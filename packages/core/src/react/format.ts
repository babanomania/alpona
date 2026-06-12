export type ValueFormat = 'number' | 'percent' | 'currency' | 'duration';

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isNaN(n) ? NaN : n;
  }
  if (value instanceof Date) return value.getTime();
  return NaN;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const standard = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const currencyCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const currencyStandard = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatValue(value: unknown, format?: ValueFormat, unit?: string): string {
  const n = toNumber(value);
  if (Number.isNaN(n)) return value == null ? '—' : String(value);

  let text: string;
  switch (format) {
    case 'percent':
      text = `${standard.format(n)}%`;
      break;
    case 'currency':
      text = Math.abs(n) >= 10_000 ? currencyCompact.format(n) : currencyStandard.format(n);
      break;
    case 'duration':
      text = `${standard.format(n)} d`;
      break;
    default:
      text = Math.abs(n) >= 10_000 ? compact.format(n) : standard.format(n);
  }
  return unit ? `${text} ${unit}` : text;
}

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}/;

/** Compact axis labels: ISO dates → "May 4", month-start dates → "May ’26". */
export function formatAxisValue(value: unknown): string {
  if (value instanceof Date) return monthDay.format(value);
  if (typeof value === 'string' && ISO_LIKE.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return value.slice(8, 10) === '01' && value.length === 10
        ? monthYear.format(date)
        : monthDay.format(date);
    }
  }
  if (typeof value === 'number') return compact.format(value);
  return String(value ?? '');
}
