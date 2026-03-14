/**
 * API client: base URL and fetch with JWT.
 */

const getBaseUrl = () =>
  typeof window !== "undefined" ? "" : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getApiUrl(path: string): string {
  const base = getBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}/api${p}` : `/api${p}`;
}

export async function api<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, body, ...init } = options;
  const url = getApiUrl(path);
  const headers: HeadersInit = {
    ...(init.headers as Record<string, string>),
  };
  if (body !== undefined && body !== null) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...init, body, headers });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      import("./auth").then(({ clearTokens }) => {
        clearTokens();
        window.location.href = "/login";
      });
      return new Promise(() => {}) as Promise<T>;
    }
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const message = Array.isArray(err.detail) ? err.detail.map((e: { msg: string }) => e.msg).join(", ") : (err.detail || res.statusText);
    const error = new Error(typeof message === "string" ? message : "Request failed") as Error & { errors?: unknown[] };
    if (Array.isArray(err.errors)) error.errors = err.errors;
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
