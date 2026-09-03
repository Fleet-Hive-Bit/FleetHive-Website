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
  const flexLabel = order.flexiblePayment
    ? `Yes — ${order.amountDueNow || '50% due now'} today, then ${order.monthlyInstallment || 'remaining balance'}/month for ${order.remainingMonths || 3} months (remaining balance: ${order.remainingBalance || '—'})`
    : 'No';

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
      ['Subscription option', order.billing],
      ['Hive Credits added', order.hiveCredits],
      ['Flexible payment', flexLabel]
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
      ['Flexible payment', flexLabel]
    );
  }

  rows.push(
    ['Location', [order.city || order.installCity, order.state].filter(Boolean).join(', ')],
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

  // Customer confirmation — best-effort, doesn't affect the response to the
  // browser either way (the team notification above is the one that matters
  // for the order to actually get processed).
  if (order.email) {
    const custRows = [
      ['Order', isTagPlan ? 'FleetHive Tag Plan order' : `FleetHive ${order.plan || 'subscription'} order`],
      ['Billing', order.billing],
      ['Total amount', order.totalAmount],
      ['Status', order.paymentStatus || 'PENDING VERIFICATION'],
      ['Next steps', 'Our team will confirm your transfer and follow up within 24 hours.'],
      ['Support', 'support@fleethive.in · +234 702 577 1522'],
    ];
    if (order.flexiblePayment) {
      custRows.splice(4, 0,
        ['Amount due today', order.amountDueNow || '—'],
        ['Remaining balance', order.remainingBalance || '—'],
        ['Monthly installment', `${order.monthlyInstallment || '—'} for ${order.remainingMonths || 3} months`]
      );
    }
    await sendEmail({
      subject: `We've received your FleetHive order`,
      intro: `Hi${order.firstName ? ' ' + order.firstName : ''}, thanks for your order. We've recorded it and it's currently pending payment verification — our team will confirm your transfer and follow up shortly.`,
      rows: custRows,
      toEmail: order.email,
      replyTo: 'support@fleethive.in',
    });
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
