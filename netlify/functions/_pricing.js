// netlify/functions/_pricing.js
//
// Server-side mirror of the pricing table in pricing.js (Lite/Pro/Prime
// subscription prices, vehicle/device pricing, hardware/software add-ons,
// and the Tag Plan one-time cost). This is the ONLY place amount
// verification is allowed to trust — paystack-initialize.js uses it to
// independently recompute what an order SHOULD cost from the structured
// selections the browser sends (plan, vehicle type/year/count, add-on ids,
// tag count, added plans, Hive Credits), rather than trusting the
// `totalAmount` number the browser also sends alongside it.
//
// IMPORTANT: keep this in sync with the constants at the top of pricing.js.
// If you change a price there, change it here too, or checkout will start
// rejecting legitimate orders as "amount mismatch."

const PLANS = {
  lite: { name: 'Lite', m: 4000, y: 42000 },
  pro: { name: 'Pro', m: 6000, y: 60000 },
  prime: { name: 'Prime', m: 12000, y: 120000 },
};

const TAGPLAN_ONE_TIME = 35000;
const TAGPLAN_RENEW_M = 3000;
const TAGPLAN_RENEW_Y = 30000;

const VEHICLE_PRICES = {
  lite: { '2000-2005': 90000, '2006-2010': 120000, '2011-2015': 170000, '2016-2019': 210000, '2020-2026': 300000, bike: 80000, heavy: 250000 },
  pro: { '2000-2005': 190000, '2006-2010': 230000, '2011-2015': 280000, '2016-2019': 320000, '2020-2026': 400000, bike: 150000, heavy: 350000 },
  prime: { '2006-2010': 480000, '2011-2015': 530000, '2016-2019': 570000, '2020-2026': 650000, bike: 300000, heavy: 550000 },
};
const BIKE_TYPES = ['Bike', 'Tricycle'];
const HEAVY_TYPES = ['Truck', 'Heavy Equipment'];

const HARDWARE_ADDONS = {
  dashcam: 200000, dashcam128: 230000, dashcam64: 215000, stepdown: 10000,
  teltonika: 400000, fuelsensor: 300000, canbus: 300000, doorsensor: 50000,
  sos: 40000, tempsensor: 50000,
};
const SOFTWARE_ADDONS = {
  dashcamstorage: 10000, analytics: 10000, routeopt: 10000,
  driverscore: 5000, maintalert: 5000, fuelmonitor: 5000,
};

function vehicleCategory(type) {
  if (BIKE_TYPES.indexOf(type) > -1) return 'bike';
  if (HEAVY_TYPES.indexOf(type) > -1) return 'heavy';
  return 'year';
}
// Prime is only available for vehicles from 2006 onward (§10/§11). Enforced
// here — not just in the UI — so a browser that somehow submits Prime +
// 2000-2005 can't be priced at all (previously this silently fell through
// to 0, since VEHICLE_PRICES.prime has no '2000-2005' key, rather than
// being rejected as an invalid order).
function isPrimeYearInvalid(plan, year) {
  return plan === 'prime' && year === '2000-2005';
}
function vehiclePrice(plan, type, year) {
  const table = VEHICLE_PRICES[plan];
  if (!table || !type) return 0;
  if (isPrimeYearInvalid(plan, year)) return null;
  const cat = vehicleCategory(type);
  if (cat === 'bike') return table.bike || 0;
  if (cat === 'heavy') return table.heavy || 0;
  return table[year] || 0;
}

// Fleet Tag amount for one unit's worth of the year-based plan amount
// (§5/§7/§8): Vehicle Type -> Vehicle Year -> Selected Plan -> the SAME
// VEHICLE_PRICES table Lite/Pro/Prime use for their device cost. This is
// added on top of the flat FleetTag device+setup cost — never used in
// place of it, and never replaced by the plan's monthly subscription
// figure. Returns null if the plan/vehicle combination is invalid (e.g.
// Prime + 2000-2005) or incomplete, so the caller can reject the order
// instead of silently pricing it at 0.
function fleetTagYearAmount(tagPlan, vehicleType, vehicleYear) {
  if (!tagPlan || !PLANS[tagPlan] || !vehicleType) return null;
  if (vehicleCategory(vehicleType) === 'year' && !vehicleYear) return null;
  const amt = vehiclePrice(tagPlan, vehicleType, vehicleYear);
  return amt; // null (invalid Prime year) or a number (0 is a legitimate "no match" fallback)
}

// entry: { plan, vehicleType?, vehicleYear?, count, billing? } for a
// subscription plan, or { plan:'tagplan', count, tagPlan, vehicleType,
// vehicleYear } for a Tag Plan entry. count === '5+' (string) means a
// custom fleet quote — mirrors pricing.js: only the flat subscription
// price is charged today, no per-vehicle device price, since that's
// quoted separately by the team.
// Returns null if the entry is invalid/unpriceable (caller must then
// reject the whole order rather than substitute a fallback amount).
function planEntryTotal(entry, fallbackBilling) {
  if (!entry || !entry.plan) return 0;
  if (entry.plan === 'tagplan') {
    const count = Number(entry.count) || 1;
    const yearAmt = fleetTagYearAmount(entry.tagPlan, entry.vehicleType, entry.vehicleYear);
    if (yearAmt === null) return null;
    return (TAGPLAN_ONE_TIME + yearAmt) * count;
  }
  const p = PLANS[entry.plan];
  if (!p) return 0;
  const billing = entry.billing || fallbackBilling || 'monthly';
  const sub = billing === 'annual' ? p.y : p.m;
  if (entry.count === '5+') return sub;
  const count = Number(entry.count) || 1;
  const device = vehiclePrice(entry.plan, entry.vehicleType, entry.vehicleYear);
  if (device === null) return null;
  return sub + device * count;
}

// Recomputes the full order subtotal from structured metadata — mirrors
// computeSubtotal() in pricing.js line for line. Returns null if the
// metadata doesn't describe a recognized/priceable plan (caller should
// then reject the order rather than trusting the browser's totalAmount).
function computeExpectedTotal(meta) {
  if (!meta || !meta.planType) return null;
  let total = 0;

  if (meta.planType === 'tagplan') {
    const n = Number(meta.tagCount) || 1;
    const yearAmt = fleetTagYearAmount(meta.tagPlan, meta.vehicleType, meta.vehicleYear);
    if (yearAmt === null) return null;
    total += (TAGPLAN_ONE_TIME + yearAmt) * n;
    if (typeof meta.hiveCredits === 'number' && meta.hiveCredits > 0) total += meta.hiveCredits;
  } else if (PLANS[meta.planType]) {
    const p = PLANS[meta.planType];
    const amt = meta.billing === 'annual' ? p.y : p.m;
    total += amt;
    const count = meta.vehCount === '5+' ? null : Number(meta.vehCount) || 1;
    if (count && meta.vehicleType) {
      const device = vehiclePrice(meta.planType, meta.vehicleType, meta.vehicleYear);
      if (device === null) return null;
      total += device * count;
    }
    (meta.hardwareAddonIds || []).forEach((id) => { total += HARDWARE_ADDONS[id] || 0; });
    (meta.softwareAddonIds || []).forEach((id) => { total += SOFTWARE_ADDONS[id] || 0; });
  } else {
    return null;
  }

  for (const entry of (meta.addedPlansData || [])) {
    const entryTotal = planEntryTotal(entry, meta.billing);
    if (entryTotal === null) return null;
    total += entryTotal;
  }

  return total;
}

module.exports = {
  PLANS, TAGPLAN_ONE_TIME, TAGPLAN_RENEW_M, TAGPLAN_RENEW_Y,
  VEHICLE_PRICES, HARDWARE_ADDONS, SOFTWARE_ADDONS, computeExpectedTotal,
};
