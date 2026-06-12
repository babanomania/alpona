import type { ParamValue, QueryResult } from '../types.js';

/**
 * A deliberately small query client for widget data: cache by
 * (sql, params), dedupe in-flight requests, expose subscribable
 * loading/success/error states. The fetcher is injected so the engine
 * stays transport-agnostic (and trivially testable).
 */

export type QueryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: QueryResult; fetchedAt: number }
  | { status: 'error'; error: string };

export type QueryFetcher = (
  sql: string,
  params: Record<string, ParamValue>,
  signal: AbortSignal,
) => Promise<QueryResult>;

export interface QueryClientOptions {
  fetcher: QueryFetcher;
  /** Cache time-to-live in ms; default 5 minutes. */
  ttlMs?: number;
}

export function queryKey(sql: string, params: Record<string, ParamValue>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join('&');
  return `${sql}::${sorted}`;
}

interface Entry {
  state: QueryState;
  listeners: Set<() => void>;
  controller?: AbortController;
}

// Stable instance: getState must return referentially equal values for
// unchanged state (useSyncExternalStore contract).
const IDLE_STATE: QueryState = { status: 'idle' };

export class QueryClient {
  private readonly entries = new Map<string, Entry>();
  private readonly fetcher: QueryFetcher;
  private readonly ttlMs: number;

  constructor(options: QueryClientOptions) {
    this.fetcher = options.fetcher;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
  }

  getState(key: string): QueryState {
    return this.entries.get(key)?.state ?? IDLE_STATE;
  }

  subscribe(key: string, listener: () => void): () => void {
    const entry = this.ensure(key);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  /**
   * Ensures the query is fresh or fetching. Concurrent callers share one
   * request; a fresh cached result is a no-op.
   */
  fetch(sql: string, params: Record<string, ParamValue>): string {
    const key = queryKey(sql, params);
    const entry = this.ensure(key);

    if (entry.state.status === 'loading') return key;
    if (entry.state.status === 'success' && Date.now() - entry.state.fetchedAt < this.ttlMs)
      return key;

    this.run(key, entry, sql, params);
    return key;
  }

  /** Drops cache for the key and refetches. */
  invalidate(sql: string, params: Record<string, ParamValue>): string {
    const key = queryKey(sql, params);
    const entry = this.ensure(key);
    entry.controller?.abort();
    this.run(key, entry, sql, params);
    return key;
  }

  /** Aborts everything in flight and clears the cache. */
  clear(): void {
    for (const entry of this.entries.values()) entry.controller?.abort();
    this.entries.clear();
  }

  private ensure(key: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { state: IDLE_STATE, listeners: new Set() };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private run(key: string, entry: Entry, sql: string, params: Record<string, ParamValue>): void {
    const controller = new AbortController();
    entry.controller = controller;
    this.transition(entry, { status: 'loading' });

    this.fetcher(sql, params, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        this.transition(entry, { status: 'success', result, fetchedAt: Date.now() });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        this.transition(entry, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  private transition(entry: Entry, state: QueryState): void {
    entry.state = state;
    for (const listener of entry.listeners) listener();
  }
}
