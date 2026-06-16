# Plan 005: Quote SQL identifiers in the dictionary builder so `alpona connect` is safe against hostile schemas

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 06ebd68..HEAD -- packages/alpona-cli/src/commands/dictionary.ts packages/alpona-cli/src/commands/seed.ts packages/alpona-cli/src/db.ts packages/alpona-cli/test/`
> If any of those files changed, re-read them and re-confirm the
> "Current state" excerpts before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (the affected code introspects untrusted databases;
  changing how identifiers are quoted across two dialects must not break
  the existing supply-chain / ecommerce / saas-metrics CI runs)
- **Depends on**: 001 (for a green typecheck baseline)
- **Category**: security
- **Planned at**: commit `06ebd68`, 2026-06-17

## Why this matters

`packages/alpona-cli/src/commands/dictionary.ts` builds the data dictionary
by introspecting the target database via `information_schema` and then
running follow-up queries that **interpolate the discovered identifiers
straight into SQL**:

```ts
const tables = await db.query<{ table_name: string; table_type: string }>(
  `SELECT table_name, table_type FROM information_schema.tables
   WHERE table_schema = '${schema}' ORDER BY table_name`,
);
…
const columns = await db.query(`SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = '${schema}' AND table_name = '${table.table_name}'
  ORDER BY ordinal_position`);
…
const countRows = await db.query(`SELECT COUNT(*) AS n FROM ${table.table_name}`);
…
const distinctRows = await db.query(
  `SELECT COUNT(DISTINCT ${column.column_name}) AS n FROM ${table.table_name}`,
);
…
const samples = await db.query(
  `SELECT DISTINCT ${column.column_name} AS v FROM ${table.table_name}
   WHERE ${column.column_name} IS NOT NULL ORDER BY 1 LIMIT 4`,
);
```

For the bundled datasets this is fine — the migrations and seeds ship
identifiers that match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. The concrete attack
surface is `alpona connect <db-url>`, the "bring your own data" path
(`packages/alpona-cli/src/commands/connect.ts:42-93`). A user pointed at
an attacker-controlled Postgres can be given a database with a table
named, for example, `x"; CREATE TABLE pwned (...); --` — Postgres allows
arbitrary characters inside quoted identifiers. The interpolated query
then becomes a multi-statement SQL injection executed by the **admin**
connection (`openAdminDb` in `packages/alpona-cli/src/db.ts`), which is
the user's local credential, not the read-only role.

The threat model is narrow (user has to choose to connect to a hostile
database) but real, and the fix is mechanical: quote every identifier
using dialect-correct rules, and reject identifiers that contain the
dialect's quote character.

## Current state

### Files involved

- `packages/alpona-cli/src/commands/dictionary.ts:23-92` — the
  interpolation sites. Lines 27-30 (schema), 38-40 (schema + table),
  43-44 (table), 56-58 (column + table), 61-63 (column + table). Six
  distinct interpolation patterns to fix.
- `packages/alpona-cli/src/db.ts:1-62` — defines `AdminDb` with
  `dialect: 'postgres' | 'duckdb'` and a `query(sql, values?)` method.
  Postgres binds with `$1, $2, …`; DuckDB with `?`.
- `packages/alpona-cli/src/commands/seed.ts:50-77` — has its own
  half-solution: an `ident()` helper that validates an identifier with
  a regex but **does not quote**. Don't refactor seed.ts in this plan,
  but read it to see the existing pattern and the gap.
- `packages/alpona-cli/src/commands/connect.ts:42-93` — the entrypoint
  that makes this remotely reachable. No edits needed here, but the
  trust boundary lives here.

### Bind capability of `AdminDb.query`

The `query` interface (line 13 in `db.ts`) accepts a values array, used
for the `INSERT INTO alpona_changelog … VALUES ($1, $2, NOW())` in
`migrate.ts:102-110`. Use it for the schema/table/column name **string
comparisons** inside `WHERE` clauses. Use safe quoting for places where
the identifier itself must be inlined (FROM, SELECT, COUNT DISTINCT —
SQL does not allow identifier placeholders).

### Project conventions

- The CLI's existing `ident()` helper (`seed.ts:50-52`) demonstrates the
  intent: validate with a regex, fail loudly on bad input. We extend
  this with quoting and dialect awareness. Keep the helper named
  `quoteIdent` (or similar) and put it in a shared module so seed.ts and
  dictionary.ts can both adopt it.
- The CLI's error style is `throw new Error(<message>)` — see
  `db.ts:25` and `migrate.ts:75`. Match that.
- Code lives in TS strict mode under `tsconfig.base.json` with
  `noUncheckedIndexedAccess: true`.
- Existing tests in `packages/alpona-cli/test/workflow.test.ts` and
  `init.test.ts` exercise the migrate/seed/dictionary path against a
  temp DuckDB file. That's the pattern to follow for the new tests.

## Commands you will need

| Purpose                         | Command                                          | Expected                  |
|---------------------------------|--------------------------------------------------|---------------------------|
| Typecheck                       | `pnpm typecheck`                                 | exit 0                    |
| Tests (all)                     | `pnpm test`                                      | all pass                  |
| Tests (CLI only)                | `pnpm --filter alpona-cli test`                  | all pass                  |
| Lint / format                   | `pnpm lint && pnpm format:check`                 | exit 0                    |
| Manual smoke (bundled dataset)  | See step 4                                       | dictionary still builds   |

## Scope

**In scope** (the only files you should modify):
- `packages/alpona-cli/src/identifiers.ts` (NEW — the quoting helper)
- `packages/alpona-cli/src/commands/dictionary.ts` (use the helper)
- `packages/alpona-cli/test/identifiers.test.ts` (NEW — unit test for
  the helper)
- `packages/alpona-cli/test/dictionary.test.ts` (NEW — integration
  test exercising the build against a DuckDB with hostile-looking
  identifiers)

**Out of scope** (do NOT touch, even though they look related):
- `packages/alpona-cli/src/commands/seed.ts` — the same gap exists,
  but the CSV-driven seed pipeline has different invariants and a
  different trust boundary. File a follow-up plan; do not refactor
  seed.ts here.
- `packages/server/src/query/guardrails.ts` — the runtime AST gate is
  not the issue; the issue is the build-time dictionary command running
  with admin credentials.
- `packages/alpona-cli/src/db.ts` — `AdminDb` is the right abstraction;
  do not widen its interface.

## Git workflow

- Branch: `advisor/005-quote-dictionary-identifiers`
- Commit style: `fix(cli): quote SQL identifiers in dictionary builder`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a dialect-aware identifier quoter

Create `packages/alpona-cli/src/identifiers.ts`:

```ts
import type { Dialect } from './db.js';

/**
 * Quote a SQL identifier for safe inlining. Both supported dialects use
 * double-quoted identifiers (Postgres SQL standard; DuckDB follows it).
 * An identifier that contains the dialect's quote character is rejected —
 * neither Postgres nor DuckDB lets you produce a string literal where the
 * data is also the closing delimiter, so escaping a double-quote is OK
 * in principle, but for the dictionary builder we already validate input
 * before quoting: reject anything carrying a quote.
 */
export function quoteIdent(name: string, dialect: Dialect): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`empty SQL identifier`);
  }
  if (name.includes('"') || name.includes(' ')) {
    throw new Error(`refusing to quote identifier containing a quote or NUL: ${JSON.stringify(name)}`);
  }
  // Both Postgres and DuckDB use double-quoted identifiers; the dialect
  // arg stays so a future MySQL adapter can swap to backticks here
  // without touching every caller.
  void dialect;
  return `"${name}"`;
}

/**
 * For places where the identifier must be quoted into a string literal
 * (WHERE table_name = 'foo'). Doubles embedded single quotes.
 */
export function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
```

Create `packages/alpona-cli/test/identifiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { quoteIdent, quoteString } from '../src/identifiers.js';

describe('quoteIdent', () => {
  it('double-quotes safe identifiers in both dialects', () => {
    expect(quoteIdent('orders', 'postgres')).toBe('"orders"');
    expect(quoteIdent('orders', 'duckdb')).toBe('"orders"');
  });
  it('rejects identifiers containing a quote', () => {
    expect(() => quoteIdent('x"; DROP TABLE y; --', 'postgres')).toThrow(/refusing to quote/);
  });
  it('rejects empty identifiers', () => {
    expect(() => quoteIdent('', 'postgres')).toThrow(/empty/);
  });
});

describe('quoteString', () => {
  it('escapes embedded single quotes', () => {
    expect(quoteString("a'b")).toBe("'a''b'");
  });
});
```

**Verify**:
- `pnpm typecheck` exits 0
- `pnpm --filter alpona-cli test` runs and the new test file passes

### Step 2: Rewrite `dictionary.ts` to use the quoter and parameter binding

Edit `packages/alpona-cli/src/commands/dictionary.ts`. Add imports at
the top:

```ts
import { quoteIdent, quoteString } from '../identifiers.js';
```

Then rewrite the six interpolation sites. The schema name comes from a
fixed string (`'public'` for Postgres, `'main'` for DuckDB) so it never
needs untrusted handling — but use `quoteString` for the comparison and
`quoteIdent` for any future inline use anyway (defence in depth).

The patched `buildDictionary` core looks like this:

```ts
export async function buildDictionary(db: AdminDb, dir: string): Promise<DataDictionary> {
  const schema = db.dialect === 'postgres' ? 'public' : 'main';
  const semantics = readSemantics(dir);

  const tables = await db.query<{ table_name: string; table_type: string }>(
    // Schema name is server-internal; bind it as a parameter anyway.
    db.dialect === 'postgres'
      ? `SELECT table_name, table_type FROM information_schema.tables
         WHERE table_schema = $1 ORDER BY table_name`
      : `SELECT table_name, table_type FROM information_schema.tables
         WHERE table_schema = ? ORDER BY table_name`,
    [schema],
  );

  const entries: DictionaryTable[] = [];
  for (const table of tables) {
    if (INTERNAL_TABLES.has(table.table_name)) continue;
    const tableSemantics = semantics.tables?.[table.table_name];

    const columns = await db.query<{ column_name: string; data_type: string }>(
      db.dialect === 'postgres'
        ? `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`
        : `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [schema, table.table_name],
    );

    const quotedTable = quoteIdent(table.table_name, db.dialect);

    const countRows = await db.query<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${quotedTable}`,
    );
    const rowCount = countRows[0]?.n ?? 0;

    const dictColumns: DictionaryColumn[] = [];
    for (const column of columns) {
      const entry: DictionaryColumn = {
        name: column.column_name,
        type: column.data_type.toLowerCase(),
        description: tableSemantics?.columns?.[column.column_name],
      };
      if (/char|text/i.test(column.data_type)) {
        const quotedColumn = quoteIdent(column.column_name, db.dialect);
        const distinctRows = await db.query<{ n: number | string }>(
          `SELECT COUNT(DISTINCT ${quotedColumn}) AS n FROM ${quotedTable}`,
        );
        entry.cardinality = Number(distinctRows[0]?.n ?? 0);
        if (entry.cardinality > 0 && entry.cardinality <= SAMPLE_CARDINALITY_LIMIT) {
          const samples = await db.query<Record<string, unknown>>(
            `SELECT DISTINCT ${quotedColumn} AS v FROM ${quotedTable}
             WHERE ${quotedColumn} IS NOT NULL ORDER BY 1 LIMIT 4`,
          );
          entry.samples = samples.map((s) => String(s.v));
        }
      }
      if (entry.description === undefined) delete entry.description;
      dictColumns.push(entry);
    }
    // …rest unchanged…
  }
  // …rest unchanged…
}
```

Key constraints:
- Every `WHERE` filter against a name is now parameter-bound.
- Every place a name must appear as an identifier (FROM, COUNT DISTINCT,
  SELECT … AS v) is wrapped with `quoteIdent`.
- The `quoteString` helper isn't used in this step but is available for
  any place that needs a literal string in SQL going forward; leave it
  exported.

Run typecheck:

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Add an integration test that exercises hostile-looking names

Create `packages/alpona-cli/test/dictionary.test.ts`. Use the same
DuckDB-temp-file pattern used in `packages/alpona-cli/test/workflow.test.ts`
(read that file first to follow the project's conventions for creating
and cleaning up temp DBs).

The test must:

1. Open a temp DuckDB instance.
2. Create a table whose identifier contains characters that, without
   quoting, would inject SQL — for example: a column named
   `n'value` (single quote) and a normal table name like `weird_data`.
   Important: DO NOT use names that contain `"` (the quoter rejects
   those, and the test would fail at quote time — which is also a
   correct outcome you can assert separately).
3. Call `buildDictionary` against the temp DB.
4. Assert that the returned dictionary lists the table and column with
   the unmodified names (no escape sequences, no truncation).
5. Negative case: try `buildDictionary` against a DB where a column name
   contains `"` and assert it throws with the "refusing to quote"
   message — proving the safe-rejection path.

Example skeleton (adapt to match `workflow.test.ts` for temp-DB setup):

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAdminDb } from '../src/db.js';
import { buildDictionary } from '../src/commands/dictionary.js';

describe('buildDictionary against unusual identifiers', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'alpona-dict-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('handles identifiers containing single quotes without injection', async () => {
    const dbPath = join(dir, 'test.duckdb');
    const db = await openAdminDb(`duckdb:${dbPath}`);
    try {
      // The identifier contains a single quote — would inject without
      // proper handling of the WHERE comparison.
      await db.run(`CREATE TABLE "weird_data" ("n'value" VARCHAR);`);
      await db.run(`INSERT INTO "weird_data" VALUES ('one'), ('two');`);
      const dict = await buildDictionary(db, dir);
      const t = dict.tables.find((t) => t.name === 'weird_data');
      expect(t).toBeDefined();
      expect(t!.columns.map((c) => c.name)).toContain("n'value");
    } finally {
      await db.close();
    }
  });

  it("refuses to quote an identifier containing a double quote", async () => {
    const dbPath = join(dir, 'reject.duckdb');
    const db = await openAdminDb(`duckdb:${dbPath}`);
    try {
      // DuckDB allows arbitrary identifier characters via double-quoted
      // literals — our quoter rejects identifiers carrying a quote.
      await db.run(`CREATE TABLE "bad" ("a""quote" VARCHAR);`);
      await expect(buildDictionary(db, dir)).rejects.toThrow(/refusing to quote/);
    } finally {
      await db.close();
    }
  });
});
```

**Verify**: `pnpm --filter alpona-cli test` passes the new file.

### Step 4: Manual smoke against a bundled dataset

Run the existing CI-style dataset build end-to-end to confirm no
regression:

```
ALPONA_DB=duckdb:./datasets/supply-chain/db/alpona.duckdb pnpm alpona migrate
pnpm alpona seed
pnpm alpona marts
pnpm alpona dictionary
pnpm alpona verify
```

**Verify**:
- `datasets/supply-chain/db/dictionary/dictionary.json` is regenerated.
- `pnpm alpona verify` says `✓ verify: schema and migrations agree`.
- `git diff datasets/supply-chain/db/dictionary/dictionary.json` is
  empty (or only differs in `generatedAt`).

### Step 5: Re-run the full guardrails

- `pnpm typecheck` → exit 0
- `pnpm test` → all pass; new tests count toward the total
- `pnpm lint` → exit 0
- `pnpm format:check` → exit 0

## Test plan

- `identifiers.test.ts` — 3 cases (safe, quote-bearing reject, empty
  reject).
- `dictionary.test.ts` — 2 integration cases (single-quote-bearing
  identifier round-trips through introspection; double-quote-bearing
  identifier is refused).
- Existing CLI tests (`workflow.test.ts`, `init.test.ts`) must keep
  passing — those exercise the supply-chain pack which has clean
  identifiers.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -nE "FROM \\$\\{|SELECT.*\\$\\{|WHERE.*table_name = '\\$\\{" packages/alpona-cli/src/commands/dictionary.ts`
      returns no matches (the old interpolation patterns are gone)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; new test files pass
- [ ] `pnpm lint && pnpm format:check` exit 0
- [ ] `pnpm alpona dictionary` regenerates the bundled supply-chain
      dictionary without errors
- [ ] `git diff --name-only` shows only:
  - `packages/alpona-cli/src/identifiers.ts` (new)
  - `packages/alpona-cli/src/commands/dictionary.ts`
  - `packages/alpona-cli/test/identifiers.test.ts` (new)
  - `packages/alpona-cli/test/dictionary.test.ts` (new)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- DuckDB's `runAndReadAll` does not accept positional `?` placeholders
  for the `information_schema` queries — check the docs for the local
  version of `@duckdb/node-api`. If positional bind isn't supported
  there, the parameter-bound `information_schema` queries can stay
  inlined with `quoteString(schema)` (which is safe for `'public'` /
  `'main'`); report this and adjust.
- The `dictionary.test.ts` cases hang or DuckDB errors with a cryptic
  message on identifier creation — that may be a DuckDB version
  difference. Surface it; do not weaken the test to make it pass.
- You discover any other file in the repo doing string interpolation of
  user-controlled identifiers into SQL (e.g. in `connect.ts` or in a
  new file added since this plan was written). Note it; fixing it is
  out of scope here.

## Maintenance notes

- The same pattern (validate + quote) should be applied to `seed.ts`'s
  `ident()` helper (`seed.ts:50-52`). The trust boundary there is
  different (CSV files in dataset packs the maintainer ships), but
  defense-in-depth is the principle. Open as a follow-up plan; explicit
  out-of-scope here.
- If MySQL or another dialect is added in the future, `quoteIdent` needs
  a branch for backticks. The `void dialect` line in the helper is a
  reminder.
- A reviewer should scrutinise that no interpolation site was missed
  (grep for `FROM ${` and `SELECT ${` in `dictionary.ts`), and that
  `information_schema` filters bind via `$1`/`?` rather than string
  inlining.
- Anyone who has used `alpona connect <db-url>` against a non-trusted
  source before this fix landed should treat their local admin
  credentials as potentially exposed; nothing personal escaped the
  machine, but commands could have run on the local DB.
