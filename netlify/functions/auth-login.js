// netlify/functions/auth-login.js
//
// The one FleetHive customer login (Prompt 2A.1 §2). Verifies the
// password against the stored hash and starts a FleetHive session —
// never touches or redirects to the white-label provider.

const db = require('./_db');
const { verifyPassword, startSession, sanitizeCustomer } = require('./_auth');

const SAFE_ERROR = 'That email or password is incorrect.';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const email = String(body.email || '').trim();
  const password = String(body.password || '');

  if (!email || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: SAFE_ERROR }) };
  }

  try {
    const customer = await db.getCustomerByEmail(email);
    // Same generic message whether the email doesn't exist or the
    // password is wrong — never reveal which one it was.
    if (!customer || !verifyPassword(password, customer.passwordHash)) {
      return { statusCode: 401, body: JSON.stringify({ error: SAFE_ERROR }) };
    }

    const { cookie } = await startSession(customer.id);
    return {
      statusCode: 200,
      headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: sanitizeCustomer(customer) }),
    };
  } catch (e) {
    console.error('auth-login failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'We were unable to sign you in right now. Please try again.' }) };
  }
};
