import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalConfig, publicPortalConfig, PORTAL_SESSION_TTL_S } from '../config.js';

const good = { PORTAL_OIDC: '1', PORTAL_CLIENT_SECRET: 's', PORTAL_SESSION_SECRET: 'x'.repeat(32), APP_URL: 'https://story-writing.solutionsai.co.uk/' };

test('everything is OFF unless PORTAL_OIDC=1', () => {
  for (const v of [undefined, '', '0', 'true', 'yes']) {
    const c = loadPortalConfig({ ...good, PORTAL_OIDC: v });
    assert.equal(c.enabled, false);
    assert.equal(c.only, false);
  }
  assert.equal(loadPortalConfig({}).enabled, false);
});

test('defaults: the real issuer, client id, and the registered redirect / post-logout URIs', () => {
  const c = loadPortalConfig(good);
  assert.equal(c.enabled, true);
  assert.equal(c.issuer, 'https://solutionsai.co.uk');
  assert.equal(c.clientId, 'stories');
  assert.equal(c.redirectUri, 'https://story-writing.solutionsai.co.uk/auth/portal/callback');
  assert.equal(c.postLogoutRedirectUri, 'https://story-writing.solutionsai.co.uk/');
  assert.equal(c.sessionTtlS, 24 * 3600);
  assert.equal(PORTAL_SESSION_TTL_S, 86400);
});

test('explicit settings win; PORTAL_ONLY needs a working config', () => {
  const c = loadPortalConfig({ ...good, PORTAL_REDIRECT_URI: 'https://x.test/cb', PORTAL_ISSUER: 'https://idp.test', PORTAL_CLIENT_ID: 'c', PORTAL_ONLY: '1' });
  assert.deepEqual([c.redirectUri, c.issuer, c.clientId, c.only], ['https://x.test/cb', 'https://idp.test', 'c', true]);
  assert.equal(loadPortalConfig({ ...good, PORTAL_CLIENT_SECRET: '', PORTAL_ONLY: '1' }).only, false);
  assert.equal(loadPortalConfig({ PORTAL_ONLY: '1' }).only, false);
});

test('missing or weak secrets leave it off with a reason that names the variable, never a value', () => {
  assert.match(loadPortalConfig({ ...good, PORTAL_CLIENT_SECRET: '' }).reason, /PORTAL_CLIENT_SECRET/);
  assert.match(loadPortalConfig({ ...good, PORTAL_SESSION_SECRET: 'short' }).reason, /PORTAL_SESSION_SECRET/);
  assert.ok(!loadPortalConfig({ ...good, PORTAL_SESSION_SECRET: 'short' }).reason.includes('short'));
});

test('the public config exposes no secret', () => {
  const p = publicPortalConfig(loadPortalConfig({ ...good, SIGNUPS_CLOSED: '1' }));
  assert.deepEqual(p, { enabled: true, only: false, signupsClosed: true });
});
