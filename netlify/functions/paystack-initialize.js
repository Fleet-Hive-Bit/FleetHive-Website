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
const { computeExpectedTotal } = require('./_pricing');

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

  const meta = metadata || {};

  // Amount-integrity check, step 1 — never trust the price sent from the
  // browser. Independently recompute what the FULL order total should be
  // from the structured selections (plan, vehicle type/year/count, add-on
  // ids, tag count, added plans, Hive Credits) using the server-side
  // pricing table in _pricing.js — the same table pricing.js uses, kept in
  // sync by hand. If the browser's metadata describes a recognized plan,
  // its self-reported `totalAmount` must match this recomputed total.
  const recomputedTotal = computeExpectedTotal(meta);
  if (recomputedTotal !== null) {
    const totalTolerance = 5; // naira, to allow for rounding
    if (typeof meta.totalAmount !== 'number' || Math.abs(recomputedTotal - meta.totalAmount) > totalTolerance) {
      console.error(`paystack-initialize totalAmount mismatch: recomputed ${recomputedTotal}, browser sent ${meta.totalAmount}`, meta);
      return { statusCode: 400, body: JSON.stringify({ error: 'Order total does not match FleetHive pricing. Please refresh and try again.' }) };
    }
  } else {
    // Metadata didn't describe a plan we recognize (e.g. missing planType,
    // or a plan code that isn't Lite/Pro/Prime/Tag) — there's nothing to
    // recompute against, so this checkout can't be trusted at all.
    console.error('paystack-initialize: could not verify order total — unrecognized plan/metadata', meta);
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not verify this order. Please refresh and try again.' }) };
  }

  // Amount-integrity check, step 2 — the amount actually being charged
  // TODAY must correctly reflect the (now-verified) total and the
  // Flexible Payment split: full total normally, or ~50% of it when
  // Flexible Payment is selected. This catches e.g. someone paying the
  // 50% flexible rate for what should be a full-price checkout.
  const expectedDueNow = meta.flexible ? Math.round(meta.totalAmount / 2) : meta.totalAmount;
  const dueTolerance = 5; // naira, to allow for rounding
  if (Math.abs(expectedDueNow - amount) > dueTolerance) {
    console.error(`paystack-initialize amount mismatch: expected ~${expectedDueNow}, got ${amount}`, meta);
    return { statusCode: 400, body: JSON.stringify({ error: 'Amount does not match the expected order total. Please refresh and try again.' }) };
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
