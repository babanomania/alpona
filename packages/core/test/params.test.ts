import { describe, expect, it } from 'vitest';
import { extractParams, paramsInSql, widgetsAffectedBy } from '../src/engine/params.js';
import type { DashboardSpec } from '../src/types.js';

describe('paramsInSql', () => {
  it('finds params, deduplicated, tolerating whitespace', () => {
    const sql =
      'SELECT * FROM t WHERE a >= {{params.from}} AND b <= {{ params.to }} AND a >= {{params.from}}';
    expect(paramsInSql(sql)).toEqual(['from', 'to']);
  });

  it('returns empty for SQL without params', () => {
    expect(paramsInSql('SELECT 1')).toEqual([]);
  });
});

function specWith(params: DashboardSpec['params']): DashboardSpec {
  return {
    specVersion: 1,
    title: 'T',
    layout: 'single-widget@1',
    params,
    widgets: [
      {
        id: 'w1',
        slot: 'main',
        type: 'table',
        binding: {
          sql: 'SELECT * FROM s WHERE d >= {{params.from}} AND w = {{params.warehouse}}',
          resultShape: {},
        },
        copy: { title: null, caption: null },
      },
      {
        id: 'w2',
        slot: 'main',
        type: 'table',
        binding: { sql: 'SELECT * FROM s WHERE d >= {{params.from}}', resultShape: {} },
        copy: { title: null, caption: null },
      },
    ],
  };
}

describe('extractParams', () => {
  it('infers control types and tracks usage', () => {
    const params = extractParams(specWith({ from: '2026-05-01', warehouse: 'ALL', limit: 10 }));
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(byName.from!.control).toBe('date');
    expect(byName.warehouse!.control).toBe('text');
    expect(byName.limit!.control).toBe('number');
    expect(byName.from!.usedBy).toEqual(['w1', 'w2']);
    expect(byName.warehouse!.usedBy).toEqual(['w1']);
    expect(byName.limit!.usedBy).toEqual([]);
  });

  it('surfaces params referenced in SQL but missing from spec.params', () => {
    const params = extractParams(specWith({ from: '2026-05-01' }));
    const missing = params.find((p) => p.name === 'warehouse');
    expect(missing).toBeDefined();
    expect(missing!.defaultValue).toBe('');
  });
});

describe('widgetsAffectedBy', () => {
  it('returns only widgets whose SQL references a changed param', () => {
    const spec = specWith({ from: '2026-05-01', warehouse: 'ALL' });
    expect(widgetsAffectedBy(spec, ['warehouse'])).toEqual(new Set(['w1']));
    expect(widgetsAffectedBy(spec, ['from'])).toEqual(new Set(['w1', 'w2']));
    expect(widgetsAffectedBy(spec, ['unused'])).toEqual(new Set());
  });
});
