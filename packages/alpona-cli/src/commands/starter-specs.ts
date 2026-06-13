import type { DashboardSpec, DataDictionary, LayoutTemplate, WidgetSpec } from '@alpona/core';
import { getLayout, interpret, layoutTemplates, widgetDefinitions } from '@alpona/core';
import {
  MockAgent,
  type BinderRequest,
  type PlannedWidget,
  type PlannerOutput,
} from '@alpona/agent';

/**
 * Starter specs: a pre-built gallery written at dataset-import time (both
 * `alpona init` and `alpona connect`) so a fresh install — or someone
 * bringing their own database — never opens blank, and can see every
 * layout and every widget rendered against their real schema. Generated
 * by the deterministic mock agent, so zero API calls and works offline.
 *
 * Two guarantees the naive "one widget type per slot" version missed:
 *  1. all 12 layout templates appear, and
 *  2. all widget types appear at least once — slot types are chosen
 *     round-robin, biased toward types not yet covered, and a dedicated
 *     "Widget gallery" board backfills anything the layouts couldn't.
 * Specs that fail the interpreter gate are skipped, never patched.
 */

const ROLE_TYPE: Record<string, string> = {
  'kpi-strip': 'kpi_card',
  hero: 'line_chart',
  side: 'donut_chart',
  table: 'table',
  secondary: 'bar_chart',
  detail: 'table',
  footer: 'kpi_card',
  main: 'table',
};

const ALL_WIDGET_TYPES = widgetDefinitions.map((d) => d.type);

/**
 * Picks a widget type for a slot, preferring one not yet covered so the
 * gallery exercises the whole registry across the layout set.
 */
function chooseType(slot: LayoutTemplate['slots'][number], covered: Set<string>): string {
  const accepts = slot.accepts.length > 0 ? slot.accepts : ALL_WIDGET_TYPES;
  return (
    accepts.find((t) => !covered.has(t)) ??
    slot.accepts[0] ??
    ROLE_TYPE[slot.role] ??
    ROLE_TYPE[slot.id] ??
    'kpi_card'
  );
}

function widgetsFor(layout: LayoutTemplate, covered: Set<string>): PlannedWidget[] {
  const widgets: PlannedWidget[] = [];
  for (const slot of layout.slots) {
    const type = chooseType(slot, covered);
    covered.add(type);
    for (let i = 0; i < Math.max(slot.minWidgets, 1); i++) {
      widgets.push({
        id: `${slot.id}${i > 0 ? `-${i + 1}` : ''}`,
        slot: slot.id,
        type,
        insight: `Starter ${type.replaceAll('_', ' ')} for the ${slot.id} slot`,
      });
    }
  }
  return widgets;
}

export interface StarterSpec {
  name: string;
  prompt: string;
  spec: DashboardSpec;
}

/** Binds one planned widget, falling back to the mock's healed binding. */
async function bindWidget(
  agent: MockAgent,
  request: BinderRequest,
  planned: PlannedWidget,
): Promise<WidgetSpec> {
  let binding;
  try {
    binding = await agent.bind(request);
  } catch {
    binding = await agent.bind({ ...request, feedback: { sql: '', error: 'starter' } });
  }
  return {
    id: planned.id,
    slot: planned.slot,
    type: planned.type,
    binding: { sql: binding.sql, resultShape: binding.resultShape },
    props: binding.props,
    copy: { title: binding.title, caption: null },
  };
}

async function assemble(
  agent: MockAgent,
  plan: PlannerOutput,
  widgets: PlannedWidget[],
): Promise<DashboardSpec | undefined> {
  const spec: DashboardSpec = {
    specVersion: 1,
    title: plan.title,
    layout: plan.layout,
    params: {},
    widgets: [],
  };
  for (const planned of widgets) {
    spec.widgets.push(
      await bindWidget(agent, { widget: planned, plan, userPrompt: plan.title }, planned),
    );
  }
  return interpret(spec).ok ? spec : undefined;
}

/**
 * A dedicated showcase that packs the still-uncovered widget types into a
 * grid layout, so the gallery always demonstrates the complete registry
 * even when no ordinary layout slot accepted a given type.
 */
async function widgetGallery(
  agent: MockAgent,
  subject: string,
  missing: string[],
): Promise<StarterSpec | undefined> {
  const grid = getLayout('chart-grid@1') ?? layoutTemplates.find((t) => t.slots.length >= 4);
  if (!grid || missing.length === 0) return undefined;

  // Fill the grid's slots with the missing types (cycling if needed).
  const widgets: PlannedWidget[] = grid.slots.map((slot, i) => {
    const type = missing[i % missing.length]!;
    return {
      id: `gallery-${i + 1}`,
      slot: slot.id,
      type,
      insight: `${type.replaceAll('_', ' ')} sample`,
    };
  });
  const plan: PlannerOutput = {
    title: `${subject} at a glance`,
    layout: `${grid.name}@${grid.version}`,
    params: {},
    widgets,
  };
  const spec = await assemble(agent, plan, widgets);
  return spec ? { name: spec.title, prompt: 'every metric on one board', spec } : undefined;
}

/** Business-dashboard framings, paired with subjects for realistic names. */
const FRAMINGS = [
  'overview',
  'at a glance',
  'this quarter',
  'breakdown',
  'by segment',
  'snapshot',
  'deep dive',
  'monitor',
  'report',
  'dashboard',
  'review',
  'highlights',
];

const titleCase = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

export async function generateStarterSpecs(dictionary: DataDictionary): Promise<StarterSpec[]> {
  const agent = new MockAgent(dictionary);
  const marts = dictionary.tables.filter((t) => t.kind === 'mart');
  const primary = marts[0] ?? dictionary.tables[0];
  if (!primary) return [];

  // Rotate the analytical subjects through realistic framings so the
  // gallery reads like saved business dashboards ("Revenue trends
  // snapshot") rather than layout previews ("Revenue — chart grid").
  const subjects = (marts.length > 0 ? marts : [primary]).map((t) =>
    titleCase(t.name.replaceAll('_', ' ')),
  );
  const subject = subjects[0]!;

  const covered = new Set<string>();
  const specs: StarterSpec[] = [];

  for (const [i, layout] of layoutTemplates.entries()) {
    const widgets = widgetsFor(layout, covered);
    const name = `${subjects[i % subjects.length]} ${FRAMINGS[i % FRAMINGS.length]}`;
    const plan: PlannerOutput = {
      title: name,
      layout: `${layout.name}@${layout.version}`,
      params: {},
      widgets,
    };
    const spec = await assemble(agent, plan, widgets);
    if (spec) {
      specs.push({ name: spec.title, prompt: name.toLowerCase(), spec });
    }
  }

  // Backfill any widget type the layouts couldn't place into a showcase.
  const used = new Set(specs.flatMap((s) => s.spec.widgets.map((w) => w.type)));
  const missing = ALL_WIDGET_TYPES.filter((t) => !used.has(t));
  const gallery = await widgetGallery(agent, subject, missing);
  if (gallery) specs.unshift(gallery);

  return specs;
}
