import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardSpec, ParamValue } from '@alpona/core';
import { QueryClient, extractParams, interpret } from '@alpona/core';
import { Dashboard, FilterBar, createHttpQueryFetcher, useAlponaAgent } from '@alpona/core/react';
import {
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Download,
  FolderOpen,
  Loader2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';

interface SavedDashboard {
  id: string;
  name: string;
  prompt?: string;
  spec: DashboardSpec;
}

export function Workspace({
  dashboardId,
  onToast,
}: {
  /** From a #/d/:id share URL; null means a fresh create surface. */
  dashboardId: string | null;
  onToast: (message: string) => void;
}) {
  const client = useMemo(() => new QueryClient({ fetcher: createHttpQueryFetcher('/api') }), []);
  const agent = useAlponaAgent('/api');
  const { spec } = agent;

  const [input, setInput] = useState('');
  const [paramValues, setParamValues] = useState<Record<string, ParamValue>>({});
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  useEffect(() => {
    void fetch('/api/suggestions')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { suggestions?: string[] } | null) => {
        if (body?.suggestions?.length) setSuggestions(body.suggestions);
      })
      .catch(() => {});
  }, []);

  // Share URLs: the component remounts per dashboardId (keyed by the
  // router), so this runs once per board.
  useEffect(() => {
    if (!dashboardId) return;
    void fetch(`/api/dashboards/${dashboardId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((saved: SavedDashboard | null) => {
        if (!saved || !interpret(saved.spec).ok) {
          onToast('That shared dashboard no longer exists');
          window.location.hash = '#/explore';
          return;
        }
        agent.loadSpec(saved.spec);
        setSavedId(saved.id);
        setLastPrompt(saved.prompt ?? null);
      })
      .catch(() => onToast('Could not load the shared dashboard'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount
  }, [dashboardId]);

  const paramDescriptors = useMemo(() => (spec ? extractParams(spec) : []), [spec]);
  const selectedWidget = spec?.widgets.find((w) => w.id === selectedWidgetId);
  const busy = agent.phase === 'planning' || agent.phase === 'binding' || agent.phase === 'copy';

  const submit = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy) return;
      setInput('');
      if (spec && agent.phase === 'done') {
        agent.refine(prompt, spec, selectedWidget?.id);
      } else {
        setSelectedWidgetId(null);
        setParamValues({});
        setSavedId(null);
        setLastPrompt(prompt);
        agent.generate(prompt);
      }
    },
    [agent, spec, selectedWidget?.id, busy],
  );

  const saveDashboard = useCallback(() => {
    if (!spec) return;
    const name = saveName.trim() || spec.title;
    void fetch('/api/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, spec, prompt: lastPrompt ?? undefined }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((saved: SavedDashboard) => {
        setSaveOpen(false);
        setSavedId(saved.id);
        const url = `${window.location.origin}${window.location.pathname}#/d/${saved.id}`;
        window.history.replaceState(null, '', `#/d/${saved.id}`);
        void navigator.clipboard
          ?.writeText(url)
          .then(() => onToast('Saved — share link copied to clipboard'))
          .catch(() => onToast(`Saved — share at #/d/${saved.id}`));
      })
      .catch(() => onToast('Save failed — is the server running?'));
  }, [spec, saveName, lastPrompt, onToast]);

  const downloadSpec = useCallback(() => {
    if (!spec) return;
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${spec.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.alpona.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [spec]);

  const loadSpecFile = useCallback(
    (file: File) => {
      void file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as DashboardSpec;
          if (interpret(parsed).ok) {
            agent.loadSpec(parsed);
            setParamValues({});
            setSelectedWidgetId(null);
            setSavedId(null);
          }
        } catch {
          /* not a spec — ignore */
        }
      });
    },
    [agent],
  );

  // ── Create mode: nothing generated yet ─────────────────────────
  if (!spec && agent.phase !== 'error' && !busy) {
    return (
      <div className="create">
        <h1>
          What should your data <em>show you</em>?
        </h1>
        <p className="create__sub">
          Describe a dashboard — Alpona plans the layout, writes guarded SQL, and draws it live.
        </p>
        <div className="create__box">
          <textarea
            autoFocus
            value={input}
            rows={3}
            placeholder="e.g. Late shipments by carrier, worst-hit regions, and a KPI for the late rate…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
          />
          <div className="create__box-foot">
            <span className="create__hint">
              <Sparkles size={13} /> grounded in your data dictionary
            </span>
            <button
              className="btn btn--primary"
              disabled={input.trim().length === 0}
              onClick={() => submit(input)}
            >
              <Wand2 size={15} /> Draw it <ArrowUp size={14} />
            </button>
          </div>
        </div>
        <div className="create__suggestions">
          {suggestions.map((s) => (
            <button key={s} className="example-chip" onClick={() => submit(s)}>
              <Sparkles size={13} />
              <span>{s}</span>
            </button>
          ))}
        </div>
        <label className="create__import">
          <FolderOpen size={14} /> or load a saved spec file
          <input
            type="file"
            accept=".json"
            hidden
            onChange={(e) => e.target.files?.[0] && loadSpecFile(e.target.files[0])}
          />
        </label>
      </div>
    );
  }

  // ── Viewer / generation mode ───────────────────────────────────
  return (
    <div className="workspace">
      {agent.phase === 'error' && (
        <div className="alpona-state alpona-state--error" role="alert">
          <span>Generation failed</span>
          <span className="alpona-state__hint">{agent.error}</span>
          <button className="btn btn--ghost" onClick={() => agent.reset()}>
            Start over
          </button>
        </div>
      )}

      {spec && (
        <>
          <div className="dashboard-head">
            <h2 className="dashboard-title">{spec.title}</h2>
            <div className="dashboard-head__actions">
              {paramDescriptors.length > 0 && (
                <FilterBar
                  descriptors={paramDescriptors}
                  values={{ ...spec.params, ...paramValues }}
                  onChange={(name, value) => setParamValues((prev) => ({ ...prev, [name]: value }))}
                />
              )}
              {agent.phase === 'done' && (
                <div className="dashboard-head__buttons">
                  <button
                    className="icon-btn"
                    title={savedId ? 'Saved — save a copy' : 'Save & get share link'}
                    onClick={() => {
                      setSaveName(spec.title);
                      setSaveOpen(true);
                    }}
                  >
                    {savedId ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                  </button>
                  <button className="icon-btn" title="Download spec JSON" onClick={downloadSpec}>
                    <Download size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
          <Dashboard
            spec={spec}
            client={client}
            params={paramValues}
            pendingInsights={agent.pendingInsights}
            healedIds={agent.healedIds}
            selectedWidgetId={selectedWidgetId}
            onSelectWidget={(id) => setSelectedWidgetId((current) => (current === id ? null : id))}
          />
        </>
      )}

      <footer className="composer">
        {busy && (
          <div className="composer__status" role="status">
            <Loader2 size={13} className="composer__spin" />
            {agent.statusMessage ?? 'Working…'}
          </div>
        )}
        {selectedWidget && (
          <div className="composer__scope">
            refining <strong>{selectedWidget.copy.title ?? selectedWidget.id}</strong>
            <button onClick={() => setSelectedWidgetId(null)} aria-label="Clear selection">
              <X size={13} />
            </button>
          </div>
        )}
        <div className="composer__bar">
          <textarea
            value={input}
            rows={1}
            placeholder={
              spec && agent.phase === 'done'
                ? selectedWidget
                  ? `Refine “${selectedWidget.copy.title ?? selectedWidget.id}” — e.g. “top 5 only”`
                  : 'Refine this dashboard, or describe a new one…'
                : 'Describe the dashboard you need…'
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
          />
          <button
            className="composer__send"
            disabled={busy || input.trim().length === 0}
            onClick={() => submit(input)}
          >
            {busy ? <Loader2 size={15} className="composer__spin" /> : <Wand2 size={15} />}
          </button>
        </div>
      </footer>

      {saveOpen && spec && (
        <div className="dialog-backdrop" onClick={() => setSaveOpen(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-label="Save dashboard"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>
              <Bookmark size={16} /> Save &amp; share
            </h3>
            <p>Saves the spec on your Alpona server and copies a share link.</p>
            <input
              autoFocus
              value={saveName}
              placeholder="Dashboard name"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveDashboard();
                if (e.key === 'Escape') setSaveOpen(false);
              }}
            />
            <div className="dialog__actions">
              <button className="btn btn--ghost" onClick={() => setSaveOpen(false)}>
                cancel
              </button>
              <button className="btn btn--primary" onClick={saveDashboard}>
                save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
