// Test harness: a fake SAI Cloud provider (discovery, JWKS, token endpoint, real ES256 ID tokens) behind an injected
// fetch, an in-memory store with the same rules as Postgres, and the real portal routes on a real express server.
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createPortalAuth } from '../routes.js';
import { loadPortalConfig } from '../config.js';

export const ISSUER = 'https://portal.test';
export const APP = 'https://stories.test';
export const JWT_SECRET = 'test-jwt-secret-' + 'x'.repeat(20);
export const baseEnv = () => ({
  PORTAL_OIDC: '1', PORTAL_ISSUER: ISSUER, PORTAL_CLIENT_ID: 'stories', PORTAL_CLIENT_SECRET: 'client-secret-for-tests',
  PORTAL_SESSION_SECRET: crypto.randomBytes(32).toString('base64'), APP_URL: APP,
});

/* ── the fake provider ─────────────────────────────────────────────────────────────────────────── */
export function fakeProvider() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'test-kid-1';
  const codes = new Map();                     // code -> { claims, aud, nonce }
  const log = [];                              // every request the client made
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const sign = (claims) => {
    const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
    const p = b64u(JSON.stringify(claims));
    const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return h + '.' + p + '.' + b64u(sig);
  };
  const reply = (status, body) => ({ status, text: async () => JSON.stringify(body) });
  const discovery = {
    issuer: ISSUER, authorization_endpoint: ISSUER + '/oidc/authorize', token_endpoint: ISSUER + '/oidc/token',
    jwks_uri: ISSUER + '/oidc/jwks', end_session_endpoint: ISSUER + '/oidc/logout',
    id_token_signing_alg_values_supported: ['ES256'], code_challenge_methods_supported: ['S256'],
  };
  const api = {
    log, codes,
    fetch: async (url, init = {}) => {
      log.push({ url: String(url), method: init.method || 'GET' });
      if (url === ISSUER + '/.well-known/openid-configuration') return reply(200, discovery);
      if (url === ISSUER + '/oidc/jwks') return reply(200, { keys: [{ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, use: 'sig', alg: 'ES256' }] });
      if (url === ISSUER + '/oidc/token') {
        const form = new URLSearchParams(init.body);
        const c = codes.get(form.get('code'));
        if (!c || form.get('grant_type') !== 'authorization_code') return reply(400, { error: 'invalid_grant' });
        codes.delete(form.get('code'));
        const t = Math.floor(Date.now() / 1000);
        const claims = { iss: ISSUER, aud: 'stories', iat: t, exp: t + 300, auth_time: t, nonce: c.nonce, ...c.claims };
        return reply(200, { token_type: 'Bearer', access_token: 'at', id_token: c.tamper ? sign({ ...claims, aud: 'someone-else' }) : sign(claims), scope: 'openid profile email' });
      }
      return reply(404, {});
    },
    /** What the portal does after the person signs in there: a code for these claims bound to this authorize URL. */
    authorize(authorizeUrl, claims, extra = {}) {
      const u = new URL(authorizeUrl);
      const code = 'code-' + crypto.randomBytes(8).toString('hex');
      codes.set(code, { claims, nonce: u.searchParams.get('nonce'), ...extra });
      return { code, state: u.searchParams.get('state') };
    },
  };
  return api;
}

/* ── an in-memory store with Postgres's rules ──────────────────────────────────────────────────── */
export function memoryStore() {
  const users = [];
  let n = 0;
  const lower = (s) => String(s || '').toLowerCase();
  const api = {
    users,
    add(u) {
      const row = { id: 'user-' + (++n), role: 'user', tier: 'free', status: 'active', email_verified: false, token_version: 1, portal_sub: null, password_hash: '', name: 'N', deleted_at: null, ...u };
      row.email = u.email; users.push(row); return row;
    },
    async findByPortalSub(sub) { return users.find((u) => u.portal_sub === sub && !u.deleted_at) || null; },
    async findByEmail(email) { return users.find((u) => lower(u.email) === lower(email) && !u.deleted_at) || null; },
    async findById(id) { return users.find((u) => u.id === id && !u.deleted_at) || null; },
    async linkPortal(id, sub, { markEmailVerified = false } = {}) {
      const u = users.find((x) => x.id === id && !x.deleted_at);
      if (!u) return { ok: false, reason: 'not_found' };
      if (users.some((x) => x.portal_sub === sub && x !== u)) return { ok: false, reason: 'sub_in_use' };
      if (u.portal_sub) return { ok: false, reason: u.portal_sub === sub ? 'already_linked' : 'sub_in_use' };
      u.portal_sub = sub; u.portal_linked_at = new Date();
      if (markEmailVerified) u.email_verified = true;
      return { ok: true, user: u };
    },
    async createPortalUser({ email, name, sub }) {
      if (users.some((x) => x.portal_sub === sub)) return { ok: false, reason: 'sub_in_use' };
      if (users.some((x) => x.email === email)) return { ok: false, reason: 'email_in_use' };
      return { ok: true, user: api.add({ email, name, tier: 'free', email_verified: true, portal_sub: sub, password_hash: 'unusable', portal_linked_at: new Date() }) };
    },
  };
  return api;
}

/* ── the real routes on a real server ──────────────────────────────────────────────────────────── */
export async function startApp({ env = {}, store = memoryStore(), provider = fakeProvider(), now } = {}) {
  const cfg = loadPortalConfig({ ...baseEnv(), ...env });
  const audit = [];
  const quiet = { error() {}, warn() {}, log() {} };
  const portal = createPortalAuth({ cfg, store, jwtSecret: JWT_SECRET, fetch: provider.fetch, log: quiet, ...(now ? { now } : {}),
    audit: async (email, userId, ok, reason) => { audit.push({ email, userId, ok, reason }); } });
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use(portal.router);
  app.post('/api/auth/login', portal.blockPasswordAuth, (req, res) => res.json({ ok: 'password-login-ran' }));
  app.post('/api/auth/register', portal.blockPasswordAuth, portal.blockSignups, (req, res) => res.json({ ok: 'register-ran' }));
  app.get('/api/probe', (req, res) => {          // stands in for authenticateToken: same cookie, same JWT secret
    try { res.json({ ok: true, claims: jwt.verify(req.cookies.token || '', JWT_SECRET) }); } catch { res.status(401).json({ ok: false }); }
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, store, provider, portal, cfg, audit, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

/** A tiny cookie-keeping browser (no redirects followed: tests assert each hop). */
export function browser(base) {
  const jar = new Map();
  const take = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
      if (value === '' || (maxAge && Number(maxAge.split('=')[1]) === 0)) jar.delete(name); else jar.set(name, { value, attrs: attrs.map((a) => a.trim()), raw: c });
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v.value}`).join('; ');
  const b = {
    jar, raw: (name) => jar.get(name)?.raw,
    async go(path, { method = 'GET', body, headers = {} } = {}) {
      const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie: cookieHeader(), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      take(res);
      return res;
    },
    /** start -> (portal signs the person in) -> callback. Returns the callback response. */
    async signIn(provider, claims, { returnTo, extraQuery = '', extra = {} } = {}) {
      const start = await b.go('/auth/portal/login' + (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : ''));
      if (start.status !== 302) return start;
      const { code, state } = provider.authorize(start.headers.get('location'), claims, extra);
      return b.go(`/auth/portal/callback?code=${code}&state=${state}&iss=${encodeURIComponent(ISSUER)}${extraQuery}`);
    },
  };
  return b;
}

export const portalClaims = (over = {}) => ({ sub: 'u_aaaaaaaaaaaaaaaa', email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace', ...over });
export const hash = (pw) => bcrypt.hashSync(pw, 4);
