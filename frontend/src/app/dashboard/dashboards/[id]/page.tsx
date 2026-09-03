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
import { WidgetFullScreenNavigationProvider } from "./WidgetFullScreenContext";

import { WidgetSpinnerLoader } from "@/components/WidgetSpinnerLoader";

interface DashboardDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  layout: any;
  fetch_data_with_date?: boolean;
  date_fetching_config?: any;
  fetch_data_with_column?: boolean;
  column_fetching_config?: any;
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

  const [userPermissions, setUserPermissions] = useState<{
    can_view: boolean;
    can_edit: boolean;
    can_load_lms: boolean;
    can_change_period: boolean;
    can_use_unique_value: boolean;
  }>({
    can_view: true,
    can_edit: true,
    can_load_lms: true,
    can_change_period: true,
    can_use_unique_value: true,
  });

  useEffect(() => {
    if (!id || !token) return;
    const query = organizationId ? `?organization_id=${organizationId}` : "";
    api<{
      can_view: boolean;
      can_edit: boolean;
      can_load_lms: boolean;
      can_change_period: boolean;
      can_use_unique_value: boolean;
    }>(`/dashboards/${id}/my-permissions${query}`, { token })
      .then(setUserPermissions)
      .catch(() => {});
  }, [id, token, organizationId]);

  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    const query = organizationId ? `?organization_id=${organizationId}` : "";
    api<DashboardDetail>(`/dashboards/${id}${query}`, { token })
      .then(async (d) => {
        setDashboard(d);
        const dConfig = d?.date_fetching_config || {};
        if (dConfig.default_period_type) {
          setSelectedPeriodType(dConfig.default_period_type);
        }
        if (dConfig.default_year) {
          setSelectedPeriod(String(dConfig.default_year).trim());
        }
        if (d?.organization_id) {
          try {
            const orgData = await api<any>(`/organizations/${d.organization_id}`, { token });
            setOrg(orgData);
          } catch (e) {
            console.error("Failed to load org details", e);
          }
        }
      })
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

  // NOTE: org is already fetched inside the dashboard fetch callback above.
  // A separate useEffect here was causing a duplicate /organizations call on every load.

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
    if (!dashboard) return;
    const dConfig = dashboard.date_fetching_config || {};
    const defaultType = dConfig.default_period_type;

    if (!selectedPeriodType) {
      if (defaultType) {
        setSelectedPeriodType(defaultType);
      } else if (customPeriods.length > 0) {
        setSelectedPeriodType(customPeriods[0].custom_period_name);
      } else {
        setSelectedPeriodType("by_default");
      }
    } else if (
      selectedPeriodType !== "by_default" &&
      customPeriods.length > 0 &&
      !customPeriods.some((p: any) => p.custom_period_name === selectedPeriodType)
    ) {
      // If current type no longer exists in org periods, fall back
      setSelectedPeriodType(defaultType || customPeriods[0].custom_period_name);
    }
  }, [dashboard, customPeriods, selectedPeriodType]);

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
    const dConfig = dashboard?.date_fetching_config || {};
    const configuredYear = dConfig.default_year ? String(dConfig.default_year).trim() : "";
    if (configuredYear && opts.some((opt: any) => opt.value === configuredYear)) {
      return configuredYear;
    }
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
      if (!selectedPeriod || !periodOptions.some(opt => opt.value === selectedPeriod)) {
        setSelectedPeriod(findDefaultPeriod(periodOptions));
      }
    }
  }, [periodOptions, selectedPeriod]);

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

  if (loading) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(248, 250, 252, 0.75)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div
          className="effective-spinner"
          style={{
            width: 52,
            height: 52,
            borderWidth: 4,
          }}
        />
        <span
          className="effective-spinner-text"
          style={{
            marginTop: "1rem",
            fontSize: "0.9rem",
            fontWeight: 600,
            color: "#1e293b",
            background: "var(--surface, #ffffff)",
            padding: "0.4rem 1rem",
            borderRadius: 999,
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            border: "1px solid var(--border, #e2e8f0)",
            whiteSpace: "nowrap",
          }}
        >
          Loading dashboard data...
        </span>
      </div>
    );
  }
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
      fetchDataWithColumn={!!dashboard.fetch_data_with_column}
      columnFetchingConfig={dashboard.column_fetching_config}
    >
      <WidgetFullScreenNavigationProvider widgets={widgets}>
        <DashboardViewContent
          dashboard={dashboard}
          userPermissions={userPermissions}
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
      </WidgetFullScreenNavigationProvider>
    </DashboardCustomizationProvider>
  );
}

function DashboardViewContent({
  dashboard,
  userPermissions,
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
  userPermissions: {
    can_view: boolean;
    can_edit: boolean;
    can_load_lms: boolean;
    can_change_period: boolean;
    can_use_unique_value: boolean;
  };
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
}) {
  const {
    isOrgAdmin,
    openGlobalModal,
    isAnyWidgetLoading,
    isInitialLoad,
    hasNeverLoaded,
    selectedColumnValue,
    setSelectedColumnValue,
    selectedDashboardFilterValues,
    setSelectedDashboardFilterValues,
    isFilterPanelOpen,
    setIsFilterPanelOpen,
  } = useDashboardCustomization();
  const token = getAccessToken();

  // Specific column data fetching state
  const [columnValues, setColumnValues] = useState<string[]>([]);
  const [columnLoading, setColumnLoading] = useState(false);
  const columnConfig = dashboard.column_fetching_config || {};
  const specificColumnName = columnConfig.column_name || columnConfig.column_key || "Department";

  useEffect(() => {
    if (!dashboard.fetch_data_with_column || !dashboard.id || !token) return;
    setColumnLoading(true);
    const q = dashboard.organization_id ? `?organization_id=${dashboard.organization_id}` : "";
    api<{ ok: boolean; column_key: string; values: string[] }>(`/dashboards/${dashboard.id}/column-values${q}`, { token })
      .then((res) => {
        if (res?.values && Array.isArray(res.values)) {
          setColumnValues(res.values);
        }
      })
      .catch((err) => {
        console.error("Failed to load column values", err);
      })
      .finally(() => setColumnLoading(false));
  }, [dashboard.fetch_data_with_column, dashboard.id, dashboard.organization_id, token]);



  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>{dashboard.name}</h2>
          {dashboard.description && (
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
              {dashboard.description}
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          {/* Specific Column Data Fetching Filter */}
          {dashboard.fetch_data_with_column && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>
                {specificColumnName}:
              </span>
              <select
                value={selectedColumnValue}
                onChange={(e) => setSelectedColumnValue(e.target.value)}
                disabled={columnLoading}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: "6px",
                  border: selectedColumnValue ? "1.5px solid var(--accent, #3b82f6)" : "1px solid var(--border)",
                  fontSize: "0.875rem",
                  background: selectedColumnValue ? "rgba(59, 130, 246, 0.06)" : "var(--surface)",
                  color: selectedColumnValue ? "var(--accent, #2563eb)" : "inherit",
                  fontWeight: selectedColumnValue ? 600 : 400,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">All ({specificColumnName})</option>
                {columnValues.map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date-based reporting period selectors */}
          {dashboard.fetch_data_with_date && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>Period Type:</span>
                <select
                  value={selectedPeriodType}
                  disabled={!userPermissions.can_change_period}
                  onChange={(e) => setSelectedPeriodType(e.target.value)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    fontSize: "0.875rem",
                    background: "var(--surface)",
                    outline: "none",
                    opacity: !userPermissions.can_change_period ? 0.65 : 1,
                    cursor: !userPermissions.can_change_period ? "not-allowed" : "pointer",
                  }}
                >
                  {(() => {
                    const dbAllowed = dashboard.date_fetching_config?.allowed_period_types;
                    const allowedTypes = userPermissions.can_change_period
                      ? ["by_default", ...customPeriods.map((c: any) => c.custom_period_name)]
                      : (dbAllowed ? (dbAllowed.includes("by_default") ? dbAllowed : ["by_default", ...dbAllowed]) : ["by_default", ...customPeriods.map((c: any) => c.custom_period_name)]);
                    return (
                      <>
                        <option value="by_default">Data Entry</option>
                        {customPeriods
                          .filter((cp: any) => allowedTypes.includes(cp.custom_period_name))
                          .map((cp: any) => (
                            <option key={cp.custom_period_name} value={cp.custom_period_name}>
                              {cp.custom_period_name}
                            </option>
                          ))}
                      </>
                    );
                  })()}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>Reporting Period:</span>
                <select
                  value={selectedPeriod}
                  disabled={!userPermissions.can_change_period}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    fontSize: "0.875rem",
                    background: "var(--surface)",
                    outline: "none",
                    opacity: !userPermissions.can_change_period ? 0.65 : 1,
                    cursor: !userPermissions.can_change_period ? "not-allowed" : "pointer",
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
              {!userPermissions.can_change_period && (
                <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
                  🔒 Period locked by admin configuration
                </span>
              )}
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

      {/* Active Specific Column Filter Chip Bar */}
      {selectedColumnValue && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.5rem 0.75rem", background: "var(--surface)", borderRadius: "8px", border: "1px solid var(--border)" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>Active Filter:</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.2rem 0.6rem",
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              color: "#2563eb",
              borderRadius: 999,
              fontSize: "0.8rem",
              fontWeight: 500,
            }}
          >
            <strong>{specificColumnName}:</strong> {selectedColumnValue}
            <button
              type="button"
              onClick={() => setSelectedColumnValue("")}
              style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, fontSize: "0.9rem", lineHeight: 1 }}
              title="Remove filter"
            >
              ✕
            </button>
          </span>
          <button
            type="button"
            onClick={() => setSelectedColumnValue("")}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "#ef4444",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Clear Filter
          </button>
        </div>
      )}

      {/* === FULL-PAGE SPINNER: shown during initial cold load to prevent empty-shell flash === */}
      {(hasNeverLoaded || isInitialLoad) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(248, 250, 252, 0.75)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          <div
            className="effective-spinner"
            style={{ width: 52, height: 52, borderWidth: 4 }}
          />
          <span
            className="effective-spinner-text"
            style={{
              marginTop: "1rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "#1e293b",
              background: "var(--surface, #ffffff)",
              padding: "0.4rem 1rem",
              borderRadius: 999,
              boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
              border: "1px solid var(--border, #e2e8f0)",
              whiteSpace: "nowrap",
            }}
          >
            Loading dashboard data...
          </span>
        </div>
      )}

      {/* Main dashboard page section with relative positioning for local backdrop blur */}
      <div style={{ position: "relative", minHeight: "220px", width: "100%" }}>
        {/* === REFRESH OVERLAY: shown during filter/period re-fetches over widgets only (header remains clear and sharp) === */}
        {isAnyWidgetLoading && !isInitialLoad && !hasNeverLoaded && (
          <>
            {/* Backdrop blur covering widgets area */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 49,
                background: "rgba(248, 250, 252, 0.65)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                borderRadius: "var(--radius, 12px)",
                pointerEvents: "auto",
              }}
            />
            {/* Centered spinner badge pinned to the viewport center */}
            <div
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 100,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--surface, #ffffff)",
                padding: "1.25rem 2rem",
                borderRadius: "1rem",
                boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
                border: "1px solid var(--border, #e2e8f0)",
                pointerEvents: "none",
              }}
            >
              <div
                className="effective-spinner"
                style={{ width: 50, height: 50, borderWidth: 4 }}
              />
              <span
                className="effective-spinner-text"
                style={{
                  marginTop: "0.85rem",
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: "#0f172a",
                  letterSpacing: "0.01em",
                  whiteSpace: "nowrap",
                }}
              >
                Applying filter...
              </span>
            </div>
          </>
        )}
        {syncInfo?.has_odoo_graphs && userPermissions.can_load_lms && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              background: "var(--surface)",
              borderRadius: "var(--radius, 8px)",
              border: "1px solid var(--border)",
              marginBottom: "1rem"
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

        {/* Backdrop blur removed — per-widget skeletons handle the initial load state;
            the slim top-bar handles refresh state. Full-page blur was blocking interaction. */}
      </div>
    </div>
  );
}
