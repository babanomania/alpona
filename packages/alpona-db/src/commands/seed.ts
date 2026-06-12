import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AdminDb } from '../db.js';
import { parseCsv } from '../csv.js';

/**
 * dbt-flavored seeds: data-as-code, idempotent. Run order:
 *   1. `seeds/pre.sql`     — optional; clears dependent tables in
 *                            FK-safe order so re-seeding always works
 *   2. `seeds/<table>.csv` — each fully replaces that table's contents
 *   3. `seeds/seed.sql`    — deterministic synthetic generators
 */

export interface SeedResult {
  tables: { table: string; rows: number }[];
  ranPreSql: boolean;
  ranSeedSql: boolean;
}

export async function seed(db: AdminDb, dir: string): Promise<SeedResult> {
  const seedsDir = join(dir, 'seeds');
  const result: SeedResult = { tables: [], ranPreSql: false, ranSeedSql: false };
  if (!existsSync(seedsDir)) return result;

  const preSqlPath = join(seedsDir, 'pre.sql');
  if (existsSync(preSqlPath)) {
    await db.run(readFileSync(preSqlPath, 'utf8'));
    result.ranPreSql = true;
  }

  const csvFiles = readdirSync(seedsDir)
    .filter((f) => f.endsWith('.csv'))
    .sort();
  for (const file of csvFiles) {
    const table = basename(file, '.csv');
    const { header, rows } = parseCsv(readFileSync(join(seedsDir, file), 'utf8'));
    await db.run(`DELETE FROM ${ident(table)}`);
    await insertRows(db, table, header, rows);
    result.tables.push({ table, rows: rows.length });
  }

  const seedSqlPath = join(seedsDir, 'seed.sql');
  if (existsSync(seedSqlPath)) {
    await db.run(readFileSync(seedSqlPath, 'utf8'));
    result.ranSeedSql = true;
  }
  return result;
}

function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
}

async function insertRows(
  db: AdminDb,
  table: string,
  header: string[],
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  const columns = header.map(ident).join(', ');
  const batchSize = 200;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const tuples = batch
      .map((row) => {
        const placeholders = row.map((cell) => {
          values.push(cell === '' ? null : cell);
          return db.dialect === 'postgres' ? `$${values.length}` : '?';
        });
        return `(${placeholders.join(', ')})`;
      })
      .join(', ');
    await db.query(`INSERT INTO ${ident(table)} (${columns}) VALUES ${tuples}`, values);
  }
}
