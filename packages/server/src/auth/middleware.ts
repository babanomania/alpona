import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Pluggable request authentication (decision D4). One verification layer
 * covers every OIDC issuer — Supabase Auth, Keycloak, Zitadel,
 * better-auth are all just issuer URLs — plus a static API key mode for
 * simple deployments and `none` for the playground.
 *
 * Auth is enforced in code, before any route logic runs. /api/health
 * stays open for probes; everything else under /api requires credentials
 * once a mode other than `none` is configured.
 */

export type AuthMode = 'none' | 'apikey' | 'oidc';

export interface AuthConfig {
  mode: AuthMode;
  /** Static key for mode=apikey (ALPONA_API_KEY). */
  apiKey?: string;
  /** OIDC issuer URL for mode=oidc — discovery locates the JWKS. */
  issuer?: string;
  /** Expected `aud` claim; unchecked when unset. */
  audience?: string;
  /** Explicit JWKS URL, skipping discovery (some issuers need this). */
  jwksUrl?: string;
  /**
   * HS256 shared secret. Set for Supabase GoTrue self-hosted, which signs
   * tokens symmetrically with GOTRUE_JWT_SECRET rather than publishing a
   * JWKS. When present, tokens are verified with this secret and JWKS
   * discovery is skipped.
   */
  jwtSecret?: string;
}

export interface AuthUser {
  /** Subject claim (oidc) or 'apikey' / 'anonymous'. */
  sub: string;
  email?: string;
}

type AuthEnv = { Variables: { user: AuthUser } };

const OPEN_PATHS = new Set(['/api/health']);

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Length leaks are unavoidable with unequal buffers; compare a digest-
  // sized copy instead of early-returning on length.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

async function discoverJwksUrl(issuer: string): Promise<string> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OIDC discovery failed: ${url} → ${response.status}`);
  const config = (await response.json()) as { jwks_uri?: string };
  if (!config.jwks_uri) throw new Error('OIDC discovery response has no jwks_uri');
  return config.jwks_uri;
}

export function createAuthMiddleware(config: AuthConfig): MiddlewareHandler<AuthEnv> {
  if (config.mode === 'none') {
    return async (c, next) => {
      c.set('user', { sub: 'anonymous' } satisfies AuthUser);
      await next();
    };
  }

  if (config.mode === 'apikey') {
    const expected = config.apiKey;
    if (!expected) throw new Error('AUTH_MODE=apikey requires ALPONA_API_KEY');
    return async (c, next) => {
      if (OPEN_PATHS.has(c.req.path)) return next();
      const presented = bearerToken(c.req.header('authorization')) ?? c.req.header('x-api-key');
      if (!presented || !constantTimeEquals(presented, expected)) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      c.set('user', { sub: 'apikey' } satisfies AuthUser);
      await next();
    };
  }

  // mode === 'oidc'
  const issuer = config.issuer;
  if (!issuer && !config.jwtSecret) {
    throw new Error('AUTH_MODE=oidc requires OIDC_ISSUER (or ALPONA_JWT_SECRET for Supabase)');
  }

  // Claims checked on every token: issuer when configured, audience when
  // configured. Shared across both verification paths.
  const claims = {
    ...(issuer ? { issuer } : {}),
    ...(config.audience ? { audience: config.audience } : {}),
  };

  // HS256 path (Supabase GoTrue): the shared secret verifies symmetrically,
  // no network round-trip. JWKS path: the key set is resolved lazily on
  // first request and cached by jose (key rotation included).
  const secretKey = config.jwtSecret ? new TextEncoder().encode(config.jwtSecret) : undefined;
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  const getJwks = async () => {
    if (!jwks) {
      const url = config.jwksUrl ?? (await discoverJwksUrl(issuer!));
      jwks = createRemoteJWKSet(new URL(url));
    }
    return jwks;
  };

  return async (c, next) => {
    if (OPEN_PATHS.has(c.req.path)) return next();
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      const { payload } = secretKey
        ? await jwtVerify(token, secretKey, claims)
        : await jwtVerify(token, await getJwks(), claims);
      c.set('user', {
        sub: String(payload.sub ?? 'unknown'),
        email: typeof payload.email === 'string' ? payload.email : undefined,
      } satisfies AuthUser);
      await next();
    } catch {
      return c.json({ error: 'unauthorized' }, 401);
    }
  };
}
