import { describe, expect, it } from 'vitest';
import { QueryService } from '../src/query/service.js';
import { QueryCache } from '../src/query/cache.js';
import { RateLimiter } from '../src/query/rate-limit.js';
import { FakeAdapter, testDictionary } from './helpers.js';

describe('QueryService', () => {
  it('executes through guardrails and returns column metadata', async () => {
    const adapter = new FakeAdapter();
    adapter.rows = [{ carrier: 'DHL', avg_delay: 2.5 }];
    const service = new QueryService(adapter, testDictionary(), { maxRows: 100, timeoutMs: 1000 });

    const result = await service.run(
      'SELECT carrier, AVG(delay_days) AS avg_delay FROM shipment_performance GROUP BY 1',
      {},
    );
    expect(result.columns).toEqual(['carrier', 'avg_delay']);
    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('serves repeated queries from the shared cache', async () => {
    const adapter = new FakeAdapter();
    const service = new QueryService(adapter, testDictionary(), { maxRows: 100, timeoutMs: 1000 });

    await service.run('SELECT COUNT(*) AS n FROM stock_risk', {});
    await service.run('SELECT COUNT(*) AS n FROM stock_risk', {});
    expect(adapter.executed).toHaveLength(1);
  });

  it('caches per distinct param values', async () => {
    const adapter = new FakeAdapter();
    const service = new QueryService(adapter, testDictionary(), { maxRows: 100, timeoutMs: 1000 });

    await service.run('SELECT * FROM stock_risk WHERE on_hand < {{params.n}}', { n: 5 });
    await service.run('SELECT * FROM stock_risk WHERE on_hand < {{params.n}}', { n: 10 });
    expect(adapter.executed).toHaveLength(2);
  });

  it('marks results at the row cap as truncated', async () => {
    const adapter = new FakeAdapter();
    adapter.rows = Array.from({ length: 5 }, (_, i) => ({ n: i }));
    const service = new QueryService(adapter, testDictionary(), { maxRows: 5, timeoutMs: 1000 });
    const result = await service.run('SELECT * FROM stock_risk', {});
    expect(result.truncated).toBe(true);
  });

  it('refuses tables outside the dictionary-derived allowlist', async () => {
    const service = new QueryService(new FakeAdapter(), testDictionary(), {
      maxRows: 100,
      timeoutMs: 1000,
    });
    await expect(service.run('SELECT * FROM secret_table', {})).rejects.toThrow(/allowlist/);
  });
});

describe('QueryCache', () => {
  it('expires entries after the TTL', () => {
    const cache = new QueryCache<number>(10, 1);
    cache.set('k', 1);
    expect(cache.get('k')).toBe(1);
    const realNow = Date.now;
    Date.now = () => realNow() + 50;
    try {
      expect(cache.get('k')).toBeUndefined();
    } finally {
      Date.now = realNow;
    }
  });

  it('evicts the least recently used entry at capacity', () => {
    const cache = new QueryCache<number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // refresh a
    cache.set('c', 3); // evicts b
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});

describe('RateLimiter', () => {
  it('admits up to capacity, then refuses, then refills over time', () => {
    let clock = 0;
    const limiter = new RateLimiter(3, 1, () => clock);
    expect(limiter.take('s')).toBe(true);
    expect(limiter.take('s')).toBe(true);
    expect(limiter.take('s')).toBe(true);
    expect(limiter.take('s')).toBe(false);
    clock += 1000; // refill 1 token
    expect(limiter.take('s')).toBe(true);
    expect(limiter.take('s')).toBe(false);
  });

  it('isolates sessions', () => {
    const limiter = new RateLimiter(1, 0, () => 0);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('b')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });
});
