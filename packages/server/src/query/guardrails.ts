import pkg from 'node-sql-parser';
import type { ParamValue } from '@alpona/core';
import { PARAM_TOKEN } from '@alpona/core';
import type { Dialect } from '../adapters/types.js';

const { Parser } = pkg;
const parser = new Parser();

/**
 * The AST gate. Agent-generated SQL crosses a trust boundary and is
 * treated as hostile input:
 *
 *   1. parses with a real SQL parser — no regex security theater
 *   2. single statement, SELECT-only (CTEs and windows welcome)
 *   3. every referenced table must be in the dictionary allowlist
 *   4. dangerous function calls are rejected outright
 *   5. `{{params.*}}` resolve to bound parameters, never interpolation
 *   6. a row LIMIT is enforced on the way out
 *
 * Layered below this: statement timeouts, the read-only database role.
 */

export class SqlRejectedError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'parse'
      | 'not-select'
      | 'multiple-statements'
      | 'table-not-allowed'
      | 'forbidden-function'
      | 'unknown-param',
  ) {
    super(message);
    this.name = 'SqlRejectedError';
  }
}

const FORBIDDEN_FUNCTIONS = new Set([
  // postgres escape hatches
  'pg_sleep',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'lo_import',
  'lo_export',
  'dblink',
  'dblink_exec',
  'copy_from',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'set_config',
  'current_setting',
  'query_to_xml',
  // duckdb escape hatches
  'read_csv',
  'read_csv_auto',
  'read_parquet',
  'read_json',
  'read_json_auto',
  'read_text',
  'read_blob',
  'glob',
  'getenv',
  'install',
  'load',
]);

export interface SafeQuery {
  /** SQL with params replaced by dialect placeholders and LIMIT enforced. */
  sql: string;
  /** Positional values for the placeholders. */
  values: ParamValue[];
}

/** Replaces `{{params.x}}` tokens with bound-parameter placeholders. */
export function bindParams(
  sql: string,
  params: Record<string, ParamValue>,
  dialect: Dialect,
): { sql: string; values: ParamValue[] } {
  const values: ParamValue[] = [];
  const bound = sql.replace(PARAM_TOKEN, (_match, name: string) => {
    if (!(name in params)) {
      throw new SqlRejectedError(`unknown param "{{params.${name}}}"`, 'unknown-param');
    }
    values.push(params[name]!);
    return dialect === 'postgres' ? `$${values.length}` : '?';
  });
  return { sql: bound, values };
}

/** Walks every node of the AST invoking `visit` — catches nested subqueries. */
function walk(node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  visit(record);
  for (const value of Object.values(record)) walk(value, visit);
}

function functionName(node: Record<string, unknown>): string | undefined {
  // node-sql-parser encodes calls as {type:'function'|'aggr_func', name:...}
  if (node.type !== 'function' && node.type !== 'aggr_func') return undefined;
  const name = node.name;
  if (typeof name === 'string') return name;
  if (typeof name === 'object' && name !== null) {
    const parts = (name as { name?: { value?: string }[] }).name;
    if (Array.isArray(parts)) return parts.map((p) => p.value ?? '').join('.');
  }
  return undefined;
}

export interface GuardrailOptions {
  allowedTables: ReadonlySet<string>;
  dialect: Dialect;
  maxRows: number;
}

/**
 * Validates agent SQL and returns an executable, parameterized, row-capped
 * query. Throws SqlRejectedError with a machine-readable reason — the
 * self-heal loop feeds that message back to the binder.
 */
export function prepareSql(
  rawSql: string,
  params: Record<string, ParamValue>,
  options: GuardrailOptions,
): SafeQuery {
  // Parse with neutral literals standing in for params: placeholders are not
  // part of any SQL grammar, and validation only cares about structure.
  const parseable = rawSql.replace(PARAM_TOKEN, '1');

  let ast: unknown;
  let tableList: string[];
  try {
    // DuckDB's SQL is close enough to postgres for structural validation.
    const result = parser.parse(parseable, { database: 'postgresql' });
    ast = result.ast;
    tableList = result.tableList;
  } catch (err) {
    throw new SqlRejectedError(
      `SQL failed to parse: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
    );
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    throw new SqlRejectedError('exactly one statement is allowed', 'multiple-statements');
  }
  const statement = statements[0] as Record<string, unknown>;
  if (statement.type !== 'select') {
    throw new SqlRejectedError(
      `only SELECT is allowed, got ${String(statement.type).toUpperCase()}`,
      'not-select',
    );
  }
  if (statement.into && (statement.into as { position?: unknown }).position) {
    throw new SqlRejectedError('SELECT INTO is not allowed', 'not-select');
  }

  // tableList entries look like "select::schema::table" — CTE names are
  // excluded by the parser, so this is the real surface area.
  const cteNames = new Set<string>();
  walk(statement, (node) => {
    if (typeof node.name === 'string' && node.stmt !== undefined && node.columns !== undefined) {
      cteNames.add(node.name.toLowerCase());
    }
    // with-clause entries: {name: {type:'default', value:'x'}, stmt: ...}
    const name = node.name as { value?: string } | undefined;
    if (node.stmt !== undefined && typeof name === 'object' && name?.value) {
      cteNames.add(name.value.toLowerCase());
    }
  });

  for (const entry of tableList) {
    const [op, schema, table] = entry.split('::');
    if (op !== 'select') {
      throw new SqlRejectedError(`operation "${op}" is not allowed`, 'not-select');
    }
    const tableName = (table ?? '').toLowerCase();
    if (cteNames.has(tableName)) continue;
    const qualified =
      schema && schema !== 'null' ? `${schema.toLowerCase()}.${tableName}` : tableName;
    if (schema && schema !== 'null' && !options.allowedTables.has(qualified)) {
      throw new SqlRejectedError(
        `table "${qualified}" is not in the allowlist`,
        'table-not-allowed',
      );
    }
    if ((!schema || schema === 'null') && !options.allowedTables.has(tableName)) {
      throw new SqlRejectedError(
        `table "${tableName}" is not in the allowlist`,
        'table-not-allowed',
      );
    }
  }

  walk(statement, (node) => {
    const fn = functionName(node);
    if (fn && FORBIDDEN_FUNCTIONS.has(fn.toLowerCase())) {
      throw new SqlRejectedError(`function "${fn}" is not allowed`, 'forbidden-function');
    }
  });

  // Bind params against the original SQL (tokens intact).
  const { sql: boundSql, values } = bindParams(
    rawSql.trim().replace(/;+\s*$/, ''),
    params,
    options.dialect,
  );

  // Enforce the row cap. An existing LIMIT within the cap is respected;
  // anything else is wrapped — deterministic and dialect-safe.
  const existingLimit = extractLimit(statement);
  const sql =
    existingLimit !== undefined && existingLimit <= options.maxRows
      ? boundSql
      : `SELECT * FROM (\n${boundSql}\n) AS alpona_capped LIMIT ${options.maxRows}`;

  return { sql, values };
}

function extractLimit(statement: Record<string, unknown>): number | undefined {
  const limit = statement.limit as { value?: { type?: string; value?: number }[] } | null;
  const entry = limit?.value?.[limit.value.length - 1];
  if (entry?.type === 'number' && typeof entry.value === 'number') return entry.value;
  return undefined;
}
