// The hidden administrator sign-in page (break-glass for PORTAL_ONLY): the page and its headers, the script's behaviour, the
// hardened login surface (same-origin, body cap, own failure budget, one uniform failure, audit lines) and the modes it is off in.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { startApp, hash, JWT_SECRET } from './harness.js';
import * as AL from '../adminLogin.js';

const {
  ADMIN_LOGIN_PATH, ADMIN_LOGIN_SCRIPT, ENTRY_HEADER, ENTRY_VALUE, GENERIC, LOCKED, MAX_FAILURES, ipClass, createWindowCounter,
} = AL;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..', '..');
const PW = 'Correct-Horse-9!';
const ADMIN = 'boss@example.com';
const READER = 'reader@example.com';

const lines = () => {
  const out = [];
  return { out, log: { error() {}, warn() {}, log: (...a) => out.push(a.join(' ')) } };
};

async function withApp(opts, fn) {
  const sink = lines();
  const t = await startApp({ realLogin: true, log: sink.log, ...opts });
  t.store.add({ email: ADMIN, role: 'admin', password_hash: hash(PW), name: 'Boss', email_verified: true });
  t.store.add({ email: READER, role: 'user', password_hash: hash(PW), name: 'Reader', email_verified: true });
  t.lines = sink.out;
  try { await fn(t); } finally { await t.close(); }
}

/** What the page's fetch sends from a browser on the same origin; `over` changes it. */
const post = (t, body, over = {}) => fetch(t.base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', [ENTRY_HEADER]: ENTRY_VALUE, origin: t.base, 'sec-fetch-site': 'same-origin', ...(over.headers || {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const fromIp = (ip) => ({ headers: { 'x-forwarded-for': ip } });

/* ── the page ──────────────────────────────────────────────────────────────────────────────────── */
test('the page is served with the privacy headers; it asks for email and password and says administrators only', async () => {
  await withApp({}, async (t) => {
    const r = await fetch(t.base + ADMIN_LOGIN_PATH);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'(;|$)/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    const html = await r.text();
    assert.match(html, /name="robots" content="noindex, nofollow/);
    assert.match(html, /type="email"/);
    assert.match(html, /type="password"/);
    assert.match(html, /administrators only/i);
    assert.match(html, /href="\/auth\/portal\/login"/);          // everyone else is pointed at SAI Cloud
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);  // no inline script: the CSP allows none
    assert.doesNotMatch(html, /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u);   // no emoji
    assert.match(html, /<meta name="viewport"/);

    const s = await fetch(t.base + ADMIN_LOGIN_SCRIPT);
    assert.equal(s.status, 200);
    assert.match(s.headers.get('content-type'), /javascript/);
    assert.match(s.headers.get('cache-control'), /no-store/);
    assert.equal(s.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  });
});

test('nothing else links to the page: no served page, no SPA source, no robots.txt or sitemap', async () => {
  await withApp({}, async (t) => {
    for (const p of ['/api/auth/portal/config', '/auth/portal/login', '/robots.txt', '/sitemap.xml']) {
      const r = await fetch(t.base + p, { redirect: 'manual' });
      const text = await r.text();
      assert.ok(!text.includes('local-login'), p);
      assert.ok(!(r.headers.get('location') || '').includes('local-login'), p);
    }
  });
  const hits = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'tests'].includes(f.name)) continue;
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (/\.(jsx?|html|css|txt|xml|json|webmanifest|svg)$/.test(f.name) && fs.readFileSync(full, 'utf8').includes('local-login')) hits.push(path.relative(REPO, full));
    }
  };
  for (const d of ['src', 'public']) if (fs.existsSync(path.join(REPO, d))) walk(path.join(REPO, d));
  if (fs.existsSync(path.join(REPO, 'index.html'))) assert.ok(!fs.readFileSync(path.join(REPO, 'index.html'), 'utf8').includes('local-login'));
  assert.deepEqual(hits, []);
});

test('without its script the page cannot send credentials anywhere: the form is hidden, has no action, is method=dialog, and the CSP allows no form submission', async () => {
  await withApp({}, async (t) => {
    const r = await fetch(t.base + ADMIN_LOGIN_PATH);
    const html = await r.text();
    const forms = html.match(/<form\b[^>]*>/gi) || [];
    assert.equal(forms.length, 1);
    const tag = forms[0];
    assert.match(tag, /\shidden(\s|>|=)/);                            // not reachable until the script un-hides it
    assert.match(tag, /method="dialog"/);                              // a submit outside a <dialog> does nothing
    assert.doesNotMatch(tag, /\saction\s*=/i);                         // nowhere to go (a form with none would GET the same URL, credentials in the query)
    assert.doesNotMatch(html, /method\s*=\s*["']?(post|get)/i);
    assert.doesNotMatch(html, /formaction/i);
    assert.match(r.headers.get('content-security-policy'), /form-action 'none'/);   // and the browser would refuse it anyway
    assert.match(html, /id="boot"[^>]*>[^<]*needs JavaScript/);        // what a visitor sees if the script never runs
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
    // every input is inside that hidden form
    assert.equal((html.match(/<input\b/g) || []).length, 2);
    assert.ok(html.indexOf('<form') < html.indexOf('<input') && html.lastIndexOf('<input') < html.indexOf('</form>'));
  });
});

test('page script: un-hides the form and hides the "needs JavaScript" notice', () => {
  const p = runPage({ fetchImpl: reply(200, {}) });
  assert.equal(p.els.f.hidden, false);
  assert.equal(p.els.boot.hidden, true);
});

/* ── the script, run as a browser would (vm with stubs) ────────────────────────────────────────── */
const SCRIPT = fs.readFileSync(path.join(here, '..', 'adminLoginPage.client.js'), 'utf8');
function runPage({ fetchImpl, storageFails = false, savedTheme = null }) {
  const store = new Map(savedTheme ? [['sw-theme', savedTheme]] : []);
  const listeners = {};
  const el = (id) => ({ id, value: '', hidden: id === 'msg' || id === 'f', disabled: false, textContent: '', addEventListener: (ev, fn) => { listeners[id + ':' + ev] = fn; } });
  const els = Object.fromEntries(['f', 'email', 'password', 'go', 'msg', 'boot'].map((id) => [id, el(id)]));
  const attrs = {};
  const calls = [];
  const ctx = {
    document: { getElementById: (id) => els[id], documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { if (storageFails && k !== 'sw-theme') throw new Error('blocked'); store.set(k, v); },
    },
    location: { replaced: null, replace(u) { this.replaced = u; } },
    fetch: (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    JSON, Promise, Error,
  };
  vm.runInNewContext(SCRIPT, ctx);
  const submit = async (email, password) => {
    els.email.value = email; els.password.value = password;
    let prevented = false;
    listeners['f:submit']({ preventDefault: () => { prevented = true; } });
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
    return prevented;
  };
  return { els, store, calls, ctx, attrs, submit };
}
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('page script: success stores `token` and `user` exactly as the SPA login does, then opens /', async () => {
  const user = { id: 'u1', email: 'boss@example.com', role: 'admin' };
  const p = runPage({ fetchImpl: reply(200, { token: 'jwt-value', user }) });
  assert.equal(await p.submit('  boss@example.com ', 'pw'), true);   // preventDefault: no native form post
  assert.equal(p.store.get('token'), 'jwt-value');
  assert.deepEqual(JSON.parse(p.store.get('user')), user);
  assert.equal(p.ctx.location.replaced, '/');
  assert.equal(p.els.password.value, '');
  const c = p.calls[0];
  assert.equal(c.url, '/api/auth/login');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.credentials, 'include');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.equal(c.init.headers['X-Stories-Entry'], ENTRY_VALUE);
  assert.deepEqual(JSON.parse(c.init.body), { email: 'boss@example.com', password: 'pw' });
});

test('page script: one generic message for any refusal, the "try again later" text for 429, and nothing stored', async () => {
  for (const status of [400, 401, 403, 404]) {
    const p = runPage({ fetchImpl: reply(status, { error: 'this account is not an admin' }) });
    await p.submit('a@b.c', 'x');
    assert.equal(p.els.msg.textContent, GENERIC, String(status));
    assert.equal(p.els.msg.hidden, false);
    assert.equal(p.store.has('token'), false);
    assert.equal(p.ctx.location.replaced, null);
    assert.equal(p.els.go.disabled, false);
  }
  const locked = runPage({ fetchImpl: reply(429, { error: 'whatever' }) });
  await locked.submit('a@b.c', 'x');
  assert.equal(locked.els.msg.textContent, LOCKED);
  const down = runPage({ fetchImpl: async () => { throw new Error('offline'); } });
  await down.submit('a@b.c', 'x');
  assert.match(down.els.msg.textContent, /not available right now/);
  const bad = runPage({ fetchImpl: reply(200, { nothing: true }) });
  await bad.submit('a@b.c', 'x');
  assert.equal(bad.els.msg.textContent, GENERIC);
  assert.equal(bad.store.has('token'), false);
});

test('page script: blocked storage is said plainly and does not navigate; a saved theme is honoured', async () => {
  const p = runPage({ fetchImpl: reply(200, { token: 't', user: { id: 1 } }), storageFails: true, savedTheme: 'dark' });
  assert.equal(p.attrs['data-theme'], 'dark');
  await p.submit('a@b.c', 'x');
  assert.match(p.els.msg.textContent, /blocked storage/);
  assert.equal(p.ctx.location.replaced, null);
});

test('page script against the real server: the stored token is a working session for the SPA (bearer and cookie)', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    let setCookie = '';
    const p = runPage({
      fetchImpl: async (url, init) => {
        const r = await fetch(t.base + url, { ...init, headers: { ...init.headers, origin: t.base, 'sec-fetch-site': 'same-origin' } });
        setCookie = r.headers.get('set-cookie') || '';
        return r;
      },
    });
    await p.submit(ADMIN, PW);
    const token = p.store.get('token');
    assert.ok(token, 'token stored');
    assert.equal(JSON.parse(p.store.get('user')).role, 'admin');
    assert.equal(JSON.parse(p.store.get('user')).email, ADMIN);
    assert.equal(p.ctx.location.replaced, '/');
    assert.match(setCookie, /^token=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.equal((await fetch(t.base + '/api/with-token', { headers: { authorization: 'Bearer ' + token } })).status, 200);
  });
});

/* ── who gets in, and what they are told ───────────────────────────────────────────────────────── */
test('under PORTAL_ONLY: admin password works; wrong password, a non-admin (right password), an unknown address all get the SAME answer', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    const ok = await post(t, { email: ADMIN, password: PW }, fromIp('10.1.0.1'));
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).token);
    const answers = [];
    let n = 2;
    for (const body of [
      { email: ADMIN, password: 'wrong-password' },       // admin, wrong password
      { email: READER, password: PW },                      // NOT an admin, RIGHT password
      { email: READER, password: 'wrong-password' },        // not an admin, wrong password
      { email: 'nobody@example.com', password: PW },        // no such account
    ]) {
      const r = await post(t, body, fromIp('10.1.0.' + (n++) * 20));   // a different IP class each, so the budget is not what answers
      answers.push({ status: r.status, body: await r.json() });
    }
    for (const a of answers) assert.deepEqual(a, { status: 401, body: { error: GENERIC } });
  });
});

test('every refusal costs one bcrypt compare (the same timing class), whichever way it is refused', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    const real = bcrypt.compare;
    let calls = 0;
    bcrypt.compare = (...a) => { calls += 1; return real.apply(bcrypt, a); };
    try {
      let n = 1;
      const counts = {};
      for (const [label, body] of Object.entries({
        adminWrong: { email: ADMIN, password: 'wrong-password' },
        nonAdminRight: { email: READER, password: PW },
        nonAdminWrong: { email: READER, password: 'wrong-password' },
        unknown: { email: 'nobody@example.com', password: PW },
      })) {
        calls = 0;
        const r = await post(t, body, fromIp('10.2.' + n++ + '.1'));
        assert.equal(r.status, 401, label);
        counts[label] = calls;
      }
      assert.deepEqual(counts, { adminWrong: 1, nonAdminRight: 1, nonAdminWrong: 1, unknown: 1 });
    } finally { bcrypt.compare = real; }
  });
});

test('PORTAL_ONLY off: the page is just the same login (a non-admin with the right password gets in), the refusal text is still generic', async () => {
  await withApp({}, async (t) => {
    const r = await post(t, { email: READER, password: PW });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).user.email, READER);
    const bad = await post(t, { email: READER, password: 'nope' }, fromIp('10.3.0.1'));
    assert.deepEqual([bad.status, await bad.json()], [401, { error: GENERIC }]);
  });
});

test('a suspended account is refused with the same generic answer', async () => {
  await withApp({}, async (t) => {
    t.store.add({ email: 'gone@example.com', role: 'admin', status: 'suspended', password_hash: hash(PW) });
    const r = await post(t, { email: 'gone@example.com', password: PW });
    assert.deepEqual([r.status, await r.json()], [401, { error: GENERIC }]);
  });
});

/* ── the budget ────────────────────────────────────────────────────────────────────────────────── */
test('five failures lock the ACCOUNT (even for the right password); another account elsewhere is unaffected', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    const statuses = [];
    for (let i = 0; i < MAX_FAILURES; i++) statuses.push((await post(t, { email: ADMIN, password: 'wrong-' + i }, fromIp('10.4.' + i + '.1'))).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401]);       // different IP classes: only the account budget is being spent
    const locked = await post(t, { email: ADMIN, password: PW }, fromIp('10.4.99.1'));
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('retry-after'), '900');
    assert.deepEqual(await locked.json(), { error: LOCKED });
    // the address is hashed into the key: a different case of the same address is the same account
    assert.equal((await post(t, { email: ADMIN.toUpperCase(), password: PW }, fromIp('10.4.98.1'))).status, 429);
    t.store.add({ email: 'second@example.com', role: 'admin', password_hash: hash(PW) });
    assert.equal((await post(t, { email: 'second@example.com', password: PW }, fromIp('10.4.97.1'))).status, 200);
  });
});

test('the IP CLASS has its own budget: five failures from one /24 lock it for every account, another /24 is unaffected', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    for (let i = 0; i < MAX_FAILURES; i++) assert.equal((await post(t, { email: `who${i}@example.com`, password: 'x' }, fromIp('10.5.5.' + (i + 1)))).status, 401);
    assert.equal((await post(t, { email: ADMIN, password: PW }, fromIp('10.5.5.200'))).status, 429);   // same /24, a fresh account, the right password
    assert.equal((await post(t, { email: ADMIN, password: PW }, fromIp('10.5.6.1'))).status, 200);     // next /24
  });
});

test('successes are given back: many good sign-ins never lock anything', async () => {
  await withApp({}, async (t) => {
    for (let i = 0; i < MAX_FAILURES * 2; i++) assert.equal((await post(t, { email: ADMIN, password: PW }, fromIp('10.6.0.1'))).status, 200);
  });
});

test('parallel guesses cannot slip past the budget: of 20 at once, only five ever reach the login handler', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post(t, { email: ADMIN, password: 'guess-' + i }, fromIp('10.7.0.1'))));
    const by = rs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
    assert.deepEqual(by, { 401: MAX_FAILURES, 429: 20 - MAX_FAILURES });
  });
});

test('ipClass: /24 for IPv4 (also mapped), /64 for IPv6, never throws', () => {
  assert.equal(ipClass('203.0.113.77'), '203.0.113.0/24');
  assert.equal(ipClass('::ffff:203.0.113.77'), '203.0.113.0/24');
  assert.equal(ipClass('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipClass('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipClass('::1'), '0:0:0:0::/64');
  for (const bad of ['', undefined, 'not an ip', '1:2:3', '::g']) assert.equal(ipClass(bad), 'unknown');
});

/** A Redis stand-in that understands the two scripts by identity (the real thing is exercised in login-budget.test.js). */
function luaFake() {
  const data = new Map();
  return {
    data,
    async eval(script, { keys, arguments: args = [] }) {
      const k = keys[0];
      if (script === AL.HIT_LUA) { data.set(k, (data.get(k) || 0) + 1); return data.get(k); }
      if (script === AL.RELEASE_LUA) { if ((data.get(k) || 0) > 0) data.set(k, data.get(k) - 1); return data.get(k) || 0; }
      throw new Error('unknown script');
    },
  };
}

test('the counter: Redis when it answers (shared, with release), process memory when it does not or hangs', async () => {
  const fake = luaFake();
  const quiet = { warn() {}, log() {} };
  const c = createWindowCounter({ redis: () => fake, log: quiet });
  const a = await c.hit('k');
  assert.equal(a.n, 1);
  assert.equal((await c.hit('k')).n, 2);
  await a.release();
  assert.equal((await c.hit('k')).n, 2);
  assert.ok([...fake.data.keys()].every((k) => k.startsWith('stories:admin-login:')));
  const hung = createWindowCounter({ redis: () => ({ eval: () => new Promise(() => {}) }), redisTimeoutMs: 20, log: quiet });
  assert.equal((await hung.hit('k')).n, 1);
  assert.equal((await hung.hit('k')).n, 2);        // memory took over and keeps counting
  const broken = createWindowCounter({ redis: () => { throw new Error('no client'); }, log: quiet });
  assert.equal((await broken.hit('k')).n, 1);
  let t = 1000;
  const windowed = createWindowCounter({ now: () => t, windowMs: 1000, log: quiet });
  await windowed.hit('k'); await windowed.hit('k');
  t += 1001;
  assert.equal((await windowed.hit('k')).n, 1);    // a new window
});

/* ── same-origin, content type, body cap ───────────────────────────────────────────────────────── */
test('cross-site requests are refused before anything else: foreign Origin, cross-site Sec-Fetch-Site, no Origin at all', async () => {
  await withApp({}, async (t) => {
    const body = { email: ADMIN, password: PW };
    for (const [label, headers] of Object.entries({
      foreignOrigin: { origin: 'https://evil.example' },
      crossSite: { 'sec-fetch-site': 'cross-site' },
      sameSiteOnly: { 'sec-fetch-site': 'same-site' },
      none: { 'sec-fetch-site': 'none' },
      nullOrigin: { origin: 'null' },
    })) {
      const r = await post(t, body, { headers });
      assert.equal(r.status, 403, label);
      assert.deepEqual(await r.json(), { error: GENERIC }, label);
    }
    const noOrigin = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', [ENTRY_HEADER]: ENTRY_VALUE }, body: JSON.stringify(body) });
    assert.equal(noOrigin.status, 403);
    assert.equal((await post(t, body)).status, 200);                       // the same request from this origin is fine
    // a refused request spent nothing: no failure was counted against the account
    for (let i = 0; i < 3; i++) assert.equal((await post(t, body, { headers: { origin: 'https://evil.example' } })).status, 403);
  });
});

test('JSON only, 2 KB at most, valid JSON, both fields present', async () => {
  await withApp({}, async (t) => {
    assert.equal((await post(t, 'email=a&password=b', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await post(t, '{}', { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await post(t, { email: ADMIN, password: 'x'.repeat(5000) })).status, 413);
    assert.equal((await post(t, '{not json')).status, 400);
    assert.equal((await post(t, '[1,2]')).status, 400);
    assert.equal((await post(t, { email: ADMIN })).status, 400);
    assert.equal((await post(t, { email: 1, password: 2 })).status, 400);
    const r = await post(t, { email: ADMIN });
    assert.deepEqual(await r.json(), { error: GENERIC });
    assert.equal((await post(t, { email: ADMIN, password: PW })).status, 200);
  });
});

test('unmarked login requests are untouched: no Origin check, the old answers, and a looser per-account budget than the page', async () => {
  await withApp({}, async (t) => {
    const plain = (body, headers = {}) => fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example', ...headers }, body: JSON.stringify(body) });
    for (let i = 0; i < MAX_FAILURES + 2; i++) assert.equal((await plain({ email: ADMIN, password: 'wrong' })).status, 401);
    const r = await plain({ email: ADMIN, password: 'wrong' });
    assert.deepEqual(await r.json(), { error: 'Invalid email or password' });   // the normal endpoint keeps its own wording
    // the account counter is SHARED: after eight failures the page (limit 5) is locked for that account, the normal form (limit 10) is not yet
    assert.equal((await post(t, { email: ADMIN, password: PW }, fromIp('10.8.0.1'))).status, 429);
    assert.equal((await plain({ email: ADMIN, password: PW })).status, 200);
    assert.equal((await post(t, { email: READER, password: PW }, fromIp('10.8.0.1'))).status, 200);   // another account is unaffected
  });
});

/* ── audit lines ───────────────────────────────────────────────────────────────────────────────── */
test('one audit line per attempt: outcome, account id or unknown, IP class; never the email, the password or the full address', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    const secret = 'Sup3r-Secret-Typed-Pw!';
    await post(t, { email: ADMIN, password: PW }, fromIp('198.51.100.7'));                                  // success
    await post(t, { email: ADMIN, password: secret }, fromIp('198.51.100.8'));                              // wrong password (account known)
    await post(t, { email: 'ghost@example.com', password: secret }, fromIp('198.51.100.9'));                // refused under PORTAL_ONLY
    await post(t, { email: ADMIN, password: PW }, { headers: { origin: 'https://evil.example', 'x-forwarded-for': '198.51.100.10' } });   // cross-site
    for (let i = 0; i < 6; i++) await post(t, { email: ADMIN, password: 'w' + i }, fromIp('198.51.100.11'));    // ... and a lock
    const audit = t.lines.filter((l) => l.startsWith('[admin-local-login]'));
    assert.ok(audit.length >= 10, `lines: ${audit.length}`);
    const adminId = t.store.users.find((u) => u.email === ADMIN).id;
    assert.ok(audit.some((l) => l.includes('outcome=success') && l.includes('acct=' + adminId) && l.includes('ipclass=198.51.100.0/24')));
    assert.ok(audit.some((l) => l.includes('outcome=failure') && l.includes('acct=' + adminId)));
    assert.ok(audit.some((l) => l.includes('outcome=failure') && l.includes('acct=unknown')));
    assert.ok(audit.some((l) => l.includes('outcome=refused') && l.includes('reason=cross_site')));
    assert.ok(audit.some((l) => l.includes('outcome=locked')));
    const all = t.lines.join('\n');
    for (const forbidden of [PW, secret, ADMIN, 'ghost@example.com', 'example.com', '198.51.100.7', '198.51.100.8']) assert.ok(!all.includes(forbidden), 'logged: ' + forbidden);
  });
});

/* ── off, and off by mode ──────────────────────────────────────────────────────────────────────── */
test('PORTAL_OIDC off (or misconfigured): the page and the script answer EXACTLY like any unknown path, a marked login is 404, unmarked is untouched', async () => {
  for (const env of [{ PORTAL_OIDC: '' }, { PORTAL_CLIENT_SECRET: '' }]) {
    await withApp({ env }, async (t) => {
      const grab = async (p) => { const r = await fetch(t.base + p); return [r.status, r.headers.get('content-type'), await r.text()]; };
      const unknown = await grab('/admin/no-such-page-here');
      for (const p of [ADMIN_LOGIN_PATH, ADMIN_LOGIN_SCRIPT]) {
        const got = await grab(p);
        assert.equal(got[0], 404, p);
        // same status, type and body as an unknown path (the paths are named in Express's own default body, so compare the shape)
        assert.equal(got[1], unknown[1], p);
        assert.equal(got[2].replace(p, '/x'), unknown[2].replace('/admin/no-such-page-here', '/x'), p);
        assert.ok(!/local-login/i.test(JSON.stringify([...got].slice(0, 2))), p);
      }
      assert.equal((await post(t, { email: ADMIN, password: PW })).status, 404);
      const plain = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN, password: PW }) });
      assert.equal(plain.status, 200);
    });
  }
});

test('the marker alone grants nothing: a non-admin under PORTAL_ONLY is still refused by the existing rule; registration stays 403', async () => {
  await withApp({ env: { PORTAL_ONLY: '1' } }, async (t) => {
    assert.equal((await post(t, { email: READER, password: PW })).status, 401);
    const plain = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: READER, password: PW }) });
    assert.equal(plain.status, 403);                                           // the normal endpoint keeps its PORTAL_ONLY answer
    assert.equal((await plain.json()).code, 'PORTAL_ONLY');
    const reg = await fetch(t.base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@example.com', password: PW, name: 'N' }) });
    assert.equal(reg.status, 403);
  });
});

test('JWT secret sanity: the token the page stores verifies with the app secret', async () => {
  await withApp({}, async (t) => {
    const { default: jwt } = await import('jsonwebtoken');
    const { token } = await (await post(t, { email: ADMIN, password: PW })).json();
    assert.equal(jwt.verify(token, JWT_SECRET).email, ADMIN);
  });
});
