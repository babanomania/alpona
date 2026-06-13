---
title: The four contracts
description: Where each kind of knowledge lives.
sidebar: { order: 4 }
---

Alpona is held together by four explicit contracts:

| Contract | Authored by | Consumed by |
| --- | --- | --- |
| `DashboardSpec` (JSON Schema) | core | agent output gate, interpreter |
| Layout slot contracts | designers | planner prompt, composer |
| Widget registry entries (zod props, `resultShape`, sizing, agent hints) | design system | binder prompt, composer, validator |
| Data dictionary (DDL + semantics + cardinality) | each implementation | planner + binder grounding, table allowlist |

The data dictionary is the **only** place domain knowledge lives — and it's
generated from the migrated schema, never hand-drifted. The core engine never
imports from a dataset; the dependency arrow points one way.
