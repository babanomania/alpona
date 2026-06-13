---
title: CLI reference
description: The alpona CLI — onboarding, data, users, and the database workflow.
sidebar: { order: 3 }
---

Everything that touches a connection string or a credential lives in the CLI;
the studio is a pure reader over what the CLI produced. Run it through pnpm
from the repo root:

```bash
pnpm alpona <command> [options]
pnpm alpona --help
```

There's nothing to install globally. Commands fall into three groups:
**onboarding** (`init`), **data** (`connect`), and **users** (`user …`), plus
the low-level **database workflow** (`migrate`, `seed`, `marts`, `dictionary`,
`verify`) that `init` orchestrates for you.

## How connections and directories resolve

The workflow commands need a database connection and a dataset directory. Each
resolves in order — the first match wins:

| Setting | Resolution order |
| --- | --- |
| Connection | `--db <conn>` → `ALPONA_DB_ADMIN` → `ALPONA_DB` |
| Dataset dir | `--dir <path>` → `ALPONA_DB_DIR` → `datasets/supply-chain/db` |

A connection is either `postgres://user:pass@host:port/db` or
`duckdb:<path>`. `init`, `connect`, and `user` manage their own connections —
see each below.

---

## `init` — the setup wizard

Takes you from clone to running data in one command: create the first user (if
auth is configured), then bring in data — an example pack or your own database.

```bash
pnpm alpona init                       # interactive
pnpm alpona init --dataset ecommerce   # non-interactive: pick a pack
pnpm alpona init --connect postgres://reader@host/db --name warehouse
```

It runs migrate → seed → marts → dictionary, optionally enriches the dictionary
with aliases (when a model is configured), generates a **starter-dashboard
gallery** covering every layout and widget, and writes a repo-root `.env`.

**Options**

| Flag | Meaning |
| --- | --- |
| `--dataset <name>` | Example pack: `supply-chain` (default), `ecommerce`, `saas-metrics`. |
| `--connect <db-url>` | Bring your own database instead of a pack (mutually exclusive with `--dataset`). |
| `--name <name>` | Source name when using `--connect`. |
| `--db <conn>` | Override the database the pack is built into (default: an in-repo DuckDB file). |
| `--user <email>` | Initial user's email (skips the prompt). |
| `--password <pw>` | Initial user's password (skips the hidden prompt; min 6 chars). |

**Environment it reads**

- **Auth step** is offered only when auth is configured —
  `ALPONA_AUTH_URL` (or `GOTRUE_URL` / `ALPONA_AUTH_UPSTREAM`) **and**
  `ALPONA_JWT_SECRET` (or `GOTRUE_JWT_SECRET`).
- **Alias enrichment** uses `OPENAI_API_KEY` or `OPENAI_BASE_URL` (and
  `ALPONA_PLANNER_MODEL` if set); skipped when neither is present.

:::tip
Everything is scriptable for CI and Docker: `--user/--password`, `--dataset`,
and `--connect` skip every prompt.
:::

---

## `connect` — bring your own database

```bash
pnpm alpona connect <db-url> [--name <name>]
```

Introspects the database, builds a dictionary, generates the starter gallery
**against your schema**, and registers it as a source. The connection string
and dictionary stay server-side; the studio only ever sees
`{ name, dialect, table count }`.

| Flag | Meaning |
| --- | --- |
| `--name <name>` | Display name for the source (default: inferred from the URL). |

It prints the exact `pnpm dev` invocation (with `ALPONA_DB`,
`ALPONA_DICTIONARY`, `ALPONA_SEED_REPORTS`, `ALPONA_SOURCE_NAME`) to explore the
connected source.

---

## `user` — provision Supabase (GoTrue) users

Accounts are admin-provisioned — there is no public signup.

```bash
pnpm alpona user add <email> [--password <pw>]
pnpm alpona user list
pnpm alpona user remove <email>
```

`user add` prompts for the password (hidden) when `--password` is omitted.

**Environment it requires**

| Variable | Meaning |
| --- | --- |
| `ALPONA_AUTH_URL` | GoTrue base URL — e.g. `http://localhost:3001/auth/v1` (proxied) or the internal `ALPONA_AUTH_UPSTREAM`. |
| `ALPONA_JWT_SECRET` | The shared secret, used to mint a short-lived `service_role` token for the admin API. |

```bash
ALPONA_AUTH_URL=http://localhost:3001/auth/v1 ALPONA_JWT_SECRET="$ALPONA_JWT_SECRET" \
  pnpm alpona user add you@example.com
```

---

## Database workflow

`init` runs these in sequence; reach for them directly when you add a migration
or change a mart. All accept `--dir` and `--db` (see resolution above).

| Command | What it does |
| --- | --- |
| `migrate` | Apply pending migrations, tracked in `alpona_changelog` (ordered, immutable, checksummed). |
| `seed` | Load `seeds/*.csv` and `seeds/seed.sql` — idempotent. |
| `marts` | (Re)create the analytical views from `marts/*.sql`. |
| `dictionary` | Regenerate the data dictionary from the live schema (merging `semantics.json`). |
| `verify` | Checksums + drift detection. CI fails if an applied migration was edited. |

```bash
pnpm alpona migrate --dir datasets/ecommerce/db --db "$ALPONA_DB_ADMIN"
pnpm alpona verify
```

:::caution
Applied migrations are immutable. Editing one is a CI failure by design — add a
new migration instead.
:::

---

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `ALPONA_DB` | workflow | Runtime connection (`duckdb:` or `postgres://`). |
| `ALPONA_DB_ADMIN` | workflow | Admin (owner) connection for migrations/seeds. |
| `ALPONA_DB_DIR` | workflow | Default dataset directory. |
| `ALPONA_AUTH_URL` | `init`, `user` | GoTrue base URL the CLI calls. |
| `ALPONA_AUTH_UPSTREAM` | `init`, `user` | Internal GoTrue URL (fallback, e.g. in-container). |
| `ALPONA_JWT_SECRET` | `init`, `user` | Shared HS256 secret (also `GOTRUE_JWT_SECRET`). |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | `init` | Enables offline alias enrichment of the dictionary. |
| `ALPONA_PLANNER_MODEL` | `init` | Model used for alias enrichment (defaults per provider). |
