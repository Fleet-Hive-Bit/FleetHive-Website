// netlify/functions/_email.js
//
// Shared helper for sending emails via Resend (https://resend.com).
// Used by send-lead.js, send-order.js, send-contact.js, send-partner.js,
// send-newsletter.js and paystack-verify.js so the Resend call logic and
// the FleetHive email template live in one place.
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
// with the site's navy + sky-blue identity.
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

// intro (optional): a short plain-English paragraph shown above the details
// table — used for customer-facing emails ("Thanks for your order...").
// Internal team notifications omit it and just get the raw details table.
async function sendEmail({ subject, rows, replyTo, toEmail, intro }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set in Netlify environment variables');
    return { ok: false, status: 500, error: 'Email service not configured' };
  }

  const to = toEmail || process.env.LEAD_TO_EMAIL || 'support@fleethive.in';
  const from = process.env.LEAD_FROM_EMAIL || 'FleetHive <onboarding@resend.dev>';

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

  const htmlBody = `
  <div style="background:#EDF3FC;padding:28px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
      <div style="background:${BRAND.navyDeep};background-image:linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navyDeep} 100%);padding:26px 28px;text-align:left;">
        <img src="${LOGO_URL}" alt="FleetHive" width="34" height="34" style="display:inline-block;vertical-align:middle;border-radius:8px;">
        <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">FLEET<span style="color:${BRAND.sky};">HIVE</span></span>
      </div>
      <div style="padding:28px;">
        <h2 style="color:${BRAND.navy};font-size:19px;margin:0 0 14px;">${escapeHtml(subject)}</h2>
        ${intro ? `<p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 18px;">${escapeHtml(intro)}</p>` : ''}
        <table style="border-collapse:collapse;width:100%;font-size:14px;">${htmlRows}</table>
      </div>
      <div style="background:#F8FAFC;padding:18px 28px;border-top:1px solid #E2E8F0;">
        <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">Sent automatically from the FleetHive website.</p>
        <p style="color:${BRAND.textMuted};font-size:12px;margin:6px 0 0;">FleetHive &middot; support@fleethive.in</p>
      </div>
    </div>
  </div>
  `;

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
        text: textBody,
        html: htmlBody,
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
    console.error('sendEmail failed:', err);
    return { ok: false, status: 500, error: 'Unexpected server error' };
  }
}

module.exports = { sendEmail };
