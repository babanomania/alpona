# Alpona — Re-architecture Plan

> This document is the source of truth for the next major iteration of Alpona.
> It was produced from an extended design session (June 2026) and is written so
> a fresh Claude Code session can execute any phase without further context.
> Durable conventions live in `CLAUDE.md`; this file holds the roadmap,
> decisions, and copy decks.

---

## 1 · Context

Alpona today: schema-driven generative UI engine for dashboards. LLM pipeline
(Planner → Binders → Composer → Copy) emits a portable `DashboardSpec`; a
deterministic engine renders it. Postgres + DuckDB adapters, AST-gated SQL,
self-heal loop, deterministic mock agent, `alpona-cli` CLI
(Liquibase/dbt-flavored, pure TS), one example app under
`examples/supply-chain`.

This plan: extract the agent, add auth + Supabase deploy mode, promote the app
to a first-class **studio**, add **ask mode** (Q&A on data) with LLM intent
classification, ship a **data catalog**, replace the single example with
**dataset packs**, build a **marketing/docs website** for GitHub Pages, and
produce **regenerable demo videos**.

Audience split (firm decision):
- **Studio (`packages/studio`)** targets *end users* — people who want a
  dashboard or an answer. No architecture language anywhere.
- **Website (`/website`)** targets *architects and product managers* —
  the people deciding whether to adopt.

---

## 2 · Decision log (with rationale)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Agent framework: **LangGraph JS**, not Google ADK TS | Pipeline is a DAG with one retry loop — maps 1:1 to LangGraph's graph/state model; larger TS ecosystem. ADK TS only shipped Dec 2025, leans multi-agent/Google. Agent package exports stay framework-agnostic (`classify/plan/bind/copy/answer`) so the choice is swappable. |
| D2 | LLM proxy: **document LiteLLM, don't bundle it** | Server already speaks OpenAI API via `OPENAI_BASE_URL`; users point it at LiteLLM / OpenRouter / LM Studio with zero code. LiteLLM is a Python gateway — bundling adds a polyglot service for nothing. |
| D3 | **Supabase = deploy mode, not a dependency** | Core stays adapter-agnostic (the second-example/boundary roadmap goal). Supabase supplies auth (OIDC JWT) + hosted Postgres + the `specs` table with RLS. The zero-Docker, zero-key **playground mode (DuckDB + mock agent) must always keep working** — it's the onboarding story and the demo-video substrate. |
| D4 | Auth: **pluggable JWT/JWKS middleware** in `packages/server` | Modes: none (playground) / static API key / OIDC issuer. One verification layer covers Supabase Auth, Keycloak, Zitadel, better-auth. better-auth is the suggested embedded option for non-Supabase users. |
| D5 | **Keep `alpona-cli` (pure TS); do NOT adopt real Flyway/dbt** | Flyway is Java, dbt is Python — heavy toolchain in a pure-TS monorepo. alpona-cli already implements their core ideas (ordered checksummed migrations, idempotent seeds, marts, generated dictionary). Market it as "Flyway/dbt-style". |
| D6 | **All data import lives in the CLI** (`alpona init`, `alpona connect`) | The studio never shows a connect wizard. It reads `GET /sources` and renders a switcher. Connection strings stay server-side. |
| D7 | **Intent classification is an LLM node** in the agent | One prompt box; questions route to **ask**, descriptions route to **build**. No UI toggle. |
| D8 | **Ask mode reuses the pipeline** | classify → retrieve catalog entries → existing Binder (same AST gate, allowlist, self-heal) → Copy pass inverted into a one-sentence answer + value. Every answer shows its SQL (collapsible) and offers **Pin as widget** (Planner assigns a slot; arrives as a JSON Patch). |
| D9 | **BM25 retrieval with safeguards** (the backfire risk is real: BM25 is lexical) | (a) **Conditional** — if the full dictionary fits the token budget, send it all; retrieval only above threshold. (b) **Alias enrichment at dictionary build time** — `alpona dictionary` has an LLM write synonyms into each entry once, offline. (c) **Recall-biased** — generous k, always include all marts. (d) **Fallback** — if a bind fails with relation/column-not-found, self-heal retries with the FULL dictionary. Same BM25 module later serves layout-library retrieval. Matters extra for local models (Gemma 12B QAT). |
| D10 | App promoted to **`packages/studio`**; example becomes a **dataset pack** | `examples/supply-chain` → `datasets/supply-chain` keeping only `db/`. One generic studio shell serves all datasets. 2–3 more dataset packs to follow. |
| D11 | Website: **Astro + Starlight** at `/website`, deployed to gh-pages | Astro = full creative control for the landing; Starlight = docs sidebar/search/dark-mode for free. Reference pages (layouts, widgets, spec schema) are **generated from code at build time** — docs that cannot drift. |
| D12 | Website hero: **the particle morph** (`alpona-website-landing.html`) | Particles draw the alpona, then the same points reassemble into a dashboard wireframe on scroll — the product thesis as physics. The loom mockup is reserved for the architecture docs header; the rice-paste cursor shelved (possible studio loading state). |
| D13 | Landing page below the hero is **PM-first**; architecture appears once, fenced | Section order answers buyer questions: outcomes → how it feels → trust → governance → under-the-hood (labeled "for the architects in the room") → quickstart. |
| D14 | Demo videos are **code, regenerated in CI** | Playwright drives the studio against the **mock agent** (deterministic ⇒ reproducible video). VHS for terminal/CLI video. Per-scene TTS (Kokoro/Piper preferred for offline CI; ElevenLabs optional). ffmpeg assembles cover (HTML→screenshot, ideally 2s of the WebGL alpona drawing) → crossfade → recording → end card. |

---

## 3 · Phases

Each phase leaves the repo green. Order matters: structure → security →
persistence → CLI → studio → website → videos.

### Phase 1 — Agent package (`packages/agent`)
1. Move plan/bind/copy logic + prompts out of `packages/server` into
   `packages/agent`.
2. Public API (framework-agnostic): `classify(input, ctx)`, `plan()`,
   `bind()`, `copy()`, `answer()`. Server imports only this surface.
3. Implement internals as a LangGraph JS graph:
   classify → (build: plan → parallel bind nodes → self-heal edge → copy)
            | (ask: retrieve → bind → answer).
4. Retrieval module (`packages/agent/retrieval`): BM25 over dictionary
   entries with the D9 safeguards. Unit-test the fallback path explicitly.
5. Mock agent reimplemented against the same public API (it must keep
   passing CI with no API key).

### Phase 2 — Auth
6. JWT/JWKS verification middleware on `/plan`, `/bind`, `/copy`, `/query`,
   `/sources`, `/specs/*`.
7. Config modes: `AUTH_MODE=none | apikey | oidc` (+ `OIDC_ISSUER`,
   `OIDC_AUDIENCE`). Playground default: none.

### Phase 3 — Supabase deploy mode
8. `specs` table migration + RLS (owner read/write; optional public-share
   flag). Columns include `dictionary_id` (name + schema hash) for D-Phase-5
   gallery filtering and drift warnings.
9. Server endpoints: save / load / list / fork specs.
10. Docs + `.env` wiring for hosted and self-hosted Supabase; postgres
    adapter points at the Supabase instance (it's just Postgres).

### Phase 4 — CLI
11. `alpona init`: pick dataset → migrate → seed → marts → dictionary
    (with alias enrichment) → generate **12 starter specs** via mock agent
    (one per layout template) → write `.env` → optional Supabase setup
    (auth config + specs table).
12. `alpona connect <db-url>`: introspect user DB → dictionary build →
    register as a source. Sources registry is server config; studio gets
    `GET /sources` (name, dialect, dictionary summary, sample-prompt count).

### Phase 5 — Studio (`packages/studio`)
13. Promote `examples/supply-chain/app` → `packages/studio`;
    `examples/supply-chain` → `datasets/supply-chain` (db/ + sample prompts
    + the saved report specs).
14. Landing page edits (copy deck §4.1): keep H1, WebGL `AlponaHero`,
    `DemoPlayer`, final-CTA line; replace subtitle, the 6 feature cards, the
    stats strip; delete the pipeline-steps section and architecture stats
    (they move to the website). Final CTA button: **"Ask it something →"**.
15. Home behavior: source switcher (from `/sources`; user sources rank above
    samples; samples collapse once a user source exists), mixed ask/build
    suggestion chips (glyph-tagged `?` / `▦`), starter-spec gallery (cards =
    mini layout thumbnails rendered from the spec, no screenshots).
16. **Catalog page** (reached from the source switcher: "Browse this data"):
    one card per mart (featured) and table — semantic description, column
    chips, freshness from dictionary build timestamp, and **"Ask about
    this"** sample prompts that pre-fill the composer. Pure renderer over
    dictionary JSON.
17. **Workspace** (reference: `design/mockups/alpona-workspace-mockup.html`):
    - Keep: full-bleed canvas, bottom composer, click-widget → "refining X"
      scope chip.
    - Add: collapsible **conversation rail** (session log): user prompts,
      **answer cards** (headline value, one-line answer, collapsible
      "ran this query · Ns · N rows", **Pin as widget**, Ask follow-up),
      patch summaries with undo, self-heal notices.
    - Add: **spec inspector** behind a `</>` icon — read-only spec JSON with
      diff-since-save highlighting.
    - Composer hint: *"questions get answers · descriptions get widgets —
      Alpona decides"*.
    - Pin flow: answer → Planner assigns slot → JSON Patch → widget slides
      in (FLIP), note logged in rail.
    - Mobile: rail becomes the primary view, canvas behind.
18. Delete in-app Docs page; Explore merges into Home. Update the
    "no signup" footer hint once auth lands.
19. Build 2–3 more dataset packs (suggestions: SaaS metrics, e-commerce,
    fitness/IoT), each: migrations, seeds, marts, dictionary semantics,
    5–6 sample prompts (mixed ask/build).

### Phase 6 — Website (`/website`, Astro + Starlight → gh-pages)
20. Landing per `design/mockups/alpona-website-landing.html` (D12, D13).
    Three.js scene as a client-only island; morph point-sets in a shared
    module (long-term: studio's AlponaHero and the website draw the same
    procedural pattern from one source).
21. Docs IA:
    - **Getting started**: playground mode · deploy mode (Supabase) · CLI
      reference.
    - **Concepts**: architecture · intent classification & ask mode · the
      DashboardSpec · the four contracts · security model · grounding &
      retrieval (D9). Optional header: the loom mockup.
    - **Datasets**: bundled packs · bring your own data · semantics &
      aliases.
    - **Reference** (build-generated): layout gallery · widget registry ·
      spec JSON Schema.
    - **Extending**: layouts · widgets · adapters · auth providers.
    - **Operations**: model providers (Anthropic / OpenAI / LiteLLM /
      LM Studio) · Supabase setup · self-hosting.
    - **Roadmap** page sourced from README checklist.
22. GitHub Actions: build + deploy on push to main.
23. README strips to: pitch, GIF, quickstart, link to site.

### Phase 7 — Videos (`/videos`, regenerated in CI)
24. `demo.spec.ts` (Playwright, mock agent, DuckDB): type build prompt →
    skeleton → bind → live → ask question → expand SQL → pin → widget-scoped
    refine. Inject fake cursor + click ripples; `recordVideo` 1280×720;
    webm → mp4.
25. `setup.tape` (VHS): clone → `alpona init` → `pnpm dev`, cut to studio
    opening on the 12 starter specs.
26. VO: per-scene clips (Kokoro/Piper default; ElevenLabs optional), scenes
    padded to clip length.
27. Assembly script: cover (HTML rendered by Playwright; ideally 2s of the
    WebGL alpona drawing itself) → xfade → recording → end card (GitHub URL
    + init command); audio leads visual by ~0.5s.
28. CI job on release; outputs land in `website/public/videos/`.
29. Embed: video 1 on the website hero area, video 2 in Getting Started.

---

## 4 · Copy decks

### 4.1 Studio landing (user-voiced)
- Badge: `✦ your data, drawn live`
- **H1 (keep):** "Dashboards drawn from a sentence."
- **Subtitle (replace):** "Ask a question, get an answer. Describe a view,
  get a live dashboard. One box, your data, plain language."
- Prompt-box placeholder cycles: *"How many shipments ran late this week?"*
  ⇄ *"Ops view for the warehouse team…"*
- **Feature cards (6):**
  1. **Ask or describe** — A question gets an answer with the numbers to
     back it. A description gets a full dashboard. Same box.
  2. **Real numbers, always** — Every answer and chart runs live against
     your database — with the query shown, so you can check the work.
  3. **Edit by talking** — "Top 5 only." "Make it weekly." Just that widget
     changes.
  4. **It fixes itself** — Failed charts quietly repair and retry. Never a
     crash.
  5. **Save, share, fork** — Dashboards are yours to keep, link, and
     duplicate.
  6. **Never start blank** — Ready-made dashboards, a browsable data
     catalog, and prompt ideas from your own schema.
- Stats strip (user-relevant, live where possible): N dashboards ready ·
  N prompt ideas from your schema · N widgets · "seconds from sentence to
  screen".
- **Final CTA (keep line, new button):** *"Your data already knows what it
  wants to say."* → **Ask it something →**
- Footer: *"Data sources are managed by the Alpona CLI · Learn more at
  [site]"*.

### 4.2 Website landing (architect/PM-voiced) — section order is the spec
1. Hero: H1 *"Describe it — Alpona draws the pattern."* + morph scene +
   scroll beats ("A fixed vocabulary of motifs. Infinite compositions." /
   "The pattern becomes the dashboard." / "The output is a spec, not
   code.").
2. **Outcomes** — "The dashboard backlog disappears." Cards: Self-serve,
   actually · Minutes, not quarters · One source of truth.
3. **How it feels** — three quoted steps: Describe / Refine / Ask.
4. **Trust** — "Brilliant demo, fragile Tuesday" (code-gen) vs "On-brand by
   construction — it cannot ship a component you didn't bless" (Alpona).
5. **Governance** — read-only by construction · every number auditable ·
   dashboards are documents (PR-reviewed, dev → prod) · yours to keep
   (Apache-2.0, offline-capable). Spec JSON as show-don't-tell.
6. **Under the hood** ("for the architects in the room") — the 5-stage
   pipeline (Classify · Plan · Bind · Compose · Copy) + link to docs.
   Division-of-labor table lives in Concepts docs, not here.
7. **Quickstart** — "No Docker. No API key. Before lunch."

---

## 5 · Design references (commit under `design/mockups/`)
- `alpona-website-landing.html` — chosen website landing (morph hero +
  PM-first sections). **Reference implementation.**
- `alpona-workspace-mockup.html` — studio workspace target (rail, answer
  card, pin, spec inspector).
- `alpona-loom-hero.html` — reserved for Concepts docs header.
- `alpona-ricepaste-hero.html` — shelved; candidate studio loading state.

Visual language (all surfaces): night-floor dark `#130e12–#1d1419`, ivory
rice-paste `#f2e4c9`, marigold `#e8a44a`, terracotta `#c96a4a`, plum
`#8a2f4f`; Fraunces (display) · Outfit (body) · IBM Plex Mono (data/code).

## 6 · Non-goals / guardrails
- No e-ink render target work (explicitly dropped).
- Playground mode (DuckDB + mock agent, zero key) must never break — CI and
  videos depend on it.
- Core never imports from a dataset pack; the dependency arrow points one
  way.
- Security is never delegated to a model: AST gate, limits, parameterized
  binding, read-only role, aggregates-only stay code-owned.
