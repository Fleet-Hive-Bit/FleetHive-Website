// netlify/functions/_whiteLabelClient.js
//
// Server-side client for FleetHive's white-label vehicle-tracking provider
// (RESTful API V3.0, base URL https://api.gpsiot.net — see
// "API Documentation V3.0.pdf" for the full spec). This file is the ONLY
// place in the codebase that is allowed to know the provider's base URL,
// credentials, and endpoint shapes.
//
// Nothing in here is reachable directly from the browser. It exists to be
// required by other Netlify Functions (server-side only). Do not import
// this file from anything that runs client-side.
//
// -----------------------------------------------------------------------
// Required Netlify environment variables (server-side only — see SETUP.md):
//   WHITE_LABEL_API_KEY      — the "Web Api Key" issued by the provider
//   WHITE_LABEL_API_SECRET   — the "Web Secret Key" issued by the provider
// Optional:
//   WHITE_LABEL_API_BASE_URL — defaults to https://api.gpsiot.net
//
// These are never sent to the browser, never hardcoded, and never logged —
// see safeLog() below, which redacts anything that looks like a credential
// before it reaches console output.
// -----------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.gpsiot.net';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2; // total attempts = 1 + MAX_RETRIES
const RETRY_BASE_DELAY_MS = 400;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000; // refresh 60s before actual expiry

function baseUrl() {
  return (process.env.WHITE_LABEL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

// Thrown for any failure talking to the provider. Callers (individual
// Netlify Functions) are responsible for translating this into a safe,
// customer-facing message — see getFriendlyErrorMessage() in
// _deviceAccess.js. The raw `detail` is for server-side logs only and is
// never sent to the browser.
class WhiteLabelApiError extends Error {
  constructor(message, { status, detail, code } = {}) {
    super(message);
    this.name = 'WhiteLabelApiError';
    this.status = status || 502;
    this.detail = detail;
    this.code = code || 'PROVIDER_ERROR';
  }
}

// Redacts anything that could be a credential/token before it's ever
// passed to console.log/console.error. Used for every log line in this
// file so a future edit can't accidentally leak a secret into Netlify's
// function logs.
function safeLog(label, extra) {
  const safeExtra = extra && typeof extra === 'object' ? { ...extra } : extra;
  if (safeExtra && typeof safeExtra === 'object') {
    for (const key of Object.keys(safeExtra)) {
      if (/token|key|secret|password|authorization/i.test(key)) {
        delete safeExtra[key];
      }
    }
  }
  console.error(`[whiteLabelClient] ${label}`, safeExtra !== undefined ? safeExtra : '');
}

// ----------------------------- Token cache ------------------------------
// A single warm Netlify Function container can serve many invocations
// before it's recycled, so caching the token in module scope avoids
// re-authenticating on every request within that window. This is
// best-effort: a cold start (or a different concurrent container) simply
// fetches a fresh token, which is always safe.
let tokenCache = { accessToken: null, expiresAt: 0 };
let pendingTokenRequest = null; // de-dupes concurrent refreshes in-flight

async function fetchNewToken() {
  const apiKey = process.env.WHITE_LABEL_API_KEY;
  const apiSecret = process.env.WHITE_LABEL_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new WhiteLabelApiError(
      'White-label tracking is not configured on the server.',
      { status: 500, code: 'NOT_CONFIGURED', detail: 'WHITE_LABEL_API_KEY / WHITE_LABEL_API_SECRET missing' }
    );
  }

  const body = new URLSearchParams({
    username: apiKey,
    password: apiSecret,
    grant_type: 'password',
  });

  let res;
  try {
    res = await fetchWithTimeout(`${baseUrl()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    safeLog('token request threw', { message: err.message });
    throw new WhiteLabelApiError('Unable to reach the tracking provider.', { status: 502, code: 'NETWORK_ERROR' });
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // fall through with data = null; handled by the !res.ok / missing-token checks below
  }

  if (!res.ok || !data || !data.access_token) {
    safeLog('token request failed', { status: res.status, error: data && data.error });
    throw new WhiteLabelApiError('Tracking provider authentication failed.', {
      status: res.status === 400 ? 502 : res.status,
      code: 'AUTH_FAILED',
      detail: data && (data.error_description || data.error),
    });
  }

  const expiresInMs = (Number(data.expires_in) || 7200) * 1000;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };
  return tokenCache.accessToken;
}

async function getAccessToken() {
  const isValid = tokenCache.accessToken && Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS;
  if (isValid) return tokenCache.accessToken;

  // If a refresh is already in flight (e.g. two parallel requests both hit
  // an expired token at once), share the same promise instead of firing
  // two separate /token requests.
  if (!pendingTokenRequest) {
    pendingTokenRequest = fetchNewToken().finally(() => {
      pendingTokenRequest = null;
    });
  }
  return pendingTokenRequest;
}

// ----------------------------- HTTP helpers ------------------------------

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generic authenticated request against the documented API. Handles:
//  - attaching the Bearer token (and a one-time retry if the token turns
//    out to have been rejected as expired/invalid, i.e. a 401)
//  - timeouts (AbortController)
//  - safe retries with backoff on 429 (rate limit, honoring Retry-After
//    when present) and on 5xx/network errors
//  - never throwing/logging the raw credential
//
// `method` and `path` must match the documented endpoint exactly — see the
// wrapper functions below, which are the only sanctioned way to call this.
async function request(method, path, { body, query, allowRetryOn401 = true } = {}) {
  let url = `${baseUrl()}${path}`;
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null)
    ).toString();
    if (qs) url += `?${qs}`;
  }

  let attempt = 0;
  let lastError;

  while (attempt <= MAX_RETRIES) {
    attempt += 1;
    const token = await getAccessToken();

    let res;
    try {
      res = await fetchWithTimeout(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      lastError = new WhiteLabelApiError('Unable to reach the tracking provider.', {
        status: 504,
        code: err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      });
      safeLog('request network error', { path, attempt, message: err.message });
      await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    // Expired/invalid token — refresh once and retry immediately, without
    // burning a full retry/backoff cycle on it.
    if (res.status === 401 && allowRetryOn401) {
      tokenCache = { accessToken: null, expiresAt: 0 };
      allowRetryOn401 = false; // only once
      continue;
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : RETRY_BASE_DELAY_MS * attempt * 2;
      lastError = new WhiteLabelApiError('Tracking provider rate limit reached.', { status: 429, code: 'RATE_LIMITED' });
      if (attempt <= MAX_RETRIES) {
        safeLog('rate limited, backing off', { path, attempt, retryAfterMs });
        await sleep(retryAfterMs);
        continue;
      }
      break;
    }

    if (res.status >= 500) {
      lastError = new WhiteLabelApiError('Tracking provider is temporarily unavailable.', {
        status: 502,
        code: 'PROVIDER_5XX',
      });
      if (attempt <= MAX_RETRIES) {
        safeLog('provider 5xx, retrying', { path, attempt, status: res.status });
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      break;
    }

    let data = null;
    const raw = await res.text();
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = raw; // some documented endpoints respond with a bare string message
      }
    }

    if (!res.ok) {
      const message = (data && (data.Message || data.message)) || 'Request to the tracking provider failed.';
      throw new WhiteLabelApiError(message, { status: res.status, code: 'PROVIDER_REJECTED', detail: data });
    }

    return { status: res.status, data };
  }

  throw lastError || new WhiteLabelApiError('Request to the tracking provider failed.', { status: 502 });
}

// --------------------- Documented endpoint wrappers ----------------------
// Each function maps 1:1 to a section of API Documentation V3.0.pdf. Field
// names and casing match the documentation exactly — do not "clean up" or
// rename them here; normalize on the way OUT (see _deviceAccess.js) so the
// raw provider contract stays traceable to the doc.

// POST /api/Asset/CurrentDeviceStatusByImei
async function getCurrentDeviceStatusByImei({ imeiNumber }) {
  if (!imeiNumber) throw new WhiteLabelApiError('imeiNumber is required.', { status: 400, code: 'BAD_REQUEST' });
  return request('POST', '/api/Asset/CurrentDeviceStatusByImei', { body: { ImeiNumber: imeiNumber } });
}

// POST /api/Asset/CurrentDeviceLockStatusByImei
async function getCurrentDeviceLockStatusByImei({ imeiNumber }) {
  if (!imeiNumber) throw new WhiteLabelApiError('imeiNumber is required.', { status: 400, code: 'BAD_REQUEST' });
  return request('POST', '/api/Asset/CurrentDeviceLockStatusByImei', { body: { ImeiNumber: imeiNumber } });
}

// POST /api/Asset/GetAllDevice
async function getAllDevices({ clientId }) {
  if (!clientId) throw new WhiteLabelApiError('clientId is required.', { status: 400, code: 'BAD_REQUEST' });
  return request('POST', '/api/Asset/GetAllDevice', { body: { ClientID: clientId } });
}

// POST /api/Asset/GetOneDevice
async function getOneDevice({ clientId, deviceId }) {
  if (!clientId || !deviceId) {
    throw new WhiteLabelApiError('clientId and deviceId are required.', { status: 400, code: 'BAD_REQUEST' });
  }
  return request('POST', '/api/Asset/GetOneDevice', { body: { ClientID: clientId, DeviceId: deviceId } });
}

// GET /api/Asset/GetResellerDevices — reseller-level, no body per the docs.
// This returns every device across every client under FleetHive's
// reseller account, so it must only ever be called from admin-gated,
// server-side code — never scoped to (or trusted as) a single customer.
async function getResellerDevices() {
  return request('GET', '/api/Asset/GetResellerDevices');
}

// GET /api/InputStatus/GetClientDeviceStatusByDateRange
//
// NB: the documentation specifies method GET with a JSON request body,
// which is how the provider actually implemented it — kept exactly as
// documented rather than "corrected" to POST, since guessing here would
// violate the "use exact documented structures" rule.
//
// The documentation caps the allowed (end_date - start_date) window at
// two minutes. This wrapper enforces that cap itself (see
// assertWithinTwoMinutes) rather than trusting callers, and
// getClientDeviceStatusByDateRangeBatched() below is the safe way to pull
// a longer range — it walks it as a sequence of server-side 2-minute
// requests instead of ever letting the browser fan out hundreds of calls.
function assertWithinTwoMinutes(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new WhiteLabelApiError('startDate/endDate must be valid dates.', { status: 400, code: 'BAD_REQUEST' });
  }
  if (end < start) {
    throw new WhiteLabelApiError('endDate must not be before startDate.', { status: 400, code: 'BAD_REQUEST' });
  }
  if (end - start > 2 * 60 * 1000) {
    throw new WhiteLabelApiError(
      'The tracking provider only allows a 2-minute range per request.',
      { status: 400, code: 'RANGE_TOO_LARGE' }
    );
  }
}

async function getClientDeviceStatusByDateRange({ startDate, endDate, imeiList = [], eventIdList = [] }) {
  assertWithinTwoMinutes(startDate, endDate);
  return request('GET', '/api/InputStatus/GetClientDeviceStatusByDateRange', {
    body: {
      start_date: startDate,
      end_date: endDate,
      imei_list: imeiList,
      eventid_list: eventIdList,
    },
  });
}

// Server-side batching helper for a range longer than 2 minutes: splits it
// into sequential ≤2-minute windows and calls the provider once per
// window, entirely on the server. This is the "server-side
// batching/aggregation strategy" required by Prompt 1B §10/§11 — nothing
// about it is driven by the frontend, and callers should still keep the
// requested range reasonable (this will make one provider request per 2
// minutes of range, sequentially, to stay inside the provider's own
// rate limits).
async function getClientDeviceStatusByDateRangeBatched({ startDate, endDate, imeiList = [], eventIdList = [] }) {
  const WINDOW_MS = 2 * 60 * 1000;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    throw new WhiteLabelApiError('startDate/endDate must be valid, with endDate after startDate.', {
      status: 400,
      code: 'BAD_REQUEST',
    });
  }

  const windows = [];
  for (let windowStart = start; windowStart < end; windowStart += WINDOW_MS) {
    const windowEnd = Math.min(windowStart + WINDOW_MS, end);
    windows.push([new Date(windowStart).toISOString(), new Date(windowEnd).toISOString()]);
  }

  const results = [];
  for (const [windowStartIso, windowEndIso] of windows) {
    // Sequential, not Promise.all — deliberately avoids hammering the
    // provider with a burst of parallel requests for a long range.
    // eslint-disable-next-line no-await-in-loop
    const { data } = await getClientDeviceStatusByDateRange({
      startDate: windowStartIso,
      endDate: windowEndIso,
      imeiList,
      eventIdList,
    });
    results.push(data);
  }
  return results;
}

// POST /api/Asset/AssignAsset
async function assignAsset({ clientId, deviceId, assetId }) {
  if (!clientId || !deviceId || !assetId) {
    throw new WhiteLabelApiError('clientId, deviceId and assetId are required.', { status: 400, code: 'BAD_REQUEST' });
  }
  return request('POST', '/api/Asset/AssignAsset', { body: { ClientID: clientId, DeviceId: deviceId, AssetId: assetId } });
}

// POST /api/Asset/UnAssignAsset
async function unassignAsset({ clientId, deviceId }) {
  if (!clientId || !deviceId) {
    throw new WhiteLabelApiError('clientId and deviceId are required.', { status: 400, code: 'BAD_REQUEST' });
  }
  return request('POST', '/api/Asset/UnAssignAsset', { body: { ClientID: clientId, DeviceId: deviceId } });
}

// POST /api/Asset/AssignSimCard
async function assignSimCard({ clientId, deviceId, simCardId }) {
  if (!clientId || !deviceId || !simCardId) {
    throw new WhiteLabelApiError('clientId, deviceId and simCardId are required.', { status: 400, code: 'BAD_REQUEST' });
  }
  return request('POST', '/api/Asset/AssignSimCard', { body: { ClientID: clientId, DeviceId: deviceId, SimCardId: simCardId } });
}

// POST /api/Asset/UnAssignSimcard
async function unassignSimCard({ clientId, deviceId }) {
  if (!clientId || !deviceId) {
    throw new WhiteLabelApiError('clientId and deviceId are required.', { status: 400, code: 'BAD_REQUEST' });
  }
  return request('POST', '/api/Asset/UnAssignSimcard', { body: { ClientID: clientId, DeviceId: deviceId } });
}

module.exports = {
  WhiteLabelApiError,
  // low-level (exported mainly for tests / future documented endpoints)
  request,
  getAccessToken,
  // documented endpoint wrappers
  getCurrentDeviceStatusByImei,
  getCurrentDeviceLockStatusByImei,
  getAllDevices,
  getOneDevice,
  getResellerDevices,
  getClientDeviceStatusByDateRange,
  getClientDeviceStatusByDateRangeBatched,
  assignAsset,
  unassignAsset,
  assignSimCard,
  unassignSimCard,
};
