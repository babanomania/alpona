# Plan 006: Make the source switcher actually switch sources

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 06ebd68..HEAD -- packages/server/src/main.ts packages/server/src/app.ts packages/studio/src/App.tsx packages/studio/src/app.css packages/server/src/env.ts`
> If any of those files changed, re-read them and compare against the
> "Current state" excerpts before continuing.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — the server's active source is captured at construction;
  the swap touches the `QueryService`, the agent, and the dictionary, and
  must keep the playground-mode CI invariant green (CLAUDE.md §1.3).
- **Depends on**: 001 (green typecheck baseline)
- **Category**: direction (closes PLAN.md §3.15 gap)
- **Planned at**: commit `06ebd68`, 2026-06-17

## Why this matters

PLAN.md §3.15 calls for a source switcher in the studio's home behaviour:

> source switcher (from `/sources`; user sources rank above samples; samples
> collapse once a user source exists) …

The server already publishes `GET /api/sources`
(`packages/server/src/app.ts:155`) and the CLI's `alpona connect` adds
entries to `.alpona/sources.json`
(`packages/alpona-cli/src/commands/connect.ts:81-92`). The studio reads
the list (`App.tsx:77-80`) and renders a topbar pill — but the pill is
read-only: `App.tsx:139-153` shows `sources[0].name` and a `+N` badge,
with no UI to pick a different source. Today, the only way to change the
active source is to restart the server with a different
`ALPONA_DB`/`ALPONA_SOURCE_NAME`. PLAN.md treats this as a gap; closing
it makes the multi-source story real for "bring your own data" users
(decision D6).

This plan covers the smallest honest version: a popover with a source
list and an in-process hot swap of the active source's adapter +
dictionary + executor + agent. No persistence beyond what
`.alpona/sources.json` already records — restarting the server returns to
the boot-default source (set by `ALPONA_SOURCE_NAME`).

## Current state

### Server boot (`packages/server/src/main.ts:1-145`)

The active source is fixed at construction:

- `config.db` is read once into `adapter`
  (`main.ts:39: const adapter = await createAdapter(config.db)`).
- `dictionary` is loaded once from `config.dictionaryPath`
  (`main.ts:28-37`).
- `queryService = new QueryService(adapter, dictionary, …)`
  (`main.ts:40-43`).
- `agent = new AlponaAgent({ backend, dictionary, executor: queryService })`
  (`main.ts:120`).
- `sources` is the registry plus the active source as `sources[0]`
  (`main.ts:82-100`).

Today, switching means restarting the process with a new `ALPONA_DB`.

### Sources registry (`packages/alpona-cli/src/commands/connect.ts:42-93`)

`alpona connect` writes one entry per source into `.alpona/sources.json`:

```json
{
  "sources": [
    { "name": "warehouse", "db": "postgres://…", "dialect": "postgres",
      "tables": 18, "dictionaryPath": ".alpona/sources/warehouse/dictionary/dictionary.json",
      "reportsPath": ".alpona/sources/warehouse/reports", "starterSpecs": 12,
      "connectedAt": "…" }
  ]
}
```

The server reads it for display (`main.ts:85-100`) but projects to only
display fields. The actual `db` / `dictionaryPath` are server-side.

### Studio topbar (`packages/studio/src/App.tsx:138-154`)

```tsx
{sources.length > 0 && (
  <span
    className="source-pill"
    title={sources.length > 1
      ? `${sources.length} sources · manage with the alpona CLI`
      : 'active data source · manage with the alpona CLI'}
  >
    <Database size={13} />
    {sources[0]!.name}
    {sources.length > 1 && (
      <span className="source-pill__more">+{sources.length - 1}</span>
    )}
  </span>
)}
```

The pill is a `<span>`, not a button. There's no popover or active state.

### Project conventions

- Server endpoints follow the pattern at `app.ts:155-164`: small Hono
  handlers that read deps from a closure-captured object. The new
  endpoint follows the same shape.
- API base path is `/api/*` with auth middleware applied across the
  board (`app.ts:75`).
- The mock backend is the playground-mode invariant (CLAUDE.md §1.3) —
  every change here must keep `pnpm test` green and the e2e CI smoke
  passing.
- Studio routes are hash-based (`App.tsx:26-34`), so a "reload" after
  switching is `window.location.reload()` not a router push.

## Commands you will need

| Purpose                       | Command                                                            | Expected             |
|-------------------------------|--------------------------------------------------------------------|----------------------|
| Typecheck                     | `pnpm typecheck`                                                   | exit 0               |
| Tests                         | `pnpm test`                                                        | all pass + new tests |
| Server-only tests             | `pnpm --filter @alpona/server test`                                | pass                 |
| Lint / format                 | `pnpm lint && pnpm format:check`                                   | exit 0               |
| Studio build                  | `pnpm --filter alpona-studio build`                                | exit 0               |
| Local dev (manual smoke)      | `pnpm dev` (then open http://localhost:5173)                       | studio renders       |

## Scope

**In scope** (the only files you should modify):
- `packages/server/src/main.ts` — load all sources into a registry; pass
  it to `buildApp`.
- `packages/server/src/app.ts` — add a `SourceRegistry` interface; new
  endpoint `POST /api/sources/active`; route `/api/query` and
  `/api/generate` through the active source.
- `packages/server/src/sources/registry.ts` (NEW) — the registry type
  with hot-swap semantics, plus a unit test.
- `packages/server/test/sources-registry.test.ts` (NEW)
- `packages/server/test/app-sources.test.ts` (NEW) — smoke test that
  `POST /api/sources/active` flips which dictionary `/api/meta` reports.
- `packages/studio/src/App.tsx` — convert the pill to a popover button,
  add a list of sources with a click-to-switch action.
- `packages/studio/src/app.css` (or wherever `.source-pill` lives) —
  popover styles. Inline existing visual language: ivory text, marigold
  highlight, no new colours (CLAUDE.md §1, design tokens).

**Out of scope** (do NOT touch):
- `packages/alpona-cli/src/commands/connect.ts` — the registry format
  it writes is already correct.
- Saved-spec `dictionary_id` drift warnings — already exist
  (`packages/server/src/store/dashboards.ts:48-54`); leave them for a
  separate UX plan.
- The starter-spec gallery filtering by source — that needs a separate
  UI plan; this one delivers the switcher and a page reload, which is
  enough to make the gallery reflect the new source on its next mount.
- Auth implications of per-user "preferred source" — out of scope.
- The Workspace page itself; the page-reload triggered after switching
  is the integration point.

## Git workflow

- Branch: `advisor/006-source-switcher`
- Suggested commit chunks (one per step):
  - `feat(server): in-process source registry with hot-swap`
  - `feat(server): POST /api/sources/active to switch the live source`
  - `feat(studio): popover source switcher in the topbar`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a `SourceRegistry` abstraction

Create `packages/server/src/sources/registry.ts`:

```ts
import type { DataDictionary } from '@alpona/core';
import type { DbAdapter } from '../adapters/types.js';
import { QueryService } from '../query/service.js';

export interface SourceConfig {
  name: string;
  db: string;
  dictionary: DataDictionary;
  /** Directory of canned/starter dashboards for the source. */
  reportsPath?: string;
}

export interface RegistryFactory {
  openAdapter: (db: string) => Promise<DbAdapter>;
  serviceOptions: { maxRows: number; timeoutMs: number; cacheTtlMs?: number };
}

export interface RegistryState {
  name: string;
  adapter: DbAdapter;
  dictionary: DataDictionary;
  service: QueryService;
  reportsPath: string | undefined;
}

/**
 * Owns the active source and the inert configs for switchable ones.
 * Adapters are constructed lazily and cached, so switching twice
 * doesn't re-open a Postgres pool.
 */
export class SourceRegistry {
  private readonly configs = new Map<string, SourceConfig>();
  private readonly states = new Map<string, RegistryState>();
  private current: RegistryState;

  private constructor(
    private readonly factory: RegistryFactory,
    initial: RegistryState,
  ) {
    this.current = initial;
    this.states.set(initial.name, initial);
  }

  static async create(
    factory: RegistryFactory,
    sources: SourceConfig[],
    activeName: string,
  ): Promise<SourceRegistry> {
    const active = sources.find((s) => s.name === activeName);
    if (!active) throw new Error(`active source "${activeName}" not in registry`);
    const adapter = await factory.openAdapter(active.db);
    const service = new QueryService(adapter, active.dictionary, factory.serviceOptions);
    const initialState: RegistryState = {
      name: active.name,
      adapter,
      dictionary: active.dictionary,
      service,
      reportsPath: active.reportsPath,
    };
    const registry = new SourceRegistry(factory, initialState);
    for (const s of sources) registry.configs.set(s.name, s);
    return registry;
  }

  /** Public list — display fields only; connection strings never leave. */
  list(): { name: string; dialect: string; tables: number; active: boolean }[] {
    return Array.from(this.configs.values()).map((s) => ({
      name: s.name,
      dialect: s.dictionary.dialect,
      tables: s.dictionary.tables.length,
      active: s.name === this.current.name,
    }));
  }

  active(): RegistryState {
    return this.current;
  }

  async setActive(name: string): Promise<RegistryState> {
    if (name === this.current.name) return this.current;
    const config = this.configs.get(name);
    if (!config) throw new Error(`unknown source "${name}"`);
    let state = this.states.get(name);
    if (!state) {
      const adapter = await this.factory.openAdapter(config.db);
      const service = new QueryService(adapter, config.dictionary, this.factory.serviceOptions);
      state = {
        name: config.name,
        adapter,
        dictionary: config.dictionary,
        service,
        reportsPath: config.reportsPath,
      };
      this.states.set(name, state);
    }
    this.current = state;
    return state;
  }

  async closeAll(): Promise<void> {
    for (const s of this.states.values()) await s.adapter.close();
  }
}
```

Create `packages/server/test/sources-registry.test.ts` with at least
these cases:

- `setActive` to an unknown name throws.
- `setActive` to the currently active name is a no-op (same `state`
  identity, no extra adapter open call).
- `list` flags `active: true` for exactly one entry.
- `setActive` then back returns the cached state (not re-opened).

Use a fake `RegistryFactory` whose `openAdapter` returns a stub that
counts opens. (Do not actually open DuckDB here — keep the test pure.)

**Verify**: `pnpm --filter @alpona/server test` passes the new file.

### Step 2: Rewire `main.ts` to use the registry

Edit `packages/server/src/main.ts`. The current shape (lines 39-43,
120, 119-137) constructs `adapter`, `queryService`, and `agent` from
captured singletons. Replace with:

1. Build the list of `SourceConfig`s from the existing `sources` array
   logic at `main.ts:82-100`. For the bundled (zero-th) source, the
   dictionary is the one already loaded from `config.dictionaryPath`
   and the db is `config.db`. For each registry entry from
   `.alpona/sources.json`, read its dictionary JSON from the entry's
   `dictionaryPath` and use its `db`. The entry shape (the full
   `SourceEntry` from connect.ts) is private to the server — the
   existing main.ts already projects it to display-only when going to
   HTTP; here we keep the full record server-side.

2. Open the active source via `SourceRegistry.create`:

   ```ts
   const registry = await SourceRegistry.create(
     { openAdapter: createAdapter, serviceOptions: { maxRows: config.maxRows, timeoutMs: config.queryTimeoutMs } },
     sourceConfigs,
     activeSourceName, // = config.sourceName
   );
   ```

3. Pass `registry` into `buildApp` instead of `adapter`, `queryService`,
   `dictionary`. The agent will be constructed inside `buildApp` on
   each switch (cheap), or once at boot and re-wired via setters —
   pick the simpler path: re-construct the agent on switch. Pass a
   factory for the backend so the live/mock choice survives switches:

   ```ts
   const backendFactory = (dictionary: DataDictionary) =>
     config.mock
       ? new MockAgent(dictionary)
       : config.provider === 'openai'
         ? new OpenAiAgent(dictionary, { …openaiOpts… })
         : new AnthropicAgent(dictionary, { …anthropicOpts… });
   ```

4. Update the SIGINT/SIGTERM handler at `main.ts:158-162` to call
   `registry.closeAll()` instead of `adapter.close()`.

**Verify**: `pnpm typecheck` exits 0. `pnpm --filter @alpona/server test`
existing tests still pass.

### Step 3: Route the app through the registry; add `POST /api/sources/active`

Edit `packages/server/src/app.ts`. Replace the `queryService` and
`dictionary` deps in `AppDeps` with `registry: SourceRegistry`. Update
every consumer:

- `/api/health` (`app.ts:77-87`): use `registry.active().dictionary.tables.length`.
- `/api/meta` (`app.ts:91-106`): read from `registry.active().dictionary`.
- `/api/catalog` (`app.ts:158-163`): same.
- `/api/sources` (`app.ts:155`): return `registry.list()` (already shaped
  for HTTP).
- `/api/query` (`app.ts:215-239`): use `registry.active().service.run(...)`.
- `/api/generate` (`app.ts:108-138`): re-build the agent for each
  request using the current dictionary, or — simpler — keep a small
  cached agent alongside the registry that re-instantiates on a
  registry change. The simplest path is a getter:

  ```ts
  const agentFor = (state: RegistryState) =>
    cache.get(state.name) ??
    cache.set(state.name, new AlponaAgent({ backend: backendFactory(state.dictionary), dictionary: state.dictionary, executor: state.service })).get(state.name)!;
  ```

  Pass the agent factory through `AppDeps`.

Add the new endpoint after the existing `/api/sources`:

```ts
app.post('/api/sources/active', async (c) => {
  let body: { name?: string };
  try {
    body = (await c.req.json()) as { name?: string };
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.name !== 'string' || body.name.length === 0) {
    return c.json({ error: 'name is required' }, 400);
  }
  try {
    const state = await deps.registry.setActive(body.name);
    return c.json({ active: state.name });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'switch failed' }, 404);
  }
});
```

Add a server test at `packages/server/test/app-sources.test.ts` that:

1. Builds a registry with two fake sources (use the fake adapter from
   step 1).
2. Hits `/api/meta` — confirm `dictionary.tables` matches source A.
3. POST `/api/sources/active` with `{name: 'B'}` — expect 200 and
   `{active: 'B'}`.
4. Hits `/api/meta` again — confirm `dictionary.tables` now matches
   source B.
5. POST with `{name: 'C'}` (not registered) — expect 404.

**Verify**: `pnpm --filter @alpona/server test` passes including the new
file. `pnpm typecheck` exits 0.

### Step 4: Studio UI — make the pill a switcher

Edit `packages/studio/src/App.tsx`. Replace the `<span className="source-pill">…</span>`
block (`App.tsx:139-154`) with a button + popover. The component shape:

```tsx
{sources.length > 0 && (
  <SourceSwitcher
    sources={sources}
    onSwitch={async (name) => {
      const res = await authFetch('/api/sources/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        // Simplest correct behaviour: full reload so every cached
        // dictionary-keyed datum (suggestions, sources list, saved
        // specs filter) is refetched against the new source.
        window.location.reload();
      } else {
        showToast('Could not switch source');
      }
    }}
  />
)}
```

Implement `SourceSwitcher` either inline in `App.tsx` (preferred, the
component is small) or in `packages/studio/src/components/SourceSwitcher.tsx`.
The popover open/close uses a single `useState<boolean>` and closes on
outside click (use a `document.addEventListener('click', …)` in a
`useEffect`).

The UI shape:

```
┌───────────────────────────────┐
│ ◉ supply-chain          ✓     │  ← active (marigold tick)
│   warehouse                   │
│   marketing                   │
└───────────────────────────────┘
```

Rules:
- Disabled sources (already active) stay visible but not clickable.
- A single click swaps and reloads. There is no in-flight indicator
  beyond the reload itself; the optimistic toast is "Could not switch
  source" only on failure.
- Keyboard accessibility: the pill button gets focus, the popover items
  are buttons inside a `<menu>` or list.

Add CSS in the existing `app.css` (search for `.source-pill` to find the
section). The new selectors are `.source-pill` (now `button` styling),
`.source-pill__popover`, `.source-pill__option`. Reuse existing colour
tokens (`--marigold`, `--ivory`, etc.) — do not introduce new colours.

**Verify**:
- `pnpm --filter alpona-studio build` exits 0
- `pnpm dev`; in a browser at http://localhost:5173, the topbar pill
  opens a popover and clicking a different source reloads the page;
  the pill then shows the new source's name.

### Step 5: Re-run the full guardrails

- `pnpm typecheck` → exit 0
- `pnpm test` → all pass (existing 129 + new registry + new app-sources)
- `pnpm lint && pnpm format:check` → exit 0
- `pnpm --filter alpona-studio build` → exit 0

Also re-run the e2e smoke from `.github/workflows/ci.yml:46-61` against
the bundled supply-chain dataset — the switcher must not break the
single-source playground path.

## Test plan

- `sources-registry.test.ts`: 4 cases listed in step 1.
- `app-sources.test.ts`: 5 cases listed in step 3.
- No new test for `App.tsx`; the studio is exercised via the existing
  build + manual smoke (no studio test runner exists today).
- The existing server tests (`auth.test.ts`, `guardrails.test.ts`,
  `query-service.test.ts`, `store.test.ts`) must keep passing — they
  exercise the per-request slice that is unchanged by the registry.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; new tests pass
- [ ] `pnpm lint && pnpm format:check` exit 0
- [ ] `pnpm --filter alpona-studio build` exits 0
- [ ] `curl -fs localhost:3001/api/sources` (after `pnpm dev`) returns
      a list with one `active: true` entry and one or more inactives
      when `.alpona/sources.json` is populated
- [ ] `curl -fs -X POST localhost:3001/api/sources/active -H 'content-type: application/json' -d '{"name":"<other>"}'`
      returns 200 and `/api/meta` then reflects the new dictionary
- [ ] Manual smoke: clicking the popover in the studio reloads and the
      pill shows the picked source
- [ ] `git diff --name-only` is limited to the files in the "In scope"
      list above
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A second `SourceRegistry` consumer surfaces (e.g. somewhere caching
  `dictionary` outside the server boot path) that this plan would
  silently leave stale — surface it; don't broaden scope.
- Any of the existing server tests fails on the registry refactor in a
  way that suggests a contract change (e.g. `QueryService` ctor
  signature drift). The plan assumes `QueryService`'s constructor
  signature is unchanged.
- The studio dev build complains about a missing CSS variable — surface
  the missing token rather than coining a new colour.
- More than two new server source files are needed — the scope cap is
  `sources/registry.ts` + tests. A deeper refactor (e.g. per-route
  source override) is a separate plan.

## Maintenance notes

- The agent is re-instantiated per active source (cached by source name).
  Two implications:
  - The mock-vs-live decision is fixed at boot — switching sources never
    switches backends. Documented as intentional.
  - If the agent's stateful caches (BM25 retrieval, prompt-template
    memoisation) grow heavy, consider sharing them across instances.
- The studio relies on `window.location.reload()` after a switch. That
  keeps the implementation simple but loses the user's in-progress
  draft prompt. A follow-up plan can preserve workspace state across
  the swap with `sessionStorage`. Out of scope here.
- `POST /api/sources/active` is the easiest target for "switch the
  source out from under another tab" race in multi-tab use; the design
  treats the latest call as authoritative. Per-user preference
  persistence is the right long-term fix.
- A reviewer should scrutinise that the new endpoint sits behind the
  same auth middleware as the rest of `/api/*` (it does — it inherits
  from `app.use('/api/*', …)`).
- Future work explicitly deferred: starter-spec gallery filtering by
  active source (the seeded reports per source already exist; rendering
  needs the catalog page to respect the active source on the next
  mount, which `window.location.reload()` already delivers).
