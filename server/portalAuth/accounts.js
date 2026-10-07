// Account resolution for "Sign in with SAI Cloud": which Stories user does a verified SAI Cloud identity map to?
//
// Keyed on the portal's `sub` (stable account id), never on the email. The email is only used ONCE, to offer a
// first link to an existing Stories account, and only under the rules below. A Stories user_id and the books
// under it are never changed by any path here.
//
//   (a) a user already linked to this sub                      -> signed in (the email is not consulted: it may have
//                                                                 changed at the portal)
//   (b) no link yet, a Stories user has the same email:
//         - that user is already linked to ANOTHER sub          -> refused ('linked_elsewhere'), never re-linked
//         - Stories email verified AND not an admin AND the
//           portal asserts email_verified                       -> linked automatically, signed in
//         - otherwise (Stories email NOT verified, or admin)    -> 'needs_password': nothing is linked or signed in until
//                                                                 the person proves they own the Stories account with its
//                                                                 old password (portalLink route)
//   (c) no such user                                            -> a new free-tier user, linked to the sub, only if
//                                                                 signups are open ('signups_closed' otherwise)
//
// `store` is the small persistence interface (store.js is the Postgres one; the tests use a memory one).

export const OUTCOME = Object.freeze({
  SIGNED_IN: 'signed_in',
  NEEDS_PASSWORD: 'needs_password',
  SIGNUPS_CLOSED: 'signups_closed',
  LINKED_ELSEWHERE: 'linked_elsewhere',
  BLOCKED: 'blocked',
  EMAIL_UNVERIFIED: 'email_unverified',
  UNAVAILABLE: 'unavailable',
});

const isBlocked = (u) => u && (u.status === 'suspended' || u.status === 'banned');

const cleanName = (name, email) => {
  const n = String(name || '').trim().slice(0, 255);
  return n || String(email).split('@')[0].slice(0, 255);
};

/**
 * @param {object} store    see store.js
 * @param {object} who      the library's handleCallback() result: { sub, verifiedEmail, emailVerified, name, ... }
 * @param {{signupsOpen: boolean}} opts
 * @returns {Promise<{kind: string, user?: object, linked?: boolean, created?: boolean, pending?: object}>}
 */
export async function resolveAccount(store, who, { signupsOpen }) {
  const sub = typeof who?.sub === 'string' ? who.sub : '';
  if (!sub) return { kind: OUTCOME.UNAVAILABLE };

  // (a) already linked: identify by sub only
  const bySub = await store.findByPortalSub(sub);
  if (bySub) {
    if (isBlocked(bySub)) return { kind: OUTCOME.BLOCKED, user: bySub };
    return { kind: OUTCOME.SIGNED_IN, user: bySub, linked: false, created: false };
  }

  // from here the email matters, and only a portal-VERIFIED one may be used
  const email = who.emailVerified === true && typeof who.verifiedEmail === 'string' ? who.verifiedEmail.trim().toLowerCase() : '';
  if (!email) return { kind: OUTCOME.EMAIL_UNVERIFIED };

  // (b) an existing Stories account with this email
  const existing = await store.findByEmail(email);
  if (existing) {
    if (isBlocked(existing)) return { kind: OUTCOME.BLOCKED, user: existing };
    if (existing.portal_sub) return { kind: OUTCOME.LINKED_ELSEWHERE };   // linked to a different sub (a) did not match

    const storiesVerified = existing.email_verified === true;
    const isAdmin = existing.role === 'admin';
    if (storiesVerified && !isAdmin) {
      const r = await store.linkPortal(existing.id, sub, { markEmailVerified: false });
      if (!r.ok) return { kind: OUTCOME.LINKED_ELSEWHERE };
      return { kind: OUTCOME.SIGNED_IN, user: r.user, linked: true, created: false };
    }
    // Not provably the same person: the Stories side never verified this address (or this is an admin account).
    // Do NOT sign in and do NOT link; ask for the old password once.
    return { kind: OUTCOME.NEEDS_PASSWORD, pending: { userId: existing.id, sub, email, name: cleanName(who.name, email) } };
  }

  // (c) nobody has this email: a new account, if signups are open
  if (!signupsOpen) return { kind: OUTCOME.SIGNUPS_CLOSED };
  const created = await store.createPortalUser({ email, name: cleanName(who.name, email), sub });
  if (created.ok) return { kind: OUTCOME.SIGNED_IN, user: created.user, linked: true, created: true };

  // lost a race: another request created/linked first. Re-resolve once from the database.
  const again = await store.findByPortalSub(sub);
  if (again && !isBlocked(again)) return { kind: OUTCOME.SIGNED_IN, user: again, linked: false, created: false };
  if (created.reason === 'email_in_use') return { kind: OUTCOME.UNAVAILABLE };
  return { kind: OUTCOME.LINKED_ELSEWHERE };
}

/**
 * The password step for case (b)-unverified: the person has proven (at the portal) that they own the address; here
 * they prove they own the Stories account. Uniform failure: wrong password, unknown user and a missing hash are the
 * same answer. `compare(password, hash)` is bcrypt.compare; `dummyHash` keeps the timing the same when there is no user.
 */
export async function linkWithPassword(store, pending, password, { compare, dummyHash }) {
  const user = await store.findById(pending.userId);
  const hash = user && typeof user.password_hash === 'string' && user.password_hash ? user.password_hash : dummyHash;
  const ok = await compare(String(password || ''), hash);
  if (!user || !ok) return { kind: 'bad_password' };
  if (isBlocked(user)) return { kind: OUTCOME.BLOCKED, user };
  if (user.portal_sub) {
    // already linked meanwhile: the same sub is simply a sign-in, another sub is a conflict
    return user.portal_sub === pending.sub ? { kind: OUTCOME.SIGNED_IN, user, linked: false } : { kind: OUTCOME.LINKED_ELSEWHERE };
  }
  // the portal asserted this address is verified and the person just proved the password: the Stories side is now verified too
  const r = await store.linkPortal(user.id, pending.sub, { markEmailVerified: true });
  if (!r.ok) return { kind: OUTCOME.LINKED_ELSEWHERE };
  return { kind: OUTCOME.SIGNED_IN, user: r.user, linked: true };
}
