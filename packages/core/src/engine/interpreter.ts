import type {
  Composition,
  DashboardSpec,
  LayoutTemplate,
  ParamDescriptor,
  SpecIssue,
} from '../types.js';
import { validateSpecShape } from '../schema/validate.js';
import { getLayout } from '../layouts/index.js';
import { getWidgetDefinition } from '../registry/index.js';
import { compose } from './composer.js';
import { extractParams } from './params.js';

/**
 * The spec interpreter is the agent output gate: schema first, then the
 * semantic pass against the registry and layout contracts. A spec that
 * passes `interpret` is guaranteed renderable — every widget resolves to
 * a registered component, every slot reference is legal, every result
 * shape satisfies its widget's contract.
 */

export interface InterpretedDashboard {
  spec: DashboardSpec;
  layout: LayoutTemplate;
  composition: Composition;
  params: ParamDescriptor[];
}

export type InterpretResult =
  | { ok: true; dashboard: InterpretedDashboard; issues: SpecIssue[] }
  | { ok: false; issues: SpecIssue[] };

export function validateSemantics(spec: DashboardSpec): {
  layout?: LayoutTemplate;
  issues: SpecIssue[];
} {
  const issues: SpecIssue[] = [];

  const layout = getLayout(spec.layout);
  if (!layout) {
    issues.push({
      path: '/layout',
      code: 'unknown-layout',
      message: `layout "${spec.layout}" is not in the layout library`,
    });
  }

  const seenIds = new Set<string>();
  spec.widgets.forEach((widget, i) => {
    const base = `/widgets/${i}`;

    if (seenIds.has(widget.id)) {
      issues.push({
        path: `${base}/id`,
        code: 'duplicate-id',
        message: `duplicate widget id "${widget.id}"`,
      });
    }
    seenIds.add(widget.id);

    const def = getWidgetDefinition(widget.type);
    if (!def) {
      issues.push({
        path: `${base}/type`,
        code: 'unknown-widget-type',
        message: `widget type "${widget.type}" is not registered`,
      });
      return; // contract checks below need the definition
    }

    if (layout) {
      const slot = layout.slots.find((s) => s.id === widget.slot);
      if (!slot) {
        issues.push({
          path: `${base}/slot`,
          code: 'unknown-slot',
          message: `slot "${widget.slot}" does not exist in layout "${spec.layout}"`,
        });
      } else if (slot.accepts.length > 0 && !slot.accepts.includes(widget.type)) {
        issues.push({
          path: `${base}/type`,
          code: 'slot-rejects-type',
          message: `slot "${slot.id}" accepts [${slot.accepts.join(', ')}], not "${widget.type}"`,
        });
      }
    }

    for (const key of def.resultShape.required) {
      if (widget.binding.resultShape[key] === undefined) {
        issues.push({
          path: `${base}/binding/resultShape`,
          code: 'result-shape',
          message: `widget type "${widget.type}" requires resultShape.${key}`,
        });
      }
    }

    if (widget.props !== undefined) {
      const parsed = def.propsSchema.safeParse(widget.props);
      if (!parsed.success) {
        issues.push({
          path: `${base}/props`,
          code: 'props',
          message: parsed.error.issues
            .map((e) => `${e.path.join('.') || 'props'}: ${e.message}`)
            .join('; '),
        });
      }
    }
  });

  return { layout, issues };
}

export function interpret(value: unknown): InterpretResult {
  const shape = validateSpecShape(value);
  if (!shape.spec) return { ok: false, issues: shape.issues };

  const { layout, issues } = validateSemantics(shape.spec);
  const fatal = issues.filter((i) => i.code !== 'props');
  if (fatal.length > 0 || !layout) return { ok: false, issues };

  // Invalid props are dropped (widget renders with defaults) rather than
  // failing the dashboard — surfaced as issues either way.
  const spec: DashboardSpec = {
    ...shape.spec,
    widgets: shape.spec.widgets.map((w, i) =>
      issues.some((iss) => iss.path === `/widgets/${i}/props`) ? { ...w, props: undefined } : w,
    ),
  };

  return {
    ok: true,
    dashboard: {
      spec,
      layout,
      composition: compose(spec, layout),
      params: extractParams(spec),
    },
    issues,
  };
}
