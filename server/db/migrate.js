// Migration runner — applies SQL files from server/db/migrations in filename order,
// once each, tracked in schema_migrations. Runs at boot (server/index.js) before the
// server starts listening. A fresh install therefore self-heals; the five orphan
// .sql files that shipped without a runner get applied the same way.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, getPool } from './postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// `preexistingSchema`: did the books table exist BEFORE this boot ran schema.sql?
// The caller must check that first. Asking here, after schema.sql has created
// the tables, made a fresh install look like an old one and skipped 01-13.
export async function runMigrations({ preexistingSchema = false } = {}) {
  let pool;
  try {
    pool = getPool();
  } catch (err) {
    console.warn('[migrate] no database configured, skipping migrations');
    return;
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // numeric-aware order, so z100_* runs after z99_* (plain sort put it first)
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  const { rows } = await query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(r => r.name));

  // BASELINE: the first boot on a database that predates the runner. The
  // migration files 01–13 shipped long before it and their objects already
  // exist in prod — re-running them on an empty schema_migrations table would
  // re-apply everything to the live DB (and any failure there means
  // process.exit(1) = an outage loop). If the schema is already populated,
  // record 01–13 as applied; only the genuinely new files (z98, z99, and
  // everything added after) actually run.
  if (applied.size === 0 && preexistingSchema) {
    const preRunner = files.filter(f => !f.startsWith('z'));
    for (const f of preRunner) {
      await query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    }
    console.log(`[migrate] baseline: marked ${preRunner.length} pre-runner migration(s) as applied on the existing schema`);
  }

  const { rows: rows2 } = await query('SELECT name FROM schema_migrations');
  const finalApplied = new Set(rows2.map(r => r.name));

  for (const file of files) {
    if (finalApplied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrate] applying ${file}`);
    try {
      await query(sql);
      await query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      console.error(`[migrate] FAILED ${file}: ${err.message}`);
      throw err; // do not boot half-migrated
    }
  }
}
