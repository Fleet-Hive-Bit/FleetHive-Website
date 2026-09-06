// netlify/functions/admin-client-lookup.js
//
// Admin-only. Solves a real gap: every Asset/* provider endpoint requires
// an opaque ClientId (e.g. "RGU2Ag==" per the API doc's own example), but
// nothing in the provider's dashboard necessarily surfaces that ID in a
// findable way. The one documented endpoint that ties a human-readable
// name to that ID is POST /api/Client/GetAllClients, which returns every
// client under FleetHive's reseller account as { ClientId, vCompanyName }
// pairs (API Documentation V3.0, "Get All The Clients"). This endpoint
// fetches that list and filters it server-side by a ?q= search term
// against vCompanyName, so an admin can type "Owoeye" instead of having to
// already know the ClientId.
//
// Reseller-wide, same sensitivity as admin-devices.js's no-clientId case —
// admin-gated only, never exposed to a customer session.

const { requireAdminSession, OwnershipError, getFriendlyErrorMessage } = require('./_deviceAccess');
const { getAllClients, WhiteLabelApiError } = require('./_whiteLabelClient');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    await requireAdminSession(event);
  } catch (e) {
    if (e instanceof OwnershipError) {
      return { statusCode: e.status, body: JSON.stringify({ error: e.message }) };
    }
    console.error('admin-client-lookup auth failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error.' }) };
  }

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim().toLowerCase();

  try {
    const { data } = await getAllClients();
    const rawClients = (data && Array.isArray(data.client)) ? data.client : (Array.isArray(data) ? data : []);

    const clients = rawClients
      .map((c) => ({
        clientId: c && (c.ClientId || c.ClientID),
        companyName: c && c.vCompanyName,
      }))
      .filter((c) => c.clientId && c.companyName);

    const filtered = q
      ? clients.filter((c) => c.companyName.toLowerCase().includes(q))
      : clients;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients: filtered }),
    };
  } catch (err) {
    if (err instanceof WhiteLabelApiError) {
      console.error('[admin-client-lookup] provider error', { code: err.code, status: err.status });
      return { statusCode: 502, body: JSON.stringify({ error: getFriendlyErrorMessage(err) }) };
    }
    console.error('[admin-client-lookup] unexpected error', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unable to search clients right now.' }) };
  }
};
