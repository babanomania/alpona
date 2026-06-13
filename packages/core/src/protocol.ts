import type { DashboardSpec, SpecIssue, WidgetSpec } from './types.js';
import type { PatchOperation } from './engine/patch.js';

/**
 * The SSE wire protocol between the agent service and the rendering
 * engine. Generation streams in pipeline order: plan (skeleton renders
 * immediately) → one `widget` event per slot binding as binders finish in
 * parallel → async `copy` events → `done`. Refinements stream `patch`
 * events instead.
 */

export interface PlanEvent {
  type: 'plan';
  /** Spec skeleton: layout + slots chosen, bindings still pending. */
  spec: DashboardSpec;
  /** Insight description per widget id, for skeleton placeholders. */
  pending: Record<string, string>;
}

export interface WidgetEvent {
  type: 'widget';
  /** Fully bound widget, replacing the pending placeholder of the same id. */
  widget: WidgetSpec;
  /** True when this binding needed the self-heal loop. */
  healed?: boolean;
}

export interface PatchEvent {
  type: 'patch';
  /** RFC 6902 operations against the current spec. */
  operations: PatchOperation[];
}

export interface CopyEvent {
  type: 'copy';
  widgetId: string;
  title: string | null;
  caption: string | null;
}

export interface StatusEvent {
  type: 'status';
  phase: 'classifying' | 'planning' | 'binding' | 'copy' | 'answering';
  message: string;
}

export interface AnswerEvent {
  type: 'answer';
  /** One-sentence answer grounded in the query result. */
  answer: string;
  /** The headline value when the result reduces to one. */
  value?: string | number | null;
  /** The exact SQL that produced it — every answer shows its work. */
  sql: string;
  /** Result rows backing the answer (capped), for the answer card. */
  rows: Record<string, unknown>[];
  /** Execution time, for the "ran this query · Ns" line. */
  elapsedMs?: number;
}

export interface DoneEvent {
  type: 'done';
  /** The final, validated spec — the durable artifact. */
  spec: DashboardSpec;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  issues?: SpecIssue[];
}

export type GenerationEvent =
  | PlanEvent
  | WidgetEvent
  | PatchEvent
  | CopyEvent
  | StatusEvent
  | AnswerEvent
  | DoneEvent
  | ErrorEvent;

export interface GenerateRequest {
  prompt: string;
  /** Present when refining an existing dashboard. */
  spec?: DashboardSpec;
  /** Scope a refinement to one widget ("top 5 only" on a click). */
  targetWidgetId?: string;
  /** Pin an ask-mode answer onto the dashboard as a widget. */
  pinAnswer?: { sql: string; title: string; columns: string[] };
}

export interface QueryRequest {
  sql: string;
  params: Record<string, string | number | boolean>;
}
