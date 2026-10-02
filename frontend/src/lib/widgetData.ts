/**
 * Single POST for dashboard widget data (replaces for-period + field map + paged multi-items).
 * Opt out with `NEXT_PUBLIC_WIDGET_DATA_BUNDLE=0`.
 */

import { api } from "@/lib/api";

export type WidgetDataRequestV1 = {
  version: 1;
  organization_id: number;
  /** Optional: when rendering on a dashboard, include dashboard context for auth. */
  dashboard_id?: number;
  /** Same shape as widget in dashboard layout (id, type, options). */
  widget: Record<string, unknown>;
  /** Runtime: year, period_key, selected_years (kpi_trend) without mutating `widget`. */
  overrides?: Record<string, unknown>;
};

/** Bar/pie fast path: dashboard view auth only (no KPI field-level checks). */
export type ChartWidgetDataRequestV1 = WidgetDataRequestV1 & {
  dashboard_id: number;
};

export type WidgetDataResponseV1 = {
  version: number;
  widget_type: string;
  meta: Record<string, unknown>;
  data: Record<string, unknown>;
  etag?: string | null;
  /** Server entry revision; use in SWR/React Query keys to invalidate when data changes. */
  entry_revision?: string | null;
};

/** When unset or not "0" / "false", use POST /api/widget-data. */
export function isWidgetDataBundleEnabled(): boolean {
  if (typeof process === "undefined") return true;
  const v = process.env.NEXT_PUBLIC_WIDGET_DATA_BUNDLE;
  if (v === "0" || v === "false") return false;
  return true;
}

/** True when `fetch` was cancelled via AbortController (e.g. React effect cleanup, Strict Mode remount). */
export function isLikelyAbortError(e: unknown): boolean {
  if (e == null) return false;
  if (e instanceof Error && (e.name === "AbortError" || e.message === "The user aborted a request.")) {
    return true;
  }
  if (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") {
    return true;
  }
  const m = String((e as { message?: string })?.message ?? e);
  return /abort|cancel/i.test(m);
}

export async function postWidgetData(
  token: string,
  body: WidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

/** `kpi_bar_chart` / pie only — use from dashboard pages when `dashboard_id` is known. */
export async function postDashboardChartWidgetData(
  token: string,
  body: ChartWidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/chart", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardChartWidgetDataBatch(
  token: string,
  body: {
    version: 1;
    organization_id: number;
    dashboard_id: number;
    items: Array<{ widget: Record<string, unknown>; overrides?: Record<string, unknown> }>;
  },
  init?: RequestInit
): Promise<{ version: number; results: Record<string, any> }> {
  return api<{ version: number; results: Record<string, any> }>("/widget-data/chart/batch", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardCardWidgetData(
  token: string,
  body: ChartWidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/card", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardCardWidgetDataBatch(
  token: string,
  body: {
    version: 1;
    organization_id: number;
    dashboard_id: number;
    items: Array<{ widget: Record<string, unknown>; overrides?: Record<string, unknown> }>;
  },
  init?: RequestInit
): Promise<{ version: number; results: Record<string, any> }> {
  return api<{ version: number; results: Record<string, any> }>("/widget-data/card/batch", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardTableWidgetData(
  token: string,
  body: ChartWidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/table", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardTableWidgetRows(
  token: string,
  body: ChartWidgetDataRequestV1 & {
    page: number;
    page_size: number;
    search?: string | null;
    sort_by?: string | null;
    sort_dir?: "asc" | "desc";
  },
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/table/rows", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardLineWidgetData(
  token: string,
  body: ChartWidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/line", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardTrendWidgetData(
  token: string,
  body: ChartWidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/trend", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardSingleValueWidgetData(
  token: string,
  body: ChartWidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/value", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

export async function postDashboardKvTableWidgetData(
  token: string,
  body: ChartWidgetDataRequestV1,
  init?: RequestInit
): Promise<WidgetDataResponseV1> {
  return api<WidgetDataResponseV1>("/widget-data/kv-table", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

/**
 * Universal period-shift batch — sends ALL widget types (charts, cards,
 * line charts, trends, tables, text) in a single POST and receives all
 * results back in one response.
 *
 * Use this instead of calling chart/batch + card/batch + individual
 * line/trend/table endpoints when the user shifts the reporting period.
 *
 * Returns: { version: 1, results: { "<widget_id>": { ok, widget_type, meta, data, entry_revision } } }
 */
export async function postDashboardUniversalBatch(
  token: string,
  body: {
    version: 1;
    organization_id: number;
    dashboard_id: number;
    items: Array<{ widget: Record<string, unknown>; overrides?: Record<string, unknown> }>;
  },
  init?: RequestInit
): Promise<{ version: number; results: Record<string, {
  ok: boolean;
  widget_type?: string;
  meta?: Record<string, unknown>;
  data?: Record<string, unknown>;
  entry_revision?: string | null;
  error?: string;
}> }> {
  return api("/widget-data/dashboard/batch", {
    method: "POST",
    body: JSON.stringify(body),
    token,
    ...init,
  });
}

const WIDGET_CACHE_PREFIX = "org_insight_widget_cache::";
const WIDGET_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes session TTL
const clientWidgetMemoryCache = new Map<string, { data: any; ts: number }>();

export function computeWidgetCacheSignature(w: any): string {
  if (!w || typeof w !== "object") return "";
  const kpiId = w.kpi_id ?? "";
  const type = w.type ?? "";
  const srcKey = w.source_field_key ?? w.field_key ?? "";
  const groupBy = w.group_by_sub_field_key ?? "";
  const valKey = w.value_sub_field_key ?? "";
  const agg = w.agg ?? "";
  const fkeys = Array.isArray(w.field_keys) ? w.field_keys.join(",") : "";
  const joins = Array.isArray(w.joins) ? JSON.stringify(w.joins) : "";
  return `${kpiId}:${type}:${srcKey}:${groupBy}:${valKey}:${agg}:${fkeys}:${joins}`;
}

export function getPersistentWidgetCache<T = any>(cacheKey: string, maxAgeMs = WIDGET_CACHE_TTL_MS): T | null {
  const now = Date.now();
  // 1. Check in-memory cache
  const mem = clientWidgetMemoryCache.get(cacheKey);
  if (mem && now - mem.ts < maxAgeMs) {
    return mem.data as T;
  }
  // 2. Check sessionStorage
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(`${WIDGET_CACHE_PREFIX}${cacheKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.ts === "number" && now - parsed.ts < maxAgeMs) {
          clientWidgetMemoryCache.set(cacheKey, { data: parsed.data, ts: parsed.ts });
          return parsed.data as T;
        } else {
          sessionStorage.removeItem(`${WIDGET_CACHE_PREFIX}${cacheKey}`);
        }
      }
    } catch {}
  }
  return null;
}

export function setPersistentWidgetCache(cacheKey: string, data: any): void {
  if (data === undefined) return;
  const now = Date.now();
  clientWidgetMemoryCache.set(cacheKey, { data, ts: now });
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(`${WIDGET_CACHE_PREFIX}${cacheKey}`, JSON.stringify({ data, ts: now }));
    } catch {
      // Storage quota exceeded or disabled
    }
  }
}

export function clearClientWidgetCache(dashboardId?: number): void {
  if (dashboardId != null) {
    const prefix = `${dashboardId}::`;
    for (const k of Array.from(clientWidgetMemoryCache.keys())) {
      if (k.startsWith(prefix)) {
        clientWidgetMemoryCache.delete(k);
      }
    }
    if (typeof window !== "undefined") {
      try {
        const fullPrefix = `${WIDGET_CACHE_PREFIX}${prefix}`;
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(fullPrefix)) keysToRemove.push(k);
        }
        keysToRemove.forEach((k) => sessionStorage.removeItem(k));
      } catch {}
    }
  } else {
    clientWidgetMemoryCache.clear();
    if (typeof window !== "undefined") {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(WIDGET_CACHE_PREFIX)) keysToRemove.push(k);
        }
        keysToRemove.forEach((k) => sessionStorage.removeItem(k));
      } catch {}
    }
  }
}

