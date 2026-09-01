// netlify/functions/paystack-verify.js
//
// Verifies a Paystack transaction server-side by its reference. Called by
// pricing.html when the visitor lands back on the site after Paystack
// checkout (?reference=...). A transaction is only ever treated as paid
// after this function confirms status "success" directly with Paystack —
// never based on the frontend redirect alone.
//
// Shares its confirmation/idempotency/amount-check logic with
// paystack-webhook.js via _paystack.js, so a browser redirect and a
// webhook call for the same reference can never double-activate an order
// or double-send the confirmation email.
//
// Required Netlify environment variable:
//   PAYSTACK_SECRET_KEY
// Optional (for the confirmation email): RESEND_API_KEY

const { getSecretKey, verifyTransaction, finalizeIfSuccess } = require('./_paystack');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const keyResult = getSecretKey();
  if (keyResult.error) {
    console.error(keyResult.error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Payment service not configured' }) };
  }
  const { secretKey } = keyResult;

  const reference =
    (event.queryStringParameters && event.queryStringParameters.reference) ||
    (event.body && JSON.parse(event.body).reference);

  if (!reference) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing reference' }) };
  }

  try {
    const tx = await verifyTransaction(reference, secretKey);
    const result = await finalizeIfSuccess(tx, 'redirect');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: result.success,
        status: tx.status,
        reference: tx.reference,
        amount: tx.amount / 100,
        paidAt: tx.paid_at,
        metadata: tx.metadata,
        amountMismatch: !!result.amountMismatch,
      }),
    };
  } catch (err) {
    console.error('paystack-verify failed:', err);
    return { statusCode: 502, body: JSON.stringify({ error: err.message || 'Could not verify transaction' }) };
  }
};
