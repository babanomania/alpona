import { describe, expect, it } from 'vitest';
import { compose } from '../src/engine/composer.js';
import { getLayout } from '../src/layouts/index.js';
import type { DashboardSpec, WidgetSpec } from '../src/types.js';

function widget(id: string, slot: string, type: string): WidgetSpec {
  return {
    id,
    slot,
    type,
    binding: { sql: 'SELECT 1', resultShape: {} },
    copy: { title: null, caption: null },
  };
}

function spec(widgets: WidgetSpec[], layout = 'ops-monitor@2'): DashboardSpec {
  return { specVersion: 1, title: 'Test', layout, params: {}, widgets };
}

describe('compose — row packing', () => {
  it('splits a KPI strip evenly across the full width', () => {
    const layout = getLayout('ops-monitor@2')!;
    const s = spec([
      widget('k1', 'kpis', 'kpi_card'),
      widget('k2', 'kpis', 'kpi_card'),
      widget('k3', 'kpis', 'kpi_card'),
      widget('k4', 'kpis', 'kpi_card'),
    ]);
    const result = compose(s, layout);
    const kpis = result.placements.filter((p) => p.slot === 'kpis');
    expect(kpis).toHaveLength(4);
    expect(kpis.map((p) => p.w)).toEqual([3, 3, 3, 3]);
    expect(kpis.map((p) => p.x)).toEqual([0, 3, 6, 9]);
    expect(new Set(kpis.map((p) => p.y))).toEqual(new Set([0]));
  });

  it('distributes remainder columns left-first for 3 widgets', () => {
    const layout = getLayout('ops-monitor@2')!;
    const s = spec([
      widget('k1', 'kpis', 'kpi_card'),
      widget('k2', 'kpis', 'kpi_card'),
      widget('k3', 'kpis', 'kpi_card'),
    ]);
    const kpis = compose(s, layout).placements;
    expect(kpis.map((p) => p.w)).toEqual([4, 4, 4]);
  });

  it('truncates beyond maxWidgets with a diagnostic', () => {
    const layout = getLayout('ops-monitor@2')!;
    const s = spec(Array.from({ length: 6 }, (_, i) => widget(`k${i}`, 'kpis', 'kpi_card')));
    const result = compose(s, layout);
    expect(result.placements.filter((p) => p.slot === 'kpis')).toHaveLength(4);
    expect(result.diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(2);
  });
});

describe('compose — column packing', () => {
  it('stacks side-rail widgets vertically', () => {
    const layout = getLayout('ops-monitor@2')!;
    const s = spec([
      widget('h', 'hero', 'line_chart'),
      widget('s1', 'side', 'donut_chart'),
      widget('s2', 'side', 'leaderboard'),
    ]);
    const side = compose(s, layout).placements.filter((p) => p.slot === 'side');
    expect(side).toHaveLength(2);
    expect(side[0]).toMatchObject({ x: 8, y: 2, w: 4, h: 2 });
    expect(side[1]).toMatchObject({ x: 8, y: 4, w: 4, h: 2 });
  });
});

describe('compose — grid packing and band shifting', () => {
  it('lays out a KPI grid in balanced rows', () => {
    const layout = getLayout('kpi-overview@1')!;
    const s = spec(
      Array.from({ length: 6 }, (_, i) => widget(`k${i}`, 'kpis', 'kpi_card')),
      'kpi-overview@1',
    );
    const result = compose(s, layout);
    const kpis = result.placements.filter((p) => p.slot === 'kpis');
    expect(kpis).toHaveLength(6);
    const rows = new Set(kpis.map((p) => p.y));
    expect(rows.size).toBe(1); // 6 cards fit one row at minW 2
    expect(kpis.map((p) => p.w)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('wraps an overfull grid and pushes the next band down', () => {
    const layout = getLayout('kpi-overview@1')!;
    const s = spec(
      [
        ...Array.from({ length: 8 }, (_, i) => widget(`k${i}`, 'kpis', 'kpi_card')),
        widget('t', 'trend', 'line_chart'),
      ],
      'kpi-overview@1',
    );
    const result = compose(s, layout);
    const kpis = result.placements.filter((p) => p.slot === 'kpis');
    // 8 cards → 2 rows of 4
    expect(new Set(kpis.map((p) => p.y)).size).toBe(2);
    const trend = result.placements.find((p) => p.slot === 'trend')!;
    expect(trend.y).toBeGreaterThanOrEqual(4); // never overlaps the kpi band
    const kpiBottom = Math.max(...kpis.map((p) => p.y + p.h));
    expect(trend.y).toBeGreaterThanOrEqual(kpiBottom);
  });
});

describe('compose — robustness', () => {
  it('skips widgets pointing at unknown slots with a diagnostic', () => {
    const layout = getLayout('ops-monitor@2')!;
    const s = spec([widget('x', 'nope', 'kpi_card'), widget('h', 'hero', 'line_chart')]);
    const result = compose(s, layout);
    expect(result.placements.map((p) => p.widgetId)).toEqual(['h']);
    expect(result.diagnostics.some((d) => d.slot === 'nope')).toBe(true);
  });

  it('is deterministic', () => {
    const layout = getLayout('deep-dive@1')!;
    const s = spec(
      [
        widget('h', 'hero', 'line_chart'),
        widget('b1', 'breakdowns', 'bar_chart'),
        widget('b2', 'breakdowns', 'donut_chart'),
        widget('d', 'detail', 'table'),
      ],
      'deep-dive@1',
    );
    expect(compose(s, layout)).toEqual(compose(s, layout));
  });

  it('never produces overlapping placements across all templates', () => {
    const layouts = ['ops-monitor@2', 'exec-summary@1', 'comparison@1', 'two-tier@1'];
    for (const ref of layouts) {
      const layout = getLayout(ref)!;
      const widgets = layout.slots.flatMap((slot) =>
        Array.from({ length: slot.maxWidgets }, (_, i) =>
          widget(`${slot.id}-${i}`, slot.id, slot.accepts[0] ?? 'kpi_card'),
        ),
      );
      const { placements } = compose(spec(widgets, ref), layout);
      for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
          const a = placements[i]!;
          const b = placements[j]!;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${ref}: ${a.widgetId} overlaps ${b.widgetId}`).toBe(false);
        }
      }
    }
  });
});
