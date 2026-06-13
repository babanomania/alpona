import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { DataDictionary } from '@alpona/core';
import { AlponaAgent, AnthropicAgent, MockAgent, OpenAiAgent } from '@alpona/agent';
import { loadConfig, loadDotEnv, workspaceRoot } from './env.js';
import { createAdapter } from './adapters/types.js';
import { QueryService } from './query/service.js';
import { FileDashboardStore } from './store/dashboards.js';
import { PostgresDashboardStore } from './store/postgres.js';
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
      '  run: pnpm alpona migrate && pnpm alpona seed && pnpm alpona marts && pnpm alpona dictionary',
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
    : new AnthropicAgent(dictionary, {
        apiKey: config.anthropicApiKey,
        plannerModel: config.plannerModel,
        binderModel: config.binderModel,
        copyModel: config.copyModel,
        dialect: adapter.dialect,
      });

let store;
if (config.specsDb) {
  const pgStore = new PostgresDashboardStore(config.specsDb);
  await pgStore.init();
  // Seed the starter/curated gallery as public samples so the explore
  // page is never empty in Supabase deploy mode.
  const seeded = await pgStore.seedFromDir(config.seedReportsDir);
  if (seeded > 0) console.log(`◈ seeded ${seeded} sample dashboard${seeded === 1 ? '' : 's'}`);
  store = pgStore;
} else {
  const fileStore = new FileDashboardStore(config.dataDir);
  const seeded = fileStore.seedFromDir(config.seedReportsDir);
  if (seeded > 0) console.log(`◈ seeded ${seeded} canned report${seeded === 1 ? '' : 's'}`);
  store = fileStore;
}

// Sources registry (written by `alpona connect`): extra databases the
// studio can switch between. The active ALPONA_DB is always source zero.
let sources: { name: string; dialect: string; tables: number }[] = [
  { name: config.sourceName, dialect: adapter.dialect, tables: dictionary.tables.length },
];
if (existsSync(config.sourcesPath)) {
  try {
    const registry = JSON.parse(readFileSync(config.sourcesPath, 'utf8')) as {
      sources?: { name: string; dialect: string; tables: number }[];
    };
    // D6: connection strings and paths stay server-side — project the
    // registry down to display fields before it goes anywhere near HTTP.
    sources = sources.concat(
      (registry.sources ?? [])
        .filter((s) => s.name !== config.sourceName)
        .map(({ name, dialect, tables }) => ({ name, dialect, tables })),
    );
  } catch {
    console.warn(`◈ could not read sources registry at ${config.sourcesPath} — ignoring`);
  }
}

// Curated prompt ideas ship with the dataset pack (prompts.json beside
// reports/); absent, the server derives suggestions from the dictionary.
let promptIdeas: { text: string; intent: 'ask' | 'build' }[] | undefined;
const promptsPath = join(config.seedReportsDir, '..', 'prompts.json');
if (existsSync(promptsPath)) {
  try {
    const pack = JSON.parse(readFileSync(promptsPath, 'utf8')) as {
      prompts?: { text: string; intent: 'ask' | 'build' }[];
    };
    promptIdeas = pack.prompts?.filter(
      (p) => p.text && (p.intent === 'ask' || p.intent === 'build'),
    );
  } catch {
    console.warn(`◈ could not read ${promptsPath} — using derived suggestions`);
  }
}

const app = buildApp({
  agent: new AlponaAgent({ backend, dictionary, executor: queryService }),
  queryService,
  dictionary,
  mock: config.mock,
  store,
  sources,
  promptIdeas,
  auth: {
    mode: config.authMode,
    apiKey: config.apiKey,
    issuer: config.oidcIssuer,
    audience: config.oidcAudience,
    jwksUrl: config.oidcJwksUrl,
    jwtSecret: config.jwtSecret,
  },
  authUrl: config.authUrl,
  authUpstream: config.authUpstream,
});

// Deploy mode: serve the built studio from the same origin, so the
// container exposes one port and the studio needs zero configuration.
if (config.studioDir && existsSync(config.studioDir)) {
  const rootRelative = relative(process.cwd(), config.studioDir);
  app.use('*', serveStatic({ root: rootRelative }));
  app.get('*', serveStatic({ path: join(rootRelative, 'index.html') }));
}

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
