---
title: Intent classification & ask mode
description: One box. Questions get answers; descriptions get dashboards.
sidebar: { order: 2 }
---

There is one prompt box and no toggle. An LLM **classify** node routes each
input: a question ("which carrier is slowest?") goes to **ask**; a description
("ops view for the warehouse team") goes to **build**.

**Ask** reuses the binder and the same query guardrails — it writes one SQL
query that contains the answer, runs it through the read-only path, and inverts
the copy pass into a one-sentence answer plus the headline value. Every answer
shows its exact SQL, and offers **Pin as widget**: the answer is placed onto the
current dashboard by pure-code slot assignment and arrives as a JSON Patch.

A question asked while a dashboard is open is still answered — the dashboard is
left untouched. A scoped widget click is always a refine.
