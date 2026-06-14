import type { CSSProperties, ReactNode } from 'react';
import type { ParamValue, WidgetSpec } from '../types.js';
import type { QueryClient } from '../engine/query-client.js';
import { useQueryState } from './useQueryState.js';
import { widgetComponents } from './widgets/index.js';

interface WidgetShellProps {
  widget: WidgetSpec;
  client: QueryClient;
  params: Record<string, ParamValue>;
  /** Insight description while the binder is still working on this widget. */
  pendingInsight?: string;
  healed?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (widgetId: string) => void;
  /** Remove this widget from the dashboard (a × shown when selected). */
  onRemove?: (widgetId: string) => void;
  style?: CSSProperties;
  flipRef?: (el: HTMLDivElement | null) => void;
}

function Body({ widget, client, params, pendingInsight }: WidgetShellProps): ReactNode {
  const pending = pendingInsight !== undefined;
  const state = useQueryState(client, pending ? null : widget.binding.sql, params);

  if (pending) {
    return (
      <>
        <div className="alpona-skeleton" />
        <div className="alpona-pending">{pendingInsight}</div>
      </>
    );
  }

  switch (state.status) {
    case 'idle':
    case 'loading':
      return <div className="alpona-skeleton" />;
    case 'error':
      return (
        <div className="alpona-state alpona-state--error" role="alert">
          <span>Query failed</span>
          <span className="alpona-state__hint">{state.error}</span>
        </div>
      );
    case 'success': {
      if (state.result.rows.length === 0) {
        return (
          <div className="alpona-state">
            <span>No data</span>
            <span className="alpona-state__hint">
              The query returned no rows for these filters.
            </span>
          </div>
        );
      }
      const Component = widgetComponents[widget.type];
      if (!Component) {
        return (
          <div className="alpona-state alpona-state--error">
            <span>Unknown widget type “{widget.type}”</span>
          </div>
        );
      }
      return <Component widget={widget} rows={state.result.rows} columns={state.result.columns} />;
    }
  }
}

export function WidgetShell(props: WidgetShellProps) {
  const { widget, healed, selectable, selected, onSelect, onRemove, style, flipRef } = props;
  const title = widget.copy.title;
  const caption = widget.copy.caption;

  return (
    <div
      ref={flipRef}
      className="alpona-widget alpona-widget--flip"
      style={style}
      data-widget-id={widget.id}
      data-widget-type={widget.type}
      data-selectable={selectable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClick={selectable ? () => onSelect?.(widget.id) : undefined}
    >
      {selected && onRemove && (
        <button
          type="button"
          className="alpona-widget__remove"
          aria-label="Remove widget"
          title="Remove from dashboard"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(widget.id);
          }}
        >
          ✕
        </button>
      )}
      {(title || caption) && (
        <div className="alpona-widget__header">
          {title && <div className="alpona-widget__title">{title}</div>}
          {caption && <div className="alpona-widget__caption">{caption}</div>}
        </div>
      )}
      {healed && (
        <span className="alpona-widget__healed" title="This query was automatically repaired">
          ↺
        </span>
      )}
      <div className="alpona-widget__body">
        <Body {...props} />
      </div>
    </div>
  );
}
