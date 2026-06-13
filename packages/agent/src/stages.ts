import { z } from 'zod';
import type { DashboardSpec, DataDictionary, ParamValue, ResultShape } from '@alpona/core';
import type { PatchOperation } from '@alpona/core';

/**
 * Stage contracts for the five-stage pipeline: classify / plan / bind /
 * copy / answer (+ refine). Every backend — Anthropic, OpenAI-compatible,
 * and the deterministic mock — implements this interface, so the graph,
 * server routes, and tests are backend-agnostic.
 */

export type Intent = 'ask' | 'build';

export interface ClassifyOutput {
  intent: Intent;
}

export interface PlannedWidget {
  id: string;
  slot: string;
  type: string;
  /** One-line description of the insight this widget should deliver. */
  insight: string;
}

export interface PlannerOutput {
  title: string;
  layout: string;
  params: Record<string, ParamValue>;
  widgets: PlannedWidget[];
}

export interface BinderRequest {
  widget: PlannedWidget;
  plan: PlannerOutput;
  userPrompt: string;
  /** Set on the self-heal attempt: the database's own error message. */
  feedback?: { sql: string; error: string };
  /**
   * Grounding override: the retrieval-narrowed dictionary when the full
   * one exceeds the token budget. Self-heal attempts pass the FULL
   * dictionary here (the D9 relation-not-found fallback).
   */
  dictionary?: DataDictionary;
  /** 'ask' binds one query that answers a question, not a widget. */
  intent?: Intent;
}

export interface BinderOutput {
  sql: string;
  resultShape: ResultShape;
  props?: Record<string, unknown>;
  title: string;
}

export interface CopyRequest {
  widgetId: string;
  insight: string;
  currentTitle: string | null;
  /** A few result rows for grounding the caption. */
  sampleRows: Record<string, unknown>[];
  dashboardTitle: string;
}

export interface CopyOutput {
  title: string;
  caption: string;
}

export interface RefineRequest {
  spec: DashboardSpec;
  prompt: string;
  targetWidgetId?: string;
}

export interface RefineOutput {
  operations: PatchOperation[];
}

export interface AnswerRequest {
  prompt: string;
  sql: string;
  columns: string[];
  /** Result rows (capped) the answer must be grounded in. */
  rows: Record<string, unknown>[];
}

export interface AnswerOutput {
  /** One sentence, stating the finding — never a description of the query. */
  answer: string;
  /** The headline value when the result reduces to one. */
  value?: string | number | null;
}

export interface AgentBackend {
  classify(userPrompt: string): Promise<ClassifyOutput>;
  plan(userPrompt: string, dictionary?: DataDictionary): Promise<PlannerOutput>;
  bind(request: BinderRequest): Promise<BinderOutput>;
  copy(request: CopyRequest): Promise<CopyOutput>;
  answer(request: AnswerRequest): Promise<AnswerOutput>;
  refine(request: RefineRequest): Promise<RefineOutput>;
}

// ── Output schemas (the parse gate for LLM responses) ──────────────

export const classifyOutputSchema = z.object({
  intent: z.enum(['ask', 'build']),
});

export const answerOutputSchema = z.object({
  answer: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 300)),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

// The planner stage has no heal loop, so its advisory-only fields clamp
// instead of failing: title heads the dashboard and insight only guides
// binders — neither is worth losing a generation over when a verbose
// model overruns the budget. Structural fields stay strict.
export const plannerOutputSchema = z.object({
  title: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 120)),
  layout: z.string().regex(/^[a-z][a-z0-9-]*@\d+$/),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  widgets: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]*$/),
        slot: z.string().min(1),
        type: z.string().min(1),
        insight: z
          .string()
          .min(1)
          .transform((s) => s.slice(0, 200)),
      }),
    )
    .min(1)
    .max(12),
});

const resultShapeSchema = z
  .object({
    x: z.string().optional(),
    y: z.string().optional(),
    series: z.string().optional(),
    label: z.string().optional(),
    value: z.string().optional(),
    delta: z.string().optional(),
    target: z.string().optional(),
    size: z.string().optional(),
    columns: z.array(z.string()).optional(),
  })
  .strict();

export const binderOutputSchema = z.object({
  sql: z.string().min(1).max(8000),
  resultShape: resultShapeSchema,
  // Smaller models often emit `"props": null` for "no props"; treat it as
  // absent rather than failing the whole binding over it.
  props: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((value) => value ?? undefined),
  title: z.string().min(1).max(120),
});

export const copyOutputSchema = z.object({
  title: z.string().min(1).max(120),
  caption: z.string().min(1).max(240),
});

export const refineOutputSchema = z.object({
  operations: z
    .array(
      z.object({
        op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
        path: z.string(),
        value: z.unknown().optional(),
        from: z.string().optional(),
      }),
    )
    .min(1)
    .max(40),
});
