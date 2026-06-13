---
title: Adding a database adapter
description: A small, dialect-aware interface.
sidebar: { order: 3 }
---

Adapters live in `packages/server/src/adapters/` and implement a small
interface (`execute`, `dialect`, `close`). Add the matching admin-side support
in the CLI's `db.ts` so migrations and the dictionary builder work too. The
rules every adapter follows: bind values positionally (never interpolate),
enforce the statement timeout, and connect with the least-privileged role.
