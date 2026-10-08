// The failure budgets behind password sign-in (review findings 1-3): one normalised spelling per account, a per-ACCOUNT budget
// for every password login, an atomic Redis counter that always ends, and a memory fallback a flood cannot reset.
// Redis tests need a throwaway Redis: PORTAL_TEST_REDIS_HOST=127.0.0.1 [PORTAL_TEST_REDIS_PORT] (skipped otherwise).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { startApp, hash } from './harness.js';
import * as AL from '../adminLogin.js';

const { ENTRY_HEADER, ENTRY_VALUE, MAX_FAILURES, createWindowCounter } = AL;
const ACCOUNT_MAX = AL.ACCOUNT_MAX_FAILURES;
const PW = 'Correct-Horse-9!';
const ADMIN = 'boss@example.com';
const quiet = { warn() {}, log() {}, error() {} };

async function withApp(opts, fn) {
  const t = await startApp({ realLogin: true, ...opts });
  t.store.add({ email: ADMIN, role: 'admin', password_hash: hash(PW), name: 'Boss', email_verified: true });
  t.store.add({ email: 'other@example.com', role: 'admin', password_hash: hash(PW), name: 'Other', email_verified: true });
  try { await fn(t); } finally { await t.close(); }
}

/** The NORMAL form's request (unmarked), from a client address as the proxy chain reports it (rightmost X-Forwarded-For entry). */
const plain = (t, email, password, xff) => fetch(t.base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) },
  body: JSON.stringify({ email, password }),
});
/** The admin page's request. */
const marked = (t, email, password, xff) => fetch(t.base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', [ENTRY_HEADER]: ENTRY_VALUE, origin: t.base, 'sec-fetch-site': 'same-origin', ...(xff ? { 'x-forwarded-for': xff } : {}) },
  body: JSON.stringify({ email, password }),
});
const tally = (rs) => rs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});

/* ── 1. one spelling per account ───────────────────────────────────────────────────────────────── */
test('normalizeEmail: case, surrounding space and Unicode compatibility forms are one address; non-strings are nothing', () => {
  const same = ['Admin@X.com', ' admin@x.com ', 'ADMIN@X.COM', '\tadmin@x.com\n', 'ａdmin@x.com' /* fullwidth a */, 'admin@x.com'];
  for (const v of same) assert.equal(AL.normalizeEmail(v), 'admin@x.com', JSON.stringify(v));
  assert.equal(new Set(same.map(AL.accountKey)).size, 1);
  for (const bad of [undefined, null, 5, {}, ['a@b.c']]) assert.equal(AL.normalizeEmail(bad), '');
  assert.ok(AL.normalizeEmail('a'.repeat(1_000_000)).length <= 400);                    // a huge body is never hashed whole
  const k = (email, ip) => AL.loginLimiterKey({ body: { email }, ip });
  assert.equal(k('Admin@X.com', '1.2.3.4'), k(' admin@x.com ', '1.2.3.4'));
  assert.notEqual(k('admin@x.com', '1.2.3.4'), k('admin@x.com', '1.2.3.5'));
  assert.equal(k(undefined, '1.2.3.4'), 'auth:unknown:1.2.3.4');
});

test('50 guesses at one account, in every spelling, from one address: only ten ever reach the login handler', async () => {
  await withApp({}, async (t) => {
    const spellings = ['boss@example.com', 'Boss@Example.com', ' boss@example.com ', 'BOSS@EXAMPLE.COM', '\tboss@example.com'];
    const rs = [];
    for (let i = 0; i < 50; i++) rs.push(await plain(t, spellings[i % spellings.length], 'guess-' + i, '10.20.0.1'));
    assert.deepEqual(tally(rs), { 401: ACCOUNT_MAX, 429: 50 - ACCOUNT_MAX });
    assert.equal((await plain(t, ADMIN, PW, '10.20.0.1')).status, 429);               // locked even for the right password
  });
});

test('...and with a different client address on every guess (rotating X-Forwarded-For) it is the same ten', async () => {
  await withApp({}, async (t) => {
    const rs = [];
    for (let i = 0; i < 50; i++) rs.push(await plain(t, i % 2 ? 'BOSS@example.com' : ' boss@example.com', 'guess-' + i, `10.21.${i}.9`));
    assert.deepEqual(tally(rs), { 401: ACCOUNT_MAX, 429: 50 - ACCOUNT_MAX });
    const locked = await plain(t, ADMIN, PW, '10.21.250.1');
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('retry-after'), '900');
    assert.equal((await plain(t, 'other@example.com', PW, '10.21.250.1')).status, 200);   // another account is untouched
  });
});

test('a correct password never counts: any number of good sign-ins, and a success between failures gives its own attempt back', async () => {
  await withApp({}, async (t) => {
    for (let i = 0; i < ACCOUNT_MAX * 3; i++) assert.equal((await plain(t, ADMIN, PW, '10.22.0.1')).status, 200);
    for (let i = 0; i < ACCOUNT_MAX - 1; i++) assert.equal((await plain(t, ADMIN, 'x' + i, `10.22.${i + 1}.1`)).status, 401);
    assert.equal((await plain(t, ADMIN, PW, '10.22.99.1')).status, 200);               // nine failures, then the right password: in
    assert.equal((await plain(t, ADMIN, 'x', '10.22.98.1')).status, 401);              // the tenth failure is still allowed
    assert.equal((await plain(t, ADMIN, 'x', '10.22.97.1')).status, 429);              // the eleventh is not
  });
});

test('the lock lasts one fixed window: refused attempts do not extend it, and after 15 minutes the account signs in again', async () => {
  let clock = 1_000_000;
  await withApp({ now: () => clock }, async (t) => {
    for (let i = 0; i < ACCOUNT_MAX; i++) await plain(t, ADMIN, 'x' + i, `10.23.${i}.1`);
    for (let i = 0; i < 20; i++) assert.equal((await plain(t, ADMIN, PW, `10.23.${50 + i}.1`)).status, 429);   // hammering while locked
    clock += 15 * 60 * 1000 - 1000;
    assert.equal((await plain(t, ADMIN, PW, '10.23.200.1')).status, 429);
    clock += 2000;
    assert.equal((await plain(t, ADMIN, PW, '10.23.200.1')).status, 200);
  });
});

test('the page and the normal form share ONE per-account failure counter; the page is held to the tighter limit', async () => {
  await withApp({}, async (t) => {
    for (let i = 0; i < 3; i++) assert.equal((await marked(t, ADMIN, 'x' + i, `10.24.${i}.1`)).status, 401);
    for (let i = 0; i < 3; i++) assert.equal((await plain(t, ADMIN, 'x' + i, `10.24.${10 + i}.1`)).status, 401);
    // six failures in all: past the page's five, short of the form's ten
    assert.equal((await marked(t, ADMIN, PW, '10.24.50.1')).status, 429);
    assert.equal((await plain(t, ADMIN, PW, '10.24.50.1')).status, 200);
    // the page counts case and spacing variants as the same account too
    assert.equal((await marked(t, 'OTHER@example.com', 'x', '10.24.60.1')).status, 401);
    for (let i = 0; i < MAX_FAILURES - 1; i++) await marked(t, ' other@example.com ', 'x', `10.24.6${i + 1}.1`);
    assert.equal((await marked(t, 'other@example.com', PW, '10.24.70.1')).status, 429);
  });
});

test('a request with no email, or no body, does not spend any account budget and is not locked out by one', async () => {
  await withApp({}, async (t) => {
    for (let i = 0; i < ACCOUNT_MAX + 3; i++) {
      const r = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x' }) });
      assert.notEqual(r.status, 429);
    }
    assert.equal((await plain(t, ADMIN, PW)).status, 200);
  });
});

/* ── 1b. the client address is the one OUR proxy appended, never one the client typed ──────────── */
test('a spoofed leftmost X-Forwarded-For entry is not a fresh budget: the page\'s per-IP-class budget follows the rightmost entry', async () => {
  for (const [trustProxy, chain] of [[1, (spoof) => `${spoof}, 203.0.113.50`], [2, (spoof) => `${spoof}, 203.0.113.50, 10.9.9.9`]]) {
    await withApp({ trustProxy }, async (t) => {
      const rs = [];
      // six different made-up addresses on the left, the same client on the right, a different account each time (only the IP class can answer)
      for (let i = 0; i < 6; i++) rs.push(await marked(t, `nobody${i}@example.com`, 'x', chain(`198.51.${i}.${i + 1}`)));
      assert.deepEqual(tally(rs), { 401: MAX_FAILURES, 429: 1 }, `trust proxy ${trustProxy}`);
    });
  }
});

test('...and the normal form\'s own per-address limiter (rate-limit key) cannot be reset by an address the client typed either', async () => {
  // the key is `auth:<normalised email>:<req.ip>`; req.ip comes from Express's trust-proxy hop count, never the leftmost entry
  const express = (await import('express')).default;
  const app = express();
  app.set('trust proxy', 2);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    for (const spoof of ['1.1.1.1', '2.2.2.2, 3.3.3.3', '::1']) {
      const r = await fetch(base + '/ip', { headers: { 'x-forwarded-for': `${spoof}, 203.0.113.50, 10.9.9.9` } });
      assert.equal((await r.json()).ip, '203.0.113.50', spoof);
    }
  } finally { srv.close(); }
});

/* ── 2. the Redis counter always ends ─────────────────────────────────────────────────────────── */
const RHOST = process.env.PORTAL_TEST_REDIS_HOST;
const redisSkip = RHOST ? false : 'set PORTAL_TEST_REDIS_HOST=127.0.0.1 (+ PORTAL_TEST_REDIS_PORT) to run against a throwaway Redis';

async function withRedis(fn) {
  const client = createClient({ socket: { host: RHOST, port: Number(process.env.PORTAL_TEST_REDIS_PORT || 6379) } });
  await client.connect();
  const prefix = 'stories:admin-login:';
  try { await fn(client, prefix); } finally {
    for (const k of await client.keys(prefix + 'lb-test-*')) await client.del(k);
    await client.quit();
  }
}

test('Redis: a hit sets the window in the same step (the key has a TTL straight away), counts, and release never goes below zero', { skip: redisSkip }, async () => {
  await withRedis(async (client, prefix) => {
    const c = createWindowCounter({ redis: () => client, log: quiet });
    const key = 'lb-test-a-' + process.pid;
    const a = await c.hit(key);
    const ttl = await client.ttl(prefix + key);
    assert.equal(a.n, 1);
    assert.ok(ttl > 0 && ttl <= 900, 'ttl ' + ttl);
    assert.equal((await c.hit(key)).n, 2);
    await a.release();
    assert.equal(await client.get(prefix + key), '1');
    const b = await c.hit(key); await b.release(); await b.release(); await b.release();   // over-release
    assert.equal(Number(await client.get(prefix + key)), 0);
    assert.equal((await c.hit(key)).n, 1);
  });
});

test('Redis: a key that has NO TTL (the EXPIRE was lost) is repaired by the next hit instead of counting up forever', { skip: redisSkip }, async () => {
  await withRedis(async (client, prefix) => {
    const c = createWindowCounter({ redis: () => client, log: quiet });
    const key = 'lb-test-b-' + process.pid;
    await client.incr(prefix + key); await client.incr(prefix + key); await client.incr(prefix + key);   // what INCR-then-failed-EXPIRE leaves
    assert.equal(await client.ttl(prefix + key), -1);
    const r = await c.hit(key);
    assert.equal(r.n, 4);
    const ttl = await client.ttl(prefix + key);
    assert.ok(ttl > 0 && ttl <= 900, 'ttl ' + ttl);
  });
});

test('Redis: a client whose EXPIRE command always fails still gets a window (the script never sends a separate EXPIRE)', { skip: redisSkip }, async () => {
  await withRedis(async (client, prefix) => {
    const lossy = new Proxy(client, { get: (t, p) => (p === 'expire' ? async () => { throw new Error('connection reset'); } : p === 'incr' ? t.incr.bind(t) : typeof t[p] === 'function' ? t[p].bind(t) : t[p]) });
    const c = createWindowCounter({ redis: () => lossy, log: quiet });
    const key = 'lb-test-c-' + process.pid;
    assert.equal((await c.hit(key)).n, 1);
    assert.ok((await client.ttl(prefix + key)) > 0);
  });
});

test('Redis: two counters (two replicas) share one budget; the window ends by itself', { skip: redisSkip }, async () => {
  await withRedis(async (client) => {
    const one = createWindowCounter({ redis: () => client, log: quiet, windowMs: 2000 });
    const two = createWindowCounter({ redis: () => client, log: quiet, windowMs: 2000 });
    const key = 'lb-test-d-' + process.pid;
    assert.equal((await one.hit(key)).n, 1);
    assert.equal((await two.hit(key)).n, 2);
    await new Promise((r) => setTimeout(r, 2300));
    assert.equal((await one.hit(key)).n, 1);
  });
});

test('Redis through the portal: a TTL-less account key is repaired and the account is locked until it expires, not forever', { skip: redisSkip }, async () => {
  await withRedis(async (client, prefix) => {
    const key = AL.accountKey(ADMIN);
    // not under the test prefix: clean up by hand
    try {
      await withApp({ redis: () => client }, async (t) => {
        for (let i = 0; i < 6; i++) await client.incr(prefix + key);                  // six failures, EXPIRE lost
        assert.equal(await client.ttl(prefix + key), -1);
        assert.equal((await marked(t, ADMIN, PW, '10.30.0.1')).status, 429);
        const ttl = await client.ttl(prefix + key);
        assert.ok(ttl > 0 && ttl <= 900, 'ttl ' + ttl);
      });
    } finally { await client.del(prefix + key); await client.del(prefix + 'i:10.30.0.0/24'); }
  });
});

/* ── 3. the memory fallback cannot be flushed by volume ───────────────────────────────────────── */
test('memory: 25,000 made-up keys do not reset an account that is being attacked', async () => {
  const c = createWindowCounter({ log: quiet });                                    // default table: 20,000 keys
  const admin = 'acct:admin';
  for (let i = 0; i < 3; i++) await c.hit(admin, { budget: MAX_FAILURES });
  const t0 = Date.now();
  for (let i = 0; i < 25_000; i++) await c.hit('acct:flood-' + i, { budget: MAX_FAILURES });
  assert.ok(Date.now() - t0 < 5000);
  assert.equal((await c.hit(admin, { budget: MAX_FAILURES })).n, 4);                 // still counting from three
  assert.ok(c.size() <= 20000);
});

test('memory: least recently used goes first, a key at half its budget or more is never evicted, and a table full of them refuses new keys', async () => {
  const c = createWindowCounter({ log: quiet, maxKeys: 5 });
  for (const k of ['a', 'b', 'c']) await c.hit(k, { budget: 4 });                    // n=1, budget 4
  await c.hit('a', { budget: 4 });                                                   // a: n=2 = half of 4: protected; also now the most recent
  await c.hit('d', { budget: 4 }); await c.hit('e', { budget: 4 });
  await c.hit('f', { budget: 4 });                                                   // full: evicts b (the least recently used unprotected), not a
  assert.equal((await c.hit('a', { budget: 4 })).n, 3);
  assert.equal((await c.hit('b', { budget: 4 })).n, 1);                              // b was forgotten
  const full = createWindowCounter({ log: quiet, maxKeys: 3 });
  for (const k of ['x', 'y', 'z']) { await full.hit(k, { budget: 2 }); await full.hit(k, { budget: 2 }); }   // all at n=2 of 2
  const refused = await full.hit('new', { budget: 2 });
  assert.ok(refused.capped && refused.n > 2);
  assert.equal((await full.hit('x', { budget: 2 })).n, 3);                           // the attacked ones are intact
});

test('memory: one IP class may only create 300 new account keys per window; a success hands its key back', async () => {
  const c = createWindowCounter({ log: quiet });
  const cls = '203.0.113.0/24';
  let capped = 0;
  for (let i = 0; i < 400; i++) { const r = await c.hit('acct:u' + i, { budget: 5, cls }); if (r.capped) capped++; }
  assert.equal(capped, 100);
  assert.equal((await c.hit('acct:other', { budget: 5, cls: '198.51.100.0/24' })).capped, undefined);   // another class is unaffected
  assert.equal((await c.hit('acct:u3', { budget: 5, cls })).n, 2);                  // an existing key still counts
  const ok = createWindowCounter({ log: quiet });
  for (let i = 0; i < 1000; i++) { const r = await ok.hit('acct:g' + i, { budget: 5, cls }); assert.ok(!r.capped, 'sign-in ' + i); await r.release(); }   // 1000 good sign-ins
  assert.equal(ok.size(), 0);
});

test('the page: a flood of made-up addresses from one IP class is refused by the IP budget BEFORE any account key exists', async () => {
  const counter = createWindowCounter({ log: quiet });
  await withApp({ adminLoginCounter: counter }, async (t) => {
    const rs = [];
    for (let i = 0; i < 60; i++) rs.push(await marked(t, `made-up-${i}@example.com`, 'x', '10.40.0.1'));
    assert.deepEqual(tally(rs), { 401: MAX_FAILURES, 429: 60 - MAX_FAILURES });
    assert.equal(counter.size(), 1 + MAX_FAILURES);                                 // the IP key and five account keys, nothing more
  });
});

test('the page: a flood through a tiny table (many IP classes) does not reset the account under attack', async () => {
  const counter = createWindowCounter({ log: quiet, maxKeys: 40 });
  await withApp({ adminLoginCounter: counter }, async (t) => {
    for (let i = 0; i < 3; i++) assert.equal((await marked(t, ADMIN, 'x' + i, `10.41.${i}.1`)).status, 401);
    for (let c = 0; c < 30; c++) for (let i = 0; i < 4; i++) await marked(t, `flood-${c}-${i}@example.com`, 'x', `10.42.${c}.1`);   // 120 made-up accounts
    assert.equal((await marked(t, ADMIN, 'x3', '10.43.0.1')).status, 401);          // 4th
    assert.equal((await marked(t, ADMIN, 'x4', '10.43.1.1')).status, 401);          // 5th
    assert.equal((await marked(t, ADMIN, PW, '10.43.2.1')).status, 429);            // locked: the counter survived the flood
  });
});

test('Redis down or timing out: ONE rate-limited log line says so and that the budget is per process', async () => {
  const out = [];
  let t = 1_000_000;
  const log = { warn: (m) => out.push(m), log() {} };
  const down = createWindowCounter({ log, now: () => t, redis: () => ({ eval: async () => { throw new Error('ECONNREFUSED'); } }) });
  for (let i = 0; i < 20; i++) await down.hit('k' + i);
  assert.equal(out.length, 1);
  assert.match(out[0], /redis/i);
  assert.match(out[0], /per replica/);
  assert.ok(!/ECONNREFUSED/.test(out[0]));
  t += 61_000;
  await down.hit('k-again');
  assert.equal(out.length, 2);                                                       // and again after a minute, not every request
  const slow = createWindowCounter({ log, now: () => t, redisTimeoutMs: 10, redis: () => ({ eval: () => new Promise(() => {}) }) });
  await slow.hit('k');
  assert.match(out[out.length - 1], /did not answer in time/);
});
