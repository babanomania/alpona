import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import type { DataDictionary } from '@alpona/core';
import { loadConfig, loadDotEnv, workspaceRoot } from './env.js';
import { createAdapter } from './adapters/types.js';
import { QueryService } from './query/service.js';
import { Pipeline } from './agent/pipeline.js';
import { LiveAgent } from './agent/live.js';
import { OpenAiAgent } from './agent/openai.js';
import { MockAgent } from './agent/mock.js';
import { FileDashboardStore } from './store/dashboards.js';
import { buildApp } from './app.js';

loadDotEnv();
const config = loadConfig();
const root = workspaceRoot();

// Relative duckdb paths (e.g. from .env) resolve against the workspace
// root, so the server starts correctly from any package directory.
if (config.db.startsWith('duckdb:')) {
  const path = config.db.slice('duckdb:'.length);
  if (!isAbsolute(path)) config.db = `duckdb:${join(root, path)}`;
}

const dictionaryPath = isAbsolute(config.dictionaryPath)
  ? config.dictionaryPath
  : resolve(root, config.dictionaryPath);
let dictionary: DataDictionary;
try {
  dictionary = JSON.parse(readFileSync(dictionaryPath, 'utf8')) as DataDictionary;
} catch {
  console.error(
    `✗ could not read the data dictionary at ${dictionaryPath}\n` +
      '  run: pnpm alpona-db migrate && pnpm alpona-db seed && pnpm alpona-db marts && pnpm alpona-db dictionary',
  );
  process.exit(1);
}

const adapter = await createAdapter(config.db);
const queryService = new QueryService(adapter, dictionary, {
  maxRows: config.maxRows,
  timeoutMs: config.queryTimeoutMs,
});

const backend = config.mock
  ? new MockAgent(dictionary)
  : config.provider === 'openai'
    ? new OpenAiAgent(dictionary, {
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        plannerModel: config.plannerModel,
        binderModel: config.binderModel,
        copyModel: config.copyModel,
        dialect: adapter.dialect,
      })
    : new LiveAgent(dictionary, {
        apiKey: config.anthropicApiKey,
        plannerModel: config.plannerModel,
        binderModel: config.binderModel,
        copyModel: config.copyModel,
        dialect: adapter.dialect,
      });

const store = new FileDashboardStore(config.dataDir);
const seeded = store.seedFromDir(config.seedReportsDir);
if (seeded > 0) console.log(`◈ seeded ${seeded} canned report${seeded === 1 ? '' : 's'}`);

const app = buildApp({
  pipeline: new Pipeline(backend, queryService),
  queryService,
  dictionary,
  mock: config.mock,
  store,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `◈ alpona server on http://localhost:${info.port}` +
      ` — ${adapter.dialect} · ${dictionary.tables.length} tables · ${
        config.mock
          ? 'MOCK agent (set ANTHROPIC_API_KEY or OPENAI_API_KEY for live)'
          : `live agent (${config.provider} · ${config.binderModel})`
      }`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void adapter.close().finally(() => process.exit(0));
  });
}
