import type { DataDictionary, Row } from '@alpona/core';
import type { DbAdapter, ExecuteOptions } from '../src/adapters/types.js';

/** A dictionary mirroring the supply-chain example's marts. */
export function testDictionary(): DataDictionary {
  return {
    version: 1,
    dialect: 'duckdb',
    generatedAt: '2026-06-11T00:00:00Z',
    tables: [
      {
        name: 'shipment_performance',
        kind: 'mart',
        description: 'One row per shipment with delay metrics',
        rowCount: 5000,
        columns: [
          { name: 'shipment_id', type: 'integer' },
          { name: 'carrier', type: 'varchar', cardinality: 5, samples: ['Maersk', 'DHL'] },
          { name: 'dispatched', type: 'date' },
          { name: 'delay_days', type: 'double', description: 'positive = late' },
          { name: 'is_late', type: 'boolean' },
        ],
      },
      {
        name: 'stock_risk',
        kind: 'mart',
        description: 'SKU stock level vs reorder point',
        rowCount: 300,
        columns: [
          { name: 'sku', type: 'varchar', cardinality: 300 },
          { name: 'on_hand', type: 'integer' },
          { name: 'reorder_point', type: 'integer' },
          { name: 'days_of_cover', type: 'double' },
        ],
      },
    ],
  };
}

/**
 * Fake adapter: returns canned rows, records executed SQL, and can be
 * told to fail on matching SQL — which is how tests exercise self-heal.
 */
export class FakeAdapter implements DbAdapter {
  readonly dialect = 'duckdb' as const;
  readonly executed: { sql: string; values: unknown[] }[] = [];
  failPattern: RegExp | null = null;
  failMessage = 'relation does not exist';
  /** Set to pin exact rows; left null, rows are synthesized from SQL aliases. */
  rows: Row[] | null = null;

  async execute(sql: string, values: unknown[], _options: ExecuteOptions): Promise<Row[]> {
    this.executed.push({ sql, values });
    if (this.failPattern?.test(sql)) {
      throw new Error(this.failMessage);
    }
    if (this.rows) return this.rows;
    // Echo plausible columns: one row keyed by the query's AS aliases, so
    // resultShape ↔ column checks behave like a real database.
    const aliases = [...sql.matchAll(/\bAS\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1]!)
      .filter((a) => a !== 'alpona_capped');
    if (aliases.length > 0) {
      return [Object.fromEntries(aliases.map((a, i) => [a, i + 1]))];
    }
    return [{ value: 42 }];
  }

  async close(): Promise<void> {}
}
