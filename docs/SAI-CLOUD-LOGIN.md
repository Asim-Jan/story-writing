# Sign in with SAI Cloud (OpenID Connect client)

Stories can sign people in through SAI Cloud (the portal at `https://solutionsai.co.uk`) instead of its own email +
password. Everything is behind `PORTAL_OIDC=1` and is **off by default**: deploying this code changes nothing until the
flag is set. The operator runbook (Secrets, order of steps, rollback, NetworkPolicy) lives with the deployment manifests
in `Solutions-AI-LTD/story-writing` (`STORIES-SAI-CLOUD.md`); this page is the code-level description.

## How it works

* `server/vendor/sai-auth-client/index.cjs` is the zero-dependency OIDC client (code flow + PKCE S256, ES256 ID tokens,
  RFC 9207 `iss` check, verified-email enforcement). It is a **vendored copy** of `manifests/_auth-client/index.js` from
  `Solutions-AI-LTD/sai-cluster`; the header records the source commit. Re-copy with `scripts/sync-auth-client.sh [path-to-sai-cluster]`.
  `server/portalAuth/tests/vendor-drift.test.js` fails if the copy drifts (set `SAI_CLUSTER_DIR` to a checkout).
* `server/portalAuth/` is the Stories side: `config.js` (env), `accounts.js` (which Stories user is this identity),
  `store.js` (Postgres), `routes.js` (HTTP).
* Routes: `GET /auth/portal/login`, `GET /auth/portal/callback`, `POST /auth/portal/logout`,
  `GET /api/auth/portal/config`, `POST /api/auth/portal/session`, `GET|POST /api/auth/portal/link*`.
  SPA pages: `/auth/portal/done`, `/auth/portal/link`, `/auth/portal/error`.
* After the callback Stories issues the **same JWT** the password login does (cookie `token`, HttpOnly, Secure, SameSite=Lax),
  but valid for **24 hours** instead of 7 days. The SPA still keeps its copy in localStorage (dozens of components read it),
  collected from `POST /api/auth/portal/session`, which works in the first two minutes after a portal sign-in and **once**: the
  session's `jti` is consumed server-side (Redis `SET NX` when connected, else this process), the second call is `410`.

## Account linking (keyed on `sub`, never on the email)

Migration `z106_portal_identity.sql` adds `users.portal_sub` (nullable, UNIQUE) and `portal_linked_at`. On the callback:

1. A user with this `portal_sub` -> signed in. The email is not consulted (it may have changed at the portal).
2. Else the Stories users with the same email (case-insensitive):
   * **more than one** (case-duplicate accounts) -> refused with a "contact support" page, nothing linked; the log carries an
     operator hint (no address). Check before enabling: `node server/portalAuth/duplicateEmails.js` (counts only, exit 1 if any);
   * already linked to a different `sub` -> refused (`linked_elsewhere`), never re-linked;
   * Stories email verified **and** the portal says `email_verified` **and** not an admin -> linked, signed in. **The link
     bumps `token_version` (every older JWT dies) and replaces the local password by one nobody knows**: whoever pre-registered
     that address (it was unverified until the real owner verified it) keeps neither a session nor a password. The person signs
     in with SAI Cloud; "Forgot password" gives them a password again if they want one;
   * otherwise (Stories email unverified, or an admin account) -> nobody is signed in or linked; the person must enter the
     **old Stories password once** (rate-limited, uniform error), which links the account, marks its email verified and bumps
     `token_version` (the password stays). Forgotten it? "Forgot password" works for accounts without a link, and a successful
     reset by the emailed link marks the Stories email verified, so the next SAI Cloud sign-in links by itself.
3. Else a new `free` user is created, linked, email verified: unless `SIGNUPS_CLOSED=1` (own page), unless the Stories
   registration limiter (3 per hour per IP, the same counter as `POST /api/auth/register`) is spent (`rate_limited`), and unless an
   a **verified or already SAI Cloud-linked** account exists under **another spelling** of the address (plus-tag, Gmail dots: a normalised key,
   `emailKey.js`) -> a "you may already have a Stories account under another spelling" page and nothing is created. An **unverified** lookalike
   does not count: anyone can register `name+x@gmail.com` without owning a mailbox, and that must not lock the real owner out of their
   sign-up. The key only detects; matching to link stays exact.

A Stories `user_id` and every book under it are untouched in every path. A SAI Cloud account whose email is not verified at
the portal cannot sign in at all (`email_unverified` page).

## Environment

| Variable | Meaning |
|---|---|
| `PORTAL_OIDC` | `1` turns the feature on (default off) |
| `PORTAL_ISSUER` | default `https://solutionsai.co.uk` |
| `PORTAL_CLIENT_ID` | default `stories` |
| `PORTAL_CLIENT_SECRET` | from a Secret, never the repo |
| `PORTAL_SESSION_SECRET` | >= 32 random bytes, signs the sign-in and linking cookies |
| `PORTAL_REDIRECT_URI` | default `<APP_URL>/auth/portal/callback` (registered at the portal byte for byte) |
| `PORTAL_POST_LOGOUT_URI` | default `<APP_URL>/` |
| `PORTAL_ONLY` | `1` REQUESTS the cutover; see "PORTAL_ONLY" below: enforced only while the portal is healthy, never against admins |
| `SIGNUPS_CLOSED` | `1` refuses new accounts (local and SAI Cloud) |

A mistake with `PORTAL_OIDC=1` (missing secret, bad URL) leaves the feature off and the pod up; the reason is in the log and
under `services.portalAuth` on `/api/health`.

## PORTAL_ONLY

`PORTAL_ONLY=1` refuses local sign-up, sign-in and password reset, but only while it can be trusted:

* **Provider health.** A background probe (every 60 s, 5 s timeout, never inside a request) fetches the portal's discovery document
  and key set. PORTAL_ONLY is enforced while both were fetched OK within the last **10 minutes**. Before the first success (just booted)
  and when the portal is unreachable, local password sign-in stays available; `/api/auth/portal/config` says `only:false` and
  `/api/health` (`services.portalAuth`) shows `providerHealthy:false` and a note.
* **Admins are never locked out.** An admin account can always sign in (and reset) with its password: break-glass. Side effect: under
  PORTAL_ONLY a non-admin gets `403` where an admin gets the normal `401`, so admin addresses can be told apart.
* **Accounts without a SAI Cloud link** can still use "forgot password" / reset (reset-then-link); linked accounts get the same generic
  answer as an unknown address and no mail.
* **What the probe cannot see:** a wrong client secret, a redirect URI that is not registered at the portal, or a client disabled there.
  Those only fail at the token step of a real sign-in. **Keep PORTAL_ONLY off until a real round trip has worked for every person**
  and the admin break-glass path has been tried.

## Known limits

* **No `verified_at`.** `users` has only the boolean `email_verified` (no timestamp), so a "verified" Stories email cannot be aged out:
  an old verification is trusted as it is. The mitigations are above: an automatic link kills older sessions and the old password. If a
  `verified_at` column is ever added, automatic linking should refuse a verification older than a year.
* API keys an account created before it was linked keep working (they are not tied to `token_version`); review them for any account that
  was pre-registered by someone else.

## Tests

* `npm run test:portal` (node:test, no network): account rules, the review fixes (`review-fixes.test.js`), routes over real HTTP against a fake provider that signs real
  ES256 ID tokens, config, the vendored client's own tests, and the vendor drift check. `migration.pg.test.js` needs a throwaway
  Postgres (`PORTAL_TEST_PG_HOST=127.0.0.1` ...) and is skipped otherwise.
* `npm run test:regress` also boots the real server with the feature off, on, `PORTAL_ONLY`, and misconfigured.

## Limits

No back-channel logout yet: signing out of SAI Cloud (or revoking the account there) does not end a Stories session; it
ends when the 24 hour token expires. Per-user API metering through SAI Cloud is not part of this.
