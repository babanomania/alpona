import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ParamValue } from '../types.js';
import type { QueryClient, QueryState } from '../engine/query-client.js';
import { queryKey } from '../engine/query-client.js';
import { paramsInSql } from '../engine/params.js';

const IDLE: QueryState = { status: 'idle' };

/**
 * Subscribes a widget to its query. Only the params the SQL actually
 * references participate in the cache key, so changing an unrelated
 * filter never refetches this widget.
 */
export function useQueryState(
  client: QueryClient,
  sql: string | null,
  params: Record<string, ParamValue>,
): QueryState {
  const relevant = useMemo(() => {
    if (sql === null) return {};
    const names = paramsInSql(sql);
    const subset: Record<string, ParamValue> = {};
    for (const name of names) {
      if (name in params) subset[name] = params[name]!;
    }
    return subset;
  }, [sql, params]);

  const key = sql === null ? null : queryKey(sql, relevant);

  useEffect(() => {
    if (sql !== null) client.fetch(sql, relevant);
  }, [client, sql, relevant]);

  return useSyncExternalStore(
    (onChange) => (key === null ? () => {} : client.subscribe(key, onChange)),
    () => (key === null ? IDLE : client.getState(key)),
  );
}
