// The script behind the hidden administrator sign-in page (adminLogin.js serves it next to the page).
// It calls the SAME endpoint the normal form calls (POST /api/auth/login) and, on success, stores the session exactly as
// src/components/AuthPage.jsx does: localStorage `token` and `user` (the server also sets its HttpOnly `token` cookie).
// Then it opens `/` so the SPA picks the session up. A FILE, not an inline script: the CSP allows no inline scripts.
(function () {
  'use strict';
  var API = '/api/auth/login';
  var GENERIC = 'That did not work. Check the details and try again.';
  var LOCKED = 'Too many attempts. Try again later.';
  var DOWN = 'Sign-in is not available right now. Try again later.';
  var NOSTORE = 'This browser blocked storage, so the session could not be kept. Allow site data and try again.';

  try {   // the SPA's saved theme choice, as public/theme-init.js reads it
    var c = localStorage.getItem('sw-theme');
    if (c === 'light' || c === 'dark') document.documentElement.setAttribute('data-theme', c);
  } catch (e) { /* storage unreadable: the page follows the device */ }

  var form = document.getElementById('f');
  var email = document.getElementById('email');
  var password = document.getElementById('password');
  var button = document.getElementById('go');
  var msg = document.getElementById('msg');
  if (!form || !email || !password || !button || !msg) return;

  function show(text) { msg.textContent = text; msg.hidden = !text; }

  function submit() {
    show('');
    button.disabled = true;
    var body = JSON.stringify({ email: email.value.trim(), password: password.value });
    return fetch(API, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Stories-Entry': 'admin-local-login' },
      body: body,
    }).then(function (res) {
      if (res.status === 429) { show(LOCKED); return; }
      if (res.status >= 500) { show(DOWN); return; }
      if (!res.ok) { show(GENERIC); return; }
      return res.json().then(function (data) {
        if (!data || typeof data.token !== 'string' || !data.token || !data.user || typeof data.user !== 'object') { show(GENERIC); return; }
        try {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));
        } catch (e) { show(NOSTORE); return; }
        password.value = '';
        location.replace('/');
      });
    }).catch(function () {
      show(DOWN);
    }).then(function () {
      password.value = '';
      button.disabled = false;
    });
  }

  form.addEventListener('submit', function (ev) { ev.preventDefault(); submit(); });
})();
