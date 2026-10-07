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
  collected once from `POST /api/auth/portal/session`, which only works in the first two minutes after a portal sign-in.

## Account linking (keyed on `sub`, never on the email)

Migration `z106_portal_identity.sql` adds `users.portal_sub` (nullable, UNIQUE) and `portal_linked_at`. On the callback:

1. A user with this `portal_sub` -> signed in. The email is not consulted (it may have changed at the portal).
2. Else an existing Stories user with the same email:
   * already linked to a different `sub` -> refused (`linked_elsewhere`), never re-linked;
   * Stories email verified **and** the portal says `email_verified` **and** not an admin -> linked, signed in;
   * otherwise (Stories email unverified, or an admin account) -> nobody is signed in or linked; the person must enter the
     **old Stories password once** (rate-limited, uniform error), which links the account and marks its email verified.
3. Else a new `free` user is created, linked, email verified (unless `SIGNUPS_CLOSED=1`: refused with its own page).

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
| `PORTAL_ONLY` | `1` disables local password sign-up, sign-in and reset. Ignored unless SAI Cloud sign-in is actually working |
| `SIGNUPS_CLOSED` | `1` refuses new accounts (local and SAI Cloud) |

A mistake with `PORTAL_OIDC=1` (missing secret, bad URL) leaves the feature off and the pod up; the reason is in the log and
under `services.portalAuth` on `/api/health`.

## Tests

* `npm run test:portal` (node:test, no network): account rules, routes over real HTTP against a fake provider that signs real
  ES256 ID tokens, config, the vendored client's own tests, and the vendor drift check. `migration.pg.test.js` needs a throwaway
  Postgres (`PORTAL_TEST_PG_HOST=127.0.0.1` ...) and is skipped otherwise.
* `npm run test:regress` also boots the real server with the feature off, on, `PORTAL_ONLY`, and misconfigured.

## Limits

No back-channel logout yet: signing out of SAI Cloud (or revoking the account there) does not end a Stories session; it
ends when the 24 hour token expires. Per-user API metering through SAI Cloud is not part of this.
