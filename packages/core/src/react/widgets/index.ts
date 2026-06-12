import type { ComponentType } from 'react';
import type { ChartProps } from './charts.js';
import {
  AreaChartWidget,
  BarChartWidget,
  DonutChartWidget,
  LineChartWidget,
  ScatterChartWidget,
} from './charts.js';
import { GaugeWidget, KpiCardWidget, LeaderboardWidget } from './scalars.js';
import { TableWidget } from './TableWidget.js';
import { HeatmapWidget } from './HeatmapWidget.js';

export type { ChartProps as WidgetRenderProps } from './charts.js';

/**
 * Runtime component registry — pairs the metadata in registry/definitions.ts
 * with render components. Kept on the React side so server code can import
 * widget contracts without dragging React along.
 */
export const widgetComponents: Record<string, ComponentType<ChartProps>> = {
  kpi_card: KpiCardWidget,
  line_chart: LineChartWidget,
  bar_chart: BarChartWidget,
  area_chart: AreaChartWidget,
  donut_chart: DonutChartWidget,
  scatter_chart: ScatterChartWidget,
  heatmap: HeatmapWidget,
  table: TableWidget,
  gauge: GaugeWidget,
  leaderboard: LeaderboardWidget,
};
