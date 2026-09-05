# FleetHive Website — Prompt 2A.2 Summary
Fleet Intelligence — Live Vehicle Tracking Dashboard

## Scope note
Picks up from Prompt 2A.1 (FleetHive authentication, Customer Portal,
`customer-vehicles.js`, `_auth.js`/`_db.js`, and the `_deviceAccess.js` /
`_whiteLabelClient.js` foundation from Prompt 1B). Nothing from those
phases was rebuilt — `login.js`, `portal.html`/`portal.js`, `_auth.js`,
`_db.js`, `auth-*.js` and the Prompt 1B provider client are untouched.
`fleet-intelligence.html` previously showed a static "coming soon"
placeholder behind the auth check Prompt 2A.1 added — this phase replaces
that placeholder with the real dashboard, reusing the same auth check.

## 1. What was built

### Backend (new)
- `netlify/functions/vehicle-status.js` — current status + lock status for
  one of the signed-in customer's own vehicles. Every request re-resolves
  ownership through `resolveOwnedDevice()`; the browser's `vehicleId` is
  never trusted as proof of anything. If the vehicle has no admin-linked
  tracking device yet, responds `200 { linked:false }` instead of an
  error, since that's a legitimate account state, not a failure.
- `netlify/functions/vehicle-trip-history.js` — history for one vehicle
  over a browser-supplied range, capped at 20 minutes per request (well
  inside the documented 2-minute-per-provider-call limit) and served via
  `_whiteLabelClient.getClientDeviceStatusByDateRangeBatched()`, which
  walks it as sequential ≤2-minute provider requests — never a
  browser-driven fan-out.

### Backend (extended)
- `netlify/functions/_deviceAccess.js` — added `deriveFriendlyStatus()`
  and its helpers (`deriveOnlineState`, `deriveMotionLabel`,
  `deriveIgnitionLabel`, `hasCoordinates`). Translates documented provider
  fields into the FleetHive-facing language (§7): Online/Offline (from
  the real `utc_date`, using a 20-minute staleness threshold — a display
  rule applied to a real timestamp, never a fabricated one), Moving/
  Parked (from `MotionState` only — never inferred from the presence of
  GPS coordinates, per §7's explicit rule), Ignition On/Off (from
  `IgnitionState`). Any provider value the mapping doesn't recognize is
  shown as-is rather than guessed.

### Frontend (new)
- `fleet-intelligence.js` — the dashboard: vehicle list with search,
  multi-vehicle map (Leaflet + OpenStreetMap tiles, no API key needed —
  there was no existing map implementation to reuse), vehicle selection
  that highlights the list item and flies the map to that vehicle, a
  detail panel (Overview / Device / Trip History tabs), and the polling
  strategy described below.
- `fleet-intelligence.html` — rewritten from the Prompt 2A.1 placeholder.
  Same auth-me gate and redirect-to-login behavior as before; the header/
  mobile nav are untouched.

### Frontend (extended)
- `style.css` — new "FLEET INTELLIGENCE" section appended at the end of
  the file. Reuses the existing design tokens and the Customer Portal's
  `.portal-empty`/`.portal-skel-*` states rather than introducing a
  parallel theme.

## 2. Polling / performance (§16)
- Vehicle statuses are fetched once for every vehicle when the dashboard
  loads (so the list and map have real data immediately), then only the
  **selected** vehicle is polled on a 30s interval — not the whole fleet
  continuously.
- A per-vehicle in-flight/cache guard (`fetchStatus()`) means the list,
  map and detail panel asking for the same vehicle in the same tick share
  one request instead of firing three.
- Polling pauses on `visibilitychange` when the tab is backgrounded and
  resumes on return.
- A manual "Refresh" button re-fetches every vehicle's status on demand
  without adding a second background timer.

## 3. Real data only / no provider leakage (§14/§23)
- Every displayed field is either a value the provider actually returned
  or the literal string "Data unavailable" — normalization is entirely in
  `_deviceAccess.js`, already covered by Prompt 1B's tests.
- The Device tab only shows FleetHive-facing fields (name, make/model,
  registration) — IMEI/DeviceId/ClientID never leave the server, in either
  the new endpoints' responses or `customer-vehicles.js` (unchanged).
- Provider errors are mapped to `getFriendlyErrorMessage()`'s fixed set of
  safe messages before reaching the browser; raw provider errors are
  logged server-side only.

## 4. What was intentionally NOT built
- **Driver monitoring, geofencing, alerts (§11/§12).** The ~90 documented
  endpoints outside the §5 list from Prompt 1B (which is what
  `_whiteLabelClient.js` implements) don't include driver-scoring,
  geofence, or alert endpoints. Per the prompt's own instruction not to
  invent driver scores/safety ratings/risk percentages or duplicate
  alerting without a documented source, none of this is implemented. If
  the provider's docs do cover this elsewhere, flag it and I'll wire it up
  against the actual documented shape.
- **Remote lock/unlock (§13).** Lock status is read-only (Locked/
  Unlocked/Undetermined, via the existing `normalizeLockStatus()`). No
  remote immobilization control is exposed, since nothing in the
  documented §5 endpoint set is a write operation for lock state, and
  §13 explicitly says not to build this without one.
- **Assign/unassign device UI.** `assignAsset`/`unassignAsset`/
  `assignSimCard`/`unassignSimCard` already exist in
  `_whiteLabelClient.js` (Prompt 1B) but still have no admin-gated caller
  — there's no admin dashboard in this codebase yet (`requireAdmin()`
  still correctly refuses everyone, since no account has an admin role).
  This is why vehicles show "not yet connected to a tracking device"
  until that admin linking tool exists — an honest account of the current
  state, not a placeholder.

## 5. Testing performed
- `node --check` on every new/changed backend file and on
  `fleet-intelligence.js`.
- Manually traced each response shape the frontend expects
  (`linked:false`, `error`, and the success shape) against what
  `vehicle-status.js`/`vehicle-trip-history.js` actually return.
- Confirmed `customer-vehicles.js`, `_auth.js`, `_db.js`,
  `_whiteLabelClient.js`, `portal.html`/`portal.js`, and every other
  existing file were not opened for writing in this pass except
  `_deviceAccess.js` (additive export) and `style.css` (additive
  section).

Not tested: an actual authenticated call against the provider, or a real
linked vehicle end-to-end — this environment has no live
`WHITE_LABEL_API_KEY`/`WHITE_LABEL_API_SECRET` or admin linking tool, so
every vehicle will show "not yet connected to a tracking device" until
both exist. The dashboard is fully wired to real endpoints and will start
showing live data the moment a vehicle is actually linked.

## 6. Completion criteria checklist (from the prompt)
1. ✅ Fleet Intelligence opens from the Customer Portal, same session.
2. ✅ No second login — reuses `auth-me`.
3. ✅ Vehicle list — real data from `customer-vehicles.js`.
4. ✅ Multiple vehicles — list, map markers, independent status per vehicle.
5. ✅ Vehicle selection — highlights list item, focuses map, loads detail.
6. ✅ Map — Leaflet/OSM (no existing map to reuse), multiple markers, focus-on-select.
7. ✅ Current vehicle status — `vehicle-status.js`, documented fields only.
8. ✅ Vehicle details — Overview / Device / Trip History tabs.
9. ✅ Real API data — see §3 above.
10. ✅ Trip history respects the documented 2-minute limit (server-side batching, 20-minute request cap).
11. 🟡 Driver info / alerts / geofencing — not implemented; not documented in the §5 endpoint set (see §4 above).
12. ✅ Lock status — read-only, translated to Locked/Unlocked/Undetermined.
13. ✅ No fake tracking data anywhere.
14. ✅ Provider credentials remain server-side (`_whiteLabelClient.js`, unchanged).
15. ✅ Customer authorization enforced — every endpoint re-derives ownership server-side.
16. ✅ Mobile (320–430px) and desktop layouts, both implemented and covered by the responsive CSS.
