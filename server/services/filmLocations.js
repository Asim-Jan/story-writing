// A film scene names its place; find it among the book's locations, so the
// scene can be drawn from the location's own description and picture.
// "Shinjuku Undergrid (Underground City)" is "Shinjuku Undergrid"; "the gull
// lighthouse" is "Gull Lighthouse".

const norm = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/^\s*the\s+/, '').replace(/\s+/g, ' ').trim();

export function matchLocation(name, locations = []) {
  const want = norm(name);
  if (!want) return null;
  const named = (locations || []).filter(l => norm(l?.name));
  const exact = named.find(l => norm(l.name) === want || (l.aliases || []).some(a => norm(a) === want));
  if (exact) return exact;
  // the longest book name that the scene's place contains, or that contains it
  const within = named
    .filter(l => { const n = norm(l.name); return n.length >= 4 && (want.includes(n) || (want.length >= 6 && n.includes(want))); })
    .sort((a, b) => norm(b.name).length - norm(a.name).length);
  return within[0] || null;
}

/** The place in words for a prompt: name, description and atmosphere, capped. */
export function describeLocation(location, max = 500) {
  if (!location) return '';
  const parts = [location.description, location.atmosphere].map(s => String(s || '').trim()).filter(Boolean);
  return `${location.name}${parts.length ? `: ${parts.join(' ')}` : ''}`.slice(0, max);
}
