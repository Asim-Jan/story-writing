// Pre-paint theme: honour a saved choice (accounts can pick night chart).
// A FILE, not an inline script — the CSP allows no inline scripts.
try { if (localStorage.getItem('sw-theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch (e) {}
