import { describe, expect, it } from 'vitest';
import type { GenerationEvent } from '@alpona/core';
import { interpret } from '@alpona/core';
import { Pipeline } from '../src/agent/pipeline.js';
import { MockAgent } from '../src/agent/mock.js';
import { QueryService } from '../src/query/service.js';
import { FakeAdapter, testDictionary } from './helpers.js';

function setup(adapter = new FakeAdapter()) {
  const dictionary = testDictionary();
  const queryService = new QueryService(adapter, dictionary, { maxRows: 1000, timeoutMs: 1000 });
  const pipeline = new Pipeline(new MockAgent(dictionary), queryService);
  return { pipeline, adapter };
}

async function collect(run: (emit: (e: GenerationEvent) => void) => Promise<void>) {
  const events: GenerationEvent[] = [];
  await run((e) => {
    events.push(e);
  });
  return events;
}

describe('Pipeline.generate', () => {
  it('streams plan → widgets → copy → done, in pipeline order', async () => {
    const { pipeline } = setup();
    const events = await collect((emit) =>
      pipeline.generate('delayed shipments by carrier and stock below reorder point', emit),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('status');
    expect(types).toContain('plan');
    expect(types).toContain('widget');
    expect(types).toContain('done');
    expect(types.indexOf('plan')).toBeLessThan(types.indexOf('widget'));
    expect(types.indexOf('widget')).toBeLessThan(types.indexOf('done'));
    expect(types).not.toContain('error');
  });

  it('emits a plan whose skeleton already passes the schema gate', async () => {
    const { pipeline } = setup();
    const events = await collect((emit) => pipeline.generate('warehouse ops view', emit));
    const plan = events.find((e) => e.type === 'plan');
    expect(plan).toBeDefined();
    if (plan?.type !== 'plan') return;
    expect(Object.keys(plan.pending).length).toBeGreaterThan(0);
    expect(interpret(plan.spec).ok).toBe(true);
  });

  it('produces a final spec that interprets cleanly and is data-free', async () => {
    const { pipeline } = setup();
    const events = await collect((emit) => pipeline.generate('shipment delays', emit));
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type !== 'done') return;

    const result = interpret(done.spec);
    expect(result.ok).toBe(true);
    // The artifact carries queries, never query results.
    expect(JSON.stringify(done.spec)).not.toContain('"rows"');
    for (const widget of done.spec.widgets) {
      expect(widget.binding.sql.toLowerCase()).toContain('select');
    }
  });

  it('self-heals a failing binding once and flags it', async () => {
    const adapter = new FakeAdapter();
    // Fail anything aggregating delay_days — first binder attempt for the hero.
    adapter.failPattern = /avg\(delay_days\)/i;
    const { pipeline } = setup(adapter);

    const events = await collect((emit) => pipeline.generate('shipment delay trends', emit));
    const healed = events.filter((e) => e.type === 'widget' && e.healed);
    expect(healed.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('dry-runs every binding against the database before emitting it', async () => {
    const adapter = new FakeAdapter();
    const { pipeline } = setup(adapter);
    const events = await collect((emit) => pipeline.generate('shipments', emit));
    const widgets = events.filter((e) => e.type === 'widget');
    expect(adapter.executed.length).toBeGreaterThanOrEqual(widgets.length);
  });
});

describe('Pipeline.refine', () => {
  it('emits a patch that transforms the spec and a final validated spec', async () => {
    const { pipeline } = setup();
    const generated = await collect((emit) => pipeline.generate('shipments by carrier', emit));
    const done = generated.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('no spec generated');
    const target = done.spec.widgets.find((w) => w.type === 'donut_chart') ?? done.spec.widgets[0]!;

    const events = await collect((emit) =>
      pipeline.refine(done.spec, 'top 3 only', target.id, emit),
    );
    const patch = events.find((e) => e.type === 'patch');
    expect(patch).toBeDefined();
    if (patch?.type !== 'patch') return;
    expect(patch.operations[0]!.path).toContain('/binding/sql');

    const refined = events.find((e) => e.type === 'done');
    expect(refined?.type === 'done' && interpret(refined.spec).ok).toBe(true);
  });

  it('rejects refinements that would break the spec', async () => {
    const { pipeline } = setup();
    const generated = await collect((emit) => pipeline.generate('shipments', emit));
    const done = generated.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('no spec generated');

    const events = await collect((emit) =>
      pipeline.refine(done.spec, 'remove it', 'no-such-widget', emit),
    );
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'patch')).toBe(false);
  });
});
