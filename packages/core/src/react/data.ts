import type { ResultShape, Row } from '../types.js';
import { toNumber } from './format.js';

export interface PivotedSeries {
  /** One object per distinct x, with one numeric key per series. */
  data: Record<string, unknown>[];
  /** Ordered series keys (single-measure name when no series column). */
  seriesKeys: string[];
}

function xKeyOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

/**
 * Long-format rows (x, y, series?) → recharts-friendly wide format.
 * Without a series column the measure column name is the single key.
 */
export function pivotSeries(rows: Row[], shape: ResultShape): PivotedSeries {
  const xCol = shape.x ?? '';
  const yCol = shape.y ?? '';

  if (!shape.series) {
    const key = yCol || 'value';
    return {
      data: rows.map((row) => ({ __x: row[xCol], [key]: toNumber(row[yCol]) })),
      seriesKeys: [key],
    };
  }

  const seriesKeys: string[] = [];
  const byX = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const xk = xKeyOf(row[xCol]);
    let entry = byX.get(xk);
    if (!entry) {
      entry = { __x: row[xCol] };
      byX.set(xk, entry);
    }
    const seriesName = String(row[shape.series] ?? '∅');
    if (!seriesKeys.includes(seriesName)) seriesKeys.push(seriesName);
    entry[seriesName] = toNumber(row[yCol]);
  }
  return { data: [...byX.values()], seriesKeys };
}

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

/** True when every non-null value in the column parses as a number. */
export function isNumericColumn(rows: Row[], column: string): boolean {
  let seen = false;
  for (const row of rows) {
    const v = row[column];
    if (v == null) continue;
    seen = true;
    if (Number.isNaN(toNumber(v))) return false;
  }
  return seen;
}
