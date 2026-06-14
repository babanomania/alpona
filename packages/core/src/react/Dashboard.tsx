import { useMemo } from 'react';
import type { DashboardSpec, ParamValue } from '../types.js';
import type { QueryClient } from '../engine/query-client.js';
import { interpret } from '../engine/interpreter.js';
import { WidgetShell } from './WidgetShell.js';
import { useFlip } from './useFlip.js';

export interface DashboardProps {
  spec: DashboardSpec;
  client: QueryClient;
  /** Current param values (defaults come from spec.params). */
  params?: Record<string, ParamValue>;
  /** widget id → insight description for widgets the binder hasn't finished. */
  pendingInsights?: Record<string, string>;
  /** Widget ids whose SQL went through the self-heal loop. */
  healedIds?: ReadonlySet<string>;
  selectedWidgetId?: string | null;
  onSelectWidget?: (widgetId: string) => void;
  /** Remove a widget from the dashboard (a × on the selected widget). */
  onRemoveWidget?: (widgetId: string) => void;
}

/**
 * The rendering engine's React entry point. Interprets the spec through
 * the agent output gate, lays it out via the composer, and renders each
 * widget data-bound through the query client. Invalid specs render a
 * diagnostic panel — the engine fails safely, never blankly.
 */
export function Dashboard({
  spec,
  client,
  params,
  pendingInsights = {},
  healedIds,
  selectedWidgetId,
  onSelectWidget,
  onRemoveWidget,
}: DashboardProps) {
  const result = useMemo(() => interpret(spec), [spec]);
  const flipRef = useFlip(result.ok ? result.dashboard.composition : null);

  const resolvedParams = useMemo(() => ({ ...spec.params, ...params }), [spec.params, params]);

  if (!result.ok) {
    return (
      <div className="alpona-state alpona-state--error" role="alert">
        <span>This dashboard spec failed validation</span>
        {result.issues.slice(0, 5).map((issue, i) => (
          <span key={i} className="alpona-state__hint">
            {issue.path}: {issue.message}
          </span>
        ))}
      </div>
    );
  }

  const { dashboard } = result;
  const widgetById = new Map(dashboard.spec.widgets.map((w) => [w.id, w]));

  return (
    <div
      className="alpona-dashboard"
      style={{ gridTemplateRows: `repeat(${dashboard.composition.rows}, var(--alpona-row))` }}
    >
      {dashboard.composition.placements.map((placement) => {
        const widget = widgetById.get(placement.widgetId);
        if (!widget) return null;
        return (
          <WidgetShell
            key={widget.id}
            widget={widget}
            client={client}
            params={resolvedParams}
            pendingInsight={pendingInsights[widget.id]}
            healed={healedIds?.has(widget.id)}
            selectable={Boolean(onSelectWidget)}
            selected={selectedWidgetId === widget.id}
            onSelect={onSelectWidget}
            onRemove={onRemoveWidget}
            flipRef={flipRef(widget.id)}
            style={{
              gridColumn: `${placement.x + 1} / span ${placement.w}`,
              gridRow: `${placement.y + 1} / span ${placement.h}`,
            }}
          />
        );
      })}
    </div>
  );
}
