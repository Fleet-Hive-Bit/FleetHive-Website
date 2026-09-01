// netlify/functions/send-partner.js
//
// Handles partner applications from partners.html and emails them to the
// FleetHive team. Required Netlify environment variable: RESEND_API_KEY
// (see SETUP.md)

const { sendEmail } = require('./_email');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let app;
  try {
    app = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const fullName = app.name || [app.surname, app.firstName, app.otherName].filter(Boolean).join(' ');

  if (!fullName || !app.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing name/email' }) };
  }

  const isPaymentUpdate = !!app.paymentUpdate;

  const rows = [
    ['Application status', app.applicationStatus || 'PENDING REVIEW'],
    ['Full name', fullName],
    ['Business name', app.businessName],
    ['Business registration status', app.businessStatus],
    ['Partnership type', app.partnershipType],
    ['Payment option (Independent Sub-seller only)', app.paymentOption],
    ['Phone', app.phone],
    ['WhatsApp', app.whatsapp],
    ['Email', app.email],
    ['City / State', app.location],
    ['Operating location', app.operatingLocation],
    ['Works with tracking devices?', app.worksWithTracking],
    ['Years of experience', app.yearsExperience],
    ['Estimated vehicles per month', app.vehiclesPerMonth],
    ['Has installers?', app.hasInstallers],
    ['Message', app.message],
  ];

  if (isPaymentUpdate) {
    rows.push(
      ['Payment method', app.paymentMethod],
      ['Payment status', app.paymentStatus],
      ['Amount due', app.amountDue]
    );
  }

  rows.push(['Date/time', app.timestamp || new Date().toLocaleString()]);

  const subject = isPaymentUpdate
    ? `FleetHive partner payment update — ${fullName} [${app.paymentMethod || 'unknown method'}]`
    : `New FleetHive partner application — ${fullName} (${app.partnershipType || 'type not selected'})`;

  const result = await sendEmail({
    subject,
    rows,
    replyTo: app.email,
  });

  if (!result.ok) {
    return { statusCode: result.status, body: JSON.stringify({ error: result.error }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
