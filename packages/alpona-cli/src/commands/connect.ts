import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataDictionary } from '@alpona/core';
import { openAdminDb } from '../db.js';
import { writeDictionary } from './dictionary.js';
import { generateStarterSpecs } from './starter-specs.js';

/**
 * `alpona connect <db-url>` — bring your own database (decision D6).
 * Introspects the database, builds a dictionary for it, and registers it
 * in the sources registry the server exposes as GET /sources. The
 * connection string stays in `.alpona/` server-side; the browser never
 * sees it.
 */

export interface SourceEntry {
  name: string;
  db: string;
  dialect: string;
  tables: number;
  dictionaryPath: string;
  /** Directory of generated starter dashboards for this source. */
  reportsPath: string;
  /** Count of starter dashboards generated against this schema. */
  starterSpecs: number;
  connectedAt: string;
}

function inferName(dbUrl: string): string {
  if (dbUrl.startsWith('duckdb:')) {
    const file = dbUrl.slice('duckdb:'.length).split('/').pop() ?? 'duckdb';
    return file.replace(/\.duckdb$/, '');
  }
  try {
    const parsed = new URL(dbUrl);
    return parsed.pathname.replace(/^\//, '') || parsed.hostname;
  } catch {
    return 'source';
  }
}

export async function connect(
  dbUrl: string,
  options: { name?: string; root: string },
): Promise<SourceEntry> {
  const name = (options.name ?? inferName(dbUrl)).replaceAll(/[^a-zA-Z0-9_-]/g, '-');
  const sourceDir = join(options.root, '.alpona/sources', name);
  mkdirSync(sourceDir, { recursive: true });

  const db = await openAdminDb(dbUrl);
  let dictionaryPath: string;
  try {
    dictionaryPath = await writeDictionary(db, sourceDir);
  } finally {
    await db.close();
  }

  const dictionary = JSON.parse(readFileSync(dictionaryPath, 'utf8')) as DataDictionary;

  // Bring-your-own-data users get the same explorable gallery: starter
  // dashboards generated against their schema (offline, via the mock).
  const reportsPath = join(sourceDir, 'reports');
  mkdirSync(reportsPath, { recursive: true });
  const starters = await generateStarterSpecs(dictionary);
  for (const starter of starters) {
    const layout = starter.spec.layout.split('@')[0];
    writeFileSync(join(reportsPath, `starter-${layout}.json`), JSON.stringify(starter, null, 2));
  }

  const entry: SourceEntry = {
    name,
    db: dbUrl,
    dialect: dictionary.dialect,
    tables: dictionary.tables.length,
    dictionaryPath,
    reportsPath,
    starterSpecs: starters.length,
    connectedAt: new Date().toISOString(),
  };

  const registryPath = join(options.root, '.alpona/sources.json');
  let registry: { sources: SourceEntry[] } = { sources: [] };
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { sources: SourceEntry[] };
    } catch {
      /* rebuild a corrupt registry */
    }
  }
  registry.sources = registry.sources.filter((s) => s.name !== name).concat(entry);
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return entry;
}
