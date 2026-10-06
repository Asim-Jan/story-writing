/** @type {import('tailwindcss').Config} */

/* ═══════════════════════════════════════════════════════════════════════════
   ORDNANCE — the SAI design system, expressed as the Tailwind palette.

   Every Tailwind colour class in the app (bg-purple-600, text-gray-700,
   from-indigo-600, ...) resolves HERE, so the whole UI wears ORDNANCE tones
   without touching a single component file. All accent hues (purple, indigo,
   violet) collapse onto the blue ladder — the ONE working colour — and the
   warn-family (yellow/amber/orange) onto the warn ladder. The ladders are
   authored tones of the token hues, not mechanical ramps.

   Hard rules (see manifests/_design/ordnance/): no gradients/glass/glow/
   shadows; radii 3/6/0; one 120ms motion; no emoji in chrome.
   ═══════════════════════════════════════════════════════════════════════════ */

// Sheet (light) is the app default — the ladder favours darker steps for ink.
// The night-chart mapping rides on CSS vars in index.css (data-theme="dark").
const blue =  { 50:'#EBF1F6', 100:'#DDE8F0', 200:'#B8CEDD', 300:'#8FB3C9', 400:'#5F88A3',
                500:'#29506E', 600:'#29506E', 700:'#23445C', 800:'#1B374D', 900:'#122939' };
const gray =  { 50:'#F7F5F0', 100:'#EFEDE6', 200:'#C9C6BC', 300:'#A9A69B', 400:'#8A8F93',
                500:'#666F73', 600:'#5A6469', 700:'#454D51', 800:'#2A3134', 900:'#14181B' };
const ok =    { 50:'#EDF3EF', 100:'#DFEAE3', 200:'#BCCFC3', 300:'#93AFA0', 400:'#5F8470',
                500:'#3F6B4F', 600:'#3F6B4F', 700:'#365C44', 800:'#2E4D39', 900:'#23392B' };
const warn =  { 50:'#F5F0E4', 100:'#EEE6D3', 200:'#DFCBA6', 300:'#C9AC7C', 400:'#8A6A34',
                500:'#A9721A', 600:'#8F6116', 700:'#8F6116', 800:'#6E4E12', 900:'#573D0E' };
const oxide = { 50:'#F7ECE8', 100:'#F0DDD6', 200:'#DFB7AA', 300:'#C99080', 400:'#A35F4C',
                500:'#B4472E', 600:'#B4472E', 700:'#99402B', 800:'#7A3220', 900:'#5C2618' };

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    // ORDNANCE radii: 3px inputs/buttons, 6px panels. No pill/shadow lift.
    borderRadius: {
      none: '0',
      sm: '3px',
      DEFAULT: '3px',
      md: '3px',
      lg: '6px',
      xl: '6px',
      '2xl': '6px',
      '3xl': '6px',
      full: '9999px',
    },
    // One motion: 120ms cubic-bezier(.4,0,.2,1)
    transitionDuration: { DEFAULT: '120ms', 0: '0ms', 75: '120ms', 100: '120ms',
                          150: '120ms', 200: '120ms', 300: '120ms', 500: '120ms',
                          700: '120ms', 1000: '120ms' },
    transitionTimingFunction: { DEFAULT: 'cubic-bezier(.4,0,.2,1)' },
    extend: {
      colors: {
        blue, gray, slate: gray, zinc: gray, neutral: gray, stone: gray,
        purple: blue, indigo: blue, violet: blue, fuchsia: blue, pink: blue, rose: oxide,
        green: ok, emerald: ok, teal: ok, cyan: ok, sky: blue,
        yellow: warn, amber: warn, orange: warn, lime: ok,
        red: oxide, warm: warn,
      },
      boxShadow: {
        sm: 'none', DEFAULT: 'none', md: 'none', lg: 'none', xl: 'none',
        '2xl': 'none', inner: 'none', none: 'none',
      },
    },
  },
  plugins: [],
}
