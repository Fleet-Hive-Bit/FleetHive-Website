// netlify/functions/send-newsletter.js
//
// Receives a "Stay in the FleetHive Network" signup from the exit-intent
// popup and emails it to the FleetHive team via Resend, following the same
// pattern as send-lead.js.
//
// Required Netlify environment variable:
//   RESEND_API_KEY
//
// Optional environment variables:
//   NEWSLETTER_TO_EMAIL — defaults to support@fleethive.in
//   LEAD_FROM_EMAIL      — shared "from" sender used across FleetHive functions

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let entry;
  try {
    entry = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!entry.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing email' }) };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set in Netlify environment variables');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  const toEmail = process.env.NEWSLETTER_TO_EMAIL || 'support@fleethive.in';
  const fromEmail = process.env.LEAD_FROM_EMAIL || 'FleetHive Leads <onboarding@resend.dev>';

  const subject = `New FleetHive newsletter signup — ${entry.name || entry.email}`;

  const textBody =
    `Name: ${entry.name || 'Not provided'}\n` +
    `Email: ${entry.email}\n` +
    `Page: ${entry.page || 'Not provided'}\n` +
    `Date/time: ${entry.timestamp || new Date().toLocaleString()}\n\n` +
    `Captured via the FleetHive exit-intent newsletter popup.`;

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:480px;">
      <h2 style="color:#0D2137;">New FleetHive newsletter signup</h2>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:6px 12px;color:#64748B;font-weight:600;">Name</td><td style="padding:6px 12px;">${entry.name || 'Not provided'}</td></tr>
        <tr><td style="padding:6px 12px;color:#64748B;font-weight:600;">Email</td><td style="padding:6px 12px;">${entry.email}</td></tr>
        <tr><td style="padding:6px 12px;color:#64748B;font-weight:600;">Page</td><td style="padding:6px 12px;">${entry.page || 'Not provided'}</td></tr>
      </table>
      <p style="color:#94A3B8;font-size:12px;margin-top:16px;">Captured via the FleetHive exit-intent newsletter popup.</p>
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
        from: fromEmail,
        to: [toEmail],
        subject,
        text: textBody,
        html: htmlBody,
        reply_to: entry.email,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend API error:', res.status, errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'Email provider rejected the request' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('send-newsletter function failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error' }) };
  }
};
