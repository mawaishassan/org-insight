"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { generatePeriodOptions } from "@/lib/periodHelpers";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { WidgetRenderer } from "../widgets";
import { DashboardCustomizationProvider, useDashboardCustomization } from "../DashboardCustomizationContext";
import type { MultiFilterSubField, MultiItemsFilterPayloadV2 } from "@/lib/multi-line-filter-payload";
import { MultiLineReportFilterPanel } from "@/components/MultiLineReportFilterPanel";
import {
  DASHBOARD_GRID_COLUMNS,
  effectiveColSpan,
  findNeighborSwapId,
  widgetGridColumnStyle,
} from "../layoutGrid";

type WidgetType =
  | "text"
  | "kpi_single_value"
  | "kpi_table"
  | "kpi_line_chart"
  | "kpi_bar_chart"
  | "kpi_trend"
  | "kpi_card_single_value"
  | "kpi_multi_line_table";
type EditTab = "basics" | "options";

const SUPER_ADMIN_WIDGET_TYPES: WidgetType[] = ["kpi_card_single_value", "kpi_bar_chart", "kpi_trend", "kpi_multi_line_table"];

function isSuperAdminRole(role: string | null | undefined) {
  const norm = String(role ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return norm === "SUPER_ADMIN" || norm === "SUPERADMIN";
}

const PALETTE_SCHEMES = [
  {
    id: "tableau10",
    label: "Tableau 10 (balanced)",
    colors: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"],
  },
  {
    id: "set2",
    label: "Set2 (soft)",
    colors: ["#66C2A5", "#FC8D62", "#8DA0CB", "#E78AC3", "#A6D854", "#FFD92F", "#E5C494", "#B3B3B3"],
  },
  {
    id: "dark2",
    label: "Dark2 (high contrast)",
    colors: ["#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E", "#E6AB02", "#A6761D", "#666666"],
  },
  {
    id: "pastel1",
    label: "Pastel (light)",
    colors: ["#FBB4AE", "#B3CDE3", "#CCEBC5", "#DECBE4", "#FED9A6", "#FFFFCC", "#E5D8BD", "#FDDAEC", "#F2F2F2"],
  },
  {
    id: "okabe_ito",
    label: "Okabe–Ito (colorblind-safe)",
    colors: ["#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"],
  },
] as const;

type PaletteSchemeId = (typeof PALETTE_SCHEMES)[number]["id"];

function paletteForScheme(id: PaletteSchemeId, count = 8) {
  const scheme = PALETTE_SCHEMES.find((s) => s.id === id) ?? PALETTE_SCHEMES[0];
  const n = Math.max(2, Math.min(12, Math.trunc(count)));
  return scheme.colors.slice(0, n);
}

function deriveGradientStopsFromBase(base: string) {
  const s = (base || "").trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  // Keep `from` as hex so `<input type="color">` always stays valid.
  // If user types a non-hex value, don't try to derive stops (renderer will fallback).
  if (!m) return { from: s || "#4f46e5", to: "" };
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { from: `#${hex.toLowerCase()}`, to: `rgba(${r}, ${g}, ${b}, 0.35)` };
}

type Widget =
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
      field_keys: string[];
      chart_type?: "bar" | "pie";
      mode?: "fields" | "multi_line_items";
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
      source_field_key?: string;
      agg?: "count_rows" | "sum" | "avg";
      group_by_sub_field_key?: string;
      value_sub_field_key?: string;
      filter_sub_field_key?: string;
      filter_label?: string;
      filter_sub_field_keys?: string[];
      filter_labels?: Record<string, string>;
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
      start_year: number;
      end_year: number;
      view?: "bar" | "line";
      default_years?: number[];
      mode?: "fields" | "multi_line_items";
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
      source_field_key?: string;
      agg?: "count_rows" | "sum" | "avg";
      group_by_sub_field_key?: string;
      value_sub_field_key?: string;
      filter_sub_field_key?: string;
      filter_label?: string;
      filter_sub_field_keys?: string[];
      filter_labels?: Record<string, string>;
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
      filter_sub_field_key?: string;
      filter_label?: string;
      filter_sub_field_keys?: string[];
      filter_labels?: Record<string, string>;
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
      source_field_key: string;
      sub_field_keys: string[];
      filter_sub_field_key?: string;
      filter_label?: string;
      filter_sub_field_keys?: string[];
      filter_labels?: Record<string, string>;
      /** Viewer row limit for the embedded widget (design-time setting). */
      rows_limit?: number;
      /** Display order for combined columns (primary + join:...). */
      column_order?: string[];
      filters?: MultiItemsFilterPayloadV2 | null;
      join?: {
        kpi_id: number;
        source_field_key: string;
        on_left_sub_field_key: string;
        on_right_sub_field_key: string;
        sub_field_keys: string[];
      };
      joins?: Array<{
        kpi_id: number;
        source_field_key: string;
        on_left_sub_field_key: string;
        on_right_sub_field_key: string;
        sub_field_keys: string[];
      }>;
      full_width?: boolean;
      col_span?: number;
    };

interface DashboardDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  layout: any;
  fetch_data_with_date?: boolean;
  date_fetching_config?: any;
}

interface KpiRow {
  id: number;
  name: string;
  year: number | null;
}

interface KpiFieldRow {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields?: Array<{ id: number; key: string; name: string; field_type: string }>;
}

function ensureLayout(layout: any): { widgets: Widget[] } {
  if (layout && typeof layout === "object" && Array.isArray(layout.widgets)) return { widgets: layout.widgets as Widget[] };
  if (Array.isArray(layout)) return { widgets: layout as Widget[] };
  return { widgets: [] };
}

function layoutFieldsForSave(
  fullWidth: boolean,
  widgetId: string,
  widgets: Widget[]
): { full_width: boolean; col_span?: number } {
  if (fullWidth) return { full_width: true, col_span: undefined };
  const prev = widgets.find((x) => x.id === widgetId);
  return { full_width: false, col_span: (prev as { col_span?: number })?.col_span ?? 6 };
}

function newId() {
  return `w_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

type KpiCardAgg = "sum" | "avg" | "count" | "min" | "max";

function normalizeKpiCardAgg(raw: unknown): KpiCardAgg {
  if (raw === "sum" || raw === "avg" || raw === "count" || raw === "min" || raw === "max") return raw;
  return "sum";
}

function DesignMoveArrow({
  dir,
  disabled,
  onClick,
  positionStyle,
}: {
  dir: "up" | "down" | "left" | "right";
  disabled: boolean;
  onClick: () => void;
  positionStyle: CSSProperties;
}) {
  const labels = { up: "Move up", down: "Move down", left: "Move left", right: "Move right" };
  const rotate: Record<typeof dir, number> = { up: 0, right: 90, down: 180, left: -90 };
  return (
    <button
      type="button"
      data-design-move-arrow
      disabled={disabled}
      aria-label={labels[dir]}
      title={labels[dir]}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!disabled) onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        width: 28,
        height: 28,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--text)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
        zIndex: 12,
        ...positionStyle,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        style={{ transform: `rotate(${rotate[dir]}deg)` }}
        aria-hidden
      >
        <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default function DashboardDesignPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgIdFromQuery = searchParams.get("organization_id");
  const token = getAccessToken();

  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    const query = orgIdFromQuery ? `?organization_id=${orgIdFromQuery}` : "";
    api<DashboardDetail>(`/dashboards/${id}${query}`, { token })
      .then(setDashboard)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [id, token, orgIdFromQuery]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!dashboard) return null;

  return (
    <DashboardCustomizationProvider
      dashboardId={id}
      organizationId={dashboard.organization_id}
      consistentColors={dashboard.layout?.consistent_colors}
      colorMappings={dashboard.layout?.color_mappings}
    >
      <DashboardDesignContent
        dashboard={dashboard}
        setDashboard={setDashboard}
        id={id}
        token={token}
        orgIdFromQuery={orgIdFromQuery}
      />
    </DashboardCustomizationProvider>
  );
}

function DashboardDesignContent({
  dashboard,
  setDashboard,
  id,
  token,
  orgIdFromQuery,
}: {
  dashboard: DashboardDetail;
  setDashboard: React.Dispatch<React.SetStateAction<DashboardDetail | null>>;
  id: number;
  token: string | null | undefined;
  orgIdFromQuery: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [widgets, setWidgets] = useState<Widget[]>(() => ensureLayout(dashboard.layout).widgets);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [fieldsByKpiId, setFieldsByKpiId] = useState<Record<number, KpiFieldRow[]>>({});

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);
  const [hoveredDesignWidgetId, setHoveredDesignWidgetId] = useState<string | null>(null);
  const [selectedDesignWidgetId, setSelectedDesignWidgetId] = useState<string | null>(null);

  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [fullWidth, setFullWidth] = useState(false);

  const [dashboardSettingsOpen, setDashboardSettingsOpen] = useState(false);
  const [consistentColors, setConsistentColors] = useState<boolean>(() => dashboard.layout?.consistent_colors ?? false);
  const [colorMappings, setColorMappings] = useState<Record<string, string>>(() => dashboard.layout?.color_mappings ?? {});
  const [fetchDataWithDate, setFetchDataWithDate] = useState<boolean>(() => dashboard.fetch_data_with_date ?? false);
  const [dateFetchingConfig, setDateFetchingConfig] = useState<any>(() => dashboard.date_fetching_config ?? {});
  const [fetchDataWithColumn, setFetchDataWithColumn] = useState<boolean>(() => (dashboard as any).fetch_data_with_column ?? false);
  const [columnFetchingConfig, setColumnFetchingConfig] = useState<any>(() => (dashboard as any).column_fetching_config ?? null);
  const [allDashboards, setAllDashboards] = useState<any[]>([]);
  const [importSourceDashboardId, setImportSourceDashboardId] = useState<number | null>(null);

  useEffect(() => {
    setWidgets(ensureLayout(dashboard.layout).widgets);
    setConsistentColors(dashboard.layout?.consistent_colors ?? false);
    setColorMappings(dashboard.layout?.color_mappings ?? {});
    setFetchDataWithDate(dashboard.fetch_data_with_date ?? false);
    setDateFetchingConfig(dashboard.date_fetching_config ?? {});
    setFetchDataWithColumn((dashboard as any).fetch_data_with_column ?? false);
    setColumnFetchingConfig((dashboard as any).column_fetching_config ?? null);
  }, [dashboard]);

  const referencedKpiIds = useMemo(() => {
    const ids = new Set<number>();
    widgets.forEach((w: any) => {
      if (w.kpi_id) ids.add(w.kpi_id);
      if (w.joins) {
        w.joins.forEach((j: any) => {
          if (j.kpi_id) ids.add(j.kpi_id);
        });
      }
    });
    return Array.from(ids);
  }, [widgets]);

  useEffect(() => {
    if (!token || !dashboard?.organization_id || referencedKpiIds.length === 0) return;
    referencedKpiIds.forEach((kpiId) => {
      if (fieldsByKpiId[kpiId]) return;
      api<KpiFieldRow[]>(`/fields?kpi_id=${kpiId}&organization_id=${dashboard.organization_id}`, { token })
        .then((fields) => setFieldsByKpiId((prev) => ({ ...prev, [kpiId]: fields })))
        .catch(() => {});
    });
  }, [token, dashboard?.organization_id, referencedKpiIds, fieldsByKpiId]);

  const dashboardMliFields = useMemo(() => {
    const list: Array<{ kpiId: number; kpiName: string; field: KpiFieldRow }> = [];
    referencedKpiIds.forEach((kpiId) => {
      const kpiObj = kpis.find((k) => k.id === kpiId);
      const fields = fieldsByKpiId[kpiId] || [];
      const mlis = fields.filter((f) => f.field_type === "multi_line_items");
      mlis.forEach((field) => {
        list.push({
          kpiId,
          kpiName: kpiObj?.name || `KPI #${kpiId}`,
          field,
        });
      });
    });
    return list;
  }, [referencedKpiIds, kpis, fieldsByKpiId]);

  const [organization, setOrganization] = useState<any>(null);
  const [localPeriodType, setLocalPeriodType] = useState<string>("");
  const [localDateBasedFetching, setLocalDateBasedFetching] = useState<boolean>(false);
  const [localDateColumn, setLocalDateColumn] = useState<string>("");
  const [localMliDateCols, setLocalMliDateCols] = useState<Record<string, string>>({});
  const [localAllowedPeriodTypes, setLocalAllowedPeriodTypes] = useState<string[]>(["by_default", "Customized Period"]);
  const [localDefaultPeriodType, setLocalDefaultPeriodType] = useState<string>("by_default");
  const [localDefaultYear, setLocalDefaultYear] = useState<string>("");
  const [localColumnBasedFetching, setLocalColumnBasedFetching] = useState<boolean>(false);
  const [localSelectedMliKey, setLocalSelectedMliKey] = useState<string>("");
  const [localSelectedColumnKey, setLocalSelectedColumnKey] = useState<string>("");

  useEffect(() => {
    if (!token || !dashboard?.organization_id) return;
    api<any>(`/organizations/${dashboard.organization_id}`, { token })
      .then((orgData) => {
        setOrganization(orgData);
      })
      .catch((err) => {
        console.error("Failed to load org details", err);
      });
  }, [token, dashboard?.organization_id]);

  useEffect(() => {
    if (dashboardSettingsOpen) {
      setLocalPeriodType(dateFetchingConfig?.period_type || "");
      setLocalDateBasedFetching(fetchDataWithDate);
      setLocalDateColumn(dateFetchingConfig?.date_column || "");
      setLocalMliDateCols(dateFetchingConfig?.mli_date_cols || {});
      setLocalAllowedPeriodTypes(dateFetchingConfig?.allowed_period_types || ["by_default", "Customized Period"]);
      setLocalDefaultPeriodType(dateFetchingConfig?.default_period_type || "by_default");
      setLocalDefaultYear(dateFetchingConfig?.default_year || String(new Date().getFullYear()));
      setLocalColumnBasedFetching(fetchDataWithColumn);
      if (columnFetchingConfig?.kpi_id && columnFetchingConfig?.source_field_key) {
        setLocalSelectedMliKey(`${columnFetchingConfig.kpi_id}_${columnFetchingConfig.source_field_key}`);
      } else {
        setLocalSelectedMliKey("");
      }
      setLocalSelectedColumnKey(columnFetchingConfig?.column_key || "");
    }
  }, [dashboardSettingsOpen, fetchDataWithDate, dateFetchingConfig, fetchDataWithColumn, columnFetchingConfig]);

  const customPeriods = useMemo(() => {
    if (!organization) return [];
    if (organization.custom_periods && organization.custom_periods.length > 0) {
      return organization.custom_periods;
    }
    if (organization.custom_period_name) {
      return [{
        custom_period_name: organization.custom_period_name,
        custom_period_start_month: organization.custom_period_start_month,
        custom_period_start_day: organization.custom_period_start_day,
        custom_period_duration_months: organization.custom_period_duration_months,
        custom_period_display_format: organization.custom_period_display_format,
        custom_period_prefix: organization.custom_period_prefix,
        custom_period_suffix: organization.custom_period_suffix,
      }];
    }
    return [];
  }, [organization]);

  const periodOptionsList = useMemo(() => {
    return customPeriods.map((p: any) => p.custom_period_name);
  }, [customPeriods]);

  const dateColumns = useMemo(() => {
    const cols = new Set<string>();
    dashboardMliFields.forEach(({ field }) => {
      field.sub_fields?.forEach((sf) => {
        if (sf.field_type === "date" || sf.field_type === "datetime") {
          cols.add(sf.key);
        }
      });
    });
    return Array.from(cols);
  }, [dashboardMliFields]);

  const widgetActivePeriodConfig = useMemo(() => {
    const currentPeriodType = localPeriodType || dateFetchingConfig?.period_type || customPeriods[0]?.custom_period_name || "";
    return customPeriods.find((p: any) => p.custom_period_name === currentPeriodType) || null;
  }, [customPeriods, localPeriodType, dateFetchingConfig]);

  const widgetPeriodOptions = useMemo(() => {
    if (!widgetActivePeriodConfig) return [];
    return generatePeriodOptions(widgetActivePeriodConfig);
  }, [widgetActivePeriodConfig]);

  const designDefaultPeriodOptions = useMemo(() => {
    if (!localDefaultPeriodType || localDefaultPeriodType === "by_default") {
      const currentYear = new Date().getFullYear();
      const years: any[] = [];
      for (let y = currentYear + 1; y >= 2020; y--) {
        years.push({ value: String(y), label: String(y) });
      }
      return years;
    }
    const cfg = customPeriods.find(
      (p: any) => (p.custom_period_name || "").trim().toLowerCase() === (localDefaultPeriodType || "").trim().toLowerCase()
    ) || customPeriods[0];
    if (!cfg) return [];
    return generatePeriodOptions(cfg);
  }, [customPeriods, localDefaultPeriodType]);

  const [addType, setAddType] = useState<WidgetType>("text");
  const [addTitle, setAddTitle] = useState("");
  const [addText, setAddText] = useState("");
  const [addKpiId, setAddKpiId] = useState<number | null>(null);
  const [addFieldKey, setAddFieldKey] = useState<string>("");
  const [addYear, setAddYear] = useState<any>(new Date().getFullYear());
  const [addStartYear, setAddStartYear] = useState<number>(new Date().getFullYear() - 4);
  const [addEndYear, setAddEndYear] = useState<number>(new Date().getFullYear());
  const [addPeriodKey, setAddPeriodKey] = useState<string>("");
  const [addFieldKeys, setAddFieldKeys] = useState<string>("");
  const [addChartType, setAddChartType] = useState<"bar" | "pie">("bar");
  const [addChartMode, setAddChartMode] = useState<"fields" | "multi_line_items">("fields");
  const [addTrendView, setAddTrendView] = useState<"bar" | "line">("bar");
  const [addTrendMode, setAddTrendMode] = useState<"fields" | "multi_line_items">("multi_line_items");
  const [addBarSortBy, setAddBarSortBy] = useState<"x" | "value">("value");
  const [addBarSortDir, setAddBarSortDir] = useState<"asc" | "desc">("desc");
  const [addBarColorMode, setAddBarColorMode] = useState<"solid" | "palette" | "gradient">("solid");
  const [addBarColor, setAddBarColor] = useState<string>("#4f46e5");
  const [addBarPaletteScheme, setAddBarPaletteScheme] = useState<PaletteSchemeId>("tableau10");
  const [addBarGradientFrom, setAddBarGradientFrom] = useState<string>("#4f46e5");
  const [addBarGradientTo, setAddBarGradientTo] = useState<string>("#a5b4fc");
  const [addTrendDefaultYears, setAddTrendDefaultYears] = useState<number[]>([]);
  const [addMultiLineFieldKey, setAddMultiLineFieldKey] = useState<string>("");
  const [addAggFn, setAddAggFn] = useState<"count_rows" | "sum" | "avg">("count_rows");
  const [addGroupBySubFieldKey, setAddGroupBySubFieldKey] = useState<string>("");
  const [addValueSubFieldKey, setAddValueSubFieldKey] = useState<string>("");
  const [addFilterSubFieldKey, setAddFilterSubFieldKey] = useState<string>("");
  const [addFilterLabel, setAddFilterLabel] = useState<string>("");
  const [addFilterSubFieldKeys, setAddFilterSubFieldKeys] = useState<string[]>([]);
  const [addFilterLabels, setAddFilterLabels] = useState<Record<string, string>>({});
  const [addAdvancedFilters, setAddAdvancedFilters] = useState<MultiItemsFilterPayloadV2 | null>(null);
  const [addCardSourceMode, setAddCardSourceMode] = useState<"field" | "multi_line_agg" | "static">("field");
  const [addCardAgg, setAddCardAgg] = useState<KpiCardAgg>("sum");
  const [addCardStaticValue, setAddCardStaticValue] = useState<string>("");
  const [addCardSubtitle, setAddCardSubtitle] = useState<string>("");
  const [addCardPrefix, setAddCardPrefix] = useState<string>("");
  const [addCardSuffix, setAddCardSuffix] = useState<string>("");
  const [addCardDecimals, setAddCardDecimals] = useState<number>(0);
  const [addCardThousandSep, setAddCardThousandSep] = useState(true);
  const [addCardAlign, setAddCardAlign] = useState<"left" | "center" | "right">("left");
  const [addCardTheme, setAddCardTheme] = useState<string>("success_light");
  const [addCardAllowCustomColors, setAddCardAllowCustomColors] = useState(false);
  const [addCardBgColor, setAddCardBgColor] = useState<string>("");
  const [addCardFgColor, setAddCardFgColor] = useState<string>("");
  const [addMultiLineTableFieldKey, setAddMultiLineTableFieldKey] = useState<string>("");
  const [addMultiLineTableSubKeys, setAddMultiLineTableSubKeys] = useState<string[]>([]);
  const [addMultiLineTableTopRows, setAddMultiLineTableTopRows] = useState<number>(5);
  const [addMultiLineTableJoinEnabled, setAddMultiLineTableJoinEnabled] = useState(false);
  const [addMultiLineTableJoinKpiId, setAddMultiLineTableJoinKpiId] = useState<number | null>(null);
  const [addMultiLineTableJoinFieldKey, setAddMultiLineTableJoinFieldKey] = useState<string>("");
  const [addMultiLineTableJoinOnLeftKey, setAddMultiLineTableJoinOnLeftKey] = useState<string>("");
  const [addMultiLineTableJoinOnRightKey, setAddMultiLineTableJoinOnRightKey] = useState<string>("");
  const [addMultiLineTableJoinSubKeys, setAddMultiLineTableJoinSubKeys] = useState<string[]>([]);
  const [mlJoins, setMlJoins] = useState<
    Array<{
      kpi_id: number | null;
      source_field_key: string;
      on_left_sub_field_key: string;
      on_right_sub_field_key: string;
      sub_field_keys: string[];
      collapsed: boolean;
      search: string;
    }>
  >([]);
  const [addMultiLineTableColumnOrder, setAddMultiLineTableColumnOrder] = useState<string[]>([]);
  const [draggingTableColKey, setDraggingTableColKey] = useState<string | null>(null);
  const [mlTableSearch, setMlTableSearch] = useState("");
  const [mlJoinSearch, setMlJoinSearch] = useState("");
  const [mlPrimaryCollapsed, setMlPrimaryCollapsed] = useState(false);
  const [mlJoinCollapsed, setMlJoinCollapsed] = useState(false);
  const [editTab, setEditTab] = useState<EditTab>("basics");

  const isEditing = editingWidgetId != null;

  const openAddWidget = () => {
    setEditingWidgetId(null);
    setEditTab("basics");
    setFullWidth(false);
    setAddType("kpi_card_single_value");
    setAddTitle("");
    setAddText("");
    setAddFieldKey("");
    setAddFieldKeys("");
    setAddPeriodKey("");
    setAddChartType("bar");
    setAddChartMode("fields");
    setAddTrendView("bar");
    setAddTrendMode("multi_line_items");
    setAddTrendDefaultYears([]);
    setAddMultiLineFieldKey("");
    setAddAggFn("count_rows");
    setAddBarSortBy("value");
    setAddBarSortDir("desc");
    setAddBarColorMode("solid");
    setAddBarColor("#4f46e5");
    setAddBarPaletteScheme("tableau10");
    {
      const stops = deriveGradientStopsFromBase("#4f46e5");
      setAddBarGradientFrom(stops.from);
      setAddBarGradientTo(stops.to);
    }
    setAddGroupBySubFieldKey("");
    setAddValueSubFieldKey("");
    setAddFilterSubFieldKey("");
    setAddFilterLabel("");
    setAddAdvancedFilters(null);
    setAddCardSourceMode("field");
    setAddCardAgg("sum");
    setAddCardStaticValue("");
    setAddCardSubtitle("");
    setAddCardPrefix("");
    setAddCardSuffix("");
    setAddCardDecimals(0);
    setAddCardThousandSep(true);
    setAddCardAlign("left");
    setAddCardTheme("success_light");
    setAddCardAllowCustomColors(false);
    setAddCardBgColor("");
    setAddCardFgColor("");
    setAddMultiLineTableFieldKey("");
    setAddMultiLineTableSubKeys([]);
    setAddMultiLineTableTopRows(5);
    setAddMultiLineTableJoinEnabled(false);
    setAddMultiLineTableJoinKpiId(null);
    setAddMultiLineTableJoinFieldKey("");
    setAddMultiLineTableJoinOnLeftKey("");
    setAddMultiLineTableJoinOnRightKey("");
    setAddMultiLineTableJoinSubKeys([]);
    setMlJoins([]);
    setAddMultiLineTableColumnOrder([]);
    setMlTableSearch("");
    setMlJoinSearch("");
    setMlPrimaryCollapsed(false);
    setMlJoinCollapsed(false);
    setSelectedDesignWidgetId(null);
    setWidgetModalOpen(true);
  };

  const openEditWidget = (w: Widget) => {
    setSelectedDesignWidgetId(null);
    setEditingWidgetId(w.id);
    setEditTab("basics");
    setFullWidth(!!(w as any).full_width);
    setAddType(w.type as WidgetType);
    setAddTitle((w as any).title || "");
    setAddText((w as any).text || "");
    if ("kpi_id" in w) setAddKpiId((w as any).kpi_id);
    if ("year" in w) setAddYear((w as any).year);
    if ("start_year" in w) setAddStartYear((w as any).start_year);
    if ("end_year" in w) setAddEndYear((w as any).end_year);
    setAddPeriodKey(((w as any).period_key || "") as string);
    if ("field_key" in w) setAddFieldKey((w as any).field_key || "");
    if ("field_keys" in w && Array.isArray((w as any).field_keys)) setAddFieldKeys(((w as any).field_keys || []).join(", "));
    setAddChartType(((w as any).chart_type as any) || "bar");
    setAddChartMode((((w as any).mode as any) || "fields") as any);
    setAddTrendView((((w as any).view as any) || "bar") as any);
    setAddTrendMode((((w as any).mode as any) || "multi_line_items") as any);
    setAddTrendDefaultYears(Array.isArray((w as any).default_years) ? (w as any).default_years.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n)) : []);
    setAddMultiLineFieldKey((w as any).source_field_key || "");
    if (w.type === "kpi_bar_chart") {
      setAddAggFn((((w as any).agg as any) || "count_rows") as any);
      setAddBarSortBy((((w as any).sort_by as any) || "value") as any);
      setAddBarSortDir((((w as any).sort_dir as any) || "desc") as any);
      setAddBarColorMode((((w as any).bar_color_mode as any) || "solid") as any);
      setAddBarColor((w as any).bar_color || "#4f46e5");
      setAddBarPaletteScheme((((w as any).bar_palette_scheme as any) || "tableau10") as any);
      setAddBarGradientFrom((w as any).bar_gradient_from || "#4f46e5");
      setAddBarGradientTo((w as any).bar_gradient_to || "#a5b4fc");
    }
    if (w.type === "kpi_trend") {
      setAddAggFn((((w as any).agg as any) || "count_rows") as any);
      setAddBarSortBy((((w as any).sort_by as any) || "value") as any);
      setAddBarSortDir((((w as any).sort_dir as any) || "desc") as any);
      setAddBarColorMode((((w as any).bar_color_mode as any) || "solid") as any);
      setAddBarColor((w as any).bar_color || "#4f46e5");
      setAddBarPaletteScheme((((w as any).bar_palette_scheme as any) || "tableau10") as any);
      setAddBarGradientFrom((w as any).bar_gradient_from || "#4f46e5");
      setAddBarGradientTo((w as any).bar_gradient_to || "#a5b4fc");
    }
    const rawFilterKeys = (w as any).filter_sub_field_keys || ((w as any).filter_sub_field_key ? [(w as any).filter_sub_field_key] : []);
    setAddFilterSubFieldKeys(Array.isArray(rawFilterKeys) ? rawFilterKeys : []);
    const rawFilterLabels = (w as any).filter_labels || ((w as any).filter_sub_field_key && (w as any).filter_label ? { [(w as any).filter_sub_field_key]: (w as any).filter_label } : {});
    setAddFilterLabels(typeof rawFilterLabels === "object" && rawFilterLabels !== null ? rawFilterLabels : {});
    setAddFilterSubFieldKey((w as any).filter_sub_field_key || (rawFilterKeys[0] || ""));
    setAddFilterLabel((w as any).filter_label || "");
    setAddAdvancedFilters(((w as any).filters as MultiItemsFilterPayloadV2 | null) ?? null);
    if (w.type === "kpi_card_single_value") {
      setAddCardSourceMode((w as any).source_mode || "field");
      setAddCardStaticValue((w as any).static_value != null ? String((w as any).static_value) : "");
      setAddCardSubtitle((w as any).subtitle || "");
      setAddCardPrefix((w as any).prefix || "");
      setAddCardSuffix((w as any).suffix || "");
      setAddCardDecimals(Number.isFinite((w as any).decimals) ? Number((w as any).decimals) : 0);
      setAddCardThousandSep((w as any).thousand_sep !== false);
      setAddCardAlign((w as any).align || "left");
      setAddCardTheme((w as any).theme || "success_light");
      setAddCardAllowCustomColors(!!(w as any).allow_custom_colors);
      setAddCardBgColor((w as any).bg_color || "");
      setAddCardFgColor((w as any).fg_color || "");
      setAddFieldKey((w as any).field_key || "");
      setAddMultiLineFieldKey((w as any).source_field_key || "");
      setAddCardAgg(normalizeKpiCardAgg((w as any).agg));
      setAddValueSubFieldKey((w as any).value_sub_field_key || "");
    }
    if (w.type === "kpi_multi_line_table") {
      setAddMultiLineTableFieldKey(w.source_field_key || "");
      setAddMultiLineTableSubKeys(Array.isArray(w.sub_field_keys) ? [...w.sub_field_keys] : []);
      setAddMultiLineTableTopRows(
        Number.isFinite((w as any).rows_limit) && Number((w as any).rows_limit) > 0 ? Number((w as any).rows_limit) : 5
      );
      const defaultOrder = [
        ...(Array.isArray((w as any).sub_field_keys) ? ((w as any).sub_field_keys as string[]) : []),
        ...(((w as any).join?.sub_field_keys as string[] | undefined) ?? []).map((k) => `join:0:${k}`),
      ];
      setAddMultiLineTableColumnOrder(
        Array.isArray((w as any).column_order) && (w as any).column_order.length ? [...(w as any).column_order] : defaultOrder
      );
      setMlTableSearch("");
      setMlJoinSearch("");
      setMlPrimaryCollapsed(false);
      setMlJoinCollapsed(false);
      const joinsFromWidget: any[] = Array.isArray((w as any).joins) ? (w as any).joins : [];
      const legacy = (w as any).join && typeof (w as any).join === "object" ? [(w as any).join] : [];
      const merged = [...joinsFromWidget, ...legacy].filter((j) => j && typeof j === "object");
      setMlJoins(
        merged.map((j) => ({
          kpi_id: typeof j.kpi_id === "number" ? j.kpi_id : null,
          source_field_key: j.source_field_key || "",
          on_left_sub_field_key: j.on_left_sub_field_key || "",
          on_right_sub_field_key: j.on_right_sub_field_key || "",
          sub_field_keys: Array.isArray(j.sub_field_keys) ? [...j.sub_field_keys] : [],
          collapsed: false,
          search: "",
        }))
      );
      // Keep legacy single-join state populated (no longer used for UI).
      const j0 = merged[0];
      setAddMultiLineTableJoinEnabled(!!j0);
      setAddMultiLineTableJoinKpiId(j0 && typeof j0.kpi_id === "number" ? j0.kpi_id : null);
      setAddMultiLineTableJoinFieldKey(j0?.source_field_key || "");
      setAddMultiLineTableJoinOnLeftKey(j0?.on_left_sub_field_key || "");
      setAddMultiLineTableJoinOnRightKey(j0?.on_right_sub_field_key || "");
      setAddMultiLineTableJoinSubKeys(Array.isArray(j0?.sub_field_keys) ? [...j0.sub_field_keys] : []);
    } else {
      setAddMultiLineTableFieldKey("");
      setAddMultiLineTableSubKeys([]);
      setAddMultiLineTableTopRows(5);
      setAddMultiLineTableJoinEnabled(false);
      setAddMultiLineTableJoinKpiId(null);
      setAddMultiLineTableJoinFieldKey("");
      setAddMultiLineTableJoinOnLeftKey("");
      setAddMultiLineTableJoinOnRightKey("");
      setAddMultiLineTableJoinSubKeys([]);
      setMlJoins([]);
      setAddMultiLineTableColumnOrder([]);
      setMlTableSearch("");
      setMlJoinSearch("");
      setMlPrimaryCollapsed(false);
      setMlJoinCollapsed(false);
    }
    setWidgetModalOpen(true);
  };

  useEffect(() => {
    if (!token) return;
    api<{ role: string }>("/auth/me", { token })
      .then((m) => setUserRole(m.role))
      .catch(() => setUserRole(null));
  }, [token]);

  useEffect(() => {
    if (!token || !dashboard?.organization_id) return;
    api<any[]>(`/dashboards?organization_id=${dashboard.organization_id}`, { token })
      .then(setAllDashboards)
      .catch(() => setAllDashboards([]));
  }, [token, dashboard?.organization_id]);

  const { allPageLabels, getDisplayLabel } = useDashboardCustomization();

  const allPageDisplayLabels = useMemo(() => {
    const set = new Set<string>();
    allPageLabels.forEach((l) => {
      const display = getDisplayLabel(l);
      if (display && display.trim()) {
        set.add(display.trim());
      }
    });
    set.add("Others");
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allPageLabels, getDisplayLabel]);

  const DEFAULT_COLORS = useMemo(() => [
    "#4E79A7", // Blue
    "#F28E2B", // Orange
    "#E15759", // Red
    "#76B7B2", // Cyan/Teal
    "#59A14F", // Green
    "#EDC948", // Yellow
    "#B07AA1", // Purple
    "#FF9DA7", // Pink
    "#9C755F", // Brown
    "#56B4E9", // Light Blue
    "#009E73", // Emerald
    "#0072B2", // Medium Blue
    "#D55E00", // Dark Orange
    "#CC79A7", // Magenta
  ], []);

  const OTHERS_COLOR = "#9ca3af"; // Gray

  // Utility to convert HSL to hex string
  const hslToHex = (h: number, s: number, l: number): string => {
    l /= 100;
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  const getDeterministicColor = useCallback((value: string, mappings: Record<string, string>) => {
    if (value.toLowerCase() === "others") return OTHERS_COLOR;
    if (mappings[value]) return mappings[value];
    
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = value.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const usedColors = new Set(Object.values(mappings));
    const available = DEFAULT_COLORS.filter(c => !usedColors.has(c));
    
    if (available.length > 0) {
      const index = Math.abs(hash) % available.length;
      return available[index];
    } else {
      // Generate deterministic unique color based on hash to avoid collisions
      const hue = Math.abs(hash) % 360;
      const lightness = 50 + (Math.abs(hash) % 3) * 7;
      return hslToHex(hue, 70, lightness);
    }
  }, [DEFAULT_COLORS]);

  // Auto-sync missing color mappings in design mode
  useEffect(() => {
    if (!dashboard || !consistentColors) return;
    
    let changed = false;
    const nextMappings = { ...colorMappings };
    
    allPageDisplayLabels.forEach((val) => {
      const key = val.trim();
      if (!key) return;
      
      const keyLower = key.toLowerCase();
      if (keyLower === "others") {
        if (!nextMappings[key]) {
          nextMappings[key] = OTHERS_COLOR;
          changed = true;
        }
        return;
      }
      
      if (!nextMappings[key]) {
        const usedColors = new Set(Object.values(nextMappings));
        const available = DEFAULT_COLORS.filter(c => !usedColors.has(c));
        let chosenColor = "";
        if (available.length > 0) {
          chosenColor = available[0];
        } else {
          // Generate a unique color to prevent collisions when defaults are exhausted
          const count = Object.keys(nextMappings).length;
          const hue = (count * 137.5) % 360;
          const lightness = 50 + (count % 3) * 7;
          chosenColor = hslToHex(hue, 70, lightness);
        }
        
        nextMappings[key] = chosenColor;
        changed = true;
      }
    });
    
    if (changed) {
      setColorMappings(nextMappings);
      persistDashboardLayout(widgets, consistentColors, nextMappings);
    }
  }, [allPageDisplayLabels, consistentColors, colorMappings, widgets, dashboard, DEFAULT_COLORS]);

  const handleAutoGenerateColors = () => {
    const nextMappings: Record<string, string> = {};
    let realIdx = 0;
    allPageDisplayLabels.forEach((val) => {
      const key = val.trim();
      if (!key) return;
      if (key.toLowerCase() === "others") {
        nextMappings[key] = OTHERS_COLOR;
      } else {
        if (realIdx < DEFAULT_COLORS.length) {
          nextMappings[key] = DEFAULT_COLORS[realIdx];
        } else {
          // Generate a unique color to prevent collisions when defaults are exhausted
          const hue = (realIdx * 137.5) % 360;
          const lightness = 50 + (realIdx % 3) * 7;
          nextMappings[key] = hslToHex(hue, 70, lightness);
        }
        realIdx++;
      }
    });
    setColorMappings(nextMappings);
    persistDashboardLayout(widgets, consistentColors, nextMappings);
    toast.success("Colors auto-generated!");
  };

  const handleResetColorMapping = () => {
    setColorMappings({});
    persistDashboardLayout(widgets, consistentColors, {});
    toast.success("Color mappings reset!");
  };

  const handleUpdateValueColor = (valueKey: string, newColor: string) => {
    const nextMappings = { ...colorMappings, [valueKey]: newColor };
    setColorMappings(nextMappings);
    persistDashboardLayout(widgets, consistentColors, nextMappings);
  };

  const handleImportColors = async () => {
    if (!importSourceDashboardId || !token) return;
    try {
      const srcDash = await api<DashboardDetail>(`/dashboards/${importSourceDashboardId}?organization_id=${dashboard.organization_id}`, { token });
      const srcMappings = srcDash?.layout?.color_mappings || {};
      
      const merged = { ...colorMappings, ...srcMappings };
      setColorMappings(merged);
      persistDashboardLayout(widgets, consistentColors, merged);
      toast.success(`Successfully imported colors from "${srcDash.name}"!`);
      setImportSourceDashboardId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import colors");
    }
  };

  useEffect(() => {
    if (!token || !dashboard?.organization_id) return;
    api<KpiRow[]>(`/kpis?organization_id=${dashboard.organization_id}`, { token })
      .then((list) => {
        setKpis(list);
        if (!addKpiId && list.length > 0) setAddKpiId(list[0].id);
      })
      .catch(() => setKpis([]));
  }, [token, dashboard?.organization_id]);

  useEffect(() => {
    if (!token || !dashboard?.organization_id || !addKpiId) return;
    if (fieldsByKpiId[addKpiId]) return;
    api<KpiFieldRow[]>(`/fields?kpi_id=${addKpiId}&organization_id=${dashboard.organization_id}`, { token })
      .then((fields) => setFieldsByKpiId((prev) => ({ ...prev, [addKpiId]: fields })))
      .catch(() => setFieldsByKpiId((prev) => ({ ...prev, [addKpiId]: [] })));
  }, [token, dashboard?.organization_id, addKpiId, fieldsByKpiId]);

  useEffect(() => {
    if (!token || !dashboard?.organization_id || !addMultiLineTableJoinKpiId) return;
    if (fieldsByKpiId[addMultiLineTableJoinKpiId]) return;
    api<KpiFieldRow[]>(`/fields?kpi_id=${addMultiLineTableJoinKpiId}&organization_id=${dashboard.organization_id}`, { token })
      .then((fields) => setFieldsByKpiId((prev) => ({ ...prev, [addMultiLineTableJoinKpiId]: fields })))
      .catch(() => setFieldsByKpiId((prev) => ({ ...prev, [addMultiLineTableJoinKpiId]: [] })));
  }, [token, dashboard?.organization_id, addMultiLineTableJoinKpiId, fieldsByKpiId]);

  const addFields = useMemo(() => {
    if (!addKpiId) return [];
    return fieldsByKpiId[addKpiId] ?? [];
  }, [addKpiId, fieldsByKpiId]);

  const addMultiLineFields = useMemo(() => addFields.filter((f) => f.field_type === "multi_line_items"), [addFields]);
  const selectedMultiLineField = useMemo(
    () => addMultiLineFields.find((f) => f.key === addMultiLineFieldKey) ?? null,
    [addMultiLineFields, addMultiLineFieldKey]
  );
  const selectedMultiLineSubFields = useMemo(() => selectedMultiLineField?.sub_fields ?? [], [selectedMultiLineField]);
  const numericSubFields = useMemo(
    () => selectedMultiLineSubFields.filter((sf) => sf.field_type === "number"),
    [selectedMultiLineSubFields]
  );

  const selectedTableMultiLineField = useMemo(
    () => addMultiLineFields.find((f) => f.key === addMultiLineTableFieldKey) ?? null,
    [addMultiLineFields, addMultiLineTableFieldKey]
  );
  const tableMultiLineSubFields = useMemo(() => selectedTableMultiLineField?.sub_fields ?? [], [selectedTableMultiLineField]);

  const joinKpiFields = useMemo(() => {
    if (!addMultiLineTableJoinKpiId) return [];
    return fieldsByKpiId[addMultiLineTableJoinKpiId] ?? [];
  }, [addMultiLineTableJoinKpiId, fieldsByKpiId]);
  const joinMultiLineFields = useMemo(() => joinKpiFields.filter((f) => f.field_type === "multi_line_items"), [joinKpiFields]);
  const selectedJoinMultiLineField = useMemo(
    () => joinMultiLineFields.find((f) => f.key === addMultiLineTableJoinFieldKey) ?? null,
    [joinMultiLineFields, addMultiLineTableJoinFieldKey]
  );
  const joinMultiLineSubFields = useMemo(() => selectedJoinMultiLineField?.sub_fields ?? [], [selectedJoinMultiLineField]);

  const persistDashboardLayout = async (
    nextWidgets: Widget[],
    nextConsistentColors: boolean,
    nextColorMappings: Record<string, string>,
    nextFetchDataWithDate: boolean = fetchDataWithDate,
    nextDateFetchingConfig: any = dateFetchingConfig,
    nextFetchDataWithColumn: boolean = fetchDataWithColumn,
    nextColumnFetchingConfig: any = columnFetchingConfig,
  ) => {
    if (!token || !dashboard) return;
    setSaving(true);
    setError(null);
    try {
      const newLayout = {
        widgets: nextWidgets,
        consistent_colors: nextConsistentColors,
        color_mappings: nextColorMappings,
      };
      await api(`/dashboards/${dashboard.id}?organization_id=${dashboard.organization_id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          layout: newLayout,
          fetch_data_with_date: nextFetchDataWithDate,
          date_fetching_config: nextDateFetchingConfig,
          fetch_data_with_column: nextFetchDataWithColumn,
          column_fetching_config: nextColumnFetchingConfig,
        }),
      });
      setDashboard((prev) => prev ? {
        ...prev,
        layout: newLayout,
        fetch_data_with_date: nextFetchDataWithDate,
        date_fetching_config: nextDateFetchingConfig,
        fetch_data_with_column: nextFetchDataWithColumn,
        column_fetching_config: nextColumnFetchingConfig,
      } : null);
      setFetchDataWithColumn(nextFetchDataWithColumn);
      setColumnFetchingConfig(nextColumnFetchingConfig);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const applyWidgetUpsert = (w: Widget) => {
    const layout = layoutFieldsForSave(fullWidth, w.id, widgets);
    const merged = { ...w, ...layout } as Widget;
    const nextWidgets = editingWidgetId ? widgets.map((x) => (x.id === editingWidgetId ? merged : x)) : [...widgets, merged];
    setWidgets(nextWidgets);
    toast.success(editingWidgetId ? "Widget updated" : "Widget added");
    setWidgetModalOpen(false);
    // Auto-persist so refresh doesn't lose title/filter label/etc.
    persistDashboardLayout(nextWidgets, consistentColors, colorMappings);
  };

  const upsertWidget = () => {
    const title = addTitle.trim() || undefined;
    if (addType === "text") {
      const w: Widget = { id: editingWidgetId ?? newId(), type: "text", title, text: addText };
      applyWidgetUpsert(w);
      return;
    }
    if (!addKpiId) return;
    const period_key = addPeriodKey.trim() ? addPeriodKey.trim() : null;
    if (addType === "kpi_single_value") {
      if (!addFieldKey.trim()) return;
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_single_value",
        title,
        kpi_id: addKpiId,
        year: addYear,
        period_key,
        field_key: addFieldKey.trim(),
      };
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_table") {
      const keys = addFieldKeys
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_table",
        title,
        kpi_id: addKpiId,
        year: addYear,
        period_key,
        field_keys: keys.length ? keys : undefined,
      };
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_line_chart") {
      if (!addFieldKey.trim()) return;
      const a = Math.min(addStartYear, addEndYear);
      const b = Math.max(addStartYear, addEndYear);
      if (b - a > 30) {
        toast.error("Year range: max 31 years");
        return;
      }
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_line_chart",
        title,
        kpi_id: addKpiId,
        field_key: addFieldKey.trim(),
        start_year: a,
        end_year: b,
        period_key,
      };
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_bar_chart") {
      // Basic validation messages (keep it simple)
      if (addChartMode === "fields") {
        const keys = addFieldKeys
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (keys.length === 0) {
          toast.error("Add at least one field key for the chart");
          return;
        }
      } else {
        if (!addMultiLineFieldKey.trim()) {
          toast.error("Select a multi-line items field");
          return;
        }
        if (!addGroupBySubFieldKey.trim()) {
          toast.error("Select a group-by sub-field");
          return;
        }
        if (addFilterSubFieldKey.trim() && addFilterSubFieldKey.trim() === addGroupBySubFieldKey.trim()) {
          toast.error("Filter column should be different from Group by");
          return;
        }
        if ((addAggFn === "sum" || addAggFn === "avg") && !addValueSubFieldKey.trim()) {
          toast.error("Select a numeric sub-field to aggregate");
          return;
        }
      }
      const w: any =
        addChartMode === "multi_line_items"
          ? {
              id: editingWidgetId ?? newId(),
              type: "kpi_bar_chart",
              title,
              kpi_id: addKpiId,
              year: addYear,
              period_key,
              chart_type: addChartType,
              mode: "multi_line_items",
              sort_by: addBarSortBy,
              sort_dir: addBarSortDir,
              bar_color_mode: addBarColorMode,
              bar_color: addBarColorMode === "solid" ? (addBarColor.trim() || undefined) : undefined,
              bar_palette: addBarColorMode === "palette" ? paletteForScheme(addBarPaletteScheme, 8) : undefined,
              bar_palette_scheme: addBarColorMode === "palette" ? addBarPaletteScheme : undefined,
              bar_gradient_from: addBarColorMode === "gradient" ? (addBarGradientFrom.trim() || undefined) : undefined,
              bar_gradient_to: addBarColorMode === "gradient" ? (addBarGradientTo.trim() || undefined) : undefined,
              source_field_key: addMultiLineFieldKey.trim(),
              agg: addAggFn,
              group_by_sub_field_key: addGroupBySubFieldKey.trim(),
              value_sub_field_key: addAggFn === "count_rows" ? undefined : addValueSubFieldKey.trim(),
              filter_sub_field_key: addFilterSubFieldKeys[0] || addFilterSubFieldKey.trim() || undefined,
              filter_label: addFilterLabels[addFilterSubFieldKeys[0]] || addFilterLabel.trim() || undefined,
              filter_sub_field_keys: addFilterSubFieldKeys.length > 0 ? addFilterSubFieldKeys : (addFilterSubFieldKey.trim() ? [addFilterSubFieldKey.trim()] : undefined),
              filter_labels: Object.keys(addFilterLabels).length > 0 ? addFilterLabels : undefined,
              filters: addAdvancedFilters,
            }
          : {
              id: editingWidgetId ?? newId(),
              type: "kpi_bar_chart",
              title,
              kpi_id: addKpiId,
              year: addYear,
              period_key,
              chart_type: addChartType,
              mode: "fields",
              sort_by: addBarSortBy,
              sort_dir: addBarSortDir,
              bar_color_mode: addBarColorMode,
              bar_color: addBarColorMode === "solid" ? (addBarColor.trim() || undefined) : undefined,
              bar_palette: addBarColorMode === "palette" ? paletteForScheme(addBarPaletteScheme, 8) : undefined,
              bar_palette_scheme: addBarColorMode === "palette" ? addBarPaletteScheme : undefined,
              bar_gradient_from: addBarColorMode === "gradient" ? (addBarGradientFrom.trim() || undefined) : undefined,
              bar_gradient_to: addBarColorMode === "gradient" ? (addBarGradientTo.trim() || undefined) : undefined,
              field_keys: addFieldKeys
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              filters: null,
            };
      applyWidgetUpsert(w as Widget);
      return;
    }
    if (addType === "kpi_trend") {
      const a = Math.min(addStartYear, addEndYear);
      const b = Math.max(addStartYear, addEndYear);
      if (b - a > 30) {
        toast.error("Year range: max 31 years");
        return;
      }
      const defaultYears = Array.from(new Set(addTrendDefaultYears.map((y) => Math.trunc(y)))).filter((y) => y >= a && y <= b);
      if (addTrendMode === "fields") {
        const keys = addFieldKeys
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (keys.length === 0) {
          toast.error("Add at least one field key for Trend (fields mode)");
          return;
        }
        const w: Widget = {
          id: editingWidgetId ?? newId(),
          type: "kpi_trend",
          title,
          kpi_id: addKpiId,
          period_key,
          start_year: a,
          end_year: b,
          view: addTrendView,
          default_years: defaultYears.length ? defaultYears : undefined,
          mode: "fields",
          field_keys: keys,
          sort_by: addBarSortBy,
          sort_dir: addBarSortDir,
          bar_color_mode: addBarColorMode,
          bar_color: addBarColorMode === "solid" ? (addBarColor.trim() || undefined) : undefined,
          bar_palette: addBarColorMode === "palette" ? paletteForScheme(addBarPaletteScheme, 8) : undefined,
          bar_palette_scheme: addBarColorMode === "palette" ? addBarPaletteScheme : undefined,
          bar_gradient_from: addBarColorMode === "gradient" ? (addBarGradientFrom.trim() || undefined) : undefined,
          bar_gradient_to: addBarColorMode === "gradient" ? (addBarGradientTo.trim() || undefined) : undefined,
        };
        applyWidgetUpsert(w);
        return;
      }
      if (!addMultiLineFieldKey.trim()) {
        toast.error("Select a multi-line items field");
        return;
      }
      if (!addGroupBySubFieldKey.trim()) {
        toast.error("Select a group-by sub-field");
        return;
      }
      if (addFilterSubFieldKey.trim() && addFilterSubFieldKey.trim() === addGroupBySubFieldKey.trim()) {
        toast.error("Filter column should be different from Group by");
        return;
      }
      if ((addAggFn === "sum" || addAggFn === "avg") && !addValueSubFieldKey.trim()) {
        toast.error("Select a numeric sub-field to aggregate");
        return;
      }
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_trend",
        title,
        kpi_id: addKpiId,
        period_key,
        start_year: a,
        end_year: b,
        view: addTrendView,
        default_years: defaultYears.length ? defaultYears : undefined,
        mode: "multi_line_items",
        sort_by: addBarSortBy,
        sort_dir: addBarSortDir,
        bar_color_mode: addBarColorMode,
        bar_color: addBarColorMode === "solid" ? (addBarColor.trim() || undefined) : undefined,
        bar_palette: addBarColorMode === "palette" ? paletteForScheme(addBarPaletteScheme, 8) : undefined,
        bar_palette_scheme: addBarColorMode === "palette" ? addBarPaletteScheme : undefined,
        bar_gradient_from: addBarColorMode === "gradient" ? (addBarGradientFrom.trim() || undefined) : undefined,
        bar_gradient_to: addBarColorMode === "gradient" ? (addBarGradientTo.trim() || undefined) : undefined,
        source_field_key: addMultiLineFieldKey.trim(),
        agg: addAggFn,
        group_by_sub_field_key: addGroupBySubFieldKey.trim(),
        value_sub_field_key: addAggFn === "count_rows" ? undefined : addValueSubFieldKey.trim(),
        filter_sub_field_key: addFilterSubFieldKeys[0] || addFilterSubFieldKey.trim() || undefined,
        filter_label: addFilterLabels[addFilterSubFieldKeys[0]] || addFilterLabel.trim() || undefined,
        filter_sub_field_keys: addFilterSubFieldKeys.length > 0 ? addFilterSubFieldKeys : (addFilterSubFieldKey.trim() ? [addFilterSubFieldKey.trim()] : undefined),
        filter_labels: Object.keys(addFilterLabels).length > 0 ? addFilterLabels : undefined,
        filters: addAdvancedFilters,
      };
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_card_single_value") {
      if (addCardSourceMode === "multi_line_agg") {
        if (!addMultiLineFieldKey.trim()) {
          toast.error("Select a multi-line items field");
          return;
        }
        if (addCardAgg !== "count" && !addValueSubFieldKey.trim()) {
          toast.error("Select a numeric sub-field for Sum, Average, Min, or Max");
          return;
        }
      }
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_card_single_value",
        title,
        kpi_id: addKpiId,
        year: addYear,
        period_key,
        source_mode: addCardSourceMode,
        field_key: addCardSourceMode === "field" ? addFieldKey.trim() : undefined,
        source_field_key: addCardSourceMode === "multi_line_agg" ? addMultiLineFieldKey.trim() : undefined,
        agg: addCardSourceMode === "multi_line_agg" ? addCardAgg : undefined,
        value_sub_field_key:
          addCardSourceMode === "multi_line_agg" && addCardAgg !== "count"
            ? addValueSubFieldKey.trim() || undefined
            : undefined,
        static_value: addCardSourceMode === "static" ? (addCardStaticValue.trim() || "") : undefined,
        subtitle: addCardSubtitle.trim() || undefined,
        prefix: addCardPrefix || undefined,
        suffix: addCardSuffix || undefined,
        decimals: addCardDecimals,
        thousand_sep: addCardThousandSep,
        align: addCardAlign,
        theme: addCardTheme,
        allow_custom_colors: addCardAllowCustomColors,
        bg_color: addCardAllowCustomColors ? addCardBgColor.trim() || undefined : undefined,
        fg_color: addCardAllowCustomColors ? addCardFgColor.trim() || undefined : undefined,
        filters: addCardSourceMode === "multi_line_agg" ? addAdvancedFilters : null,
      } as any;
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_multi_line_table") {
      if (!addMultiLineTableFieldKey.trim()) {
        toast.error("Select a multi-line items field");
        return;
      }
      const subKeys = addMultiLineTableSubKeys.filter((k) => k.trim());
      if (subKeys.length === 0) {
        toast.error("Select at least one sub-field column");
        return;
      }
      const rowsLimit = Math.max(1, Math.min(200, Math.round(addMultiLineTableTopRows || 5)));

      const joins = mlJoins
        .map((j) => ({
          kpi_id: j.kpi_id,
          source_field_key: j.source_field_key.trim(),
          on_left_sub_field_key: j.on_left_sub_field_key.trim(),
          on_right_sub_field_key: j.on_right_sub_field_key.trim(),
          sub_field_keys: j.sub_field_keys.filter((k) => k.trim()),
        }))
        .filter((j) => j.kpi_id && j.source_field_key);
      for (const j of joins) {
        if (!j.on_left_sub_field_key || !j.on_right_sub_field_key) {
          toast.error("Select join keys (left and right)");
          return;
        }
        if (j.sub_field_keys.length === 0) {
          toast.error("Select at least one joined sub-field column");
          return;
        }
      }

      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_multi_line_table",
        title,
        kpi_id: addKpiId,
        year: addYear,
        period_key,
        source_field_key: addMultiLineTableFieldKey.trim(),
        sub_field_keys: subKeys,
        rows_limit: rowsLimit as any,
        column_order: addMultiLineTableColumnOrder as any,
        joins: joins as any,
        filters: addAdvancedFilters,
      };
      applyWidgetUpsert(w);
      return;
    }
  };

  // Open the add-widget modal when navigated with ?add_widget=1 (used by top bar button).
  useEffect(() => {
    if (!token) return;
    if (widgetModalOpen) return;
    const q = searchParams.get("add_widget");
    if (q !== "1") return;
    openAddWidget();
    // Remove param so refresh doesn't keep opening.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("add_widget");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, searchParams, widgetModalOpen]);

  const removeWidget = (wid: string) => {
    setWidgets((prev) => {
      const next = prev.filter((w) => w.id !== wid);
      void persistDashboardLayout(next, consistentColors, colorMappings);
      return next;
    });
  };

  const toggleWidgetFullWidth = (wid: string) => {
    setWidgets((prev) => {
      const next = prev.map((w) => {
        if (w.id !== wid) return w;
        const nextFull = !(w as { full_width?: boolean }).full_width;
        if (nextFull) return { ...w, full_width: true, col_span: undefined } as Widget;
        return { ...w, full_width: false, col_span: (w as { col_span?: number }).col_span ?? 6 } as Widget;
      });
      void persistDashboardLayout(next, consistentColors, colorMappings);
      return next;
    });
  };

  const setWidgetColSpan = (wid: string, span: number) => {
    const s = Math.max(1, Math.min(DASHBOARD_GRID_COLUMNS, Math.round(span)));
    setWidgets((prev) => {
      const next = prev.map((w) =>
        w.id !== wid
          ? w
          : s >= DASHBOARD_GRID_COLUMNS
            ? ({ ...w, full_width: true, col_span: undefined } as Widget)
            : ({ ...w, full_width: false, col_span: s } as Widget)
      );
      void persistDashboardLayout(next, consistentColors, colorMappings);
      return next;
    });
  };

  const reorderWidgets = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setWidgets((prev) => {
      const others = prev.filter((w) => w.id !== fromId);
      const insertAt = others.findIndex((w) => w.id === toId);
      if (insertAt < 0) return prev;
      const item = prev.find((w) => w.id === fromId);
      if (!item) return prev;
      const next = [...others.slice(0, insertAt), item, ...others.slice(insertAt)];
      void persistDashboardLayout(next, consistentColors, colorMappings);
      return next;
    });
  };

  const swapWidgetsInLayout = (idA: string, idB: string) => {
    if (idA === idB) return;
    setWidgets((prev) => {
      const ia = prev.findIndex((x) => x.id === idA);
      const ib = prev.findIndex((x) => x.id === idB);
      if (ia < 0 || ib < 0) return prev;
      const next = [...prev];
      [next[ia], next[ib]] = [next[ib], next[ia]];
      void persistDashboardLayout(next, consistentColors, colorMappings);
      return next;
    });
  };

  const widgetMoveNeighbors = useMemo(() => {
    const m = new Map<string, { up: string | null; down: string | null; left: string | null; right: string | null }>();
    for (const w of widgets) {
      m.set(w.id, {
        up: findNeighborSwapId(widgets, w.id, "up"),
        down: findNeighborSwapId(widgets, w.id, "down"),
        left: findNeighborSwapId(widgets, w.id, "left"),
        right: findNeighborSwapId(widgets, w.id, "right"),
      });
    }
    return m;
  }, [widgets]);

  useEffect(() => {
    if (selectedDesignWidgetId == null) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest("[data-design-widget-cell]")) return;
      setSelectedDesignWidgetId(null);
    };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [selectedDesignWidgetId]);

  if (error) return <p className="form-error">{error}</p>;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {!widgetModalOpen && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "1rem", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => router.push(`/dashboard/dashboards/${dashboard.id}${orgIdFromQuery ? `?organization_id=${orgIdFromQuery}` : ""}`)}
            >
              ← Back to Dashboard
            </button>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              Design Mode: {dashboard.name}
            </h1>
          </div>
          {isSuperAdminRole(userRole) && (
            <button
              type="button"
              className="btn"
              style={{
                background: dashboardSettingsOpen ? "var(--border)" : "var(--accent)",
                color: "white",
              }}
              onClick={() => setDashboardSettingsOpen(!dashboardSettingsOpen)}
            >
              ⚙️ Dashboard Settings
            </button>
          )}
        </div>
      )}

      {!widgetModalOpen && dashboardSettingsOpen && isSuperAdminRole(userRole) && (
        <div className="card" style={{ padding: "1.25rem", display: "grid", gap: "1.25rem", background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Dashboard Color & Style Settings</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setDashboardSettingsOpen(false)}
            >
              Close
            </button>
          </div>

          <div style={{ display: "grid", gap: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={consistentColors}
                onChange={(e) => {
                  const nextVal = e.target.checked;
                  setConsistentColors(nextVal);
                  persistDashboardLayout(widgets, nextVal, colorMappings);
                }}
              />
              Consistent Colors for Unique Values
            </label>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
              When enabled, the same unique category value (e.g., "UET Lahore") will receive the same color across all charts on this dashboard.
            </p>
          </div>

          {consistentColors && (
            <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <span style={{ fontWeight: 650, fontSize: "0.9rem" }}>Color Mapping Config</span>
                <div style={{ display: "flex", gap: "0.35rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                    onClick={handleAutoGenerateColors}
                  >
                    Auto Generate Colors
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                    onClick={handleResetColorMapping}
                  >
                    Reset Color Mapping
                  </button>
                </div>
              </div>

              {allDashboards.filter(d => d.id !== dashboard.id).length > 0 && (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.25rem", padding: "0.5rem", background: "var(--bg)", borderRadius: "6px", border: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>Import color mappings from:</span>
                  <select
                    value={importSourceDashboardId || ""}
                    onChange={(e) => setImportSourceDashboardId(e.target.value ? Number(e.target.value) : null)}
                    style={{ padding: "0.25rem 0.45rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)" }}
                  >
                    <option value="">Select dashboard…</option>
                    {allDashboards
                      .filter((d) => d.id !== dashboard.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                    disabled={!importSourceDashboardId}
                    onClick={handleImportColors}
                  >
                    Import Colors
                  </button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.5rem", maxHeight: "250px", overflowY: "auto", paddingRight: "4px", marginTop: "0.5rem" }}>
                {allPageDisplayLabels.map((val) => {
                  const key = val.trim();
                  if (!key) return null;
                  const curColor = colorMappings[key] || getDeterministicColor(key, colorMappings);
                  return (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.35rem 0.55rem", background: "var(--bg)", borderRadius: "6px", border: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, paddingRight: "0.5rem" }}>{key}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span
                          style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            background: curColor,
                            border: "1px solid rgba(0,0,0,0.15)",
                            display: "inline-block",
                          }}
                        />
                        <input
                          type="color"
                          value={curColor.startsWith("#") && curColor.length === 7 ? curColor : "#9ca3af"}
                          onChange={(e) => handleUpdateValueColor(key, e.target.value)}
                          style={{ width: "32px", height: "24px", padding: 0, border: "none", cursor: "pointer", background: "transparent" }}
                          title={`Edit color for ${key}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <span style={{ fontWeight: 650, fontSize: "0.9rem" }}>Dashboard Date-Fetching Configuration</span>
            
            <div style={{ display: "grid", gap: "0.3rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={localDateBasedFetching}
                  onChange={(e) => setLocalDateBasedFetching(e.target.checked)}
                />
                Fetch Data with Date
              </label>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Enable date-based data-fetching using organization custom reporting periods. If disabled, default integer year logic will be used.
              </p>
            </div>

            {localDateBasedFetching && (
              <div style={{ display: "grid", gap: "0.8rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", background: "var(--surface)", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Select Reporting Type:</label>
                    <select
                      value={localDefaultPeriodType || "by_default"}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        setLocalDefaultPeriodType(nextType);
                        setLocalAllowedPeriodTypes(["by_default", ...customPeriods.map((c: any) => c.custom_period_name)]);
                        setLocalDefaultYear("");
                      }}
                      style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)" }}
                    >
                      <option value="by_default">Data Entry Period (By Default)</option>
                      {customPeriods.map((cp: any) => (
                        <option key={cp.custom_period_name} value={cp.custom_period_name}>
                          {cp.custom_period_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Default Reporting Year / Period:</label>
                    <select
                      value={localDefaultYear}
                      onChange={(e) => setLocalDefaultYear(e.target.value)}
                      style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)" }}
                    >
                      <option value="">Select default period...</option>
                      {designDefaultPeriodOptions.map((opt: any) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Configure Date Column per Multi-Line Field</label>
                  {dashboardMliFields.length === 0 ? (
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: 0, fontStyle: "italic" }}>
                      No multi-line fields are used in this dashboard. Add widgets using multi-line fields to configure date columns.
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      {dashboardMliFields.map((item) => {
                        const key = `${item.kpiId}_${item.field.key}`;
                        return (
                          <div key={key} style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", display: "grid", gap: "0.5rem" }}>
                            <div style={{ fontSize: "0.82rem", fontWeight: 650 }}>
                              <span style={{ color: "var(--muted)" }}>KPI:</span> {item.kpiName} <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>Field:</span> {item.field.name}
                            </div>
                            <div style={{ display: "grid", gap: "0.35rem" }}>
                              <select
                                value={localMliDateCols[key] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLocalMliDateCols(prev => ({
                                    ...prev,
                                    [key]: val
                                  }));
                                }}
                                style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", width: "100%" }}
                              >
                                <option value="">Select date column...</option>
                                {item.field.sub_fields?.map((sf: any) => (
                                  <option key={sf.key} value={sf.key}>
                                    {sf.name || sf.key} ({sf.field_type})
                                  </option>
                                ))}
                                {localMliDateCols[key] &&
                                  !item.field.sub_fields?.some((sf: any) => sf.key === localMliDateCols[key]) && (
                                    <option value={localMliDateCols[key]}>
                                      {localMliDateCols[key]} (Custom)
                                    </option>
                                  )}
                              </select>
                              <input
                                type="text"
                                placeholder="Or type custom date column key..."
                                value={localMliDateCols[key] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLocalMliDateCols(prev => ({
                                    ...prev,
                                    [key]: val
                                  }));
                                }}
                                style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)" }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

          <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <span style={{ fontWeight: 650, fontSize: "0.9rem" }}>Specific Column Data Fetching</span>
            
            <div style={{ display: "grid", gap: "0.3rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={localColumnBasedFetching}
                  onChange={(e) => setLocalColumnBasedFetching(e.target.checked)}
                />
                Enable Data Fetch with Specific Column
              </label>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
                Allow end users to filter dashboard data dynamically by a specific Multi-Line Item column (e.g., Department).
              </p>
            </div>

            {localColumnBasedFetching && (
              <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", background: "var(--surface)", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border)" }}>
                {/* Step 1 & 2: Select MLI */}
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Step 1 & 2: Select Target Multi-Line Item (MLI)</label>
                  {dashboardMliFields.length === 0 ? (
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: 0, fontStyle: "italic" }}>
                      No multi-line fields are used in this dashboard. Add widgets using multi-line fields to configure specific column fetching.
                    </p>
                  ) : (
                    <select
                      value={localSelectedMliKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLocalSelectedMliKey(val);
                        setLocalSelectedColumnKey("");
                      }}
                      style={{ padding: "0.45rem 0.6rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", width: "100%" }}
                    >
                      <option value="">-- Choose Multi-Line Item --</option>
                      {dashboardMliFields.map((item) => (
                        <option key={`${item.kpiId}_${item.field.key}`} value={`${item.kpiId}_${item.field.key}`}>
                          {item.kpiName} → {item.field.name} ({item.field.key})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Step 3: Select Column */}
                {localSelectedMliKey && (
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Step 3: Select Target Column to Filter By</label>
                    {(() => {
                      const selectedMli = dashboardMliFields.find(
                        (item) => `${item.kpiId}_${item.field.key}` === localSelectedMliKey
                      );
                      const subFields = selectedMli?.field?.sub_fields || [];
                      return (
                        <select
                          value={localSelectedColumnKey}
                          onChange={(e) => setLocalSelectedColumnKey(e.target.value)}
                          style={{ padding: "0.45rem 0.6rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", width: "100%" }}
                        >
                          <option value="">-- Choose Column (e.g. Department) --</option>
                          {subFields.map((sf: any) => (
                            <option key={sf.key} value={sf.key}>
                              {sf.name || sf.key} ({sf.field_type})
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                  </div>
                )}

                {/* Preview summary */}
                {localSelectedMliKey && localSelectedColumnKey && (
                  <div style={{ padding: "0.5rem 0.75rem", background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.2)", borderRadius: "6px", fontSize: "0.82rem" }}>
                    <span style={{ fontWeight: 600, color: "#2563eb" }}>Active Filter Configuration:</span> End users will see a global filter for <strong>{(() => {
                      const selectedMli = dashboardMliFields.find(
                        (item) => `${item.kpiId}_${item.field.key}` === localSelectedMliKey
                      );
                      const sf = selectedMli?.field?.sub_fields?.find((s: any) => s.key === localSelectedColumnKey);
                      return sf?.name || localSelectedColumnKey;
                    })()}</strong> populated with distinct values.
                  </div>
                )}
              </div>
            )}
          </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const nextDateConfig = {
                  ...dateFetchingConfig,
                  allowed_period_types: localAllowedPeriodTypes,
                  default_period_type: localDefaultPeriodType,
                  default_year: localDefaultYear,
                  mli_date_cols: localMliDateCols,
                };
                let nextColConfig = null;
                if (localColumnBasedFetching && localSelectedMliKey && localSelectedColumnKey) {
                  const selectedMli = dashboardMliFields.find(
                    (item) => `${item.kpiId}_${item.field.key}` === localSelectedMliKey
                  );
                  const sf = selectedMli?.field?.sub_fields?.find((s: any) => s.key === localSelectedColumnKey);
                  nextColConfig = {
                    enabled: true,
                    kpi_id: selectedMli?.kpiId,
                    kpi_name: selectedMli?.kpiName,
                    source_field_key: selectedMli?.field?.key,
                    column_key: localSelectedColumnKey,
                    column_name: sf?.name || localSelectedColumnKey,
                  };
                }
                await persistDashboardLayout(
                  widgets,
                  consistentColors,
                  colorMappings,
                  localDateBasedFetching,
                  nextDateConfig,
                  localColumnBasedFetching,
                  nextColConfig
                );
                toast.success("Configuration saved successfully.");
              }}
              style={{ marginTop: "0.5rem", width: "100%" }}
            >
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {!widgetModalOpen &&
        (widgets.length === 0 ? (
          <div className="card" style={{ padding: "1rem" }}>
            <p style={{ color: "var(--muted)", margin: 0 }}>No widgets yet. Click “Add widget”.</p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: `repeat(${DASHBOARD_GRID_COLUMNS}, minmax(0, 1fr))`,
            }}
          >
            {widgets.map((w) => {
              const canDesign = isSuperAdminRole(userRole);
              const showMoveChrome =
                canDesign && (hoveredDesignWidgetId === w.id || selectedDesignWidgetId === w.id);
              const isDesignActive = showMoveChrome;
              const nb = widgetMoveNeighbors.get(w.id);
              return (
                <div
                  key={w.id}
                  data-design-widget-cell
                  style={{
                    position: "relative",
                    paddingLeft: canDesign ? 28 : undefined,
                    ...widgetGridColumnStyle(w as { full_width?: boolean; col_span?: number }),
                    opacity: draggingWidgetId === w.id ? 0.55 : 1,
                    outline: isDesignActive ? "2px solid #3b82f6" : undefined,
                    outlineOffset: isDesignActive ? 2 : undefined,
                    borderRadius: isDesignActive ? 12 : undefined,
                    transition: "outline-color 0.15s ease, outline-offset 0.15s ease",
                  }}
                  onMouseEnter={() => canDesign && setHoveredDesignWidgetId(w.id)}
                  onMouseLeave={() => canDesign && setHoveredDesignWidgetId((cur) => (cur === w.id ? null : cur))}
                  onMouseDown={(e) => {
                    if (!canDesign || e.button !== 0) return;
                    if ((e.target as HTMLElement).closest("[data-design-move-arrow]")) return;
                    setSelectedDesignWidgetId(w.id);
                  }}
                  onDragOver={
                    canDesign
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }
                      : undefined
                  }
                  onDrop={
                    canDesign
                      ? (e) => {
                          e.preventDefault();
                          const from = e.dataTransfer.getData("text/plain");
                          if (from) reorderWidgets(from, w.id);
                        }
                      : undefined
                  }
                >
                  {showMoveChrome && nb ? (
                    <>
                      <DesignMoveArrow
                        dir="up"
                        disabled={!nb.up}
                        positionStyle={{ top: -14, left: "50%", marginLeft: -14 }}
                        onClick={() => nb.up && swapWidgetsInLayout(w.id, nb.up)}
                      />
                      <DesignMoveArrow
                        dir="down"
                        disabled={!nb.down}
                        positionStyle={{ bottom: -14, left: "50%", marginLeft: -14 }}
                        onClick={() => nb.down && swapWidgetsInLayout(w.id, nb.down)}
                      />
                      <DesignMoveArrow
                        dir="left"
                        disabled={!nb.left}
                        positionStyle={{ left: -14, top: "50%", marginTop: -14 }}
                        onClick={() => nb.left && swapWidgetsInLayout(w.id, nb.left)}
                      />
                      <DesignMoveArrow
                        dir="right"
                        disabled={!nb.right}
                        positionStyle={{ right: -14, top: "50%", marginTop: -14 }}
                        onClick={() => nb.right && swapWidgetsInLayout(w.id, nb.right)}
                      />
                    </>
                  ) : null}
                  {canDesign ? (
                    <div
                      draggable
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData("text/plain", w.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingWidgetId(w.id);
                      }}
                      onDragEnd={() => setDraggingWidgetId(null)}
                      title="Drag to reorder"
                      role="button"
                      aria-label="Drag to reorder widget"
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        zIndex: 5,
                        cursor: "grab",
                        padding: "4px 6px",
                        lineHeight: 1,
                        fontSize: "14px",
                        color: "var(--muted)",
                        borderRadius: 6,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        userSelect: "none",
                      }}
                    >
                      ⋮⋮
                    </div>
                  ) : null}
                  <WidgetRenderer
                    widget={w as any}
                    organizationId={dashboard.organization_id}
                    dashboardId={dashboard.id}
                    designActions={
                      canDesign
                        ? {
                            onEdit: () => openEditWidget(w),
                            onDelete: () => removeWidget(w.id),
                            onToggleFullWidth: () => toggleWidgetFullWidth(w.id),
                            isFullWidth: !!(w as { full_width?: boolean }).full_width,
                            colSpan: effectiveColSpan(w as { full_width?: boolean; col_span?: number }),
                            onSetColSpan: (span) => setWidgetColSpan(w.id, span),
                          }
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        ))}

      {widgetModalOpen && (
        <div className="modal-backdrop">
          <div
            className="modal"
            style={{
              width: "min(980px, 100%)",
              height: "min(100vh, 100%)",
              maxWidth: "none",
              maxHeight: "none",
              borderRadius: 0,
              padding: 0,
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: "auto 1fr",
            }}
          >
            <div
              style={{
                padding: "0.9rem 1rem",
                borderBottom: "1px solid var(--border)",
                background: "var(--surface)",
                display: "grid",
                gap: "0.75rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: "0.15rem" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{isEditing ? "Edit widget" : "Add widget"}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Preview is hidden while editing.</div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <button type="button" className="btn" onClick={() => setWidgetModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={upsertWidget}>
                    {isEditing ? "Update widget" : "Add widget"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditTab("basics")}
                  aria-pressed={editTab === "basics"}
                  style={{ fontSize: "0.85rem", borderColor: editTab === "basics" ? "var(--accent)" : undefined, color: editTab === "basics" ? "var(--accent)" : undefined }}
                >
                  Basics
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditTab("options")}
                  aria-pressed={editTab === "options"}
                  style={{ fontSize: "0.85rem", borderColor: editTab === "options" ? "var(--accent)" : undefined, color: editTab === "options" ? "var(--accent)" : undefined }}
                >
                  {addType === "kpi_multi_line_table" ? "Column selection" : "Options"}
                </button>
              </div>
            </div>

            <div style={{ overflow: "auto", overflowX: "hidden", padding: "0.9rem" }}>
              <div style={{ maxWidth: 680, margin: "0 auto", display: "grid", gap: "0.75rem" }}>
                {editTab === "basics" && (
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Type</label>
                      <select
                        value={addType}
                        onChange={(e) => setAddType(e.target.value as WidgetType)}
                        style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                      >
                        {isEditing && !SUPER_ADMIN_WIDGET_TYPES.includes(addType) ? (
                          <option value={addType}>Existing widget type ({addType})</option>
                        ) : null}
                        <option value="kpi_card_single_value">KPI card (single value)</option>
                        <option value="kpi_bar_chart">KPI chart (bar/pie)</option>
                        <option value="kpi_trend">KPI trend</option>
                        <option value="kpi_multi_line_table">KPI multi-line table</option>
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Title</label>
                      <input
                        value={addTitle}
                        onChange={(e) => setAddTitle(e.target.value)}
                        style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                        placeholder="Optional"
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Layout</label>
                      <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                        <input type="checkbox" checked={fullWidth} onChange={(e) => setFullWidth(e.target.checked)} />
                        Full width
                      </label>
                    </div>
                    {addType !== "text" && (
                      <>
                        <div style={{ height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>KPI</label>
                          <select
                            value={addKpiId ?? ""}
                            onChange={(e) => setAddKpiId(Number(e.target.value))}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            {kpis.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.name} (#{k.id})
                              </option>
                            ))}
                          </select>
                        </div>

                        {addType === "kpi_line_chart" || addType === "kpi_trend" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Start year</label>
                              <input
                                type="number"
                                value={addStartYear}
                                onChange={(e) => setAddStartYear(Number(e.target.value))}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>End year</label>
                              <input
                                type="number"
                                value={addEndYear}
                                onChange={(e) => setAddEndYear(Number(e.target.value))}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                          </div>
                        ) : (
                          fetchDataWithDate ? (
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Default Reporting Period</label>
                              <select
                                value={addYear}
                                onChange={(e) => setAddYear(e.target.value)}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--surface)" }}
                              >
                                <option value="">Select period...</option>
                                {widgetPeriodOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Year</label>
                              <input
                                type="number"
                                value={addYear}
                                onChange={(e) => setAddYear(Number(e.target.value))}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                          )
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Period</label>
                          <input
                            value={addPeriodKey}
                            onChange={(e) => setAddPeriodKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            placeholder="Optional"
                          />
                        </div>

                        {addType === "kpi_multi_line_table" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Top rows</label>
                            <input
                              type="number"
                              min={1}
                              max={200}
                              value={addMultiLineTableTopRows}
                              onChange={(e) => setAddMultiLineTableTopRows(Number(e.target.value))}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              placeholder="e.g. 5"
                            />
                          </div>
                        ) : null}

                        {isSuperAdminRole(userRole) && addType === "kpi_multi_line_table" && addMultiLineTableFieldKey.trim() && tableMultiLineSubFields.length > 0 ? (
                          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
                            <div style={{ fontSize: "0.85rem", fontWeight: 650, marginBottom: "0.5rem" }}>Advanced filters</div>
                            <MultiLineReportFilterPanel
                              organizationId={dashboard?.organization_id ?? 0}
                              token={token ?? null}
                              fieldKey={addMultiLineTableFieldKey.trim()}
                              subFields={tableMultiLineSubFields as unknown as MultiFilterSubField[]}
                              value={addAdvancedFilters}
                              onChange={setAddAdvancedFilters}
                            />
                          </div>
                        ) : null}

                        {(addType === "kpi_single_value" || addType === "kpi_line_chart") && (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field</label>
                            <select
                              value={addFieldKey}
                              onChange={(e) => setAddFieldKey(e.target.value)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            >
                              <option value="">Select…</option>
                              {addFields.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.name} ({f.key})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </>
                    )}
                    {addType === "text" && (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Text</label>
                        <textarea
                          value={addText}
                          onChange={(e) => setAddText(e.target.value)}
                          style={{ padding: "0.55rem", minHeight: 220, fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {editTab === "options" && (
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    {addType === "kpi_table" && (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field keys</label>
                        <input
                          value={addFieldKeys}
                          onChange={(e) => setAddFieldKeys(e.target.value)}
                          style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          placeholder="Comma-separated (optional)"
                        />
                      </div>
                    )}

                    {addType === "kpi_bar_chart" && (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Chart</label>
                          <select
                            value={addChartType}
                            onChange={(e) => setAddChartType(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="bar">Bar</option>
                            <option value="pie">Pie</option>
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Data</label>
                          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                              <input type="radio" checked={addChartMode === "fields"} onChange={() => setAddChartMode("fields")} />
                              Fields
                            </label>
                            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                              <input type="radio" checked={addChartMode === "multi_line_items"} onChange={() => setAddChartMode("multi_line_items")} />
                              Multi-line items
                            </label>
                          </div>
                        </div>
                      </>
                    )}

                    {addType === "kpi_trend" && (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>View</label>
                          <select
                            value={addTrendView}
                            onChange={(e) => setAddTrendView(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="bar">Bar (multi-year)</option>
                            <option value="line">Line (trend)</option>
                          </select>
                        </div>
                        {isSuperAdminRole(userRole) ? (
                          <div style={{ display: "grid", gap: "0.75rem" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Sort</label>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                                <select
                                  value={addBarSortBy}
                                  onChange={(e) => setAddBarSortBy(e.target.value as any)}
                                  style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                  title="Sort by"
                                >
                                  <option value="x">Label</option>
                                  <option value="value">Value</option>
                                </select>
                                <select
                                  value={addBarSortDir}
                                  onChange={(e) => setAddBarSortDir(e.target.value as any)}
                                  style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                  title="Sort direction"
                                >
                                  <option value="asc">Ascending</option>
                                  <option value="desc">Descending</option>
                                </select>
                              </div>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Colors</label>
                              <select
                                value={addBarColorMode}
                                onChange={(e) => setAddBarColorMode(e.target.value as any)}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              >
                                <option value="solid">Single (solid)</option>
                                <option value="palette">Palette</option>
                                <option value="gradient">Gradient</option>
                              </select>
                            </div>
                            {addBarColorMode === "solid" ? (
                              <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                                <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Color</label>
                                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                  <input type="color" value={addBarColor} onChange={(e) => setAddBarColor(e.target.value)} style={{ width: 44, height: 34, padding: 0 }} />
                                  <input
                                    value={addBarColor}
                                    onChange={(e) => setAddBarColor(e.target.value)}
                                    placeholder="#4f46e5 or CSS color"
                                    style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                  />
                                </div>
                              </div>
                            ) : null}
                        {addBarColorMode === "palette" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Scheme</label>
                            <select
                              value={addBarPaletteScheme}
                              onChange={(e) => setAddBarPaletteScheme(e.target.value as PaletteSchemeId)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            >
                              {PALETTE_SCHEMES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        {addBarColorMode === "gradient" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Base color</label>
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                              <input
                                type="color"
                                value={addBarGradientFrom}
                                onChange={(e) => {
                                  const base = e.target.value;
                                  const stops = deriveGradientStopsFromBase(base);
                                  setAddBarGradientFrom(stops.from);
                                  setAddBarGradientTo(stops.to);
                                }}
                                style={{ width: 44, height: 34, padding: 0 }}
                              />
                              <input
                                value={addBarGradientFrom}
                                onChange={(e) => {
                                  const base = e.target.value;
                                  const stops = deriveGradientStopsFromBase(base);
                                  setAddBarGradientFrom(stops.from);
                                  setAddBarGradientTo(stops.to);
                                }}
                                placeholder="#4f46e5"
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                          </div>
                        ) : null}
                          </div>
                        ) : null}
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Data</label>
                          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                              <input type="radio" checked={addTrendMode === "multi_line_items"} onChange={() => setAddTrendMode("multi_line_items")} />
                              Multi-line items
                            </label>
                            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                              <input type="radio" checked={addTrendMode === "fields"} onChange={() => setAddTrendMode("fields")} />
                              Fields
                            </label>
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Default years (viewer starts with these)</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                            {(() => {
                              const a = Math.min(addStartYear, addEndYear);
                              const b = Math.max(addStartYear, addEndYear);
                              const years: number[] = [];
                              for (let y = b; y >= a; y--) years.push(y);
                              const setYear = (y: number) =>
                                setAddTrendDefaultYears((prev) =>
                                  prev.includes(y) ? prev.filter((x) => x !== y) : [...prev, y].sort((m, n) => n - m)
                                );
                              return years.map((y) => {
                                const active = addTrendDefaultYears.includes(y);
                                return (
                                  <button
                                    key={y}
                                    type="button"
                                    onClick={() => setYear(y)}
                                    className="btn"
                                    style={{
                                      fontSize: "0.85rem",
                                      padding: "0.2rem 0.55rem",
                                      borderRadius: 999,
                                      borderColor: active ? "var(--accent)" : undefined,
                                      color: active ? "var(--accent)" : undefined,
                                      background: active ? "rgba(79,70,229,0.08)" : undefined,
                                    }}
                                    aria-pressed={active}
                                  >
                                    {y}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            <button type="button" className="btn" onClick={() => setAddTrendDefaultYears([])} style={{ fontSize: "0.85rem" }}>
                              Clear
                            </button>
                            <div style={{ color: "var(--muted)", fontSize: "0.85rem", alignSelf: "center" }}>
                              Leave empty to default to latest year.
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {addType === "kpi_bar_chart" && addChartMode === "fields" && (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field keys</label>
                        <input
                          value={addFieldKeys}
                          onChange={(e) => setAddFieldKeys(e.target.value)}
                          style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          placeholder="Comma-separated (required)"
                        />
                      </div>
                    )}

                    {addType === "kpi_bar_chart" && isSuperAdminRole(userRole) ? (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Sort</label>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                            <select
                              value={addBarSortBy}
                              onChange={(e) => setAddBarSortBy(e.target.value as any)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              title="Sort by"
                            >
                              <option value="x">X-axis (label)</option>
                              <option value="value">Value</option>
                            </select>
                            <select
                              value={addBarSortDir}
                              onChange={(e) => setAddBarSortDir(e.target.value as any)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              title="Sort direction"
                            >
                              <option value="asc">Ascending</option>
                              <option value="desc">Descending</option>
                            </select>
                          </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Colors</label>
                          <select
                            value={addBarColorMode}
                            onChange={(e) => setAddBarColorMode(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="solid">Same color (solid)</option>
                            <option value="palette">Different colors (palette)</option>
                            <option value="gradient">Gradient (same color family)</option>
                          </select>
                        </div>
                        {addBarColorMode === "solid" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Color</label>
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                              <input type="color" value={addBarColor} onChange={(e) => setAddBarColor(e.target.value)} style={{ width: 44, height: 34, padding: 0 }} />
                              <input
                                value={addBarColor}
                                onChange={(e) => setAddBarColor(e.target.value)}
                                placeholder="#4f46e5 or CSS color"
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                          </div>
                        ) : null}
                        {addBarColorMode === "palette" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Scheme</label>
                            <select
                              value={addBarPaletteScheme}
                              onChange={(e) => setAddBarPaletteScheme(e.target.value as PaletteSchemeId)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            >
                              {PALETTE_SCHEMES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        {addBarColorMode === "gradient" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Base color</label>
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                              <input
                                type="color"
                                value={addBarGradientFrom}
                                onChange={(e) => {
                                  const base = e.target.value;
                                  const stops = deriveGradientStopsFromBase(base);
                                  setAddBarGradientFrom(stops.from);
                                  setAddBarGradientTo(stops.to);
                                }}
                                style={{ width: 44, height: 34, padding: 0 }}
                              />
                              <input
                                value={addBarGradientFrom}
                                onChange={(e) => {
                                  const base = e.target.value;
                                  const stops = deriveGradientStopsFromBase(base);
                                  setAddBarGradientFrom(stops.from);
                                  setAddBarGradientTo(stops.to);
                                }}
                                placeholder="#4f46e5"
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {addType === "kpi_trend" && addTrendMode === "fields" && (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field keys</label>
                        <input
                          value={addFieldKeys}
                          onChange={(e) => setAddFieldKeys(e.target.value)}
                          style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          placeholder="Comma-separated (required)"
                        />
                      </div>
                    )}

                    {addType === "kpi_multi_line_table" && (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                            gap: "0.75rem",
                            alignItems: "start",
                          }}
                        >
                          <div style={{ display: "grid", gap: "0.75rem" }}>
                            <div className="card" style={{ padding: "0.85rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                                <div style={{ fontWeight: 800 }}>Primary KPI columns</div>
                                <button type="button" className="btn" onClick={() => setMlPrimaryCollapsed((v) => !v)} style={{ fontSize: "0.85rem" }}>
                                  {mlPrimaryCollapsed ? "Expand" : "Collapse"}
                                </button>
                              </div>
                              {!mlPrimaryCollapsed ? (
                                <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.6rem" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                                    <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Source</label>
                                    <select
                                      value={addMultiLineTableFieldKey}
                                      onChange={(e) => {
                                        setAddMultiLineTableFieldKey(e.target.value);
                                        setAddMultiLineTableSubKeys([]);
                                        setMlJoins([]);
                                        setAddMultiLineTableColumnOrder([]);
                                      }}
                                      style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                    >
                                      <option value="">Select…</option>
                                      {addMultiLineFields.map((f) => (
                                        <option key={f.key} value={f.key}>
                                          {f.name} ({f.key})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <input
                                    value={mlTableSearch}
                                    onChange={(e) => setMlTableSearch(e.target.value)}
                                    placeholder="Search columns…"
                                    style={{ padding: "0.45rem 0.55rem", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.9rem" }}
                                  />
                                  <div style={{ display: "grid", gap: "0.35rem", maxHeight: 260, overflow: "auto", paddingRight: 4 }}>
                                    {tableMultiLineSubFields
                                      .filter((sf) => {
                                        const q = mlTableSearch.trim().toLowerCase();
                                        if (!q) return true;
                                        return `${sf.name} ${sf.key}`.toLowerCase().includes(q);
                                      })
                                      .map((sf) => (
                                        <label key={sf.key} style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                                          <input
                                            type="checkbox"
                                            checked={addMultiLineTableSubKeys.includes(sf.key)}
                                            onChange={(e) => {
                                              const checked = e.target.checked;
                                              setAddMultiLineTableSubKeys((prev) => (checked ? [...prev, sf.key] : prev.filter((k) => k !== sf.key)));
                                              setAddMultiLineTableColumnOrder((prev) => {
                                                const key = sf.key;
                                                if (checked) return prev.includes(key) ? prev : [...prev, key];
                                                return prev.filter((k) => k !== key);
                                              });
                                            }}
                                          />
                                          <span>
                                            {sf.name} <span style={{ color: "var(--muted)" }}>({sf.key})</span>
                                          </span>
                                        </label>
                                      ))}
                                    {tableMultiLineSubFields.length === 0 ? (
                                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Select a multi-line source to see columns.</div>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                              <div style={{ fontWeight: 800 }}>Joins</div>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  setMlJoins((prev) => [
                                    ...prev,
                                    {
                                      kpi_id: null,
                                      source_field_key: "",
                                      on_left_sub_field_key: "",
                                      on_right_sub_field_key: "",
                                      sub_field_keys: [],
                                      collapsed: false,
                                      search: "",
                                    },
                                  ]);
                                }}
                                style={{ fontSize: "0.85rem" }}
                              >
                                + Join another KPI
                              </button>
                            </div>
                            {mlJoins.length === 0 ? (
                              <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No joins added.</div>
                            ) : (
                              <div style={{ display: "grid", gap: "0.75rem" }}>
                                {mlJoins.map((j, idx) => {
                                  const joinKpiId = j.kpi_id;
                                  const joinKpiName = joinKpiId ? kpis.find((k) => k.id === joinKpiId)?.name : null;
                                  const title = joinKpiName ? `Join: ${joinKpiName}` : `Join #${idx + 1}`;
                                  const joinKpiFields = joinKpiId ? (fieldsByKpiId[joinKpiId] ?? []) : [];
                                  const joinMlFields = joinKpiFields.filter((f) => f.field_type === "multi_line_items");
                                  const joinSelectedField = joinMlFields.find((f) => f.key === j.source_field_key) ?? null;
                                  const joinSubFields = joinSelectedField?.sub_fields ?? [];
                                  const q = (j.search || "").trim().toLowerCase();
                                  const filteredJoinSubFields = q ? joinSubFields.filter((sf) => `${sf.name} ${sf.key}`.toLowerCase().includes(q)) : joinSubFields;
                                  return (
                                    <div key={idx} className="card" style={{ padding: "0.85rem" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
                                        <div style={{ fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>
                                          {title}
                                        </div>
                                        <div style={{ display: "flex", gap: "0.35rem" }}>
                                          <button
                                            type="button"
                                            className="btn"
                                            onClick={() => setMlJoins((prev) => prev.map((x, i) => (i === idx ? { ...x, collapsed: !x.collapsed } : x)))}
                                            style={{ fontSize: "0.85rem" }}
                                          >
                                            {j.collapsed ? "Expand" : "Collapse"}
                                          </button>
                                          <button
                                            type="button"
                                            className="btn"
                                            onClick={() => {
                                              setMlJoins((prev) => prev.filter((_, i) => i !== idx));
                                              setAddMultiLineTableColumnOrder((prev) => prev.filter((k) => !k.startsWith(`join:${idx}:`)));
                                            }}
                                            style={{ fontSize: "0.85rem" }}
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      </div>

                                        {!j.collapsed ? (
                                          <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.6rem" }}>
                                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join KPI</label>
                                              <select
                                                value={j.kpi_id ?? ""}
                                                onChange={(e) => {
                                                  const next = Number(e.target.value);
                                                  setMlJoins((prev) =>
                                                    prev.map((x, i) =>
                                                      i === idx
                                                        ? {
                                                            ...x,
                                                            kpi_id: Number.isFinite(next) ? next : null,
                                                            source_field_key: "",
                                                            on_right_sub_field_key: "",
                                                            sub_field_keys: [],
                                                          }
                                                        : x
                                                    )
                                                  );
                                                  setAddMultiLineTableColumnOrder((prev) => prev.filter((k) => !k.startsWith(`join:${idx}:`)));
                                                }}
                                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                              >
                                                <option value="">Select…</option>
                                                {kpis.map((k) => (
                                                  <option key={k.id} value={k.id}>
                                                    {k.name} (#{k.id})
                                                  </option>
                                                ))}
                                              </select>
                                            </div>

                                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join source</label>
                                              <select
                                                value={j.source_field_key}
                                                onChange={(e) => {
                                                  const v = e.target.value;
                                                  setMlJoins((prev) => prev.map((x, i) => (i === idx ? { ...x, source_field_key: v, on_right_sub_field_key: "", sub_field_keys: [] } : x)));
                                                  setAddMultiLineTableColumnOrder((prev) => prev.filter((k) => !k.startsWith(`join:${idx}:`)));
                                                }}
                                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                                disabled={!j.kpi_id}
                                              >
                                                <option value="">Select…</option>
                                                {joinMlFields.map((f) => (
                                                  <option key={f.key} value={f.key}>
                                                    {f.name} ({f.key})
                                                  </option>
                                                ))}
                                              </select>
                                            </div>

                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                                              <div style={{ display: "grid", gap: "0.25rem" }}>
                                                <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join key (this table)</label>
                                                <select
                                                  value={j.on_left_sub_field_key}
                                                  onChange={(e) =>
                                                    setMlJoins((prev) => prev.map((x, i) => (i === idx ? { ...x, on_left_sub_field_key: e.target.value } : x)))
                                                  }
                                                  style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                                  disabled={!addMultiLineTableFieldKey}
                                                >
                                                  <option value="">Select…</option>
                                                  {tableMultiLineSubFields.map((sf) => (
                                                    <option key={sf.key} value={sf.key}>
                                                      {sf.name} ({sf.key})
                                                    </option>
                                                  ))}
                                                </select>
                                              </div>
                                              <div style={{ display: "grid", gap: "0.25rem" }}>
                                                <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join key (joined KPI)</label>
                                                <select
                                                  value={j.on_right_sub_field_key}
                                                  onChange={(e) =>
                                                    setMlJoins((prev) => prev.map((x, i) => (i === idx ? { ...x, on_right_sub_field_key: e.target.value } : x)))
                                                  }
                                                  style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                                  disabled={!j.source_field_key}
                                                >
                                                  <option value="">Select…</option>
                                                  {joinSubFields.map((sf) => (
                                                    <option key={sf.key} value={sf.key}>
                                                      {sf.name} ({sf.key})
                                                    </option>
                                                  ))}
                                                </select>
                                              </div>
                                            </div>

                                            <input
                                              value={j.search}
                                              onChange={(e) => setMlJoins((prev) => prev.map((x, i) => (i === idx ? { ...x, search: e.target.value } : x)))}
                                              placeholder="Search joined columns…"
                                              style={{ padding: "0.45rem 0.55rem", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.9rem" }}
                                              disabled={!j.source_field_key}
                                            />
                                            <div style={{ display: "grid", gap: "0.35rem", maxHeight: 240, overflow: "auto", paddingRight: 4 }}>
                                              {filteredJoinSubFields.map((sf) => (
                                                <label key={sf.key} style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                                                  <input
                                                    type="checkbox"
                                                    checked={j.sub_field_keys.includes(sf.key)}
                                                    onChange={(e) => {
                                                      const checked = e.target.checked;
                                                      setMlJoins((prev) =>
                                                        prev.map((x, i) =>
                                                          i === idx
                                                            ? { ...x, sub_field_keys: checked ? [...x.sub_field_keys, sf.key] : x.sub_field_keys.filter((k) => k !== sf.key) }
                                                            : x
                                                        )
                                                      );
                                                      setAddMultiLineTableColumnOrder((prev) => {
                                                        const key = `join:${idx}:${sf.key}`;
                                                        if (checked) return prev.includes(key) ? prev : [...prev, key];
                                                        return prev.filter((k) => k !== key);
                                                      });
                                                    }}
                                                  />
                                                  <span>
                                                    {sf.name} <span style={{ color: "var(--muted)" }}>({sf.key})</span>
                                                  </span>
                                                </label>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="card" style={{ padding: "0.85rem" }}>
                            <div style={{ fontWeight: 800, marginBottom: "0.35rem" }}>Selected columns (viewer order)</div>
                            <div style={{ display: "grid", gap: "0.35rem" }}>
                              {addMultiLineTableColumnOrder.filter((k) => {
                                if (k.startsWith("join:")) return addMultiLineTableJoinSubKeys.includes(k.slice("join:".length));
                                return addMultiLineTableSubKeys.includes(k);
                              }).length === 0 ? (
                                <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No columns selected yet.</div>
                              ) : null}
                              {addMultiLineTableColumnOrder
                                .filter((k) => {
                                  if (k.startsWith("join:")) {
                                    const parts = k.split(":");
                                    const idx = Number(parts[1]);
                                    const key = parts.slice(2).join(":");
                                    if (!Number.isFinite(idx)) return false;
                                    return mlJoins[idx]?.sub_field_keys.includes(key) ?? false;
                                  }
                                  return addMultiLineTableSubKeys.includes(k);
                                })
                                .map((key) => {
                                  const isJoin = key.startsWith("join:");
                                  const raw = (() => {
                                    if (!isJoin) return key;
                                    const parts = key.split(":");
                                    return parts.slice(2).join(":");
                                  })();
                                  const joinIdx = (() => {
                                    if (!isJoin) return null;
                                    const parts = key.split(":");
                                    const n = Number(parts[1]);
                                    return Number.isFinite(n) ? n : null;
                                  })();
                                  const label = isJoin
                                    ? raw
                                    : tableMultiLineSubFields.find((sf) => sf.key === raw)?.name ?? raw;
                                  const pill = isJoin ? `Join #${(joinIdx ?? 0) + 1}` : "Primary";
                                  return (
                                    <div
                                      key={key}
                                      draggable
                                      onDragStart={(e) => {
                                        e.dataTransfer.setData("text/plain", key);
                                        e.dataTransfer.effectAllowed = "move";
                                        setDraggingTableColKey(key);
                                      }}
                                      onDragEnd={() => setDraggingTableColKey(null)}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = "move";
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        const from = e.dataTransfer.getData("text/plain");
                                        const to = key;
                                        if (!from || from === to) return;
                                        setAddMultiLineTableColumnOrder((prev) => {
                                          const a = prev.indexOf(from);
                                          const b = prev.indexOf(to);
                                          if (a < 0 || b < 0) return prev;
                                          const next = [...prev];
                                          next.splice(a, 1);
                                          next.splice(b, 0, from);
                                          return next;
                                        });
                                      }}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "0.5rem",
                                        padding: "0.4rem 0.55rem",
                                        borderRadius: 10,
                                        border: "1px solid var(--border)",
                                        background: "var(--surface)",
                                        opacity: draggingTableColKey === key ? 0.55 : 1,
                                        cursor: "grab",
                                        userSelect: "none",
                                      }}
                                      title="Drag to reorder"
                                    >
                                      <span style={{ color: "var(--muted)" }}>⋮⋮</span>
                                      <span
                                        style={{
                                          fontSize: "0.72rem",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: 999,
                                          border: "1px solid var(--border)",
                                          color: "var(--muted)",
                                          flexShrink: 0,
                                        }}
                                      >
                                        {pill}
                                      </span>
                                      <span style={{ fontSize: "0.9rem" }}>
                                        {label} <span style={{ color: "var(--muted)" }}>({raw})</span>
                                      </span>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>

                      </div>
                    )}

                    {addType === "kpi_bar_chart" && addChartMode === "multi_line_items" && (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Source</label>
                          <select
                            value={addMultiLineFieldKey}
                            onChange={(e) => setAddMultiLineFieldKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">Select…</option>
                            {addMultiLineFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.name} ({f.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Aggregate</label>
                          <select
                            value={addAggFn}
                            onChange={(e) => setAddAggFn(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            disabled={!addMultiLineFieldKey}
                          >
                            <option value="count_rows">Count rows</option>
                            <option value="sum">Sum</option>
                            <option value="avg">Average</option>
                          </select>
                        </div>
                        {(addAggFn === "sum" || addAggFn === "avg") && (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Value</label>
                            <select
                              value={addValueSubFieldKey}
                              onChange={(e) => setAddValueSubFieldKey(e.target.value)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            >
                              <option value="">Select numeric…</option>
                              {numericSubFields.map((sf) => (
                                <option key={sf.key} value={sf.key}>
                                  {sf.name} ({sf.key})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Group by</label>
                          <select
                            value={addGroupBySubFieldKey}
                            onChange={(e) => setAddGroupBySubFieldKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">Select…</option>
                            {selectedMultiLineSubFields.map((sf) => (
                              <option key={sf.key} value={sf.key}>
                                {sf.name} ({sf.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <label style={{ fontSize: "0.88rem", fontWeight: 600 }}>Normal Dashboard Filters</label>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                const available = selectedMultiLineSubFields.find(
                                  (sf) => !addFilterSubFieldKeys.includes(sf.key) && sf.key !== addGroupBySubFieldKey
                                );
                                if (available) {
                                  const nextKeys = [...addFilterSubFieldKeys, available.key];
                                  setAddFilterSubFieldKeys(nextKeys);
                                  setAddFilterSubFieldKey(nextKeys[0]);
                                } else if (selectedMultiLineSubFields.length > 0) {
                                  const nextKeys = [...addFilterSubFieldKeys, selectedMultiLineSubFields[0].key];
                                  setAddFilterSubFieldKeys(nextKeys);
                                  setAddFilterSubFieldKey(nextKeys[0]);
                                }
                              }}
                              style={{ fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}
                            >
                              + Add Filter Column
                            </button>
                          </div>
                          
                          {addFilterSubFieldKeys.length === 0 ? (
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Filter Column</label>
                              <select
                                value={addFilterSubFieldKey}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setAddFilterSubFieldKey(next);
                                  if (next) {
                                    setAddFilterSubFieldKeys([next]);
                                  } else {
                                    setAddFilterSubFieldKeys([]);
                                    setAddFilterLabel("");
                                  }
                                }}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.85rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              >
                                <option value="">None (No normal filter)</option>
                                {selectedMultiLineSubFields.map((sf) => (
                                  <option key={sf.key} value={sf.key}>
                                    {sf.name} ({sf.key})
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div style={{ display: "grid", gap: "0.5rem" }}>
                              {addFilterSubFieldKeys.map((k, idx) => (
                                <div key={`${k}_${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.4rem", alignItems: "center", background: "var(--surface)", padding: "0.4rem", borderRadius: "6px", border: "1px solid var(--border)" }}>
                                  <select
                                    value={k}
                                    onChange={(e) => {
                                      const nextKeys = [...addFilterSubFieldKeys];
                                      nextKeys[idx] = e.target.value;
                                      setAddFilterSubFieldKeys(nextKeys);
                                      setAddFilterSubFieldKey(nextKeys[0]);
                                    }}
                                    style={{ padding: "0.3rem 0.45rem", fontSize: "0.82rem", width: "100%" }}
                                  >
                                    {selectedMultiLineSubFields.map((sf) => (
                                      <option key={sf.key} value={sf.key}>
                                        {sf.name} ({sf.key})
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    placeholder="Button label override..."
                                    value={addFilterLabels[k] || ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setAddFilterLabels(prev => ({ ...prev, [k]: val }));
                                    }}
                                    style={{ padding: "0.3rem 0.45rem", fontSize: "0.82rem", width: "100%" }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextKeys = addFilterSubFieldKeys.filter((_, i) => i !== idx);
                                      setAddFilterSubFieldKeys(nextKeys);
                                      setAddFilterSubFieldKey(nextKeys[0] || "");
                                    }}
                                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "1rem", padding: "0 0.3rem" }}
                                    title="Remove filter"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {isSuperAdminRole(userRole) && addMultiLineFieldKey.trim() && selectedMultiLineSubFields.length > 0 ? (
                          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
                            <div style={{ fontSize: "0.85rem", fontWeight: 650, marginBottom: "0.5rem" }}>Advanced filters</div>
                            <MultiLineReportFilterPanel
                              organizationId={dashboard?.organization_id ?? 0}
                              token={token ?? null}
                              fieldKey={addMultiLineFieldKey.trim()}
                              subFields={selectedMultiLineSubFields as unknown as MultiFilterSubField[]}
                              value={addAdvancedFilters}
                              onChange={setAddAdvancedFilters}
                            />
                          </div>
                        ) : null}
                      </div>
                    )}

                    {addType === "kpi_trend" && addTrendMode === "multi_line_items" && (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Source</label>
                          <select
                            value={addMultiLineFieldKey}
                            onChange={(e) => setAddMultiLineFieldKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">Select…</option>
                            {addMultiLineFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.name} ({f.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Aggregate</label>
                          <select
                            value={addAggFn}
                            onChange={(e) => setAddAggFn(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            disabled={!addMultiLineFieldKey}
                          >
                            <option value="count_rows">Count rows</option>
                            <option value="sum">Sum</option>
                            <option value="avg">Average</option>
                          </select>
                        </div>
                        {(addAggFn === "sum" || addAggFn === "avg") && (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Value</label>
                            <select
                              value={addValueSubFieldKey}
                              onChange={(e) => setAddValueSubFieldKey(e.target.value)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            >
                              <option value="">Select numeric…</option>
                              {numericSubFields.map((sf) => (
                                <option key={sf.key} value={sf.key}>
                                  {sf.name} ({sf.key})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Group by</label>
                          <select
                            value={addGroupBySubFieldKey}
                            onChange={(e) => setAddGroupBySubFieldKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">Select…</option>
                            {selectedMultiLineSubFields.map((sf) => (
                              <option key={sf.key} value={sf.key}>
                                {sf.name} ({sf.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <label style={{ fontSize: "0.88rem", fontWeight: 600 }}>Normal Dashboard Filters</label>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                const available = selectedMultiLineSubFields.find(
                                  (sf) => !addFilterSubFieldKeys.includes(sf.key) && sf.key !== addGroupBySubFieldKey
                                );
                                if (available) {
                                  const nextKeys = [...addFilterSubFieldKeys, available.key];
                                  setAddFilterSubFieldKeys(nextKeys);
                                  setAddFilterSubFieldKey(nextKeys[0]);
                                } else if (selectedMultiLineSubFields.length > 0) {
                                  const nextKeys = [...addFilterSubFieldKeys, selectedMultiLineSubFields[0].key];
                                  setAddFilterSubFieldKeys(nextKeys);
                                  setAddFilterSubFieldKey(nextKeys[0]);
                                }
                              }}
                              style={{ fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}
                            >
                              + Add Filter Column
                            </button>
                          </div>
                          
                          {addFilterSubFieldKeys.length === 0 ? (
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Filter Column</label>
                              <select
                                value={addFilterSubFieldKey}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setAddFilterSubFieldKey(next);
                                  if (next) {
                                    setAddFilterSubFieldKeys([next]);
                                  } else {
                                    setAddFilterSubFieldKeys([]);
                                    setAddFilterLabel("");
                                  }
                                }}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.85rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              >
                                <option value="">None (No normal filter)</option>
                                {selectedMultiLineSubFields.map((sf) => (
                                  <option key={sf.key} value={sf.key}>
                                    {sf.name} ({sf.key})
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div style={{ display: "grid", gap: "0.5rem" }}>
                              {addFilterSubFieldKeys.map((k, idx) => (
                                <div key={`${k}_${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.4rem", alignItems: "center", background: "var(--surface)", padding: "0.4rem", borderRadius: "6px", border: "1px solid var(--border)" }}>
                                  <select
                                    value={k}
                                    onChange={(e) => {
                                      const nextKeys = [...addFilterSubFieldKeys];
                                      nextKeys[idx] = e.target.value;
                                      setAddFilterSubFieldKeys(nextKeys);
                                      setAddFilterSubFieldKey(nextKeys[0]);
                                    }}
                                    style={{ padding: "0.3rem 0.45rem", fontSize: "0.82rem", width: "100%" }}
                                  >
                                    {selectedMultiLineSubFields.map((sf) => (
                                      <option key={sf.key} value={sf.key}>
                                        {sf.name} ({sf.key})
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    placeholder="Button label override..."
                                    value={addFilterLabels[k] || ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setAddFilterLabels(prev => ({ ...prev, [k]: val }));
                                    }}
                                    style={{ padding: "0.3rem 0.45rem", fontSize: "0.82rem", width: "100%" }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextKeys = addFilterSubFieldKeys.filter((_, i) => i !== idx);
                                      setAddFilterSubFieldKeys(nextKeys);
                                      setAddFilterSubFieldKey(nextKeys[0] || "");
                                    }}
                                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "1rem", padding: "0 0.3rem" }}
                                    title="Remove filter"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {isSuperAdminRole(userRole) && addMultiLineFieldKey.trim() && selectedMultiLineSubFields.length > 0 ? (
                          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
                            <div style={{ fontSize: "0.85rem", fontWeight: 650, marginBottom: "0.5rem" }}>Advanced filters</div>
                            <MultiLineReportFilterPanel
                              organizationId={dashboard?.organization_id ?? 0}
                              token={token ?? null}
                              fieldKey={addMultiLineFieldKey.trim()}
                              subFields={selectedMultiLineSubFields as unknown as MultiFilterSubField[]}
                              value={addAdvancedFilters}
                              onChange={setAddAdvancedFilters}
                            />
                          </div>
                        ) : null}
                      </div>
                    )}

                    {addType !== "kpi_table" &&
                      addType !== "kpi_bar_chart" &&
                      addType !== "kpi_trend" &&
                      addType !== "kpi_multi_line_table" &&
                      addType !== "kpi_card_single_value" &&
                      addType !== "text" && (
                      <div className="card" style={{ padding: "0.9rem" }}>
                        <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>No extra options</div>
                        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>This widget type doesn’t have additional options.</div>
                      </div>
                    )}

                    {addType === "kpi_card_single_value" && (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Value source</label>
                          <select
                            value={addCardSourceMode}
                            onChange={(e) => setAddCardSourceMode(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="field">Formula/field</option>
                            <option value="multi_line_agg">Multi-line aggregation</option>
                            <option value="static">Static/manual</option>
                          </select>
                        </div>

                        {addCardSourceMode === "static" && (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Static value</label>
                            <input value={addCardStaticValue} onChange={(e) => setAddCardStaticValue(e.target.value)} style={{ padding: "0.35rem 0.45rem" }} />
                          </div>
                        )}

                        {addCardSourceMode === "field" && (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field</label>
                            <select value={addFieldKey} onChange={(e) => setAddFieldKey(e.target.value)} style={{ padding: "0.35rem 0.45rem" }}>
                              <option value="">Select…</option>
                              {addFields.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.name} ({f.key})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {addCardSourceMode === "multi_line_agg" && (
                          <div style={{ display: "grid", gap: "0.6rem" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Source</label>
                              <select value={addMultiLineFieldKey} onChange={(e) => setAddMultiLineFieldKey(e.target.value)} style={{ padding: "0.35rem 0.45rem" }}>
                                <option value="">Select…</option>
                                {addMultiLineFields.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.name} ({f.key})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Aggregation</label>
                              <select
                                value={addCardAgg}
                                onChange={(e) => setAddCardAgg(e.target.value as KpiCardAgg)}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              >
                                <option value="count">Count rows</option>
                                <option value="sum">Sum</option>
                                <option value="avg">Average</option>
                                <option value="min">Minimum</option>
                                <option value="max">Maximum</option>
                              </select>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                                {addCardAgg === "count" ? "Sub-field (optional)" : "Numeric sub-field"}
                              </label>
                              <select
                                value={addValueSubFieldKey}
                                onChange={(e) => setAddValueSubFieldKey(e.target.value)}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                disabled={addCardAgg === "count"}
                              >
                                <option value="">Select…</option>
                                {selectedMultiLineSubFields.map((sf) => (
                                  <option key={sf.key} value={sf.key}>
                                    {sf.name} ({sf.key})
                                  </option>
                                ))}
                              </select>
                            </div>
                            {addCardAgg === "count" ? (
                              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
                                Count shows how many rows are in the multi-line list. Pick a sub-field only if you use Sum, Average, Min, or Max.
                              </p>
                            ) : null}
                          </div>
                        )}

                        {isSuperAdminRole(userRole) && addCardSourceMode === "multi_line_agg" && addMultiLineFieldKey.trim() && selectedMultiLineSubFields.length > 0 ? (
                          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
                            <div style={{ fontSize: "0.85rem", fontWeight: 650, marginBottom: "0.5rem" }}>Advanced filters</div>
                            <MultiLineReportFilterPanel
                              organizationId={dashboard?.organization_id ?? 0}
                              token={token ?? null}
                              fieldKey={addMultiLineFieldKey.trim()}
                              subFields={selectedMultiLineSubFields as unknown as MultiFilterSubField[]}
                              value={addAdvancedFilters}
                              onChange={setAddAdvancedFilters}
                            />
                          </div>
                        ) : null}

                        <div style={{ height: 1, background: "var(--border)" }} />
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Subtitle</label>
                          <input value={addCardSubtitle} onChange={(e) => setAddCardSubtitle(e.target.value)} style={{ padding: "0.35rem 0.45rem" }} placeholder="Optional" />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                          <div style={{ display: "grid", gap: "0.25rem" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Prefix</label>
                            <input value={addCardPrefix} onChange={(e) => setAddCardPrefix(e.target.value)} style={{ padding: "0.35rem 0.45rem" }} placeholder="e.g. PKR " />
                          </div>
                          <div style={{ display: "grid", gap: "0.25rem" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Suffix</label>
                            <input value={addCardSuffix} onChange={(e) => setAddCardSuffix(e.target.value)} style={{ padding: "0.35rem 0.45rem" }} placeholder="e.g. %" />
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                          <div style={{ display: "grid", gap: "0.25rem" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Decimals</label>
                            <input type="number" value={addCardDecimals} onChange={(e) => setAddCardDecimals(Number(e.target.value))} style={{ padding: "0.35rem 0.45rem" }} />
                          </div>
                          <div style={{ display: "grid", gap: "0.25rem" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Alignment</label>
                            <select value={addCardAlign} onChange={(e) => setAddCardAlign(e.target.value as any)} style={{ padding: "0.35rem 0.45rem" }}>
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </select>
                          </div>
                        </div>
                        <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                          <input type="checkbox" checked={addCardThousandSep} onChange={(e) => setAddCardThousandSep(e.target.checked)} />
                          Thousand separators
                        </label>

                        <div style={{ height: 1, background: "var(--border)" }} />
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Theme</label>
                          <select value={addCardTheme} onChange={(e) => setAddCardTheme(e.target.value)} style={{ padding: "0.35rem 0.45rem" }}>
                            <option value="success_light">Light Green / White</option>
                            <option value="success_dark">Dark Green / White</option>
                            <option value="info_light">Light Blue / White</option>
                            <option value="info_dark">Dark Blue / White</option>
                            <option value="alert_light">Light Red / White</option>
                            <option value="warning_orange">Orange / White</option>
                            <option value="neutral_grey_dark">Grey / White</option>
                            <option value="neutral_grey_light">Grey / Black</option>
                            <option value="minimal_white">White / Dark</option>
                            <option value="grad_blue_purple">Gradient Blue → Purple</option>
                            <option value="grad_green_teal">Gradient Green → Teal</option>
                          </select>
                        </div>
                        <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                          <input type="checkbox" checked={addCardAllowCustomColors} onChange={(e) => setAddCardAllowCustomColors(e.target.checked)} />
                          Allow custom colors
                        </label>
                        {addCardAllowCustomColors && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Background</label>
                              <input value={addCardBgColor} onChange={(e) => setAddCardBgColor(e.target.value)} style={{ padding: "0.35rem 0.45rem" }} placeholder="#22c55e or linear-gradient(...)" />
                            </div>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Text color</label>
                              <input value={addCardFgColor} onChange={(e) => setAddCardFgColor(e.target.value)} style={{ padding: "0.35rem 0.45rem" }} placeholder="#ffffff" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
