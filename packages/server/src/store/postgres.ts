import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { DashboardSpec } from '@alpona/core';
import { interpret } from '@alpona/core';
import type { DashboardStore, DashboardSummary, SavedDashboard, SaveInput } from './dashboards.js';

/**
 * Postgres-backed spec store — the Supabase deploy mode (decision D3).
 * Supabase is just Postgres here: point ALPONA_SPECS_DB at the instance
 * and run supabase/0001_specs.sql (table + RLS for direct Supabase-client
 * access). The server connects with its own role and enforces the same
 * ownership rules in SQL, so the visibility model holds on any Postgres.
 */
export class PostgresDashboardStore implements DashboardStore {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  /** Creates the table when absent — self-hosted convenience; Supabase
   *  users run the checked-in migration to get RLS policies as well. */
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS alpona_specs (
        id text PRIMARY KEY,
        name text NOT NULL,
        prompt text,
        owner text,
        is_public boolean NOT NULL DEFAULT false,
        dictionary_id text,
        spec jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  /**
   * Idempotently loads canned/starter reports as PUBLIC samples — owned
   * by a 'samples' sentinel so every signed-in user sees them but no one
   * can delete them, and is_public so they list regardless of viewer.
   * Stable seed-<file> ids make re-seeding a no-op (ON CONFLICT). This is
   * what makes the explore gallery non-empty in Supabase deploy mode.
   */
  async seedFromDir(seedDir: string): Promise<number> {
    if (!existsSync(seedDir)) return 0;
    let seeded = 0;
    for (const file of readdirSync(seedDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const id = `seed-${file.replace(/\.json$/, '').replaceAll(/[^A-Za-z0-9_-]/g, '-')}`;
      try {
        const raw = JSON.parse(readFileSync(join(seedDir, file), 'utf8')) as {
          name?: string;
          prompt?: string;
          spec?: DashboardSpec;
        };
        if (!raw.name || !raw.spec || !interpret(raw.spec).ok) continue;
        const { rowCount } = await this.pool.query(
          `INSERT INTO alpona_specs (id, name, prompt, owner, is_public, spec)
           VALUES ($1, $2, $3, 'samples', true, $4)
           ON CONFLICT (id) DO NOTHING`,
          [id, raw.name, raw.prompt ?? null, JSON.stringify(raw.spec)],
        );
        seeded += rowCount ?? 0;
      } catch {
        // skip malformed seed files
      }
    }
    return seeded;
  }

  async save(input: SaveInput): Promise<SavedDashboard> {
    const id = randomBytes(6).toString('base64url');
    const { rows } = await this.pool.query<{ created_at: Date }>(
      `INSERT INTO alpona_specs (id, name, prompt, owner, is_public, dictionary_id, spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at`,
      [
        id,
        input.name,
        input.prompt ?? null,
        input.owner ?? null,
        input.isPublic ?? false,
        input.dictionaryId ?? null,
        JSON.stringify(input.spec),
      ],
    );
    return {
      id,
      name: input.name,
      prompt: input.prompt,
      createdAt: rows[0]!.created_at.toISOString(),
      spec: input.spec,
      owner: input.owner,
      isPublic: input.isPublic,
      dictionaryId: input.dictionaryId,
    };
  }

  async get(id: string, viewer?: string): Promise<SavedDashboard | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM alpona_specs
       WHERE id = $1 AND (is_public OR owner IS NULL OR $2::text IS NULL OR owner = $2)`,
      [id, viewer ?? null],
    );
    return rows[0] ? toSaved(rows[0] as SpecRow) : undefined;
  }

  async list(viewer?: string): Promise<DashboardSummary[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM alpona_specs
       WHERE is_public OR owner IS NULL OR $1::text IS NULL OR owner = $1
       ORDER BY created_at ASC`,
      [viewer ?? null],
    );
    return (rows as SpecRow[]).map((row) => {
      const saved = toSaved(row);
      return {
        id: saved.id,
        name: saved.name,
        prompt: saved.prompt,
        createdAt: saved.createdAt,
        title: saved.spec.title,
        widgetCount: saved.spec.widgets.length,
        owner: saved.owner,
        isPublic: saved.isPublic,
        dictionaryId: saved.dictionaryId,
      };
    });
  }

  async delete(id: string, viewer?: string): Promise<boolean> {
    // Only the owner deletes; public visibility never grants deletion.
    const { rowCount } = await this.pool.query(
      `DELETE FROM alpona_specs
       WHERE id = $1 AND (owner IS NULL OR $2::text IS NULL OR owner = $2)`,
      [id, viewer ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  async fork(id: string, viewer?: string): Promise<SavedDashboard | undefined> {
    const source = await this.get(id, viewer);
    if (!source) return undefined;
    return this.save({
      name: `Copy of ${source.name}`.slice(0, 80),
      spec: source.spec,
      prompt: source.prompt,
      owner: viewer,
      dictionaryId: source.dictionaryId,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface SpecRow {
  id: string;
  name: string;
  prompt: string | null;
  owner: string | null;
  is_public: boolean;
  dictionary_id: string | null;
  spec: DashboardSpec;
  created_at: Date;
}

function toSaved(row: SpecRow): SavedDashboard {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt ?? undefined,
    createdAt: row.created_at.toISOString(),
    spec: row.spec,
    owner: row.owner ?? undefined,
    isPublic: row.is_public,
    dictionaryId: row.dictionary_id ?? undefined,
  };
}
