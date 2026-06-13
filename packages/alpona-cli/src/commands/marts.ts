import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminDb } from '../db.js';

/**
 * dbt-flavored transforms: each `marts/*.sql` is a version-controlled
 * CREATE OR REPLACE VIEW — the analytical surface the agent binds to
 * first, raw tables second.
 */
export async function marts(db: AdminDb, dir: string): Promise<string[]> {
  const martsDir = join(dir, 'marts');
  if (!existsSync(martsDir)) return [];
  const files = readdirSync(martsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.run(readFileSync(join(martsDir, file), 'utf8'));
  }
  return files;
}
