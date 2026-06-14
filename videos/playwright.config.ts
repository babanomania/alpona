import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// videos/ is a sibling of packages/ — resolve the repo root for the dev servers.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dbFile = resolve(here, '.cache/demo.duckdb');

// Deterministic playground: the mock agent + a throwaway DuckDB seeded in
// global-setup. The dictionary + seed reports come from the supply-chain pack
// defaults, so we only override the database and force the mock backend.
const serverEnv: Record<string, string> = {
  ALPONA_MOCK: '1',
  AUTH_MODE: 'none',
  ALPONA_DB: `duckdb:${dbFile}`,
  ALPONA_PORT: '3001',
};

export default defineConfig({
  testDir: './tests',
  outputDir: './.cache/test-results',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
    // Record every test; the assembly step picks up the webm from .cache.
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    actionTimeout: 30_000,
  },
  webServer: [
    {
      command: 'pnpm --filter @alpona/server dev',
      cwd: root,
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: serverEnv,
    },
    {
      command: 'pnpm --filter alpona-studio dev',
      cwd: root,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
