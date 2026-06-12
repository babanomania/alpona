/**
 * Core type system for Alpona.
 *
 * A DashboardSpec is the durable artifact the agent produces: portable,
 * versioned, diffable, and free of data values. Everything else in this file
 * describes the contracts that bound what the agent may express — layout slot
 * contracts and widget registry contracts.
 */

// ── Params ─────────────────────────────────────────────────────────

export type ParamValue = string | number | boolean;

export interface ParamDescriptor {
  name: string;
  /** Inferred control type for the auto-generated filter bar. */
  control: 'date' | 'select' | 'text' | 'number';
  defaultValue: ParamValue;
  /** Which widget ids reference this param (for scoped refresh). */
  usedBy: string[];
}

// ── Result shapes ──────────────────────────────────────────────────

/**
 * Maps result-set columns onto the visual roles a widget understands.
 * Each widget type declares which keys are required/optional in its
 * registry entry; the interpreter enforces that contract.
 */
export interface ResultShape {
  /** Column for the x axis / category dimension. */
  x?: string;
  /** Column for the measure on the y axis. */
  y?: string;
  /** Column whose distinct values split the data into series. */
  series?: string;
  /** Column for a row label (donut slices, leaderboard entries). */
  label?: string;
  /** Column for a single headline measure (kpi, gauge, donut value). */
  value?: string;
  /** Column with a comparison delta (kpi cards). */
  delta?: string;
  /** Column with a target/threshold measure (gauge). */
  target?: string;
  /** Column controlling point size (scatter). */
  size?: string;
  /** Explicit column order for tables; omit to show all columns. */
  columns?: string[];
}

export type ResultShapeKey = keyof ResultShape;

// ── Widgets ────────────────────────────────────────────────────────

export interface WidgetBinding {
  /**
   * A single SELECT statement. May reference dashboard params as
   * `{{params.name}}` placeholders; the server resolves these as bound
   * parameters, never via string interpolation.
   */
  sql: string;
  resultShape: ResultShape;
}

export interface WidgetCopy {
  title: string | null;
  /** One-line insight caption, written by the async copy pass. */
  caption: string | null;
}

export interface WidgetSpec {
  /** Stable identifier — JSON Patch refinements address widgets by id. */
  id: string;
  /** Slot id within the layout template. */
  slot: string;
  /** Widget type key registered in the widget registry. */
  type: string;
  binding: WidgetBinding;
  /** Per-type presentation props, validated by the registry's zod schema. */
  props?: Record<string, unknown>;
  copy: WidgetCopy;
}

export interface DashboardSpec {
  /** Spec format version; bump on breaking schema changes. */
  specVersion: 1;
  title: string;
  /** Pinned layout template reference, e.g. "ops-monitor@2". */
  layout: string;
  params: Record<string, ParamValue>;
  widgets: WidgetSpec[];
}

// ── Layout templates ───────────────────────────────────────────────

export type SlotRole = 'kpi-strip' | 'hero' | 'secondary' | 'table' | 'side' | 'footer';

/** How multiple widgets divide a slot's region. */
export type SlotPacking = 'row' | 'column' | 'grid';

/** What happens when a slot receives more widgets than maxWidgets. */
export type SlotOverflow = 'truncate' | 'wrap';

export interface SlotRegion {
  /** Column start, 0-based, in a 12-column grid. */
  x: number;
  /** Row start, 0-based, relative to the template (bands may shift down). */
  y: number;
  /** Column span, 1–12. */
  w: number;
  /** Row span. */
  h: number;
}

export interface SlotContract {
  id: string;
  role: SlotRole;
  /** Human guidance surfaced to the planner prompt. */
  description: string;
  /** Widget types this slot accepts; empty array means any registered type. */
  accepts: string[];
  minWidgets: number;
  maxWidgets: number;
  packing: SlotPacking;
  overflow: SlotOverflow;
  region: SlotRegion;
}

export interface LayoutTemplate {
  name: string;
  version: number;
  /** One-line guidance the planner reads when choosing a template. */
  whenToUse: string;
  description: string;
  columns: 12;
  slots: SlotContract[];
}

/** Parses "ops-monitor@2" into name + version. */
export interface LayoutRef {
  name: string;
  version: number;
}

// ── Composition output ─────────────────────────────────────────────

export interface WidgetPlacement {
  widgetId: string;
  slot: string;
  /** Final absolute grid coordinates (12-column grid, row units). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompositionDiagnostic {
  severity: 'info' | 'warning';
  slot: string;
  widgetId?: string;
  message: string;
}

export interface Composition {
  placements: WidgetPlacement[];
  /** Total grid rows occupied (for sizing the container). */
  rows: number;
  diagnostics: CompositionDiagnostic[];
}

// ── Validation ─────────────────────────────────────────────────────

export interface SpecIssue {
  /** JSON Pointer-ish path into the spec, e.g. "/widgets/2/binding". */
  path: string;
  code:
    | 'schema'
    | 'unknown-layout'
    | 'unknown-widget-type'
    | 'unknown-slot'
    | 'slot-rejects-type'
    | 'result-shape'
    | 'props'
    | 'duplicate-id';
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: SpecIssue[];
}

// ── Query results ──────────────────────────────────────────────────

export type Row = Record<string, unknown>;

export interface QueryResult {
  rows: Row[];
  columns: string[];
  /** Milliseconds spent executing on the database. */
  elapsedMs: number;
  /** True when the enforced row cap truncated the result. */
  truncated: boolean;
}
