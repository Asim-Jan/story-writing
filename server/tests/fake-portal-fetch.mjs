// Preloaded into a test server with NODE_OPTIONS=--import=<this file> (regress.test.js only). It answers the two public
// documents the SAI Cloud health probe fetches from https://portal.test, so PORTAL_ONLY can be exercised for real
// (enforced against a healthy provider) without any network. Everything else goes to the real fetch.
const real = globalThis.fetch;
const ISSUER = 'https://portal.test';
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === ISSUER + '/.well-known/openid-configuration') {
    return json({ issuer: ISSUER, authorization_endpoint: ISSUER + '/oidc/authorize', token_endpoint: ISSUER + '/oidc/token', jwks_uri: ISSUER + '/oidc/jwks',
      id_token_signing_alg_values_supported: ['ES256'], code_challenge_methods_supported: ['S256'] });
  }
  if (u === ISSUER + '/oidc/jwks') return json({ keys: [{ kty: 'EC', crv: 'P-256', x: 'test-x', y: 'test-y', kid: 'k1', use: 'sig', alg: 'ES256' }] });
  return real(url, init);
};
