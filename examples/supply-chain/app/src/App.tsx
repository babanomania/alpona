import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Compass, Moon, Sun, Wand2 } from 'lucide-react';
import { Landing } from './pages/Landing.js';
import { Workspace } from './pages/Workspace.js';
import { Explore } from './pages/Explore.js';
import { Docs } from './pages/Docs.js';

type Route =
  | { page: 'landing' }
  | { page: 'create' }
  | { page: 'explore' }
  | { page: 'docs' }
  | { page: 'viewer'; id: string };

function parseRoute(): Route {
  const hash = window.location.hash;
  const shared = /^#\/d\/([A-Za-z0-9_-]+)$/.exec(hash);
  if (shared) return { page: 'viewer', id: shared[1]! };
  if (hash.startsWith('#/create')) return { page: 'create' };
  if (hash.startsWith('#/explore')) return { page: 'explore' };
  if (hash.startsWith('#/docs')) return { page: 'docs' };
  return { page: 'landing' };
}

export function App() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('alpona-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('alpona-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const [suggestionCount, setSuggestionCount] = useState(0);
  useEffect(() => {
    void fetch('/api/suggestions')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { suggestions?: string[] } | null) =>
        setSuggestionCount(body?.suggestions?.length ?? 0),
      )
      .catch(() => {});
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const onLanding = route.page === 'landing';

  return (
    <div className={`shell ${onLanding ? 'shell--landing' : ''}`}>
      <header className="topbar">
        <button
          className="wordmark"
          onClick={() => (window.location.hash = '')}
          title="Alpona home"
        >
          <span className="wordmark__bengali" aria-hidden>
            আলপনা
          </span>
          <div>
            <h1>Alpona</h1>
            <p>describe it — alpona draws the pattern</p>
          </div>
        </button>
        <nav className="topbar__nav">
          <a href="#/create" className={route.page === 'create' ? 'active' : ''}>
            <Wand2 size={14} /> Create
          </a>
          <a href="#/explore" className={route.page === 'explore' ? 'active' : ''}>
            <Compass size={14} /> Explore
          </a>
          <a href="#/docs" className={route.page === 'docs' ? 'active' : ''}>
            <BookOpen size={14} /> Docs
          </a>
        </nav>
        <div className="topbar__actions">
          {onLanding && (
            <button
              className="btn btn--primary btn--sm"
              onClick={() => (window.location.hash = '#/create')}
            >
              <Wand2 size={14} /> Open studio
            </button>
          )}
          <button
            className="ghost-btn"
            onClick={() => setDark((d) => !d)}
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main className="canvas">
        {route.page === 'landing' && <Landing suggestionCount={suggestionCount} />}
        {route.page === 'explore' && <Explore onToast={showToast} />}
        {route.page === 'docs' && <Docs onToast={showToast} />}
        {(route.page === 'create' || route.page === 'viewer') && (
          <Workspace
            // Remount on route change: a fresh create surface or a fresh
            // shared-board load, with no cross-route state to reconcile.
            key={route.page === 'viewer' ? route.id : 'create'}
            dashboardId={route.page === 'viewer' ? route.id : null}
            onToast={showToast}
          />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
