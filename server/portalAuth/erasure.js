// Account deletion for SAI Cloud identities: erase everything a person owns in Stories, keyed by their
// `portal_sub` (the OIDC subject — NEVER by email, name, key prefix or title; see STORIES-DELETION.md).
//
// The contract lives in sai-cluster/manifests/sai-portal/STORIES-DELETION.md. Rules implemented here:
//   - the erase is idempotent per `evt` (deletion evt ids are kept forever) and per `sub`;
//   - money rows (payments, subscriptions) are NOT deleted: both carry a NOT-NULL, ON-DELETE-CASCADE user_id,
//     so deleting the user row would destroy the amounts, which the contract forbids. The user row becomes an
//     anonymised tombstone instead: `status='erased'`, email/name pseudonymised (the columns are NOT NULL),
//     `portal_sub` NULL, a password nobody knows, `token_version` bumped (every session/JWT dies).
//   - rows reachable from that one user are removed; nothing else is matched — no name, email, prefix or title.
// Every count is logged by event id only (never a sub's data, titles or file names).
'use strict';

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/* Tables holding the person's data. The FK map (asserted against the REAL schema by the test):
 *   user_id columns: ai_cost_summary, ai_generations, api_keys, collaborators, continuity_analyses,
 *     email_verification_log, imports, jobs, login_history, quota_violations, quotas, template_clones,
 *     user_activity_log, user_settings
 *   owner_id columns: books, book_imports, custom_voices
 * NOT here: payments/subscriptions (money — tombstone instead); admin_audit_log and content_flags (an ADMIN's
 * act on someone else's content is not the erased person's data); chapter_versions.created_by (cascade children). */
export const USER_TABLES = [
  { t: 'ai_cost_summary', c: 'user_id' }, { t: 'ai_generations', c: 'user_id' }, { t: 'api_keys', c: 'user_id' },
  { t: 'collaborators', c: 'user_id' }, { t: 'continuity_analyses', c: 'user_id' },
  { t: 'email_verification_log', c: 'user_id' }, { t: 'imports', c: 'user_id' }, { t: 'jobs', c: 'user_id' },
  { t: 'login_history', c: 'user_id' }, { t: 'quota_violations', c: 'user_id' }, { t: 'quotas', c: 'user_id' },
  { t: 'template_clones', c: 'user_id' }, { t: 'user_activity_log', c: 'user_id' }, { t: 'user_settings', c: 'user_id' },
  { t: 'books', c: 'owner_id' }, { t: 'book_imports', c: 'owner_id' }, { t: 'custom_voices', c: 'owner_id' },
];
/* cascade children that go with their parents (asserted by the test, deleted by ON DELETE CASCADE) */
export const CASCADE_CHILDREN = ['chapters', 'chapter_versions', 'media'];

const ERASED_EMAIL = () => `erased-${crypto.randomUUID()}@invalid.invalid`;

export function createEraser({ pool, storage, redis, log = console }) {
  if (!pool) throw new Error('eraser: pool is required');

  /* Postgres: every row reachable from the user, then the tombstone. One transaction. */
  async function eraseUserRows(userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const counts = {};
      for (const { t, c } of USER_TABLES) {
        const r = await client.query(`DELETE FROM ${t} WHERE ${c} = $1`, [userId]);
        counts[t] = r.rowCount || 0;
      }
      // money: the person goes, the money stays (user_id is NOT NULL, so pseudonymise by a tombstone user below —
      // the FK keeps pointing at the erased user's row, which now carries nothing about them)
      counts.money_rows_kept = (
        await client.query('SELECT (SELECT COUNT(*) FROM payments WHERE user_id = $1) + (SELECT COUNT(*) FROM subscriptions WHERE user_id = $1) AS n', [userId])
      ).rows[0].n;
      const scrub = await client.query(
        `UPDATE users SET email = $2, name = $3, portal_sub = NULL, email_verification_token = NULL,
           email_verification_token_expires = NULL, email_verified = FALSE, portal_linked_at = NULL,
           password_hash = $4, token_version = token_version + 1, status = 'erased',
           deleted_at = COALESCE(deleted_at, NOW())
         WHERE id = $1`,
        [userId, ERASED_EMAIL(), 'Erased account', bcrypt.hashSync(crypto.randomBytes(48).toString('base64'), 10)],
      );
      counts.users_tombstoned = scrub.rowCount || 0;
      await client.query('COMMIT');
      return counts;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* already gone */ }
      throw e;
    } finally {
      client.release();
    }
  }

  /* MinIO: every object the user owns (media_owners is the ONLY ownership record — the objects carry no user
   * prefix), then the rows. One failed object aborts the whole erase: the caller answers 503 and the portal's
   * next delivery attempt retries it; removal is idempotent. */
  async function eraseMediaObjects(userId) {
    const { rows } = await pool.query(
      'SELECT bucket_type, filename FROM media_owners WHERE owner_id = $1 ORDER BY created_at', [userId]);
    let removed = 0;
    for (const r of rows) {
      try {
        await storage.delete(r.bucket_type, r.filename);
        removed++;
      } catch (e) {
        // an object that is already gone is fine; anything else stops the erase (retry later)
        if (!/NoSuchKey|not exist|404/i.test(String((e && (e.message || e.code)) || e))) {
          log.error && log.error('[identity-events] an object could not be removed; the erase will be retried');
          throw e;
        }
        removed++;
      }
    }
    await pool.query('DELETE FROM media_owners WHERE owner_id = $1', [userId]);
    return { objects: removed };
  }

  /* Redis. The keys a user owns here (dataAdapter.js, jobs/queue.js, services/mediaJobs.js):
   *   user:<id>:jobs (a set of "<type>:<id>" refs) + their job:<type>:<id> keys
   *   user:<id>:apikeys, mjobs:book:<bookId>:<id>
   *   apikey:<id> / password_reset:<token> caches — keyed by id or token, matched by their VALUE holding the id.
   * Bull's own keys are left alone: completed jobs self-remove (removeOnComplete), and an in-flight job's
   * metadata keys expire (24 h / 7 d) and reference only ids. */
  async function eraseRedis(userId) {
    if (!redis) return { keys: 0 };
    let keys = 0;
    const scanAll = async (pattern) => {
      const out = []; let cursor = '0';
      do {
        // node-redis v4 answers {cursor, keys}; some wrappers answer [cursor, keys] — accept both
        const r = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        const next = r && typeof r === 'object' && !Array.isArray(r) ? r.cursor : r[0];
        const batch = r && typeof r === 'object' && !Array.isArray(r) ? r.keys : r[1];
        if (next == null || !Array.isArray(batch)) throw new Error('the redis client answered an unreadable scan');
        cursor = String(next); out.push(...batch);
      } while (cursor !== '0');
      return out;
    };
    const del = async (...ks) => { if (ks.length) { await redis.del(...ks); keys += ks.length; } };

    // the user's own key space + the job refs inside it
    const own = await scanAll(`user:${userId}:*`);
    for (const k of own) {
      if (k.endsWith(':jobs')) {
        const refs = await redis.sMembers(k);
        await del(...refs.map(r => `job:${r}`));
      }
    }
    await del(...own);

    // media-job lists keyed ...:<userId>
    await del(...(await scanAll(`mjobs:book:*:${userId}`)));

    // value-keyed caches (api keys, password resets): small, bounded, matched by their value
    for (const k of await scanAll('apikey:*')) {
      try { if (JSON.parse(await redis.get(k)).userId === userId) await del(k); } catch { /* not ours */ }
    }
    for (const k of await scanAll('password_reset:*')) {
      try { if ((await redis.get(k)) === userId) await del(k); } catch { /* not ours */ }
    }
    return { keys };
  }

  /* Erase by portal_sub.
   * → { done: true, counts } — including "no Stories account holds this sub" and "already erased" (both idempotent no-ops),
   *   or { done: false } when something must be retried (the caller answers 503 and the portal retries). */
  async function eraseBySub(sub) {
    const u = await pool.query('SELECT id, status FROM users WHERE portal_sub = $1', [sub]);
    if (!u.rows.length) return { done: true, counts: { note: 'no Stories account holds this sub' } };
    const user = u.rows[0];
    if (user.status === 'erased') return { done: true, counts: { note: 'already erased' } };

    const media = await eraseMediaObjects(user.id);
    const rd = await eraseRedis(user.id);
    const pg = await eraseUserRows(user.id);
    log.info && log.info(`[identity-events] erased an account (${media.objects} objects, ${rd.keys} redis keys, ${pg.users_tombstoned} tombstoned, ${pg.money_rows_kept} money rows kept)`);
    return { done: true, counts: { media: media.objects, redis: rd.keys, pg } };
  }

  return { eraseBySub, USER_TABLES, CASCADE_CHILDREN };
}
