// netlify/functions/_paystack.js
//
// Shared logic used by paystack-initialize.js, paystack-verify.js and
// paystack-webhook.js:
//
//   - getSecretKey()      TEST MODE GUARD. Reads PAYSTACK_SECRET_KEY and
//                          refuses to proceed with a live key (sk_live_...)
//                          unless ALLOW_LIVE_PAYSTACK=true is explicitly
//                          set in the environment. This is the safety net
//                          for "test mode only, for now."
//   - verifyTransaction() Calls Paystack's /transaction/verify/:reference
//                          API directly. This is the ONLY source of truth
//                          for whether a payment succeeded — the frontend
//                          redirect and the webhook body are both treated
//                          as hints, never as proof.
//   - finalizeIfSuccess() Shared by paystack-verify.js (called from the
//                          browser after redirect) and paystack-webhook.js
//                          (called by Paystack server-to-server). Confirms
//                          the transaction, checks the paid amount against
//                          what FleetHive asked Paystack to charge at
//                          initialize time, persists the order, and sends
//                          the confirmation email — all exactly once per
//                          reference, however many times it's called.

const crypto = require('crypto');
const { sendEmail } = require('./_email');
const { getOrder, saveOrder } = require('./_store');

const LIVE_KEY_PREFIX = 'sk_live_';

function getSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return { error: 'PAYSTACK_SECRET_KEY is not set in Netlify environment variables' };
  }
  const allowLive = process.env.ALLOW_LIVE_PAYSTACK === 'true';
  if (secretKey.startsWith(LIVE_KEY_PREFIX) && !allowLive) {
    return {
      error:
        'A Paystack LIVE secret key is set, but this integration is running in test-mode-only. ' +
        'Use your sk_test_... key while testing. (To go live later, set ALLOW_LIVE_PAYSTACK=true as well.)',
    };
  }
  return { secretKey, isTest: secretKey.startsWith('sk_test_') };
}

// Verifies the raw Paystack webhook signature. Paystack signs the exact
// raw request body with your secret key using HMAC-SHA512 and sends it in
// the x-paystack-signature header — this is what proves a webhook call
// actually came from Paystack and wasn't forged by a third party hitting
// the endpoint directly.
function verifyWebhookSignature(rawBody, signatureHeader, secretKey) {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signatureHeader, 'utf8'));
  } catch (e) {
    return false;
  }
}

async function verifyTransaction(reference, secretKey) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    const err = new Error((data && data.message) || 'Could not verify transaction');
    err.upstream = data;
    throw err;
  }
  return data.data; // the transaction object
}

// Idempotent: safe to call twice for the same reference (frontend redirect
// + webhook both landing). Only the first successful call sends the email
// / marks the order PAID; later calls just return the same result.
async function finalizeIfSuccess(tx, source) {
  const success = tx.status === 'success';
  const reference = tx.reference;

  const existing = await getOrder(reference);
  if (existing && existing.status === 'PAID') {
    return { success: true, alreadyProcessed: true, order: existing };
  }

  if (!success) {
    await saveOrder(reference, { status: tx.status === 'abandoned' ? 'ABANDONED' : 'FAILED', paystackStatus: tx.status, source });
    return { success: false, order: null };
  }

  // Amount integrity check: compare what Paystack actually collected
  // against what FleetHive asked it to charge when the transaction was
  // initialized (recorded in _store by paystack-initialize.js). This
  // catches tampering/mismatch between initialize and payment — it does
  // NOT mark an order PAID/ACTIVE if the amounts disagree.
  let amountOk = true;
  if (existing && typeof existing.expectedAmountKobo === 'number') {
    amountOk = existing.expectedAmountKobo === tx.amount;
  }

  if (!amountOk) {
    console.error(`Amount mismatch for ${reference}: expected ${existing.expectedAmountKobo}, got ${tx.amount}`);
    await saveOrder(reference, {
      status: 'AMOUNT_MISMATCH',
      paystackStatus: tx.status,
      paidAmountKobo: tx.amount,
      source,
    });
    // Alert the team — this needs a human look, never auto-activate.
    await sendEmail({
      subject: `⚠️ Amount mismatch — FleetHive order [${reference}]`,
      rows: [
        ['Reference', reference],
        ['Expected (kobo)', existing.expectedAmountKobo],
        ['Paid (kobo)', tx.amount],
        ['Customer email', tx.customer && tx.customer.email],
      ],
    });
    return { success: false, order: null, amountMismatch: true };
  }

  const meta = tx.metadata || {};
  const symbol = tx.currency === 'USD' ? '$' : '₦';
  const money = (n) => (typeof n === 'number' ? `${symbol}${n.toLocaleString()}` : n || 'Not provided');
  const isTagPlan = meta.planType === 'tagplan';
  const orderTypeLabel = isTagPlan
    ? 'Tag Plan'
    : meta.partnershipType
    ? `Partner Application — ${meta.plan || meta.partnershipType}`
    : `${meta.plan || 'Subscription'} Plan`;

  // NEW FLEETHIVE CUSTOMER — internal notification. Includes everything the
  // team needs to action the order: contact info, plan, vehicle/tag
  // details, location, amount, payment method and flexible-payment split
  // (if applicable).
  const rows = [
    ['Name', meta.customerName],
    ['Email', tx.customer && tx.customer.email],
    ['Phone', meta.phone],
    ['Plan', orderTypeLabel],
    ['Billing', meta.billing],
    ['Vehicle type', meta.vehicleType],
    ['Vehicle year', meta.vehicleYear],
    ['Vehicle count', meta.vehCount],
    ['Amount paid', money(tx.amount / 100)],
    ['Payment reference', tx.reference],
    ['Location', meta.location],
    ['Payment method', 'Paystack'],
    ['Timestamp', new Date(tx.paid_at || Date.now()).toLocaleString()],
    ['Confirmed via', source],
  ];
  if (isTagPlan) {
    rows.push(
      ['Number of Tags', meta.tagCount],
      ['Total amount', money(meta.totalAmount)],
      ['Subscription option', meta.billing]
    );
  }
  if (meta.addons) rows.push(['Add-ons', meta.addons]);
  if (meta.addedPlans) rows.push(['Additional plans', meta.addedPlans]);
  if (meta.hiveCredits) rows.push(['Hive Credits', money(meta.hiveCredits)]);
  if (meta.flexible) {
    rows.push(
      ['Flexible payment', 'Yes'],
      ['Total order amount', money(meta.totalAmount)],
      ['Amount paid today', money(tx.amount / 100)],
      ['Remaining balance', money(meta.remainingBalance)],
      ['Monthly installment', `${money(meta.monthlyInstallment)} for ${meta.remainingMonths || 3} months`]
    );
  }
  // Best-effort — the order is still marked PAID even if this email fails;
  // we don't want an email hiccup to block a genuinely verified payment.
  await sendEmail({
    subject: `NEW FLEETHIVE CUSTOMER — ✅ Paid [${tx.reference}]`,
    rows,
    replyTo: tx.customer && tx.customer.email,
  });

  // Customer receipt — separate email, sent to the customer's own address
  // rather than the FleetHive team inbox. Also best-effort: a failure here
  // never blocks marking the order PAID.
  if (tx.customer && tx.customer.email) {
    const orderLabel = isTagPlan ? 'FleetHive Tag Plan order' : meta.partnershipType ? 'FleetHive partnership fee' : `FleetHive ${meta.plan || 'subscription'} order`;
    const custRows = [
      ['Customer name', meta.customerName],
      ['Plan', orderTypeLabel],
      ['Amount paid', money(tx.amount / 100)],
      ['Payment reference', tx.reference],
      ['Payment status', 'Successful'],
      ['Next steps', 'Our team will contact you within 24 hours to arrange installation/delivery.'],
      ['Support', 'support@fleethive.in · +234 702 577 1522'],
    ];
    if (meta.flexible) {
      custRows.splice(4, 0,
        ['Total order amount', money(meta.totalAmount)],
        ['Amount paid today', money(tx.amount / 100)],
        ['Remaining balance', money(meta.remainingBalance)],
        ['Monthly installment', `${money(meta.monthlyInstallment)} for ${meta.remainingMonths || 3} months`]
      );
    }
    await sendEmail({
      subject: `Payment successful — Welcome to FleetHive! [${tx.reference}]`,
      intro: `Hi${meta.customerName ? ' ' + meta.customerName : ''}, payment successful — welcome to FleetHive! We've received your payment for your ${orderLabel}. Our team will be in touch with next steps.`,
      rows: custRows,
      toEmail: tx.customer.email,
      replyTo: 'support@fleethive.in',
    });
  }

  const order = {
    status: 'PAID',
    paystackStatus: tx.status,
    amountKobo: tx.amount,
    currency: tx.currency,
    customerEmail: tx.customer && tx.customer.email,
    metadata: meta,
    paidAt: tx.paid_at,
    source,
  };
  await saveOrder(reference, order);

  return { success: true, alreadyProcessed: false, order };
}

module.exports = { getSecretKey, verifyWebhookSignature, verifyTransaction, finalizeIfSuccess };
