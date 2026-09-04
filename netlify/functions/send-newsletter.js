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

const { sendEmail, sendWelcomeEmail } = require('./_email');

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

  const subject = `New FleetHive newsletter signup — ${entry.name || entry.email}`;
  const rows = [
    ['Name', entry.name],
    ['Email', entry.email],
    ['Page', entry.page],
    ['Date/time', entry.timestamp || new Date().toLocaleString()],
  ];

  const result = await sendEmail({
    subject,
    rows,
    replyTo: entry.email,
    intro: 'Captured via the FleetHive exit-intent newsletter popup.',
    toEmail: process.env.NEWSLETTER_TO_EMAIL || process.env.LEAD_TO_EMAIL || 'support@fleethive.in',
  });

  if (!result.ok) {
    return { statusCode: result.status, body: JSON.stringify({ error: result.error }) };
  }

  // Best-effort welcome email back to the subscriber. This is separate from
  // the internal notification above, so a hiccup here (bad address, Resend
  // blip, etc.) never fails the signup itself — the person already
  // successfully subscribed as far as the site and the team are concerned.
  try {
    const welcome = await sendWelcomeEmail({ toEmail: entry.email, name: entry.name });
    if (!welcome.ok) {
      console.error('Newsletter welcome email failed:', welcome.error);
    }
  } catch (e) {
    console.error('Newsletter welcome email threw:', e);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
