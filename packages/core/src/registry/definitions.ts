import { z } from 'zod';
import type { ResultShapeKey } from '../types.js';

/**
 * Widget registry — the design-system contract.
 *
 * Each entry tells three audiences what a widget is:
 *  - the binder prompt (agentHints + resultShape docs + sql guidance)
 *  - the interpreter (resultShape contract + props schema)
 *  - the composer (sizing in grid units)
 *
 * Render components are registered separately in the React layer so the
 * server can import these definitions without pulling in React.
 */

export interface ResultShapeContract {
  required: ResultShapeKey[];
  optional: ResultShapeKey[];
  /** Per-key meaning, surfaced verbatim in the binder prompt. */
  docs: Partial<Record<ResultShapeKey, string>>;
}

export interface WidgetSizing {
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
}

export interface WidgetDefinition {
  type: string;
  description: string;
  agentHints: {
    whenToUse: string;
    sqlGuidance: string;
  };
  resultShape: ResultShapeContract;
  propsSchema: z.ZodType;
  sizing: WidgetSizing;
}

const axisProps = {
  yLabel: z.string().max(40).optional(),
  yFormat: z.enum(['number', 'percent', 'currency', 'duration']).optional(),
};

export const widgetDefinitions: readonly WidgetDefinition[] = [
  {
    type: 'kpi_card',
    description: 'Single headline number with an optional period-over-period delta.',
    agentHints: {
      whenToUse:
        'One scalar that answers "how are we doing right now" — totals, rates, counts. Use several side by side for a KPI strip.',
      sqlGuidance:
        'Return exactly one row. Compute the delta in SQL when a comparison is asked for (e.g. vs previous period), as a signed percentage.',
    },
    resultShape: {
      required: ['value'],
      optional: ['delta'],
      docs: {
        value: 'column holding the headline number (single row)',
        delta: 'signed percent change vs comparison period, e.g. -12.5',
      },
    },
    propsSchema: z
      .object({
        format: z.enum(['number', 'percent', 'currency', 'duration']).optional(),
        unit: z.string().max(12).optional(),
        /** When true, a positive delta is bad (e.g. delay, cost). */
        invertDelta: z.boolean().optional(),
      })
      .strict(),
    sizing: { minW: 2, minH: 2, defaultW: 3, defaultH: 2 },
  },
  {
    type: 'line_chart',
    description: 'Trend over a continuous (usually time) axis, one line per series.',
    agentHints: {
      whenToUse: 'Anything evolving over time: trends, rolling averages, week-over-week movement.',
      sqlGuidance:
        'Return one row per (x, series). Truncate timestamps to a sensible grain (date_trunc) and ORDER BY the x column.',
    },
    resultShape: {
      required: ['x', 'y'],
      optional: ['series'],
      docs: {
        x: 'time or ordered dimension column',
        y: 'measure column',
        series: 'optional column splitting rows into one line per distinct value',
      },
    },
    propsSchema: z.object({ ...axisProps, smooth: z.boolean().optional() }).strict(),
    sizing: { minW: 4, minH: 3, defaultW: 8, defaultH: 4 },
  },
  {
    type: 'bar_chart',
    description: 'Categorical comparison, vertical or horizontal, optionally grouped or stacked.',
    agentHints: {
      whenToUse:
        'Comparing a measure across categories (carriers, regions, suppliers). Stack when parts of a whole matter.',
      sqlGuidance:
        'Return one row per (x, series). Keep cardinality readable: aggregate and ORDER BY the measure, top 10–15 categories.',
    },
    resultShape: {
      required: ['x', 'y'],
      optional: ['series'],
      docs: {
        x: 'category column',
        y: 'measure column',
        series: 'optional column for grouped/stacked sub-bars',
      },
    },
    propsSchema: z
      .object({
        ...axisProps,
        stacked: z.boolean().optional(),
        horizontal: z.boolean().optional(),
      })
      .strict(),
    sizing: { minW: 4, minH: 3, defaultW: 6, defaultH: 4 },
  },
  {
    type: 'area_chart',
    description: 'Stacked composition over time — how parts contribute to a whole.',
    agentHints: {
      whenToUse:
        'Volume over time where composition matters (orders by status, capacity by warehouse).',
      sqlGuidance: 'Same shape as line_chart: one row per (x, series), ordered by x.',
    },
    resultShape: {
      required: ['x', 'y'],
      optional: ['series'],
      docs: {
        x: 'time or ordered dimension column',
        y: 'measure column',
        series: 'optional stacking column',
      },
    },
    propsSchema: z.object({ ...axisProps, stacked: z.boolean().optional() }).strict(),
    sizing: { minW: 4, minH: 3, defaultW: 8, defaultH: 4 },
  },
  {
    type: 'donut_chart',
    description: 'Share-of-total for a small number of categories.',
    agentHints: {
      whenToUse:
        'Composition snapshots with ≤ 6 slices (share by carrier, status mix). Prefer bar_chart above 6 categories.',
      sqlGuidance:
        'Return one row per category: a label column and a value column, ordered by value DESC.',
    },
    resultShape: {
      required: ['label', 'value'],
      optional: [],
      docs: {
        label: 'category name column',
        value: 'measure column (share is computed client-side)',
      },
    },
    propsSchema: z
      .object({ format: z.enum(['number', 'percent', 'currency']).optional() })
      .strict(),
    sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 },
  },
  {
    type: 'scatter_chart',
    description: 'Correlation between two measures across entities, optional bubble size.',
    agentHints: {
      whenToUse:
        'Relationships between two measures (lead time vs spend, volume vs delay) where each point is an entity.',
      sqlGuidance:
        'Return one row per entity with two numeric columns; include a series column to color groups and a size column for bubbles.',
    },
    resultShape: {
      required: ['x', 'y'],
      optional: ['series', 'size', 'label'],
      docs: {
        x: 'numeric measure for the x axis',
        y: 'numeric measure for the y axis',
        series: 'optional grouping column for color',
        size: 'optional numeric column for bubble size',
        label: 'optional entity name for tooltips',
      },
    },
    propsSchema: z.object(axisProps).strict(),
    sizing: { minW: 4, minH: 3, defaultW: 6, defaultH: 4 },
  },
  {
    type: 'heatmap',
    description: 'Intensity matrix across two categorical dimensions.',
    agentHints: {
      whenToUse:
        'Two crossed dimensions with a measure in each cell (warehouse × weekday utilization, carrier × lane delays).',
      sqlGuidance:
        'Return one row per (x, y) cell with a numeric value column. Keep both dimensions ≤ 14 distinct values.',
    },
    resultShape: {
      required: ['x', 'y', 'value'],
      optional: [],
      docs: {
        x: 'column dimension',
        y: 'row dimension',
        value: 'cell intensity measure',
      },
    },
    propsSchema: z
      .object({ format: z.enum(['number', 'percent', 'currency']).optional() })
      .strict(),
    sizing: { minW: 4, minH: 3, defaultW: 6, defaultH: 4 },
  },
  {
    type: 'table',
    description: 'Sortable drill-down grid of raw result rows.',
    agentHints: {
      whenToUse:
        'Operational detail the user will scan or act on row by row: exception lists, worklists, top-N detail.',
      sqlGuidance:
        'Select only the columns a human needs, aliased to readable names. Order by the most actionable column. 50 rows max.',
    },
    resultShape: {
      required: [],
      optional: ['columns'],
      docs: {
        columns: 'optional explicit column order; omit to show all result columns',
      },
    },
    propsSchema: z
      .object({
        pageSize: z.number().int().min(5).max(50).optional(),
        highlightColumn: z.string().optional(),
      })
      .strict(),
    sizing: { minW: 4, minH: 3, defaultW: 12, defaultH: 5 },
  },
  {
    type: 'gauge',
    description: 'Progress of a single measure toward a target or capacity.',
    agentHints: {
      whenToUse:
        'A value with a meaningful 0–max range or explicit target: utilization %, SLA attainment, fill rate.',
      sqlGuidance:
        'Return one row with a value column and, when available, a target column. Express percentages as 0–100.',
    },
    resultShape: {
      required: ['value'],
      optional: ['target'],
      docs: {
        value: 'current measure (single row)',
        target: 'optional target/threshold to mark on the arc',
      },
    },
    propsSchema: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        unit: z.string().max(12).optional(),
      })
      .strict(),
    sizing: { minW: 2, minH: 2, defaultW: 3, defaultH: 3 },
  },
  {
    type: 'leaderboard',
    description: 'Ranked list with proportional bars — top performers or worst offenders.',
    agentHints: {
      whenToUse:
        'Ranking entities by one measure where the order is the message (worst carriers, top SKUs at risk).',
      sqlGuidance:
        'Return ≤ 10 rows: a label column and a value column, ORDER BY value in the telling direction.',
    },
    resultShape: {
      required: ['label', 'value'],
      optional: ['delta'],
      docs: {
        label: 'entity name column',
        value: 'ranking measure column',
        delta: 'optional signed percent change shown next to each entry',
      },
    },
    propsSchema: z
      .object({
        format: z.enum(['number', 'percent', 'currency', 'duration']).optional(),
        /** When true, high values are bad and are tinted as such. */
        invertColor: z.boolean().optional(),
      })
      .strict(),
    sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 },
  },
];
