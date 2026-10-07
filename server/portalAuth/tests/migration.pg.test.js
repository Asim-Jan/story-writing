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
let admin, pool, Repo;

before(async () => {
  if (skip) return;
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
