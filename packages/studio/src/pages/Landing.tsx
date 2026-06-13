import {
  ArrowRight,
  Compass,
  Database,
  FileJson,
  GitMerge,
  LayoutDashboard,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Wand2,
  Workflow,
  Zap,
} from 'lucide-react';
import { AlponaHero } from '../hero/AlponaHero.js';
import { DemoPlayer } from '../marketing/DemoPlayer.js';

const FEATURES = [
  {
    icon: MessageSquareText,
    title: 'Speak, don’t configure',
    body: 'Describe the dashboard in plain language. Layout, widgets, queries, and copy assemble themselves.',
  },
  {
    icon: ShieldCheck,
    title: 'SQL behind guardrails',
    body: 'Every query passes an AST gate — read-only, row-capped, schema-grounded. The agent can only fail safely.',
  },
  {
    icon: Zap,
    title: 'Self-healing binds',
    body: 'A failing query is retried with the database’s own error as feedback. Broken widgets become honest empty states, never crashes.',
  },
  {
    icon: GitMerge,
    title: 'Refine, don’t regenerate',
    body: 'Edits arrive as JSON Patches. Say “top 5 only” and just that widget morphs — nothing else re-renders.',
  },
  {
    icon: FileJson,
    title: 'Portable by design',
    body: 'A dashboard is a small JSON spec: save it, share it as a URL, download it, version it. Data stays in your database.',
  },
  {
    icon: Database,
    title: 'Your stack, your models',
    body: 'DuckDB or Postgres underneath. Anthropic, OpenAI, or a local model via LM Studio doing the thinking.',
  },
];

const STEPS = [
  {
    icon: Sparkles,
    name: 'Plan',
    body: 'A layout and widget set, streamed instantly as a skeleton.',
  },
  {
    icon: Wand2,
    name: 'Bind',
    body: 'One validated SQL query per widget, dry-run before it ships.',
  },
  {
    icon: MessageSquareText,
    name: 'Copy',
    body: 'Titles and captions written from the actual result rows.',
  },
  { icon: Workflow, name: 'Refine', body: 'Conversational edits as surgical JSON Patches.' },
];

export function Landing({ suggestionCount }: { suggestionCount: number }) {
  const go = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <div className="landing">
      <section className="landing__hero">
        <div className="hero__backdrop" aria-hidden>
          <AlponaHero dark={document.documentElement.classList.contains('dark')} />
        </div>
        <span className="landing__badge">
          <Sparkles size={13} /> generative dashboards, validated end to end
        </span>
        <h1>
          Dashboards drawn
          <br />
          from <em>a sentence</em>.
        </h1>
        <p className="landing__sub">
          An LLM decides <strong>what</strong> to show. A deterministic engine decides{' '}
          <strong>how</strong>. Ask in plain language — get a live, data-bound dashboard with SQL
          you can trust.
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
          <strong>4-stage</strong>
          <span>agent pipeline</span>
        </div>
        <div>
          <strong>100%</strong>
          <span>of SQL gated &amp; sandboxed</span>
        </div>
        <div>
          <strong>12</strong>
          <span>layout templates</span>
        </div>
        <div>
          <strong>{suggestionCount || 5}</strong>
          <span>prompts suggested from your schema</span>
        </div>
      </section>

      <section className="landing__features" id="features">
        <h2>
          The agent proposes. <em>The engine disposes.</em>
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

      <section className="landing__steps">
        <h2>
          Four stages, <em>one sentence apart</em>
        </h2>
        <div className="steps">
          {STEPS.map(({ icon: Icon, name, body }, i) => (
            <article key={name} className="steps__card">
              <span className="steps__num">{String(i + 1).padStart(2, '0')}</span>
              <span className="steps__icon">
                <Icon size={17} />
              </span>
              <h3>{name}</h3>
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
          <LayoutDashboard size={17} /> Draw your first dashboard <ArrowRight size={16} />
        </button>
        <p className="landing__final-hint">no signup — it’s your server, your database</p>
      </section>
    </div>
  );
}
