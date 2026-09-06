// netlify/functions/admin-device-assign.js
//
// Admin-only (Prompt 2B.2 §2/§5/§9/§11/§17). Body:
//   { customerId, vehicleId, whiteLabelClientId, assetId, deviceId }
//
// Every one of those identifiers is used only to look up FleetHive's own
// records or to call the provider with the exact documented parameters —
// none of them are ever treated as an ownership claim on their own (§11):
// the vehicle must already exist under the given customerId in FleetHive's
// own database (db.getVehicleForCustomer, which is scoped by construction —
// see _db.js), or this request is rejected before the provider is ever
// called.
//
// Uses POST /api/Asset/AssignAsset with exactly ClientID/DeviceId/AssetId
// (§5) — no invented parameters, no altered request shape.
//
// After a successful provider assignment, the IMEI stored on the vehicle
// record is re-fetched from the provider (GetOneDevice) rather than
// trusted from the browser (§11 explicitly lists IMEI among the fields
// that must never be trusted from the browser) — the frontend may have
// shown the admin an IMEI from the earlier device-discovery call, but this
// endpoint re-derives it server-side before persisting it.

const { requireAdminSession, OwnershipError } = require('./_deviceAccess');
const { normalizeDeviceRecord, getFriendlyErrorMessage } = require('./_deviceAccess');
const { assignAsset, getOneDevice, WhiteLabelApiError } = require('./_whiteLabelClient');
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
    console.error('admin-device-assign auth failed:', e.message);
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
  const clientId = String(body.whiteLabelClientId || '').trim();
  const assetId = String(body.assetId || '').trim();
  const deviceId = String(body.deviceId || '').trim();

  if (!customerId || !vehicleId || !clientId || !assetId || !deviceId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'customerId, vehicleId, whiteLabelClientId, assetId and deviceId are all required.' }),
    };
  }

  const vehicle = await db.getVehicleForCustomer(customerId, vehicleId);
  if (!vehicle) {
    return { statusCode: 404, body: JSON.stringify({ error: 'That vehicle could not be found on that customer\u2019s account.' }) };
  }

  const previousDeviceId = vehicle.whiteLabelDeviceId || null;

  try {
    await assignAsset({ clientId, deviceId, assetId });
  } catch (err) {
    if (err instanceof WhiteLabelApiError) {
      console.error('[admin-device-assign] provider rejected assignment', { code: err.code, status: err.status });
      return { statusCode: 502, body: JSON.stringify({ error: getFriendlyErrorMessage(err) }) };
    }
    console.error('[admin-device-assign] unexpected error', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to assign the device right now.' }) };
  }

  // Re-derive the IMEI server-side rather than trust anything the browser
  // sent (§11). Best-effort: the assignment itself already succeeded, so a
  // failure here shouldn't be reported as a failed assignment — the vehicle
  // is simply saved with imei left as whatever it already was (or null).
  let imei = null;
  try {
    const { data } = await getOneDevice({ clientId, deviceId });
    const normalized = normalizeDeviceRecord(data);
    imei = normalized && normalized.imeiNumber !== 'Data unavailable' ? normalized.imeiNumber : null;
  } catch (e) {
    console.error('[admin-device-assign] post-assign GetOneDevice lookup failed', e.message);
  }

  const updated = await db.updateVehicle(customerId, vehicleId, {
    whiteLabelClientId: clientId,
    whiteLabelDeviceId: deviceId,
    assetId,
    imei,
  });

  await db.recordAuditLog({
    action: 'device_assigned',
    adminId: adminCtx.authContext.userId,
    adminEmail: adminCtx.authContext.email,
    customerId,
    vehicleId,
    deviceId,
    clientId,
    detail: previousDeviceId
      ? `Reassigned vehicle ${vehicleId} from device ${previousDeviceId} to ${deviceId} (asset ${assetId}, client ${clientId})`
      : `Assigned device ${deviceId} to vehicle ${vehicleId} (asset ${assetId}, client ${clientId})`,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      vehicle: {
        id: updated.id,
        customerId: updated.customerId,
        label: updated.label,
        whiteLabelClientId: updated.whiteLabelClientId,
        whiteLabelDeviceId: updated.whiteLabelDeviceId,
        assetId: updated.assetId,
        imei: updated.imei,
      },
    }),
  };
};
