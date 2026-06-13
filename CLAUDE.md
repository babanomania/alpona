# CLAUDE.md — Alpona

Instructions for AI coding sessions in this repository. For the current
roadmap, decisions, and copy decks, read `PLAN.md` first.

## What this project is

Alpona (আলপনা) is a **schema-driven generative UI engine for dashboards**.
An LLM decides *what* to show and *how to fetch it*; a deterministic engine
decides *how it renders*. The model's output is a portable, versioned,
data-free `DashboardSpec` — never code. One prompt box serves two intents:
**build** (a dashboard) and **ask** (a direct answer with its SQL shown).

## Core principles — do not violate

1. **The agent proposes; the engine disposes.** Layout composition, slot
   contracts, and grid math are pure code. Inference never does what
   constraint satisfaction can.
2. **Security is never delegated to a model.** Agent SQL is hostile input:
   AST gate (single statement, SELECT-only, table allowlist) → enforced
   LIMIT + timeouts + rate limits → parameterized binding (no string
   interpolation, ever) → read-only DB role (`alpona_reader`) →
   aggregates-only leave the server.
3. **Playground mode must always work**: DuckDB in-process + deterministic
   mock agent, zero Docker, zero API key. CI and the demo-video pipeline run
   on it. Any change that breaks the no-key path is a regression.
4. **Generated, never hand-drifted.** The data dictionary is generated from
   the migrated schema (`alpona dictionary`); website Reference pages are
   generated from the layout JSON, widget registry, and spec schema at build
   time. Don't hand-edit generated artifacts.
5. **One-way dependency arrow.** `packages/core` and `packages/server` never
   import from a dataset pack or the studio. Domain knowledge lives only in
   each dataset's data dictionary.
6. **Data import lives in the CLI only** (`alpona init`, `alpona connect`).
   The studio reads `GET /sources`; it never shows a connect wizard and the
   browser never sees a connection string.
7. **Audience split**: `packages/studio` speaks to end users (no
   architecture jargon — no "AST gate", no "pipeline" in UI copy);
   `/website` speaks to architects and PMs.

## Repository layout (target)

```
packages/
  core/      # rendering engine: schema, registry, layouts, engine, theme
  agent/     # LangGraph JS pipeline: classify / plan / bind / copy / answer
             #   + retrieval (BM25 over dictionary, see PLAN.md D9)
             #   + mock/ (deterministic agent, same public API)
  server/    # HTTP: agent routes, query service, guardrails, auth
             #   middleware (none | apikey | oidc), sources registry,
             #   specs endpoints, adapters (postgres, duckdb)
  studio/    # the user-facing app (Vite + React)
  alpona-cli/# migrate / seed / marts / dictionary / verify / init / connect
datasets/    # dataset packs: db/ (migrations, seeds, marts, dictionary),
             # prompts, starter report specs
website/     # Astro + Starlight → GitHub Pages
videos/      # Playwright demo specs, VHS tapes, VO scripts, assembly
design/mockups/  # reference HTML mockups (see PLAN.md §5)
```

## Stack & conventions

- **TypeScript everywhere.** pnpm workspaces, vitest, prettier, eslint.
  Do not introduce Java (Flyway) or Python (dbt, LiteLLM) toolchain
  dependencies — `alpona-cli` is the TS-native equivalent by design; LiteLLM
  is supported by documentation via `OPENAI_BASE_URL`, not bundled.
- **Agent framework:** LangGraph JS, hidden behind `packages/agent`'s
  framework-agnostic exports. Don't leak LangGraph types into the server.
- **Model access:** OpenAI-compatible client. Anthropic / OpenAI / LiteLLM /
  LM Studio are all just base-URL + model-name config. Keep grounded prompts
  small enough for a 16k-context local model (Gemma 12B QAT is a supported
  target).
- **Auth:** verify JWT/JWKS in middleware; Supabase Auth, Keycloak, Zitadel,
  better-auth are all just OIDC issuers. `AUTH_MODE=none` is the playground
  default.
- **Supabase** is a supported deployment (auth + Postgres + `specs` table
  with RLS), never a core dependency.
- **Specs:** refinements are RFC 6902 JSON Patches; saved specs carry a
  `dictionary_id` (name + schema hash) for gallery filtering and drift
  warnings.
- **UI:** shadcn/ui-based widget registry; CSS-variable theme tokens.
  Visual language: night-floor dark, ivory `#f2e4c9`, marigold `#e8a44a`,
  terracotta `#c96a4a`, plum `#8a2f4f`; Fraunces / Outfit / IBM Plex Mono.

## Testing expectations

- Mock agent runs the full pipeline in CI without a key — keep it passing.
- `packages/agent/retrieval` must have explicit tests for: under-budget
  full-dictionary passthrough, alias-based recall, and the
  relation-not-found → full-dictionary self-heal fallback.
- Guardrail tests (AST gate, parameter binding) are security tests: never
  weaken to make a feature pass.
- `alpona verify` (checksums + drift) must stay green; editing an applied
  migration is a CI failure by design.

## Writing UI copy

Studio copy is user-voiced: plain verbs, sentence case, no system jargon,
benefits over mechanisms (see PLAN.md §4.1 for the approved deck). Website
copy is PM-first with architecture fenced into one labeled section
(PLAN.md §4.2). When in doubt, reuse the approved decks verbatim.
