# Plan 004: Bind the per-client rate-limit key to the authenticated subject (not a spoofable header)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 06ebd68..HEAD -- packages/server/src/app.ts packages/server/src/query/rate-limit.ts packages/server/test/auth.test.ts`
> If any of those files changed, re-read them and compare against the
> "Current state" excerpts before continuing.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independent of plans 001-003; logically depends
  on 001 only to verify against a green typecheck)
- **Category**: security
- **Planned at**: commit `06ebd68`, 2026-06-17

## Why this matters

The `/api/query` endpoint is rate-limited per "session key". The current
key derivation in `packages/server/src/app.ts:215-219` is:

```ts
const sessionKey =
  c.req.header('x-alpona-session') ?? c.req.header('x-forwarded-for') ?? 'local';
if (!limiter.take(sessionKey)) {
  return c.json({ error: 'rate limit exceeded — slow down' }, 429);
}
```

Both headers are client-controlled. A caller that rotates either header
gets a fresh token bucket every request, defeating the limiter. Without a
trusted-proxy convention (and Alpona deploys both same-origin behind the
server itself and behind arbitrary front-ends), this is effectively
"please don't bypass me".

The fix is to derive the key from the authenticated subject — which Hono
already sets on every request in the auth middleware (`c.set('user', …)`
in `packages/server/src/auth/middleware.ts:76, 91, 130`). That subject is
either a real OIDC `sub`, the string `'apikey'`, or `'anonymous'`. For
`none` mode (playground), keep a single shared bucket — the playground is
single-user-ish and the limit's job there is to keep a runaway script from
hammering the DB, not to isolate users.

## Current state

### `packages/server/src/app.ts:215-239`

```ts
app.post('/api/query', async (c) => {
  const sessionKey =
    c.req.header('x-alpona-session') ?? c.req.header('x-forwarded-for') ?? 'local';
  if (!limiter.take(sessionKey)) {
    return c.json({ error: 'rate limit exceeded — slow down' }, 429);
  }

  let request: QueryRequest;
  try {
    request = (await c.req.json()) as QueryRequest;
    if (typeof request.sql !== 'string') return c.json({ error: 'sql is required' }, 400);
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  try {
    const result = await deps.queryService.run(request.sql, request.params ?? {});
    return c.json(result);
  } catch (err) {
    if (err instanceof SqlRejectedError) {
      return c.json({ error: `query rejected: ${err.message}`, reason: err.reason }, 422);
    }
    return c.json({ error: err instanceof Error ? err.message : 'query failed' }, 500);
  }
});
```

### How `c.get('user')` is populated

`packages/server/src/auth/middleware.ts`:

- mode `none`, line 76: `c.set('user', { sub: 'anonymous' } …)`
- mode `apikey`, line 91: `c.set('user', { sub: 'apikey' } …)`
- mode `oidc`, line 130: `c.set('user', { sub: String(payload.sub ?? 'unknown'), email: … } …)`

The auth middleware runs on every `/api/*` route (`app.ts:75`), so by the
time `/api/query` executes `c.get('user').sub` is always set.

### Rate limiter implementation — `packages/server/src/query/rate-limit.ts:1-29`

Token bucket, per-key, refilling at 10/s up to 30. No changes needed to
this file.

### Existing tests

`packages/server/test/auth.test.ts:1-58` covers the auth middleware modes
with a spy app — exactly the pattern this plan reuses. No rate-limit
test exists today; this plan adds one.

### Project conventions

- The server's security tests carry the comment "Security tests — these
  gate credentials handling and must never be weakened to make a feature
  pass." (`auth.test.ts:9-11`). Mirror that tone in any new test file.
- `c.get('user')` is accessed in `app.ts` via the typed `viewer`
  helper at line 169:
  `const viewer = (c: { get: (key: 'user') => { sub: string } }) => c.get('user').sub;`
  Reuse this helper or extract a similar one.

## Commands you will need

| Purpose                | Command                                                     | Expected on success         |
|------------------------|-------------------------------------------------------------|-----------------------------|
| Typecheck              | `pnpm typecheck`                                            | exit 0                      |
| Tests (all)            | `pnpm test`                                                 | 16 files, 129 + N tests pass|
| Tests (server only)    | `pnpm --filter @alpona/server test`                         | all pass                    |
| Lint / format          | `pnpm lint && pnpm format:check`                            | exit 0                      |

## Scope

**In scope** (the only files you should modify):
- `packages/server/src/app.ts` — the key derivation in `/api/query`
- `packages/server/test/rate-limit.test.ts` — a new test (small)
- Optionally `packages/server/src/query/rate-limit.ts` if you need to
  expose `now` or accept an injected clock for the test (skip unless
  required — the existing constructor already accepts `now: () => number`)

**Out of scope** (do NOT touch):
- The token-bucket capacity/refill numbers — tuning those is a separate
  decision.
- Any other route's rate handling (`/api/generate` does not currently
  rate-limit — that's a separate concern, see maintenance notes).
- The `x-alpona-session` and `x-forwarded-for` headers themselves; do not
  remove their reception elsewhere if other code reads them (`grep` first
  — they should not be read elsewhere, but verify).

## Git workflow

- Branch: `advisor/004-rate-limit-by-subject`
- Commit style: `fix(server): rate-limit by auth subject, not spoofable headers`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the spoofable key with the auth subject

Edit `packages/server/src/app.ts`. The `/api/query` handler currently
starts at line 215. Replace lines 215-219:

```ts
app.post('/api/query', async (c) => {
  const sessionKey =
    c.req.header('x-alpona-session') ?? c.req.header('x-forwarded-for') ?? 'local';
  if (!limiter.take(sessionKey)) {
    return c.json({ error: 'rate limit exceeded — slow down' }, 429);
  }
```

with:

```ts
app.post('/api/query', async (c) => {
  // Rate-limit per authenticated subject. In `none` mode every request
  // is 'anonymous' — a single shared bucket, by design. Client-supplied
  // headers were the previous key; they are trivially spoofable.
  const sessionKey = c.get('user').sub;
  if (!limiter.take(sessionKey)) {
    return c.json({ error: 'rate limit exceeded — slow down' }, 429);
  }
```

Confirm no other reference to `x-alpona-session` or `x-forwarded-for`
remains in the server: `grep -rn 'x-alpona-session\|x-forwarded-for' packages/server/src/`
should return zero matches.

**Verify**:
- `pnpm typecheck` exits 0
- `grep -rn 'x-alpona-session\|x-forwarded-for' packages/server/src/` is empty

### Step 2: Add a focused rate-limit test that proves the fix

Create `packages/server/test/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware, type AuthUser } from '../src/auth/middleware.js';
import { RateLimiter } from '../src/query/rate-limit.js';

/**
 * Security tests — the rate limit gates abuse of /api/query and must
 * never be weakened to make a feature pass.
 */

type AppEnv = { Variables: { user: AuthUser } };

function appWith(authMode: 'none' | 'apikey', limiter: RateLimiter) {
  const app = new Hono<AppEnv>();
  app.use(
    '/api/*',
    createAuthMiddleware(
      authMode === 'apikey' ? { mode: 'apikey', apiKey: 'sk-test' } : { mode: 'none' },
    ),
  );
  app.post('/api/query', async (c) => {
    const sessionKey = c.get('user').sub;
    if (!limiter.take(sessionKey)) return c.json({ error: 'rate limit exceeded' }, 429);
    return c.json({ ok: true });
  });
  return app;
}

describe('rate limit is keyed on auth subject', () => {
  it('cannot be bypassed by varying x-forwarded-for in none mode', async () => {
    // capacity 1, refill 0 — a single request, then deny.
    const limiter = new RateLimiter(1, 0);
    const app = appWith('none', limiter);
    const first = await app.request('/api/query', { method: 'POST' });
    expect(first.status).toBe(200);
    const spoofed = await app.request('/api/query', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.99' },
    });
    expect(spoofed.status).toBe(429);
    const spoofed2 = await app.request('/api/query', {
      method: 'POST',
      headers: { 'x-alpona-session': 'whatever' },
    });
    expect(spoofed2.status).toBe(429);
  });

  it('isolates buckets between two apikey subjects', async () => {
    // Note: apikey mode collapses every caller into sub='apikey', so two
    // calls share a bucket. That is the documented trade-off — the test
    // pins it so a future "per-key bucket" refactor changes this test
    // intentionally rather than silently.
    const limiter = new RateLimiter(1, 0);
    const app = appWith('apikey', limiter);
    const a = await app.request('/api/query', {
      method: 'POST',
      headers: { authorization: 'Bearer sk-test' },
    });
    expect(a.status).toBe(200);
    const b = await app.request('/api/query', {
      method: 'POST',
      headers: { authorization: 'Bearer sk-test' },
    });
    expect(b.status).toBe(429);
  });
});
```

**Verify**: `pnpm --filter @alpona/server test` includes
`rate-limit.test.ts` and the two tests pass.

### Step 3: Re-run the full guardrails

- `pnpm typecheck` → exit 0
- `pnpm test` → exit 0; total test count is the previous 129 plus the 2
  new tests (so 131)
- `pnpm lint` → exit 0
- `pnpm format:check` → exit 0

## Test plan

Covered by the new file in step 2:

- Happy path: a single request succeeds in `none` mode.
- Regression test for the bug: rotating `x-forwarded-for` AND
  `x-alpona-session` no longer earns a fresh bucket.
- Documented behaviour pin: `apikey` mode shares one bucket across all
  callers (because every authed request sets `sub: 'apikey'`). This is
  by design; the test makes that intent visible.

Run the existing security tests in `packages/server/test/auth.test.ts`
too — they exercise the same middleware path and must keep passing.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn 'x-alpona-session\|x-forwarded-for' packages/server/src/`
      returns no matches
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; new file `rate-limit.test.ts` contributes the
      two new passing tests
- [ ] `pnpm lint && pnpm format:check` exit 0
- [ ] `git diff --name-only` shows only `packages/server/src/app.ts` and
      `packages/server/test/rate-limit.test.ts`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `c.get('user').sub` is not populated when `/api/query` runs (e.g. the
  auth middleware ordering changed and the route runs before
  `app.use('/api/*', createAuthMiddleware(auth))`). That would be a
  bigger middleware-ordering issue — flag it and stop.
- The new test fails because Hono's `app.request` does not propagate
  `c.get('user').sub` in unit-test mode — check the Hono version
  (`pnpm why hono` in `packages/server`); 4.12.x supports this. If a
  version skew makes the test infeasible, report rather than mocking
  around it.
- You discover a second caller of the rate limiter (e.g. on
  `/api/generate`) that this plan would silently change. The plan is
  scoped to `/api/query`; surface the second site and stop.

## Maintenance notes

- `/api/generate` is currently not rate-limited at all
  (`app.ts:108-138`). A future plan should add the same per-subject
  bucket there — it's a more expensive endpoint and a better DoS target.
  Out of scope here because adding limiter coverage there changes the
  SSE response shape (need a 429 streamed appropriately).
- `apikey` mode shares a single bucket across all callers because every
  authed request gets `sub='apikey'`. If you ever support multiple API
  keys, key the bucket on the key's identifier (e.g. a SHA-256 prefix of
  the key, never the key itself).
- A reviewer should scrutinise that the `c.get('user').sub` access is
  type-safe (no `@ts-ignore`) and that no test was added that relies on
  the old header-based behaviour.
- `x-forwarded-for` may still be useful for *logging* (which actual IP
  hit us behind a trusted proxy). That's a separate concern; do not
  reintroduce it for rate-limit purposes.
