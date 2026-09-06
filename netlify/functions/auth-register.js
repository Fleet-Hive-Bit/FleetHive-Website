// netlify/functions/auth-register.js
//
// Creates a FleetHive customer account and starts a FleetHive session in
// the same request — no white-label provider involvement at all (Prompt
// 2A.1 §2/§3). This is the only place a new "cust:<id>" record is created.

const crypto = require('crypto');
const db = require('./_db');
const { hashPassword, startSession, sanitizeCustomer } = require('./_auth');

const SAFE_ERROR = 'We were unable to create your account. Please try again.';

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
  const name = String(body.name || '').trim();
  const customerType = body.customerType === 'business' ? 'business' : 'private';

  if (!email || !email.includes('@') || email.length > 254) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please provide a valid email address.' }) };
  }
  if (!name || name.length > 120) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please provide your name.' }) };
  }
  if (!password || password.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 8 characters.' }) };
  }

  try {
    const passwordHash = hashPassword(password);
    const id = crypto.randomUUID();
    const customer = await db.createCustomer({ id, email, name, passwordHash, customerType });
    const { cookie } = await startSession(customer.id);

    return {
      statusCode: 201,
      headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: sanitizeCustomer(customer) }),
    };
  } catch (e) {
    if (e.message === 'EMAIL_TAKEN') {
      return { statusCode: 409, body: JSON.stringify({ error: 'An account with that email already exists.' }) };
    }
    console.error('auth-register failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: SAFE_ERROR }) };
  }
};
