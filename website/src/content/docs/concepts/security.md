---
title: Security model
description: Security is never delegated to a model.
sidebar: { order: 5 }
---

Agent-written SQL is treated as hostile input. Five independent layers sit
between the model and your data, every one of them pure code:

1. **AST gate** — single statement, `SELECT`-only, against a table allowlist
   derived from the dictionary.
2. **Enforced LIMIT, statement timeouts, and rate limits.**
3. **Parameterized binding** — values bind positionally; SQL is never built by
   string interpolation.
4. **Read-only database role** (`alpona_reader`) that cannot write.
5. **Aggregates leave the server** — the rendering engine only ever receives
   query results, never raw rows it didn't ask for.

Every chart and every answer carries the exact query that produced it, so
"where did this number come from?" always has an answer.
