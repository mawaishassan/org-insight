/**
 * API client: base URL and fetch with JWT.
 */

/**
 * Base URL for API requests (no trailing slash).
 * - In the browser, when `NEXT_PUBLIC_API_URL` or `NEXT_PUBLIC_BACKEND_URL` is set, requests go
 *   straight to FastAPI. That avoids the Next.js dev-server rewrite proxy, which can drop long
 *   requests (report preview, exports) with ECONNRESET / "socket hang up".
 * - Otherwise the browser uses same-origin `/api/*` (rewritten in next.config.js).
 * - During SSR, uses env or falls back to the same port as start.bat / next.config (8080).
 */
function getBaseUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "").trim();
  if (typeof window !== "undefined") {
    if (fromEnv) {
      return fromEnv.replace(/\/+$/, "");
    }
    return "";
  }
  return fromEnv.replace(/\/+$/, "") || "http://localhost:8080";
}

export function getApiUrl(path: string): string {
  const base = getBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}/api${p}` : `/api${p}`;
}

/** Path under /api, e.g. kpis/12/files/34/download */
function parseKpiFileDownloadPath(pathname: string): string | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "");
  const withApi = /^\/api\/(kpis\/\d+\/files\/\d+\/download)$/.exec(p);
  if (withApi) return withApi[1];
  const noApi = /^\/(kpis\/\d+\/files\/\d+\/download)$/.exec(p);
  if (noApi) return noApi[1];
  return null;
}

/**
 * If rawUrl is our protected KPI file download (any host or relative), return path for getApiUrl (kpis/id/files/id/download).
 * Otherwise return null (external URL or unrelated path).
 */
export function resolveKpiFileDownloadApiPath(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const u = new URL(trimmed);
      return parseKpiFileDownloadPath(u.pathname);
    }
    const pathOnly = trimmed.startsWith("/") ? trimmed.split("?")[0] : `/${trimmed.split("?")[0]}`;
    return parseKpiFileDownloadPath(pathOnly);
  } catch {
    return null;
  }
}

function storedFileRefToUrl(ref: unknown): string {
  if (typeof ref === "string") return ref.trim();
  if (ref && typeof ref === "object" && "url" in ref && typeof (ref as { url: unknown }).url === "string") {
    return String((ref as { url: string }).url).trim();
  }
  return "";
}

/**
 * Delete KPI file record + storage when URL points to /api/kpis/{id}/files/{id}/download. No-op for external URLs.
 */
export async function deleteKpiStoredFileByUrl(rawUrl: string, token: string | null): Promise<void> {
  if (!token) {
    throw new Error("Not signed in");
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) return;
  const inner = resolveKpiFileDownloadApiPath(trimmed);
  if (!inner) return;
  const m = /^kpis\/(\d+)\/files\/(\d+)\/download$/.exec(inner);
  if (!m) return;
  const kpiId = m[1];
  const fileId = m[2];
  const res = await fetch(getApiUrl(`kpis/${kpiId}/files/${fileId}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    const d = (err as { detail?: unknown }).detail;
    throw new Error(typeof d === "string" ? d : `Could not delete file (${res.status})`);
  }
}

function storedFileRefToFilename(ref: unknown): string {
  if (ref && typeof ref === "object") {
    if ("filename" in ref && typeof (ref as { filename: unknown }).filename === "string") {
      return String((ref as { filename: string }).filename).trim();
    }
    if ("original_filename" in ref && typeof (ref as { original_filename: unknown }).original_filename === "string") {
      return String((ref as { original_filename: string }).original_filename).trim();
    }
  }
  return "";
}

/**
 * Open a KPI attachment stored as download URL (relative or absolute). Uses JWT for /api/kpis/.../files/.../download.
 * For other http(s) URLs, opens in a new tab without auth.
 */
export async function openKpiStoredFileInNewTab(ref: unknown, token: string | null): Promise<void> {
  if (!token) {
    throw new Error("Not signed in");
  }
  const trimmed = storedFileRefToUrl(ref);
  if (!trimmed) {
    throw new Error("No file URL");
  }

  const inner = resolveKpiFileDownloadApiPath(trimmed);
  const url = inner ? getApiUrl(inner) : null;

  if (url) {
    const previewUrl = `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    window.open(previewUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    window.open(trimmed, "_blank", "noopener,noreferrer");
    return;
  }

  const rel = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const previewUrl = `${origin}${rel}${rel.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  window.open(previewUrl, "_blank", "noopener,noreferrer");
}

export async function api<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, body, ...init } = options;
  const url = getApiUrl(path);
  const method = (init.method || "GET").toUpperCase();

  // Fast cache for /auth/me to avoid repeating this call across pages/components.
  // Token-scoped and short-lived to prevent stale UI after role/org changes.
  if ((method === "GET" || method === "HEAD") && url.endsWith("/api/auth/me") && token) {
    const cached = meCacheByToken.get(token);
    if (cached && Date.now() - cached.ts < ME_CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  // In-flight de-duplication: if multiple components trigger the exact same request at the same time
  // (common with React strict mode + shared layout fetching), share one Promise and one network call.
  // Key includes token because auth can change the response.
  const dedupeKey = (() => {
    const b =
      body === undefined || body === null
        ? ""
        : typeof body === "string"
          ? body
          : (() => {
              try {
                return JSON.stringify(body);
              } catch {
                return String(body);
              }
            })();
    return `${method} ${url} token=${token || ""} body=${b}`;
  })();

  // Only dedupe safe idempotent methods by default.
  const canDedupe = method === "GET" || method === "HEAD";
  if (canDedupe) {
    const existing = inflightRequests.get(dedupeKey);
    if (existing) return existing as Promise<T>;
  }

  const headers: HeadersInit = {
    ...(init.headers as Record<string, string>),
  };
  if (body !== undefined && body !== null) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const run = (async () => {
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
      const message = Array.isArray(err.detail)
        ? err.detail.map((e: { msg: string }) => e.msg).join(", ")
        : (err.detail || res.statusText);
      const error = new Error(typeof message === "string" ? message : "Request failed") as Error & {
        errors?: unknown[];
      };
      if (Array.isArray(err.errors)) error.errors = err.errors;
      throw error;
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json()) as T;
    if ((method === "GET" || method === "HEAD") && url.endsWith("/api/auth/me") && token) {
      meCacheByToken.set(token, { ts: Date.now(), data: json as unknown });
    }
    return json;
  })();

  if (canDedupe) {
    inflightRequests.set(dedupeKey, run);
    run.finally(() => {
      inflightRequests.delete(dedupeKey);
    });
  }

  return run;
}

const inflightRequests = new Map<string, Promise<unknown>>();

const ME_CACHE_TTL_MS = 30_000;
const meCacheByToken = new Map<string, { ts: number; data: unknown }>();

/** Human-readable duration for bulk-upload timing (toasts and summaries). */
export function formatElapsedMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return s >= 10 ? `${s.toFixed(1)} s` : `${s.toFixed(2)} s`;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}m ${r < 10 ? r.toFixed(1) : Math.round(r)}s`;
}

/** Live elapsed clock for upload UI (updates every tick). */
export function formatElapsedClockSec(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${sec}s`;
}

/** Default cap for large Excel imports (server processing may run long after the upload bytes finish). */
const DEFAULT_FORM_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * POST multipart form data with XMLHttpRequest so we can report upload progress (bytes sent to the server).
 * After the request body is sent, the server may still be parsing/validating/saving; use `onRequestSent` for that phase.
 */
export function postFormDataWithUploadProgress(
  path: string,
  formData: FormData,
  options: {
    token: string;
    onUploadProgress?: (ev: ProgressEvent) => void;
    /** Called when the browser has finished sending the request body (server may still be working). */
    onRequestSent?: () => void;
    signal?: AbortSignal;
    /** 0 disables the XHR timeout (not recommended). */
    timeoutMs?: number;
  }
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const url = getApiUrl(path);
  const { token, onUploadProgress, onRequestSent, signal, timeoutMs = DEFAULT_FORM_UPLOAD_TIMEOUT_MS } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (timeoutMs > 0) {
      xhr.timeout = timeoutMs;
    }
    xhr.upload.onprogress = (ev) => {
      onUploadProgress?.(ev);
    };
    xhr.upload.onload = () => {
      onRequestSent?.();
    };
    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => {
          const t = xhr.responseText;
          if (!t) return {};
          try {
            return JSON.parse(t) as unknown;
          } catch {
            return {};
          }
        },
      });
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.ontimeout = () => reject(new Error("Request timed out"));

    const onAbort = () => xhr.abort();
    if (signal) {
      signal.addEventListener("abort", onAbort);
      xhr.addEventListener(
        "loadend",
        () => {
          signal.removeEventListener("abort", onAbort);
        },
        { once: true }
      );
    }

    xhr.send(formData);
  });
}
