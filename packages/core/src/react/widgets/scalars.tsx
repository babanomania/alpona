import type { ChartProps } from './charts.js';
import { formatValue, toNumber } from '../format.js';
import type { ValueFormat } from '../format.js';

export function KpiCardWidget({ widget, rows }: ChartProps) {
  const shape = widget.binding.resultShape;
  const props = (widget.props ?? {}) as {
    format?: ValueFormat;
    unit?: string;
    invertDelta?: boolean;
  };
  const row = rows[0] ?? {};
  const value = row[shape.value ?? ''];
  const delta = shape.delta ? toNumber(row[shape.delta]) : NaN;
  const hasDelta = !Number.isNaN(delta);
  const improving = props.invertDelta ? delta < 0 : delta > 0;

  return (
    <div className="alpona-kpi">
      <div className="alpona-kpi__value">{formatValue(value, props.format, props.unit)}</div>
      {hasDelta && (
        <div className={`alpona-kpi__delta alpona-kpi__delta--${improving ? 'up' : 'down'}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '–'} {formatValue(Math.abs(delta), 'percent')}
        </div>
      )}
    </div>
  );
}

export function GaugeWidget({ widget, rows }: ChartProps) {
  const shape = widget.binding.resultShape;
  const props = (widget.props ?? {}) as { min?: number; max?: number; unit?: string };
  const row = rows[0] ?? {};
  const value = toNumber(row[shape.value ?? '']);
  const target = shape.target ? toNumber(row[shape.target]) : NaN;
  const min = props.min ?? 0;
  const max =
    props.max ?? Math.max(100, Number.isNaN(value) ? 0 : value, Number.isNaN(target) ? 0 : target);
  const frac = Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));

  // Semicircular arc: radius 40, centered at (50, 50) in a 100×55 viewBox.
  const angle = Math.PI * (1 - frac);
  const endX = 50 + 40 * Math.cos(angle);
  const endY = 50 - 40 * Math.sin(angle);
  const targetFrac = Number.isNaN(target)
    ? null
    : Math.min(1, Math.max(0, (target - min) / (max - min)));

  return (
    <div className="alpona-gauge">
      <svg
        viewBox="0 0 100 55"
        style={{ width: '70%', maxHeight: '60%' }}
        role="img"
        aria-label="gauge"
      >
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke="var(--muted)"
          strokeWidth={8}
          strokeLinecap="round"
        />
        {frac > 0.005 && (
          <path
            d={`M 10 50 A 40 40 0 0 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={8}
            strokeLinecap="round"
          />
        )}
        {targetFrac !== null && (
          <line
            x1={50 + 33 * Math.cos(Math.PI * (1 - targetFrac))}
            y1={50 - 33 * Math.sin(Math.PI * (1 - targetFrac))}
            x2={50 + 47 * Math.cos(Math.PI * (1 - targetFrac))}
            y2={50 - 47 * Math.sin(Math.PI * (1 - targetFrac))}
            stroke="var(--foreground)"
            strokeWidth={1.5}
          />
        )}
      </svg>
      <div className="alpona-gauge__value">{formatValue(value, undefined, props.unit)}</div>
      {targetFrac !== null && (
        <div className="alpona-gauge__target">
          target {formatValue(target, undefined, props.unit)}
        </div>
      )}
    </div>
  );
}

export function LeaderboardWidget({ widget, rows }: ChartProps) {
  const shape = widget.binding.resultShape;
  const props = (widget.props ?? {}) as { format?: ValueFormat; invertColor?: boolean };
  const entries = rows.slice(0, 10).map((row) => ({
    label: String(row[shape.label ?? ''] ?? '∅'),
    value: toNumber(row[shape.value ?? '']),
    delta: shape.delta ? toNumber(row[shape.delta]) : NaN,
  }));
  const peak = Math.max(...entries.map((e) => Math.abs(e.value)), 1e-9);

  return (
    <div className="alpona-leaderboard">
      {entries.map((entry, i) => (
        <div key={i} className="alpona-leaderboard__row">
          <span className="alpona-leaderboard__label" title={entry.label}>
            {entry.label}
          </span>
          <span>
            <span
              className={`alpona-leaderboard__bar${props.invertColor ? ' alpona-leaderboard__bar--bad' : ''}`}
              style={{ width: `${(Math.abs(entry.value) / peak) * 100}%`, display: 'block' }}
            />
          </span>
          <span className="alpona-leaderboard__value">
            {formatValue(entry.value, props.format)}
          </span>
        </div>
      ))}
    </div>
  );
}
