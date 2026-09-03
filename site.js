// ===== Mobile menu =====
function fhToggleMobile(){
  document.getElementById('mp').classList.toggle('open');
  var btn = document.getElementById('mobileToggleBtn');
  if(btn) btn.classList.toggle('active');
}

// ===== Light / Dark theme =====
(function(){
  var saved = localStorage.getItem('fh-theme');
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = saved || (systemDark ? 'dark' : 'light');
  if(theme === 'light'){ document.documentElement.setAttribute('data-theme','light'); }
})();
function fhSetThemeIcon(){
  var isLight = document.documentElement.getAttribute('data-theme') === 'light';
  ['themeIconMoon'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.innerHTML = isLight
      ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/>'
      : '<path d="M21 12.5A9 9 0 1 1 11.5 3 7 7 0 0 0 21 12.5z"/>';
  });
}
function fhToggleTheme(){
  var html = document.documentElement;
  var isLight = html.getAttribute('data-theme') === 'light';
  if(isLight){ html.removeAttribute('data-theme'); localStorage.setItem('fh-theme','dark'); }
  else { html.setAttribute('data-theme','light'); localStorage.setItem('fh-theme','light'); }
  fhSetThemeIcon();
}
document.addEventListener('DOMContentLoaded', function(){
  fhSetThemeIcon();
  var t1 = document.getElementById('themeToggle');
  var t2 = document.getElementById('themeToggleMobile');
  if(t1) t1.addEventListener('click', fhToggleTheme);
  if(t2) t2.addEventListener('click', fhToggleTheme);
});

// ===== Reveal on scroll =====
document.addEventListener('DOMContentLoaded', function(){
  var els = document.querySelectorAll('.reveal, .reveal-stagger');
  if('IntersectionObserver' in window){
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); } });
    }, {threshold:0.15});
    els.forEach(function(el){ obs.observe(el); });
  } else { els.forEach(function(el){ el.classList.add('in'); }); }
});

// ===== Global button click bloom =====
document.addEventListener('click', function(e){
  var btn = e.target.closest('.btn, .hc-arrow, .pc-arrow, .sc-arrow, .wa-float, .bree-launcher, .price-card .btn');
  if(!btn) return;
  var rect = btn.getBoundingClientRect();
  var bloom = document.createElement('span');
  bloom.className = 'btn-bloom';
  var x = (e.clientX ? e.clientX - rect.left : rect.width/2);
  var y = (e.clientY ? e.clientY - rect.top : rect.height/2);
  bloom.style.left = x + 'px';
  bloom.style.top = y + 'px';
  btn.style.position = btn.style.position || 'relative';
  btn.appendChild(bloom);
  setTimeout(function(){ bloom.remove(); }, 700);
});

// ===== Generic carousel factory =====
function makeCarousel(opts){
  var root = document.getElementById(opts.rootId);
  if(!root) return null;
  var slides = root.querySelectorAll(opts.slideSel);
  var dots = root.querySelectorAll(opts.dotSel);
  var idx = 0, timer = null;
  var captionEl = opts.captionId ? document.getElementById(opts.captionId) : null;
  var counterEl = opts.counterId ? document.getElementById(opts.counterId) : null;
  var captions = opts.captions || [];

  function pad(n){ return n < 10 ? '0'+n : ''+n; }

  function render(){
    slides.forEach(function(s,i){
      s.classList.remove('active','prev');
      if(i === idx) s.classList.add('active');
      else if(i === (idx - 1 + slides.length) % slides.length) s.classList.add('prev');
    });
    dots.forEach(function(d,i){ d.classList.toggle('active', i === idx); });
    if(captionEl && captions.length){
      captionEl.style.opacity = 0;
      captionEl.style.transform = 'translateY(6px)';
      setTimeout(function(){
        captionEl.textContent = captions[idx];
        captionEl.style.opacity = 1;
        captionEl.style.transform = 'translateY(0)';
      }, 180);
    }
    if(counterEl){
      counterEl.textContent = pad(idx+1) + ' / ' + pad(slides.length);
    }
    if(opts.onChange) opts.onChange(idx);
    if(opts.scanEl){
      var se = document.getElementById(opts.scanEl);
      if(se){ se.classList.remove('scanning'); void se.offsetWidth; se.classList.add('scanning'); }
    }
  }
  function go(n){ idx = (n + slides.length) % slides.length; render(); }
  function next(){ go(idx+1); }
  function prev(){ go(idx-1); }
  function play(){ stop(); timer = setInterval(next, opts.interval || 5500); }
  function stop(){ if(timer) clearInterval(timer); }

  dots.forEach(function(d,i){ d.addEventListener('click', function(){ go(i); play(); }); });
  if(opts.nextSel){ root.querySelectorAll(opts.nextSel).forEach(function(b){ b.addEventListener('click', function(){ next(); play(); }); }); }
  if(opts.prevSel){ root.querySelectorAll(opts.prevSel).forEach(function(b){ b.addEventListener('click', function(){ prev(); play(); }); }); }

  var startX = null;
  root.addEventListener('touchstart', function(e){ startX = e.touches[0].clientX; stop(); }, {passive:true});
  root.addEventListener('touchend', function(e){
    if(startX === null) return;
    var dx = e.changedTouches[0].clientX - startX;
    if(dx > 40) prev(); else if(dx < -40) next();
    startX = null; play();
  }, {passive:true});
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', play);

  render();
  play();
  return {go:go, next:next, prev:prev, play:play, stop:stop};
}

document.addEventListener('DOMContentLoaded', function(){
  makeCarousel({ rootId:'heroCarousel', slideSel:'.hc-slide', dotSel:'.hc-dot', nextSel:'.hc-arrow.right', prevSel:'.hc-arrow.left', interval:2500 });

  makeCarousel({
    rootId:'platformCarousel', slideSel:'.pc-slide', dotSel:'.pc-dot',
    nextSel:'.pc-arrow.right', prevSel:'.pc-arrow.left', interval:6000,
    captionId:'pcCaption', counterId:'pcCounter', scanEl:'pcStage',
    captions:['LIVE TRACKING','TRIP INTELLIGENCE','SMART ALERT','SMART ZONES','VEHICLE INTELLIGENCE']
  });

  var hiwItems = document.querySelectorAll('.hiw-li');
  var hiwCarousel = makeCarousel({
    rootId:'hiwCarousel', slideSel:'.hiw-slide', dotSel:'.hiw-dot-none',
    interval:2500, scanEl:'hiwVisual',
    onChange:function(i){
      hiwItems.forEach(function(li,j){ li.classList.toggle('active', j===i); });
    }
  });
  hiwItems.forEach(function(li,i){
    li.addEventListener('click', function(){ if(hiwCarousel){ hiwCarousel.go(i); hiwCarousel.play(); } });
  });
});

// ===== Numbers counters =====
document.addEventListener('DOMContentLoaded', function(){
  var section = document.getElementById('numbers');
  if(!section) return;
  var nums = section.querySelectorAll('.num-value');
  var running = false;
  function resetCounters(){
    nums.forEach(function(el){
      var suffix = el.getAttribute('data-suffix') || '';
      el.innerHTML = '0<span class="plus">' + suffix + '</span>';
    });
  }
  function animateCounters(){
    if(running) return; running = true;
    nums.forEach(function(el){
      var target = parseFloat(el.getAttribute('data-target'));
      var suffix = el.getAttribute('data-suffix') || '';
      var dur = 1600, start = null;
      function step(ts){
        if(!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = Math.round(target * eased);
        el.innerHTML = val.toLocaleString() + '<span class="plus">' + suffix + '</span>';
        if(p < 1) requestAnimationFrame(step); else if(el === nums[nums.length-1]) running = false;
      }
      requestAnimationFrame(step);
    });
  }
  // Numbers animate every time the section is re-entered, not just once.
  resetCounters();
  if('IntersectionObserver' in window){
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ animateCounters(); }
        else { running = false; resetCounters(); }
      });
    }, {threshold:0.4});
    obs.observe(section);
  } else { animateCounters(); }
});

// ===== Section indicator (desktop + mobile) — robust scrollspy =====
document.addEventListener('DOMContentLoaded', function(){
  var items = document.querySelectorAll('.si-item');
  var mobileDots = document.querySelectorAll('.sim-dot');
  if(!items.length && !mobileDots.length) return;
  var targets = items.length ? items : mobileDots;
  var sections = Array.prototype.map.call(targets, function(i){ return document.getElementById(i.getAttribute('data-target')); });

  function bindClick(el){
    el.addEventListener('click', function(){
      var target = document.getElementById(el.getAttribute('data-target'));
      if(target) target.scrollIntoView({behavior:'smooth'});
    });
  }
  items.forEach(bindClick);
  mobileDots.forEach(bindClick);

  var ticking = false;
  function updateActive(){
    var pivot = window.innerHeight * 0.35;
    var bestIdx = 0, bestDist = Infinity;
    sections.forEach(function(s, i){
      if(!s) return;
      var r = s.getBoundingClientRect();
      var dist = Math.abs(r.top - pivot);
      if(r.top <= pivot && dist < bestDist){ bestDist = dist; bestIdx = i; }
    });
    items.forEach(function(it, i){ it.classList.toggle('active', i === bestIdx); });
    mobileDots.forEach(function(it, i){ it.classList.toggle('active', i === bestIdx); });
    ticking = false;
  }
  window.addEventListener('scroll', function(){
    if(!ticking){ requestAnimationFrame(updateActive); ticking = true; }
  }, {passive:true});
  updateActive();
});

// ===== Problem / Why liquid wave — touch support with guaranteed reset =====
document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('.problem-card, .why-card, .leader-card').forEach(function(card){
    var resetTimer = null;
    card.addEventListener('touchstart', function(){
      card.classList.add('touched');
      clearTimeout(resetTimer);
      resetTimer = setTimeout(function(){ card.classList.remove('touched'); }, 1800);
    }, {passive:true});
    card.addEventListener('touchend', function(){
      clearTimeout(resetTimer);
      resetTimer = setTimeout(function(){ card.classList.remove('touched'); }, 900);
    }, {passive:true});
  });
});

// ===== Pricing monthly/annual toggle =====
document.addEventListener('DOMContentLoaded', function(){
  var sw = document.getElementById('priceToggle');
  if(!sw) return;
  var monthlyLabel = document.getElementById('ptMonthly');
  var annualLabel = document.getElementById('ptAnnual');
  var amounts = document.querySelectorAll('.price-amt-wrap');
  var plans = {lite:{m:4000, y:42000}, pro:{m:6000, y:60000}, prime:{m:12000, y:120000}, tagplan:{m:3000, y:30000}};
  var saveNotes = document.querySelectorAll('.price-save-note');

  function render(annual){
    sw.classList.toggle('annual', annual);
    monthlyLabel.classList.toggle('active', !annual);
    annualLabel.classList.toggle('active', annual);
    amounts.forEach(function(wrap){
      var plan = wrap.getAttribute('data-plan');
      var el = wrap.querySelector('.price-amt');
      el.classList.add('swap');
      setTimeout(function(){
        if(annual){
          el.innerHTML = '₦' + plans[plan].y.toLocaleString() + '<span>/yr</span>';
        } else {
          el.innerHTML = '₦' + plans[plan].m.toLocaleString() + '<span>/mo</span>';
        }
        el.classList.remove('swap');
      }, 160);
    });
    saveNotes.forEach(function(note){ note.style.display = annual ? '' : 'none'; });
  }
  sw.addEventListener('click', function(){ render(!sw.classList.contains('annual')); });
  render(false);
});

function fhChoosePlan(plan){
  var annual = document.getElementById('priceToggle') && document.getElementById('priceToggle').classList.contains('annual');
  window.location.href = 'pricing.html?plan=' + encodeURIComponent(plan) + '&billing=' + (annual ? 'annual' : 'monthly');
}

// ===== Stories: tabs + depth carousel =====
document.addEventListener('DOMContentLoaded', function(){
  var track = document.getElementById('storiesTrack');
  if(!track) return;
  var tabs = document.querySelectorAll('.sc-tab');
  var cards = track.querySelectorAll('.story-card');
  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){
      tabs.forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      var group = tab.getAttribute('data-group');
      cards.forEach(function(c){
        c.style.display = (group === 'all' || c.getAttribute('data-group') === group) ? '' : 'none';
      });
      track.scrollTo({left:0, behavior:'smooth'});
    });
  });
  var leftBtn = document.querySelector('.sc-arrow.left');
  var rightBtn = document.querySelector('.sc-arrow.right');
  if(leftBtn) leftBtn.addEventListener('click', function(){ track.scrollBy({left:-360, behavior:'smooth'}); });
  if(rightBtn) rightBtn.addEventListener('click', function(){ track.scrollBy({left:360, behavior:'smooth'}); });

  // auto-slide
  var autoTimer = setInterval(function(){
    if(track.scrollLeft + track.clientWidth >= track.scrollWidth - 10){
      track.scrollTo({left:0, behavior:'smooth'});
    } else {
      track.scrollBy({left:360, behavior:'smooth'});
    }
  }, 3000);
  track.addEventListener('mouseenter', function(){ clearInterval(autoTimer); });
  track.addEventListener('touchstart', function(){ clearInterval(autoTimer); }, {passive:true});

  // depth effect on center-most card
  function updateDepth(){
    var center = track.scrollLeft + track.clientWidth/2;
    cards.forEach(function(c){
      var cCenter = c.offsetLeft + c.offsetWidth/2;
      var dist = Math.abs(center - cCenter);
      c.classList.toggle('sc-center', dist < c.offsetWidth*0.6);
      c.classList.toggle('sc-side', dist >= c.offsetWidth*0.6);
    });
  }
  track.addEventListener('scroll', updateDepth, {passive:true});
  updateDepth();
});

// ===== BREE — FleetHive digital rep + AI sales assistant (frontend rule-engine, no live LLM) =====
// Honesty note for future maintainers: Bree runs entirely in the browser using keyword/pattern
// matching, slot-filling and templated responses — not a hosted language model. She never invents
// FleetHive facts (prices, features, stats) beyond what's defined in KNOWN below. Turning her into
// a true natural-language assistant would mean connecting a real LLM through a backend (so the API
// key isn't exposed client-side) — a separate, small build.
document.addEventListener('DOMContentLoaded', function(){
  var launcher = document.getElementById('breeLauncher');
  var panel = document.getElementById('breePanel');
  var closeBtn = document.getElementById('breeClose');
  var body = document.getElementById('breeBody');
  var input = document.getElementById('breeInput');
  var sendBtn = document.getElementById('breeSend');
  if(!launcher || !panel) return;

  // ---------- Verified FleetHive facts only (centralized in bree-knowledge.js) ----------
  var KNOWN = window.BREE_KB || {
    plans: {
      lite:  {name:'Lite',  price:'₦4,000/mo (₦42,000/yr)',  fit:'a single personal vehicle, mainly for location and trip history'},
      pro:   {name:'Pro',   price:'₦6,000/mo (₦60,000/yr)',  fit:'small business fleets that need fuel and driver oversight, not just location'},
      prime: {name:"Prime", price:"₦12,000/mo (₦120,000/yr)", fit:"fleets that want FleetHive's team actively monitoring and reporting alongside them"}
    },
    solutions: {
      tracking:  'Live Vehicle Tracking — real-time location, so you know where a vehicle is without depending on phone calls.',
      trips:     'Trips & Activity — a clear history of where a vehicle has been and how it\'s being used.',
      alerts:    'Smart Alerts — notified the moment something needs attention, instead of finding out later.',
      zones:     'Smart Zones — set routes and no-go areas, and get told the moment a vehicle leaves them.',
      intel:     'Vehicle Intelligence — raw activity turned into information you can actually act on.',
      tags:      'Fleet Tags — tracking for assets beyond vehicles, for things you move but can\'t install a full device on.'
    },
    tagPlan: {
      startCost: '₦35,000 for one FleetTag',
      free: 'the first 3 months of tracking are free',
      renewal: 'then ₦3,000/mo or ₦30,000/yr (saves ₦6,000 a year)',
      note: 'the ₦3,000/mo and ₦30,000/yr prices are renewal prices — they are not charged at purchase, only ₦35,000 per tag is charged upfront',
      uses: 'packages, orders, assets, vehicles and other trackable items'
    },
    hiveCredits: {
      desc: 'Hive Credits are prepaid credits for tracking and support services, separate from the Tag Plan subscription — they are not compulsory and not the same as the renewal fee',
      amounts: '₦5,000, ₦10,000, ₦20,000, ₦50,000 or a custom amount'
    },
    installation: {
      locations: ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu'],
      outsideLocations: "Let me connect you with the FleetHive team so we can confirm the available installation option for your location."
    }
  };

  function tagPlanCost(n){
    n = parseInt(n, 10) || 1;
    return '₦' + (35000 * n).toLocaleString('en-NG') + ' for ' + n + (n === 1 ? ' FleetTag' : ' FleetTags');
  }

  // ---------- Conversion layer: dynamic CTAs (real destinations only, never invented) ----------
  var DEST = (KNOWN.destinations) || {};
  var WA_BASE = (KNOWN.contact && KNOWN.contact.whatsapp) || 'https://wa.me/2347025771522';
  var CTA = {
    pricing:    {label:'View Pricing',        href: DEST.pricing    || 'pricing.html'},
    lite:       {label:'Start with Lite',     href: DEST.lite       || 'pricing.html?plan=lite'},
    pro:        {label:'View Pro',            href: DEST.pro        || 'pricing.html?plan=pro'},
    prime:      {label:'View Prime',          href: DEST.prime      || 'pricing.html?plan=prime'},
    tagplan:    {label:'View Tag Plan',       href: DEST.tagPlan    || 'pricing.html?plan=tagplan'},
    getTagPlan: {label:'Get Tag Plan',        href: DEST.tagPlan    || 'pricing.html?plan=tagplan'},
    getStarted: {label:'Get Started',         href: DEST.pricing    || 'pricing.html'},
    partner:    {label:'Become a Partner',    href: DEST.partnerApply || 'partners.html#partner-application'},
    howItWorks: {label:'How FleetHive Works', href: DEST.howItWorks || 'how-it-works.html'},
    contact:    {label:'Contact an Agent',    href: DEST.contact    || 'contact.html'},
    whatsapp:   {label:'WhatsApp Us',         href: WA_BASE},
    login:      {label:'Login',               href: DEST.login      || 'https://app.fleethive.in'}
  };
  // Renders a real CTA button (never a fabricated link) from the registry above.
  function addCTA(key, opts){
    var c = CTA[key];
    if(!c) return;
    var href = c.href;
    if(key === 'whatsapp' && opts && opts.context){
      href = WA_BASE + (WA_BASE.indexOf('?') === -1 ? '?' : '&') + 'text=' + encodeURIComponent('Hi FleetHive, ' + opts.context);
    }
    addLink(c.label, href);
  }
  // A conversational quick-reply (not a page link) — feeds the label back into Bree
  // as if the visitor typed it, used for "Help Me Choose" style comparison prompts.
  function addQuickReply(label, message){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline';
    btn.style.cssText = 'margin:4px 0 10px; padding:9px 16px; font-size:11.5px; align-self:flex-start;';
    btn.textContent = label;
    btn.addEventListener('click', function(){ handleUserMessage(message); });
    body.appendChild(btn);
    body.scrollTop = body.scrollHeight;
  }
  // A button that starts the lead-capture flow directly, without adding a fake
  // user message to the transcript.
  function addLeadCaptureButton(label){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline';
    btn.style.cssText = 'margin:4px 0 10px; padding:9px 16px; font-size:11.5px; align-self:flex-start;';
    btn.textContent = label;
    btn.addEventListener('click', function(){ startLeadFlow(); });
    body.appendChild(btn);
    body.scrollTop = body.scrollHeight;
  }

  // Small word-number map so "three tags" / "five vehicles" parse the same as "3 tags" / "5 vehicles"
  var WORD_NUM = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  function wordOrDigitToNum(str){
    if(!str) return null;
    var s = str.toLowerCase().trim();
    if(WORD_NUM.hasOwnProperty(s)) return WORD_NUM[s];
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }
  var NUM_WORD_PATTERN = '(\\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)';

  function addMsg(text, who){
    var d = document.createElement('div');
    d.className = 'bree-msg ' + who;
    d.textContent = text;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }
  function addLink(label, href){
    var link = document.createElement('a');
    link.href = href;
    link.className = 'btn btn-primary';
    link.style.cssText = 'margin:4px 0 10px; padding:9px 16px; font-size:11.5px; align-self:flex-start;';
    link.textContent = label;
    link.target = href.indexOf('mailto:') === 0 ? '_blank' : '_self';
    body.appendChild(link);
    body.scrollTop = body.scrollHeight;
  }

  // ---------- Conversation memory (slot filling) ----------
  var slot = {name:null, email:null, phone:null, location:null, fleetSize:null, vehicleType:null,
              customerType:null, primaryProblem:null, planInterest:null, partnership:false, tagCount:null};
  var intent = 'INFORMATIONAL';
  var askedName=false, askedEmail=false;

  function bumpIntent(to){
    var order = ['INFORMATIONAL','INTERESTED','QUALIFIED','READY TO CONVERT'];
    if(order.indexOf(to) > order.indexOf(intent)) intent = to;
  }

  function extractSlots(msg){
    var m = msg.toLowerCase();
    // Allows up to two words between the number and the unit noun (e.g. "10 company
    // vehicles", "5 delivery vans") instead of requiring them to sit right next to
    // each other, so fleet size is still captured with a descriptive word in between.
    var numMatch = m.match(new RegExp(NUM_WORD_PATTERN + '(?:\\s+\\w+){0,2}?\\s*(vehicles?|cars?|vans?|trucks?|bikes?|buses?|fleet|items?|orders?|packages?|parcels?|assets?|trackers?)'));
    if(numMatch){ var fn = wordOrDigitToNum(numMatch[1]); if(fn) slot.fleetSize = fn; }
    if(/business|company|our drivers|our fleet|delivery|logistics|staff/.test(m)) slot.customerType = 'business';
    if(/my car|personal|just one car|private/.test(m)) slot.customerType = 'private';
    if(/\bvan\b/.test(m)) slot.vehicleType = 'van';
    else if(/\btruck/.test(m)) slot.vehicleType = 'truck';
    else if(/\bbike|motorcycle/.test(m)) slot.vehicleType = 'bike';
    else if(/\bbus/.test(m)) slot.vehicleType = 'bus';
    else if(/heavy equipment/.test(m)) slot.vehicleType = 'heavy equipment';
    else if(/tricycle|keke/.test(m)) slot.vehicleType = 'tricycle';
    else if(/package|parcel|\border\b|\basset\b/.test(m)) slot.vehicleType = slot.vehicleType || 'package';
    else if(/\bcar\b/.test(m) && !slot.vehicleType) slot.vehicleType = 'car';
    if(/lagos|abuja|port harcourt|ibadan|kano|enugu|kaduna/.test(m)){
      var loc = m.match(/lagos|abuja|port harcourt|ibadan|kano|enugu|kaduna/);
      if(loc) slot.location = loc[0];
    }
    var emailMatch = msg.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
    if(emailMatch) slot.email = emailMatch[0];
    var phoneMatch = msg.match(/(\+?\d[\d\s-]{7,14}\d)/);
    if(phoneMatch) slot.phone = phoneMatch[0];
    if(/partner|reseller|install for others|sell fleethive/.test(m)) slot.partnership = true;
    var tagMatch = m.match(new RegExp(NUM_WORD_PATTERN + '\\s*(fleettags?|tags?)'));
    if(tagMatch){ var tn = wordOrDigitToNum(tagMatch[1]); if(tn) slot.tagCount = tn; }
    if(/package|parcel|order|asset\b/.test(m)) slot.primaryProblem = slot.primaryProblem || 'package/asset tracking';
  }

  function recommendPlan(){
    if(slot.partnership) return null;
    if(slot.fleetSize && slot.fleetSize >= 15) return 'prime';
    if(slot.customerType === 'business' || (slot.fleetSize && slot.fleetSize > 1)) return 'pro';
    // Only default to Lite once we actually know something (a customer type or a
    // fleet size) — with zero information, return null so callers ask a question
    // instead of guessing a plan for the visitor.
    if(slot.customerType || slot.fleetSize) return 'lite';
    return null;
  }

  // ---------- Objection handling ----------
  var OBJECTIONS = [
    {t:/why (do|would) i need|why fleethive|why should i/, a:function(){
      return "Fair question. Most people find out the hard way — a vehicle used somewhere unexpected, fuel that doesn't add up, or just not knowing where a car is right now. FleetHive replaces that guessing with a live answer whenever you check."; }},
    {t:/expensive|too much money|can'?t afford|too costly|too pricey/, a:function(){
      return "I understand. The right option depends on what you actually need. If you're mainly looking for straightforward vehicle tracking, Lite is the simplest starting point at ₦4,000/mo. Would you like me to show you what it includes?"; }},
    {t:/only (have |own )?(one|1) (car|vehicle)/, a:function(){
      slot.customerType = 'private'; slot.fleetSize = 1;
      return "That's exactly what Lite is built for — real-time location and trip history for a single vehicle, at ₦4,000/mo. No need for anything heavier."; }},
    {t:/(\d{2,4})\s*vehicles|large fleet|50 vehicles/, a:function(){
      return "For a fleet that size, Prime tends to make the most sense — it adds managed support and monthly reporting on top of everything in Pro, so you're not the only one watching it. Want me to note your fleet size for the team?"; }},
    {t:/worth (it |paying )?monthly|is it worth/, a:function(){
      return "Most customers tell us the value shows up in the first month — either fuel usage that suddenly makes sense, or just not having to call a driver to ask where they are. It's priced per vehicle so you only pay for what you're tracking."; }},
    {t:/what makes fleethive different|why not just|competitor/, a:function(){
      return "The honest answer: it's the combination — tracking, driver behaviour, fuel intelligence and (on Prime) an actual support team, in one dashboard instead of stitched-together tools."; }},
    {t:/how does installation work|installation/, a:function(){
      return "A technician installs the FleetHive tracking device in your vehicle, it connects to the platform, and your dashboard goes live the same day — no long onboarding."; }},
    {t:/(don'?t know|not sure) which plan/, a:function(){
      return "No problem — tell me roughly how many vehicles you're looking to track and whether it's personal or for a business, and I'll point you to the plan that fits."; }},
    {t:/how will this help my business/, a:function(){
      return "Concretely: less time chasing drivers by phone, an actual record when something goes wrong, and (on Pro/Prime) visibility into fuel use and driving behaviour you currently can't see at all."; }},
    {t:/don'?t think i need tracking/, a:function(){
      return "That's fair if nothing's gone wrong yet — most people look into FleetHive right after something has (a vehicle went somewhere unexpected, fuel came up short). Happy to just leave the info here if that's useful later."; }}
  ];

  // ---------- Feature → benefit KB (problem -> feature -> benefit -> next step) ----------
  var KB = [
    {k:['price','pricing','cost','how much'], a:function(){
      bumpIntent('INTERESTED');
      return "FleetHive is priced per vehicle: Lite ₦4,000/mo, Pro ₦6,000/mo, Prime ₦12,000/mo (annual options save a bit on each). " + planSuggestion();
    }},
    {k:['lite','simple tracking','basic tracking','just tracking','small car','personal car','private car'], a:function(){ slot.customerType = slot.customerType || 'private'; return "Lite (₦4,000/mo): " + KNOWN.plans.lite.fit + " — real-time GPS tracking, trip history & playback, basic geofencing, single-user dashboard."; }},
    {k:['pro','business fleet'], a:function(){ slot.customerType='business'; return "Pro (₦6,000/mo): " + KNOWN.plans.pro.fit + " — everything in Lite, plus fuel intelligence & theft detection, driver behaviour scoring, multi-user analytics."; }},
    {k:['prime','premium','advanced tracking','advanced fleet intelligence','heavy fleet'], a:function(){ return "Prime (₦12,000/mo): " + KNOWN.plans.prime.fit + " — everything in Pro, plus managed fleet support, monthly reports, priority escalation."; }},
    {k:['fuel monitoring','fuel intelligence','engine data'], a:function(){ bumpIntent('INTERESTED'); return "Fuel intelligence is part of Pro and Prime — you get fuel-use data alongside location and driver behaviour, not just where the vehicle is."; }},
    // Tag Plan keywords are checked BEFORE the generic 'track/tracking' entry and BEFORE the
    // fleet 'delivery' entry below, so package/order/customer-delivery tracking is never
    // misread as vehicle tracking or a fleet-of-drivers question.
    {k:['tag plan','fleettag','fleet tag','track a package','track my package','track order','track my order','parcel','track package','package tracking','parcel tracking','order tracking','asset tracking','track delivery','track deliveries','customer deliveries','customer delivery','delivery tracking','track item','reusable tag'], a:function(){
      bumpIntent('INTERESTED');
      var t = KNOWN.tagPlan;
      if(slot.tagCount){
        return 'Tag Plan is for tracking ' + t.uses + ' with a reusable FleetTag. ' + t.startCost + ', and ' + t.free + '. After that, it\'s ' + t.renewal + ' \u2014 ' + t.note + '. For ' + tagPlanCost(slot.tagCount) + ' upfront.';
      }
      return 'Tag Plan is for tracking ' + t.uses + ' with a reusable FleetTag. ' + t.startCost + ', and ' + t.free + '. After that, it\'s ' + t.renewal + ' \u2014 ' + t.note + '. How many items would you like to track, so I can work out the total cost?';
    }},
    {k:['track','tracking','where is my'], a:function(){ return KNOWN.solutions.tracking; }},
    {k:['driver','overspeeding','speeding','driver behaviour','driver behavior'], a:function(){
      slot.customerType = slot.customerType || 'business'; bumpIntent('INTERESTED');
      var rec = recommendPlan();
      var recLine = rec ? (' ' + KNOWN.plans[rec].name + ' is the common starting point for that.') : '';
      return "Driver monitoring comes with Pro and Prime — you get driver behaviour scoring alongside location, so you can see how a vehicle is being driven, not just where it is." + recLine;
    }},
    {k:['fleet manager','multiple vehicles','company vehicles','fleet management'], a:function(){ slot.customerType='business'; bumpIntent('INTERESTED'); return "For managing several vehicles, Pro is the common starting point — it adds fuel intelligence and driver oversight on top of location. Prime adds a managed team on top of that for larger fleets."; }},
    {k:['login','log in','dashboard','password','my account'], a:function(){ bumpIntent('INTERESTED'); return "You can log in to your FleetHive dashboard from the Login link in the site menu. If you're having trouble accessing your account, I'll connect you with the team."; }},
    {k:['trip','history'], a:function(){ return KNOWN.solutions.trips; }},
    {k:['alert'], a:function(){ return KNOWN.solutions.alerts; }},
    {k:['zone','geofence','no-go'], a:function(){ return KNOWN.solutions.zones; }},
    {k:['intelligence','insight'], a:function(){ return KNOWN.solutions.intel; }},
    {k:['hive credit'], a:function(){ bumpIntent('INTERESTED'); return KNOWN.hiveCredits.desc + '. Available amounts: ' + KNOWN.hiveCredits.amounts + '.'; }},
    {k:['fleet tag','asset','equipment'], a:function(){ return KNOWN.solutions.tags; }},
    {k:['how it works','install','setup','connect'], a:function(){ return "Four steps: Install the tracking device, Connect it to the platform, Monitor location/trips/alerts live, and Act on what you see. Most customers are live the same day."; }},
    {k:['partner','reseller','install for'], a:function(){ slot.partnership = true; bumpIntent('INTERESTED'); return "The Partner Program is for installers, ICT consultants, mobility companies and resellers — you earn recurring revenue selling and deploying FleetHive. Want me to pass your interest to the partnerships team?"; }},
    {k:['delivery','logistics','courier'], a:function(){ slot.customerType='business'; return "For delivery work specifically, Pro is the common fit — the fuel intelligence and driver behaviour scoring matter a lot once you've got drivers you're not riding with."; }},
    {k:['future','roadmap','upcoming','coming soon'], a:function(){ return "I only speak to what's live today — I don't have verified detail on unreleased plans. For roadmap questions, support@fleethive.in can give you an accurate answer."; }},
    {k:['contact','support','human','speak with someone','talk to someone','talk to an agent','agent'], a:function(){ bumpIntent('QUALIFIED'); return "Happy to connect you — I can take a few details now so the team can reach out directly, or you can message support@fleethive.in yourself."; }}
  ];

  function planSuggestion(){
    var p = recommendPlan();
    if(!p) return "What would you like to track — a personal vehicle, a business fleet, or packages/deliveries? That'll help me point you to the right plan.";
    var reason = p === 'lite' ? "since it sounds like one vehicle for personal use" :
                 p === 'prime' ? "given the fleet size you mentioned" :
                 "since this sounds like business use with more than one vehicle";
    return "Based on what you've told me, " + KNOWN.plans[p].name + " (" + KNOWN.plans[p].price + ") is what makes sense " + reason + ".";
  }

  // Catches bare tag-quantity messages like "I need three tags" that don't otherwise
  // mention "tag plan" / "FleetTag" but do contain a number + "tag(s)".
  function findTagQuantity(msg){
    var m = msg.toLowerCase();
    if(!/\btags?\b/.test(m)) return null;
    if(!slot.tagCount) return null;
    bumpIntent('INTERESTED');
    return "Got it — " + tagPlanCost(slot.tagCount) + " upfront (₦35,000 per FleetTag). The first 3 months of tracking are free on each; after that it's ₦3,000/mo or ₦30,000/yr per tag.";
  }

  // "Do you install in <city>?" — answers only from KNOWN.installation.locations, never invents coverage.
  var INSTALL_LOCATIONS = (KNOWN.installation && KNOWN.installation.locations) || ['Lagos','Abuja','Port Harcourt','Ibadan','Kano','Enugu'];
  var OUTSIDE_INSTALL_MSG = (KNOWN.installation && KNOWN.installation.outsideLocations) || "Let me connect you with the FleetHive team so we can confirm the available installation option for your location.";
  function findInstallationLocation(msg){
    var m = msg.toLowerCase();
    if(!/install|installation|do you (cover|service|operate)/.test(m)) return null;
    var anyCityMention = m.match(/lagos|abuja|port harcourt|ibadan|kano|enugu|kaduna/);
    if(!anyCityMention) return null;
    var mentioned = anyCityMention[0];
    var cityHit = null;
    for(var i=0;i<INSTALL_LOCATIONS.length;i++){
      if(mentioned === INSTALL_LOCATIONS[i].toLowerCase()){ cityHit = INSTALL_LOCATIONS[i]; break; }
    }
    if(cityHit){
      slot.location = cityHit;
      return "Yes — FleetHive currently installs in " + cityHit + ". Would you like me to help you get started?";
    }
    return OUTSIDE_INSTALL_MSG;
  }

  // Which specific plan/product a message names, if any — used to shorten the
  // conversation and jump straight to the right CTA once intent is clear.
  function explicitPlanKey(msg){
    var m = msg.toLowerCase();
    if(/tag plan|fleettag|\bfleet tag\b/.test(m)) return 'tagplan';
    if(/\bprime\b/.test(m)) return 'prime';
    if(/\bpro\b/.test(m)) return 'pro';
    if(/\blite\b/.test(m)) return 'lite';
    return null;
  }
  function isPartnerIntent(msg){
    return /become a partner|partner with fleethive|want to partner|reseller|sub-?seller/.test(msg.toLowerCase());
  }
  function isCompareQuestion(msg){
    return /difference between|compare (the )?plans|lite (vs\.?|versus) pro|pro (vs\.?|versus) prime|lite (vs\.?|versus) prime|what'?s the difference/.test(msg.toLowerCase());
  }
  function isCheapestQuestion(msg){
    return /cheapest|most affordable|lowest price|least expensive/.test(msg.toLowerCase());
  }
  function isBestPlanQuestion(msg){
    return /\bbest plan\b|which (plan|one) is best|recommended plan|what'?s the best (plan|option)/.test(msg.toLowerCase());
  }
  // Compact, human-readable summary of everything Bree has learned so far — sent
  // to the team on handoff so the visitor never has to repeat themselves.
  function contextSummary(){
    var parts = [];
    if(slot.name) parts.push('Name: ' + slot.name);
    if(slot.email) parts.push('Email: ' + slot.email);
    if(slot.location) parts.push('Location: ' + slot.location);
    if(slot.customerType) parts.push('Type: ' + slot.customerType);
    if(slot.fleetSize) parts.push('Qty: ' + slot.fleetSize);
    if(slot.vehicleType) parts.push('Vehicle/item: ' + slot.vehicleType);
    if(slot.tagCount) parts.push('FleetTags: ' + slot.tagCount);
    if(slot.partnership) parts.push('Interested in: Partner Program');
    else { var p = recommendPlan(); if(p) parts.push('Plan discussed: ' + KNOWN.plans[p].name); }
    parts.push('Intent: ' + intent);
    return parts.join(' | ');
  }

  function findObjection(msg){
    var m = msg.toLowerCase();
    for(var i=0;i<OBJECTIONS.length;i++){ if(OBJECTIONS[i].t.test(m)) return OBJECTIONS[i].a(); }
    return null;
  }
  function findAnswer(msg){
    var m = msg.toLowerCase();
    for(var i=0;i<KB.length;i++){
      for(var j=0;j<KB[i].k.length;j++){
        if(m.indexOf(KB[i].k[j]) !== -1) return KB[i].a();
      }
    }
    return null;
  }
  function fallback(){
    return "I don't want to give you the wrong information there. Let me connect you with the FleetHive team instead.";
  }
  // Never invents information to keep the conversation going — hands off to a
  // real human, and preserves whatever context Bree already collected (section 14)
  // so the visitor doesn't have to repeat themselves to the human agent.
  function escalate(){
    addMsg(fallback(), 'bot');
    var ctx = contextSummary();
    addCTA('contact');
    addCTA('whatsapp', ctx ? {context: ctx} : null);
    var subject = encodeURIComponent('FleetHive website enquiry' + (slot.name ? ' — ' + slot.name : ''));
    var mailBody = encodeURIComponent((ctx ? ctx + '\n\n' : '') + 'Captured via Bree on the FleetHive website.');
    addLink('Email Support', 'mailto:' + ((KNOWN.contact && KNOWN.contact.email) || 'support@fleethive.in') + '?subject=' + subject + '&body=' + mailBody);

    // Best-effort, silent — so the team has this context even if the visitor
    // never taps a CTA. Never blocks or errors out the conversation if it fails.
    if(slot.name || slot.email || slot.phone){
      fetch('/.netlify/functions/send-lead', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          name: slot.name, email: slot.email, phone: slot.phone, location: slot.location,
          fleetSize: slot.fleetSize, vehicleType: slot.vehicleType, customerType: slot.customerType,
          primaryProblem: slot.primaryProblem, partnership: slot.partnership,
          intent: intent, leadScore: computeLeadScore(), timestamp: new Date().toLocaleString(),
          source: 'Bree handoff (unanswered question)'
        })
      }).catch(function(){});
    }
  }

  var BUYING_SIGNALS = /get started|sign up|ready to start|how (do|can) i (start|begin)|speak (with|to) (someone|fleethive|a person)|how (soon|quickly)|start today|become a partner|i want to buy|can i pay now|i need this for my (company|business)|where can i register|how much do i need to start|i want (the )?lite|i want (the )?pro\b|i want (the )?prime|i want (the )?tag plan|can i order today|order today|i'?m ready|let'?s do this|sign me up|i need (\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(trackers?|vehicles?|tags?)/i;

  // ---------- Lead capture — only asks what's still missing ----------
  var leadMode = false;
  var leadQueue = [];

  function queueMissingSlots(){
    leadQueue = [];
    if(!slot.name) leadQueue.push({key:'name', q:"By the way, what can I call you?"});
    if(!slot.email) leadQueue.push({key:'email', q:"What's the best email to reach you?"});
    if(!slot.fleetSize) leadQueue.push({key:'fleetSize', q: slot.partnership ? "Roughly how many vehicles or installs do you expect to manage?" : "How many vehicles or items are you looking to track?"});
    if(!slot.customerType) leadQueue.push({key:'customerType', q:"Is this for personal use or a business?"});
    if(!slot.location) leadQueue.push({key:'location', q:"Which city are you based in?"});
    if(!slot.primaryProblem) leadQueue.push({key:'primaryProblem', q:"What's the main thing you want FleetHive to help with?"});
  }

  function askNext(){
    if(leadQueue.length === 0){ finishLead(); return; }
    var next = leadQueue.shift();
    setTimeout(function(){ addMsg(next.q, 'bot'); }, 350);
  }

  function captureFreeformIntoSlots(text, expectedKey){
    extractSlots(text);
    if(expectedKey === 'name' && !slot.name) slot.name = text;
    if(expectedKey === 'customerType' && !slot.customerType) slot.customerType = /business|company/i.test(text) ? 'business' : /personal|private/i.test(text) ? 'private' : text;
    if(expectedKey === 'primaryProblem' && !slot.primaryProblem) slot.primaryProblem = text;
    if(expectedKey === 'location' && !slot.location) slot.location = text;
    if(expectedKey === 'fleetSize' && !slot.fleetSize){
      var n = text.match(/\d+/);
      slot.fleetSize = n ? parseInt(n[0],10) : (wordOrDigitToNum(text.trim()) || text);
    }
  }

  // Internal-only score (never shown to the visitor) — rough signal of how sales-ready a lead is.
  function computeLeadScore(){
    var score = 0;
    if(intent === 'INTERESTED') score = 25;
    if(intent === 'QUALIFIED') score = 55;
    if(intent === 'READY TO CONVERT') score = 80;
    if(slot.email) score += 10;
    if(slot.phone) score += 5;
    if(slot.fleetSize && slot.fleetSize > 1) score += 5;
    if(slot.partnership) score += 5;
    return Math.min(score, 100);
  }

  var currentAskedKey = null;

  function finishLead(){
    leadMode = false;
    bumpIntent('READY TO CONVERT');
    var plan = recommendPlan();
    var recommended = plan ? KNOWN.plans[plan].name + ' (' + KNOWN.plans[plan].price + ')' : (slot.partnership ? 'Partner Program' : 'Not enough info yet');

    var leadPayload = {
      name: slot.name, location: slot.location, email: slot.email, phone: slot.phone,
      fleetSize: slot.fleetSize, vehicleType: slot.vehicleType, customerType: slot.customerType,
      primaryProblem: slot.primaryProblem, partnership: slot.partnership,
      recommended: recommended, intent: intent, leadScore: computeLeadScore(),
      timestamp: new Date().toLocaleString()
    };

    var subject = encodeURIComponent('New FleetHive lead — ' + (slot.name || 'Website visitor') + ' [' + intent + ']');
    var summary =
      'Name: ' + (slot.name || 'Not provided') +
      '\nLocation: ' + (slot.location || 'Not provided') +
      '\nEmail: ' + (slot.email || 'Not provided') +
      '\nPhone: ' + (slot.phone || 'Not provided') +
      '\nFleet size: ' + (slot.fleetSize || 'Not provided') +
      '\nVehicle type: ' + (slot.vehicleType || 'Not provided') +
      '\nCustomer type: ' + (slot.customerType || 'Not provided') +
      '\nPrimary problem: ' + (slot.primaryProblem || 'Not provided') +
      '\nPartnership interest: ' + (slot.partnership ? 'Yes' : 'No') +
      '\nRecommended plan/action: ' + recommended +
      '\nLead intent: ' + intent +
      '\nDate/time: ' + leadPayload.timestamp +
      '\n\nCaptured via Bree on the FleetHive homepage.';
    var bodyText = encodeURIComponent(summary);
    var mailtoHref = 'mailto:support@fleethive.in?subject=' + subject + '&body=' + bodyText;

    var greet = (slot.name ? "Thanks, " + slot.name.split(' ')[0] + " — " : "Thanks — ");

    fetch('/.netlify/functions/send-lead', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(leadPayload)
    }).then(function(res){
      if(res.ok){
        addMsg(greet + "I've sent this straight to the FleetHive team, including " + recommended + " as the fit based on what you've shared. Someone will follow up shortly.", 'bot');
      } else {
        addMsg(greet + "I couldn't reach FleetHive's server just now, so I've prepared an email instead — tap below to send it yourself.", 'bot');
        addLink('Send to FleetHive', mailtoHref);
      }
    }).catch(function(){
      addMsg(greet + "I couldn't reach FleetHive's server just now, so I've prepared an email instead — tap below to send it yourself.", 'bot');
      addLink('Send to FleetHive', mailtoHref);
    });
  }

  function handleUserMessage(text){
    addMsg(text, 'user');
    extractSlots(text);
    var m = text.toLowerCase();

    if(leadMode){
      captureFreeformIntoSlots(text, currentAskedKey);
      if(leadQueue.length === 0){ finishLead(); return; }
      currentAskedKey = leadQueue[0].key;
      askNext();
      return;
    }

    // ---- HIGH INTENT: shorten the conversation and go straight to the CTA ----
    // (section 2/15 — never interrogate a visitor who has already told us what they want)
    if(BUYING_SIGNALS.test(text)){
      if(slot.partnership || isPartnerIntent(text)){
        slot.partnership = true;
        bumpIntent('QUALIFIED');
        addMsg("Absolutely — the Partner Program is for installers, ICT consultants, mobility companies and resellers who earn recurring revenue selling and deploying FleetHive. I can get you started.", 'bot');
        addCTA('partner');
        return;
      }
      var epk = explicitPlanKey(text);
      if(epk){
        bumpIntent('QUALIFIED');
        var shortMsg = {
          lite: "Perfect — I can help you get started with Lite.",
          pro: "Great — let's get you set up with Pro.",
          prime: "Great — let's get you set up with Prime.",
          tagplan: "Perfect — let's get your Tag Plan order started."
        }[epk];
        addMsg(shortMsg, 'bot');
        addCTA(epk === 'tagplan' ? 'getTagPlan' : epk);
        return;
      }
    }

    // ---- Plan comparison / cheapest / best (sections 6-8) ----
    if(isCompareQuestion(text)){
      bumpIntent('INTERESTED');
      addMsg("Lite: straightforward vehicle tracking. Pro: more control and fleet intelligence. Prime: advanced vehicle intelligence. Tag Plan: track packages, assets or other items using FleetTag.", 'bot');
      addMsg("Tell me what you're trying to track and how many you have, and I can help you choose.", 'bot');
      addQuickReply('Help Me Choose', "I'm not sure which plan is right for me");
      return;
    }
    if(isCheapestQuestion(text)){
      bumpIntent('INTERESTED');
      addMsg("Lite is the most affordable of the vehicle tracking plans. If you tell me what you're trying to track, I can check whether Lite is enough for your needs.", 'bot');
      addCTA('lite');
      return;
    }
    if(isBestPlanQuestion(text)){
      bumpIntent('INTERESTED');
      addMsg("It depends on what you need. Lite is the simplest starting point, Pro is our most recommended option for more advanced fleet monitoring, while Prime is for advanced requirements. What are you looking to track?", 'bot');
      addCTA('pricing');
      return;
    }

    var objection = findObjection(text);
    if(objection){
      addMsg(objection, 'bot');
      bumpIntent('INTERESTED');
      if(/expensive|too much money|can'?t afford|too costly|too pricey/.test(m) || /only (have |own )?(one|1) (car|vehicle)/.test(m)){
        addCTA('lite');
      } else if(/(\d{2,4})\s*vehicles|large fleet|50 vehicles/.test(m)){
        addCTA('prime');
      }
      if(BUYING_SIGNALS.test(text)){ bumpIntent('QUALIFIED'); }
      return;
    }

    var locAnswer = findInstallationLocation(text);
    if(locAnswer){
      addMsg(locAnswer, 'bot');
      bumpIntent('INTERESTED');
      return;
    }

    var tagQty = findTagQuantity(text);
    if(tagQty){
      addMsg(tagQty, 'bot');
      bumpIntent('INTERESTED');
      addCTA('getTagPlan');
      if(BUYING_SIGNALS.test(text)){ bumpIntent('QUALIFIED'); }
      return;
    }

    var ans = findAnswer(text);
    if(ans){
      addMsg(ans, 'bot');
      bumpIntent('INTERESTED');
      // Only one relevant CTA shown at a time (section 3) — most specific match first.
      if(/contact|support|human|speak with someone|talk to someone|talk to an agent|\bagent\b|account (problem|issue)/.test(m)){
        addCTA('contact');
        addCTA('whatsapp');
      } else if(/login|log in|dashboard|password|can'?t log ?in|my account/.test(m)){
        addCTA('login');
      } else if(/hive credit/.test(m)){
        addCTA('tagplan');
      } else if(/tag plan|fleettag|track a package|track my package|track order|track my order|parcel|package tracking|parcel tracking|order tracking|asset tracking|track deliver|customer deliver/.test(m)){
        addCTA('tagplan');
      } else if(/\bprime\b/.test(m)){
        addCTA('prime');
      } else if(/\bpro\b|fleet manager|multiple vehicles|company vehicles|fleet management|delivery|logistics|courier/.test(m)){
        addCTA('pro');
      } else if(/\blite\b|personal car|private car|small car/.test(m)){
        addCTA('lite');
      } else if(/price|pricing|cost|how much/.test(m)){
        addCTA('pricing');
      } else if(/partner|reseller/.test(m)){
        addCTA('partner');
      } else if(/how it works|installation|\binstall\b/.test(m)){
        addCTA('howItWorks');
      }
      if(BUYING_SIGNALS.test(text) || /qualified/.test(m)){
        bumpIntent('QUALIFIED');
      }
      return;
    }

    // ---- High intent but no specific plan named yet — recommend, then act ----
    if(BUYING_SIGNALS.test(text)){
      bumpIntent('QUALIFIED');
      var rp = recommendPlan();
      if(rp){
        addMsg("Happy to help you get started — based on what you've told me, " + KNOWN.plans[rp].name + " looks like the right fit.", 'bot');
        addCTA(rp);
      } else {
        addMsg("Happy to help you get started — tell me a little about what you're looking to track, or I can pass your details straight to the team.", 'bot');
        addCTA('getStarted');
      }
      addLeadCaptureButton('Have the Team Contact Me');
      return;
    }

    escalate();
  }

  function startLeadFlow(){
    leadMode = true;
    queueMissingSlots();
    if(leadQueue.length === 0){ finishLead(); return; }
    currentAskedKey = leadQueue[0].key;
    askNext();
  }

  // Local time greeting, with a genuine night bucket — previously anything before
  // noon (including 12am-4am) was mislabelled "Good morning".
  function timeGreeting(){
    var h = new Date().getHours();
    if(h >= 5 && h < 12) return 'Good morning';
    if(h >= 12 && h < 17) return 'Good afternoon';
    if(h >= 17 && h < 21) return 'Good evening';
    return "Hope you're having a good night"; // 9pm–5am
  }

  // ---------- Page awareness (section 10) — Bree knows what page she's on ----------
  function currentPageKey(){
    var p = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if(p === '' || p === 'index.html') return 'home';
    if(p.indexOf('pricing') === 0) return 'pricing';
    if(p.indexOf('how-it-works') === 0) return 'howItWorks';
    if(p.indexOf('partners') === 0) return 'partner';
    if(p.indexOf('contact') === 0) return 'contact';
    return 'other';
  }
  var PAGE_INTROS = {
    pricing: "Since you're on the pricing page, want me to help you compare Lite, Pro, Prime and the Tag Plan?",
    howItWorks: "I can walk you through exactly how FleetHive works, step by step, if that's useful.",
    partner: "Looks like you're checking out the Partner Program \u2014 want details on how it works and how to apply?",
    contact: "Looks like you're after support \u2014 I can connect you with the team right away, or answer a quick question first."
  };

  launcher.addEventListener('click', function(){
    panel.classList.add('open');
    if(!body.dataset.greeted){
      body.dataset.greeted = '1';
      addMsg(timeGreeting() + " \ud83d\udc4b I'm Bree from FleetHive. I can help you understand our plans, tracking solutions, pricing, partnerships and how to get started.", 'bot');
      var pageIntro = PAGE_INTROS[currentPageKey()];
      if(pageIntro){
        setTimeout(function(){ addMsg(pageIntro, 'bot'); }, 300);
      } else {
        setTimeout(function(){ addMsg("What are you looking to track today?", 'bot'); }, 300);
      }
    }
  });
  closeBtn.addEventListener('click', function(){ panel.classList.remove('open'); });

  document.querySelectorAll('.bree-quick button').forEach(function(b){
    b.addEventListener('click', function(){ handleUserMessage(b.textContent); });
  });

  function submitInput(){
    var v = input.value.trim();
    if(!v) return;
    input.value = '';
    handleUserMessage(v);
  }
  sendBtn.addEventListener('click', submitInput);
  input.addEventListener('keydown', function(e){ if(e.key === 'Enter') submitInput(); });
});

// ===== Exit-intent newsletter popup ("Stay in the FleetHive Network") =====
document.addEventListener('DOMContentLoaded', function(){
  var overlay = document.getElementById('exitPopup');
  if(!overlay) return;
  var STORAGE_KEY = 'fh_exit_popup_seen';
  var closeBtn = document.getElementById('exitPopupClose');
  var form = document.getElementById('exitPopupForm');
  var pageLoadedAt = Date.now();
  var MIN_DELAY = 8000;   // don't show immediately on arrival
  var FALLBACK_DELAY = 45000; // mobile / long-visit fallback since there's no mouse to leave
  var shown = false;

  function alreadySeen(){
    try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch(e){ return false; }
  }
  function markSeen(){
    try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch(e){}
  }
  function open(){
    if(shown || alreadySeen()) return;
    if(Date.now() - pageLoadedAt < MIN_DELAY) return;
    shown = true;
    overlay.classList.add('show');
  }
  function close(){
    markSeen();
    overlay.classList.remove('show');
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });

  // Desktop exit intent — cursor leaves through the top of the viewport
  document.addEventListener('mouseout', function(e){
    if(!e.relatedTarget && e.clientY <= 0){ open(); }
  });
  // Fallback for touch devices / long visits where there's no mouseout to catch
  setTimeout(open, FALLBACK_DELAY);

  if(form){
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var name = document.getElementById('exitPopupName').value.trim();
      var email = document.getElementById('exitPopupEmail').value.trim();
      if(!email) return;
      markSeen();
      overlay.querySelector('.exit-popup').classList.add('submitted');
      fetch('/.netlify/functions/send-newsletter', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name:name, email:email, page: location.pathname, timestamp: new Date().toLocaleString() })
      }).catch(function(){ /* best-effort — visitor still sees a thank-you either way */ });
      setTimeout(close, 2200);
    });
  }
});
