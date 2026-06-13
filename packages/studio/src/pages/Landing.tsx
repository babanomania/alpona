import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Compass,
  Database,
  MessagesSquare,
  RefreshCw,
  Sparkles,
  Target,
  Wand2,
  Wrench,
} from 'lucide-react';
import { AlponaHero } from '../hero/AlponaHero.js';
import { DemoPlayer } from '../marketing/DemoPlayer.js';
import { authFetch } from '../auth.js';

// §4.1 copy deck — user-voiced, benefits over mechanisms.
const FEATURES = [
  {
    icon: MessagesSquare,
    title: 'Ask or describe',
    body: 'A question gets an answer with the numbers to back it. A description gets a full dashboard. Same box.',
  },
  {
    icon: Target,
    title: 'Real numbers, always',
    body: 'Every answer and chart runs live against your database — with the query shown, so you can check the work.',
  },
  {
    icon: RefreshCw,
    title: 'Edit by talking',
    body: '“Top 5 only.” “Make it weekly.” Just that widget changes.',
  },
  {
    icon: Wrench,
    title: 'It fixes itself',
    body: 'Failed charts quietly repair and retry. Never a crash.',
  },
  {
    icon: Sparkles,
    title: 'Save, share, fork',
    body: 'Dashboards are yours to keep, link, and duplicate.',
  },
  {
    icon: Database,
    title: 'Never start blank',
    body: 'Ready-made dashboards, a browsable data catalog, and prompt ideas from your own schema.',
  },
];

export function Landing({ suggestionCount }: { suggestionCount: number }) {
  const go = (hash: string) => {
    window.location.hash = hash;
  };

  const [dashboardCount, setDashboardCount] = useState(0);
  useEffect(() => {
    void authFetch('/api/dashboards')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { dashboards?: unknown[] } | null) => {
        if (body?.dashboards) setDashboardCount(body.dashboards.length);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="landing">
      <section className="landing__hero">
        <div className="hero__backdrop" aria-hidden>
          <AlponaHero dark={document.documentElement.classList.contains('dark')} />
        </div>
        <span className="landing__badge">
          <Sparkles size={13} /> your data, drawn live
        </span>
        <h1>
          Dashboards drawn
          <br />
          from <em>a sentence</em>.
        </h1>
        <p className="landing__sub">
          Ask a question, get an answer. Describe a view, get a live dashboard. One box, your data,
          plain language.
        </p>
        <div className="landing__cta">
          <button className="btn btn--primary" onClick={() => go('#/create')}>
            <Wand2 size={16} /> Start creating <ArrowRight size={15} />
          </button>
          <button className="btn btn--ghost" onClick={() => go('#/explore')}>
            <Compass size={16} /> Explore dashboards
          </button>
        </div>
        <div className="landing__demo">
          <DemoPlayer />
        </div>
      </section>

      <section className="landing__stats">
        <div>
          <strong>{dashboardCount || '—'}</strong>
          <span>dashboards ready to open</span>
        </div>
        <div>
          <strong>{suggestionCount || 6}</strong>
          <span>prompt ideas from your schema</span>
        </div>
        <div>
          <strong>10</strong>
          <span>widget types</span>
        </div>
        <div>
          <strong>seconds</strong>
          <span>from sentence to screen</span>
        </div>
      </section>

      <section className="landing__features" id="features">
        <h2>
          One box. <em>Your data.</em> Plain language.
        </h2>
        <div className="bento">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="bento__card">
              <span className="bento__icon">
                <Icon size={19} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing__final">
        <h2>
          Your data already knows
          <br />
          what it wants to say.
        </h2>
        <button className="btn btn--primary btn--lg" onClick={() => go('#/create')}>
          <Sparkles size={17} /> Ask it something <ArrowRight size={16} />
        </button>
        <p className="landing__final-hint">
          Data sources are managed by the Alpona CLI — your server, your database.
        </p>
      </section>
    </div>
  );
}
