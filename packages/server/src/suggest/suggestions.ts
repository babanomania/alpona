import type { DataDictionary } from '@alpona/core';

/**
 * Suggested prompts for the landing page, derived deterministically from
 * the data dictionary — no LLM call, so they appear instantly, work in
 * mock mode, and automatically adapt to whatever schema `alpona
 * dictionary` imported. The heuristics mirror what the planner is good
 * at: trends need a date column, breakdowns need a low-cardinality
 * dimension plus a measure, exception lists need a boolean flag.
 */

interface TableProfile {
  name: string;
  description: string;
  human: string;
  dateColumns: string[];
  measureColumns: string[];
  dimensionColumns: string[];
  flagColumns: string[];
}

const MEASURE_TYPES = new Set(['integer', 'bigint', 'double', 'decimal', 'real', 'float']);
const DATE_TYPES = new Set(['date', 'timestamp', 'timestamptz', 'datetime']);

function humanize(identifier: string): string {
  return identifier.replaceAll('_', ' ');
}

/**
 * Lowercases the leading letter and clips trailing qualifiers ("… — the
 * first stop for X questions") so descriptions read mid-sentence.
 */
function midSentence(text: string): string {
  const clipped = text.split(/\s+—\s+/)[0]!;
  const trimmed = clipped.trim().replace(/\.$/, '');
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function profile(dictionary: DataDictionary): TableProfile[] {
  // Marts are the curated analytical surface — suggestions stay there.
  const tables = dictionary.tables.filter((t) => t.kind === 'mart');
  return tables.map((table) => {
    const dateColumns: string[] = [];
    const measureColumns: string[] = [];
    const dimensionColumns: string[] = [];
    const flagColumns: string[] = [];
    for (const column of table.columns) {
      const type = column.type.toLowerCase();
      if (DATE_TYPES.has(type)) dateColumns.push(column.name);
      else if (type === 'boolean') flagColumns.push(column.name);
      else if (MEASURE_TYPES.has(type) && !column.name.endsWith('_id') && column.name !== 'id')
        measureColumns.push(column.name);
      else if (
        column.cardinality !== undefined &&
        column.cardinality > 1 &&
        column.cardinality <= 25
      )
        dimensionColumns.push(column.name);
    }
    return {
      name: table.name,
      description: table.description ?? humanize(table.name),
      human: humanize(table.name),
      dateColumns,
      measureColumns,
      dimensionColumns,
      flagColumns,
    };
  });
}

export function suggestPrompts(dictionary: DataDictionary, count = 5): string[] {
  const profiles = profile(dictionary);
  if (profiles.length === 0) return [];
  const suggestions: string[] = [];

  // 1. The everything-view: one overview spanning the analytical marts.
  if (profiles.length > 1) {
    const parts = profiles.slice(0, 3).map((p) => midSentence(p.description));
    suggestions.push(`Operations overview: ${parts.join(', ')}.`);
  }

  // 2. Breakdown: measure by dimension, per mart that supports it.
  for (const p of profiles) {
    if (p.measureColumns.length > 0 && p.dimensionColumns.length > 0) {
      suggestions.push(
        `Break down ${humanize(p.measureColumns[0]!)} by ${humanize(p.dimensionColumns[0]!)} — top contributors, and how they compare.`,
      );
    }
  }

  // 3. Trend: needs a date column and a measure.
  for (const p of profiles) {
    if (p.dateColumns.length > 0 && p.measureColumns.length > 0) {
      suggestions.push(
        `How is ${humanize(p.measureColumns[0]!)} trending over time${p.dimensionColumns[0] ? ` by ${humanize(p.dimensionColumns[0])}` : ''}?`,
      );
    }
  }

  // 4. Exceptions: boolean flags make natural watchlists.
  for (const p of profiles) {
    if (p.flagColumns.length > 0) {
      suggestions.push(
        `Which records are ${humanize(p.flagColumns[0]!).replace(/^is /, '')}? Show the rate as a KPI and list the worst cases.`,
      );
    }
  }

  // De-dupe, keep order, cap.
  return [...new Set(suggestions)].slice(0, count);
}
