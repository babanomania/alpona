import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  Copy,
  ExternalLink,
  LayoutDashboard,
  LayoutGrid,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';

interface DashboardSummary {
  id: string;
  name: string;
  prompt?: string;
  createdAt: string;
  title: string;
  widgetCount: number;
}

export function Explore({ onToast }: { onToast: (message: string) => void }) {
  const [rows, setRows] = useState<DashboardSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = () => {
    void fetch('/api/dashboards')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { dashboards?: DashboardSummary[] } | null) => {
        if (body?.dashboards) setRows(body.dashboards);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  };
  useEffect(refresh, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (r.prompt ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const copyLink = (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#/d/${id}`;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => onToast('Share link copied'))
      .catch(() => onToast(url));
  };

  const remove = (row: DashboardSummary) => {
    if (!window.confirm(`Delete “${row.name}”? The share link will stop working.`)) return;
    void fetch(`/api/dashboards/${row.id}`, { method: 'DELETE' })
      .then((r) => {
        if (r.ok) {
          onToast(`Deleted “${row.name}”`);
          refresh();
        } else onToast('Delete failed');
      })
      .catch(() => onToast('Delete failed'));
  };

  return (
    <div className="explore">
      <header className="explore__head">
        <div>
          <h1>
            <LayoutGrid size={22} /> Saved dashboards
          </h1>
          <p>Every saved board is a portable spec with a stable share URL.</p>
        </div>
        <button className="btn btn--primary" onClick={() => (window.location.hash = '#/create')}>
          <Wand2 size={15} /> New dashboard
        </button>
      </header>

      <div className="explore__toolbar">
        <div className="explore__search">
          <Search size={15} />
          <input
            value={query}
            placeholder="Filter by name or prompt…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="explore__count">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th>
                <LayoutDashboard size={13} /> Name
              </th>
              <th>
                <Sparkles size={13} /> Prompt
              </th>
              <th className="table__num">Widgets</th>
              <th>
                <Calendar size={13} /> Created
              </th>
              <th className="table__actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} onClick={() => (window.location.hash = `#/d/${row.id}`)}>
                <td>
                  <div className="table__name">
                    <span>{row.name}</span>
                    {row.id.startsWith('seed-') && <span className="chip">curated</span>}
                  </div>
                  <span className="table__sub">{row.title}</span>
                </td>
                <td className="table__prompt">{row.prompt ?? '—'}</td>
                <td className="table__num">{row.widgetCount}</td>
                <td className="table__date">
                  {new Date(row.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </td>
                <td className="table__actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    title="Open"
                    onClick={() => (window.location.hash = `#/d/${row.id}`)}
                  >
                    <ExternalLink size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Copy share link"
                    onClick={() => copyLink(row.id)}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-btn icon-btn--danger"
                    title="Delete"
                    onClick={() => remove(row)}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {loaded && filtered.length === 0 && (
              <tr className="table__empty">
                <td colSpan={5}>
                  {rows.length === 0 ? (
                    <>
                      No saved dashboards yet —{' '}
                      <a href="#/create">
                        draw your first one <ArrowRight size={13} />
                      </a>
                    </>
                  ) : (
                    'Nothing matches that filter.'
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
