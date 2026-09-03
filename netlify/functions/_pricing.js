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
function vehiclePrice(plan, type, year) {
  const table = VEHICLE_PRICES[plan];
  if (!table || !type) return 0;
  const cat = vehicleCategory(type);
  if (cat === 'bike') return table.bike || 0;
  if (cat === 'heavy') return table.heavy || 0;
  return table[year] || 0;
}

// entry: { plan, vehicleType?, vehicleYear?, count, billing? } for a
// subscription plan, or { plan:'tagplan', count } for a Tag Plan entry.
function planEntryTotal(entry, fallbackBilling) {
  if (!entry || !entry.plan) return 0;
  if (entry.plan === 'tagplan') {
    return TAGPLAN_ONE_TIME * (Number(entry.count) || 1);
  }
  const p = PLANS[entry.plan];
  if (!p) return 0;
  const billing = entry.billing || fallbackBilling || 'monthly';
  const sub = billing === 'annual' ? p.y : p.m;
  const count = Number(entry.count) || 1;
  const device = vehiclePrice(entry.plan, entry.vehicleType, entry.vehicleYear);
  return sub + device * count;
}

// Recomputes the full order subtotal from structured metadata — mirrors
// computeSubtotal() in pricing.js line for line. Returns null if the
// metadata doesn't describe a recognized plan (caller should then fall
// back to treating the browser's totalAmount as unverifiable and flag it).
function computeExpectedTotal(meta) {
  if (!meta || !meta.planType) return null;
  let total = 0;

  if (meta.planType === 'tagplan') {
    const n = Number(meta.tagCount) || 1;
    total += TAGPLAN_ONE_TIME * n;
    if (typeof meta.hiveCredits === 'number' && meta.hiveCredits > 0) total += meta.hiveCredits;
  } else if (PLANS[meta.planType]) {
    const p = PLANS[meta.planType];
    const amt = meta.billing === 'annual' ? p.y : p.m;
    total += amt;
    const count = meta.vehCount === '5+' ? null : Number(meta.vehCount) || 1;
    if (count && meta.vehicleType) {
      total += vehiclePrice(meta.planType, meta.vehicleType, meta.vehicleYear) * count;
    }
    (meta.hardwareAddonIds || []).forEach((id) => { total += HARDWARE_ADDONS[id] || 0; });
    (meta.softwareAddonIds || []).forEach((id) => { total += SOFTWARE_ADDONS[id] || 0; });
  } else {
    return null;
  }

  (meta.addedPlansData || []).forEach((entry) => {
    total += planEntryTotal(entry, meta.billing);
  });

  return total;
}

module.exports = { PLANS, TAGPLAN_ONE_TIME, VEHICLE_PRICES, HARDWARE_ADDONS, SOFTWARE_ADDONS, computeExpectedTotal };
