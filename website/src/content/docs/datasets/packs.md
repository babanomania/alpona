---
title: Bundled dataset packs
description: Three ready-to-explore example datasets.
sidebar: { order: 1 }
---

Three packs ship today. Each is migrations + deterministic seed generators +
analytical marts + dictionary semantics + curated prompts — pure SQL, working
on both Postgres and DuckDB.

- **`supply-chain`** — suppliers, warehouses, shipments, inventory. Marts for
  shipment performance, stock risk, and warehouse utilization.
- **`ecommerce`** — customers, products, orders, line items. Marts for weekly
  revenue by channel, product performance and margin, and customer segments.
- **`saas-metrics`** — accounts, subscriptions, usage events. Marts for MRR by
  plan, churn risk by industry, and feature adoption by region.

```bash
pnpm alpona init --dataset ecommerce
```

Each pack ships a **starter-dashboard gallery** that exercises every layout and
every widget against its data, plus curated ask/build prompts.
