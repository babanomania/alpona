# Plan 001: Restore a green `pnpm typecheck` at the workspace root

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 06ebd68..HEAD -- website/scripts/gen-reference.ts packages/core/src/registry/definitions.ts packages/core/src/types.ts`
> If `website/scripts/gen-reference.ts` has changed since this plan was
> written, compare the "Current state" excerpts against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / correctness
- **Planned at**: commit `06ebd68`, 2026-06-17

## Why this matters

`pnpm typecheck` at the workspace root is currently red on `main`: the
website's build-time reference-generator script fails with TS7053, which
means the CI `checks` job (which runs `pnpm typecheck`) is failing on every
push. Every subsequent plan in this set relies on `pnpm typecheck` as a
verification gate; the gate must be honest before any other change lands.
The fix is a one-line type assertion in a docs-generation script — no
runtime behaviour changes.

## Current state

The failing file: `website/scripts/gen-reference.ts`. This script runs at
website build time to emit Starlight markdown from `@alpona/core`'s widget
registry, so the docs cannot drift from the code (CLAUDE.md §4 "Generated,
never hand-drifted").

The error from `pnpm typecheck` (full output you can reproduce in step 1):

```
website typecheck: scripts/gen-reference.ts:89:41 - error ts(7053):
  Element implicitly has an 'any' type because expression of type
  'string' can't be used to index type
  'Partial<Record<keyof ResultShape, string>>'.
  89         ? keys.map((k) => `\`${k}\` — ${w.resultShape.docs[k] ?? ''}`).join('; ')
```

The relevant excerpt — `website/scripts/gen-reference.ts:75-107`:

```ts
const widgetsMd = [
  '---',
  'title: Widget registry',
  'description: Every widget type, its result-shape contract, and agent hints.',
  'sidebar: { order: 2 }',
  '---',
  '',
  GENERATED,
  '',
  `**${widgetDefinitions.length}** widget types. …`,
  '',
  ...widgetDefinitions.flatMap((w) => {
    const shape = (keys: string[]) =>
      keys.length
        ? keys.map((k) => `\`${k}\` — ${w.resultShape.docs[k] ?? ''}`).join('; ')
        : '—';
    return [
      `## ${w.type}`,
      …
      `**Required:** ${shape(w.resultShape.required)}`,
      …
      w.resultShape.optional.length ? `**Optional:** ${shape(w.resultShape.optional)}` : '',
      …
    ].filter((line) => line !== '');
  }),
].join('\n');
```

What's actually being indexed: `w.resultShape.docs` is typed as
`Partial<Record<ResultShapeKey, string>>` (`packages/core/src/registry/definitions.ts:20`),
and `ResultShapeKey = keyof ResultShape` (`packages/core/src/types.ts:30,51`).
The `shape` helper is annotated `(keys: string[])` so TS cannot prove `k` is
a valid `ResultShapeKey` — but the callers pass `w.resultShape.required` and
`w.resultShape.optional`, which are `ResultShapeKey[]`. The fix is to narrow
the parameter type so the index access is sound.

Project conventions that apply here:

- TypeScript is strict; `noUncheckedIndexedAccess: true` is set
  (`tsconfig.base.json:8`).
- ESLint enforces `@typescript-eslint/consistent-type-imports`
  (`eslint.config.js:29`) — use `import type` for type-only imports.
- The website is an Astro project with its own checker (`astro check`)
  invoked via `pnpm --filter @alpona/website typecheck`. The workspace
  root `pnpm typecheck` runs `pnpm -r typecheck` which includes website.
  (Verified in recon: `package.json:17` and `website/package.json` `typecheck`
  script.)

## Commands you will need

| Purpose                 | Command                            | Expected on success                         |
|-------------------------|------------------------------------|---------------------------------------------|
| Install                 | `pnpm install --frozen-lockfile`   | exit 0                                      |
| Reproduce the failure   | `pnpm typecheck`                   | exit 1; the ts(7053) message shown above    |
| Verify the fix          | `pnpm typecheck`                   | exit 0, no errors                           |
| Test suite still passes | `pnpm test`                        | 16 files, 129 tests pass                    |
| Lint                    | `pnpm lint`                        | exit 0                                      |
| Format check            | `pnpm format:check`                | exit 0                                      |

## Scope

**In scope** (the only files you should modify):
- `website/scripts/gen-reference.ts`

**Out of scope** (do NOT touch, even though they look related):
- `packages/core/src/types.ts` — changing `ResultShape` is a contract
  change that affects every widget; this is a typing-of-the-consumer
  problem, not a contract problem.
- `packages/core/src/registry/definitions.ts` — same reason.
- Any deprecation-warning (`ts(6385)`, `ts(6387)`) in
  `website/src/scripts/hero.ts` re `THREE.Clock` — surface noise only,
  not the failure; leave it alone.

## Git workflow

- Branch: `advisor/001-fix-broken-typecheck`
- Recent commit style (from `git log --oneline -5`): conventional commits
  with package scope, e.g. `feat(datasets): curated report galleries for
  ecommerce and saas-metrics`, `fix(studio,videos): pin answers as KPIs`.
  Match it: `fix(website): narrow gen-reference shape helper to ResultShapeKey[]`
  is in keeping with the style.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Reproduce the failure

Run `pnpm typecheck` from the repo root and confirm the only error is
the ts(7053) one in `gen-reference.ts:89` (deprecation warnings on
`hero.ts` are expected and not part of this plan).

**Verify**: `pnpm typecheck 2>&1 | grep -E "ts\(7053\)|gen-reference"`
returns the line containing `gen-reference.ts:89:41 - error ts(7053)`.

### Step 2: Narrow the `shape` helper's parameter type

Edit `website/scripts/gen-reference.ts`.

1. At the top of the file, where existing imports from `@alpona/core` live
   (check the file's actual import line), add `ResultShapeKey` to the
   imported types. The import must use `import type` per the repo's
   `@typescript-eslint/consistent-type-imports` rule. For example, if the
   current import reads:

   ```ts
   import { widgetDefinitions, layoutTemplates } from '@alpona/core';
   ```

   adjust it (or add a sibling `import type` line) so that `ResultShapeKey`
   is in scope as a type. If `widgetDefinitions` is imported as a value
   from `@alpona/core` directly, keep that, and add:

   ```ts
   import type { ResultShapeKey } from '@alpona/core';
   ```

   If `@alpona/core`'s public exports do not include `ResultShapeKey` (check
   `packages/core/src/index.ts`), re-export it from there — add
   `export type { ResultShapeKey } from './types.js';` to
   `packages/core/src/index.ts` and treat that edit as a STOP condition
   review: read "STOP conditions" below.

2. Change the `shape` helper from `(keys: string[])` to
   `(keys: readonly ResultShapeKey[])`. The full updated block at
   `gen-reference.ts:87-90` should be:

   ```ts
       const shape = (keys: readonly ResultShapeKey[]) =>
         keys.length
           ? keys.map((k) => `\`${k}\` — ${w.resultShape.docs[k] ?? ''}`).join('; ')
           : '—';
   ```

   The callers (`w.resultShape.required`, `w.resultShape.optional`) are
   already `ResultShapeKey[]` per `ResultShapeContract`
   (`packages/core/src/registry/definitions.ts:16-20`), so no caller
   changes are needed.

**Verify**: `pnpm typecheck` exits 0. There should be no ts(7053) error,
and the only remaining `gen-reference.ts` output (if any) is from
unrelated files.

### Step 3: Re-run the full check matrix

Run, in order:

- `pnpm typecheck` → exit 0
- `pnpm test` → 16 files, 129 tests pass (matches the recorded baseline at
  commit `06ebd68`)
- `pnpm lint` → exit 0
- `pnpm format:check` → exit 0

**Verify**: each command exits 0. If `pnpm format:check` fails on
`gen-reference.ts`, run `pnpm format` to fix and commit the formatting
change as a separate hunk.

## Test plan

This change has no runtime behaviour to test — it tightens a build-time
script's parameter type so an existing static check passes. The verification
gate is `pnpm typecheck` itself.

- No new tests required.
- Do NOT add a snapshot test for the generated markdown; the website docs
  intentionally regenerate on every build (CLAUDE.md §4), and a snapshot
  would just churn.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; 129 tests pass
- [ ] `pnpm lint` exits 0
- [ ] `pnpm format:check` exits 0
- [ ] `git diff --name-only` shows only `website/scripts/gen-reference.ts`
      (and, if step 2.1 required it, `packages/core/src/index.ts`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `website/scripts/gen-reference.ts:75-107` does not match the
  excerpt above (the file has been refactored since this plan was written).
- `@alpona/core` does not export `ResultShapeKey` AND you would need to
  modify more than `packages/core/src/index.ts` to re-export it (e.g. the
  type is renamed or removed in core). In that case, report the divergence
  rather than refactoring core.
- After the type narrowing, `pnpm typecheck` still fails with a different
  error in the same file — there may be a second type bug masked behind
  this one.
- `pnpm test` newly fails after the change (it should not — this is a
  build-script-only edit).

## Maintenance notes

- The website's reference pages are generated from `@alpona/core`'s widget
  registry on every build (`website.yml` deploy workflow). Any future
  refactor of `ResultShape` or `ResultShapeKey` in `packages/core/src/types.ts`
  must keep the type exported from `@alpona/core`'s public surface, or
  this script breaks again.
- A reviewer should check that the imported `ResultShapeKey` is a `type`
  import (not a value import), matching the rest of the file.
- Deferred out of this plan: the `THREE.Clock` deprecation warnings in
  `website/src/scripts/hero.ts:268` are noise from a three.js bump and
  unrelated to the typecheck failure. Leave them for a separate
  three.js-cleanup plan.
