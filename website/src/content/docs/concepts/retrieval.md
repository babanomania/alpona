---
title: Grounding & retrieval
description: Keeping the model grounded without backfiring.
sidebar: { order: 6 }
---

The agent is grounded entirely in the data dictionary. For large schemas that
exceed a local model's context budget, a BM25 retrieval step narrows the
grounding — with safeguards, because lexical retrieval can backfire:

- **Conditional** — when the full dictionary fits the budget, it is sent whole;
  retrieval only activates above the threshold.
- **Alias-aware** — synonyms written into the dictionary once at build time
  (`alpona dictionary`, via an offline LLM pass) are first-class match terms.
- **Recall-biased** — generous `k`, and every mart is always included.
- **Self-heal fallback** — if a bind fails with relation/column-not-found, the
  retry runs with the **full** dictionary restored.

Retrieval can narrow a prompt; it can never narrow a capability.
