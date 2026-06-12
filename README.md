# Alpona

**Generative UI for dashboards. Describe it — Alpona draws the pattern.**

> **আলপনা** _(al-po-na)_ — the Bengali art of drawing intricate patterns freehand, composed from a learned vocabulary of motifs. No two alponas are identical; none break the tradition's rules. That is exactly what this engine does with dashboards.

Alpona is a **generative UI engine**: an LLM decides _what to show_ and _how to fetch it_; a deterministic rendering engine decides _how it renders_. Type a plain-language description and watch a live, data-bound dashboard assemble itself — layout chosen, widgets selected, labels written, and every chart powered by agent-generated SQL that is validated, sandboxed, and self-healing.

No code is generated. No template is hardcoded. The interface itself is the model's output — expressed as a spec your design system can trust.

## What it does

```
"Ops view for the warehouse team: delayed shipments by carrier,
 SKUs below reorder point, and utilization across warehouses."
```

⬇️ &nbsp;within seconds

A fully laid-out dashboard: KPI strip, hero chart, drill-down table — each widget bound to a real SQL query against your database, streaming onto the screen as it's planned, hydrating in parallel as queries resolve.

The output is not code. It is a **DashboardSpec** — a portable, versioned, data-free JSON artifact. The same spec re-runs against dev or prod, re-parameterizes for any branch/date/region, diffs cleanly in a PR, and never contains a single data value.

## Generative UI — the schema-driven school

Generative UI today has two schools. **Code-generating** tools (v0, Lovable, Bolt) have the LLM write actual React — maximally flexible, but every generation is novel code that can break, drift off the design system, and needs repair loops. **Schema-driven** generative UI inverts the bet: the LLM emits structured decisions against a fixed vocabulary, and a deterministic engine renders them. Bounded. Validatable. Design-system-safe by construction.

Alpona is a full-stack expression of the schema-driven school — and it pushes the idea further than the typical "LLM picks a component" pattern:

- **Layout is generative.** The model selects from a curated, versioned layout library and fills its slots — composition is a first-class model decision, not a hardcoded grid.
- **Data binding is generative.** The model writes real SQL per widget — windows, CTEs, pivots — making this generative UI that reaches all the way down to the data layer, not a renderer for pre-fetched props.
- **The generation is a durable artifact.** Output is a portable, diffable, re-parameterizable `DashboardSpec` — generative UI you can version, fork, review in a PR, and promote dev → prod. Not ephemeral, not code.
- **The model can only fail safely.** Invalid specs are rejected by schema, illegal SQL by the AST gate, broken queries silently self-heal. The magic never breaks character.

## Why it's different

Alpona splits the work by what each part is actually good at:

| Concern                | Owner                           | Why                                              |
| ---------------------- | ------------------------------- | ------------------------------------------------ |
| What insights matter   | **LLM (Planner)**               | Meaning requires inference                       |
| How data is fetched    | **LLM (Binder)** → raw SQL      | Full SQL power: windows, CTEs, pivots            |
| Where widgets go       | **Code (Composer)**             | Layout is constraint satisfaction, not inference |
| What things are called | Data dictionary + LLM copy pass | Labels are lookups; narrative is judgment        |
| Whether SQL is safe    | **Code (Guardrails)**           | Security is never delegated to a model           |

The agent can only fail in ways the system can catch — invalid specs are rejected by schema, illegal SQL is rejected by the AST gate, and broken queries are silently regenerated via the self-heal loop with the database's own error message as feedback.

## Architecture

```
┌───────────────── BROWSER ─────────────────┐
│  Chat UI (SSE streaming)                  │
│  RENDERING ENGINE                         │
│   ├─ Spec Interpreter + JSON Patch (FLIP) │
│   ├─ Composer — slot contracts, grid      │
│   ├─ Widget Registry (shadcn/ui based)    │
│   ├─ Param Resolver → auto filter bar     │
│   └─ Query Client (cache, dedupe, states) │
└──────────┬───────────────────▲────────────┘
           ▼                   │ aggregates only
╔═════════════════ BACKEND ════════════════════╗
║  AGENT SERVICE          QUERY SERVICE        ║
║   ├─ /plan  (layout +    ├─ SELECT-only AST  ║
║   │   slots, streamed)   │   gate, allowlist ║
║   ├─ /bind  (SQL per     ├─ LIMIT + timeout  ║
║   │   slot, parallel)    ├─ param binding    ║
║   ├─ /copy  (captions)   ├─ shared cache     ║
║   └─ LLM key lives here  └─ ↺ self-heal loop ║
║                                              ║
║  DB ADAPTER (dialect-aware: postgres, duckdb)║
╚═══════════════════╦══════════════════════════╝
                    ▼
          ┌────────────────────┐
          │  PostgreSQL         │  read-only role
          │  (migrated + seeded │  via alpona-db
          │   via alpona-db)     │
          └────────────────────┘
```

### The four-stage pipeline

1. **Planner** _(fast model)_ — reads the layout library and data dictionary, picks a layout template, assigns insight slots. Streams immediately: the skeleton renders in under a second.
2. **Binders** _(strong model, parallel)_ — one call per slot. Receives DDL + sample rows + widget result-shape contracts; emits `{ widgetType, sql, resultShape }`. Failures self-heal: the database error is fed back and the binding regenerates — once, silently.
3. **Composer** _(pure code)_ — enforces slot contracts (min/max, accepted types, overflow rules), computes the responsive grid. The agent proposes; the composer disposes.
4. **Copy pass** _(cheap model, async)_ — titles and one-line insight captions fade in after data loads.

### The four contracts

| Contract                                                             | Authored by         | Consumed by                                 |
| -------------------------------------------------------------------- | ------------------- | ------------------------------------------- |
| `DashboardSpec` (JSON Schema)                                        | core                | agent output gate, interpreter              |
| Layout slot contracts (10–15 templates)                              | designers           | planner prompt, composer                    |
| Widget registry entries (zod props, resultShape, sizing, agentHints) | design system       | binder prompt, composer, validator          |
| Data dictionary (DDL + semantics + cardinality)                      | each implementation | planner + binder grounding, table allowlist |

The data dictionary is the **only** place domain knowledge lives. The core engine never imports from an example — the dependency arrow points one way.

## Database deployment — migrations as code

Alpona treats the database the way it treats dashboards: as a versioned, declarative, repeatable artifact. The `alpona-db` workflow is Liquibase/dbt-flavored:

```
examples/supply-chain/db/
├── migrations/                  # Liquibase-style: ordered, immutable, checksummed
│   ├── 0001_create_suppliers.sql
│   ├── 0002_create_warehouses.sql
│   ├── 0003_create_products_inventory.sql
│   ├── 0004_create_orders_shipments.sql
│   ├── 0005_create_demand_history.sql
│   └── 0006_roles_and_grants.sql   # creates alpona_reader (read-only)
├── seeds/                       # dbt-style: idempotent reference + demo data
│   ├── suppliers.csv
│   ├── products.csv
│   └── seed.sql                 # COPY + deterministic synthetic generators
├── marts/                       # dbt-style transforms: views the agent queries
│   ├── shipment_performance.sql # late-vs-on-time, rolling delay averages
│   ├── stock_risk.sql           # on-hand vs reorder point, days of cover
│   └── warehouse_utilization.sql
└── dictionary/
    └── build.ts                 # introspects schema → data dictionary JSON
```

```bash
alpona-db migrate    # apply pending migrations (tracked in alpona_changelog)
alpona-db seed       # load seeds, idempotent
alpona-db marts      # (re)create analytical views
alpona-db dictionary # regenerate the data dictionary from live schema
alpona-db verify     # checksums + drift detection against migrations
```

Principles borrowed deliberately:

- **From Liquibase/Flyway:** ordered immutable migrations, a changelog table, checksum verification, drift detection. Editing an applied migration fails CI.
- **From dbt:** seeds are data-as-code; analytical views live in `marts/` as version-controlled SQL transforms — the agent binds to marts first, raw tables second, which keeps generated SQL simpler and faster.
- **Alpona-specific:** the data dictionary is _generated from the migrated schema_, never hand-drifted. If a migration adds a column, `alpona-db dictionary` picks it up and the agent knows about it on the next generation. Schema, dictionary, and agent grounding cannot disagree.

The read-only `alpona_reader` role created in migrations is the security backstop: even if every guardrail above it failed, the database itself refuses writes.

## Repository layout

```
alpona/
├── packages/
│   ├── core/                 # client rendering engine
│   │   ├── schema/           # dashboard-spec.schema.json
│   │   ├── registry/         # runtime widget registry + 10 widgets
│   │   ├── layouts/          # layout template library (JSON, versioned)
│   │   ├── engine/           # interpreter, composer, patcher, params
│   │   └── theme/            # CSS-variable tokens (shadcn-compatible)
│   ├── server/               # agent service + query service
│   │   ├── agent/            # plan / bind / copy routes, prompts, SSE
│   │   ├── query/            # guardrails, cache, rate limit, self-heal
│   │   └── adapters/         # postgres.ts, duckdb.ts
│   └── alpona-db/             # migration/seed/marts/dictionary CLI
└── examples/
    └── supply-chain/
        ├── db/               # migrations, seeds, marts, dictionary
        ├── app/              # Vite app wiring core ↔ server
        └── docker-compose.yml
```

## Quickstart

The fast path needs **no Docker and no API key** — the example runs on an
in-process DuckDB file, and without a key the server uses a deterministic
mock agent grounded in the same data dictionary the real one reads:

```bash
git clone https://github.com/<you>/alpona && cd alpona
pnpm install

# 1. Build the example database (DuckDB, zero infrastructure)
pnpm alpona-db migrate && pnpm alpona-db seed && pnpm alpona-db marts
pnpm alpona-db dictionary

# 2. Run
pnpm dev                      # server :3001, app :5173
```

For the full experience, add the real agent and/or Postgres:

```bash
cp .env.example .env          # add ANTHROPIC_API_KEY or OPENAI_API_KEY for live generation

# or run fully local against LM Studio (any OpenAI-compatible server works —
# load the model with ≥16k context; the grounded prompts are ~4k tokens):
#   OPENAI_BASE_URL=http://localhost:1234/v1
#   ALPONA_PLANNER_MODEL=google/gemma-4-e4b   # + BINDER / COPY, same model

# optional: Postgres instead of DuckDB
docker compose -f examples/supply-chain/docker-compose.yml up -d
export ALPONA_DB_ADMIN=postgres://alpona:alpona@localhost:5433/alpona
pnpm alpona-db migrate && pnpm alpona-db seed && pnpm alpona-db marts && pnpm alpona-db dictionary
# then point the server at the read-only role:
#   ALPONA_DB=postgres://alpona_reader:alpona_reader@localhost:5433/alpona
```

Open the app and try:

> _"Supplier scorecard for this quarter — lead time trends, PO value by supplier, and flag anyone averaging more than 3 days late."_

Then click any widget and refine it: _"top 5 only"_, _"make this weekly"_, _"add a target line at 95%"_. Refinements arrive as RFC 6902 JSON Patches — widgets slide to their new positions; nothing regenerates that didn't change.

## The DashboardSpec at a glance

```jsonc
{
  "title": "Warehouse Ops Monitor",
  "layout": "ops-monitor@2", // pinned template version
  "params": { "from": "2026-05-01", "warehouse": "ALL" },
  "widgets": [
    {
      "slot": "hero",
      "type": "line_chart",
      "binding": {
        "sql": "SELECT date_trunc('week', dispatched) AS wk, carrier, AVG(delay_days) AS avg_delay FROM shipment_performance WHERE dispatched >= {{params.from}} GROUP BY 1, 2 ORDER BY 1",
        "resultShape": { "x": "wk", "y": "avg_delay", "series": "carrier" },
      },
      "copy": { "title": "Carrier delay trend", "caption": null },
    },
  ],
}
```

No data. No environment specifics. Re-run it anywhere the dictionary matches.

## Security model

Agent-generated SQL crosses a trust boundary, so it is treated as hostile input:

1. **AST gate** — parsed with a real SQL parser; single statement, `SELECT`-only, tables restricted to the dictionary allowlist
2. **Resource limits** — enforced `LIMIT`, statement timeout, per-session rate limiting
3. **Parameterized binding** — `{{params.*}}` resolve as bound parameters, never string interpolation
4. **Read-only role** — `alpona_reader` cannot write, even if layers 1–3 fail
5. **Aggregates only** — raw rows never leave the server unless a widget contract requires them

## Roadmap

- [x] Layout library v1 (12 templates) and widget registry v1 (10 widgets)
- [x] Adapters: PostgreSQL and in-process DuckDB (the zero-Docker path)
- [x] Deterministic mock agent — demo and CI run without an API key
- [ ] Spec gallery: save, fork, and share parameterized dashboards
- [ ] Generative refinement UX: voice-style scoped edits, layout switching as a one-line patch
- [ ] Additional adapters: MySQL, SQLite, server-side DuckDB
- [ ] Retrieval over the layout library (BM25) once it outgrows the context window
- [ ] Second example implementation to prove the core/domain boundary
- [ ] shadcn registry distribution for Alpona widgets (`npx shadcn add @alpona/...`)
- [ ] Alternate render targets: static PNG reports, e-ink layouts — one spec, many engines

## Contributing

The most valuable contributions right now are **layout templates** (a JSON file + a `whenToUse` description — no code required) and **adapters**. See `CONTRIBUTING.md`.

---

_Alpona is an exploration of where generative UI is heading: models that generate **decisions**, engines that render them, and specs that outlive the conversation that created them._
