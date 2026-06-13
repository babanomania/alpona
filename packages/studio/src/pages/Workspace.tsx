import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardSpec, ParamValue } from '@alpona/core';
import { QueryClient, extractParams, interpret } from '@alpona/core';
import type { AgentLogEntry } from '@alpona/core/react';
import { Dashboard, FilterBar, createHttpQueryFetcher, useAlponaAgent } from '@alpona/core/react';
import {
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Code2,
  Download,
  FolderOpen,
  HelpCircle,
  LayoutGrid,
  Loader2,
  MessagesSquare,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { ConversationRail } from '../components/ConversationRail.js';
import { authFetch, authHeaders } from '../auth.js';

interface SavedDashboard {
  id: string;
  name: string;
  prompt?: string;
  spec: DashboardSpec;
}

interface Suggestion {
  text: string;
  intent: 'ask' | 'build';
}

/** Turns a question into a short widget title: "what is the revenue for
 *  Jan?" → "Revenue for Jan". */
function labelFromQuestion(question?: string): string | undefined {
  if (!question) return undefined;
  const stripped = question
    .trim()
    .replace(/\?+$/, '')
    .replace(
      /^(what(?:'s| is| are)?|how many|how much|show me|which|list|give me|tell me)\s+(the\s+)?/i,
      '',
    )
    .trim();
  const label = stripped || question.trim().replace(/\?+$/, '');
  return label ? label.charAt(0).toUpperCase() + label.slice(1, 60) : undefined;
}

export function Workspace({
  dashboardId,
  onToast,
}: {
  /** From a #/d/:id share URL; null means a fresh create surface. */
  dashboardId: string | null;
  onToast: (message: string) => void;
}) {
  const client = useMemo(
    () => new QueryClient({ fetcher: createHttpQueryFetcher('/api', authHeaders) }),
    [],
  );
  const agent = useAlponaAgent('/api', authHeaders);
  const { spec } = agent;

  // Catalog "Ask about this" pre-fills the composer via sessionStorage —
  // consumed once at mount so it never leaks into a later session.
  const [input, setInput] = useState(() => {
    const prefill = sessionStorage.getItem('alpona-prefill');
    if (prefill) {
      sessionStorage.removeItem('alpona-prefill');
      return prefill;
    }
    return '';
  });
  const [paramValues, setParamValues] = useState<Record<string, ParamValue>>({});
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [railOpen, setRailOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    void authFetch('/api/suggestions')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { suggestions?: (string | Suggestion)[] } | null) => {
        if (!body?.suggestions?.length) return;
        // Tolerate both the new tagged shape and a bare-string fallback.
        setSuggestions(
          body.suggestions.map((s) =>
            typeof s === 'string'
              ? { text: s, intent: s.trimEnd().endsWith('?') ? 'ask' : 'build' }
              : s,
          ),
        );
      })
      .catch(() => {});
  }, []);

  // Share URLs: the component remounts per dashboardId (keyed by the
  // router), so this runs once per board.
  useEffect(() => {
    if (!dashboardId) return;
    void authFetch(`/api/dashboards/${dashboardId}`)
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

  const pinAnswer = useCallback(
    (item: AgentLogEntry) => {
      if (!spec || !item.answer) return;
      const columns = item.answer.rows.length > 0 ? Object.keys(item.answer.rows[0]!) : ['value'];
      // Name the pinned widget after the question, not its value — "212"
      // is a meaningless title on a dashboard.
      const title = labelFromQuestion(item.question) ?? columns[0] ?? 'Pinned metric';
      agent.pin(spec, { sql: item.answer.sql, title, columns });
    },
    [agent, spec],
  );

  const saveDashboard = useCallback(() => {
    if (!spec) return;
    const name = saveName.trim() || spec.title;
    void authFetch('/api/dashboards', {
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
  if (!spec && agent.phase !== 'error' && !busy && !agent.answer) {
    return (
      <div className="create">
        <h1>
          Ask a question, or <br />
          <em>describe a view</em>.
        </h1>
        <p className="create__sub">
          One box, your data, plain language. A question gets an answer; <br /> a description gets a
          live dashboard — Alpona decides.
        </p>
        <div className="create__box">
          <textarea
            autoFocus
            value={input}
            rows={3}
            placeholder="How many shipments ran late this week?  ·  Ops view for the warehouse team…"
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
              <Wand2 size={15} /> Go <ArrowUp size={14} />
            </button>
          </div>
        </div>
        <div className="create__suggestions">
          {suggestions.map((s) => (
            <button
              key={s.text}
              className={`example-chip example-chip--${s.intent}`}
              onClick={() => submit(s.text)}
              title={s.intent === 'ask' ? 'a question → an answer' : 'a description → a dashboard'}
            >
              {s.intent === 'ask' ? <HelpCircle size={13} /> : <LayoutGrid size={13} />}
              <span>{s.text}</span>
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
  const focusComposer = () =>
    document.querySelector<HTMLTextAreaElement>('.composer__bar textarea')?.focus();

  return (
    <div className={`workspace ${railOpen ? 'workspace--rail' : ''}`}>
      <div className="workspace__main">
        {agent.phase === 'error' && (
          <div className="alpona-state alpona-state--error" role="alert">
            <span>Generation failed</span>
            <span className="alpona-state__hint">{agent.error}</span>
            <button className="btn btn--ghost" onClick={() => agent.reset()}>
              Start over
            </button>
          </div>
        )}

        {!spec && agent.answer && agent.phase === 'done' && (
          <div className="answer-only">
            <span className="answer-only__eyebrow">
              <HelpCircle size={14} /> answer
            </span>
            {agent.answer.value != null && (
              <div className="answer-only__value">{String(agent.answer.value)}</div>
            )}
            <p className="answer-only__text">{agent.answer.answer}</p>
            <p className="answer-only__hint">
              Ask another question, or describe a full dashboard to start building.
            </p>
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
                    onChange={(name, value) =>
                      setParamValues((prev) => ({ ...prev, [name]: value }))
                    }
                  />
                )}
                {agent.phase === 'done' && (
                  <div className="dashboard-head__buttons">
                    <button
                      className={`icon-btn ${inspectorOpen ? 'icon-btn--on' : ''}`}
                      title="Inspect the spec JSON"
                      onClick={() => setInspectorOpen((o) => !o)}
                    >
                      <Code2 size={16} />
                    </button>
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
              onSelectWidget={(id) =>
                setSelectedWidgetId((current) => (current === id ? null : id))
              }
            />
            {inspectorOpen && <pre className="spec-inspector">{JSON.stringify(spec, null, 2)}</pre>}
          </>
        )}
      </div>

      <aside className="workspace__rail">
        <ConversationRail
          log={agent.log}
          canPin={Boolean(spec)}
          onPin={pinAnswer}
          onUndo={agent.undo}
          onFollowUp={focusComposer}
        />
      </aside>

      <footer className="composer">
        <button
          className={`composer__rail-toggle ${railOpen ? 'on' : ''}`}
          title={railOpen ? 'Hide the conversation' : 'Show the conversation'}
          onClick={() => setRailOpen((o) => !o)}
        >
          <MessagesSquare size={15} />
        </button>
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
                  : 'Refine this dashboard, ask a question, or describe a new one…'
                : 'Ask a question, or describe a view…'
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
        <p className="composer__hint">
          questions get answers · descriptions get widgets — Alpona decides
        </p>
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
