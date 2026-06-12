import { describe, expect, it, vi } from 'vitest';
import { QueryClient, queryKey } from '../src/engine/query-client.js';
import type { QueryResult } from '../src/types.js';

const result: QueryResult = { rows: [{ n: 1 }], columns: ['n'], elapsedMs: 1, truncated: false };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('queryKey', () => {
  it('is stable under param key order', () => {
    expect(queryKey('SELECT 1', { a: 1, b: 'x' })).toBe(queryKey('SELECT 1', { b: 'x', a: 1 }));
  });
});

describe('QueryClient', () => {
  it('dedupes concurrent fetches for the same key', async () => {
    const d = deferred<QueryResult>();
    const fetcher = vi.fn().mockReturnValue(d.promise);
    const client = new QueryClient({ fetcher });

    const key1 = client.fetch('SELECT 1', {});
    const key2 = client.fetch('SELECT 1', {});
    expect(key1).toBe(key2);
    expect(fetcher).toHaveBeenCalledTimes(1);

    d.resolve(result);
    await d.promise;
    expect(client.getState(key1).status).toBe('success');
  });

  it('serves fresh cache without refetching', async () => {
    const fetcher = vi.fn().mockResolvedValue(result);
    const client = new QueryClient({ fetcher, ttlMs: 60_000 });
    const key = client.fetch('SELECT 1', {});
    await vi.waitFor(() => expect(client.getState(key).status).toBe('success'));

    client.fetch('SELECT 1', {});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on state transitions', async () => {
    const fetcher = vi.fn().mockResolvedValue(result);
    const client = new QueryClient({ fetcher });
    const key = queryKey('SELECT 1', {});
    const listener = vi.fn();
    client.subscribe(key, listener);

    client.fetch('SELECT 1', {});
    await vi.waitFor(() => expect(client.getState(key).status).toBe('success'));
    // loading + success
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('records errors as state, not exceptions', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const client = new QueryClient({ fetcher });
    const key = client.fetch('SELECT 1', {});
    await vi.waitFor(() => expect(client.getState(key).status).toBe('error'));
    const state = client.getState(key);
    expect(state.status === 'error' && state.error).toBe('boom');
  });

  it('invalidate aborts in-flight work and refetches', async () => {
    const first = deferred<QueryResult>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ...result, rows: [{ n: 2 }] });
    const client = new QueryClient({ fetcher });

    const key = client.fetch('SELECT 1', {});
    client.invalidate('SELECT 1', {});
    first.resolve(result); // stale resolution must be ignored

    await vi.waitFor(() => {
      const state = client.getState(key);
      expect(state.status === 'success' && state.result.rows[0]!.n).toBe(2);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
