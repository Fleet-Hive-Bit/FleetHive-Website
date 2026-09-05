// netlify/functions/_deviceAccess.js
//
// Two things live here, both required by Prompt 1B but deliberately kept
// separate from _whiteLabelClient.js (which only knows the provider's API
// shape and nothing about FleetHive customers):
//
//   1. Response normalizers — turn raw provider fields (lat/lon/
//      IgnitionState/Speed/etc., lock Status -1/0/1) into a safe shape for
//      the rest of the app, without ever fabricating a value the provider
//      didn't actually return.
//
//   2. The Customer → Vehicle → White-label Client → Asset → Device → IMEI
//      ownership boundary and the IDOR checks that must run before any
//      vehicle-scoped provider call is made.
//
// IMPORTANT — about part 2:
// FleetHive doesn't yet have a customer/vehicle database or a login
// system in this codebase (Prompt 1A only covered the marketing site).
// Building a real `resolveOwnedDevice()` requires that database, which is
// explicitly out of scope here — Prompt 1B's own STOP CONDITION says the
// full Customer Portal belongs to Prompt 2, and this file's job is to
// define the exact contract/shape that portal must satisfy, so wiring it
// up later is a matter of filling in real lookups where marked below
// rather than re-deriving the ownership model from scratch.
//
// Every one of the 5 checks in Prompt 1B §9 is represented as an explicit
// step here, in order, so Prompt 2 can't accidentally skip one.

// ---------------------------- Normalizers --------------------------------

const UNAVAILABLE = 'Data unavailable';

function orUnavailable(value) {
  return value === null || value === undefined || value === '' ? UNAVAILABLE : value;
}

// Maps the raw response of POST /api/Asset/CurrentDeviceStatusByImei
// (and the equivalent fields inside GetAllDevice / GetDevicesCurrentData)
// into a normalized shape. Never invents a value for a field the provider
// didn't return — those become "Data unavailable" for display.
function normalizeDeviceStatus(raw) {
  if (!raw) {
    return {
      lat: UNAVAILABLE,
      lon: UNAVAILABLE,
      location: UNAVAILABLE,
      ignitionState: UNAVAILABLE,
      motionState: UNAVAILABLE,
      speed: UNAVAILABLE,
      odometer: UNAVAILABLE,
      eventName: UNAVAILABLE,
      utcDate: UNAVAILABLE,
      battery: UNAVAILABLE,
    };
  }
  return {
    lat: orUnavailable(raw.lat),
    lon: orUnavailable(raw.lon),
    location: orUnavailable(raw.location),
    ignitionState: orUnavailable(raw.IgnitionState),
    motionState: orUnavailable(raw.MotionState),
    speed: orUnavailable(raw.Speed),
    odometer: orUnavailable(raw.odometer),
    eventName: orUnavailable(raw.EventName),
    utcDate: orUnavailable(raw.utc_date),
    battery: orUnavailable(raw.battery),
  };
}

// Maps POST /api/Asset/CurrentDeviceLockStatusByImei.
// Documented values: 1 = Locked, 0 = UnLocked, -1 = Undetermined.
// -1 must NEVER be shown as locked or unlocked — this is the one place
// that mapping happens, so nothing downstream can get it wrong.
function normalizeLockStatus(raw) {
  const status = raw && typeof raw.Status !== 'undefined' ? Number(raw.Status) : null;
  if (status === 1) return { state: 'locked', label: 'Locked' };
  if (status === 0) return { state: 'unlocked', label: 'Unlocked' };
  // Covers -1 and any unexpected/missing value — always undetermined,
  // never guessed as locked or unlocked.
  return { state: 'undetermined', label: 'Undetermined' };
}

// Maps the GetAllDevice / GetOneDevice device record fields (§7).
function normalizeDeviceRecord(raw) {
  if (!raw) return null;
  return {
    deviceId: orUnavailable(raw.DeviceId),
    imeiNumber: orUnavailable(raw.ImeiNumber),
    assignedAssetId: orUnavailable(raw.AssignedAssetId),
    deviceTypeId: orUnavailable(raw.DeviceTypeId),
    serialNumber: orUnavailable(raw.SerialNumber),
    description: orUnavailable(raw.Description),
    gsmNumber: orUnavailable(raw.GsmNumber),
    dateCreated: orUnavailable(raw.DateCreated),
    softwareSpeedLimit: orUnavailable(raw.SoftwareSpeedLimit),
    lastGpsDateTime: orUnavailable(raw.LastGpsDateTime),
    tagNo: orUnavailable(raw.TagNo),
    deactivationDate: orUnavailable(raw.DeactivationDate),
  };
}

// ------------------------- Friendly error mapping -------------------------
//
// Never show a customer a raw provider error ("401 Unauthorized", a stack
// trace, etc. — Prompt 1B §19). Log the technical detail server-side
// (already redacted of secrets by _whiteLabelClient's safeLog) and return
// one of these safe messages instead.
function getFriendlyErrorMessage(err) {
  const code = err && err.code;
  switch (code) {
    case 'RANGE_TOO_LARGE':
      return 'That date range is too large for a single request. Please choose a shorter range.';
    case 'RATE_LIMITED':
      return "We're getting a lot of tracking requests right now. Please try again in a moment.";
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
    case 'PROVIDER_5XX':
      return 'Unable to retrieve vehicle information right now. Please try again shortly.';
    case 'AUTH_FAILED':
    case 'NOT_CONFIGURED':
      return 'Vehicle tracking is temporarily unavailable. Our team has been notified.';
    case 'BAD_REQUEST':
      return 'That request was missing some required information.';
    default:
      return 'Unable to retrieve vehicle information right now. Please try again shortly.';
  }
}

// ---------------------- Ownership / IDOR foundation -----------------------

class OwnershipError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'OwnershipError';
    this.status = status;
  }
}

class NotImplementedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotImplementedError';
    this.status = 501;
  }
}

// Resolves the provider identifiers (ClientID / DeviceId / IMEI) for a
// FleetHive vehicle the authenticated user is asking about — running every
// check from Prompt 1B §9, in order, before any provider call is allowed:
//
//   1. authContext.userId is present and their session/token is valid.
//   2. Their FleetHive account is active.
//   3. They hold permission to view vehicles at all.
//   4. The requested vehicleId actually belongs to their account (never
//      the browser-supplied vehicleId/imei/clientId/deviceId alone).
//   5. Only THEN are the white-label ClientID/DeviceId/IMEI resolved,
//      strictly server-side, from FleetHive's own database — never from
//      anything the browser sent directly.
//
// This throws NotImplementedError today because steps 1–5 need FleetHive's
// customer/vehicle database, which doesn't exist in this codebase yet
// (that's the Customer Portal — Prompt 2). Wiring this up is then a matter
// of replacing the TODOs below with real lookups; every caller in this
// codebase already goes through this single function, so nothing else
// needs to change.
async function resolveOwnedDevice(authContext, vehicleId) {
  if (!authContext || !authContext.userId) {
    throw new OwnershipError('Authentication required.', 401);
  }
  if (!vehicleId) {
    throw new OwnershipError('A vehicle must be specified.', 400);
  }

  // TODO (Prompt 2): step 1 — look up the session/user record for
  //   authContext.userId; throw OwnershipError(401) if it doesn't resolve.
  // TODO (Prompt 2): step 2 — confirm the FleetHive account is active;
  //   throw OwnershipError(403) if suspended/cancelled.
  // TODO (Prompt 2): step 3 — confirm the user's role/permissions allow
  //   viewing vehicles at all; throw OwnershipError(403) otherwise.
  // TODO (Prompt 2): step 4 — look up `vehicleId` in FleetHive's own
  //   vehicles table scoped to authContext.userId's account; throw
  //   OwnershipError(404) if it doesn't belong to them. This is the actual
  //   IDOR check — vehicleId must be resolved against the account, never
  //   trusted as already-verified because the browser sent it.
  // TODO (Prompt 2): step 5 — read that vehicle's stored white-label
  //   ClientID / DeviceId / IMEI (set when the vehicle was linked to a
  //   device — see AssignAsset in _whiteLabelClient.js) and return them:
  //   return { clientId, deviceId, imeiNumber };

  throw new NotImplementedError(
    'Vehicle ownership resolution requires the FleetHive customer/vehicle database, which is part of the Customer Portal (Prompt 2).'
  );
}

// Same shape of gate for the admin-only device-management operations in
// Prompt 1B §13/§14 (AssignAsset/UnAssignAsset/AssignSimCard/
// UnAssignSimcard). Throws until FleetHive has real admin authentication;
// every admin-facing function in this codebase must call this first.
function requireAdmin(authContext) {
  if (!authContext || !authContext.userId) {
    throw new OwnershipError('Authentication required.', 401);
  }
  // TODO (Prompt 2): replace with a real role/permission check against
  //   FleetHive's user records, e.g.:
  //   if (!authContext.roles || !authContext.roles.includes('admin')) {
  //     throw new OwnershipError('Administrator access required.', 403);
  //   }
  throw new NotImplementedError(
    'Admin authorization requires FleetHive\'s user/role system, which is part of the Customer Portal (Prompt 2).'
  );
}

module.exports = {
  UNAVAILABLE,
  normalizeDeviceStatus,
  normalizeLockStatus,
  normalizeDeviceRecord,
  getFriendlyErrorMessage,
  OwnershipError,
  NotImplementedError,
  resolveOwnedDevice,
  requireAdmin,
};
