// Pre-paint theme: honour a saved choice ('light', 'dark', or 'system' = follow the device).
// A FILE, not an inline script — the CSP allows no inline scripts.
try {
  var c = localStorage.getItem('sw-theme');
  if (c === 'dark' || ((c === 'system' || !c) && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
} catch (e) {}
