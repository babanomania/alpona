---
title: Semantics & aliases
description: Teaching the dictionary your domain's words.
sidebar: { order: 3 }
---

The dictionary is generated from the live schema, but two human-authored inputs
sharpen it:

- **`semantics.json`** — one-line descriptions per table and column, merged into
  the dictionary at build time. This is the agent's domain knowledge.
- **Aliases** — synonyms a business user might say ("deliveries" for
  `shipment_performance`). `alpona init` can write these once via an offline LLM
  pass; they become first-class retrieval match terms.

Both are pure data — no code, no domain logic in the engine.
