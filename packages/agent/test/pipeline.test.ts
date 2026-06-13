import { describe, expect, it } from 'vitest';
import type { GenerationEvent } from '@alpona/core';
import { interpret } from '@alpona/core';
import { AlponaAgent } from '../src/graph.js';
import { MockAgent } from '../src/backends/mock.js';
import { FakeExecutor, testDictionary } from './helpers.js';

function setup(executor = new FakeExecutor()) {
  const dictionary = testDictionary();
  const agent = new AlponaAgent({ backend: new MockAgent(dictionary), dictionary, executor });
  return { agent, executor };
}

async function collect(run: (emit: (e: GenerationEvent) => void) => Promise<void>) {
  const events: GenerationEvent[] = [];
  await run((e) => {
    events.push(e);
  });
  return events;
}

describe('AlponaAgent.generate (build intent)', () => {
  it('streams plan → widgets → copy → done, in pipeline order', async () => {
    const { agent } = setup();
    const events = await collect((emit) =>
      agent.generate('delayed shipments by carrier and stock below reorder point', emit),
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
    const { agent } = setup();
    const events = await collect((emit) => agent.generate('warehouse ops view', emit));
    const plan = events.find((e) => e.type === 'plan');
    expect(plan).toBeDefined();
    if (plan?.type !== 'plan') return;
    expect(Object.keys(plan.pending).length).toBeGreaterThan(0);
    expect(interpret(plan.spec).ok).toBe(true);
  });

  it('produces a final spec that interprets cleanly and is data-free', async () => {
    const { agent } = setup();
    const events = await collect((emit) => agent.generate('shipment delays overview', emit));
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
    const executor = new FakeExecutor();
    // Fail anything aggregating delay_days — first binder attempt for the hero.
    executor.failPattern = /avg\(delay_days\)/i;
    const { agent } = setup(executor);

    const events = await collect((emit) => agent.generate('shipment delay trends', emit));
    const healed = events.filter((e) => e.type === 'widget' && e.healed);
    expect(healed.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('dry-runs every binding through the executor before emitting it', async () => {
    const executor = new FakeExecutor();
    const { agent } = setup(executor);
    const events = await collect((emit) => agent.generate('shipments overview', emit));
    const widgets = events.filter((e) => e.type === 'widget');
    expect(executor.executed.length).toBeGreaterThanOrEqual(widgets.length);
  });
});

describe('AlponaAgent.generate (ask intent)', () => {
  it('routes questions to an answer with its SQL shown — no dashboard', async () => {
    const { agent } = setup();
    const events = await collect((emit) =>
      agent.generate('How many shipments ran late this week?', emit),
    );

    const answer = events.find((e) => e.type === 'answer');
    expect(answer).toBeDefined();
    if (answer?.type !== 'answer') return;
    expect(answer.sql.toLowerCase()).toContain('select');
    expect(answer.answer.length).toBeGreaterThan(0);
    expect(answer.rows.length).toBeGreaterThan(0);

    // Ask mode never plans a layout.
    expect(events.some((e) => e.type === 'plan')).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('runs answer SQL through the injected executor (same gates as queries)', async () => {
    const executor = new FakeExecutor();
    const { agent } = setup(executor);
    await collect((emit) => agent.generate('What is the average delay in days?', emit));
    expect(executor.executed.length).toBeGreaterThan(0);
    expect(executor.executed[0]!.sql.toLowerCase()).toContain('avg');
  });
});

describe('AlponaAgent.refine', () => {
  it('emits a patch that transforms the spec and a final validated spec', async () => {
    const { agent } = setup();
    const generated = await collect((emit) => agent.generate('shipments by carrier', emit));
    const done = generated.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('no spec generated');
    const target = done.spec.widgets.find((w) => w.type === 'donut_chart') ?? done.spec.widgets[0]!;

    const events = await collect((emit) => agent.refine(done.spec, 'top 3 only', target.id, emit));
    const patch = events.find((e) => e.type === 'patch');
    expect(patch).toBeDefined();
    if (patch?.type !== 'patch') return;
    expect(patch.operations[0]!.path).toContain('/binding/sql');

    const refined = events.find((e) => e.type === 'done');
    expect(refined?.type === 'done' && interpret(refined.spec).ok).toBe(true);
  });

  it('rejects refinements that would break the spec', async () => {
    const { agent } = setup();
    const generated = await collect((emit) => agent.generate('shipments overview', emit));
    const done = generated.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('no spec generated');

    const events = await collect((emit) =>
      agent.refine(done.spec, 'remove it', 'no-such-widget', emit),
    );
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'patch')).toBe(false);
  });
});

describe('AlponaAgent.pin (answer → widget, pure code)', () => {
  it('places a pinned answer into a free, accepting slot as an add patch', async () => {
    const { agent } = setup();
    const generated = await collect((emit) => agent.generate('shipments overview', emit));
    const done = generated.find((e) => e.type === 'done');
    if (done?.type !== 'done') throw new Error('no spec generated');
    const before = done.spec.widgets.length;

    const events = await collect((emit) =>
      agent.pin(
        done.spec,
        {
          sql: 'SELECT COUNT(*) AS value FROM shipment_performance WHERE is_late',
          title: 'Late shipments',
          columns: ['value'],
        },
        emit,
      ),
    );

    const patch = events.find((e) => e.type === 'patch');
    expect(patch?.type === 'patch' && patch.operations[0]!.op).toBe('add');
    const final = events.find((e) => e.type === 'done');
    expect(final?.type === 'done' && interpret(final.spec).ok).toBe(true);
    if (final?.type !== 'done') return;
    expect(final.spec.widgets.length).toBe(before + 1);
    expect(final.spec.widgets.some((w) => w.id.startsWith('pinned-'))).toBe(true);
  });

  it('pins a label+value answer into a chart slot of an otherwise-full layout', async () => {
    const { agent } = setup();
    // A deep-dive board fills every slot; its only spare slot accepts
    // charts/lists, not KPIs — so a label+value answer must land there.
    const deepDive = {
      specVersion: 1 as const,
      title: 'Deep dive',
      layout: 'deep-dive@1',
      params: {},
      widgets: [
        {
          id: 'hero',
          slot: 'hero',
          type: 'line_chart',
          binding: {
            sql: 'SELECT dispatched AS x, delay_days AS y FROM shipment_performance',
            resultShape: { x: 'x', y: 'y' },
          },
          copy: { title: 'Trend', caption: null },
        },
        {
          id: 'b1',
          slot: 'breakdowns',
          type: 'bar_chart',
          binding: {
            sql: 'SELECT carrier AS x, delay_days AS y FROM shipment_performance',
            resultShape: { x: 'x', y: 'y' },
          },
          copy: { title: 'By carrier', caption: null },
        },
        {
          id: 'b2',
          slot: 'breakdowns',
          type: 'donut_chart',
          binding: {
            sql: 'SELECT carrier AS label, delay_days AS value FROM shipment_performance',
            resultShape: { label: 'label', value: 'value' },
          },
          copy: { title: 'Mix', caption: null },
        },
        {
          id: 'detail',
          slot: 'detail',
          type: 'table',
          binding: {
            sql: 'SELECT carrier FROM shipment_performance',
            resultShape: { columns: ['carrier'] },
          },
          copy: { title: 'Rows', caption: null },
        },
      ],
    };
    expect(interpret(deepDive).ok).toBe(true);

    const events = await collect((emit) =>
      agent.pin(
        deepDive,
        {
          sql: 'SELECT carrier AS carrier, COUNT(*) AS n FROM shipment_performance GROUP BY 1',
          title: 'Late by carrier',
          columns: ['carrier', 'n'],
        },
        emit,
      ),
    );

    expect(events.some((e) => e.type === 'error')).toBe(false);
    const final = events.find((e) => e.type === 'done');
    expect(final?.type === 'done' && interpret(final.spec).ok).toBe(true);
    if (final?.type !== 'done') return;
    const pinnedW = final.spec.widgets.find((w) => w.id.startsWith('pinned-'));
    expect(pinnedW?.slot).toBe('breakdowns'); // the only slot with room
  });
});
