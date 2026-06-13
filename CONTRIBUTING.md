# Contributing to Alpona

Thanks for your interest! The two most valuable contributions right now are
**layout templates** (no code required) and **database adapters**.

## Getting set up

```bash
pnpm install
pnpm alpona migrate && pnpm alpona seed && pnpm alpona marts && pnpm alpona dictionary
pnpm dev          # server :3001 (mock agent without a key) + app :5173
pnpm test         # vitest across all packages
pnpm typecheck && pnpm lint && pnpm format:check
```

No Docker and no API key are required for development: the example runs on an
in-process DuckDB file, and without `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
the server uses a deterministic mock agent grounded in the same data
dictionary the real one reads. (`OPENAI_BASE_URL` also works for local
OpenAI-compatible servers like LM Studio — no key needed.)

## Contributing a layout template

A layout is a single JSON file in `packages/core/src/layouts/templates/` —
designers can contribute without writing code.

1. Copy an existing template (e.g. `two-tier.json`).
2. Give it a unique `name` and start `version` at 1. Versions are immutable:
   once published, behavior changes mean a new version, because specs pin
   `name@version` forever.
3. Write `whenToUse` for the planner — one sentence describing the _question
   shape_ this layout answers, not its geometry.
4. Define slots on the 12-column grid. Each slot's contract (`accepts`,
   `minWidgets`/`maxWidgets`, `packing`, `overflow`, `region`) is enforced by
   the composer — the agent can propose, never violate.
5. Register it in `packages/core/src/layouts/index.ts`.
6. `pnpm vitest run --project core` — the layout test suite validates slot
   contracts, overlap-freedom, and registry consistency automatically.

## Contributing an adapter

Adapters live in `packages/server/src/adapters/` and implement the small
`DbAdapter` interface (`execute`, `dialect`, `close`). Add the matching
admin-side support in `packages/alpona-cli/src/db.ts` so migrations and the
dictionary builder work too. Mind the rules the existing adapters follow:

- values bind positionally — never interpolate into SQL
- enforce the statement timeout
- connect with the least-privileged role available

## Contributing a widget

A widget is a registry entry (`packages/core/src/registry/definitions.ts`)
plus a render component (`packages/core/src/react/widgets/`). The entry's
`resultShape` contract and `agentHints` are what the binder reads — write
them as carefully as the component.

## House rules

- The core engine never imports from an example — the dependency arrow
  points one way. Domain knowledge lives only in data dictionaries.
- Agent-generated SQL is hostile input. Anything that loosens the
  guardrails needs a very good story.
- Applied migrations are immutable; CI runs `alpona verify`.
- All four gates must pass: `pnpm test`, `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`.
