// netlify/functions/auth-me.js
//
// Returns the authenticated FleetHive customer for the current session, or
// 401 if there isn't one. This is what portal.html and login.html use to
// find out "is anyone logged in" — the customer identity always comes
// from the session cookie, never from anything the page passes in.

const { requireSession, sanitizeCustomer, isAdminEmail } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const session = await requireSession(event);
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };
    }
    // isAdmin is resolved server-side from ADMIN_EMAILS on every request —
    // it is informational for the frontend (e.g. showing/hiding the Admin
    // nav link) only. Every admin-* endpoint independently re-checks this
    // itself, so a tampered/replayed client can never gain admin access by
    // forging this field.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: sanitizeCustomer(session.customer),
        isAdmin: isAdminEmail(session.customer.email),
      }),
    };
  } catch (e) {
    console.error('auth-me failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to load your account right now.' }) };
  }
};
