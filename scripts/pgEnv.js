// The database settings for the maintenance scripts in this folder. Every value comes from the environment (or a .env file);
// there are NO built-in defaults, so a script can never reach a database you did not name, and no credential lives in the repo.
//   POSTGRES_HOST=... POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=... [POSTGRES_PORT=5432] node scripts/<script>.js
import dotenv from 'dotenv';

export const REQUIRED_PG_ENV = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];

/** Names (never values) of the required variables that are missing or empty. */
export function missingPgEnv(env = process.env) {
  return REQUIRED_PG_ENV.filter((k) => !String(env[k] || '').trim());
}

/** Pool settings from the environment; prints which variables are missing and exits 1 if any is. */
export function pgConfigFromEnv(env = process.env, { exit = process.exit, err = console.error } = {}) {
  const missing = missingPgEnv(env);
  if (missing.length) {
    err(`Missing required environment variable(s): ${missing.join(', ')}`);
    err('Set POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB (and POSTGRES_PORT if it is not 5432), in the environment or a .env file.');
    exit(1);
    return null;
  }
  return {
    host: env.POSTGRES_HOST,
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
  };
}

/** Load .env, then read the settings. Call this where the Pool is made. */
export function loadPgConfig() {
  dotenv.config();
  return pgConfigFromEnv();
}
