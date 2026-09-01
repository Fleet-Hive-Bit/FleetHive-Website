// netlify/functions/paystack-webhook.js
//
// Paystack webhook target. This is the second, independent confirmation
// path recommended by Paystack — it fires server-to-server even if the
// customer closes their browser before the redirect back to pricing.html
// completes, so an order still gets confirmed/recorded.
//
// Set this URL in Paystack Dashboard → Settings → API Keys & Webhooks →
// Webhook URL:
//   https://YOUR-SITE.netlify.app/.netlify/functions/paystack-webhook
//
// Security: every request is checked against the x-paystack-signature
// header (HMAC-SHA512 of the raw body, signed with your secret key).
// Requests that don't match are rejected — this is what stops anyone else
// from POSTing a fake "payment succeeded" event at this URL.
//
// Even after the signature checks out, this NEVER trusts the amount/status
// in the webhook body directly — it re-verifies the transaction against
// Paystack's API (verifyTransaction) before doing anything, exactly like
// paystack-verify.js. Both paths share the same finalizeIfSuccess logic in
// _paystack.js, so this is idempotent with the redirect-based verification.
//
// Required Netlify environment variable:
//   PAYSTACK_SECRET_KEY

const { getSecretKey, verifyWebhookSignature, verifyTransaction, finalizeIfSuccess } = require('./_paystack');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const keyResult = getSecretKey();
  if (keyResult.error) {
    console.error(keyResult.error);
    // 500 so Paystack retries once the key is fixed, rather than giving up.
    return { statusCode: 500, body: 'Payment service not configured' };
  }
  const { secretKey } = keyResult;

  const rawBody = event.body || '';
  const signature = event.headers['x-paystack-signature'] || event.headers['X-Paystack-Signature'];

  if (!verifyWebhookSignature(rawBody, signature, secretKey)) {
    console.error('paystack-webhook: invalid signature — rejecting request');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Only charge.success needs action here; acknowledge everything else so
  // Paystack doesn't keep retrying events we don't care about.
  if (payload.event !== 'charge.success') {
    return { statusCode: 200, body: 'ignored' };
  }

  const reference = payload.data && payload.data.reference;
  if (!reference) {
    return { statusCode: 400, body: 'Missing reference' };
  }

  try {
    // Re-verify against Paystack directly rather than trusting the webhook
    // payload's own amount/status fields.
    const tx = await verifyTransaction(reference, secretKey);
    await finalizeIfSuccess(tx, 'webhook');
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('paystack-webhook failed:', err);
    // 500 so Paystack retries.
    return { statusCode: 500, body: 'Unexpected server error' };
  }
};
