import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataDictionary, DictionaryColumn, DictionaryTable } from '@alpona/core';
import type { AdminDb } from '../db.js';

/**
 * Generates the data dictionary FROM the migrated schema — never
 * hand-drifted. Structure comes from information_schema; meaning comes
 * from `dictionary/semantics.json` (authored); statistics come from the
 * data itself. If a migration adds a column, regenerating picks it up
 * and the agent knows about it on the next generation.
 */

interface Semantics {
  tables?: Record<string, { description?: string; columns?: Record<string, string> }>;
}

const SAMPLE_CARDINALITY_LIMIT = 50;
// Alpona infrastructure tables are never part of the analytical surface:
// not in the dictionary, therefore never on the agent's query allowlist.
const INTERNAL_TABLES = new Set(['alpona_changelog', 'alpona_specs']);

export async function buildDictionary(db: AdminDb, dir: string): Promise<DataDictionary> {
  const schema = db.dialect === 'postgres' ? 'public' : 'main';
  const semantics = readSemantics(dir);

  const tables = await db.query<{ table_name: string; table_type: string }>(
    `SELECT table_name, table_type FROM information_schema.tables
     WHERE table_schema = '${schema}' ORDER BY table_name`,
  );

  const entries: DictionaryTable[] = [];
  for (const table of tables) {
    if (INTERNAL_TABLES.has(table.table_name)) continue;
    const tableSemantics = semantics.tables?.[table.table_name];

    const columns = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = '${table.table_name}'
       ORDER BY ordinal_position`,
    );

    const countRows = await db.query<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${table.table_name}`,
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
        const distinctRows = await db.query<{ n: number | string }>(
          `SELECT COUNT(DISTINCT ${column.column_name}) AS n FROM ${table.table_name}`,
        );
        entry.cardinality = Number(distinctRows[0]?.n ?? 0);
        if (entry.cardinality > 0 && entry.cardinality <= SAMPLE_CARDINALITY_LIMIT) {
          const samples = await db.query<Record<string, unknown>>(
            `SELECT DISTINCT ${column.column_name} AS v FROM ${table.table_name}
             WHERE ${column.column_name} IS NOT NULL ORDER BY 1 LIMIT 4`,
          );
          entry.samples = samples.map((s) => String(s.v));
        }
      }
      if (entry.description === undefined) delete entry.description;
      dictColumns.push(entry);
    }

    entries.push({
      name: table.table_name,
      kind: table.table_type === 'VIEW' ? 'mart' : 'table',
      description: tableSemantics?.description,
      rowCount: Number(rowCount),
      columns: dictColumns,
    });
  }

  // Marts first — the agent should reach for them before raw tables.
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'mart' ? -1 : 1,
  );

  return {
    version: 1,
    dialect: db.dialect,
    generatedAt: new Date().toISOString(),
    tables: entries,
  };
}

export async function writeDictionary(db: AdminDb, dir: string): Promise<string> {
  const dictionary = await buildDictionary(db, dir);
  const outDir = join(dir, 'dictionary');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'dictionary.json');
  writeFileSync(outPath, JSON.stringify(dictionary, null, 2) + '\n');
  return outPath;
}

function readSemantics(dir: string): Semantics {
  const path = join(dir, 'dictionary', 'semantics.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Semantics;
}
