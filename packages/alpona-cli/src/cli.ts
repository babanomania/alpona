#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openAdminDb } from './db.js';
import { migrate, verify } from './commands/migrate.js';
import { seed } from './commands/seed.js';
import { marts } from './commands/marts.js';
import { writeDictionary } from './commands/dictionary.js';

const HELP = `alpona — the Alpona CLI: onboarding, data, and users

Usage: alpona <command> [--dir <db-dir>]

Commands:
  init        one command from clone to running data: migrate + seed +
              marts + dictionary (+ alias enrichment when a model is
              configured) + a starter-dashboard gallery + .env
              [--dataset supply-chain | ecommerce | saas-metrics]
  connect     <db-url> — introspect your own database, build a dictionary,
              register it as a source  [--name <name>]
  user add    <email> — provision a Supabase (GoTrue) user  [--password <pw>]
  user list   list provisioned users
  user remove <email> — delete a user
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
  --dir <path>         db project dir (default: datasets/supply-chain/db)
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

/** Reads a visible line from stdin (for non-secret prompts). */
async function promptPlain(label: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(label)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line from stdin with the echo suppressed (for passwords). */
async function promptHidden(label: string): Promise<string> {
  process.stdout.write(label);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  return await new Promise<string>((resolveInput) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      const code = chunk[0];
      if (code === 0x0d || code === 0x0a) {
        // Enter — finish the line
        stdin.setRawMode?.(wasRaw ?? false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolveInput(value);
      } else if (code === 0x03) {
        process.exit(1); // Ctrl-C
      } else if (code === 0x7f || code === 0x08) {
        value = value.slice(0, -1); // backspace / delete
      } else {
        value += chunk.toString('utf8');
      }
    };
    stdin.on('data', onData);
  });
}

/** Walks up from cwd to the pnpm workspace root (falls back to cwd). */
function workspaceRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return resolve(process.cwd());
    dir = parent;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === '--help' || command === 'help') {
    console.log(HELP);
    return;
  }

  loadDotEnv();

  // `init` is a setup wizard: create the sign-in account, then bring in
  // data (an example pack, or your own database). Flags make every step
  // scriptable (--user/--password, --dataset, --connect) for CI/Docker.
  if (command === 'init') {
    const root = workspaceRoot();
    const tty = process.stdin.isTTY;

    // ── Step 1 · account (only when auth is configured) ──────────────
    const authConfigured = Boolean(
      (process.env.ALPONA_AUTH_URL ?? process.env.GOTRUE_URL ?? process.env.ALPONA_AUTH_UPSTREAM) &&
      (process.env.ALPONA_JWT_SECRET ?? process.env.GOTRUE_JWT_SECRET),
    );
    if (authConfigured) {
      console.log('\nStep 1 · create your sign-in account');
      const email = arg('--user') ?? (tty ? await promptPlain('  email (blank to skip): ') : '');
      if (email.trim()) {
        const password =
          arg('--password') ?? (await promptHidden(`  password for ${email.trim()}: `));
        if (password.length < 6) {
          console.error('  ✗ password must be at least 6 characters — skipping');
        } else {
          const { addUser } = await import('./commands/users.js');
          const user = await addUser(email.trim(), password);
          console.log(`  ✓ ${user.email} created`);
        }
      }
    }

    // ── Step 2 · data: an example pack, or your own database ─────────
    console.log(authConfigured ? '\nStep 2 · bring in data' : '\nBring in data');
    const { availableDatasets } = await import('./commands/init.js');
    const datasets = availableDatasets(root);
    let connectUrl = arg('--connect');
    let dataset = arg('--dataset');

    if (!connectUrl && !dataset && tty) {
      console.log('  1) import an example dataset');
      console.log('  2) connect your own database');
      const choice = (await promptPlain('  choose [1/2, default 1]: ')).trim();
      if (choice === '2') {
        connectUrl = (await promptPlain('  database URL (postgres://… or duckdb:…): ')).trim();
      } else {
        datasets.forEach((d, i) => console.log(`     ${i + 1}. ${d}`));
        const pick = (await promptPlain(`  dataset [1-${datasets.length}, default 1]: `)).trim();
        dataset = datasets[Math.max(1, Number(pick) || 1) - 1] ?? datasets[0];
      }
    }

    if (connectUrl) {
      const { connect } = await import('./commands/connect.js');
      const entry = await connect(connectUrl, { name: arg('--name'), root });
      console.log(
        `  ✓ connected "${entry.name}" — ${entry.tables} tables, ${entry.starterSpecs} starter dashboards`,
      );
      console.log(
        `  explore: ALPONA_DB="${entry.db}" ALPONA_DICTIONARY="${entry.dictionaryPath}" ` +
          `ALPONA_SEED_REPORTS="${entry.reportsPath}" ALPONA_SOURCE_NAME="${entry.name}" pnpm dev`,
      );
    } else {
      const { init } = await import('./commands/init.js');
      const result = await init({ dataset: dataset ?? 'supply-chain', root, db: arg('--db') });
      console.log(`  ✓ ${result.starterSpecs} starter dashboards ready`);
    }

    console.log('\n✓ setup complete · run: pnpm dev');
    return;
  }
  if (command === 'connect') {
    const dbUrl = process.argv[3];
    if (!dbUrl || dbUrl.startsWith('--')) {
      console.error('✗ usage: alpona connect <db-url> [--name <name>]');
      process.exit(1);
    }
    const { connect } = await import('./commands/connect.js');
    const entry = await connect(dbUrl, { name: arg('--name'), root: workspaceRoot() });
    console.log(
      `✓ connected "${entry.name}" — ${entry.tables} tables (${entry.dialect}) · ` +
        `${entry.starterSpecs} starter dashboards generated`,
    );
    console.log(
      `  explore them: ALPONA_DB="${entry.db}" ALPONA_DICTIONARY="${entry.dictionaryPath}" ` +
        `ALPONA_SEED_REPORTS="${entry.reportsPath}" ALPONA_SOURCE_NAME="${entry.name}" pnpm dev`,
    );
    return;
  }
  if (command === 'user') {
    const sub = process.argv[3];
    const { addUser, listUsers, removeUser } = await import('./commands/users.js');
    if (sub === 'add') {
      const email = process.argv[4];
      if (!email || email.startsWith('--')) {
        console.error('✗ usage: alpona user add <email> [--password <pw>]');
        process.exit(1);
      }
      const password = arg('--password') ?? (await promptHidden(`password for ${email}: `));
      if (password.length < 6) {
        console.error('✗ password must be at least 6 characters');
        process.exit(1);
      }
      const user = await addUser(email, password);
      console.log(
        `✓ user "${user.email}" created (${user.id}) · they can now sign in to the studio`,
      );
    } else if (sub === 'list') {
      const users = await listUsers();
      if (users.length === 0) console.log('no users yet — alpona user add <email>');
      for (const u of users) console.log(`  ${u.email} (${u.id})`);
    } else if (sub === 'remove') {
      const email = process.argv[4];
      if (!email) {
        console.error('✗ usage: alpona user remove <email>');
        process.exit(1);
      }
      const removed = await removeUser(email);
      console.log(removed ? `✓ removed "${email}"` : `✗ no user "${email}"`);
    } else {
      console.error('✗ usage: alpona user <add|list|remove>');
      process.exit(1);
    }
    return;
  }

  const dir = resolve(arg('--dir') ?? process.env.ALPONA_DB_DIR ?? 'datasets/supply-chain/db');
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
