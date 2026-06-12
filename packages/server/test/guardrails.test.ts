import { describe, expect, it } from 'vitest';
import { bindParams, prepareSql, SqlRejectedError } from '../src/query/guardrails.js';

const options = {
  allowedTables: new Set(['shipment_performance', 'stock_risk', 'warehouse_utilization', 'orders']),
  dialect: 'postgres' as const,
  maxRows: 1000,
};

function reason(fn: () => unknown): string {
  try {
    fn();
    return 'no-error';
  } catch (err) {
    return err instanceof SqlRejectedError ? err.reason : 'other';
  }
}

describe('prepareSql — statement gate', () => {
  it('accepts a plain SELECT against allowed tables', () => {
    const safe = prepareSql(
      'SELECT carrier, AVG(delay_days) FROM shipment_performance GROUP BY 1',
      {},
      options,
    );
    expect(safe.sql).toContain('shipment_performance');
    expect(safe.values).toEqual([]);
  });

  it('accepts CTEs and window functions', () => {
    const sql = `WITH ranked AS (
      SELECT carrier, delay_days, ROW_NUMBER() OVER (PARTITION BY carrier ORDER BY delay_days DESC) AS rn
      FROM shipment_performance
    ) SELECT carrier, delay_days FROM ranked WHERE rn <= 3`;
    expect(() => prepareSql(sql, {}, options)).not.toThrow();
  });

  it('rejects every write statement', () => {
    expect(reason(() => prepareSql('DELETE FROM orders', {}, options))).toBe('not-select');
    expect(reason(() => prepareSql('INSERT INTO orders VALUES (1)', {}, options))).toBe(
      'not-select',
    );
    expect(reason(() => prepareSql('UPDATE orders SET x = 1', {}, options))).toBe('not-select');
    expect(reason(() => prepareSql('DROP TABLE orders', {}, options))).not.toBe('no-error');
  });

  it('rejects multiple statements', () => {
    expect(
      reason(() => prepareSql('SELECT 1 FROM orders; SELECT 2 FROM orders', {}, options)),
    ).toBe('multiple-statements');
  });

  it('rejects unparseable garbage', () => {
    expect(reason(() => prepareSql('SELEKT * FORM orders', {}, options))).toBe('parse');
  });
});

describe('prepareSql — table allowlist', () => {
  it('rejects tables outside the dictionary', () => {
    expect(reason(() => prepareSql('SELECT * FROM users', {}, options))).toBe('table-not-allowed');
  });

  it('rejects system catalogs', () => {
    expect(reason(() => prepareSql('SELECT * FROM pg_catalog.pg_shadow', {}, options))).toBe(
      'table-not-allowed',
    );
    expect(reason(() => prepareSql('SELECT * FROM information_schema.tables', {}, options))).toBe(
      'table-not-allowed',
    );
  });

  it('rejects disallowed tables hidden in joins and subqueries', () => {
    expect(
      reason(() =>
        prepareSql('SELECT o.id FROM orders o JOIN secrets s ON s.id = o.id', {}, options),
      ),
    ).toBe('table-not-allowed');
    expect(
      reason(() =>
        prepareSql('SELECT * FROM orders WHERE id IN (SELECT id FROM secrets)', {}, options),
      ),
    ).toBe('table-not-allowed');
  });

  it('does not flag CTE names as tables', () => {
    const sql = 'WITH t AS (SELECT * FROM orders) SELECT * FROM t';
    expect(() => prepareSql(sql, {}, options)).not.toThrow();
  });
});

describe('prepareSql — function blocklist', () => {
  it('rejects pg_sleep and file-reading functions', () => {
    expect(reason(() => prepareSql('SELECT pg_sleep(10) FROM orders', {}, options))).toBe(
      'forbidden-function',
    );
    expect(
      reason(() => prepareSql("SELECT pg_read_file('/etc/passwd') FROM orders", {}, options)),
    ).toBe('forbidden-function');
  });

  it('rejects duckdb file readers', () => {
    expect(
      reason(() =>
        prepareSql("SELECT * FROM orders WHERE x = read_text('/etc/passwd')", {}, options),
      ),
    ).toBe('forbidden-function');
  });
});

describe('prepareSql — params become bound parameters', () => {
  it('replaces tokens with $n placeholders in order', () => {
    const safe = prepareSql(
      'SELECT * FROM orders WHERE created >= {{params.from}} AND region = {{params.region}}',
      { from: '2026-05-01', region: 'EU' },
      options,
    );
    expect(safe.sql).toContain('$1');
    expect(safe.sql).toContain('$2');
    expect(safe.sql).not.toContain('{{');
    expect(safe.values).toEqual(['2026-05-01', 'EU']);
  });

  it('uses ? placeholders for duckdb', () => {
    const safe = prepareSql(
      'SELECT * FROM orders WHERE created >= {{params.from}}',
      { from: '2026-05-01' },
      { ...options, dialect: 'duckdb' },
    );
    expect(safe.sql).toContain('?');
    expect(safe.values).toEqual(['2026-05-01']);
  });

  it('rejects params that were never declared', () => {
    expect(
      reason(() => prepareSql('SELECT * FROM orders WHERE x = {{params.nope}}', {}, options)),
    ).toBe('unknown-param');
  });

  it('never string-interpolates values — injection via param value is inert', () => {
    const safe = prepareSql(
      'SELECT * FROM orders WHERE region = {{params.region}}',
      { region: "'; DROP TABLE orders; --" },
      options,
    );
    expect(safe.sql).not.toContain('DROP');
    expect(safe.values[0]).toContain('DROP TABLE'); // delivered as data, not SQL
  });
});

describe('prepareSql — row cap', () => {
  it('wraps queries without a LIMIT', () => {
    const safe = prepareSql('SELECT * FROM orders', {}, options);
    expect(safe.sql).toMatch(/LIMIT 1000/);
  });

  it('respects an existing LIMIT within the cap', () => {
    const safe = prepareSql('SELECT * FROM orders LIMIT 50', {}, options);
    expect(safe.sql.match(/LIMIT/g)).toHaveLength(1);
    expect(safe.sql).toContain('LIMIT 50');
  });

  it('caps an oversized LIMIT', () => {
    const safe = prepareSql('SELECT * FROM orders LIMIT 999999', {}, options);
    expect(safe.sql).toMatch(/\) AS alpona_capped LIMIT 1000/);
  });

  it('strips trailing semicolons before wrapping', () => {
    const safe = prepareSql('SELECT * FROM orders;', {}, options);
    expect(safe.sql).not.toMatch(/;\s*\n\) AS/);
  });
});

describe('bindParams', () => {
  it('binds repeated tokens as separate positional values', () => {
    const bound = bindParams(
      'SELECT * FROM t WHERE a >= {{params.from}} OR b >= {{params.from}}',
      { from: '2026-01-01' },
      'postgres',
    );
    expect(bound.sql).toContain('$1');
    expect(bound.sql).toContain('$2');
    expect(bound.values).toEqual(['2026-01-01', '2026-01-01']);
  });
});
