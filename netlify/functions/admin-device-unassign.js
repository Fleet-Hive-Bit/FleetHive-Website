// netlify/functions/admin-device-unassign.js
//
// Admin-only (Prompt 2B.2 §2/§6/§9/§17). Body: { customerId, vehicleId }.
//
// The white-label ClientID/DeviceId used for the provider call are never
// taken from the request body — they're resolved strictly from FleetHive's
// own vehicle record (§11), which itself is looked up scoped to the given
// customerId (a mismatched customerId/vehicleId pair simply won't be
// found, exactly like every other lookup in this codebase).
//
// Uses POST /api/Asset/UnAssignAsset with exactly ClientID/DeviceId (§6) —
// no invented parameters.

const { requireAdminSession, OwnershipError, getFriendlyErrorMessage } = require('./_deviceAccess');
const { unassignAsset, WhiteLabelApiError } = require('./_whiteLabelClient');
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let adminCtx;
  try {
    adminCtx = await requireAdminSession(event);
  } catch (e) {
    if (e instanceof OwnershipError) {
      return { statusCode: e.status, body: JSON.stringify({ error: e.message }) };
    }
    console.error('admin-device-unassign auth failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const customerId = String(body.customerId || '').trim();
  const vehicleId = String(body.vehicleId || '').trim();
  if (!customerId || !vehicleId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'customerId and vehicleId are required.' }) };
  }

  const vehicle = await db.getVehicleForCustomer(customerId, vehicleId);
  if (!vehicle) {
    return { statusCode: 404, body: JSON.stringify({ error: 'That vehicle could not be found on that customer\u2019s account.' }) };
  }
  if (!vehicle.whiteLabelClientId || !vehicle.whiteLabelDeviceId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'That vehicle has no device assigned to unassign.' }) };
  }

  const { whiteLabelClientId: clientId, whiteLabelDeviceId: deviceId } = vehicle;

  try {
    await unassignAsset({ clientId, deviceId });
  } catch (err) {
    if (err instanceof WhiteLabelApiError) {
      console.error('[admin-device-unassign] provider rejected unassignment', { code: err.code, status: err.status });
      return { statusCode: 502, body: JSON.stringify({ error: getFriendlyErrorMessage(err) }) };
    }
    console.error('[admin-device-unassign] unexpected error', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to unassign the device right now.' }) };
  }

  const updated = await db.updateVehicle(customerId, vehicleId, {
    whiteLabelClientId: null,
    whiteLabelDeviceId: null,
    assetId: null,
    imei: null,
  });

  await db.recordAuditLog({
    action: 'device_unassigned',
    adminId: adminCtx.authContext.userId,
    adminEmail: adminCtx.authContext.email,
    customerId,
    vehicleId,
    deviceId,
    clientId,
    detail: `Unassigned device ${deviceId} from vehicle ${vehicleId} (client ${clientId})`,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      vehicle: { id: updated.id, customerId: updated.customerId, label: updated.label },
    }),
  };
};
