import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { WidgetSpec, Row } from '../../types.js';
import { chartColor, pivotSeries } from '../data.js';
import { formatAxisValue, formatValue, toNumber } from '../format.js';
import type { ValueFormat } from '../format.js';

export interface ChartProps {
  widget: WidgetSpec;
  rows: Row[];
  columns: string[];
}

interface TooltipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
}

function ChartTooltip(props: {
  active?: boolean;
  label?: unknown;
  payload?: TooltipEntry[];
  format?: ValueFormat;
}) {
  if (!props.active || !props.payload?.length) return null;
  return (
    <div className="alpona-tooltip">
      {props.label !== undefined && (
        <div className="alpona-tooltip__label">{formatAxisValue(props.label)}</div>
      )}
      {props.payload.map((entry, i) => (
        <div key={i} className="alpona-tooltip__row">
          <span className="alpona-tooltip__swatch" style={{ background: entry.color }} />
          <span>{entry.name}:</span>
          <strong>{formatValue(entry.value, props.format)}</strong>
        </div>
      ))}
    </div>
  );
}

function axisProps(widget: WidgetSpec) {
  const props = (widget.props ?? {}) as { yFormat?: ValueFormat; yLabel?: string };
  return props;
}

const X_AXIS = {
  tickFormatter: formatAxisValue,
  tickLine: false,
  axisLine: false,
  tickMargin: 6,
} as const;

const Y_AXIS = {
  tickLine: false,
  axisLine: false,
  width: 44,
  tickMargin: 4,
} as const;

const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

export function LineChartWidget({ widget, rows }: ChartProps) {
  const { data, seriesKeys } = pivotSeries(rows, widget.binding.resultShape);
  const { yFormat } = axisProps(widget);
  const smooth = (widget.props as { smooth?: boolean } | undefined)?.smooth ?? true;
  return (
    <div className="alpona-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={40} minHeight={40}>
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="__x" {...X_AXIS} />
          <YAxis {...Y_AXIS} tickFormatter={(v: unknown) => formatValue(v, yFormat)} />
          <Tooltip content={<ChartTooltip format={yFormat} />} />
          {seriesKeys.length > 1 && <Legend iconType="plainline" iconSize={12} />}
          {seriesKeys.map((key, i) => (
            <Line
              key={key}
              type={smooth ? 'monotone' : 'linear'}
              dataKey={key}
              stroke={chartColor(i)}
              strokeWidth={2}
              dot={false}
              isAnimationActive={true}
              animationDuration={500}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaChartWidget({ widget, rows }: ChartProps) {
  const { data, seriesKeys } = pivotSeries(rows, widget.binding.resultShape);
  const { yFormat } = axisProps(widget);
  const stacked = (widget.props as { stacked?: boolean } | undefined)?.stacked ?? true;
  return (
    <div className="alpona-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={40} minHeight={40}>
        <AreaChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="__x" {...X_AXIS} />
          <YAxis {...Y_AXIS} tickFormatter={(v: unknown) => formatValue(v, yFormat)} />
          <Tooltip content={<ChartTooltip format={yFormat} />} />
          {seriesKeys.length > 1 && <Legend iconType="circle" iconSize={8} />}
          {seriesKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stackId={stacked ? 'stack' : undefined}
              stroke={chartColor(i)}
              fill={chartColor(i)}
              fillOpacity={0.25}
              strokeWidth={1.5}
              animationDuration={500}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChartWidget({ widget, rows }: ChartProps) {
  const { data, seriesKeys } = pivotSeries(rows, widget.binding.resultShape);
  const props = (widget.props ?? {}) as {
    stacked?: boolean;
    horizontal?: boolean;
    yFormat?: ValueFormat;
  };
  const layout = props.horizontal ? 'vertical' : 'horizontal';
  return (
    <div className="alpona-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={40} minHeight={40}>
        <BarChart data={data} layout={layout} margin={MARGIN}>
          <CartesianGrid
            vertical={Boolean(props.horizontal)}
            horizontal={!props.horizontal}
            strokeDasharray="3 3"
          />
          {props.horizontal ? (
            <>
              <XAxis
                type="number"
                {...X_AXIS}
                tickFormatter={(v: unknown) => formatValue(v, props.yFormat)}
              />
              <YAxis
                type="category"
                dataKey="__x"
                {...Y_AXIS}
                width={88}
                tickFormatter={formatAxisValue}
              />
            </>
          ) : (
            <>
              <XAxis dataKey="__x" {...X_AXIS} />
              <YAxis {...Y_AXIS} tickFormatter={(v: unknown) => formatValue(v, props.yFormat)} />
            </>
          )}
          <Tooltip
            content={<ChartTooltip format={props.yFormat} />}
            cursor={{ fillOpacity: 0.06 }}
          />
          {seriesKeys.length > 1 && <Legend iconType="circle" iconSize={8} />}
          {seriesKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              stackId={props.stacked ? 'stack' : undefined}
              fill={chartColor(i)}
              radius={props.stacked ? 0 : [3, 3, 0, 0]}
              animationDuration={500}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChartWidget({ widget, rows }: ChartProps) {
  const shape = widget.binding.resultShape;
  const format = (widget.props as { format?: ValueFormat } | undefined)?.format;
  const data = rows.map((row) => ({
    name: String(row[shape.label ?? ''] ?? '∅'),
    value: toNumber(row[shape.value ?? '']),
  }));
  return (
    <div className="alpona-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={40} minHeight={40}>
        <PieChart>
          <Tooltip content={<ChartTooltip format={format} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            layout="vertical"
            align="right"
            verticalAlign="middle"
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="85%"
            paddingAngle={2}
            strokeWidth={0}
            animationDuration={500}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={chartColor(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScatterChartWidget({ widget, rows }: ChartProps) {
  const shape = widget.binding.resultShape;
  const { yFormat } = axisProps(widget);
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = shape.series ? String(row[shape.series] ?? '∅') : 'all';
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return (
    <div className="alpona-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={40} minHeight={40}>
        <ScatterChart margin={MARGIN}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" dataKey="__sx" name={shape.x} {...X_AXIS} />
          <YAxis
            type="number"
            dataKey="__sy"
            name={shape.y}
            {...Y_AXIS}
            tickFormatter={(v: unknown) => formatValue(v, yFormat)}
          />
          {shape.size && <ZAxis dataKey="__sz" range={[40, 320]} />}
          <Tooltip content={<ChartTooltip format={yFormat} />} />
          {groups.size > 1 && <Legend iconType="circle" iconSize={8} />}
          {[...groups.entries()].map(([name, groupRows], i) => (
            <Scatter
              key={name}
              name={name}
              fill={chartColor(i)}
              fillOpacity={0.75}
              data={groupRows.map((row) => ({
                __sx: toNumber(row[shape.x ?? '']),
                __sy: toNumber(row[shape.y ?? '']),
                __sz: shape.size ? toNumber(row[shape.size]) : undefined,
                __label: shape.label ? row[shape.label] : undefined,
              }))}
              animationDuration={500}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
