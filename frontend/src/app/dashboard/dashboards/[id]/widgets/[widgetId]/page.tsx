"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { WidgetRenderer, type Widget } from "../../widgets";

interface DashboardDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  layout: any;
}

function asWidgets(layout: any): Widget[] {
  if (!layout) return [];
  if (Array.isArray(layout)) return layout as Widget[];
  if (typeof layout === "object" && Array.isArray(layout.widgets)) return layout.widgets as Widget[];
  return [];
}

export default function DashboardWidgetFullPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const dashboardId = Number(params.id);
  const widgetId = String((params as any).widgetId || "");
  const orgIdFromQuery = searchParams.get("organization_id");
  const organizationIdFromQuery = orgIdFromQuery ? Number(orgIdFromQuery) : undefined;

  const token = getAccessToken();
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rowsPerPage, setRowsPerPage] = useState<number>(10);

  useEffect(() => {
    if (!dashboardId || !token) return;
    setLoading(true);
    setError(null);
    const query = organizationIdFromQuery ? `?organization_id=${organizationIdFromQuery}` : "";
    api<DashboardDetail>(`/dashboards/${dashboardId}${query}`, { token })
      .then(setDashboard)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [dashboardId, token, organizationIdFromQuery]);

  const widgets = useMemo(() => asWidgets(dashboard?.layout), [dashboard?.layout]);
  const widget = useMemo(() => widgets.find((w) => w.id === widgetId) ?? null, [widgets, widgetId]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!dashboard) return null;
  if (!widget) return <p className="form-error">Widget not found.</p>;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem", fontSize: "1.5rem" }}>Widget</h1>
          <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 0 }}>
            Dashboard: <strong>{dashboard.name}</strong>
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link
            className="btn"
            href={`/dashboard/dashboards/${dashboard.id}${dashboard.organization_id ? `?organization_id=${dashboard.organization_id}` : ""}`}
            style={{ fontSize: "0.85rem", textDecoration: "none" }}
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      {widget.type === "kpi_multi_line_table" && (
        <div className="card" style={{ padding: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Rows per page:</span>
            <select
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem" }}
            >
              {[5, 10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <WidgetRenderer
        widget={widget}
        organizationId={dashboard.organization_id}
        dashboardId={dashboard.id}
        isFullPage
        tableRowsPerPage={widget.type === "kpi_multi_line_table" ? rowsPerPage : undefined}
      />
    </div>
  );
}

