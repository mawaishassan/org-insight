"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
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

  // Odoo sync states
  const [syncInfo, setSyncInfo] = useState<{ has_odoo_graphs: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

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

  useEffect(() => {
    if (!id || !token) return;
    const query = organizationId ? `?organization_id=${organizationId}` : "";
    api<{ has_odoo_graphs: boolean }>(`/dashboards/${id}/odoo-sync-info${query}`, { token })
      .then(setSyncInfo)
      .catch(() => setSyncInfo(null));
  }, [id, token, organizationId]);

  const handleSync = async () => {
    if (!id || !token || syncing) return;
    setSyncing(true);
    const query = organizationId ? `?organization_id=${organizationId}` : "";
    try {
      const res = await api<{ status: string; synced_count: number; total_imported_rows: number; errors?: string[] }>(
        `/dashboards/${id}/sync-odoo${query}`,
        { method: "POST", token }
      );
      if (res?.errors && res.errors.length > 0) {
        res.errors.forEach((err) => toast.error(err, { duration: 6000 }));
      }
      if (res?.synced_count && res.synced_count > 0) {
        toast.success(`Successfully synced ${res.synced_count} Odoo integration(s).`);
        setRefreshCount((prev) => prev + 1);
      } else {
        toast.success("Odoo sync completed.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sync Odoo data");
    } finally {
      setSyncing(false);
    }
  };

  const widgets = useMemo(() => asWidgets(dashboard?.layout), [dashboard?.layout]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!dashboard) return null;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {syncInfo?.has_odoo_graphs && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.75rem 1rem",
            background: "var(--surface)",
            borderRadius: "var(--radius, 8px)",
            border: "1px solid var(--border)",
            marginBottom: "0.5rem"
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Odoo Data Integration</h3>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
              This dashboard contains graphs generated via Odoo integrated API.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncing}
            onClick={handleSync}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              cursor: syncing ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.875rem",
              fontWeight: 500
            }}
          >
            {syncing ? "Syncing Odoo..." : "Load Latest Odoo Data"}
          </button>
        </div>
      )}

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
            <div key={`${w.id}-${refreshCount}`} style={widgetGridColumnStyle(w as { full_width?: boolean; col_span?: number })}>
              <WidgetRenderer widget={w} organizationId={dashboard.organization_id} dashboardId={dashboard.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
