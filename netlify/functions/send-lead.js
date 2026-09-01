// netlify/functions/send-lead.js
//
// Receives a lead captured by Bree (FleetHive's assistant) and emails it to
// support@fleethive.in via Resend (https://resend.com). The Resend API key
// lives only here, as a Netlify environment variable — it is never sent to
// the browser, so it can't be read from the page source or dev tools.
//
// Required Netlify environment variable:
//   RESEND_API_KEY   — your Resend API key (see SETUP.md)
//
// Optional environment variables:
//   LEAD_TO_EMAIL    — defaults to support@fleethive.in
//   LEAD_FROM_EMAIL  — the "from" address Resend sends as (must be a
//                      domain you've verified in Resend, or their shared
//                      test sender while you're setting things up)

exports.handler = async function (event) {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let lead;
  try {
    lead = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Basic validation — refuse empty/garbage submissions
  if (!lead.name && !lead.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing name/email' }) };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set in Netlify environment variables');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email service not configured' }) };
  }

  const toEmail = process.env.LEAD_TO_EMAIL || 'support@fleethive.in';
  const fromEmail = process.env.LEAD_FROM_EMAIL || 'FleetHive Leads <onboarding@resend.dev>';

  const subject = `New FleetHive lead — ${lead.name || 'Website visitor'} [${lead.intent || 'UNKNOWN'}]`;

  const rows = [
    ['Name', lead.name],
    ['Location', lead.location],
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Fleet size', lead.fleetSize],
    ['Vehicle type', lead.vehicleType],
    ['Customer type', lead.customerType],
    ['Primary problem', lead.primaryProblem],
    ['Partnership interest', lead.partnership ? 'Yes' : 'No'],
    ['Recommended plan/action', lead.recommended],
    ['Lead intent', lead.intent],
    ['Date/time', lead.timestamp || new Date().toLocaleString()],
  ];

  const textBody =
    rows.map(([k, v]) => `${k}: ${v || 'Not provided'}`).join('\n') +
    '\n\nCaptured via Bree on the FleetHive homepage.';

  const htmlRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#64748B;font-weight:600;">${k}</td><td style="padding:6px 12px;">${
          v || 'Not provided'
        }</td></tr>`
    )
    .join('');

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:520px;">
      <h2 style="color:#0D2137;">New FleetHive lead</h2>
      <table style="border-collapse:collapse;width:100%;">${htmlRows}</table>
      <p style="color:#94A3B8;font-size:12px;margin-top:16px;">Captured via Bree on the FleetHive homepage.</p>
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
        reply_to: lead.email || undefined,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend API error:', res.status, errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'Email provider rejected the request' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('send-lead function failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected server error' }) };
  }
};
