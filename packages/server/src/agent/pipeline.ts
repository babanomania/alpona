import type { DashboardSpec, GenerationEvent, WidgetSpec } from '@alpona/core';
import { applyPatch, getLayout, getWidgetDefinition, interpret } from '@alpona/core';
import type { QueryService } from '../query/service.js';
import type { AgentBackend, BinderOutput, PlannedWidget, PlannerOutput } from './stages.js';

export type EmitEvent = (event: GenerationEvent) => void | Promise<void>;

const PENDING_SQL = 'SELECT 1 AS pending';

/**
 * The four-stage pipeline:
 *
 *   plan (streams a renderable skeleton immediately)
 *   → bind, one call per slot in parallel, each dry-run against the
 *     database; failures self-heal once with the DB error as feedback
 *   → copy, async, fades in after data
 *
 * Every artifact passes the core interpreter gate before it is emitted —
 * the agent can only fail in ways the system catches.
 */
export class Pipeline {
  constructor(
    private readonly backend: AgentBackend,
    private readonly queryService: QueryService,
  ) {}

  async generate(prompt: string, emit: EmitEvent): Promise<void> {
    await emit({ type: 'status', phase: 'planning', message: 'Choosing a layout…' });

    let plan: PlannerOutput;
    try {
      plan = await this.backend.plan(prompt);
    } catch (err) {
      await emit({ type: 'error', message: `planner failed: ${message(err)}` });
      return;
    }

    const sanitized = sanitizePlan(plan);
    if ('error' in sanitized) {
      await emit({ type: 'error', message: sanitized.error });
      return;
    }
    plan = sanitized.plan;

    // Skeleton spec: every widget pending, renderable immediately.
    let spec: DashboardSpec = {
      specVersion: 1,
      title: plan.title,
      layout: plan.layout,
      params: plan.params,
      widgets: plan.widgets.map((w) => ({
        id: w.id,
        slot: w.slot,
        type: w.type,
        // Placeholder binding that satisfies the widget's resultShape
        // contract so the skeleton passes the same gate as the final spec.
        // Clients never fetch pending widgets; binders replace this.
        binding: {
          sql: PENDING_SQL,
          resultShape: Object.fromEntries(
            (getWidgetDefinition(w.type)?.resultShape.required ?? []).map((key) => [
              key,
              'pending',
            ]),
          ),
        },
        copy: { title: null, caption: null },
      })),
    };

    const pending = Object.fromEntries(plan.widgets.map((w) => [w.id, w.insight]));
    await emit({ type: 'plan', spec, pending });
    await emit({ type: 'status', phase: 'binding', message: 'Writing queries…' });

    const sampleRowsById = new Map<string, Record<string, unknown>[]>();

    const bindOne = async (planned: PlannedWidget): Promise<void> => {
      const { binding, healed } = await this.bindWithHeal(planned, plan, prompt);
      const widget: WidgetSpec = {
        id: planned.id,
        slot: planned.slot,
        type: planned.type,
        binding: { sql: binding.sql, resultShape: binding.resultShape },
        props: binding.props,
        copy: { title: binding.title, caption: null },
      };
      spec = {
        ...spec,
        widgets: spec.widgets.map((w) => (w.id === widget.id ? widget : w)),
      };
      const sample = await this.tryRun(binding.sql, plan.params);
      if (sample) sampleRowsById.set(widget.id, sample.slice(0, 8));
      await emit({ type: 'widget', widget, healed: healed || undefined });
    };

    await Promise.all(plan.widgets.map((w) => bindOne(w)));

    // Final gate: the assembled spec must interpret cleanly.
    const result = interpret(spec);
    if (!result.ok) {
      await emit({
        type: 'error',
        message: 'generated spec failed validation',
        issues: result.issues,
      });
      return;
    }

    await emit({ type: 'status', phase: 'copy', message: 'Writing captions…' });
    await Promise.all(
      spec.widgets.map(async (widget) => {
        try {
          const copy = await this.backend.copy({
            widgetId: widget.id,
            insight: pending[widget.id] ?? widget.copy.title ?? widget.type,
            currentTitle: widget.copy.title,
            sampleRows: sampleRowsById.get(widget.id) ?? [],
            dashboardTitle: spec.title,
          });
          spec = {
            ...spec,
            widgets: spec.widgets.map((w) =>
              w.id === widget.id ? { ...w, copy: { title: copy.title, caption: copy.caption } } : w,
            ),
          };
          await emit({
            type: 'copy',
            widgetId: widget.id,
            title: copy.title,
            caption: copy.caption,
          });
        } catch {
          // copy is decorative — a failure must never break the dashboard
        }
      }),
    );

    await emit({ type: 'done', spec });
  }

  async refine(
    spec: DashboardSpec,
    prompt: string,
    targetWidgetId: string | undefined,
    emit: EmitEvent,
  ): Promise<void> {
    await emit({ type: 'status', phase: 'planning', message: 'Refining…' });
    try {
      const { operations } = await this.backend.refine({ spec, prompt, targetWidgetId });
      const next = applyPatch(spec, operations);
      const result = interpret(next);
      if (!result.ok) {
        await emit({
          type: 'error',
          message: 'refinement produced an invalid spec and was rejected',
          issues: result.issues,
        });
        return;
      }
      await emit({ type: 'patch', operations });
      await emit({ type: 'done', spec: next });
    } catch (err) {
      await emit({ type: 'error', message: `refinement failed: ${message(err)}` });
    }
  }

  /** Bind once; on any failure, retry once with the error as feedback. */
  private async bindWithHeal(
    planned: PlannedWidget,
    plan: PlannerOutput,
    userPrompt: string,
  ): Promise<{ binding: BinderOutput; healed: boolean }> {
    let lastSql = '';
    const attempt = async (feedback?: { sql: string; error: string }): Promise<BinderOutput> => {
      const binding = await this.backend.bind({ widget: planned, plan, userPrompt, feedback });
      lastSql = binding.sql;
      validateBinding(planned, binding);
      // Dry-run through the full guardrail + database path. The database's
      // own error message is the heal feedback — nothing is synthesized.
      const result = await this.queryService.run(binding.sql, plan.params);
      const missing = shapeColumnsMissing(binding, result.columns);
      if (missing.length > 0 && result.rows.length > 0) {
        throw new Error(`resultShape references missing columns: ${missing.join(', ')}`);
      }
      return binding;
    };

    try {
      return { binding: await attempt(), healed: false };
    } catch (firstError) {
      try {
        const binding = await attempt({ sql: lastSql, error: message(firstError) });
        return { binding, healed: true };
      } catch (secondError) {
        // Both attempts failed — ship a contract-satisfying zero-row binding;
        // the client renders an honest empty state rather than a dead app.
        const def = getWidgetDefinition(planned.type);
        const required = def?.resultShape.required ?? [];
        const aliases = required.length > 0 ? required : (['value'] as const);
        const selectList = aliases.map((key) => `NULL AS ${key}`).join(', ');
        return {
          binding: {
            sql: `SELECT ${selectList} WHERE 1 = 0 -- ${message(secondError).slice(0, 120)}`,
            resultShape: Object.fromEntries(aliases.map((key) => [key, key])),
            title: planned.insight.slice(0, 60),
          },
          healed: true,
        };
      }
    }
  }

  private async tryRun(
    sql: string,
    params: Record<string, string | number | boolean>,
  ): Promise<Record<string, unknown>[] | undefined> {
    try {
      const result = await this.queryService.run(sql, params);
      return result.rows;
    } catch {
      return undefined;
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Structural checks on the plan before anything renders. */
function sanitizePlan(plan: PlannerOutput): { plan: PlannerOutput } | { error: string } {
  const layout = getLayout(plan.layout);
  if (!layout) return { error: `planner chose unknown layout "${plan.layout}"` };

  const seen = new Set<string>();
  const widgets = plan.widgets.filter((w) => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    const slot = layout.slots.find((s) => s.id === w.slot);
    if (!slot) return false;
    if (slot.accepts.length > 0 && !slot.accepts.includes(w.type)) return false;
    return getWidgetDefinition(w.type) !== undefined;
  });
  if (widgets.length === 0) return { error: 'planner produced no valid widgets' };
  return { plan: { ...plan, widgets } };
}

/** Binding must satisfy the widget type's resultShape contract. */
function validateBinding(planned: PlannedWidget, binding: BinderOutput): void {
  const def = getWidgetDefinition(planned.type);
  if (!def) throw new Error(`unknown widget type "${planned.type}"`);
  for (const key of def.resultShape.required) {
    if (binding.resultShape[key] === undefined) {
      throw new Error(`widget type "${planned.type}" requires resultShape.${key}`);
    }
  }
  if (binding.props !== undefined) {
    const parsed = def.propsSchema.safeParse(binding.props);
    if (!parsed.success) delete binding.props;
  }
}

function shapeColumnsMissing(binding: BinderOutput, columns: string[]): string[] {
  const referenced = Object.entries(binding.resultShape).flatMap(([key, value]) =>
    key === 'columns' ? (value as string[]) : [value as string],
  );
  return referenced.filter((column) => !columns.includes(column));
}
