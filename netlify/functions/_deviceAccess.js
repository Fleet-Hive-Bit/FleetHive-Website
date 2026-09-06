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
// Prompt 1B left `resolveOwnedDevice()`/`requireAdmin()` throwing
// NotImplementedError because FleetHive had no customer/vehicle database
// or login system yet. Prompt 2A.1 adds exactly that (_auth.js + _db.js —
// FleetHive's own session system and a Blobs-backed customer/vehicle
// store), so both functions below are now wired to real lookups instead
// of TODOs. Every one of the 5 checks in Prompt 1B §9 is still
// represented, in order, and every caller in this codebase already goes
// through this single function, so nothing else had to change.
//
// Update — Prompt 2B.2: the admin linking tool referenced below now
// exists (admin-devices.js / admin-vehicles.js / admin-device-assign.js /
// admin-device-unassign.js, gated by requireAdminSession() at the bottom
// of this file). `resolveOwnedDevice()` itself is unchanged — it already
// correctly finds a vehicle once one is linked; Prompt 2B.2 is what
// actually creates that link. A customer with no admin-assigned device
// yet still legitimately sees an empty vehicle list / "not yet linked"
// state, which is the honest state, not a bug.

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
  // Step 1 — the session/user must be valid. authContext is expected to
  // come from _auth.js's requireSession(), never from browser-supplied
  // fields, so authContext.userId here is already server-verified.
  if (!authContext || !authContext.userId) {
    throw new OwnershipError('Authentication required.', 401);
  }
  if (!vehicleId) {
    throw new OwnershipError('A vehicle must be specified.', 400);
  }

  // Step 2 — the account must be active. FleetHive doesn't yet have a
  // suspend/cancel flag on the customer record (no admin tool creates one
  // yet), so every account with a valid session is currently treated as
  // active. Adding that flag later is a one-line check here.

  // Step 3 — permission to view vehicles at all. Every authenticated
  // FleetHive customer may view their own vehicles; there is no separate
  // role system yet (see requireAdmin() below for the admin-only gate).

  // Step 4 — the actual IDOR check. _db.js's key layout
  // (veh:<customerId>:<vehicleId>) means this lookup is scoped to
  // authContext.userId's own records by construction — it is not
  // possible for this call to return a vehicle belonging to a different
  // customer, no matter what vehicleId the browser sent.
  const db = require('./_db');
  const vehicle = await db.getVehicleForCustomer(authContext.userId, vehicleId);
  if (!vehicle) {
    throw new OwnershipError('That vehicle could not be found on your account.', 404);
  }

  // Step 5 — only now resolve the white-label identifiers, strictly from
  // the record just retrieved (never from the browser).
  if (!vehicle.whiteLabelClientId || !vehicle.whiteLabelDeviceId) {
    throw new NotImplementedError(
      'This vehicle has not yet been linked to a tracking device. Linking vehicles to devices is an admin-only capability not yet built (Prompt 2A.2).'
    );
  }
  return {
    clientId: vehicle.whiteLabelClientId,
    deviceId: vehicle.whiteLabelDeviceId,
    imeiNumber: vehicle.imei,
  };
}

// Same shape of gate for the admin-only device-management operations in
// Prompt 1B §13/§14 (AssignAsset/UnAssignAsset/AssignSimCard/
// UnAssignSimcard). FleetHive customer accounts created in Prompt 2A.1
// have no role field and no admin dashboard exists to grant one, so this
// still correctly refuses everyone — that's the honest state until an
// admin tool exists (out of scope for 2A.1), not a leftover TODO.
function requireAdmin(authContext) {
  if (!authContext || !authContext.userId) {
    throw new OwnershipError('Authentication required.', 401);
  }
  if (!authContext.roles || !authContext.roles.includes('admin')) {
    throw new OwnershipError('Administrator access required.', 403);
  }
}

// Prompt 2B.2: the one place every admin-* endpoint resolves "who is
// asking, and are they an admin" — combining _auth.js's real session
// lookup (never anything from the request itself) with the ADMIN_EMAILS
// check, then the same requireAdmin() gate every other admin-only code
// path already used. Throws OwnershipError (401 if signed out at all, 403
// if signed in but not an admin) so callers can just try/catch once.
async function requireAdminSession(event) {
  const { requireSession, authContextFromSession } = require('./_auth');
  const session = await requireSession(event);
  if (!session) {
    throw new OwnershipError('Authentication required.', 401);
  }
  const authContext = authContextFromSession(session);
  requireAdmin(authContext);
  return { session, authContext };
}

// ------------------- Customer-friendly status translation ------------------
// Prompt 2A.2 §7: translate the documented provider fields into
// FleetHive's customer-facing language (Moving/Parked, Ignition On/Off,
// Online/Offline). This never infers a state from a field that isn't the
// documented source for it — e.g. §7 explicitly forbids assuming a
// vehicle is moving just because lat/lon are present, so motion always
// comes from MotionState, never from the coordinates. Any provider value
// this doesn't recognize is shown as-is rather than guessed at.

// How long since the provider's own utc_date before FleetHive labels a
// vehicle "Offline" instead of "Online" (§8: don't show fake "Live" data
// for a device that hasn't recently reported). This is a display
// threshold applied to the real timestamp the provider returned — it
// never substitutes a fabricated timestamp or reading.
const STALE_AFTER_MS = 20 * 60 * 1000;

function parseProviderDate(value) {
  if (!value || value === UNAVAILABLE) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function deriveOnlineState(utcDate) {
  const parsed = parseProviderDate(utcDate);
  if (!parsed) return { state: 'unknown', label: 'Unavailable' };
  const ageMs = Date.now() - parsed.getTime();
  if (ageMs <= STALE_AFTER_MS) return { state: 'online', label: 'Online' };
  return { state: 'offline', label: 'Offline' };
}

function deriveMotionLabel(motionState) {
  if (motionState === UNAVAILABLE || motionState === null || motionState === undefined || motionState === '') {
    return { state: 'unknown', label: 'Unavailable' };
  }
  const raw = String(motionState).trim().toLowerCase();
  if (['1', 'true', 'moving', 'motion', 'driving', 'running'].includes(raw)) {
    return { state: 'moving', label: 'Moving' };
  }
  if (['0', 'false', 'idle', 'parked', 'stopped', 'stationary'].includes(raw)) {
    return { state: 'parked', label: 'Parked' };
  }
  // A documented value this mapping doesn't recognize yet — show the
  // provider's own text rather than silently guessing Moving/Parked.
  return { state: 'unknown', label: String(motionState) };
}

function deriveIgnitionLabel(ignitionState) {
  if (ignitionState === UNAVAILABLE || ignitionState === null || ignitionState === undefined || ignitionState === '') {
    return { state: 'unknown', label: 'Unavailable' };
  }
  const raw = String(ignitionState).trim().toLowerCase();
  if (['1', 'true', 'on', 'ignition on'].includes(raw)) return { state: 'on', label: 'Ignition On' };
  if (['0', 'false', 'off', 'ignition off'].includes(raw)) return { state: 'off', label: 'Ignition Off' };
  return { state: 'unknown', label: String(ignitionState) };
}

function hasCoordinates(normalizedStatus) {
  return (
    normalizedStatus &&
    normalizedStatus.lat !== UNAVAILABLE &&
    normalizedStatus.lon !== UNAVAILABLE &&
    !Number.isNaN(Number(normalizedStatus.lat)) &&
    !Number.isNaN(Number(normalizedStatus.lon))
  );
}

// Combines the pieces above into the one object the frontend renders from.
function deriveFriendlyStatus(normalizedStatus) {
  const online = deriveOnlineState(normalizedStatus.utcDate);
  const motion = deriveMotionLabel(normalizedStatus.motionState);
  const ignition = deriveIgnitionLabel(normalizedStatus.ignitionState);
  return {
    online,
    motion,
    ignition,
    isStale: online.state === 'offline',
    hasCoordinates: hasCoordinates(normalizedStatus),
  };
}

module.exports = {
  UNAVAILABLE,
  normalizeDeviceStatus,
  normalizeLockStatus,
  normalizeDeviceRecord,
  getFriendlyErrorMessage,
  deriveFriendlyStatus,
  OwnershipError,
  NotImplementedError,
  resolveOwnedDevice,
  requireAdmin,
  requireAdminSession,
};
