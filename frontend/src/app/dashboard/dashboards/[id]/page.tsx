"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { WidgetRenderer, type Widget } from "./widgets";
import { DASHBOARD_GRID_COLUMNS, widgetGridColumnStyle } from "./layoutGrid";

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

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "1rem" }}>
      {title && <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>{title}</h3>}
      {children}
    </div>
  );
}

export default function DashboardViewPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgIdFromQuery = searchParams.get("organization_id");
  const organizationId = orgIdFromQuery ? Number(orgIdFromQuery) : undefined;

  const token = getAccessToken();
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    const query = organizationId ? `?organization_id=${organizationId}` : "";
    api<DashboardDetail>(`/dashboards/${id}${query}`, { token })
      .then(setDashboard)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [id, token, organizationId]);

  const widgets = useMemo(() => asWidgets(dashboard?.layout), [dashboard?.layout]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!dashboard) return null;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {widgets.length === 0 ? (
        <Card title="No widgets">
          <p style={{ color: "var(--muted)", margin: 0 }}>This dashboard has no widgets yet.</p>
        </Card>
      ) : (
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: `repeat(${DASHBOARD_GRID_COLUMNS}, minmax(0, 1fr))`,
          }}
        >
          {widgets.map((w) => (
            <div key={w.id} style={widgetGridColumnStyle(w as { full_width?: boolean; col_span?: number })}>
              <WidgetRenderer widget={w} organizationId={dashboard.organization_id} dashboardId={dashboard.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
