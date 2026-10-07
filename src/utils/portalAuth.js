// Sign in with SAI Cloud: what the browser needs to know. The server answers {enabled:false} when the
// feature is off, so every caller can treat "no answer" and "off" the same.
let cached = null;

export async function fetchPortalConfig() {
  if (cached) return cached;
  try {
    const res = await fetch('/api/auth/portal/config', { credentials: 'include' });
    if (!res.ok) return { enabled: false, only: false, signupsClosed: false };
    const c = await res.json();
    cached = { enabled: !!c.enabled, only: !!c.only, signupsClosed: !!c.signupsClosed };
    return cached;
  } catch {
    return { enabled: false, only: false, signupsClosed: false };
  }
}

// A path on this site only: "/" or "/?book=...", never "//host" or an absolute URL.
export const safeReturnTo = (v) => (typeof v === 'string' && /^\/(?![/\\])[\x21-\x7e]{0,512}$/.test(v) ? v : null);

/** The link behind the "Sign in with SAI Cloud" button. Keeps an opened book across the round trip. */
export function portalLoginHref({ different = false } = {}) {
  const here = window.location.pathname + window.location.search;
  const rt = window.location.pathname === '/' && window.location.search ? safeReturnTo(here) : null;
  const q = [];
  if (rt) q.push('returnTo=' + encodeURIComponent(rt));
  if (different) q.push('different=1');
  return '/auth/portal/login' + (q.length ? '?' + q.join('&') : '');
}

// Plain-language text for every way the round trip can end (the `code` of /auth/portal/error).
export const PORTAL_ERRORS = {
  email_unverified: {
    title: 'Verify your SAI Cloud email first',
    body: 'Your SAI Cloud account has an email address that has not been verified yet, so Stories cannot use it to sign you in. Open SAI Cloud, verify your email address, then come back and sign in again.',
    portalLink: true,
  },
  access_denied: {
    title: 'Sign-in was cancelled',
    body: 'SAI Cloud did not share your sign-in with Stories. Nothing was changed. You can try again whenever you like.',
  },
  expired: {
    title: 'That sign-in expired',
    body: 'It took too long, or it was started in a different browser or tab. Start again from this browser.',
  },
  signups_closed: {
    title: 'New accounts are closed',
    body: 'Stories is not taking new accounts right now. If you already have a Stories account, sign in to SAI Cloud with the same email address your Stories account uses.',
  },
  linked_elsewhere: {
    title: 'This Stories account belongs to another SAI Cloud account',
    body: 'The Stories account for this email address is already linked to a different SAI Cloud account. Sign in with the SAI Cloud account you linked first.',
    different: true,
  },
  contact_support: {
    title: 'Please contact support',
    body: 'More than one Stories account uses your email address, so Stories cannot tell which one this sign-in belongs to. Nothing was changed. Contact support and we will sort it out.',
  },
  similar_email: {
    title: 'You may already have a Stories account',
    body: 'Your SAI Cloud email looks like another spelling of an email address that already has a Stories account (for example with a +tag or different dots). No new account was created. If that account is yours, sign in to Stories with its email and password, or contact support so it can be linked to SAI Cloud.',
  },
  rate_limited: {
    title: 'Too many new accounts',
    body: 'Too many accounts have been created from your network recently. Please try again in about an hour.',
  },
  suspended: {
    title: 'This account is not available',
    body: 'The Stories account for this sign-in has been suspended. Please contact support.',
  },
  unavailable: {
    title: 'SAI Cloud is not reachable',
    body: 'Stories could not reach SAI Cloud just now. Please try again in a minute.',
  },
  failed: {
    title: 'Sign-in failed',
    body: 'Something went wrong while signing you in with SAI Cloud. Nothing was changed. Please try again.',
  },
};
