---
title: Supabase setup
description: Supabase is a deploy mode, never a core dependency.
sidebar: { order: 2 }
---

Supabase is just Postgres plus GoTrue auth. Point `ALPONA_SPECS_DB` at the
instance and apply the checked-in `specs` migration (table + RLS: owner
read/write, a public-share flag, and a `dictionary_id` for gallery filtering and
drift warnings). The bundled `docker-compose.auth.yml` overlay runs the whole
thing locally — see [deploy mode](/getting-started/deploy-supabase) for the
step-by-step.

:::caution
GoTrue and the Alpona server share one `ALPONA_JWT_SECRET`. The compose default
is a throwaway dev value — **set a real one** (`openssl rand -hex 32`) in
`deploy/.env` before exposing the stack to anyone.
:::

The zero-key playground (DuckDB + mock agent) always keeps working — it's the
onboarding and demo substrate.
