import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DashboardSpec, DataDictionary } from '@alpona/core';
import { interpret } from '@alpona/core';

export interface SavedDashboard {
  id: string;
  name: string;
  /** The natural-language prompt that produced it, when known. */
  prompt?: string;
  createdAt: string;
  spec: DashboardSpec;
  /** Auth subject of the creator ('anonymous' in playground mode). */
  owner?: string;
  /** Public dashboards are readable (and forkable) by anyone. */
  isPublic?: boolean;
  /** Dictionary identity at save time — gallery filtering + drift warnings. */
  dictionaryId?: string;
}

export interface DashboardSummary {
  id: string;
  name: string;
  prompt?: string;
  createdAt: string;
  title: string;
  widgetCount: number;
  owner?: string;
  isPublic?: boolean;
  dictionaryId?: string;
}

export interface SaveInput {
  name: string;
  spec: DashboardSpec;
  prompt?: string;
  owner?: string;
  isPublic?: boolean;
  dictionaryId?: string;
}

/**
 * Identity of a dictionary: dialect + a hash of its structural shape
 * (table/column names and types). Saved specs carry it so the gallery can
 * filter by source and warn when the schema has drifted under a spec.
 */
export function dictionaryId(dictionary: DataDictionary): string {
  const shape = dictionary.tables
    .map((t) => `${t.name}(${t.columns.map((c) => `${c.name}:${c.type}`).join(',')})`)
    .sort()
    .join(';');
  return `${dictionary.dialect}:${createHash('sha256').update(shape).digest('hex').slice(0, 12)}`;
}

/**
 * Persistence for saved dashboards. Specs are small JSON documents, so the
 * default backend is a plain directory of files — no database, no infra,
 * matching the bring-your-own-database philosophy. The Postgres backend
 * (Supabase deploy mode) implements the same interface.
 *
 * Visibility model, enforced by every backend: an entry is visible to its
 * owner and — when public — to everyone. `viewer` is the auth subject of
 * the requester.
 */
export interface DashboardStore {
  save(input: SaveInput): Promise<SavedDashboard>;
  get(id: string, viewer?: string): Promise<SavedDashboard | undefined>;
  list(viewer?: string): Promise<DashboardSummary[]>;
  delete(id: string, viewer?: string): Promise<boolean>;
  /** Copies a visible dashboard under a new id owned by the viewer. */
  fork(id: string, viewer?: string): Promise<SavedDashboard | undefined>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{4,40}$/;

function visibleTo(entry: SavedDashboard, viewer?: string): boolean {
  if (entry.isPublic) return true;
  if (entry.owner === undefined || viewer === undefined) return true; // pre-auth entries / single-user mode
  return entry.owner === viewer;
}

export class FileDashboardStore implements DashboardStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async save(input: SaveInput): Promise<SavedDashboard> {
    const saved: SavedDashboard = {
      id: randomBytes(6).toString('base64url'),
      name: input.name,
      prompt: input.prompt,
      createdAt: new Date().toISOString(),
      spec: input.spec,
      owner: input.owner,
      isPublic: input.isPublic,
      dictionaryId: input.dictionaryId,
    };
    this.write(saved);
    return saved;
  }

  async get(id: string, viewer?: string): Promise<SavedDashboard | undefined> {
    // The id doubles as a filename — reject anything path-shaped outright.
    if (!ID_PATTERN.test(id)) return undefined;
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as SavedDashboard;
      return visibleTo(saved, viewer) ? saved : undefined;
    } catch {
      return undefined;
    }
  }

  async list(viewer?: string): Promise<DashboardSummary[]> {
    const summaries: DashboardSummary[] = [];
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const saved = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as SavedDashboard;
        if (!visibleTo(saved, viewer)) continue;
        summaries.push({
          id: saved.id,
          name: saved.name,
          prompt: saved.prompt,
          createdAt: saved.createdAt,
          title: saved.spec.title,
          widgetCount: saved.spec.widgets.length,
          owner: saved.owner,
          isPublic: saved.isPublic,
          dictionaryId: saved.dictionaryId,
        });
      } catch {
        // skip unreadable entries — never let one bad file kill the list
      }
    }
    return summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async delete(id: string, viewer?: string): Promise<boolean> {
    if (!ID_PATTERN.test(id)) return false;
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return false;
    // Only the owner deletes; public visibility never grants deletion.
    const existing = await this.get(id, viewer);
    if (!existing) return false;
    if (existing.owner !== undefined && viewer !== undefined && existing.owner !== viewer) {
      return false;
    }
    rmSync(path);
    return true;
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

  /**
   * Idempotently loads canned reports from a directory of
   * `{name, prompt?, spec}` JSON files. Ids derive from filenames
   * (`seed-<basename>`), so seeded share URLs are stable across restarts
   * and re-seeds never duplicate. Specs that fail the interpreter gate are
   * skipped — a stale seed must not break boot.
   */
  seedFromDir(seedDir: string): number {
    if (!existsSync(seedDir)) return 0;
    let seeded = 0;
    for (const file of readdirSync(seedDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const id = `seed-${file.replace(/\.json$/, '').replaceAll(/[^A-Za-z0-9_-]/g, '-')}`;
      if (!ID_PATTERN.test(id) || existsSync(join(this.dir, `${id}.json`))) continue;
      try {
        const raw = JSON.parse(readFileSync(join(seedDir, file), 'utf8')) as {
          name?: string;
          prompt?: string;
          spec?: DashboardSpec;
        };
        if (!raw.name || !raw.spec || !interpret(raw.spec).ok) continue;
        this.write({
          id,
          name: raw.name,
          prompt: raw.prompt,
          createdAt: new Date().toISOString(),
          spec: raw.spec,
          // Curated seeds are everyone's starting points.
          isPublic: true,
        });
        seeded += 1;
      } catch {
        // skip malformed seed files
      }
    }
    return seeded;
  }

  private write(saved: SavedDashboard): void {
    writeFileSync(join(this.dir, `${saved.id}.json`), JSON.stringify(saved, null, 2));
  }
}
