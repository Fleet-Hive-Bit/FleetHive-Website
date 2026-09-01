// netlify/functions/_email.js
//
// Shared helper for sending emails via Resend (https://resend.com).
// Used by send-lead.js, send-order.js, send-contact.js, send-partner.js
// and paystack-verify.js so the Resend call logic lives in one place.
//
// Required Netlify environment variable:
//   RESEND_API_KEY
// Optional:
//   LEAD_TO_EMAIL   — defaults to support@fleethive.in
//   LEAD_FROM_EMAIL — defaults to Resend's shared test sender

async function sendEmail({ subject, rows, replyTo, toEmail }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set in Netlify environment variables');
    return { ok: false, status: 500, error: 'Email service not configured' };
  }

  const to = toEmail || process.env.LEAD_TO_EMAIL || 'support@fleethive.in';
  const from = process.env.LEAD_FROM_EMAIL || 'FleetHive <onboarding@resend.dev>';

  const textBody = rows.map(([k, v]) => `${k}: ${v || 'Not provided'}`).join('\n');

  const htmlRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#64748B;font-weight:600;white-space:nowrap;">${k}</td><td style="padding:6px 12px;">${
          v || 'Not provided'
        }</td></tr>`
    )
    .join('');

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:560px;">
      <h2 style="color:#0D2137;">${subject}</h2>
      <table style="border-collapse:collapse;width:100%;">${htmlRows}</table>
      <p style="color:#94A3B8;font-size:12px;margin-top:16px;">Sent automatically from the FleetHive website.</p>
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
