"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

const TIME_DIMENSION_ORDER = ["yearly", "half_yearly", "quarterly", "monthly"] as const;
const TIME_DIMENSION_LABELS: Record<string, string> = {
  yearly: "Yearly",
  half_yearly: "Half-yearly",
  quarterly: "Quarterly",
  monthly: "Monthly",
};

/** Tag-based card accent colors (border-left + subtle bg) for org_admin cards. Same tag(s) = same color. */
const CARD_TAG_COLORS = [
  { border: "#6366f1", bg: "rgba(99, 102, 241, 0.06)" },
  { border: "#059669", bg: "rgba(5, 150, 105, 0.06)" },
  { border: "#dc2626", bg: "rgba(220, 38, 38, 0.06)" },
  { border: "#d97706", bg: "rgba(217, 119, 6, 0.06)" },
  { border: "#7c3aed", bg: "rgba(124, 58, 237, 0.06)" },
  { border: "#0d9488", bg: "rgba(13, 148, 136, 0.06)" },
  { border: "#2563eb", bg: "rgba(37, 99, 235, 0.06)" },
  { border: "#4f46e5", bg: "rgba(79, 70, 229, 0.06)" },
];
function getCardColorForTags(tagNames: string[]): { border: string; bg: string } {
  if (tagNames.length === 0) return { border: "var(--border, #e5e7eb)", bg: "transparent" };
  let n = 0;
  for (let i = 0; i < tagNames.length; i++) {
    for (let j = 0; j < (tagNames[i] ?? "").length; j++) n += (tagNames[i].charCodeAt(j) ?? 0);
  }
  return CARD_TAG_COLORS[Math.abs(n) % CARD_TAG_COLORS.length];
}

export interface OverviewItem {
  kpi_id: number;
  kpi_name: string;
  kpi_year: number;
  kpi_description?: string | null;
  entry_mode?: string | null;
  organization_tag_names?: string[];
  assigned_user_names?: string[];
  assigned_role_names?: string[];
  assigned_users?: Array<{ display_name: string; email: string | null; permission?: string }>;
  current_user_permission?: "data_entry" | "view";
  org_time_dimension?: string;
  kpi_time_dimension?: string | null;
  effective_time_dimension?: string;
  /** Per-period entries when KPI has sub-periods (e.g. Q1–Q4). */
  entries?: Array<{
    period_key: string;
    period_display: string;
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
  }>;
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
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
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
  /** "org_admin" = card layout for org admin entries page (name, description, last updated; top row: time dimension + entry method) */
  cardLayout?: "default" | "org_admin";
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
  cardLayout = "default",
}: KpiCardsGridProps) {
  const token = getAccessToken();
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingKpis, setLoadingKpis] = useState(!!domainId && !kpisOverride);
  /** When overview is empty on org_admin entries page, fallback list from GET /entries/available-kpis so org admin still sees all KPIs. */
  const [availableKpisFallback, setAvailableKpisFallback] = useState<KpiRow[]>([]);
  const [loadingFallback, setLoadingFallback] = useState(false);

  const loadOverview = () => {
    if (!token || !organizationId) return;
    setLoadingOverview(true);
    setAvailableKpisFallback([]);
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

  // Org admin entries page: when overview is empty, fetch available-kpis so we still show all KPIs
  useEffect(() => {
    if (
      !token ||
      !organizationId ||
      cardLayout !== "org_admin" ||
      domainId != null ||
      kpisOverride !== undefined ||
      loadingOverview ||
      overview.length > 0
    ) {
      if (overview.length > 0) setAvailableKpisFallback([]);
      return;
    }
    setLoadingFallback(true);
    api<KpiRow[]>(`/entries/available-kpis?${qs({ organization_id: organizationId })}`, { token })
      .then((list) => setAvailableKpisFallback(Array.isArray(list) ? list : []))
      .catch(() => setAvailableKpisFallback([]))
      .finally(() => setLoadingFallback(false));
  }, [token, organizationId, cardLayout, domainId, kpisOverride, loadingOverview, overview.length]);

  const listToShow = useMemo(() => {
    if (kpisOverride !== undefined) return kpisOverride;
    if (domainId != null) return kpis;
    if (overview.length > 0) return overview.map((o) => ({ id: o.kpi_id, name: o.kpi_name }));
    return availableKpisFallback;
  }, [domainId, kpisOverride, kpis, overview, availableKpisFallback]);

  const overviewByKpiId = useMemo(() => {
    const map = new Map<number, OverviewItem>();
    overview.forEach((o) => map.set(o.kpi_id, o));
    return map;
  }, [overview]);

  const getStatus = (k: KpiRow): "submitted" | "draft" | "not_entered" | "no_user_assigned" => {
    const item = overviewByKpiId.get(k.id);
    const hasEntry = item?.entry != null;
    const assignedCount = (item?.assigned_role_names?.length ?? 0) || (item?.assigned_user_names?.length ?? 0);
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

  const loading =
    parentLoading ??
    (loadingOverview ||
      loadingFallback ||
      (!!domainId && !kpisOverride && loadingKpis));
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
        const entry = item?.entry ?? null;
        const hasEntry = entry != null;
        const status = !hasEntry ? "not_entered" : entry.is_locked ? "locked" : entry.is_draft ? "draft" : "submitted";
        const preview = hasEntry && entry.preview ? entry.preview : [];
    const assignedUserCount = item?.assigned_user_names?.length ?? 0;
    const assignedRoleCount = item?.assigned_role_names?.length ?? 0;
    const assignedCount = assignedRoleCount || assignedUserCount;
    const assignedUsers = item?.assigned_users ?? [];
    const noAssigned = assignedCount === 0;
    const assignedDisplay = (item?.assigned_role_names?.length ? item.assigned_role_names.join(", ") : null) ?? (item?.assigned_user_names?.length ? item.assigned_user_names.join(", ") : "");
        const lastUpdatedFormatted =
          item?.entry?.last_updated_at &&
          (() => {
            const d = new Date(item.entry!.last_updated_at!);
            return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en", { month: "short" })}-${String(d.getFullYear()).slice(-2)}`;
          })();
        const reminderEmails = assignedUsers.map((u) => u.email).filter(Boolean).join(", ");
        const isViewOnly = item?.current_user_permission === "view";
        const entryModeLabel = (item?.entry_mode ?? "manual") === "api" ? "API" : "Manual";
        const timeDimensionLabel = item?.effective_time_dimension
          ? (TIME_DIMENSION_LABELS[item.effective_time_dimension] ?? item.effective_time_dimension)
          : null;

        if (cardLayout === "org_admin") {
          const tagNames = item?.organization_tag_names ?? [];
          const cardColor = getCardColorForTags(tagNames);
          const SECTION_TOP_HEIGHT = "2.25rem";
          const SECTION_TAGS_HEIGHT = "1.75rem";
          const SECTION_NAME_HEIGHT = "2.75rem";
          const SECTION_DESC_HEIGHT = "3.75rem";
          const SECTION_FOOTER_HEIGHT = "2.25rem";
          return (
            <Link
              key={kpi.id}
              href={detailHref(kpi.id)}
              style={{
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 200,
                borderLeftWidth: 4,
                borderLeftStyle: "solid",
                borderLeftColor: cardColor.border,
                background: cardColor.bg,
                borderRadius: 8,
                ...(noAssigned ? { boxShadow: "0 0 0 2px var(--warning, #b8860b)" } : {}),
              }}
              className="card"
            >
              {/* Section: Top row — time dimension (left), data entry method (right) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  height: SECTION_TOP_HEIGHT,
                  minHeight: SECTION_TOP_HEIGHT,
                  paddingBottom: "0.5rem",
                  borderBottom: "1px solid var(--border, #e5e7eb)",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>
                  {timeDimensionLabel ?? "—"}
                </span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    padding: "0.2rem 0.5rem",
                    borderRadius: 6,
                    background: "var(--accent-muted, #e8e8e8)",
                    color: "var(--text)",
                  }}
                >
                  {entryModeLabel}
                </span>
              </div>
              {/* Section: KPI name — fixed height, max 2 lines */}
              <div
                style={{
                  minHeight: SECTION_NAME_HEIGHT,
                  height: SECTION_NAME_HEIGHT,
                  display: "flex",
                  alignItems: "flex-start",
                  paddingTop: "0.5rem",
                  paddingBottom: "0.5rem",
                  borderBottom: "1px solid var(--border, #e5e7eb)",
                  flexShrink: 0,
                }}
              >
                <h3
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 600,
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    lineHeight: 1.3,
                  }}
                  title={kpi.name}
                >
                  {kpi.name || "—"}
                </h3>
              </div>
              {/* Section: Description — fixed height, max 3 lines, empty space if none */}
              <div
                style={{
                  minHeight: SECTION_DESC_HEIGHT,
                  height: SECTION_DESC_HEIGHT,
                  paddingTop: "0.5rem",
                  paddingBottom: "0.5rem",
                  borderBottom: "1px solid var(--border, #e5e7eb)",
                  flexShrink: 0,
                }}
              >
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--muted)",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    lineHeight: 1.35,
                  }}
                >
                  {(item?.kpi_description ?? "").trim() || " "}
                </p>
              </div>
              {/* Section: Tags — one line below description, ellipsis + hover for full text */}
              <div
                style={{
                  minHeight: SECTION_TAGS_HEIGHT,
                  height: SECTION_TAGS_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  paddingTop: "0.35rem",
                  paddingBottom: "0.35rem",
                  borderBottom: "1px solid var(--border, #e5e7eb)",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                {tagNames.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  >
                    {tagNames.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        title={tag}
                        style={{
                          fontSize: "0.7rem",
                          padding: "0.15rem 0.4rem",
                          borderRadius: 999,
                          background: "var(--accent-muted, #eef2ff)",
                          color: "var(--accent, #4f46e5)",
                          fontWeight: 500,
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flexShrink: 1,
                          minWidth: 0,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>—</span>
                )}
              </div>
              {/* Section: Last updated — fixed height */}
              <div
                style={{
                  minHeight: SECTION_FOOTER_HEIGHT,
                  height: SECTION_FOOTER_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  paddingTop: "0.4rem",
                  flexShrink: 0,
                  fontSize: "0.8rem",
                  color: "var(--muted)",
                }}
              >
                {hasEntry && (item?.entry?.last_updated_at || item?.entry?.entered_by_user_name) ? (
                  <span>
                    Last updated: {lastUpdatedFormatted || ""}
                    {item?.entry?.entered_by_user_name
                      ? (lastUpdatedFormatted ? " by " : "") + item.entry.entered_by_user_name
                      : ""}
                  </span>
                ) : assignedCount > 0 ? (
                  <span>Assigned: {assignedDisplay}</span>
                ) : (
                  <span style={{ color: "var(--warning, #b8860b)", fontWeight: 500 }}>
                    No data entry user assigned.
                  </span>
                )}
              </div>
            </Link>
          );
        }

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
              {item?.effective_time_dimension && (
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0 0 0" }}>
                  Time: {TIME_DIMENSION_LABELS[item.effective_time_dimension] ?? item.effective_time_dimension}
                </p>
              )}
              {Array.isArray(item?.entries) && item.entries.length > 1 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.35rem" }}>
                  {item.entries.map(({ period_display: label, entry: periodEntry }) => {
                    const isSubmitted = periodEntry && !periodEntry.is_draft && periodEntry.submitted_at;
                    const isDraft = periodEntry?.is_draft ?? false;
                    return (
                      <span
                        key={label}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.4rem",
                          borderRadius: 4,
                          border: `1px solid ${isSubmitted ? "var(--success)" : isDraft ? "var(--warning)" : "var(--border)"}`,
                          background: isSubmitted ? "var(--success)" : isDraft ? "var(--warning)" : "transparent",
                          color: "var(--text)",
                        }}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
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
                      Data has not been uploaded by {assignedDisplay}.
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
                    <p style={{ margin: 0 }}>Assigned for data entry: {assignedDisplay}</p>
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
