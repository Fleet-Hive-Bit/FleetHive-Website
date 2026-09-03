# FleetHive Customer & Partner Dashboard — Prompt 1 of 4: Audit Report

Scope: audit only, per instructions. Nothing was built, redesigned, or
migrated. This covers the existing FleetHive site/backend (unchanged since
the prior audit) plus the newly-supplied White Label API documentation
(`API_Documentation_V3.0.pdf`, 172 pages, "RESTFUL API V3.0", provider base
URL `https://api.gpsiot.net`).

---

## 1. FleetHive frontend architecture
Static HTML/CSS/vanilla JS — no framework (no React/Vue/etc.), no build
step, no bundler. 13 real pages (`index.html`, `pricing.html`,
`how-it-works.html`, `about.html`, `contact.html`, `partners.html`, 7 blog
pages) plus one redirect stub (`solutions.html` → `how-it-works.html`).
Shared logic lives in `site.js` (Bree assistant, exit popup), `pricing.js`,
`partners.js`, and the shared `global-floating.js` component. Content/copy
is centralized in `bree-knowledge.js`. No client-side router — each page is
a real file; navigation is plain `<a href>`. No state-management library —
state is page-local JS variables/DOM.

There are currently **no** `/login`, `/dashboard`, `/dashboard/vehicles`,
`/dashboard/payments`, or `/partner/dashboard` routes or files anywhere in
the project. The only "login" reference is a static link to the external
white-label portal, `https://app.fleethive.in`, from Bree's CTA registry in
`site.js`.

## 2. FleetHive backend architecture
Serverless only: 12 Netlify Functions under `netlify/functions/`, no
standalone server, no persistent app backend beyond that. Functions today:
lead capture (`send-lead`), contact/partner/newsletter form mail
(`send-contact`, `send-partner`, `send-newsletter`), order email
(`send-order`), and the Paystack flow (`paystack-initialize`,
`paystack-verify`, `paystack-webhook`, plus shared helpers `_paystack.js`,
`_pricing.js`, `_email.js`, `_store.js`). All are stateless request/response
functions — none of them currently call any external tracking API.

## 3. Authentication architecture
**There is no FleetHive customer authentication system today.** No
login form, no password handling, no session, no JWT, no cookie auth
anywhere in the codebase (checked directly — zero matches for jwt, bcrypt,
passport, express-session, or any session/auth library in `package.json` or
source). "Login" is purely a link out to the white-label provider's own
portal. There is also no admin system and no partner account system in the
FleetHive codebase — the Partner page (`partners.html`) is a marketing/
application page (a form that emails the FleetHive team), not an account
system.

## 4. Database architecture
No database exists. The only persistence layer at all is
`netlify/functions/_store.js`, using Netlify Blobs as a simple key→JSON
store, and it holds exactly one thing: Paystack order records (reference,
amount, status, plan metadata) for idempotent payment verification. There
are no tables/models for customers, users, vehicles, devices, partners, or
subscriptions — those don't exist yet in any form.

## 5. Existing White Label integration
None. Confirmed by direct search: no API URLs, tokens, auth functions,
`fetch`/`axios` calls, or any reference to gpsiot.net (or any other
tracking-platform vendor) anywhere in the FleetHive codebase. The
integration described in this prompt does not exist yet in any form —
today's "integration" is just the outbound link to `app.fleethive.in`.

## 6. Available White Label API functionality
The supplied documentation is a real, dated (through 15/07/2024), versioned
REST API — not a stub. Key facts:

- **Base URL**: `https://api.gpsiot.net`
- **Auth**: OAuth2-style password grant. `POST /token` with a
  `WebApiKey` (username) + `WebApiSecret` (password) you request from the
  provider, `grant_type=password`. Returns a bearer `access_token` (expires
  in `expires_in` seconds, e.g. 7200). Every other endpoint requires
  `Authorization: Bearer <access_token>`. This is a **single reseller-level
  credential** — there is no per-customer login exposed by this REST API
  (see #7 below).
- **Hierarchy**: Reseller (FleetHive's own top account) → Sub-resellers
  ("mini-resellers") → Clients → Users (`UserType` 2 = Reseller User, 3 =
  Client User) → Assets/Devices. `GetAllClients` even takes an
  `IncludeMiniresellerClients` flag.
- **Relevant endpoint groups**: Client (`GetAllClients`, `GetClient`,
  `CreateClient`, `UpdateClient`, `DeleteClient`), User
  (`GetUsers`, `CreateUser`, `UpdateUser`, `DeleteUser`, `LoginHistory`,
  `InActiveUsers`, `RecoverPassword`), Asset/Device (`GetAllAssets`,
  `GetOneAsset`, `GetAllAssetsWithExtraDetails`, `GetClientUserAssets`,
  device CRUD, SIM management), current status/location
  (`GetDevicesCurrentData`, `GetResellerDevicesCurrentData`,
  `Status/v2/GetCurrent`), trips (`GetTrips`, `GetTripDetails`,
  `GetMileageSummary`), `DailySummary/GetDailySummary`, geofences, events/
  telemetry, fuel (`AssetFuelInfo`, `GetFuelTelemetry`), alerts
  (`GetClientAlerts`, `GetNotificationAlerts`), and GPRS device commands.
- **What actually answers the dashboard's needs** (section 3 of your
  prompt): `GetDevicesCurrentData` (or `GetResellerDevicesCurrentData`)
  returns, per device: `Lat`, `Lon`, `Location` (address string),
  `VehicleSpeed`, `IsIgnitionOn`, `GPSDateTime`, `Battery`, `DeviceName`,
  `ImeiNumber`. `GetAllAssetsWithExtraDetails` supplies the vehicle's own
  metadata (name, registration/`asset_reg_number`, make/model, year, fuel
  type, etc.).
- **Important gap — there is no explicit "online/offline" field anywhere
  in the documented responses.** The realistic way to derive it is
  "offline if `GPSDateTime` is older than N minutes" — a normal pattern for
  GPS platforms, but a threshold FleetHive has to define, not something the
  API states outright. "Parked vs moving" is derivable from `VehicleSpeed`
  (and/or `IsIgnitionOn`) rather than an explicit status flag. I'm flagging
  this now rather than quietly picking a number later.
- **No subscription/billing data anywhere in the API.** Confirms this
  platform is tracking-only — good, it means FleetHive's own payment
  records (already handled via Paystack) are the sole source of truth
  for section 5 of your prompt, with no risk of a second conflicting
  payment system.

## 7. How customer-to-vehicle mapping currently works
It doesn't — there's no FleetHive customer account system yet at all
(#3), so there's nothing to map from. On the provider side, the natural
join point is: **FleetHive Customer ID (to be built) → gpsiot.net
`ClientID` (+ optionally `UserID` if a customer should only see a subset of
their Client's assets) → Asset/Device IDs returned by `GetClientUserAssets`
/ `GetAllAssetsWithExtraDetails` scoped to that `ClientID`.** That mapping
table doesn't exist anywhere yet — it's new work, covered in #10 and #13.

One more important consequence of #6: because the only credential this API
accepts is the single reseller-level `WebApiKey`/`WebApiSecret`, FleetHill's
backend — not the browser, and not gpsiot.net directly — must always be
the one making these calls, filtering the response to the logged-in
customer's own `ClientID` before anything reaches the browser. There is no
way to hand a scoped, customer-specific credential to the frontend even if
we wanted to; the provider's auth model doesn't support it.

## 8. How partner-to-asset mapping currently works
Also doesn't exist yet on the FleetHive side (#3/#4). On the provider side,
the Reseller → Sub-reseller ("mini-reseller") → Client structure is a real,
usable primitive: a FleetHive Partner could plausibly be modeled as a
sub-reseller with their own Clients underneath. But the API's own concepts
stop at Reseller/Sub-reseller/Client/User — there is **no built-in
"Independent Partner" vs "Dependent Partner" distinction** in this API. If
FleetHive needs that distinction (per section 7 of your prompt), it has to
be a FleetHive-side construct layered on top (e.g., a `partners` table that
records each partner's own FleetHive-issued type, independent of how their
accounts happen to be structured on gpsiot.net) — not something I can
confirm or invent from the documentation alone.

## 9. Existing payment/subscription architecture
Real and working (audited previously, unchanged here): Paystack
integration with server-side transaction verification, webhook signature
checking, amount-integrity checking against the amount recorded at
initialize time, and idempotent order finalization, all persisted via
Netlify Blobs (`_store.js`). This is order/transaction-level, not
account/subscription-level — e.g. there's no current record of "this
customer's plan renews on this date" as a queryable subscription object,
just individual paid orders. That's relevant to section 5 of your prompt
(showing next renewal date, outstanding balance) — the raw payment facts
exist, but "subscription state" as a first-class concept would need to be
derived or newly modeled.

## 10. What needs to be built
- A real FleetHive customer authentication system (signup/login, password
  handling, sessions) — none exists today.
- A FleetHive backend data layer (customers, and the mapping described in
  #7/#8) — no database exists today.
- A server-side proxy layer that holds the single gpsiot.net reseller
  credential, calls the White Label API, and returns only the calling
  customer's own data — never the raw API or credential to the browser.
- The dashboard UI itself (`/dashboard`, `/dashboard/vehicles`,
  `/dashboard/payments`) and partner dashboard (`/partner/dashboard`),
  plus `/login`.
- A defined online/offline threshold and parked/moving derivation, since
  the API doesn't provide these as explicit flags (#6).
- A subscription-state view derived from (or added alongside) the existing
  order records, if you want renewal-date/outstanding-balance shown without
  rebuilding payments from scratch (#9).

## 11. What can be reused
- The entire existing site, Bree, floating UI, forms, and Paystack payment
  flow — none of this needs to change to add a dashboard.
- The existing Netlify Functions pattern (serverless, secrets only in
  `process.env`) is the right shape to extend for the White Label proxy —
  no need to introduce a different backend technology just for this.
- The existing order records in `_store.js` are a real, usable source for
  "amount paid / plan / reference" — they just weren't designed to answer
  "what's my current subscription status," so expect to add to them rather
  than replace them.

## 12. Files/components that need modification (once building starts)
- New: `netlify/functions/_whitelabel.js` (token fetch/caching + scoped
  proxy helpers), new customer-auth functions, new dashboard-data
  functions.
- New: `login.html`, `dashboard.html` (+ vehicle detail view),
  `partner-dashboard.html`, plus their JS.
- `site.js` / `bree-knowledge.js`: update the `login` CTA destination once
  `/login` exists, so Bree sends customers to FleetHive's own login instead
  of `app.fleethive.in`.
- `_store.js` or a new store module: extend/add records for customer
  accounts and the FleetHive-ID ↔ ClientID/UserID mapping.
- `SETUP.md`: document the new environment variables and setup steps once
  they're finalized.

## 13. Database changes required
None exist to "change" — this is new schema, not a migration. At minimum,
new tables/records for: customers (credentials, contact info), the
FleetHive-customer → gpsiot.net ClientID/UserID mapping, partners (with
whatever independent/dependent distinction you confirm you need — #8), and
ideally a subscription/renewal view alongside the existing order records.
Exact shape depends on what auth approach and database/storage you choose,
which hasn't been decided yet — flagging as open rather than picking one
unilaterally.

## 14. Environment variables required
New, once building starts: the gpsiot.net `WebApiKey` and `WebApiSecret`
(names TBD, e.g. `GPSIOT_API_KEY` / `GPSIOT_API_SECRET`), plus whatever a
chosen auth approach needs (e.g. a session secret). Existing variables
(`RESEND_API_KEY`, `PAYSTACK_SECRET_KEY`, `ALLOW_LIVE_PAYSTACK`, etc.) are
unaffected.

## 15. Security risks discovered
None currently, because none of this is built yet — there's nothing
exposed today since there's no dashboard, no login, and no White Label
calls anywhere in the code. The risk to actively design against, given #6:
the gpsiot.net credential is reseller-wide (not scoped per customer), so
the entire access-control burden sits on FleetHive's own backend correctly
filtering every response by the logged-in customer's `ClientID`/`UserID`
before anything reaches the browser — the API itself won't stop one
customer's request from returning another's data if the backend doesn't
filter it.

## 16. Missing information/API documentation
- Confirmation of which `ClientID`(s) on gpsiot.net correspond to FleetHive
  today (i.e., is FleetHive already using this platform live, with real
  clients/assets set up, or is this a fresh integration?).
- The actual `WebApiKey`/`WebApiSecret` credential (to be requested from
  the provider per the doc's "Getting started" section — not something I
  can generate).
- Your decision on the online/offline and parked/moving thresholds (#6).
- Your intended definition of "Independent Partner" vs "Dependent
  Partner" (#8) — the API doesn't define this, so it needs to come from
  you.
- Whether you want customer accounts built from scratch or want to explore
  whether gpsiot.net's own `Client User` login (the `UserType: 3` mentioned
  in `GetUsers`) could partially double as FleetHive's auth — worth a
  question to the provider before committing to one approach.

## 17. Recommended implementation architecture
Matches the flow in your prompt: **Customer → FleetHive website → FleetHive
auth → FleetHive backend (Netlify Functions) → White Label API (single
reseller credential, held server-side) → customer's own vehicles only**,
with the FleetHive backend as the one and only place that (a) knows the
gpsiot.net credential and (b) enforces that a customer can only ever query
their own `ClientID`/`UserID`'s assets — mirroring the pattern already
proven out in the Paystack integration (secrets only in `process.env`,
verification/filtering done server-side, browser only ever sees the
already-scoped result).

---

**Per your instructions: this is an audit only. Nothing has been built,
redesigned, or migrated. Stopping here pending your go-ahead for Prompt 2.**
