import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { DashboardSpec, DataDictionary, GenerateRequest, QueryRequest } from '@alpona/core';
import { interpret, layoutTemplates, widgetDefinitions } from '@alpona/core';
import type { AlponaAgent } from '@alpona/agent';
import type { QueryService } from './query/service.js';
import type { DashboardStore } from './store/dashboards.js';
import { dictionaryId } from './store/dashboards.js';
import type { AuthConfig, AuthUser } from './auth/middleware.js';
import { createAuthMiddleware } from './auth/middleware.js';
import { suggestPrompts } from './suggest/suggestions.js';
import { SqlRejectedError } from './query/guardrails.js';
import { RateLimiter } from './query/rate-limit.js';

export interface AppDeps {
  agent: AlponaAgent;
  queryService: QueryService;
  dictionary: DataDictionary;
  mock: boolean;
  store?: DashboardStore;
  /** Registered data sources (active ALPONA_DB first; rest via `alpona connect`). */
  sources?: { name: string; dialect: string; tables: number }[];
  /** Curated prompt ideas from the dataset pack's prompts.json. */
  promptIdeas?: { text: string; intent: 'ask' | 'build' }[];
  /** Defaults to mode "none" — the playground must always work. */
  auth?: AuthConfig;
  /** Public auth-service URL the studio shows its login against (oidc). */
  authUrl?: string;
  /**
   * Internal GoTrue base URL. When set, /auth/v1/* is reverse-proxied to
   * it, so the studio authenticates same-origin (no CORS, one exposed
   * port). The login/token traffic skips the bearer middleware.
   */
  authUpstream?: string;
}

type AppEnv = { Variables: { user: AuthUser } };

/**
 * The HTTP surface. /api/generate streams the four-stage pipeline over
 * SSE (refinements included — send the current spec); /api/query is the
 * guarded query service the rendering engine hydrates widgets through.
 */
export function buildApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter();
  const auth = deps.auth ?? { mode: 'none' as const };

  app.use('*', cors());

  // Reverse-proxy the auth service so the studio logs in same-origin.
  // This sits before the bearer middleware (which only guards /api/*) —
  // logging in is necessarily unauthenticated.
  if (deps.authUpstream) {
    const upstream = deps.authUpstream.replace(/\/$/, '');
    app.all('/auth/v1/*', async (c) => {
      const path = c.req.path.replace(/^\/auth\/v1/, '');
      const url = `${upstream}${path}${new URL(c.req.url).search}`;
      const headers = new Headers(c.req.raw.headers);
      headers.delete('host');
      const init: RequestInit = { method: c.req.method, headers };
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
        init.body = await c.req.raw.arrayBuffer();
      }
      const response = await fetch(url, init);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    });
  }

  // Auth runs before every route; /api/health stays open for probes.
  app.use('/api/*', createAuthMiddleware(auth));

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      mock: deps.mock,
      auth: auth.mode,
      // The studio reads this to decide whether to show a login screen
      // and where to authenticate; never a credential, just the URL.
      authUrl: auth.mode === 'none' ? undefined : deps.authUrl,
      tables: deps.dictionary.tables.length,
    }),
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
        if (request.pinAnswer && request.spec) {
          await deps.agent.pin(request.spec, request.pinAnswer, emit);
        } else if (request.spec) {
          await deps.agent.refine(request.spec, request.prompt, request.targetWidgetId, emit);
        } else {
          await deps.agent.generate(request.prompt, emit);
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
  // Suggestions: the pack's curated prompts when it ships them, else
  // derived from the dictionary. Each is intent-tagged for the chips
  // (? = ask, ▦ = build); the LLM classifier still has the final say.
  const suggestions =
    deps.promptIdeas && deps.promptIdeas.length > 0
      ? deps.promptIdeas
      : suggestPrompts(deps.dictionary).map((text) => ({
          text,
          intent: (text.trimEnd().endsWith('?') ? 'ask' : 'build') as 'ask' | 'build',
        }));
  app.get('/api/suggestions', (c) => c.json({ suggestions }));

  // D6: data import lives in the CLI; the studio only ever reads this.
  app.get('/api/sources', (c) => c.json({ sources: deps.sources ?? [] }));

  // The catalog page is a pure renderer over this dictionary JSON.
  app.get('/api/catalog', (c) =>
    c.json({
      generatedAt: deps.dictionary.generatedAt,
      dialect: deps.dictionary.dialect,
      tables: deps.dictionary.tables,
    }),
  );

  if (deps.store) {
    const store = deps.store;
    const dictId = dictionaryId(deps.dictionary);
    const viewer = (c: { get: (key: 'user') => { sub: string } }) => c.get('user').sub;

    app.get('/api/dashboards', async (c) => c.json({ dashboards: await store.list(viewer(c)) }));

    app.get('/api/dashboards/:id', async (c) => {
      const saved = await store.get(c.req.param('id'), viewer(c));
      return saved ? c.json(saved) : c.json({ error: 'dashboard not found' }, 404);
    });

    app.delete('/api/dashboards/:id', async (c) => {
      const deleted = await store.delete(c.req.param('id'), viewer(c));
      return deleted ? c.json({ ok: true }) : c.json({ error: 'dashboard not found' }, 404);
    });

    app.post('/api/dashboards/:id/fork', async (c) => {
      const forked = await store.fork(c.req.param('id'), viewer(c));
      return forked ? c.json(forked, 201) : c.json({ error: 'dashboard not found' }, 404);
    });

    app.post('/api/dashboards', async (c) => {
      let body: { name?: string; prompt?: string; spec?: DashboardSpec; isPublic?: boolean };
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
        owner: viewer(c),
        isPublic: body.isPublic === true,
        dictionaryId: dictId,
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
