// netlify/functions/customer-subscription.js
//
// Authenticated endpoint (Prompt 2B.1 §1/§3/§13) that gives the Customer
// Portal a "current plan" view built entirely from the customer's own
// verified Paystack orders (_store.js) — never from anything the browser
// asserts, and never from a separate/second subscription system (§1 says
// reuse what exists; there is no live recurring-billing system to reuse,
// so this derives an informational view from real order records).
//
// IMPORTANT — be explicit about what this is NOT:
// Paystack is only ever used here as a one-off "initialize a transaction"
// charge (see paystack-initialize.js) — never a subscription/authorization
// API. There is no webhook or cron that automatically marks a renewal
// PAID or FAILED on its own. So "subscription status" below is a DERIVED,
// INFORMATIONAL label computed from elapsed time since the customer's most
// recent successful payment plus whether the customer has a more recent
// failed/mismatched attempt — it is not a live state read from Paystack,
// and it does not update itself the moment a real-world payment lapses;
// it updates the next time this endpoint is called.
//
// Only orders placed while the customer was signed in are linked to their
// account (see _store.js / paystack-initialize.js) — anonymous checkouts
// made before login are not retroactively attributed.

const { requireSession } = require('./_auth');
const { getOrdersForCustomer } = require('./_store');
const { PLANS, TAGPLAN_RENEW_M, TAGPLAN_RENEW_Y } = require('./_pricing');

const MS_DAY = 24 * 60 * 60 * 1000;

function planLabel(meta) {
  if (!meta) return 'Unknown';
  if (meta.planType === 'tagplan') {
    const inner = meta.tagPlan && PLANS[meta.tagPlan] ? PLANS[meta.tagPlan].name : null;
    return inner ? `Fleet Tag (${inner})` : 'Fleet Tag';
  }
  if (PLANS[meta.planType]) return PLANS[meta.planType].name;
  return meta.plan || 'Subscription';
}

// How long a payment "covers" before the next one is due, in days —
// mirrors the billing cycle implied by the order itself. Fleet Tag orders
// include 3 months free tracking before the tag renewal cycle kicks in
// (TAGPLAN_RENEW_M/Y are the renewal AMOUNTS, not used for timing here,
// but the 3-month free period they follow is what sets the first cycle).
function cycleDays(order) {
  const meta = order.metadata || {};
  if (meta.planType === 'tagplan') return 90; // 3 months free tracking, then renews
  if (meta.billing === 'annual') return 365;
  return 30; // default: monthly billing
}

function billingFrequencyLabel(order) {
  const meta = order.metadata || {};
  if (meta.planType === 'tagplan') return 'Every 3 months (Fleet Tag renewal)';
  return meta.billing === 'annual' ? 'Annual' : 'Monthly';
}

// Derives a status label from elapsed time + whether anything went wrong
// since the last successful payment. This is an informational label, not
// proof of a live Paystack state — see the file header note above.
function deriveStatus(paidOrder, moreRecentOrders) {
  const failedSince = moreRecentOrders.find(
    (o) => (o.status === 'FAILED' || o.status === 'AMOUNT_MISMATCH') &&
      new Date(o.updatedAt || 0) > new Date(paidOrder.paidAt || paidOrder.updatedAt || 0)
  );
  if (failedSince) {
    return failedSince.status === 'AMOUNT_MISMATCH' ? 'Payment Failed' : 'Payment Failed';
  }

  const paidAt = paidOrder.paidAt ? new Date(paidOrder.paidAt) : new Date(paidOrder.updatedAt || Date.now());
  const days = cycleDays(paidOrder);
  const nextDue = new Date(paidAt.getTime() + days * MS_DAY);
  const now = new Date();
  const graceDays = 7;

  if (now <= nextDue) return 'Active';
  if (now <= new Date(nextDue.getTime() + graceDays * MS_DAY)) return 'Payment Due';
  return 'Expired';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const session = await requireSession(event);
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };
    }

    const orders = await getOrdersForCustomer(session.customer.id);

    // Payment history — the customer's own orders only, most recent first,
    // sanitized to what a customer should see (no internal fields like
    // expectedAmountKobo, source, or raw Paystack status codes).
    const history = orders
      .filter((o) => o.status === 'PAID' || o.status === 'FAILED' || o.status === 'AMOUNT_MISMATCH')
      .map((o) => ({
        reference: o.reference,
        plan: planLabel(o.metadata),
        amount: typeof o.amountKobo === 'number' ? o.amountKobo / 100 : (o.metadata && o.metadata.totalAmount) || null,
        currency: o.currency || 'NGN',
        status: o.status === 'PAID' ? 'Paid' : 'Failed',
        date: o.paidAt || o.updatedAt || null,
      }));

    const paidOrders = orders.filter((o) => o.status === 'PAID');
    if (!paidOrders.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hasSubscription: false,
          history,
        }),
      };
    }

    // Most recent PAID order = current plan. getOrdersForCustomer() already
    // sorts most-recent-first.
    const current = paidOrders[0];
    const meta = current.metadata || {};
    const status = deriveStatus(current, orders);

    const paidAt = current.paidAt ? new Date(current.paidAt) : new Date(current.updatedAt || Date.now());
    const nextPayment = new Date(paidAt.getTime() + cycleDays(current) * MS_DAY);

    // Outstanding balance is only ever surfaced from a Flexible Payment
    // order's own recorded remaining balance — never invented from a
    // missed-payment guess.
    const outstandingBalance = meta.flexible && typeof meta.remainingBalance === 'number'
      ? meta.remainingBalance
      : null;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hasSubscription: true,
        currentPlan: planLabel(meta),
        // Raw values (not just the display label) so the Portal's "Make
        // Payment" action can deep-link to pricing.html?plan=&billing=
        // with the right plan preselected (§4/§13) — reusing the existing
        // query-param preselect in pricing.js, never a second payment flow.
        planType: meta.planType || null,
        billing: meta.billing || 'monthly',
        status,
        billingFrequency: billingFrequencyLabel(current),
        nextPayment: status === 'Expired' ? null : nextPayment.toISOString(),
        outstandingBalance,
        currency: current.currency || 'NGN',
        lastPaymentAmount: typeof current.amountKobo === 'number' ? current.amountKobo / 100 : null,
        lastPaymentDate: current.paidAt || current.updatedAt || null,
        history,
      }),
    };
  } catch (e) {
    console.error('customer-subscription failed:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "We're unable to load your subscription right now. Please try again." }),
    };
  }
};
