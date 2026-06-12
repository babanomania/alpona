import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminDb } from '../db.js';
import { checksum } from '../checksum.js';

/**
 * Liquibase/Flyway-flavored migrations: ordered, immutable, checksummed.
 * Applied files are tracked in alpona_changelog; editing an applied
 * migration fails loudly — write a new one instead.
 *
 * Dialect-specific migrations declare themselves with a header line:
 *   -- alpona:dialect=postgres
 * and are recorded as skipped on other dialects.
 */

export interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
  dialect?: string;
}

export interface ChangelogRow {
  filename: string;
  checksum: string;
  applied_at: string;
}

const CHANGELOG_DDL = `CREATE TABLE IF NOT EXISTS alpona_changelog (
  filename VARCHAR PRIMARY KEY,
  checksum VARCHAR NOT NULL,
  applied_at TIMESTAMP NOT NULL
)`;

const DIALECT_DIRECTIVE = /^--\s*alpona:dialect=(\w+)\s*$/m;

export function readMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(join(dir, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((filename) => {
    const sql = readFileSync(join(dir, 'migrations', filename), 'utf8');
    return {
      filename,
      sql,
      checksum: checksum(sql),
      dialect: DIALECT_DIRECTIVE.exec(sql)?.[1],
    };
  });
}

export async function readChangelog(db: AdminDb): Promise<Map<string, ChangelogRow>> {
  await db.run(CHANGELOG_DDL);
  const rows = await db.query<ChangelogRow>(
    'SELECT filename, checksum, applied_at FROM alpona_changelog ORDER BY filename',
  );
  return new Map(rows.map((r) => [r.filename, r]));
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  alreadyApplied: number;
}

export async function migrate(db: AdminDb, dir: string): Promise<MigrateResult> {
  const migrations = readMigrations(dir);
  const changelog = await readChangelog(db);

  // Immutability gate first: refuse to do anything if history was edited.
  for (const migration of migrations) {
    const entry = changelog.get(migration.filename);
    if (entry && entry.checksum !== migration.checksum && entry.checksum !== 'skipped') {
      throw new Error(
        `migration ${migration.filename} was modified after being applied ` +
          `(checksum ${entry.checksum.slice(0, 12)}… → ${migration.checksum.slice(0, 12)}…). ` +
          'Applied migrations are immutable — add a new migration instead.',
      );
    }
  }

  const result: MigrateResult = { applied: [], skipped: [], alreadyApplied: 0 };
  for (const migration of migrations) {
    if (changelog.has(migration.filename)) {
      result.alreadyApplied++;
      continue;
    }
    if (migration.dialect && migration.dialect !== db.dialect) {
      await record(db, migration.filename, 'skipped');
      result.skipped.push(migration.filename);
      continue;
    }
    await db.run(migration.sql);
    await record(db, migration.filename, migration.checksum);
    result.applied.push(migration.filename);
  }
  return result;
}

async function record(db: AdminDb, filename: string, sum: string): Promise<void> {
  if (db.dialect === 'postgres') {
    await db.query(
      'INSERT INTO alpona_changelog (filename, checksum, applied_at) VALUES ($1, $2, NOW())',
      [filename, sum],
    );
  } else {
    await db.query(
      'INSERT INTO alpona_changelog (filename, checksum, applied_at) VALUES (?, ?, NOW())',
      [filename, sum],
    );
  }
}

export interface VerifyResult {
  ok: boolean;
  pending: string[];
  modified: string[];
  missing: string[];
}

/** Checksum + drift detection: CI fails when history and files disagree. */
export async function verify(db: AdminDb, dir: string): Promise<VerifyResult> {
  const migrations = readMigrations(dir);
  const changelog = await readChangelog(db);
  const byName = new Map(migrations.map((m) => [m.filename, m]));

  const pending = migrations.filter((m) => !changelog.has(m.filename)).map((m) => m.filename);
  const modified = [...changelog.values()]
    .filter((entry) => {
      const file = byName.get(entry.filename);
      return file && entry.checksum !== 'skipped' && entry.checksum !== file.checksum;
    })
    .map((entry) => entry.filename);
  const missing = [...changelog.keys()].filter((name) => !byName.has(name));

  return {
    ok: pending.length + modified.length + missing.length === 0,
    pending,
    modified,
    missing,
  };
}
