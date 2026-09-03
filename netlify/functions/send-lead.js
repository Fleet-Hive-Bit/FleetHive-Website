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

const { sendEmail } = require('./_email');

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

  const result = await sendEmail({
    subject,
    rows,
    replyTo: lead.email,
    intro: 'Captured via Bree on the FleetHive homepage.',
  });

  if (!result.ok) {
    return { statusCode: result.status, body: JSON.stringify({ error: result.error }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
