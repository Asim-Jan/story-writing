// VENDORED from sai-cluster manifests/_auth-client/tests/lib.test.js @ 59fa1eae791c7b76ec0b67deeaa877314897cfcb (require path rewritten). Re-copy with scripts/sync-auth-client.sh.
'use strict';
/* The client library on its own (no provider): option validation, the signed app-session cookie, the signed sign-in cookie,
 * and cookie parsing. The provider round trip is e2e.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createClient, createSession, OidcError, parseCookies } = require('./index.cjs');

const SECRET = crypto.randomBytes(32).toString('base64');
const OTHER = crypto.randomBytes(32).toString('base64');
const base = { issuer: 'https://portal.test', clientId: 'app', clientSecret: 's3cret', redirectUri: 'https://app.test/cb', cookieSecret: SECRET };
const throwsCode = (fn, code) => assert.throws(fn, e => e instanceof OidcError && e.code === code, `expected OidcError(${code})`);
const cookieValue = sc => sc.split(';')[0].split('=').slice(1).join('=');

test('createClient validates its configuration', () => {
  assert.ok(createClient(base));
  throwsCode(() => createClient({ ...base, issuer: 'http://portal.test' }), 'config');
  throwsCode(() => createClient({ ...base, issuer: 'https://portal.test/' }), 'config');            // a trailing slash would never match the iss claim
  throwsCode(() => createClient({ ...base, issuer: 'https://portal.test/oidc' }), 'config');
  throwsCode(() => createClient({ ...base, issuer: 'https://u:p@portal.test' }), 'config');
  throwsCode(() => createClient({ ...base, clientId: '' }), 'config');
  throwsCode(() => createClient({ ...base, clientSecret: '' }), 'config');
  throwsCode(() => createClient({ ...base, redirectUri: 'http://app.test/cb' }), 'config');
  throwsCode(() => createClient({ ...base, redirectUri: 'https://app.test/cb#x' }), 'config');
  throwsCode(() => createClient({ ...base, cookieSecret: 'too short' }), 'config');
  throwsCode(() => createClient({ ...base, cookieSecret: undefined }), 'config');
  throwsCode(() => createClient({ ...base, scope: 'email profile' }), 'config');
  throwsCode(() => createClient({ ...base, fetch: 'nope', }), 'config');
});

test('the session cookie: __Host- prefix, attributes, round trip', () => {
  const s = createSession({ secret: SECRET });
  const c = s.issue({ sub: 'u_1', email: 'a@b.c' });
  assert.match(c, /^__Host-sai_sess=[A-Za-z0-9_.-]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200$/);
  assert.ok(!/Domain=/i.test(c), 'a __Host- cookie must not carry a Domain');
  assert.deepEqual(s.read({ headers: { cookie: 'x=1; ' + c.split(';')[0] + '; y=2' } }), { sub: 'u_1', email: 'a@b.c' });
  assert.equal(s.read({ headers: {} }), null);
  assert.equal(s.read({}), null);
  assert.equal(s.read(null), null);
  assert.match(s.clear(), /^__Host-sai_sess=; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0$/);
  throwsCode(() => createSession({ secret: SECRET, cookieName: 'sai_sess' }), 'config');
  throwsCode(() => createSession({ secret: SECRET, cookieName: '__Secure-x' }), 'config');
  throwsCode(() => createSession({ secret: 'short' }), 'config');
  throwsCode(() => s.issue('a string'), 'config');
  throwsCode(() => s.issue(['x']), 'config');
  throwsCode(() => s.issue({ blob: 'x'.repeat(4000) }), 'config');
});

test('the session cookie cannot be forged, replayed across secrets, extended or repurposed', async () => {
  const s = createSession({ secret: SECRET });
  const v = cookieValue(s.issue({ sub: 'u_1' }));
  const req = val => ({ headers: { cookie: '__Host-sai_sess=' + val } });
  const [p, m] = v.split('.');
  const evil = Buffer.from(JSON.stringify({ d: { sub: 'u_admin' }, iat: 1, exp: 9999999999 })).toString('base64url');
  assert.equal(s.read(req(evil + '.' + m)), null, 'a changed payload under the old MAC');
  assert.equal(s.read(req(p + '.' + m.slice(0, -2) + 'AA')), null, 'a changed MAC');
  assert.equal(s.read(req(p)), null, 'no MAC');
  assert.equal(s.read(req(p + '.')), null);
  assert.equal(s.read(req(p + '.' + m + '.x')), null, 'extra segment');
  assert.equal(s.read(req('')), null);
  assert.equal(createSession({ secret: OTHER }).read(req(v)), null, 'a cookie signed with another secret');
  // domain separation: a sign-in (transaction) cookie is not a session
  const doc = { issuer: base.issuer, authorization_endpoint: base.issuer + '/oidc/authorize', token_endpoint: base.issuer + '/oidc/token', jwks_uri: base.issuer + '/oidc/jwks' };
  const c = createClient({ ...base, fetch: async () => ({ status: 200, text: async () => JSON.stringify(doc) }) });
  const a = await c.authorizationUrl();
  assert.equal(s.read(req(cookieValue(a.cookie))), null, 'a sign-in cookie must not read as a session');
});

test('the session cookie expires', () => {
  let t = 1_000_000_000_000;
  const s = createSession({ secret: SECRET, now: () => t, ttlS: 60 });
  const c = s.issue({ sub: 'u_1' });
  assert.match(c, /Max-Age=60$/);
  const req = { headers: { cookie: c.split(';')[0] } };
  t += 59000; assert.ok(s.read(req));
  t += 2000; assert.equal(s.read(req), null);
  const long = s.issue({ sub: 'u_1' }, { ttlS: 3600 }); t += 100000;
  assert.ok(s.read({ headers: { cookie: long.split(';')[0] } }), 'a per-call ttl is honoured');
});

test('parseCookies', () => {
  assert.deepEqual(parseCookies('a=1; b=2;c=3'), { a: '1', b: '2', c: '3' });
  assert.deepEqual(parseCookies('a=1; a=2'), { a: '1' }, 'the FIRST wins (a later duplicate cannot shadow it)');
  assert.deepEqual(parseCookies('=x; novalue; ok=y=z'), { ok: 'y=z' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('authorizationUrl: the request it builds', async () => {
  const doc = { issuer: base.issuer, authorization_endpoint: base.issuer + '/oidc/authorize', token_endpoint: base.issuer + '/oidc/token', jwks_uri: base.issuer + '/oidc/jwks' };
  let n = 0;
  const c = createClient({ ...base, fetch: async () => { n++; return { status: 200, text: async () => JSON.stringify(doc) }; } });
  const a = await c.authorizationUrl({ returnTo: '/library?x=1', maxAge: 300, prompt: 'login', loginHint: 'a@b.c' });
  const u = new URL(a.url), q = u.searchParams;
  assert.equal(u.origin + u.pathname, base.issuer + '/oidc/authorize');
  assert.equal(q.get('client_id'), 'app'); assert.equal(q.get('redirect_uri'), base.redirectUri); assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('scope'), 'openid profile email'); assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('max_age'), '300'); assert.equal(q.get('prompt'), 'login'); assert.equal(q.get('login_hint'), 'a@b.c');
  assert.equal(q.get('state'), a.state);
  assert.match(q.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(q.get('nonce'), /^[A-Za-z0-9_-]{32}$/); assert.match(q.get('state'), /^[A-Za-z0-9_-]{32}$/);
  assert.match(a.cookie, /^__Host-sai_oidc_tx=[A-Za-z0-9_.-]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
  // the verifier is in the (signed, HttpOnly) cookie and hashes to the challenge; it is NOT in the URL
  const tx = JSON.parse(Buffer.from(cookieValue(a.cookie).split('.')[0], 'base64url').toString());
  assert.equal(crypto.createHash('sha256').update(tx.v).digest('base64url'), q.get('code_challenge'));
  assert.ok(!a.url.includes(tx.v));
  assert.equal(tx.s, q.get('state')); assert.equal(tx.n, q.get('nonce')); assert.equal(tx.r, '/library?x=1'); assert.equal(tx.m, 300);
  const b = await c.authorizationUrl();
  assert.notEqual(new URL(b.url).searchParams.get('state'), q.get('state'), 'fresh state every time');
  assert.notEqual(new URL(b.url).searchParams.get('code_challenge'), q.get('code_challenge'), 'fresh verifier every time');
  assert.equal(n, 1, 'discovery is cached');
  for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)', 'relative', '/a b', '/' + 'x'.repeat(600)])
    await assert.rejects(c.authorizationUrl({ returnTo: bad }), e => e.code === 'config', 'returnTo ' + bad.slice(0, 30));
});

test('discovery is validated', async () => {
  const mk = doc => createClient({ ...base, fetch: async () => ({ status: 200, text: async () => JSON.stringify(doc) }) });
  const good = { issuer: base.issuer, authorization_endpoint: base.issuer + '/oidc/authorize', token_endpoint: base.issuer + '/oidc/token', jwks_uri: base.issuer + '/oidc/jwks' };
  await assert.doesNotReject(mk(good).discover());
  for (const [n, d] of [['a different issuer', { ...good, issuer: 'https://evil.test' }], ['an issuer with a slash', { ...good, issuer: base.issuer + '/' }],
    ['a token endpoint on another origin', { ...good, token_endpoint: 'https://evil.test/token' }], ['an http endpoint', { ...good, token_endpoint: 'http://portal.test/oidc/token' }],
    ['a jwks on another origin', { ...good, jwks_uri: 'https://evil.test/jwks' }], ['no authorization endpoint', { ...good, authorization_endpoint: undefined }],
    ['an end_session on another origin', { ...good, end_session_endpoint: 'https://evil.test/out' }], ['no ES256', { ...good, id_token_signing_alg_values_supported: ['RS256'] }],
    ['no S256', { ...good, code_challenge_methods_supported: ['plain'] }], ['not an object', 'x']])
    await assert.rejects(mk(d).discover(), e => e.code === 'discovery', n);
  await assert.rejects(createClient({ ...base, fetch: async () => ({ status: 500, text: async () => '' }) }).discover(), e => e.code === 'discovery');
  await assert.rejects(createClient({ ...base, fetch: async () => { throw new Error('boom'); } }).discover(), e => e.code === 'discovery' && !/boom/.test(e.message));
  await assert.rejects(createClient({ ...base, fetch: async () => ({ status: 200, text: async () => 'x'.repeat(300000) }) }).discover(), e => e.code === 'discovery');
});

test('handleCallback refuses what it should before touching the network', async () => {
  const c = createClient({ ...base, fetch: async () => { throw new Error('must not be called'); } });
  const none = await c.handleCallback({ url: '/cb?code=x&state=y&iss=' + encodeURIComponent(base.issuer), headers: {} }).catch(e => e);
  assert.equal(none.code, 'tx_missing');
  assert.match(none.clearCookie, /Max-Age=0$/);
  const junk = await c.handleCallback({ url: '/cb?code=x&state=y', headers: { cookie: '__Host-sai_oidc_tx=garbage' } }).catch(e => e);
  assert.equal(junk.code, 'tx_invalid');
  const dup = await c.handleCallback({ url: '/cb?code=x&code=y&state=y', headers: { cookie: '__Host-sai_oidc_tx=garbage' } }).catch(e => e);
  assert.equal(dup.code, 'tx_invalid');
  const wrongSecret = createClient({ ...base, cookieSecret: OTHER, fetch: async () => ({ status: 200, text: async () => JSON.stringify({ issuer: base.issuer, authorization_endpoint: base.issuer + '/a', token_endpoint: base.issuer + '/t', jwks_uri: base.issuer + '/j' }) }) });
  const a = await wrongSecret.authorizationUrl();
  const forged = await c.handleCallback({ url: '/cb?code=x&state=' + a.state + '&iss=' + encodeURIComponent(base.issuer), headers: { cookie: a.cookie.split(';')[0] } }).catch(e => e);
  assert.equal(forged.code, 'tx_invalid', 'a sign-in cookie made with another secret');
});
