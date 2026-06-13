import { useEffect, useState } from 'react';
import {
  Activity,
  AreaChart,
  BarChart3,
  Check,
  CircleDot,
  Copy,
  Database,
  Gauge,
  Grid3X3,
  LayoutTemplate,
  LineChart,
  ListOrdered,
  PieChart,
  Rocket,
  ScatterChart,
  Settings2,
  Shapes,
  Table2,
  Terminal,
} from 'lucide-react';

interface MetaLayout {
  name: string;
  version: number;
  whenToUse: string;
  slots: {
    id: string;
    accepts: string[];
    region: { x: number; y: number; w: number; h: number };
  }[];
}

interface MetaWidget {
  type: string;
  description: string;
}

const WIDGET_ICONS: Record<string, typeof BarChart3> = {
  kpi_card: Activity,
  line_chart: LineChart,
  bar_chart: BarChart3,
  area_chart: AreaChart,
  donut_chart: PieChart,
  scatter_chart: ScatterChart,
  heatmap: Grid3X3,
  table: Table2,
  gauge: Gauge,
  leaderboard: ListOrdered,
};

/** Tremor-style miniature preview per widget type, pure CSS/SVG. */
function WidgetPreview({ type }: { type: string }) {
  switch (type) {
    case 'kpi_card':
      return (
        <div className="wprev wprev--kpi">
          <span className="wprev__label">Late rate</span>
          <span className="wprev__metric">21.6%</span>
          <span className="wprev__delta">▲ 2.1%</span>
        </div>
      );
    case 'gauge':
      return (
        <div className="wprev wprev--kpi">
          <span className="wprev__label">Utilization</span>
          <span className="wprev__metric">73%</span>
          <span className="wprev__track">
            <span style={{ width: '73%' }} />
          </span>
        </div>
      );
    case 'bar_chart':
      return (
        <div className="wprev wprev--bars">
          {[82, 58, 44, 31, 22, 14].map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      );
    case 'line_chart':
    case 'area_chart':
    case 'scatter_chart': {
      const points = '0,34 16,26 32,29 48,18 64,22 80,10 96,14';
      return (
        <svg className="wprev wprev--line" viewBox="0 0 96 40" preserveAspectRatio="none">
          {type === 'area_chart' && (
            <polygon points={`${points} 96,40 0,40`} className="wprev__area" />
          )}
          {type !== 'scatter_chart' && <polyline points={points} className="wprev__stroke" />}
          {type === 'scatter_chart' &&
            points
              .split(' ')
              .map((p, i) => [p.split(',') as [string, string], i] as const)
              .map(([[x, y], i]) => (
                <circle key={i} cx={x} cy={y} r="2.4" className="wprev__dot" />
              ))}
        </svg>
      );
    }
    case 'donut_chart':
      return (
        <div className="wprev wprev--center">
          <span className="wprev__donut" />
        </div>
      );
    case 'heatmap':
      return (
        <div className="wprev wprev--heat">
          {[0.9, 0.3, 0.6, 0.2, 0.5, 0.8, 0.15, 0.7, 0.4, 0.95, 0.25, 0.55].map((o, i) => (
            <span key={i} style={{ opacity: o }} />
          ))}
        </div>
      );
    case 'leaderboard':
      return (
        <div className="wprev wprev--rows">
          {[88, 61, 37].map((w, i) => (
            <span key={i} className="wprev__hbar" style={{ width: `${w}%` }} />
          ))}
        </div>
      );
    case 'table':
      return (
        <div className="wprev wprev--table">
          {[0, 1, 2].map((r) => (
            <span key={r} className="wprev__trow">
              <span />
              <span />
              <span />
            </span>
          ))}
        </div>
      );
    default:
      return <div className="wprev" />;
  }
}

function CodeBlock({ code, onCopied }: { code: string; onCopied: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre className="code">
      <button
        className="code__copy"
        title="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            onCopied();
            setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <code>{code}</code>
    </pre>
  );
}

const SECTIONS = [
  { id: 'quickstart', label: 'Quickstart', icon: Rocket },
  { id: 'configuration', label: 'Configuration', icon: Settings2 },
  { id: 'providers', label: 'Model providers', icon: Terminal },
  { id: 'layouts', label: 'Layouts', icon: LayoutTemplate },
  { id: 'widgets', label: 'Widgets', icon: Shapes },
];

const ENV_VARS: { name: string; def: string; desc: string }[] = [
  {
    name: 'ALPONA_PROVIDER',
    def: 'inferred',
    desc: 'anthropic | openai — which agent backend to use',
  },
  { name: 'ANTHROPIC_API_KEY', def: '—', desc: 'Anthropic credentials for the live agent' },
  { name: 'OPENAI_API_KEY', def: '—', desc: 'OpenAI credentials (unused for local servers)' },
  { name: 'OPENAI_BASE_URL', def: '—', desc: 'Any OpenAI-compatible endpoint, e.g. LM Studio' },
  {
    name: 'ALPONA_PLANNER_MODEL',
    def: 'per provider',
    desc: 'Fast model: chooses layout and widgets',
  },
  { name: 'ALPONA_BINDER_MODEL', def: 'per provider', desc: 'Strong model: writes SQL per widget' },
  { name: 'ALPONA_COPY_MODEL', def: 'per provider', desc: 'Fast model: titles and captions' },
  { name: 'ALPONA_DB', def: 'duckdb:…', desc: 'duckdb:<path> or a postgres:// connection string' },
  { name: 'ALPONA_MOCK', def: 'auto', desc: '1 = deterministic fixtures, no API key needed' },
  { name: 'ALPONA_DATA_DIR', def: '.alpona/dashboards', desc: 'Where saved dashboards live' },
  { name: 'ALPONA_PORT', def: '3001', desc: 'Agent + query service port' },
];

export function Docs({ onToast }: { onToast: (message: string) => void }) {
  const [layouts, setLayouts] = useState<MetaLayout[]>([]);
  const [widgets, setWidgets] = useState<MetaWidget[]>([]);
  const [active, setActive] = useState('quickstart');

  useEffect(() => {
    void fetch('/api/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((meta: { layouts?: MetaLayout[]; widgets?: MetaWidget[] } | null) => {
        if (meta?.layouts) setLayouts(meta.layouts);
        if (meta?.widgets) setWidgets(meta.widgets);
      })
      .catch(() => {});
  }, []);

  const copied = () => onToast('Copied to clipboard');

  return (
    <div className="docs">
      <aside className="docs__nav">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#/docs`}
            className={active === id ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              setActive(id);
              document.getElementById(`docs-${id}`)?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Icon size={14} /> {label}
          </a>
        ))}
      </aside>

      <div className="docs__body">
        <section id="docs-quickstart" className="docs__section">
          <h1>
            <Rocket size={22} /> Quickstart
          </h1>
          <p>
            Alpona is a pnpm monorepo: a rendering engine (<code>@alpona/core</code>), an agent +
            query server (<code>@alpona/server</code>), a migration CLI (<code>alpona-db</code>),
            and this example app. Node 22+ and pnpm 9+ are the only prerequisites — no Docker, no
            cloud account.
          </p>
          <h3>1 · Install</h3>
          <CodeBlock
            onCopied={copied}
            code={`git clone <your-fork> alpona && cd alpona\npnpm install`}
          />
          <h3>2 · Import a data model &amp; data</h3>
          <p>
            Migrations and seeds are plain SQL; the data dictionary — the only thing the agent ever
            sees — is generated from the migrated schema, never written by hand.
          </p>
          <CodeBlock
            onCopied={copied}
            code={`pnpm alpona-db migrate     # schema\npnpm alpona-db seed        # data\npnpm alpona-db marts       # analytical views the agent prefers\npnpm alpona-db dictionary  # grounding for every prompt`}
          />
          <h3>3 · Run</h3>
          <CodeBlock
            onCopied={copied}
            code={`cp .env.example .env       # add an API key, or skip for mock mode\npnpm dev                   # server :3001 · app :5173`}
          />
          <p>
            The landing page reads your dictionary and suggests prompts immediately. Without a key,
            a deterministic mock agent serves the full experience offline.
          </p>
        </section>

        <section id="docs-configuration" className="docs__section">
          <h1>
            <Settings2 size={22} /> Configuration
          </h1>
          <p>
            Everything is environment-driven via <code>.env</code> at the workspace root. Explicit
            variables always win.
          </p>
          <div className="table-card">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Default</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {ENV_VARS.map((v) => (
                  <tr key={v.name} className="table__static">
                    <td>
                      <code>{v.name}</code>
                    </td>
                    <td className="table__date">{v.def}</td>
                    <td>{v.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="docs-providers" className="docs__section">
          <h1>
            <Terminal size={22} /> Model providers
          </h1>
          <p>
            The four-stage pipeline is provider-agnostic. Point it at Anthropic, OpenAI, or any
            OpenAI-compatible server — switching is a <code>.env</code> change, not a code change.
          </p>
          <h3>
            <Database size={15} /> OpenAI
          </h3>
          <CodeBlock
            onCopied={copied}
            code={`ALPONA_PROVIDER=openai\nOPENAI_API_KEY=sk-…\n# defaults: gpt-5.4-mini (planner/copy) · gpt-5.4 (binders)`}
          />
          <h3>
            <Database size={15} /> Anthropic
          </h3>
          <CodeBlock
            onCopied={copied}
            code={`ANTHROPIC_API_KEY=sk-ant-…\n# defaults: claude-haiku-4-5 (planner/copy) · claude-opus-4-8 (binders)`}
          />
          <h3>
            <Database size={15} /> Local via LM Studio
          </h3>
          <CodeBlock
            onCopied={copied}
            code={`OPENAI_BASE_URL=http://localhost:1234/v1\nALPONA_PLANNER_MODEL=<model-id>   # + BINDER / COPY\n# load the model with ≥16k context: lms load <model> --context-length 16384`}
          />
        </section>

        <section id="docs-layouts" className="docs__section">
          <h1>
            <LayoutTemplate size={22} /> Layouts
          </h1>
          <p>
            A layout is a versioned JSON template: named slots with grid regions, accepted widget
            types, and min/max counts. The planner picks one; the composer enforces it. These{' '}
            {layouts.length} ship today — contributing one is a single JSON file, no code.
          </p>
          <div className="layout-grid">
            {layouts.map((layout) => (
              <article key={layout.name} className="layout-card">
                <div className="layout-card__diagram" aria-hidden>
                  {layout.slots.map((slot) => (
                    <span
                      key={slot.id}
                      title={slot.id}
                      style={{
                        gridColumn: `${slot.region.x + 1} / span ${slot.region.w}`,
                        gridRow: `${slot.region.y + 1} / span ${slot.region.h}`,
                      }}
                    />
                  ))}
                </div>
                <h3>
                  {layout.name}
                  <span className="layout-card__version">v{layout.version}</span>
                </h3>
                <p>{layout.whenToUse}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="docs-widgets" className="docs__section">
          <h1>
            <Shapes size={22} /> Widgets
          </h1>
          <p>
            Every widget declares a zod props schema, a <code>resultShape</code> contract (how SQL
            columns map onto visual roles), sizing rules, and agent hints. The binder can only
            produce what the registry can validate.
          </p>
          <div className="widget-grid">
            {widgets.map((widget) => {
              const Icon = WIDGET_ICONS[widget.type] ?? CircleDot;
              return (
                <article key={widget.type} className="widget-card">
                  <WidgetPreview type={widget.type} />
                  <div className="widget-card__meta">
                    <h3>
                      <Icon size={14} />
                      <code>{widget.type}</code>
                    </h3>
                    <p>{widget.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
