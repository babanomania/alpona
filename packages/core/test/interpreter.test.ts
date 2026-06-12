import { describe, expect, it } from 'vitest';
import { interpret } from '../src/engine/interpreter.js';
import type { DashboardSpec } from '../src/types.js';

function validSpec(): DashboardSpec {
  return {
    specVersion: 1,
    title: 'Warehouse Ops Monitor',
    layout: 'ops-monitor@2',
    params: { from: '2026-05-01' },
    widgets: [
      {
        id: 'delay-trend',
        slot: 'hero',
        type: 'line_chart',
        binding: {
          sql: "SELECT date_trunc('week', dispatched) AS wk, carrier, AVG(delay_days) AS avg_delay FROM shipment_performance WHERE dispatched >= {{params.from}} GROUP BY 1, 2 ORDER BY 1",
          resultShape: { x: 'wk', y: 'avg_delay', series: 'carrier' },
        },
        copy: { title: 'Carrier delay trend', caption: null },
      },
      {
        id: 'late-count',
        slot: 'kpis',
        type: 'kpi_card',
        binding: {
          sql: 'SELECT COUNT(*) AS late FROM shipment_performance WHERE is_late',
          resultShape: { value: 'late' },
        },
        copy: { title: null, caption: null },
      },
    ],
  };
}

describe('interpret', () => {
  it('accepts a valid spec and returns a renderable dashboard', () => {
    const result = interpret(validSpec());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dashboard.layout.name).toBe('ops-monitor');
    expect(result.dashboard.composition.placements).toHaveLength(2);
    expect(result.dashboard.params.map((p) => p.name)).toEqual(['from']);
    expect(result.dashboard.params[0]!.control).toBe('date');
  });

  it('rejects non-objects and schema violations', () => {
    expect(interpret(null).ok).toBe(false);
    expect(interpret({}).ok).toBe(false);

    const extra = { ...validSpec(), evil: true };
    const result = interpret(extra);
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.code).toBe('schema');
  });

  it('rejects unknown layouts', () => {
    const s = { ...validSpec(), layout: 'no-such-layout@9' };
    const result = interpret(s);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'unknown-layout')).toBe(true);
  });

  it('rejects unknown widget types and slots the layout does not define', () => {
    const s = validSpec();
    s.widgets[0]!.type = 'pie3d';
    const r1 = interpret(s);
    expect(r1.ok).toBe(false);
    expect(r1.issues.some((i) => i.code === 'unknown-widget-type')).toBe(true);

    const s2 = validSpec();
    s2.widgets[0]!.slot = 'sidebar';
    const r2 = interpret(s2);
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.code === 'unknown-slot')).toBe(true);
  });

  it('rejects a widget type the slot does not accept', () => {
    const s = validSpec();
    // hero accepts charts, not tables
    s.widgets[0]! = {
      ...s.widgets[0]!,
      type: 'table',
      binding: { sql: 'SELECT 1', resultShape: {} },
    };
    const result = interpret(s);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'slot-rejects-type')).toBe(true);
  });

  it('enforces resultShape contracts per widget type', () => {
    const s = validSpec();
    s.widgets[0]!.binding.resultShape = { y: 'avg_delay' }; // line_chart needs x
    const result = interpret(s);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'result-shape')).toBe(true);
  });

  it('rejects duplicate widget ids', () => {
    const s = validSpec();
    s.widgets[1]!.id = s.widgets[0]!.id;
    const result = interpret(s);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'duplicate-id')).toBe(true);
  });

  it('drops invalid props instead of failing the dashboard', () => {
    const s = validSpec();
    s.widgets[1]!.props = { format: 'hexadecimal' };
    const result = interpret(s);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.code === 'props')).toBe(true);
    expect(result.dashboard.spec.widgets[1]!.props).toBeUndefined();
  });
});
