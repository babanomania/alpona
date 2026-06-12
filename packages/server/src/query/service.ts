import { createHash } from 'node:crypto';
import type { DataDictionary, ParamValue, QueryResult, Row } from '@alpona/core';
import { allowedTables } from '@alpona/core';
import type { DbAdapter } from '../adapters/types.js';
import { prepareSql } from './guardrails.js';
import { QueryCache } from './cache.js';

export interface QueryServiceOptions {
  maxRows: number;
  timeoutMs: number;
  cacheTtlMs?: number;
}

/**
 * The query service: guardrails → cache → adapter, returning aggregates
 * only. Raw rows never leave this process beyond the enforced cap.
 */
export class QueryService {
  private readonly cache: QueryCache<QueryResult>;
  private readonly allowlist: ReadonlySet<string>;

  constructor(
    private readonly adapter: DbAdapter,
    dictionary: DataDictionary,
    private readonly options: QueryServiceOptions,
  ) {
    this.cache = new QueryCache(500, options.cacheTtlMs ?? 30_000);
    this.allowlist = allowedTables(dictionary);
  }

  async run(sql: string, params: Record<string, ParamValue>): Promise<QueryResult> {
    const safe = prepareSql(sql, params, {
      allowedTables: this.allowlist,
      dialect: this.adapter.dialect,
      maxRows: this.options.maxRows,
    });

    const key = createHash('sha256')
      .update(safe.sql)
      .update(JSON.stringify(safe.values))
      .digest('hex');

    const cached = this.cache.get(key);
    if (cached) return cached;

    const startedAt = performance.now();
    const rows = await this.adapter.execute(safe.sql, safe.values, {
      timeoutMs: this.options.timeoutMs,
    });
    const elapsedMs = Math.round(performance.now() - startedAt);

    const truncated = rows.length >= this.options.maxRows;
    const result: QueryResult = {
      rows: rows as Row[],
      columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
      elapsedMs,
      truncated,
    };
    this.cache.set(key, result);
    return result;
  }
}
