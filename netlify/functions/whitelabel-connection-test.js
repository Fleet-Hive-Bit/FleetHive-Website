// netlify/functions/whitelabel-connection-test.js
//
// A deliberately narrow, admin-gated endpoint that proves out the
// authentication + request/retry/error-handling foundation built in
// _whiteLabelClient.js, without exposing any customer data or destructive
// operations.
//
// WHY THIS EXISTS INSTEAD OF A FULL SET OF DEVICE/ASSIGNMENT ENDPOINTS:
// Prompt 1B asks for a secure foundation, not the Customer Portal or Admin
// Dashboard (those are explicitly Prompt 2 — see the STOP CONDITION at the
// end of the prompt). Endpoints like device-status-by-vehicle or
// assign/unassign-device can only be made safe once they sit behind real
// FleetHive authentication that can prove account ownership and admin
// role — see the TODOs in _deviceAccess.js. Shipping those routes now,
// before that authentication exists, would mean either leaving them
// completely open (an IDOR / destructive-action hole — the exact thing
// Prompt 1B §9/§13 says to prevent) or faking an auth check that isn't
// real. Neither is acceptable, so this phase stops at the client +
// ownership-contract layer and this one connectivity check.
//
// This route calls GET /api/Asset/GetResellerDevices, which per the
// documentation is reseller-scoped (not customer-scoped), so there is no
// per-customer ownership question for it — it's the same data an admin
// would see in the provider's own dashboard. It still requires a shared
// secret so it isn't publicly callable.
//
// Required Netlify environment variables:
//   WHITE_LABEL_API_KEY, WHITE_LABEL_API_SECRET  (see SETUP.md)
//   ADMIN_API_TOKEN — a long random string you set yourself; the request
//                     must send it as `x-admin-token`. Treat it like a
//                     password. This is a stopgap until Prompt 2's real
//                     admin login exists.

const { getResellerDevices, WhiteLabelApiError } = require('./_whiteLabelClient');
const { getFriendlyErrorMessage } = require('./_deviceAccess');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken) {
    return { statusCode: 500, body: JSON.stringify({ error: 'This endpoint is not configured.' }) };
  }

  const suppliedToken = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  if (!suppliedToken || suppliedToken !== adminToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { data } = await getResellerDevices();
    const devices = Array.isArray(data) ? data : [];
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: 'White-label API authentication and request flow are working.',
        deviceCount: devices.length,
      }),
    };
  } catch (err) {
    if (err instanceof WhiteLabelApiError) {
      console.error('[whitelabel-connection-test] provider error', { code: err.code, status: err.status });
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: getFriendlyErrorMessage(err) }) };
    }
    console.error('[whitelabel-connection-test] unexpected error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Unexpected server error.' }) };
  }
};
