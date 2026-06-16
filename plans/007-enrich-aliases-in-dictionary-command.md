# Plan 007: Run alias enrichment from the standalone `alpona dictionary` command, not just `alpona init`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 06ebd68..HEAD -- packages/alpona-cli/src/commands/dictionary.ts packages/alpona-cli/src/commands/init.ts packages/alpona-cli/src/cli.ts packages/alpona-cli/test/`
> If any of those changed, re-read them and compare against the
> "Current state" excerpts before continuing.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (green typecheck baseline)
- **Category**: direction (closes PLAN.md D9(b) gap)
- **Planned at**: commit `06ebd68`, 2026-06-17

## Why this matters

PLAN.md decision D9(b) says alias enrichment lives at *dictionary build
time* — `alpona dictionary` is the command that builds the dictionary, so
that command should enrich. Today, enrichment only runs from
`alpona init` (`packages/alpona-cli/src/commands/init.ts:63-122`,
`init.ts:150`), and `alpona dictionary` (the documented standalone
workflow in `CONTRIBUTING.md:10`) writes a dictionary with no aliases.

The consequence: contributors who follow CONTRIBUTING.md run
`pnpm alpona migrate && pnpm alpona seed && pnpm alpona marts && pnpm alpona dictionary`
and get a no-alias dictionary even when `OPENAI_API_KEY` /
`OPENAI_BASE_URL` is set. They never see the BM25 alias-recall payoff
described in PLAN.md §2 D9 (and verified by the test at
`packages/agent/test/retrieval.test.ts:43-54`).

This plan moves the existing `enrichAliases` function to a reusable
module so both commands share it, and has `alpona dictionary` call it
when a model is configured.

## Current state

### `packages/alpona-cli/src/commands/init.ts:63-122`

The function `enrichAliases(dictionaryPath, log)` is defined here as a
private (non-exported) function. It:

1. Reads `OPENAI_API_KEY` / `OPENAI_BASE_URL` from `process.env`; bails
   out (returns `false`) when both are unset.
2. Reads the dictionary JSON.
3. POSTs to `<baseUrl or OpenAI>/chat/completions` with a fixed system
   prompt asking for 2-4 alias suggestions per table.
4. Parses the response as JSON, writes aliases into each table's
   `aliases` field, persists, and returns `true`.

The function is called once from `init()` at line 150:

```ts
const aliasesEnriched = await enrichAliases(dictionaryPath, log);
```

### `packages/alpona-cli/src/commands/dictionary.ts:94-101`

```ts
export async function writeDictionary(db: AdminDb, dir: string): Promise<string> {
  const dictionary = await buildDictionary(db, dir);
  const outDir = join(dir, 'dictionary');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'dictionary.json');
  writeFileSync(outPath, JSON.stringify(dictionary, null, 2) + '\n');
  return outPath;
}
```

No enrichment call here.

### CLI dispatch (`packages/alpona-cli/src/cli.ts:292-297`)

```ts
case 'dictionary': {
  const path = await writeDictionary(db, dir);
  const dictionary = JSON.parse(readFileSync(path, 'utf8')) as { tables: unknown[] };
  console.log(`✓ dictionary: ${dictionary.tables.length} tables → ${path}`);
  break;
}
```

### Project conventions

- CLI commands use the `log: (line: string) => void` pattern injected
  from a caller (default `console.log`) — see
  `init.ts:25, 124-125`. Reuse this pattern.
- Enrichment is **best-effort**: a network failure must never fail the
  command. The existing `enrichAliases` catches errors and logs them;
  preserve that behaviour.
- The standalone CLI commands operate on a connection from
  `openAdminDb` and respect the `--dir` flag — the dictionary lives in
  `<dir>/dictionary/dictionary.json`.

## Commands you will need

| Purpose             | Command                                  | Expected                |
|---------------------|------------------------------------------|-------------------------|
| Typecheck           | `pnpm typecheck`                         | exit 0                  |
| Tests               | `pnpm test`                              | all pass                |
| Tests (CLI only)    | `pnpm --filter alpona-cli test`          | pass                    |
| Lint / format       | `pnpm lint && pnpm format:check`         | exit 0                  |
| Manual smoke        | See step 4                               | aliases present in JSON |

## Scope

**In scope** (the only files you should modify):
- `packages/alpona-cli/src/commands/dictionary.ts` — wire enrichment in.
- `packages/alpona-cli/src/commands/aliases.ts` (NEW) — the extracted,
  reusable enrichment function.
- `packages/alpona-cli/src/commands/init.ts` — switch to the shared
  implementation.
- `packages/alpona-cli/test/aliases.test.ts` (NEW) — unit-tests for
  the extracted function (with an injected fetch).

**Out of scope** (do NOT touch):
- The CLI dispatcher (`cli.ts`) — no signature changes; the existing
  `writeDictionary` invocation continues to work.
- The agent's retrieval module — it already consumes aliases when
  present (`packages/agent/src/retrieval/index.ts:47-55`).
- The model prompt for alias enrichment itself — improving it is a
  follow-up.

## Git workflow

- Branch: `advisor/007-dictionary-alias-enrichment`
- Commit style: `feat(cli): enrich aliases in alpona dictionary command`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the enrichment function into a shared module

Create `packages/alpona-cli/src/commands/aliases.ts`. Copy the body of
`enrichAliases` from `init.ts` and adapt:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { DataDictionary } from '@alpona/core';

export interface EnrichOptions {
  /** Override fetch for testing. */
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

/**
 * D9(b) alias enrichment: one offline LLM call writes synonyms into the
 * dictionary so lexical retrieval can match the words users actually
 * use. Best-effort — never fails the caller because a model was
 * unreachable.
 */
export async function enrichAliases(
  dictionaryPath: string,
  options: EnrichOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const doFetch = options.fetch ?? globalThis.fetch;
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = env.OPENAI_BASE_URL;
  if (!apiKey && !baseUrl) {
    log('  ⊘ alias enrichment skipped (no OPENAI_API_KEY / OPENAI_BASE_URL)');
    return false;
  }
  const dictionary = JSON.parse(readFileSync(dictionaryPath, 'utf8')) as DataDictionary;
  const summary = dictionary.tables
    .map((t) => `${t.name}: ${t.columns.map((c) => c.name).join(', ')}`)
    .join('\n');
  try {
    const response = await doFetch(
      `${(baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey ?? 'local'}`,
        },
        body: JSON.stringify({
          model: env.ALPONA_PLANNER_MODEL ?? 'gpt-5.4-mini',
          max_completion_tokens: 2048,
          messages: [
            {
              role: 'system',
              content:
                'For each database table, list 2-4 short synonyms a business user might say instead of the table name (e.g. shipment_performance → deliveries, late orders). Respond with a single JSON object and nothing else: {"tables": {"<table_name>": ["alias", …]}}',
            },
            { role: 'user', content: summary },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`enrichment call failed: ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? '';
    const start = text.indexOf('{');
    const parsed = JSON.parse(text.slice(start)) as { tables?: Record<string, string[]> };
    let enriched = 0;
    for (const table of dictionary.tables) {
      const aliases = parsed.tables?.[table.name];
      if (Array.isArray(aliases) && aliases.length > 0) {
        table.aliases = aliases.filter((a) => typeof a === 'string').slice(0, 6);
        enriched += 1;
      }
    }
    if (enriched > 0) {
      writeFileSync(dictionaryPath, JSON.stringify(dictionary, null, 2));
      log(`  ✚ aliases for ${enriched} tables`);
      return true;
    }
    return false;
  } catch (err) {
    log(`  ⊘ alias enrichment skipped (${err instanceof Error ? err.message : String(err)})`);
    return false;
  }
}
```

Create `packages/alpona-cli/test/aliases.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { enrichAliases } from '../src/commands/aliases.js';

function writeDict(path: string, tables: string[]) {
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      dialect: 'duckdb',
      generatedAt: new Date().toISOString(),
      tables: tables.map((name) => ({
        name,
        kind: 'table',
        columns: [{ name: 'id', type: 'integer' }],
      })),
    }),
  );
}

describe('enrichAliases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'alpona-aliases-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('no-ops when neither OPENAI_API_KEY nor OPENAI_BASE_URL is set', async () => {
    const dictPath = join(dir, 'd.json');
    writeDict(dictPath, ['orders']);
    const ok = await enrichAliases(dictPath, { env: {}, log: () => {} });
    expect(ok).toBe(false);
    const after = JSON.parse(readFileSync(dictPath, 'utf8')) as { tables: { aliases?: string[] }[] };
    expect(after.tables[0]!.aliases).toBeUndefined();
  });

  it('writes aliases when the model returns a valid JSON map', async () => {
    const dictPath = join(dir, 'd.json');
    writeDict(dictPath, ['shipment_performance']);
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"tables":{"shipment_performance":["deliveries","late orders","drops"]}}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof globalThis.fetch;
    const ok = await enrichAliases(dictPath, {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetch: fakeFetch,
      log: () => {},
    });
    expect(ok).toBe(true);
    const after = JSON.parse(readFileSync(dictPath, 'utf8')) as { tables: { aliases?: string[] }[] };
    expect(after.tables[0]!.aliases).toEqual(['deliveries', 'late orders', 'drops']);
  });

  it('swallows model failures without throwing', async () => {
    const dictPath = join(dir, 'd.json');
    writeDict(dictPath, ['orders']);
    const fakeFetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof globalThis.fetch;
    const ok = await enrichAliases(dictPath, {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetch: fakeFetch,
      log: () => {},
    });
    expect(ok).toBe(false);
  });
});
```

**Verify**: `pnpm --filter alpona-cli test` passes the new file.

### Step 2: Have `writeDictionary` call `enrichAliases` after writing

Edit `packages/alpona-cli/src/commands/dictionary.ts`. Add at the top of
the file:

```ts
import { enrichAliases } from './aliases.js';
```

Change `writeDictionary` to:

```ts
export interface WriteDictionaryOptions {
  log?: (line: string) => void;
  /** Skip the alias-enrichment call (used when callers run it themselves). */
  skipEnrichment?: boolean;
}

export async function writeDictionary(
  db: AdminDb,
  dir: string,
  options: WriteDictionaryOptions = {},
): Promise<string> {
  const dictionary = await buildDictionary(db, dir);
  const outDir = join(dir, 'dictionary');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'dictionary.json');
  writeFileSync(outPath, JSON.stringify(dictionary, null, 2) + '\n');
  if (!options.skipEnrichment) {
    await enrichAliases(outPath, { log: options.log });
  }
  return outPath;
}
```

Important: `writeDictionary` already has callers in
`init.ts:144`, `connect.ts:53`, and `cli.ts:293`. All three keep
working unchanged because the new options arg is optional.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Have `init.ts` use the shared function

Edit `packages/alpona-cli/src/commands/init.ts`. Remove the local
`enrichAliases` function (lines 63-122). Replace the import line at the
top with one that pulls in the shared version:

```ts
import { enrichAliases } from './aliases.js';
```

The call at line 150 stays roughly the same, but adapt to the new
signature:

```ts
const aliasesEnriched = await enrichAliases(dictionaryPath, { log });
```

Important: `init()` already calls `writeDictionary` at line 144 — under
the new `writeDictionary` default, that call now *also* enriches. Two
enrichment runs is wasteful (one network call, idempotent but wasted).
Suppress the duplicate by passing `skipEnrichment: true` to the
`writeDictionary` call in `init()` (the standalone enrichment below it
remains so the existing log line `  ✚ aliases for N tables` keeps
appearing in the init output):

```ts
dictionaryPath = await writeDictionary(db, datasetDir, { log, skipEnrichment: true });
…
const aliasesEnriched = await enrichAliases(dictionaryPath, { log });
```

**Verify**: `pnpm typecheck` exits 0. The existing test
`packages/alpona-cli/test/init.test.ts` still passes
(`pnpm --filter alpona-cli test`).

### Step 4: Manual smoke

Without a model key set, `alpona dictionary` should print the existing
"⊘ alias enrichment skipped" line, and the dictionary file should not
contain aliases beyond what was hand-authored.

```
unset OPENAI_API_KEY OPENAI_BASE_URL
ALPONA_DB=duckdb:./datasets/supply-chain/db/alpona.duckdb pnpm alpona migrate
pnpm alpona seed
pnpm alpona marts
pnpm alpona dictionary
```

The CLI output must include the `⊘` skip line. `git diff
datasets/supply-chain/db/dictionary/dictionary.json` should be empty (or
only differ in `generatedAt`).

If you have a local model server (LM Studio etc.), repeat with
`OPENAI_BASE_URL=http://localhost:1234/v1` exported; the `✚` log line
should appear.

### Step 5: Re-run the full guardrails

- `pnpm typecheck` → exit 0
- `pnpm test` → all pass (existing + new `aliases.test.ts`)
- `pnpm lint && pnpm format:check` → exit 0

## Test plan

- New file `aliases.test.ts`: three cases — no-key bail, happy path,
  network failure swallowed.
- Existing test `init.test.ts` still passes (it does not require a
  model; the `OPENAI_API_KEY` / `OPENAI_BASE_URL` are unset in the test
  env, so the enrichment call short-circuits exactly as before).
- Existing test `workflow.test.ts` still passes — exercises the full
  CLI workflow against a temp DuckDB without a model key.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; new test file passes
- [ ] `pnpm lint && pnpm format:check` exit 0
- [ ] `grep -n "async function enrichAliases" packages/alpona-cli/src/commands/init.ts`
      returns no matches (the local copy is gone)
- [ ] `grep -n "from './aliases.js'" packages/alpona-cli/src/commands/dictionary.ts packages/alpona-cli/src/commands/init.ts`
      returns one match per file
- [ ] `git diff --name-only` lists only the four files in the In-scope
      list above
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `init.ts` `enrichAliases` function has been modified since this
  plan was written (e.g. prompt changed, model fallback added) — port
  those changes into the shared module rather than reverting them.
- A third call site for the inline enrichment shows up (grep
  `OPENAI_API_KEY` in `packages/alpona-cli/src/`) and is materially
  different from the shared function — note it and stop.
- `connect.ts` uses `writeDictionary` in a context where enrichment is
  undesirable. Looking at `connect.ts:53` — the connect command runs
  against the user's database; enrichment is appropriate there. If
  that's not the case in the current code, pass `{skipEnrichment: true}`
  and surface the decision in your report.

## Maintenance notes

- The enrichment prompt is hand-rolled HTTP in `aliases.ts`; the agent
  package already has Anthropic and OpenAI backends with structured
  output handling. A follow-up plan can route enrichment through the
  agent surface (would need a new `enrichAliases` stage on the
  `AgentBackend` interface) so the prompt lives next to the others.
  Out of scope here.
- Aliases in the data dictionary are picked up by
  `packages/agent/src/retrieval/index.ts:47-55` automatically; no
  consumer-side change is needed.
- A reviewer should scrutinise that the dictionary file write is
  atomic-ish (today it's a single `writeFileSync`); concurrent CLI
  invocations are unsupported by design.
- The init flow now logs the `⊘` or `✚` line once, from the explicit
  `enrichAliases` call after `writeDictionary({skipEnrichment: true})`.
  A reviewer should confirm the log output isn't duplicated.
