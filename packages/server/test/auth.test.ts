import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuthMiddleware, type AuthUser } from '../src/auth/middleware.js';

const enc = new TextEncoder();

/**
 * Security tests — these gate credentials handling and must never be
 * weakened to make a feature pass.
 */

function appWith(middleware: ReturnType<typeof createAuthMiddleware>) {
  const app = new Hono<{ Variables: { user: AuthUser } }>();
  app.use('/api/*', middleware);
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/secret', (c) => c.json({ user: c.get('user') }));
  return app;
}

describe('auth mode: none', () => {
  it('lets everything through as anonymous', async () => {
    const app = appWith(createAuthMiddleware({ mode: 'none' }));
    const res = await app.request('/api/secret');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: AuthUser }).user.sub).toBe('anonymous');
  });
});

describe('auth mode: apikey', () => {
  const middleware = createAuthMiddleware({ mode: 'apikey', apiKey: 'sk-test-123' });

  it('rejects requests with no credentials', async () => {
    const res = await appWith(middleware).request('/api/secret');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong key', async () => {
    const res = await appWith(middleware).request('/api/secret', {
      headers: { authorization: 'Bearer sk-wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts the key as Bearer or x-api-key', async () => {
    const app = appWith(middleware);
    const bearer = await app.request('/api/secret', {
      headers: { authorization: 'Bearer sk-test-123' },
    });
    expect(bearer.status).toBe(200);
    const header = await app.request('/api/secret', { headers: { 'x-api-key': 'sk-test-123' } });
    expect(header.status).toBe(200);
  });

  it('keeps /api/health open for probes', async () => {
    const res = await appWith(middleware).request('/api/health');
    expect(res.status).toBe(200);
  });

  it('refuses to construct without a configured key', () => {
    expect(() => createAuthMiddleware({ mode: 'apikey' })).toThrow(/ALPONA_API_KEY/);
  });
});

describe('auth mode: oidc with HS256 shared secret (Supabase GoTrue)', () => {
  const secret = 'super-secret-gotrue-jwt-key-that-is-long-enough';
  const issuer = 'alpona';
  const middleware = createAuthMiddleware({
    mode: 'oidc',
    jwtSecret: secret,
    issuer,
    audience: 'authenticated',
  });

  const sign = (opts: { secret?: string; iss?: string; aud?: string; exp?: string } = {}) =>
    new SignJWT({ email: 'user@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('11111111-1111-1111-1111-111111111111')
      .setIssuer(opts.iss ?? issuer)
      .setAudience(opts.aud ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '1h')
      .sign(enc.encode(opts.secret ?? secret));

  it('accepts a correctly-signed GoTrue token and sets the user', async () => {
    const res = await appWith(middleware).request('/api/secret', {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AuthUser };
    expect(body.user).toMatchObject({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
    });
  });

  it('rejects a token signed with the wrong secret, issuer, audience, or expiry', async () => {
    const app = appWith(middleware);
    for (const token of [
      await sign({ secret: 'a-different-secret-entirely-wrong-one' }),
      await sign({ iss: 'evil' }),
      await sign({ aud: 'anon' }),
      await sign({ exp: '-1h' }),
      'not-a-jwt',
    ]) {
      const res = await app.request('/api/secret', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    }
  });

  it('requires either an issuer or a secret to construct', () => {
    expect(() => createAuthMiddleware({ mode: 'oidc' })).toThrow(/OIDC_ISSUER|ALPONA_JWT_SECRET/);
  });
});

describe('auth mode: oidc', () => {
  it('verifies issuer-signed JWTs against the JWKS and rejects everything else', async () => {
    const issuer = 'https://issuer.test';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };

    // Serve the JWKS from a local endpoint; the middleware takes an
    // explicit jwksUrl, so no discovery round-trip is needed.
    const jwksApp = new Hono().get('/jwks', (c) => c.json({ keys: [jwk] }));
    const { serve } = await import('@hono/node-server');
    const server = serve({ fetch: jwksApp.fetch, port: 0 });
    const port = (server.address() as { port: number }).port;

    try {
      const middleware = createAuthMiddleware({
        mode: 'oidc',
        issuer,
        audience: 'alpona',
        jwksUrl: `http://127.0.0.1:${port}/jwks`,
      });
      const app = appWith(middleware);

      const sign = (claims: { iss?: string; aud?: string; exp?: string }) =>
        new SignJWT({ email: 'user@example.com' })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setSubject('user-1')
          .setIssuer(claims.iss ?? issuer)
          .setAudience(claims.aud ?? 'alpona')
          .setIssuedAt()
          .setExpirationTime(claims.exp ?? '5m')
          .sign(privateKey);

      // Valid token → 200, user context populated.
      const ok = await app.request('/api/secret', {
        headers: { authorization: `Bearer ${await sign({})}` },
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { user: AuthUser };
      expect(body.user).toMatchObject({ sub: 'user-1', email: 'user@example.com' });

      // Wrong issuer, wrong audience, expired, garbage → all 401.
      for (const token of [
        await sign({ iss: 'https://evil.test' }),
        await sign({ aud: 'someone-else' }),
        await sign({ exp: '-5m' }),
        'not-a-jwt',
      ]) {
        const res = await app.request('/api/secret', {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(401);
      }

      // No token at all → 401; health stays open.
      expect((await app.request('/api/secret')).status).toBe(401);
      expect((await app.request('/api/health')).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
