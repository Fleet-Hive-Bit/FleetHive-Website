// portal.js
//
// FleetHive Customer Portal — Prompt 2A.1.
//
// This page never trusts anything about "who's logged in" from the URL,
// localStorage, or its own markup — every fact about the customer and
// their vehicles comes from the session-authenticated auth-me /
// customer-vehicles endpoints. If either responds 401, this is not a
// soft client-side gate around already-loaded data: there is no vehicle
// data to protect here in the first place, because the data itself only
// ever comes from the authenticated API call.

(function () {
  function redirectToLogin() {
    window.location.replace('login.html');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Personalized welcome (§4) — always uses the real authenticated name;
  // never a hardcoded customer, never an invented customer type. Copy
  // branches only on customer.customerType, which comes from the
  // server-authenticated account, not a guess.
  function renderWelcome(customer) {
    var heading = document.getElementById('welcomeHeading');
    var lead = document.getElementById('welcomeLead');
    var firstName = (customer.name || '').split(' ')[0] || 'there';

    if (customer.customerType === 'business') {
      heading.textContent = 'Welcome back, ' + firstName + ' \uD83D\uDC4B';
      lead.textContent = 'Your fleet. Your operations at a glance.';
    } else {
      heading.textContent = 'Welcome back, ' + firstName + ' \uD83D\uDC4B';
      lead.textContent = 'Your vehicle. Your peace of mind. FleetHive is keeping watch so you don\u2019t always have to.';
    }
  }

  // Live status snippet for a vehicle card (§3/§9/§10) — reuses the exact
  // same friendly-status shape vehicle-status.js already returns for Fleet
  // Intelligence, so a vehicle never shows two different stories about
  // itself. `result` is null while its status hasn't loaded yet, or when
  // the vehicle has no admin-linked device (`linked:false`) — both render
  // as honest "not yet available" states, never a fabricated one.
  function vehicleStatusRow(result) {
    if (!result) {
      return '<div class="portal-vehicle-status-row"><span class="fi-dot fi-dot-muted"></span><span>Loading status\u2026</span></div>';
    }
    if (result.linked === false) {
      return '<div class="portal-vehicle-status-row"><span class="fi-dot fi-dot-muted"></span><span>Not yet connected</span></div>';
    }
    if (result.error) {
      return '<div class="portal-vehicle-status-row"><span class="fi-dot fi-dot-muted"></span><span>Status unavailable</span></div>';
    }
    var f = result.friendly || {};
    var online = f.online || {};
    var motion = f.motion || {};
    var dotClass = online.state === 'online' ? 'fi-dot-success' : (online.state === 'offline' ? 'fi-dot-danger' : 'fi-dot-muted');
    var pulse = online.state === 'online' ? ' fi-dot-pulse' : '';
    var label = escapeHtml(online.label || 'Unavailable');
    if (online.state === 'online' && motion.label) label += ' \u00B7 ' + escapeHtml(motion.label);
    return '<div class="portal-vehicle-status-row"><span class="fi-dot ' + dotClass + pulse + '" aria-hidden="true"></span><span>' + label + '</span></div>';
  }

  function vehicleMeta(result) {
    if (!result || result.linked === false || result.error || !result.status) return '';
    var s = result.status;
    var updated = escapeHtml(formatRelativeTime(result.status.utcDate));
    var speed = s.speed === 'Data unavailable' || s.speed == null ? null : escapeHtml(String(s.speed)) + ' km/h';
    var bits = ['Updated ' + updated];
    if (speed) bits.push(speed);
    return '<div class="portal-vehicle-meta">' + bits.map(function (b) { return '<span>' + b + '</span>'; }).join('') + '</div>';
  }

  function formatRelativeTime(iso) {
    if (!iso || iso === 'Data unavailable') return 'recently';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'recently';
    var diffSec = Math.round((Date.now() - d.getTime()) / 1000);
    if (diffSec < 0) diffSec = 0;
    if (diffSec < 45) return 'just now';
    var diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
    var diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
    var diffDay = Math.round(diffHr / 24);
    return diffDay + (diffDay === 1 ? ' day ago' : ' days ago');
  }

  function vehicleCard(v, result) {
    var title = escapeHtml(v.label || [v.make, v.model].filter(Boolean).join(' ') || 'Vehicle');
    var sub = escapeHtml(v.plateNumber || '');
    return (
      '<div class="portal-vehicle-card" data-vehicle-id="' + escapeHtml(v.id) + '">' +
      '<h4>' + title + '</h4>' +
      (sub ? '<p class="portal-vehicle-plate">' + sub + '</p>' : '') +
      vehicleStatusRow(result) +
      vehicleMeta(result) +
      '<a class="portal-vehicle-link" href="fleet-intelligence.html?vehicle=' + encodeURIComponent(v.id) + '">View details \u2192</a>' +
      '</div>'
    );
  }

  // Renders vehicle cards immediately with whatever status is already
  // cached (often nothing yet), then loads each vehicle's live status in
  // parallel and patches just that card in place — one slow/failed
  // vehicle never blocks or breaks the others (§13: real-time experience
  // without pretending stale data is live).
  function loadCardStatuses(vehicles) {
    vehicles.forEach(function (v) {
      fetch('/.netlify/functions/vehicle-status?vehicleId=' + encodeURIComponent(v.id), { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : { vehicleId: v.id, error: true }; })
        .catch(function () { return { vehicleId: v.id, error: true }; })
        .then(function (result) {
          var card = document.querySelector('.portal-vehicle-card[data-vehicle-id="' + v.id.replace(/"/g, '') + '"]');
          if (!card) return;
          var rows = card.querySelectorAll('.portal-vehicle-status-row, .portal-vehicle-meta');
          Array.prototype.forEach.call(rows, function (el) { el.remove(); });
          card.querySelector('.portal-vehicle-link').insertAdjacentHTML('beforebegin', vehicleStatusRow(result) + vehicleMeta(result));
        });
    });
  }

  function renderVehicles(customer, vehicles) {
    var loading = document.getElementById('vehicleLoading');
    var statsEl = document.getElementById('vehicleStats');
    var gridEl = document.getElementById('vehicleGrid');
    var emptyEl = document.getElementById('vehicleEmpty');
    var errorEl = document.getElementById('vehicleError');
    var intro = document.getElementById('vehicleSectionIntro');
    loading.style.display = 'none';
    errorEl.style.display = 'none';

    if (!vehicles.length) {
      intro.textContent = 'You don\u2019t have any vehicles connected to your FleetHive account yet.';
      statsEl.style.display = 'none';
      gridEl.style.display = 'none';
      emptyEl.style.display = '';
      return;
    }

    emptyEl.style.display = 'none';

    if (customer.customerType === 'business') {
      intro.textContent = 'Your fleet at a glance.';
      statsEl.style.display = '';
      statsEl.innerHTML =
        '<div class="portal-stat"><span class="portal-stat-num">' + vehicles.length + '</span><span class="portal-stat-label">Total Vehicles</span></div>';
    } else {
      intro.textContent = vehicles.length === 1 ? 'Your vehicle:' : 'Your vehicles:';
      statsEl.style.display = 'none';
    }

    gridEl.style.display = '';
    gridEl.innerHTML = vehicles.map(function (v) { return vehicleCard(v, null); }).join('');
    loadCardStatuses(vehicles);
  }

  function showError() {
    document.getElementById('vehicleLoading').style.display = 'none';
    document.getElementById('vehicleStats').style.display = 'none';
    document.getElementById('vehicleGrid').style.display = 'none';
    document.getElementById('vehicleEmpty').style.display = 'none';
    document.getElementById('vehicleError').style.display = '';
  }

  // ------------------------- Subscription (§1/§13) --------------------------
  // Money formatting mirrors pricing.js's fmt() — this is a display-only
  // helper, the actual amounts always come from the server.
  function money(amount, currency) {
    if (typeof amount !== 'number') return 'Not available';
    var symbol = currency === 'USD' ? '$' : '\u20A6';
    return symbol + Math.round(amount).toLocaleString();
  }

  function formatDate(iso) {
    if (!iso) return 'Not available';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Not available';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Status -> badge tone + dot, reusing the existing .fi-badge/.fi-dot
  // system (no separate badge styling). Only statuses that can actually
  // be derived from real order data are mapped (§3) — "Cancelled" isn't
  // reachable today since there's no cancellation flow, so it's omitted.
  var STATUS_STYLE = {
    'Active': 'success',
    'Payment Due': 'warning',
    'Payment Failed': 'danger',
    'Pending': 'warning',
    'Expired': 'muted',
  };

  function showSubscriptionState(which) {
    ['subLoading', 'subActive', 'subEmpty', 'subError'].forEach(function (id) {
      document.getElementById(id).style.display = id === which ? '' : 'none';
    });
  }

  function paymentHistoryRow(item) {
    var failed = item.status === 'Failed';
    return (
      '<div class="portal-pay-row">' +
      '<div class="portal-pay-row-main">' +
      '<span class="portal-pay-row-plan">' + escapeHtml(item.plan) + '</span>' +
      '<span class="portal-pay-row-date">' + formatDate(item.date) + ' \u00B7 ' + escapeHtml(item.status) + '</span>' +
      '</div>' +
      '<span class="portal-pay-row-amt' + (failed ? ' failed' : '') + '">' + money(item.amount, item.currency) + '</span>' +
      '</div>'
    );
  }

  function renderSubscription(data) {
    if (!data.hasSubscription) {
      showSubscriptionState('subEmpty');
      return;
    }

    showSubscriptionState('subActive');

    var tone = STATUS_STYLE[data.status] || 'info';
    document.getElementById('subStatusBadge').className = 'fi-badge fi-badge-' + tone;
    document.getElementById('subStatusDot').className = 'fi-dot fi-dot-' + tone;
    document.getElementById('subStatusText').textContent = data.status;

    document.getElementById('subPlanName').textContent = data.currentPlan;
    document.getElementById('subBillingFreq').textContent = data.billingFrequency;

    var nextLabel = document.getElementById('subNextPaymentLabel');
    var nextVal = document.getElementById('subNextPayment');
    if (data.status === 'Expired') {
      nextLabel.textContent = 'Subscription';
      nextVal.textContent = 'Expired';
    } else {
      nextLabel.textContent = 'Next Payment';
      nextVal.textContent = formatDate(data.nextPayment);
    }

    var outstandingRow = document.getElementById('subOutstandingRow');
    if (typeof data.outstandingBalance === 'number' && data.outstandingBalance > 0) {
      outstandingRow.style.display = '';
      document.getElementById('subOutstanding').textContent = money(data.outstandingBalance, data.currency);
    } else {
      outstandingRow.style.display = 'none';
    }

    // Make Payment (§4) — reuses the existing pricing.html?plan=&billing=
    // preselect (pricing.js already reads these params); never a second
    // payment system.
    var payBtn = document.getElementById('subPayBtn');
    var needsPayment = data.status === 'Payment Due' || data.status === 'Payment Failed' || data.status === 'Expired';
    if (needsPayment && data.planType) {
      var href = 'pricing.html?plan=' + encodeURIComponent(data.planType);
      if (data.billing === 'annual') href += '&billing=annual';
      payBtn.href = href;
      payBtn.style.display = '';
    } else {
      payBtn.style.display = 'none';
    }

    var historyWrap = document.getElementById('subHistoryWrap');
    var historyList = document.getElementById('subHistoryList');
    var history = data.history || [];
    if (history.length) {
      historyWrap.style.display = '';
      historyList.innerHTML = history.slice(0, 5).map(paymentHistoryRow).join('');
    } else {
      historyWrap.style.display = 'none';
    }
  }

  function loadSubscription() {
    showSubscriptionState('subLoading');
    fetch('/.netlify/functions/customer-subscription', { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { redirectToLogin(); return null; }
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        renderSubscription(data);
      })
      .catch(function () { showSubscriptionState('subError'); });
  }

  function loadVehicles(customer) {
    document.getElementById('vehicleLoading').style.display = '';
    document.getElementById('vehicleError').style.display = 'none';
    fetch('/.netlify/functions/customer-vehicles', { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { redirectToLogin(); return null; }
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        renderVehicles(customer, data.vehicles || []);
      })
      .catch(function () { showError(); });
  }

  function boot() {
    fetch('/.netlify/functions/auth-me', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.customer) { redirectToLogin(); return; }

        document.getElementById('portalChecking').style.display = 'none';
        document.getElementById('portalWelcome').style.display = '';
        document.getElementById('portalBody').style.display = '';

        renderWelcome(data.customer);
        loadVehicles(data.customer);
        loadSubscription();

        // isAdmin is server-resolved (see auth-me.js) — used here only to
        // decide whether to show a link to admin.html. admin.html and
        // every admin-* Netlify Function independently re-check this
        // server-side, so hiding/showing this link is a convenience, not
        // the actual access control.
        if (data.isAdmin) {
          var navLink = document.getElementById('adminNavLink');
          var navLinkMobile = document.getElementById('adminNavLinkMobile');
          if (navLink) navLink.style.display = '';
          if (navLinkMobile) navLinkMobile.style.display = '';
        }

        document.getElementById('vehicleRetry').addEventListener('click', function () {
          loadVehicles(data.customer);
        });
        document.getElementById('subRetry').addEventListener('click', loadSubscription);
      })
      .catch(function () { redirectToLogin(); });
  }

  function logout() {
    fetch('/.netlify/functions/auth-logout', { method: 'POST', credentials: 'same-origin' })
      .finally(function () { window.location.href = 'index.html'; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot();
    var b1 = document.getElementById('logoutBtn');
    var b2 = document.getElementById('logoutBtnMobile');
    if (b1) b1.addEventListener('click', logout);
    if (b2) b2.addEventListener('click', logout);
  });
})();
