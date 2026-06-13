---
title: The DashboardSpec
description: The durable artifact — a spec, not code.
sidebar: { order: 3 }
---

A dashboard is a small JSON document: a title, a pinned layout version, params,
and a list of widgets, each with a SQL binding and a `resultShape` mapping
columns onto visual roles. It contains **queries, never results** — no data,
no secrets.

```json
{
  "title": "Warehouse Ops Monitor",
  "layout": "ops-monitor@2",
  "params": { "from": "2026-05-01" },
  "widgets": [{
    "slot": "hero",
    "type": "line_chart",
    "binding": { "sql": "SELECT … WHERE dispatched >= {{params.from}}" }
  }]
}
```

Because it's a document, it diffs cleanly in a PR, re-parameterizes for any
branch/date/region, promotes dev → prod, and outlives the conversation that
created it. Refinements are RFC 6902 JSON Patches.
