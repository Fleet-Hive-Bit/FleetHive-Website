# FleetHive — Backend Setup

This covers every Netlify Function used across the site: Bree's lead
capture, the Pricing page order/payment flow (Paystack + Bank Transfer),
and the Contact / Become a Partner forms.

## Functions overview

| Function | Purpose | Required env vars |
|---|---|---|
| `send-lead.js` | Bree chat → emails a captured lead | `RESEND_API_KEY` |
| `send-order.js` | Pricing page → emails a subscription/Tag Plan order (used for Bank Transfer confirmations) | `RESEND_API_KEY` |
| `send-contact.js` | Contact page form | `RESEND_API_KEY` |
| `send-partner.js` | Become a Partner form | `RESEND_API_KEY` |
| `paystack-initialize.js` | Starts a Paystack transaction server-side | `PAYSTACK_SECRET_KEY` |
| `paystack-verify.js` | Confirms a Paystack transaction server-side (called by the browser after redirect), then emails an order confirmation | `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY` |
| `paystack-webhook.js` | Same confirmation, triggered server-to-server by Paystack instead of the browser — the reliable fallback if a customer closes their tab before the redirect completes | `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY` |
| `_paystack.js` | Shared helper: test-mode guard, webhook signature check, transaction verification, and the idempotent "finalize" logic used by both `paystack-verify.js` and `paystack-webhook.js` | — |
| `_pricing.js` | Server-side mirror of FleetHive's pricing table, used by `paystack-initialize.js` to independently recompute and verify the order total instead of trusting the browser's number | — |
| `_store.js` | Persists each order (reference, amount, status, plan/customer metadata) using Netlify Blobs, and makes verification idempotent | — (Netlify Blobs needs no setup/keys) |

All of the email-sending functions share one helper, `_email.js`, so the
Resend integration only needed to be written once.

**None of this is required for the site to work.** Every form falls back to
a pre-filled `mailto:` link (or a clear on-screen message) if its function
isn't reachable or isn't configured yet — the same pattern Bree already
uses. Bank Transfer and Paystack simply won't be able to collect/verify
payment automatically until the relevant keys are added below.

---

## Part A — Email (Bree, orders, contact, partner forms)

This makes Bree actually send leads to support@fleethive.in automatically,
instead of just opening a pre-filled email draft.

It works using a **Netlify Function** — a small server-side script that runs
on Netlify's infrastructure. Your email API key lives only there, as an
environment variable. It is never present in the HTML/CSS/JS that ships to
the browser, so nobody can find it by viewing page source or dev tools.

Files involved:
- `netlify/functions/send-lead.js` — the serverless function that sends the email
- `netlify.toml` — tells Netlify where to find the function
- `site.js` — Bree now calls this function via `fetch()`, and only falls back
  to opening a `mailto:` draft if the function is unreachable or not set up yet

---

## 1. Create a Resend account (free)

Resend (https://resend.com) is the email-sending service the function uses.
Free tier is generous (100 emails/day, 3,000/month) — plenty for lead capture.

1. Go to resend.com → sign up
2. Once logged in, go to **API Keys** → **Create API Key**
3. Copy the key (starts with `re_...`) — you'll need it in step 3

You can start sending immediately using Resend's shared test sender
(`onboarding@resend.dev`) — good enough to get this working today. When
you're ready for a proper "from" address (e.g. `leads@fleethive.in`), verify
your domain in Resend under **Domains** — takes a few DNS records and
Resend walks you through it.

## 2. Deploy the site to Netlify with the function included

If you haven't already:

1. Push this whole folder (including `netlify/` and `netlify.toml`) to a
   GitHub repository
2. In Netlify: **Add new site → Import an existing project** → connect the repo
3. Build settings: leave as default (no build command needed — it's static
   files + one function). Netlify auto-detects `netlify.toml`.

(If you're still doing the drag-and-drop deploy instead of connecting
GitHub: drag-and-drop **does not support Netlify Functions**. You'll need to
connect a GitHub repo for this part specifically — it's a one-time setup.)

## 3. Add your API key as an environment variable

In the Netlify dashboard for your site:

1. **Site configuration → Environment variables → Add a variable**
2. Add:
   - Key: `RESEND_API_KEY`
   - Value: the `re_...` key from step 1
3. (Optional) Also add:
   - `LEAD_TO_EMAIL` → defaults to `support@fleethive.in` if you don't set this
   - `LEAD_FROM_EMAIL` → e.g. `FleetHive Leads <leads@fleethive.in>` once
     you've verified your domain in Resend. Until then, leave unset — it
     defaults to Resend's shared test sender.
   - `SITE_URL` → your production URL (e.g. `https://fleethive.in` or your
     `https://your-site.netlify.app` address). All outgoing emails include
     the FleetHive logo, loaded from `${SITE_URL}/assets/logo.png` — email
     clients can't reach a `localhost` path, so this must point at your
     live, publicly reachable site. Defaults to `https://fleethive.in` if
     you don't set it.
   - `EMAIL_LOGO_URL` → only needed if the logo lives somewhere other than
     `${SITE_URL}/assets/logo.png` (e.g. a CDN). Overrides `SITE_URL` for
     the logo specifically.
4. Trigger a redeploy (Netlify → Deploys → Trigger deploy) so the function
   picks up the new variable.

## 4. Test it

1. Open your live site, click Bree, go through a lead capture flow
2. Check the inbox for `support@fleethive.in` (or whatever `LEAD_TO_EMAIL` is)
3. If something's wrong, check **Netlify → Functions → send-lead → Logs** —
   errors (bad API key, Resend rejecting the request, etc.) show up there

## What happens if it's not set up yet

Bree still works completely fine — if the function call fails (not deployed
yet, API key missing, Resend error), she tells the visitor she couldn't
reach the server and hands them a ready-to-send `mailto:` link instead.
Nothing breaks; it just falls back to the manual path.

## Swapping Resend for something else

If you'd rather use SendGrid, Postmark, AWS SES, or plain SMTP, only
`netlify/functions/_email.js` needs to change — every other function
(`send-lead`, `send-order`, `send-contact`, `send-partner`, `paystack-verify`)
calls into it, and the frontend/fallback behavior stays the same either way.

---

## Part B — Payments (Paystack, on the Pricing page)

The Pricing page (`pricing.html`) lets a visitor pay for a Lite/Pro/Prime
subscription or a Tag Plan order using Paystack or Bank Transfer.

### How the Paystack flow works

1. Visitor fills in the order form and clicks **Proceed to Payment**.
2. The browser calls `paystack-initialize.js`, which talks to Paystack's
   API using your **secret key** (never exposed to the browser) and gets
   back a checkout URL.
3. The browser is redirected to Paystack's hosted checkout.
4. After payment, Paystack redirects back to `pricing.html?...&reference=...`.
5. The page calls `paystack-verify.js`, which asks Paystack directly
   whether that reference was actually paid, and only then shows
   "Payment Successful". The frontend redirect is never trusted on its own.
6. On a verified success, `paystack-verify.js` also emails an order
   confirmation to the team via Resend (Part A).

### Setup steps — TEST MODE

This integration is currently locked to **test mode only**. `_paystack.js`
actively refuses to run if it sees a live secret key (`sk_live_...`) unless
you also set `ALLOW_LIVE_PAYSTACK=true` — so there's no way to accidentally
take real payments before you're ready.

1. Create a Paystack account at https://paystack.com and go to
   **Settings → API Keys & Webhooks**.
2. Copy your **Test Secret Key** (starts with `sk_test_`).
3. In Netlify: **Site configuration → Environment variables → Add a variable**
   - Key: `PAYSTACK_SECRET_KEY` — Value: your `sk_test_...` key
   - (Do **not** add your live key yet — see "Going live" below.)
4. In Netlify: **Site configuration → Environment variables**, confirm
   `RESEND_API_KEY` is also set (Part A) so order-confirmation emails send.
5. Trigger a redeploy so the functions pick up the new variables.

### Set up the webhook (recommended, not optional)

1. In your Paystack dashboard: **Settings → API Keys & Webhooks → Webhook URL**
2. Set it to:
   `https://YOUR-SITE.netlify.app/.netlify/functions/paystack-webhook`
3. Paystack will send a `charge.success` event here whenever a payment
   completes — server-to-server, independent of whether the customer's
   browser makes it back to the success page. `paystack-webhook.js` checks
   the request's signature, re-verifies the transaction directly with
   Paystack, and records/confirms the order exactly like the redirect
   path does (they share logic and won't double-process the same
   reference or double-send the confirmation email).

### How to run a test payment

1. On the deployed site, go to **Pricing**, pick a plan, fill in the order
   form, choose **Pay with Paystack**.
2. You'll land on Paystack's real test checkout page. Use one of
   [Paystack's test cards](https://paystack.com/docs/payments/test-payments/)
   — e.g. card `4084084084084081`, any future expiry, CVV `408`, PIN `0000`,
   OTP `123456`.
3. You'll be redirected back to the Pricing page, which calls
   `paystack-verify.js` and shows "Payment Successful" only once that's
   confirmed server-side.
4. Check: the `support@fleethive.in` inbox (or `LEAD_TO_EMAIL`) for the
   "✅ Paid" confirmation email, and **Netlify → Functions → Logs** for
   `paystack-verify` and `paystack-webhook` to see both confirmations land.
5. Try a failed/cancelled test card too, and confirm the pricing page shows
   the "Payment Not Confirmed" state rather than marking anything active.

### Going live (when you're ready — not yet)

1. Swap `PAYSTACK_SECRET_KEY` to your `sk_live_...` key.
2. Also set `ALLOW_LIVE_PAYSTACK=true` — the functions will refuse the live
   key without this, on purpose.
3. Update the webhook URL in Paystack's dashboard if you switched from a
   test app to a live one.
4. Redeploy, then do one small real payment yourself to confirm end-to-end
   before promoting it.

### Order storage

There's no separate database in this project — before this update, a
"paid order" only existed as the confirmation email. `_store.js` now also
persists every transaction (reference, expected amount, paid amount,
status, plan/customer metadata) in **Netlify Blobs**, a key/value store
built into Netlify with no separate account or service to set up — it's
what makes the redirect-confirmation and the webhook-confirmation safe to
both fire for the same payment without double-activating anything. If you
later want a proper admin view of orders (not just email + Blobs), that's
a further step — flag it and we can add a simple orders list page.

**Amount integrity:** the browser is never trusted with the final price.
`paystack-initialize.js` independently recomputes the full order total
server-side, from the structured selections the browser sends (plan,
vehicle type/year/count, add-on ids, Tag count, added plans, Hive
Credits), using `netlify/functions/_pricing.js` — a server-side mirror of
the pricing table in `pricing.js`. If the browser's self-reported total
doesn't match what FleetHive's own price list says it should be, checkout
is rejected before Paystack is ever contacted. It then separately checks
that the amount being charged today correctly reflects that (now-verified)
total and the Flexible Payment split (50% today, or the full total
otherwise). Finally, `paystack-verify.js` / `paystack-webhook.js` compare
what Paystack confirms was actually paid against what was asked for at
initialize time, and refuse to mark the order PAID/ACTIVE (emailing the
team an alert instead) if they don't match.

**Keeping prices in sync:** `_pricing.js` duplicates the price constants
at the top of `pricing.js` (plan prices, vehicle/device prices, add-on
prices, Tag Plan cost) so it can check the browser's numbers without
trusting the browser's arithmetic. If you ever change a price in
`pricing.js`, make the same change in `_pricing.js` — otherwise checkout
will start rejecting genuine orders as a "mismatch."

### Bank Transfer

Bank Transfer needs no extra setup — it already shows FleetHive's account
details and, when the visitor clicks **I Have Made the Transfer**, submits
their order to `send-order.js` (Part A) with status `PENDING VERIFICATION`
for your team to confirm manually.
