// netlify/functions/_auth.js
//
// FleetHive's own customer authentication — Prompt 2A.1.
//
// This is the ONE customer login for FleetHive (see the prompt's §2/§3):
// the white-label provider never sees the customer, never issues them a
// session, and never appears in the browser. Provider credentials
// (_whiteLabelClient.js) remain a completely separate, backend-only
// concern from the session system in this file.
//
// Password hashing uses Node's built-in crypto.scrypt (no new
// dependency — consistent with the "no unnecessary dependencies"
// principle already followed by _store.js). Sessions are an opaque
// random token stored server-side in Blobs (_db.js) with an expiry;
// nothing about the client can forge or extend one.

const crypto = require('crypto');
const db = require('./_db');

const SESSION_COOKIE = 'fh_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------- Passwords ------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || stored.indexOf(':') === -1) return false;
  const [salt, hash] = stored.split(':');
  try {
    const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// ---------------------------- Cookies ---------------------------------------

function parseCookies(event) {
  const header = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function serializeSessionCookie(token, maxAgeMs) {
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ---------------------------- Session lifecycle -----------------------------

async function startSession(customerId) {
  const { token, expiresAt } = await db.createSession(customerId, SESSION_TTL_MS);
  return { cookie: serializeSessionCookie(token, SESSION_TTL_MS), token, expiresAt };
}

async function endSession(event) {
  const cookies = parseCookies(event);
  const token = cookies[SESSION_COOKIE];
  if (token) await db.destroySession(token);
  return clearSessionCookie();
}

// The single place every protected endpoint calls to find out who's
// asking. Resolves the customer strictly from the signed, server-stored
// session behind the cookie — never from any customerId/userId the
// request body or query string might contain. Returns null if there is
// no valid session; callers should respond 401 in that case.
async function requireSession(event) {
  const cookies = parseCookies(event);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await db.getSession(token);
  if (!session || !session.customerId) return null;
  const customer = await db.getCustomerById(session.customerId);
  if (!customer) return null;
  return { customer, token };
}

function sanitizeCustomer(customer) {
  if (!customer) return null;
  const { id, email, name, customerType, createdAt } = customer;
  return { id, email, name, customerType, createdAt };
}

// ---------------------------- Admin identity --------------------------------
//
// Prompt 2B.2: FleetHive still has exactly ONE login (§25 — "no second
// white-label login exists"). Admin is not a second account system; it's a
// server-side-only flag on top of an ordinary FleetHive account, resolved
// from the ADMIN_EMAILS environment variable (comma-separated, case
// insensitive) — never from anything the browser sends, never from a
// client-editable field, and never storable by a customer registering
// themselves (auth-register.js has no such field to set).
//
// This mirrors the ADMIN_API_TOKEN stopgap already used by
// whitelabel-connection-test.js, but ties admin actions to a real,
// individually-identifiable FleetHive account (needed so audit log entries
// can record which admin did what — a shared bearer token can't do that).
function isAdminEmail(email) {
  const configured = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!configured.length || !email) return false;
  return configured.includes(String(email).trim().toLowerCase());
}

// Builds the authContext shape _deviceAccess.js's requireAdmin()/
// resolveOwnedDevice() expect, from a real requireSession() result. The
// roles array is computed fresh on every request from the current
// ADMIN_EMAILS value — revoking admin access is just editing that env var,
// no data migration, no stale "isAdmin" flag baked into a stored record.
function authContextFromSession(session) {
  if (!session || !session.customer) return null;
  return {
    userId: session.customer.id,
    email: session.customer.email,
    roles: isAdminEmail(session.customer.email) ? ['admin'] : [],
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  parseCookies,
  serializeSessionCookie,
  clearSessionCookie,
  startSession,
  endSession,
  requireSession,
  sanitizeCustomer,
  isAdminEmail,
  authContextFromSession,
  SESSION_COOKIE,
};
