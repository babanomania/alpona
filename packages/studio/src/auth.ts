/**
 * Studio-side auth state. Tokens come from Supabase GoTrue (proxied
 * same-origin through the Alpona server at /auth/v1). The token is held
 * in localStorage and attached as a bearer to every API call.
 */

const TOKEN_KEY = 'alpona-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Header provider passed to the core hooks and the studio's fetches. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** fetch wrapper that injects the bearer and signs out on a 401. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), ...authHeaders() },
  });
  if (response.status === 401 && getToken()) {
    // The token expired or was revoked — drop it and bounce to login.
    clearToken();
    window.location.reload();
  }
  return response;
}

export interface AuthInfo {
  mode: 'none' | 'apikey' | 'oidc';
  authUrl?: string;
}

/** Reads the server's auth posture from /api/health (field: `auth`). */
export async function fetchAuthInfo(): Promise<AuthInfo> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { mode: 'none' };
    const body = (await res.json()) as { auth?: AuthInfo['mode']; authUrl?: string };
    return { mode: body.auth ?? 'none', authUrl: body.authUrl };
  } catch {
    return { mode: 'none' };
  }
}

/** Password grant against GoTrue; stores the access token on success. */
export async function login(
  authUrl: string,
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${authUrl}/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error_description?: string;
      msg?: string;
    };
    if (!res.ok || !body.access_token) {
      return {
        ok: false,
        error: body.error_description ?? body.msg ?? 'invalid email or password',
      };
    }
    localStorage.setItem(TOKEN_KEY, body.access_token);
    return { ok: true };
  } catch {
    return { ok: false, error: 'could not reach the auth service' };
  }
}
