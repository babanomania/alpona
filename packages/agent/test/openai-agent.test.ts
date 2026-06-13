import { describe, expect, it } from 'vitest';
import { OpenAiAgent } from '../src/backends/openai.js';
import { testDictionary } from './helpers.js';

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** Fake transport: records every request, replies with a canned completion. */
function fakeTransport(content: string): {
  calls: CapturedRequest[];
  fetch: typeof globalThis.fetch;
} {
  const calls: CapturedRequest[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push({
      url: request.url,
      body: JSON.parse(await request.text()) as Record<string, unknown>,
      headers: request.headers,
    });
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'test',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const PLAN_JSON = JSON.stringify({
  title: 'Shipment delays',
  layout: 'ops-overview@6',
  params: { window_days: 30 },
  widgets: [{ id: 'late-rate', slot: 'kpi-1', type: 'kpi', insight: 'Share of late shipments' }],
});

function agent(content: string, models?: Partial<{ planner: string; binder: string }>) {
  const transport = fakeTransport(content);
  const backend = new OpenAiAgent(testDictionary(), {
    apiKey: 'test-key',
    baseUrl: 'http://localhost:9999/v1',
    plannerModel: models?.planner ?? 'google/gemma-4-e4b',
    binderModel: models?.binder ?? 'google/gemma-4-e4b',
    copyModel: 'google/gemma-4-e4b',
    dialect: 'duckdb',
    fetch: transport.fetch,
  });
  return { backend, calls: transport.calls };
}

describe('OpenAiAgent', () => {
  it('plans via chat completions against the configured base URL', async () => {
    const { backend, calls } = agent(PLAN_JSON);
    const plan = await backend.plan('show me shipment delays');

    expect(plan.title).toBe('Shipment delays');
    expect(plan.widgets).toHaveLength(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:9999/v1/chat/completions');
    const body = calls[0]!.body;
    expect(body.model).toBe('google/gemma-4-e4b');
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('shipment_performance');
    expect(messages[1]).toEqual({ role: 'user', content: 'show me shipment delays' });
  });

  it('omits OpenAI-only parameters for non-OpenAI models', async () => {
    const { backend, calls } = agent(PLAN_JSON);
    await backend.plan('anything');

    const body = calls[0]!.body;
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.max_completion_tokens).toBe(4096);
  });

  it('asks reasoning models for low effort on plan, high on bind, with JSON mode', async () => {
    const bindJson = JSON.stringify({
      sql: 'SELECT carrier AS label, COUNT(*) AS value FROM shipment_performance GROUP BY 1',
      resultShape: { label: 'label', value: 'value' },
      title: 'Shipments by carrier',
    });
    const { backend, calls } = agent(bindJson, { planner: 'gpt-5.4-mini', binder: 'gpt-5.4' });

    await backend.bind({
      widget: { id: 'w1', slot: 's1', type: 'bar', insight: 'volume by carrier' },
      plan: { title: 't', layout: 'ops-overview@6', params: {}, widgets: [] },
      userPrompt: 'carriers',
    });
    expect(calls[0]!.body.reasoning_effort).toBe('high');
    expect(calls[0]!.body.response_format).toEqual({ type: 'json_object' });
    // Reasoning tokens share the budget, so thinking stages get headroom.
    expect(calls[0]!.body.max_completion_tokens).toBe(16384);

    const planner = agent(PLAN_JSON, { planner: 'gpt-5.4-mini' });
    await planner.backend.plan('anything');
    expect(planner.calls[0]!.body.reasoning_effort).toBe('low');
    expect(planner.calls[0]!.body.max_completion_tokens).toBe(4096);
  });

  it('extracts the JSON object from prose-wrapped responses', async () => {
    const { backend } = agent(
      `Here is the dashboard plan:\n\`\`\`json\n${PLAN_JSON}\n\`\`\`\nLet me know!`,
    );
    const plan = await backend.plan('noisy model');
    expect(plan.layout).toBe('ops-overview@6');
  });

  it('throws on schema-invalid output so the pipeline heal path can retry', async () => {
    const { backend } = agent(
      JSON.stringify({ title: '', layout: 'NOT A LAYOUT', params: {}, widgets: [] }),
    );
    await expect(backend.plan('bad output')).rejects.toThrow();
  });
});
