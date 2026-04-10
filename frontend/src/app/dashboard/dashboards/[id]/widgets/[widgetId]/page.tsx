"use client";

import { useEffect, useMemo, useState } from "react";
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
      <WidgetRenderer
        widget={widget}
        organizationId={dashboard.organization_id}
        dashboardId={dashboard.id}
        isFullPage
        tableRowsPerPage={widget.type === "kpi_multi_line_table" ? rowsPerPage : undefined}
        onTableRowsPerPageChange={widget.type === "kpi_multi_line_table" ? setRowsPerPage : undefined}
        tableRowsPerPageOptions={[5, 10, 25, 50, 100]}
      />
    </div>
  );
}

