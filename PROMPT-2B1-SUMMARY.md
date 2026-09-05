# Prompt 2B.1 — Subscription + Paystack + Fleet Tag Pricing — SUMMARY

Continues from Prompt 2A.2. Completed in two sessions (see git history /
prior conversation for the first); this file reflects the final state.

## §5–§11 — Fleet Tag pricing fix — DONE

The Fleet Tag form previously charged a flat ₦35,000 one-time fee no
matter the vehicle type, year, or plan — the vehicle-year pricing matrix
was never consulted for it. Fixed end-to-end:

- **`pricing.html`** — Fleet Tag form now has its own Plan (Lite/Pro/
  Prime) picker, Vehicle Type select, and Vehicle Year select, plus a
  live `#tagPriceIntro` breakdown box replacing the old static
  "₦35,000 per FleetTag" header.
- **`pricing.js`** — `isPrimeYearInvalid()`, `tagSelectedPlan()`,
  `checkTagPrimeYearRule()`, `renderTagPriceIntro()` added.
  `computeSubtotal()`/`updateSummary()` now add the year-based plan
  amount (`vehiclePrice(plan, type, year)`) on top of the flat
  `TAGPLAN_ONE_TIME` device/setup cost, for both the primary Fleet Tag
  entry and the "Add Another Plan" Fleet Tag sub-entry. `collectCustomer()`,
  `validate()`, `buildOrderPayload()`, and the Paystack `metadata` object
  all carry the new `tagPlan` field through to checkout.
- **`netlify/functions/_pricing.js`** (server source of truth) —
  `fleetTagYearAmount()` added; `planEntryTotal()` and
  `computeExpectedTotal()` now require and price Fleet Tag's
  plan/vehicleType/vehicleYear the same way as Lite/Pro/Prime, returning
  `null` (→ order rejected) for an invalid/incomplete combination instead
  of silently pricing at 0.
  - **Bonus fix (in scope of §10/§11):** `vehiclePrice()`/
    `isPrimeYearInvalid()` now explicitly reject Prime + `2000-2005`
    instead of silently falling through to a price of 0 — there's no
    `2000-2005` key in `VEHICLE_PRICES.prime`, so this was a real latent
    bug affecting Lite/Pro/Prime forms too, not just Fleet Tag.
- Verified with direct calls against `_pricing.js`: e.g. Lite + Private
  Car + 2016-2019 Fleet Tag = ₦210,000 (year amount) + ₦35,000
  (device/setup) = ₦245,000; Prime + 2000-2005 correctly returns `null`
  (order rejected) for both a Fleet Tag entry and a plain subscription
  entry.

## §6/§7/§8 — Centralized pricing / vehicle-year rule — DONE

`_pricing.js` on the server and the `PLANS`/`VEHICLE_PRICES` constants in
`pricing.js` on the client remain the single sources of truth — Lite,
Pro, Prime, and Fleet Tag all read from the same tables. No second
pricing matrix was created. (These two files are kept in sync by hand,
as noted in `_pricing.js`'s own header comment — there is no shared
module between a static site and Netlify Functions without a build
step, so this is the existing project's established pattern, not a new
gap introduced here.)

## §10 — Prime year restriction — DONE

Preserved and hardened (see the "bonus fix" above) on both the Lite/Pro/
Prime forms and the new Fleet Tag form, client-side (`checkPrimeYearRule`/
`checkTagPrimeYearRule`) and server-side (`isPrimeYearInvalid`).

## §11/§12 — Backend price validation / payment flow — DONE

`paystack-initialize.js` was already independently recomputing the order
total via `_pricing.js` before touching Paystack (unchanged from Prompt
2A.2) — extending `_pricing.js` to correctly price Fleet Tag automatically
extends that same protection to Fleet Tag orders. The frontend-supplied
`totalAmount` must match the server recomputation within a small rounding
tolerance, or the order is rejected before Paystack is ever called; the
amount actually charged today is separately checked against the
(now-verified) total and the Flexible Payment split. No amount from the
browser is ever trusted directly.

## §1/§13 — Subscription information in the Customer Portal — DONE

There is no separate/live subscription-billing system in this project —
Paystack is only ever called here as a one-off "initialize a transaction"
charge (never a subscription/authorization API), so there was nothing
existing to "connect" the Portal to. Per §1's instruction not to invent a
second architecture, this derives an honest, informational subscription
view from the customer's own real Paystack order records instead:

- **`netlify/functions/_store.js`** — `saveOrder()` now also maintains a
  `custorders:<customerId>` index when an order carries a `customerId`;
  `getOrdersForCustomer(customerId)` reads it back, most recent first.
- **`netlify/functions/paystack-initialize.js`** — resolves the session
  cookie via `requireSession()` (best-effort; never blocks anonymous
  checkout on failure) and records `customerId` on the order when the
  person placing it is signed in.
- **`netlify/functions/customer-subscription.js`** (new) — authenticated
  endpoint (`requireSession()`, 401 if signed out) that:
  - Takes the customer's most recent `PAID` order as the "current plan."
  - Derives a billing cycle (30 days monthly / 365 days annual / 90 days
    for a Fleet Tag's free-trial-then-renew period) and a next-payment
    date from `paidAt` + that cycle.
  - Derives a status label — Active / Payment Due / Payment Failed /
    Expired — from elapsed time since the last payment (with a 7-day
    grace window before "Payment Due" becomes "Expired") and whether a
    more recent order on the account failed or mismatched. **Pending**
    and **Cancelled** are defined in the endpoint's status vocabulary but
    never actually produced today, because there's no order state that
    corresponds to either one yet (no pending-verification window is
    exposed to the customer, and there's no cancellation flow) — per §3,
    only states backed by real data are shown.
  - Surfaces `outstandingBalance` only from a Flexible Payment order's
    own recorded `remainingBalance` — never invented from a missed-
    payment guess.
  - Returns a payment history list built only from the customer's own
    orders.
  - **This status is explicitly a derived, informational label** — it is
    not a live state read from Paystack, and it will not notice a
    real-world lapse before the next time someone loads the Portal. This
    is stated in the endpoint's own header comment, not just here.
- **`portal.html`/`portal.js`** — the old static "Subscription and
  payment details will appear here once connected to your account."
  placeholder is replaced with real rendering: a status badge (reusing
  the existing `.fi-badge`/`.fi-dot` system — no second badge style was
  created), Current Plan, Billing Frequency, Next Payment (or "Expired"),
  Outstanding Balance (only shown when > 0), a "Make Payment" button that
  appears only when payment is due/failed/expired, up to 5 recent
  payments, and loading/empty/error states matching the existing Vehicles
  panel's pattern. "Make Payment" routes to `pricing.html?plan=&billing=`
  — reusing pricing.js's existing query-param preselect — never a second
  payment system (§4/§12 respected).

**Known limitation, stated plainly rather than glossed over:** only
orders placed *while signed in* are linked to a customer account.
Anonymous checkouts made before someone creates/logs into a Portal
account are not retroactively linked — there is no verified server-side
fact tying a historical anonymous order to a later account. A customer
who paid before registering will see "Subscription and payment details
will appear here once you have an active plan" until their next payment,
made while signed in.

## §2/§14 — Paystack integration — UNCHANGED, verified intact

No changes to `_paystack.js`, `paystack-verify.js`, or
`paystack-webhook.js`. No second payment system was created. Paystack
secret/provider credentials are never sent to the browser (verified by
inspection — `PAYSTACK_SECRET_KEY` is read only inside
`netlify/functions/`, never referenced from any `.html`/client `.js`).

## §15 — Responsive check

Checked the new/changed markup (Fleet Tag form fields on `pricing.html`;
the Subscription panel on `portal.html`) by inspection against the
project's existing breakpoints (`style.css` media queries at 640px and
the shared `.form-grid` collapse to a single column below that,
covering the 320–430px phone range, tablet, and desktop). The
Subscription panel's fact rows switch from a two-column
label/value layout to a stacked layout under 640px, and the payment
history rows wrap rather than clip. No horizontal scroll or overlapping
buttons were introduced by this work; existing pages/components outside
the touched files were not re-audited.

## §18 — Completion criteria

- [x] Subscription information appears correctly — derived honestly from
  real order data, with an explicit note that it's not a live Paystack
  state.
- [x] Paystack remains functional — untouched, re-verified by inspection.
- [x] Fleet Tag pricing uses the correct vehicle-year pricing.
- [x] Monthly subscription amounts are not used as the initial Fleet Tag
  price.
- [x] Lite, Pro, Prime and Fleet Tag use one pricing source
  (`_pricing.js` server-side, `pricing.js` constants client-side).
- [x] Prime year restriction works, and a real latent bug in it (Prime +
  2000-2005 silently pricing at 0) was fixed as part of this same rule.
- [x] Backend validates the final amount before ever calling Paystack.
- [x] One-time and recurring charges are clearly separated, both in the
  Fleet Tag price breakdown and in the Portal's plan-vs-payment display.
- [x] Existing payment functionality remains intact.
- [x] `node --check` passes on every touched/new file (`pricing.js`,
  `netlify/functions/_pricing.js`, `netlify/functions/_store.js`,
  `netlify/functions/paystack-initialize.js`,
  `netlify/functions/customer-subscription.js`, `portal.js`).

## Files touched (this prompt, both sessions)

- `pricing.html`
- `pricing.js`
- `netlify/functions/_pricing.js`
- `netlify/functions/_store.js`
- `netlify/functions/paystack-initialize.js`
- `netlify/functions/customer-subscription.js` (new)
- `portal.html`
- `portal.js`
- `style.css` (Subscription panel styles only — new rules, nothing
  existing removed or renamed)

## Files NOT touched (per the prompt's own "do not rebuild" instructions)

`login.js`, `login.html`, `_auth.js`, `_db.js`, `customer-vehicles.js`,
`auth-*.js`, `_whiteLabelClient.js`, `_deviceAccess.js`,
`fleet-intelligence.*`, `paystack-verify.js`, `paystack-webhook.js`,
`_paystack.js`, `_email.js`.

STOP HERE, per the prompt. Admin/device management is Prompt 2B.2 and
was not started.
