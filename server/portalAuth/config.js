// Sign in with SAI Cloud: configuration from the environment. Everything is OFF unless PORTAL_OIDC=1.
//
//   PORTAL_OIDC             1 turns the feature on (default off: deploying the code changes nothing)
//   PORTAL_ISSUER           the portal origin, exactly (default https://solutionsai.co.uk: no path, no trailing slash)
//   PORTAL_CLIENT_ID        default "stories"
//   PORTAL_CLIENT_SECRET    Secret story-writing-oidc / client-secret (never in the repo)
//   PORTAL_SESSION_SECRET   Secret story-writing-oidc / session-secret: >= 32 random bytes; signs the sign-in and
//                           account-linking cookies
//   PORTAL_REDIRECT_URI     default <APP_URL>/auth/portal/callback; must be registered at the portal byte for byte
//   PORTAL_POST_LOGOUT_URI  default <APP_URL>/
//   PORTAL_ONLY             1 disables local password sign-up, sign-in and password reset (the final cutover). Only
//                           honoured when SAI Cloud sign-in is actually working, so a bad config cannot lock everyone out.
//   SIGNUPS_CLOSED          1 refuses NEW accounts, local and through SAI Cloud (default open)
//
// A mistake while PORTAL_OIDC=1 (missing secret, bad URL) leaves the feature OFF and the pod UP, with the reason in the
// log and on /api/health: the password login keeps working.

const DEFAULT_ISSUER = 'https://solutionsai.co.uk';
export const PORTAL_SESSION_TTL_S = 24 * 3600;      // portal-linked app sessions: 24 h (no back-channel logout yet)

const flag = (v) => String(v || '').trim() === '1';

export function loadPortalConfig(env = process.env) {
  const requested = flag(env.PORTAL_OIDC);
  const appUrl = String(env.APP_URL || env.CLIENT_URL || '').replace(/\/+$/, '');
  const cfg = {
    requested,
    enabled: false,
    reason: requested ? '' : 'PORTAL_OIDC is not 1',
    onlyRequested: flag(env.PORTAL_ONLY),
    only: false,
    signupsClosed: flag(env.SIGNUPS_CLOSED),
    issuer: String(env.PORTAL_ISSUER || DEFAULT_ISSUER),
    clientId: String(env.PORTAL_CLIENT_ID || 'stories'),
    clientSecret: String(env.PORTAL_CLIENT_SECRET || ''),
    cookieSecret: String(env.PORTAL_SESSION_SECRET || ''),
    redirectUri: String(env.PORTAL_REDIRECT_URI || (appUrl ? appUrl + '/auth/portal/callback' : '')),
    postLogoutRedirectUri: String(env.PORTAL_POST_LOGOUT_URI || (appUrl ? appUrl + '/' : '')),
    sessionTtlS: PORTAL_SESSION_TTL_S,
  };
  if (!requested) return cfg;
  const missing = [];
  if (!cfg.clientSecret) missing.push('PORTAL_CLIENT_SECRET');
  if (Buffer.byteLength(cfg.cookieSecret) < 32) missing.push('PORTAL_SESSION_SECRET (>= 32 bytes)');
  if (!cfg.redirectUri) missing.push('PORTAL_REDIRECT_URI or APP_URL');
  if (missing.length) cfg.reason = 'missing: ' + missing.join(', ');
  else cfg.enabled = true;
  cfg.only = cfg.enabled && cfg.onlyRequested;
  return cfg;
}

/** What the browser may know. No secret, no issuer detail beyond a label. */
export const publicPortalConfig = (cfg) => ({
  enabled: cfg.enabled,
  only: cfg.only,
  signupsClosed: cfg.signupsClosed,
});
