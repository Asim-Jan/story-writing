// The SAI Cloud app switcher (/sai-suite.js, the CUSTOMER bundle of sai-cluster/manifests/_suite).
//   node --test server/tests/suite-script.test.js      (npm run test:media)
// Pins: the route serves JavaScript or a plain 404 and never the SPA's index.html (mounted in the same
// order as server/index.js: the route BEFORE the SPA fallback); the page loads it deferred with
// data-app="stories"; the page CSP already allows it; every full-screen utility leaves room for the
// 45px bar; deploy.sh builds the customer variant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';
import { suiteScriptHandler } from '../utils/suiteScript.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function serve(candidates) {
  const app = express();
  app.get('/sai-suite.js', suiteScriptHandler(candidates));
  app.get(/^\/(?!api\/).*/, (req, res) => res.type('text/html').send('<!doctype html><div id="root"></div>'));   // the SPA fallback
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}

test('/sai-suite.js is served as JavaScript from the first build that has it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-'));
  const file = path.join(dir, 'sai-suite.js');
  fs.writeFileSync(file, '(function(){ window.SAISuite = {}; })();\n');
  const s = await serve([path.join(dir, 'missing', 'sai-suite.js'), file]);
  try {
    const r = await fetch(`${s.base}/sai-suite.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/javascript/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await r.text(), fs.readFileSync(file, 'utf8'));
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('/sai-suite.js missing from the build is a plain 404, never the SPA index.html', async () => {
  const s = await serve([path.join(os.tmpdir(), 'no-such-dir-' + process.pid, 'sai-suite.js')]);
  try {
    const r = await fetch(`${s.base}/sai-suite.js`);
    assert.equal(r.status, 404);
    assert.doesNotMatch(r.headers.get('content-type') || '', /html/);
    assert.doesNotMatch(await r.text(), /<!doctype|<div/i);
  } finally { await s.close(); }
});

test('the server mounts the route before the SPA fallback', () => {
  const src = fs.readFileSync(path.join(REPO, 'server', 'index.js'), 'utf8');
  const route = src.indexOf("app.get('/sai-suite.js'");
  const spa = src.indexOf('app.get(/^\\/(?!api\\/).*/');
  assert.ok(route > 0 && spa > 0 && route < spa, `route at ${route}, SPA fallback at ${spa}`);
});

test('index.html loads the switcher deferred, as the stories app', () => {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/sai-suite\.js" defer data-app="stories"><\/script>/);
});

test('the page CSP already allows the customer bundle (script-src \'self\', style-src \'unsafe-inline\'), nothing extra needed', () => {
  const src = fs.readFileSync(path.join(REPO, 'server', 'index.js'), 'utf8');
  const csp = src.slice(src.indexOf('contentSecurityPolicy'), src.indexOf('crossOriginEmbedderPolicy'));
  assert.match(csp, /"script-src": \[[^\]]*"'self'"/);
  assert.match(csp, /"style-src": \[[^\]]*"'unsafe-inline'"/);
});

test('every full-screen utility leaves room for the 45px bar (--sai-suite-h)', async () => {
  const cfg = (await import(path.join(REPO, 'tailwind.config.js'))).default;
  for (const k of ['height', 'minHeight', 'maxHeight']) {
    assert.equal(cfg.theme.extend[k].screen, 'calc(100vh - var(--sai-suite-h, 0px))', k);
  }
  // no raw 100vh / h-screen-style arbitrary value left in a component that ignores the bar
  const offenders = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|css)$/.test(f)) { const t = fs.readFileSync(p, 'utf8'); for (const m of t.matchAll(/100vh[^)\]'"]*/g)) if (!/sai-suite-h/.test(t.slice(m.index, m.index + 80))) offenders.push(`${path.relative(REPO, p)}: ${m[0]}`); } } };
  walk(path.join(REPO, 'src'));
  assert.deepEqual(offenders, []);
});

test('deploy.sh builds the CUSTOMER variant into public/ and the output is git-ignored', () => {
  const sh = fs.readFileSync(path.join(REPO, 'deploy.sh'), 'utf8');
  assert.match(sh, /manifests\/_suite\/build\.js"/);
  assert.match(sh, /node "\$kit" public\/sai-suite\.js --variant customer/);
  assert.match(sh, /deploy_app\(\) \{\n\s+build_suite/, 'the suite is built before the image');
  assert.match(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8'), /^public\/sai-suite\.js$/m);
});

/* deploy.sh's guard: the switcher is baked only from a CLEAN sai-cluster checkout at origin/main. */
test('scripts/check-sai-cluster.sh accepts only a clean checkout at origin/main', async () => {
  const { execFileSync, spawnSync } = await import('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saicl-'));
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
  const check = (dir, env = { SAI_CLUSTER_ORIGIN_OK: '*' }) => spawnSync(path.join(REPO, 'scripts', 'check-sai-cluster.sh'), [dir], { env: { ...process.env, ...env } });
  try {
    const seed = path.join(tmp, 'seed');
    fs.mkdirSync(path.join(seed, 'manifests', '_suite'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'manifests', '_suite', 'build.js'), '// kit\n');
    git(seed, 'init', '-q', '-b', 'main'); git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'kit');
    const origin = path.join(tmp, 'origin.git');
    git(tmp, 'clone', '-q', '--bare', seed, origin);
    const wt = path.join(tmp, 'wt');
    git(tmp, 'clone', '-q', origin, wt);

    assert.equal(check(wt).status, 0, 'clean at origin/main: OK');
    assert.notEqual(check(wt, {}).status, 0, 'an origin that is not Solutions-AI-LTD/sai-cluster is refused');
    assert.notEqual(check(path.join(tmp, 'nope')).status, 0, 'no checkout: refused');

    fs.writeFileSync(path.join(wt, 'manifests', '_suite', 'catalog.json'), '{}');
    assert.notEqual(check(wt).status, 0, 'an untracked file in manifests/_suite: refused');
    fs.rmSync(path.join(wt, 'manifests', '_suite', 'catalog.json'));

    fs.writeFileSync(path.join(wt, 'manifests', '_suite', 'build.js'), '// edited\n');
    assert.notEqual(check(wt).status, 0, 'an uncommitted edit: refused');
    git(wt, 'commit', '-qam', 'local');
    const r = check(wt);
    assert.notEqual(r.status, 0, 'a local commit (HEAD is not origin/main): refused');
    assert.match(r.stderr.toString(), /is not origin\/main/);
    git(wt, 'reset', '-q', '--hard', 'origin/main');
    assert.equal(check(wt).status, 0, 'back at origin/main: OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('deploy.sh runs the checkout guard before VERSION is touched', () => {
  const sh = fs.readFileSync(path.join(REPO, 'deploy.sh'), 'utf8');
  const guard = sh.indexOf('scripts/check-sai-cluster.sh');
  assert.ok(guard > 0 && guard < sh.indexOf('echo "$NEW_VERSION" > VERSION'));
});
