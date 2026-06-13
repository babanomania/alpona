# Alpona

**Generative UI for dashboards. Describe it — Alpona draws the pattern.**

> **আলপনা** _(al-po-na)_ — the Bengali art of drawing intricate patterns freehand, composed from a learned vocabulary of motifs. No two alponas are identical; none break the tradition's rules. That is exactly what this engine does with dashboards.

Alpona is a **schema-driven generative UI engine**: an LLM decides _what to show_ and _how to fetch it_; a deterministic rendering engine decides _how it renders_. Type a plain-language description and watch a live, data-bound dashboard assemble itself — layout chosen, widgets selected, labels written, and every chart powered by agent-generated SQL that is validated, sandboxed, and self-healing.

No code is generated. No template is hardcoded. The interface itself is the model's output — a portable **DashboardSpec** your design system can trust.

> 📖 **[Full documentation →](https://babanomania.github.io/alpona)** — architecture, the security model, the CLI, dataset packs, and a build-generated layout & widget reference.

## What it does

```
"Ops view for the warehouse team: delayed shipments by carrier,
 SKUs below reorder point, and utilization across warehouses."
```

⬇️ &nbsp;within seconds — a fully laid-out dashboard, each widget bound to a real SQL query, streaming on as it's planned.

One prompt box, two intents: **ask** a question and get an answer with its SQL shown; **describe** a view and get a live dashboard. Refine by talking ("top 5 only", "make it weekly") — only that widget changes. Pin an answer and it slides onto the board.

The output is a **DashboardSpec** — a portable, versioned, data-free JSON artifact. It re-runs against dev or prod, re-parameterizes for any branch/date/region, diffs cleanly in a PR, and never contains a single data value.

## Quickstart

No Docker, no API key — DuckDB in-process and a deterministic mock agent:

```bash
git clone https://github.com/babanomania/alpona && cd alpona
pnpm install
pnpm alpona init   # example database + a starter-dashboard gallery (a wizard)
pnpm dev           # studio on :5173
```

`alpona init` lets you pick a dataset pack (`supply-chain`, `ecommerce`, `saas-metrics`) or connect your own database. Add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to `.env` for the live agent; a local model works too via `OPENAI_BASE_URL`.

Run the whole thing — Supabase Postgres + Alpona + studio — in Docker:

```bash
cd deploy
cp .env.example .env             # optional: set OPENAI_API_KEY for the live agent
docker compose up                # http://localhost:3001 (playground, no login)
```

An empty `.env` boots the playground (mock agent, no login). To turn on real Supabase Auth — a login screen and per-user dashboards — set `ALPONA_JWT_SECRET` in `deploy/.env` and run **both** compose files:

```bash
docker compose -f docker-compose.yml -f docker-compose.auth.yml up
```

Users are admin-provisioned (no public signup) with `alpona user add`. Bring your own data any time with `alpona connect <db-url>`. Full setup — keys, secrets, datasets — is in the [deploy docs](https://babanomania.github.io/alpona/getting-started/deploy-supabase).

## How it works

Alpona splits the work by what each part is good at — and the agent can only fail in ways the system catches:

- **The agent proposes, the engine disposes.** A five-stage pipeline (classify → plan → bind → compose → copy) emits structured decisions against a fixed vocabulary; pure code composes them.
- **Security is never delegated to a model.** Agent SQL passes an AST gate (single statement, `SELECT`-only, table allowlist), enforced limits and timeouts, parameterized binding, and a read-only database role.
- **It fixes itself.** A failed query is retried with the database's own error as feedback; a broken widget becomes an honest empty state, never a crash.
- **The output is a document.** A `DashboardSpec` is reviewed in a PR, versioned, and promoted dev → prod.

The full architecture, security model, the four contracts, and a build-generated layout/widget reference live in the **[documentation](https://babanomania.github.io/alpona)**.

## Repository

```
packages/
  core/        rendering engine: schema, registry, layouts, interpreter, theme
  agent/       classify / plan / bind / copy / answer (+ BM25 retrieval)
  server/      HTTP routes, query service, guardrails, auth, adapters
  studio/      the user-facing app (Vite + React)
  alpona-cli/  init / connect / users / migrate / seed / marts / dictionary
datasets/      dataset packs (supply-chain, ecommerce, saas-metrics)
website/       Astro + Starlight docs → GitHub Pages
deploy/        docker-compose: Supabase Postgres + Alpona (+ auth overlay)
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable are **layout templates** (a single JSON file, no code) and **database adapters**.

## License

Apache-2.0.
