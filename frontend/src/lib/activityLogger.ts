/**
 * End User Activity Logger for Client-Side Actions
 * Completely non-blocking and fire-and-forget.
 */

import { getAccessToken } from "./auth";
import { getApiUrl } from "./api";

export interface LogActivityParams {
  module: "dashboard" | "report" | "kpi" | "data_entry" | "drilldown" | "auth" | "system";
  resourceType?: string;
  resourceId?: number;
  resourceName?: string;
  actionType:
    | "VIEW"
    | "DRILL_DOWN"
    | "DOWNLOAD_PDF"
    | "DOWNLOAD_EXCEL"
    | "DOWNLOAD_CSV"
    | "DOWNLOAD_WORD"
    | "DRILLDOWN_DOWNLOAD_PDF"
    | "DATA_SAVED"
    | "DATA_SUBMITTED"
    | "DATA_DELETED"
    | "DATA_EXPORTED"
    | "DATA_IMPORTED"
    | "LOGIN"
    | "LOGOUT";
  period?: string;
  details?: string;
  metadata?: Record<string, unknown>;
  status?: "SUCCESS" | "FAILED" | "WARNING";
}

// Simple in-memory deduplication set to avoid spamming the same VIEW event within a short window
const recentlyLogged = new Set<string>();

export function logUserActivity(params: LogActivityParams): void {
  if (typeof window === "undefined") return;

  const token = getAccessToken();
  if (!token) return;

  // Deduplicate rapid duplicate views within 3 seconds
  const dedupKey = `${params.actionType}:${params.module}:${params.resourceId || ""}:${params.period || ""}`;
  if (recentlyLogged.has(dedupKey)) {
    return;
  }
  recentlyLogged.add(dedupKey);
  setTimeout(() => {
    recentlyLogged.delete(dedupKey);
  }, 3000);

  try {
    const url = getApiUrl("activity-logs/event");
    const payload = JSON.stringify({
      module: params.module,
      resource_type: params.resourceType || null,
      resource_id: params.resourceId || null,
      resource_name: params.resourceName || null,
      action_type: params.actionType,
      reporting_period: params.period || null,
      period: params.period || null,
      action_details: params.details || null,
      details: params.details || null,
      metadata: params.metadata || null,
      status: params.status || "SUCCESS",
    });

    // Use sendBeacon if available, otherwise fetch with keepalive
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && false) {
      // Note: sendBeacon cannot easily set Authorization header without blob/cookies, so we use keepalive fetch
    }

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Intentionally silent: Activity tracking should never throw or degrade UX
    });
  } catch {
    // Non-blocking catch
  }
}

/** Convenience helper for Dashboard view */
export function logDashboardView(dashboardId: number, dashboardName: string): void {
  logUserActivity({
    module: "dashboard",
    resourceType: "dashboard",
    resourceId: dashboardId,
    resourceName: dashboardName,
    actionType: "VIEW",
    details: `Viewed dashboard: ${dashboardName}`,
  });
}

/** Convenience helper for Report view */
export function logReportView(reportId: number, reportName: string): void {
  logUserActivity({
    module: "report",
    resourceType: "report",
    resourceId: reportId,
    resourceName: reportName,
    actionType: "VIEW",
    details: `Viewed report: ${reportName}`,
  });
}

/** Convenience helper for Widget Drill-Down modal view */
export function logDrillDownView(
  widgetId: number, 
  widgetTitle: string, 
  details?: string, 
  period?: string
): void {
  logUserActivity({
    module: "drilldown",
    resourceType: "widget",
    resourceId: widgetId,
    resourceName: widgetTitle,
    actionType: "DRILL_DOWN",
    period: period,
    details: details || `Drilled down into widget: ${widgetTitle}${period ? ` (${period})` : ""}`,
  });
}

/** Convenience helper for Widget Drill-Down PDF export */
export function logDrillDownPdfExport(
  widgetId: number, 
  widgetTitle: string, 
  period?: string
): void {
  logUserActivity({
    module: "drilldown",
    resourceType: "widget",
    resourceId: widgetId,
    resourceName: widgetTitle,
    actionType: "DRILLDOWN_DOWNLOAD_PDF",
    period: period,
    details: `Exported drill-down PDF for widget: ${widgetTitle}${period ? ` (${period})` : ""}`,
  });
}
