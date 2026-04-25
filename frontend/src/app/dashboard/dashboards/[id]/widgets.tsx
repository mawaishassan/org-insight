"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { fetchAllMultiItemsRows, getKpiFieldsWithSubs, type KpiFieldWithSubs } from "@/lib/fetchMultiItemsRows";
import type { MultiItemsFilterPayloadV2 } from "@/lib/multi-line-filter-payload";
import {
  isLikelyAbortError,
  isWidgetDataBundleEnabled,
  postDashboardChartWidgetData,
  postDashboardChartWidgetDataBatch,
  postDashboardCardWidgetData,
  postDashboardLineWidgetData,
  postDashboardSingleValueWidgetData,
  postDashboardKvTableWidgetData,
  postDashboardTableWidgetData,
  postDashboardTrendWidgetData,
  postWidgetData,
} from "@/lib/widgetData";

// Batch bar/pie chart loads to avoid browser connection queuing when dashboards contain many charts.
type ChartBatchKey = string;
type PendingChart = {
  token: string;
  organizationId: number;
  dashboardId: number;
  widgetId: string;
  widget: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  resolve: (v: any) => void;
  reject: (e: any) => void;
};
const pendingChartBatches = new Map<
  ChartBatchKey,
  { timer: any; items: PendingChart[]; inFlight?: Promise<void> }
>();

function enqueueDashboardChartBatch(req: Omit<PendingChart, "resolve" | "reject">): Promise<any> {
  const key = `${req.token}::${req.organizationId}::${req.dashboardId}`;
  return new Promise((resolve, reject) => {
    const item: PendingChart = { ...req, resolve, reject };
    const cur = pendingChartBatches.get(key) ?? { timer: null, items: [] as PendingChart[] };
    cur.items.push(item);
    if (!cur.timer) {
      cur.timer = setTimeout(async () => {
        const batch = pendingChartBatches.get(key);
        if (!batch) return;
        pendingChartBatches.delete(key);
        const items = batch.items;
        if (items.length === 0) return;
        try {
          const res = await postDashboardChartWidgetDataBatch(
            req.token,
            {
              version: 1,
              organization_id: req.organizationId,
              dashboard_id: req.dashboardId,
              items: items.map((x) => ({ widget: x.widget, overrides: x.overrides })),
            },
            undefined
          );
          items.forEach((x, idx) => {
            const k = x.widgetId || `idx:${idx}`;
            const r = res?.results?.[k] ?? res?.results?.[`idx:${idx}`];
            if (r && r.ok) x.resolve(r);
            else x.reject(new Error(r?.error || "Chart batch failed"));
          });
        } catch (e) {
          items.forEach((x) => x.reject(e));
        }
      }, 0);
    }
    pendingChartBatches.set(key, cur);
  });
}
export type WidgetDesignMenuActions = {
  onEdit: () => void;
  onDelete: () => void;
  onToggleFullWidth: () => void;
  isFullWidth: boolean;
  /** Current span when not full width (1–12). */
  colSpan: number;
  onSetColSpan: (span: number) => void;
};

const WidgetViewerMenuSetterContext = createContext<React.Dispatch<React.SetStateAction<React.ReactNode>> | null>(null);
const WidgetHeaderAddonSetterContext = createContext<React.Dispatch<React.SetStateAction<React.ReactNode>> | null>(null);

function useWidgetViewerMenuSetter() {
  return useContext(WidgetViewerMenuSetterContext);
}

function useWidgetHeaderAddonSetter() {
  return useContext(WidgetHeaderAddonSetterContext);
}

const PALETTE_SCHEMES: Record<string, string[]> = {
  tableau10: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"],
  set2: ["#66C2A5", "#FC8D62", "#8DA0CB", "#E78AC3", "#A6D854", "#FFD92F", "#E5C494", "#B3B3B3"],
  dark2: ["#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E", "#E6AB02", "#A6761D", "#666666"],
  pastel1: ["#FBB4AE", "#B3CDE3", "#CCEBC5", "#DECBE4", "#FED9A6", "#FFFFCC", "#E5D8BD", "#FDDAEC", "#F2F2F2"],
  okabe_ito: ["#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"],
};

function paletteForScheme(scheme: string | undefined, count: number) {
  const colors = (scheme && PALETTE_SCHEMES[scheme]) || PALETTE_SCHEMES.tableau10;
  const n = Math.max(2, Math.min(12, Math.trunc(count)));
  return colors.slice(0, n);
}

export type Widget =
  | { id: string; type: "text"; title?: string; text?: string; full_width?: boolean; col_span?: number }
  | {
      id: string;
      type: "kpi_single_value";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      field_key: string;
      full_width?: boolean;
      col_span?: number;
    }
  | {
      id: string;
      type: "kpi_table";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      field_keys?: string[];
      full_width?: boolean;
      col_span?: number;
    }
  | {
      id: string;
      type: "kpi_line_chart";
      title?: string;
      kpi_id: number;
      field_key: string;
      start_year: number;
      end_year: number;
      period_key?: string | null;
      full_width?: boolean;
      col_span?: number;
    }
  | {
      id: string;
      type: "kpi_bar_chart";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      chart_type?: "bar" | "pie";
      mode?: "fields" | "multi_line_items";
      field_keys?: string[];
      /** Sort bars left-to-right by x-axis label or by value. */
      sort_by?: "x" | "value";
      sort_dir?: "asc" | "desc";
      /** Bar color scheme (for bar charts). */
      bar_color_mode?: "solid" | "palette" | "gradient";
      bar_color?: string;
      bar_palette?: string[];
      bar_palette_scheme?: string;
      bar_gradient_from?: string;
      bar_gradient_to?: string;
      // multi_line_items mode
      source_field_key?: string;
      agg?: "count_rows" | "sum" | "avg";
      group_by_sub_field_key?: string;
      value_sub_field_key?: string;
      filter_sub_field_key?: string;
      /** Optional viewer-facing label for filter button */
      filter_label?: string;
      /** Advanced multi-line row filters (SUPER_ADMIN) */
      filters?: MultiItemsFilterPayloadV2 | null;
      full_width?: boolean;
      col_span?: number;
    }
  | {
      id: string;
      type: "kpi_trend";
      title?: string;
      kpi_id: number;
      period_key?: string | null;
      /** Year range available to viewers (multi-select subset). */
      start_year: number;
      end_year: number;
      /** Default visualization in viewer. */
      view?: "bar" | "line";
      /** Default years selected for comparison in viewer. */
      default_years?: number[];
      mode?: "fields" | "multi_line_items";
      /** fields mode: scalar KPI value fields */
      field_keys?: string[];
      /** Sort categories left-to-right by label or by value. */
      sort_by?: "x" | "value";
      sort_dir?: "asc" | "desc";
      /** Color scheme for multi-series bars/lines. */
      bar_color_mode?: "solid" | "palette" | "gradient";
      bar_color?: string;
      bar_palette?: string[];
      bar_palette_scheme?: string;
      bar_gradient_from?: string;
      bar_gradient_to?: string;
      // multi_line_items mode
      source_field_key?: string;
      agg?: "count_rows" | "sum" | "avg";
      group_by_sub_field_key?: string;
      value_sub_field_key?: string;
      filter_sub_field_key?: string;
      /** Optional viewer-facing label for filter button */
      filter_label?: string;
      /** Advanced multi-line row filters (SUPER_ADMIN) */
      filters?: MultiItemsFilterPayloadV2 | null;
      full_width?: boolean;
      col_span?: number;
    }
  | {
      id: string;
      type: "kpi_card_single_value";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      source_mode: "field" | "multi_line_agg" | "static";
      field_key?: string;
      source_field_key?: string;
      agg?: "sum" | "avg" | "count" | "min" | "max";
      value_sub_field_key?: string;
      static_value?: number | string;
      subtitle?: string;
      prefix?: string;
      suffix?: string;
      decimals?: number;
      thousand_sep?: boolean;
      align?: "left" | "center" | "right";
      title_size?: number;
      value_size?: number;
      subtitle_size?: number;
      title_weight?: 400 | 500 | 600 | 700 | 800;
      value_weight?: 400 | 500 | 600 | 700 | 800;
      theme?: string;
      allow_custom_colors?: boolean;
      bg_color?: string;
      fg_color?: string;
      /** Advanced multi-line row filters (SUPER_ADMIN) */
      filters?: MultiItemsFilterPayloadV2 | null;
      full_width?: boolean;
      col_span?: number;
    }
  | {
      id: string;
      type: "kpi_multi_line_table";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      /** Multi-line items field key on the KPI */
      source_field_key: string;
      /** Sub-field keys viewers are allowed to see (SA configures) */
      sub_field_keys: string[];
      /** Viewer row limit for embedded widget. */
      rows_limit?: number;
      /** Display order for combined columns (primary + join:...). */
      column_order?: string[];
      /** Advanced multi-line row filters (SUPER_ADMIN) */
      filters?: MultiItemsFilterPayloadV2 | null;
      /** Optional join to another KPI's multi-line items (acts like a lookup join). */
      join?: {
        kpi_id: number;
        source_field_key: string;
        /** Key in left (primary) items used to match. */
        on_left_sub_field_key: string;
        /** Key in right (joined) items used to match. */
        on_right_sub_field_key: string;
        /** Sub-field keys to show from joined KPI. */
        sub_field_keys: string[];
      };
      full_width?: boolean;
      col_span?: number;
    };

type KpiFieldMap = { idByKey: Record<string, number>; keyById: Record<number, string>; nameByKey: Record<string, string> };

function fieldMapFromServerBundle(
  d: Record<string, unknown>
): { idByKey: Record<string, number>; nameByKey: Record<string, string>; keyById: Record<number, string> } {
  const fm = d.field_map as { id_by_key?: Record<string, number>; name_by_key?: Record<string, string> } | undefined;
  if (!fm?.id_by_key) return { idByKey: {}, nameByKey: {}, keyById: {} };
  const idByKey = { ...fm.id_by_key };
  const nameByKey: Record<string, string> = { ...(fm.name_by_key || {}) };
  const keyById: Record<number, string> = {};
  Object.entries(idByKey).forEach(([k, id]) => {
    keyById[Number(id)] = k;
  });
  return { idByKey, nameByKey, keyById };
}

const _kpiFieldMapCache: Record<string, Promise<KpiFieldMap> | undefined> = {};

async function getKpiFieldMap(token: string, organizationId: number, kpiId: number): Promise<KpiFieldMap> {
  const cacheKey = `${organizationId}:${kpiId}`;
  if (_kpiFieldMapCache[cacheKey]) return _kpiFieldMapCache[cacheKey];
  const build = (fields: Array<{ id: number; key: string; name: string }>) => {
      const idByKey: Record<string, number> = {};
      const keyById: Record<number, string> = {};
      const nameByKey: Record<string, string> = {};
      fields.forEach((f) => {
        idByKey[f.key] = f.id;
        keyById[f.id] = f.key;
        nameByKey[f.key] = f.name;
      });
      return { idByKey, keyById, nameByKey };
  };

  _kpiFieldMapCache[cacheKey] = api<Array<{ id: number; key: string; name: string }>>(
    `/entries/fields?kpi_id=${kpiId}&organization_id=${organizationId}`,
    { token }
  )
    .then((fields) => {
      if (Array.isArray(fields) && fields.length) return build(fields);
      return api<Array<{ id: number; key: string; name: string }>>(`/fields?kpi_id=${kpiId}&organization_id=${organizationId}`, { token }).then(build);
    })
    .catch(() => ({ idByKey: {}, keyById: {}, nameByKey: {} }));
  return _kpiFieldMapCache[cacheKey];
}

const DESIGN_COL_SPAN_OPTIONS: { span: number; label: string }[] = [
  { span: 12, label: "Full row (12)" },
  { span: 8, label: "⅔ row (8)" },
  { span: 6, label: "Half (6)" },
  { span: 4, label: "⅓ row (4)" },
  { span: 3, label: "¼ row (3)" },
  { span: 2, label: "⅙ row (2)" },
  { span: 1, label: "1 column (1)" },
];

function MenuRow({
  children,
  onClick,
  danger,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "0.5rem 0.75rem",
        border: "none",
        background: active ? "var(--border, #e5e5e5)" : "transparent",
        fontSize: "0.9rem",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        color: danger ? "var(--danger, #c00)" : "var(--text)",
      }}
    >
      {children}
    </button>
  );
}

function WidgetSettingsShell({
  title,
  designActions,
  widgetKey,
  children,
}: {
  title?: string;
  designActions?: WidgetDesignMenuActions;
  widgetKey: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [viewerMenu, setViewerMenu] = useState<React.ReactNode>(null);
  const [headerAddon, setHeaderAddon] = useState<React.ReactNode>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const layoutWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewerMenu(null);
    setOpen(false);
    setLayoutOpen(false);
  }, [widgetKey]);

  useEffect(() => {
    if (!open && !layoutOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const inSettings = !!(wrapRef.current && wrapRef.current.contains(t));
      const inLayout = !!(layoutWrapRef.current && layoutWrapRef.current.contains(t));
      if (!inSettings) setOpen(false);
      if (!inLayout) setLayoutOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, layoutOpen]);

  const hasDesign = !!designActions;
  const hasViewer = viewerMenu != null;
  const showSettingsButton = hasDesign || hasViewer;
  const showHeader = !!title || headerAddon != null || hasDesign || hasViewer;

  return (
    <WidgetViewerMenuSetterContext.Provider value={setViewerMenu}>
      <WidgetHeaderAddonSetterContext.Provider value={setHeaderAddon}>
        <div className="card" style={{ padding: "1rem", position: "relative" }}>
          {showHeader ? (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-start",
                alignItems: "flex-start",
                gap: "0.5rem",
                marginBottom: "0.75rem",
              }}
            >
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                {title ? (
                  <h3 style={{ margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h3>
                ) : null}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                {headerAddon ? <div style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{headerAddon}</div> : null}
                {hasDesign ? (
                  <div ref={layoutWrapRef} style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label="Layout"
                    aria-expanded={layoutOpen}
                    aria-haspopup="true"
                    onClick={() => setLayoutOpen((o) => !o)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 36,
                      padding: 0,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--surface)",
                      color: "var(--text)",
                      cursor: "pointer",
                    }}
                    title="Layout"
                  >
                    {/* layout icon */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="3" y="4" width="7" height="7" rx="1" />
                      <rect x="14" y="4" width="7" height="7" rx="1" />
                      <rect x="3" y="13" width="18" height="7" rx="1" />
                    </svg>
                  </button>
                  {layoutOpen && (
                    <div
                      role="menu"
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 6px)",
                        minWidth: 220,
                        maxWidth: "min(90vw, 320px)",
                        maxHeight: "min(70vh, 380px)",
                        overflowY: "auto",
                        zIndex: 40,
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        background: "var(--surface)",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                        padding: "0.35rem 0",
                      }}
                    >
                      <div
                        style={{
                          padding: "0.35rem 0.75rem 0.2rem",
                          fontSize: "0.72rem",
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        Width in row (12 columns)
                      </div>
                      {DESIGN_COL_SPAN_OPTIONS.map(({ span, label }) => (
                        <MenuRow
                          key={span}
                          active={designActions!.colSpan === span}
                          onClick={() => {
                            designActions!.onSetColSpan(span);
                            setLayoutOpen(false);
                          }}
                        >
                          {label}
                        </MenuRow>
                      ))}
                    </div>
                  )}
                  </div>
                ) : null}
                {showSettingsButton ? (
                  <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label="Widget settings"
                    aria-expanded={open}
                    aria-haspopup="true"
                    onClick={() => setOpen((o) => !o)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 36,
                      padding: 0,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--surface)",
                      color: "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="12" cy="12" r="3" />
                      <path
                        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  {open && (
                    <div
                      role="menu"
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 6px)",
                        minWidth: 220,
                        maxWidth: "min(90vw, 320px)",
                        maxHeight: "min(70vh, 380px)",
                        overflowY: "auto",
                        zIndex: 40,
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        background: "var(--surface)",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                        padding: "0.35rem 0",
                      }}
                    >
                {hasDesign && (
                  <>
                    <MenuRow
                      onClick={() => {
                        designActions!.onEdit();
                        setOpen(false);
                      }}
                    >
                      Edit
                    </MenuRow>
                    <MenuRow
                      danger
                      onClick={() => {
                        designActions!.onDelete();
                        setOpen(false);
                      }}
                    >
                      Delete
                    </MenuRow>
                  </>
                )}
                {hasDesign && hasViewer && <div style={{ borderTop: "1px solid var(--border)", margin: "0.25rem 0" }} />}
                {hasViewer && <div style={{ padding: "0.45rem 0.65rem" }}>{viewerMenu}</div>}
                    </div>
                  )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        {children}
      </div>
      </WidgetHeaderAddonSetterContext.Provider>
    </WidgetViewerMenuSetterContext.Provider>
  );
}

export function WidgetRenderer({
  widget,
  organizationId,
  designActions,
  dashboardId,
  isFullPage,
  tableRowsPerPage,
  onTableRowsPerPageChange,
  tableRowsPerPageOptions,
}: {
  widget: Widget;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
  isFullPage?: boolean;
  tableRowsPerPage?: number;
  onTableRowsPerPageChange?: (n: number) => void;
  tableRowsPerPageOptions?: number[];
}) {
  if (widget.type === "text") {
    return (
      <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
        <div style={{ whiteSpace: "pre-wrap" }}>{widget.text || ""}</div>
      </WidgetSettingsShell>
    );
  }
  if (widget.type === "kpi_single_value") {
    return (
      <KpiSingleValueWidget
        widget={widget}
        organizationId={organizationId}
        designActions={designActions}
        dashboardId={dashboardId}
      />
    );
  }
  if (widget.type === "kpi_table") {
    return (
      <KpiTableWidget
        widget={widget}
        organizationId={organizationId}
        designActions={designActions}
        dashboardId={dashboardId}
      />
    );
  }
  if (widget.type === "kpi_line_chart") {
    return (
      <KpiLineChartWidget
        widget={widget}
        organizationId={organizationId}
        designActions={designActions}
        dashboardId={dashboardId}
      />
    );
  }
  if (widget.type === "kpi_bar_chart") {
    return (
      <KpiBarChartWidget
        widget={widget}
        organizationId={organizationId}
        dashboardId={dashboardId}
        designActions={designActions}
      />
    );
  }
  if (widget.type === "kpi_trend") {
    return (
      <KpiTrendWidget
        widget={widget}
        organizationId={organizationId}
        designActions={designActions}
        dashboardId={dashboardId}
      />
    );
  }
  if (widget.type === "kpi_card_single_value") {
    return (
      <KpiCardSingleValueWidget
        widget={widget}
        organizationId={organizationId}
        designActions={designActions}
        dashboardId={dashboardId}
      />
    );
  }
  if (widget.type === "kpi_multi_line_table") {
    return (
      <KpiMultiLineTableWidget
        widget={widget}
        organizationId={organizationId}
        designActions={designActions}
        dashboardId={dashboardId}
        isFullPage={isFullPage}
        tableRowsPerPage={tableRowsPerPage}
        onTableRowsPerPageChange={onTableRowsPerPageChange}
        tableRowsPerPageOptions={tableRowsPerPageOptions}
      />
    );
  }
  const w = widget as { id?: string };
  return (
    <WidgetSettingsShell title="Unknown widget" designActions={designActions} widgetKey={w.id ?? "unknown"}>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(widget, null, 2)}</pre>
    </WidgetSettingsShell>
  );
}

function rawFieldFromEntry(entry: any, fieldId: number): unknown {
  const field = (entry?.values ?? []).find((v: any) => v?.field_id === fieldId);
  return field?.value_text ?? field?.value_number ?? field?.value_boolean ?? field?.value_date ?? field?.value_json;
}

function entryHasAnyData(entry: any): boolean {
  const vals = entry?.values;
  if (!Array.isArray(vals) || vals.length === 0) return false;
  return vals.some((v: any) => {
    if (!v || typeof v !== "object") return false;
    return (
      v.value_text != null ||
      v.value_number != null ||
      v.value_boolean != null ||
      v.value_date != null ||
      v.value_json != null
    );
  });
}

function toNumeric(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatNumberForCard(n: number, opts: { decimals?: number; thousandSep?: boolean }): string {
  const d = typeof opts.decimals === "number" && opts.decimals >= 0 && opts.decimals <= 10 ? opts.decimals : 0;
  const useSep = opts.thousandSep !== false;
  if (useSep) {
    return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  return n.toFixed(d);
}

const KPI_CARD_THEMES: Array<{ id: string; label: string; bg: string; fg: string }> = [
  { id: "success_light", label: "Light Green / White", bg: "#22c55e", fg: "#ffffff" },
  { id: "success_dark", label: "Dark Green / White", bg: "#166534", fg: "#ffffff" },
  { id: "info_light", label: "Light Blue / White", bg: "#3b82f6", fg: "#ffffff" },
  { id: "info_dark", label: "Dark Blue / White", bg: "#1e3a8a", fg: "#ffffff" },
  { id: "alert_light", label: "Light Red / White", bg: "#ef4444", fg: "#ffffff" },
  { id: "warning_orange", label: "Orange / White", bg: "#f97316", fg: "#ffffff" },
  { id: "neutral_grey_dark", label: "Grey / White", bg: "#334155", fg: "#ffffff" },
  { id: "neutral_grey_light", label: "Grey / Black", bg: "#e5e7eb", fg: "#111827" },
  { id: "minimal_white", label: "White / Dark", bg: "#ffffff", fg: "#111827" },
  { id: "grad_blue_purple", label: "Gradient Blue → Purple", bg: "linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%)", fg: "#ffffff" },
  { id: "grad_green_teal", label: "Gradient Green → Teal", bg: "linear-gradient(135deg, #22c55e 0%, #14b8a6 100%)", fg: "#ffffff" },
];

function aggregateSingleValue(items: any[], opts: { agg: "sum" | "avg" | "count" | "min" | "max"; valueKey?: string }): number | null {
  if (!Array.isArray(items)) return null;
  const { agg, valueKey } = opts;
  if (agg === "count") return items.length;
  const nums: number[] = [];
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const n = toNumeric((row as any)[valueKey || ""]);
    if (n != null) nums.push(n);
  }
  if (nums.length === 0) return null;
  if (agg === "sum") return nums.reduce((s, x) => s + x, 0);
  if (agg === "avg") return nums.reduce((s, x) => s + x, 0) / nums.length;
  if (agg === "min") return Math.min(...nums);
  if (agg === "max") return Math.max(...nums);
  return null;
}

async function fetchEntryForPeriod(
  token: string,
  organizationId: number,
  kpiId: number,
  year: number,
  periodKey: string | null | undefined
): Promise<any> {
  const q = new URLSearchParams({
    kpi_id: String(kpiId),
    year: String(year),
    organization_id: String(organizationId),
  });
  if (periodKey) q.set("period_key", periodKey);
  return api<any>(`/entries/for-period?${q.toString()}`, { token });
}

function KpiSingleValueWidget({
  widget,
  organizationId,
  designActions,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_single_value" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
}) {
  const token = getAccessToken();
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    if (isWidgetDataBundleEnabled()) {
      const ac = new AbortController();
      const w = { ...(widget as unknown as Record<string, unknown>) };
      const bundleReq =
        dashboardId != null
          ? postDashboardSingleValueWidgetData(
              token,
              { version: 1, organization_id: organizationId, dashboard_id: dashboardId, widget: w },
              { signal: ac.signal }
            )
          : postWidgetData(token, { version: 1, organization_id: organizationId, widget: w }, { signal: ac.signal });
      bundleReq
        .then((res) => {
          const raw = (res.data as { raw?: unknown }).raw;
          setValue(raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw));
        })
        .catch((e) => {
          if (isLikelyAbortError(e)) return;
          setError(e instanceof Error ? e.message : "Failed to load KPI value");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      return () => ac.abort();
    }
    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      (async () => {
        const q = new URLSearchParams({
          kpi_id: String(widget.kpi_id),
          year: String(widget.year),
          organization_id: String(organizationId),
        });
        if (widget.period_key) q.set("period_key", widget.period_key);
        return api<any>(`/entries/for-period?${q.toString()}`, { token });
      })(),
    ])
      .then(([map, entry]) => {
        const fid = map.idByKey[widget.field_key];
        const raw = fid ? rawFieldFromEntry(entry, fid) : null;
        setValue(raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load KPI value"))
      .finally(() => setLoading(false));
  }, [token, widget.kpi_id, widget.year, widget.period_key, widget.field_key, organizationId]);

  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : (
        <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{value || "—"}</div>
      )}
    </WidgetSettingsShell>
  );
}

function KpiCardSingleValueWidget({
  widget,
  organizationId,
  designActions,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_card_single_value" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
}) {
  const token = getAccessToken();
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);

    if (widget.source_mode === "static") {
      const raw = widget.static_value;
      const n = toNumeric(raw);
      if (n != null) setValue(formatNumberForCard(n, { decimals: widget.decimals, thousandSep: widget.thousand_sep }));
      else setValue(raw == null ? "" : String(raw));
      setLoading(false);
      return;
    }

    if (isWidgetDataBundleEnabled()) {
      const ac = new AbortController();
      const w = { ...(widget as unknown as Record<string, unknown>) };
      const bundleReq =
        dashboardId != null && (widget.source_mode === "field" || widget.source_mode === "static")
          ? postDashboardCardWidgetData(
              token,
              { version: 1, organization_id: organizationId, dashboard_id: dashboardId, widget: w },
              { signal: ac.signal }
            )
          : postWidgetData(token, { version: 1, organization_id: organizationId, widget: w }, { signal: ac.signal });
      bundleReq
        .then((res) => {
          const d = res.data;
          if (d.source_mode === "field" || (!d.source_mode && widget.source_mode === "field")) {
            const raw = d.raw;
            const n = toNumeric(raw);
            if (n != null) setValue(formatNumberForCard(n, { decimals: widget.decimals, thousandSep: widget.thousand_sep }));
            else setValue(raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw));
            return;
          }
          if (d.source_mode === "multi_line_agg" || (!d.source_mode && widget.source_mode === "multi_line_agg")) {
            const n = toNumeric(d.numeric);
            setValue(n == null ? "" : formatNumberForCard(n, { decimals: widget.decimals, thousandSep: widget.thousand_sep }));
            return;
          }
          setValue("");
        })
        .catch((e) => {
          if (isLikelyAbortError(e)) return;
          setError(e instanceof Error ? e.message : "Failed to load KPI value");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      return () => ac.abort();
    }

    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      fetchEntryForPeriod(token, organizationId, widget.kpi_id, widget.year, widget.period_key),
      widget.source_mode === "multi_line_agg" && widget.source_field_key
        ? fetchAllMultiItemsRows({
            token,
            organizationId,
            kpiId: widget.kpi_id,
            year: widget.year,
            periodKey: widget.period_key,
            sourceFieldKey: widget.source_field_key,
            filters: widget.filters ?? null,
          })
        : Promise.resolve(null),
    ])
      .then(([map, entry, multiLineRows]) => {
        if (widget.source_mode === "field") {
          const key = widget.field_key || "";
          const fid = key ? map.idByKey[key] : undefined;
          const raw = fid ? rawFieldFromEntry(entry, fid) : null;
          const n = toNumeric(raw);
          if (n != null) setValue(formatNumberForCard(n, { decimals: widget.decimals, thousandSep: widget.thousand_sep }));
          else setValue(raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw));
          return;
        }
        if (widget.source_mode === "multi_line_agg") {
          const items = Array.isArray(multiLineRows) ? multiLineRows : [];
          const agg = widget.agg ?? "sum";
          const n = aggregateSingleValue(items, { agg, valueKey: widget.value_sub_field_key });
          setValue(n == null ? "" : formatNumberForCard(n, { decimals: widget.decimals, thousandSep: widget.thousand_sep }));
          return;
        }
        setValue("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load KPI value"))
      .finally(() => setLoading(false));
  }, [
    token,
    organizationId,
    widget.kpi_id,
    widget.year,
    widget.period_key,
    widget.source_mode,
    widget.field_key,
    widget.source_field_key,
    widget.agg,
    widget.value_sub_field_key,
    widget.static_value,
    widget.decimals,
    widget.thousand_sep,
    JSON.stringify(widget.filters ?? null),
  ]);

  const theme = useMemo(() => KPI_CARD_THEMES.find((t) => t.id === (widget.theme || "")) ?? KPI_CARD_THEMES[0], [widget.theme]);
  const bg = widget.allow_custom_colors && widget.bg_color ? widget.bg_color : theme.bg;
  const fg = widget.allow_custom_colors && widget.fg_color ? widget.fg_color : theme.fg;

  const prefix = widget.prefix ?? "";
  const suffix = widget.suffix ?? "";
  const subtitle = widget.subtitle?.trim() || "";

  const align = widget.align || "left";
  const titleSize = widget.title_size ?? 14;
  const valueSize = widget.value_size ?? 34;
  const subtitleSize = widget.subtitle_size ?? 12;
  const titleWeight = widget.title_weight ?? 700;
  const valueWeight = widget.value_weight ?? 800;

  const display = value ? `${prefix}${value}${suffix}` : "";
  const bgStyle = bg.startsWith("linear-gradient") ? ({ backgroundImage: bg } as const) : ({ background: bg } as const);

  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : (
        <div
          style={{
            borderRadius: 14,
            padding: "1rem 1.1rem",
            color: fg,
            minHeight: 120,
            display: "grid",
            alignContent: "center",
            gap: "0.35rem",
            textAlign: align as any,
            border: bg === "#ffffff" ? "1px solid var(--border)" : "1px solid rgba(0,0,0,0.04)",
            ...bgStyle,
          }}
        >
          {subtitle ? (
            <div style={{ fontSize: subtitleSize, opacity: 0.92, fontWeight: titleWeight, lineHeight: 1.2 }}>{subtitle}</div>
          ) : null}
          <div style={{ fontSize: valueSize, fontWeight: valueWeight, lineHeight: 1.1 }}>{display || "—"}</div>
          <div style={{ fontSize: titleSize, opacity: 0.92, fontWeight: titleWeight, lineHeight: 1.2 }}>{widget.title || ""}</div>
        </div>
      )}
    </WidgetSettingsShell>
  );
}

function KpiLineChartWidget({
  widget,
  organizationId,
  designActions,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_line_chart" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
}) {
  const token = getAccessToken();
  const [points, setPoints] = useState<Array<{ year: number; value: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const start = Math.min(widget.start_year, widget.end_year);
    const end = Math.max(widget.start_year, widget.end_year);
    const years: number[] = [];
    for (let y = start; y <= end; y++) years.push(y);
    if (isWidgetDataBundleEnabled()) {
      const ac = new AbortController();
      const w = { ...(widget as unknown as Record<string, unknown>) };
      const bundleReq =
        dashboardId != null
          ? postDashboardLineWidgetData(
              token,
              { version: 1, organization_id: organizationId, dashboard_id: dashboardId, widget: w },
              { signal: ac.signal }
            )
          : postWidgetData(token, { version: 1, organization_id: organizationId, widget: w }, { signal: ac.signal });
      bundleReq
        .then((res) => {
          const pts = res.data.points as Array<{ year: number; value: unknown }> | undefined;
          if (Array.isArray(pts)) {
            setPoints(
              pts.map((p) => ({
                year: p.year,
                value: p.value != null && p.value !== "" ? toNumeric(p.value) : null,
              }))
            );
          } else {
            setPoints([]);
          }
        })
        .catch((e) => {
          if (isLikelyAbortError(e)) return;
          setError(e instanceof Error ? e.message : "Failed to load chart data");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      return () => ac.abort();
    }
    Promise.all([getKpiFieldMap(token, organizationId, widget.kpi_id)]).then(([map]) => {
      const fid = map.idByKey[widget.field_key];
      if (!fid) {
        setPoints([]);
        setLoading(false);
        return;
      }
      return Promise.all(
        years.map((year) =>
          fetchEntryForPeriod(token, organizationId, widget.kpi_id, year, widget.period_key).then((entry) => ({
            year,
            value: toNumeric(rawFieldFromEntry(entry, fid)),
          }))
        )
      )
        .then(setPoints)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load chart data"))
        .finally(() => setLoading(false));
    });
  }, [token, organizationId, widget.kpi_id, widget.field_key, widget.start_year, widget.end_year, widget.period_key]);

  const numeric = points.filter((p) => p.value != null) as { year: number; value: number }[];
  const values = numeric.map((p) => p.value);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;

  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : numeric.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>No numeric data for this field in the selected years.</p>
      ) : (
        <div style={{ width: "100%", maxWidth: 720 }}>
          <svg
            viewBox="0 0 640 240"
            role="img"
            aria-label="Line chart"
            style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
            onMouseLeave={() => {
              setHoverIdx(null);
              setHoverPt(null);
            }}
            onMouseMove={(e) => {
              const W = 640;
              const H = 240;
              const left = 44;
              const right = 16;
              const top = 16;
              const bottom = 36;
              const innerW = W - left - right;
              const innerH = H - top - bottom;
              const span = Math.max(maxV - minV, 1e-9);
              const n = numeric.length;
              if (!n) return;
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const sx = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * W;
              const idx =
                n === 1
                  ? 0
                  : Math.min(
                      n - 1,
                      Math.max(0, Math.round(((sx - left) / Math.max(innerW, 1)) * (n - 1)))
                    );
              const x = left + (n === 1 ? innerW / 2 : (idx / (n - 1)) * innerW);
              const y = top + innerH - ((numeric[idx].value - minV) / span) * innerH;
              setHoverIdx(idx);
              setHoverPt({ x, y });
            }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (!t) return;
              const W = 640;
              const H = 240;
              const left = 44;
              const right = 16;
              const top = 16;
              const bottom = 36;
              const innerW = W - left - right;
              const innerH = H - top - bottom;
              const span = Math.max(maxV - minV, 1e-9);
              const n = numeric.length;
              if (!n) return;
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const sx = ((t.clientX - rect.left) / Math.max(rect.width, 1)) * W;
              const idx =
                n === 1
                  ? 0
                  : Math.min(
                      n - 1,
                      Math.max(0, Math.round(((sx - left) / Math.max(innerW, 1)) * (n - 1)))
                    );
              const x = left + (n === 1 ? innerW / 2 : (idx / (n - 1)) * innerW);
              const y = top + innerH - ((numeric[idx].value - minV) / span) * innerH;
              setHoverIdx(idx);
              setHoverPt({ x, y });
            }}
            onTouchMove={(e) => {
              const t = e.touches[0];
              if (!t) return;
              const W = 640;
              const H = 240;
              const left = 44;
              const right = 16;
              const top = 16;
              const bottom = 36;
              const innerW = W - left - right;
              const innerH = H - top - bottom;
              const span = Math.max(maxV - minV, 1e-9);
              const n = numeric.length;
              if (!n) return;
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const sx = ((t.clientX - rect.left) / Math.max(rect.width, 1)) * W;
              const idx =
                n === 1
                  ? 0
                  : Math.min(
                      n - 1,
                      Math.max(0, Math.round(((sx - left) / Math.max(innerW, 1)) * (n - 1)))
                    );
              const x = left + (n === 1 ? innerW / 2 : (idx / (n - 1)) * innerW);
              const y = top + innerH - ((numeric[idx].value - minV) / span) * innerH;
              setHoverIdx(idx);
              setHoverPt({ x, y });
            }}
            onTouchEnd={() => {
              setHoverIdx(null);
              setHoverPt(null);
            }}
          >
            <rect x="0" y="0" width="640" height="240" fill="var(--bg)" rx="6" />
            {(() => {
              const W = 640;
              const H = 240;
              const left = 44;
              const right = 16;
              const top = 16;
              const bottom = 36;
              const innerW = W - left - right;
              const innerH = H - top - bottom;
              const span = Math.max(maxV - minV, 1e-9);
              const n = numeric.length;
              const xs = numeric.map((_, i) => left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW));
              const ys = numeric.map((p) => top + innerH - ((p.value - minV) / span) * innerH);
              const pathD = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");
              const minIdx = numeric.reduce((best, p, i) => (p.value < numeric[best].value ? i : best), 0);
              const maxIdx = numeric.reduce((best, p, i) => (p.value > numeric[best].value ? i : best), 0);
              const tooltipIdx = hoverIdx != null ? Math.min(Math.max(hoverIdx, 0), n - 1) : null;
              return (
                <>
                  <text x={left} y={H - 10} fontSize="11" fill="var(--muted)">
                    {numeric[0].year}
                  </text>
                  <text x={W - right - 36} y={H - 10} fontSize="11" fill="var(--muted)" textAnchor="end">
                    {numeric[n - 1].year}
                  </text>
                  <text x={8} y={top + 10} fontSize="11" fill="var(--muted)">
                    {maxV.toLocaleString()}
                  </text>
                  <text x={8} y={top + innerH} fontSize="11" fill="var(--muted)">
                    {minV.toLocaleString()}
                  </text>
                  <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  {xs.map((x, i) => (
                    <circle key={numeric[i].year} cx={x} cy={ys[i]} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth="1" />
                  ))}
                  {/* Always show labels for extreme points (min/max) */}
                  <g>
                    <text
                      x={xs[maxIdx]}
                      y={Math.max(12, ys[maxIdx] - 10)}
                      fontSize="11"
                      fill="var(--text)"
                      textAnchor="middle"
                      style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
                    >
                      {numeric[maxIdx].value.toLocaleString()}
                    </text>
                    <text
                      x={xs[minIdx]}
                      y={Math.min(H - 44, ys[minIdx] + 18)}
                      fontSize="11"
                      fill="var(--text)"
                      textAnchor="middle"
                      style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
                    >
                      {numeric[minIdx].value.toLocaleString()}
                    </text>
                  </g>
                  {/* Hover/touch tooltip */}
                  {tooltipIdx != null && hoverPt ? (
                    <g>
                      <line x1={hoverPt.x} y1={top} x2={hoverPt.x} y2={top + innerH} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                      <circle cx={hoverPt.x} cy={hoverPt.y} r={6} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
                      {(() => {
                        const label = `${numeric[tooltipIdx].year}: ${numeric[tooltipIdx].value.toLocaleString()}`;
                        const padX = 8;
                        const boxW = Math.min(260, 12 + label.length * 6.2);
                        const boxH = 26;
                        const preferLeft = hoverPt.x > W * 0.55;
                        const x = preferLeft ? Math.max(8, hoverPt.x - boxW - 10) : Math.min(W - boxW - 8, hoverPt.x + 10);
                        const y = Math.max(8, Math.min(H - boxH - 8, hoverPt.y - boxH - 10));
                        return (
                          <g>
                            <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                            <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                              {label}
                            </text>
                          </g>
                        );
                      })()}
                    </g>
                  ) : null}
                </>
              );
            })()}
          </svg>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.5rem 0 0" }}>
            Field <code>{widget.field_key}</code> · {numeric.length} year{numeric.length !== 1 ? "s" : ""} with data
          </p>
        </div>
      )}
    </WidgetSettingsShell>
  );
}

function safeKey(x: unknown): string {
  const s = x == null ? "" : String(x).trim();
  return s || "(empty)";
}

function aggregateMultiLine(
  items: any[],
  opts: {
    groupByKey: string;
    agg: "count_rows" | "sum" | "avg";
    valueKey?: string;
  }
): Array<{ label: string; value: number }> {
  const { groupByKey, agg, valueKey } = opts;
  const map = new Map<string, { sum: number; count: number }>();
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const g = safeKey((row as any)[groupByKey]);
    const cur = map.get(g) ?? { sum: 0, count: 0 };
    cur.count += 1;
    if (agg === "sum" || agg === "avg") {
      const n = toNumeric((row as any)[valueKey || ""]);
      if (n != null) cur.sum += n;
    }
    map.set(g, cur);
  }
  const out: Array<{ label: string; value: number }> = [];
  Array.from(map.entries()).forEach(([label, v]) => {
    if (agg === "count_rows") out.push({ label, value: v.count });
    else if (agg === "sum") out.push({ label, value: v.sum });
    else out.push({ label, value: v.count ? v.sum / v.count : 0 });
  });
  return out;
}

/** Roll up server-side SQL buckets (group × optional filter) after chip filter selection. */
function rollupSqlBuckets(
  buckets: Array<{ g: string; f: string | null; n: number; s: number }>,
  agg: "count_rows" | "sum" | "avg",
  filterKey: string,
  selectedFilterValues: string[]
): Array<{ label: string; value: number }> {
  const byLabel = new Map<string, { n: number; s: number }>();
  for (const b of buckets) {
    if (filterKey && selectedFilterValues.length > 0) {
      const fv = safeKey(b.f);
      if (!selectedFilterValues.includes(fv)) continue;
    }
    const cur = byLabel.get(b.g) ?? { n: 0, s: 0 };
    cur.n += b.n;
    cur.s += b.s;
    byLabel.set(b.g, cur);
  }
  const out: Array<{ label: string; value: number }> = [];
  for (const [label, { n, s }] of byLabel) {
    if (agg === "count_rows") out.push({ label, value: n });
    else if (agg === "sum") out.push({ label, value: s });
    else out.push({ label, value: n ? s / n : 0 });
  }
  return out;
}

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function pieArcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const p1 = polarToCartesian(cx, cy, r, start);
  const p2 = polarToCartesian(cx, cy, r, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
}

function KpiBarChartWidgetInner({
  widget,
  organizationId,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_bar_chart" }>;
  organizationId: number;
  /** When set with bundle mode, uses fast `POST /widget-data/chart` (dashboard auth only). */
  dashboardId?: number;
}) {
  const token = getAccessToken();
  const setViewerMenu = useWidgetViewerMenuSetter();
  const setHeaderAddon = useWidgetHeaderAddonSetter();
  const [viewerYear, setViewerYear] = useState<number>(widget.year);
  const [yearOptions, setYearOptions] = useState<number[]>([]);
  const [bars, setBars] = useState<Array<{ key: string; label: string; value: number | null }>>([]);
  const [groups, setGroups] = useState<Array<{ label: string; value: number }>>([]);
  const [filterValues, setFilterValues] = useState<string[]>([]);
  const [selectedFilterValues, setSelectedFilterValues] = useState<string[]>([]);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterEditing, setFilterEditing] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [viewerChartType, setViewerChartType] = useState<"bar" | "pie">(widget.chart_type || "bar");
  const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverBarKey, setHoverBarKey] = useState<string | null>(null);
  const [hoverBarPt, setHoverBarPt] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  const [hoverPieKey, setHoverPieKey] = useState<string | null>(null);
  const [hoverPiePt, setHoverPiePt] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  /** Full multi-line row list for the viewer year (client-side filter only; do not refetch when selectedFilterValues changes). */
  const [rawMultiLineItems, setRawMultiLineItems] = useState<any[]>([]);
  /** Pre-aggregated (group×filter) buckets from SQL when structured row filters are not used. */
  const [sqlAggBuckets, setSqlAggBuckets] = useState<Array<{ g: string; f: string | null; n: number; s: number }> | null>(
    null
  );

  useEffect(() => {
    setViewerChartType(widget.chart_type || "bar");
    setHiddenSeriesKeys([]);
    setViewerYear(widget.year);
    setSelectedFilterValues([]);
    setFilterSearch("");
    setFilterEditing(false);
    setSqlAggBuckets(null);
  }, [widget.id, widget.chart_type, widget.mode]);

  useEffect(() => {
    if (!token) return;
    const now = new Date().getFullYear();
    const base = Array.from({ length: 12 }, (_, i) => now - i);
    const mustInclude = new Set<number>([widget.year, viewerYear, ...base]);
    const nextYear = now + 1;
    (async () => {
      try {
        const en = await fetchEntryForPeriod(token, organizationId, widget.kpi_id, nextYear, widget.period_key);
        if (entryHasAnyData(en)) mustInclude.add(nextYear);
      } catch {
        // ignore
      }
      const list = Array.from(mustInclude).sort((a, b) => b - a);
      setYearOptions(list);
    })();
  }, [token, organizationId, widget.kpi_id, widget.period_key, widget.id, widget.year, viewerYear]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    if (isWidgetDataBundleEnabled()) {
      const ac = new AbortController();
      const w = { ...(widget as unknown as Record<string, unknown>) };
      const bundleReq =
        dashboardId != null
          ? enqueueDashboardChartBatch({
              token,
              organizationId,
              dashboardId,
              widgetId: String((w as any)?.id ?? ""),
              widget: w,
              overrides: { year: viewerYear },
            }).then((r) => ({
              version: 1,
              widget_type: "kpi_bar_chart",
              meta: r.meta ?? {},
              data: r.data ?? {},
              entry_revision: r.entry_revision ?? null,
            }))
          : postWidgetData(
              token,
              { version: 1, organization_id: organizationId, widget: w, overrides: { year: viewerYear } },
              { signal: ac.signal }
            );
      bundleReq
        .then((res) => {
          const d = res.data;
          const mode = (d.mode as string) || (widget.mode || "fields");
          if (mode === "multi_line_items") {
            const sourceKey = widget.source_field_key || "";
            const groupBy = widget.group_by_sub_field_key || "";
            const map = fieldMapFromServerBundle(d);
            const sourceId = sourceKey ? map.idByKey[sourceKey] : undefined;
            if (!sourceId || !groupBy) {
              setRawMultiLineItems([]);
              setSqlAggBuckets(null);
              setGroups([]);
            } else if (Array.isArray(d.multi_line_agg_buckets)) {
              const buckets = d.multi_line_agg_buckets as Array<{ g: string; f: string | null; n: number; s: number }>;
              setSqlAggBuckets(buckets);
              setRawMultiLineItems([]);
              const filterKey = widget.filter_sub_field_key || "";
              if (filterKey) {
                const uniq = Array.from(
                  new Set(buckets.map((b) => safeKey(b.f)).filter((v) => v && v !== "(empty)"))
                ).sort((a, b) => a.localeCompare(b));
                setFilterValues(uniq);
                setSelectedFilterValues((prev) => prev.filter((v) => uniq.includes(v)));
              } else {
                setFilterValues([]);
                setSelectedFilterValues([]);
              }
            } else {
              setSqlAggBuckets(null);
              const items = Array.isArray(d.raw_rows) ? d.raw_rows : [];
              setRawMultiLineItems(items);
              const filterKey = widget.filter_sub_field_key || "";
              if (filterKey) {
                const uniq = Array.from(
                  new Set(items.map((r: any) => safeKey(r?.[filterKey])).filter((v) => v && v !== "(empty)"))
                ).sort((a, b) => a.localeCompare(b));
                setFilterValues(uniq);
                setSelectedFilterValues((prev) => prev.filter((v) => uniq.includes(v)));
              } else {
                setFilterValues([]);
                setSelectedFilterValues([]);
              }
            }
            setBars([]);
            return;
          }
          setSqlAggBuckets(null);
          setRawMultiLineItems([]);
          const br = Array.isArray(d.bars) ? d.bars : [];
          setBars(
            br.map((b: { key: string; label: string; value: unknown }) => ({
              key: b.key,
              label: b.label,
              value: b.value != null && b.value !== "" ? toNumeric(b.value) : null,
            }))
          );
          setGroups([]);
        })
        .catch((e) => {
          if (isLikelyAbortError(e)) return;
          setError(e instanceof Error ? e.message : "Failed to load chart data");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      return () => ac.abort();
    }
    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      fetchEntryForPeriod(token, organizationId, widget.kpi_id, viewerYear, widget.period_key),
      widget.mode === "multi_line_items" && widget.source_field_key
        ? fetchAllMultiItemsRows({
            token,
            organizationId,
            kpiId: widget.kpi_id,
            year: viewerYear,
            periodKey: widget.period_key,
            sourceFieldKey: widget.source_field_key,
            filters: widget.filters ?? null,
          })
        : Promise.resolve(null),
    ])
      .then(([map, entry, multiLineRows]) => {
        const mode = widget.mode || "fields";
        if (mode === "multi_line_items") {
          const sourceKey = widget.source_field_key || "";
          const groupBy = widget.group_by_sub_field_key || "";
          const agg = widget.agg || "count_rows";
          const valueKey = widget.value_sub_field_key;
          const filterKey = widget.filter_sub_field_key || "";
          const sourceId = sourceKey ? map.idByKey[sourceKey] : undefined;
          if (!sourceId || !groupBy) {
            setRawMultiLineItems([]);
            setGroups([]);
            return;
          }
          const items = Array.isArray(multiLineRows) ? multiLineRows : [];
          setRawMultiLineItems(items);
          if (filterKey) {
            const uniq = Array.from(new Set(items.map((r: any) => safeKey(r?.[filterKey])).filter((v) => v && v !== "(empty)"))).sort((a, b) =>
              a.localeCompare(b)
            );
            setFilterValues(uniq);
            setSelectedFilterValues((prev) => prev.filter((v) => uniq.includes(v)));
          } else {
            setFilterValues([]);
            setSelectedFilterValues([]);
          }
          setBars([]);
          return;
        }
        setRawMultiLineItems([]);
        const keys = widget.field_keys || [];
        setBars(
          keys.map((key) => {
            const fid = map.idByKey[key];
            return { key, label: map.nameByKey[key] ?? key, value: fid ? toNumeric(rawFieldFromEntry(entry, fid)) : null };
          })
        );
        setGroups([]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load chart data"))
      .finally(() => setLoading(false));
  }, [
    token,
    organizationId,
    widget.kpi_id,
    viewerYear,
    widget.period_key,
    widget.mode,
    widget.chart_type,
    JSON.stringify(widget.field_keys || []),
    widget.source_field_key,
    widget.group_by_sub_field_key,
    widget.agg,
    widget.value_sub_field_key,
    widget.filter_sub_field_key,
    JSON.stringify(widget.filters ?? null),
    dashboardId,
  ]);

  useEffect(() => {
    const mode = widget.mode || "fields";
    if (mode !== "multi_line_items") return;
    const groupBy = widget.group_by_sub_field_key || "";
    const agg = (widget.agg || "count_rows") as "count_rows" | "sum" | "avg";
    const valueKey = widget.value_sub_field_key;
    const filterKey = widget.filter_sub_field_key || "";
    if (!groupBy) {
      setGroups([]);
      return;
    }
    if (sqlAggBuckets != null) {
      setGroups(rollupSqlBuckets(sqlAggBuckets, agg, filterKey, selectedFilterValues));
      return;
    }
    const filtered =
      filterKey && selectedFilterValues.length > 0
        ? rawMultiLineItems.filter((r: any) => selectedFilterValues.includes(safeKey(r?.[filterKey])))
        : rawMultiLineItems;
    setGroups(aggregateMultiLine(filtered, { groupByKey: groupBy, agg, valueKey }));
  }, [
    sqlAggBuckets,
    rawMultiLineItems,
    selectedFilterValues,
    widget.mode,
    widget.group_by_sub_field_key,
    widget.agg,
    widget.value_sub_field_key,
    widget.filter_sub_field_key,
  ]);

  const mode = widget.mode || "fields";
  const chartType = viewerChartType;
  const numeric = bars.filter((b) => b.value != null) as { key: string; label: string; value: number }[];
  const vals = numeric.map((b) => b.value);
  const maxV = vals.length ? Math.max(...vals, 0) : 1;
  const groupVals = groups.map((g) => g.value);
  const maxG = groupVals.length ? Math.max(...groupVals, 0) : 1;

  const sortBy = widget.sort_by || "value";
  const sortDir = widget.sort_dir || "desc";
  const dirMul = sortDir === "asc" ? 1 : -1;

  const visibleGroups = useMemo(() => {
    const v = groups.filter((g) => !hiddenSeriesKeys.includes(g.label));
    const next = [...v];
    if (sortBy === "x") next.sort((a, b) => dirMul * a.label.localeCompare(b.label));
    else next.sort((a, b) => dirMul * (a.value - b.value));
    return next;
  }, [groups, JSON.stringify(hiddenSeriesKeys), sortBy, sortDir]);

  const visibleNumeric = useMemo(() => {
    const v = numeric.filter((b) => !hiddenSeriesKeys.includes(b.key));
    const next = [...v];
    if (sortBy === "x") next.sort((a, b) => dirMul * a.label.localeCompare(b.label));
    else next.sort((a, b) => dirMul * (a.value - b.value));
    return next;
  }, [JSON.stringify(numeric), JSON.stringify(hiddenSeriesKeys), sortBy, sortDir]);

  const barColorMode = widget.bar_color_mode || "solid";
  const barSolid = widget.bar_color || "var(--accent)";
  const barPalette =
    Array.isArray(widget.bar_palette) && widget.bar_palette.length
      ? widget.bar_palette
      : paletteForScheme(widget.bar_palette_scheme, 8);
  const barGradFrom = widget.bar_gradient_from || "var(--accent)";
  const barGradTo = widget.bar_gradient_to || "";

  const parseRgbColor = (raw: string) => {
    const s = raw.trim();
    const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.exec(s);
    if (!m) return null;
    const r = Math.max(0, Math.min(255, Number(m[1])));
    const g = Math.max(0, Math.min(255, Number(m[2])));
    const b = Math.max(0, Math.min(255, Number(m[3])));
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return { r, g, b };
  };

  const parseHslColor = (raw: string) => {
    const s = raw.trim();
    const m = /^hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.exec(s);
    if (!m) return null;
    let h = Number(m[1]);
    const sat = Number(m[2]) / 100;
    const light = Number(m[3]) / 100;
    if (![h, sat, light].every((n) => Number.isFinite(n))) return null;
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mm = light - c / 2;
    let rr = 0, gg = 0, bb = 0;
    if (h < 60) [rr, gg, bb] = [c, x, 0];
    else if (h < 120) [rr, gg, bb] = [x, c, 0];
    else if (h < 180) [rr, gg, bb] = [0, c, x];
    else if (h < 240) [rr, gg, bb] = [0, x, c];
    else if (h < 300) [rr, gg, bb] = [x, 0, c];
    else [rr, gg, bb] = [c, 0, x];
    const r = Math.round((rr + mm) * 255);
    const g = Math.round((gg + mm) * 255);
    const b = Math.round((bb + mm) * 255);
    return { r, g, b };
  };

  const parseHexColor = (raw: string) => {
    const s = raw.trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  const parseColor = (raw: string) => parseHexColor(raw) ?? parseRgbColor(raw) ?? parseHslColor(raw);

  const derivedGradTo = useMemo(() => {
    const raw = (barGradTo || "").trim();
    if (raw) return raw;
    const base = parseColor(String(barGradFrom || "").trim());
    if (!base) return "rgb(165, 180, 252)";
    // Create a real visible ramp by mixing towards white (or black if already very light).
    const lum = 0.2126 * (base.r / 255) + 0.7152 * (base.g / 255) + 0.0722 * (base.b / 255);
    const toward = lum > 0.72 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    const t = lum > 0.72 ? 0.35 : 0.62;
    const r = Math.round(base.r + (toward.r - base.r) * t);
    const g = Math.round(base.g + (toward.g - base.g) * t);
    const b = Math.round(base.b + (toward.b - base.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }, [barGradFrom, barGradTo]);

  const colorForIndex = (idx: number, total: number) => {
    if (barColorMode === "palette") return barPalette[idx % barPalette.length];
    if (barColorMode === "solid") return barSolid;
    // Gradient: create distinct shades by varying lightness in HSL.
    const base = parseColor(barGradFrom) ?? parseColor(barSolid);
    if (!base) return barGradFrom || barSolid;
    const rgbToHsl = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const rr = r / 255;
      const gg = g / 255;
      const bb = b / 255;
      const max = Math.max(rr, gg, bb);
      const min = Math.min(rr, gg, bb);
      const d = max - min;
      let h = 0;
      const l = (max + min) / 2;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (d !== 0) {
        if (max === rr) h = ((gg - bb) / d) % 6;
        else if (max === gg) h = (bb - rr) / d + 2;
        else h = (rr - gg) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      return { h, s: s * 100, l: l * 100 };
    };
    const { h, s, l } = rgbToHsl(base);
    const t = total <= 1 ? 0 : Math.min(1, Math.max(0, idx / (total - 1)));
    // Make a +/- 26% lightness ramp around the base, clamped for readability.
    const lo = Math.max(12, Math.min(88, l - 26));
    const hi = Math.max(12, Math.min(88, l + 26));
    const ll = lo + (hi - lo) * t;
    return `hsl(${Math.round(h)}, ${Math.round(Math.max(18, Math.min(92, s)))}%, ${Math.round(ll)}%)`;
  };

  const toggleFilterValue = (v: string) => {
    setSelectedFilterValues((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const shownFilterValues = useMemo(() => {
    if (!filterEditing) return [];
    const q = filterSearch.trim().toLowerCase();
    return filterValues
      .filter((v) => !selectedFilterValues.includes(v))
      .filter((v) => (q ? v.toLowerCase().includes(q) : true))
      .slice(0, 50);
  }, [filterValues, selectedFilterValues, filterSearch, filterEditing]);

  const addTypedFilterValue = () => {
    const raw = filterSearch.trim();
    if (!raw) return;
    const match = filterValues.find((v) => v.toLowerCase() === raw.toLowerCase());
    const toAdd = match ?? shownFilterValues[0];
    if (!toAdd) return;
    setSelectedFilterValues((prev) => (prev.includes(toAdd) ? prev : [...prev, toAdd]));
    setFilterSearch("");
  };

  const toggleHiddenSeries = (k: string) => {
    setHiddenSeriesKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  const chipBtnStyle = (hidden: boolean) => ({
    padding: "0.12rem 0.45rem",
    borderRadius: 999,
    border: `1px solid ${hidden ? "var(--border)" : "var(--accent)"}`,
    background: hidden ? "var(--surface)" : "rgba(79,70,229,0.10)",
    color: hidden ? "var(--muted)" : "var(--accent)",
    fontSize: "0.78rem",
    cursor: "pointer",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });

  useEffect(() => {
    if (!setHeaderAddon) return;
    if (loading || error) {
      setHeaderAddon(null);
      return;
    }

    const modeNow = widget.mode || "fields";
    const filterKey = widget.filter_sub_field_key || "";
    const yearSelect = (
      <select
        value={viewerYear}
        onChange={(e) => {
          const next = Number(e.target.value);
          setViewerYear(next);
          setSelectedFilterValues([]);
          setFilterSearch("");
          setFilterEditing(false);
        }}
        style={{ height: 36, padding: "0.35rem 0.45rem", fontSize: "0.85rem" }}
        title="Year"
      >
        {(yearOptions.length ? yearOptions : [viewerYear]).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    );

    if (modeNow !== "multi_line_items" || !filterKey) {
      setHeaderAddon(<div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>{yearSelect}</div>);
      return;
    }

    const filterLabel = (widget.filter_label || "").trim() || filterKey;
    const pillLabel =
      selectedFilterValues.length === 0 ? `All ${filterLabel}` : `${filterLabel}: ${selectedFilterValues.length} selected`;

    setHeaderAddon(
      <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
        {yearSelect}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.35rem" }}>
          {!filterEditing ? (
            <button
              type="button"
              onClick={() => {
                setFilterEditing(true);
                window.setTimeout(() => filterInputRef.current?.focus(), 0);
              }}
              style={{
                height: 36,
                maxWidth: 260,
                padding: "0 0.65rem",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: selectedFilterValues.length > 0 ? "var(--accent)" : "var(--muted)",
                cursor: "pointer",
                fontSize: "0.85rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title="Click to filter"
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pillLabel}</span>
            </button>
          ) : (
            <>
              <div
                style={{
                  height: 36,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0 0.45rem",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                }}
              >
                <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{filterLabel}:</span>
                <input
                  ref={filterInputRef}
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder={filterValues.length === 0 ? "No values" : "Type to search"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTypedFilterValue();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setFilterEditing(false);
                      setFilterSearch("");
                    }
                  }}
                  style={{
                    width: 150,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    padding: 0,
                    fontSize: "0.9rem",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setFilterEditing(false);
                    setFilterSearch("");
                  }}
                  aria-label="Close filter"
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: "1.1rem", lineHeight: 1, padding: 0 }}
                  title="Close"
                >
                  ×
                </button>
              </div>

              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  zIndex: 45,
                  minWidth: 260,
                  maxWidth: "min(90vw, 360px)",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  borderRadius: 12,
                  boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
                  overflow: "hidden",
                }}
              >
                <div style={{ maxHeight: 240, overflow: "auto" }}>
                  {shownFilterValues.length === 0 ? (
                    <div style={{ padding: "0.55rem 0.7rem", color: "var(--muted)", fontSize: "0.85rem" }}>
                      {filterValues.length === 0 ? "No values." : "No matches."}
                    </div>
                  ) : (
                    shownFilterValues.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedFilterValues((prev) => (prev.includes(v) ? prev : [...prev, v]));
                          setFilterSearch("");
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          background: "transparent",
                          color: "inherit",
                          padding: "0.45rem 0.7rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          fontSize: "0.9rem",
                        }}
                        title={v}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );

    return () => setHeaderAddon(null);
  }, [
    setHeaderAddon,
    loading,
    error,
    widget.id,
    widget.mode,
    widget.filter_sub_field_key,
    widget.filter_label,
    viewerYear,
    filterEditing,
    filterSearch,
    JSON.stringify(filterValues),
    JSON.stringify(selectedFilterValues),
    JSON.stringify(shownFilterValues),
  ]);

  useEffect(() => {
    if (!setViewerMenu) return;
    if (loading || error) {
      setViewerMenu(null);
      return;
    }
    const chartToggle = (
      <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => setViewerChartType("bar")}
          style={{
            padding: "0.25rem 0.55rem",
            border: "none",
            background: viewerChartType === "bar" ? "rgba(79,70,229,0.10)" : "transparent",
            color: viewerChartType === "bar" ? "var(--accent)" : "var(--text)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
          aria-pressed={viewerChartType === "bar"}
        >
          Bar
        </button>
        <button
          type="button"
          onClick={() => setViewerChartType("pie")}
          style={{
            padding: "0.25rem 0.55rem",
            border: "none",
            borderLeft: "1px solid var(--border)",
            background: viewerChartType === "pie" ? "rgba(79,70,229,0.10)" : "transparent",
            color: viewerChartType === "pie" ? "var(--accent)" : "var(--text)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
          aria-pressed={viewerChartType === "pie"}
        >
          Pie
        </button>
      </div>
    );

    if (mode === "multi_line_items") {
      setViewerMenu(
        <div style={{ display: "grid", gap: "0.65rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 4 }}>Chart</div>
            {chartToggle}
          </div>
          {hiddenSeriesKeys.length > 0 && (
            <button type="button" className="btn" onClick={() => setHiddenSeriesKeys([])} style={{ fontSize: "0.85rem", width: "100%" }}>
              Reset hidden series
            </button>
          )}
          {groups.length > 0 && (
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 6 }}>Visible groups</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {groups.slice(0, 20).map((g) => {
                  const hidden = hiddenSeriesKeys.includes(g.label);
                  return (
                    <button
                      key={g.label}
                      type="button"
                      onClick={() => toggleHiddenSeries(g.label)}
                      style={chipBtnStyle(hidden)}
                      title={hidden ? "Hidden (click to show)" : "Visible (click to hide)"}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
      return () => setViewerMenu(null);
    }

    setViewerMenu(
      <div style={{ display: "grid", gap: "0.65rem" }}>
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 4 }}>Chart</div>
          {chartToggle}
        </div>
        {hiddenSeriesKeys.length > 0 && (
          <button type="button" className="btn" onClick={() => setHiddenSeriesKeys([])} style={{ fontSize: "0.85rem", width: "100%" }}>
            Reset hidden series
          </button>
        )}
        {numeric.length > 0 && (
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 6 }}>Visible fields</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {numeric.slice(0, 20).map((b) => {
                const hidden = hiddenSeriesKeys.includes(b.key);
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => toggleHiddenSeries(b.key)}
                    style={chipBtnStyle(hidden)}
                    title={hidden ? "Hidden (click to show)" : "Visible (click to hide)"}
                  >
                    {b.key}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
    return () => setViewerMenu(null);
  }, [
    setViewerMenu,
    loading,
    error,
    mode,
    viewerChartType,
    JSON.stringify(hiddenSeriesKeys),
    JSON.stringify(groups),
    JSON.stringify(numeric.map((b) => b.key))
  ]);

  return (
    <>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : mode === "multi_line_items" ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {widget.filter_sub_field_key && selectedFilterValues.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
              {selectedFilterValues.map((v) => (
                <span
                  key={v}
                  style={{
                    display: "inline-flex",
                    gap: "0.25rem",
                    alignItems: "center",
                    padding: "0.1rem 0.4rem",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: "0.78rem",
                    maxWidth: 220,
                  }}
                  title={v}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                  <button
                    type="button"
                    onClick={() => toggleFilterValue(v)}
                    style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
                    aria-label={`Remove ${v}`}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {visibleGroups.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>No grouped data available for this multi-line field.</p>
          ) : chartType === "pie" ? (
            <div style={{ width: "100%", maxWidth: 720 }}>
              <svg
                viewBox="0 0 640 300"
                role="img"
                aria-label="Pie chart"
                style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
                onMouseLeave={() => {
                  setHoverPieKey(null);
                  setHoverPiePt(null);
                }}
                onTouchEnd={() => {
                  setHoverPieKey(null);
                  setHoverPiePt(null);
                }}
              >
                <rect x="0" y="0" width="640" height="300" fill="var(--bg)" rx="6" />
                {(() => {
                  const total = visibleGroups.reduce((s, g) => s + g.value, 0) || 1;
                  const cx = 210;
                  const cy = 150;
                  const r = 110;
                  let a = -Math.PI / 2;
                  return (
                    <>
                      {(() => {
                        const slices = visibleGroups.slice(0, 12);
                        return slices.map((g, i) => {
                          const frac = g.value / total;
                          const next = a + frac * Math.PI * 2;
                          const d = pieArcPath(cx, cy, r, a, next);
                          const mid = (a + next) / 2;
                          const p = polarToCartesian(cx, cy, r * 0.72, mid);
                          a = next;
                          const fill = colorForIndex(i, slices.length);
                          return (
                            <path
                              key={g.label}
                              d={d}
                              fill={fill}
                              stroke="var(--surface)"
                              strokeWidth="1"
                              onMouseEnter={() => {
                                setHoverPieKey(g.label);
                                setHoverPiePt({ x: p.x, y: p.y, label: g.label, value: g.value });
                              }}
                              onMouseMove={() => {
                                setHoverPieKey(g.label);
                                setHoverPiePt({ x: p.x, y: p.y, label: g.label, value: g.value });
                              }}
                              onTouchStart={() => {
                                setHoverPieKey(g.label);
                                setHoverPiePt({ x: p.x, y: p.y, label: g.label, value: g.value });
                              }}
                              onTouchMove={() => {
                                setHoverPieKey(g.label);
                                setHoverPiePt({ x: p.x, y: p.y, label: g.label, value: g.value });
                              }}
                            />
                          );
                        });
                      })()}
                      {hoverPiePt && hoverPieKey ? (
                        <g>
                          <circle cx={hoverPiePt.x} cy={hoverPiePt.y} r={4} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
                          {(() => {
                            const label = `${hoverPiePt.label}: ${hoverPiePt.value.toLocaleString()}`;
                            const padX = 8;
                            const boxW = Math.min(320, 12 + label.length * 6.2);
                            const boxH = 26;
                            const x = Math.min(640 - boxW - 8, Math.max(8, hoverPiePt.x + 12));
                            const y = Math.min(300 - boxH - 8, Math.max(8, hoverPiePt.y - boxH - 10));
                            return (
                              <g>
                                <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                                <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                                  {label}
                                </text>
                              </g>
                            );
                          })()}
                        </g>
                      ) : null}
                      <text x="420" y="34" fontSize="12" fill="var(--muted)">
                        Top groups
                      </text>
                      {(() => {
                        const legend = visibleGroups.slice(0, 8);
                        return legend.map((g, i) => (
                          <g key={g.label}>
                            <rect x="420" y={52 + i * 26} width="10" height="10" fill={colorForIndex(i, legend.length)} />
                            <text x="436" y={61 + i * 26} fontSize="11" fill="var(--text)">
                              {g.label.length > 22 ? `${g.label.slice(0, 20)}…` : g.label} ({g.value.toLocaleString()})
                            </text>
                          </g>
                        ));
                      })()}
                    </>
                  );
                })()}
              </svg>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 720 }}>
              <svg
                viewBox="0 0 640 260"
                role="img"
                aria-label="Bar chart"
                style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
                onMouseLeave={() => {
                  setHoverBarKey(null);
                  setHoverBarPt(null);
                }}
                onTouchEnd={() => {
                  setHoverBarKey(null);
                  setHoverBarPt(null);
                }}
              >
                <rect x="0" y="0" width="640" height="260" fill="var(--bg)" rx="6" />
                {(() => {
                  const W = 640;
                  const H = 260;
                  const left = 40;
                  const right = 16;
                  const top = 16;
                  const bottom = 58;
                  const innerW = W - left - right;
                  const innerH = H - top - bottom;
                  const data = visibleGroups.slice(0, 12);
                  const n = data.length;
                  const gap = 8;
                  const barW = n > 0 ? Math.max(10, (innerW - gap * (n - 1)) / n) : 10;
                  const minIdx = data.reduce((best, b, i) => (b.value < data[best].value ? i : best), 0);
                  const maxIdx = data.reduce((best, b, i) => (b.value > data[best].value ? i : best), 0);
                  return (
                    <>
                      <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                        {maxG.toLocaleString()}
                      </text>
                      {data.map((b, i) => {
                        const x = left + i * (barW + gap);
                        const h = maxG > 0 ? (b.value / maxG) * innerH : 0;
                        const y = top + innerH - h;
                        const fill = colorForIndex(i, data.length);
                        return (
                          <g key={b.label}>
                            <rect
                              x={x}
                              y={y}
                              width={barW}
                              height={h}
                              fill={fill}
                              opacity={0.85}
                              rx={2}
                              onMouseEnter={() => {
                                setHoverBarKey(b.label);
                                setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
                              }}
                              onMouseMove={() => {
                                setHoverBarKey(b.label);
                                setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
                              }}
                              onTouchStart={() => {
                                setHoverBarKey(b.label);
                                setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
                              }}
                              onTouchMove={() => {
                                setHoverBarKey(b.label);
                                setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
                              }}
                            />
                            {(i === minIdx || i === maxIdx) && h > 0 ? (
                              <text
                                x={x + barW / 2}
                                y={Math.max(12, y - 6)}
                                fontSize="11"
                                fill="var(--text)"
                                textAnchor="middle"
                                style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
                              >
                                {b.value.toLocaleString()}
                              </text>
                            ) : null}
                            <text x={x + barW / 2} y={H - 10} fontSize="9" fill="var(--muted)" textAnchor="middle">
                              {b.label.length > 12 ? `${b.label.slice(0, 10)}…` : b.label}
                            </text>
                          </g>
                        );
                      })}
                      {hoverBarPt && hoverBarKey ? (
                        <g>
                          <line x1={hoverBarPt.x} y1={top} x2={hoverBarPt.x} y2={top + innerH} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                          {(() => {
                            const label = `${hoverBarPt.label}: ${hoverBarPt.value.toLocaleString()}`;
                            const padX = 8;
                            const boxW = Math.min(300, 12 + label.length * 6.2);
                            const boxH = 26;
                            const preferLeft = hoverBarPt.x > W * 0.55;
                            const x = preferLeft ? Math.max(8, hoverBarPt.x - boxW - 10) : Math.min(W - boxW - 8, hoverBarPt.x + 10);
                            const y = Math.max(8, Math.min(H - boxH - 8, hoverBarPt.y - boxH - 10));
                            return (
                              <g>
                                <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                                <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                                  {label}
                                </text>
                              </g>
                            );
                          })()}
                        </g>
                      ) : null}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}
        </div>
      ) : visibleNumeric.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>No numeric data for the selected fields.</p>
      ) : (
        <div style={{ width: "100%", maxWidth: 720 }}>
          {chartType === "pie" ? (
            <svg
              viewBox="0 0 640 300"
              role="img"
              aria-label="Pie chart"
              style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
              onMouseLeave={() => {
                setHoverPieKey(null);
                setHoverPiePt(null);
              }}
              onTouchEnd={() => {
                setHoverPieKey(null);
                setHoverPiePt(null);
              }}
            >
              <rect x="0" y="0" width="640" height="300" fill="var(--bg)" rx="6" />
              {(() => {
                const data = visibleNumeric.slice(0, 12);
                const total = data.reduce((s, b) => s + b.value, 0) || 1;
                const cx = 210;
                const cy = 150;
                const r = 110;
                let a = -Math.PI / 2;
                return (
                  <>
                    {data.map((b, i) => {
                      const frac = b.value / total;
                      const next = a + frac * Math.PI * 2;
                      const d = pieArcPath(cx, cy, r, a, next);
                      const mid = (a + next) / 2;
                      const p = polarToCartesian(cx, cy, r * 0.72, mid);
                      a = next;
                      const fill = colorForIndex(i, data.length);
                      return (
                        <path
                          key={b.key}
                          d={d}
                          fill={fill}
                          stroke="var(--surface)"
                          strokeWidth="1"
                          onMouseEnter={() => {
                            setHoverPieKey(b.key);
                            setHoverPiePt({ x: p.x, y: p.y, label: b.key, value: b.value });
                          }}
                          onMouseMove={() => {
                            setHoverPieKey(b.key);
                            setHoverPiePt({ x: p.x, y: p.y, label: b.key, value: b.value });
                          }}
                          onTouchStart={() => {
                            setHoverPieKey(b.key);
                            setHoverPiePt({ x: p.x, y: p.y, label: b.key, value: b.value });
                          }}
                          onTouchMove={() => {
                            setHoverPieKey(b.key);
                            setHoverPiePt({ x: p.x, y: p.y, label: b.key, value: b.value });
                          }}
                        />
                      );
                    })}
                    {hoverPiePt && hoverPieKey ? (
                      <g>
                        <circle cx={hoverPiePt.x} cy={hoverPiePt.y} r={4} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
                        {(() => {
                          const label = `${hoverPiePt.label}: ${hoverPiePt.value.toLocaleString()}`;
                          const padX = 8;
                          const boxW = Math.min(320, 12 + label.length * 6.2);
                          const boxH = 26;
                          const x = Math.min(640 - boxW - 8, Math.max(8, hoverPiePt.x + 12));
                          const y = Math.min(300 - boxH - 8, Math.max(8, hoverPiePt.y - boxH - 10));
                          return (
                            <g>
                              <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                              <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                                {label}
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    ) : null}
                    <text x="420" y="34" fontSize="12" fill="var(--muted)">
                      Top fields
                    </text>
                    {data.slice(0, 8).map((b, i) => (
                      <g key={b.key}>
                        <rect x="420" y={52 + i * 26} width="10" height="10" fill={colorForIndex(i, Math.min(8, data.length))} />
                        <text x="436" y={61 + i * 26} fontSize="11" fill="var(--text)">
                          {b.key.length > 22 ? `${b.key.slice(0, 20)}…` : b.key} ({b.value.toLocaleString()})
                        </text>
                      </g>
                    ))}
                  </>
                );
              })()}
            </svg>
          ) : (
            <svg
              viewBox="0 0 640 260"
              role="img"
              aria-label="Bar chart"
              style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
              onMouseLeave={() => {
                setHoverBarKey(null);
                setHoverBarPt(null);
              }}
              onTouchEnd={() => {
                setHoverBarKey(null);
                setHoverBarPt(null);
              }}
            >
              <rect x="0" y="0" width="640" height="260" fill="var(--bg)" rx="6" />
              {(() => {
                const W = 640;
                const H = 260;
                const left = 40;
                const right = 16;
                const top = 16;
                const bottom = 52;
                const innerW = W - left - right;
                const innerH = H - top - bottom;
                const n = visibleNumeric.length;
                const gap = 8;
                const barW = n > 0 ? Math.max(8, (innerW - gap * (n - 1)) / n) : 8;
                const minIdx = visibleNumeric.reduce((best, b, i) => (b.value < visibleNumeric[best].value ? i : best), 0);
                const maxIdx = visibleNumeric.reduce((best, b, i) => (b.value > visibleNumeric[best].value ? i : best), 0);
                return (
                  <>
                    <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                      {maxV.toLocaleString()}
                    </text>
                    {visibleNumeric.map((b, i) => {
                      const x = left + i * (barW + gap);
                      const h = maxV > 0 ? (b.value / maxV) * innerH : 0;
                      const y = top + innerH - h;
                      const fill = colorForIndex(i, visibleNumeric.length);
                      return (
                        <g key={b.key}>
                          <rect
                            x={x}
                            y={y}
                            width={barW}
                            height={h}
                            fill={fill}
                            opacity={0.85}
                            rx={2}
                            onMouseEnter={() => {
                              setHoverBarKey(b.key);
                              setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
                            }}
                            onMouseMove={() => {
                              setHoverBarKey(b.key);
                              setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
                            }}
                            onTouchStart={() => {
                              setHoverBarKey(b.key);
                              setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
                            }}
                            onTouchMove={() => {
                              setHoverBarKey(b.key);
                              setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
                            }}
                          />
                          {(i === minIdx || i === maxIdx) && h > 0 ? (
                            <text
                              x={x + barW / 2}
                              y={Math.max(12, y - 6)}
                              fontSize="11"
                              fill="var(--text)"
                              textAnchor="middle"
                              style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}
                            >
                              {b.value.toLocaleString()}
                            </text>
                          ) : null}
                          <text x={x + barW / 2} y={H - 8} fontSize="9" fill="var(--muted)" textAnchor="middle">
                            {b.key.length > 14 ? `${b.key.slice(0, 12)}…` : b.key}
                          </text>
                        </g>
                      );
                    })}
                    {hoverBarPt && hoverBarKey ? (
                      <g>
                        <line x1={hoverBarPt.x} y1={top} x2={hoverBarPt.x} y2={top + innerH} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                        {(() => {
                          const label = `${hoverBarPt.label}: ${hoverBarPt.value.toLocaleString()}`;
                          const padX = 8;
                          const boxW = Math.min(300, 12 + label.length * 6.2);
                          const boxH = 26;
                          const preferLeft = hoverBarPt.x > W * 0.55;
                          const x = preferLeft ? Math.max(8, hoverBarPt.x - boxW - 10) : Math.min(W - boxW - 8, hoverBarPt.x + 10);
                          const y = Math.max(8, Math.min(H - boxH - 8, hoverBarPt.y - boxH - 10));
                          return (
                            <g>
                              <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                              <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                                {label}
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    ) : null}
                  </>
                );
              })()}
            </svg>
          )}
        </div>
      )}
    </>
  );
}

function KpiBarChartWidget({
  widget,
  organizationId,
  dashboardId,
  designActions,
}: {
  widget: Extract<Widget, { type: "kpi_bar_chart" }>;
  organizationId: number;
  dashboardId?: number;
  designActions?: WidgetDesignMenuActions;
}) {
  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      <KpiBarChartWidgetInner widget={widget} organizationId={organizationId} dashboardId={dashboardId} />
    </WidgetSettingsShell>
  );
}

function yearRange(start: number, end: number): number[] {
  const s = Number.isFinite(start) ? Math.trunc(start) : end;
  const e = Number.isFinite(end) ? Math.trunc(end) : start;
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  const out: number[] = [];
  for (let y = hi; y >= lo; y--) out.push(y);
  return out;
}

function KpiTrendWidget({
  widget,
  organizationId,
  designActions,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_trend" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
}) {
  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      <KpiTrendWidgetInner widget={widget} organizationId={organizationId} dashboardId={dashboardId} />
    </WidgetSettingsShell>
  );
}

function KpiTrendWidgetInner({
  widget,
  organizationId,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_trend" }>;
  organizationId: number;
  dashboardId?: number;
}) {
  const token = getAccessToken();
  const setViewerMenu = useWidgetViewerMenuSetter();
  const setHeaderAddon = useWidgetHeaderAddonSetter();
  const mode = widget.mode || "multi_line_items";
  const [viewerView, setViewerView] = useState<"bar" | "line">(widget.view || "bar");
  const [hoverTrendPt, setHoverTrendPt] = useState<{ x: number; y: number; label: string; value: number; series: string } | null>(null);
  const [selectedYears, setSelectedYears] = useState<number[]>(() => {
    const y = Math.max(widget.start_year, widget.end_year);
    const raw = Array.isArray(widget.default_years) ? widget.default_years : [];
    const uniq = Array.from(new Set(raw.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n))));
    const within = uniq.filter((yy) => yy >= Math.min(widget.start_year, widget.end_year) && yy <= Math.max(widget.start_year, widget.end_year));
    return within.length ? within.sort((a, b) => b - a) : [y];
  });
  const [yearOptions, setYearOptions] = useState<number[]>([]);
  const [filterValues, setFilterValues] = useState<string[]>([]);
  const [selectedFilterValues, setSelectedFilterValues] = useState<string[]>([]);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterEditing, setFilterEditing] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seriesByYear, setSeriesByYear] = useState<Record<number, Array<{ label: string; value: number }>>>({});
  const [fieldBarsByYear, setFieldBarsByYear] = useState<Record<number, Array<{ key: string; label: string; value: number | null }>>>({});
  /** Multi-line rows per year after fetch (viewer filter is client-side only). */
  const [rawMultiLineByYear, setRawMultiLineByYear] = useState<Record<number, any[]>>({});
  const [bucketsByYear, setBucketsByYear] = useState<Record<number, Array<{ g: string; f: string | null; n: number; s: number }>>>({});

  useEffect(() => {
    setViewerView(widget.view || "bar");
    const y = Math.max(widget.start_year, widget.end_year);
    const raw = Array.isArray(widget.default_years) ? widget.default_years : [];
    const uniq = Array.from(new Set(raw.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n))));
    const within = uniq.filter((yy) => yy >= Math.min(widget.start_year, widget.end_year) && yy <= Math.max(widget.start_year, widget.end_year));
    setSelectedYears(within.length ? within.sort((a, b) => b - a) : [y]);
    setSelectedFilterValues([]);
    setFilterSearch("");
    setFilterEditing(false);
  }, [widget.id, widget.view, widget.mode, widget.start_year, widget.end_year, JSON.stringify(widget.default_years ?? [])]);

  useEffect(() => {
    const opts = yearRange(widget.start_year, widget.end_year);
    setYearOptions(opts);
    setSelectedYears((prev) => {
      const uniq = Array.from(new Set(prev.filter((y) => opts.includes(y))));
      if (uniq.length) return uniq.sort((a, b) => b - a);
      const fallback = Math.max(widget.start_year, widget.end_year);
      return opts.includes(fallback) ? [fallback] : (opts.length ? [opts[0]] : []);
    });
  }, [widget.start_year, widget.end_year, widget.id]);

  useEffect(() => {
    if (!token) return;
    if (selectedYears.length === 0) return;
    setLoading(true);
    setError(null);
    if (isWidgetDataBundleEnabled()) {
      const ac = new AbortController();
      const w = { ...(widget as unknown as Record<string, unknown>) };
      const bundleReq =
        dashboardId != null
          ? postDashboardTrendWidgetData(
              token,
              {
                version: 1,
                organization_id: organizationId,
                dashboard_id: dashboardId,
                widget: w,
                overrides: { selected_years: selectedYears },
              },
              { signal: ac.signal }
            )
          : postWidgetData(
              token,
              {
                version: 1,
                organization_id: organizationId,
                widget: w,
                overrides: { selected_years: selectedYears },
              },
              { signal: ac.signal }
            );
      bundleReq
        .then((res) => {
          const d = res.data;
          const m = (d.mode as string) || (widget.mode || "fields");
          if (m === "multi_line_items") {
            const sourceKey = widget.source_field_key || "";
            const groupBy = widget.group_by_sub_field_key || "";
            if (!groupBy) {
              setRawMultiLineByYear({});
              setBucketsByYear({});
              setSeriesByYear({});
              setFilterValues([]);
              setSelectedFilterValues([]);
              setFieldBarsByYear({});
              return;
            }
            const years = [...selectedYears].sort((a, b) => b - a);
            const filterKey = widget.filter_sub_field_key || "";
            const bby = d.multi_line_agg_buckets_by_year as Record<string, any[]> | undefined;
            if (bby) {
              const next: Record<number, Array<{ g: string; f: string | null; n: number; s: number }>> = {};
              const allF: string[] = [];
              years.forEach((y) => {
                const buckets = (bby && bby[String(y)]) || [];
                next[y] = buckets as any;
                if (filterKey) {
                  (buckets as any[]).forEach((b: any) => {
                    const fv = safeKey(b?.f);
                    if (fv && fv !== "(empty)") allF.push(fv);
                  });
                }
              });
              setBucketsByYear(next);
              setRawMultiLineByYear({});
              if (filterKey) {
                const uniq = Array.from(new Set(allF)).sort((a, b) => a.localeCompare(b));
                setFilterValues(uniq);
                setSelectedFilterValues((prev) => prev.filter((v) => uniq.includes(v)));
              } else {
                setFilterValues([]);
                setSelectedFilterValues([]);
              }
            } else {
              const rby = d.raw_rows_by_year as Record<string, unknown[]> | undefined;
              const raw: Record<number, any[]> = {};
              const allItems: any[] = [];
              years.forEach((y) => {
                const items = (rby && rby[String(y)]) || [];
                raw[y] = items;
                allItems.push(...items);
              });
              setBucketsByYear({});
              if (filterKey) {
                const uniq = Array.from(
                  new Set(allItems.map((r: any) => safeKey(r?.[filterKey])).filter((v) => v && v !== "(empty)"))
                ).sort((a, b) => a.localeCompare(b));
                setFilterValues(uniq);
                setSelectedFilterValues((prev) => prev.filter((v) => uniq.includes(v)));
              } else {
                setFilterValues([]);
                setSelectedFilterValues([]);
              }
              setRawMultiLineByYear(raw);
            }
            setFieldBarsByYear({});
            return;
          }
          setRawMultiLineByYear({});
          setBucketsByYear({});
          const fby = d.field_bars_by_year as Record<string, Array<{ key: string; label: string; value: unknown }>> | undefined;
          const outByYear: Record<number, Array<{ key: string; label: string; value: number | null }>> = {};
          if (fby) {
            Object.keys(fby).forEach((k) => {
              outByYear[Number(k)] = (fby[k] || []).map((row) => ({
                key: row.key,
                label: row.label,
                value: row.value != null && row.value !== "" ? toNumeric(row.value) : null,
              }));
            });
          }
          setFieldBarsByYear(outByYear);
          setSeriesByYear({});
          setFilterValues([]);
          setSelectedFilterValues([]);
        })
        .catch((e) => {
          if (isLikelyAbortError(e)) return;
          setError(e instanceof Error ? e.message : "Failed to load trend data");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      return () => ac.abort();
    }
    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      Promise.all(selectedYears.map((y) => fetchEntryForPeriod(token, organizationId, widget.kpi_id, y, widget.period_key))),
      mode === "multi_line_items" && widget.source_field_key
        ? Promise.all(
            selectedYears.map((y) =>
              fetchAllMultiItemsRows({
                token,
                organizationId,
                kpiId: widget.kpi_id,
                year: y,
                periodKey: widget.period_key,
                sourceFieldKey: widget.source_field_key || "",
                filters: widget.filters ?? null,
              })
            )
          )
        : Promise.resolve(null),
    ])
      .then(([map, entries, rowsByYear]) => {
        const years = [...selectedYears].sort((a, b) => b - a);
        const entryByYear = new Map<number, any>();
        selectedYears.forEach((y, i) => entryByYear.set(y, entries[i]));

        if (mode === "multi_line_items") {
          const sourceKey = widget.source_field_key || "";
          const groupBy = widget.group_by_sub_field_key || "";
          const agg = widget.agg || "count_rows";
          const valueKey = widget.value_sub_field_key;
          const filterKey = widget.filter_sub_field_key || "";
          const sourceId = sourceKey ? map.idByKey[sourceKey] : undefined;
          if (!sourceId || !groupBy) {
            setRawMultiLineByYear({});
            setSeriesByYear({});
            setFilterValues([]);
            setSelectedFilterValues([]);
            setFieldBarsByYear({});
            return;
          }

          const allItems: any[] = [];
          const rawItemsByYear = new Map<number, any[]>();
          years.forEach((y) => {
            const idx = selectedYears.indexOf(y);
            const items = Array.isArray(rowsByYear) && idx >= 0 ? rowsByYear[idx] ?? [] : [];
            rawItemsByYear.set(y, items);
            allItems.push(...items);
          });

          if (filterKey) {
            const uniq = Array.from(new Set(allItems.map((r: any) => safeKey(r?.[filterKey])).filter((v) => v && v !== "(empty)"))).sort((a, b) => a.localeCompare(b));
            setFilterValues(uniq);
            setSelectedFilterValues((prev) => prev.filter((v) => uniq.includes(v)));
          } else {
            setFilterValues([]);
            setSelectedFilterValues([]);
          }

          const raw: Record<number, any[]> = {};
          years.forEach((y) => {
            raw[y] = rawItemsByYear.get(y) ?? [];
          });
          setRawMultiLineByYear(raw);
          setFieldBarsByYear({});
          return;
        }

        setRawMultiLineByYear({});
        const keys = widget.field_keys || [];
        const outByYear: Record<number, Array<{ key: string; label: string; value: number | null }>> = {};
        selectedYears.forEach((y) => {
          const entry = entryByYear.get(y);
          outByYear[y] = keys.map((key) => {
            const fid = map.idByKey[key];
            return { key, label: map.nameByKey[key] ?? key, value: fid ? toNumeric(rawFieldFromEntry(entry, fid)) : null };
          });
        });
        setFieldBarsByYear(outByYear);
        setSeriesByYear({});
        setFilterValues([]);
        setSelectedFilterValues([]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load trend data"))
      .finally(() => setLoading(false));
  }, [
    token,
    organizationId,
    widget.kpi_id,
    widget.period_key,
    widget.id,
    widget.mode,
    widget.source_field_key,
    widget.group_by_sub_field_key,
    widget.agg,
    widget.value_sub_field_key,
    widget.filter_sub_field_key,
    JSON.stringify(widget.filters ?? null),
    JSON.stringify(widget.field_keys || []),
    JSON.stringify(selectedYears),
  ]);

  useEffect(() => {
    if (mode !== "multi_line_items") return;
    const groupBy = widget.group_by_sub_field_key || "";
    const agg = widget.agg || "count_rows";
    const valueKey = widget.value_sub_field_key;
    const filterKey = widget.filter_sub_field_key || "";
    if (!groupBy || selectedYears.length === 0) {
      setSeriesByYear({});
      return;
    }
    const years = [...selectedYears].sort((a, b) => b - a);
    const byYear: Record<number, Array<{ label: string; value: number }>> = {};
    years.forEach((y) => {
      const buckets = bucketsByYear[y];
      if (Array.isArray(buckets) && buckets.length > 0) {
        byYear[y] = rollupSqlBuckets(buckets as any, agg as any, filterKey, selectedFilterValues);
      } else {
        const items = rawMultiLineByYear[y] ?? [];
        const filtered =
          filterKey && selectedFilterValues.length > 0
            ? items.filter((r: any) => selectedFilterValues.includes(safeKey(r?.[filterKey])))
            : items;
        byYear[y] = aggregateMultiLine(filtered, { groupByKey: groupBy, agg, valueKey });
      }
    });
    setSeriesByYear(byYear);
  }, [
    mode,
    rawMultiLineByYear,
    bucketsByYear,
    selectedFilterValues,
    JSON.stringify(selectedYears),
    widget.group_by_sub_field_key,
    widget.agg,
    widget.value_sub_field_key,
    widget.filter_sub_field_key,
  ]);

  const toggleYear = (y: number) => {
    setSelectedYears((prev) => {
      const next = prev.includes(y) ? prev.filter((x) => x !== y) : [...prev, y];
      const uniq = Array.from(new Set(next)).filter((x) => yearOptions.includes(x));
      return uniq.sort((a, b) => b - a);
    });
  };

  const shownFilterValues = useMemo(() => {
    if (!filterEditing) return [];
    const q = filterSearch.trim().toLowerCase();
    return filterValues
      .filter((v) => !selectedFilterValues.includes(v))
      .filter((v) => (q ? v.toLowerCase().includes(q) : true))
      .slice(0, 50);
  }, [filterValues, selectedFilterValues, filterSearch, filterEditing]);

  const addTypedFilterValue = () => {
    const raw = filterSearch.trim();
    if (!raw) return;
    const match = filterValues.find((v) => v.toLowerCase() === raw.toLowerCase());
    const toAdd = match ?? shownFilterValues[0];
    if (!toAdd) return;
    setSelectedFilterValues((prev) => (prev.includes(toAdd) ? prev : [...prev, toAdd]));
    setFilterSearch("");
  };

  useEffect(() => {
    if (!setHeaderAddon) return;
    if (loading || error) {
      setHeaderAddon(null);
      return;
    }

    const yearsLabel =
      selectedYears.length === 0 ? "Select years" : selectedYears.length === 1 ? `${selectedYears[0]}` : `${selectedYears.length} years`;
    const pill = (
      <div
        style={{
          height: 36,
          padding: "0 0.65rem",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--muted)",
          fontSize: "0.85rem",
          display: "inline-flex",
          alignItems: "center",
        }}
        title="Selected years"
      >
        Years: {yearsLabel}
      </div>
    );

    if (mode !== "multi_line_items" || !widget.filter_sub_field_key) {
      setHeaderAddon(<div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>{pill}</div>);
      return;
    }

    const filterKey = widget.filter_sub_field_key || "";
    const filterLabel = (widget.filter_label || "").trim() || filterKey;
    const filterPillLabel =
      selectedFilterValues.length === 0 ? `All ${filterLabel}` : `${filterLabel}: ${selectedFilterValues.length} selected`;

    setHeaderAddon(
      <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
        {pill}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.35rem" }}>
          {!filterEditing ? (
            <button
              type="button"
              onClick={() => {
                setFilterEditing(true);
                window.setTimeout(() => filterInputRef.current?.focus(), 0);
              }}
              style={{
                height: 36,
                maxWidth: 260,
                padding: "0 0.65rem",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: selectedFilterValues.length > 0 ? "var(--accent)" : "var(--muted)",
                cursor: "pointer",
                fontSize: "0.85rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title="Click to filter"
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filterPillLabel}</span>
            </button>
          ) : (
            <>
              <div
                style={{
                  height: 36,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0 0.45rem",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                }}
              >
                <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{filterLabel}:</span>
                <input
                  ref={filterInputRef}
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder={filterValues.length === 0 ? "No values" : "Type to search"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTypedFilterValue();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setFilterEditing(false);
                      setFilterSearch("");
                    }
                  }}
                  style={{
                    width: 150,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    padding: 0,
                    fontSize: "0.9rem",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setFilterEditing(false);
                    setFilterSearch("");
                  }}
                  aria-label="Close filter"
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "var(--muted)",
                    fontSize: "1.1rem",
                    lineHeight: 1,
                    padding: 0,
                  }}
                  title="Close"
                >
                  ×
                </button>
              </div>

              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  zIndex: 45,
                  minWidth: 260,
                  maxWidth: "min(90vw, 360px)",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  borderRadius: 12,
                  boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
                  overflow: "hidden",
                }}
              >
                <div style={{ maxHeight: 240, overflow: "auto" }}>
                  {shownFilterValues.length === 0 ? (
                    <div style={{ padding: "0.55rem 0.7rem", color: "var(--muted)", fontSize: "0.85rem" }}>
                      {filterValues.length === 0 ? "No values." : "No matches."}
                    </div>
                  ) : (
                    shownFilterValues.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedFilterValues((prev) => (prev.includes(v) ? prev : [...prev, v]));
                          setFilterSearch("");
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          background: "transparent",
                          color: "inherit",
                          padding: "0.45rem 0.7rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          fontSize: "0.9rem",
                        }}
                        title={v}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }, [
    setHeaderAddon,
    loading,
    error,
    widget.id,
    mode,
    widget.filter_sub_field_key,
    widget.filter_label,
    JSON.stringify(selectedYears),
    filterEditing,
    filterSearch,
    JSON.stringify(filterValues),
    JSON.stringify(selectedFilterValues),
    JSON.stringify(shownFilterValues),
  ]);

  useEffect(() => {
    if (!setViewerMenu) return;
    if (loading || error) {
      setViewerMenu(null);
      return;
    }

    const viewToggle = (
      <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
        <button
          type="button"
          onClick={() => setViewerView("bar")}
          style={{
            padding: "0.25rem 0.55rem",
            border: "none",
            background: viewerView === "bar" ? "rgba(79,70,229,0.10)" : "transparent",
            color: viewerView === "bar" ? "var(--accent)" : "var(--text)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
          aria-pressed={viewerView === "bar"}
        >
          Bars
        </button>
        <button
          type="button"
          onClick={() => setViewerView("line")}
          style={{
            padding: "0.25rem 0.55rem",
            border: "none",
            borderLeft: "1px solid var(--border)",
            background: viewerView === "line" ? "rgba(79,70,229,0.10)" : "transparent",
            color: viewerView === "line" ? "var(--accent)" : "var(--text)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
          aria-pressed={viewerView === "line"}
        >
          Line
        </button>
      </div>
    );

    setViewerMenu(
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 4 }}>View</div>
          {viewToggle}
        </div>
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 6 }}>Years</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {yearOptions.map((y) => {
              const active = selectedYears.includes(y);
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => toggleYear(y)}
                  style={{
                    padding: "0.12rem 0.45rem",
                    borderRadius: 999,
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    background: active ? "rgba(79,70,229,0.10)" : "var(--surface)",
                    color: active ? "var(--accent)" : "var(--text)",
                    fontSize: "0.78rem",
                    cursor: "pointer",
                  }}
                  aria-pressed={active}
                >
                  {y}
                </button>
              );
            })}
          </div>
          {selectedYears.length === 0 && <div style={{ marginTop: 6, color: "var(--muted)", fontSize: "0.82rem" }}>Select at least one year.</div>}
        </div>
      </div>
    );
    return () => setViewerMenu(null);
  }, [setViewerMenu, loading, error, viewerView, JSON.stringify(yearOptions), JSON.stringify(selectedYears)]);

  const years = useMemo(() => [...selectedYears].sort((a, b) => a - b), [JSON.stringify(selectedYears)]);

  const sortBy = widget.sort_by || "value";
  const sortDir = widget.sort_dir || "desc";
  const dirMul = sortDir === "asc" ? 1 : -1;

  const barColorMode = widget.bar_color_mode || "solid";
  const barSolid = widget.bar_color || "var(--accent)";
  const barPalette =
    Array.isArray(widget.bar_palette) && widget.bar_palette.length
      ? widget.bar_palette
      : paletteForScheme(widget.bar_palette_scheme, 8);
  const barGradFrom = widget.bar_gradient_from || "var(--accent)";
  const barGradTo = widget.bar_gradient_to || "";

  const parseRgbColor = (raw: string) => {
    const s = raw.trim();
    const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.exec(s);
    if (!m) return null;
    const r = Math.max(0, Math.min(255, Number(m[1])));
    const g = Math.max(0, Math.min(255, Number(m[2])));
    const b = Math.max(0, Math.min(255, Number(m[3])));
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return { r, g, b };
  };

  const parseHslColor = (raw: string) => {
    const s = raw.trim();
    const m = /^hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.exec(s);
    if (!m) return null;
    let h = Number(m[1]);
    const sat = Number(m[2]) / 100;
    const light = Number(m[3]) / 100;
    if (![h, sat, light].every((n) => Number.isFinite(n))) return null;
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mm = light - c / 2;
    let rr = 0, gg = 0, bb = 0;
    if (h < 60) [rr, gg, bb] = [c, x, 0];
    else if (h < 120) [rr, gg, bb] = [x, c, 0];
    else if (h < 180) [rr, gg, bb] = [0, c, x];
    else if (h < 240) [rr, gg, bb] = [0, x, c];
    else if (h < 300) [rr, gg, bb] = [x, 0, c];
    else [rr, gg, bb] = [c, 0, x];
    const r = Math.round((rr + mm) * 255);
    const g = Math.round((gg + mm) * 255);
    const b = Math.round((bb + mm) * 255);
    return { r, g, b };
  };

  const parseHexColor = (raw: string) => {
    const s = raw.trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  const parseColor = (raw: string) => parseHexColor(raw) ?? parseRgbColor(raw) ?? parseHslColor(raw);

  const derivedGradTo = useMemo(() => {
    const raw = (barGradTo || "").trim();
    if (raw) return raw;
    const base = parseColor(String(barGradFrom || "").trim());
    if (!base) return "rgb(165, 180, 252)";
    const lum = 0.2126 * (base.r / 255) + 0.7152 * (base.g / 255) + 0.0722 * (base.b / 255);
    const toward = lum > 0.72 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    const t = lum > 0.72 ? 0.35 : 0.62;
    const r = Math.round(base.r + (toward.r - base.r) * t);
    const g = Math.round(base.g + (toward.g - base.g) * t);
    const b = Math.round(base.b + (toward.b - base.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }, [barGradFrom, barGradTo]);

  const colorForIndex = (idx: number, total: number) => {
    if (barColorMode === "palette") return barPalette[idx % barPalette.length];
    if (barColorMode === "solid") return barSolid;
    const base = parseColor(barGradFrom) ?? parseColor(barSolid);
    if (!base) return barGradFrom || barSolid;
    const rgbToHsl = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const rr = r / 255;
      const gg = g / 255;
      const bb = b / 255;
      const max = Math.max(rr, gg, bb);
      const min = Math.min(rr, gg, bb);
      const d = max - min;
      let h = 0;
      const l = (max + min) / 2;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (d !== 0) {
        if (max === rr) h = ((gg - bb) / d) % 6;
        else if (max === gg) h = (bb - rr) / d + 2;
        else h = (rr - gg) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      return { h, s: s * 100, l: l * 100 };
    };
    const { h, s, l } = rgbToHsl(base);
    const t = total <= 1 ? 0 : Math.min(1, Math.max(0, idx / (total - 1)));
    const lo = Math.max(12, Math.min(88, l - 26));
    const hi = Math.max(12, Math.min(88, l + 26));
    const ll = lo + (hi - lo) * t;
    return `hsl(${Math.round(h)}, ${Math.round(Math.max(18, Math.min(92, s)))}%, ${Math.round(ll)}%)`;
  };

  const yearColors = useMemo(() => {
    const out: Record<number, string> = {};
    years.forEach((y, i) => (out[y] = colorForIndex(i, years.length)));
    return out;
  }, [JSON.stringify(years), barColorMode, barSolid, barGradFrom, barGradTo, JSON.stringify(barPalette)]);

  const categories = useMemo(() => {
    if (mode !== "multi_line_items") return [];
    const union = new Map<string, number>();
    years.forEach((y) => {
      (seriesByYear[y] || []).forEach((g) => {
        union.set(g.label, Math.max(union.get(g.label) ?? 0, g.value));
      });
    });
    const latest = years.length ? years[years.length - 1] : null;
    const latestMap = new Map<string, number>((latest != null ? (seriesByYear[latest] || []) : []).map((g) => [g.label, g.value]));
    return Array.from(union.keys())
      .sort((a, b) => {
        if (sortBy === "x") return dirMul * a.localeCompare(b);
        return (
          dirMul * ((latestMap.get(a) ?? 0) - (latestMap.get(b) ?? 0)) ||
          dirMul * ((union.get(a) ?? 0) - (union.get(b) ?? 0)) ||
          dirMul * a.localeCompare(b)
        );
      })
      .slice(0, 12);
  }, [mode, JSON.stringify(years), JSON.stringify(seriesByYear), sortBy, sortDir]);

  return (
    <>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : selectedYears.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Select one or more years to view the trend.</p>
      ) : mode === "multi_line_items" ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {widget.filter_sub_field_key && selectedFilterValues.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
              {selectedFilterValues.map((v) => (
                <span
                  key={v}
                  style={{
                    display: "inline-flex",
                    gap: "0.25rem",
                    alignItems: "center",
                    padding: "0.1rem 0.4rem",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: "0.78rem",
                    maxWidth: 220,
                  }}
                  title={v}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedFilterValues((prev) => prev.filter((x) => x !== v))}
                    style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
                    aria-label={`Remove ${v}`}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {categories.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>No grouped data available.</p>
          ) : viewerView === "bar" ? (
            <div style={{ width: "100%", maxWidth: 840 }}>
              <svg
                viewBox="0 0 720 320"
                role="img"
                aria-label="Trend bars"
                style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
                onMouseLeave={() => setHoverTrendPt(null)}
                onTouchEnd={() => setHoverTrendPt(null)}
              >
                <rect x="0" y="0" width="720" height="320" fill="var(--bg)" rx="6" />
                {(() => {
                  const W = 720;
                  const H = 320;
                  const left = 44;
                  const right = 16;
                  const top = 18;
                  const bottom = 86;
                  const innerW = W - left - right;
                  const innerH = H - top - bottom;
                  const perCat = years.length;
                  const catGap = 10;
                  const barGap = 3;
                  const catW = categories.length > 0 ? Math.max(28, (innerW - catGap * (categories.length - 1)) / categories.length) : 28;
                  const barW = perCat > 0 ? Math.max(4, (catW - barGap * (perCat - 1)) / perCat) : 4;

                  let maxV = 1;
                  categories.forEach((c) => {
                    years.forEach((y) => {
                      const v = (seriesByYear[y] || []).find((g) => g.label === c)?.value ?? 0;
                      if (v > maxV) maxV = v;
                    });
                  });

                  return (
                    <>
                      <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                        {maxV.toLocaleString()}
                      </text>
                      {categories.map((c, i) => {
                        const catX = left + i * (catW + catGap);
                        return (
                          <g key={c}>
                            {years.map((y, j) => {
                              const v = (seriesByYear[y] || []).find((g) => g.label === c)?.value ?? 0;
                              const h = maxV > 0 ? (v / maxV) * innerH : 0;
                              const x = catX + j * (barW + barGap);
                              const yy = top + innerH - h;
                              return (
                                <rect
                                  key={`${c}:${y}`}
                                  x={x}
                                  y={yy}
                                  width={barW}
                                  height={h}
                                  fill={yearColors[y]}
                                  opacity={0.9}
                                  rx={2}
                                  onMouseEnter={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
                                  onMouseMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
                                  onTouchStart={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
                                  onTouchMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
                                />
                              );
                            })}
                            <text x={catX + catW / 2} y={H - 56} fontSize="9" fill="var(--muted)" textAnchor="middle">
                              {c.length > 14 ? `${c.slice(0, 12)}…` : c}
                            </text>
                          </g>
                        );
                      })}
                      {hoverTrendPt ? (
                        <g>
                          <line x1={hoverTrendPt.x} y1={top} x2={hoverTrendPt.x} y2={top + innerH} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                          {(() => {
                            const label = `${hoverTrendPt.series} · ${hoverTrendPt.label}: ${hoverTrendPt.value.toLocaleString()}`;
                            const padX = 8;
                            const boxW = Math.min(360, 12 + label.length * 6.2);
                            const boxH = 26;
                            const preferLeft = hoverTrendPt.x > W * 0.55;
                            const x = preferLeft ? Math.max(8, hoverTrendPt.x - boxW - 10) : Math.min(W - boxW - 8, hoverTrendPt.x + 10);
                            const y = Math.max(8, Math.min(H - boxH - 8, hoverTrendPt.y - boxH - 10));
                            return (
                              <g>
                                <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                                <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                                  {label}
                                </text>
                              </g>
                            );
                          })()}
                        </g>
                      ) : null}
                      <g>
                        {years.slice().reverse().map((y, i) => (
                          <g key={y} transform={`translate(${left + i * 96}, ${H - 34})`}>
                            <rect x="0" y="-9" width="10" height="10" fill={yearColors[y]} />
                            <text x="14" y="0" fontSize="10" fill="var(--muted)">
                              {y}
                            </text>
                          </g>
                        ))}
                      </g>
                    </>
                  );
                })()}
              </svg>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 840 }}>
              <svg
                viewBox="0 0 720 320"
                role="img"
                aria-label="Trend lines"
                style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
                onMouseLeave={() => setHoverTrendPt(null)}
                onTouchEnd={() => setHoverTrendPt(null)}
              >
                <rect x="0" y="0" width="720" height="320" fill="var(--bg)" rx="6" />
                {(() => {
                  const W = 720;
                  const H = 320;
                  const left = 52;
                  const right = 16;
                  const top = 18;
                  const bottom = 62;
                  const innerW = W - left - right;
                  const innerH = H - top - bottom;
                  const xStep = years.length > 1 ? innerW / (years.length - 1) : 0;

                  const topCats = categories.slice(0, 6);
                  const catColor = (idx: number) => colorForIndex(idx, topCats.length);

                  let maxV = 1;
                  topCats.forEach((c) => {
                    years.forEach((y) => {
                      const v = (seriesByYear[y] || []).find((g) => g.label === c)?.value ?? 0;
                      if (v > maxV) maxV = v;
                    });
                  });

                  return (
                    <>
                      <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                        {maxV.toLocaleString()}
                      </text>
                      {years.map((y, i) => (
                        <g key={y}>
                          <line x1={left + i * xStep} y1={top} x2={left + i * xStep} y2={top + innerH} stroke="var(--border)" strokeWidth="1" opacity={0.6} />
                          <text x={left + i * xStep} y={H - 16} fontSize="10" fill="var(--muted)" textAnchor="middle">
                            {y}
                          </text>
                        </g>
                      ))}
                      {topCats.map((c, idx) => {
                        const pts = years.map((y, i) => {
                          const v = (seriesByYear[y] || []).find((g) => g.label === c)?.value ?? 0;
                          const xx = left + i * xStep;
                          const yy = top + innerH - (maxV > 0 ? (v / maxV) * innerH : 0);
                          return { x: xx, y: yy, v };
                        });
                        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
                        return (
                          <g key={c}>
                            <path d={d} fill="none" stroke={catColor(idx)} strokeWidth="2.5" />
                            {pts.map((p, i) => (
                              <circle
                                key={`${c}:${i}`}
                                cx={p.x}
                                cy={p.y}
                                r="3"
                                fill={catColor(idx)}
                                onMouseEnter={() => setHoverTrendPt({ x: p.x, y: p.y, label: c, value: p.v, series: String(years[i]) })}
                                onMouseMove={() => setHoverTrendPt({ x: p.x, y: p.y, label: c, value: p.v, series: String(years[i]) })}
                                onTouchStart={() => setHoverTrendPt({ x: p.x, y: p.y, label: c, value: p.v, series: String(years[i]) })}
                                onTouchMove={() => setHoverTrendPt({ x: p.x, y: p.y, label: c, value: p.v, series: String(years[i]) })}
                              />
                            ))}
                          </g>
                        );
                      })}
                      {hoverTrendPt ? (
                        <g>
                          <line x1={hoverTrendPt.x} y1={top} x2={hoverTrendPt.x} y2={top + innerH} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                          <circle cx={hoverTrendPt.x} cy={hoverTrendPt.y} r={6} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
                          {(() => {
                            const label = `${hoverTrendPt.series} · ${hoverTrendPt.label}: ${hoverTrendPt.value.toLocaleString()}`;
                            const padX = 8;
                            const boxW = Math.min(380, 12 + label.length * 6.2);
                            const boxH = 26;
                            const preferLeft = hoverTrendPt.x > W * 0.55;
                            const x = preferLeft ? Math.max(8, hoverTrendPt.x - boxW - 10) : Math.min(W - boxW - 8, hoverTrendPt.x + 10);
                            const y = Math.max(8, Math.min(H - boxH - 8, hoverTrendPt.y - boxH - 10));
                            return (
                              <g>
                                <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                                <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                                  {label}
                                </text>
                              </g>
                            );
                          })()}
                        </g>
                      ) : null}
                      <g>
                        {topCats.map((c, i) => (
                          <g key={c} transform={`translate(${left + i * 110}, ${top + 12})`}>
                            <rect x="0" y="-9" width="10" height="10" fill={catColor(i)} />
                            <text x="14" y="0" fontSize="10" fill="var(--muted)">
                              {c.length > 16 ? `${c.slice(0, 14)}…` : c}
                            </text>
                          </g>
                        ))}
                      </g>
                    </>
                  );
                })()}
              </svg>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div style={{ width: "100%", maxWidth: 840 }}>
            <svg
              viewBox="0 0 720 320"
              role="img"
              aria-label="Field trend"
              style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
              onMouseLeave={() => setHoverTrendPt(null)}
              onTouchEnd={() => setHoverTrendPt(null)}
            >
              <rect x="0" y="0" width="720" height="320" fill="var(--bg)" rx="6" />
              {(() => {
                const W = 720;
                const H = 320;
                const left = 44;
                const right = 16;
                const top = 18;
                const bottom = 86;
                const innerW = W - left - right;
                const innerH = H - top - bottom;
                const rawKeys = (widget.field_keys || []).slice(0, 10);
                const latest = years.length ? years[years.length - 1] : null;
                const latestMap = new Map<string, number>(
                  rawKeys.map((k) => {
                    const v = latest != null ? (fieldBarsByYear[latest] || []).find((b) => b.key === k)?.value ?? 0 : 0;
                    return [k, v ?? 0];
                  })
                );
                const keys = [...rawKeys].sort((a, b) => {
                  if (sortBy === "x") return dirMul * a.localeCompare(b);
                  return dirMul * ((latestMap.get(a) ?? 0) - (latestMap.get(b) ?? 0)) || dirMul * a.localeCompare(b);
                });
                const perCat = years.length;
                const catGap = 10;
                const barGap = 3;
                const catW = keys.length > 0 ? Math.max(28, (innerW - catGap * (keys.length - 1)) / keys.length) : 28;
                const barW = perCat > 0 ? Math.max(4, (catW - barGap * (perCat - 1)) / perCat) : 4;

                let maxV = 1;
                keys.forEach((k) => {
                  years.forEach((y) => {
                    const v = (fieldBarsByYear[y] || []).find((b) => b.key === k)?.value ?? 0;
                    if (v > maxV) maxV = v;
                  });
                });

                return (
                  <>
                    <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                      {maxV.toLocaleString()}
                    </text>
                    {keys.map((k, i) => {
                      const catX = left + i * (catW + catGap);
                      return (
                        <g key={k}>
                          {years.map((y, j) => {
                            const v = (fieldBarsByYear[y] || []).find((b) => b.key === k)?.value ?? 0;
                            const h = maxV > 0 ? (v / maxV) * innerH : 0;
                            const x = catX + j * (barW + barGap);
                            const yy = top + innerH - h;
                            return (
                              <rect
                                key={`${k}:${y}`}
                                x={x}
                                y={yy}
                                width={barW}
                                height={h}
                                fill={yearColors[y]}
                                opacity={0.9}
                                rx={2}
                                onMouseEnter={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
                                onMouseMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
                                onTouchStart={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
                                onTouchMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
                              />
                            );
                          })}
                          <text x={catX + catW / 2} y={H - 56} fontSize="9" fill="var(--muted)" textAnchor="middle">
                            {k.length > 14 ? `${k.slice(0, 12)}…` : k}
                          </text>
                        </g>
                      );
                    })}
                    {hoverTrendPt ? (
                      <g>
                        <line x1={hoverTrendPt.x} y1={top} x2={hoverTrendPt.x} y2={top + innerH} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
                        {(() => {
                          const label = `${hoverTrendPt.series} · ${hoverTrendPt.label}: ${hoverTrendPt.value.toLocaleString()}`;
                          const padX = 8;
                          const boxW = Math.min(380, 12 + label.length * 6.2);
                          const boxH = 26;
                          const preferLeft = hoverTrendPt.x > W * 0.55;
                          const x = preferLeft ? Math.max(8, hoverTrendPt.x - boxW - 10) : Math.min(W - boxW - 8, hoverTrendPt.x + 10);
                          const y = Math.max(8, Math.min(H - boxH - 8, hoverTrendPt.y - boxH - 10));
                          return (
                            <g>
                              <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" />
                              <text x={x + padX} y={y + 17} fontSize="12" fill="var(--text)">
                                {label}
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    ) : null}
                    <g>
                      {years.slice().reverse().map((y, i) => (
                        <g key={y} transform={`translate(${left + i * 96}, ${H - 34})`}>
                          <rect x="0" y="-9" width="10" height="10" fill={yearColors[y]} />
                          <text x="14" y="0" fontSize="10" fill="var(--muted)">
                            {y}
                          </text>
                        </g>
                      ))}
                    </g>
                  </>
                );
              })()}
            </svg>
          </div>
        </div>
      )}
    </>
  );
}

function KpiTableWidget({
  widget,
  organizationId,
  designActions,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_table" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
}) {
  const token = getAccessToken();
  const [rows, setRows] = useState<Array<{ label: string; value: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    if (isWidgetDataBundleEnabled()) {
      const ac = new AbortController();
      const w = { ...(widget as unknown as Record<string, unknown>) };
      const bundleReq =
        dashboardId != null
          ? postDashboardKvTableWidgetData(
              token,
              { version: 1, organization_id: organizationId, dashboard_id: dashboardId, widget: w },
              { signal: ac.signal }
            )
          : postWidgetData(token, { version: 1, organization_id: organizationId, widget: w }, { signal: ac.signal });
      bundleReq
        .then((res) => {
          const drows = res.data.rows as Array<{ label: string; value: string }> | undefined;
          if (Array.isArray(drows)) {
            setRows(
              drows.map((r) => ({
                label: r.label,
                value: r.value || "",
              }))
            );
          } else {
            setRows([]);
          }
        })
        .catch((e) => {
          if (isLikelyAbortError(e)) return;
          setError(e instanceof Error ? e.message : "Failed to load KPI entry");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      return () => ac.abort();
    }
    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      (async () => {
        const q = new URLSearchParams({
          kpi_id: String(widget.kpi_id),
          year: String(widget.year),
          organization_id: String(organizationId),
        });
        if (widget.period_key) q.set("period_key", widget.period_key);
        return api<any>(`/entries/for-period?${q.toString()}`, { token });
      })(),
    ])
      .then(([map, entry]) => {
        const keys = widget.field_keys?.length ? widget.field_keys : Object.keys(map.idByKey);
        const out: Array<{ label: string; value: string }> = [];
        keys.forEach((k) => {
          const fid = map.idByKey[k];
          const raw = fid ? rawFieldFromEntry(entry, fid) : null;
          const val = raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
          out.push({ label: map.nameByKey[k] ?? k, value: val });
        });
        setRows(out);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load KPI entry"))
      .finally(() => setLoading(false));
  }, [token, widget.kpi_id, widget.year, widget.period_key, organizationId, JSON.stringify(widget.field_keys ?? [])]);

  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>No data.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem 0.25rem", fontWeight: 600, width: "40%" }}>{r.label}</td>
                  <td style={{ padding: "0.5rem 0.25rem" }}>{r.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetSettingsShell>
  );
}

function formatCellForTable(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function compareCellValues(a: unknown, b: unknown): number {
  const sa = formatCellForTable(a);
  const sb = formatCellForTable(b);
  const na = Number(String(sa).replace(/,/g, ""));
  const nb = Number(String(sb).replace(/,/g, ""));
  if (sa.trim() !== "" && sb.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
}

function KpiMultiLineTableWidgetInner({
  widget,
  organizationId,
  pageSize,
  onChangePageSize,
  pageSizeOptions,
  showOpenFullLink,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_multi_line_table" }>;
  organizationId: number;
  pageSize: number;
  onChangePageSize?: (n: number) => void;
  pageSizeOptions?: number[];
  showOpenFullLink: boolean;
  dashboardId?: number;
}) {
  const token = getAccessToken();
  const setViewerMenu = useWidgetViewerMenuSetter();
  const setHeaderAddon = useWidgetHeaderAddonSetter();
  const [viewerYear, setViewerYear] = useState<number>(widget.year);
  const [yearOptions, setYearOptions] = useState<number[]>([]);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [labelByKey, setLabelByKey] = useState<Record<string, string>>({});
  const [sourceFieldId, setSourceFieldId] = useState<number | null>(null);
  const [joinIndexes, setJoinIndexes] = useState<Array<Record<string, Record<string, unknown>>>>([]);
  const [joinLabels, setJoinLabels] = useState<Array<Record<string, string>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  const allowedKeys = widget.sub_field_keys ?? [];
  const joinSpecs: Array<{
    kpi_id: number;
    source_field_key: string;
    on_left_sub_field_key: string;
    on_right_sub_field_key: string;
    sub_field_keys: string[];
  }> = useMemo(() => {
    const list: any[] = Array.isArray((widget as any).joins) ? ((widget as any).joins as any[]) : [];
    const legacy = (widget as any).join && typeof (widget as any).join === "object" ? [(widget as any).join] : [];
    const merged = [...list, ...legacy].filter((j) => j && typeof j === "object");
    return merged
      .map((j) => ({
        kpi_id: typeof j.kpi_id === "number" ? j.kpi_id : NaN,
        source_field_key: String(j.source_field_key || ""),
        on_left_sub_field_key: String(j.on_left_sub_field_key || ""),
        on_right_sub_field_key: String(j.on_right_sub_field_key || ""),
        sub_field_keys: Array.isArray(j.sub_field_keys) ? (j.sub_field_keys as string[]).filter(Boolean) : [],
      }))
      .filter((j) => Number.isFinite(j.kpi_id) && j.source_field_key && j.on_left_sub_field_key && j.on_right_sub_field_key);
  }, [JSON.stringify((widget as any).joins ?? null), JSON.stringify((widget as any).join ?? null)]);

  const hasJoins = joinSpecs.length > 0;

  const joinLookup = (joinIdx: number, row: Record<string, unknown>): Record<string, unknown> | null => {
    const spec = joinSpecs[joinIdx];
    if (!spec) return null;
    const leftKey = spec.on_left_sub_field_key;
    const k = leftKey ? String(row?.[leftKey] ?? "").trim() : "";
    if (!k) return null;
    return joinIndexes[joinIdx]?.[k] ?? null;
  };

  useEffect(() => {
    const base = allowedKeys.length ? [...allowedKeys] : [];
    const joinBase = joinSpecs.flatMap((j, idx) => (j.sub_field_keys || []).map((k) => `join:${idx}:${k}`));
    setVisibleKeys([...base, ...joinBase]);
    setSortKey(null);
    setSortDir("asc");
    setSearch("");
    setPage(0);
    setViewerYear(widget.year);
  }, [widget.id, JSON.stringify(allowedKeys), JSON.stringify(joinSpecs)]);

  useEffect(() => {
    if (!token) return;
    const now = new Date().getFullYear();
    const base = Array.from({ length: 12 }, (_, i) => now - i);
    const mustInclude = new Set<number>([widget.year, viewerYear, ...base]);
    const nextYear = now + 1;
    (async () => {
      try {
        const en = await fetchEntryForPeriod(token, organizationId, widget.kpi_id, nextYear, widget.period_key);
        if (entryHasAnyData(en)) mustInclude.add(nextYear);
      } catch {
        // ignore
      }
      const list = Array.from(mustInclude).sort((a, b) => b - a);
      setYearOptions(list);
    })();
  }, [token, organizationId, widget.kpi_id, widget.period_key, widget.id, widget.year, viewerYear]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    if (isWidgetDataBundleEnabled()) {
      const ac = new AbortController();
      const w = { ...(widget as unknown as Record<string, unknown>) };
      const bundleReq =
        dashboardId != null
          ? postDashboardTableWidgetData(
              token,
              {
                version: 1,
                organization_id: organizationId,
                dashboard_id: dashboardId,
                widget: w,
                overrides: { year: viewerYear },
              },
              { signal: ac.signal }
            )
          : postWidgetData(
              token,
              { version: 1, organization_id: organizationId, widget: w, overrides: { year: viewerYear } },
              { signal: ac.signal }
            );
      bundleReq
        .then((res) => {
          const d = res.data;
          const sid = d.source_field_id;
          setSourceFieldId(typeof sid === "number" ? sid : null);
          const rows = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
          setItems(rows);
          setLabelByKey((d.sub_field_labels as Record<string, string>) || {});

          const jpack = (d.joins as Array<{ rows?: unknown; sub_field_labels?: Record<string, string> }>) || [];
          const nextJoinLabels: Array<Record<string, string>> = [];
          const nextJoinIndexes: Array<Record<string, Record<string, unknown>>> = [];
          if (joinSpecs.length === 0) {
            setJoinLabels([]);
            setJoinIndexes([]);
            return;
          }
          jpack.forEach((j, idx) => {
            const spec = joinSpecs[idx];
            if (!spec) return;
            nextJoinLabels[idx] = j.sub_field_labels || {};
            const joinRows = Array.isArray(j.rows) ? (j.rows as Record<string, unknown>[]) : [];
            const ix: Record<string, Record<string, unknown>> = {};
            const rightKey = spec.on_right_sub_field_key;
            joinRows.forEach((r) => {
              const k = rightKey ? String((r as any)?.[rightKey] ?? "").trim() : "";
              if (!k) return;
              if (!ix[k]) ix[k] = r;
            });
            nextJoinIndexes[idx] = ix;
          });
          setJoinLabels(nextJoinLabels);
          setJoinIndexes(nextJoinIndexes);
        })
        .catch((e) => {
          if (isLikelyAbortError(e)) return;
          setError(e instanceof Error ? e.message : "Failed to load table data");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      return () => ac.abort();
    }
    Promise.all([
      getKpiFieldsWithSubs(token, organizationId, widget.kpi_id),
      fetchEntryForPeriod(token, organizationId, widget.kpi_id, viewerYear, widget.period_key),
      widget.source_field_key
        ? fetchAllMultiItemsRows({
            token,
            organizationId,
            kpiId: widget.kpi_id,
            year: viewerYear,
            periodKey: widget.period_key,
            sourceFieldKey: widget.source_field_key,
            filters: widget.filters ?? null,
          })
        : Promise.resolve([]),
      ...joinSpecs.map((j) =>
        Promise.all([
          getKpiFieldsWithSubs(token, organizationId, j.kpi_id),
          fetchEntryForPeriod(token, organizationId, j.kpi_id, viewerYear, widget.period_key),
          j.source_field_key
            ? fetchAllMultiItemsRows({
                token,
                organizationId,
                kpiId: j.kpi_id,
                year: viewerYear,
                periodKey: widget.period_key,
                sourceFieldKey: j.source_field_key,
                filters: null,
              })
            : Promise.resolve([]),
        ])
      ),
    ])
      .then(([fields, entry, primaryRows, ...joinResults]) => {
        const source = fields.find((f) => f.key === widget.source_field_key && f.field_type === "multi_line_items");
        const fid = source?.id;
        setSourceFieldId(typeof fid === "number" ? fid : null);
        const rows = Array.isArray(primaryRows) ? (primaryRows as Record<string, unknown>[]) : [];
        setItems(rows);
        const labels: Record<string, string> = {};
        (source?.sub_fields ?? []).forEach((sf) => {
          labels[sf.key] = sf.name;
        });
        setLabelByKey(labels);

        const nextJoinLabels: Array<Record<string, string>> = [];
        const nextJoinIndexes: Array<Record<string, Record<string, unknown>>> = [];
        joinResults.forEach((jr, idx) => {
          const spec = joinSpecs[idx];
          const [joinFields, _joinEntry, joinRowsFetched] = jr as any;
          const joinSource = joinFields.find((f: any) => f.key === spec.source_field_key && f.field_type === "multi_line_items");
          const joinRows = Array.isArray(joinRowsFetched) ? (joinRowsFetched as Record<string, unknown>[]) : [];
          const labels: Record<string, string> = {};
          (joinSource?.sub_fields ?? []).forEach((sf: any) => {
            labels[sf.key] = sf.name;
          });
          nextJoinLabels[idx] = labels;
          const ix: Record<string, Record<string, unknown>> = {};
          const rightKey = spec.on_right_sub_field_key;
          joinRows.forEach((r) => {
            const k = rightKey ? String((r as any)?.[rightKey] ?? "").trim() : "";
            if (!k) return;
            if (!ix[k]) ix[k] = r;
          });
          nextJoinIndexes[idx] = ix;
        });
        setJoinLabels(nextJoinLabels);
        setJoinIndexes(nextJoinIndexes);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load table data"))
      .finally(() => setLoading(false));
  }, [
    token,
    organizationId,
    widget.kpi_id,
    viewerYear,
    widget.period_key,
    widget.source_field_key,
    JSON.stringify(widget.filters ?? null),
    JSON.stringify((widget as any).joins ?? null),
    JSON.stringify((widget as any).join ?? null),
  ]);

  const joinAllowedKeySpecs = useMemo(
    () =>
      joinSpecs.flatMap((j, idx) => (j.sub_field_keys || []).map((k) => ({ idx, key: k, full: `join:${idx}:${k}` }))),
    [JSON.stringify(joinSpecs)]
  );

  const orderedKeys = useMemo(() => {
    const base =
      Array.isArray(widget.column_order) && widget.column_order.length
        ? widget.column_order
        : [...allowedKeys, ...joinAllowedKeySpecs.map((x) => x.full)];
    const allowSet = new Set<string>([...allowedKeys, ...joinAllowedKeySpecs.map((x) => x.full)]);
    return base.filter((k) => allowSet.has(k) && visibleKeys.includes(k));
  }, [JSON.stringify(widget.column_order ?? null), JSON.stringify(allowedKeys), JSON.stringify(joinAllowedKeySpecs), JSON.stringify(visibleKeys)]);

  const orderedPrimaryKeys = useMemo(() => orderedKeys.filter((k) => !k.startsWith("join:")), [orderedKeys]);
  const orderedJoinCols = useMemo(() => {
    return orderedKeys
      .filter((k) => k.startsWith("join:"))
      .map((k) => {
        const parts = k.split(":");
        const idx = Number(parts[1]);
        const key = parts.slice(2).join(":");
        return { joinIdx: Number.isFinite(idx) ? idx : -1, key, full: k };
      })
      .filter((x) => x.joinIdx >= 0 && !!x.key);
  }, [orderedKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const leftHit = allowedKeys.some((k) => formatCellForTable(row[k]).toLowerCase().includes(q));
      if (leftHit) return true;
      if (!hasJoins) return false;
      return joinAllowedKeySpecs.some(({ idx, key }) => {
        const j = joinLookup(idx, row);
        if (!j) return false;
        return formatCellForTable(j[key]).toLowerCase().includes(q);
      });
    });
  }, [items, search, allowedKeys, hasJoins, JSON.stringify(joinAllowedKeySpecs), JSON.stringify(joinIndexes)]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    if (sortKey.startsWith("join:")) {
      const raw = sortKey.slice("join:".length);
      const parts = raw.split(":");
      const joinIdx = Number(parts[0]);
      const k = parts.slice(1).join(":");
      if (!Number.isFinite(joinIdx) || !k) return filtered;
      if (!orderedJoinCols.some((x) => x.joinIdx === joinIdx && x.key === k)) return filtered;
      const dir = sortDir === "asc" ? 1 : -1;
      return [...filtered].sort((a, b) => dir * compareCellValues((joinLookup(joinIdx, a) ?? {})[k], (joinLookup(joinIdx, b) ?? {})[k]));
    }
    if (!orderedPrimaryKeys.includes(sortKey)) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => dir * compareCellValues(a[sortKey], b[sortKey]));
  }, [filtered, sortKey, sortDir, orderedPrimaryKeys, JSON.stringify(joinIndexes), JSON.stringify(orderedJoinCols)]);

  useEffect(() => {
    setPage(0);
  }, [search, sortKey, sortDir, JSON.stringify(orderedKeys), items.length]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sorted.length / Math.max(1, pageSize))), [sorted.length, pageSize]);
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(() => {
    const start = safePage * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  const toggleColumn = (key: string) => {
    setVisibleKeys((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((x) => x !== key);
        return next.length === 0 ? [key] : next;
      }
      return [...prev, key];
    });
  };
  const toggleJoinColumn = (key: string) => {
    // key is `${joinIdx}:${subKey}`
    const full = `join:${key}`;
    setVisibleKeys((prev) => {
      if (prev.includes(full)) {
        const next = prev.filter((x) => x !== full);
        return next.length === 0 ? [full] : next;
      }
      return [...prev, full];
    });
  };

  const onHeaderClick = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  useEffect(() => {
    if (!setHeaderAddon) return;
    const now = new Date().getFullYear();
    const yearSelect = (
      <select
        value={viewerYear}
        onChange={(e) => setViewerYear(Number(e.target.value))}
        style={{ height: 36, padding: "0.35rem 0.45rem", fontSize: "0.85rem" }}
        title="Year"
      >
        {(yearOptions.length ? yearOptions : [now]).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    );

    setHeaderAddon(
      <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
        {yearSelect}
        {showOpenFullLink ? (
          sourceFieldId != null ? (
            <Link
              href={`/dashboard/entries/${widget.kpi_id}/${viewerYear}/multi/${sourceFieldId}?${new URLSearchParams({
                organization_id: String(organizationId),
                ...(dashboardId != null ? { dashboard_id: String(dashboardId) } : {}),
                widget_id: String(widget.id),
                ...(Array.isArray(widget.sub_field_keys) && widget.sub_field_keys.length > 0
                  ? { cols: widget.sub_field_keys.join(",") }
                  : {}),
                ...(widget.filters && widget.filters.conditions?.length ? { filters: JSON.stringify(widget.filters) } : {}),
                ...(widget.period_key ? { period_key: widget.period_key } : {}),
              }).toString()}`}
              className="btn"
              style={{ fontSize: "0.85rem", textDecoration: "none", height: 36, display: "inline-flex", alignItems: "center" }}
            >
              Full Page View
            </Link>
          ) : dashboardId != null ? (
            <Link
              href={`/dashboard/dashboards/${dashboardId}/widgets/${widget.id}`}
              className="btn"
              style={{ fontSize: "0.85rem", textDecoration: "none", height: 36, display: "inline-flex", alignItems: "center" }}
            >
              Full Page View
            </Link>
          ) : null
        ) : null}
      </div>
    );
    return () => setHeaderAddon(null);
  }, [setHeaderAddon, showOpenFullLink, dashboardId, widget.id, widget.kpi_id, widget.period_key, organizationId, viewerYear, sourceFieldId, JSON.stringify(yearOptions)]);

  useEffect(() => {
    if (!setViewerMenu) return;
    if (loading || error || (allowedKeys.length === 0 && joinAllowedKeySpecs.length === 0)) {
      setViewerMenu(null);
      return;
    }
    setViewerMenu(
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Columns</div>
        {allowedKeys.map((k) => (
          <label
            key={k}
            style={{
              display: "flex",
              gap: "0.45rem",
              alignItems: "center",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={visibleKeys.includes(k)} onChange={() => toggleColumn(k)} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k}>
              {labelByKey[k] ?? k}
            </span>
          </label>
        ))}
        {hasJoins && joinAllowedKeySpecs.length > 0 && (
          <>
            <div style={{ height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Joined columns</div>
            {joinAllowedKeySpecs.map(({ idx, key, full }) => (
              <label
                key={full}
                style={{
                  display: "flex",
                  gap: "0.45rem",
                  alignItems: "center",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={visibleKeys.includes(full)} onChange={() => toggleJoinColumn(`${idx}:${key}`)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={full}>
                  {(joinLabels[idx] ?? {})[key] ?? key}
                </span>
              </label>
            ))}
          </>
        )}
      </div>
    );
    return () => setViewerMenu(null);
  }, [
    setViewerMenu,
    loading,
    error,
    JSON.stringify(allowedKeys),
    JSON.stringify(joinAllowedKeySpecs),
    JSON.stringify(visibleKeys),
    JSON.stringify(labelByKey),
    JSON.stringify(joinLabels),
    hasJoins,
  ]);

  return (
    <>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rows…"
              style={{
                width: "min(680px, 100%)",
                padding: "0.45rem 0.6rem",
                fontSize: "0.95rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                boxSizing: "border-box",
              }}
            />
          </div>
          {sorted.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>No rows to show.</p>
          ) : orderedKeys.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>Select at least one column.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    {orderedPrimaryKeys.map((k) => (
                      <th key={k} style={{ textAlign: "left", padding: "0.45rem 0.5rem", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => onHeaderClick(k)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            font: "inherit",
                            fontWeight: 700,
                            color: "var(--text)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                          }}
                        >
                          {labelByKey[k] ?? k}
                          {sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                      </th>
                    ))}
                    {hasJoins &&
                      orderedJoinCols.map(({ joinIdx, key, full }) => (
                        <th key={full} style={{ textAlign: "left", padding: "0.45rem 0.5rem", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            onClick={() => onHeaderClick(full)}
                            style={{
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              cursor: "pointer",
                              font: "inherit",
                              fontWeight: 700,
                              color: "var(--text)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.25rem",
                            }}
                          >
                            {(joinLabels[joinIdx] ?? {})[key] ?? key}
                            {sortKey === full ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                          </button>
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                      {orderedPrimaryKeys.map((k) => (
                        <td key={k} style={{ padding: "0.45rem 0.5rem", verticalAlign: "top" }}>
                          {formatCellForTable(row[k]) || "—"}
                        </td>
                      ))}
                      {hasJoins &&
                        orderedJoinCols.map(({ joinIdx, key, full }) => (
                          <td key={full} style={{ padding: "0.45rem 0.5rem", verticalAlign: "top" }}>
                            {formatCellForTable((joinLookup(joinIdx, row) ?? {})[key]) || "—"}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(sorted.length > pageSize || onChangePageSize) && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              {onChangePageSize ? (
                <div style={{ display: "inline-flex", gap: "0.45rem", alignItems: "center" }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => onChangePageSize(Number(e.target.value))}
                    style={{ height: 34, padding: "0.3rem 0.45rem", fontSize: "0.85rem" }}
                    title="Rows per page"
                  >
                    {(pageSizeOptions?.length ? pageSizeOptions : [5, 10, 25, 50, 100]).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <span style={{ color: "var(--muted)", fontSize: "0.85rem", marginLeft: "auto" }}>
                Page {safePage + 1} of {totalPages}
              </span>

              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button type="button" className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
                  Prev
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function KpiMultiLineTableWidget({
  widget,
  organizationId,
  designActions,
  dashboardId,
  isFullPage,
  tableRowsPerPage,
  onTableRowsPerPageChange,
  tableRowsPerPageOptions,
}: {
  widget: Extract<Widget, { type: "kpi_multi_line_table" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
  isFullPage?: boolean;
  tableRowsPerPage?: number;
  onTableRowsPerPageChange?: (n: number) => void;
  tableRowsPerPageOptions?: number[];
}) {
  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      <KpiMultiLineTableWidgetInner
        widget={widget}
        organizationId={organizationId}
        pageSize={Math.max(1, tableRowsPerPage ?? (isFullPage ? 10 : widget.rows_limit ?? 5))}
        onChangePageSize={onTableRowsPerPageChange}
        pageSizeOptions={tableRowsPerPageOptions}
        showOpenFullLink={!isFullPage}
        dashboardId={dashboardId}
      />
    </WidgetSettingsShell>
  );
}

