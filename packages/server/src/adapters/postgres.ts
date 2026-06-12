import pg from 'pg';
import type { Row } from '@alpona/core';
import type { DbAdapter, ExecuteOptions } from './types.js';

/**
 * Postgres adapter. Connects as the read-only `alpona_reader` role — the
 * database itself is the last line of defense even if every guardrail
 * above it failed.
 */
export class PostgresAdapter implements DbAdapter {
  readonly dialect = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      // Read-only at the session level, independent of the role's grants.
      options: '-c default_transaction_read_only=on',
    });
  }

  async execute(sql: string, values: unknown[], options: ExecuteOptions): Promise<Row[]> {
    const client = await this.pool.connect();
    try {
      await client.query(`SET statement_timeout = ${Math.floor(options.timeoutMs)}`);
      const result = await client.query(sql, values);
      return result.rows as Row[];
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
