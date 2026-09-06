// netlify/functions/_store.js
//
// Minimal persistent store for Paystack orders/transactions, using Netlify
// Blobs (https://docs.netlify.com/blobs/overview/) — a key/value store
// built into Netlify, so it needs no external database or extra service.
// Netlify auto-provisions credentials for it at runtime on deployed sites;
// nothing to configure in the dashboard.
//
// Used by paystack-initialize.js, paystack-verify.js and
// paystack-webhook.js to record every transaction (reference, amount,
// status, customer/plan metadata) and to make verification idempotent —
// so a redirect + a webhook firing for the same reference don't double
// activate an order or double-send the confirmation email.
//
// This is intentionally best-effort: if Blobs isn't available for some
// reason (e.g. running outside Netlify), every function still works using
// Paystack as the source of truth — orders just won't be persisted
// locally. Nothing about payment verification depends on this store.

let getStore;
try {
  // Lazy require so a missing/failed Blobs setup never breaks payment
  // verification itself — only persistence.
  ({ getStore } = require('@netlify/blobs'));
} catch (e) {
  getStore = null;
}

function store() {
  if (!getStore) return null;
  try {
    return getStore('fleethive-orders');
  } catch (e) {
    console.error('Netlify Blobs unavailable:', e.message);
    return null;
  }
}

async function getOrder(reference) {
  const s = store();
  if (!s || !reference) return null;
  try {
    return await s.get(reference, { type: 'json' });
  } catch (e) {
    console.error('_store.getOrder failed:', e.message);
    return null;
  }
}

async function saveOrder(reference, data) {
  const s = store();
  if (!s || !reference) return false;
  try {
    const existing = (await getOrder(reference)) || {};
    const merged = { ...existing, ...data, reference, updatedAt: new Date().toISOString() };
    await s.setJSON(reference, merged);
    // If this order is (now) associated with a signed-in FleetHive customer,
    // keep the customer -> references index up to date so the Portal's
    // subscription view (Prompt 2B.1 §1) can find their orders without
    // scanning every order in the store. Only ever written from a
    // customerId the server itself resolved from the session — never from
    // anything the browser sent directly (see paystack-initialize.js).
    const customerId = merged.customerId;
    if (customerId) {
      const indexKey = `custorders:${customerId}`;
      let refs = [];
      try { refs = (await s.get(indexKey, { type: 'json' })) || []; } catch (e) { refs = []; }
      if (refs.indexOf(reference) === -1) {
        refs.push(reference);
        await s.setJSON(indexKey, refs);
      }
    }
    return true;
  } catch (e) {
    console.error('_store.saveOrder failed:', e.message);
    return false;
  }
}

// Returns every order on record for a given FleetHive customer id, most
// recent first. Only orders that were initialized while the customer was
// signed in (so paystack-initialize.js could resolve customerId server-side)
// appear here — anonymous/pre-login checkouts made with the same email are
// not retroactively linked, since there is no verified server-side fact
// tying that historical order to this account.
async function getOrdersForCustomer(customerId) {
  const s = store();
  if (!s || !customerId) return [];
  try {
    const refs = (await s.get(`custorders:${customerId}`, { type: 'json' })) || [];
    const orders = await Promise.all(refs.map((ref) => getOrder(ref)));
    return orders
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch (e) {
    console.error('_store.getOrdersForCustomer failed:', e.message);
    return [];
  }
}

module.exports = { getOrder, saveOrder, getOrdersForCustomer };
