// netlify/functions/send-order.js
//
// Receives an order from pricing.html — either a Lite/Pro/Prime subscription
// order or a Tag Plan order — and emails the details to the FleetHive team.
// Used for:
//   1. Bank transfer orders ("I HAVE MADE THE TRANSFER") — status PENDING VERIFICATION
//   2. A record of successful Paystack orders (paystack-verify.js calls this
//      internally after confirming payment, so this function focuses on the
//      bank-transfer path and any order FleetHive needs to review manually)
//
// Required Netlify environment variable: RESEND_API_KEY (see SETUP.md)

const { sendEmail } = require('./_email');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let order;
  try {
    order = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!order.email && !order.phone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing email/phone' }) };
  }

  const isTagPlan = order.planType === 'tagplan';

  const rows = [
    ['Order type', isTagPlan ? 'Tag Plan' : `${order.plan || 'Subscription'} Plan`],
    ['Billing', order.billing],
    ['Payment method', order.paymentMethod],
    ['Payment status', order.paymentStatus || 'PENDING VERIFICATION'],
    ['Total amount', order.totalAmount],
    ['Full name', [order.surname, order.firstName, order.otherName].filter(Boolean).join(' ')],
    ['Phone', order.phone],
    ['WhatsApp', order.whatsapp],
    ['Email', order.email],
  ];

  if (isTagPlan) {
    rows.push(
      ['Delivery state', order.state],
      ['Delivery city', order.city],
      ['House no.', order.houseNo],
      ['Street/address', order.street],
      ['Landmark', order.landmark],
      ['Number of FleetTags', order.tagCount],
      ['Use of FleetTag', order.tagUse],
      ['Hive Credits added', order.hiveCredits],
      ['Flexible payment', order.flexiblePayment ? 'Yes (50% now, 50% over 3 months, +₦10,000 fee)' : 'No']
    );
  } else {
    rows.push(
      ['Residential address', order.address],
      ['Vehicle type', order.vehicleType],
      ['Vehicle year', order.vehicleYear],
      ['Number of vehicles', order.vehCount],
      ['Fleet deployment note', order.fleetNote],
      ['Installation city', order.installCity],
      ['Installation option', order.installOption],
      ['Installation date', order.installDate],
      ['Installation time', order.installTime],
      ['Add-ons', order.addons],
      ['Additional plans on this order', order.addedPlans],
      ['Flexible payment', order.flexiblePayment ? 'Yes' : 'No']
    );
  }

  rows.push(
    ['Paystack reference', order.reference],
    ['Date/time', order.timestamp || new Date().toLocaleString()]
  );

  const subject = `New FleetHive order — ${isTagPlan ? 'Tag Plan' : order.plan || 'Subscription'} [${
    order.paymentMethod || 'unknown method'
  }]`;

  const result = await sendEmail({ subject, rows, replyTo: order.email });
  if (!result.ok) {
    return { statusCode: result.status, body: JSON.stringify({ error: result.error }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
