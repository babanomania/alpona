import { Annotation, END, START, Send, StateGraph } from '@langchain/langgraph';
import type { DashboardSpec, DataDictionary, GenerationEvent, WidgetSpec } from '@alpona/core';
import { applyPatch, getLayout, getWidgetDefinition, interpret } from '@alpona/core';
import type { AgentBackend, BinderOutput, Intent, PlannedWidget, PlannerOutput } from './stages.js';
import type { RetrievalOptions } from './retrieval/index.js';
import { retrieveDictionary } from './retrieval/index.js';

export type EmitEvent = (event: GenerationEvent) => void | Promise<void>;

/**
 * Query execution injected by the host. In the Alpona server this is the
 * guarded QueryService — AST gate, allowlist, limits, parameter binding —
 * so every agent-written query passes the same gates as user traffic.
 */
export interface QueryExecutor {
  run(
    sql: string,
    params: Record<string, string | number | boolean>,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
}

export interface AlponaAgentOptions {
  backend: AgentBackend;
  dictionary: DataDictionary;
  executor: QueryExecutor;
  retrieval?: RetrievalOptions;
}

const PENDING_SQL = 'SELECT 1 AS pending';

interface BoundWidget {
  widget: WidgetSpec;
  healed: boolean;
  sample: Record<string, unknown>[];
}

/**
 * Graph state. `bound` fans in from the parallel bind nodes; everything
 * else is last-value. The emit callback rides in config, not state — it
 * is a side channel, not data.
 */
const AgentState = Annotation.Root({
  prompt: Annotation<string>,
  intent: Annotation<Intent>,
  /** Retrieval-narrowed grounding for this run (full dict when it fits). */
  grounding: Annotation<DataDictionary>,
  narrowed: Annotation<boolean>,
  plan: Annotation<PlannerOutput | null>,
  skeleton: Annotation<DashboardSpec | null>,
  pending: Annotation<Record<string, string>>,
  failed: Annotation<boolean>({ reducer: (a, b) => a || b, default: () => false }),
  bound: Annotation<BoundWidget[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

type State = typeof AgentState.State;

interface NodeConfig {
  configurable?: { emit?: EmitEvent };
}

/** A Send payload for one parallel bind. */
interface BindTask {
  prompt: string;
  plan: PlannerOutput;
  widget: PlannedWidget;
  grounding: DataDictionary;
  narrowed: boolean;
}

/**
 * The agent: a LangGraph state machine behind a framework-agnostic
 * surface (decision D1 — no LangGraph types escape this module).
 *
 *   classify ─→ build: plan ─→ bind ×N (parallel, self-heal) ─→ copy
 *            └→ ask:   retrieve → bind → answer
 *
 * Self-heal retries a failed bind once with the database's own error as
 * feedback and the FULL dictionary as grounding (the D9 fallback: when
 * retrieval narrowed the prompt and the model reached for a table that
 * was cut, the heal attempt restores it). A second failure ships a
 * contract-satisfying zero-row binding — an honest empty state.
 */
export class AlponaAgent {
  private readonly backend: AgentBackend;
  private readonly dictionary: DataDictionary;
  private readonly executor: QueryExecutor;
  private readonly retrieval: RetrievalOptions;
  private readonly graph: ReturnType<AlponaAgent['buildGraph']>;

  constructor(options: AlponaAgentOptions) {
    this.backend = options.backend;
    this.dictionary = options.dictionary;
    this.executor = options.executor;
    this.retrieval = options.retrieval ?? {};
    this.graph = this.buildGraph();
  }

  async generate(prompt: string, emit: EmitEvent): Promise<void> {
    try {
      await this.graph.invoke(
        { prompt, plan: null, skeleton: null, pending: {} },
        { configurable: { emit } },
      );
    } catch (err) {
      await emit({ type: 'error', message: message(err) });
    }
  }

  async refine(
    spec: DashboardSpec,
    prompt: string,
    targetWidgetId: string | undefined,
    emit: EmitEvent,
  ): Promise<void> {
    // One box, even with a dashboard present (D7): a scoped click is
    // always a refine, but a free-form prompt is classified — a question
    // gets answered (spec untouched, pinnable from the rail), a
    // description edits the dashboard.
    if (!targetWidgetId) {
      let intent: 'ask' | 'build' = 'build';
      try {
        ({ intent } = await this.backend.classify(prompt));
      } catch {
        /* routing only — default to build (refine) */
      }
      if (intent === 'ask') {
        const { dictionary } = retrieveDictionary(this.dictionary, prompt, this.retrieval);
        await this.answerQuestion(prompt, dictionary, emit);
        return;
      }
    }

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

  /**
   * Pin an ask-mode answer onto the dashboard. Slot assignment is
   * constraint satisfaction, not inference — pure code finds a slot that
   * accepts the widget type, and the result arrives as a JSON Patch.
   * Starter dashboards fill every slot, so a slot at capacity is the
   * common case: prefer one with room, else fall back to a wrap-overflow
   * slot that grows to hold the extra widget (the composer extends its
   * region) rather than refusing the pin.
   */
  async pin(
    spec: DashboardSpec,
    pinned: { sql: string; title: string; columns: string[] },
    emit: EmitEvent,
  ): Promise<void> {
    const layout = getLayout(spec.layout);
    if (!layout) {
      await emit({ type: 'error', message: `unknown layout "${spec.layout}"` });
      return;
    }

    const counts = new Map<string, number>();
    for (const w of spec.widgets) counts.set(w.slot, (counts.get(w.slot) ?? 0) + 1);
    const accepts = (s: (typeof layout.slots)[number], type: string) =>
      s.accepts.length === 0 || s.accepts.includes(type);

    // Candidate widget types by answer shape, widest-fit first — a single
    // value is a KPI/gauge; a label+value pair is a chart/list; anything
    // wider is a table. Trying several types lets the pin land in whatever
    // slot a full starter layout still has room for.
    const candidates =
      pinned.columns.length <= 1
        ? ['kpi_card', 'gauge', 'table']
        : pinned.columns.length === 2
          ? ['leaderboard', 'bar_chart', 'donut_chart', 'table', 'kpi_card']
          : ['table'];

    let placement: { slot: string; type: string } | undefined;
    // 1) a slot with spare capacity.
    for (const type of candidates) {
      const slot = layout.slots.find(
        (s) => accepts(s, type) && (counts.get(s.id) ?? 0) < s.maxWidgets,
      );
      if (slot) {
        placement = { slot: slot.id, type };
        break;
      }
    }
    // 2) all full — a wrap-overflow slot grows to hold one more.
    if (!placement) {
      for (const type of candidates) {
        const slot = layout.slots.find((s) => accepts(s, type) && s.overflow === 'wrap');
        if (slot) {
          placement = { slot: slot.id, type };
          break;
        }
      }
    }
    if (!placement) {
      await emit({
        type: 'error',
        message: 'this layout is full — refine the dashboard or start a new one to add more',
      });
      return;
    }

    let n = 1;
    while (spec.widgets.some((w) => w.id === `pinned-${n}`)) n += 1;
    const [c0 = 'value', c1 = 'value'] = pinned.columns;
    const resultShape = pinResultShape(placement.type, c0, c1, pinned.columns);
    const widget = {
      id: `pinned-${n}`,
      slot: placement.slot,
      type: placement.type,
      binding: { sql: pinned.sql, resultShape },
      copy: { title: pinned.title.slice(0, 80), caption: 'Pinned from an answer' },
    };

    const operations = [{ op: 'add' as const, path: '/widgets/-', value: widget }];
    const next = applyPatch(spec, operations);
    const result = interpret(next);
    if (!result.ok) {
      await emit({
        type: 'error',
        message: 'pinned widget failed validation',
        issues: result.issues,
      });
      return;
    }
    await emit({ type: 'patch', operations });
    await emit({ type: 'done', spec: next });
  }

  // ── Graph wiring ──────────────────────────────────────────────

  private buildGraph() {
    return new StateGraph(AgentState)
      .addNode('classify', this.classifyNode)
      .addNode('planner', this.planNode)
      .addNode('bind', this.bindNode)
      .addNode('assemble', this.assembleNode)
      .addNode('ask', this.askNode)
      .addEdge(START, 'classify')
      .addConditionalEdges('classify', (s: State) => (s.intent === 'ask' ? 'ask' : 'planner'), [
        'ask',
        'planner',
      ])
      .addConditionalEdges(
        'planner',
        (s: State) => {
          if (s.failed || !s.plan) return END;
          return s.plan.widgets.map(
            (widget) =>
              new Send('bind', {
                prompt: s.prompt,
                plan: s.plan!,
                widget,
                grounding: s.grounding,
                narrowed: s.narrowed,
              } satisfies BindTask),
          );
        },
        ['bind', END],
      )
      .addEdge('bind', 'assemble')
      .addEdge('assemble', END)
      .addEdge('ask', END)
      .compile();
  }

  private classifyNode = async (state: State, config: NodeConfig): Promise<Partial<State>> => {
    const emit = config.configurable?.emit ?? (() => {});
    await emit({ type: 'status', phase: 'classifying', message: 'Reading your request…' });
    const { dictionary, narrowed } = retrieveDictionary(
      this.dictionary,
      state.prompt,
      this.retrieval,
    );
    try {
      const { intent } = await this.backend.classify(state.prompt);
      return { intent, grounding: dictionary, narrowed };
    } catch {
      // Classification is routing, not safety — default to build.
      return { intent: 'build', grounding: dictionary, narrowed };
    }
  };

  private planNode = async (state: State, config: NodeConfig): Promise<Partial<State>> => {
    const emit = config.configurable?.emit ?? (() => {});
    await emit({ type: 'status', phase: 'planning', message: 'Choosing a layout…' });

    let plan: PlannerOutput;
    try {
      plan = await this.backend.plan(state.prompt, state.grounding);
    } catch (err) {
      await emit({ type: 'error', message: `planner failed: ${message(err)}` });
      return { failed: true };
    }

    const sanitized = sanitizePlan(plan);
    if ('error' in sanitized) {
      await emit({ type: 'error', message: sanitized.error });
      return { failed: true };
    }
    plan = sanitized.plan;

    // Skeleton spec: every widget pending, renderable immediately.
    const skeleton: DashboardSpec = {
      specVersion: 1,
      title: plan.title,
      layout: plan.layout,
      params: plan.params,
      widgets: plan.widgets.map((w) => ({
        id: w.id,
        slot: w.slot,
        type: w.type,
        // Placeholder binding satisfying the widget's resultShape contract
        // so the skeleton passes the same gate as the final spec.
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
    await emit({ type: 'plan', spec: skeleton, pending });
    await emit({ type: 'status', phase: 'binding', message: 'Writing queries…' });
    return { plan, skeleton, pending };
  };

  private bindNode = async (task: BindTask, config: NodeConfig): Promise<Partial<State>> => {
    const emit = config.configurable?.emit ?? (() => {});
    const { binding, healed } = await this.bindWithHeal(task);
    const widget: WidgetSpec = {
      id: task.widget.id,
      slot: task.widget.slot,
      type: task.widget.type,
      binding: { sql: binding.sql, resultShape: binding.resultShape },
      props: binding.props,
      copy: { title: binding.title, caption: null },
    };
    const sample = await this.tryRun(binding.sql, task.plan.params);
    await emit({ type: 'widget', widget, healed: healed || undefined });
    return { bound: [{ widget, healed, sample: (sample ?? []).slice(0, 8) }] };
  };

  private assembleNode = async (state: State, config: NodeConfig): Promise<Partial<State>> => {
    const emit = config.configurable?.emit ?? (() => {});
    if (!state.skeleton || !state.plan) return {};

    let spec: DashboardSpec = {
      ...state.skeleton,
      widgets: state.skeleton.widgets.map(
        (w) => state.bound.find((b) => b.widget.id === w.id)?.widget ?? w,
      ),
    };

    // Final gate: the assembled spec must interpret cleanly.
    const result = interpret(spec);
    if (!result.ok) {
      await emit({
        type: 'error',
        message: 'generated spec failed validation',
        issues: result.issues,
      });
      return { failed: true };
    }

    await emit({ type: 'status', phase: 'copy', message: 'Writing captions…' });
    await Promise.all(
      spec.widgets.map(async (widget) => {
        try {
          const copy = await this.backend.copy({
            widgetId: widget.id,
            insight: state.pending[widget.id] ?? widget.copy.title ?? widget.type,
            currentTitle: widget.copy.title,
            sampleRows: state.bound.find((b) => b.widget.id === widget.id)?.sample ?? [],
            dashboardTitle: spec.title,
          });
          spec = {
            ...spec,
            widgets: spec.widgets.map((w) =>
              w.id === widget.id ? { ...w, copy: { title: copy.title, caption: copy.caption } } : w,
            ),
          };
          await emit({ type: 'copy', widgetId: widget.id, ...copy });
        } catch {
          // copy is decorative — a failure must never break the dashboard
        }
      }),
    );

    await emit({ type: 'done', spec });
    return {};
  };

  /**
   * Ask mode (D8): the binder writes ONE query through the same gates,
   * the executor runs it, and the answer stage states the finding in a
   * sentence — with the SQL attached, because every answer shows its work.
   */
  private askNode = async (state: State, config: NodeConfig): Promise<Partial<State>> => {
    const emit = config.configurable?.emit ?? (() => {});
    const ok = await this.answerQuestion(state.prompt, state.grounding, emit);
    return ok ? {} : { failed: true };
  };

  /**
   * Ask mode (D8): reuses the binder gates with the ask prompt, runs the
   * query through the same guarded executor, and inverts the copy pass
   * into a one-sentence answer. Reused by the graph's ask node and by a
   * question typed at an existing dashboard. Returns false on failure
   * (the caller decides how to surface it).
   */
  private async answerQuestion(
    prompt: string,
    grounding: DataDictionary,
    emit: EmitEvent,
  ): Promise<boolean> {
    await emit({ type: 'status', phase: 'answering', message: 'Looking that up…' });

    const widget: PlannedWidget = { id: 'answer', slot: 'main', type: 'table', insight: prompt };
    const plan: PlannerOutput = {
      title: prompt.slice(0, 120),
      layout: 'single-widget@1',
      params: {},
      widgets: [widget],
    };

    const attempt = async (feedback?: { sql: string; error: string }) => {
      const binding = await this.backend.bind({
        widget,
        plan,
        userPrompt: prompt,
        intent: 'ask',
        // Heal attempts get the FULL dictionary (D9 fallback).
        dictionary: feedback ? this.dictionary : grounding,
        feedback,
      });
      const started = Date.now();
      const result = await this.executor.run(binding.sql, {});
      return { binding, result, elapsedMs: Date.now() - started };
    };

    let outcome: Awaited<ReturnType<typeof attempt>>;
    try {
      outcome = await attempt();
    } catch (firstError) {
      try {
        outcome = await attempt({ sql: '', error: message(firstError) });
      } catch (secondError) {
        await emit({ type: 'error', message: `could not answer: ${message(secondError)}` });
        return false;
      }
    }

    try {
      const rows = outcome.result.rows.slice(0, 50);
      const { answer, value } = await this.backend.answer({
        prompt,
        sql: outcome.binding.sql,
        columns: outcome.result.columns,
        rows,
      });
      await emit({
        type: 'answer',
        answer,
        value,
        sql: outcome.binding.sql,
        rows: rows.slice(0, 20),
        elapsedMs: outcome.elapsedMs,
      });
    } catch (err) {
      await emit({ type: 'error', message: `could not answer: ${message(err)}` });
      return false;
    }
    return true;
  }

  // ── Bind + self-heal ──────────────────────────────────────────

  private async bindWithHeal(task: BindTask): Promise<{ binding: BinderOutput; healed: boolean }> {
    let lastSql = '';
    const attempt = async (feedback?: { sql: string; error: string }): Promise<BinderOutput> => {
      const binding = await this.backend.bind({
        widget: task.widget,
        plan: task.plan,
        userPrompt: task.prompt,
        feedback,
        // First attempt grounds on the (possibly narrowed) retrieval set;
        // the heal attempt always restores the FULL dictionary (D9).
        dictionary: feedback ? this.dictionary : task.grounding,
      });
      lastSql = binding.sql;
      validateBinding(task.widget, binding);
      // Dry-run through the full guardrail + database path. The database's
      // own error message is the heal feedback — nothing is synthesized.
      const result = await this.executor.run(binding.sql, task.plan.params);
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
        const def = getWidgetDefinition(task.widget.type);
        const required = def?.resultShape.required ?? [];
        const aliases = required.length > 0 ? required : (['value'] as const);
        const selectList = aliases.map((key) => `NULL AS ${key}`).join(', ');
        return {
          binding: {
            sql: `SELECT ${selectList} WHERE 1 = 0 -- ${message(secondError).slice(0, 120)}`,
            resultShape: Object.fromEntries(aliases.map((key) => [key, key])),
            title: task.widget.insight.slice(0, 60),
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
      const result = await this.executor.run(sql, params);
      return result.rows;
    } catch {
      return undefined;
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Maps the answer's columns onto a pinned widget type's visual roles. */
function pinResultShape(
  type: string,
  col0: string,
  col1: string,
  columns: string[],
): Record<string, string | string[]> {
  switch (type) {
    case 'kpi_card':
    case 'gauge':
      return { value: col0 };
    case 'leaderboard':
    case 'donut_chart':
      return { label: col0, value: col1 };
    case 'bar_chart':
    case 'line_chart':
    case 'area_chart':
    case 'scatter_chart':
      return { x: col0, y: col1 };
    default:
      return { columns };
  }
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
