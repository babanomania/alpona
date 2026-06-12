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
  phase: 'planning' | 'binding' | 'copy';
  message: string;
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
  | DoneEvent
  | ErrorEvent;

export interface GenerateRequest {
  prompt: string;
  /** Present when refining an existing dashboard. */
  spec?: DashboardSpec;
  /** Scope a refinement to one widget ("top 5 only" on a click). */
  targetWidgetId?: string;
}

export interface QueryRequest {
  sql: string;
  params: Record<string, string | number | boolean>;
}
