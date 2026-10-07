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
//   PORTAL_ONLY             1 asks for the final cutover: local password sign-up, sign-in and password reset are refused.
//                           It is only ENFORCED while the portal is healthy (health.js: its discovery document and keys were
//                           fetched OK in the last 10 minutes), so an outage cannot lock everyone out; admin accounts can always
//                           sign in with their password (break-glass); an account that has no SAI Cloud link can still use
//                           "forgot password" (reset-then-link). The probe CANNOT see a wrong client secret or an unregistered
//                           redirect URI: leave this OFF until a real round trip has worked for every person.
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
    only: false,                      // requested AND the feature is enabled; whether it is enforced right now is routes.js (provider health)
    signupsClosed: flag(env.SIGNUPS_CLOSED),
    issuer: String(env.PORTAL_ISSUER || DEFAULT_ISSUER),
    clientId: String(env.PORTAL_CLIENT_ID || 'stories'),
    // trimmed: a Secret made with --from-file keeps the file's trailing newline, which would break the Basic auth header
    clientSecret: String(env.PORTAL_CLIENT_SECRET || '').trim(),
    cookieSecret: String(env.PORTAL_SESSION_SECRET || '').trim(),
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
