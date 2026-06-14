import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Boxes, Compass, Database, LogOut, Moon, Sun, Wand2 } from 'lucide-react';
import { Landing } from './pages/Landing.js';
import { Workspace } from './pages/Workspace.js';
import { Explore } from './pages/Explore.js';
import { Catalog } from './pages/Catalog.js';
import { Login } from './pages/Login.js';
import { authFetch, clearToken, fetchAuthInfo, getToken, type AuthInfo } from './auth.js';

interface Source {
  name: string;
  dialect: string;
  tables: number;
}

type Route =
  | { page: 'landing' }
  | { page: 'create' }
  | { page: 'explore' }
  | { page: 'catalog' }
  | { page: 'viewer'; id: string };

// Documentation lives in the Starlight site, not the studio.
const DOCS_URL = 'https://babanomania.github.io/alpona';

function parseRoute(): Route {
  const hash = window.location.hash;
  const shared = /^#\/d\/([A-Za-z0-9_-]+)$/.exec(hash);
  if (shared) return { page: 'viewer', id: shared[1]! };
  if (hash.startsWith('#/create')) return { page: 'create' };
  if (hash.startsWith('#/explore')) return { page: 'explore' };
  if (hash.startsWith('#/catalog')) return { page: 'catalog' };
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

  // Auth gate: learn the server's posture first; render the studio only
  // once we're signed in (or auth is off). null = still resolving.
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    void fetchAuthInfo().then((info) => {
      setAuthInfo(info);
      setSignedIn(info.mode === 'none' || Boolean(getToken()));
    });
  }, []);

  const authed = authInfo !== null && (authInfo.mode === 'none' || signedIn);

  const [suggestionCount, setSuggestionCount] = useState(0);
  const [sources, setSources] = useState<Source[]>([]);
  useEffect(() => {
    if (!authed) return;
    void authFetch('/api/suggestions')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { suggestions?: unknown[] } | null) =>
        setSuggestionCount(body?.suggestions?.length ?? 0),
      )
      .catch(() => {});
    void authFetch('/api/sources')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { sources?: Source[] } | null) => body?.sources && setSources(body.sources))
      .catch(() => {});
  }, [authed]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const onLanding = route.page === 'landing';

  // Auth still resolving — avoid a flash of the studio before the gate.
  if (authInfo === null) {
    return <div className="shell" />;
  }
  // Auth required and not signed in → the login screen, nothing else.
  if (authInfo.mode !== 'none' && !signedIn) {
    return <Login authUrl={authInfo.authUrl ?? '/auth/v1'} onSignedIn={() => setSignedIn(true)} />;
  }

  const signOut = () => {
    clearToken();
    setSignedIn(false);
    window.location.hash = '';
  };

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
          <a href="#/catalog" className={route.page === 'catalog' ? 'active' : ''}>
            <Boxes size={14} /> Catalog
          </a>
          <a href="#/explore" className={route.page === 'explore' ? 'active' : ''}>
            <Compass size={14} /> Explore
          </a>
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            <BookOpen size={14} /> Docs
          </a>
        </nav>
        <div className="topbar__actions">
          {sources.length > 0 && (
            <span
              className="source-pill"
              title={
                sources.length > 1
                  ? `${sources.length} sources · manage with the alpona CLI`
                  : 'active data source · manage with the alpona CLI'
              }
            >
              <Database size={13} />
              {sources[0]!.name}
              {sources.length > 1 && (
                <span className="source-pill__more">+{sources.length - 1}</span>
              )}
            </span>
          )}
          {onLanding && (
            <button
              className="btn btn--primary btn--sm"
              onClick={() => (window.location.hash = '#/create')}
            >
              <Wand2 size={14} /> Open studio
            </button>
          )}
          {authInfo.mode !== 'none' && (
            <button className="ghost-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
              <LogOut size={15} />
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
        {route.page === 'catalog' && <Catalog />}
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
