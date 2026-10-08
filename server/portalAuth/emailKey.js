// A normalised form of an email, used ONLY to DETECT that two spellings might belong to one person
// ("ada+books@x.com", "a.da@gmail.com" vs "ada@gmail.com"). It is never used to match, link or sign anyone in:
// guessing that two addresses are the same mailbox is an attack surface, so linking stays on the exact
// (case-insensitive) email. The same rule is written in SQL in UserRepository.findUsersByEmailKey; the PG test
// pins the two together.
//
//   lower-case; drop a "+tag" from the local part; on gmail.com / googlemail.com also drop the dots and
//   treat googlemail.com as gmail.com (Gmail ignores both).
const GMAIL = new Set(['gmail.com', 'googlemail.com']);

export function emailKey(email) {
  const s = String(email || '').trim().toLowerCase();
  const at = s.indexOf('@');
  if (at < 1) return s;
  let local = s.slice(0, at).split('+')[0];
  let domain = s.slice(at + 1);
  if (GMAIL.has(domain)) { local = local.replace(/\./g, ''); domain = 'gmail.com'; }
  return local + '@' + domain;
}
