import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DataDictionary } from '@alpona/core';
import { openAdminDb } from '../db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { marts } from './marts.js';
import { writeDictionary } from './dictionary.js';
import { generateStarterSpecs } from './starter-specs.js';

/**
 * `alpona init` — the one-command onboarding path: pick a dataset pack,
 * migrate + seed + marts + dictionary (with optional LLM alias
 * enrichment), generate starter specs with the mock agent, and write a
 * .env. Works with zero keys and zero Docker (DuckDB playground mode).
 */

export interface InitOptions {
  dataset: string;
  root: string;
  /** Admin connection override; defaults to an in-repo DuckDB file. */
  db?: string;
  log?: (line: string) => void;
}

export interface InitResult {
  datasetDir: string;
  dictionaryPath: string;
  starterSpecs: number;
  aliasesEnriched: boolean;
  envWritten: boolean;
}

/** Dataset packs live in datasets/ (target layout) or examples/ (legacy). */
export function resolveDatasetDir(root: string, dataset: string): string | undefined {
  for (const base of ['datasets', 'examples']) {
    const dir = join(root, base, dataset, 'db');
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

/** Names of the bundled dataset packs (any folder with a db/migrations dir). */
export function availableDatasets(root: string): string[] {
  const names = new Set<string>();
  for (const base of ['datasets', 'examples']) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(dir, entry.name, 'db', 'migrations'))) {
        names.add(entry.name);
      }
    }
  }
  return [...names].sort();
}

/**
 * D9b alias enrichment: one offline LLM call writes synonyms into the
 * dictionary so lexical retrieval can match the words users actually
 * use. Best-effort — init never fails because a model was unreachable.
 */
async function enrichAliases(dictionaryPath: string, log: (l: string) => void): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL;
  if (!apiKey && !baseUrl) {
    log('  ⊘ alias enrichment skipped (no OPENAI_API_KEY / OPENAI_BASE_URL)');
    return false;
  }
  const dictionary = JSON.parse(readFileSync(dictionaryPath, 'utf8')) as DataDictionary;
  const summary = dictionary.tables
    .map((t) => `${t.name}: ${t.columns.map((c) => c.name).join(', ')}`)
    .join('\n');
  try {
    const response = await fetch(
      `${(baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey ?? 'local'}`,
        },
        body: JSON.stringify({
          model: process.env.ALPONA_PLANNER_MODEL ?? 'gpt-5.4-mini',
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
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
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

export async function init(options: InitOptions): Promise<InitResult> {
  const log = options.log ?? console.log;
  const datasetDir = resolveDatasetDir(options.root, options.dataset);
  if (!datasetDir) {
    const available = availableDatasets(options.root);
    throw new Error(
      `dataset "${options.dataset}" not found. Available: ${available.join(', ') || '(none)'}`,
    );
  }

  const connection = options.db ?? `duckdb:${join(datasetDir, 'alpona.duckdb')}`;
  const db = await openAdminDb(connection);
  let dictionaryPath: string;
  try {
    const migrated = await migrate(db, datasetDir);
    log(`  ↑ migrate: ${migrated.applied.length} applied`);
    const seeded = await seed(db, datasetDir);
    log(`  ⤓ seed: ${seeded.tables.length} tables`);
    const views = await marts(db, datasetDir);
    log(`  ◫ marts: ${views.length} views`);
    dictionaryPath = await writeDictionary(db, datasetDir);
    log(`  ◈ dictionary → ${relative(options.root, dictionaryPath)}`);
  } finally {
    await db.close();
  }

  const aliasesEnriched = await enrichAliases(dictionaryPath, log);

  // The server seeds the gallery from the pack's reports/ dir on boot. A pack
  // that ships a curated gallery (any non-"starter-" report) is used as-is;
  // otherwise we generate a starter set with the mock agent for coverage.
  const reportsDir = join(datasetDir, '..', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const curated = readdirSync(reportsDir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('starter-'),
  );
  let starterCount = curated.length;
  if (curated.length > 0) {
    log(`  ▦ ${curated.length} curated reports (pack gallery) → ${relative(options.root, reportsDir)}`);
  } else {
    const dictionary = JSON.parse(readFileSync(dictionaryPath, 'utf8')) as DataDictionary;
    const starters = await generateStarterSpecs(dictionary);
    for (const starter of starters) {
      const layout = starter.spec.layout.split('@')[0];
      writeFileSync(join(reportsDir, `starter-${layout}.json`), JSON.stringify(starter, null, 2));
    }
    starterCount = starters.length;
    log(`  ▦ ${starters.length} starter specs → ${relative(options.root, reportsDir)}`);
  }

  // A .env only when none exists — never clobber configuration.
  const envPath = join(options.root, '.env');
  let envWritten = false;
  if (!existsSync(envPath)) {
    writeFileSync(
      envPath,
      [
        `ALPONA_DB=${connection}`,
        `ALPONA_DICTIONARY=${relative(options.root, dictionaryPath)}`,
        `ALPONA_SEED_REPORTS=${relative(options.root, reportsDir)}`,
        `ALPONA_SOURCE_NAME=${options.dataset}`,
        '# add ANTHROPIC_API_KEY or OPENAI_API_KEY for the live agent',
        '',
      ].join('\n'),
    );
    envWritten = true;
    log('  ✎ .env written');
  }

  return {
    datasetDir,
    dictionaryPath,
    starterSpecs: starterCount,
    aliasesEnriched,
    envWritten,
  };
}
