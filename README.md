# Alpona

**Generative UI for dashboards. Describe it — Alpona draws the pattern.**

> **আলপনা** _(al-po-na)_ — the Bengali art of drawing intricate patterns freehand, composed from a learned vocabulary of motifs. No two alponas are identical; none break the tradition's rules. That is exactly what this engine does with dashboards.

Alpona is a **schema-driven generative UI engine**: an LLM decides _what to show_ and _how to fetch it_; a deterministic rendering engine decides _how it renders_. Type a plain-language description and watch a live, data-bound dashboard assemble itself — layout chosen, widgets selected, labels written, and every chart powered by agent-generated SQL that is validated, sandboxed, and self-healing.

No code is generated. No template is hardcoded. The interface itself is the model's output — a portable **DashboardSpec** your design system can trust.

> 📖 **[Full documentation →](https://babanomania.github.io/alpona)** — architecture, the security model, the CLI, dataset packs, and a build-generated layout & widget reference.

## What it does

Describe a dashboard in plain English. Alpona plans the layout, wires up SQL queries, and within seconds you have a live, interactive view. Refine by talking ("top 5 only", "make it weekly") — only that widget changes. Ask it a question and get an instant answer with the SQL shown.

The result is a **DashboardSpec** — clean, versioned JSON with zero hardcoded data. Ship it across dev and prod, diff it in PRs like normal code.

## Get started

No Docker, no API key — DuckDB in-process and a deterministic mock agent:

```bash
git clone https://github.com/babanomania/alpona && cd alpona
pnpm install
pnpm alpona init   # pick a dataset pack (supply-chain, ecommerce, saas-metrics)
pnpm dev           # http://localhost:5173
```

Then try this:

> _"Supplier scorecard for this quarter — lead time trends, PO value by supplier, and flag anyone averaging more than 3 days late."_

Within seconds, a dashboard appears. Click any widget and refine it: _"top 5 only"_, _"make this weekly"_, _"add a target line at 95%"_. Refinements arrive as JSON patches — only what changed re-renders.

Try asking the dashboard: _"Show me the fastest supplier this quarter."_ The answer appears as a widget you can pin to the board.

### Options

Add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to `.env` to swap the mock agent for the live one. Or use `OPENAI_BASE_URL` for a local model.

For Docker + Supabase Postgres + authentication:

```bash
cd deploy
cp .env.example .env
docker compose up  # http://localhost:3001 (no login by default)
```

To enable login and per-user dashboards, set `ALPONA_JWT_SECRET` and run both compose files. Full setup is in the [deploy docs](https://babanomania.github.io/alpona/getting-started/deploy-supabase). Bring your own database any time with `alpona connect <db-url>`.

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
