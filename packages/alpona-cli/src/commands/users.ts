import { SignJWT } from 'jose';

/**
 * User provisioning against Supabase GoTrue (decision D6: all account
 * management lives in the CLI, never the studio). Self-hosted GoTrue is
 * admin-provisioned here — signup is disabled in compose — so these
 * commands are the only way users are created.
 *
 * The GoTrue admin API authenticates with a `service_role` JWT signed by
 * the shared `GOTRUE_JWT_SECRET`; we mint a short-lived one per call.
 */

export interface GoTrueConfig {
  /** Base URL of the GoTrue service, e.g. http://localhost:9999. */
  url: string;
  /** Shared HS256 secret (GOTRUE_JWT_SECRET / ALPONA_JWT_SECRET). */
  secret: string;
}

interface GoTrueUser {
  id: string;
  email?: string;
  created_at?: string;
}

function resolveConfig(env: NodeJS.ProcessEnv): GoTrueConfig {
  // From the host: ALPONA_AUTH_URL (the proxied …/auth/v1). From inside
  // the alpona container: ALPONA_AUTH_UPSTREAM points straight at GoTrue.
  const url = env.ALPONA_AUTH_URL ?? env.GOTRUE_URL ?? env.ALPONA_AUTH_UPSTREAM;
  const secret = env.ALPONA_JWT_SECRET ?? env.GOTRUE_JWT_SECRET;
  if (!url) throw new Error('set ALPONA_AUTH_URL to the GoTrue service URL');
  if (!secret) throw new Error('set ALPONA_JWT_SECRET (the shared GoTrue secret)');
  return { url: url.replace(/\/$/, ''), secret };
}

async function serviceToken(secret: string): Promise<string> {
  return new SignJWT({ role: 'service_role' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(new TextEncoder().encode(secret));
}

async function adminFetch(
  config: GoTrueConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await serviceToken(config.secret);
  return fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      // Some GoTrue builds also require the apikey header; the service
      // token doubles for it in self-hosted setups.
      apikey: token,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

export async function addUser(
  email: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GoTrueUser> {
  const config = resolveConfig(env);
  const res = await adminFetch(config, '/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`could not create user (${res.status}): ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as GoTrueUser;
}

export async function listUsers(env: NodeJS.ProcessEnv = process.env): Promise<GoTrueUser[]> {
  const config = resolveConfig(env);
  const res = await adminFetch(config, '/admin/users');
  if (!res.ok) throw new Error(`could not list users (${res.status})`);
  const body = (await res.json()) as { users?: GoTrueUser[] };
  return body.users ?? [];
}

export async function removeUser(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const config = resolveConfig(env);
  const users = await listUsers(env);
  const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!match) return false;
  const res = await adminFetch(config, `/admin/users/${match.id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`could not delete user (${res.status})`);
  return true;
}
