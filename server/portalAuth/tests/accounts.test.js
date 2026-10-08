// Account resolution rules (accounts.js) against the in-memory store.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { resolveAccount, linkWithPassword, OUTCOME } from '../accounts.js';
import { memoryStore, hash } from './harness.js';

const who = (over = {}) => ({ sub: 'u_1111111111111111', emailVerified: true, verifiedEmail: 'ada@example.com', name: 'Ada', ...over });
const open = { signupsOpen: true };

test('(a) a user already linked to this sub signs in, even if the email has changed at the portal', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'old@example.com', portal_sub: 'u_1111111111111111', email_verified: true });
  const r = await resolveAccount(store, who({ verifiedEmail: 'brand-new@example.com' }), open);
  assert.equal(r.kind, OUTCOME.SIGNED_IN);
  assert.equal(r.user.id, u.id);
  assert.equal(r.user.email, 'old@example.com', 'the Stories email is not rewritten');
  assert.equal(store.users.length, 1, 'no second account is created');
});

test('(a) by sub only: an unverified portal email does not matter for an already linked user', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'x@example.com', portal_sub: 'u_1111111111111111' });
  const r = await resolveAccount(store, who({ emailVerified: false, verifiedEmail: null }), open);
  assert.equal(r.kind, OUTCOME.SIGNED_IN);
  assert.equal(r.user.id, u.id);
});

test('(b) same email, Stories email VERIFIED: linked automatically, same user id', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'Ada@Example.com', email_verified: true });
  const r = await resolveAccount(store, who(), open);
  assert.equal(r.kind, OUTCOME.SIGNED_IN);
  assert.equal(r.linked, true);
  assert.equal(r.user.id, u.id);
  assert.equal(u.portal_sub, 'u_1111111111111111');
  assert.ok(u.portal_linked_at);
  assert.equal(store.users.length, 1);
});

test('(b) same email, Stories email NOT verified: nothing is linked and nobody is signed in', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('old-pass') });
  const r = await resolveAccount(store, who(), open);
  assert.equal(r.kind, OUTCOME.NEEDS_PASSWORD);
  assert.equal(r.user, undefined, 'no user is handed back for a session');
  assert.deepEqual(Object.keys(r.pending).sort(), ['email', 'name', 'sub', 'userId']);
  assert.equal(u.portal_sub, null, 'not linked');
});

test('(b) an ADMIN account always goes through the password step, even with a verified email', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', email_verified: true, role: 'admin' });
  const r = await resolveAccount(store, who(), open);
  assert.equal(r.kind, OUTCOME.NEEDS_PASSWORD);
  assert.equal(u.portal_sub, null);
});

test('(b) the Stories user is linked to ANOTHER sub: refused, never re-linked', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', email_verified: true, portal_sub: 'u_other0000000000' });
  const r = await resolveAccount(store, who(), open);
  assert.equal(r.kind, OUTCOME.LINKED_ELSEWHERE);
  assert.equal(u.portal_sub, 'u_other0000000000');
});

test('(b) a suspended or banned user cannot be linked or signed in', async () => {
  for (const status of ['suspended', 'banned']) {
    const store = memoryStore();
    const u = store.add({ email: 'ada@example.com', email_verified: true, status });
    assert.equal((await resolveAccount(store, who(), open)).kind, OUTCOME.BLOCKED);
    assert.equal(u.portal_sub, null);
    const linked = memoryStore();
    linked.add({ email: 'z@example.com', portal_sub: 'u_1111111111111111', status });
    assert.equal((await resolveAccount(linked, who(), open)).kind, OUTCOME.BLOCKED);
  }
});

test('an unverified portal email can never link or create', async () => {
  const store = memoryStore();
  store.add({ email: 'ada@example.com', email_verified: true });
  for (const w of [who({ emailVerified: false }), who({ verifiedEmail: null }), who({ emailVerified: undefined })]) {
    assert.equal((await resolveAccount(store, w, open)).kind, OUTCOME.EMAIL_UNVERIFIED);
  }
  assert.equal(store.users[0].portal_sub, null);
});

test('(c) no such user: a new free account linked to the sub, email taken from the verified claim', async () => {
  const store = memoryStore();
  const r = await resolveAccount(store, who({ verifiedEmail: 'New.Person@Example.com', name: '  ' }), open);
  assert.equal(r.kind, OUTCOME.SIGNED_IN);
  assert.equal(r.created, true);
  assert.equal(r.user.email, 'new.person@example.com');
  assert.equal(r.user.name, 'new.person', 'falls back to the local part when the portal sent no name');
  assert.equal(r.user.tier, 'free');
  assert.equal(r.user.email_verified, true);
  assert.equal(r.user.portal_sub, 'u_1111111111111111');
});

test('(c) signups closed: a new person is refused with a clear outcome and nothing is created', async () => {
  const store = memoryStore();
  const r = await resolveAccount(store, who(), { signupsOpen: false });
  assert.equal(r.kind, OUTCOME.SIGNUPS_CLOSED);
  assert.equal(store.users.length, 0);
});

test('closed signups do not stop an EXISTING user from linking', async () => {
  const store = memoryStore();
  store.add({ email: 'ada@example.com', email_verified: true });
  assert.equal((await resolveAccount(store, who(), { signupsOpen: false })).kind, OUTCOME.SIGNED_IN);
});

test('two different subs can never end up on one Stories user, and one sub never on two users', async () => {
  const store = memoryStore();
  store.add({ email: 'ada@example.com', email_verified: true });
  assert.equal((await resolveAccount(store, who({ sub: 'u_A' }), open)).kind, OUTCOME.SIGNED_IN);
  assert.equal((await resolveAccount(store, who({ sub: 'u_B' }), open)).kind, OUTCOME.LINKED_ELSEWHERE);
  const other = store.add({ email: 'grace@example.com', email_verified: true });
  const r = await resolveAccount(store, who({ sub: 'u_A', verifiedEmail: 'grace@example.com' }), open);
  assert.equal(r.user.id, store.users[0].id, 'u_A is already Ada: identified by sub, the email claim is ignored');
  assert.equal(other.portal_sub, null);
  assert.equal(store.users.filter((u) => u.portal_sub === 'u_A').length, 1);
});

test('losing the create race re-resolves instead of failing', async () => {
  const store = memoryStore();
  let raced = false;
  const racing = { ...store, findByPortalSub: store.findByPortalSub, findByEmail: store.findByEmail, createPortalUser: async (d) => {
    if (!raced) { raced = true; store.add({ email: d.email, portal_sub: d.sub, email_verified: true }); return { ok: false, reason: 'sub_in_use' }; }
    return store.createPortalUser(d);
  } };
  const r = await resolveAccount(racing, who(), open);
  assert.equal(r.kind, OUTCOME.SIGNED_IN);
  assert.equal(store.users.length, 1);
});

/* ── the password step ─────────────────────────────────────────────────────────────────────────── */
const deps = { compare: bcrypt.compare, dummyHash: hash('dummy') };

test('password step: the right old password links (and marks the Stories email verified)', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', email_verified: false, password_hash: hash('old-pass-1A!') });
  const r = await linkWithPassword(store, { userId: u.id, sub: 'u_1111111111111111' }, 'old-pass-1A!', deps);
  assert.equal(r.kind, OUTCOME.SIGNED_IN);
  assert.equal(r.linked, true);
  assert.equal(u.portal_sub, 'u_1111111111111111');
  assert.equal(u.email_verified, true);
});

test('password step: wrong password, unknown user and empty password are the same answer and link nothing', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', password_hash: hash('old-pass-1A!') });
  const a = await linkWithPassword(store, { userId: u.id, sub: 's' }, 'nope', deps);
  const b = await linkWithPassword(store, { userId: 'ghost', sub: 's' }, 'old-pass-1A!', deps);
  const c = await linkWithPassword(store, { userId: u.id, sub: 's' }, '', deps);
  assert.deepEqual(a, { kind: 'bad_password' });
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.equal(u.portal_sub, null);
});

test('password step: an account linked meanwhile to ANOTHER sub is a conflict; to the same sub is just a sign-in', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', password_hash: hash('pw'), portal_sub: 'u_other' });
  assert.equal((await linkWithPassword(store, { userId: u.id, sub: 'u_mine' }, 'pw', deps)).kind, OUTCOME.LINKED_ELSEWHERE);
  assert.equal(u.portal_sub, 'u_other');
  assert.equal((await linkWithPassword(store, { userId: u.id, sub: 'u_other' }, 'pw', deps)).kind, OUTCOME.SIGNED_IN);
});

test('password step: a suspended user is not signed in, even with the right password', async () => {
  const store = memoryStore();
  const u = store.add({ email: 'ada@example.com', password_hash: hash('pw'), status: 'suspended' });
  assert.equal((await linkWithPassword(store, { userId: u.id, sub: 's' }, 'pw', deps)).kind, OUTCOME.BLOCKED);
  assert.equal(u.portal_sub, null);
});
