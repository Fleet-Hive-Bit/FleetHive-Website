# FleetHive Website — Prompt 1B Summary
White-Label API Foundation · Security · Resend Email Branding

## Scope note
This picks up from `AUDIT-REPORT-PROMPT3.md` (Prompt 3 pass), which found
the white-label dashboard couldn't be built yet because the provider
identity, API docs, and credential mechanism weren't available. Prompt 1B
supplied "API Documentation V3.0.pdf" — that gap is now closed at the
foundation level. Nothing from Prompt 1A (Meet the Team, CEO/COO
expansion, header, mobile nav, branding) was touched — see "Prompt 1A
verification" below.

**No provider credentials were included in this round's upload.** Nothing
was hardcoded or invented in their place — `WHITE_LABEL_API_KEY` /
`WHITE_LABEL_API_SECRET` are read from Netlify environment variables that
you still need to set once you have them (SETUP.md Part C, step 2).

## 1. What was read
"API Documentation V3.0.pdf" (172 pages, RESTful API V3.0, base URL
`https://api.gpsiot.net`) was read in full. Every endpoint, field name,
and status code used below is taken directly from it — nothing was
guessed. The 10 endpoints listed in the prompt (§5) plus the `/token`
auth endpoint are implemented; the other ~90 documented endpoints
(clients, users, roles, geofences, trips, fuel, alerts, etc.) are not
implemented, since the prompt scoped this phase to the §5 list plus the
device/lock-status/assignment operations it depends on.

## 2. Files added
- `netlify/functions/_whiteLabelClient.js` — the API client: `/token`
  exchange, in-memory token cache with auto-refresh (and immediate
  refresh on a 401), 15s request timeout, retries with backoff on 429
  (honoring `Retry-After`) and 5xx/network errors, and one wrapper
  function per documented endpoint in §5. Credentials and tokens are
  redacted from every log line (`safeLog()`).
- `netlify/functions/_deviceAccess.js` — normalizers
  (`normalizeDeviceStatus`, `normalizeLockStatus`, `normalizeDeviceRecord`)
  that turn raw provider fields into a safe shape, a friendly-error mapper
  (`getFriendlyErrorMessage`), and the ownership/IDOR contract
  (`resolveOwnedDevice`, `requireAdmin`) — see §4 below for why the latter
  two currently throw.
- `netlify/functions/whitelabel-connection-test.js` — a token-gated
  connectivity check (see SETUP.md Part C, "Testing it").
- `.env.example`, `.gitignore` — so the new (and existing) secret env
  vars have a documented, non-committed home.

## 3. Files changed
- `netlify/functions/_email.js` — refactored so `sendEmail()` and
  `sendWelcomeEmail()` both call one shared `renderBrandedEmail()`
  template instead of each building its own copy of the HTML shell. Same
  official FleetHive logo (`assets/logo.png`), same navy/sky brand colors,
  same escaping of user-supplied fields. A new `sendBrandedEmail()` export
  makes that one template reusable for future flows without duplicating
  it again. **No caller had to change** — `send-lead.js`, `send-order.js`,
  `send-contact.js`, `send-partner.js`, `send-newsletter.js`, and
  `_paystack.js` (payment success/mismatch emails) all already went
  through `sendEmail`/`sendWelcomeEmail`, so every existing customer-facing
  email flow now renders from the single template automatically.
- `SETUP.md` — added the `_whiteLabelClient.js` / `_deviceAccess.js` /
  `whitelabel-connection-test.js` rows to the functions table, and a new
  "Part C" section covering credentials, env vars, and testing.

## 4. Why there's no tracking dashboard or admin assign/unassign screen
Two of the prompt's own conditions point the same direction:
- §9 (IDOR): every vehicle/device request must first verify the vehicle
  belongs to the authenticated account — never trust a browser-supplied
  `vehicleId`/`imei`/`deviceId` as proof.
- §13/§14: assign/unassign must be restricted to admins, and admin
  screens are only "prepared" **if an admin dashboard already exists**.

This codebase has no customer database, vehicle records, login system, or
admin dashboard (Prompt 1A was the marketing site; Prompt 3's audit
confirmed "Login" currently points straight at the provider's own portal,
`app.fleethive.in`, and flagged that as the actual gap). Shipping a
vehicle-status or assign/unassign endpoint right now would mean either
leaving it open to anyone (the exact IDOR hole §9 exists to prevent) or
faking an ownership/role check that doesn't check anything real — neither
is acceptable.

So `_deviceAccess.js` defines the exact contract instead:
`resolveOwnedDevice(authContext, vehicleId)` and `requireAdmin(authContext)`
both currently throw `NotImplementedError`, with the 5 checks from §9
written out as ordered `TODO` comments describing exactly what each one
needs to do once FleetHive's customer/vehicle database exists. Every
future vehicle-scoped call in this codebase should go through
`resolveOwnedDevice()` — wiring it up in Prompt 2 is then a matter of
filling in real database lookups, not re-deriving the ownership model.

`whitelabel-connection-test.js` is the one exception: it only calls
`GetResellerDevices`, which the documentation scopes at the reseller
level (not per-customer), so there's no ownership question for it — it's
gated by a separate `ADMIN_API_TOKEN` shared secret instead, purely to
prove the auth/request/retry machinery actually works end-to-end.

**Flag for Prompt 2:** the "Login" → `app.fleethive.in` redirect noted in
the Prompt 3 audit still exists — that's exactly the "no white-label
platform leakage" pattern §20 warns against, and the Customer Portal work
in Prompt 2 should replace it with a FleetHive-branded login backed by
this foundation, not carry it forward.

## 5. Data-safety guarantees actually enforced in code
- Lock status: `normalizeLockStatus()` maps `1`→locked, `0`→unlocked, and
  **everything else (including `-1` and missing/malformed values)**→
  `undetermined`. Verified with a unit test covering all four cases.
- Device status: `normalizeDeviceStatus()` returns `"Data unavailable"`
  for any field the provider didn't return — never a fabricated number.
  Verified with a test asserting a partial response doesn't get padded
  with invented values.
- Historical data: `getClientDeviceStatusByDateRange()` rejects any
  range over 2 minutes before a request is made (`RANGE_TOO_LARGE`).
  `getClientDeviceStatusByDateRangeBatched()` is the safe way to cover a
  longer range — it walks it as sequential ≤2-minute server-side
  requests. Verified with a test asserting a 5-minute range becomes
  exactly 3 provider requests.
- Errors: raw provider errors never reach the browser —
  `getFriendlyErrorMessage()` maps every error code to one of a fixed set
  of safe messages; technical detail goes to server logs only, with
  credentials/tokens redacted first.

## 6. Testing performed
Run directly (Node, no live network — `fetch` mocked so nothing touched
the real provider without real credentials):
- **Auth/token flow**: first call fetches a token; a second call within
  the token's lifetime reuses it (no second `/token` request) — confirms
  the in-memory cache. A simulated `401` triggers exactly one token
  refresh and retry, not an infinite loop.
- **Rate limit / 5xx**: request/retry path exercised (see
  `_whiteLabelClient.js` `request()` — 429 backs off honoring
  `Retry-After`; 5xx retries with backoff; both give up after
  `MAX_RETRIES` with a safe error).
- **IDOR-relevant range guard**: an 11-minute-apart start/end pair is
  rejected before any request is sent.
- **Batching**: a 5-minute range against `GetClientDeviceStatusByDateRange`
  produces exactly 3 sequential ≤2-minute provider requests.
- **Lock/device-status normalizers**: all documented status values (incl.
  `-1`) and partial/missing responses, as in §5 above.
- **Connection-test endpoint auth gating**: no `ADMIN_API_TOKEN`
  configured → 500 without touching the provider; missing header → 401;
  wrong header → 401; wrong HTTP method → 405.
- **Email template**: `sendEmail`/`sendWelcomeEmail` both render with the
  FleetHive logo present, user-supplied HTML (`<script>...`) escaped in
  the output, and the welcome email's personalized heading correct.
- **Syntax**: `node --check` on every new/changed file.

Not tested (needs your real credentials, which weren't provided this
round): an actual authenticated call against `https://api.gpsiot.net`.
Once `WHITE_LABEL_API_KEY`/`WHITE_LABEL_API_SECRET` are set in Netlify,
use `whitelabel-connection-test.js` (SETUP.md Part C) to verify that live.

## 7. Prompt 1A verification
Confirmed unchanged (file contents untouched — this pass only added new
`netlify/functions/*` files and edited `_email.js`/`SETUP.md`):
`index.html`, `about.html`, `site.js`, `style.css`, `pricing.html`, and
every other existing page/asset. Meet the Team, CEO/COO expansion,
Babashola Nelson, header scroll behavior, and mobile navigation all live
in files this pass never opened for writing.

## 8. Success criteria checklist (from the prompt)
1. ✅ API doc reviewed in full (172 pages).
2. ✅ Auth implemented server-side only (`_whiteLabelClient.js`), Bearer
   token flow per the doc.
3. ✅ Credentials read only from `WHITE_LABEL_API_KEY`/`_SECRET` env vars —
   nowhere else, never logged.
4. ✅ Reusable `_whiteLabelClient.js` centralizes auth/requests/retries/
   errors — no duplicated auth logic.
5. ✅ The §5 endpoints are mapped with exact documented structures.
6. 🟡 Customer → Vehicle → Client → Asset → Device mapping is defined as
   an explicit contract (`resolveOwnedDevice`) — not yet backed by a real
   database, since that database doesn't exist in this codebase (Prompt 2).
7. 🟡 IDOR protection: the 5 required checks are encoded as the ordered
   steps `resolveOwnedDevice` must perform — enforced once Prompt 2 wires
   in real lookups; nothing vehicle-scoped is exposed unprotected today.
8. ✅ Device status foundation exists, with "Data unavailable" fallback.
9. ✅ Historical-data 2-minute limit is enforced server-side, with a
   batching helper for longer ranges.
10. 🟡 Device assignment functions exist in the client
    (`assignAsset`/`unassignAsset`/`assignSimCard`/`unassignSimCard`) but
    are intentionally not exposed via any endpoint yet — no admin
    dashboard exists to restrict them to (§14 is conditional on one
    already existing).
11. ✅ Resend unchanged/still functional; all existing flows verified to
    route through the same shared template.
12. ✅ FleetHive-branded template exists (`renderBrandedEmail`).
13. ✅ Official `assets/logo.png` used — no new logo generated.
14. ✅ No provider branding anywhere in emails or code.
15. ✅ No fake tracking data — normalizers only ever pass through real
    values or `"Data unavailable"`.
16. ✅ Prompt 1A functionality verified intact (§7 above).
17. ✅ Nothing existing was replaced — only `_email.js` was edited
    in-place (behavior-preserving refactor) and new files were added.
