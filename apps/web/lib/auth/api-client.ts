// Part 10.1 — talks to apps/api's auth module. The refresh token lives in an
// httpOnly cookie (never touched here); the access token is held in memory
// only (never localStorage — see ibms-brain meta/designs, XSS-resistant
// token strategy) and re-issued transparently via a single silent-refresh
// retry on a 401.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * True when a 403 came from the forced-MFA-enrolment guard rather than from a missing permission.
 *
 * Both arrive as a bare 403 and a screen that guesses picks wrong roughly half the time: a measured
 * first sign-in showed every insurer screen reporting "you do not hold insurer.read" to an
 * administrator who held it and simply had no authenticator paired yet. The API has always said
 * which is which in its `code` field; nothing on the web side was reading it.
 */
export function isMfaEnrolmentError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === 'MFA_ENROLLMENT_REQUIRED';
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
}

// Multiple concurrent 401s should trigger exactly one refresh call, not one
// per failed request — every caller awaits the same in-flight promise.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST' });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const body = (await res.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function parseErrorBody(res: Response): Promise<{ message?: string; code?: string }> {
  try {
    return (await res.json()) as { message?: string; code?: string };
  } catch {
    return {};
  }
}

// Shared by apiFetch and apiFetchBlob: issues the request, retries exactly
// once via a silent refresh on a 401, and throws ApiError on any other
// non-OK response — everything both callers need before they diverge on
// how to parse a successful body (.json() vs. .blob()).
async function fetchWithRetry(
  path: string,
  init: RequestInit,
  options: { skipAuthRetry?: boolean },
): Promise<Response> {
  let res = await rawFetch(path, init);

  if (res.status === 401 && !options.skipAuthRetry && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawFetch(path, init);
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    const message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? res.statusText);
    throw new ApiError(message, res.status, body.code);
  }
  return res;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: { skipAuthRetry?: boolean } = {},
): Promise<T> {
  const res = await fetchWithRetry(path, init, options);
  if (res.status === 204) return undefined as T;
  // An empty body is NOT always a 204. A NestJS handler typed `Promise<void>`
  // under `@HttpCode(200)` answers 200 with nothing in the body — this API has
  // 154 such service methods — and `res.json()` on an empty body throws a
  // SyntaxError. That is not an `ApiError`, so every caller written as
  // `err instanceof ApiError ? err.message : <fallback>` reported its FALLBACK
  // for what was actually a success.
  //
  // On MFA enrolment that fallback is "Invalid code — try again", shown to a
  // user whose correct code had already enabled MFA server-side. Reading the
  // body as text first fixes the whole class at the one chokepoint every
  // request goes through, rather than endpoint by endpoint.
  const text = await res.text();
  if (text.trim().length === 0) return undefined as T;
  return JSON.parse(text) as T;
}

// Part F item #7 — the first binary (non-JSON) download this app makes.
// Same 401-retry-once shape as apiFetch, resolving a Blob instead of a
// JSON body — a generated PDF is never JSON.
export async function apiFetchBlob(
  path: string,
  options: { skipAuthRetry?: boolean } = {},
): Promise<Blob> {
  const res = await fetchWithRetry(path, { method: 'GET' }, options);
  return res.blob();
}

export function apiPost<T>(path: string, body?: unknown, options?: { skipAuthRetry?: boolean }): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, options);
}

export function apiGet<T>(path: string, options?: { skipAuthRetry?: boolean }): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' }, options);
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
