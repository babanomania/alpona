import type { DataDictionary, DictionaryColumn, DictionaryTable } from '@alpona/core';
import { getLayout } from '@alpona/core';
import type {
  AgentBackend,
  BinderOutput,
  BinderRequest,
  CopyOutput,
  CopyRequest,
  PlannedWidget,
  PlannerOutput,
  RefineOutput,
  RefineRequest,
} from './stages.js';

/**
 * The deterministic mock backend: a tiny rule-based "agent" grounded in
 * the same data dictionary the real one reads. It powers the demo and CI
 * without an API key, and doubles as proof that the core/domain boundary
 * holds — nothing here knows what a "shipment" is.
 */

const isDate = (c: DictionaryColumn) => /date|timestamp/i.test(c.type);
const isNumeric = (c: DictionaryColumn) => /int|numeric|decimal|double|real|float/i.test(c.type);
const isCategory = (c: DictionaryColumn) =>
  /char|text|varchar/i.test(c.type) && (c.cardinality === undefined || c.cardinality <= 30);

interface TableProfile {
  table: DictionaryTable;
  date?: DictionaryColumn;
  measure?: DictionaryColumn;
  category?: DictionaryColumn;
  score: number;
}

function profile(table: DictionaryTable): TableProfile {
  const date = table.columns.find(isDate);
  const measure = table.columns.find((c) => isNumeric(c) && !/_id$|^id$/i.test(c.name));
  const category = table.columns.find(isCategory);
  let score = 0;
  if (table.kind === 'mart') score += 4; // marts first, raw tables second
  if (date) score += 2;
  if (measure) score += 2;
  if (category) score += 1;
  return { table, date, measure, category, score };
}

function pickTables(dictionary: DataDictionary, prompt: string): TableProfile[] {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3);
  return dictionary.tables
    .map((t) => {
      const p = profile(t);
      const haystack =
        `${t.name} ${t.description ?? ''} ${t.columns.map((c) => c.name).join(' ')}`.toLowerCase();
      p.score += words.filter((w) => haystack.includes(w)).length * 2;
      return p;
    })
    .sort((a, b) => b.score - a.score);
}

function titleCase(name: string): string {
  return name.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export class MockAgent implements AgentBackend {
  constructor(private readonly dictionary: DataDictionary) {}

  async plan(userPrompt: string): Promise<PlannerOutput> {
    const tables = pickTables(this.dictionary, userPrompt);
    const primary = tables[0];
    if (!primary) throw new Error('data dictionary has no tables — run alpona-db dictionary');

    const lower = userPrompt.toLowerCase();
    const layoutRef = /\b(vs|versus|compare|comparison)\b/.test(lower)
      ? 'comparison@1'
      : /\b(list|worklist|queue|which|table)\b/.test(lower)
        ? 'table-first@1'
        : 'ops-monitor@2';
    const layout = getLayout(layoutRef)!;

    const params: PlannerOutput['params'] = {};
    if (primary.date) params.from = isoDaysAgo(90);

    const widgets: PlannedWidget[] = [];
    for (const slot of layout.slots) {
      const source = primary;
      const make = (suffix: string, type: string, insight: string) =>
        widgets.push({ id: `${slot.id}-${suffix}`, slot: slot.id, type, insight });

      switch (slot.role) {
        case 'kpi-strip': {
          make('count', 'kpi_card', `Total rows in ${source.table.name}`);
          if (source.measure)
            make('avg', 'kpi_card', `Average ${source.measure.name} in ${source.table.name}`);
          const second = tables[1];
          if (second?.measure && second.table.name !== source.table.name)
            make('alt', 'kpi_card', `Average ${second.measure.name} in ${second.table.name}`);
          break;
        }
        case 'hero':
          if (source.date && source.measure) {
            make(
              'trend',
              slot.accepts.includes('line_chart')
                ? 'line_chart'
                : (slot.accepts[0] ?? 'line_chart'),
              `Weekly ${source.measure.name} from ${source.table.name}${source.category ? ` split by ${source.category.name}` : ''}`,
            );
          } else if (source.category && source.measure) {
            make(
              'breakdown',
              'bar_chart',
              `${source.measure.name} by ${source.category.name} from ${source.table.name}`,
            );
          }
          break;
        case 'side':
          if (source.category)
            make(
              'mix',
              slot.accepts.includes('donut_chart') ? 'donut_chart' : 'leaderboard',
              `Distribution of ${source.category.name} in ${source.table.name}`,
            );
          break;
        case 'table':
          make('rows', 'table', `Recent rows from ${source.table.name}`);
          break;
        case 'secondary':
          if (source.category && source.measure)
            make(
              'by-cat',
              'bar_chart',
              `${source.measure.name} by ${source.category.name} from ${source.table.name}`,
            );
          break;
        case 'footer':
          break;
      }
    }

    return {
      title: titleCase(primary.table.name.replace(/_/g, ' ')) + ' overview',
      layout: layoutRef,
      params,
      widgets: widgets.filter((w, i) => widgets.findIndex((o) => o.id === w.id) === i),
    };
  }

  async bind(request: BinderRequest): Promise<BinderOutput> {
    const { widget } = request;
    // Self-heal fallback: something trivially correct on any dictionary.
    if (request.feedback) return this.fallbackBinding(widget);

    const tables = pickTables(this.dictionary, widget.insight);
    const source = tables[0]!;
    const t = source.table.name;
    const dateFilter =
      source.date && 'from' in request.plan.params
        ? ` WHERE ${source.date.name} >= CAST({{params.from}} AS DATE)`
        : '';

    switch (widget.type) {
      case 'kpi_card': {
        const measure =
          /average|avg/i.test(widget.insight) && source.measure
            ? `ROUND(AVG(${source.measure.name}), 1)`
            : 'COUNT(*)';
        return {
          sql: `SELECT ${measure} AS value FROM ${t}${dateFilter}`,
          resultShape: { value: 'value' },
          title:
            /average|avg/i.test(widget.insight) && source.measure
              ? `Avg ${titleCase(source.measure.name)}`
              : `${titleCase(t)} count`,
        };
      }
      case 'line_chart':
      case 'area_chart': {
        const measure = source.measure!;
        const series = source.category ? `, ${source.category.name} AS series` : '';
        const seriesGroup = source.category ? ', 2' : '';
        return {
          sql: `SELECT date_trunc('week', ${source.date!.name}) AS wk${series}, ROUND(AVG(${measure.name}), 2) AS avg_value FROM ${t}${dateFilter} GROUP BY 1${seriesGroup} ORDER BY 1`,
          resultShape: source.category
            ? { x: 'wk', y: 'avg_value', series: 'series' }
            : { x: 'wk', y: 'avg_value' },
          title: `${titleCase(measure.name)} trend`,
        };
      }
      case 'bar_chart': {
        const measure = source.measure!;
        return {
          sql: `SELECT ${source.category!.name} AS cat, ROUND(AVG(${measure.name}), 2) AS avg_value FROM ${t}${dateFilter} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
          resultShape: { x: 'cat', y: 'avg_value' },
          title: `${titleCase(measure.name)} by ${source.category!.name.replaceAll('_', ' ')}`,
        };
      }
      case 'donut_chart':
      case 'leaderboard': {
        return {
          sql: `SELECT ${source.category!.name} AS label, COUNT(*) AS n FROM ${t}${dateFilter} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
          resultShape: { label: 'label', value: 'n' },
          title: `${titleCase(source.category!.name)} mix`,
        };
      }
      case 'gauge': {
        return {
          sql: `SELECT ROUND(AVG(${source.measure!.name}), 1) AS value FROM ${t}${dateFilter}`,
          resultShape: { value: 'value' },
          props: { max: 100 },
          title: `Avg ${titleCase(source.measure!.name)}`,
        };
      }
      case 'heatmap': {
        return {
          sql: `SELECT ${source.category!.name} AS x, date_trunc('month', ${source.date!.name}) AS y, COUNT(*) AS n FROM ${t}${dateFilter} GROUP BY 1, 2 ORDER BY 2 LIMIT 200`,
          resultShape: { x: 'x', y: 'y', value: 'n' },
          title: `${titleCase(source.category!.name)} by month`,
        };
      }
      case 'table':
      default: {
        const cols = source.table.columns.slice(0, 6).map((c) => c.name);
        const order = source.date ? ` ORDER BY ${source.date.name} DESC` : '';
        return {
          sql: `SELECT ${cols.join(', ')} FROM ${t}${dateFilter}${order} LIMIT 25`,
          resultShape: { columns: cols },
          title: `Recent ${t.replaceAll('_', ' ')}`,
        };
      }
    }
  }

  /** Trivially correct, contract-satisfying query for any widget type. */
  private fallbackBinding(widget: PlannedWidget): BinderOutput {
    const table = this.dictionary.tables[0]!;
    const t = table.name;
    const date = table.columns.find(isDate);
    const category = table.columns.find(isCategory);
    const numeric = table.columns.find(isNumeric);
    const title = titleCase(t.replaceAll('_', ' '));
    const firstCol = table.columns[0]!.name;

    switch (widget.type) {
      case 'line_chart':
      case 'area_chart': {
        const x = date?.name ?? firstCol;
        return {
          sql: `SELECT ${x} AS x, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 1`,
          resultShape: { x: 'x', y: 'n' },
          title,
        };
      }
      case 'bar_chart': {
        const x = category?.name ?? firstCol;
        return {
          sql: `SELECT ${x} AS x, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
          resultShape: { x: 'x', y: 'n' },
          title,
        };
      }
      case 'donut_chart':
      case 'leaderboard': {
        const label = category?.name ?? firstCol;
        return {
          sql: `SELECT ${label} AS label, COUNT(*) AS n FROM ${t} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
          resultShape: { label: 'label', value: 'n' },
          title,
        };
      }
      case 'scatter_chart': {
        const x = numeric?.name ?? firstCol;
        return {
          sql: `SELECT ${x} AS x, COUNT(*) AS n FROM ${t} GROUP BY 1 LIMIT 100`,
          resultShape: { x: 'x', y: 'n' },
          title,
        };
      }
      case 'heatmap': {
        const x = category?.name ?? firstCol;
        const y = date?.name ?? firstCol;
        return {
          sql: `SELECT ${x} AS x, ${y} AS y, COUNT(*) AS n FROM ${t} GROUP BY 1, 2 LIMIT 200`,
          resultShape: { x: 'x', y: 'y', value: 'n' },
          title,
        };
      }
      case 'table': {
        const cols = table.columns.slice(0, 5).map((c) => c.name);
        return {
          sql: `SELECT ${cols.join(', ')} FROM ${t} LIMIT 25`,
          resultShape: { columns: cols },
          title,
        };
      }
      default:
        return {
          sql: `SELECT COUNT(*) AS value FROM ${t}`,
          resultShape: { value: 'value' },
          title: `${title} count`,
        };
    }
  }

  async copy(request: CopyRequest): Promise<CopyOutput> {
    const rows = request.sampleRows.length;
    return {
      title: request.currentTitle ?? titleCase(request.widgetId.replaceAll('-', ' ')),
      caption: `${request.insight.replace(/\.$/, '')} — ${rows} point${rows === 1 ? '' : 's'} shown.`,
    };
  }

  async refine(request: RefineRequest): Promise<RefineOutput> {
    const { spec, prompt, targetWidgetId } = request;
    const lower = prompt.toLowerCase();
    const index = targetWidgetId
      ? spec.widgets.findIndex((w) => w.id === targetWidgetId)
      : spec.widgets.length - 1;
    if (index === -1) throw new Error(`widget "${targetWidgetId}" not found`);
    const widget = spec.widgets[index]!;

    const topN = /top\s+(\d+)/.exec(lower);
    if (topN) {
      const sql = widget.binding.sql.replace(/\s+LIMIT\s+\d+\s*$/i, '') + ` LIMIT ${topN[1]}`;
      return { operations: [{ op: 'replace', path: `/widgets/${index}/binding/sql`, value: sql }] };
    }

    const grain = /\b(daily|weekly|monthly)\b/.exec(lower);
    if (grain) {
      const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[grain[1]!]!;
      const sql = widget.binding.sql.replace(/date_trunc\('\w+'/g, `date_trunc('${unit}'`);
      return { operations: [{ op: 'replace', path: `/widgets/${index}/binding/sql`, value: sql }] };
    }

    if (/\b(remove|delete|drop)\b/.test(lower)) {
      return { operations: [{ op: 'remove', path: `/widgets/${index}` }] };
    }

    // Default demo behavior: retitle the widget with the instruction.
    return {
      operations: [
        {
          op: 'replace',
          path: `/widgets/${index}/copy/title`,
          value: prompt.slice(0, 80),
        },
      ],
    };
  }
}

function isoDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}
