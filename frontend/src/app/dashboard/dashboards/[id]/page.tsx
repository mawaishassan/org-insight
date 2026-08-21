"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { WidgetRenderer, type Widget } from "./widgets";
import { generatePeriodOptions } from "@/lib/periodHelpers";
import { DASHBOARD_GRID_COLUMNS, widgetGridColumnStyle } from "./layoutGrid";
import { DashboardCustomizationProvider, useDashboardCustomization } from "./DashboardCustomizationContext";

interface DashboardDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  layout: any;
  fetch_data_with_date?: boolean;
}

function asWidgets(layout: any): Widget[] {
  if (!layout) return [];
  if (Array.isArray(layout)) return layout as Widget[];
  if (typeof layout === "object" && Array.isArray(layout.widgets)) return layout.widgets as Widget[];
  return [];
}

function WidgetWithPeriodSelector({
  widget,
  organizationId,
  dashboardId,
}: {
  widget: Widget;
  organizationId: number;
  dashboardId: number;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0.5rem" }}>
      <div style={{ flex: 1 }}>
        <WidgetRenderer
          widget={widget}
          organizationId={organizationId}
          dashboardId={dashboardId}
        />
      </div>
    </div>
  );
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

  const [org, setOrg] = useState<any | null>(null);
  const [selectedPeriodType, setSelectedPeriodType] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

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

  useEffect(() => {
    if (!token || !dashboard?.organization_id) return;
    api<any>(`/organizations/${dashboard.organization_id}`, { token })
      .then((orgData) => {
        setOrg(orgData);
      })
      .catch((e) => console.error("Failed to load org details", e));
  }, [token, dashboard?.organization_id]);

  const customPeriods = useMemo(() => {
    if (!org) return [];
    if (org.custom_periods && org.custom_periods.length > 0) {
      return org.custom_periods;
    }
    if (org.custom_period_name) {
      return [{
        custom_period_name: org.custom_period_name,
        custom_period_start_month: org.custom_period_start_month,
        custom_period_start_day: org.custom_period_start_day,
        custom_period_duration_months: org.custom_period_duration_months,
        custom_period_display_format: org.custom_period_display_format,
        custom_period_prefix: org.custom_period_prefix,
        custom_period_suffix: org.custom_period_suffix,
      }];
    }
    return [];
  }, [org]);

  useEffect(() => {
    if (customPeriods.length > 0) {
      if (!selectedPeriodType || (selectedPeriodType !== "by_default" && !customPeriods.some((p: any) => p.custom_period_name === selectedPeriodType))) {
        setSelectedPeriodType(customPeriods[0].custom_period_name);
      }
    } else {
      setSelectedPeriodType("by_default");
    }
  }, [customPeriods, selectedPeriodType]);

  const activePeriodConfig = useMemo(() => {
    return customPeriods.find((p: any) => p.custom_period_name === selectedPeriodType) || null;
  }, [customPeriods, selectedPeriodType]);

  const periodOptions = useMemo(() => {
    if (selectedPeriodType === "by_default") {
      const currentYear = new Date().getFullYear();
      const years: any[] = [];
      for (let y = currentYear + 1; y >= 2020; y--) {
        years.push({ value: String(y), label: String(y) });
      }
      return years;
    }
    if (!activePeriodConfig) return [];
    return generatePeriodOptions(activePeriodConfig);
  }, [activePeriodConfig, selectedPeriodType]);

  const findDefaultPeriod = (opts: any[]) => {
    if (!opts || opts.length === 0) return "";
    const currentYear = new Date().getFullYear();
    const currentYearStr = String(currentYear);
    const prevYearStr = String(currentYear - 1);
    const nextYearStr = String(currentYear + 1);

    const exactMatch = opts.find(opt => opt.value === currentYearStr);
    if (exactMatch) return exactMatch.value;

    const startCurrent = opts.find(opt => opt.value.startsWith(currentYearStr));
    if (startCurrent) return startCurrent.value;

    const endCurrent = opts.find(opt => opt.value.endsWith(currentYearStr) || opt.value.endsWith(currentYearStr.slice(2)));
    if (endCurrent) return endCurrent.value;

    const startPrev = opts.find(opt => opt.value.startsWith(prevYearStr));
    if (startPrev) return startPrev.value;

    const startNext = opts.find(opt => opt.value.startsWith(nextYearStr));
    if (startNext) return startNext.value;

    const middleIdx = Math.floor(opts.length / 2);
    return opts[middleIdx]?.value || opts[0]?.value || "";
  };

  useEffect(() => {
    if (periodOptions.length > 0) {
      if (!selectedPeriod || (selectedPeriodType !== "by_default" && selectedPeriod === "by_default") || !periodOptions.some(opt => opt.value === selectedPeriod)) {
        setSelectedPeriod(findDefaultPeriod(periodOptions));
      }
    } else {
      setSelectedPeriod("");
    }
  }, [periodOptions, selectedPeriod, selectedPeriodType]);

  const handleSync = async () => {
    if (!id || !token || syncing) return;
    setSyncing(true);
    const startTime = Date.now();
    const query = organizationId ? `?organization_id=${organizationId}` : "";
    try {
      const res = await api<{ status: string; synced_count: number; total_imported_rows: number; errors?: string[] }>(
        `/dashboards/${id}/sync-odoo${query}`,
        { method: "POST", token }
      );
      if (res?.errors && res.errors.length > 0) {
        res.errors.forEach((err) => toast.error(err, { duration: 6000 }));
      }
      const imported = res?.total_imported_rows ?? 0;
      if (res?.synced_count && res.synced_count > 0) {
        toast.success(`Successfully synced ${res.synced_count} LMS integration(s) (${imported} rows imported). Refreshing graphs...`);
      } else {
        toast.success("LMS sync completed. Refreshing graphs...");
      }
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (e) {
      const elapsed = (Date.now() - startTime) / 1000;
      const msg = String(e instanceof Error ? e.message : e || "").toLowerCase();
      const isTimeout =
        msg.includes("socket hang up") ||
        msg.includes("hang up") ||
        msg.includes("econnreset") ||
        msg.includes("timeout") ||
        msg.includes("abort") ||
        msg.includes("failed to fetch") ||
        msg.includes("network error") ||
        msg.includes("502") ||
        msg.includes("504");

      if (isTimeout) {
        // Fetch the sync progress stage from the backend
        let stageInfo = "UNKNOWN";
        try {
          const progRes = await api<{ stage: string }>(
            `/entries/multi-items/sync-progress?entity_type=dashboard&entity_id=${id}`,
            { token }
          );
          if (progRes?.stage) {
            stageInfo = progRes.stage;
          }
        } catch (progErr) {
          console.error("Failed to fetch sync progress", progErr);
        }

        let diagnosis = "An unknown connection or timeout issue occurred.";
        let remedy = "Please try syncing again.";
        
        // Diagnose Node.js vs Nginx based on elapsed time
        if (elapsed >= 27 && elapsed <= 34) {
          diagnosis = `The sync request timed out after ${elapsed.toFixed(1)} seconds at the Next.js/Node.js rewrite proxy level (default limit is 30s). This happened during the '${stageInfo}' stage.`;
          remedy = "To resolve this, configure your live server Nginx configuration to bypass Next.js and proxy '/api/' requests directly to the FastAPI backend (port 8080).";
        } else if (elapsed >= 55 && elapsed <= 65) {
          diagnosis = `The sync request timed out after ${elapsed.toFixed(1)} seconds at the Nginx gateway level (default read limit is 60s). This happened during the '${stageInfo}' stage.`;
          remedy = "To resolve this, increase Nginx's 'proxy_read_timeout' to '600s' in your live server configuration block.";
        } else {
          diagnosis = `The sync request disconnected after ${elapsed.toFixed(1)} seconds during the '${stageInfo}' stage.`;
          remedy = "Verify your live server's proxy timeout settings and network connection.";
        }

        toast((t) => (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "450px" }}>
            <span style={{ fontSize: "0.95rem", fontWeight: "bold", color: "#b91c1c" }}>
              Odoo Sync Timeout Diagnosed
            </span>
            <span style={{ fontSize: "0.85rem", color: "#374151" }}>
              <strong>Diagnosis:</strong> {diagnosis}
            </span>
            <span style={{ fontSize: "0.85rem", color: "#1e40af", background: "#eff6ff", padding: "0.4rem 0.6rem", borderRadius: 4 }}>
              <strong>Solution:</strong> {remedy}
            </span>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                handleSync();
              }}
              style={{
                alignSelf: "flex-end",
                padding: "0.3rem 0.8rem",
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 600,
                boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)"
              }}
            >
              Try Again
            </button>
          </div>
        ), { duration: 25000 });
      } else {
        toast.error(e instanceof Error ? e.message : "Failed to sync LMS data");
      }
    } finally {
      setSyncing(false);
    }
  };

  const widgets = useMemo(() => asWidgets(dashboard?.layout), [dashboard?.layout]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!dashboard) return null;

  return (
    <DashboardCustomizationProvider
      dashboardId={id}
      organizationId={dashboard.organization_id}
      consistentColors={dashboard.layout?.consistent_colors}
      colorMappings={dashboard.layout?.color_mappings}
      fetchDataWithDate={!!dashboard.fetch_data_with_date}
      periodOptions={periodOptions}
      selectedPeriod={selectedPeriod}
      selectedPeriodType={selectedPeriodType}
    >
      <DashboardViewContent
        dashboard={dashboard}
        syncInfo={syncInfo}
        syncing={syncing}
        handleSync={handleSync}
        widgets={widgets}
        refreshCount={refreshCount}
        org={org}
        selectedPeriodType={selectedPeriodType}
        setSelectedPeriodType={setSelectedPeriodType}
        selectedPeriod={selectedPeriod}
        setSelectedPeriod={setSelectedPeriod}
        customPeriods={customPeriods}
        periodOptions={periodOptions}
      />
    </DashboardCustomizationProvider>
  );
}

function DashboardViewContent({
  dashboard,
  syncInfo,
  syncing,
  handleSync,
  widgets,
  refreshCount,
  org,
  selectedPeriodType,
  setSelectedPeriodType,
  selectedPeriod,
  setSelectedPeriod,
  customPeriods,
  periodOptions,
}: {
  dashboard: DashboardDetail;
  syncInfo: { has_odoo_graphs: boolean } | null;
  syncing: boolean;
  handleSync: () => void;
  widgets: Widget[];
  refreshCount: number;
  org: any;
  selectedPeriodType: string;
  setSelectedPeriodType: (s: string) => void;
  selectedPeriod: string;
  setSelectedPeriod: (s: string) => void;
  customPeriods: any[];
  periodOptions: any[];
}) {  const { isOrgAdmin, openGlobalModal } = useDashboardCustomization();
  const token = getAccessToken();


  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>{dashboard.name}</h2>
          {dashboard.description && (
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
              {dashboard.description}
            </p>
          )}
        </div>        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {dashboard.fetch_data_with_date && (
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>Period Type:</span>
                <select
                  value={selectedPeriodType}
                  onChange={(e) => setSelectedPeriodType(e.target.value)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    fontSize: "0.875rem",
                    background: "var(--surface)",
                    outline: "none"
                  }}
                >
                  {customPeriods.map((cp: any) => (
                    <option key={cp.custom_period_name} value={cp.custom_period_name}>
                      {cp.custom_period_name}
                    </option>
                  ))}
                  <option value="by_default">By Default</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>Reporting Period:</span>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    fontSize: "0.875rem",
                    background: "var(--surface)",
                    outline: "none"
                  }}
                >
                  <option value="">Select period...</option>
                  {periodOptions.map((opt: any) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {isOrgAdmin && (
            <button
              type="button"
              className="btn"
              onClick={openGlobalModal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                height: 38,
              }}
            >
              <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Customize Labels
            </button>
          )}
        </div>
      </div>

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
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>LMS Data Integration</h3>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
              This dashboard contains graphs generated via LMS integrated API.
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
            {syncing ? "Syncing LMS..." : "Load Latest LMS Data"}
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
              <WidgetWithPeriodSelector
                widget={w}
                organizationId={dashboard.organization_id}
                dashboardId={dashboard.id}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
