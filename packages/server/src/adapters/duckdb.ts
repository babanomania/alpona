import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { Row } from '@alpona/core';
import type { DbAdapter, ExecuteOptions } from './types.js';

/**
 * In-process DuckDB adapter — the zero-Docker path. Opens the database
 * read-only so generated SQL cannot write even in principle.
 */
export class DuckDbAdapter implements DbAdapter {
  readonly dialect = 'duckdb' as const;

  private constructor(private readonly connection: DuckDBConnection) {}

  static async open(path: string): Promise<DuckDbAdapter> {
    const instance = await DuckDBInstance.create(path, { access_mode: 'READ_ONLY' });
    const connection = await instance.connect();
    return new DuckDbAdapter(connection);
  }

  async execute(sql: string, values: unknown[], options: ExecuteOptions): Promise<Row[]> {
    const work = (async () => {
      const reader = await this.connection.runAndReadAll(
        sql,
        values as Parameters<DuckDBConnection['runAndReadAll']>[1],
      );
      // JSON-safe values: BIGINT → number/string, DATE/TIMESTAMP → ISO strings.
      return reader.getRowObjectsJson() as Row[];
    })();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`query exceeded ${options.timeoutMs}ms timeout`)),
        options.timeoutMs,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    this.connection.closeSync();
  }
}
