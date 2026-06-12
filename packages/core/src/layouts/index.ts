import { z } from 'zod';
import type { LayoutRef, LayoutTemplate } from '../types.js';

import opsMonitor from './templates/ops-monitor.json' with { type: 'json' };
import kpiOverview from './templates/kpi-overview.json' with { type: 'json' };
import execSummary from './templates/exec-summary.json' with { type: 'json' };
import deepDive from './templates/deep-dive.json' with { type: 'json' };
import comparison from './templates/comparison.json' with { type: 'json' };
import focusMetric from './templates/focus-metric.json' with { type: 'json' };
import chartGrid from './templates/chart-grid.json' with { type: 'json' };
import tableFirst from './templates/table-first.json' with { type: 'json' };
import trendWall from './templates/trend-wall.json' with { type: 'json' };
import matrixView from './templates/matrix-view.json' with { type: 'json' };
import singleWidget from './templates/single-widget.json' with { type: 'json' };
import twoTier from './templates/two-tier.json' with { type: 'json' };

const slotSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    role: z.enum(['kpi-strip', 'hero', 'secondary', 'table', 'side', 'footer']),
    description: z.string().min(1),
    accepts: z.array(z.string()),
    minWidgets: z.number().int().min(0),
    maxWidgets: z.number().int().min(1),
    packing: z.enum(['row', 'column', 'grid']),
    overflow: z.enum(['truncate', 'wrap']),
    region: z.object({
      x: z.number().int().min(0).max(11),
      y: z.number().int().min(0),
      w: z.number().int().min(1).max(12),
      h: z.number().int().min(1),
    }),
  })
  .strict()
  .refine((s) => s.minWidgets <= s.maxWidgets, { message: 'minWidgets must be ≤ maxWidgets' })
  .refine((s) => s.region.x + s.region.w <= 12, { message: 'region exceeds 12 columns' });

export const layoutTemplateSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: z.number().int().min(1),
    whenToUse: z.string().min(1),
    description: z.string().min(1),
    columns: z.literal(12),
    slots: z.array(slotSchema).min(1),
  })
  .strict()
  .refine((t) => new Set(t.slots.map((s) => s.id)).size === t.slots.length, {
    message: 'slot ids must be unique',
  });

const rawTemplates = [
  opsMonitor,
  kpiOverview,
  execSummary,
  deepDive,
  comparison,
  focusMetric,
  chartGrid,
  tableFirst,
  trendWall,
  matrixView,
  singleWidget,
  twoTier,
];

/** All bundled layout templates, validated at module load. */
export const layoutTemplates: readonly LayoutTemplate[] = rawTemplates.map(
  (t) => layoutTemplateSchema.parse(t) as LayoutTemplate,
);

const byRef = new Map<string, LayoutTemplate>(
  layoutTemplates.map((t) => [`${t.name}@${t.version}`, t]),
);

export function parseLayoutRef(ref: string): LayoutRef | undefined {
  const match = /^([a-z][a-z0-9-]*)@(\d+)$/.exec(ref);
  if (!match) return undefined;
  return { name: match[1]!, version: Number(match[2]!) };
}

/** Resolves a pinned reference like "ops-monitor@2". */
export function getLayout(ref: string): LayoutTemplate | undefined {
  return byRef.get(ref);
}
