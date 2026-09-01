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
    await s.setJSON(reference, { ...existing, ...data, reference, updatedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    console.error('_store.saveOrder failed:', e.message);
    return false;
  }
}

module.exports = { getOrder, saveOrder };
