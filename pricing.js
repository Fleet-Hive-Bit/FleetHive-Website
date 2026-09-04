// pricing.js — order flow logic for pricing.html
// Handles: plan selection + animated selection border, vehicle-based price
// calculation, installation details, hardware/software add-ons, adding
// extra plans to one order, the Tag Plan multi-section form, Hive Credits,
// order summary calculation, flexible payment, and the Paystack /
// Bank Transfer payment flow (talking to the Netlify functions).

(function(){
  var PLANS = {
    lite:  { name:'Lite',  m:4000,  y:42000 },
    pro:   { name:'Pro',   m:6000,  y:60000 },
    prime: { name:'Prime', m:12000, y:120000 }
  };
  var TAGPLAN_ONE_TIME = 35000;
  var TAGPLAN_DEVICE_PORTION = 25000; // FleetTag device + 3 months free tracking
  var TAGPLAN_SETUP_PORTION = 10000;  // Technical setup & configuration
  var TAGPLAN_RENEW_M = 3000;
  var TAGPLAN_RENEW_Y = 30000;
  // Flexible Payment: 50% due today, remaining 50% split across 3 months.
  // No separate fee — the split is calculated automatically off the order
  // subtotal (see splitFlexible()).

  // Internal vehicle/device pricing — never shown to the customer directly.
  var VEHICLE_PRICES = {
    lite:  { '2000-2005':90000, '2006-2010':120000, '2011-2015':170000, '2016-2019':210000, '2020-2026':300000, bike:80000, heavy:250000 },
    pro:   { '2000-2005':190000,'2006-2010':230000, '2011-2015':280000, '2016-2019':320000, '2020-2026':400000, bike:150000, heavy:350000 },
    prime: {                    '2006-2010':480000, '2011-2015':530000, '2016-2019':570000, '2020-2026':650000, bike:300000, heavy:550000 }
  };
  var BIKE_TYPES = ['Bike','Tricycle'];
  var HEAVY_TYPES = ['Truck','Heavy Equipment'];

  var HARDWARE_ADDONS = [
    { id:'dashcam',        label:'Dashcam Without AI',                              price:200000 },
    { id:'dashcam128',     label:'Dashcam Without AI + 128GB SD Card',              price:230000 },
    { id:'dashcam64',      label:'Dashcam Without AI + 64GB SD Card',               price:215000 },
    { id:'stepdown',       label:'Step Down for 24V Vehicle',                       price:10000 },
    { id:'teltonika',      label:'Teltonika Dual Camera With AI',                   price:400000 },
    { id:'fuelsensor',     label:'Fuel Sensor',                                     price:300000 },
    { id:'canbus',         label:'CAN Bus Integration',                             price:300000 },
    { id:'doorsensor',     label:'Door Sensor for Trucks/Containers',               price:50000 },
    { id:'sos',            label:'SOS Panic Button',                                price:40000 },
    { id:'tempsensor',     label:'Temperature Sensor',                              price:50000 }
  ];
  var SOFTWARE_ADDONS = [
    { id:'dashcamstorage', label:'Dashcam Data Storage & Playback', price:10000 },
    { id:'analytics',      label:'Advanced Fleet Analytics',        price:10000 },
    { id:'routeopt',       label:'Route Optimization Support',      price:10000 },
    { id:'driverscore',    label:'Driver Behaviour Scoring Reports',price:5000 },
    { id:'maintalert',     label:'Maintenance Alert Report',        price:5000 },
    { id:'fuelmonitor',    label:'Fuel Monitoring Analytics',       price:5000 }
  ];

  var state = {
    plan: null,          // 'lite' | 'pro' | 'prime' | 'tagplan'
    billing: 'monthly',  // 'monthly' | 'annual' (subscription plans only)
    hiveCredits: 0,
    flexible: false,
    payMethod: 'paystack',
    vehCount: '1',
    hardwareAddons: {},  // id -> true
    softwareAddons: {},  // id -> true
    addedPlans: []        // [{plan:'pro', vehicleType, vehicleYear, count}] or [{plan:'tagplan', count}]
  };

  function qs(id){ return document.getElementById(id); }
  function fmt(n){ return '₦' + Number(n||0).toLocaleString(); }

  function vehicleCategory(type){
    if(BIKE_TYPES.indexOf(type) > -1) return 'bike';
    if(HEAVY_TYPES.indexOf(type) > -1) return 'heavy';
    return 'year';
  }
  function vehiclePrice(plan, type, year){
    var table = VEHICLE_PRICES[plan];
    if(!table || !type) return 0;
    var cat = vehicleCategory(type);
    if(cat === 'bike') return table.bike || 0;
    if(cat === 'heavy') return table.heavy || 0;
    return table[year] || 0;
  }

  // ---------------- Plan selection ----------------
  window.selectPlan = function(plan){
    state.plan = plan;
    var url = new URL(window.location.href);
    url.searchParams.set('plan', plan);
    var annual = qs('priceToggle') && qs('priceToggle').classList.contains('annual');
    state.billing = annual ? 'annual' : 'monthly';
    url.searchParams.set('billing', state.billing);
    window.history.replaceState({}, '', url);

    document.querySelectorAll('.price-card[data-card]').forEach(function(c){
      c.classList.toggle('is-selected', c.dataset.card === plan);
    });
    positionPlanGlow();

    qs('order-flow').style.display = '';
    qs('subFlow').style.display = (plan === 'tagplan') ? 'none' : '';
    qs('tagFlow').style.display = (plan === 'tagplan') ? '' : 'none';

    renderPlanChip();
    renderFlexiBox();
    renderAddPlanOptions();
    checkPrimeYearRule();
    updateSummary();

    qs('order-flow').scrollIntoView({ behavior:'smooth', block:'start' });
  };

  // Single animated selection indicator — glides between plan cards instead
  // of four permanently-active borders.
  function positionPlanGlow(){
    var glow = qs('planGlow');
    var card = document.querySelector('.price-card[data-card="' + state.plan + '"]');
    if(!glow || !card) return;
    glow.style.opacity = '1';
    glow.style.width = card.offsetWidth + 'px';
    glow.style.height = card.offsetHeight + 'px';
    glow.style.transform = 'translate(' + card.offsetLeft + 'px,' + card.offsetTop + 'px)';
  }
  window.addEventListener('resize', function(){ if(state.plan) positionPlanGlow(); });

  function renderPlanChip(){
    var chip = qs('planChip');
    if(state.plan === 'tagplan'){
      chip.innerHTML =
        '<div><div class="pc-name">Tag Plan</div>' +
        '<div class="pc-sub">Reusable FleetTag + 3 months free tracking</div></div>' +
        '<div><div class="pc-amt">' + fmt(TAGPLAN_ONE_TIME) + '</div>' +
        '<button class="pc-change" onclick="document.getElementById(\'plans\').scrollIntoView({behavior:\'smooth\'})">Change plan</button></div>';
    } else {
      var p = PLANS[state.plan];
      var amt = state.billing === 'annual' ? p.y : p.m;
      chip.innerHTML =
        '<div><div class="pc-name">' + p.name + ' Plan</div>' +
        '<div class="pc-sub">' + (state.billing === 'annual' ? 'Billed yearly' : 'Billed monthly') + '</div></div>' +
        '<div><div class="pc-amt">' + fmt(amt) + '<span style="font-size:12px;">' + (state.billing === 'annual' ? '/yr' : '/mo') + '</span></div>' +
        '<button class="pc-change" onclick="document.getElementById(\'plans\').scrollIntoView({behavior:\'smooth\'})">Change plan</button></div>';
    }
  }

  // React to the shared monthly/annual toggle (defined in site.js)
  document.addEventListener('DOMContentLoaded', function(){
    var sw = qs('priceToggle');
    if(sw){
      sw.addEventListener('click', function(){
        setTimeout(function(){
          if(state.plan && state.plan !== 'tagplan'){
            state.billing = sw.classList.contains('annual') ? 'annual' : 'monthly';
            renderPlanChip();
            renderFlexiBox();
            updateSummary();
          }
        }, 10);
      });
    }

    // Read plan/billing from the URL (arrived via "Choose a Plan" on the homepage)
    var params = new URLSearchParams(window.location.search);
    var plan = params.get('plan');
    var billing = params.get('billing');
    if(billing === 'annual' && sw){ sw.classList.add('annual'); }
    if(plan && (PLANS[plan] || plan === 'tagplan')){
      selectPlan(plan);
    }

    // Paystack callback — verify a transaction we just returned from
    var reference = params.get('reference');
    if(reference){ verifyPaystack(reference); }
  });

  // ---------------- Vehicle type / year / count (subFlow) ----------------
  function checkPrimeYearRule(){
    var warn = qs('primeYearWarn');
    if(!warn) return false;
    var year = qs('subVehicleYear') ? qs('subVehicleYear').value : '';
    var blocked = (state.plan === 'prime' && year === '2000-2005');
    warn.style.display = blocked ? '' : 'none';
    return blocked;
  }

  document.addEventListener('DOMContentLoaded', function(){
    var vType = qs('subVehicleType'), vYear = qs('subVehicleYear');
    if(vType) vType.addEventListener('change', function(){ checkPrimeYearRule(); updateSummary(); });
    if(vYear) vYear.addEventListener('change', function(){ checkPrimeYearRule(); updateSummary(); });

    var countRow = qs('subVehCountRow');
    if(countRow){
      countRow.addEventListener('click', function(e){
        var btn = e.target.closest('.choice-pill');
        if(!btn) return;
        countRow.querySelectorAll('.choice-pill').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        state.vehCount = btn.dataset.val;
        qs('fleetDeployWrap').style.display = (state.vehCount === '5+') ? '' : 'none';
        updateSummary();
      });
    }

    // Build add-on checkbox lists once
    var hwBox = qs('subHardwareAddons');
    if(hwBox){
      HARDWARE_ADDONS.forEach(function(a){
        var row = document.createElement('div');
        row.className = 'addon-row';
        row.innerHTML = '<input type="checkbox" id="hw_' + a.id + '"><label for="hw_' + a.id + '">' + a.label + '</label>';
        hwBox.appendChild(row);
        row.querySelector('input').addEventListener('change', function(e){
          state.hardwareAddons[a.id] = e.target.checked;
          updateSummary();
        });
      });
    }
    var swBox = qs('subSoftwareAddons');
    if(swBox){
      SOFTWARE_ADDONS.forEach(function(a){
        var row = document.createElement('div');
        row.className = 'addon-row';
        row.innerHTML = '<input type="checkbox" id="sw_' + a.id + '"><label for="sw_' + a.id + '">' + a.label + '</label>';
        swBox.appendChild(row);
        row.querySelector('input').addEventListener('change', function(e){
          state.softwareAddons[a.id] = e.target.checked;
          updateSummary();
        });
      });
    }
  });

  // ---------------- Add Another Plan ----------------
  // Two mostly-identical UIs (one inside subFlow, one inside tagFlow) share
  // this logic. Since only one flow is ever visible at a time, everything
  // below resolves the active flow's element ids via flowPrefix() rather
  // than duplicating the functions.
  function flowPrefix(){ return state.plan === 'tagplan' ? 'tag' : 'sub'; }

  var VEHICLE_TYPE_OPTIONS = [
    'Private Car','Company Vehicle','Bike','Tricycle','Van','Bus','Truck','Heavy Equipment'
  ];
  var VEHICLE_YEAR_OPTIONS = [
    ['2000-2005','2000 – 2005'], ['2006-2010','2006 – 2010'], ['2011-2015','2011 – 2015'],
    ['2016-2019','2016 – 2019'], ['2020-2026','2020 – 2026']
  ];

  function renderAddPlanOptions(){
    var sel = qs(flowPrefix() + 'AddPlanSelect');
    if(!sel) return;
    var all = [
      { val:'lite', label:'Lite' }, { val:'pro', label:'Pro' },
      { val:'prime', label:'Prime' }, { val:'tagplan', label:'Tag Plan' }
    ];
    var current = sel.value;
    sel.innerHTML = '<option value="">Select a plan to add</option>';
    all.forEach(function(o){
      if(o.val === state.plan) return; // current plan already selected
      if(state.addedPlans.some(function(p){ return p.plan === o.val; })) return; // already added
      var opt = document.createElement('option');
      opt.value = o.val; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    if(Array.prototype.some.call(sel.options, function(o){ return o.value === current; })) sel.value = current;
  }

  function vehicleTypeOptionsHtml(selected){
    return '<option value="">Select vehicle type</option>' + VEHICLE_TYPE_OPTIONS.map(function(t){
      return '<option value="' + t + '"' + (t === selected ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
  }
  function vehicleYearOptionsHtml(selected){
    return '<option value="">Select vehicle year</option>' + VEHICLE_YEAR_OPTIONS.map(function(pair){
      return '<option value="' + pair[0] + '"' + (pair[0] === selected ? ' selected' : '') + '>' + pair[1] + '</option>';
    }).join('');
  }
  function countChoiceRowHtml(idPrefix, unitLabel, selected){
    var vals = ['1','2','3','4','5+'];
    return vals.map(function(v){
      var label = v === '5+' ? '5+ ' + unitLabel + 's' : v + ' ' + unitLabel + (v === '1' ? '' : 's');
      return '<button type="button" class="choice-pill' + (v === selected ? ' active' : '') + '" data-val="' + v + '" data-row="' + idPrefix + '">' + label + '</button>';
    }).join('');
  }

  // Renders the inline detail form for whichever plan was just picked from
  // the "Select a plan to add" dropdown — collecting the same vehicle /
  // installation info the main plan collected, rather than silently
  // defaulting to Private Car / 2020-2026 / 1 vehicle like before.
  function renderApDetail(planVal){
    var prefix = flowPrefix();
    var panel = qs(prefix + 'ApDetail');
    if(!panel) return;
    if(!planVal){ panel.style.display = 'none'; panel.innerHTML = ''; return; }

    var html = '';
    if(planVal === 'tagplan'){
      html +=
        '<div class="form-grid">' +
          '<div class="form-group full">' +
            '<label class="form-label">Number of FleetTags*</label>' +
            '<div class="choice-row" id="' + prefix + 'ApTagCountRow">' + countChoiceRowHtml('tagcount', 'FleetTag', '1') + '</div>' +
            '<input class="form-input" id="' + prefix + 'ApTagCountCustom" placeholder="Enter number of FleetTags" style="display:none; margin-top:10px; max-width:220px;">' +
          '</div>' +
        '</div>' +
        '<div class="addplan-row" style="margin-top:14px;">' +
          '<button type="button" class="btn btn-primary" id="' + prefix + 'ApAdd" style="padding:10px 20px; font-size:12.5px;">Add to Order</button>' +
          '<button type="button" class="btn btn-outline" id="' + prefix + 'ApCancel" style="padding:10px 20px; font-size:12.5px;">Cancel</button>' +
        '</div>';
    } else {
      html +=
        '<div class="form-grid">' +
          '<div class="form-group"><label class="form-label">Vehicle Type*</label>' +
            '<select class="form-select" id="' + prefix + 'ApVehicleType">' + vehicleTypeOptionsHtml('') + '</select></div>' +
          '<div class="form-group"><label class="form-label">Vehicle Year*</label>' +
            '<select class="form-select" id="' + prefix + 'ApVehicleYear">' + vehicleYearOptionsHtml('') + '</select></div>' +
        '</div>' +
        '<label class="form-label">Number of Vehicles*</label>' +
        '<div class="choice-row" id="' + prefix + 'ApVehCountRow" style="margin:10px 0 16px;">' + countChoiceRowHtml('vehcount', 'Vehicle', '1') + '</div>' +
        '<label class="form-label">Same installation details as above?</label>' +
        '<div class="choice-row" id="' + prefix + 'ApInstallSameRow" style="margin:10px 0 16px;">' +
          '<button type="button" class="choice-pill active" data-val="yes">Yes, same details</button>' +
          '<button type="button" class="choice-pill" data-val="no">No, different</button>' +
        '</div>' +
        '<div id="' + prefix + 'ApInstallWrap" style="display:none;">' +
          '<div class="form-grid">' +
            '<div class="form-group"><label class="form-label">Preferred Installation Location*</label>' +
              '<select class="form-select" id="' + prefix + 'ApInstallCity">' +
                '<option value="">Select a city</option><option>Lagos</option><option>Abuja</option>' +
                '<option>Port Harcourt</option><option>Ibadan</option><option>Kano</option><option>Enugu</option>' +
              '</select></div>' +
            '<div class="form-group"><label class="form-label">Installation Option*</label>' +
              '<select class="form-select" id="' + prefix + 'ApInstallOption">' +
                '<option value="">Select an option</option>' +
                '<option value="Installer Visit My Location">Installer Visit My Location</option>' +
                '<option value="I Will Visit Installation Center">I Will Visit Installation Center</option>' +
              '</select></div>' +
            '<div class="form-group"><label class="form-label">Preferred Installation Date*</label><input class="form-input" id="' + prefix + 'ApInstallDate" type="date"></div>' +
            '<div class="form-group"><label class="form-label">Preferred Installation Time*</label><input class="form-input" id="' + prefix + 'ApInstallTime" type="time"></div>' +
          '</div>' +
        '</div>' +
        '<div class="addplan-row" style="margin-top:4px;">' +
          '<button type="button" class="btn btn-primary" id="' + prefix + 'ApAdd" style="padding:10px 20px; font-size:12.5px;">Add to Order</button>' +
          '<button type="button" class="btn btn-outline" id="' + prefix + 'ApCancel" style="padding:10px 20px; font-size:12.5px;">Cancel</button>' +
        '</div>';
    }
    panel.innerHTML = html;
    panel.style.display = '';

    // Count choice-rows (shared handler — click delegation on the panel)
    panel.querySelectorAll('.choice-row[id$="TagCountRow"], .choice-row[id$="VehCountRow"]').forEach(function(row){
      row.addEventListener('click', function(e){
        var btn = e.target.closest('.choice-pill');
        if(!btn) return;
        row.querySelectorAll('.choice-pill').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        // FleetTag count has an exact custom-number field for 5+ (tags are
        // flat-priced per unit); vehicle count intentionally doesn't — 5+
        // vehicles is treated as a custom fleet quote, same as the main form.
        var customInput = qs(prefix + 'ApTagCountCustom');
        if(customInput) customInput.style.display = (btn.dataset.val === '5+') ? '' : 'none';
      });
    });

    var sameRow = qs(prefix + 'ApInstallSameRow');
    if(sameRow){
      sameRow.addEventListener('click', function(e){
        var btn = e.target.closest('.choice-pill');
        if(!btn) return;
        sameRow.querySelectorAll('.choice-pill').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        qs(prefix + 'ApInstallWrap').style.display = (btn.dataset.val === 'no') ? '' : 'none';
      });
    }

    var cancelBtn = qs(prefix + 'ApCancel');
    if(cancelBtn){
      cancelBtn.addEventListener('click', function(){
        qs(prefix + 'AddPlanSelect').value = '';
        panel.style.display = 'none';
        panel.innerHTML = '';
      });
    }

    var addBtn = qs(prefix + 'ApAdd');
    if(addBtn){
      addBtn.addEventListener('click', function(){
        var entry = { plan: planVal };
        if(planVal === 'tagplan'){
          var tagActive = panel.querySelector('#' + prefix + 'ApTagCountRow .choice-pill.active');
          var tagVal = tagActive ? tagActive.dataset.val : '1';
          entry.count = (tagVal === '5+')
            ? Math.max(5, Number(qs(prefix + 'ApTagCountCustom').value) || 5)
            : Number(tagVal);
        } else {
          entry.vehicleType = qs(prefix + 'ApVehicleType').value;
          entry.vehicleYear = qs(prefix + 'ApVehicleYear').value;
          var vehActive = panel.querySelector('#' + prefix + 'ApVehCountRow .choice-pill.active');
          entry.count = vehActive ? vehActive.dataset.val : '1'; // kept as string; '5+' means custom fleet quote
          if(!entry.vehicleType || (vehicleCategory(entry.vehicleType) === 'year' && !entry.vehicleYear)){
            alert('Please select a vehicle type and year for this plan before adding it.');
            return;
          }
          var installSameActive = panel.querySelector('#' + prefix + 'ApInstallSameRow .choice-pill.active');
          entry.installSame = !installSameActive || installSameActive.dataset.val === 'yes';
          if(!entry.installSame){
            entry.installCity = qs(prefix + 'ApInstallCity').value;
            entry.installOption = qs(prefix + 'ApInstallOption').value;
            entry.installDate = qs(prefix + 'ApInstallDate').value;
            entry.installTime = qs(prefix + 'ApInstallTime').value;
            if(!entry.installCity || !entry.installOption || !entry.installDate || !entry.installTime){
              alert('Please fill in the installation details for this plan, or choose "Same details" instead.');
              return;
            }
          }
        }
        state.addedPlans.push(entry);
        qs(prefix + 'AddPlanSelect').value = '';
        panel.style.display = 'none';
        panel.innerHTML = '';
        renderAddedPlans();
        renderAddPlanOptions();
        updateSummary();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    ['sub','tag'].forEach(function(prefix){
      var sel = qs(prefix + 'AddPlanSelect');
      if(!sel) return;
      sel.addEventListener('change', function(){
        renderApDetail(sel.value);
      });
    });
  });

  function addedPlanLabel(entry){
    if(entry.plan === 'tagplan') return 'Tag Plan, ' + entry.count + ' FleetTag' + (entry.count > 1 ? 's' : '');
    var isCustomFleet = entry.count === '5+';
    var countLabel = isCustomFleet ? ' · 5+ vehicles (custom quote)' : (Number(entry.count) > 1 ? ' · ' + entry.count + ' vehicles' : '');
    var installLabel = entry.installSame === false ? ' · custom installation' : '';
    return PLANS[entry.plan].name + ' Plan, ' + entry.vehicleType + ', ' + entry.vehicleYear + countLabel + installLabel;
  }
  function addedPlanAmount(entry){
    if(entry.plan === 'tagplan') return TAGPLAN_ONE_TIME * entry.count;
    var sub = state.billing === 'annual' ? PLANS[entry.plan].y : PLANS[entry.plan].m;
    if(entry.count === '5+') return sub; // custom fleet — device/install quoted separately by the team
    var device = vehiclePrice(entry.plan, entry.vehicleType, entry.vehicleYear);
    var count = Number(entry.count) || 1;
    return sub + (device * count);
  }
  function renderAddedPlans(){
    var wrap = qs(flowPrefix() + 'AddedPlansList');
    if(!wrap) return;
    wrap.innerHTML = '';
    state.addedPlans.forEach(function(entry, idx){
      var card = document.createElement('div');
      card.className = 'added-plan-card';
      card.innerHTML =
        '<div><div class="ap-name">' + addedPlanLabel(entry) + '</div>' +
        '<div class="ap-sub">' + fmt(addedPlanAmount(entry)) + '</div></div>' +
        '<button type="button" class="ap-remove" data-idx="' + idx + '">Remove</button>';
      wrap.appendChild(card);
    });
    wrap.querySelectorAll('.ap-remove').forEach(function(b){
      b.addEventListener('click', function(){
        state.addedPlans.splice(Number(b.dataset.idx), 1);
        renderAddedPlans();
        renderAddPlanOptions();
        updateSummary();
      });
    });
  }

  // ---------------- Flexible payment ----------------
  function flexiBaseAmount(){
    return computeSubtotal();
  }
  // Total -> 50% due today, remaining 50% split evenly across 3 months.
  // Calculated automatically off whatever the current subtotal is — never
  // hard-coded — so it works the same way for every plan (Lite/Pro/Prime
  // subscriptions and the Tag Plan alike).
  function splitFlexible(total){
    var dueNow = Math.round(total / 2);
    var remaining = total - dueNow;
    var monthly = Math.floor(remaining / 3);
    var lastMonth = remaining - (monthly * 2); // absorbs any rounding remainder
    return { total: total, dueNow: dueNow, remaining: remaining, monthly: monthly, lastMonth: lastMonth };
  }
  function renderFlexiBox(){
    var wrap = state.plan === 'tagplan' ? qs('tagFlexiWrap') : qs('subFlexiWrap');
    var otherWrap = state.plan === 'tagplan' ? qs('subFlexiWrap') : qs('tagFlexiWrap');
    if(otherWrap) otherWrap.innerHTML = '';
    if(!wrap || !state.plan) return;
    var base = flexiBaseAmount();
    var split = splitFlexible(base);
    wrap.innerHTML =
      '<div class="flexi-box">' +
        '<div class="flexi-head"><span class="flexi-title">Flexible Payment Plan</span>' +
        '<div class="fh-switch' + (state.flexible ? ' on' : '') + '" id="flexiSwitch"></div></div>' +
        '<p>Pay 50% today and spread the remaining 50% across the next 3 months. ' +
        'The tracking device remains FleetHive property until the full required payment has been completed. ' +
        'If the agreed payment is not completed, FleetHive reserves the right to recover or remove the device and take the necessary action in line with the applicable Terms &amp; Conditions.</p>' +
        '<div class="form-check" id="flexiAgreeWrap" style="' + (state.flexible ? '' : 'display:none;') + '">' +
          '<input type="checkbox" id="flexiAgree"><label for="flexiAgree">I understand and agree to the Flexible Payment terms.</label>' +
        '</div>' +
        '<p id="flexiPreview" style="' + (state.flexible ? '' : 'display:none;') + ' font-weight:700; color:var(--heading);">' +
          'Due today: ' + fmt(split.dueNow) + ', then ' + fmt(split.monthly) + '/month for 3 months' +
          (split.lastMonth !== split.monthly ? ' (final month ' + fmt(split.lastMonth) + ')' : '') + '.' +
        '</p>' +
      '</div>';
    var sw = qs('flexiSwitch');
    if(sw){
      sw.addEventListener('click', function(){
        state.flexible = !state.flexible;
        renderFlexiBox();
        updateSummary();
      });
    }
  }

  // ---------------- Tag Plan sub-widgets ----------------
  document.addEventListener('DOMContentLoaded', function(){
    // FleetTag count pills
    var countRow = qs('tagCountRow');
    if(countRow){
      countRow.addEventListener('click', function(e){
        var btn = e.target.closest('.choice-pill');
        if(!btn) return;
        countRow.querySelectorAll('.choice-pill').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        qs('tagCountCustom').style.display = (btn.dataset.val === '5+') ? '' : 'none';
        updateSummary();
      });
    }
    var tagCountCustom = qs('tagCountCustom');
    if(tagCountCustom){ tagCountCustom.addEventListener('input', updateSummary); }
    // FleetTag use pills
    var useRow = qs('tagUseRow');
    if(useRow){
      useRow.addEventListener('click', function(e){
        var btn = e.target.closest('.choice-pill');
        if(!btn) return;
        useRow.querySelectorAll('.choice-pill').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        qs('tagUseCustom').style.display = (btn.dataset.val === 'Other') ? '' : 'none';
      });
    }
    // Hive Credits yes/no
    var hcYes = qs('hcYes'), hcNo = qs('hcNo');
    if(hcYes && hcNo){
      hcYes.addEventListener('click', function(){
        hcYes.classList.add('active'); hcNo.classList.remove('active');
        qs('hcAmountWrap').style.display = '';
      });
      hcNo.addEventListener('click', function(){
        hcNo.classList.add('active'); hcYes.classList.remove('active');
        qs('hcAmountWrap').style.display = 'none';
        state.hiveCredits = 0;
        updateSummary();
      });
    }
    // Hive credit amount chips
    var creditGrid = document.querySelector('.credit-grid');
    if(creditGrid){
      creditGrid.addEventListener('click', function(e){
        var chip = e.target.closest('.credit-chip');
        if(!chip) return;
        creditGrid.querySelectorAll('.credit-chip').forEach(function(c){ c.classList.remove('active'); });
        chip.classList.add('active');
        if(chip.dataset.amt === 'custom'){
          qs('hcCustomAmt').style.display = '';
          state.hiveCredits = Number(qs('hcCustomAmt').value) || 0;
        } else {
          qs('hcCustomAmt').style.display = 'none';
          state.hiveCredits = Number(chip.dataset.amt);
        }
        updateSummary();
      });
    }
    var hcCustom = qs('hcCustomAmt');
    if(hcCustom){
      hcCustom.addEventListener('input', function(){
        state.hiveCredits = Number(hcCustom.value) || 0;
        updateSummary();
      });
    }
  });

  function tagCount(){
    var active = document.querySelector('#tagCountRow .choice-pill.active');
    if(!active) return 1;
    if(active.dataset.val === '5+') return Math.max(5, Number(qs('tagCountCustom').value) || 5);
    return Number(active.dataset.val) || 1;
  }
  function subVehCount(){
    if(state.vehCount === '5+') return null; // custom fleet, quoted separately
    return Number(state.vehCount) || 1;
  }
  function hardwareAddonsTotal(){
    var total = 0;
    HARDWARE_ADDONS.forEach(function(a){ if(state.hardwareAddons[a.id]) total += (a.price || 0); });
    return total;
  }
  function softwareAddonsTotal(){
    var total = 0;
    SOFTWARE_ADDONS.forEach(function(a){ if(state.softwareAddons[a.id]) total += (a.price || 0); });
    return total;
  }

  // ---------------- Order summary ----------------
  function computeSubtotal(){
    var total = 0;
    if(state.plan === 'tagplan'){
      total += TAGPLAN_ONE_TIME * tagCount();
      if(state.hiveCredits > 0) total += state.hiveCredits;
    } else if(state.plan) {
      var p = PLANS[state.plan];
      var amt = state.billing === 'annual' ? p.y : p.m;
      total += amt;
      var count = subVehCount();
      if(count){
        var type = qs('subVehicleType') ? qs('subVehicleType').value : '';
        var year = qs('subVehicleYear') ? qs('subVehicleYear').value : '';
        total += vehiclePrice(state.plan, type, year) * count;
      }
      total += hardwareAddonsTotal() + softwareAddonsTotal();
    }
    state.addedPlans.forEach(function(entry){ total += addedPlanAmount(entry); });
    return total;
  }

  function updateSummary(){
    var box = qs('orderSummary');
    if(!box || !state.plan) return;
    renderAddedPlans();
    var lines = [];
    var total = 0;

    if(state.plan === 'tagplan'){
      var n = tagCount();
      var tagLabel = n + ' FleetTag' + (n > 1 ? 's' : '');
      lines.push(['FleetTag Device + 3 Months Free Tracking (' + tagLabel + ')', fmt(TAGPLAN_DEVICE_PORTION * n)]);
      lines.push(['Technical Setup &amp; Configuration (' + tagLabel + ')', fmt(TAGPLAN_SETUP_PORTION * n)]);
      total += TAGPLAN_ONE_TIME * n;
      if(state.hiveCredits > 0){ lines.push(['Hive Credits', fmt(state.hiveCredits)]); total += state.hiveCredits; }
    } else {
      var p = PLANS[state.plan];
      var amt = state.billing === 'annual' ? p.y : p.m;
      lines.push([p.name + ' Plan (' + (state.billing === 'annual' ? 'Annual' : 'Monthly') + ')', fmt(amt)]);
      total += amt;

      var count = subVehCount();
      var type = qs('subVehicleType') ? qs('subVehicleType').value : '';
      var year = qs('subVehicleYear') ? qs('subVehicleYear').value : '';
      if(count && type && (vehicleCategory(type) !== 'year' || year)){
        var vp = vehiclePrice(state.plan, type, year);
        if(vp){
          lines.push(['Vehicle Setup & Device (' + count + ' vehicle' + (count > 1 ? 's' : '') + ')', fmt(vp * count)]);
          total += vp * count;
        }
      } else if(state.vehCount === '5+') {
        lines.push(['Fleet Deployment (5+ vehicles)', 'Custom quote']);
      }

      HARDWARE_ADDONS.forEach(function(a){
        if(state.hardwareAddons[a.id]){
          lines.push([a.label, fmt(a.price)]);
          total += a.price;
        }
      });
      SOFTWARE_ADDONS.forEach(function(a){
        if(state.softwareAddons[a.id]){ lines.push([a.label + ' (monthly)', fmt(a.price)]); total += a.price; }
      });
    }

    var addedTagCount = 0;
    state.addedPlans.forEach(function(entry){
      if(entry.plan === 'tagplan'){
        lines.push(['Additional: FleetTag Device + 3 Months Free Tracking (' + entry.count + ')', fmt(TAGPLAN_DEVICE_PORTION * entry.count)]);
        lines.push(['Additional: Technical Setup &amp; Configuration (' + entry.count + ')', fmt(TAGPLAN_SETUP_PORTION * entry.count)]);
        addedTagCount += entry.count;
      } else {
        lines.push(['Additional: ' + addedPlanLabel(entry), fmt(addedPlanAmount(entry))]);
      }
      total += addedPlanAmount(entry);
    });

    var html = '<h3>Order Summary</h3>';
    lines.forEach(function(l){ html += '<div class="order-line"><span>' + l[0] + '</span><span>' + l[1] + '</span></div>'; });
    html += '<div class="order-total"><span class="ot-label">' + (state.plan === 'tagplan' ? 'Total One-Time Cost' : 'Total to Pay') + '</span><span class="ot-amt">' + fmt(total) + '</span></div>';

    var dueNow = total;
    if(state.flexible){
      var split = splitFlexible(total);
      dueNow = split.dueNow;
      html += '<div class="tag-price-breakdown" style="margin-top:14px;">' +
        '<div class="tpb-row tpb-now"><span class="tpb-label">Due Today <span class="tpb-tag">Flexible Payment</span></span><span class="tpb-amt">' + fmt(split.dueNow) + '</span></div>' +
        '<div class="tpb-row"><span class="tpb-label">Remaining Balance</span><span class="tpb-amt">' + fmt(split.remaining) + '</span></div>' +
        '<div class="tpb-row"><span class="tpb-label">Monthly Installment (3 months)</span><span class="tpb-amt">' + fmt(split.monthly) + '/mo' + (split.lastMonth !== split.monthly ? ' <span>(final month ' + fmt(split.lastMonth) + ')</span>' : '') + '</span></div>' +
      '</div>';
    }

    if(state.plan === 'tagplan'){
      html += '<div class="tag-price-breakdown" style="margin-top:14px;">' +
        '<div class="tpb-row tpb-now"><span class="tpb-label">Pay Now</span><span class="tpb-amt">' + fmt(total) + '</span></div>' +
        '<div class="tpb-row tpb-free"><span class="tpb-label">First 3 Months</span><span class="tpb-amt tpb-free-amt">FREE</span></div>' +
        '<div class="tpb-row tpb-renew"><span class="tpb-label">After 3 Months <span class="tpb-tag tpb-tag-later">Future Renewal</span></span><span class="tpb-amt">' + fmt(TAGPLAN_RENEW_M) + '/mo <span>or ' + fmt(TAGPLAN_RENEW_Y) + '/yr, Save ₦6,000</span></span></div>' +
      '</div>';
      html += '<p class="order-note">Your tracking subscription will be deactivated after the free period if you do not renew, we\'ll notify you before it\'s due.</p>';
    } else if(addedTagCount > 0){
      html += '<p class="order-note">The FleetTag' + (addedTagCount > 1 ? 's' : '') + ' added above include' + (addedTagCount > 1 ? '' : 's') + ' 3 months of free tracking. After that, it renews at ' + fmt(TAGPLAN_RENEW_M) + '/month or ' + fmt(TAGPLAN_RENEW_Y) + '/year (future renewal price, not charged today).</p>';
    }
    box.innerHTML = html;
    box.dataset.total = total;
    box.dataset.dueNow = dueNow;

    // Keep the flexible-payment preview amount current
    if(state.flexible) renderFlexiBox();

    var bankNote = qs('bankAmountNote');
    if(bankNote){
      bankNote.textContent = state.flexible
        ? 'Transfer ' + fmt(dueNow) + ' (50% due today) using your mobile banking app or bank transfer. The remaining ' + fmt(total - dueNow) + ' is spread across the next 3 months as agreed in the Flexible Payment terms.'
        : 'Transfer the exact amount shown above (' + fmt(total) + ') using your mobile banking app or bank transfer.';
    }
  }

  // ---------------- Payment method tabs ----------------
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('.pay-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        document.querySelectorAll('.pay-tab').forEach(function(t){ t.classList.remove('active'); });
        document.querySelectorAll('.pay-panel').forEach(function(p){ p.classList.remove('active'); });
        tab.classList.add('active');
        state.payMethod = tab.dataset.pay;
        qs(tab.dataset.pay === 'paystack' ? 'payPaystack' : 'payBank').classList.add('active');
      });
    });

    var copyBtn = qs('copyAcct');
    if(copyBtn){
      copyBtn.addEventListener('click', function(){
        navigator.clipboard && navigator.clipboard.writeText(qs('bankAcctNum').textContent.trim()).then(function(){
          copyBtn.textContent = 'Copied'; copyBtn.classList.add('copied');
          setTimeout(function(){ copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1800);
        });
      });
    }
  });

  // ---------------- Field collection ----------------
  function collectCustomer(){
    if(state.plan === 'tagplan'){
      return {
        surname: qs('tagSurname').value, firstName: qs('tagFirstName').value, otherName: qs('tagOtherName').value,
        phone: qs('tagPhone').value, whatsapp: qs('tagWhatsapp').value, email: qs('tagEmail').value,
        state: qs('tagState').value, city: qs('tagCity').value, houseNo: qs('tagHouseNo').value,
        street: qs('tagStreet').value, landmark: qs('tagLandmark').value,
        tagCount: tagCount(),
        tagUse: (function(){
          var active = document.querySelector('#tagUseRow .choice-pill.active');
          if(active && active.dataset.val === 'Other') return qs('tagUseCustom').value || 'Other';
          return active ? active.dataset.val : 'Vehicle';
        })()
      };
    }
    return {
      surname: qs('subSurname').value, firstName: qs('subFirstName').value, otherName: qs('subOtherName').value,
      phone: qs('subPhone').value, whatsapp: qs('subWhatsapp').value, email: qs('subEmail').value,
      address: qs('subAddress').value,
      vehicleType: qs('subVehicleType').value, vehicleYear: qs('subVehicleYear').value, vehCount: state.vehCount,
      fleetNote: qs('fleetDeployNote') ? qs('fleetDeployNote').value : '',
      installCity: qs('subInstallCity').value, installOption: qs('subInstallOption').value,
      installDate: qs('subInstallDate').value, installTime: qs('subInstallTime').value
    };
  }

  function validate(cust){
    if(checkPrimeYearRule()){
      alert('Prime is available for vehicles from 2006 upward. Please choose Lite or Pro, or select a different vehicle year.');
      return false;
    }
    var required = state.plan === 'tagplan'
      ? [cust.surname, cust.firstName, cust.phone, cust.email, cust.state, cust.landmark]
      : [cust.surname, cust.firstName, cust.phone, cust.email, cust.address, cust.vehicleType, cust.installCity, cust.installOption, cust.installDate, cust.installTime]
          .concat(vehicleCategory(cust.vehicleType || '') === 'year' ? [cust.vehicleYear] : []);
    if(required.some(function(v){ return !v; })){
      alert('Please fill in all required fields before continuing.');
      return false;
    }
    if(!qs('agreeInfo').checked || !qs('agreeTerms').checked){
      alert('Please confirm the checkboxes before continuing.');
      return false;
    }
    if(state.plan === 'tagplan' && qs('hcYes').classList.contains('active') && !qs('hcAgree').checked){
      alert('Please agree to the Hive Credits Terms & Conditions.');
      return false;
    }
    if(state.flexible && qs('flexiAgree') && !qs('flexiAgree').checked){
      alert('Please agree to the Flexible Payment terms.');
      return false;
    }
    return true;
  }

  function buildOrderPayload(cust){
    var total = Number(qs('orderSummary').dataset.total || 0);
    var dueNow = Number(qs('orderSummary').dataset.dueNow || total);
    var addons = [];
    HARDWARE_ADDONS.forEach(function(a){ if(state.hardwareAddons[a.id]) addons.push(a.label); });
    SOFTWARE_ADDONS.forEach(function(a){ if(state.softwareAddons[a.id]) addons.push(a.label + ' (software)'); });
    var payload = {
      planType: state.plan,
      plan: state.plan === 'tagplan' ? 'Tag Plan' : PLANS[state.plan].name,
      billing: state.plan === 'tagplan' ? 'One-time + free trial' : state.billing,
      totalAmount: fmt(total),
      surname: cust.surname, firstName: cust.firstName, otherName: cust.otherName,
      phone: cust.phone, whatsapp: cust.whatsapp, email: cust.email,
      state: cust.state, city: cust.city, houseNo: cust.houseNo, street: cust.street, landmark: cust.landmark,
      tagCount: cust.tagCount, tagUse: cust.tagUse,
      address: cust.address, vehicleType: cust.vehicleType, vehicleYear: cust.vehicleYear, vehCount: cust.vehCount,
      fleetNote: cust.fleetNote, installCity: cust.installCity, installOption: cust.installOption,
      installDate: cust.installDate, installTime: cust.installTime,
      addons: addons.join(', '),
      addedPlans: state.addedPlans.map(addedPlanLabel).join('; '),
      hiveCredits: state.hiveCredits ? fmt(state.hiveCredits) : null,
      flexiblePayment: state.flexible,
      timestamp: new Date().toLocaleString()
    };
    if(state.flexible){
      var split = splitFlexible(total);
      payload.amountDueNow = fmt(split.dueNow);
      payload.remainingBalance = fmt(split.remaining);
      payload.monthlyInstallment = fmt(split.monthly);
      payload.remainingMonths = 3;
    }
    return payload;
  }

  // ---------------- Paystack ----------------
  document.addEventListener('DOMContentLoaded', function(){
    var btn = qs('btnPaystack');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var cust = collectCustomer();
      if(!validate(cust)) return;
      var total = Number(qs('orderSummary').dataset.total || 0);
      if(!total){ alert('Please select a plan first.'); return; }
      // CRITICAL: when Flexible Payment is on, only charge 50% of the total
      // at checkout today — never the full amount. dueNow already reflects
      // this (see updateSummary/splitFlexible); it equals total when
      // Flexible Payment is off.
      var dueNow = Number(qs('orderSummary').dataset.dueNow || total);

      btn.disabled = true; btn.textContent = 'Redirecting to Paystack…';
      var payload = buildOrderPayload(cust);

      // hardwareAddonIds / softwareAddonIds / addedPlansData carry the raw
      // selection ids/structure (not just the human-readable label strings
      // in `addons` / `addedPlans`) so paystack-initialize.js can
      // independently recompute the order total server-side via
      // _pricing.js instead of trusting `totalAmount` on its own.
      var hardwareAddonIds = [];
      HARDWARE_ADDONS.forEach(function(a){ if(state.hardwareAddons[a.id]) hardwareAddonIds.push(a.id); });
      var softwareAddonIds = [];
      SOFTWARE_ADDONS.forEach(function(a){ if(state.softwareAddons[a.id]) softwareAddonIds.push(a.id); });
      var addedPlansData = state.addedPlans.map(function(entry){
        return entry.plan === 'tagplan'
          ? { plan:'tagplan', count: entry.count }
          : { plan: entry.plan, vehicleType: entry.vehicleType, vehicleYear: entry.vehicleYear, count: entry.count, billing: state.billing };
      });

      var metadata = {
        plan: payload.plan, planType: state.plan, billing: payload.billing,
        customerName: [cust.surname, cust.firstName].filter(Boolean).join(' '), phone: cust.phone,
        totalAmount: total, flexible: state.flexible,
        vehicleType: cust.vehicleType || null, vehicleYear: cust.vehicleYear || null, vehCount: cust.vehCount || null,
        tagCount: cust.tagCount || null, tagUse: cust.tagUse || null,
        location: [cust.city || cust.installCity, cust.state].filter(Boolean).join(', ') || cust.address || null,
        addons: payload.addons || null, addedPlans: payload.addedPlans || null,
        hardwareAddonIds: hardwareAddonIds, softwareAddonIds: softwareAddonIds, addedPlansData: addedPlansData,
        hiveCredits: state.hiveCredits || null
      };
      if(state.flexible){
        var split = splitFlexible(total);
        metadata.remainingBalance = split.remaining;
        metadata.monthlyInstallment = split.monthly;
        metadata.remainingMonths = 3;
      }

      fetch('/.netlify/functions/paystack-initialize', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          email: cust.email,
          amount: dueNow,
          callback_url: window.location.origin + window.location.pathname + '?plan=' + state.plan,
          metadata: metadata
        })
      }).then(function(res){ return res.json().then(function(data){ return {ok:res.ok, data:data}; }); })
        .then(function(r){
          if(r.ok && r.data.authorization_url){
            window.location.href = r.data.authorization_url;
          } else {
            btn.disabled = false; btn.textContent = 'Proceed to Payment';
            qs('paystackMsg').textContent = 'Payment could not be started. This usually means Paystack has not been configured yet on the server, please use Bank Transfer, or contact FleetHive.';
          }
        }).catch(function(){
          btn.disabled = false; btn.textContent = 'Proceed to Payment';
          qs('paystackMsg').textContent = 'Payment could not be started. Please use Bank Transfer, or contact FleetHive.';
        });
    });
  });

  function verifyPaystack(reference){
    fetch('/.netlify/functions/paystack-verify?reference=' + encodeURIComponent(reference))
      .then(function(res){ return res.json(); })
      .then(function(data){
        var wrap = qs('resultPanelWrap');
        if(!wrap) return;
        if(data.success){
          var meta = data.metadata || {};
          var flexRows = '';
          if(meta.flexible){
            flexRows =
              '<div class="order-line"><span>Total Order Amount</span><span>' + fmt(meta.totalAmount) + '</span></div>' +
              '<div class="order-line"><span>Amount Paid Today</span><span>' + fmt(data.amount) + '</span></div>' +
              '<div class="order-line"><span>Remaining Balance</span><span>' + fmt(meta.remainingBalance) + '</span></div>' +
              '<div class="order-line"><span>Monthly Installment</span><span>' + fmt(meta.monthlyInstallment) + '/mo for ' + (meta.remainingMonths || 3) + ' months</span></div>';
          }
          wrap.innerHTML =
            '<div class="result-panel"><div class="rp-icon">🎉</div><h2>Payment Successful, Welcome to FleetHive!</h2>' +
            '<p>Your FleetHive ' + (meta.plan || 'order') + ' has been received. For installation requests, our team will contact you within 24 hours. A confirmation email with your order details is on its way to your inbox.</p>' +
            '<div class="rp-details">' +
              '<div class="order-line"><span>Plan</span><span>' + (meta.plan || '—') + '</span></div>' +
              '<div class="order-line"><span>Amount Paid</span><span>' + fmt(data.amount) + '</span></div>' +
              flexRows +
              '<div class="order-line"><span>Reference</span><span>' + data.reference + '</span></div>' +
            '</div>' +
            '<a href="index.html" class="btn btn-primary" style="margin-top:18px; justify-content:center;">Continue to FleetHive</a>' +
            '</div>';
          // Payment is a "meaningfully changed" interaction per the popup
          // frequency rules — let the newsletter popup become eligible again,
          // still subject to the 4-minute/newsletter-subscribed guards.
          if(window.fhTriggerPopup){ setTimeout(window.fhTriggerPopup, 2000); }
        } else {
          wrap.innerHTML = '<div class="result-panel pending"><div class="rp-icon">⏳</div><h2>Payment Not Confirmed</h2><p>We could not confirm this payment. If you were charged, please contact FleetHive support with your reference: ' + reference + '</p></div>';
        }
        wrap.scrollIntoView({ behavior:'smooth' });
      }).catch(function(){});
  }

  // ---------------- Bank Transfer ----------------
  document.addEventListener('DOMContentLoaded', function(){
    var btn = qs('btnBankDone');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var cust = collectCustomer();
      if(!validate(cust)) return;
      var total = Number(qs('orderSummary').dataset.total || 0);
      if(!total){ alert('Please select a plan first.'); return; }

      btn.disabled = true; btn.textContent = 'Submitting…';
      var payload = buildOrderPayload(cust);
      payload.paymentMethod = 'Bank Transfer';
      payload.paymentStatus = 'PENDING VERIFICATION';

      fetch('/.netlify/functions/send-order', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      }).then(function(res){
        btn.disabled = false; btn.textContent = 'I Have Made the Transfer';
        var wrap = qs('resultPanelWrap');
        if(res.ok){
          wrap.innerHTML =
            '<div class="result-panel pending"><div class="rp-icon">⏳</div><h2>Payment Pending Verification</h2>' +
            '<p>Your ' + (state.plan === 'tagplan' ? 'FleetHive Tag Plan order' : 'FleetHive order') + ' has been received. ' +
            (state.plan === 'tagplan' ? 'Your FleetTag order will be processed for delivery to the address provided. If Hive Credits were selected, they will be added to your account after verification. ' : 'For installation requests, our team will contact you within 24 hours. ') +
            'Our team will confirm your transfer and follow up shortly.</p>' +
            '<a href="index.html" class="btn btn-outline" style="margin-top:18px; justify-content:center;">Continue to FleetHive</a>' +
            '</div>';
        } else {
          qs('bankMsg').textContent = "We couldn't submit your details automatically. Please WhatsApp us at +234 702 577 1522 with your payment proof.";
        }
        wrap.scrollIntoView({ behavior:'smooth' });
      }).catch(function(){
        btn.disabled = false; btn.textContent = 'I Have Made the Transfer';
        qs('bankMsg').textContent = "We couldn't submit your details automatically. Please WhatsApp us at +234 702 577 1522 with your payment proof.";
      });
    });
  });

  // ---------------- FAQ accordion ----------------
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('.faq-item').forEach(function(item){
      var q = item.querySelector('.faq-q');
      var a = item.querySelector('.faq-a');
      if(!q || !a) return;
      q.addEventListener('click', function(){
        var wasOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function(other){
          if(other !== item){
            other.classList.remove('open');
            other.querySelector('.faq-a').style.maxHeight = null;
          }
        });
        if(wasOpen){
          item.classList.remove('open');
          a.style.maxHeight = null;
        } else {
          item.classList.add('open');
          a.style.maxHeight = a.scrollHeight + 'px';
        }
      });
    });
  });
})();
