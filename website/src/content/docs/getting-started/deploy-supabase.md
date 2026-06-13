---
title: Deploy mode (Docker + Supabase)
description: Run Alpona, a Supabase Postgres, and (optionally) auth in one command.
sidebar: { order: 2 }
---

One command brings up a Supabase Postgres and the Alpona server, which serves
both the API and the built studio on a single port.

```bash
cd deploy
cp .env.example .env       # configure once (see below)
docker compose up          # → studio + API on http://localhost:3001
```

:::note
Run these from the **`deploy/`** directory — that's where the compose files
and `.env` live. `docker compose up` (the base file) is the playground;
**auth needs both files** (see below).
:::

With an empty `.env`, the stack boots the full playground: Supabase Postgres +
a deterministic **mock agent** + the studio, no key required.

## Use the live agent

The default is the offline mock agent — that's why a fresh `docker compose up`
reports `mock` mode. To use a real model, set a key in `deploy/.env`:

```bash
# deploy/.env
OPENAI_API_KEY=sk-…
# or: ANTHROPIC_API_KEY=sk-ant-…
# or a local model:  OPENAI_BASE_URL=http://host.docker.internal:1234/v1
```

The provider is inferred from whichever key is set; pin it with
`ALPONA_PROVIDER=openai|anthropic` if you set both. Restart with
`docker compose up -d` to pick up the change.

## Pick a dataset

```bash
# deploy/.env
ALPONA_DATASET=ecommerce          # supply-chain (default) | ecommerce | saas-metrics
```

## Turn on real Supabase Auth

Auth adds a login screen and per-user dashboards. It needs the **auth overlay
file** in addition to the base, and a **shared JWT secret** — do not ship the
built-in dev default.

```bash
# deploy/.env — generate a strong secret:  openssl rand -hex 32
ALPONA_JWT_SECRET=<your-long-random-secret>
```

```bash
# both compose files — this is what actually enables auth:
docker compose -f docker-compose.yml -f docker-compose.auth.yml up
```

There is no public signup — users are admin-provisioned from the CLI:

```bash
ALPONA_AUTH_URL=http://localhost:3001/auth/v1 ALPONA_JWT_SECRET="$ALPONA_JWT_SECRET" \
  pnpm alpona user add you@example.com
```

GoTrue (Supabase Auth) runs internally; the Alpona server reverse-proxies
`/auth/v1/*` to it, so the studio stays single-origin on one port.

## Quick reference

| Goal | Command (from `deploy/`) |
| --- | --- |
| Playground (no login) | `docker compose up` |
| With Supabase Auth | `docker compose -f docker-compose.yml -f docker-compose.auth.yml up` |
| Stop | `docker compose down` |
| Reset all data | `docker compose down -v` |
