/**
 * Admin database handle for alpona-db. Unlike the server's read-only
 * adapter, this one writes — it owns migrations, seeds, and marts.
 */

export type Dialect = 'postgres' | 'duckdb';

export interface AdminDb {
  readonly dialect: Dialect;
  /** Executes one or more statements (a whole migration file). */
  run(sql: string): Promise<void>;
  /** Runs a single query and returns rows. */
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function openAdminDb(connection: string): Promise<AdminDb> {
  if (connection.startsWith('duckdb:')) {
    return openDuckDb(connection.slice('duckdb:'.length));
  }
  if (connection.startsWith('postgres://') || connection.startsWith('postgresql://')) {
    return openPostgres(connection);
  }
  throw new Error(`unsupported connection string: ${connection.split(':')[0]}…`);
}

async function openDuckDb(path: string): Promise<AdminDb> {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  return {
    dialect: 'duckdb',
    async run(sql) {
      await conn.run(sql);
    },
    async query(sql, values = []) {
      const reader = await conn.runAndReadAll(sql, values as never);
      return reader.getRowObjectsJson() as never;
    },
    async close() {
      conn.closeSync();
    },
  };
}

async function openPostgres(connection: string): Promise<AdminDb> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: connection, max: 2 });
  return {
    dialect: 'postgres',
    async run(sql) {
      await pool.query(sql);
    },
    async query(sql, values = []) {
      const result = await pool.query(sql, values);
      return result.rows as never;
    },
    async close() {
      await pool.end();
    },
  };
}
