// netlify/functions/admin-customers.js
//
// Admin-only (Prompt 2B.2 §2/§10). Lets an admin search for a FleetHive
// customer by email/name so they can attach a vehicle/device to the right
// account. Requires a real admin FleetHive session — see
// _deviceAccess.js's requireAdminSession(). Never reachable by an
// ordinary customer session, and password hashes are never included in
// the response.

const { requireAdminSession } = require('./_deviceAccess');
const { OwnershipError } = require('./_deviceAccess');
const db = require('./_db');

function sanitizeCustomer(c) {
  const { id, email, name, customerType, createdAt } = c;
  return { id, email, name, customerType, createdAt };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    await requireAdminSession(event);

    const q = (event.queryStringParameters && event.queryStringParameters.q) || '';
    const customers = await db.listAllCustomers(q);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customers: customers.map(sanitizeCustomer) }),
    };
  } catch (e) {
    if (e instanceof OwnershipError) {
      return { statusCode: e.status, body: JSON.stringify({ error: e.message }) };
    }
    console.error('admin-customers failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to load customers right now.' }) };
  }
};
