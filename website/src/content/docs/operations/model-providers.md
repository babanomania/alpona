---
title: Model providers
description: Anthropic, OpenAI, LiteLLM, or a local model.
sidebar: { order: 1 }
---

The pipeline is provider-agnostic — switching is a `.env` change. Set these in
the **repo-root `.env`** for `pnpm dev`, or in **`deploy/.env`** for Docker.
With no key set, the deterministic mock agent runs (offline, no key).

```bash
# OpenAI (or any OpenAI-compatible base URL)
ALPONA_PROVIDER=openai
OPENAI_API_KEY=sk-…

# Anthropic
ANTHROPIC_API_KEY=sk-ant-…

# Local via LM Studio (no key); load the model with ≥16k context
OPENAI_BASE_URL=http://localhost:1234/v1
ALPONA_PLANNER_MODEL=<model-id>   # + BINDER / COPY
```

Planner and copy run on a fast model; binders run on a strong one. LiteLLM and
OpenRouter are supported the same way — point `OPENAI_BASE_URL` at them.
