#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openAdminDb } from './db.js';
import { migrate, verify } from './commands/migrate.js';
import { seed } from './commands/seed.js';
import { marts } from './commands/marts.js';
import { writeDictionary } from './commands/dictionary.js';

const HELP = `alpona-db — database workflow for Alpona implementations

Usage: alpona-db <command> [--dir <db-dir>]

Commands:
  migrate     apply pending migrations (tracked in alpona_changelog)
  seed        load seeds/*.csv and seeds/seed.sql, idempotent
  marts       (re)create analytical views from marts/*.sql
  dictionary  regenerate the data dictionary from the live schema
  verify      checksums + drift detection against migrations

Connection (first match wins):
  --db <conn>          postgres://… or duckdb:<path>
  ALPONA_DB_ADMIN      admin connection (postgres)
  ALPONA_DB            falls back to the runtime connection (duckdb)

Directory:
  --dir <path>         db project dir (default: examples/supply-chain/db)
  ALPONA_DB_DIR        same, via environment
`;

function loadDotEnv(): void {
  for (const candidate of ['.env', '../../.env']) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path);
      } catch {
        /* explicit env wins */
      }
      return;
    }
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === '--help' || command === 'help') {
    console.log(HELP);
    return;
  }

  loadDotEnv();
  const dir = resolve(arg('--dir') ?? process.env.ALPONA_DB_DIR ?? 'examples/supply-chain/db');
  const connection = arg('--db') ?? process.env.ALPONA_DB_ADMIN ?? process.env.ALPONA_DB ?? '';
  if (!connection) {
    console.error('✗ no connection: set --db, ALPONA_DB_ADMIN, or ALPONA_DB');
    process.exit(1);
  }
  if (!existsSync(dir)) {
    console.error(`✗ db directory not found: ${dir}`);
    process.exit(1);
  }

  const db = await openAdminDb(connection);
  try {
    switch (command) {
      case 'migrate': {
        const result = await migrate(db, dir);
        for (const f of result.applied) console.log(`  ↑ ${f}`);
        for (const f of result.skipped) console.log(`  ⊘ ${f} (other dialect)`);
        console.log(
          `✓ migrate: ${result.applied.length} applied, ${result.skipped.length} skipped, ${result.alreadyApplied} already applied`,
        );
        break;
      }
      case 'seed': {
        const result = await seed(db, dir);
        if (result.ranPreSql) console.log('  ⤓ pre.sql (cleared dependents)');
        for (const t of result.tables) console.log(`  ⤓ ${t.table}: ${t.rows} rows`);
        if (result.ranSeedSql) console.log('  ⤓ seed.sql (synthetic generators)');
        console.log('✓ seed complete');
        break;
      }
      case 'marts': {
        const files = await marts(db, dir);
        for (const f of files) console.log(`  ◫ ${f}`);
        console.log(`✓ marts: ${files.length} views (re)created`);
        break;
      }
      case 'dictionary': {
        const path = await writeDictionary(db, dir);
        const dictionary = JSON.parse(readFileSync(path, 'utf8')) as { tables: unknown[] };
        console.log(`✓ dictionary: ${dictionary.tables.length} tables → ${path}`);
        break;
      }
      case 'verify': {
        const result = await verify(db, dir);
        for (const f of result.pending) console.log(`  ? pending: ${f}`);
        for (const f of result.modified) console.log(`  ✗ modified after apply: ${f}`);
        for (const f of result.missing) console.log(`  ✗ applied but file missing: ${f}`);
        if (!result.ok) {
          console.error('✗ verify failed');
          process.exitCode = 1;
        } else {
          console.log('✓ verify: schema and migrations agree');
        }
        break;
      }
      default:
        console.error(`✗ unknown command "${command}"\n`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
