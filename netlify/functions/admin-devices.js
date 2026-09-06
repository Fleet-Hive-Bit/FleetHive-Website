// netlify/functions/admin-devices.js
//
// Admin-only (Prompt 2B.2 §2/§3/§4). Device discovery, following the
// documented provider hierarchy rather than guessing which endpoint to
// use (§3):
//
//   - No ?clientId= query param -> GET /api/Asset/GetResellerDevices
//     (reseller-wide: every device across every white-label client under
//     FleetHive's account). This is the broad "what devices exist that I
//     could assign" view an admin needs, and per _whiteLabelClient.js's
//     own doc comment it must only ever be called from admin-gated code —
//     which this endpoint is. It is NEVER exposed to a customer session
//     (§3 — "do not retrieve all reseller devices and expose them to
//     customers").
//   - ?clientId=<id> -> POST /api/Asset/GetAllDevice (client-scoped):
//     lets an admin check what's already registered under one specific
//     white-label client before assigning something new to it.
//
// Only the documented device fields (§4) are ever returned — see
// normalizeDeviceRecord() in _deviceAccess.js, which is an explicit
// allow-list, not a passthrough of the raw provider response.

const { requireAdminSession, OwnershipError, normalizeDeviceRecord, getFriendlyErrorMessage } = require('./_deviceAccess');
const { getResellerDevices, getAllDevices, WhiteLabelApiError } = require('./_whiteLabelClient');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    await requireAdminSession(event);
  } catch (e) {
    if (e instanceof OwnershipError) {
      return { statusCode: e.status, body: JSON.stringify({ error: e.message }) };
    }
    console.error('admin-devices auth failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error.' }) };
  }

  const clientId = event.queryStringParameters && event.queryStringParameters.clientId;

  try {
    const { data } = clientId ? await getAllDevices({ clientId }) : await getResellerDevices();
    const rawDevices = Array.isArray(data) ? data : [];
    const devices = rawDevices.map(normalizeDeviceRecord).filter(Boolean);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices, scope: clientId ? 'client' : 'reseller' }),
    };
  } catch (err) {
    if (err instanceof WhiteLabelApiError) {
      console.error('[admin-devices] provider error', { code: err.code, status: err.status });
      return { statusCode: 502, body: JSON.stringify({ error: getFriendlyErrorMessage(err) }) };
    }
    console.error('[admin-devices] unexpected error', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to retrieve devices right now.' }) };
  }
};
