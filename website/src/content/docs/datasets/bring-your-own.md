---
title: Bring your own data
description: Point Alpona at your own database.
sidebar: { order: 2 }
---

`alpona connect` introspects your database, builds a dictionary, and generates
the same starter gallery **against your schema** — so you immediately see every
layout and widget rendered on your own tables.

```bash
alpona connect postgres://reader@your-host/yourdb --name warehouse
```

The connection string and dictionary stay server-side; the studio only ever
sees `{ name, dialect, table count }`. Data import lives entirely in the CLI —
the browser never sees a connection string.
