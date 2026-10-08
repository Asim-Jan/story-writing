// z106_portal_identity.sql and the UserRepository portal methods against a REAL Postgres.
// SKIPPED unless a throwaway server is named (it creates and drops its own database):
//   PORTAL_TEST_PG_HOST=127.0.0.1 PORTAL_TEST_PG_PORT=57432 PORTAL_TEST_PG_USER=postgres PORTAL_TEST_PG_PASSWORD=x \
//     node --test server/portalAuth/tests/migration.pg.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const E = process.env;
const enabled = ['127.0.0.1', 'localhost'].includes(E.PORTAL_TEST_PG_HOST) && E.PORTAL_TEST_PG_USER;
const skip = enabled ? false : 'set PORTAL_TEST_PG_HOST=127.0.0.1 (+ _PORT _USER _PASSWORD) to run against a throwaway Postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, '..', '..', 'db');
const UP = fs.readFileSync(path.join(dbDir, 'migrations', 'z106_portal_identity.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(dbDir, 'migrations-down', 'z106_portal_identity.down.sql'), 'utf8');
const DB = 'portal_mig_' + process.pid;
const conn = { host: E.PORTAL_TEST_PG_HOST, port: Number(E.PORTAL_TEST_PG_PORT || 5432), user: E.PORTAL_TEST_PG_USER, password: E.PORTAL_TEST_PG_PASSWORD };
let admin, pool, Repo, DataService;

before(async () => {
  if (skip) return;
  Object.assign(process.env, { USE_POSTGRES: 'true', READ_FROM_POSTGRES: 'true', DUAL_WRITE: 'false' });   // read by config/features.js at import
  Object.assign(process.env, { NODE_ENV: 'production', POSTGRES_HOST: conn.host, POSTGRES_PORT: String(conn.port), POSTGRES_USER: conn.user,
    POSTGRES_PASSWORD: conn.password || '', POSTGRES_DB: DB, POSTGRES_SSL: 'false' });
  admin = new pg.Client({ ...conn, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  const { getPool } = await import('../../db/postgres.js');
  pool = getPool();
  // what index.js does at boot on a fresh install
  await pool.query(fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8'));
  const { runMigrations } = await import('../../db/migrate.js');
  await runMigrations({ preexistingSchema: false });
  ({ UserRepository: Repo } = await import('../../db/repositories/UserRepository.js'));
  ({ UserDataService: DataService } = await import('../../db/dataService.js'));
});

after(async () => {
  if (skip) return;
  const { closePool } = await import('../../db/postgres.js').catch(() => ({}));
  try { await (closePool ? closePool() : pool.end()); } catch { /* already closed */ }
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.end();
});

const cols = async () => (await pool.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name IN ('portal_sub','portal_linked_at') ORDER BY 1`)).rows;
const mkUser = async (email, extra = '') => (await pool.query(`INSERT INTO users (email, name, password_hash, email_verified ${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ($1,'N','h',true ${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING *`, [email])).rows[0];

test('a fresh install has the two nullable columns and the unique index, recorded as applied', { skip }, async () => {
  assert.deepEqual(await cols(), [{ column_name: 'portal_linked_at', is_nullable: 'YES' }, { column_name: 'portal_sub', is_nullable: 'YES' }]);
  const idx = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='users_portal_sub_key'`);
  assert.match(idx.rows[0].indexdef, /UNIQUE/);
  const applied = await pool.query(`SELECT 1 FROM schema_migrations WHERE name='z106_portal_identity.sql'`);
  assert.equal(applied.rowCount, 1);
});

test('the migration is idempotent and reversible, and never touches an existing user or book', { skip }, async () => {
  const u = await mkUser('keep@example.com');
  const b = (await pool.query(`INSERT INTO books (owner_id, title) VALUES ($1,'My Book') RETURNING id`, [u.id])).rows[0];
  await pool.query(UP); await pool.query(UP);                                   // idempotent
  assert.equal((await cols()).length, 2);
  await pool.query(DOWN); await pool.query(DOWN);                               // reversible (and idempotent)
  assert.equal((await cols()).length, 0);
  await pool.query(UP);                                                          // and back
  assert.equal((await cols()).length, 2);
  const after = (await pool.query(`SELECT id, email, portal_sub FROM users WHERE id=$1`, [u.id])).rows[0];
  assert.deepEqual({ id: after.id, email: after.email, portal_sub: after.portal_sub }, { id: u.id, email: 'keep@example.com', portal_sub: null });
  assert.equal((await pool.query(`SELECT 1 FROM books WHERE id=$1 AND owner_id=$2`, [b.id, u.id])).rowCount, 1, 'the book is still there');
});

test('many users may be unlinked (NULL), but one sub can never be on two users', { skip }, async () => {
  const a = await mkUser('n1@example.com'); const b = await mkUser('n2@example.com');
  assert.equal(a.portal_sub, null); assert.equal(b.portal_sub, null);
  await pool.query(`UPDATE users SET portal_sub='u_dup' WHERE id=$1`, [a.id]);
  await assert.rejects(pool.query(`UPDATE users SET portal_sub='u_dup' WHERE id=$1`, [b.id]), (e) => e.code === '23505');
});

test('linkPortal: links an unlinked user atomically; a linked user or a taken sub is refused', { skip }, async () => {
  const a = await mkUser('l1@example.com'); const b = await mkUser('l2@example.com');
  const r = await Repo.linkPortal(a.id, 'u_L1');
  assert.equal(r.ok, true);
  assert.equal(r.user.id, a.id); assert.equal(r.user.portal_sub, 'u_L1'); assert.ok(r.user.portal_linked_at);
  assert.deepEqual(await Repo.linkPortal(a.id, 'u_L1'), { ok: false, reason: 'already_linked' });
  assert.deepEqual(await Repo.linkPortal(a.id, 'u_OTHER'), { ok: false, reason: 'sub_in_use' }, 'a user is never re-linked to a second sub');
  assert.deepEqual(await Repo.linkPortal(b.id, 'u_L1'), { ok: false, reason: 'sub_in_use' }, 'a sub is never on two users');
  assert.deepEqual(await Repo.linkPortal('00000000-0000-0000-0000-000000000000', 'u_X'), { ok: false, reason: 'not_found' });
  assert.equal((await Repo.findByPortalSub('u_L1')).id, a.id);
  assert.equal(await Repo.findByPortalSub('u_nobody'), null);
});

test('linkPortal with markEmailVerified verifies an unverified account; without it the flag is untouched', { skip }, async () => {
  const u = (await pool.query(`INSERT INTO users (email,name,password_hash,email_verified,email_verification_token) VALUES ('uv@example.com','N','h',false,'tok') RETURNING *`)).rows[0];
  const r1 = await Repo.linkPortal(u.id, 'u_UV', { markEmailVerified: true });
  assert.equal(r1.user.email_verified, true);
  assert.equal(r1.user.email_verification_token, null);
  const v = (await pool.query(`INSERT INTO users (email,name,password_hash,email_verified) VALUES ('uv2@example.com','N','h',false) RETURNING *`)).rows[0];
  assert.equal((await Repo.linkPortal(v.id, 'u_UV2')).user.email_verified, false);
});

test('createPortalUser: a free, verified, linked account with its quota and settings rows; duplicates are reported, not thrown', { skip }, async () => {
  const r = await Repo.createPortalUser({ email: 'new@example.com', name: 'New', sub: 'u_NEW', passwordHash: 'hash' });
  assert.equal(r.ok, true);
  assert.equal(r.user.tier, 'free'); assert.equal(r.user.email_verified, true); assert.equal(r.user.portal_sub, 'u_NEW');
  assert.equal((await pool.query(`SELECT max_books FROM quotas WHERE user_id=$1`, [r.user.id])).rows[0].max_books, 3);
  assert.equal((await pool.query(`SELECT 1 FROM user_settings WHERE user_id=$1`, [r.user.id])).rowCount, 1);
  assert.deepEqual(await Repo.createPortalUser({ email: 'other@example.com', name: 'O', sub: 'u_NEW', passwordHash: 'h' }), { ok: false, reason: 'sub_in_use' });
  assert.deepEqual(await Repo.createPortalUser({ email: 'new@example.com', name: 'O', sub: 'u_NEW2', passwordHash: 'h' }), { ok: false, reason: 'email_in_use' });
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM users WHERE email IN ('other@example.com')`)).rows[0].n, 0, 'nothing half-created');
});

test('the old create() path is unchanged (quota + settings rows)', { skip }, async () => {
  const u = await Repo.create({ email: 'pw@example.com', name: 'PW', password_hash: 'h' });
  assert.equal(u.portal_sub, null);
  assert.equal((await pool.query(`SELECT 1 FROM quotas WHERE user_id=$1`, [u.id])).rowCount, 1);
  assert.equal((await pool.query(`SELECT 1 FROM user_settings WHERE user_id=$1`, [u.id])).rowCount, 1);
});

test('deleting a user frees their SAI Cloud sub and findByPortalSub ignores deleted users', { skip }, async () => {
  const u = await mkUser('gone@example.com');
  await Repo.linkPortal(u.id, 'u_GONE');
  await Repo.delete(u.id);
  assert.equal(await Repo.findByPortalSub('u_GONE'), null);
  const again = await Repo.createPortalUser({ email: 'gone@example.com', name: 'Back', sub: 'u_GONE', passwordHash: 'h' });
  assert.equal(again.ok, true, 'the same person can sign up again');
});


/* ── the independent security review (2026-10-07) ─────────────────────────────────────────────── */
import bcrypt from 'bcryptjs';
import { emailKey } from '../emailKey.js';

test('review 3: linkPortal ALWAYS bumps token_version and returns the new one; passwordHash replaces the local password only when given', { skip }, async () => {
  const keep = (await pool.query(`INSERT INTO users (email,name,password_hash,email_verified) VALUES ('rv3a@example.com','N',$1,true) RETURNING *`, [await bcrypt.hash('known-pw', 4)])).rows[0];
  assert.equal(keep.token_version, 1);
  const r1 = await Repo.linkPortal(keep.id, 'u_RV3A', { markEmailVerified: true });
  assert.equal(r1.user.token_version, 2);
  assert.equal(await bcrypt.compare('known-pw', r1.user.password_hash), true, 'the password stays when no hash is given (password-step link)');

  const auto = (await pool.query(`INSERT INTO users (email,name,password_hash,email_verified) VALUES ('rv3b@example.com','N',$1,true) RETURNING *`, [await bcrypt.hash('attacker-pw', 4)])).rows[0];
  const attackerToken = auto.token_version;
  const r2 = await Repo.linkPortal(auto.id, 'u_RV3B', { passwordHash: await bcrypt.hash('nobody-knows', 4) });
  assert.equal(r2.user.token_version, attackerToken + 1, 'the attacker\'s JWT (tokenVersion 1) no longer matches what authenticateToken reads');
  assert.equal((await Repo.findById(auto.id)).token_version, 2);
  assert.equal(await bcrypt.compare('attacker-pw', r2.user.password_hash), false);
  // refused links change nothing
  assert.deepEqual(await Repo.linkPortal(auto.id, 'u_RV3B'), { ok: false, reason: 'already_linked' });
  assert.equal((await Repo.findById(auto.id)).token_version, 2, 'no second bump');
});

test('review 4: findUsersByEmail sees case-duplicates (the old findByEmail hid them behind LIMIT 1)', { skip }, async () => {
  await pool.query(`INSERT INTO users (email,name,password_hash) VALUES ('Dup.Case@example.com','A','h'), ('dup.case@example.com','B','h')`);
  assert.equal((await Repo.findUsersByEmail('DUP.CASE@EXAMPLE.COM')).length, 2);
  assert.equal((await Repo.findUsersByEmail('nobody.at.all@example.com')).length, 0);
  assert.equal((await Repo.findUsersByEmail('rv3a@example.com')).length, 1);
});

test('review 4: the operator counts are numbers only, agree with the data, and the script output holds no address', { skip }, async () => {
  const c = await Repo.emailAuditCounts();
  const total = (await pool.query(`SELECT count(*)::int n FROM users WHERE deleted_at IS NULL`)).rows[0].n;
  const groups = (await pool.query(`SELECT count(*)::int n FROM (SELECT 1 FROM users WHERE deleted_at IS NULL GROUP BY lower(email) HAVING count(*)>1) g`)).rows[0].n;
  const linked = (await pool.query(`SELECT count(*)::int n FROM users WHERE deleted_at IS NULL AND portal_sub IS NOT NULL`)).rows[0].n;
  assert.deepEqual([c.users, c.duplicateGroups, c.linked], [total, groups, linked]);
  assert.ok(c.duplicateGroups >= 1, 'the Dup.Case pair above');
  assert.ok(c.accountsInDuplicateGroups >= 2);
  const { run, formatCounts } = await import('../duplicateEmails.js');
  const out = [];
  assert.equal(await run({ out: (x) => out.push(x) }), 1, 'a duplicate group blocks');
  assert.ok(!out.join('\n').includes('@') && !/dup\.case/i.test(out.join('\n')));
  assert.match(formatCounts(c), /BLOCKED/);
  await pool.query(`DELETE FROM users WHERE lower(email)='dup.case@example.com'`);
  assert.equal((await Repo.emailAuditCounts()).duplicateGroups, 0);
  assert.equal(await run({ out: () => {} }), 0);
});

test('review 5: the SQL normalisation is the same rule as emailKey.js', { skip }, async () => {
  const addrs = ['ada@example.com', 'ada+books@example.com', 'Ada+X@Example.com', 'a.da@example.com', 'a.d.a@gmail.com', 'ada@gmail.com', 'ada+z@gmail.com',
    'Ada@GoogleMail.com', 'a.da@googlemail.com', 'ada@gmail.co.uk', 'a.da@gmail.co.uk', 'x.y+t@outlook.com'];
  for (const [i, a] of addrs.entries()) await pool.query(`INSERT INTO users (email,name,password_hash) VALUES ($1,'K','h')`, ['k' + i + '.' + a]);
  // keys are computed for the stored (prefixed) spelling and for a probe; both sides must agree on who matches whom
  for (const [i, a] of addrs.entries()) {
    const stored = 'k' + i + '.' + a;
    const hits = (await Repo.findUsersByEmailKey(emailKey(stored), 10)).map((u) => u.email);
    assert.ok(hits.includes(stored), `${stored} finds itself by its own key ${emailKey(stored)}`);
    for (const h of hits) assert.equal(emailKey(h), emailKey(stored), `${h} shares the key of ${stored}`);
  }
  // and the cases that matter
  const mk = async (email) => (await pool.query(`INSERT INTO users (email,name,password_hash) VALUES ($1,'K','h') RETURNING id`, [email])).rows[0].id;
  await mk('pat.person@gmail.com'); await mk('lee+old@example.org'); await mk('a.b@example.net');
  assert.equal((await Repo.findUsersByEmailKey(emailKey('patperson+news@googlemail.com'))).length, 1);
  assert.equal((await Repo.findUsersByEmailKey(emailKey('lee@example.org'))).length, 1);
  assert.equal((await Repo.findUsersByEmailKey(emailKey('ab@example.net'))).length, 0, 'dots are significant outside Gmail');
  assert.equal((await Repo.findUsersByEmailKey(emailKey('nobody@example.org'))).length, 0);
});

test('second review 1: trustedOnly counts verified or portal-linked lookalikes only, in SQL, so unverified rows cannot crowd the LIMIT', { skip }, async () => {
  const mk = async (email, verified, sub = null) => (await pool.query(`INSERT INTO users (email,name,password_hash,email_verified,portal_sub) VALUES ($1,'K','h',$2,$3) RETURNING id`, [email, verified, sub])).rows[0].id;
  for (let i = 0; i < 4; i++) await mk(`sq.uat+${i}@gmail.com`, false);                                   // squatters, oldest first
  assert.equal((await Repo.findUsersByEmailKey(emailKey('sq.uat@gmail.com'), 10, { trustedOnly: true })).length, 0, 'unverified only: nobody counts');
  assert.equal((await Repo.findUsersByEmailKey(emailKey('sq.uat@gmail.com'), 10)).length, 4, 'the untrusted default still sees them');
  await mk('squat.real@gmail.com', true);                                                                   // different key: must not match
  const v = await mk('sq.u.at+real@gmail.com', true);
  const hit = await Repo.findUsersByEmailKey(emailKey('sq.uat@gmail.com'), 2, { trustedOnly: true });
  assert.deepEqual(hit.map((u) => u.id), [v], 'the verified one is returned even though four older unverified rows precede it and the limit is 2');
  await mk('lk.unverified+1@example.org', false, 'u_second_review_sub_1');
  assert.equal((await Repo.findUsersByEmailKey(emailKey('lk.unverified@example.org'), 2, { trustedOnly: true })).length, 1, 'portal-linked counts even if unverified');
});

test('review 6e: a generic update cannot move portal_sub / portal_linked_at, even from a stale copy of the whole user', { skip }, async () => {
  const u = (await pool.query(`INSERT INTO users (email,name,password_hash) VALUES ('rv6e@example.com','N','h') RETURNING *`)).rows[0];
  const stale = await Repo.findById(u.id);                                   // portal_sub NULL
  await Repo.linkPortal(u.id, 'u_RV6E');
  await Repo.update(u.id, { name: 'Renamed', portal_sub: stale.portal_sub, portal_linked_at: stale.portal_linked_at });
  const now = await Repo.findById(u.id);
  assert.equal(now.name, 'Renamed');
  assert.equal(now.portal_sub, 'u_RV6E', 'the stale NULL did not unlink the account');
  assert.ok(now.portal_linked_at);
  await assert.rejects(Repo.update(u.id, { portal_sub: 'u_OTHER' }), /No valid fields/);
  assert.equal((await Repo.findById(u.id)).portal_sub, 'u_RV6E');
  // the data-service path the handlers use
  await DataService.update(u.id, { ...stale, name: 'Again' });
  assert.equal((await Repo.findById(u.id)).portal_sub, 'u_RV6E');
});

test('review 3/6e: a book-list-only update writes nothing to users, so a stale password hash is never put back', { skip }, async () => {
  const u = (await pool.query(`INSERT INTO users (email,name,password_hash) VALUES ('rv3c@example.com','N','attacker-hash') RETURNING *`)).rows[0];
  await Repo.linkPortal(u.id, 'u_RV3C', { passwordHash: 'unusable-hash' });
  await DataService.update(u.id, { books: ['b1'] });                          // what the book handlers send now
  assert.equal((await Repo.findById(u.id)).password_hash, 'unusable-hash');
  await DataService.update(u.id, { password: 'new-hash' });                    // the intended password change still works
  assert.equal((await Repo.findById(u.id)).password_hash, 'new-hash');
});

test('review 2: completePasswordReset verifies the email, clears the token and bumps token_version', { skip }, async () => {
  const u = (await pool.query(`INSERT INTO users (email,name,password_hash,email_verified,email_verification_token,email_verification_token_expires) VALUES ('rv2@example.com','N','h',false,'tok',NOW()+interval '1 day') RETURNING *`)).rows[0];
  const r = await Repo.completePasswordReset(u.id);
  assert.equal(r.email_verified, true);
  assert.equal(r.email_verification_token, null);
  assert.equal(r.token_version, u.token_version + 1);
  assert.equal(await Repo.completePasswordReset('00000000-0000-0000-0000-000000000000'), null);
  // and now the same account auto-links (the reset-then-link path)
  assert.equal((await Repo.linkPortal(u.id, 'u_RV2')).ok, true);
});
