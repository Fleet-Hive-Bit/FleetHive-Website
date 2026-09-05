// login.js
//
// FleetHive's single customer login/registration page. There is no
// second, provider-branded login anywhere in this flow — both forms here
// talk only to FleetHive's own auth-* functions, which never touch the
// white-label provider (see netlify/functions/_auth.js).

(function () {
  var tabLogin = document.getElementById('tabLogin');
  var tabRegister = document.getElementById('tabRegister');
  var loginForm = document.getElementById('loginForm');
  var registerForm = document.getElementById('registerForm');
  var authHeading = document.getElementById('authHeading');
  var authLead = document.getElementById('authLead');

  function showLogin() {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.style.display = '';
    registerForm.style.display = 'none';
    authHeading.textContent = 'Welcome back';
    authLead.textContent = 'One FleetHive login for your Customer Portal and Fleet Intelligence.';
  }
  function showRegister() {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.style.display = '';
    loginForm.style.display = 'none';
    authHeading.textContent = 'Create your FleetHive account';
    authLead.textContent = 'Set up your account once to access your Customer Portal and Fleet Intelligence.';
  }
  tabLogin.addEventListener('click', showLogin);
  tabRegister.addEventListener('click', showRegister);

  // If the query string asks for the register tab (e.g. a "Get Started"
  // link elsewhere could point here with ?tab=register), honor it.
  if (/[?&]tab=register/.test(window.location.search)) showRegister();

  // Account-type pills (register form)
  var customerType = 'private';
  var pills = document.querySelectorAll('#registerForm .choice-pill');
  pills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      pills.forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      customerType = pill.getAttribute('data-type');
    });
  });

  // If a session already exists, there is no second login — go straight
  // to the portal.
  fetch('/.netlify/functions/auth-me', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (data && data.customer) window.location.replace('portal.html');
    })
    .catch(function () {});

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = document.getElementById('loginMsg');
    var btn = document.getElementById('loginSubmit');
    msg.textContent = '';
    msg.style.color = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    fetch('/.netlify/functions/auth-login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value,
      }),
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (result.ok) {
          window.location.href = 'portal.html';
          return;
        }
        msg.style.color = '#EF4444';
        msg.textContent = (result.data && result.data.error) || 'We were unable to sign you in right now. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      })
      .catch(function () {
        msg.style.color = '#EF4444';
        msg.textContent = "We're unable to reach FleetHive right now. Please try again.";
        btn.disabled = false;
        btn.textContent = 'Sign In';
      });
  });

  registerForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = document.getElementById('registerMsg');
    var btn = document.getElementById('registerSubmit');
    msg.textContent = '';
    msg.style.color = '';
    btn.disabled = true;
    btn.textContent = 'Creating account…';

    fetch('/.netlify/functions/auth-register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        password: document.getElementById('regPassword').value,
        customerType: customerType,
      }),
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (result.ok) {
          window.location.href = 'portal.html';
          return;
        }
        msg.style.color = '#EF4444';
        msg.textContent = (result.data && result.data.error) || 'We were unable to create your account. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Create Account';
      })
      .catch(function () {
        msg.style.color = '#EF4444';
        msg.textContent = "We're unable to reach FleetHive right now. Please try again.";
        btn.disabled = false;
        btn.textContent = 'Create Account';
      });
  });
})();
