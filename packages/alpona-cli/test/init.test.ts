import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DataDictionary } from '@alpona/core';
import { interpret, layoutTemplates, widgetDefinitions } from '@alpona/core';
import { openAdminDb } from '../src/db.js';
import { generateStarterSpecs } from '../src/commands/starter-specs.js';
import { connect } from '../src/commands/connect.js';

function dictionary(): DataDictionary {
  return {
    version: 1,
    dialect: 'duckdb',
    generatedAt: '2026-06-13T00:00:00Z',
    tables: [
      {
        name: 'shipment_performance',
        kind: 'mart',
        description: 'One row per shipment with delay metrics',
        columns: [
          { name: 'carrier', type: 'varchar', cardinality: 5 },
          { name: 'dispatched', type: 'date' },
          { name: 'delay_days', type: 'double' },
          { name: 'is_late', type: 'boolean' },
        ],
      },
    ],
  };
}

describe('generateStarterSpecs', () => {
  it('covers every layout and every widget type, all validated, zero LLM calls', async () => {
    const specs = await generateStarterSpecs(dictionary());
    // At least one starter per layout (a widget-gallery board may add one).
    expect(specs.length).toBeGreaterThanOrEqual(layoutTemplates.length);
    for (const starter of specs) {
      expect(interpret(starter.spec).ok).toBe(true);
      expect(starter.spec.widgets.length).toBeGreaterThan(0);
    }

    const layouts = new Set(specs.map((s) => s.spec.layout));
    for (const t of layoutTemplates) {
      expect(layouts.has(`${t.name}@${t.version}`)).toBe(true);
    }

    // The whole widget registry is exercised — this is the "explore
    // everything available" guarantee for new and BYO-data installs.
    const usedTypes = new Set(specs.flatMap((s) => s.spec.widgets.map((w) => w.type)));
    for (const def of widgetDefinitions) {
      expect(usedTypes.has(def.type)).toBe(true);
    }
  });
});

describe('connect', () => {
  it('introspects a database, writes a dictionary, and registers the source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'alpona-connect-'));
    const dbPath = join(root, 'mine.duckdb');
    const db = await openAdminDb(`duckdb:${dbPath}`);
    await db.run('CREATE TABLE orders (id INTEGER, amount DOUBLE, placed_at DATE)');
    await db.run("INSERT INTO orders VALUES (1, 9.5, DATE '2026-01-02')");
    await db.close();

    const entry = await connect(`duckdb:${dbPath}`, { root });
    expect(entry.name).toBe('mine');
    expect(entry.tables).toBeGreaterThanOrEqual(1);

    const registry = JSON.parse(readFileSync(join(root, '.alpona/sources.json'), 'utf8')) as {
      sources: { name: string }[];
    };
    expect(registry.sources.map((s) => s.name)).toContain('mine');

    const dict = JSON.parse(readFileSync(entry.dictionaryPath, 'utf8')) as DataDictionary;
    expect(dict.tables.map((t) => t.name)).toContain('orders');

    // Re-connect is idempotent: same name, no duplicate registry entries.
    await connect(`duckdb:${dbPath}`, { root });
    const again = JSON.parse(readFileSync(join(root, '.alpona/sources.json'), 'utf8')) as {
      sources: { name: string }[];
    };
    expect(again.sources.filter((s) => s.name === 'mine')).toHaveLength(1);
  });
});
