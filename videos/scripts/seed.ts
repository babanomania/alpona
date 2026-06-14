import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// scripts/ → videos/ → repo root.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const root = resolve(pkg, '..');
const cache = resolve(pkg, '.cache');
const dbFile = resolve(cache, 'demo.duckdb');
const datasetDir = 'datasets/supply-chain/db';

/**
 * Seed a throwaway DuckDB with the supply-chain pack so the recording is
 * reproducible. Runs BEFORE `playwright test` (the server opens the database
 * read-only and cannot create it, and Playwright starts webServer before
 * globalSetup). Uses the prompt-free workflow commands — no wizard, no .env.
 */
export function seed(): string {
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });

  const conn = `duckdb:${dbFile}`;
  const env = { ...process.env, ALPONA_MOCK: '1' };
  for (const key of [
    'ALPONA_AUTH_URL',
    'ALPONA_AUTH_UPSTREAM',
    'GOTRUE_URL',
    'ALPONA_JWT_SECRET',
    'GOTRUE_JWT_SECRET',
  ]) {
    delete env[key];
  }

  for (const command of ['migrate', 'seed', 'marts', 'dictionary']) {
    execFileSync('pnpm', ['alpona', command, '--dir', datasetDir, '--db', conn], {
      cwd: root,
      stdio: 'inherit',
      env,
    });
  }
  return dbFile;
}

seed();
