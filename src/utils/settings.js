// Pure helpers for the Settings page (no React, no fetch: the regression suite imports them).

export const PLAN_NAMES = { free: 'Free', basic: 'Basic', premium: 'Premium' };
// what checkout charges (Stripe prices in GBP); the limits themselves always come from the server's tier table
export const PLAN_PRICES = { basic: '£9.99', premium: '£19.99' };

// /api/plans `features` keys, in plain words; a key without a label is not shown
export const FEATURE_LABELS = {
  ai_generation: 'AI writing tools',
  media_generation: 'Pictures, audiobooks and films',
  export_epub: 'ePub export',
  export_pdf: 'PDF export',
  export_cbz: 'Comic export (CBZ)',
  export_rpg: 'RPG export',
  continuity_check: 'Continuity check',
  collaboration: 'Collaborators',
  version_history: 'Version history',
  priority_processing: 'Priority processing',
};

export const UNLIMITED = 999999;

/** Usage against a limit: {pct 0..100, unlimited}. A missing or "unlimited" limit has no bar. */
export function meterOf(used, limit) {
  const l = Number(limit);
  if (!Number.isFinite(l) || l <= 0 || l >= UNLIMITED) return { pct: 0, unlimited: true };
  const u = Math.max(0, Number(used) || 0);
  return { pct: Math.min(100, Math.round((u / l) * 100)), unlimited: false };
}

/** "chapter-generator" / "plot_twist" -> "Chapter generator" / "Plot twist". */
export function toolLabel(type) {
  const s = String(type || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Other';
}

/** Up to two initials from the name, else the first letter of the email. */
export function initialsOf(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  return String(email || '?').trim().charAt(0).toUpperCase() || '?';
}

/**
 * What a URL asks the Settings page to open with: ?settings=<section>, plus ?connect=<id> after a SAI Cloud connect and
 * ?checkout=success|canceled after Stripe. null when the URL does not ask for Settings.
 */
export function settingsArrival(search, sections = ['account', 'security', 'plan', 'preferences']) {
  const q = new URLSearchParams(search || '');
  if (!q.has('settings')) return null;
  const s = q.get('settings');
  const checkout = q.get('checkout');
  return {
    section: sections.includes(s) ? s : 'account',
    connected: /^[0-9a-f]{32}$/.test(q.get('connect') || ''),
    checkout: checkout === 'success' || checkout === 'canceled' ? checkout : null,
  };
}
