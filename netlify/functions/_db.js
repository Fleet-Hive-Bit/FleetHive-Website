// netlify/functions/_db.js
//
// FleetHive's customer/account/vehicle/session data layer — Prompt 2A.1.
//
// Uses Netlify Blobs (already a dependency — see _store.js, which uses the
// same pattern for Paystack orders), so this needs no new database service
// or extra credentials to configure. Three logical stores:
//
//   fleethive-customers  cust:<id>            -> customer record
//                         email:<normalized>   -> { id }  (login lookup index)
//   fleethive-vehicles    veh:<custId>:<vehId> -> vehicle record
//                         (keys are always prefixed with the owning
//                         customer's id, so listing a customer's vehicles
//                         with store.list({prefix:'veh:<custId>:'}) can
//                         never surface another customer's records — the
//                         tenant boundary is baked into the key itself,
//                         not enforced by filtering after the fact)
//   fleethive-sessions    sess:<token>         -> { customerId, expiresAt }
//
// Every lookup here is by a value the *server* derives (the session
// cookie, the authenticated customer id) — never by an id the browser
// hands us directly. That's what the ownership checks in
// _deviceAccess.js / customer-vehicles.js rely on.

let getStore;
try {
  ({ getStore } = require('@netlify/blobs'));
} catch (e) {
  getStore = null;
}

function customersStore() {
  if (!getStore) return null;
  try { return getStore('fleethive-customers'); }
  catch (e) { console.error('Blobs (customers) unavailable:', e.message); return null; }
}
function vehiclesStore() {
  if (!getStore) return null;
  try { return getStore('fleethive-vehicles'); }
  catch (e) { console.error('Blobs (vehicles) unavailable:', e.message); return null; }
}
function sessionsStore() {
  if (!getStore) return null;
  try { return getStore('fleethive-sessions'); }
  catch (e) { console.error('Blobs (sessions) unavailable:', e.message); return null; }
}
// Prompt 2B.2 — admin device-mapping audit trail. Kept as its own Blobs
// store (fleethive-auditlog) rather than mixed into any customer/vehicle
// data, so it can never be returned by a customer-facing lookup.
function auditStore() {
  if (!getStore) return null;
  try { return getStore('fleethive-auditlog'); }
  catch (e) { console.error('Blobs (auditlog) unavailable:', e.message); return null; }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// ---------------------------- Customers -----------------------------------

async function getCustomerByEmail(email) {
  const s = customersStore();
  if (!s) return null;
  const norm = normalizeEmail(email);
  if (!norm) return null;
  try {
    const idx = await s.get(`email:${norm}`, { type: 'json' });
    if (!idx || !idx.id) return null;
    return await s.get(`cust:${idx.id}`, { type: 'json' });
  } catch (e) {
    console.error('_db.getCustomerByEmail failed:', e.message);
    return null;
  }
}

async function getCustomerById(id) {
  const s = customersStore();
  if (!s || !id) return null;
  try {
    return await s.get(`cust:${id}`, { type: 'json' });
  } catch (e) {
    console.error('_db.getCustomerById failed:', e.message);
    return null;
  }
}

// Throws if the email is already registered — caller decides how to
// surface that (kept generic so auth-register.js can give a safe message).
async function createCustomer(record) {
  const s = customersStore();
  if (!s) throw new Error('STORE_UNAVAILABLE');
  const norm = normalizeEmail(record.email);
  if (!norm) throw new Error('EMAIL_REQUIRED');

  const existing = await s.get(`email:${norm}`, { type: 'json' });
  if (existing && existing.id) throw new Error('EMAIL_TAKEN');

  const id = record.id;
  const full = {
    id,
    email: norm,
    name: record.name,
    passwordHash: record.passwordHash,
    customerType: record.customerType === 'business' ? 'business' : 'private',
    createdAt: new Date().toISOString(),
  };
  await s.setJSON(`cust:${id}`, full);
  // Set the email index last-ish, but only after the record exists so a
  // lookup can never resolve to a half-written customer.
  await s.setJSON(`email:${norm}`, { id });
  return full;
}

// Admin-only (Prompt 2B.2 §2/§10): lists every registered customer so an
// admin can pick which account a vehicle/device belongs to. This is
// deliberately never used by any customer-facing endpoint — only
// admin-customers.js calls it, and that endpoint is admin-gated. Netlify
// Blobs has no server-side full-text search, so filtering by the optional
// `query` (email or name substring) happens after listing; fine at
// FleetHive's current scale, same pragmatic approach _store.js already
// takes for its own listings.
async function listAllCustomers(query) {
  const s = customersStore();
  if (!s) return [];
  try {
    const { blobs } = await s.list({ prefix: 'cust:' });
    if (!blobs || !blobs.length) return [];
    const records = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })));
    let customers = records.filter(Boolean);
    if (query) {
      const needle = String(query).trim().toLowerCase();
      customers = customers.filter(
        (c) => (c.email || '').toLowerCase().includes(needle) || (c.name || '').toLowerCase().includes(needle)
      );
    }
    return customers.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } catch (e) {
    console.error('_db.listAllCustomers failed:', e.message);
    return [];
  }
}

// ---------------------------- Vehicles --------------------------------------

// Lists ONLY the vehicles stored under this customer's own key prefix.
// There is no code path here that accepts an arbitrary customerId from the
// browser — callers must pass the id resolved from the authenticated
// session (see _auth.js requireSession()).
async function listVehiclesForCustomer(customerId) {
  const s = vehiclesStore();
  if (!s || !customerId) return [];
  try {
    const { blobs } = await s.list({ prefix: `veh:${customerId}:` });
    if (!blobs || !blobs.length) return [];
    const records = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })));
    return records.filter(Boolean);
  } catch (e) {
    console.error('_db.listVehiclesForCustomer failed:', e.message);
    return [];
  }
}

// Fetches one vehicle, scoped to the given customerId — because the key
// itself is prefixed with customerId, a vehicle belonging to a different
// customer simply cannot be found this way, no matter what vehicleId the
// browser supplies.
async function getVehicleForCustomer(customerId, vehicleId) {
  const s = vehiclesStore();
  if (!s || !customerId || !vehicleId) return null;
  try {
    return await s.get(`veh:${customerId}:${vehicleId}`, { type: 'json' });
  } catch (e) {
    console.error('_db.getVehicleForCustomer failed:', e.message);
    return null;
  }
}

// Admin-only (Prompt 2B.2 §2): creates a FleetHive vehicle record owned by
// the given customer. This is the one place a veh:<customerId>:<vehicleId>
// key is first written — admin-vehicles.js is the only caller, and it is
// admin-gated. customerId always comes from an admin-chosen, server-
// verified customer record (admin-customers.js), never parsed out of
// free-form input.
async function createVehicle(customerId, fields) {
  const s = vehiclesStore();
  if (!s) throw new Error('STORE_UNAVAILABLE');
  if (!customerId) throw new Error('CUSTOMER_ID_REQUIRED');
  const crypto = require('crypto');
  const id = crypto.randomUUID();
  const record = {
    id,
    customerId,
    label: fields.label || '',
    make: fields.make || '',
    model: fields.model || '',
    plateNumber: fields.plateNumber || '',
    // Provider mapping fields — absent until an admin actually assigns a
    // device (admin-device-assign.js). Never set from this function
    // directly with browser-supplied values; see that endpoint.
    whiteLabelClientId: null,
    whiteLabelDeviceId: null,
    assetId: null,
    imei: null,
    createdAt: new Date().toISOString(),
  };
  await s.setJSON(`veh:${customerId}:${id}`, record);
  return record;
}

// Admin-only: merges `patch` into an existing vehicle record, scoped to
// (customerId, vehicleId) exactly like getVehicleForCustomer — a vehicle
// belonging to a different customer cannot be reached this way regardless
// of what vehicleId is supplied. Returns null if no such vehicle exists
// (caller should treat that as 404, not silently create one).
async function updateVehicle(customerId, vehicleId, patch) {
  const s = vehiclesStore();
  if (!s || !customerId || !vehicleId) return null;
  const key = `veh:${customerId}:${vehicleId}`;
  const existing = await s.get(key, { type: 'json' });
  if (!existing) return null;
  const merged = { ...existing, ...patch, id: existing.id, customerId: existing.customerId, updatedAt: new Date().toISOString() };
  await s.setJSON(key, merged);
  return merged;
}

// Admin-only (Prompt 2B.2 §2/§8): lists every vehicle across every
// customer, for the device-mapping review screen. The customer/vehicle
// key layout (veh:<custId>:<vehId>) already scopes normal customer
// lookups; this function is the deliberate, admin-gated exception that
// reads across that prefix. Only admin-vehicles.js calls it.
async function listAllVehicles() {
  const s = vehiclesStore();
  if (!s) return [];
  try {
    const { blobs } = await s.list({ prefix: 'veh:' });
    if (!blobs || !blobs.length) return [];
    const records = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })));
    return records.filter(Boolean).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } catch (e) {
    console.error('_db.listAllVehicles failed:', e.message);
    return [];
  }
}

// ---------------------------- Sessions --------------------------------------

async function createSession(customerId, ttlMs) {
  const s = sessionsStore();
  if (!s) throw new Error('STORE_UNAVAILABLE');
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + ttlMs;
  await s.setJSON(`sess:${token}`, { customerId, expiresAt });
  return { token, expiresAt };
}

async function getSession(token) {
  const s = sessionsStore();
  if (!s || !token) return null;
  try {
    const record = await s.get(`sess:${token}`, { type: 'json' });
    if (!record) return null;
    if (!record.expiresAt || record.expiresAt < Date.now()) {
      // Expired — best-effort cleanup, but never let a cleanup failure
      // block treating the session as invalid.
      s.delete(`sess:${token}`).catch(() => {});
      return null;
    }
    return record;
  } catch (e) {
    console.error('_db.getSession failed:', e.message);
    return null;
  }
}

async function destroySession(token) {
  const s = sessionsStore();
  if (!s || !token) return;
  try { await s.delete(`sess:${token}`); }
  catch (e) { console.error('_db.destroySession failed:', e.message); }
}

// ---------------------------- Audit log (Prompt 2B.2 §17) --------------------
//
// Records administrative device/mapping actions. Never accepts secrets —
// callers (admin-device-assign.js / admin-device-unassign.js) pass only
// action, the responsible admin's own identity (resolved server-side from
// their session, never from the request body), a timestamp, and
// non-secret record identifiers (vehicleId, deviceId, IMEI, etc). No
// provider token/API key/authorization header is ever passed in here, and
// this file does not accept arbitrary free-form fields that could later be
// used to smuggle one in — see the explicit allow-list below.
async function recordAuditLog(entry) {
  const s = auditStore();
  if (!s) return false;
  try {
    const crypto = require('crypto');
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const safeEntry = {
      id,
      timestamp: new Date().toISOString(),
      action: entry.action,
      adminId: entry.adminId,
      adminEmail: entry.adminEmail,
      customerId: entry.customerId,
      vehicleId: entry.vehicleId,
      deviceId: entry.deviceId,
      clientId: entry.clientId,
      detail: entry.detail,
    };
    await s.setJSON(`log:${id}`, safeEntry);
    return true;
  } catch (e) {
    console.error('_db.recordAuditLog failed:', e.message);
    return false;
  }
}

async function listRecentAuditLog(limit = 50) {
  const s = auditStore();
  if (!s) return [];
  try {
    const { blobs } = await s.list({ prefix: 'log:' });
    if (!blobs || !blobs.length) return [];
    const sorted = blobs.sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, limit);
    const records = await Promise.all(sorted.map((b) => s.get(b.key, { type: 'json' })));
    return records.filter(Boolean);
  } catch (e) {
    console.error('_db.listRecentAuditLog failed:', e.message);
    return [];
  }
}

module.exports = {
  getCustomerByEmail,
  getCustomerById,
  createCustomer,
  listAllCustomers,
  listVehiclesForCustomer,
  getVehicleForCustomer,
  createVehicle,
  updateVehicle,
  listAllVehicles,
  createSession,
  getSession,
  destroySession,
  recordAuditLog,
  listRecentAuditLog,
};
