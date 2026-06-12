import type { Row } from '@alpona/core';

export type Dialect = 'postgres' | 'duckdb';

export interface ExecuteOptions {
  /** Statement timeout in milliseconds. */
  timeoutMs: number;
}

export interface DbAdapter {
  readonly dialect: Dialect;
  /**
   * Executes a single parameterized SELECT. `values` bind positionally to
   * `$1…$n` (postgres) or `?` (duckdb) placeholders produced by the
   * guardrails layer — adapter code never sees raw param tokens.
   */
  execute(sql: string, values: unknown[], options: ExecuteOptions): Promise<Row[]>;
  close(): Promise<void>;
}

/** Creates the adapter matching an ALPONA_DB connection string. */
export async function createAdapter(connection: string): Promise<DbAdapter> {
  if (connection.startsWith('duckdb:')) {
    const { DuckDbAdapter } = await import('./duckdb.js');
    return DuckDbAdapter.open(connection.slice('duckdb:'.length));
  }
  if (connection.startsWith('postgres://') || connection.startsWith('postgresql://')) {
    const { PostgresAdapter } = await import('./postgres.js');
    return new PostgresAdapter(connection);
  }
  throw new Error(`unsupported ALPONA_DB connection string: ${connection.split(':')[0]}…`);
}
