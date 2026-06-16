# Plan 002: Patch the 8 known dependency vulnerabilities reported by `pnpm audit`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 06ebd68..HEAD -- package.json website/package.json pnpm-lock.yaml`
> If any of these files changed since this plan was written, re-run
> `pnpm audit` first to learn the current state; advisories may have been
> partially fixed already.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (Astro `5 → 6` is a major version bump)
- **Depends on**: 001 (a green `pnpm typecheck` is the gate for verifying the Astro bump didn't break docs)
- **Category**: deps / security
- **Planned at**: commit `06ebd68`, 2026-06-17

## Why this matters

`pnpm audit` reports 8 vulnerabilities, three of them HIGH severity:

- **esbuild RCE via `NPM_CONFIG_REGISTRY`** (<0.28.1, GHSA-gv7w-rqvm-qjhr).
  Affects 30 dependency paths (tsx, vitest, vite). Any contributor or CI
  run can be hit.
- **Astro reflected XSS via unescaped slot name** (<6.3.3, GHSA-8hv8-536x-4wqp)
  — the docs site Alpona ships as its public face.
- **Astro Host-header SSRF in prerendered error page fetch** (<6.4.6,
  GHSA-2pvr-wf23-7pc7).

Plus 5 moderate/low (yaml stack overflow in dev tooling, Astro define:vars
XSS, Astro server-island replay, esbuild dev-server file-read on Windows).

These are real vulns in published advisories — the workspace pins
`astro@^5.1.1` while `@astrojs/starlight@^0.30.3` resolves astro to
`5.18.2`, below every patched range. The fix is to bump dependencies; the
risk is that Astro 5 → 6 is a major version, so the website pages have to
keep rendering after the bump.

## Current state

### Vulnerable pins

`website/package.json:13-19`:

```json
"dependencies": {
  "@alpona/core": "workspace:*",
  "@astrojs/starlight": "^0.30.3",
  "astro": "^5.1.1",
  "sharp": "^0.33.5",
  "three": "^0.184.0"
}
```

The root `package.json` does not pin esbuild directly — it comes in
transitively via `tsx@^4.22.4`, `vitest@^4.1.8`, and `vite` (used by
`alpona-studio` and `website`).

### Audit output (verified by running `pnpm audit` at commit `06ebd68`)

```
8 vulnerabilities found
Severity: 2 low | 3 moderate | 3 high
```

Three HIGH:
- esbuild >=0.17.0 <0.28.1 → patched >=0.28.1 (GHSA-gv7w-rqvm-qjhr)
- astro <6.3.3 reflected XSS (GHSA-8hv8-536x-4wqp)
- astro <6.4.6 Host-header SSRF (GHSA-2pvr-wf23-7pc7)

Three MODERATE:
- astro <6.1.6 define:vars XSS (GHSA-j687-52p2-xcff)
- yaml <2.8.3 stack overflow (GHSA-48c2-rrv3-qjmp) — dev-only via
  `@astrojs/check`'s YAML language server
- (one more moderate in the same chain — see `pnpm audit` for the exact
  third moderate entry; the fix is subsumed by the astro 6.x bump)

Two LOW:
- astro <6.1.10 server-island replay (GHSA-xr5h-phrj-8vxv)
- esbuild <0.28.1 Windows dev-server file-read (GHSA-g7r4-m6w7-qqqr)

### Project conventions

- pnpm workspaces, `pnpm-lock.yaml` is checked in and CI runs
  `pnpm install --frozen-lockfile` (`.github/workflows/ci.yml:18`).
- ESLint ignores `website/**`; the website has its own
  `pnpm --filter @alpona/website typecheck` that runs `astro check`.
- Site is statically generated for GitHub Pages
  (`.github/workflows/website.yml`).
- The website uses `@astrojs/starlight` plus a custom landing
  (`website/src/pages/index.astro`). Starlight 0.30 supports astro 5.x;
  to get to astro 6.x you also need to bump Starlight — verify the matrix
  at https://starlight.astro.build/ before picking the target version.

## Commands you will need

| Purpose                            | Command                                           | Expected on success                |
|------------------------------------|---------------------------------------------------|------------------------------------|
| Install with lock changes          | `pnpm install`                                    | exit 0; lockfile updates           |
| Re-audit                           | `pnpm audit`                                      | the three HIGH advisories gone     |
| Strict re-audit                    | `pnpm audit --audit-level=high`                   | exit 0                             |
| Workspace typecheck                | `pnpm typecheck`                                  | exit 0                             |
| Workspace tests                    | `pnpm test`                                       | 16 files, 129 tests pass           |
| Website build                      | `pnpm --filter @alpona/website build`             | exit 0; `website/dist/` populated  |
| Lint / format                      | `pnpm lint && pnpm format:check`                  | exit 0                             |
| Studio build (Vite/esbuild path)   | `pnpm --filter alpona-studio build`               | exit 0                             |
| E2E smoke (mock agent)             | See `.github/workflows/ci.yml:24-64` — reproduce  | curl returns plan/widget/done      |

## Scope

**In scope** (the only files you should modify):
- `website/package.json` (Astro + Starlight version bumps)
- `package.json` (root, if a `pnpm.overrides` block is needed for esbuild)
- `pnpm-lock.yaml` (regenerated)

**Out of scope** (do NOT touch, even though they look related):
- `packages/studio/package.json` — Vite there transitively gets the
  patched esbuild via overrides; only edit if step 2 specifically
  determines a direct bump is needed.
- Any application code under `packages/*/src/` — this is a dependency
  hygiene pass, not a code change.
- `website/src/**` — the Astro 6 bump must not require source rewrites;
  if it does, treat as a STOP condition (see below).
- `videos/` and `deploy/` — separate dependency surfaces, no advisories
  reported there.

## Git workflow

- Branch: `advisor/002-patch-dep-vulns`
- Commit per logical chunk; conventional-commit style as observed in the
  repo (e.g. `chore(deps): bump esbuild to 0.28.1 via pnpm.overrides`,
  `chore(website): astro 5 → 6.4.x for security advisories`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Patch esbuild via a root `pnpm.overrides`

esbuild is transitive across many packages; the cheapest, most consistent
fix is a workspace-level override so every consumer (`tsx`, `vitest`,
`vite`) sees the same patched version.

Edit `package.json` at the workspace root. Add a `pnpm` section if it
doesn't exist (it currently does not — `package.json` ends at field
`devDependencies`). After `devDependencies`, add:

```json
"pnpm": {
  "overrides": {
    "esbuild": "^0.28.1"
  }
}
```

The existing top-level `packageManager: "pnpm@11.5.3"` stays as is. Do
not change `engines`.

Run `pnpm install`. The lockfile will regenerate. Inspect the diff:
`git diff pnpm-lock.yaml | grep esbuild | head -40` should show old
`0.28.0` entries replaced by `0.28.1` (or higher).

**Verify**:
- `pnpm why esbuild` shows version `0.28.1` (or higher) in every path.
- `pnpm audit` no longer reports the two esbuild advisories.

### Step 2: Bump Astro + Starlight to a version pair that patches the SSRF + XSS

Astro 6.4.6 is the lowest patched version for the Host-header SSRF
(GHSA-2pvr-wf23-7pc7). Starlight must be bumped in the same change to a
version that supports astro@^6.x — visit the Starlight changelog
(https://github.com/withastro/starlight/releases) to confirm the minimum
Starlight version that declares `peerDependencies.astro ^6.x`. As of
2026-06-17, Starlight 0.32.x or later supports Astro 6. If the lockup
matrix has changed by the time you execute, pick the lowest Starlight
release whose declared peer covers `astro@^6.4.6`.

Edit `website/package.json`:

```json
"dependencies": {
  "@alpona/core": "workspace:*",
  "@astrojs/starlight": "^<lowest-astro-6-compatible>",
  "astro": "^6.4.6",
  "sharp": "^0.33.5",
  "three": "^0.184.0"
}
```

Run `pnpm install` from the repo root.

**Verify**:
- `pnpm audit --audit-level=high` exits 0.
- `pnpm why astro` shows astro `>= 6.4.6` in every path.
- `pnpm --filter @alpona/website typecheck` exits 0 (depends on plan 001
  having landed — the workspace typecheck must be green to start with).
- `pnpm --filter @alpona/website build` exits 0 and writes
  `website/dist/index.html`.

If `astro check` reports type errors that are clearly Astro-6 API
changes (e.g. config option renames, removed adapters), STOP — see
"STOP conditions". Do not start a wider Astro 6 migration in this plan.

### Step 3: Visually smoke-test the website build output

The Astro major bump risks breaking the landing's Three.js hero or
Starlight's sidebar. The static build is the artifact CI deploys to
gh-pages, so a fast manual check is enough.

Open `website/dist/index.html` and confirm:

1. The `<script>` tag for the hero scene is present (search for
   `initHero` or `hero.ts` import).
2. The Starlight sidebar HTML structure renders for at least one doc
   page: open `website/dist/getting-started/playground/index.html` (or
   `playground.html`, depending on Astro 6's output layout) and confirm
   there is a `<nav>` or `<aside>` block with sidebar items.

You can serve the dist locally for a sanity check:
`pnpm --filter @alpona/website preview` and load `http://localhost:4321`
(default Astro preview port). Confirm:

- The landing hero animates (Three.js scene shows the alpona pattern).
- A docs page (e.g. `/getting-started/playground`) loads and shows the
  sidebar.

**Verify**: both pages render without console errors. If the hero is
broken (Three.js init error), STOP — see "STOP conditions".

### Step 4: Final guardrails

Run, in order:

- `pnpm install --frozen-lockfile` (from a clean state with the new
  lockfile) → exit 0
- `pnpm typecheck` → exit 0
- `pnpm test` → 16 files, 129 tests pass
- `pnpm lint` → exit 0
- `pnpm format:check` → exit 0
- `pnpm audit --audit-level=high` → exit 0
- `pnpm audit --audit-level=moderate` → ideally exit 0; if a moderate
  yaml advisory remains (the dev-only YAML language server path), that
  is acceptable for this plan **only** if the path is `>volar-service-yaml>yaml-language-server>yaml`
  (dev-only). Record the leftover advisory in the maintenance notes
  section of your final report.

## Test plan

This is a dependency-bump plan; the tests already cover what the apps do
at runtime. The verification is the existing test suite, the website
build, and the audit being clean.

- Run the existing `pnpm test` — must still be 129/129.
- Run the e2e smoke (the second job in `.github/workflows/ci.yml`):
  ```
  ALPONA_DB=duckdb:./datasets/supply-chain/db/alpona.duckdb pnpm alpona migrate \
    && pnpm alpona seed && pnpm alpona marts && pnpm alpona dictionary && pnpm alpona verify
  ALPONA_MOCK=1 pnpm --filter @alpona/server start &
  for i in $(seq 1 30); do curl -fs localhost:3001/api/health && break || sleep 1; done
  curl -fs -N -X POST localhost:3001/api/generate \
    -H 'content-type: application/json' \
    -d '{"prompt":"delayed shipments by carrier"}' --max-time 30 > /tmp/stream.txt
  grep -q '"type":"plan"' /tmp/stream.txt
  grep -q '"type":"widget"' /tmp/stream.txt
  grep -q '"type":"done"' /tmp/stream.txt
  ! grep -q '"type":"error"' /tmp/stream.txt
  ```
  All `grep -q` lines must succeed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm install --frozen-lockfile` succeeds with the new lockfile
- [ ] `pnpm audit --audit-level=high` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; 129 tests pass
- [ ] `pnpm lint` exits 0
- [ ] `pnpm format:check` exits 0
- [ ] `pnpm --filter @alpona/website build` exits 0
- [ ] `pnpm why esbuild` shows version `>= 0.28.1` everywhere
- [ ] `pnpm why astro` shows version `>= 6.4.6` everywhere
- [ ] `git diff --name-only` shows only `package.json`, `website/package.json`,
      `pnpm-lock.yaml` (no source-code changes)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- After the Astro 6 bump, `astro check` reports type or config errors that
  are Astro 6 breaking-change migrations (e.g. `Astro.glob` removal,
  config-option renames). Migrating the site to Astro 6 conventions is a
  separate, larger plan — do not attempt it inline.
- The hero scene does not render after the bump. Astro's client-island
  semantics shifted between 5 and 6; debugging the hero is out of scope
  here.
- `pnpm install` fails to resolve because no Starlight version supports
  both `astro@^6.4.6` and Alpona's other constraints — report the
  resolution conflict; do NOT use `--force` or override Starlight's peer.
- A non-esbuild, non-astro, non-yaml advisory appears that you did not
  expect — surface it and stop. Adding more bumps without explicit scope
  expansion is what breaks dep-hygiene plans.
- More than three source files outside `website/` would need to change —
  the scope is dependency hygiene, not a codebase port.

## Maintenance notes

- The transitive `yaml` advisory (GHSA-48c2-rrv3-qjmp) is dev-only via
  `@astrojs/check` → `yaml-language-server`. It clears the day `astro/check`
  itself bumps `yaml-language-server`. Re-check `pnpm audit` after the
  next Astro/check release; if it still lingers, add a
  `pnpm.overrides.yaml: "^2.8.3"` to force the patched version.
- The `pnpm.overrides.esbuild` line is the simplest control surface for
  future esbuild advisories — just bump the pin.
- A reviewer should scrutinise the lockfile diff for collateral version
  changes (Vite, tsx, vitest may all shift sub-versions) and confirm the
  e2e smoke ran. Astro majors have historically required adjustments to
  `astro.config.mjs` — confirm the site config compiles unchanged.
- Deferred out of this plan: the website's `@astrojs/check` and TypeScript
  pin (`typescript: ^6.0.3`) are not part of the advisory set — leave
  them. Three.js deprecation warnings noted in plan 001 also stay
  deferred.
