// Minimal lint: undeclared globals fail the build (the Chapters-tab
// white-screen class — Vite doesn't flag undeclared names; eslint does).
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  rules: {
    'no-undef': 'error',
    'no-redeclare': 'error',
  },
  overrides: [
    {
      files: ['src/**/*.{js,jsx}'],
      globals: {
        React: 'readonly',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'public/dist/'],
};
