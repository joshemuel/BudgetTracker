type Method = "GET" | "POST" | "PATCH" | "DELETE";

function normalizePath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith("/api/")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/api${p}`;
}

async function request<T>(
  path: string,
  method: Method = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(normalizePath(path), {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail ?? detail;
    } catch {
      /* ignore */
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p, "GET"),
  post: <T>(p: string, body?: unknown) => request<T>(p, "POST", body),
  patch: <T>(p: string, body?: unknown) => request<T>(p, "PATCH", body),
  del: <T = void>(p: string) => request<T>(p, "DELETE"),
};
