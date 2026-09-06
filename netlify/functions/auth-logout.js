// netlify/functions/auth-logout.js
//
// Ends the FleetHive session server-side (deletes the session record, not
// just the cookie) so a logged-out session token can't be replayed.

const { endSession } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  const cookie = await endSession(event);
  return {
    statusCode: 200,
    headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
