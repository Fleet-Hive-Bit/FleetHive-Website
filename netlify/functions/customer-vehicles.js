// netlify/functions/customer-vehicles.js
//
// Returns ONLY the authenticated customer's own vehicles (Prompt 2A.1
// §10/§12). The customer id never comes from the browser — it's resolved
// from the session cookie via requireSession(), and _db.js's key layout
// (veh:<customerId>:<vehicleId>) means a lookup literally cannot surface
// another customer's records.
//
// Provider (white-label) identifiers are never sent to the browser here —
// only the FleetHive-facing fields a customer is allowed to see. If a
// vehicle's live status needs to come from the provider, that lookup
// happens server-side, through _whiteLabelClient.js, using the mapping
// resolved by _deviceAccess.js.resolveOwnedDevice() — not implemented in
// this phase (Prompt 2A.1 is the customer/vehicle foundation; the live
// Fleet Intelligence view that would call it is Prompt 2A.2).

const { requireSession } = require('./_auth');
const db = require('./_db');

function sanitizeVehicle(v) {
  if (!v) return null;
  // Deliberately excludes whiteLabelClientId / whiteLabelDeviceId / imei —
  // those stay server-side per §11/§13.
  const { id, label, make, model, plateNumber, createdAt } = v;
  return { id, label, make, model, plateNumber, createdAt };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const session = await requireSession(event);
    if (!session) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in.' }) };
    }

    const vehicles = await db.listVehiclesForCustomer(session.customer.id);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicles: vehicles.map(sanitizeVehicle) }),
    };
  } catch (e) {
    console.error('customer-vehicles failed:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "We're unable to load your vehicles right now. Please try again." }),
    };
  }
};
