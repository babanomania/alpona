import { defineConfig } from '@playwright/test';

// Records against the already-running Docker stack (auth + live OpenAI agent)
// on http://localhost:3001 — no dev server is launched here. Bring the stack
// up first:  cd deploy && docker compose -f docker-compose.yml \
//   -f docker-compose.auth.yml up -d
export default defineConfig({
  testDir: './tests',
  outputDir: './.cache/docker-results',
  // The live agent plans + binds several widgets and answers a question over
  // real OpenAI calls — give the whole walkthrough room.
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.ALPONA_TARGET ?? 'http://localhost:3001',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    actionTimeout: 60_000,
    // Save copies a share link to the clipboard.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
});
