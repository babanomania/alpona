# Plan 003: Refuse to boot the auth overlay with the documented placeholder JWT secret

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 06ebd68..HEAD -- deploy/ packages/server/src/auth/middleware.ts packages/server/src/env.ts`
> If `deploy/docker-compose.auth.yml` or `deploy/.env.example` changed
> since this plan was written, re-read them and compare against the
> "Current state" excerpts before continuing.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (refuses-to-boot is a hard fail — easier to debug than a
  silent compromised default)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `06ebd68`, 2026-06-17

## Why this matters

`deploy/docker-compose.auth.yml` defaults the JWT secret to the literal
string `dev-only-change-me-a-long-random-secret` if `ALPONA_JWT_SECRET` is
unset. The same string is in two places (lines 29 and 44) and is the value
GoTrue uses to sign tokens AND the value the Alpona server uses to verify
them. README.md:46-50 walks users through:

```
cd deploy && cp .env.example .env && docker compose up
```

`deploy/.env.example:42` ships `ALPONA_JWT_SECRET=` empty. A user who
follows the README literally — copies the example, doesn't fill in the
secret, then later adds the auth overlay because they want login — gets a
production deployment signed by a string committed to a public repo.
Anyone with access to the docker-compose file (i.e. the whole internet)
can mint valid HS256 tokens for any user.

The fix is straightforward: refuse to start the auth services without an
explicit, non-placeholder secret, and document how to generate one. This
is a documented-default-to-fail-fast change.

## Current state

### `deploy/docker-compose.auth.yml`

The relevant lines (`deploy/docker-compose.auth.yml:13-49`):

```yaml
services:
  auth:
    image: supabase/gotrue:v2.189.0
    ...
    environment:
      ...
      DATABASE_URL: postgres://supabase_admin:${POSTGRES_PASSWORD:-alpona-super-secret}@db:5432/alpona?search_path=auth
      ...
      # The shared HS256 secret — Alpona verifies tokens with the same one.
      GOTRUE_JWT_SECRET: ${ALPONA_JWT_SECRET:-dev-only-change-me-a-long-random-secret}
      GOTRUE_JWT_ISSUER: alpona
      ...

  alpona:
    environment:
      AUTH_MODE: oidc
      OIDC_ISSUER: alpona
      OIDC_AUDIENCE: authenticated
      ALPONA_JWT_SECRET: ${ALPONA_JWT_SECRET:-dev-only-change-me-a-long-random-secret}
      ALPONA_AUTH_UPSTREAM: http://auth:9999
    depends_on:
      auth:
        condition: service_started
```

### `deploy/.env.example`

The relevant lines (`deploy/.env.example:33-42`):

```dotenv
# (b) Real Supabase Auth (login screen + per-user dashboards). Add the
#     auth overlay AND set a strong shared secret — DO NOT ship the
#     default. Generate one with:  openssl rand -hex 32
#
#   docker compose -f docker-compose.yml -f docker-compose.auth.yml up
#
#   Then provision the first user (no public signup, by design):
#   ALPONA_AUTH_URL=http://localhost:3001/auth/v1 ALPONA_JWT_SECRET=$ALPONA_JWT_SECRET \
#     pnpm alpona user add you@example.com
ALPONA_JWT_SECRET=
```

The README does call this out (`README.md:47-50`) — but the documented
default is still the dangerous one. The right hierarchy is: compose
**refuses to boot** without a real secret, and the error tells the user
exactly how to make one.

### Project conventions for compose env hygiene

- Database passwords already use the same `${VAR:-default}` pattern
  (`docker-compose.yml:16-18`): `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-alpona-super-secret}`
  etc. Those defaults are arguably also risky for production, but they
  are scoped to a service that is only published on `5433` and used by
  the local Alpona container — out of scope here. Keep this plan tight
  on the JWT secret.
- The CLI prints `✗` on hard fails and exits non-zero (CLI commands at
  `packages/alpona-cli/src/cli.ts:322` use `process.exit(1)`).

## Commands you will need

| Purpose                              | Command                                                                       | Expected                                  |
|--------------------------------------|-------------------------------------------------------------------------------|-------------------------------------------|
| Lint / format                        | `pnpm lint && pnpm format:check`                                              | exit 0                                    |
| Compose parse                        | `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.auth.yml config -q` | exit 0 with vars set; exit 1 unset        |
| Manual boot smoke (with real secret) | See step 4                                                                    | services start; login works              |
| Manual boot fail (unset secret)      | See step 4                                                                    | compose refuses to start with clear msg   |

You need Docker installed locally to verify step 4. If Docker is not
available, document this in your final report and run only the static
checks (steps 1–3).

## Scope

**In scope** (the only files you should modify):
- `deploy/docker-compose.auth.yml`
- `deploy/.env.example`
- `README.md` (only the deploy paragraph at lines 42-50 if needed; do not
  rewrite the file)

**Out of scope** (do NOT touch):
- `deploy/docker-compose.yml` — the `POSTGRES_PASSWORD` and friends are a
  separate hardening concern. Mention them in the maintenance notes only.
- `packages/server/src/auth/middleware.ts` — the server already rejects
  unknown AUTH_MODE values and requires a secret/issuer
  (`middleware.ts:97-99`); the issue is compose providing a fake secret,
  not server logic.
- `packages/alpona-cli/src/commands/users.ts` — the CLI errors when
  `ALPONA_JWT_SECRET` is unset (`users.ts:31-32`); leave it alone.

## Git workflow

- Branch: `advisor/003-no-default-jwt-secret`
- Commit message style (matches repo log):
  `fix(deploy): refuse to boot the auth overlay with the placeholder JWT secret`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the default from both compose env lines

Edit `deploy/docker-compose.auth.yml`. Change line 29 from:

```yaml
      GOTRUE_JWT_SECRET: ${ALPONA_JWT_SECRET:-dev-only-change-me-a-long-random-secret}
```

to:

```yaml
      # No default on purpose: compose interpolates "" when ALPONA_JWT_SECRET
      # is unset, which makes GoTrue refuse to start (HS256 needs a key) —
      # the visible error guides the user to generate one. See .env.example.
      GOTRUE_JWT_SECRET: ${ALPONA_JWT_SECRET:?set ALPONA_JWT_SECRET — see deploy/.env.example}
```

Make the same change at line 44:

```yaml
      ALPONA_JWT_SECRET: ${ALPONA_JWT_SECRET:?set ALPONA_JWT_SECRET — see deploy/.env.example}
```

The `${VAR:?error message}` form is a compose-native validation: it
prints `error message` and exits non-zero if the variable is unset or
empty. The text after the `?` is shown verbatim to the user.

**Verify**:
- With `ALPONA_JWT_SECRET` unset:
  `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.auth.yml config -q`
  must exit non-zero and print a message that contains
  `set ALPONA_JWT_SECRET — see deploy/.env.example`.
- With `ALPONA_JWT_SECRET=anything-non-empty docker compose … config -q`
  must exit 0.

If Docker isn't available, run `grep -n 'dev-only-change-me' deploy/`
and confirm zero matches.

### Step 2: Tighten `deploy/.env.example`

Edit `deploy/.env.example`. Replace the `ALPONA_JWT_SECRET=` block (lines
33-42) with content that makes the requirement unambiguous when
auth-overlay use is intended. The block becomes:

```dotenv
# (b) Real Supabase Auth (login screen + per-user dashboards). Add the
#     auth overlay AND set a strong shared secret — the overlay refuses
#     to boot without one. Generate it with:
#
#       openssl rand -hex 32
#
#     Then run:
#
#       docker compose -f docker-compose.yml -f docker-compose.auth.yml up
#
#     and provision the first user (no public signup, by design):
#       ALPONA_AUTH_URL=http://localhost:3001/auth/v1 \
#       ALPONA_JWT_SECRET=$ALPONA_JWT_SECRET \
#         pnpm alpona user add you@example.com
ALPONA_JWT_SECRET=
```

Notable: keep the line `ALPONA_JWT_SECRET=` empty so a user who copies
the example to `.env` is forced to fill it. The compose `${VAR:?…}` will
treat empty the same as unset.

**Verify**: `grep -c 'dev-only-change-me' deploy/.env.example` returns 0.

### Step 3: Make sure `README.md`'s deploy paragraph still reads correctly

`README.md:46-50` currently says:

> To enable login and per-user dashboards, set `ALPONA_JWT_SECRET` and
> run both compose files. Full setup is in the deploy docs.

That sentence is already accurate, so no edit is strictly required. If
you do edit it, only adjust the wording — do NOT remove the link to
deploy docs, and do NOT add a default value in the README.

**Verify**: `git diff README.md` is either empty or contains only minor
wording tweaks (no new secrets, no removed link).

### Step 4: End-to-end smoke (requires Docker)

If Docker is available locally, run:

1. Without setting the secret:
   ```
   cd deploy
   unset ALPONA_JWT_SECRET
   docker compose -f docker-compose.yml -f docker-compose.auth.yml up --no-start
   ```
   Expected: compose exits non-zero with the configured error string.

2. With a generated secret:
   ```
   export ALPONA_JWT_SECRET="$(openssl rand -hex 32)"
   docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d
   # wait for health
   for i in $(seq 1 30); do curl -fs localhost:3001/api/health && break || sleep 1; done
   curl -fs localhost:3001/api/health | grep '"auth":"oidc"'
   docker compose down
   unset ALPONA_JWT_SECRET
   ```
   Expected: `/api/health` reports `"auth":"oidc"`; `down` cleans up.

If Docker is not available, skip step 4 and note "Docker-side smoke
deferred to reviewer" in the maintenance notes.

## Test plan

This is a deploy-config change; the existing test suite already covers
the server-side auth middleware behaviour (`packages/server/test/auth.test.ts`).

- Existing tests must still pass: `pnpm test` → 16 files, 129 tests pass.
- No new unit tests are warranted (compose syntax is not test code).
- Docker-side smoke as above when available.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn 'dev-only-change-me' deploy/ README.md` returns no
      matches
- [ ] `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.auth.yml config -q`
      with `ALPONA_JWT_SECRET` unset exits non-zero
- [ ] `ALPONA_JWT_SECRET=test docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.auth.yml config -q`
      exits 0
- [ ] `pnpm test` exits 0; 129 tests pass
- [ ] `pnpm lint && pnpm format:check` exit 0
- [ ] `git diff --name-only` shows only `deploy/docker-compose.auth.yml`
      and `deploy/.env.example` (and optionally a minor README tweak)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The compose files have been restructured to source the secret from a
  Docker secret or external secret manager — that's a better fix and
  this plan is moot; report and let the reviewer close it.
- The `${VAR:?msg}` syntax is rejected by the installed Docker Compose
  version — that would be Compose < 1.27, which is below the project's
  supported floor. Report the local Compose version and stop.
- README.md no longer mentions deploy/.env.example — there may be a
  separate docs PR in flight; coordinate before changing the README.

## Maintenance notes

- The same hardening pattern (`${VAR:?…}`) should be applied to
  `POSTGRES_PASSWORD`, `ALPONA_DB_PASSWORD`, and `ALPONA_READER_PASSWORD`
  in `deploy/docker-compose.yml:16-18`. Those defaults
  (`alpona-super-secret`, `alpona`, `alpona_reader`) are also published
  and pose a similar risk for someone who exposes port 5433. Out of scope
  here — file as a follow-up plan.
- A reviewer should test the unset-secret path on their machine — Docker
  behaviour around interactive vs daemon mode can mask compose validation
  failures.
- Anyone running deployments today with the placeholder secret has a
  forge-any-token risk; advise rotation immediately and audit any tokens
  signed before the rotation (revoke or accept that they expire on the
  current `GOTRUE_JWT_EXP: '3600'` ceiling).
