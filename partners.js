// partners.js — logic for the "Become a Partner" application on partners.html
// Handles: dynamic partnership-type helper text, Independent Sub-seller
// payment-plan selection, conditional business fields, choice-pill inputs,
// form validation, submitting the application (send-partner Netlify
// function), and the Paystack / Bank Transfer payment flow for the
// applicable partnership fee (mirrors the pattern used in pricing.js).

(function(){
  var PARTNER_TYPES = {
    reseller: {
      name: 'Reseller',
      helper: "Run your own branded tracking business using the FleetHive platform.",
      dueLabel: 'One-time Partnership Fee',
      dueNow: 200,
      currency: 'USD',
      showPayment: false,
      showBusiness: true
    },
    dependent: {
      name: 'Dependent Sub-seller',
      helper: "Operate under FleetHive and manage installations locally.",
      dueLabel: 'One-time Setup Fee (+ 30% revenue share on sales)',
      dueNow: 50,
      currency: 'USD',
      showPayment: false,
      showBusiness: false
    },
    independent: {
      name: 'Independent Sub-seller',
      helper: "Deploy assets independently using FleetHive approval.",
      dueLabel: 'Setup & Activation Fee',
      dueNow: 15,
      currency: 'USD',
      showPayment: true,
      showBusiness: true
    }
  };

  var PAYMENT_OPTIONS = {
    monthly:   { label: 'Monthly',    amount: 3500,  period: 'per month' },
    '6months': { label: '6 Months',   amount: 18000, period: 'per 6 months' },
    '12months':{ label: '12 Months',  amount: 30000, period: 'per year' }
  };

  var state = {
    type: '',
    paymentOption: 'monthly',
    vehiclesPerMonth: '',
    submitted: false
  };

  function qs(id){ return document.getElementById(id); }
  function fmtN(n){ return '₦' + Number(n||0).toLocaleString(); }
  function fmtUSD(n){ return '$' + Number(n||0).toLocaleString(); }

  // ---------------- Partnership type selection ----------------
  window.selectPartnerType = function(type){
    var sel = qs('pType');
    if(sel) sel.value = type;
    onTypeChange();
    var appSection = qs('partner-application');
    if(appSection) appSection.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  function onTypeChange(){
    var sel = qs('pType');
    var type = sel ? sel.value : '';
    state.type = type;
    var cfg = PARTNER_TYPES[type];

    var helperEl = qs('typeHelper');
    var paymentSection = qs('paymentOptionSection');
    var businessSection = qs('businessSection');

    if(!cfg){
      if(helperEl){ helperEl.style.display = 'none'; }
      if(paymentSection) paymentSection.style.display = 'none';
      if(businessSection) businessSection.style.display = 'none';
      return;
    }

    if(helperEl){
      helperEl.style.display = '';
      helperEl.textContent = cfg.helper;
    }
    if(paymentSection) paymentSection.style.display = cfg.showPayment ? '' : 'none';
    if(businessSection) businessSection.style.display = cfg.showBusiness ? '' : 'none';
  }

  document.addEventListener('DOMContentLoaded', function(){
    var sel = qs('pType');
    if(sel) sel.addEventListener('change', onTypeChange);
    onTypeChange();

    // Payment option pills (Independent Sub-seller)
    var payRow = qs('paymentOptionRow');
    if(payRow){
      payRow.querySelectorAll('.choice-pill').forEach(function(btn){
        btn.addEventListener('click', function(){
          payRow.querySelectorAll('.choice-pill').forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          state.paymentOption = btn.dataset.val;
        });
      });
    }

    // Vehicles-per-month pills
    var vehRow = qs('vehiclesPerMonthRow');
    if(vehRow){
      vehRow.querySelectorAll('.choice-pill').forEach(function(btn){
        btn.addEventListener('click', function(){
          vehRow.querySelectorAll('.choice-pill').forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          state.vehiclesPerMonth = btn.dataset.val;
        });
      });
    }
  });

  // ---------------- Collect + validate ----------------
  function collect(){
    return {
      partnershipType: qs('pType') ? (PARTNER_TYPES[qs('pType').value] ? PARTNER_TYPES[qs('pType').value].name : '') : '',
      typeKey: state.type,
      paymentOption: state.type === 'independent' ? (PAYMENT_OPTIONS[state.paymentOption] ? PAYMENT_OPTIONS[state.paymentOption].label : '') : '',
      surname: qs('pSurname').value.trim(),
      firstName: qs('pFirstName').value.trim(),
      otherName: qs('pOtherName').value.trim(),
      phone: qs('pPhone').value.trim(),
      whatsapp: qs('pWhatsapp').value.trim(),
      email: qs('pEmail').value.trim(),
      location: qs('pCityState').value.trim(),
      worksWithTracking: qs('pWorksWithTracking').value,
      yearsExperience: qs('pYearsExperience').value,
      vehiclesPerMonth: state.vehiclesPerMonth,
      hasInstallers: qs('pInstallers').value,
      operatingLocation: qs('pOperatingLocation').value.trim(),
      businessName: qs('pBusinessName') ? qs('pBusinessName').value.trim() : '',
      businessStatus: qs('pBizStatus') ? qs('pBizStatus').value : '',
      agree: qs('pAgree').checked
    };
  }

  function validate(data){
    var errs = [];
    if(!data.typeKey) errs.push('Please select a partnership type.');
    if(!data.surname) errs.push('Surname is required.');
    if(!data.firstName) errs.push('First name is required.');
    if(!data.phone) errs.push('Phone number is required.');
    if(!data.email) errs.push('Email address is required.');
    if(!data.location) errs.push('City / State is required.');
    if(!data.worksWithTracking) errs.push('Please tell us if you currently work with tracking devices.');
    if(!data.yearsExperience) errs.push('Please select your years of experience.');
    if(!data.vehiclesPerMonth) errs.push('Please select your estimated vehicles per month.');
    if(!data.hasInstallers) errs.push('Please tell us if you already have installers.');
    if(!data.operatingLocation) errs.push('Please tell us where you will operate.');

    var cfg = PARTNER_TYPES[data.typeKey];
    if(cfg && cfg.showBusiness && !data.businessStatus) errs.push('Please select your business registration status.');
    if(!data.agree) errs.push("Please agree to FleetHive's partnership structure and terms.");
    return errs;
  }

  // ---------------- Submit application ----------------
  document.addEventListener('DOMContentLoaded', function(){
    var form = qs('partnerForm');
    if(!form) return;
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var btn = qs('partnerSubmit');
      var msg = qs('partnerMsg');
      var data = collect();
      var errs = validate(data);
      if(errs.length){
        msg.textContent = errs[0];
        msg.style.color = 'var(--warning, #E0A93B)';
        return;
      }
      msg.textContent = '';

      btn.disabled = true; btn.textContent = 'Submitting…';

      var payload = {
        name: [data.surname, data.firstName, data.otherName].filter(Boolean).join(' '),
        surname: data.surname, firstName: data.firstName, otherName: data.otherName,
        phone: data.phone, whatsapp: data.whatsapp, email: data.email,
        partnershipType: data.partnershipType,
        paymentOption: data.paymentOption,
        location: data.location,
        operatingLocation: data.operatingLocation,
        worksWithTracking: data.worksWithTracking,
        yearsExperience: data.yearsExperience,
        vehiclesPerMonth: data.vehiclesPerMonth,
        hasInstallers: data.hasInstallers,
        businessName: data.businessName,
        businessStatus: data.businessStatus,
        applicationStatus: 'PENDING REVIEW',
        timestamp: new Date().toLocaleString()
      };

      var mailtoHref = 'mailto:support@fleethive.in?subject=' + encodeURIComponent('Partner application — ' + payload.name) +
        '&body=' + encodeURIComponent(Object.keys(payload).map(function(k){ return k + ': ' + payload[k]; }).join('\n'));

      fetch('/.netlify/functions/send-partner', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      }).then(function(res){
        btn.disabled = false; btn.textContent = 'APPLY TO BECOME A FLEETHIVE PARTNER';
        if(res.ok){
          state.submitted = true;
          showSubmitted(data);
        } else {
          msg.innerHTML = "We couldn't submit this automatically. <a href='" + mailtoHref + "' style='color:var(--sky);'>Click here to email us directly.</a>";
        }
      }).catch(function(){
        btn.disabled = false; btn.textContent = 'APPLY TO BECOME A FLEETHIVE PARTNER';
        msg.innerHTML = "We couldn't submit this automatically. <a href='" + mailtoHref + "' style='color:var(--sky);'>Click here to email us directly.</a>";
      });
    });
  });

  function showSubmitted(data){
    var confirmBox = qs('applicationConfirm');
    if(confirmBox){
      confirmBox.style.display = '';
      confirmBox.scrollIntoView({ behavior:'smooth', block:'start' });
    }
    renderPayment(data);
  }

  // ---------------- Payment section ----------------
  function renderPayment(data){
    var cfg = PARTNER_TYPES[data.typeKey];
    var section = qs('partnerPaymentSection');
    if(!cfg || !section) return;
    section.style.display = '';

    var summary = qs('partnerOrderSummary');
    var amount = cfg.dueNow;
    summary.dataset.total = amount;
    summary.dataset.currency = cfg.currency;

    var extra = '';
    if(cfg.showPayment){
      var opt = PAYMENT_OPTIONS[state.paymentOption] || PAYMENT_OPTIONS.monthly;
      extra = '<div class="order-line"><span>Selected plan (billed after activation)</span><span>' + fmtN(opt.amount) + ' ' + opt.period + '</span></div>';
    }

    summary.innerHTML =
      '<h3>Payment Summary</h3>' +
      '<div class="order-line"><span>Partnership type</span><span>' + cfg.name + '</span></div>' +
      '<div class="order-line"><span>' + cfg.dueLabel + '</span><span>' + fmtUSD(amount) + '</span></div>' +
      extra +
      '<p class="form-help" style="margin-top:12px;">This fee gets your application ready for review. FleetHive still reviews and approves every application separately — payment does not guarantee approval.</p>';
  }

  function buildPaymentPayload(status, method){
    var data = collect();
    var cfg = PARTNER_TYPES[data.typeKey];
    return {
      name: [data.surname, data.firstName, data.otherName].filter(Boolean).join(' '),
      surname: data.surname, firstName: data.firstName, otherName: data.otherName,
      phone: data.phone, whatsapp: data.whatsapp, email: data.email,
      partnershipType: data.partnershipType,
      paymentOption: data.paymentOption,
      location: data.location,
      paymentUpdate: true,
      paymentMethod: method,
      paymentStatus: status,
      amountDue: cfg ? fmtUSD(cfg.dueNow) : '',
      timestamp: new Date().toLocaleString()
    };
  }

  // ---------------- Paystack ----------------
  document.addEventListener('DOMContentLoaded', function(){
    var btn = qs('btnPartnerPaystack');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var data = collect();
      var cfg = PARTNER_TYPES[data.typeKey];
      if(!cfg || !data.email){ alert('Please complete and submit your application first.'); return; }

      btn.disabled = true; btn.textContent = 'Redirecting to Paystack…';

      fetch('/.netlify/functions/paystack-initialize', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          email: data.email,
          amount: cfg.dueNow,
          currency: cfg.currency,
          callback_url: window.location.origin + window.location.pathname,
          metadata: {
            plan: cfg.name, partnershipType: data.typeKey, currency: cfg.currency,
            customerName: [data.surname, data.firstName].filter(Boolean).join(' '), phone: data.phone
          }
        })
      }).then(function(res){ return res.json().then(function(d){ return {ok:res.ok, data:d}; }); })
        .then(function(r){
          if(r.ok && r.data.authorization_url){
            window.location.href = r.data.authorization_url;
          } else {
            btn.disabled = false; btn.textContent = 'Proceed to Payment';
            qs('partnerPaystackMsg').textContent = 'Payment could not be started. This usually means Paystack has not been configured yet on the server — please use Bank Transfer, or contact FleetHive.';
          }
        }).catch(function(){
          btn.disabled = false; btn.textContent = 'Proceed to Payment';
          qs('partnerPaystackMsg').textContent = 'Payment could not be started. Please use Bank Transfer, or contact FleetHive.';
        });
    });
  });

  document.addEventListener('DOMContentLoaded', function(){
    var params = new URLSearchParams(window.location.search);
    var reference = params.get('reference');
    if(reference) verifyPaystack(reference);
  });

  function verifyPaystack(reference){
    fetch('/.netlify/functions/paystack-verify?reference=' + encodeURIComponent(reference))
      .then(function(res){ return res.json(); })
      .then(function(data){
        var wrap = qs('partnerResultWrap');
        if(!wrap) return;
        if(data.success){
          wrap.innerHTML =
            '<div class="result-panel"><div class="rp-icon">🎉</div><h2>Payment Successful</h2>' +
            '<p>Your partnership fee has been received. Your application remains in review — our partnerships team will contact you within 48 hours.</p>' +
            '<div class="rp-details">' +
              '<div class="order-line"><span>Amount</span><span>$' + Number(data.amount).toLocaleString() + '</span></div>' +
              '<div class="order-line"><span>Reference</span><span>' + data.reference + '</span></div>' +
            '</div>' +
            '<a href="index.html" class="btn btn-primary" style="margin-top:18px; justify-content:center;">Continue to FleetHive</a>' +
            '</div>';
        } else {
          wrap.innerHTML = '<div class="result-panel pending"><div class="rp-icon">⏳</div><h2>Payment Not Confirmed</h2><p>We could not confirm this payment. If you were charged, please contact FleetHive support with your reference: ' + reference + '</p></div>';
        }
        wrap.scrollIntoView({ behavior:'smooth' });
      }).catch(function(){});
  }

  // ---------------- Bank Transfer ----------------
  document.addEventListener('DOMContentLoaded', function(){
    var btn = qs('btnPartnerBankDone');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var data = collect();
      if(!data.email){ alert('Please complete and submit your application first.'); return; }

      btn.disabled = true; btn.textContent = 'Submitting…';
      var payload = buildPaymentPayload('PAYMENT PENDING VERIFICATION', 'Bank Transfer');

      fetch('/.netlify/functions/send-partner', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      }).then(function(res){
        btn.disabled = false; btn.textContent = 'I Have Made the Transfer';
        var wrap = qs('partnerResultWrap');
        if(res.ok){
          wrap.innerHTML =
            '<div class="result-panel pending"><div class="rp-icon">⏳</div><h2>Payment Pending Verification</h2>' +
            '<p>Thanks — we\'ve recorded your transfer. Our team will verify payment and follow up on your application, which remains PENDING REVIEW until approved.</p>' +
            '<a href="index.html" class="btn btn-outline" style="margin-top:18px; justify-content:center;">Continue to FleetHive</a>' +
            '</div>';
        } else {
          qs('partnerBankMsg').textContent = "We couldn't submit your details automatically. Please WhatsApp us at +234 702 577 1522 with your payment proof.";
        }
        wrap.scrollIntoView({ behavior:'smooth' });
      }).catch(function(){
        btn.disabled = false; btn.textContent = 'I Have Made the Transfer';
        qs('partnerBankMsg').textContent = "We couldn't submit your details automatically. Please WhatsApp us at +234 702 577 1522 with your payment proof.";
      });
    });
  });

  // ---------------- Pay tabs ----------------
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('#partnerPaymentSection .pay-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        document.querySelectorAll('#partnerPaymentSection .pay-tab').forEach(function(t){ t.classList.remove('active'); });
        document.querySelectorAll('#partnerPaymentSection .pay-panel').forEach(function(p){ p.classList.remove('active'); });
        tab.classList.add('active');
        var target = tab.dataset.pay === 'bank' ? qs('partnerPayBank') : qs('partnerPayPaystack');
        if(target) target.classList.add('active');
      });
    });

    var copyBtn = qs('partnerCopyAcct');
    if(copyBtn){
      copyBtn.addEventListener('click', function(){
        var num = qs('partnerBankAcctNum');
        if(!num) return;
        navigator.clipboard && navigator.clipboard.writeText(num.textContent.trim()).then(function(){
          copyBtn.textContent = 'Copied';
          setTimeout(function(){ copyBtn.textContent = 'Copy'; }, 1500);
        });
      });
    }
  });

  // ---------------- Comparison / FAQ-style accordion not needed here ----------------
})();
