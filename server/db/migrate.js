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

export async function runMigrations() {
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

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const { rows } = await query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(r => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;

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
