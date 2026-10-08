import { AsyncLocalStorage } from 'async_hooks';
import { query } from '../db/postgres.js';

// The app's chat "backbone", switchable at runtime from the admin dashboard.
//
// Code asks for a ROLE, not a model: SAI_CHAT ('sai-chat') means the Writer
// (long-form: chapters, whole books) and SAI_CHAT_FAST ('sai-chat-fast')
// means the Assistant (short helpers, JSON extraction, RPG tools). The SAI
// client maps the role to the model configured here on every call, so a
// switch needs no redeploy and no change at any of the call sites.
//
// Stored in app_settings ('ai_models'); env vars are the fallback defaults.
// Every process (API, worker) refreshes its copy every 15 s.

export const MODEL_ROLES = {
  writer: {
    label: 'Writer',
    description: 'Long-form writing: chapters and whole books',
    roleToken: process.env.SAI_CHAT_MODEL || 'sai-chat',
    fallback: process.env.SAI_WRITER_MODEL || 'sai-chat-fast',
  },
  assistant: {
    label: 'Assistant',
    description: 'Short helpers, JSON extraction (characters, scenes, import analysis), RPG tools',
    roleToken: process.env.SAI_CHAT_FAST_MODEL || 'sai-chat-fast',
    fallback: process.env.SAI_ASSISTANT_MODEL || 'sai-chat-fast',
  },
};

// ── Plan-gated Writer choice ─────────────────────────────────────────────────
// A user whose plan has the `model_choice` feature (Premium) may pick which model writes for them. The choice is
// saved in user_settings.preferences.writerModel and applies through a per-request context: authenticateToken runs the
// rest of the request inside withModelChoice(), so every Writer call made for that request (including the media jobs
// it starts, which run in-process) resolves to the user's model. Nothing else changes at any call site.
//
// What a user may choose from: SAI_WRITER_CHOICES (default "sai-chat,sai-chat-fast"), further limited to what the
// gateway serves. The plain-language description of each one lives here too, so the page and the API agree.
export const MODEL_INFO = {
  'sai-chat': { label: 'SAI Chat', note: 'Quick and dependable; the everyday writing model.' },
  'sai-chat-fast': { label: 'SAI Chat Fast', note: 'The richest prose and the best at long scenes. Costs the most to run.' },
};
export const WRITER_CHOICES = String(process.env.SAI_WRITER_CHOICES || 'sai-chat,sai-chat-fast')
  .split(',').map((m) => m.trim()).filter(Boolean);

const requestModels = new AsyncLocalStorage();
/** Run fn with this Writer model for every Writer call it makes (null = the plan default). */
export function withModelChoice(writer, fn) {
  return requestModels.run({ writer: typeof writer === 'string' && writer ? writer : null }, fn);
}

const CHOICE_TTL_MS = 30000;
const choiceCache = new Map();   // userId -> { writer, at }
/** Forget a cached choice (after the user changes it). */
export function forgetModelChoice(userId) { choiceCache.delete(String(userId)); }
/**
 * The Writer model a user has chosen, or null when they have none or their plan no longer allows one
 * (a downgrade switches them back to the default without touching the saved choice).
 * @param {object} user   { id|userId, tier, role }
 * @param {(user) => boolean} allowed   the plan check (index.js: hasFeature(tier, 'model_choice') or admin)
 */
export async function writerChoiceFor(user, allowed) {
  if (!user || !allowed(user)) return null;
  const id = String(user.userId || user.id);
  const hit = choiceCache.get(id);
  if (hit && Date.now() - hit.at < CHOICE_TTL_MS) return hit.writer;
  let writer = null;
  try {
    const { rows } = await query(`SELECT preferences->>'writerModel' AS w FROM user_settings WHERE user_id = $1`, [id]);
    writer = rows[0]?.w && WRITER_CHOICES.includes(rows[0].w) ? rows[0].w : null;
  } catch { /* no settings row / no database: the default */ }
  choiceCache.set(id, { writer, at: Date.now() });
  if (choiceCache.size > 5000) choiceCache.delete(choiceCache.keys().next().value);
  return writer;
}

const REFRESH_MS = 15000;
let current = Object.fromEntries(Object.entries(MODEL_ROLES).map(([k, r]) => [k, r.fallback]));
let loadedAt = 0;
let loading = null;

async function load() {
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = 'ai_models'`);
    const saved = rows[0]?.value || {};
    current = Object.fromEntries(Object.entries(MODEL_ROLES).map(([k, r]) => [k, typeof saved[k] === 'string' && saved[k] ? saved[k] : r.fallback]));
  } catch (err) {
    // no table yet (first boot before migrations) or no database: keep the defaults
    if (!/does not exist|ECONNREFUSED|not configured/i.test(err.message)) console.warn('AI model settings load failed:', err.message);
  }
  loadedAt = Date.now();
}

function refreshSoon() {
  if (Date.now() - loadedAt < REFRESH_MS || loading) return;
  loading = load().finally(() => { loading = null; });
}

/** The configured model for each role ({ writer, assistant }). */
export async function getModelSettings() {
  if (Date.now() - loadedAt >= REFRESH_MS) await (loading || load());
  return { ...current };
}

/**
 * Map a requested model to the one to call. A role token (the SAI_CHAT /
 * SAI_CHAT_FAST constants) becomes the configured model; any other name is
 * used as given. Synchronous: uses the cached settings and refreshes them in
 * the background.
 */
export function resolveChatModel(requested) {
  refreshSoon();
  if (requested === MODEL_ROLES.writer.roleToken) {
    const chosen = requestModels.getStore()?.writer;
    if (chosen) return chosen;
  }
  for (const [role, r] of Object.entries(MODEL_ROLES)) {
    if (requested === r.roleToken) return current[role];
  }
  return requested;
}

export async function saveModelSettings(settings, userId) {
  const value = {};
  for (const role of Object.keys(MODEL_ROLES)) {
    if (typeof settings[role] === 'string' && settings[role].trim()) value[role] = settings[role].trim();
  }
  await query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('ai_models', $1, NOW(), $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(value), userId || null]
  );
  await load();
  return { ...current };
}

// No load at import time: on a fresh database the migrations that create
// app_settings run after the modules load. The first request loads the
// settings (until then the env defaults apply).
