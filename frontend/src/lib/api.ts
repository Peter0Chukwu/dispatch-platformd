/**
 * API CLIENT
 *
 * Security model:
 *  · the ACCESS token is held in memory only — never in localStorage, so an XSS
 *    payload cannot read it and it disappears when the tab closes
 *  · the REFRESH token lives in an HttpOnly cookie the browser sends automatically
 *  · on a 401 the client silently refreshes ONCE, then retries the original request
 *  · refresh calls are single-flight: ten parallel 401s trigger one refresh, not ten
 *    (ten parallel rotations look exactly like token theft to the server)
 */
export const API_BASE = '/api/v1';

export type ApiErrorShape = {
  code: string;
  message: string;
  details?: Array<{ field?: string; message: string }>;
  requestId?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorShape['details'];
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }

  /** A message that is safe and useful to show a customer. */
  get userMessage(): string {
    if (this.status === 0) return 'You appear to be offline. Check your connection and try again.';
    if (this.status >= 500) return `Something went wrong on our side. Reference: ${this.requestId ?? 'n/a'}`;
    return this.message;
  }

  /** Field-level messages, ready for a form. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      if (detail.field && !map[detail.field]) map[detail.field] = detail.message;
    }
    return map;
  }
}

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

type Options = Omit<RequestInit, 'body'> & {
  body?: unknown;
  timeoutMs?: number;
  /** Internal: prevents an infinite refresh loop. */
  retryOnUnauthorized?: boolean;
  skipAuthRefresh?: boolean;
};

let refreshInFlight: Promise<string | null> | null = null;

/** Silently rotates the refresh token. Returns the new access token, or null. */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        accessToken = null;
        return null;
      }
      const body = (await response.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return body.accessToken;
    } catch {
      accessToken = null;
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: Options = {}): Promise<T> {
  const { body, timeoutMs = 20_000, headers, retryOnUnauthorized = true, skipAuthRefresh = false, ...rest } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && retryOnUnauthorized && !skipAuthRefresh) {
      const renewed = await refreshAccessToken();
      if (renewed) {
        return apiRequest<T>(path, { ...options, retryOnUnauthorized: false });
      }
    }

    if (response.status === 204) return undefined as T;

    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const shape: ApiErrorShape =
        payload && typeof payload === 'object' && 'error' in payload
          ? (payload as { error: ApiErrorShape }).error
          : { code: 'INTERNAL_ERROR', message: `Request failed (${response.status})` };
      throw new ApiError(response.status, shape);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, { code: 'NETWORK_TIMEOUT', message: 'The request timed out. Please try again.' });
    }
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: 'Network request failed' });
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string, options?: Options) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Options) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Options) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Options) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
