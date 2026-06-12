import type { DashboardSpec, ParamDescriptor, ParamValue } from '../types.js';

/**
 * Dashboard params are the re-parameterization surface of a spec: the same
 * artifact re-runs for any date range, region, or entity. SQL references
 * them as `{{params.name}}`; the server resolves those as bound parameters.
 * The client only needs to know which params exist and how to render
 * controls for them — that is what this module derives.
 */

export const PARAM_TOKEN = /\{\{\s*params\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Param names referenced by one SQL string, in order of first appearance. */
export function paramsInSql(sql: string): string[] {
  const seen = new Set<string>();
  for (const match of sql.matchAll(PARAM_TOKEN)) {
    seen.add(match[1]!);
  }
  return [...seen];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function inferControl(value: ParamValue): ParamDescriptor['control'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'select';
  if (ISO_DATE.test(value)) return 'date';
  return 'text';
}

/**
 * Derives the filter-bar model: every param declared in spec.params,
 * its inferred control type, and which widgets reference it.
 * Params referenced in SQL but missing from spec.params are also
 * surfaced (with an empty default) so the gap is visible.
 */
export function extractParams(spec: DashboardSpec): ParamDescriptor[] {
  const usage = new Map<string, string[]>();
  for (const widget of spec.widgets) {
    for (const name of paramsInSql(widget.binding.sql)) {
      const widgets = usage.get(name) ?? [];
      widgets.push(widget.id);
      usage.set(name, widgets);
    }
  }

  const descriptors: ParamDescriptor[] = [];
  for (const [name, defaultValue] of Object.entries(spec.params)) {
    descriptors.push({
      name,
      control: inferControl(defaultValue),
      defaultValue,
      usedBy: usage.get(name) ?? [],
    });
    usage.delete(name);
  }
  // Referenced but undeclared — keep visible rather than silently broken.
  for (const [name, usedBy] of usage) {
    descriptors.push({ name, control: 'text', defaultValue: '', usedBy });
  }
  return descriptors;
}

/** Widget ids that must refetch when `changed` params are updated. */
export function widgetsAffectedBy(spec: DashboardSpec, changed: string[]): Set<string> {
  const affected = new Set<string>();
  const changedSet = new Set(changed);
  for (const widget of spec.widgets) {
    if (paramsInSql(widget.binding.sql).some((p) => changedSet.has(p))) {
      affected.add(widget.id);
    }
  }
  return affected;
}
