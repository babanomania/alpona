import { useEffect, useMemo, useState } from 'react';
import type { DataDictionary, DictionaryTable } from '@alpona/core';
import { Boxes, Clock, Database, Layers, MessageSquare, Search, Table2 } from 'lucide-react';
import { authFetch } from '../auth.js';

/**
 * The data catalog (PLAN.md §5.16): a pure renderer over the dictionary
 * JSON. One card per table — semantic description, column chips,
 * freshness from the build timestamp, and "Ask about this" prompts that
 * pre-fill the composer. Marts are featured above raw tables.
 */

function freshness(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'unknown';
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function samplePrompts(table: DictionaryTable): string[] {
  const subject = table.name.replaceAll('_', ' ');
  const measure = table.columns.find(
    (c) => /int|numeric|decimal|double|real|float/i.test(c.type) && !/_id$|^id$/i.test(c.name),
  );
  const dim = table.columns.find((c) => c.cardinality !== undefined && c.cardinality <= 25);
  const prompts: string[] = [];
  if (measure && dim)
    prompts.push(`${measure.name.replaceAll('_', ' ')} by ${dim.name.replaceAll('_', ' ')}`);
  if (measure) prompts.push(`What's the total ${measure.name.replaceAll('_', ' ')}?`);
  prompts.push(`Show me recent ${subject}`);
  return prompts.slice(0, 3);
}

function TableCard({ table, onAsk }: { table: DictionaryTable; onAsk: (prompt: string) => void }) {
  return (
    <article className="cat-card">
      <header className="cat-card__head">
        <span className={`cat-card__kind cat-card__kind--${table.kind}`}>
          {table.kind === 'mart' ? <Layers size={12} /> : <Table2 size={12} />}
          {table.kind}
        </span>
        {table.rowCount !== undefined && (
          <span className="cat-card__rows">{table.rowCount.toLocaleString()} rows</span>
        )}
      </header>
      <h3 className="cat-card__name">{table.name}</h3>
      <p className="cat-card__desc">{table.description ?? 'No description provided.'}</p>
      <div className="cat-card__cols">
        {table.columns.slice(0, 10).map((c) => (
          <span
            key={c.name}
            className="col-chip"
            title={`${c.type}${c.description ? ` — ${c.description}` : ''}`}
          >
            {c.name}
          </span>
        ))}
        {table.columns.length > 10 && (
          <span className="col-chip col-chip--more">+{table.columns.length - 10}</span>
        )}
      </div>
      <div className="cat-card__asks">
        {samplePrompts(table).map((p) => (
          <button key={p} className="ask-chip" onClick={() => onAsk(p)}>
            <MessageSquare size={11} /> {p}
          </button>
        ))}
      </div>
    </article>
  );
}

export function Catalog() {
  const [catalog, setCatalog] = useState<DataDictionary | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void authFetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: DataDictionary | null) => body && setCatalog(body))
      .catch(() => {});
  }, []);

  const ask = (prompt: string) => {
    sessionStorage.setItem('alpona-prefill', prompt);
    window.location.hash = '#/create';
  };

  const { marts, tables } = useMemo(() => {
    const all = catalog?.tables ?? [];
    const q = query.trim().toLowerCase();
    const match = (t: DictionaryTable) =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      t.columns.some((c) => c.name.toLowerCase().includes(q));
    const filtered = all.filter(match);
    return {
      marts: filtered.filter((t) => t.kind === 'mart'),
      tables: filtered.filter((t) => t.kind === 'table'),
    };
  }, [catalog, query]);

  return (
    <div className="catalog">
      <header className="catalog__head">
        <div>
          <h1>
            <Boxes size={22} /> Data catalog
          </h1>
          <p>
            <Database size={13} /> {catalog?.dialect ?? '—'} · <Clock size={13} /> built{' '}
            {catalog ? freshness(catalog.generatedAt) : '…'} · the only thing the agent ever sees
          </p>
        </div>
        <div className="explore__search">
          <Search size={15} />
          <input
            value={query}
            placeholder="Filter tables or columns…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      {marts.length > 0 && (
        <>
          <h2 className="catalog__section">Analytical views</h2>
          <div className="cat-grid">
            {marts.map((t) => (
              <TableCard key={t.name} table={t} onAsk={ask} />
            ))}
          </div>
        </>
      )}
      {tables.length > 0 && (
        <>
          <h2 className="catalog__section">Raw tables</h2>
          <div className="cat-grid">
            {tables.map((t) => (
              <TableCard key={t.name} table={t} onAsk={ask} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
