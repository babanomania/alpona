import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DashboardSpec } from '@alpona/core';
import { interpret } from '@alpona/core';

export interface SavedDashboard {
  id: string;
  name: string;
  /** The natural-language prompt that produced it, when known. */
  prompt?: string;
  createdAt: string;
  spec: DashboardSpec;
}

export interface DashboardSummary {
  id: string;
  name: string;
  prompt?: string;
  createdAt: string;
  title: string;
  widgetCount: number;
}

/**
 * Persistence for saved dashboards. Specs are small JSON documents, so the
 * default backend is a plain directory of files — no database, no infra,
 * matching the bring-your-own-database philosophy. A hosted backend
 * (Postgres, Supabase, …) only needs to implement this interface.
 */
export interface DashboardStore {
  save(input: { name: string; spec: DashboardSpec; prompt?: string }): Promise<SavedDashboard>;
  get(id: string): Promise<SavedDashboard | undefined>;
  list(): Promise<DashboardSummary[]>;
  delete(id: string): Promise<boolean>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{4,40}$/;

export class FileDashboardStore implements DashboardStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async save(input: {
    name: string;
    spec: DashboardSpec;
    prompt?: string;
  }): Promise<SavedDashboard> {
    const saved: SavedDashboard = {
      id: randomBytes(6).toString('base64url'),
      name: input.name,
      prompt: input.prompt,
      createdAt: new Date().toISOString(),
      spec: input.spec,
    };
    this.write(saved);
    return saved;
  }

  async get(id: string): Promise<SavedDashboard | undefined> {
    // The id doubles as a filename — reject anything path-shaped outright.
    if (!ID_PATTERN.test(id)) return undefined;
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as SavedDashboard;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<DashboardSummary[]> {
    const summaries: DashboardSummary[] = [];
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const saved = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as SavedDashboard;
        summaries.push({
          id: saved.id,
          name: saved.name,
          prompt: saved.prompt,
          createdAt: saved.createdAt,
          title: saved.spec.title,
          widgetCount: saved.spec.widgets.length,
        });
      } catch {
        // skip unreadable entries — never let one bad file kill the list
      }
    }
    return summaries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async delete(id: string): Promise<boolean> {
    if (!ID_PATTERN.test(id)) return false;
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
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
