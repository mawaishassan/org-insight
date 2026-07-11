"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAccessToken, clearTokens } from "@/lib/auth";
import {
  api,
  formatElapsedClockSec,
  formatElapsedMs,
  getApiUrl,
  openKpiStoredFileInNewTab,
  postFormDataWithUploadProgress,
} from "@/lib/api";
import { getAttachmentDisplayName, getAttachmentUrl } from "@/lib/attachmentCellValue";
import { downloadBlob } from "@/lib/download";
import toast from "react-hot-toast";
import type { Widget } from "@/app/dashboard/dashboards/[id]/widgets";
import {
  buildMultiItemsApiRequestExample,
  buildMultiItemsApiResponseExamplePreferActual,
  stringifyApiExample,
} from "@/lib/multiItemsApiExample";

import {
  SubField,
  FieldSummary,
  MultiFilterConditionRow,
  isReferenceLikeFieldType,
  getNextSourceKpiIdForPath,
  getFieldTypeAtPath,
  computeChainKpiIds,
  pathsForChainComputation,
  shouldOmitReferenceResolution,
  terminalRefAllowedValuesKey,
  parseComparePath,
  defaultReferenceComparePath,
  emptyMultiFilterRow,
  rrToPathStrings,
  payloadToFilterDraft,
  filterDraftToPayload,
  removeConditionFromPayload,
  buildReferenceAttributeOptions,
  formatComparePathLabel,
  appliedReferencePathsForChip,
  MULTI_ITEM_WHERE_OPS,
  operatorsForMultiItemSubField,
  MultiItemsFilterPayloadV2,
} from "@/lib/multiItemsFiltersHelper";

import MultiItemsAdvancedFiltersPanel from "@/components/MultiItemsAdvancedFiltersPanel";

function asWidgets(layout: any): Widget[] {
  if (!layout) return [];
  if (Array.isArray(layout)) return layout as Widget[];
  if (typeof layout === "object" && Array.isArray((layout as any).widgets)) return (layout as any).widgets as Widget[];
  return [];
}

function truncateLabel(label: string, max = 48): string {
  const s = String(label ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Strip characters invalid in Windows/Excel filenames and trim whitespace (does not touch extension or internal spaces). */
function sanitizeFileNameInput(name: string): string {
  return String(name ?? "").replace(/[\\/:*?"<>|]+/g, "").trim();
}

/** Default export file name base (no extension) from the Multi Line Item's own name, e.g. "Research Publications" -> "Research_Publications_2026". */
function defaultExportFileNameBase(multiLineItemName: string, year: number): string {
  const cleaned = sanitizeFileNameInput(multiLineItemName).replace(/\s+/g, "_");
  return `${cleaned || "Export"}_${year}`;
}

/** Resolve the final file name from user input for the given export format: sanitize, fall back
 * to the default when empty, ensure the correct extension is present exactly once. */
function resolveExportFileName(input: string, defaultBase: string, ext: "xlsx" | "pdf"): string {
  let base = sanitizeFileNameInput(input);
  if (!base) base = defaultBase;
  const suffix = `.${ext}`;
  if (!base.toLowerCase().endsWith(suffix)) base = `${base}${suffix}`;
  return base;
}

const DEFAULT_PDF_HEADER_COLOR = "#2563eb";

/** Max columns a PDF export can hold before it's considered unreadable (mirrored server-side in
 * entries/routes.py's export endpoint as a defense-in-depth check with the same value). */
const MAX_PDF_COLUMNS = 10;

const PDF_TOO_MANY_COLUMNS_MESSAGE =
  "You have selected too many columns for a readable PDF. Please deselect some columns before exporting.";

const PDF_HEADER_COLOR_PRESETS: { name: string; value: string }[] = [
  { name: "Blue", value: "#2563eb" },
  { name: "Green", value: "#16a34a" },
  { name: "Gray", value: "#4b5563" },
  { name: "Black", value: "#111827" },
  { name: "Purple", value: "#7c3aed" },
];

/** Black or white text for readable contrast against a hex background — mirrors the backend's
 * _contrasting_text_color() heuristic exactly, so the dialog preview matches the actual PDF. */
function contrastTextColor(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "#ffffff";
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 0.6 ? "#ffffff" : "#000000";
}

interface MultiItemsRow {
  index: number;
  data: Record<string, unknown>;
  can_edit?: boolean;
  can_delete?: boolean;
}

interface MultiItemsListResponse {
  total: number;
  page: number;
  page_size: number;
  rows: MultiItemsRow[];
  sub_fields: SubField[];
}



interface RowAccessUser {
  user_id: number;
  full_name: string | null;
  username: string;
  can_edit: boolean;
  can_delete: boolean;
}

export default function FullPageMultiItems() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const kpiId = Number(params.kpiId);
  const year = Number(params.year);
  const fieldId = Number(params.fieldId);
  const organizationIdFromUrl = searchParams.get("organization_id");
  const periodKey = searchParams.get("period_key") || "";
  const dashboardIdFromUrl = searchParams.get("dashboard_id");
  const widgetIdFromUrl = searchParams.get("widget_id");
  const colsFromUrl = searchParams.get("cols");
  const filtersFromUrl = searchParams.get("filters");

  const token = getAccessToken();

  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const [kpiName, setKpiName] = useState<string>("");
  const [field, setField] = useState<FieldSummary | null>(null);
  const [dashboardName, setDashboardName] = useState<string>("");
  const [dashboardWidgetTitle, setDashboardWidgetTitle] = useState<string>("");
  const [entryId, setEntryId] = useState<number | null>(null);
  const [rows, setRows] = useState<MultiItemsRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Search UX: allow typing without hammering the API; apply only on Enter (or when cleared).
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [showEditableOnly, setShowEditableOnly] = useState(false);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [uploadOption, setUploadOption] = useState<"append" | "override" | "upsert" | null>(null);
  const [upsertMatchSubFieldKey, setUpsertMatchSubFieldKey] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgressHint, setUploadProgressHint] = useState<string | null>(null);
  const [uploadElapsedClock, setUploadElapsedClock] = useState<string | null>(null);
  const bulkUploadTickRef = useRef<number | null>(null);

  const pageBusy = exportingCsv || exportingXlsx || exportingPdf || downloadingTemplate || loading || uploading || saving;
  const busyLabel = exportingCsv
    ? "Exporting CSV…"
    : exportingXlsx
      ? "Exporting Excel…"
    : exportingPdf
      ? "Exporting PDF…"
    : downloadingTemplate
      ? "Downloading template…"
    : uploading
      ? "Uploading…"
      : saving
        ? "Saving…"
        : loading
          ? "Loading…"
          : null;
  const parsedFiltersFromUrl = useMemo(() => {
    if (!filtersFromUrl) return null;
    try {
      const parsed = JSON.parse(filtersFromUrl) as MultiItemsFilterPayloadV2;
      return parsed && Array.isArray((parsed as any).conditions) ? parsed : null;
    } catch {
      return null;
    }
  }, [filtersFromUrl]);

  const [appliedFilter, setAppliedFilter] = useState<MultiItemsFilterPayloadV2 | null>(() => parsedFiltersFromUrl);
  const [filterDraft, setFilterDraft] = useState<MultiFilterConditionRow[]>(() =>
    payloadToFilterDraft(parsedFiltersFromUrl)
  );

  useEffect(() => {
    // If filters are provided via URL (e.g. from a dashboard widget), use them as the initial applied filter.
    if (!parsedFiltersFromUrl) return;
    setAppliedFilter(parsedFiltersFromUrl);
    setFilterDraft(payloadToFilterDraft(parsedFiltersFromUrl));
  }, [parsedFiltersFromUrl]);
  const [refFilterOptions, setRefFilterOptions] = useState<Record<string, string[]>>({});
  const [sourceKpiFieldsById, setSourceKpiFieldsById] = useState<Record<number, FieldSummary[]>>({});
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkChannel, setBulkChannel] = useState<"excel" | "api" | "odoo" | "previous_year" | null>(null);
  const [importCapabilities, setImportCapabilities] = useState<{
    channels: string[];
    odoo_ready: boolean;
    odoo_org_configured?: boolean;
    odoo_kpi_configured?: boolean;
    odoo_blockers?: string[];
    import_channel?: string;
  } | null>(null);
  const [importFromYear, setImportFromYear] = useState<number>(() => {
    const y = new Date().getFullYear();
    return y - 1;
  });
  const [availableSourceYears, setAvailableSourceYears] = useState<number[]>([]);
  const [availableSourceYearsLoading, setAvailableSourceYearsLoading] = useState(false);
  const [availableSourceYearsError, setAvailableSourceYearsError] = useState<string | null>(null);
  const [apiUrlOverride, setApiUrlOverride] = useState<string>("");
  const [showApiExampleJson, setShowApiExampleJson] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showColumnsPopup, setShowColumnsPopup] = useState(false);
  const [columnsPopupSearch, setColumnsPopupSearch] = useState("");
  const [columnsPopupDraft, setColumnsPopupDraft] = useState<string[]>([]);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "pdf">("xlsx");
  const [exportMode, setExportMode] = useState<"all" | "selected">("all");
  const [exportSelectedKeys, setExportSelectedKeys] = useState<string[]>([]);
  const [exportColumnsSearch, setExportColumnsSearch] = useState("");
  const [exportFileName, setExportFileName] = useState("");
  const [pdfHeaderColor, setPdfHeaderColor] = useState(DEFAULT_PDF_HEADER_COLOR);
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfSubtitle, setPdfSubtitle] = useState("");
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [maxAutoColumns, setMaxAutoColumns] = useState<number>(5);
  const [manualColumnsMode, setManualColumnsMode] = useState(false);
  const [canEditKpi, setCanEditKpi] = useState<boolean>(true);
  const [kpiLevelCanEdit, setKpiLevelCanEdit] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [canAddRow, setCanAddRow] = useState<boolean>(false);
  const [canExport, setCanExport] = useState<boolean>(false);
  const [rowAccessModal, setRowAccessModal] = useState<{ rowIndex: number; preview: string } | null>(null);
  const [rowAccessUsers, setRowAccessUsers] = useState<RowAccessUser[]>([]);
  const [rowAccessAssignments, setRowAccessAssignments] = useState<{ id: number; full_name: string | null; username: string }[]>([]);
  const [rowAccessAddUserId, setRowAccessAddUserId] = useState<number | null>(null);
  const [rowAccessAddAccess, setRowAccessAddAccess] = useState<"view" | "edit" | "edit_delete">("edit_delete");
  const [rowAccessSaving, setRowAccessSaving] = useState(false);
  const [rowAccessUserSearch, setRowAccessUserSearch] = useState("");
  const [includeExistingRowsInTemplate, setIncludeExistingRowsInTemplate] = useState(true);

  /** Ignore stale API responses when year/org/field changes quickly (fixes missing rows / wrong permissions UI). */
  const multiPageContextLoadGenRef = useRef(0);
  const multiPageRowsLoadGenRef = useRef(0);
  const rowsCacheRef = useRef(new Map<string, { rows: MultiItemsRow[]; total: number }>());
  const entryIdLiveRef = useRef<number | null>(null);

  const isAdmin = userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN";
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  const canManageRowAccess = isAdmin;
  const canAddRowEffective = canAddRow || isAdmin;
  const canExportEffective = canExport || isAdmin;

  const effectiveOrgId = useMemo(
    () => (organizationIdFromUrl ? Number(organizationIdFromUrl) : meOrgId ?? undefined),
    [organizationIdFromUrl, meOrgId]
  );

  const cameFromDashboard = dashboardIdFromUrl != null && String(dashboardIdFromUrl).trim() !== "";
  const dashboardId = cameFromDashboard ? Number(dashboardIdFromUrl) : null;
  const baseQueryParams = useMemo(() => {
    const q = new URLSearchParams();
    if (effectiveOrgId != null) q.set("organization_id", String(effectiveOrgId));
    if (periodKey) q.set("period_key", periodKey);
    if (cameFromDashboard && dashboardId != null && Number.isFinite(dashboardId)) q.set("dashboard_id", String(dashboardId));
    if (cameFromDashboard && widgetIdFromUrl) q.set("widget_id", String(widgetIdFromUrl));
    if (cameFromDashboard && filtersFromUrl) q.set("filters", String(filtersFromUrl));
    return q;
  }, [effectiveOrgId, periodKey, cameFromDashboard, dashboardIdFromUrl, widgetIdFromUrl, filtersFromUrl]);

  useEffect(() => {
    if (!token) return;
    if (!cameFromDashboard) {
      setDashboardName("");
      setDashboardWidgetTitle("");
      return;
    }
    if (dashboardId == null || !Number.isFinite(dashboardId)) return;
    const q = new URLSearchParams();
    if (effectiveOrgId != null) q.set("organization_id", String(effectiveOrgId));
    api<{ name: string; layout?: any }>(`/dashboards/${dashboardId}?${q.toString()}`, { token })
      .then((d) => {
        setDashboardName(d?.name || "Dashboard");
        const wid = widgetIdFromUrl ? String(widgetIdFromUrl) : "";
        const ws = asWidgets((d as any)?.layout);
        const w = wid ? ws.find((x) => String((x as any)?.id) === wid) : null;
        setDashboardWidgetTitle(String((w as any)?.title || "").trim());
      })
      .catch(() => {
        setDashboardName("Dashboard");
        setDashboardWidgetTitle("");
      });
  }, [token, cameFromDashboard, dashboardId, effectiveOrgId, widgetIdFromUrl]);

  useEffect(() => {
    entryIdLiveRef.current = entryId;
  }, [entryId]);

  // If token is missing/cleared (e.g. expired), send user to login
  useEffect(() => {
    if (!token) {
      clearTokens();
      router.push("/login");
    }
  }, [token, router]);

  useEffect(() => {
    if (!token) return;
    api<{ organization_id: number | null; role?: string | { value?: string } }>("/auth/me", { token })
      .then((me) => {
        setMeOrgId(me.organization_id ?? null);
        const r = me.role;
        setUserRole(typeof r === "string" ? r : r?.value ?? null);
      })
      .catch(() => setMeOrgId(null));
  }, [token]);

  useEffect(() => {
    if (!token || effectiveOrgId == null || !fieldId || !kpiId) return;
    api<{ channels: string[]; odoo_ready: boolean; odoo_org_configured?: boolean; odoo_kpi_configured?: boolean; odoo_blockers?: string[]; import_channel?: string }>(
      `/entries/multi-items/import-capabilities?${new URLSearchParams({
        field_id: String(fieldId),
        kpi_id: String(kpiId),
        organization_id: String(effectiveOrgId),
      }).toString()}`,
      { token }
    )
      .then((c) => {
        setImportCapabilities(c);
        const ch = (field?.config as { multi_items_import_channel?: string } | undefined)?.multi_items_import_channel;
        if (ch === "odoo" && c.odoo_ready) setBulkChannel("odoo");
        else if (ch === "api") setBulkChannel("api");
      })
      .catch(() => setImportCapabilities(null));
  }, [token, effectiveOrgId, fieldId, kpiId, field?.config]);

  const loadContext = async () => {
    if (!token || !kpiId || effectiveOrgId == null || !fieldId) return;
    const loadId = ++multiPageContextLoadGenRef.current;
    setError(null);
    try {
      const ctx = await api<{
        entry_id: number;
        kpi_id: number;
        kpi_name: string;
        field: FieldSummary;
        can_edit: boolean;
        kpi_level_can_edit: boolean;
        can_add_row: boolean;
        can_export: boolean;
      }>(
        `/entries/multi-items/page-context?${new URLSearchParams({
          kpi_id: String(kpiId),
          year: String(year),
          period_key: periodKey || "",
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      );
      if (loadId !== multiPageContextLoadGenRef.current) return;
      setKpiName(ctx?.kpi_name || "");
      setField(ctx?.field ?? null);
      // Initialize sort before entry_id triggers first rows load to avoid a duplicate fetch.
      if (sortBy === null && ctx?.field?.sub_fields?.length) {
        setSortBy(ctx.field.sub_fields[0].key);
      }
      setEntryId(ctx.entry_id);
      setCanEditKpi(ctx?.can_edit !== false);
      setKpiLevelCanEdit(ctx?.kpi_level_can_edit === true);
      setCanAddRow(ctx?.can_add_row === true);
      setCanExport(ctx?.can_export === true);
    } catch (e) {
      if (loadId === multiPageContextLoadGenRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load context");
      }
    }
  };

  const loadRows = async (opts?: { force?: boolean }) => {
    if (!token || !entryId || !fieldId || effectiveOrgId == null) return;
    const entryIdForThisFetch = entryId;
    const buildRowsQueryParams = (targetPage: number) => {
      const params = new URLSearchParams({
        entry_id: String(entryIdForThisFetch),
        field_id: String(fieldId),
        organization_id: String(effectiveOrgId),
        page: String(targetPage),
        page_size: String(pageSize),
        sort_dir: sortDir,
      });
      if (appliedSearch.trim()) params.set("search", appliedSearch.trim());
      if (sortBy) params.set("sort_by", sortBy);
      if (showEditableOnly) params.set("editable_only", "true");
      if (appliedFilter && appliedFilter.conditions.length > 0) {
        params.set("filters", JSON.stringify(appliedFilter));
      }
      return params;
    };

    const cacheKey = buildRowsQueryParams(page).toString();
    const cached = rowsCacheRef.current.get(cacheKey);
    if (!opts?.force && cached) {
      setRows(cached.rows);
      setTotal(cached.total);
      setLoading(false);
      return;
    }

    const rowLoadId = ++multiPageRowsLoadGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = buildRowsQueryParams(page);
      const res = await api<MultiItemsListResponse>(`/entries/multi-items/rows?${params.toString()}`, { token });
      if (
        rowLoadId !== multiPageRowsLoadGenRef.current ||
        entryIdForThisFetch !== entryIdLiveRef.current
      ) {
        return;
      }
      setRows(res.rows);
      setTotal(res.total);
      rowsCacheRef.current.set(params.toString(), { rows: res.rows, total: res.total });
      if (res.sub_fields && (!field || !field.sub_fields)) {
        setField((prev) => (prev ? { ...prev, sub_fields: res.sub_fields } : prev));
      }

      // Prefetch next page (optional): improves paging performance without loading full dataset.
      const totalCount = Number(res.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)));
      const nextPage = page + 1;
      if (nextPage <= totalPages) {
        const nextParams = buildRowsQueryParams(nextPage);
        const nextKey = nextParams.toString();
        if (!rowsCacheRef.current.has(nextKey)) {
          void api<MultiItemsListResponse>(`/entries/multi-items/rows?${nextKey}`, { token })
            .then((r) => {
              // Don't touch UI state; only cache if still relevant.
              if (entryIdForThisFetch !== entryIdLiveRef.current) return;
              rowsCacheRef.current.set(nextKey, { rows: r.rows, total: Number(r.total ?? totalCount) });
            })
            .catch(() => undefined);
        }
      }
    } catch (e) {
      if (rowLoadId === multiPageRowsLoadGenRef.current && entryIdForThisFetch === entryIdLiveRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load rows");
      }
    } finally {
      if (rowLoadId === multiPageRowsLoadGenRef.current && entryIdForThisFetch === entryIdLiveRef.current) {
        setLoading(false);
      }
    }
  };

  const refreshRows = async () => {
    rowsCacheRef.current.clear();
    await loadRows({ force: true });
  };

  /** Same search/sort/filter params sent to /multi-items/rows (the grid), plus column
   * selection/order, so exports contain exactly what's currently displayed. No page/page_size:
   * export always covers every filtered row, not just the current page.
   * `columnKeys` (when provided) overrides the default "all columns currently in the grid"
   * set — used by the Export Options dialog's "Selected columns" mode.
   * `fileName` (when provided) is sent as the desired download name (Export Options dialog).
   * `headerColor`/`pdfTitle`/`pdfSubtitle` (PDF only) apply to this export only — none of them
   * are persisted anywhere, matching "does not modify any application settings". */
  const buildExportQueryParams = (
    format: "csv" | "xlsx" | "pdf",
    columnKeys?: string[],
    fileName?: string,
    headerColor?: string,
    pdfTitleParam?: string,
    pdfSubtitleParam?: string
  ) => {
    const params = new URLSearchParams({
      entry_id: String(entryId),
      field_id: String(fieldId),
      organization_id: String(effectiveOrgId ?? ""),
      sort_dir: sortDir,
      format,
    });
    if (appliedSearch.trim()) params.set("search", appliedSearch.trim());
    if (sortBy) params.set("sort_by", sortBy);
    if (appliedFilter && appliedFilter.conditions.length > 0) {
      params.set("filters", JSON.stringify(appliedFilter));
    }
    const cols = columnKeys ?? gridOrderedVisibleKeys;
    if (cols.length > 0) params.set("columns", cols.join(","));
    if (fileName && fileName.trim()) params.set("filename", fileName.trim());
    if (format === "pdf" && headerColor) params.set("pdf_header_color", headerColor);
    if (format === "pdf" && pdfTitleParam && pdfTitleParam.trim()) params.set("pdf_title", pdfTitleParam.trim());
    if (format === "pdf" && pdfSubtitleParam && pdfSubtitleParam.trim()) {
      params.set("pdf_subtitle", pdfSubtitleParam.trim());
    }
    return params;
  };

  const runExport = async (
    format: "csv" | "xlsx" | "pdf",
    columnKeys?: string[],
    fileName?: string,
    headerColor?: string,
    pdfTitleParam?: string,
    pdfSubtitleParam?: string
  ) => {
    if (!token || !entryId || !fieldId || effectiveOrgId == null) return;
    const setBusy = format === "xlsx" ? setExportingXlsx : format === "pdf" ? setExportingPdf : setExportingCsv;
    setBusy(true);
    try {
      const params = buildExportQueryParams(format, columnKeys, fileName, headerColor, pdfTitleParam, pdfSubtitleParam);
      const url = getApiUrl(`/entries/multi-items/export?${params.toString()}`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        clearTokens();
        toast.error("Session expired. Please log in again.");
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        toast.error("You don't have permission to export this data.");
        return;
      }
      if (!res.ok) {
        toast.error("Export failed");
        return;
      }
      const blob = await res.blob();
      // The backend echoes the same resolved name via Content-Disposition, but that header
      // isn't readable client-side across the cross-origin dev API (no CORS expose_headers) —
      // use the name we already resolved and sent, so the saved file always matches it exactly.
      const downloadName = fileName && fileName.trim() ? fileName.trim() : `multi_items_${fieldId}_${year}.${format}`;
      downloadBlob(blob, downloadName);
      const formatLabel = format === "xlsx" ? "Excel" : format === "pdf" ? "PDF" : "CSV";
      toast.success(`${formatLabel} file downloaded`);
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token || effectiveOrgId == null) return;
    loadContext().catch(() => undefined);
    return () => {
      multiPageContextLoadGenRef.current += 1;
      multiPageRowsLoadGenRef.current += 1;
    };
  }, [token, kpiId, year, effectiveOrgId, fieldId, periodKey]);

  // When the underlying query changes (KPI/field/org/year/period), drop cached pages.
  useEffect(() => {
    rowsCacheRef.current.clear();
  }, [kpiId, fieldId, year, effectiveOrgId, periodKey]);

  const subFields = field?.sub_fields ?? [];
  const gridSubFields = useMemo(() => {
    const isSubFieldConditional = (sf: any, allSubs: any[]): boolean => {
      if (sf.config?.condition_trigger_field_id != null || sf.config?.condition_trigger_field_key != null) {
        return true;
      }
      for (const other of allSubs) {
        const rules = other.config?.conditional_rules;
        if (Array.isArray(rules)) {
          for (const r of rules) {
            const deps = r.dependent_fields || r.dependent_field_ids || [];
            const depStrList = deps.map((d: any) => String(d));
            if (
              (sf.id != null && depStrList.includes(String(sf.id))) ||
              (sf.key != null && depStrList.includes(String(sf.key)))
            ) {
              return true;
            }
          }
        }
      }
      return false;
    };
    return subFields.filter((sf) => !isSubFieldConditional(sf, subFields));
  }, [subFields]);

  /** Columns currently shown in the grid, in the grid's actual display order (the table always
   * renders subFields in field-defined order, filtered to visibleColumns — never the picker's
   * possibly-different toggle order). This is the "columns currently in the Multi Line Item grid"
   * both export modes are defined relative to. */
  const gridOrderedVisibleKeys = useMemo(
    () =>
      gridSubFields
        .filter((sf) => visibleColumns.length === 0 || visibleColumns.includes(sf.key))
        .map((sf) => sf.key),
    [gridSubFields, visibleColumns]
  );

  /** Every sub-field defined for this Multi Line Item, in field-defined order — independent of
   * the grid's currently-visible/auto-fit column subset (visibleColumns only limits what's
   * rendered on screen; it is not the exportable column set). Used by the Export dialog, which
   * must offer every configured field regardless of grid display limits. */
  const allFieldColumnKeys = useMemo(() => subFields.map((sf) => sf.key), [subFields]);

  /** Default PDF title/sub-header — mirrors the backend's own fallback exactly (title = the
   * Multi Line Item's name; sub-header = KPI name + year), shown pre-filled in the Export
   * dialog so the user sees sensible text immediately but can freely override it per export. */
  const defaultPdfTitle = field?.name || kpiName || "Export";
  const defaultPdfSubtitle = kpiName && kpiName !== defaultPdfTitle ? `${kpiName} · ${year}` : String(year);

  /** PDF is capped at MAX_PDF_COLUMNS — beyond that the table would be too cramped to read.
   * Checked in real time as the user (de)selects columns, not just at submit time. */
  const pdfTooManyColumnsSelected = exportFormat === "pdf" && exportSelectedKeys.length > MAX_PDF_COLUMNS;

  useEffect(() => {
    if (!token || effectiveOrgId == null || !showFilterPanel) return;
    const needed = new Set<number>();
    filterDraft.forEach((row) => {
      if (!row.field) return;
      const sub = subFields.find((s) => s.key === row.field);
      const cfg = sub?.config as { reference_source_kpi_id?: number } | undefined;
      if (
        (sub?.field_type === "reference" || sub?.field_type === "multi_reference") &&
        cfg?.reference_source_kpi_id
      ) {
        const sid = cfg.reference_source_kpi_id;
        const pc = pathsForChainComputation(row, sub);
        const chainIds = computeChainKpiIds(sid, pc, sourceKpiFieldsById);
        chainIds.forEach((id) => needed.add(id));
      }
    });
    needed.forEach((kid) => {
      if (sourceKpiFieldsById[kid]?.length) return;
      api<FieldSummary[]>(
        `/entries/fields?${new URLSearchParams({
          kpi_id: String(kid),
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      )
        .then((list) => setSourceKpiFieldsById((prev) => ({ ...prev, [kid]: list })))
        .catch(() => setSourceKpiFieldsById((prev) => ({ ...prev, [kid]: [] })));
    });
  }, [token, effectiveOrgId, showFilterPanel, filterDraft, subFields, sourceKpiFieldsById]);

  useEffect(() => {
    if (!token || effectiveOrgId == null || !showFilterPanel) return;
    filterDraft.forEach((row) => {
      if (!row.field) return;
      const sub = subFields.find((s) => s.key === row.field);
      if (!sub || (sub.field_type !== "reference" && sub.field_type !== "multi_reference")) return;
      const cfg = sub.config as { reference_source_kpi_id?: number } | undefined;
      const sid = cfg?.reference_source_kpi_id;
      if (!sid) return;
      const pc = pathsForChainComputation(row, sub);
      const chainIds = computeChainKpiIds(sid, pc, sourceKpiFieldsById);
      const term = terminalRefAllowedValuesKey(chainIds, pc, sourceKpiFieldsById);
      if (!term) return;
      if (refFilterOptions[term.cacheKey] !== undefined) return;
      const last = pc.length - 1;
      const kpiId = chainIds[last];
      const path = pc[last];
      const { fieldKey, subKey } = parseComparePath(path);
      if (!fieldKey) return;
      const params = new URLSearchParams({
        source_kpi_id: String(kpiId),
        source_field_key: fieldKey,
        organization_id: String(effectiveOrgId),
      });
      if (subKey) params.set("source_sub_field_key", subKey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params.toString()}`, { token })
        .then((r) =>
          setRefFilterOptions((prev) => ({ ...prev, [term.cacheKey]: r.values ?? [] }))
        )
        .catch(() => setRefFilterOptions((prev) => ({ ...prev, [term.cacheKey]: [] })));
    });
  }, [token, effectiveOrgId, showFilterPanel, filterDraft, subFields, refFilterOptions, sourceKpiFieldsById]);

  const fieldApiResponseExampleJson = useMemo(() => {
    const actualData = rows.slice(0, 2).map((r) => r.data);
    return stringifyApiExample(
      buildMultiItemsApiResponseExamplePreferActual(year, field?.sub_fields ?? [], actualData)
    );
  }, [year, field?.sub_fields, rows]);

  const fieldApiRequestExampleJson = useMemo(() => {
    if (effectiveOrgId == null) {
      return stringifyApiExample({
        year,
        kpi_id: kpiId,
        field_id: fieldId,
        field_key: field?.key ?? "",
        organization_id: "<organization_id>",
        entry_id: entryId,
      });
    }
    return stringifyApiExample(
      buildMultiItemsApiRequestExample({
        year,
        kpiId,
        fieldId,
        fieldKey: field?.key ?? "",
        organizationId: effectiveOrgId,
        entryId,
      })
    );
  }, [year, kpiId, fieldId, field?.key, effectiveOrgId, entryId]);

  useEffect(() => {
    if (!entryId) return;
    loadRows().catch(() => undefined);
  }, [entryId, page, pageSize, appliedSearch, sortBy, sortDir, appliedFilter, showEditableOnly]);

  // Toast when returning from row edit page with success param
  useEffect(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const added = params.get("row_added");
    const updated = params.get("row_updated");
    if (added === "1") {
      toast.success("Row added successfully");
      params.delete("row_added");
      if (typeof window !== "undefined") window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    } else if (updated === "1") {
      toast.success("Row updated successfully");
      params.delete("row_updated");
      if (typeof window !== "undefined") window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
  }, []);

  // Note: sortBy is initialized during context load to prevent double row fetches on first render.

  // Initialize visible columns (persisted per KPI/field; dashboard-origin can override via ?cols=)
  useEffect(() => {
    if (gridSubFields.length === 0) return;
    const storageKey = `multi_visible_cols:${kpiId}:${fieldId}`;
    const manualKey = `multi_manual_cols:${kpiId}:${fieldId}`;
    let initial: string[] | null = null;
    let manualStored: boolean | null = null;

    if (cameFromDashboard && colsFromUrl) {
      const parsed = String(colsFromUrl)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const filtered = parsed.filter((k) => gridSubFields.some((sf) => sf.key === k));
      if (filtered.length > 0) {
        setVisibleColumns(filtered);
        return;
      }
    }

    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            initial = parsed.filter((k) => gridSubFields.some((sf) => sf.key === k));
          }
        }
        const m = window.localStorage.getItem(manualKey);
        if (m != null) manualStored = m === "true";
      } catch {
        // ignore
      }
    }
    if (manualStored != null) setManualColumnsMode(manualStored);
    if (!initial || initial.length === 0) {
      // Default to as many columns as fit in the available width.
      initial = gridSubFields.slice(0, Math.max(1, maxAutoColumns)).map((sf) => sf.key);
    }
    setVisibleColumns(manualStored ? initial : initial.slice(0, Math.max(1, maxAutoColumns)));
  }, [gridSubFields, kpiId, fieldId, cameFromDashboard, colsFromUrl, maxAutoColumns]);

  // Compute how many columns fit in the available table width and trim selection if needed.
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;

    const compute = () => {
      const w = el.getBoundingClientRect().width;
      // Reserve space for non-data columns: checkbox + row number + actions.
      const reserved = canManageRowAccess ? 240 : 190;
      // Conservative per-column width; we want to avoid horizontal overflow.
      const perCol = 220;
      const fit = Math.max(1, Math.floor((Math.max(0, w - reserved)) / perCol));
      setMaxAutoColumns(fit);
    };

    compute();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [canManageRowAccess]);

  useEffect(() => {
    if (manualColumnsMode) return;
    if (visibleColumns.length <= maxAutoColumns) return;
    setVisibleColumns((prev) => prev.slice(0, Math.max(1, maxAutoColumns)));
  }, [manualColumnsMode, maxAutoColumns, visibleColumns.length]);

  // Persist manual columns preference
  useEffect(() => {
    const manualKey = `multi_manual_cols:${kpiId}:${fieldId}`;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(manualKey, manualColumnsMode ? "true" : "false");
    } catch {
      // ignore
    }
  }, [manualColumnsMode, kpiId, fieldId]);

  // Persist visible columns
  useEffect(() => {
    if (visibleColumns.length === 0) return;
    const storageKey = `multi_visible_cols:${kpiId}:${fieldId}`;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(visibleColumns));
      } catch {
        // ignore
      }
    }
  }, [visibleColumns, kpiId, fieldId]);

  const openRowView = (row: MultiItemsRow) => {
    const params = new URLSearchParams(baseQueryParams.toString());
    router.push(
      `/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/${row.index}?${params.toString()}`
    );
  };

  const handleSaveRow = async () => {
    // legacy inline save no longer used; kept for compatibility
  };

  // Single-row delete is now handled on the row detail page.

  const handleBulkDelete = async () => {
    if (!token || !entryId || !fieldId || selectedIndices.length === 0) return;
    if (!window.confirm(`Delete ${selectedIndices.length} row(s)?`)) return;
    try {
      await api(
        `/entries/multi-items/rows/bulk-delete?${new URLSearchParams({
          entry_id: String(entryId),
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId ?? ""),
        }).toString()}`,
        { method: "POST", body: JSON.stringify({ indices: selectedIndices }), token }
      );
      toast.success("Rows deleted");
      setSelectedIndices([]);
      await refreshRows();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk delete failed");
    }
  };

  // Load available source years when "Previous year" channel is selected.
  useEffect(() => {
    if (!token || effectiveOrgId == null || !entryId || !fieldId || !kpiId) return;
    if (bulkChannel !== "previous_year") return;
    const controller = new AbortController();
    setAvailableSourceYearsLoading(true);
    setAvailableSourceYearsError(null);
    api<{ years: number[] }>(
      `/entries/multi-items/available-source-years?${new URLSearchParams({
        kpi_id: String(kpiId),
        field_id: String(fieldId),
        target_year: String(year),
        organization_id: String(effectiveOrgId),
        ...(periodKey ? { period_key: periodKey } : {}),
      }).toString()}`,
      { token }
    )
      .then((r) => {
        const yearsList = Array.isArray(r?.years) ? r.years.filter((y) => typeof y === "number" && y < year) : [];
        yearsList.sort((a, b) => b - a);
        setAvailableSourceYears(yearsList);
        if (yearsList.length > 0) setImportFromYear(yearsList[0]);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setAvailableSourceYears([]);
        setAvailableSourceYearsError(e instanceof Error ? e.message : "Failed to load years");
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailableSourceYearsLoading(false);
      });
    return () => controller.abort();
  }, [bulkChannel, token, effectiveOrgId, entryId, fieldId, kpiId, year, periodKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const uploadModeReady =
    uploadOption != null && (uploadOption !== "upsert" || upsertMatchSubFieldKey.trim().length > 0);

  const openRowAccessModal = (row: MultiItemsRow) => {
    if (!token || !entryId || !fieldId || !kpiId || effectiveOrgId == null) return;
    const preview = subFields
      .slice(0, 3)
      .map((sf) => row.data[sf.key])
      .filter((v) => v != null && String(v).trim() !== "")
      .join(" | ");
    setRowAccessModal({ rowIndex: row.index, preview: preview.slice(0, 80) });
    setRowAccessUsers([]);
    setRowAccessAddUserId(null);
    Promise.all([
      api<{ row_index: number; users: RowAccessUser[] }[]>(
        `/kpis/${kpiId}/row-access-by-entry?${new URLSearchParams({
          entry_id: String(entryId),
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      ),
      api<{ id: number; full_name: string | null; username: string }[]>(
        `/users?${new URLSearchParams({ organization_id: String(effectiveOrgId) }).toString()}`,
        { token }
      ),
    ])
      .then(([rowsData, usersData]) => {
        const rowData = Array.isArray(rowsData) ? rowsData.find((r) => r.row_index === row.index) : null;
        setRowAccessUsers(rowData?.users ?? []);
        setRowAccessAssignments(Array.isArray(usersData) ? usersData : []);
        setRowAccessAddUserId(usersData?.[0]?.id ?? null);
      })
      .catch(() => {
        setRowAccessAssignments([]);
      });
  };

  const refetchRowAccessUsers = () => {
    if (!rowAccessModal || !token || !entryId || !fieldId || !kpiId || effectiveOrgId == null) return;
    api<{ row_index: number; users: RowAccessUser[] }[]>(
      `/kpis/${kpiId}/row-access-by-entry?${new URLSearchParams({
        entry_id: String(entryId),
        field_id: String(fieldId),
        organization_id: String(effectiveOrgId),
      }).toString()}`,
      { token }
    )
      .then((rowsData) => {
        const rowData = Array.isArray(rowsData) ? rowsData.find((r) => r.row_index === rowAccessModal.rowIndex) : null;
        setRowAccessUsers(rowData?.users ?? []);
      })
      .catch(() => {});
  };

  const removeUserFromRow = async (userId: number) => {
    if (!rowAccessModal || !token || !kpiId || !entryId || !fieldId || effectiveOrgId == null) return;
    try {
      const existing = await api<{ row_index: number; can_edit: boolean; can_delete: boolean }[]>(
        `/kpis/${kpiId}/row-access?${new URLSearchParams({
          user_id: String(userId),
          entry_id: String(entryId),
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      );
      const rowsToSend = existing
        .filter((r) => r.row_index !== rowAccessModal.rowIndex)
        .map((r) => ({ row_index: r.row_index, can_edit: r.can_edit, can_delete: r.can_delete }));
      await api(`/kpis/${kpiId}/row-access?${new URLSearchParams({ organization_id: String(effectiveOrgId) }).toString()}`, {
        method: "PUT",
        body: JSON.stringify({ user_id: userId, entry_id: entryId, field_id: fieldId, rows: rowsToSend }),
        token,
      });
      toast.success("User removed from row");
      refetchRowAccessUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  };

  const saveAddUserToRow = async () => {
    if (!rowAccessModal || rowAccessAddUserId == null || !token || !kpiId || !entryId || !fieldId || effectiveOrgId == null) return;
    setRowAccessSaving(true);
    try {
      const existing = await api<{ row_index: number; can_edit: boolean; can_delete: boolean }[]>(
        `/kpis/${kpiId}/row-access?${new URLSearchParams({
          user_id: String(rowAccessAddUserId),
          entry_id: String(entryId),
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      );
      const can_edit = rowAccessAddAccess !== "view";
      const can_delete = rowAccessAddAccess === "edit_delete";
      const merged = (Array.isArray(existing) ? existing : []).filter((r) => r.row_index !== rowAccessModal.rowIndex);
      merged.push({ row_index: rowAccessModal.rowIndex, can_edit, can_delete });
      merged.sort((a, b) => a.row_index - b.row_index);
      await api(`/kpis/${kpiId}/row-access?${new URLSearchParams({ organization_id: String(effectiveOrgId) }).toString()}`, {
        method: "PUT",
        body: JSON.stringify({
          user_id: rowAccessAddUserId,
          entry_id: entryId,
          field_id: fieldId,
          rows: merged.map((r) => ({ row_index: r.row_index, can_edit: r.can_edit, can_delete: r.can_delete })),
        }),
        token,
      });
      toast.success(rowAccessAddAccess === "view" ? "Row view access granted" : "User access added to row");
      setRowAccessModal(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setRowAccessSaving(false);
    }
  };

  return (
    <div style={{ padding: "0.75rem 1rem 1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <style jsx global>{`
        @keyframes multiSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes multiIndeterminate {
          0% {
            transform: translateX(-60%);
          }
          100% {
            transform: translateX(160%);
          }
        }
      `}</style>
      {pageBusy && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",
          }}
          aria-live="polite"
          aria-busy="true"
        >
          <div
            className="card"
            style={{
              padding: "0.9rem 1rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: "0.6rem",
              minWidth: 220,
              boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: "2px solid var(--border)",
                  borderTopColor: "var(--accent)",
                  animation: "multiSpin 0.9s linear infinite",
                  flex: "0 0 auto",
                }}
              />
              <span style={{ color: "var(--text)", fontSize: "0.95rem", fontWeight: 600 }}>
                {busyLabel ?? "Working…"}
              </span>
            </div>
            <div
              aria-hidden
              style={{
                height: 6,
                borderRadius: 999,
                background: "var(--bg-muted, #eef2f7)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: "45%",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
                  animation: "multiIndeterminate 1.1s ease-in-out infinite",
                }}
              />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="card" style={{ padding: "0.75rem", color: "var(--error)" }}>
          {error}
        </div>
      )}

      {/* Search + Add row + Bulk upload + filters */}
      <div className="card" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {cameFromDashboard && dashboardId != null && Number.isFinite(dashboardId) ? (
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            <Link
              href={`/dashboard/dashboards/${dashboardId}?${new URLSearchParams({ organization_id: String(effectiveOrgId ?? "") }).toString()}`}
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              {dashboardName || "Dashboard"}
            </Link>
            <span style={{ margin: "0 0.35rem" }}>/</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{dashboardWidgetTitle || field?.name || "Full Page"}</span>
          </div>
        ) : (
          <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{field?.name || kpiName || "Entries"}</span>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search rows..."
            value={searchDraft}
            onChange={(e) => {
              const next = e.target.value;
              setSearchDraft(next);
              // When cleared, immediately show all records again.
              if (next.trim() === "") {
                setPage(1);
                setAppliedSearch("");
              }
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              setPage(1);
              setAppliedSearch(searchDraft.trim());
            }}
            disabled={pageBusy}
            style={{ flex: "1 1 220px", minWidth: 160, padding: "0.4rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
          />
          {searchDraft.trim() !== "" && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSearchDraft("");
                setPage(1);
                setAppliedSearch("");
              }}
              disabled={pageBusy}
              title="Clear search"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPage(1);
              setAppliedSearch(searchDraft.trim());
            }}
            disabled={pageBusy || searchDraft.trim() === appliedSearch.trim()}
            title="Apply search (Enter)"
          >
            Search
          </button>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.25rem 0.5rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                cursor: "pointer",
                userSelect: "none",
                whiteSpace: "nowrap",
              }}
              title="Show only rows you can edit and/or delete"
            >
              <input
                type="checkbox"
                checked={showEditableOnly}
                onChange={(e) => {
                  setPage(1);
                  setShowEditableOnly(e.target.checked);
                }}
              />
              Editable rows only
            </label>
          {canAddRowEffective && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!entryId) return;
                  const params = new URLSearchParams({
                    organization_id: String(effectiveOrgId ?? ""),
                    ...(periodKey ? { period_key: periodKey } : {}),
                  });
                  router.push(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/new?${params.toString()}&mode=edit`);
                }}
              >
                Add row
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setBulkPanelOpen((open) => !open)}
              >
                Bulk upload
              </button>
            </>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!showFilterPanel) {
                setFilterDraft(payloadToFilterDraft(appliedFilter));
              }
              setShowFilterPanel((open) => !open);
            }}
          >
            Advanced filters
          </button>
          {subFields.length > 0 && (
            <button
              type="button"
              className="btn"
              title="Choose visible columns"
              aria-label="Choose visible columns"
              onClick={() => {
                if (!showColumnsPopup) {
                  setColumnsPopupDraft([...visibleColumns]);
                  setColumnsPopupSearch("");
                }
                setShowColumnsPopup((open) => !open);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.35rem",
                padding: "0.4rem 0.6rem",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>Columns</span>
              {visibleColumns.length > 0 && (
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>({visibleColumns.length})</span>
              )}
            </button>
          )}
          {canExportEffective && (
            <button
              type="button"
              className="btn"
              disabled={pageBusy}
              title="Export the currently filtered rows"
              onClick={() => {
                setExportFormat("xlsx");
                setExportMode("all");
                // Default to the columns currently visible in the grid (not every column defined
                // for the field) — the user is already working with these, and it keeps the PDF
                // selection under MAX_PDF_COLUMNS in the common case so the dialog opens valid.
                setExportSelectedKeys([...gridOrderedVisibleKeys]);
                setExportColumnsSearch("");
                setExportFileName(`${defaultExportFileNameBase(field?.name || kpiName || "Export", year)}.xlsx`);
                setPdfHeaderColor(DEFAULT_PDF_HEADER_COLOR);
                setPdfTitle(defaultPdfTitle);
                setPdfSubtitle(defaultPdfSubtitle);
                setShowExportDialog(true);
              }}
            >
              {exportingXlsx || exportingPdf ? "Exporting…" : "Export"}
            </button>
          )}
        </div>
        {/* Active filters badges */}
        {appliedFilter && appliedFilter.conditions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem", alignItems: "center" }}>
            {appliedFilter.conditions.map((cond, idx) => {
              const sf = subFields.find((s) => s.key === cond.field);
              const label = sf?.name ?? cond.field;
              const val =
                Array.isArray(cond.values) && cond.values.length ? cond.values.join(", ") : String(cond.value ?? "");
              let refPathText = "";
              if (sf && (sf.field_type === "reference" || sf.field_type === "multi_reference")) {
                const cfg = (sf.config ?? {}) as { reference_source_kpi_id?: number };
                const sid = cfg.reference_source_kpi_id;
                if (sid != null) {
                  const paths = appliedReferencePathsForChip(cond, sf);
                  const chainIds = computeChainKpiIds(sid, paths, sourceKpiFieldsById);
                  const parts: string[] = [];
                  for (let i = 0; i < paths.length; i++) {
                    const kpiAt = chainIds[i];
                    if (kpiAt == null) break;
                    parts.push(formatComparePathLabel(sourceKpiFieldsById[kpiAt] ?? [], paths[i]));
                  }
                  if (parts.length > 0) refPathText = parts.join(" → ");
                }
              }
              const summary = `${label}${refPathText ? ` (${refPathText})` : ""} ${cond.op} ${val}`.trim();
              return (
                <span
                  key={`${idx}-${cond.field}-${cond.op}-${val}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "flex-start",
                    gap: "0.35rem",
                    padding: "0.25rem 0.45rem",
                    paddingRight: "0.35rem",
                    borderRadius: 999,
                    background: "var(--accent-muted, #eef2ff)",
                    fontSize: "0.8rem",
                    maxWidth: "100%",
                  }}
                >
                  <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "0.25rem", flex: "1 1 auto", minWidth: 0 }}>
                    {idx > 0 && (
                      <span style={{ fontWeight: 700, color: "var(--muted)", fontSize: "0.7rem" }}>
                        {cond.logic === "or" ? "OR" : "AND"}
                      </span>
                    )}
                    <strong>{label}</strong>
                    {refPathText && (
                      <span style={{ color: "var(--muted)" }}>
                        {`(${refPathText})`}
                      </span>
                    )}
                    <span style={{ color: "var(--muted)" }}>{cond.op}</span>
                    <span>{val}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!appliedFilter) return;
                      const next = removeConditionFromPayload(appliedFilter, idx);
                      setAppliedFilter(next);
                      setPage(1);
                    }}
                    aria-label={`Remove filter: ${summary}`}
                    title="Remove this filter"
                    style={{
                      flex: "0 0 auto",
                      alignSelf: "flex-start",
                      marginTop: "-0.05rem",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "1.05rem",
                      lineHeight: 1,
                      padding: "0 0.15rem",
                      color: "var(--muted)",
                    }}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAppliedFilter(null);
                setPage(1);
              }}
              style={{ fontSize: "0.8rem", padding: "0.1rem 0.5rem" }}
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Advanced filter panel */}
      {showFilterPanel && subFields.length > 0 && token && effectiveOrgId && (
        <MultiItemsAdvancedFiltersPanel
          token={token}
          effectiveOrgId={effectiveOrgId}
          subFields={subFields}
          filterDraft={filterDraft}
          setFilterDraft={setFilterDraft}
          sourceKpiFieldsById={sourceKpiFieldsById}
          setSourceKpiFieldsById={setSourceKpiFieldsById}
          refFilterOptions={refFilterOptions}
          setRefFilterOptions={setRefFilterOptions}
          onApply={(draft) => {
            const payload = filterDraftToPayload(draft, subFields);
            setAppliedFilter(payload);
            setPage(1);
            setShowFilterPanel(false);
          }}
          onClose={() => setShowFilterPanel(false)}
        />
      )}

      {/* Bulk upload panel */}
      {canAddRowEffective && bulkPanelOpen && (
        <div className="card" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Bulk upload</span>
            <button
              type="button"
              className="btn"
              onClick={() => setBulkPanelOpen(false)}
              style={{ fontSize: "0.85rem" }}
            >
              Hide
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Step 1 – Upload mode</span>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", fontSize: "0.85rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="uploadMode"
                    checked={uploadOption === "append"}
                    onChange={() => setUploadOption("append")}
                    disabled={!entryId}
                  />
                  Append
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="uploadMode"
                    checked={uploadOption === "override"}
                    onChange={() => setUploadOption("override")}
                    disabled={!entryId}
                  />
                  Override
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="uploadMode"
                    checked={uploadOption === "upsert"}
                    onChange={() => setUploadOption("upsert")}
                    disabled={!entryId}
                  />
                  Update or add
                </label>
              </div>
              {uploadOption === "upsert" && subFields.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginTop: "0.25rem" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Match on sub-field (same value → update row; new value → add row)</label>
                  <select
                    value={upsertMatchSubFieldKey}
                    onChange={(e) => setUpsertMatchSubFieldKey(e.target.value)}
                    style={{ maxWidth: 320, padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value="">— Select column —</option>
                    {subFields.map((sf) => (
                      <option key={sf.key} value={sf.key}>
                        {sf.name} ({sf.key})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Step 2 – Channel</span>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", fontSize: "0.85rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="uploadChannel"
                    checked={bulkChannel === "excel"}
                    onChange={() => setBulkChannel("excel")}
                    disabled={!entryId}
                  />
                  Excel file
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="uploadChannel"
                    checked={bulkChannel === "api"}
                    onChange={() => {
                      setBulkChannel("api");
                      if (!apiUrlOverride && field?.config && (field.config as any).multi_items_api_endpoint_url) {
                        setApiUrlOverride((field.config as any).multi_items_api_endpoint_url as string);
                      }
                    }}
                    disabled={!entryId || !(importCapabilities?.channels || []).includes("api")}
                  />
                  API
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="uploadChannel"
                    checked={bulkChannel === "odoo"}
                    onChange={() => setBulkChannel("odoo")}
                    disabled={!entryId || !importCapabilities?.odoo_ready}
                  />
                  Odoo
                </label>
                {!importCapabilities?.odoo_ready && (
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted)", maxWidth: 520 }}>
                    {!entryId
                      ? "Create or open this year’s KPI entry first."
                      : isSuperAdmin
                        ? (importCapabilities?.odoo_blockers || []).join(" ") ||
                          "Odoo is not ready: organization connection and KPI request body must both be configured."
                        : (importCapabilities?.odoo_blockers || []).join(" ") ||
                          "Odoo is not configured for this KPI. Ask your Super Admin to configure it first."}
                    {entryId && effectiveOrgId != null && isSuperAdmin && (
                      <>
                        {" "}
                        <Link
                          href={`/dashboard/kpis/${kpiId}/fields?organization_id=${effectiveOrgId}&tab=odoo`}
                          style={{ color: "var(--primary)", fontWeight: 500 }}
                        >
                          Configure Odoo on KPI Fields page →
                        </Link>
                      </>
                    )}
                  </p>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="uploadChannel"
                    checked={bulkChannel === "previous_year"}
                    onChange={() => setBulkChannel("previous_year")}
                    disabled={!entryId}
                  />
                  Previous year
                </label>
              </div>
            </div>
          </div>

          {/* Excel file upload */}
          {bulkChannel === "excel" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={pageBusy}
                  onClick={async () => {
                    if (!token || !fieldId || !entryId || effectiveOrgId == null) return;
                setDownloadingTemplate(true);
                try {
                  const url = getApiUrl(
                    `/entries/multi-items/template?${new URLSearchParams({
                      field_id: String(fieldId),
                      organization_id: String(effectiveOrgId),
                      ...(includeExistingRowsInTemplate ? { entry_id: String(entryId), include_existing_rows: "true" } : {}),
                    }).toString()}`
                  );
                  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                  if (res.status === 401 || res.status === 403) {
                    clearTokens();
                    toast.error("Session expired. Please log in again.");
                    router.push("/login");
                    return;
                  }
                  if (!res.ok) {
                    toast.error("Template download failed");
                    return;
                  }
                  const blob = await res.blob();
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `multi_items_${fieldId}_${year}.xlsx`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                } catch {
                  toast.error("Template download failed");
                } finally {
                  setDownloadingTemplate(false);
                }
                  }}
                >
                  {downloadingTemplate ? "Downloading…" : "Download Excel template"}
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--muted)", fontSize: "0.9rem" }}>
                  <input
                    type="checkbox"
                    checked={includeExistingRowsInTemplate}
                    onChange={(e) => setIncludeExistingRowsInTemplate(e.target.checked)}
                  />
                  Include existing rows (slow for large datasets)
                </label>
                <label
                  className="btn btn-primary"
                  style={{
                    cursor:
                      entryId && uploadOption != null && !uploading && (uploadOption !== "upsert" || upsertMatchSubFieldKey.trim())
                        ? "pointer"
                        : "not-allowed",
                    opacity: entryId && uploadOption != null && (uploadOption !== "upsert" || upsertMatchSubFieldKey.trim()) ? 1 : 0.6,
                  }}
                >
                  {uploading ? "Uploading…" : "Upload Excel"}
                  <input
                    type="file"
                    accept=".xlsx"
                    style={{ display: "none" }}
                    disabled={
                      !entryId ||
                      uploadOption == null ||
                      uploading ||
                      (uploadOption === "upsert" && !upsertMatchSubFieldKey.trim())
                    }
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file || !token || !fieldId || !entryId || effectiveOrgId == null || uploadOption == null) return;
                      if (uploadOption === "upsert" && !upsertMatchSubFieldKey.trim()) {
                        toast.error("Select which sub-field to use for matching.");
                        return;
                      }
                      if (uploadOption === "override") {
                        if (
                          !window.confirm(
                            "Are you sure you want to replace all existing data for this field? This cannot be undone."
                          )
                        ) {
                          return;
                        }
                      }
                      setUploading(true);
                      setUploadProgressHint("Starting upload…");
                      setUploadElapsedClock("0s");
                      const tStart = performance.now();
                      bulkUploadTickRef.current = window.setInterval(() => {
                        setUploadElapsedClock(formatElapsedClockSec((performance.now() - tStart) / 1000));
                      }, 500);
                      try {
                        const form = new FormData();
                        form.append("file", file);
                        const q = new URLSearchParams({
                          entry_id: String(entryId),
                          field_id: String(fieldId),
                          organization_id: String(effectiveOrgId),
                        });
                        if (uploadOption === "upsert") {
                          q.set("import_mode", "upsert");
                          q.set("match_sub_field_key", upsertMatchSubFieldKey.trim());
                        } else {
                          q.set("import_mode", uploadOption === "append" ? "append" : "replace");
                        }
                        const path = `/entries/multi-items/upload?${q.toString()}`;
                        const res = await postFormDataWithUploadProgress(path, form, {
                          token: token ?? "",
                          onUploadProgress: (ev) => {
                            if (ev.lengthComputable && ev.total > 0) {
                              setUploadProgressHint(`Uploading ${Math.round((100 * ev.loaded) / ev.total)}%`);
                            } else if (ev.loaded > 0) {
                              setUploadProgressHint(`Uploading (${(ev.loaded / 1024 / 1024).toFixed(1)} MB sent)`);
                            }
                          },
                          onRequestSent: () => setUploadProgressHint("Processing on server…"),
                        });
                        if (res.status === 401 || res.status === 403) {
                          clearTokens();
                          toast.error("Session expired. Please log in again.");
                          router.push("/login");
                          return;
                        }
                        if (res.ok) {
                          const payload = (await res.json()) as any;
                          const added = Number(payload?.rows_added ?? 0);
                          const overridden = Number(payload?.rows_overridden ?? 0);
                          const updated = Number(payload?.rows_updated ?? 0);
                          const elapsedMs = performance.now() - tStart;
                          const timeSuffix = ` · ${formatElapsedMs(elapsedMs)}`;
                          if (uploadOption === "upsert") {
                            toast.success(
                              `Update or add: ${updated} row(s) updated, ${added} new row(s) added${timeSuffix}`
                            );
                          } else {
                            const modeLabel = uploadOption === "append" ? "Appended" : "Replaced";
                            toast.success(
                              overridden > 0
                                ? `${modeLabel}: ${added} rows imported (overrode ${overridden} existing)${timeSuffix}`
                                : `${modeLabel}: ${added} rows imported${timeSuffix}`
                            );
                          }
                          await refreshRows();
                          setBulkPanelOpen(false);
                          setUploadOption(null);
                        } else {
                          const elapsedMsFail = performance.now() - tStart;
                          const failSuffix = ` (${formatElapsedMs(elapsedMsFail)})`;
                          if (res.status === 413) {
                            toast.error(
                              `Upload rejected: file exceeds the server upload limit (413). Ask your administrator to increase the limit (e.g. nginx client_max_body_size for /api), or split the spreadsheet.${failSuffix}`
                            );
                            return;
                          }
                          const err = (await res.json()) as any;
                          const validationErrors = Array.isArray(err?.errors) ? err.errors : [];
                          if (validationErrors.length > 0) {
                            const first = validationErrors[0] as {
                              field_key?: string;
                              sub_field_key?: string;
                              row_index?: number;
                              value?: string;
                              message?: string;
                              row?: unknown;
                            };
                            const loc =
                              first.sub_field_key != null
                                ? `Field "${first.field_key}", row ${(first.row_index ?? 0) + 1}, "${first.sub_field_key}"`
                                : `Field "${first.field_key}"`;
                            const details =
                              first.row != null
                                ? ` | row: ${
                                    typeof first.row === "string" ? first.row : JSON.stringify(first.row)
                                  }`
                                : "";
                            const msg = `Consistency check failed:\n${loc}: value "${first.value ?? ""}" ${
                              first.message ?? "not allowed"
                            }${details}${failSuffix}`;
                            toast.error(msg);
                          } else {
                            const detail =
                              err?.detail != null ? String(err.detail) : "Excel upload failed";
                            toast.error(`${detail}${failSuffix}`);
                          }
                        }
                      } catch (err) {
                        const elapsedMs = performance.now() - tStart;
                        const timePart = ` (${formatElapsedMs(elapsedMs)})`;
                        if (err instanceof DOMException && err.name === "AbortError") {
                          toast.error(`Upload was cancelled${timePart}`);
                          return;
                        }
                        const msg = err instanceof Error ? err.message : "";
                        if (msg.includes("timed out")) {
                          toast.error(
                            `Upload or processing timed out. For very large files, try again or contact your administrator about proxy/server timeouts${timePart}`
                          );
                          return;
                        }
                        toast.error(
                          err instanceof Error
                            ? `Excel upload failed: ${err.message}${timePart}`
                            : `Excel upload failed${timePart}`
                        );
                      } finally {
                        if (bulkUploadTickRef.current != null) {
                          window.clearInterval(bulkUploadTickRef.current);
                          bulkUploadTickRef.current = null;
                        }
                        setUploadElapsedClock(null);
                        setUploadProgressHint(null);
                        setUploading(false);
                      }
                    }}
                  />
                </label>
                {(uploadProgressHint || uploadElapsedClock) ? (
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)", alignSelf: "center" }}>
                    {uploadProgressHint}
                    {uploadElapsedClock ? ` · ${uploadElapsedClock}` : ""}
                  </span>
                ) : null}
              </div>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                Template includes existing records and required columns. Edit or add rows, then upload to import.
              </p>
            </div>
          )}

          {/* API import */}
          {bulkChannel === "api" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontWeight: 500 }}>API endpoint URL</label>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <input
                    type="url"
                    placeholder="https://example.com/multi-items-api"
                    value={apiUrlOverride}
                    onChange={(e) => setApiUrlOverride(e.target.value)}
                    style={{
                      flex: "1 1 200px",
                      minWidth: 0,
                      padding: "0.35rem 0.5rem",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}
                    disabled={
                      !entryId ||
                      !uploadOption ||
                      !apiUrlOverride.trim() ||
                      !token ||
                      (uploadOption === "upsert" && !upsertMatchSubFieldKey.trim())
                    }
                    onClick={async () => {
                      if (!token || !entryId || !fieldId || effectiveOrgId == null || !uploadOption) return;
                      if (uploadOption === "upsert" && !upsertMatchSubFieldKey.trim()) {
                        toast.error("Select which sub-field to use for matching.");
                        return;
                      }
                      try {
                        const params = new URLSearchParams({
                          entry_id: String(entryId),
                          field_id: String(fieldId),
                          organization_id: String(effectiveOrgId),
                          sync_mode: uploadOption,
                          api_url: apiUrlOverride.trim(),
                        });
                        if (uploadOption === "upsert") {
                          params.set("match_sub_field_key", upsertMatchSubFieldKey.trim());
                        }
                        const res = await api<{
                          rows_imported?: number;
                          rows_updated?: number;
                          rows_appended?: number;
                          skipped?: boolean;
                          reason?: string;
                        }>(`/entries/multi-items/sync-from-api?${params.toString()}`, { method: "POST", token });
                        if (res?.skipped) {
                          toast(res.reason || "Sync was skipped.");
                        } else if (uploadOption === "upsert") {
                          const u = res?.rows_updated ?? 0;
                          const a = res?.rows_appended ?? 0;
                          toast.success(`Update or add: ${u} row(s) updated, ${a} new row(s) added`);
                        } else {
                          const n = res?.rows_imported ?? 0;
                          toast.success(
                            n > 0
                              ? `Imported ${n} record${n === 1 ? "" : "s"} from API.`
                              : "API sync completed (no records imported)."
                          );
                        }
                        await refreshRows();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "API sync failed");
                      }
                    }}
                  >
                    Load data from API
                  </button>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowApiExampleJson((v) => !v)}
                  style={{
                    alignSelf: "flex-start",
                    fontSize: "0.8rem",
                    padding: "0.3rem 0.65rem",
                  }}
                >
                  {showApiExampleJson ? "Hide example JSON" : "Show example JSON"}
                </button>
                {field?.config && (field.config as any).multi_items_api_endpoint_url && (
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                    Configured URL:&nbsp;
                    <code style={{ fontSize: "0.8rem" }}>
                      {(field.config as any).multi_items_api_endpoint_url as string}
                    </code>
                  </p>
                )}
              </div>
              {showApiExampleJson && (
                <div>
                  <p style={{ margin: "0 0 0.35rem", fontWeight: 500 }}>Request body (POST to your URL)</p>
                  <p style={{ margin: "0 0 0.35rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                    The app sends this JSON. Your endpoint should respond with the expected response below.
                  </p>
                  <pre
                    style={{
                      margin: "0 0 0.75rem",
                      padding: "0.5rem 0.6rem",
                      borderRadius: 6,
                      background: "var(--code-bg, #f5f5f5)",
                      overflowX: "auto",
                      fontSize: "0.8rem",
                    }}
                  >
                    {fieldApiRequestExampleJson}
                  </pre>
                  {entryId == null && (
                    <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                      <code>entry_id</code> is set when this period&apos;s entry exists; sync is available after the entry is created.
                    </p>
                  )}
                  <p style={{ margin: "0 0 0.25rem", fontWeight: 500 }}>Expected JSON response</p>
                  <p style={{ margin: "0 0 0.35rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                    Top-level <code>year</code> should match the entry year (shown in your request). Each element of{" "}
                    <code>items</code> uses your sub-field <strong>keys</strong> as property names.
                    {rows.length > 0 ? (
                      <>
                        {" "}
                        The example below uses <strong>actual cell values</strong> from the first two rows currently loaded
                        on this page (one row if only one is loaded).
                      </>
                    ) : (
                      <>
                        {" "}
                        With no rows loaded yet, the example shows <strong>demo values</strong> by column type; replace{" "}
                        <code>reference</code> / <code>multi_reference</code> placeholders with allowed tokens from the linked
                        source KPI.
                      </>
                    )}
                  </p>
                  {subFields.length > 0 && (
                    <ul
                      style={{
                        margin: "0 0 0.5rem",
                        paddingLeft: "1.1rem",
                        fontSize: "0.8rem",
                        color: "var(--muted)",
                      }}
                    >
                      {subFields.map((sf) => (
                        <li key={sf.key}>
                          <code>{sf.key}</code>
                          {sf.name ? ` — ${sf.name}` : ""}
                          <span style={{ opacity: 0.85 }}> ({sf.field_type ?? "single_line_text"})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <pre
                    style={{
                      margin: 0,
                      padding: "0.5rem 0.6rem",
                      borderRadius: 6,
                      background: "var(--code-bg, #f5f5f5)",
                      overflowX: "auto",
                      fontSize: "0.8rem",
                    }}
                  >
                    {fieldApiResponseExampleJson}
                  </pre>
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                    Append, replace, or update-or-add is chosen in Step 1 above only; the remote API cannot override that.
                  </p>
                </div>
              )}
            </div>
          )}

          {bulkChannel === "odoo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
                {isSuperAdmin
                  ? "Loads data from Odoo using organization connection and KPI request body configured on the KPI Fields page."
                  : "Loads data from Odoo using settings configured by your Super Admin."}
              </p>
              {!uploadModeReady && (
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                  Select an upload mode in Step 1 (Append, Override, or Update or add) to enable Odoo import.
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!entryId || !uploadModeReady || uploading}
                style={{
                  alignSelf: "flex-start",
                  opacity: entryId && uploadModeReady && !uploading ? 1 : 0.55,
                  cursor: entryId && uploadModeReady && !uploading ? "pointer" : "not-allowed",
                }}
                onClick={async () => {
                  if (!token || !entryId || !fieldId || effectiveOrgId == null || !uploadModeReady || !uploadOption) return;
                  if (uploadOption === "upsert" && !upsertMatchSubFieldKey.trim()) {
                    toast.error("Select which sub-field to use for matching.");
                    return;
                  }
                  setUploading(true);
                  try {
                    const params = new URLSearchParams({
                      entry_id: String(entryId),
                      field_id: String(fieldId),
                      organization_id: String(effectiveOrgId),
                      sync_mode: uploadOption,
                    });
                    if (uploadOption === "upsert") {
                      params.set("match_sub_field_key", upsertMatchSubFieldKey.trim());
                    }
                    const res = await api<{
                      rows_imported?: number;
                      rows_updated?: number;
                      rows_appended?: number;
                    }>(`/entries/multi-items/sync-from-odoo?${params.toString()}`, { method: "POST", token });
                    if (uploadOption === "upsert") {
                      toast.success(
                        `Update or add: ${res?.rows_updated ?? 0} row(s) updated, ${res?.rows_appended ?? 0} new row(s) added`
                      );
                    } else {
                      const n = res?.rows_imported ?? 0;
                      toast.success(n > 0 ? `Imported ${n} record(s) from Odoo.` : "Odoo sync completed (no records imported).");
                    }
                    await refreshRows();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Odoo sync failed");
                  } finally {
                    setUploading(false);
                  }
                }}
              >
                {uploading ? "Loading from Odoo…" : "Load data from Odoo"}
              </button>
            </div>
          )}

          {/* Import from previous year */}
          {bulkChannel === "previous_year" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Import rows from year</label>
                <select
                  value={String(importFromYear)}
                  onChange={(e) => setImportFromYear(Number(e.target.value))}
                  style={{ maxWidth: 180, padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                  disabled={availableSourceYearsLoading || availableSourceYears.length === 0}
                >
                  {availableSourceYears.length === 0 ? (
                    <option value="">— No previous uploads found —</option>
                  ) : (
                    availableSourceYears.map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))
                  )}
                </select>
                {availableSourceYearsLoading && (
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading years…</div>
                )}
                {availableSourceYearsError && (
                  <div className="form-error" style={{ fontSize: "0.85rem" }}>{availableSourceYearsError}</div>
                )}
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", maxWidth: 520 }}>
                  Copies rows from the selected year into this year using Step 1 mode above (Append/Override/Update-or-add). This option is available even if carry-forward is disabled.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !entryId ||
                  !uploadOption ||
                  uploading ||
                  !token ||
                  effectiveOrgId == null ||
                  availableSourceYears.length === 0 ||
                  (uploadOption === "upsert" && !upsertMatchSubFieldKey.trim())
                }
                onClick={async () => {
                  if (!token || !entryId || !fieldId || effectiveOrgId == null || !uploadOption) return;
                  if (uploadOption === "upsert" && !upsertMatchSubFieldKey.trim()) {
                    toast.error("Select which sub-field to use for matching.");
                    return;
                  }
                  if (uploadOption === "override") {
                    const ok = window.confirm(
                      "Override will replace all existing rows for this field in the current year. Continue?"
                    );
                    if (!ok) return;
                  }
                  setUploading(true);
                  try {
                    const mode = uploadOption === "override" ? "replace" : uploadOption;
                    const params = new URLSearchParams({
                      entry_id: String(entryId),
                      field_id: String(fieldId),
                      organization_id: String(effectiveOrgId),
                      source_year: String(importFromYear),
                      import_mode: mode,
                      ...(periodKey ? { source_period_key: periodKey } : {}),
                    });
                    if (mode === "upsert") params.set("match_sub_field_key", upsertMatchSubFieldKey.trim());
                    const res = await api<any>(`/entries/multi-items/import-from-year?${params.toString()}`, {
                      method: "POST",
                      token,
                    });
                    if (mode === "upsert") {
                      const updated = Number(res?.rows_updated ?? 0);
                      const added = Number(res?.rows_appended ?? 0);
                      toast.success(`Update or add: ${updated} row(s) updated, ${added} new row(s) added`);
                    } else {
                      const added = Number(res?.rows_added ?? 0);
                      const overridden = Number(res?.rows_overridden ?? 0);
                      const label = uploadOption === "append" ? "Appended" : "Replaced";
                      toast.success(overridden > 0 ? `${label}: ${added} rows imported (overrode ${overridden} existing)` : `${label}: ${added} rows imported`);
                    }
                    await refreshRows();
                    setBulkPanelOpen(false);
                    setUploadOption(null);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Import from previous year failed");
                  } finally {
                    setUploading(false);
                  }
                }}
              >
                {uploading ? "Importing…" : "Import"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit is now handled on dedicated row page */}

      {/* Rows list */}
      <div className="card" style={{ padding: "0.75rem" }}>
        {canEditKpi && selectedIndices.length > 0 && !loading && total > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.4rem 0.6rem",
              marginBottom: "0.5rem",
              borderRadius: 6,
              background: "rgba(255, 99, 71, 0.06)",
              border: "1px solid rgba(255, 99, 71, 0.4)",
              fontSize: "0.85rem",
            }}
          >
            <span>
              <strong>{selectedIndices.length}</strong> record{selectedIndices.length === 1 ? "" : "s"} selected
            </span>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setSelectedIndices([])}
                style={{ fontSize: "0.8rem" }}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: "#b91c1c", color: "#fff", borderColor: "#b91c1c" }}
                onClick={handleBulkDelete}
              >
                Delete selected
              </button>
            </div>
          </div>
        )}
        {/* Columns popup */}
        {showColumnsPopup && subFields.length > 0 && (
          <>
            <div
              role="presentation"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                zIndex: 1000,
              }}
              onClick={() => setShowColumnsPopup(false)}
            />
            <div
              role="dialog"
              aria-label="Choose visible columns"
              style={{
                position: "fixed",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 1001,
                background: "var(--bg, #fff)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                minWidth: 320,
                maxWidth: "90vw",
                maxHeight: "80vh",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: "1rem", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>Visible columns</div>
              <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
                <input
                  type="text"
                  placeholder="Search columns..."
                  value={columnsPopupSearch}
                  onChange={(e) => setColumnsPopupSearch(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    fontSize: "0.9rem",
                  }}
                  autoFocus
                />
                <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.65rem", fontSize: "0.9rem", color: "var(--muted)" }}>
                  <input
                    type="checkbox"
                    checked={manualColumnsMode}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setManualColumnsMode(next);
                      if (!next) {
                        setColumnsPopupDraft((prev) => prev.slice(0, Math.max(1, maxAutoColumns)));
                      }
                    }}
                  />
                  Manual column adjustment (may overflow)
                </label>
                {!manualColumnsMode && (
                  <div style={{ marginTop: "0.35rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                    Auto-fit is enabled. You can select up to <strong>{Math.max(1, maxAutoColumns)}</strong> columns based on available width.
                  </div>
                )}
              </div>
              <div
                style={{
                  overflowY: "auto",
                  padding: "0.5rem 1rem",
                  maxHeight: 280,
                }}
              >
                {gridSubFields
                  .filter((sf) => {
                    const q = columnsPopupSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      sf.name.toLowerCase().includes(q) || (sf.key || "").toLowerCase().includes(q)
                    );
                  })
                  .map((sf) => {
                    const selected = columnsPopupDraft.includes(sf.key);
                    const atLimit = !manualColumnsMode && !selected && columnsPopupDraft.length >= Math.max(1, maxAutoColumns);
                    return (
                      <label
                        key={sf.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.4rem 0",
                          cursor: atLimit ? "not-allowed" : "pointer",
                          opacity: atLimit ? 0.7 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={atLimit}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setColumnsPopupDraft((prev) => {
                                const next = prev.includes(sf.key) ? prev : [...prev, sf.key];
                                // If user goes beyond available area, auto-trim.
                                  return manualColumnsMode ? next : next.slice(0, Math.max(1, maxAutoColumns));
                              });
                            } else {
                              setColumnsPopupDraft((prev) => prev.filter((k) => k !== sf.key));
                            }
                          }}
                        />
                        <span>{sf.name}</span>
                        {sf.key && sf.key !== sf.name && (
                          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>({sf.key})</span>
                        )}
                      </label>
                    );
                  })}
                {gridSubFields.filter((sf) => {
                  const q = columnsPopupSearch.trim().toLowerCase();
                  if (!q) return true;
                  return sf.name.toLowerCase().includes(q) || (sf.key || "").toLowerCase().includes(q);
                }).length === 0 && (
                  <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.5rem 0" }}>
                    No columns match your search.
                  </p>
                )}
              </div>
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                }}
              >
                <button type="button" className="btn" onClick={() => setShowColumnsPopup(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const draft = columnsPopupDraft.length > 0 ? columnsPopupDraft : gridSubFields.map((sf) => sf.key);
                    const next = manualColumnsMode ? draft : draft.slice(0, Math.max(1, maxAutoColumns));
                    setVisibleColumns(next);
                    setShowColumnsPopup(false);
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          </>
        )}
        {showExportDialog && (
          <>
            <div
              role="presentation"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                zIndex: 1000,
              }}
              onClick={() => setShowExportDialog(false)}
            />
            <div
              role="dialog"
              aria-label="Export"
              style={{
                position: "fixed",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 1001,
                background: "var(--bg, #fff)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                width: "min(460px, 92vw)",
                maxHeight: "min(620px, 88vh)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)", fontWeight: 600, flex: "0 0 auto" }}>
                Export
              </div>

              <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                      Format
                    </label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {(["xlsx", "pdf"] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          className={exportFormat === fmt ? "btn btn-primary" : "btn"}
                          style={{ flex: 1, padding: "0.4rem 0.5rem", fontSize: "0.85rem" }}
                          onClick={() => {
                            setExportFormat(fmt);
                            // PDF only supports "selected columns" (an all-columns PDF is unreadable).
                            if (fmt === "pdf" && exportMode === "all") setExportMode("selected");
                            setExportFileName((prev) => {
                              const base = prev.replace(/\.(xlsx|pdf)$/i, "");
                              return `${base}.${fmt}`;
                            });
                          }}
                        >
                          {fmt === "xlsx" ? "Excel" : "PDF"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                    File name
                  </label>
                  <input
                    type="text"
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder={`${defaultExportFileNameBase(field?.name || kpiName || "Export", year)}.${exportFormat}`}
                    style={{
                      width: "100%",
                      padding: "0.4rem 0.6rem",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>

                {exportFormat === "xlsx" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="radio"
                        name="export-mode"
                        checked={exportMode === "all"}
                        onChange={() => setExportMode("all")}
                      />
                      <span>
                        All columns
                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}> ({allFieldColumnKeys.length} total)</span>
                      </span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.85rem" }}>
                      <input
                        type="radio"
                        name="export-mode"
                        checked={exportMode === "selected"}
                        onChange={() => setExportMode("selected")}
                      />
                      <span>Selected columns</span>
                    </label>
                  </div>
                )}

                {exportFormat === "pdf" && (
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                        PDF header
                      </label>
                      <input
                        type="text"
                        value={pdfTitle}
                        onChange={(e) => setPdfTitle(e.target.value)}
                        placeholder={defaultPdfTitle}
                        style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem" }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label
                        style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}
                        title="An explanatory line shown just above the table"
                      >
                        PDF sub-header
                      </label>
                      <input
                        type="text"
                        value={pdfSubtitle}
                        onChange={(e) => setPdfSubtitle(e.target.value)}
                        placeholder={defaultPdfSubtitle}
                        title="An explanatory line shown just above the table"
                        style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem" }}
                      />
                    </div>
                  </div>
                )}

                {exportFormat === "pdf" && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                      Header color
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                      {PDF_HEADER_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          title={preset.name}
                          aria-label={preset.name}
                          onClick={() => setPdfHeaderColor(preset.value)}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: preset.value,
                            border:
                              pdfHeaderColor.toLowerCase() === preset.value.toLowerCase()
                                ? "2px solid var(--text)"
                                : "1px solid var(--border)",
                            boxShadow: pdfHeaderColor.toLowerCase() === preset.value.toLowerCase() ? "0 0 0 2px var(--bg, #fff)" : "none",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      ))}
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(pdfHeaderColor) ? pdfHeaderColor : DEFAULT_PDF_HEADER_COLOR}
                        onChange={(e) => setPdfHeaderColor(e.target.value)}
                        title="Custom color"
                        style={{ width: 26, height: 22, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                      />
                      <span
                        style={{
                          marginLeft: "0.15rem",
                          padding: "0.2rem 0.6rem",
                          borderRadius: 6,
                          background: pdfHeaderColor,
                          color: contrastTextColor(pdfHeaderColor),
                          fontSize: "0.75rem",
                          fontWeight: 600,
                        }}
                      >
                        Preview
                      </span>
                    </div>
                  </div>
                )}

                {(exportFormat === "pdf" || exportMode === "selected") && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <input
                        type="text"
                        placeholder="Search columns..."
                        value={exportColumnsSearch}
                        onChange={(e) => setExportColumnsSearch(e.target.value)}
                        style={{
                          flex: "1 1 160px",
                          padding: "0.35rem 0.55rem",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          fontSize: "0.85rem",
                        }}
                      />
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                        onClick={() => setExportSelectedKeys([...allFieldColumnKeys])}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                        onClick={() => setExportSelectedKeys([])}
                      >
                        Deselect all
                      </button>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: pdfTooManyColumnsSelected ? "var(--error, #dc2626)" : "var(--muted)",
                          fontWeight: pdfTooManyColumnsSelected ? 600 : 400,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {exportSelectedKeys.length}/{allFieldColumnKeys.length} selected
                        {exportFormat === "pdf" && ` (max ${MAX_PDF_COLUMNS})`}
                      </span>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "0.25rem 0.6rem",
                      }}
                    >
                      {allFieldColumnKeys
                        .map((key) => subFields.find((sf) => sf.key === key))
                        .filter((sf): sf is SubField => {
                          if (!sf) return false;
                          const q = exportColumnsSearch.trim().toLowerCase();
                          if (!q) return true;
                          return sf.name.toLowerCase().includes(q) || (sf.key || "").toLowerCase().includes(q);
                        })
                        .map((sf) => {
                          const selected = exportSelectedKeys.includes(sf.key);
                          return (
                            <label
                              key={sf.key}
                              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0", cursor: "pointer", fontSize: "0.85rem" }}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  setExportSelectedKeys((prev) =>
                                    e.target.checked ? [...prev, sf.key] : prev.filter((k) => k !== sf.key)
                                  );
                                }}
                              />
                              <span>{sf.name}</span>
                              {sf.key && sf.key !== sf.name && (
                                <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>({sf.key})</span>
                              )}
                            </label>
                          );
                        })}
                      {allFieldColumnKeys.length === 0 && (
                        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.4rem 0" }}>No columns available.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ flex: "0 0 auto", borderTop: "1px solid var(--border)", padding: "0.75rem 1.1rem" }}>
                {pdfTooManyColumnsSelected && (
                  <div
                    style={{
                      marginBottom: "0.6rem",
                      padding: "0.5rem 0.65rem",
                      borderRadius: 6,
                      background: "var(--error-muted, #fef2f2)",
                      border: "1px solid var(--error, #dc2626)",
                      color: "var(--error, #dc2626)",
                      fontSize: "0.8rem",
                    }}
                  >
                    {PDF_TOO_MANY_COLUMNS_MESSAGE}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                  <button type="button" className="btn" onClick={() => setShowExportDialog(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      ((exportFormat === "pdf" || exportMode === "selected") && exportSelectedKeys.length === 0) ||
                      pdfTooManyColumnsSelected
                    }
                    onClick={() => {
                      if (pdfTooManyColumnsSelected) {
                        toast.error(PDF_TOO_MANY_COLUMNS_MESSAGE);
                        return;
                      }
                      const usesAllColumns = exportFormat === "xlsx" && exportMode === "all";
                      const cols = usesAllColumns
                        ? allFieldColumnKeys
                        : allFieldColumnKeys.filter((k) => exportSelectedKeys.includes(k));
                      const defaultBase = defaultExportFileNameBase(field?.name || kpiName || "Export", year);
                      const resolvedFileName = resolveExportFileName(exportFileName, defaultBase, exportFormat);
                      setShowExportDialog(false);
                      void runExport(exportFormat, cols, resolvedFileName, pdfHeaderColor, pdfTitle, pdfSubtitle);
                    }}
                  >
                    Export
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        {loading ? (
          <p style={{ color: "var(--muted)" }}>Loading rows…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            {canEditKpi ? 'No rows yet. Use "Add row" above to create one.' : "No rows in this field."}
          </p>
        ) : (
          <div ref={tableWrapRef} style={{ width: "100%", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr>
                {canEditKpi && (
                  <th style={{ width: 32, padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)" }}>
                    <input
                      type="checkbox"
                      checked={selectedIndices.length > 0 && selectedIndices.length === rows.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIndices(rows.map((r) => r.index));
                        } else {
                          setSelectedIndices([]);
                        }
                      }}
                    />
                  </th>
                )}
                <th style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", textAlign: "left" }}>#</th>
                {gridSubFields
                  .filter((sf) => visibleColumns.length === 0 || visibleColumns.includes(sf.key))
                  .map((sf) => {
                  const isActive = sortBy === sf.key;
                  const nextDir = isActive && sortDir === "asc" ? "desc" : "asc";
                  return (
                    <th
                      key={sf.key}
                      style={{
                        padding: "0.4rem 0.5rem",
                        borderBottom: "1px solid var(--border)",
                        textAlign: "left",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        background: isActive ? "var(--accent-muted, rgba(0, 0, 0, 0.06))" : undefined,
                        fontWeight: isActive ? 600 : undefined,
                      }}
                      onClick={() => {
                        setPage(1);
                        if (sortBy === sf.key) {
                          setSortDir(nextDir);
                        } else {
                          setSortBy(sf.key);
                          setSortDir("asc");
                        }
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {sf.name}
                        <span style={{ fontSize: "0.85rem", color: isActive ? "var(--accent, inherit)" : "var(--muted)" }}>
                          {isActive ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅"}
                        </span>
                      </span>
                    </th>
                  );
                })}
                {(canEditKpi || canManageRowAccess) && (
                  <th style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", width: canManageRowAccess ? 140 : 88, textAlign: "right" }}>
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.index}>
                {canEditKpi && (
                  <td style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" }}>
                      <input
                        type="checkbox"
                        checked={selectedIndices.includes(row.index)}
                        disabled={row.can_delete === false}
                        onChange={(e) => {
                          setSelectedIndices((prev) =>
                            e.target.checked
                              ? prev.includes(row.index)
                                ? prev
                                : [...prev, row.index]
                              : prev.filter((i) => i !== row.index)
                          );
                        }}
                      />
                    </td>
                  )}
                  <td style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" }}>{row.index + 1}</td>
                {gridSubFields
                  .filter((sf) => visibleColumns.length === 0 || visibleColumns.includes(sf.key))
                  .map((sf) => (
                    <td
                      key={sf.key}
                      style={{
                        padding: "0.35rem 0.5rem",
                        borderBottom: "1px solid var(--border)",
                        cursor: canEditKpi && row.can_edit !== false ? "pointer" : "default",
                      }}
                      onClick={() => {
                        openRowView(row);
                      }}
                    >
                      {(() => {
                        const cellVal = row.data[sf.key];
                        if (sf.field_type === "multi_reference") {
                          const arr = Array.isArray(cellVal)
                            ? (cellVal as unknown[]).filter((x) => x != null && String(x).trim() !== "")
                            : [];
                          if (arr.length === 0) return "—";
                          return arr.map((x) => String(x)).join("; ");
                        }
                        if (sf.field_type === "mixed_list") {
                          const arr = Array.isArray(cellVal)
                            ? (cellVal as unknown[]).filter((x) => x != null && String(x).trim() !== "")
                            : [];
                          if (arr.length === 0) return "—";
                          return arr.map((x) => String(x)).join("; ");
                        }
                        if (sf.field_type === "attachment") {
                          const url = getAttachmentUrl(cellVal);
                          if (!url) return "—";
                          const name = getAttachmentDisplayName(cellVal);
                          const handleOpen = async (e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!token) {
                              toast.error("Session expired. Please log in again.");
                              return;
                            }
                            try {
                              await openKpiStoredFileInNewTab(cellVal, token);
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Could not open file");
                            }
                          };
                          return (
                            <button
                              type="button"
                              onClick={handleOpen}
                              title={url}
                              style={{
                                color: "var(--accent)",
                                cursor: "pointer",
                                background: "none",
                                border: "none",
                                padding: 0,
                                font: "inherit",
                                textDecoration: "underline",
                                textAlign: "left",
                                maxWidth: 280,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                display: "block",
                              }}
                            >
                              {name}
                            </button>
                          );
                        }
                        if (cellVal == null || String(cellVal).trim() === "") return "—";
                        return String(cellVal);
                      })()}
                    </td>
                  ))}
                  {(canEditKpi || canManageRowAccess) && (
                    <td style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "0.25rem", alignItems: "center", justifyContent: "flex-end" }}>
                        {canManageRowAccess && (
                        <button
                          type="button"
                          title="Row access"
                          aria-label="Row access"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRowAccessModal(row);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 32,
                            height: 32,
                            padding: 0,
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--bg-subtle, #f5f5f5)",
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--accent-muted, #e8e8e8)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.color = "var(--accent)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "var(--bg-subtle, #f5f5f5)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.color = "var(--text)";
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        </button>
                        )}
                        <button
                          type="button"
                          title="View row"
                          aria-label="View row"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRowView(row);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 32,
                            height: 32,
                            padding: 0,
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--bg-subtle, #f5f5f5)",
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--accent-muted, #e8e8e8)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.color = "var(--accent)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "var(--bg-subtle, #f5f5f5)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.color = "var(--text)";
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        {false && row.can_edit !== false && canEditKpi && (
                        <button
                          type="button"
                          title="Edit row"
                          aria-label="Edit row"
                          onClick={(e) => {
                            e.stopPropagation();
                              openRowView(row);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 32,
                            height: 32,
                            padding: 0,
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--bg-subtle, #f5f5f5)",
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--accent-muted, #e8e8e8)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.color = "var(--accent)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "var(--bg-subtle, #f5f5f5)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.color = "var(--text)";
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        )}
                        {false && row.can_delete !== false && canEditKpi && (
                        <button
                          type="button"
                          title="Delete row"
                          aria-label="Delete row"
                          onClick={(e) => {
                            e.stopPropagation();
                              // handled on row detail page
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 32,
                            height: 32,
                            padding: 0,
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--bg-subtle, #f5f5f5)",
                            color: "var(--error, #b91c1c)",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--error-muted, #fef2f2)";
                            e.currentTarget.style.borderColor = "var(--error)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "var(--bg-subtle, #f5f5f5)";
                            e.currentTarget.style.borderColor = "var(--border)";
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {/* Table footer: paging + export */}
        {!loading && total > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "0.75rem",
              fontSize: "0.85rem",
            }}
          >
            <span style={{ color: "var(--muted)" }}>
              Page {page} of {totalPages} · {total} record{total === 1 ? "" : "s"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                Page size{" "}
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value) || 20;
                    setPageSize(next);
                    setPage(1);
                  }}
                  style={{ marginLeft: 4, padding: "0.15rem 0.3rem", borderRadius: 4, border: "1px solid var(--border)" }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={pageBusy}
                onClick={() => runExport("csv")}
              >
                {exportingCsv ? "Exporting…" : `Export CSV (${total})`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {rowAccessModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setRowAccessModal(null)}
        >
          <div
            className="card"
            style={{ width: "90%", maxWidth: 440, padding: "1.25rem", maxHeight: "85vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem 0" }}>Row access</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1rem" }}>
              Record #{rowAccessModal.rowIndex + 1}{rowAccessModal.preview ? ` — ${rowAccessModal.preview}${rowAccessModal.preview.length >= 80 ? "…" : ""}` : ""}
            </p>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
              Assign which users can view, edit, or delete this row.
            </p>
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                {rowAccessUsers.map((u) => (
                  <span
                    key={u.user_id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      padding: "0.2rem 0.5rem",
                      borderRadius: 6,
                      background: "var(--bg-subtle)",
                      fontSize: "0.8rem",
                    }}
                  >
                    {u.full_name || u.username} ({!u.can_edit ? "View" : u.can_delete ? "Edit+Delete" : "Edit"})
                    <button
                      type="button"
                      onClick={() => removeUserFromRow(u.user_id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        padding: "0 0.15rem",
                        color: "var(--muted)",
                        fontSize: "1rem",
                        lineHeight: 1,
                      }}
                      aria-label="Remove user from row"
                      title="Remove from row"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Add user</label>
              <input
                type="text"
                placeholder="Search user by name or username"
                value={rowAccessUserSearch}
                onChange={(e) => setRowAccessUserSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.4rem 0.6rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  marginBottom: "0.35rem",
                  fontSize: "0.85rem",
                }}
              />
              {rowAccessAssignments.length > 0 && rowAccessUserSearch.trim() !== "" && (
                <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                  {rowAccessAssignments.filter((a) => {
                    const term = rowAccessUserSearch.toLowerCase();
                    return (
                      (a.full_name || "").toLowerCase().includes(term) ||
                      a.username.toLowerCase().includes(term)
                    );
                  }).length === 0
                    ? "No users match this search."
                    : ""}
                </p>
              )}
              <select
                value={rowAccessAddUserId ?? ""}
                onChange={(e) => setRowAccessAddUserId(e.target.value ? Number(e.target.value) : null)}
                style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)", marginBottom: "0.5rem" }}
              >
                <option value="">— Select user —</option>
                {rowAccessAssignments
                  .filter((a) => {
                    if (!rowAccessUserSearch.trim()) return true;
                    const term = rowAccessUserSearch.toLowerCase();
                    return (
                      (a.full_name || "").toLowerCase().includes(term) ||
                      a.username.toLowerCase().includes(term)
                    );
                  })
                  .map((a) => (
                  <option key={a.id} value={a.id}>{a.full_name || a.username}</option>
                ))}
              </select>
              <select
                value={rowAccessAddAccess}
                onChange={(e) => setRowAccessAddAccess(e.target.value as "view" | "edit" | "edit_delete")}
                style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)" }}
              >
                <option value="view">View only</option>
                <option value="edit">Edit only</option>
                <option value="edit_delete">Edit + Delete</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" disabled={rowAccessSaving || rowAccessAddUserId == null} onClick={saveAddUserToRow}>
                {rowAccessSaving ? "Saving…" : "Add and save"}
              </button>
              <button type="button" className="btn" onClick={() => setRowAccessModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

