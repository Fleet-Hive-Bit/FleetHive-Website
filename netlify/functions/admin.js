// admin.js
//
// FleetHive Admin — Device Management (Prompt 2B.2).
//
// Like portal.js, this page never trusts anything about "am I an admin"
// from its own markup or from localStorage — auth-me's isAdmin field is
// only used to decide whether to SHOW the admin UI. Every actual admin
// action (discover/assign/unassign/create vehicle/view audit log) hits an
// admin-* Netlify Function that independently re-verifies the session and
// admin status server-side (see requireAdminSession() in
// _deviceAccess.js). A tampered client cannot grant itself admin
// capability this way — worst case, it shows UI that then gets 401/403'd
// by the server on every request.

(function () {
  function redirectToLogin() {
    window.location.replace('login.html');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDateTime(iso) {
    if (!iso) return 'Not available';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Not available';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function apiFetch(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { redirectToLogin(); return Promise.reject(new Error('unauthorized')); }
      return res.json().then(function (data) {
        if (!res.ok) return Promise.reject(new Error((data && data.error) || 'Request failed'));
        return data;
      });
    });
  }

  // -------------------------- Confirmation modal ---------------------------
  var modalOverlay = null, modalTitle = null, modalBody = null, modalConfirmBtn = null, modalCancelBtn = null;
  function initModal() {
    modalOverlay = document.getElementById('modalOverlay');
    modalTitle = document.getElementById('modalTitle');
    modalBody = document.getElementById('modalBody');
    modalConfirmBtn = document.getElementById('modalConfirmBtn');
    modalCancelBtn = document.getElementById('modalCancelBtn');
    modalCancelBtn.addEventListener('click', hideModal);
    modalOverlay.addEventListener('click', function (e) { if (e.target === modalOverlay) hideModal(); });
  }
  function hideModal() {
    modalOverlay.style.display = 'none';
    modalConfirmBtn.onclick = null;
  }
  // opts: { title, bodyHtml, confirmLabel, onConfirm }
  function showModal(opts) {
    modalTitle.textContent = opts.title;
    modalBody.innerHTML = opts.bodyHtml;
    modalConfirmBtn.textContent = opts.confirmLabel || 'Confirm';
    modalConfirmBtn.onclick = function () {
      modalConfirmBtn.disabled = true;
      Promise.resolve(opts.onConfirm()).finally(function () { modalConfirmBtn.disabled = false; });
    };
    modalOverlay.style.display = '';
  }

  // ------------------------------ Customers ---------------------------------
  var customerCache = [];

  function searchCustomers(q) {
    return apiFetch('/.netlify/functions/admin-customers?q=' + encodeURIComponent(q || '')).then(function (data) {
      customerCache = data.customers || [];
      var select = document.getElementById('custSelect');
      select.innerHTML = '<option value="">Choose a customer…</option>' +
        customerCache.map(function (c) {
          return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name || c.email) + ' — ' + escapeHtml(c.email) + '</option>';
        }).join('');
    });
  }

  // --------------------------- Client name lookup -----------------------------
  // Provider ClientIds are opaque (e.g. "RGU2Ag=="), not something an admin
  // can guess. This searches /api/Client/GetAllClients (via
  // admin-client-lookup.js) by company name so the admin can find the right
  // ClientId without needing it handed to them separately.
  function clientResultRow(c) {
    return '<div class="admin-autocomplete-item" data-client-id="' + escapeHtml(c.clientId) + '">' +
      escapeHtml(c.companyName) + '<span style="color:var(--text-secondary); font-size:12px; margin-left:8px;">' + escapeHtml(c.clientId) + '</span></div>';
  }

  function searchClientsByName(q) {
    var resultsEl = document.getElementById('clientNameResults');
    if (!q || !q.trim()) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; return; }
    apiFetch('/.netlify/functions/admin-client-lookup?q=' + encodeURIComponent(q.trim()))
      .then(function (data) {
        var clients = data.clients || [];
        if (!clients.length) {
          resultsEl.innerHTML = '<div class="admin-autocomplete-item admin-autocomplete-empty">No matching clients found.</div>';
        } else {
          resultsEl.innerHTML = clients.map(clientResultRow).join('');
        }
        resultsEl.style.display = '';
      })
      .catch(function (err) {
        resultsEl.innerHTML = '<div class="admin-autocomplete-item admin-autocomplete-empty">' + escapeHtml(err.message || 'Unable to search clients right now.') + '</div>';
        resultsEl.style.display = '';
      });
  }

  // ------------------------------- Devices -----------------------------------
  var lastDiscoveredDevices = [];

  function deviceRow(d) {
    var assigned = d.assignedAssetId && d.assignedAssetId !== 'Data unavailable';
    return (
      '<tr>' +
      '<td>' + escapeHtml(d.deviceId) + '</td>' +
      '<td>' + escapeHtml(d.imeiNumber) + '</td>' +
      '<td>' + escapeHtml(d.serialNumber) + '</td>' +
      '<td>' + (assigned ? escapeHtml(d.assignedAssetId) : '<span class="fi-badge fi-badge-muted">Unassigned</span>') + '</td>' +
      '<td>' + escapeHtml(d.lastGpsDateTime) + '</td>' +
      '<td><button class="btn btn-outline admin-row-btn" data-device-id="' + escapeHtml(d.deviceId) + '">Assign…</button></td>' +
      '</tr>'
    );
  }

  function showDeviceState(which) {
    ['devLoading', 'devError', 'devEmpty', 'devTableWrap'].forEach(function (id) {
      document.getElementById(id).style.display = id === which ? '' : 'none';
    });
  }

  function discoverDevices() {
    showDeviceState('devLoading');
    var clientId = document.getElementById('devClientIdFilter').value.trim();
    var url = '/.netlify/functions/admin-devices' + (clientId ? '?clientId=' + encodeURIComponent(clientId) : '');
    apiFetch(url)
      .then(function (data) {
        lastDiscoveredDevices = data.devices || [];
        if (!lastDiscoveredDevices.length) { showDeviceState('devEmpty'); return; }
        document.getElementById('devTableBody').innerHTML = lastDiscoveredDevices.map(deviceRow).join('');
        showDeviceState('devTableWrap');
      })
      .catch(function (err) {
        document.getElementById('devErrorText').textContent = err.message || 'Unable to retrieve devices right now.';
        showDeviceState('devError');
      });
  }

  function openAssignModal(deviceId) {
    var device = lastDiscoveredDevices.filter(function (d) { return d.deviceId === deviceId; })[0];
    if (!device) return;

    loadMappingData().then(function (vehicles) {
      var unmapped = vehicles.filter(function (v) { return !v.isMapped; });
      var options = unmapped.length
        ? unmapped.map(function (v) {
            return '<option value="' + escapeHtml(v.id) + '|' + escapeHtml(v.customerId) + '">' +
              escapeHtml(v.label || [v.make, v.model].filter(Boolean).join(' ') || v.id) + ' — ' + escapeHtml(v.customerEmail) +
              '</option>';
          }).join('')
        : '<option value="">No unmapped vehicles — create one first</option>';

      var bodyHtml =
        '<p>Assign device <strong>' + escapeHtml(device.deviceId) + '</strong> (IMEI ' + escapeHtml(device.imeiNumber) + ')?</p>' +
        '<label class="form-label">Target Vehicle</label>' +
        '<select class="form-select" id="assignVehicleSelect" style="margin-bottom:10px;">' + options + '</select>' +
        '<label class="form-label">White-Label Client ID</label>' +
        '<input type="text" class="form-input" id="assignClientIdInput" value="' + escapeHtml(document.getElementById('devClientIdFilter').value.trim()) + '" style="margin-bottom:10px;">' +
        '<label class="form-label">Asset ID</label>' +
        '<input type="text" class="form-input" id="assignAssetIdInput" placeholder="Provider Asset ID">';

      showModal({
        title: 'Assign this device to a vehicle?',
        bodyHtml: bodyHtml,
        confirmLabel: 'Confirm Assignment',
        onConfirm: function () {
          var sel = document.getElementById('assignVehicleSelect').value;
          if (!sel) return Promise.resolve();
          var parts = sel.split('|');
          var vehicleId = parts[0], customerId = parts[1];
          var clientId = document.getElementById('assignClientIdInput').value.trim();
          var assetId = document.getElementById('assignAssetIdInput').value.trim();
          if (!clientId || !assetId) { alert('Client ID and Asset ID are both required.'); return Promise.resolve(); }

          return apiFetch('/.netlify/functions/admin-device-assign', {
            method: 'POST',
            body: JSON.stringify({ customerId: customerId, vehicleId: vehicleId, whiteLabelClientId: clientId, assetId: assetId, deviceId: device.deviceId }),
          }).then(function () {
            hideModal();
            discoverDevices();
            loadMappingData(true);
          }).catch(function (err) { alert(err.message || 'Unable to assign the device.'); });
        },
      });
    });
  }

  // ------------------------------ Vehicles / Mapping --------------------------
  var mappingCache = null;

  function statusBadge(v) {
    return v.isMapped
      ? '<span class="fi-badge fi-badge-success"><span class="fi-dot fi-dot-success" style="margin-right:6px;"></span>Mapped</span>'
      : '<span class="fi-badge fi-badge-muted"><span class="fi-dot fi-dot-muted" style="margin-right:6px;"></span>Unmapped</span>';
  }

  function mappingRow(v) {
    var name = escapeHtml(v.label || [v.make, v.model].filter(Boolean).join(' ') || v.id);
    var deviceInfo = v.isMapped ? escapeHtml(v.whiteLabelDeviceId) + ' / ' + escapeHtml(v.imei || 'Data unavailable') : '—';
    var actionBtn = v.isMapped
      ? '<button class="btn btn-outline admin-row-btn admin-unassign-btn" data-vehicle-id="' + escapeHtml(v.id) + '" data-customer-id="' + escapeHtml(v.customerId) + '">Unassign</button>'
      : '';
    return (
      '<tr>' +
      '<td>' + name + (v.plateNumber ? '<br><span style="color:var(--text-secondary); font-size:12px;">' + escapeHtml(v.plateNumber) + '</span>' : '') + '</td>' +
      '<td>' + escapeHtml(v.customerName || v.customerEmail) + '<br><span style="color:var(--text-secondary); font-size:12px;">' + escapeHtml(v.customerEmail) + '</span></td>' +
      '<td>' + statusBadge(v) + '</td>' +
      '<td>' + deviceInfo + '</td>' +
      '<td>' + actionBtn + '</td>' +
      '</tr>'
    );
  }

  function showMapState(which) {
    ['mapLoading', 'mapError', 'mapEmpty', 'mapTableWrap'].forEach(function (id) {
      document.getElementById(id).style.display = id === which ? '' : 'none';
    });
  }

  function loadMappingData(silent) {
    if (!silent) showMapState('mapLoading');
    return apiFetch('/.netlify/functions/admin-vehicles')
      .then(function (data) {
        mappingCache = data.vehicles || [];
        document.getElementById('mapIntro').textContent = mappingCache.length
          ? 'Every FleetHive vehicle and its current device-mapping status.'
          : 'No vehicles have been created yet.';
        if (!mappingCache.length) { showMapState('mapEmpty'); return mappingCache; }
        document.getElementById('mapTableBody').innerHTML = mappingCache.map(mappingRow).join('');
        showMapState('mapTableWrap');
        return mappingCache;
      })
      .catch(function () {
        showMapState('mapError');
        return [];
      });
  }

  function openUnassignModal(vehicleId, customerId) {
    var vehicle = (mappingCache || []).filter(function (v) { return v.id === vehicleId; })[0];
    var name = vehicle ? (vehicle.label || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicleId) : vehicleId;
    showModal({
      title: 'Unassign this device?',
      bodyHtml: '<p>Are you sure you want to unassign the device from <strong>' + escapeHtml(name) + '</strong>? This cannot be undone from here.</p>',
      confirmLabel: 'Unassign',
      onConfirm: function () {
        return apiFetch('/.netlify/functions/admin-device-unassign', {
          method: 'POST',
          body: JSON.stringify({ customerId: customerId, vehicleId: vehicleId }),
        }).then(function () {
          hideModal();
          loadMappingData(true);
        }).catch(function (err) { alert(err.message || 'Unable to unassign the device.'); });
      },
    });
  }

  function createVehicle() {
    var select = document.getElementById('custSelect');
    var customerId = select.value;
    var msg = document.getElementById('vehCreateMsg');
    if (!customerId) { msg.textContent = 'Choose a customer first.'; msg.style.color = 'var(--danger)'; return; }

    var payload = {
      customerId: customerId,
      label: document.getElementById('vehLabelInput').value.trim(),
      make: document.getElementById('vehMakeInput').value.trim(),
      model: document.getElementById('vehModelInput').value.trim(),
      plateNumber: document.getElementById('vehPlateInput').value.trim(),
    };

    apiFetch('/.netlify/functions/admin-vehicles', { method: 'POST', body: JSON.stringify(payload) })
      .then(function () {
        msg.textContent = 'Vehicle created.';
        msg.style.color = 'var(--success)';
        ['vehLabelInput', 'vehMakeInput', 'vehModelInput', 'vehPlateInput'].forEach(function (id) { document.getElementById(id).value = ''; });
        loadMappingData(true);
      })
      .catch(function (err) {
        msg.textContent = err.message || 'Unable to create the vehicle.';
        msg.style.color = 'var(--danger)';
      });
  }

  // -------------------------------- Audit log ---------------------------------
  function auditRow(entry) {
    return (
      '<div class="admin-audit-row">' +
      '<div><strong>' + escapeHtml(entry.action) + '</strong> — ' + escapeHtml(entry.detail || '') + '</div>' +
      '<div style="color:var(--text-secondary); font-size:12px;">' + formatDateTime(entry.timestamp) + ' · ' + escapeHtml(entry.adminEmail || 'Unknown admin') + '</div>' +
      '</div>'
    );
  }

  function loadAuditLog() {
    apiFetch('/.netlify/functions/admin-audit-log')
      .then(function (data) {
        var entries = data.entries || [];
        var listEl = document.getElementById('auditList');
        var emptyEl = document.getElementById('auditEmpty');
        if (!entries.length) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
        emptyEl.style.display = 'none';
        listEl.innerHTML = entries.map(auditRow).join('');
      })
      .catch(function () { /* non-critical panel — fail silently */ });
  }

  // ---------------------------------- Boot -------------------------------------
  function boot() {
    fetch('/.netlify/functions/auth-me', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.customer) { redirectToLogin(); return; }
        document.getElementById('adminChecking').style.display = 'none';

        if (!data.isAdmin) {
          document.getElementById('adminDenied').style.display = '';
          return;
        }

        document.getElementById('adminWelcome').style.display = '';
        document.getElementById('adminBody').style.display = '';
        initModal();

        discoverDevices();
        loadMappingData();
        loadAuditLog();
        searchCustomers('');

        document.getElementById('devDiscoverBtn').addEventListener('click', discoverDevices);
        document.getElementById('devRetry').addEventListener('click', discoverDevices);

        var clientNameInput = document.getElementById('clientNameSearchInput');
        var clientSearchTimer = null;
        clientNameInput.addEventListener('input', function () {
          clearTimeout(clientSearchTimer);
          var val = clientNameInput.value;
          clientSearchTimer = setTimeout(function () { searchClientsByName(val); }, 250);
        });
        document.getElementById('clientNameResults').addEventListener('click', function (e) {
          var item = e.target.closest('[data-client-id]');
          if (!item) return;
          document.getElementById('devClientIdFilter').value = item.getAttribute('data-client-id');
          document.getElementById('clientNameResults').style.display = 'none';
          clientNameInput.value = '';
        });
        document.addEventListener('click', function (e) {
          if (!e.target.closest('#clientNameSearchInput') && !e.target.closest('#clientNameResults')) {
            document.getElementById('clientNameResults').style.display = 'none';
          }
        });
        document.getElementById('mapRetry').addEventListener('click', function () { loadMappingData(); });
        document.getElementById('vehCreateBtn').addEventListener('click', createVehicle);

        var custSearchInput = document.getElementById('custSearchInput');
        var searchTimer = null;
        custSearchInput.addEventListener('input', function () {
          clearTimeout(searchTimer);
          var val = custSearchInput.value;
          searchTimer = setTimeout(function () { searchCustomers(val); }, 250);
        });

        document.getElementById('devTableBody').addEventListener('click', function (e) {
          var btn = e.target.closest('[data-device-id]');
          if (btn) openAssignModal(btn.getAttribute('data-device-id'));
        });
        document.getElementById('mapTableBody').addEventListener('click', function (e) {
          var btn = e.target.closest('.admin-unassign-btn');
          if (btn) openUnassignModal(btn.getAttribute('data-vehicle-id'), btn.getAttribute('data-customer-id'));
        });
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
