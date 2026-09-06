// netlify/functions/admin-vehicles.js
//
// Admin-only (Prompt 2B.2 §2/§8). Two things:
//
//   GET  — the "review device mapping" screen: every FleetHive vehicle,
//          across every customer, with its current provider-mapping
//          status. Reads only from FleetHive's own database (fast, no
//          provider call) — this is NOT the same as GET
//          /api/Asset/GetResellerDevices (that's admin-devices.js);
//          this is FleetHive's own Customer -> Vehicle records.
//
//   POST — creates a new FleetHive vehicle, owned by an admin-selected
//          customer. This is the step that must exist before "associate
//          a device with a FleetHive vehicle" is possible at all, since
//          nothing in FleetHive today lets a vehicle record be created
//          otherwise (see PROMPT-2A1 — customers have no self-service
//          "add a vehicle" flow yet). customerId is taken from the
//          request body here, but only because the admin is the one
//          supplying it, having themselves just looked it up via
//          admin-customers.js — it is never treated as a claim of
//          identity the way a customerId from an ordinary customer
//          request would be (that would be exactly the IDOR pattern
//          §12 warns about). The endpoint itself is admin-gated, so an
//          ordinary customer can never reach this branch no matter what
//          customerId they might send.

const { requireAdminSession, OwnershipError } = require('./_deviceAccess');
const db = require('./_db');

function sanitizeVehicleForAdmin(v, customersById) {
  const customer = customersById[v.customerId];
  return {
    id: v.id,
    customerId: v.customerId,
    customerEmail: customer ? customer.email : 'Unknown',
    customerName: customer ? customer.name : 'Unknown',
    label: v.label,
    make: v.make,
    model: v.model,
    plateNumber: v.plateNumber,
    isMapped: Boolean(v.whiteLabelClientId && v.whiteLabelDeviceId),
    whiteLabelClientId: v.whiteLabelClientId || null,
    whiteLabelDeviceId: v.whiteLabelDeviceId || null,
    imei: v.imei || null,
    createdAt: v.createdAt,
  };
}

exports.handler = async (event) => {
  let adminCtx;
  try {
    adminCtx = await requireAdminSession(event);
  } catch (e) {
    if (e instanceof OwnershipError) {
      return { statusCode: e.status, body: JSON.stringify({ error: e.message }) };
    }
    console.error('admin-vehicles auth failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error.' }) };
  }

  if (event.httpMethod === 'GET') {
    try {
      const [vehicles, customers] = await Promise.all([db.listAllVehicles(), db.listAllCustomers()]);
      const customersById = {};
      customers.forEach((c) => { customersById[c.id] = c; });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicles: vehicles.map((v) => sanitizeVehicleForAdmin(v, customersById)) }),
      };
    } catch (e) {
      console.error('admin-vehicles GET failed:', e.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Unable to load vehicle mappings right now.' }) };
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const customerId = String(body.customerId || '').trim();
      if (!customerId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A customer must be selected.' }) };
      }
      // Verify the customer actually exists before creating a vehicle
      // "for" them — never trust the id blindly just because an admin
      // sent it (a typo shouldn't silently create an orphaned record).
      const customer = await db.getCustomerById(customerId);
      if (!customer) {
        return { statusCode: 404, body: JSON.stringify({ error: 'That customer could not be found.' }) };
      }

      const label = String(body.label || '').trim();
      const make = String(body.make || '').trim();
      const model = String(body.model || '').trim();
      const plateNumber = String(body.plateNumber || '').trim();
      if (!label && !make && !model) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Give the vehicle at least a name, make, or model.' }) };
      }

      const vehicle = await db.createVehicle(customerId, { label, make, model, plateNumber });

      await db.recordAuditLog({
        action: 'vehicle_created',
        adminId: adminCtx.authContext.userId,
        adminEmail: adminCtx.authContext.email,
        customerId,
        vehicleId: vehicle.id,
        detail: `Created vehicle "${label || [make, model].filter(Boolean).join(' ') || vehicle.id}" for ${customer.email}`,
      });

      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle: sanitizeVehicleForAdmin(vehicle, { [customer.id]: customer }) }),
      };
    } catch (e) {
      console.error('admin-vehicles POST failed:', e.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Unable to create the vehicle right now.' }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
