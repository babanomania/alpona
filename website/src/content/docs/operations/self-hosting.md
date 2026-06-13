---
title: Self-hosting
description: Your server, your database, offline-capable.
sidebar: { order: 3 }
---

Alpona is Apache-2.0 and self-hosted by default. The single server container
serves the API and the built studio on one port; saved dashboards live in a
file store (zero infra) or Postgres (Supabase mode). With a local model behind
`OPENAI_BASE_URL`, the whole system runs offline — your data never has to leave
your network.
