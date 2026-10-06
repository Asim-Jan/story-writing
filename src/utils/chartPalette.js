// ORDNANCE chart palette — read from the LIVE theme tokens (getComputedStyle),
// because SVG/Recharts attributes cannot resolve CSS var() and the two themes
// are authored independently (night chart ≠ inverted sheet). Calling this on
// every render keeps charts in step when the theme toggles.
//
// Series order: blue (the one working colour) first, then dim/ok/warn, then a
// blue-tint ramp for additional series. Oxide stays OUT of chart palettes —
// it is reserved for the brand mark and destructive actions.
export function ordnanceChartColors(count = 6) {
  if (typeof window === 'undefined') return [];
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  const base = [
    v('--blue'), v('--dim'), v('--ok'), v('--warn'),
    v('--line2'), v('--dim2'),
  ].filter(Boolean);
  if (base.length < count) {
    // pad with progressively lighter/darker blue steps via alpha compositing
    const blue = v('--blue') || '#6EA8D8';
    const n = parseInt(blue.slice(1), 16);
    for (let i = 1; base.length < count; i++) {
      const a = Math.max(0.28, 0.75 - i * 0.12);
      base.push(blue + Math.round(a * 255).toString(16).padStart(2, '0'));
    }
  }
  return base.slice(0, count);
}
