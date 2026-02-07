"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

export interface OverviewItem {
  kpi_id: number;
  kpi_name: string;
  kpi_year: number;
  assigned_user_names?: string[];
  assigned_users?: Array<{ display_name: string; email: string | null; permission?: string }>;
  /** Current user's permission for this KPI: data_entry (can edit) or view (read-only) */
  current_user_permission?: "data_entry" | "view";
  entry: {
    id: number;
    is_draft: boolean;
    is_locked: boolean;
    submitted_at: string | null;
    preview: Array<{ field_name: string; value: string }>;
    entered_by_user_name?: string | null;
    last_updated_at?: string | null;
    data_entry_user_is_assigned?: boolean;
  } | null;
}

interface KpiRow {
  id: number;
  name: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return new URLSearchParams(entries as Record<string, string>).toString();
}

export interface KpiCardsGridProps {
  organizationId: number;
  year: number;
  domainId?: number;
  /** When domainId is set, pass pre-filtered KPIs (e.g. by tag/category) to show; otherwise component fetches KPIs for domain. */
  kpisOverride?: KpiRow[];
  /** Optional name filter applied client-side to the KPI list */
  filterName?: string;
  /** Filter by entry status (client-side from overview) */
  statusFilter?: "all" | "submitted" | "draft" | "not_entered" | "no_user_assigned";
  /** Loading and error from parent (e.g. domain page) when using kpisOverride */
  loading?: boolean;
  error?: string | null;
  /** Empty message when no KPIs */
  emptyMessage?: string;
  /** Called when the filtered KPI count changes (for parent to show in heading) */
  onFilteredCountChange?: (count: number) => void;
  /** When true, show only KPIs where current user has data_entry permission (for "Only assigned to me" toggle) */
  assignedToMeOnly?: boolean;
}

export function KpiCardsGrid({
  organizationId,
  year,
  domainId,
  kpisOverride,
  filterName = "",
  statusFilter = "all",
  loading: parentLoading,
  error: parentError,
  emptyMessage,
  onFilteredCountChange,
  assignedToMeOnly = false,
}: KpiCardsGridProps) {
  const token = getAccessToken();
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingKpis, setLoadingKpis] = useState(!!domainId && !kpisOverride);

  const loadOverview = () => {
    if (!token || !organizationId) return;
    setLoadingOverview(true);
    const query = `?${qs({ year, organization_id: organizationId })}`;
    api<OverviewItem[]>(`/entries/overview${query}`, { token })
      .then(setOverview)
      .catch(() => setOverview([]))
      .finally(() => setLoadingOverview(false));
  };

  useEffect(() => {
    loadOverview();
  }, [token, organizationId, year]);

  useEffect(() => {
    if (!token || !organizationId || !domainId || kpisOverride !== undefined) return;
    setLoadingKpis(true);
    const query = `?${qs({ organization_id: organizationId, domain_id: domainId })}`;
    api<KpiRow[]>(`/kpis${query}`, { token })
      .then(setKpis)
      .catch(() => setKpis([]))
      .finally(() => setLoadingKpis(false));
  }, [token, organizationId, domainId, kpisOverride]);

  const listToShow = useMemo(() => {
    if (kpisOverride !== undefined) return kpisOverride;
    if (domainId != null) return kpis;
    return overview.map((o) => ({ id: o.kpi_id, name: o.kpi_name }));
  }, [domainId, kpisOverride, kpis, overview]);

  const overviewByKpiId = useMemo(() => {
    const map = new Map<number, OverviewItem>();
    overview.forEach((o) => map.set(o.kpi_id, o));
    return map;
  }, [overview]);

  const getStatus = (k: KpiRow): "submitted" | "draft" | "not_entered" | "no_user_assigned" => {
    const item = overviewByKpiId.get(k.id);
    const hasEntry = item?.entry != null;
    const assignedCount = item?.assigned_user_names?.length ?? 0;
    const noAssigned = assignedCount === 0;
    if (hasEntry && !item!.entry!.is_draft && item!.entry!.submitted_at != null) return "submitted";
    if (hasEntry && item!.entry!.is_draft) return "draft";
    if (!hasEntry && noAssigned) return "no_user_assigned";
    return "not_entered"; // no entry but has assigned users
  };

  const filteredKpis = useMemo(() => {
    let list = listToShow;
    const search = filterName.trim().toLowerCase();
    if (search) list = list.filter((k) => k.name.toLowerCase().includes(search));
    if (assignedToMeOnly) {
      list = list.filter((k) => {
        const item = overviewByKpiId.get(k.id);
        return (item?.current_user_permission ?? "data_entry") === "data_entry";
      });
    }
    if (statusFilter !== "all") {
      list = list.filter((k) => getStatus(k) === statusFilter);
    }
    const order = (k: KpiRow): number => {
      const s = getStatus(k);
      if (s === "submitted") return 0;
      if (s === "draft") return 1;
      if (s === "not_entered") return 2;
      return 3; // no_user_assigned
    };
    return [...list].sort((a, b) => order(a) - order(b));
  }, [listToShow, filterName, statusFilter, overviewByKpiId, assignedToMeOnly]);

  useEffect(() => {
    onFilteredCountChange?.(filteredKpis.length);
  }, [filteredKpis.length, onFilteredCountChange]);

  const loading = parentLoading ?? (loadingOverview || (!!domainId && !kpisOverride && loadingKpis));
  const error = parentError;

  const detailHref = (kpiId: number) =>
    domainId != null
      ? `/dashboard/domains/${domainId}/kpis/${kpiId}?year=${year}&organization_id=${organizationId}`
      : `/dashboard/entries/kpi/${kpiId}?year=${year}&organization_id=${organizationId}`;

  if (loading && overview.length === 0 && filteredKpis.length === 0) {
    return <p>Loading...</p>;
  }

  if (error) {
    return <p className="form-error">{error}</p>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
      {filteredKpis.map((kpi) => {
        const item = overviewByKpiId.get(kpi.id);
        const hasEntry = item?.entry != null;
        const status = !hasEntry ? "not_entered" : item!.entry.is_locked ? "locked" : item!.entry.is_draft ? "draft" : "submitted";
        const preview = hasEntry && item!.entry.preview ? item!.entry.preview : [];
        const assignedCount = item?.assigned_user_names?.length ?? 0;
        const assignedUsers = item?.assigned_users ?? [];
        const noAssigned = assignedCount === 0;
        const lastUpdatedFormatted =
          item?.entry?.last_updated_at &&
          (() => {
            const d = new Date(item.entry!.last_updated_at!);
            return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en", { month: "short" })}-${String(d.getFullYear()).slice(-2)}`;
          })();
        const reminderEmails = assignedUsers.map((u) => u.email).filter(Boolean).join(", ");
        const isViewOnly = item?.current_user_permission === "view";

        return (
          <Link
            key={kpi.id}
            href={detailHref(kpi.id)}
            style={{
              textDecoration: "none",
              color: "inherit",
              display: "block",
              ...(noAssigned ? { boxShadow: "0 0 0 2px var(--warning, #b8860b)", borderRadius: 8 } : {}),
            }}
            className="card"
          >
            <div
              style={{
                paddingBottom: "0.75rem",
                marginBottom: "0.75rem",
                borderBottom: "1px solid var(--border, #e5e7eb)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Year {year}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                {isViewOnly && (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      padding: "0.15rem 0.4rem",
                      borderRadius: 4,
                      background: "var(--muted)",
                      color: "var(--text)",
                    }}
                  >
                    View only
                  </span>
                )}
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    padding: "0.2rem 0.45rem",
                    borderRadius: 4,
                    flexShrink: 0,
                    ...(status === "not_entered" && noAssigned
                      ? { background: "var(--error, #dc2626)", color: "#fff" }
                      : status === "not_entered"
                        ? { background: "var(--warning)", color: "var(--on-muted)" }
                        : status === "draft"
                          ? { background: "var(--warning)", color: "var(--on-muted)" }
                          : status === "submitted"
                            ? { background: "var(--success)", color: "var(--on-muted)" }
                            : { background: "var(--muted)", color: "var(--text)" }),
                  }}
                >
                  {status === "not_entered" && noAssigned
                    ? "No User Assigned"
                    : status === "not_entered"
                      ? "Not entered"
                      : status === "draft"
                        ? "Draft"
                        : status === "submitted"
                          ? "Submitted"
                          : "Locked"}
                </span>
                </span>
              </div>
              <h3
                style={{
                  fontSize: "1.05rem",
                  fontWeight: 600,
                  margin: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={kpi.name}
              >
                {kpi.name}
              </h3>
            </div>

            <div
              style={{
                paddingBottom: "0.75rem",
                marginBottom: "0.75rem",
                borderBottom: "1px solid var(--border, #e5e7eb)",
                minHeight: "2rem",
              }}
            >
              {preview.length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {preview.map((p, i) => (
                    <li key={i} style={{ fontSize: "0.9rem", marginBottom: "0.35rem", color: "var(--muted)" }}>
                      <strong style={{ color: "var(--text)" }}>{p.field_name}:</strong> {p.value || "—"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
                  {hasEntry ? "No field values yet" : "No data for this year"}
                </p>
              )}
              {!hasEntry && (
                <p style={{ fontSize: "0.8rem", margin: "0.5rem 0 0 0", color: "var(--muted)" }}>
                  {assignedCount > 0 ? (
                    <>
                      Data has not been uploaded by {item!.assigned_user_names!.join(", ")}.
                      {reminderEmails ? (
                        <>
                          {" "}
                          Give a reminder:{" "}
                          <a
                            href={`mailto:${reminderEmails}`}
                            style={{ color: "var(--primary)" }}
                            onClick={(e) => e.stopPropagation()}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {reminderEmails}
                          </a>
                        </>
                      ) : (
                        " Give a reminder."
                      )}
                    </>
                  ) : (
                    <span style={{ color: "var(--warning, #b8860b)" }}>
                      Assign user to upload data entry or add data yourself.
                    </span>
                  )}
                </p>
              )}
            </div>

            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              {hasEntry && (item?.entry?.last_updated_at || item?.entry?.entered_by_user_name) ? (
                <p style={{ margin: 0 }}>
                  Last updated: {lastUpdatedFormatted || ""}
                  {item?.entry?.entered_by_user_name ? (lastUpdatedFormatted ? " by " : "") + item.entry.entered_by_user_name : ""}
                </p>
              ) : (
                <>
                  {assignedCount > 0 ? (
                    <p style={{ margin: 0 }}>Assigned for data entry: {item!.assigned_user_names!.join(", ")}</p>
                  ) : (
                    <p style={{ margin: 0, color: "var(--warning, #b8860b)", fontWeight: 500 }}>No data entry user assigned.</p>
                  )}
                </>
              )}
            </div>
          </Link>
        );
      })}
      {filteredKpis.length === 0 && (
        <p style={{ color: "var(--muted)", marginTop: "0.5rem", gridColumn: "1 / -1" }}>
          {emptyMessage ?? (domainId != null ? "No KPIs in this domain." : "No KPIs in this organization.")}
        </p>
      )}
    </div>
  );
}
