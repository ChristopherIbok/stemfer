const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://stemfer-api.ibokchris.workers.dev';

/* In-flight request dedup map — avoids duplicate GET calls fired simultaneously */
const inflight = new Map<string, Promise<unknown>>();

async function request<T>(
  path: string,
  options: RequestInit & { params?: Record<string, string> } = {}
): Promise<T> {
  const { params, ...init } = options;

  const url = new URL(BASE + path);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const token = typeof window !== 'undefined' ? localStorage.getItem('stemfer_token') : null;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(init.body instanceof FormData || init.body instanceof ArrayBuffer)) {
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  }

  const urlStr = url.toString();
  const method = (init.method ?? 'GET').toUpperCase();

  /* Deduplicate concurrent GET requests to the same endpoint */
  if (method === 'GET') {
    const key = urlStr;
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = fetch(urlStr, { ...init, headers })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          const e   = new Error(err.error ?? `HTTP ${res.status}`);
          (e as any).status = res.status;
          throw e;
        }
        const ct = res.headers.get('Content-Type') ?? '';
        return ct.includes('application/json') ? res.json() : res;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p as Promise<T>;
  }

  /* Non-GET: execute directly */
  const res = await fetch(urlStr, { ...init, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    const e   = new Error(err.error ?? `HTTP ${res.status}`);
    (e as any).status = res.status;
    throw e;
  }

  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('application/json')) return res.json() as Promise<T>;
  return res as unknown as T;
}

export const api = {
  get:     <T>(path: string, params?: Record<string, string>) =>
             request<T>(path, { method: 'GET', params }),
  post:    <T>(path: string, body?: unknown) =>
             request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch:   <T>(path: string, body?: unknown) =>
             request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete:  <T>(path: string) =>
             request<T>(path, { method: 'DELETE' }),
  rawPost: <T>(path: string, body: BodyInit, headers?: Record<string, string>) =>
             request<T>(path, { method: 'POST', body, headers }),
};
