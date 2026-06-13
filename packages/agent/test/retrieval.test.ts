import { describe, expect, it } from 'vitest';
import type { DataDictionary, DictionaryTable, GenerationEvent } from '@alpona/core';
import { retrieveDictionary } from '../src/retrieval/index.js';
import { AlponaAgent } from '../src/graph.js';
import { MockAgent } from '../src/backends/mock.js';
import type { BinderRequest } from '../src/stages.js';
import { FakeExecutor, testDictionary } from './helpers.js';

/** A dictionary big enough to blow any small budget: 2 marts + N raw tables. */
function wideDictionary(rawTables = 30): DataDictionary {
  const base = testDictionary();
  const noise: DictionaryTable[] = Array.from({ length: rawTables }, (_, i) => ({
    name: `raw_table_${i}`,
    kind: 'table' as const,
    description: `Operational table number ${i}`,
    columns: [
      { name: 'id', type: 'integer' },
      { name: `field_${i}`, type: 'varchar' },
    ],
  }));
  // One raw table findable only through its alias — the D9(b) case.
  noise.push({
    name: 'po_lines',
    kind: 'table',
    description: 'Line items',
    aliases: ['purchase orders', 'procurement'],
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'unit_price', type: 'numeric', aliases: ['cost', 'spend'] },
    ],
  });
  return { ...base, tables: [...base.tables, ...noise] };
}

describe('retrieveDictionary (D9 safeguards)', () => {
  it('passes the full dictionary through untouched when it fits the budget', () => {
    const full = testDictionary();
    const result = retrieveDictionary(full, 'late shipments by carrier');
    expect(result.narrowed).toBe(false);
    expect(result.dictionary).toBe(full);
  });

  it('recalls tables by alias when narrowing (alias enrichment pays off)', () => {
    const full = wideDictionary();
    const result = retrieveDictionary(full, 'total procurement spend this quarter', {
      budgetChars: 500,
      k: 3,
    });
    expect(result.narrowed).toBe(true);
    const names = result.dictionary.tables.map((t) => t.name);
    // Found via "procurement"/"spend" aliases only — the literal name never matches.
    expect(names).toContain('po_lines');
    expect(result.dictionary.tables.length).toBeLessThan(full.tables.length);
  });

  it('always keeps every mart, however the query scores (recall bias)', () => {
    const full = wideDictionary();
    const result = retrieveDictionary(full, 'completely unrelated gibberish zzz', {
      budgetChars: 500,
      k: 2,
    });
    const marts = result.dictionary.tables.filter((t) => t.kind === 'mart');
    expect(marts.length).toBe(full.tables.filter((t) => t.kind === 'mart').length);
  });
});

describe('relation-not-found → full-dictionary self-heal fallback (D9d)', () => {
  it('retries a failed bind with the FULL dictionary as grounding', async () => {
    const full = wideDictionary();
    const bindRequests: BinderRequest[] = [];

    // Spy backend: records every bind request's grounding dictionary.
    const backend = new (class extends MockAgent {
      override async bind(request: BinderRequest) {
        bindRequests.push(request);
        return super.bind(request);
      }
    })(full);

    const executor = new FakeExecutor();
    executor.failPattern = /shipment_performance/i; // first attempt's table
    executor.failMessage = 'Catalog Error: Table "shipment_performance" does not exist';

    const agent = new AlponaAgent({
      backend,
      dictionary: full,
      executor,
      retrieval: { budgetChars: 500, k: 2 }, // force narrowing
    });

    const events: GenerationEvent[] = [];
    await agent.generate('shipment delays by carrier', (e) => {
      events.push(e);
    });

    const healAttempts = bindRequests.filter((r) => r.feedback);
    expect(healAttempts.length).toBeGreaterThan(0);
    for (const attempt of healAttempts) {
      // The fallback restores every table, not the narrowed subset.
      expect(attempt.dictionary?.tables.length).toBe(full.tables.length);
      // And carries the database's own error message as feedback.
      expect(attempt.feedback!.error).toContain('does not exist');
    }

    // First attempts ran on the narrowed grounding.
    const firstAttempts = bindRequests.filter((r) => !r.feedback);
    for (const attempt of firstAttempts) {
      expect(attempt.dictionary?.tables.length).toBeLessThan(full.tables.length);
    }

    // The run still completes — honest output, never a crash.
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});
