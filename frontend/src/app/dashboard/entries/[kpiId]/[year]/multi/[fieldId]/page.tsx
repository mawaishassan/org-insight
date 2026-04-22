"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAccessToken, clearTokens } from "@/lib/auth";
import { api, getApiUrl, openKpiStoredFileInNewTab } from "@/lib/api";
import { getAttachmentDisplayName, getAttachmentUrl } from "@/lib/attachmentCellValue";
import toast from "react-hot-toast";
import {
  buildMultiItemsApiRequestExample,
  buildMultiItemsApiResponseExamplePreferActual,
  stringifyApiExample,
} from "@/lib/multiItemsApiExample";

type SubField = {
  id?: number;
  key: string;
  name: string;
  field_type?: string | null;
  is_required?: boolean;
  config?: { reference_source_kpi_id?: number; reference_source_field_key?: string; reference_source_sub_field_key?: string } | null;
};

function truncateLabel(label: string, max = 48): string {
  const s = String(label ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

const MULTI_ITEM_WHERE_OPS = [
  { value: "eq", label: "equals (=)" },
  { value: "neq", label: "not equals (≠)" },
  { value: "gt", label: "greater than (>)" },
  { value: "gte", label: "greater or equal (≥)" },
  { value: "lt", label: "less than (<)" },
  { value: "lte", label: "less or equal (≤)" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
] as const;

function operatorsForMultiItemSubField(fieldType: string | undefined): readonly { value: string; label: string }[] {
  const ft = fieldType ?? "";
  const cmp = MULTI_ITEM_WHERE_OPS.filter((o) =>
    ["eq", "neq", "gt", "gte", "lt", "lte"].includes(o.value)
  );
  const text = MULTI_ITEM_WHERE_OPS.filter((o) =>
    ["eq", "neq", "contains", "not_contains", "starts_with", "ends_with"].includes(o.value)
  );
  if (ft === "number" || ft === "date") return cmp;
  if (ft === "boolean") return MULTI_ITEM_WHERE_OPS.filter((o) => ["eq", "neq"].includes(o.value));
  if (ft === "reference" || ft === "multi_reference") return text;
  return text;
}

type MultiItemsFilterPayloadV2 = {
  _version: 2;
  conditions: Array<{
    logic?: "and" | "or";
    field: string;
    op: string;
    value?: unknown;
    values?: string[];
    /** Walk reference fields then read the final scalar field (chain) or legacy single compare. */
    reference_resolution?: {
      compare_field_key?: string;
      compare_sub_field_key?: string;
      chain?: Array<{ compare_field_key: string; compare_sub_field_key?: string }>;
    };
  }>;
};

type MultiFilterConditionRow = {
  field: string;
  op: string;
  value: string;
  multiValues: string[];
  logicWithPrev: "and" | "or";
  /** Paths on each KPI in the reference chain: `fieldKey` or `fieldKey|subKey`. Empty = use configured default label path only. */
  referenceChainPaths: string[];
};

function isReferenceLikeFieldType(ft: string | undefined): boolean {
  return ft === "reference" || ft === "multi_reference";
}

function getNextSourceKpiIdForPath(fields: FieldSummary[], path: string): number | undefined {
  const { fieldKey, subKey } = parseComparePath(path);
  const f = fields.find((x) => x.key === fieldKey);
  if (!f) return undefined;
  if (subKey && f.field_type === "multi_line_items" && f.sub_fields?.length) {
    const sub = f.sub_fields.find((s) => s.key === subKey);
    if (!sub) return undefined;
    if (!isReferenceLikeFieldType(sub.field_type ?? undefined)) return undefined;
    const cfg = (sub.config ?? {}) as { reference_source_kpi_id?: number };
    return cfg.reference_source_kpi_id;
  }
  if (isReferenceLikeFieldType(f.field_type)) {
    const cfg = (f.config ?? {}) as { reference_source_kpi_id?: number };
    return cfg.reference_source_kpi_id;
  }
  return undefined;
}

function getFieldTypeAtPath(fields: FieldSummary[], path: string): string | undefined {
  const { fieldKey, subKey } = parseComparePath(path);
  const f = fields.find((x) => x.key === fieldKey);
  if (!f) return undefined;
  if (subKey && f.field_type === "multi_line_items" && f.sub_fields?.length) {
    return f.sub_fields.find((s) => s.key === subKey)?.field_type ?? undefined;
  }
  return f.field_type;
}

/** KPI id at step 0, 1, … when walking `paths` (length = paths.length + 1). */
function computeChainKpiIds(
  startKpiId: number,
  paths: string[],
  cache: Record<number, FieldSummary[]>
): number[] {
  const ids: number[] = [startKpiId];
  for (let i = 0; i < paths.length; i++) {
    const flds = cache[ids[i]] ?? [];
    const nextId = getNextSourceKpiIdForPath(flds, paths[i]);
    if (nextId == null) break;
    ids.push(nextId);
  }
  return ids;
}

/** Paths used for chain resolution / terminal value; empty draft → configured default path. */
function pathsForChainComputation(row: MultiFilterConditionRow, sub: SubField | undefined): string[] {
  const raw = row.referenceChainPaths ?? [];
  const def = sub ? defaultReferenceComparePath(sub) : "";
  if (raw.length === 0) return def ? [def] : [];
  return [...raw];
}

function shouldOmitReferenceResolution(paths: string[], sub: SubField | undefined): boolean {
  const def = sub ? defaultReferenceComparePath(sub) : "";
  return paths.length === 1 && paths[0] === def;
}

function terminalRefAllowedValuesKey(
  chainKpiIds: number[],
  pathsComp: string[],
  fieldCache: Record<number, FieldSummary[]>
): { cacheKey: string } | null {
  if (!chainKpiIds.length || !pathsComp.length) return null;
  const last = pathsComp.length - 1;
  const kpiId = chainKpiIds[last];
  const path = pathsComp[last];
  const fields = fieldCache[kpiId] ?? [];
  const ft = getFieldTypeAtPath(fields, path);
  if (isReferenceLikeFieldType(ft)) return null;
  const { fieldKey, subKey } = parseComparePath(path);
  if (!fieldKey) return null;
  const cacheKey = `${kpiId}-${fieldKey}${subKey ? `-${subKey}` : ""}`;
  return { cacheKey };
}

function parseComparePath(path: string): { fieldKey: string; subKey?: string } {
  const p = path.trim();
  if (!p) return { fieldKey: "" };
  const idx = p.indexOf("|");
  if (idx === -1) return { fieldKey: p };
  return { fieldKey: p.slice(0, idx), subKey: p.slice(idx + 1).trim() || undefined };
}

function defaultReferenceComparePath(sub: SubField): string {
  const cfg = (sub.config ?? {}) as {
    reference_source_field_key?: string;
    reference_source_sub_field_key?: string;
  };
  const fk = cfg.reference_source_field_key ?? "";
  const sk = cfg.reference_source_sub_field_key;
  return sk ? `${fk}|${sk}` : fk;
}

function emptyMultiFilterRow(): MultiFilterConditionRow {
  return { field: "", op: "eq", value: "", multiValues: [], logicWithPrev: "and", referenceChainPaths: [] };
}

function rrToPathStrings(rr: MultiItemsFilterPayloadV2["conditions"][0]["reference_resolution"]): string[] {
  if (!rr) return [];
  const ch = rr.chain;
  if (Array.isArray(ch) && ch.length > 0) {
    return ch.map((s) =>
      s.compare_sub_field_key ? `${s.compare_field_key}|${s.compare_sub_field_key}` : s.compare_field_key
    );
  }
  if (rr.compare_field_key) {
    return [rr.compare_sub_field_key ? `${rr.compare_field_key}|${rr.compare_sub_field_key}` : rr.compare_field_key];
  }
  return [];
}

function payloadToFilterDraft(payload: MultiItemsFilterPayloadV2 | null): MultiFilterConditionRow[] {
  if (!payload?.conditions?.length) return [emptyMultiFilterRow()];
  return payload.conditions.map((c, i) => {
    const vals = Array.isArray(c.values) ? c.values.map(String) : [];
    const multiVals = vals.length > 1 ? [...vals] : [];
    let valueStr = "";
    if (vals.length === 1) valueStr = vals[0] ?? "";
    else if (!multiVals.length && c.value !== undefined && c.value !== null) {
      if (typeof c.value === "boolean") valueStr = c.value ? "true" : "false";
      else valueStr = String(c.value);
    }
    return {
      field: String(c.field ?? ""),
      op: String(c.op ?? "eq"),
      value: valueStr,
      multiValues: multiVals,
      logicWithPrev: i === 0 ? "and" : c.logic === "or" ? "or" : "and",
      referenceChainPaths: rrToPathStrings(c.reference_resolution),
    };
  });
}

function filterDraftToPayload(rows: MultiFilterConditionRow[], subFields: SubField[]): MultiItemsFilterPayloadV2 | null {
  const conditions: MultiItemsFilterPayloadV2["conditions"] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fk = r.field.trim();
    if (!fk) continue;
    const sf = subFields.find((s) => s.key === fk);
    const ft = sf?.field_type ?? "";
    let valueOut: unknown = r.value.trim();
    let valuesOut: string[] | undefined;

    if (ft === "number" && String(valueOut) !== "") {
      const n = Number(valueOut);
      valueOut = Number.isNaN(n) ? valueOut : n;
    }
    if (ft === "boolean") {
      const vs = String(valueOut).trim().toLowerCase();
      if (vs === "true") valueOut = true;
      else if (vs === "false") valueOut = false;
    }

    const allowedOps = operatorsForMultiItemSubField(ft);
    const resolvedOp = allowedOps.some((o) => o.value === r.op) ? r.op : (allowedOps[0]?.value ?? "eq");

    const isMultiRef = ft === "multi_reference";
    const multi = (r.multiValues ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (isMultiRef && multi.length > 1 && (resolvedOp === "eq" || resolvedOp === "neq")) {
      valuesOut = multi;
    }

    const base: MultiItemsFilterPayloadV2["conditions"][0] = {
      field: fk,
      op: resolvedOp,
      ...(valuesOut ? { values: valuesOut } : { value: valueOut }),
    };
    if (i > 0) base.logic = r.logicWithPrev;

    if (ft === "reference" || ft === "multi_reference") {
      const rawPaths = r.referenceChainPaths ?? [];
      if (rawPaths.length > 0 && !shouldOmitReferenceResolution(rawPaths, sf)) {
        base.reference_resolution = {
          chain: rawPaths.map((p) => {
            const { fieldKey, subKey } = parseComparePath(p);
            return {
              compare_field_key: fieldKey,
              ...(subKey ? { compare_sub_field_key: subKey } : {}),
            };
          }),
        };
      }
    }
    const hasValue =
      valuesOut != null ||
      (typeof valueOut === "boolean") ||
      (typeof valueOut === "number" && !Number.isNaN(valueOut)) ||
      (typeof valueOut === "string" && valueOut !== "");
    if (!hasValue) continue;
    conditions.push(base);
  }
  if (conditions.length === 0) return null;
  return { _version: 2, conditions };
}

function removeConditionFromPayload(payload: MultiItemsFilterPayloadV2, idx: number): MultiItemsFilterPayloadV2 | null {
  const next = payload.conditions.filter((_, i) => i !== idx);
  if (next.length === 0) return null;
  const normalized: MultiItemsFilterPayloadV2["conditions"] = next.map((c, i) => {
    const row: MultiItemsFilterPayloadV2["conditions"][0] = {
      field: String(c.field),
      op: String(c.op),
      ...(Array.isArray(c.values) && c.values.length > 0 ? { values: [...c.values] } : { value: c.value }),
    };
    const rr = c.reference_resolution;
    if (rr?.chain && Array.isArray(rr.chain) && rr.chain.length > 0) {
      row.reference_resolution = {
        chain: rr.chain.map((s) => ({
          compare_field_key: String(s.compare_field_key),
          ...(s.compare_sub_field_key ? { compare_sub_field_key: String(s.compare_sub_field_key) } : {}),
        })),
      };
    } else if (rr?.compare_field_key) {
      row.reference_resolution = {
        compare_field_key: String(rr.compare_field_key),
        ...(rr.compare_sub_field_key ? { compare_sub_field_key: String(rr.compare_sub_field_key) } : {}),
      };
    }
    if (i > 0) row.logic = c.logic === "or" ? "or" : "and";
    return row;
  });
  return { _version: 2, conditions: normalized };
}

function buildReferenceAttributeOptions(fields: FieldSummary[]): { value: string; label: string }[] {
  const scalarTypes = [
    "single_line_text",
    "multi_line_text",
    "number",
    "date",
    "boolean",
    "reference",
    "multi_reference",
    "mixed_list",
  ];
  const out: { value: string; label: string }[] = [];
  for (const f of fields) {
    if (!f?.key) continue;
    if (scalarTypes.includes(f.field_type)) {
      out.push({ value: f.key, label: truncateLabel(`${f.name} (${f.key})`, 56) });
    }
    if (f.field_type === "multi_line_items" && f.sub_fields?.length) {
      for (const s of f.sub_fields) {
        out.push({
          value: `${f.key}|${s.key}`,
          label: truncateLabel(`${f.name} → ${s.name} (${s.key})`, 56),
        });
      }
    }
  }
  return out;
}

function formatComparePathLabel(fields: FieldSummary[], path: string): string {
  const { fieldKey, subKey } = parseComparePath(path);
  const f = fields.find((x) => x.key === fieldKey);
  if (!f) return path;
  if (subKey && f.field_type === "multi_line_items" && f.sub_fields?.length) {
    const s = f.sub_fields.find((x) => x.key === subKey);
    if (!s) return `${f.name} → ${subKey}`;
    return `${f.name} → ${s.name}`;
  }
  return f.name || fieldKey;
}

function appliedReferencePathsForChip(cond: MultiItemsFilterPayloadV2["conditions"][0], sub: SubField | undefined): string[] {
  const rr = cond.reference_resolution;
  if (rr?.chain && Array.isArray(rr.chain) && rr.chain.length > 0) {
    return rr.chain.map((s) => (s.compare_sub_field_key ? `${s.compare_field_key}|${s.compare_sub_field_key}` : s.compare_field_key));
  }
  if (rr?.compare_field_key) {
    return [rr.compare_sub_field_key ? `${rr.compare_field_key}|${rr.compare_sub_field_key}` : rr.compare_field_key];
  }
  const def = sub ? defaultReferenceComparePath(sub) : "";
  return def ? [def] : [];
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

interface FieldSummary {
  id: number;
  key: string;
  name: string;
  field_type: string;
  full_page_multi_items?: boolean;
  sub_fields?: SubField[];
  config?: Record<string, unknown> | null;
}

interface KpiInfo {
  name: string;
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
  const [search, setSearch] = useState("");
  const [showEditableOnly, setShowEditableOnly] = useState(false);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [uploadOption, setUploadOption] = useState<"append" | "override" | "upsert" | null>(null);
  const [upsertMatchSubFieldKey, setUpsertMatchSubFieldKey] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [appliedFilter, setAppliedFilter] = useState<MultiItemsFilterPayloadV2 | null>(null);
  const [filterDraft, setFilterDraft] = useState<MultiFilterConditionRow[]>(() => [emptyMultiFilterRow()]);
  const [refFilterOptions, setRefFilterOptions] = useState<Record<string, string[]>>({});
  const [sourceKpiFieldsById, setSourceKpiFieldsById] = useState<Record<number, FieldSummary[]>>({});
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkChannel, setBulkChannel] = useState<"excel" | "api" | "previous_year" | null>(null);
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
  const [canEditKpi, setCanEditKpi] = useState<boolean>(true);
  const [kpiLevelCanEdit, setKpiLevelCanEdit] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [canAddRow, setCanAddRow] = useState<boolean>(false);
  const [rowAccessModal, setRowAccessModal] = useState<{ rowIndex: number; preview: string } | null>(null);
  const [rowAccessUsers, setRowAccessUsers] = useState<RowAccessUser[]>([]);
  const [rowAccessAssignments, setRowAccessAssignments] = useState<{ id: number; full_name: string | null; username: string }[]>([]);
  const [rowAccessAddUserId, setRowAccessAddUserId] = useState<number | null>(null);
  const [rowAccessAddAccess, setRowAccessAddAccess] = useState<"view" | "edit" | "edit_delete">("edit_delete");
  const [rowAccessSaving, setRowAccessSaving] = useState(false);
  const [rowAccessUserSearch, setRowAccessUserSearch] = useState("");

  /** Ignore stale API responses when year/org/field changes quickly (fixes missing rows / wrong permissions UI). */
  const multiPageContextLoadGenRef = useRef(0);
  const multiPageRowsLoadGenRef = useRef(0);
  const entryIdLiveRef = useRef<number | null>(null);

  const isAdmin = userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN";
  const canManageRowAccess = isAdmin;
  const canAddRowEffective = canAddRow || isAdmin;

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
    return q;
  }, [effectiveOrgId, periodKey, cameFromDashboard, dashboardIdFromUrl, widgetIdFromUrl]);

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

  const loadContext = async () => {
    if (!token || !kpiId || effectiveOrgId == null || !fieldId) return;
    const loadId = ++multiPageContextLoadGenRef.current;
    setError(null);
    try {
      // Load KPI name
      const kpi = await api<KpiInfo>(`/kpis/${kpiId}?${new URLSearchParams({ organization_id: String(effectiveOrgId) }).toString()}`, { token }).catch(() => null);
      if (loadId !== multiPageContextLoadGenRef.current) return;
      if (kpi?.name) setKpiName(kpi.name);
      // Load fields and find this multi_line_items field
      const fields = await api<FieldSummary[]>(`/entries/fields?${new URLSearchParams({ kpi_id: String(kpiId), organization_id: String(effectiveOrgId) }).toString()}`, { token }).catch(() => []);
      if (loadId !== multiPageContextLoadGenRef.current) return;
      const f = fields.find((x) => x.id === fieldId && x.field_type === "multi_line_items") || null;
      setField(f);
      // Ensure entry exists for this period
      const forPeriod = await api<{ id: number }>(
        `/entries/for-period?${new URLSearchParams({
          kpi_id: String(kpiId),
          year: String(year),
          period_key: periodKey || "",
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      );
      if (loadId !== multiPageContextLoadGenRef.current) return;
      setEntryId(forPeriod.id);
      // User's edit rights for this KPI (view-only users get can_edit: false)
      const apiInfo = await api<{ can_edit?: boolean; kpi_level_can_edit?: boolean }>(
        `/entries/kpi-api-info?${new URLSearchParams({ kpi_id: String(kpiId), organization_id: String(effectiveOrgId) }).toString()}`,
        { token }
      ).catch(() => ({ can_edit: false, kpi_level_can_edit: false }));
      if (loadId !== multiPageContextLoadGenRef.current) return;
      setCanEditKpi(apiInfo?.can_edit !== false);
      setKpiLevelCanEdit(apiInfo?.kpi_level_can_edit === true);

      // Add-row permission is field-specific (not KPI-level)
      const addRowInfo = await api<{ can_add_row?: boolean }>(
        `/entries/multi-items/add-row-info?${new URLSearchParams({ field_id: String(fieldId), organization_id: String(effectiveOrgId) }).toString()}`,
        { token }
      ).catch(() => ({ can_add_row: false }));
      if (loadId !== multiPageContextLoadGenRef.current) return;
      setCanAddRow(addRowInfo?.can_add_row === true);
    } catch (e) {
      if (loadId === multiPageContextLoadGenRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load context");
      }
    }
  };

  const loadRows = async () => {
    if (!token || !entryId || !fieldId || effectiveOrgId == null) return;
    const rowLoadId = ++multiPageRowsLoadGenRef.current;
    const entryIdForThisFetch = entryId;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        entry_id: String(entryId),
        field_id: String(fieldId),
        organization_id: String(effectiveOrgId),
        page: String(page),
        page_size: String(pageSize),
        sort_dir: sortDir,
      });
      if (search.trim()) params.set("search", search.trim());
      if (sortBy) params.set("sort_by", sortBy);
      if (showEditableOnly) params.set("editable_only", "true");
      if (appliedFilter && appliedFilter.conditions.length > 0) {
        params.set("filters", JSON.stringify(appliedFilter));
      }
      const res = await api<MultiItemsListResponse>(`/entries/multi-items/rows?${params.toString()}`, { token });
      if (
        rowLoadId !== multiPageRowsLoadGenRef.current ||
        entryIdForThisFetch !== entryIdLiveRef.current
      ) {
        return;
      }
      setRows(res.rows);
      setTotal(res.total);
      if (res.sub_fields && (!field || !field.sub_fields)) {
        setField((prev) => (prev ? { ...prev, sub_fields: res.sub_fields } : prev));
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

  useEffect(() => {
    if (!token || effectiveOrgId == null) return;
    loadContext().catch(() => undefined);
    return () => {
      multiPageContextLoadGenRef.current += 1;
      multiPageRowsLoadGenRef.current += 1;
    };
  }, [token, kpiId, year, effectiveOrgId, fieldId, periodKey]);

  const subFields = field?.sub_fields ?? [];

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
  }, [entryId, page, pageSize, search, sortBy, sortDir, appliedFilter, showEditableOnly]);

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

  // Default sort by first column when sub_fields become available
  useEffect(() => {
    if (subFields.length > 0 && sortBy === null) {
      setSortBy(subFields[0].key);
    }
  }, [subFields, sortBy]);

  // Initialize visible columns (persisted per KPI/field; dashboard-origin can override via ?cols=)
  useEffect(() => {
    if (subFields.length === 0) return;
    const storageKey = `multi_visible_cols:${kpiId}:${fieldId}`;
    let initial: string[] | null = null;

    if (cameFromDashboard && colsFromUrl) {
      const parsed = String(colsFromUrl)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const filtered = parsed.filter((k) => subFields.some((sf) => sf.key === k));
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
            initial = parsed.filter((k) => subFields.some((sf) => sf.key === k));
          }
        }
      } catch {
        // ignore
      }
    }
    if (!initial || initial.length === 0) {
      const attachmentKeys = subFields
        .filter((sf) => sf.field_type === "attachment")
        .map((sf) => sf.key);
      const otherKeys = subFields
        .filter((sf) => sf.field_type !== "attachment")
        .map((sf) => sf.key);
      const combined: string[] = [];
      attachmentKeys.forEach((k) => {
        if (!combined.includes(k)) combined.push(k);
      });
      otherKeys.forEach((k) => {
        if (!combined.includes(k)) combined.push(k);
      });
      initial = combined.length > 0 ? combined : subFields.map((sf) => sf.key);
    }
    setVisibleColumns(initial);
  }, [subFields, kpiId, fieldId, cameFromDashboard, colsFromUrl]);

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
      await loadRows();
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
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            style={{ flex: "1 1 220px", minWidth: 160, padding: "0.4rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
          />
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
      {showFilterPanel && subFields.length > 0 && (
        <div className="card" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Advanced filters</span>
            <button
              type="button"
              className="btn"
              onClick={() => setShowFilterPanel(false)}
              style={{ fontSize: "0.85rem" }}
            >
              Close
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {filterDraft.map((c, idx) => {
              const sfCond = subFields.find((s) => s.key === c.field);
              const ftCond = sfCond?.field_type ?? "";
              const opChoices = operatorsForMultiItemSubField(ftCond);
              const opSelectValue = opChoices.some((o) => o.value === c.op) ? c.op : (opChoices[0]?.value ?? "eq");
              const refCfg = sfCond?.config as { reference_source_kpi_id?: number } | undefined;
              const sourceKpiIdForRef = refCfg?.reference_source_kpi_id;
              const pcComp = sfCond ? pathsForChainComputation(c, sfCond) : [];
              const chainIdsForRef =
                sourceKpiIdForRef != null
                  ? computeChainKpiIds(sourceKpiIdForRef, pcComp, sourceKpiFieldsById)
                  : [];
              const termKey = terminalRefAllowedValuesKey(chainIdsForRef, pcComp, sourceKpiFieldsById);
              const refCacheKey = termKey?.cacheKey ?? "";
              const refOptions = refCacheKey ? refFilterOptions[refCacheKey] ?? [] : [];
              const showMultiRefPick =
                ftCond === "multi_reference" && (c.op === "eq" || c.op === "neq") && refOptions.length > 0;
              const setRow = (patch: Partial<MultiFilterConditionRow>) =>
                setFilterDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    alignItems: "flex-end",
                    paddingBottom: "0.5rem",
                    borderBottom: idx < filterDraft.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  {idx > 0 && (
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                        Logical
                      </label>
                      <select
                        value={c.logicWithPrev}
                        onChange={(e) =>
                          setRow({ logicWithPrev: e.target.value === "or" ? "or" : "and" })
                        }
                        style={{ minWidth: "110px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                      >
                        <option value="and">AND</option>
                        <option value="or">OR</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
                    <select
                      value={c.field}
                      onChange={(e) => {
                        const key = e.target.value;
                        const sf = subFields.find((s) => s.key === key);
                        const nextOps = operatorsForMultiItemSubField(sf?.field_type ?? undefined);
                        setRow({
                          field: key,
                          op: nextOps[0]?.value ?? "eq",
                          value: "",
                          multiValues: [],
                          referenceChainPaths: [],
                        });
                      }}
                      style={{ minWidth: "200px", maxWidth: "min(100%, 320px)", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    >
                      <option value="">— Select field —</option>
                      {subFields.map((s) => (
                        <option key={s.key} value={s.key}>
                          {truncateLabel(`${s.name} — ${s.key}`, 56)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(ftCond === "reference" || ftCond === "multi_reference") &&
                    sfCond &&
                    sourceKpiIdForRef != null &&
                    (() => {
                      const pcCompInner = pathsForChainComputation(c, sfCond);
                      const chainIds = computeChainKpiIds(sourceKpiIdForRef, pcCompInner, sourceKpiFieldsById);
                      const nodes: ReactNode[] = [];
                      for (let L = 0; L < 16; L++) {
                        const kpiAtL = chainIds[L];
                        if (kpiAtL == null) break;
                        if (L > 0) {
                          const prevPath = pcCompInner[L - 1];
                          if (!prevPath) break;
                          const prevFt = getFieldTypeAtPath(sourceKpiFieldsById[chainIds[L - 1]] ?? [], prevPath);
                          if (!isReferenceLikeFieldType(prevFt)) break;
                        }
                        const pathSel = pcCompInner[L] ?? "";
                        const opts = buildReferenceAttributeOptions(sourceKpiFieldsById[kpiAtL] ?? []);
                        nodes.push(
                          <div key={L} style={{ minWidth: "200px", maxWidth: "min(100%, 340px)" }}>
                            <label
                              style={{
                                display: "block",
                                fontSize: "0.8rem",
                                color: "var(--muted)",
                                marginBottom: "0.25rem",
                              }}
                            >
                              {L === 0 ? "Reference attribute" : `Linked field (${L + 1})`}
                            </label>
                            <select
                              value={pathSel}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                setFilterDraft((prev) =>
                                  prev.map((x, i) => {
                                    if (i !== idx) return x;
                                    if (!v) {
                                      return {
                                        ...x,
                                        referenceChainPaths: (x.referenceChainPaths ?? []).slice(0, L),
                                        value: "",
                                        multiValues: [],
                                      };
                                    }
                                    const next = [...(x.referenceChainPaths ?? [])];
                                    next[L] = v;
                                    return {
                                      ...x,
                                      referenceChainPaths: next.slice(0, L + 1),
                                      value: "",
                                      multiValues: [],
                                    };
                                  })
                                );
                              }}
                              style={{
                                width: "100%",
                                padding: "0.35rem 0.5rem",
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                              }}
                            >
                              <option value="">— Select column —</option>
                              {opts.length === 0 ? (
                                <option value="" disabled>
                                  Loading…
                                </option>
                              ) : (
                                opts.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))
                              )}
                            </select>
                          </div>
                        );
                        const sel = pcCompInner[L];
                        if (!sel) break;
                        const cft = getFieldTypeAtPath(sourceKpiFieldsById[kpiAtL] ?? [], sel);
                        if (!isReferenceLikeFieldType(cft)) break;
                      }
                      return <>{nodes}</>;
                    })()}
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Operator</label>
                    <select
                      value={opSelectValue}
                      onChange={(e) => {
                        const next = e.target.value;
                        const collapseMulti =
                          next !== "eq" && next !== "neq" && (c.multiValues?.length ?? 0) > 0;
                        setFilterDraft((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  op: next,
                                  ...(collapseMulti ? { value: x.multiValues?.[0] ?? x.value, multiValues: [] } : {}),
                                }
                              : x
                          )
                        );
                      }}
                      style={{ minWidth: "140px", maxWidth: "220px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    >
                      {opChoices.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Value</label>
                    {!c.field ? (
                      <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "inline-block", padding: "0.35rem 0" }}>
                        Select a field first
                      </span>
                    ) : ftCond === "boolean" ? (
                      <select
                        value={c.value === "true" || c.value === "false" ? c.value : ""}
                        onChange={(e) => setRow({ value: e.target.value })}
                        style={{ minWidth: "140px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                      >
                        <option value="">—</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : ftCond === "number" ? (
                      <input
                        type="number"
                        step="any"
                        value={c.value}
                        onChange={(e) => setRow({ value: e.target.value })}
                        style={{ width: "100%", maxWidth: "200px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                        placeholder="Number"
                      />
                    ) : ftCond === "date" ? (
                      <input
                        type="date"
                        value={c.value.length >= 10 ? c.value.slice(0, 10) : c.value}
                        onChange={(e) => setRow({ value: e.target.value })}
                        style={{ maxWidth: "200px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                      />
                    ) : ftCond === "reference" && sourceKpiIdForRef ? (
                      termKey ? (
                        refOptions.length > 0 ? (
                          !c.value || refOptions.includes(c.value) ? (
                            <select
                              value={refOptions.includes(c.value) ? c.value : ""}
                              onChange={(e) => setRow({ value: e.target.value })}
                              style={{ minWidth: "200px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                            >
                              <option value="">— Select value —</option>
                              {refOptions.map((v) => (
                                <option key={v} value={v}>{truncateLabel(v, 72)}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={c.value}
                              onChange={(e) => setRow({ value: e.target.value })}
                              style={{ minWidth: "180px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                              placeholder="Custom value"
                            />
                          )
                        ) : (
                          <input
                            type="text"
                            value={c.value}
                            onChange={(e) => setRow({ value: e.target.value })}
                            style={{ minWidth: "180px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                            placeholder="Loading values… or type manually"
                          />
                        )
                      ) : (
                        <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "inline-block", padding: "0.35rem 0" }}>
                          Choose linked columns until a non-reference field is selected; values load for that field.
                        </span>
                      )
                    ) : ftCond === "multi_reference" && sourceKpiIdForRef ? (
                      termKey ? (
                        showMultiRefPick ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "200px", maxWidth: "420px" }}>
                            <select
                              multiple
                              size={Math.min(8, Math.max(3, refOptions.length))}
                              value={c.multiValues ?? []}
                              onChange={(e) => {
                                const sel = Array.from(e.target.selectedOptions, (o) => o.value);
                                setRow({ multiValues: sel, value: sel[0] ?? "" });
                              }}
                              style={{ width: "100%", padding: "0.25rem", borderRadius: 6, border: "1px solid var(--border)" }}
                            >
                              {refOptions.map((v) => (
                                <option key={v} value={v}>{truncateLabel(v, 80)}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                              {c.op === "eq" ? "Any selected value matches (OR)." : "None of the selected values (AND)."} Use Ctrl/Cmd or Shift for multiple.
                            </span>
                          </div>
                        ) : refOptions.length > 0 ? (
                          !c.value || refOptions.includes(c.value) ? (
                            <select
                              value={refOptions.includes(c.value) ? c.value : ""}
                              onChange={(e) => setRow({ value: e.target.value })}
                              style={{ minWidth: "200px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                            >
                              <option value="">— Select value —</option>
                              {refOptions.map((v) => (
                                <option key={v} value={v}>{truncateLabel(v, 72)}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={c.value}
                              onChange={(e) => setRow({ value: e.target.value })}
                              style={{ minWidth: "180px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                              placeholder="Custom value"
                            />
                          )
                        ) : (
                          <input
                            type="text"
                            value={c.value}
                            onChange={(e) => setRow({ value: e.target.value })}
                            style={{ minWidth: "180px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                            placeholder="Type a value"
                          />
                        )
                      ) : (
                        <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "inline-block", padding: "0.35rem 0" }}>
                          Choose linked columns until a non-reference field is selected; values load for that field.
                        </span>
                      )
                    ) : (
                      <input
                        type="text"
                        value={c.value}
                        onChange={(e) => setRow({ value: e.target.value })}
                        style={{ minWidth: "180px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                        placeholder="Value"
                      />
                    )}
                  </div>
                  {filterDraft.length > 1 && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.85rem", alignSelf: "flex-end" }}
                      onClick={() => setFilterDraft((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div>
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.85rem" }}
              onClick={() => setFilterDraft((prev) => [...prev, emptyMultiFilterRow()])}
            >
              + Add condition
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setFilterDraft([emptyMultiFilterRow()]);
                setAppliedFilter(null);
                setPage(1);
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const payload = filterDraftToPayload(filterDraft, subFields);
                setAppliedFilter(payload);
                setPage(1);
                setShowFilterPanel(false);
              }}
            >
              Apply filters
            </button>
          </div>
        </div>
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
                    disabled={!entryId}
                  />
                  API
                </label>
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
                  onClick={async () => {
                    if (!token || !fieldId || !entryId || effectiveOrgId == null) return;
                try {
                  const url = getApiUrl(
                    `/entries/multi-items/template?${new URLSearchParams({
                      field_id: String(fieldId),
                      entry_id: String(entryId),
                      organization_id: String(effectiveOrgId),
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
                }
                  }}
                >
                  Download Excel template
                </button>
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
                        const url = getApiUrl(`/entries/multi-items/upload?${q.toString()}`);
                        const res = await fetch(url, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${token}` },
                          body: form,
                        });
                        if (res.ok) {
                          const payload = await res.json().catch(() => ({} as any));
                          const added = Number((payload as any)?.rows_added ?? 0);
                          const overridden = Number((payload as any)?.rows_overridden ?? 0);
                          const updated = Number((payload as any)?.rows_updated ?? 0);
                          if (uploadOption === "upsert") {
                            toast.success(
                              `Update or add: ${updated} row(s) updated, ${added} new row(s) added`
                            );
                          } else {
                            const modeLabel = uploadOption === "append" ? "Appended" : "Replaced";
                            toast.success(
                              overridden > 0
                                ? `${modeLabel}: ${added} rows imported (overrode ${overridden} existing)`
                                : `${modeLabel}: ${added} rows imported`
                            );
                          }
                          await loadRows();
                          setBulkPanelOpen(false);
                          setUploadOption(null);
                        } else {
                          const err = await res.json().catch(() => ({} as any));
                          const validationErrors = Array.isArray((err as any).errors)
                            ? ((err as any).errors as any[])
                            : [];
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
                            }${details}`;
                            toast.error(msg);
                          } else {
                            toast.error("Excel upload failed");
                          }
                        }
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? `Excel upload failed: ${err.message}` : "Excel upload failed"
                        );
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </label>
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
                        await loadRows();
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
                    await loadRows();
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
              </div>
              <div
                style={{
                  overflowY: "auto",
                  padding: "0.5rem 1rem",
                  maxHeight: 280,
                }}
              >
                {subFields
                  .filter((sf) => {
                    const q = columnsPopupSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      sf.name.toLowerCase().includes(q) || (sf.key || "").toLowerCase().includes(q)
                    );
                  })
                  .map((sf) => {
                    const selected = columnsPopupDraft.includes(sf.key);
                    const atLimit = false;
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
                              setColumnsPopupDraft((prev) => (prev.includes(sf.key) ? prev : [...prev, sf.key]));
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
                {subFields.filter((sf) => {
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
                    setVisibleColumns(columnsPopupDraft.length > 0 ? columnsPopupDraft : subFields.map((sf) => sf.key));
                    setShowColumnsPopup(false);
                  }}
                >
                  Apply
                </button>
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
                {subFields
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
                {subFields
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
                onClick={async () => {
                  if (!token || !entryId || !fieldId || effectiveOrgId == null) return;
                  try {
                    const params = new URLSearchParams({
                      entry_id: String(entryId),
                      field_id: String(fieldId),
                      organization_id: String(effectiveOrgId),
                      sort_dir: sortDir,
                    });
                    if (search.trim()) params.set("search", search.trim());
                    if (sortBy) params.set("sort_by", sortBy);
                    if (appliedFilter && appliedFilter.conditions.length > 0) {
                      params.set("filters", JSON.stringify(appliedFilter));
                    }
                    const url = getApiUrl(`/entries/multi-items/export?${params.toString()}`);
                    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                    if (res.status === 401 || res.status === 403) {
                      clearTokens();
                      toast.error("Session expired. Please log in again.");
                      router.push("/login");
                      return;
                    }
                    if (!res.ok) {
                      toast.error("Export failed");
                      return;
                    }
                    const blob = await res.blob();
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `multi_items_${fieldId}_${year}.csv`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  } catch {
                    toast.error("Export failed");
                  }
                }}
              >
                Export CSV
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

