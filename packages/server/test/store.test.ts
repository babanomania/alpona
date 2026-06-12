import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DashboardSpec } from '@alpona/core';
import { FileDashboardStore } from '../src/store/dashboards.js';
import { suggestPrompts } from '../src/suggest/suggestions.js';
import { testDictionary } from './helpers.js';

/** Minimal spec that passes the interpreter gate (mirrors mock output shape). */
function validSpec(title = 'Test board'): DashboardSpec {
  return {
    specVersion: 1,
    title,
    layout: 'single-widget@1',
    params: {},
    widgets: [
      {
        id: 'metric',
        slot: 'main',
        type: 'kpi_card',
        binding: { sql: 'SELECT 1 AS value', resultShape: { value: 'value' } },
        copy: { title: 'One', caption: null },
      },
    ],
  };
}

describe('FileDashboardStore', () => {
  it('saves, gets, and lists dashboards', async () => {
    const store = new FileDashboardStore(mkdtempSync(join(tmpdir(), 'alpona-store-')));
    const saved = await store.save({ name: 'Ops board', spec: validSpec(), prompt: 'ops stuff' });

    expect(saved.id).toMatch(/^[A-Za-z0-9_-]{4,40}$/);
    const roundTripped = await store.get(saved.id);
    expect(roundTripped?.name).toBe('Ops board');
    expect(roundTripped?.spec.title).toBe('Test board');

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Ops board', widgetCount: 1, prompt: 'ops stuff' });
  });

  it('rejects path-shaped ids', async () => {
    const store = new FileDashboardStore(mkdtempSync(join(tmpdir(), 'alpona-store-')));
    expect(await store.get('../../etc/passwd')).toBeUndefined();
    expect(await store.get('a/b')).toBeUndefined();
  });

  it('seeds canned reports idempotently with stable ids, skipping invalid specs', async () => {
    const seedDir = mkdtempSync(join(tmpdir(), 'alpona-seeds-'));
    writeFileSync(
      join(seedDir, 'ops-overview.json'),
      JSON.stringify({ name: 'Ops overview', prompt: 'ops', spec: validSpec() }),
    );
    writeFileSync(
      join(seedDir, 'broken.json'),
      JSON.stringify({ name: 'Broken', spec: { specVersion: 1, title: 'x' } }),
    );

    const store = new FileDashboardStore(mkdtempSync(join(tmpdir(), 'alpona-store-')));
    expect(store.seedFromDir(seedDir)).toBe(1);
    expect(store.seedFromDir(seedDir)).toBe(0); // idempotent

    const seeded = await store.get('seed-ops-overview');
    expect(seeded?.name).toBe('Ops overview');
  });
});

describe('suggestPrompts', () => {
  it('derives grounded suggestions from the dictionary marts', () => {
    const suggestions = suggestPrompts(testDictionary());
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    // Breakdown comes from carrier (low-cardinality) + delay_days (measure).
    expect(suggestions.join(' ')).toContain('carrier');
    // Exception list comes from the is_late boolean flag.
    expect(suggestions.some((s) => s.includes('late'))).toBe(true);
    // Deterministic: same dictionary, same suggestions.
    expect(suggestPrompts(testDictionary())).toEqual(suggestions);
  });
});
