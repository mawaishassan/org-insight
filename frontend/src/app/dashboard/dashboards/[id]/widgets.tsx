"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

export type WidgetDesignMenuActions = {
  onEdit: () => void;
  onDelete: () => void;
  onToggleFullWidth: () => void;
  isFullWidth: boolean;
};

const WidgetViewerMenuSetterContext = createContext<React.Dispatch<React.SetStateAction<React.ReactNode>> | null>(null);
const WidgetHeaderAddonSetterContext = createContext<React.Dispatch<React.SetStateAction<React.ReactNode>> | null>(null);

function useWidgetViewerMenuSetter() {
  return useContext(WidgetViewerMenuSetterContext);
}

function useWidgetHeaderAddonSetter() {
  return useContext(WidgetHeaderAddonSetterContext);
}

export type Widget =
  | { id: string; type: "text"; title?: string; text?: string; full_width?: boolean }
  | { id: string; type: "kpi_single_value"; title?: string; kpi_id: number; year: number; period_key?: string | null; field_key: string; full_width?: boolean }
  | { id: string; type: "kpi_table"; title?: string; kpi_id: number; year: number; period_key?: string | null; field_keys?: string[]; full_width?: boolean }
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
      // multi_line_items mode
      source_field_key?: string;
      agg?: "count_rows" | "sum" | "avg";
      group_by_sub_field_key?: string;
      value_sub_field_key?: string;
      filter_sub_field_key?: string;
      /** Optional viewer-facing label for filter button */
      filter_label?: string;
      full_width?: boolean;
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
      full_width?: boolean;
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
    };

type KpiFieldMap = { idByKey: Record<string, number>; keyById: Record<number, string>; nameByKey: Record<string, string> };
type KpiFieldWithSubs = {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields?: Array<{ id: number; key: string; name: string; field_type: string }>;
};
const _kpiFieldsDetailCache: Record<string, Promise<KpiFieldWithSubs[]> | undefined> = {};

async function getKpiFieldsWithSubs(token: string, organizationId: number, kpiId: number): Promise<KpiFieldWithSubs[]> {
  const cacheKey = `${organizationId}:${kpiId}:subs`;
  if (_kpiFieldsDetailCache[cacheKey]) return _kpiFieldsDetailCache[cacheKey];
  _kpiFieldsDetailCache[cacheKey] = api<KpiFieldWithSubs[]>(
    `/fields?kpi_id=${kpiId}&organization_id=${organizationId}`,
    { token }
  ).catch(() => []);
  return _kpiFieldsDetailCache[cacheKey];
}
const _kpiFieldMapCache: Record<string, Promise<KpiFieldMap> | undefined> = {};

async function getKpiFieldMap(token: string, organizationId: number, kpiId: number): Promise<KpiFieldMap> {
  const cacheKey = `${organizationId}:${kpiId}`;
  if (_kpiFieldMapCache[cacheKey]) return _kpiFieldMapCache[cacheKey];
  _kpiFieldMapCache[cacheKey] = api<Array<{ id: number; key: string; name: string }>>(
    `/fields?kpi_id=${kpiId}&organization_id=${organizationId}`,
    { token }
  )
    .then((fields) => {
      const idByKey: Record<string, number> = {};
      const keyById: Record<number, string> = {};
      const nameByKey: Record<string, string> = {};
      fields.forEach((f) => {
        idByKey[f.key] = f.id;
        keyById[f.id] = f.key;
        nameByKey[f.key] = f.name;
      });
      return { idByKey, keyById, nameByKey };
    })
    .catch(() => ({ idByKey: {}, keyById: {}, nameByKey: {} }));
  return _kpiFieldMapCache[cacheKey];
}

function MenuRow({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
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
        background: "transparent",
        fontSize: "0.9rem",
        cursor: "pointer",
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
  const [viewerMenu, setViewerMenu] = useState<React.ReactNode>(null);
  const [headerAddon, setHeaderAddon] = useState<React.ReactNode>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewerMenu(null);
    setOpen(false);
  }, [widgetKey]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hasDesign = !!designActions;
  const hasViewer = viewerMenu != null;
  const showEmptyHint = open && !hasDesign && !hasViewer;

  return (
    <WidgetViewerMenuSetterContext.Provider value={setViewerMenu}>
      <WidgetHeaderAddonSetterContext.Provider value={setHeaderAddon}>
        <div className="card" style={{ padding: "1rem", position: "relative" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              alignItems: "flex-start",
              gap: "0.5rem",
              marginBottom: "0.75rem",
              minHeight: title ? undefined : 36,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              {title ? (
                <h3 style={{ margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h3>
              ) : null}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
              {headerAddon ? <div style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{headerAddon}</div> : null}
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
                      onClick={() => {
                        designActions!.onToggleFullWidth();
                      }}
                    >
                      {designActions!.isFullWidth ? "Use half width" : "Use full width"}
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
                {showEmptyHint && (
                  <div style={{ padding: "0.65rem", color: "var(--muted)", fontSize: "0.85rem" }}>No options for this widget.</div>
                )}
                  </div>
                )}
              </div>
            </div>
        </div>
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
}: {
  widget: Widget;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
  isFullPage?: boolean;
  tableRowsPerPage?: number;
}) {
  if (widget.type === "text") {
    return (
      <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
        <div style={{ whiteSpace: "pre-wrap" }}>{widget.text || ""}</div>
      </WidgetSettingsShell>
    );
  }
  if (widget.type === "kpi_single_value") {
    return <KpiSingleValueWidget widget={widget} organizationId={organizationId} designActions={designActions} />;
  }
  if (widget.type === "kpi_table") {
    return <KpiTableWidget widget={widget} organizationId={organizationId} designActions={designActions} />;
  }
  if (widget.type === "kpi_line_chart") {
    return <KpiLineChartWidget widget={widget} organizationId={organizationId} designActions={designActions} />;
  }
  if (widget.type === "kpi_bar_chart") {
    return <KpiBarChartWidget widget={widget} organizationId={organizationId} designActions={designActions} />;
  }
  if (widget.type === "kpi_card_single_value") {
    return <KpiCardSingleValueWidget widget={widget} organizationId={organizationId} designActions={designActions} />;
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
}: {
  widget: Extract<Widget, { type: "kpi_single_value" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
}) {
  const token = getAccessToken();
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
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
}: {
  widget: Extract<Widget, { type: "kpi_card_single_value" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
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

    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      fetchEntryForPeriod(token, organizationId, widget.kpi_id, widget.year, widget.period_key),
    ])
      .then(([map, entry]) => {
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
          const sourceKey = widget.source_field_key || "";
          const sourceId = sourceKey ? map.idByKey[sourceKey] : undefined;
          const raw = sourceId ? rawFieldFromEntry(entry, sourceId) : null;
          const items = Array.isArray(raw) ? raw : [];
          const agg = widget.agg || "count";
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
}: {
  widget: Extract<Widget, { type: "kpi_line_chart" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
}) {
  const token = getAccessToken();
  const [points, setPoints] = useState<Array<{ year: number; value: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const start = Math.min(widget.start_year, widget.end_year);
    const end = Math.max(widget.start_year, widget.end_year);
    const years: number[] = [];
    for (let y = start; y <= end; y++) years.push(y);
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
          <svg viewBox="0 0 640 240" role="img" aria-label="Line chart" style={{ width: "100%", height: "auto", display: "block" }}>
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
  out.sort((a, b) => b.value - a.value);
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
}: {
  widget: Extract<Widget, { type: "kpi_bar_chart" }>;
  organizationId: number;
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

  useEffect(() => {
    setViewerChartType(widget.chart_type || "bar");
    setHiddenSeriesKeys([]);
    setViewerYear(widget.year);
    setSelectedFilterValues([]);
    setFilterSearch("");
    setFilterEditing(false);
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
    Promise.all([getKpiFieldMap(token, organizationId, widget.kpi_id), fetchEntryForPeriod(token, organizationId, widget.kpi_id, viewerYear, widget.period_key)])
      .then(([map, entry]) => {
        const mode = widget.mode || "fields";
        if (mode === "multi_line_items") {
          const sourceKey = widget.source_field_key || "";
          const groupBy = widget.group_by_sub_field_key || "";
          const agg = widget.agg || "count_rows";
          const valueKey = widget.value_sub_field_key;
          const filterKey = widget.filter_sub_field_key || "";
          const sourceId = sourceKey ? map.idByKey[sourceKey] : undefined;
          if (!sourceId || !groupBy) {
            setGroups([]);
            return;
          }
          const raw = rawFieldFromEntry(entry, sourceId);
          const items = Array.isArray(raw) ? raw : [];
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
          const filtered =
            filterKey && selectedFilterValues.length > 0
              ? items.filter((r: any) => selectedFilterValues.includes(safeKey(r?.[filterKey])))
              : items;
          const aggRows = aggregateMultiLine(filtered, { groupByKey: groupBy, agg, valueKey });
          setGroups(aggRows);
          setBars([]);
          return;
        }
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
    JSON.stringify(selectedFilterValues),
  ]);

  const mode = widget.mode || "fields";
  const chartType = viewerChartType;
  const numeric = bars.filter((b) => b.value != null) as { key: string; label: string; value: number }[];
  const vals = numeric.map((b) => b.value);
  const maxV = vals.length ? Math.max(...vals, 0) : 1;
  const groupVals = groups.map((g) => g.value);
  const maxG = groupVals.length ? Math.max(...groupVals, 0) : 1;

  const visibleGroups = useMemo(() => groups.filter((g) => !hiddenSeriesKeys.includes(g.label)), [groups, JSON.stringify(hiddenSeriesKeys)]);
  const visibleNumeric = useMemo(() => numeric.filter((b) => !hiddenSeriesKeys.includes(b.key)), [JSON.stringify(numeric), JSON.stringify(hiddenSeriesKeys)]);

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
    JSON.stringify(numeric.map((b) => b.key)),
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
              <svg viewBox="0 0 640 300" role="img" aria-label="Pie chart" style={{ width: "100%", height: "auto", display: "block" }}>
                <rect x="0" y="0" width="640" height="300" fill="var(--bg)" rx="6" />
                {(() => {
                  const total = visibleGroups.reduce((s, g) => s + g.value, 0) || 1;
                  const cx = 210;
                  const cy = 150;
                  const r = 110;
                  let a = -Math.PI / 2;
                  const colors = ["var(--accent)", "rgba(79,70,229,0.65)", "rgba(79,70,229,0.45)", "rgba(79,70,229,0.3)"];
                  return (
                    <>
                      {visibleGroups.slice(0, 12).map((g, i) => {
                        const frac = g.value / total;
                        const next = a + frac * Math.PI * 2;
                        const d = pieArcPath(cx, cy, r, a, next);
                        a = next;
                        return <path key={g.label} d={d} fill={colors[i % colors.length]} stroke="var(--surface)" strokeWidth="1" />;
                      })}
                      <text x="420" y="34" fontSize="12" fill="var(--muted)">
                        Top groups
                      </text>
                      {visibleGroups.slice(0, 8).map((g, i) => (
                        <g key={g.label}>
                          <rect x="420" y={52 + i * 26} width="10" height="10" fill={colors[i % colors.length]} />
                          <text x="436" y={61 + i * 26} fontSize="11" fill="var(--text)">
                            {g.label.length > 22 ? `${g.label.slice(0, 20)}…` : g.label} ({g.value.toLocaleString()})
                          </text>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 720 }}>
              <svg viewBox="0 0 640 260" role="img" aria-label="Bar chart" style={{ width: "100%", height: "auto", display: "block" }}>
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
                  return (
                    <>
                      <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                        {maxG.toLocaleString()}
                      </text>
                      {data.map((b, i) => {
                        const x = left + i * (barW + gap);
                        const h = maxG > 0 ? (b.value / maxG) * innerH : 0;
                        const y = top + innerH - h;
                        return (
                          <g key={b.label}>
                            <rect x={x} y={y} width={barW} height={h} fill="var(--accent)" opacity={0.85} rx={2} />
                            <text x={x + barW / 2} y={H - 10} fontSize="9" fill="var(--muted)" textAnchor="middle">
                              {b.label.length > 12 ? `${b.label.slice(0, 10)}…` : b.label}
                            </text>
                          </g>
                        );
                      })}
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
            <svg viewBox="0 0 640 300" role="img" aria-label="Pie chart" style={{ width: "100%", height: "auto", display: "block" }}>
              <rect x="0" y="0" width="640" height="300" fill="var(--bg)" rx="6" />
              {(() => {
                const data = visibleNumeric.slice(0, 12);
                const total = data.reduce((s, b) => s + b.value, 0) || 1;
                const cx = 210;
                const cy = 150;
                const r = 110;
                let a = -Math.PI / 2;
                const colors = ["var(--accent)", "rgba(79,70,229,0.65)", "rgba(79,70,229,0.45)", "rgba(79,70,229,0.3)"];
                return (
                  <>
                    {data.map((b, i) => {
                      const frac = b.value / total;
                      const next = a + frac * Math.PI * 2;
                      const d = pieArcPath(cx, cy, r, a, next);
                      a = next;
                      return <path key={b.key} d={d} fill={colors[i % colors.length]} stroke="var(--surface)" strokeWidth="1" />;
                    })}
                    <text x="420" y="34" fontSize="12" fill="var(--muted)">
                      Top fields
                    </text>
                    {data.slice(0, 8).map((b, i) => (
                      <g key={b.key}>
                        <rect x="420" y={52 + i * 26} width="10" height="10" fill={colors[i % colors.length]} />
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
            <svg viewBox="0 0 640 260" role="img" aria-label="Bar chart" style={{ width: "100%", height: "auto", display: "block" }}>
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
                return (
                  <>
                    <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                      {maxV.toLocaleString()}
                    </text>
                    {visibleNumeric.map((b, i) => {
                      const x = left + i * (barW + gap);
                      const h = maxV > 0 ? (b.value / maxV) * innerH : 0;
                      const y = top + innerH - h;
                      return (
                        <g key={b.key}>
                          <rect x={x} y={y} width={barW} height={h} fill="var(--accent)" opacity={0.85} rx={2} />
                          <text x={x + barW / 2} y={H - 8} fontSize="9" fill="var(--muted)" textAnchor="middle">
                            {b.key.length > 14 ? `${b.key.slice(0, 12)}…` : b.key}
                          </text>
                        </g>
                      );
                    })}
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
  designActions,
}: {
  widget: Extract<Widget, { type: "kpi_bar_chart" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
}) {
  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      <KpiBarChartWidgetInner widget={widget} organizationId={organizationId} />
    </WidgetSettingsShell>
  );
}

function KpiTableWidget({
  widget,
  organizationId,
  designActions,
}: {
  widget: Extract<Widget, { type: "kpi_table" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
}) {
  const token = getAccessToken();
  const [rows, setRows] = useState<Array<{ label: string; value: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
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
  showOpenFullLink,
  dashboardId,
}: {
  widget: Extract<Widget, { type: "kpi_multi_line_table" }>;
  organizationId: number;
  pageSize: number;
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
  const [joinItemsByKey, setJoinItemsByKey] = useState<Record<string, Record<string, unknown>>>({});
  const [joinLabelByKey, setJoinLabelByKey] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  const allowedKeys = widget.sub_field_keys ?? [];
  const joinAllowedKeys = widget.join?.sub_field_keys ?? [];
  const hasJoin =
    !!widget.join &&
    typeof widget.join.kpi_id === "number" &&
    !!widget.join.source_field_key &&
    !!widget.join.on_left_sub_field_key &&
    !!widget.join.on_right_sub_field_key;

  const joinKeyForLeft = (row: Record<string, unknown>): string => {
    const k = widget.join?.on_left_sub_field_key || "";
    return k ? String(row?.[k] ?? "").trim() : "";
  };
  const joinLookup = (row: Record<string, unknown>): Record<string, unknown> | null => {
    if (!hasJoin) return null;
    const key = joinKeyForLeft(row);
    return key ? joinItemsByKey[key] ?? null : null;
  };

  useEffect(() => {
    const base = allowedKeys.length ? [...allowedKeys] : [];
    const joinBase = joinAllowedKeys.length ? joinAllowedKeys.map((k) => `join:${k}`) : [];
    setVisibleKeys([...base, ...joinBase]);
    setSortKey(null);
    setSortDir("asc");
    setSearch("");
    setPage(0);
    setViewerYear(widget.year);
  }, [widget.id, JSON.stringify(allowedKeys), JSON.stringify(joinAllowedKeys)]);

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
    const joinSpec = widget.join;
    Promise.all([
      getKpiFieldsWithSubs(token, organizationId, widget.kpi_id),
      fetchEntryForPeriod(token, organizationId, widget.kpi_id, viewerYear, widget.period_key),
      hasJoin && joinSpec
        ? Promise.all([
            getKpiFieldsWithSubs(token, organizationId, joinSpec.kpi_id),
            fetchEntryForPeriod(token, organizationId, joinSpec.kpi_id, viewerYear, widget.period_key),
          ])
        : Promise.resolve(null),
    ])
      .then(([fields, entry, joinRes]) => {
        const source = fields.find((f) => f.key === widget.source_field_key && f.field_type === "multi_line_items");
        const fid = source?.id;
        const raw = fid ? rawFieldFromEntry(entry, fid) : null;
        const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
        setItems(rows);
        const labels: Record<string, string> = {};
        (source?.sub_fields ?? []).forEach((sf) => {
          labels[sf.key] = sf.name;
        });
        setLabelByKey(labels);

        if (joinRes && joinSpec) {
          const [joinFields, joinEntry] = joinRes;
          const joinSource = joinFields.find((f) => f.key === joinSpec.source_field_key && f.field_type === "multi_line_items");
          const joinFid = joinSource?.id;
          const joinRaw = joinFid ? rawFieldFromEntry(joinEntry, joinFid) : null;
          const joinRows = Array.isArray(joinRaw) ? (joinRaw as Record<string, unknown>[]) : [];
          const joinLabels: Record<string, string> = {};
          (joinSource?.sub_fields ?? []).forEach((sf) => {
            joinLabels[sf.key] = sf.name;
          });
          setJoinLabelByKey(joinLabels);

          const idx: Record<string, Record<string, unknown>> = {};
          const rightKey = joinSpec.on_right_sub_field_key;
          joinRows.forEach((r) => {
            const k = rightKey ? String((r as any)?.[rightKey] ?? "").trim() : "";
            if (!k) return;
            if (!idx[k]) idx[k] = r;
          });
          setJoinItemsByKey(idx);
        } else {
          setJoinLabelByKey({});
          setJoinItemsByKey({});
        }
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
    JSON.stringify(widget.join ?? null),
  ]);

  const displayKeys = useMemo(() => allowedKeys.filter((k) => visibleKeys.includes(k)), [allowedKeys, visibleKeys]);
  const joinDisplayKeys = useMemo(() => joinAllowedKeys.filter((k) => visibleKeys.includes(`join:${k}`)), [joinAllowedKeys, visibleKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const leftHit = allowedKeys.some((k) => formatCellForTable(row[k]).toLowerCase().includes(q));
      if (leftHit) return true;
      if (!hasJoin) return false;
      const j = joinLookup(row);
      if (!j) return false;
      return joinAllowedKeys.some((k) => formatCellForTable(j[k]).toLowerCase().includes(q));
    });
  }, [items, search, allowedKeys, hasJoin, joinAllowedKeys, JSON.stringify(joinItemsByKey)]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    if (sortKey.startsWith("join:")) {
      const k = sortKey.slice("join:".length);
      if (!joinDisplayKeys.includes(k)) return filtered;
      const dir = sortDir === "asc" ? 1 : -1;
      return [...filtered].sort((a, b) => dir * compareCellValues((joinLookup(a) ?? {})[k], (joinLookup(b) ?? {})[k]));
    }
    if (!displayKeys.includes(sortKey)) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => dir * compareCellValues(a[sortKey], b[sortKey]));
  }, [filtered, sortKey, sortDir, displayKeys, JSON.stringify(joinItemsByKey), JSON.stringify(joinDisplayKeys)]);

  useEffect(() => {
    setPage(0);
  }, [search, sortKey, sortDir, JSON.stringify(displayKeys), items.length]);

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
      return [...prev, key].sort((a, b) => allowedKeys.indexOf(a) - allowedKeys.indexOf(b));
    });
  };
  const toggleJoinColumn = (key: string) => {
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
        {showOpenFullLink && dashboardId != null ? (
          <Link
            href={`/dashboard/dashboards/${dashboardId}/widgets/${widget.id}`}
            className="btn"
            style={{ fontSize: "0.85rem", textDecoration: "none", height: 36, display: "inline-flex", alignItems: "center" }}
          >
            Full Page View
          </Link>
        ) : null}
      </div>
    );
    return () => setHeaderAddon(null);
  }, [setHeaderAddon, showOpenFullLink, dashboardId, widget.id, viewerYear, JSON.stringify(yearOptions)]);

  useEffect(() => {
    if (!setViewerMenu) return;
    if (loading || error || (allowedKeys.length === 0 && joinAllowedKeys.length === 0)) {
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
        {hasJoin && joinAllowedKeys.length > 0 && (
          <>
            <div style={{ height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Joined columns</div>
            {joinAllowedKeys.map((k) => (
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
                <input type="checkbox" checked={visibleKeys.includes(`join:${k}`)} onChange={() => toggleJoinColumn(k)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k}>
                  {joinLabelByKey[k] ?? k}
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
    JSON.stringify(joinAllowedKeys),
    JSON.stringify(visibleKeys),
    JSON.stringify(labelByKey),
    JSON.stringify(joinLabelByKey),
    hasJoin,
  ]);

  return (
    <>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rows…"
            style={{
              width: "100%",
              maxWidth: 320,
              padding: "0.4rem 0.55rem",
              fontSize: "0.9rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxSizing: "border-box",
            }}
          />
          {sorted.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>No rows to show.</p>
          ) : displayKeys.length === 0 && joinDisplayKeys.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>Select at least one column.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    {displayKeys.map((k) => (
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
                    {hasJoin &&
                      joinDisplayKeys.map((k) => (
                        <th key={`join:${k}`} style={{ textAlign: "left", padding: "0.45rem 0.5rem", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            onClick={() => onHeaderClick(`join:${k}`)}
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
                            {joinLabelByKey[k] ?? k}
                            {sortKey === `join:${k}` ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                          </button>
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                      {displayKeys.map((k) => (
                        <td key={k} style={{ padding: "0.45rem 0.5rem", verticalAlign: "top" }}>
                          {formatCellForTable(row[k]) || "—"}
                        </td>
                      ))}
                      {hasJoin &&
                        joinDisplayKeys.map((k) => (
                          <td key={`join:${k}`} style={{ padding: "0.45rem 0.5rem", verticalAlign: "top" }}>
                            {formatCellForTable((joinLookup(row) ?? {})[k]) || "—"}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sorted.length > pageSize && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
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
}: {
  widget: Extract<Widget, { type: "kpi_multi_line_table" }>;
  organizationId: number;
  designActions?: WidgetDesignMenuActions;
  dashboardId?: number;
  isFullPage?: boolean;
  tableRowsPerPage?: number;
}) {
  return (
    <WidgetSettingsShell title={widget.title} designActions={designActions} widgetKey={widget.id}>
      <KpiMultiLineTableWidgetInner
        widget={widget}
        organizationId={organizationId}
        pageSize={Math.max(1, tableRowsPerPage ?? (isFullPage ? 10 : 5))}
        showOpenFullLink={!isFullPage}
        dashboardId={dashboardId}
      />
    </WidgetSettingsShell>
  );
}

