---
title: Playground mode
description: Run the full Alpona experience with no Docker and no API key.
sidebar: { order: 1 }
---

Alpona's playground is the onboarding story and the demo substrate: **DuckDB
in-process** and a **deterministic mock agent**, so the whole experience runs
offline with zero infrastructure and zero credentials.

```bash
git clone https://github.com/babanomania/alpona && cd alpona
pnpm install
pnpm alpona init   # migrate + seed + marts + dictionary + a starter gallery
pnpm dev           # studio on :5173, server on :3001
```

The CLI runs through pnpm (`pnpm alpona <command>`); there's nothing to install
globally.

`pnpm alpona init` is a small wizard — pick an example dataset (`supply-chain`,
`ecommerce`, or `saas-metrics`) or connect your own database. It builds the
database, generates a **starter-dashboard gallery** covering every layout and
widget, and writes a `.env` at the repo root.

## Use the live agent

Without a key, the **mock agent** serves the full flow — build, refine, ask —
so nothing about the experience requires one. To switch to a real model, add a
key to the repo-root `.env` (the one `init` wrote) and restart `pnpm dev`:

```bash
# .env
OPENAI_API_KEY=sk-…
# or: ANTHROPIC_API_KEY=sk-ant-…
# or a local model:  OPENAI_BASE_URL=http://localhost:1234/v1
```

The provider is inferred from whichever key is present; set
`ALPONA_PROVIDER=openai|anthropic` to pin it when both are. The startup banner
shows which agent is active (`MOCK agent` vs `live agent (openai · …)`).
