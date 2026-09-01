// netlify/functions/send-contact.js
//
// Handles submissions from contact.html and emails them to the FleetHive team.
// Required Netlify environment variable: RESEND_API_KEY (see SETUP.md)

const { sendEmail } = require('./_email');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let msg;
  try {
    msg = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!msg.name || !msg.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing name/email' }) };
  }

  const rows = [
    ['Name', msg.name],
    ['Email', msg.email],
    ['Phone', msg.phone],
    ['Subject', msg.subject],
    ['Message', msg.message],
    ['Date/time', msg.timestamp || new Date().toLocaleString()],
  ];

  const result = await sendEmail({
    subject: `New FleetHive contact form message — ${msg.name}`,
    rows,
    replyTo: msg.email,
  });

  if (!result.ok) {
    return { statusCode: result.status, body: JSON.stringify({ error: result.error }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
