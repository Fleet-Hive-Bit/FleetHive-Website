// fleet-intelligence.js
//
// FleetHive Fleet Intelligence — Prompt 2A.2.
//
// Architecture (§15): this file only ever talks to FleetHive's own
// Netlify Functions (auth-me, customer-vehicles, vehicle-status,
// vehicle-trip-history) — never to the white-label provider directly, and
// never with a provider identifier (IMEI/ClientID/DeviceId) in sight.
// Every vehicleId sent from here is re-verified as belonging to the
// signed-in customer on the server before any data comes back (see
// _deviceAccess.js resolveOwnedDevice()).
//
// Real data only (§14): every value rendered here either came back from
// the server as-is or is literally the string "Data unavailable" — this
// file never invents a coordinate, speed, or status.

(function () {
  'use strict';

  // ---------------------------- Small helpers -------------------------------

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function redirectToLogin() {
    window.location.replace('login.html');
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isUnavailable(v) {
    return v === undefined || v === null || v === 'Data unavailable';
  }

  function fmtValue(v, suffix) {
    if (isUnavailable(v)) return '<span class="fi-unavailable">Data unavailable</span>';
    return escapeHtml(String(v)) + (suffix || '');
  }

  function formatRelativeTime(iso) {
    if (isUnavailable(iso)) return 'Data unavailable';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Data unavailable';
    var diffMs = Date.now() - d.getTime();
    var diffSec = Math.round(diffMs / 1000);
    if (diffSec < 0) diffSec = 0;
    if (diffSec < 45) return 'Just now';
    var diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
    var diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
    var diffDay = Math.round(diffHr / 24);
    return diffDay + (diffDay === 1 ? ' day ago' : ' days ago');
  }

  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {})).then(function (res) {
      if (res.status === 401) {
        redirectToLogin();
        return Promise.reject(new Error('unauthorized'));
      }
      return res.json().catch(function () { return null; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  // ------------------------------- State -------------------------------------

  var state = {
    vehicles: [],
    filteredIds: null, // null = no filter active
    selectedId: null,
    statusCache: {}, // vehicleId -> { result, fetchedAt }
    inFlight: {}, // vehicleId -> Promise
    map: null,
    markers: {}, // vehicleId -> L.Marker
    pollTimer: null,
    reducedMotion: prefersReducedMotion(),
  };

  var POLL_INTERVAL_MS = 30000;
  var CACHE_FRESH_MS = 5000; // avoid duplicate near-simultaneous requests for the same vehicle

  // ------------------------------ Status fetch --------------------------------

  // Fetches (and caches/deduplicates) the current status for one vehicle.
  // Deduplication matters here specifically because §16 forbids hitting the
  // provider on every component render — a vehicle can be asked for by the
  // list, the map and the detail panel all in the same tick.
  function fetchStatus(vehicleId, force) {
    var cached = state.statusCache[vehicleId];
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_FRESH_MS) {
      return Promise.resolve(cached.result);
    }
    if (state.inFlight[vehicleId]) return state.inFlight[vehicleId];

    var p = fetchJSON('/.netlify/functions/vehicle-status?vehicleId=' + encodeURIComponent(vehicleId))
      .then(function (res) {
        var result = res.ok ? res.data : { vehicleId: vehicleId, error: 'Vehicle data is temporarily unavailable. Please try again shortly.' };
        state.statusCache[vehicleId] = { result: result, fetchedAt: Date.now() };
        return result;
      })
      .catch(function () {
        var result = { vehicleId: vehicleId, error: 'Vehicle data is temporarily unavailable. Please try again shortly.' };
        state.statusCache[vehicleId] = { result: result, fetchedAt: Date.now() };
        return result;
      })
      .finally(function () {
        delete state.inFlight[vehicleId];
      });

    state.inFlight[vehicleId] = p;
    return p;
  }

  function fetchAllStatuses(vehicles) {
    return Promise.all(vehicles.map(function (v) { return fetchStatus(v.id, false); }));
  }

  // ------------------------------- Rendering -----------------------------------

  function statusDotClass(kind, stateName) {
    var map = {
      online: { online: 'success', offline: 'danger', unknown: 'muted' },
      motion: { moving: 'info', parked: 'muted', unknown: 'muted' },
      ignition: { on: 'warning', off: 'muted', unknown: 'muted' },
      lock: { locked: 'success', unlocked: 'warning', undetermined: 'muted' },
    };
    return 'fi-dot-' + ((map[kind] && map[kind][stateName]) || 'muted');
  }

  function vehicleDisplayName(v) {
    return escapeHtml(v.label || [v.make, v.model].filter(Boolean).join(' ') || 'Vehicle');
  }

  function summaryLine(result) {
    if (!result) return { text: 'Loading…', dotClass: 'fi-dot-muted' };
    if (result.linked === false) return { text: 'Not yet connected', dotClass: 'fi-dot-muted' };
    if (result.error) return { text: 'Unavailable', dotClass: 'fi-dot-muted' };
    var f = result.friendly || {};
    var online = (f.online && f.online.label) || 'Unavailable';
    return { text: online, dotClass: statusDotClass('online', f.online && f.online.state) };
  }

  function renderVehicleList() {
    var listEl = document.getElementById('fiVehicleList');
    var term = (document.getElementById('fiSearch').value || '').trim().toLowerCase();

    var visible = state.vehicles.filter(function (v) {
      if (!term) return true;
      var hay = [v.label, v.make, v.model, v.plateNumber].filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(term) !== -1;
    });

    document.getElementById('fiSearchEmpty').style.display = (term && !visible.length) ? '' : 'none';
    document.getElementById('fiVehicleCount').textContent = state.vehicles.length;

    listEl.innerHTML = visible.map(function (v) {
      var cached = state.statusCache[v.id];
      var result = cached ? cached.result : null;
      var summary = summaryLine(result);
      var speed = result && result.status ? fmtValue(result.status.speed) : 'Data unavailable';
      var updated = result && result.status ? formatRelativeTime(result.status.utcDate) : 'Data unavailable';
      var selected = v.id === state.selectedId;

      return (
        '<button type="button" class="fi-vehicle-item' + (selected ? ' is-selected' : '') + '" ' +
          'data-id="' + escapeHtml(v.id) + '" role="listitem" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
          '<div class="fi-vehicle-item-main">' +
            '<span class="fi-vehicle-name">' + vehicleDisplayName(v) + '</span>' +
            (v.plateNumber ? '<span class="fi-vehicle-plate">' + escapeHtml(v.plateNumber) + '</span>' : '') +
          '</div>' +
          '<div class="fi-vehicle-item-status">' +
            '<span class="fi-dot ' + summary.dotClass + '" aria-hidden="true"></span>' +
            '<span>' + escapeHtml(summary.text) + '</span>' +
          '</div>' +
          '<div class="fi-vehicle-item-meta">' +
            '<span>Speed: ' + speed + '</span>' +
            '<span>Updated: ' + escapeHtml(updated) + '</span>' +
          '</div>' +
        '</button>'
      );
    }).join('');

    Array.prototype.forEach.call(listEl.querySelectorAll('.fi-vehicle-item'), function (btn) {
      btn.addEventListener('click', function () { selectVehicle(btn.getAttribute('data-id')); });
    });
  }

  function renderTop(vehicle, result) {
    var body = document.getElementById('fiTopBody');
    var empty = document.getElementById('fiTopEmpty');

    if (!vehicle) {
      body.style.display = 'none';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    body.style.display = '';

    if (!result || result.linked === false) {
      body.innerHTML =
        '<h3>' + vehicleDisplayName(vehicle) + '</h3>' +
        '<p class="fi-note">' + escapeHtml((result && result.message) || 'This vehicle is not yet connected to a tracking device.') + '</p>';
      return;
    }
    if (result.error) {
      body.innerHTML =
        '<h3>' + vehicleDisplayName(vehicle) + '</h3>' +
        '<p class="fi-note fi-note-error">' + escapeHtml(result.error) + '</p>';
      return;
    }

    var f = result.friendly || {};
    var s = result.status || {};
    body.innerHTML =
      '<h3>' + vehicleDisplayName(vehicle) + '</h3>' +
      '<div class="fi-badge-row">' +
        badgeHtml(f.online, 'online') +
        badgeHtml(f.motion, 'motion') +
      '</div>' +
      '<p class="fi-location"><strong>Location:</strong> ' + fmtValue(s.location) + '</p>' +
      (f.isStale ? '<p class="fi-note">This vehicle\u2019s last report is older than 20 minutes, so its position may not reflect where it is right now.</p>' : '');
  }

  function badgeHtml(stateObj, kind) {
    if (!stateObj) return '<span class="fi-badge fi-badge-muted">Unavailable</span>';
    var cls = statusDotClass(kind, stateObj.state).replace('fi-dot-', 'fi-badge-');
    return '<span class="fi-badge ' + cls + '">' + escapeHtml(stateObj.label) + '</span>';
  }

  function renderDetail(vehicle, result) {
    var body = document.getElementById('fiDetailBody');
    var empty = document.getElementById('fiDetailEmpty');

    if (!vehicle) {
      body.style.display = 'none';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    body.style.display = '';

    var linkStateHtml = '';
    var overviewHtml = '';
    if (!result || result.linked === false) {
      overviewHtml = '<p class="fi-note">' + escapeHtml((result && result.message) || 'Linking a tracking device to this vehicle is an admin-only step that hasn\u2019t happened yet.') + '</p>';
    } else if (result.error) {
      overviewHtml = '<p class="fi-note fi-note-error">' + escapeHtml(result.error) + '</p>';
    } else {
      var f = result.friendly || {};
      var s = result.status || {};
      var lockLabel = result.lock ? result.lock.label : 'Unavailable';
      var lockClass = result.lock ? statusDotClass('lock', result.lock.state).replace('fi-dot-', 'fi-badge-') : 'fi-badge-muted';
      overviewHtml =
        '<div class="fi-badge-row">' +
          badgeHtml(f.ignition, 'ignition') +
          '<span class="fi-badge ' + lockClass + '">' + escapeHtml(lockLabel) + '</span>' +
        '</div>' +
        '<dl class="fi-fact-grid">' +
          '<div><dt>Speed</dt><dd>' + fmtValue(s.speed, ' km/h') + '</dd></div>' +
          '<div><dt>Odometer</dt><dd>' + fmtValue(s.odometer) + '</dd></div>' +
          '<div><dt>Battery</dt><dd>' + fmtValue(s.battery) + '</dd></div>' +
          '<div><dt>Last event</dt><dd>' + fmtValue(s.eventName) + '</dd></div>' +
          '<div><dt>Last update</dt><dd>' + escapeHtml(formatRelativeTime(s.utcDate)) + '</dd></div>' +
        '</dl>';
    }

    body.innerHTML =
      '<div class="fi-tabs" role="tablist">' +
        '<button type="button" class="fi-tab is-active" role="tab" aria-selected="true" id="fiTabOverviewBtn" data-tab="overview">Overview</button>' +
        '<button type="button" class="fi-tab" role="tab" aria-selected="false" id="fiTabDeviceBtn" data-tab="device">Device</button>' +
        '<button type="button" class="fi-tab" role="tab" aria-selected="false" id="fiTabHistoryBtn" data-tab="history">Trip History</button>' +
      '</div>' +
      '<div class="fi-tab-panel" id="fiTabOverview" role="tabpanel">' + overviewHtml + '</div>' +
      '<div class="fi-tab-panel" id="fiTabDevice" role="tabpanel" hidden>' + deviceTabHtml(vehicle) + '</div>' +
      '<div class="fi-tab-panel" id="fiTabHistory" role="tabpanel" hidden>' + historyTabHtml() + '</div>';

    wireTabs();
    wireHistoryForm(vehicle);
  }

  function deviceTabHtml(vehicle) {
    // Only customer-facing fields — no IMEI/DeviceId/ClientID (§9/§23).
    return (
      '<dl class="fi-fact-grid">' +
        '<div><dt>Name</dt><dd>' + vehicleDisplayName(vehicle) + '</dd></div>' +
        '<div><dt>Make / Model</dt><dd>' + fmtValue([vehicle.make, vehicle.model].filter(Boolean).join(' ') || null) + '</dd></div>' +
        '<div><dt>Registration</dt><dd>' + fmtValue(vehicle.plateNumber) + '</dd></div>' +
      '</dl>'
    );
  }

  function historyTabHtml() {
    var now = new Date();
    var start = new Date(now.getTime() - 20 * 60 * 1000);
    return (
      '<form id="fiHistoryForm" class="fi-history-form">' +
        '<div class="fi-history-fields">' +
          '<label>From<input type="datetime-local" id="fiHistoryStart" value="' + toLocalInputValue(start) + '"></label>' +
          '<label>To<input type="datetime-local" id="fiHistoryEnd" value="' + toLocalInputValue(now) + '"></label>' +
        '</div>' +
        '<p class="fi-muted-note">Range is limited to 20 minutes per lookup, in line with the tracking provider\u2019s own limits.</p>' +
        '<button type="submit" class="btn btn-outline">Load History</button>' +
      '</form>' +
      '<div id="fiHistoryResults" class="fi-history-results"></div>'
    );
  }

  function toLocalInputValue(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function wireTabs() {
    var tabs = document.querySelectorAll('.fi-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (t) {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
        ['overview', 'device', 'history'].forEach(function (name) {
          var panel = document.getElementById('fiTab' + name.charAt(0).toUpperCase() + name.slice(1));
          if (panel) panel.hidden = (name !== tab.getAttribute('data-tab'));
        });
      });
    });
  }

  function wireHistoryForm(vehicle) {
    var form = document.getElementById('fiHistoryForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var startVal = document.getElementById('fiHistoryStart').value;
      var endVal = document.getElementById('fiHistoryEnd').value;
      var resultsEl = document.getElementById('fiHistoryResults');
      if (!startVal || !endVal) return;

      var start = new Date(startVal);
      var end = new Date(endVal);
      if (end - start > 20 * 60 * 1000 || end <= start) {
        resultsEl.innerHTML = '<p class="fi-note fi-note-error">Please choose a valid range of 20 minutes or less.</p>';
        return;
      }

      resultsEl.innerHTML = '<p class="fi-muted-note">Loading trip history…</p>';
      var url = '/.netlify/functions/vehicle-trip-history?vehicleId=' + encodeURIComponent(vehicle.id) +
        '&startDate=' + encodeURIComponent(start.toISOString()) + '&endDate=' + encodeURIComponent(end.toISOString());

      fetchJSON(url).then(function (res) {
        var data = res.data || {};
        if (!res.ok) {
          resultsEl.innerHTML = '<p class="fi-note fi-note-error">' + escapeHtml((data && data.error) || 'Unable to load trip history right now.') + '</p>';
          return;
        }
        if (data.linked === false) {
          resultsEl.innerHTML = '<p class="fi-note">' + escapeHtml(data.message || 'This vehicle is not yet connected to a tracking device.') + '</p>';
          return;
        }
        if (data.error) {
          resultsEl.innerHTML = '<p class="fi-note fi-note-error">' + escapeHtml(data.error) + '</p>';
          return;
        }
        var points = data.points || [];
        if (!points.length) {
          resultsEl.innerHTML = '<p class="fi-muted-note">No data was returned for this range.</p>';
          return;
        }
        resultsEl.innerHTML = '<ul class="fi-history-list">' + points.map(function (p) {
          return '<li><span class="fi-history-time">' + escapeHtml(formatRelativeTime(p.utcDate)) + '</span>' +
            '<span>' + fmtValue(p.location) + '</span>' +
            '<span>' + fmtValue(p.speed, ' km/h') + '</span></li>';
        }).join('') + '</ul>';
      }).catch(function () {
        resultsEl.innerHTML = '<p class="fi-note fi-note-error">Unable to load trip history right now. Please try again shortly.</p>';
      });
    });
  }

  // --------------------------------- Map ---------------------------------------

  function initMap() {
    if (state.map || typeof L === 'undefined') return;
    state.map = L.map('fiMap', { zoomControl: true }).setView([9.082, 8.6753], 6); // Nigeria-wide default view
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(state.map);
  }

  function dotIcon(dotClass) {
    return L.divIcon({
      className: 'fi-map-marker-wrap',
      html: '<span class="fi-map-marker ' + dotClass + '"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10],
    });
  }

  function updateMarker(vehicle, result) {
    if (!state.map) return;
    var s = result && result.status;
    var hasCoords = result && result.friendly && result.friendly.hasCoordinates;
    var existing = state.markers[vehicle.id];

    if (!hasCoords) {
      if (existing) { state.map.removeLayer(existing); delete state.markers[vehicle.id]; }
      return;
    }

    var lat = Number(s.lat);
    var lon = Number(s.lon);
    var summary = summaryLine(result);
    var popupHtml =
      '<strong>' + vehicleDisplayName(vehicle) + '</strong><br>' +
      escapeHtml(summary.text) + '<br>' +
      fmtValue(s.location) + '<br>' +
      '<span class="fi-muted-note">Updated ' + escapeHtml(formatRelativeTime(s.utcDate)) + '</span>';

    if (existing) {
      existing.setLatLng([lat, lon]);
      existing.setIcon(dotIcon(summary.dotClass));
      existing.getPopup() && existing.setPopupContent(popupHtml);
    } else {
      var marker = L.marker([lat, lon], { icon: dotIcon(summary.dotClass) }).addTo(state.map);
      marker.bindPopup(popupHtml);
      marker.on('click', function () { selectVehicle(vehicle.id); });
      state.markers[vehicle.id] = marker;
    }
  }

  function refreshAllMarkers() {
    state.vehicles.forEach(function (v) {
      var cached = state.statusCache[v.id];
      updateMarker(v, cached ? cached.result : null);
    });
  }

  function focusMapOnVehicle(vehicleId) {
    var marker = state.markers[vehicleId];
    if (!state.map) return;
    if (!marker) return;
    var latlng = marker.getLatLng();
    if (state.reducedMotion) {
      state.map.setView(latlng, Math.max(state.map.getZoom(), 14));
    } else {
      state.map.flyTo(latlng, Math.max(state.map.getZoom(), 14), { duration: 0.8 });
    }
    marker.openPopup();
  }

  // ------------------------------ Selection / polling ----------------------------

  function announce(text) {
    var el = document.getElementById('fiLiveRegion');
    if (el) el.textContent = text;
  }

  function selectVehicle(vehicleId) {
    state.selectedId = vehicleId;
    renderVehicleList();
    stopPolling();

    var vehicle = state.vehicles.filter(function (v) { return v.id === vehicleId; })[0];
    if (!vehicle) return;

    var cached = state.statusCache[vehicleId];
    renderTop(vehicle, cached ? cached.result : null);
    renderDetail(vehicle, cached ? cached.result : null);
    focusMapOnVehicle(vehicleId);

    fetchStatus(vehicleId, true).then(function (result) {
      updateMarker(vehicle, result);
      if (state.selectedId !== vehicleId) return; // selection changed while in flight
      renderTop(vehicle, result);
      renderDetail(vehicle, result);
      renderVehicleList();
      announce(vehicleDisplayName(vehicle).replace(/<[^>]+>/g, '') + ' status updated.');
    });

    startPolling(vehicleId);
  }

  function startPolling(vehicleId) {
    if (document.hidden) return; // don't poll while the tab is backgrounded
    state.pollTimer = setInterval(function () {
      var vehicle = state.vehicles.filter(function (v) { return v.id === vehicleId; })[0];
      if (!vehicle) return;
      fetchStatus(vehicleId, true).then(function (result) {
        updateMarker(vehicle, result);
        if (state.selectedId !== vehicleId) return;
        renderTop(vehicle, result);
        renderVehicleList();
      });
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopPolling();
    } else if (state.selectedId) {
      startPolling(state.selectedId);
    }
  });

  // -------------------------------- Boot / load ----------------------------------

  function showListState(name) {
    ['fiListLoading', 'fiEmpty', 'fiLoadError', 'fiLayout'].forEach(function (id) {
      document.getElementById(id).style.display = (id === name) ? '' : 'none';
    });
  }

  function loadVehicles() {
    showListState('fiListLoading');
    fetchJSON('/.netlify/functions/customer-vehicles').then(function (res) {
      if (!res.ok) { showListState('fiLoadError'); return; }
      var vehicles = (res.data && res.data.vehicles) || [];
      state.vehicles = vehicles;

      if (!vehicles.length) { showListState('fiEmpty'); return; }

      showListState('fiLayout');
      initMap();
      renderVehicleList();

      fetchAllStatuses(vehicles).then(function () {
        renderVehicleList();
        refreshAllMarkers();
        if (!state.selectedId) {
          // Deep link from the Customer Portal's "View details" link
          // (§11: preserve/honor a selection rather than always defaulting
          // to the first vehicle) — falls back to the first vehicle if the
          // id is missing or doesn't belong to this customer.
          var requestedId = new URLSearchParams(window.location.search).get('vehicle');
          var match = requestedId && vehicles.filter(function (v) { return v.id === requestedId; })[0];
          selectVehicle(match ? match.id : vehicles[0].id);
        }
      });
    }).catch(function () { showListState('fiLoadError'); });
  }

  function boot() {
    fetchJSON('/.netlify/functions/auth-me').then(function (res) {
      if (!res.ok || !res.data || !res.data.customer) { redirectToLogin(); return; }
      document.getElementById('fiChecking').style.display = 'none';
      document.getElementById('fiDash').style.display = '';
      loadVehicles();
    }).catch(function () { redirectToLogin(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot();
    document.getElementById('fiSearch').addEventListener('input', renderVehicleList);
    document.getElementById('fiLoadRetry').addEventListener('click', loadVehicles);
    document.getElementById('fiRefreshAll').addEventListener('click', function () {
      if (!state.vehicles.length) return;
      announce('Refreshing vehicle statuses…');
      fetchAllStatuses(state.vehicles).then(function () {
        renderVehicleList();
        refreshAllMarkers();
        if (state.selectedId) {
          var vehicle = state.vehicles.filter(function (v) { return v.id === state.selectedId; })[0];
          var cached = state.statusCache[state.selectedId];
          if (vehicle) { renderTop(vehicle, cached ? cached.result : null); renderDetail(vehicle, cached ? cached.result : null); }
        }
        announce('Vehicle statuses updated.');
      });
    });
  });
})();
