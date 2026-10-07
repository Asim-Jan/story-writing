// Pre-enable check for Sign in with SAI Cloud: prints COUNTS ONLY, never an email, a name or an id.
//
//   inside the backend pod (the image carries server/ only):   node server/portalAuth/duplicateEmails.js
//   from a checkout with POSTGRES_* in the environment:         node scripts/check-duplicate-emails.js
//
// Case-duplicate accounts ("Ada@x.com" and "ada@x.com") must be 0 before the feature is turned on: with two matching
// accounts nobody can tell which one a SAI Cloud sign-in belongs to, so the app refuses to link either.
// Exit code 0 = no duplicate groups, 1 = duplicates found, 2 = could not query.
import { fileURLToPath } from 'url';
import { UserRepository } from '../db/repositories/UserRepository.js';

export function formatCounts(c) {
  return [
    `users (not deleted):                 ${c.users}`,
    `duplicate lower(email) groups:       ${c.duplicateGroups}   (accounts inside them: ${c.accountsInDuplicateGroups})`,
    `users already linked to SAI Cloud:   ${c.linked}`,
    c.duplicateGroups === 0 ? 'RESULT: OK, no duplicate email groups' : 'RESULT: BLOCKED, merge or remove the duplicate accounts first',
  ].join('\n');
}

export async function run({ counts = () => UserRepository.emailAuditCounts(), out = console.log } = {}) {
  const c = await counts();
  out(formatCounts(c));
  return c.duplicateGroups === 0 ? 0 : 1;
}

/** The command-line entry: query, print, close the pool, exit with the code. */
export async function main() {
  try {
    const code = await run();
    try { const { getPool } = await import('../db/postgres.js'); await getPool().end(); } catch { /* nothing to close */ }
    process.exit(code);
  } catch (e) {
    console.error('could not count users:', e.code || e.message);
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
