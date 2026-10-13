import fs from 'fs';

/**
 * GET /sai-suite.js: the SAI Cloud app switcher (the CUSTOMER bundle of sai-cluster/manifests/_suite,
 * built into public/ by deploy.sh before the image build; Vite copies it into public/dist). It is
 * ALWAYS JavaScript or a plain 404, never the SPA's index.html: a script tag that receives HTML is a
 * syntax error in the console and, worse, hides a missing build. The first existing candidate wins.
 * Not fingerprinted, so a short cache: a catalogue change reaches the page with the next deploy.
 * CSP: the customer bundle needs only script-src 'self' and style-src 'unsafe-inline' (it never
 * fetches the Suite and never frames a dock), both already in this server's policy.
 */
export function suiteScriptHandler(candidates) {
  return (req, res) => {
    const file = candidates.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    if (!file) {
      res.status(404).type('text/plain').send('sai-suite.js is not part of this build');
      return;
    }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };
}
