// netlify/functions/vehicle-trip-history.js
//
// Fleet Intelligence — Prompt 2A.2 §10.
//
// The documented endpoint (GetClientDeviceStatusByDateRange) caps a single
// request's window at 2 minutes. This function never sends the browser's
// requested range straight through — it re-validates it server-side and
// calls _whiteLabelClient's getClientDeviceStatusByDateRangeBatched(),
// which walks the range as a sequence of server-side ≤2-minute requests
// (§10: "handle batching server-side... avoid hundreds/thousands of
// browser requests").
//
// MAX_RANGE_MS caps how large a range this endpoint accepts per call —
// independent of (and tighter than) the provider's own 2-minute-per-call
// limit — so one browser request can't turn into an unbounded chain of
// sequential provider calls inside a single function invocation.

const { requireSession } = require('./_auth');
const {
  resolveOwnedDevice,
  normalizeDeviceStatus,
  getFriendlyErrorMessage,
  OwnershipError,
  NotImplementedError,
} = require('./_deviceAccess');
const whiteLabel = require('./_whiteLabelClient');

const MAX_RANGE_MS = 20 * 60 * 1000; // 20 minutes = at most 10 sequential provider requests per lookup

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const params = event.queryStringParameters || {};
  const { vehicleId, startDate, endDate } = params;
  if (!vehicleId || !startDate || !endDate) {
    return { statusCode: 400, body: JSON.stringify({ error: 'vehicleId, startDate and endDate are required.' }) };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { statusCode: 400, body: JSON.stringify({ error: 'startDate/endDate must be valid dates.' }) };
  }
  if (end <= start) {
    return { statusCode: 400, body: JSON.stringify({ error: 'endDate must be after startDate.' }) };
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Please choose a range of ${MAX_RANGE_MS / 60000} minutes or less.` }),
    };
  }

  try {
    const session = await requireSession(event);
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };
    }

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

    let windows;
    try {
      windows = await whiteLabel.getClientDeviceStatusByDateRangeBatched({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        imeiList: [device.imeiNumber],
      });
    } catch (err) {
      console.error('vehicle-trip-history: provider call failed:', vehicleId, err.message);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId, linked: true, error: getFriendlyErrorMessage(err) }),
      };
    }

    // Each window's `data` is passed straight through the same normalizer
    // used for current status, so a point missing a field shows "Data
    // unavailable" rather than a fabricated value — never invented here.
    const points = [];
    (windows || []).forEach((windowData) => {
      const records = Array.isArray(windowData) ? windowData : windowData ? [windowData] : [];
      records.forEach((record) => points.push(normalizeDeviceStatus(record)));
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleId, linked: true, points }),
    };
  } catch (e) {
    console.error('vehicle-trip-history failed:', vehicleId, e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Vehicle data is temporarily unavailable. Please try again shortly.' }),
    };
  }
};
