import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAdminDb, type AdminDb } from '../src/db.js';
import { migrate, verify } from '../src/commands/migrate.js';
import { seed } from '../src/commands/seed.js';
import { marts } from '../src/commands/marts.js';
import { buildDictionary } from '../src/commands/dictionary.js';

/**
 * End-to-end workflow against a real (temp) DuckDB database — the same
 * engine the no-Docker quickstart uses.
 */

let dir: string;
let db: AdminDb;

function write(path: string, content: string) {
  writeFileSync(join(dir, path), content);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'alpona-db-'));
  mkdirSync(join(dir, 'migrations'));
  mkdirSync(join(dir, 'seeds'));
  mkdirSync(join(dir, 'marts'));
  mkdirSync(join(dir, 'dictionary'));

  write(
    'migrations/0001_create_suppliers.sql',
    'CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, country VARCHAR);',
  );
  write(
    'migrations/0002_create_orders.sql',
    `CREATE TABLE orders (
       id INTEGER PRIMARY KEY,
       supplier_id INTEGER NOT NULL,
       ordered_at DATE NOT NULL,
       amount DOUBLE NOT NULL
     );`,
  );
  write(
    'migrations/0003_roles.sql',
    '-- alpona:dialect=postgres\nCREATE ROLE alpona_reader_test_role;',
  );
  write('seeds/suppliers.csv', 'id,name,country\n1,"Acme, Ltd",IN\n2,Globex,DE\n');
  write(
    'seeds/seed.sql',
    `DELETE FROM orders;
     INSERT INTO orders (id, supplier_id, ordered_at, amount)
     SELECT i, 1 + (i % 2), DATE '2026-01-01' + CAST(i % 90 AS INTEGER), 100 + (i % 7) * 10
     FROM generate_series(1, 50) AS t(i);`,
  );
  write(
    'marts/order_volume.sql',
    `CREATE OR REPLACE VIEW order_volume AS
     SELECT s.name AS supplier, COUNT(*) AS orders, SUM(o.amount) AS total
     FROM orders o JOIN suppliers s ON s.id = o.supplier_id
     GROUP BY 1;`,
  );
  write(
    'dictionary/semantics.json',
    JSON.stringify({
      tables: {
        order_volume: {
          description: 'Order volume per supplier',
          columns: { total: 'Total order value' },
        },
      },
    }),
  );

  db = await openAdminDb(`duckdb:${join(dir, 'test.duckdb')}`);
});

afterEach(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrate', () => {
  it('applies pending migrations in order and records them', async () => {
    const result = await migrate(db, dir);
    expect(result.applied).toEqual(['0001_create_suppliers.sql', '0002_create_orders.sql']);
    expect(result.skipped).toEqual(['0003_roles.sql']);

    const again = await migrate(db, dir);
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toBe(3);
  });

  it('refuses to run when an applied migration was edited', async () => {
    await migrate(db, dir);
    write('migrations/0001_create_suppliers.sql', 'CREATE TABLE suppliers (id INTEGER);');
    await expect(migrate(db, dir)).rejects.toThrow(/immutable/);
  });

  it('skips other-dialect migrations without executing them', async () => {
    await migrate(db, dir);
    const roles = await db.query(
      "SELECT checksum FROM alpona_changelog WHERE filename = '0003_roles.sql'",
    );
    expect(roles[0]!.checksum).toBe('skipped');
  });
});

describe('verify', () => {
  it('passes on a clean state and reports drift precisely', async () => {
    await migrate(db, dir);
    expect((await verify(db, dir)).ok).toBe(true);

    write('migrations/0004_new.sql', 'CREATE TABLE pending_table (id INTEGER);');
    const withPending = await verify(db, dir);
    expect(withPending.ok).toBe(false);
    expect(withPending.pending).toEqual(['0004_new.sql']);

    rmSync(join(dir, 'migrations', '0004_new.sql'));
    write('migrations/0002_create_orders.sql', 'CREATE TABLE orders (id INTEGER);');
    const withModified = await verify(db, dir);
    expect(withModified.modified).toEqual(['0002_create_orders.sql']);
  });
});

describe('seed', () => {
  it('loads CSVs idempotently and runs synthetic generators', async () => {
    await migrate(db, dir);
    const first = await seed(db, dir);
    expect(first.tables).toEqual([{ table: 'suppliers', rows: 2 }]);
    expect(first.ranSeedSql).toBe(true);

    await seed(db, dir); // idempotent
    const suppliers = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM suppliers');
    expect(Number(suppliers[0]!.n)).toBe(2);
    const orders = await db.query<{ o: number }>('SELECT COUNT(*) AS o FROM orders');
    expect(Number(orders[0]!.o)).toBe(50);
  });

  it('preserves quoted values through the pipeline', async () => {
    await migrate(db, dir);
    await seed(db, dir);
    const rows = await db.query<{ name: string }>('SELECT name FROM suppliers WHERE id = 1');
    expect(rows[0]!.name).toBe('Acme, Ltd');
  });
});

describe('marts + dictionary', () => {
  it('creates views and the dictionary reflects schema, semantics, and stats', async () => {
    await migrate(db, dir);
    await seed(db, dir);
    const created = await marts(db, dir);
    expect(created).toEqual(['order_volume.sql']);

    const dictionary = await buildDictionary(db, dir);
    expect(dictionary.dialect).toBe('duckdb');

    const names = dictionary.tables.map((t) => t.name);
    expect(names).toContain('suppliers');
    expect(names).toContain('orders');
    expect(names).toContain('order_volume');
    expect(names).not.toContain('alpona_changelog');

    const mart = dictionary.tables.find((t) => t.name === 'order_volume')!;
    expect(mart.kind).toBe('mart');
    expect(mart.description).toBe('Order volume per supplier');
    expect(mart.columns.find((c) => c.name === 'total')!.description).toBe('Total order value');
    // marts sort before raw tables — the agent reaches for them first
    expect(dictionary.tables[0]!.kind).toBe('mart');

    const suppliers = dictionary.tables.find((t) => t.name === 'suppliers')!;
    expect(suppliers.rowCount).toBe(2);
    const country = suppliers.columns.find((c) => c.name === 'country')!;
    expect(country.cardinality).toBe(2);
    expect(country.samples).toEqual(['DE', 'IN']);
  });

  it('picks up new columns on regeneration — schema and dictionary cannot disagree', async () => {
    await migrate(db, dir);
    await seed(db, dir);
    const before = await buildDictionary(db, dir);
    expect(before.tables.find((t) => t.name === 'suppliers')!.columns).toHaveLength(3);

    write('migrations/0004_add_tier.sql', 'ALTER TABLE suppliers ADD COLUMN tier VARCHAR;');
    await migrate(db, dir);
    const after = await buildDictionary(db, dir);
    expect(after.tables.find((t) => t.name === 'suppliers')!.columns.map((c) => c.name)).toContain(
      'tier',
    );
  });
});
