/**
 * Single POST for dashboard widget data (replaces for-period + field map + paged multi-items).
 * Opt out with `NEXT_PUBLIC_WIDGET_DATA_BUNDLE=0`.
 */

import { api } from "@/lib/api";

export type WidgetDataRequestV1 = {
  version: 1;
  organization_id: number;
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
  return /abort/i.test(m);
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
