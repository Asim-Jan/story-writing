/* The test double against the shared conformance suite, plus the double's own helpers. No Docker. Run: node fake.test.js */
const crypto = require('crypto');
const { createFakeDrive } = require('../fake.cjs');
const { DriveError } = require('../index.cjs');
const conformance = require('./conformance.cjs');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log(`FAIL ${n}${d ? '\n  ' + String(d).slice(0, 400) : ''}`); } };

(async () => {
  const fake = createFakeDrive();
  const adapter = { client: (appId, secret) => fake.client({ appId, appSecret: secret }), admin: fake.admin };
  try {
    await conformance.run(adapter, ok);
    // the double's own helpers
    const u = fake.client({ appId: 'portal' }).forUser('u_1111111111111111');
    await u.put(Buffer.from('hello'), { project: 'media', path: 'a.txt', ref: 'a', tag: 'final' });
    fake.admin.failNext(2);
    const e1 = await u.quota().catch(e => e), e2 = await u.quota().catch(e => e), e3 = await u.quota();
    ok('failNext(2): the next two calls are unavailable, the third works', e1 instanceof DriveError && e1.code === 'unavailable' && e2.code === 'unavailable' && e3.used === 5);
    fake.admin.failNext(1, { afterWrite: true });
    const lost = await u.put(Buffer.from('second'), { project: 'media', path: 'b.txt', ref: 'b', tag: 'final', sha256: true }).catch(e => e);
    ok('failNext afterWrite: the write LANDS but the answer is lost (unavailable)...', lost.code === 'unavailable' && fake.admin.usedBytes('u_1111111111111111') === 11);
    const again = await u.put(Buffer.from('second'), { project: 'media', path: 'b.txt', ref: 'b', tag: 'final', sha256: true });
    ok('...and the retry is a clean replay (the idempotency a consumer relies on)', again.replayed === true && fake.admin.usedBytes('u_1111111111111111') === 11);
    ok('the double needs the right secret', (await fake.client({ appId: 'portal', appSecret: 'wrong' }).forUser('u_1111111111111111').quota().catch(e => e)).code === 'forbidden');
    ok('secrets are exposed for consumers\' tests', typeof fake.secrets.portal === 'string' && fake.secrets.portal.length >= 32);
    ok('the double keeps accounts apart', (await fake.client({ appId: 'portal' }).forUser('u_2222222222222222').quota()).used === 0);
  } catch (e) { fail++; console.log('CRASH', e && e.stack || e); }
  console.log(`drive-client fake + conformance: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
