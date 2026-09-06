// netlify/functions/admin-audit-log.js
//
// Admin-only (Prompt 2B.2 §10/§17 — "review operational information").
// Read-only view of the audit trail recorded by admin-device-assign.js /
// admin-device-unassign.js / admin-vehicles.js. Never contains secrets —
// see the explicit allow-list in _db.js's recordAuditLog().

const { requireAdminSession, OwnershipError } = require('./_deviceAccess');
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    await requireAdminSession(event);
    const entries = await db.listRecentAuditLog(50);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    };
  } catch (e) {
    if (e instanceof OwnershipError) {
      return { statusCode: e.status, body: JSON.stringify({ error: e.message }) };
    }
    console.error('admin-audit-log failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to load the audit log right now.' }) };
  }
};
