// netlify/functions/vehicle-status.js
//
// Fleet Intelligence — Prompt 2A.2 §6/§7/§13.
//
// Returns the authenticated customer's CURRENT status (and lock status)
// for ONE of their own vehicles. Follows the architecture in §15:
//
//   Browser -> this function -> resolveOwnedDevice() -> _whiteLabelClient
//           -> normalized/"Data unavailable" response -> Browser
//
// The browser-supplied vehicleId is never trusted as proof of ownership —
// resolveOwnedDevice() (in _deviceAccess.js) re-derives the white-label
// ClientID/DeviceId/IMEI strictly from FleetHive's own database, scoped to
// the session-authenticated customer. Those provider identifiers are
// never included in this function's response (§9/§23) — only the
// normalized, customer-facing fields are.
//
// If the vehicle belongs to the customer but has no admin-linked tracking
// device yet (no admin linking tool exists in this codebase — see
// _deviceAccess.js), this responds 200 with `linked:false` rather than an
// error, so a legitimate, ownership-verified vehicle isn't presented to
// the UI as a failure.

const { requireSession } = require('./_auth');
const {
  resolveOwnedDevice,
  normalizeDeviceStatus,
  normalizeLockStatus,
  deriveFriendlyStatus,
  getFriendlyErrorMessage,
  OwnershipError,
  NotImplementedError,
} = require('./_deviceAccess');
const whiteLabel = require('./_whiteLabelClient');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const vehicleId = event.queryStringParameters && event.queryStringParameters.vehicleId;
  if (!vehicleId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'vehicleId is required.' }) };
  }

  try {
    const session = await requireSession(event);
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };
    }

    // authContext deliberately built from the server-verified session only
    // — never from anything in the request body/query beyond the vehicleId
    // being looked up, which resolveOwnedDevice() re-checks against the
    // customer's own records regardless.
    const authContext = { userId: session.customer.id, roles: [] };

    let device;
    try {
      device = await resolveOwnedDevice(authContext, vehicleId);
    } catch (e) {
      if (e instanceof NotImplementedError) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vehicleId, linked: false, message: e.message }),
        };
      }
      if (e instanceof OwnershipError) {
        return { statusCode: e.status, body: JSON.stringify({ error: e.message }) };
      }
      throw e;
    }

    const [statusRes, lockRes] = await Promise.allSettled([
      whiteLabel.getCurrentDeviceStatusByImei({ imeiNumber: device.imeiNumber }),
      whiteLabel.getCurrentDeviceLockStatusByImei({ imeiNumber: device.imeiNumber }),
    ]);

    if (statusRes.status === 'rejected') {
      console.error('vehicle-status: status fetch failed:', vehicleId, statusRes.reason && statusRes.reason.message);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId, linked: true, error: getFriendlyErrorMessage(statusRes.reason) }),
      };
    }

    const normalizedStatus = normalizeDeviceStatus(statusRes.value && statusRes.value.data);
    const friendly = deriveFriendlyStatus(normalizedStatus);
    const lock = lockRes.status === 'fulfilled' ? normalizeLockStatus(lockRes.value && lockRes.value.data) : null;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicleId,
        linked: true,
        fetchedAt: new Date().toISOString(),
        status: normalizedStatus,
        friendly,
        lock,
      }),
    };
  } catch (e) {
    console.error('vehicle-status failed:', vehicleId, e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Vehicle data is temporarily unavailable. Please try again shortly.' }),
    };
  }
};
