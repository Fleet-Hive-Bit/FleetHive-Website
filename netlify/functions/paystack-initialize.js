// netlify/functions/paystack-initialize.js
//
// Initializes a Paystack transaction server-side. The Paystack SECRET key
// lives only here as a Netlify environment variable — it is never sent to
// the browser. The frontend calls this function, then redirects the visitor
// to the returned authorization_url (Paystack's hosted checkout page).
//
// TEST MODE ONLY (for now): this will refuse to run with a live secret key
// (sk_live_...) unless ALLOW_LIVE_PAYSTACK=true is also set. See
// _paystack.js.
//
// Required Netlify environment variable:
//   PAYSTACK_SECRET_KEY   — use your sk_test_... key while testing
//
// See SETUP.md for how to get this from your Paystack dashboard.

const { getSecretKey } = require('./_paystack');
const { saveOrder } = require('./_store');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const keyResult = getSecretKey();
  if (keyResult.error) {
    console.error(keyResult.error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Payment service not configured' }) };
  }
  const { secretKey } = keyResult;

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, amount, metadata, callback_url, currency } = payload;

  if (!email || !amount || amount <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing/invalid email or amount' }) };
  }

  const amountKobo = Math.round(amount * 100);

  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        // Paystack expects the smallest currency unit (kobo for NGN, cents
        // for USD). Amount arrives from the frontend in the major unit, so
        // convert here. Defaults to NGN for the existing pricing/checkout flow.
        amount: amountKobo,
        currency: currency || 'NGN',
        metadata: metadata || {},
        callback_url: callback_url || undefined,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.status) {
      console.error('Paystack initialize error:', data);
      return { statusCode: 502, body: JSON.stringify({ error: data.message || 'Paystack rejected the request' }) };
    }

    // Record what we asked Paystack to charge, keyed by the reference it
    // generated. paystack-verify.js / paystack-webhook.js check the amount
    // actually paid against this before marking anything PAID/ACTIVE.
    await saveOrder(data.data.reference, {
      status: 'INITIALIZED',
      expectedAmountKobo: amountKobo,
      currency: currency || 'NGN',
      customerEmail: email,
      metadata: metadata || {},
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        authorization_url: data.data.authorization_url,
        access_code: data.data.access_code,
        reference: data.data.reference,
      }),
    };
  } catch (err) {
    console.error('paystack-initialize failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error' }) };
  }
};
