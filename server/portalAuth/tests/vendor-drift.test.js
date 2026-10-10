// The vendored sign-in client must be byte-identical to sai-cluster's manifests/_auth-client/index.js.
//   SAI_CLUSTER_DIR=/path/to/sai-cluster  compares against that checkout's WORKING TREE (strict: use this in CI / before a release)
//   otherwise a sibling ../sai-cluster is used, if it has the commit named in the vendored header (git show: branch-independent)
//   neither available -> the comparison is SKIPPED with a message; the structural checks below still run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', '..');
const dir = path.join(repo, 'server', 'vendor', 'sai-auth-client');
const vendored = fs.readFileSync(path.join(dir, 'index.cjs'), 'utf8');
const MARKER = '//--- BEGIN VENDORED SOURCE: everything below this line is byte-identical to the original file ---\n';
const body = vendored.slice(vendored.indexOf(MARKER) + MARKER.length);
const headerCommit = (vendored.match(/^ \* Commit:\s+(\S+)/m) || [])[1];

test('the vendored client carries its provenance header and the marker', () => {
  assert.ok(vendored.startsWith('/*\n * VENDORED COPY - do not edit here.'));
  assert.match(vendored, /Source:\s+Solutions-AI-LTD\/sai-cluster\s+manifests\/_auth-client\/index\.js/);
  assert.match(vendored, /Licence:/);
  assert.match(headerCommit || '', /^[0-9a-f]{40}$/, 'the header must record the exact source commit');
  assert.ok(vendored.includes(MARKER));
  assert.match(body, /^'use strict';/);
  assert.match(body, /module\.exports = \{ createClient, createSession, createJtiSet, OidcError, parseCookies, EVENT_URIS \};/);
});

test('the sync script exists and is executable', () => {
  const s = path.join(repo, 'scripts', 'sync-auth-client.sh');
  assert.ok(fs.statSync(s).mode & 0o111, 'scripts/sync-auth-client.sh must be executable');
});

test('the vendored client is byte-identical to the sai-cluster source', (t) => {
  const explicit = process.env.SAI_CLUSTER_DIR;
  const root = explicit || path.join(repo, '..', 'sai-cluster');
  const file = path.join(root, 'manifests', '_auth-client', 'index.js');
  let source = null;
  if (explicit) {
    assert.ok(fs.existsSync(file), `SAI_CLUSTER_DIR is set but ${file} does not exist`);
    source = fs.readFileSync(file, 'utf8');
  } else if (fs.existsSync(file)) {
    try { source = execFileSync('git', ['-C', root, 'show', `${headerCommit}:manifests/_auth-client/index.js`], { encoding: 'utf8', maxBuffer: 1 << 24 }); }
    catch { return t.skip(`sibling checkout ${root} does not have commit ${headerCommit}: cannot compare (set SAI_CLUSTER_DIR to a checkout that has it)`); }
  } else {
    return t.skip(`no sai-cluster checkout found (set SAI_CLUSTER_DIR or put it at ${root}): drift not checked`);
  }
  assert.equal(body, source, 'server/vendor/sai-auth-client/index.cjs drifted from sai-cluster manifests/_auth-client/index.js - run scripts/sync-auth-client.sh');
});

test('the vendored unit tests match the source tests (require path rewritten)', (t) => {
  const explicit = process.env.SAI_CLUSTER_DIR;
  const root = explicit || path.join(repo, '..', 'sai-cluster');
  const file = path.join(root, 'manifests', '_auth-client', 'tests', 'lib.test.js');
  if (!fs.existsSync(file)) return t.skip('no sai-cluster checkout found: vendored tests not compared');
  let source;
  try { source = explicit ? fs.readFileSync(file, 'utf8') : execFileSync('git', ['-C', root, 'show', `${headerCommit}:manifests/_auth-client/tests/lib.test.js`], { encoding: 'utf8', maxBuffer: 1 << 24 }); }
  catch { return t.skip('commit not in the sibling checkout'); }
  const vt = fs.readFileSync(path.join(dir, 'sai-auth-client.lib.test.cjs'), 'utf8');
  const expected = source.replace("require('../index.js')", "require('./index.cjs')");
  assert.ok(vt.endsWith(expected), 'sai-auth-client.lib.test.cjs drifted - run scripts/sync-auth-client.sh');
});
