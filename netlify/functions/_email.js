// netlify/functions/_email.js
//
// Shared helper for sending emails via Resend (https://resend.com).
// Used by send-lead.js, send-order.js, send-contact.js, send-partner.js,
// send-newsletter.js and _paystack.js (payment confirmation/mismatch
// emails) so the Resend call logic and the FleetHive email template live
// in one place.
//
// Prompt 1B: this file previously built two separate copies of the same
// branded HTML shell — one inside sendEmail(), one inside
// sendWelcomeEmail(). They're now both thin wrappers around a single
// renderBrandedEmail() template (below), so there is exactly one place
// that defines what a FleetHive email looks like. sendEmail and
// sendWelcomeEmail keep their existing signatures, so every function that
// already calls them (send-lead, send-order, send-contact, send-partner,
// send-newsletter, _paystack) picks up the change automatically — nothing
// else needed to be touched.
//
// Required Netlify environment variable:
//   RESEND_API_KEY
// Optional:
//   LEAD_TO_EMAIL   — defaults to support@fleethive.in
//   LEAD_FROM_EMAIL — defaults to Resend's shared test sender
//   SITE_URL        — the public URL FleetHive is deployed at (e.g.
//                      https://fleethive.in or https://your-site.netlify.app).
//                      Used to build a publicly reachable logo URL for email
//                      clients, since a localhost/dev path can never render
//                      in a recipient's inbox. Defaults to https://fleethive.in.
//   EMAIL_LOGO_URL  — full override if the logo lives somewhere else
//                      (skips SITE_URL entirely).

const DEFAULT_SITE_URL = 'https://fleethive.in';
const LOGO_URL = process.env.EMAIL_LOGO_URL
  || `${(process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '')}/assets/logo.png`;

// FleetHive brand colors, kept in one place so every email stays consistent
// with the site's navy + sky-blue identity. This is the official FleetHive
// logo/mark already used across the site (assets/logo.png) — nothing here
// generates a new logo or references the white-label provider's branding.
const BRAND = {
  navyDeep: '#081826',
  navy: '#0D2137',
  sky: '#6FA3F0',
  border: '#1E3A54',
  textMuted: '#94A3B8',
};

// Escapes a value before it's interpolated into the HTML email body.
// Customer-supplied fields (name, message, address, etc.) flow straight
// into these emails from public forms — without this, someone could
// submit HTML/script markup as their "name" or "message" and have it
// render in the FleetHive team's or their own inbox. Values shown in the
// plain-text body don't need this — only the HTML version is at risk.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// ---------------------------------------------------------------------
// The single reusable FleetHive transactional email template.
//
//   heading   — the H2 shown under the logo bar
//   bodyHtml  — pre-escaped/pre-built HTML for the message body (a rows
//               table, paragraphs, whatever the caller needs) — callers
//               are responsible for escaping any user-supplied text they
//               put in here, same as before
//   ctaText / ctaUrl (optional) — renders a single branded button
//   footerNote (optional) — replaces the default footer line, e.g. for
//               subscriber-facing emails that need unsubscribe wording
// ---------------------------------------------------------------------
function renderBrandedEmail({ heading, bodyHtml, ctaText, ctaUrl, footerNote }) {
  const cta = ctaText && ctaUrl
    ? `<div style="margin:22px 0 4px;">
         <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND.sky};color:${BRAND.navyDeep};font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;text-decoration:none;">${escapeHtml(ctaText)}</a>
       </div>`
    : '';

  return `
  <div style="background:#EDF3FC;padding:28px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
      <div style="background:${BRAND.navyDeep};background-image:linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navyDeep} 100%);padding:26px 28px;text-align:left;">
        <img src="${LOGO_URL}" alt="FleetHive" width="34" height="34" style="display:inline-block;vertical-align:middle;border-radius:8px;">
        <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">FLEET<span style="color:${BRAND.sky};">HIVE</span></span>
      </div>
      <div style="padding:28px;">
        <h2 style="color:${BRAND.navy};font-size:19px;margin:0 0 14px;">${escapeHtml(heading)}</h2>
        ${bodyHtml}
        ${cta}
      </div>
      <div style="background:#F8FAFC;padding:18px 28px;border-top:1px solid #E2E8F0;">
        ${footerNote || `<p style="color:${BRAND.textMuted};font-size:12px;margin:0;">Sent automatically from the FleetHive website.</p>
        <p style="color:${BRAND.textMuted};font-size:12px;margin:6px 0 0;">FleetHive &middot; support@fleethive.in</p>`}
      </div>
    </div>
  </div>
  `;
}

async function callResend({ from, to, subject, text, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set in Netlify environment variables');
    return { ok: false, status: 500, error: 'Email service not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
        reply_to: replyTo || undefined,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend API error:', res.status, errText);
      return { ok: false, status: 502, error: 'Email provider rejected the request' };
    }
    return { ok: true, status: 200 };
  } catch (err) {
    console.error('Resend send failed:', err);
    return { ok: false, status: 500, error: 'Unexpected server error' };
  }
}

// Generic entry point for any FleetHive transactional email — used by
// sendEmail/sendWelcomeEmail below, and available directly for future
// flows (e.g. payment receipts) that want the branded template without
// the "rows table" shape sendEmail() assumes.
async function sendBrandedEmail({ toEmail, subject, heading, bodyHtml, bodyText, ctaText, ctaUrl, footerNote, replyTo, fromEmail }) {
  if (!toEmail) return { ok: false, status: 400, error: 'Missing recipient email' };
  const from = fromEmail || process.env.LEAD_FROM_EMAIL || 'FleetHive <onboarding@resend.dev>';
  const html = renderBrandedEmail({ heading, bodyHtml, ctaText, ctaUrl, footerNote });
  return callResend({ from, to: toEmail, subject, text: bodyText, html, replyTo });
}

// intro (optional): a short plain-English paragraph shown above the details
// table — used for customer-facing emails ("Thanks for your order...").
// Internal team notifications omit it and just get the raw details table.
async function sendEmail({ subject, rows, replyTo, toEmail, intro }) {
  const to = toEmail || process.env.LEAD_TO_EMAIL || 'support@fleethive.in';

  const textBody =
    (intro ? intro + '\n\n' : '') + rows.map(([k, v]) => `${k}: ${v || 'Not provided'}`).join('\n');

  const htmlRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#64748B;font-weight:600;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:6px 12px;">${
          v ? escapeHtml(v) : 'Not provided'
        }</td></tr>`
    )
    .join('');

  const bodyHtml = `
    ${intro ? `<p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 18px;">${escapeHtml(intro)}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;font-size:14px;">${htmlRows}</table>
  `;

  return sendBrandedEmail({ toEmail: to, subject, heading: subject, bodyHtml, bodyText: textBody, replyTo });
}

// sendWelcomeEmail: a warm, subscriber-facing confirmation — distinct from
// sendEmail's internal "here's a new lead" notification table. This is the
// email the *subscriber themselves* receives after signing up, so the copy
// is narrative/welcoming rather than a data table.
async function sendWelcomeEmail({ toEmail, name }) {
  if (!toEmail) return { ok: false, status: 400, error: 'Missing recipient email' };

  const greetingName = name ? escapeHtml(name).split(' ')[0] : null;
  const subject = "You're subscribed to the FleetHive newsletter";
  const heading = greetingName ? `Welcome, ${greetingName}!` : "You're on the list!";

  const textBody =
    `${greetingName ? `Hi ${greetingName},` : 'Hi there,'}\n\n` +
    `Thanks for subscribing to the FleetHive newsletter. You're now on the list for product updates, ` +
    `new features and useful tips on getting the most out of your vehicle tracking.\n\n` +
    `We'll only reach out when we have something worth your time. If you ever want to stop receiving ` +
    `these emails, just reply and let us know.\n\n` +
    `Talk soon,\nThe FleetHive Team`;

  const bodyHtml = `
    <p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 14px;">
      Thanks for subscribing to the FleetHive newsletter. You're now in the loop for product updates,
      new features, and practical tips on getting more out of your vehicle tracking.
    </p>
    <p style="color:#334155;font-size:14px;line-height:1.7;margin:0 0 14px;">
      We'll only reach out when we have something genuinely useful to share &mdash; no spam, no noise.
    </p>
    <p style="color:#334155;font-size:14px;line-height:1.7;margin:0;">
      Talk soon,<br>The FleetHive Team
    </p>
  `;

  const footerNote = `<p style="color:${BRAND.textMuted};font-size:12px;margin:0;">You're receiving this because you subscribed at fleethive.in.</p>
        <p style="color:${BRAND.textMuted};font-size:12px;margin:6px 0 0;">Didn't sign up, or want to stop? Just reply to this email. &middot; FleetHive &middot; support@fleethive.in</p>`;

  return sendBrandedEmail({
    toEmail,
    subject,
    heading,
    bodyHtml,
    bodyText: textBody,
    footerNote,
    replyTo: process.env.LEAD_TO_EMAIL || 'support@fleethive.in',
  });
}

module.exports = { sendEmail, sendWelcomeEmail, sendBrandedEmail };
