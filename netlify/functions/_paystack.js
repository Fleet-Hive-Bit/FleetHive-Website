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
  const rows = [
    ['Order type', meta.planType === 'tagplan' ? 'Tag Plan' : meta.partnershipType ? `Partner Application — ${meta.plan || meta.partnershipType}` : `${meta.plan || 'Subscription'} Plan`],
    ['Billing', meta.billing],
    ['Customer', meta.customerName],
    ['Phone', meta.phone],
    ['Amount paid', `${symbol}${(tx.amount / 100).toLocaleString()}`],
    ['Paystack reference', tx.reference],
    ['Email', tx.customer && tx.customer.email],
    ['Date/time', new Date(tx.paid_at || Date.now()).toLocaleString()],
    ['Confirmed via', source],
  ];
  // Best-effort — the order is still marked PAID even if this email fails;
  // we don't want an email hiccup to block a genuinely verified payment.
  await sendEmail({
    subject: `✅ Paid — FleetHive order [${tx.reference}]`,
    rows,
    replyTo: tx.customer && tx.customer.email,
  });

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
