import { useMemo, useState } from 'react';
import type { ChartProps } from './charts.js';
import { isNumericColumn } from '../data.js';
import { toNumber } from '../format.js';

function renderCell(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

export function TableWidget({ widget, rows, columns }: ChartProps) {
  const props = (widget.props ?? {}) as { pageSize?: number; highlightColumn?: string };
  const shape = widget.binding.resultShape;
  const visible = shape.columns?.filter((c) => columns.includes(c)) ?? columns;
  const [sort, setSort] = useState<{ column: string; dir: 1 | -1 } | null>(null);

  const numeric = useMemo(
    () => new Set(visible.filter((c) => isNumericColumn(rows, c))),
    [visible, rows],
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { column, dir } = sort;
    const isNum = numeric.has(column);
    return [...rows].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = isNum ? toNumber(av) - toNumber(bv) : String(av).localeCompare(String(bv));
      return cmp * dir;
    });
  }, [rows, sort, numeric]);

  const pageSize = props.pageSize ?? 50;
  const shown = sorted.slice(0, pageSize);

  return (
    <div className="alpona-table-wrap">
      <table className="alpona-table">
        <thead>
          <tr>
            {visible.map((column) => (
              <th
                key={column}
                className={numeric.has(column) ? 'alpona-table__num' : undefined}
                onClick={() =>
                  setSort((prev) =>
                    prev?.column === column
                      ? { column, dir: prev.dir === 1 ? -1 : 1 }
                      : { column, dir: -1 },
                  )
                }
              >
                {column.replaceAll('_', ' ')}
                {sort?.column === column ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i}>
              {visible.map((column) => (
                <td
                  key={column}
                  className={numeric.has(column) ? 'alpona-table__num' : undefined}
                  style={props.highlightColumn === column ? { fontWeight: 600 } : undefined}
                >
                  {renderCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
