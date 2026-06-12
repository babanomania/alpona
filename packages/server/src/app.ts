import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { DashboardSpec, DataDictionary, GenerateRequest, QueryRequest } from '@alpona/core';
import { interpret, layoutTemplates, widgetDefinitions } from '@alpona/core';
import type { Pipeline } from './agent/pipeline.js';
import type { QueryService } from './query/service.js';
import type { DashboardStore } from './store/dashboards.js';
import { suggestPrompts } from './suggest/suggestions.js';
import { SqlRejectedError } from './query/guardrails.js';
import { RateLimiter } from './query/rate-limit.js';

export interface AppDeps {
  pipeline: Pipeline;
  queryService: QueryService;
  dictionary: DataDictionary;
  mock: boolean;
  store?: DashboardStore;
}

/**
 * The HTTP surface. /api/generate streams the four-stage pipeline over
 * SSE (refinements included — send the current spec); /api/query is the
 * guarded query service the rendering engine hydrates widgets through.
 */
export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();
  const limiter = new RateLimiter();

  app.use('*', cors());

  app.get('/api/health', (c) =>
    c.json({ ok: true, mock: deps.mock, tables: deps.dictionary.tables.length }),
  );

  // Capabilities endpoint: lets clients introspect the contract versions.
  app.get('/api/meta', (c) =>
    c.json({
      mock: deps.mock,
      layouts: layoutTemplates.map((t) => ({
        name: t.name,
        version: t.version,
        whenToUse: t.whenToUse,
        slots: t.slots.map((s) => ({ id: s.id, accepts: s.accepts, region: s.region })),
      })),
      widgets: widgetDefinitions.map((d) => ({ type: d.type, description: d.description })),
      dictionary: {
        dialect: deps.dictionary.dialect,
        generatedAt: deps.dictionary.generatedAt,
        tables: deps.dictionary.tables.map((t) => t.name),
      },
    }),
  );

  app.post('/api/generate', async (c) => {
    let request: GenerateRequest;
    try {
      request = (await c.req.json()) as GenerateRequest;
      if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0) {
        return c.json({ error: 'prompt is required' }, 400);
      }
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    return streamSSE(c, async (stream) => {
      const emit = async (event: unknown) => {
        await stream.writeSSE({ data: JSON.stringify(event) });
      };
      try {
        if (request.spec) {
          await deps.pipeline.refine(request.spec, request.prompt, request.targetWidgetId, emit);
        } else {
          await deps.pipeline.generate(request.prompt, emit);
        }
      } catch (err) {
        await emit({
          type: 'error',
          message: err instanceof Error ? err.message : 'generation failed',
        });
      }
    });
  });

  // Landing-page prompt suggestions, derived from the dictionary alone —
  // deterministic, so compute once and serve from memory.
  const suggestions = suggestPrompts(deps.dictionary);
  app.get('/api/suggestions', (c) => c.json({ suggestions }));

  if (deps.store) {
    const store = deps.store;

    app.get('/api/dashboards', async (c) => c.json({ dashboards: await store.list() }));

    app.get('/api/dashboards/:id', async (c) => {
      const saved = await store.get(c.req.param('id'));
      return saved ? c.json(saved) : c.json({ error: 'dashboard not found' }, 404);
    });

    app.delete('/api/dashboards/:id', async (c) => {
      const deleted = await store.delete(c.req.param('id'));
      return deleted ? c.json({ ok: true }) : c.json({ error: 'dashboard not found' }, 404);
    });

    app.post('/api/dashboards', async (c) => {
      let body: { name?: string; prompt?: string; spec?: DashboardSpec };
      try {
        body = (await c.req.json()) as typeof body;
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400);
      }
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (!name) return c.json({ error: 'name is required' }, 400);
      if (!body.spec) return c.json({ error: 'spec is required' }, 400);
      // Same gate the pipeline ends on: nothing invalid gets persisted.
      const result = interpret(body.spec);
      if (!result.ok) {
        return c.json({ error: 'spec failed validation', issues: result.issues }, 422);
      }
      const saved = await store.save({
        name,
        spec: body.spec,
        prompt: typeof body.prompt === 'string' ? body.prompt.slice(0, 500) : undefined,
      });
      return c.json(saved, 201);
    });
  }

  app.post('/api/query', async (c) => {
    const sessionKey =
      c.req.header('x-alpona-session') ?? c.req.header('x-forwarded-for') ?? 'local';
    if (!limiter.take(sessionKey)) {
      return c.json({ error: 'rate limit exceeded — slow down' }, 429);
    }

    let request: QueryRequest;
    try {
      request = (await c.req.json()) as QueryRequest;
      if (typeof request.sql !== 'string') return c.json({ error: 'sql is required' }, 400);
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    try {
      const result = await deps.queryService.run(request.sql, request.params ?? {});
      return c.json(result);
    } catch (err) {
      if (err instanceof SqlRejectedError) {
        return c.json({ error: `query rejected: ${err.message}`, reason: err.reason }, 422);
      }
      return c.json({ error: err instanceof Error ? err.message : 'query failed' }, 500);
    }
  });

  return app;
}
