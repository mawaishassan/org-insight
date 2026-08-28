"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import { generatePeriodOptions } from "@/lib/periodHelpers";
import { downloadBlob } from "@/lib/download";
import { getApiUrl } from "@/lib/api";
import {
  SubField,
  FieldSummary,
  MultiFilterConditionRow,
  emptyMultiFilterRow,
  payloadToFilterDraft,
  filterDraftToPayload,
  removeConditionFromPayload,
  truncateLabel,
} from "@/lib/multiItemsFiltersHelper";
import MultiItemsAdvancedFiltersPanel from "@/components/MultiItemsAdvancedFiltersPanel";
import { ColumnWidthConfigModal } from "@/components/ColumnWidthConfigModal";
import { TableFooterConfigModal, TableFooterConfig } from "@/components/TableFooterConfigModal";
import { MliFormulaBuilderModal } from "@/components/MliFormulaBuilderModal";
import { CustomDatePicker } from "@/components/CustomDatePicker";
import { LinkedConfigUI } from "@/components/LinkedConfigUI";

interface KPISubField {
  id: number;
  key: string;
  name: string;
  field_type: string;
  config?: any;
  is_required?: boolean;
}

interface KPIField {
  id: number;
  kpi_id: number;
  key: string;
  name: string;
  field_type: string;
  formula_expression?: string;
  sub_fields?: KPISubField[];
  is_required?: boolean;
  carry_forward_data?: boolean;
}

interface KPI {
  id: number;
  name: string;
  description?: string;
  fields: KPIField[];
  domain_id?: number;
  category_id?: number;
  entry_mode?: string;
  api_endpoint_url?: string;
  organization_tag_ids?: number[];
  organization_tags?: Array<{ id: number; name: string }>;
}

interface CustomReportField {
  id?: number;
  kpi_field_id: number;
  field_key: string;
  field_name: string;
  field_type: string;
  sort_order: number;
  kpi_id: number;
  config?: {
    selected_columns?: string[] | null;
    filters?: { conditions: any[]; _version: number } | null;
    column_widths?: Record<string, number> | null;
    custom_name?: string | null;
    merged_headers?: any[] | null;
    footer_config?: TableFooterConfig | null;
    [key: string]: any;
  } | null;
}

interface CustomReportSection {
  id?: number;
  kpi_id: number | null;
  kpi_name: string;
  custom_header: string | null;
  sort_order: number;
  fields: CustomReportField[];
}

interface CustomReportDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  sections: CustomReportSection[];
  fetch_data_with_date?: boolean;
  date_fetching_config?: any;
}

interface DomainRow {
  id: number;
  name: string;
}

interface CategoryRow {
  id: number;
  name: string;
  domain_id?: number;
}

const FIELD_TYPES = [
  "single_line_text",
  "multi_line_text",
  "number",
  "date",
  "boolean",
  "attachment",
  "reference",
  "multi_reference",
  "mixed_list",
  "multi_line_items",
  "formula",
] as const;

const FIELD_TYPE_LABELS: Record<string, string> = {
  single_line_text: "Single Line Text",
  multi_line_text: "Multi Line Text",
  number: "Number (Scalar)",
  date: "Date",
  boolean: "Boolean",
  attachment: "Attachment/File",
  reference: "Reference",
  multi_reference: "Multi Reference",
  mixed_list: "Mixed List",
  multi_line_items: "Table (Multi Line Items)",
  formula: "Formula",
};

const SUB_FIELD_TYPES = [
  "single_line_text",
  "multi_line_text",
  "number",
  "date",
  "boolean",
  "reference",
  "multi_reference",
  "attachment",
  "mixed_list",
  "formula",
] as const;

const SUB_FIELD_TYPE_LABELS: Record<string, string> = {
  single_line_text: "Single Line Text",
  multi_line_text: "Multi Line Text",
  number: "Number",
  date: "Date",
  boolean: "Boolean",
  reference: "Reference",
  multi_reference: "Multi Reference",
  attachment: "Attachment/File",
  mixed_list: "Mixed List",
  formula: "Formula",
};

function slugifyKey(name: string): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface FormulaRefKpi {
  id: number;
  name: string;
  fields: KPIField[];
}

const GROUP_FUNCTIONS = [
  { value: "COUNT_ITEMS", label: "COUNT" },
  { value: "SUM_ITEMS", label: "SUM (total)" },
  { value: "AVG_ITEMS", label: "AVG (average)" },
  { value: "MIN_ITEMS", label: "MIN" },
  { value: "MAX_ITEMS", label: "MAX" },
  { value: "COUNT_UNIQUE_ITEMS", label: "Count Unique" },
  { value: "FETCH_ITEMS", label: "Fetch Filtered MLI" },
] as const;

const WHERE_OPERATORS = [
  { value: "op_eq", label: "equals (=)" },
  { value: "op_neq", label: "not equals (≠)" },
  { value: "op_gt", label: "greater than (>)" },
  { value: "op_gte", label: "greater or equal (≥)" },
  { value: "op_lt", label: "less than (<)" },
  { value: "op_lte", label: "less or equal (≤)" },
  { value: "op_contains", label: "contains" },
  { value: "op_not_contains", label: "does not contain" },
  { value: "op_starts_with", label: "starts with" },
  { value: "op_ends_with", label: "ends with" },
] as const;

function operatorsForSubFieldType(fieldType: string | undefined): readonly { value: string; label: string }[] {
  const ft = fieldType ?? "";
  const cmp = WHERE_OPERATORS.filter((o) =>
    ["op_eq", "op_neq", "op_gt", "op_gte", "op_lt", "op_lte"].includes(o.value)
  );
  const text = WHERE_OPERATORS.filter((o) =>
    ["op_eq", "op_neq", "op_contains", "op_not_contains", "op_starts_with", "op_ends_with"].includes(o.value)
  );
  if (ft === "number" || ft === "date") return cmp;
  if (ft === "boolean") return WHERE_OPERATORS.filter((o) => ["op_eq", "op_neq"].includes(o.value));
  if (ft === "reference" || ft === "multi_reference") return text;
  return text;
}

function quoteFormulaWhereValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("CurrentRow.")) {
    return trimmed;
  }
  const isNumeric = trimmed !== "" && !Number.isNaN(Number(trimmed));
  return isNumeric ? trimmed : `'${trimmed.replace(/'/g, "\\'")}'`;
}

function FormulaBuilder({
  formulaValue,
  onInsert,
  fields,
  organizationId,
  currentKpiId,
  currentMliSubFields,
  currentSubFieldKey,
}: {
  formulaValue: string;
  onInsert: (text: string) => void;
  fields: KPIField[];
  organizationId?: number;
  currentKpiId?: number;
  currentMliSubFields?: KPISubField[];
  currentSubFieldKey?: string;
}) {
  type WhereCondition = {
    filterSubKey: string;
    op: string;
    value: string;
    compareType?: "constant" | "subfield" | "scalar" | "other_scalar";
    multiValues: string[];
    logicWithPrev: "op_and" | "op_or";
  };

  const [sourceKpi, setSourceKpi] = useState<"current" | "other">("current");
  const [selectedFieldKey, setSelectedFieldKey] = useState<string>("");
  const [refSubKey, setRefSubKey] = useState("");
  const [refGroupFn, setRefGroupFn] = useState<string>("COUNT_ITEMS");
  const [primaryGroupByKey, setPrimaryGroupByKey] = useState<string>("");
  const [secondaryGroupByKey, setSecondaryGroupByKey] = useState<string>("");
  const [useConditional, setUseConditional] = useState(false);
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([
    { filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" },
  ]);
  const [refAllowedValues, setRefAllowedValues] = useState<Record<string, string[]>>({});
  const [otherKpis, setOtherKpis] = useState<FormulaRefKpi[]>([]);
  const [refOtherKpiId, setRefOtherKpiId] = useState<number | "">("");

  const [fetchSeparator, setFetchSeparator] = useState<string>(", ");
  const [fetchRemoveDuplicates, setFetchRemoveDuplicates] = useState<boolean>(true);
  const [fetchSortOrder, setFetchSortOrder] = useState<"none" | "asc" | "desc">("none");
  const [fetchEmptyFallback, setFetchEmptyFallback] = useState<string>("");

  const token = getAccessToken();
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<{ role: string | { value?: string } }>("/auth/me", { token })
      .then((me) => {
        const r = me.role;
        setUserRole(typeof r === "string" ? r : r?.value ?? null);
      })
      .catch(() => setUserRole(null));
  }, [token]);

  const currentMliFieldKey = useMemo(() => {
    if (!currentMliSubFields || currentMliSubFields.length === 0) return null;
    const match = fields.find((f) => {
      if (!f.sub_fields || f.sub_fields.length !== currentMliSubFields.length) return false;
      return f.sub_fields.every((sf, idx) => sf.key === currentMliSubFields[idx].key);
    });
    return match?.key || null;
  }, [fields, currentMliSubFields]);

  const isCurrentMliSelected = sourceKpi === "current" && selectedFieldKey === currentMliFieldKey;

  useEffect(() => {
    if (!token || organizationId == null) return;
    const params: Record<string, string> = { organization_id: String(organizationId) };
    if (currentKpiId != null) {
      params.exclude_kpi_id = String(currentKpiId);
    }
    const qs = new URLSearchParams(params);
    api<FormulaRefKpi[]>(`/kpis/formula-refs?${qs}`, { token })
      .then(setOtherKpis)
      .catch(() => setOtherKpis([]));
  }, [token, organizationId, currentKpiId]);

  const handleSourceKpiChange = (type: "current" | "other") => {
    setSourceKpi(type);
    setSelectedFieldKey("");
    setRefOtherKpiId("");
    setRefSubKey("");
    setPrimaryGroupByKey("");
    setSecondaryGroupByKey("");
    setUseConditional(false);
    setWhereConditions([{ filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" }]);
  };

  const isOther = sourceKpi === "other";
  const selectedOtherKpi = refOtherKpiId === "" ? null : otherKpis.find((k) => k.id === refOtherKpiId);
  const otherKpiFields = selectedOtherKpi?.fields ?? [];

  const activeField = isOther
    ? (selectedOtherKpi?.fields.find((f) => f.key === selectedFieldKey) ?? null)
    : (fields.find((f) => f.key === selectedFieldKey) ?? null);

  const activeMliField = activeField?.field_type === "multi_line_items" ? activeField : null;
  const subFields = activeMliField ? (activeMliField.sub_fields ?? []) : [];
  const primaryCond = whereConditions[0];
  const refFilterSubKey = primaryCond?.filterSubKey ?? "";
  const canInsertNumber = activeField?.field_type === "number" || activeField?.field_type === "formula";
  const isCountItemsOnly = refGroupFn === "COUNT_ITEMS";
  const isConditionalWhere = (useConditional || refGroupFn === "FETCH_ITEMS") && activeMliField !== null && !!refFilterSubKey;
  const isCountWhere = refGroupFn === "COUNT_ITEMS";
  const canInsertItems = activeMliField !== null && (
    primaryGroupByKey !== ""
      ? (isCountItemsOnly || (subFields.length > 0 && !!refSubKey))
      : (isConditionalWhere
          ? (isCountWhere ? !!refFilterSubKey : (subFields.length > 0 && !!refSubKey && !!refFilterSubKey))
          : (isCountItemsOnly || (subFields.length > 0 && !!refSubKey)))
  );

  const getRefSourceFromSubKey = (subKey: string): { cacheKey: string; sid: number; skey: string; sourceSubKey?: string } | null => {
    const isCur = subKey.startsWith("CurrentRow.");
    const sfKey = isCur ? subKey.substring(11) : subKey;
    const sf = isCur
      ? currentMliSubFields?.find((s: KPISubField) => s.key === sfKey)
      : subFields.find((s: KPISubField) => s.key === sfKey);
    if (!sf || (sf.field_type !== "reference" && sf.field_type !== "multi_reference")) return null;
    const cfg = (sf.config ?? {}) as any;
    const sid = cfg.reference_source_kpi_id;
    const skey = cfg.reference_source_field_key;
    if (!sid || !skey) return null;
    const sourceSubKey = cfg.reference_source_sub_field_key;
    const cacheKey = `${sid}-${skey}${sourceSubKey ? `-${sourceSubKey}` : ""}`;
    return { cacheKey, sid, skey, sourceSubKey };
  };

  useEffect(() => {
    if (!token || organizationId == null || subFields.length === 0) return;
    const refs = whereConditions
      .map((c) => getRefSourceFromSubKey(c.filterSubKey))
      .filter((x): x is { cacheKey: string; sid: number; skey: string; sourceSubKey?: string } => !!x);
    const unique = new Map<string, { sid: number; skey: string; sourceSubKey?: string }>();
    refs.forEach((r) => {
      if (!unique.has(r.cacheKey)) unique.set(r.cacheKey, { sid: r.sid, skey: r.skey, sourceSubKey: r.sourceSubKey });
    });
    unique.forEach((meta, cacheKey) => {
      if (refAllowedValues[cacheKey]) return;
      const params = new URLSearchParams({
        source_kpi_id: String(meta.sid),
        source_field_key: meta.skey,
        organization_id: String(organizationId),
      });
      if (meta.sourceSubKey) params.set("source_sub_field_key", meta.sourceSubKey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params.toString()}`, { token })
        .then((r) => setRefAllowedValues((prev) => ({ ...prev, [cacheKey]: r.values || [] })))
        .catch(() => setRefAllowedValues((prev) => ({ ...prev, [cacheKey]: [] })));
    });
  }, [token, organizationId, subFields, whereConditions, refAllowedValues]);

  const handleInsertItems = () => {
    if (!activeMliField) return;
    const isOther = sourceKpi === "other";
    const kpiIdPrefix = isOther ? `${refOtherKpiId}, ` : "";

    if (refGroupFn === "FETCH_ITEMS") {
      const fnName = isOther ? "FETCH_KPI_ITEMS_WHERE" : "FETCH_ITEMS_WHERE";
      const separatorQuote = `"${(fetchSeparator || "").replace(/"/g, '\\"')}"`;
      const removeDupsVal = fetchRemoveDuplicates ? "yes" : "no";
      const sortVal = `"${fetchSortOrder}"`;
      const fallbackQuote = `"${(fetchEmptyFallback || "").replace(/"/g, '\\"')}"`;

      const condArgs: string[] = [];
      whereConditions.forEach((c, idx) => {
        if (!c.filterSubKey) return;
        const isLhsCurrent = c.filterSubKey.startsWith("CurrentRow.");
        const resolvedFilterSubKey = isLhsCurrent ? c.filterSubKey.substring(11) : c.filterSubKey;

        const sfRow = subFields.find((s: KPISubField) => s.key === (isLhsCurrent ? c.value : resolvedFilterSubKey));
        const allowedOps = operatorsForSubFieldType(sfRow?.field_type);
        const resolvedOp = allowedOps.some((o) => o.value === c.op) ? c.op : (allowedOps[0]?.value ?? "op_eq");

        const raw = String(c.value ?? "").trim();
        if (!raw) return;

        if (idx > 0) condArgs.push(`"${c.logicWithPrev}"`);

        if (isLhsCurrent) {
          const val = `CurrentRow.${resolvedFilterSubKey}`;
          if (isOther) {
            condArgs.push(`"${raw}"`, `"${resolvedOp}"`, val);
          } else {
            condArgs.push(raw, resolvedOp, val);
          }
        } else {
          const isUnquoted = c.compareType === "subfield" || c.compareType === "scalar" || c.compareType === "other_scalar";
          const val = isUnquoted ? raw : quoteFormulaWhereValue(raw);
          if (isOther) {
            condArgs.push(`"${resolvedFilterSubKey}"`, `"${resolvedOp}"`, val);
          } else {
            condArgs.push(resolvedFilterSubKey, resolvedOp, val);
          }
        }
      });

      const prefix = isOther
        ? `${refOtherKpiId}, "${activeMliField.key}", "${refSubKey}", ${separatorQuote}, "${removeDupsVal}", ${sortVal}, ${fallbackQuote}`
        : `"${activeMliField.key}", "${refSubKey}", ${separatorQuote}, "${removeDupsVal}", ${sortVal}, ${fallbackQuote}`;

      const finalExpr = condArgs.length > 0
        ? `${fnName}(${prefix}, ${condArgs.join(", ")})`
        : `${fnName}(${prefix})`;

      onInsert(finalExpr);
      return;
    }

    if (primaryGroupByKey !== "") {
      let leafAggStr = "";
      if (refGroupFn === "COUNT_ITEMS") {
        leafAggStr = refSubKey ? `COUNT(${refSubKey})` : "COUNT()";
      } else if (refGroupFn === "COUNT_UNIQUE_ITEMS") {
        leafAggStr = refSubKey ? `UNIQUE_COUNT(${refSubKey})` : "UNIQUE_COUNT()";
      } else if (refGroupFn === "SUM_ITEMS") {
        leafAggStr = `SUM(${refSubKey})`;
      } else if (refGroupFn === "AVG_ITEMS") {
        leafAggStr = `AVG(${refSubKey})`;
      } else if (refGroupFn === "MIN_ITEMS") {
        leafAggStr = `MIN(${refSubKey})`;
      } else if (refGroupFn === "MAX_ITEMS") {
        leafAggStr = `MAX(${refSubKey})`;
      }

      let condStr = "";
      if (isConditionalWhere) {
        const condArgs: string[] = [];
        whereConditions.forEach((c, idx) => {
          if (!c.filterSubKey) return;
          const isLhsCurrent = c.filterSubKey.startsWith("CurrentRow.");
          const resolvedFilterSubKey = isLhsCurrent ? c.filterSubKey.substring(11) : c.filterSubKey;
          const sfRow = subFields.find((s: KPISubField) => s.key === (isLhsCurrent ? c.value : resolvedFilterSubKey));
          const allowedOps = operatorsForSubFieldType(sfRow?.field_type);
          const resolvedOp = allowedOps.some((o) => o.value === c.op) ? c.op : (allowedOps[0]?.value ?? "op_eq");
          const raw = String(c.value ?? "").trim();
          if (!raw) return;
          if (idx > 0) condArgs.push(c.logicWithPrev);
          if (isLhsCurrent) {
            condArgs.push(raw, resolvedOp, `CurrentRow.${resolvedFilterSubKey}`);
          } else {
            const isUnquoted = c.compareType === "subfield" || c.compareType === "scalar" || c.compareType === "other_scalar";
            const val = isUnquoted ? raw : quoteFormulaWhereValue(raw);
            condArgs.push(resolvedFilterSubKey, resolvedOp, val);
          }
        });
        if (condArgs.length >= 3) {
          condStr = `WHERE(${condArgs.join(", ")})`;
        }
      }

      let innerExpr = leafAggStr;
      if (secondaryGroupByKey !== "") {
        innerExpr = `GROUP_BY(${secondaryGroupByKey}, ${leafAggStr})`;
      }

      let groupExpr = "";
      if (condStr) {
        groupExpr = `GROUP_BY(${primaryGroupByKey}, ${condStr}, ${innerExpr})`;
      } else {
        groupExpr = `GROUP_BY(${primaryGroupByKey}, ${innerExpr})`;
      }

      if (isOther) {
        onInsert(`KPI_GROUP_BY(${refOtherKpiId}, "${activeMliField.key}", ${groupExpr})`);
      } else {
        onInsert(groupExpr);
      }
      return;
    }

    let baseFn = refGroupFn;
    if (isOther) {
      baseFn = refGroupFn.replace("_ITEMS", "_KPI_ITEMS");
    }

    if (isConditionalWhere) {
      const condArgs: string[] = [];
      whereConditions.forEach((c, idx) => {
        if (!c.filterSubKey) return;
        const isLhsCurrent = c.filterSubKey.startsWith("CurrentRow.");
        const resolvedFilterSubKey = isLhsCurrent ? c.filterSubKey.substring(11) : c.filterSubKey;

        const sfRow = subFields.find((s: KPISubField) => s.key === (isLhsCurrent ? c.value : resolvedFilterSubKey));
        const allowedOps = operatorsForSubFieldType(sfRow?.field_type);
        const resolvedOp = allowedOps.some((o) => o.value === c.op) ? c.op : (allowedOps[0]?.value ?? "op_eq");

        const rawVals: string[] = [c.value];
        const trimmedVals = rawVals.map((r) => String(r ?? "").trim()).filter((v) => v !== "");
        if (trimmedVals.length === 0) return;

        const raw = trimmedVals[0]!;

        if (idx > 0) condArgs.push(c.logicWithPrev);

        if (isLhsCurrent) {
          const val = `CurrentRow.${resolvedFilterSubKey}`;
          if (isOther) {
            condArgs.push(`"${raw}"`, `"${resolvedOp}"`, val);
          } else {
            condArgs.push(raw, resolvedOp, val);
          }
        } else {
          const isUnquoted = c.compareType === "subfield" || c.compareType === "scalar" || c.compareType === "other_scalar";
          const val = isUnquoted ? raw : quoteFormulaWhereValue(raw);
          if (isOther) {
            condArgs.push(`"${resolvedFilterSubKey}"`, `"${resolvedOp}"`, val);
          } else {
            condArgs.push(resolvedFilterSubKey, resolvedOp, val);
          }
        }
      });
      if (condArgs.length < 3) return;
      const whereFn = baseFn.endsWith("_WHERE") ? baseFn : baseFn + "_WHERE";
      if (whereFn === "COUNT_ITEMS_WHERE" || whereFn === "COUNT_KPI_ITEMS_WHERE") {
        onInsert(isOther
          ? `${whereFn}(${kpiIdPrefix}"${activeMliField.key}", ${condArgs.join(", ")})`
          : `${whereFn}(${activeMliField.key}, ${condArgs.join(", ")})`
        );
      } else {
        onInsert(isOther
          ? `${whereFn}(${kpiIdPrefix}"${activeMliField.key}", "${refSubKey}", ${condArgs.join(", ")})`
          : `${whereFn}(${activeMliField.key}, ${refSubKey}, ${condArgs.join(", ")})`
        );
      }
      return;
    }

    if (refGroupFn === "COUNT_ITEMS" && !refSubKey) {
      onInsert(isOther
        ? `COUNT_KPI_ITEMS(${refOtherKpiId}, "${activeMliField.key}")`
        : `COUNT_ITEMS(${activeMliField.key})`
      );
    } else {
      onInsert(isOther
        ? `${baseFn}(${kpiIdPrefix}"${activeMliField.key}", "${refSubKey}")`
        : `${baseFn}(${activeMliField.key}, ${refSubKey})`
      );
    }
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem", background: "var(--bg-subtle, #f8f9fa)", width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowX: "hidden" }}>
      {currentMliSubFields && currentMliSubFields.length > 0 && (
        <div style={{ marginBottom: "0.85rem", padding: "0.75rem", background: "var(--surface)", border: "1px solid var(--primary)", borderRadius: 8 }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span>⚡ Same Row Sub-field (Formula for Each Row)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <select
              style={{ flex: "1 1 240px", padding: "0.38rem 0.55rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", background: "white" }}
              value=""
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  onInsert(`CurrentRow.${val}`);
                }
              }}
            >
              <option value="">— Select Sub-field (e.g. CurrentRow.key) —</option>
              {currentMliSubFields
                .filter((sf) => sf.key !== currentSubFieldKey)
                .map((sf) => (
                  <option key={sf.key} value={sf.key}>
                    {sf.name} ({sf.key}) → CurrentRow.{sf.key}
                  </option>
                ))}
            </select>

            <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Operators:</span>
              {["+", "-", "*", "/", "(", ")"].map((op) => (
                <button
                  key={op}
                  type="button"
                  className="btn"
                  style={{ padding: "0.2rem 0.45rem", fontSize: "0.85rem", fontFamily: "monospace", minWidth: "28px" }}
                  onClick={() => onInsert(` ${op} `)}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Insert reference / Aggregation</div>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>Source:</span>
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
          <input
            type="radio"
            name="source_kpi_type"
            checked={sourceKpi === "current"}
            onChange={() => handleSourceKpiChange("current")}
          />
          Current KPI
        </label>
        {organizationId != null && otherKpis.length > 0 && (
          <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="source_kpi_type"
              checked={sourceKpi === "other"}
              onChange={() => handleSourceKpiChange("other")}
            />
            Other KPI
          </label>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", marginBottom: "0.75rem", width: "100%", boxSizing: "border-box" }}>
        {isOther && (
          <div style={{ flex: "1 1 180px", minWidth: "160px", maxWidth: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Select KPI</label>
            <select
              value={refOtherKpiId}
              onChange={(e) => {
                setRefOtherKpiId(e.target.value ? Number(e.target.value) : "");
                setSelectedFieldKey("");
                setRefSubKey("");
                setUseConditional(false);
                setWhereConditions([{ filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" }]);
              }}
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
            >
              <option value="">— Select KPI —</option>
              {otherKpis.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
        )}

        {(!isOther || refOtherKpiId !== "") && (
          <div style={{ flex: "1 1 200px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
            <select
              value={selectedFieldKey}
              onChange={(e) => {
                setSelectedFieldKey(e.target.value);
                setRefSubKey("");
                setUseConditional(false);
                setWhereConditions([{ filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" }]);
              }}
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
            >
              <option value="">— Select field —</option>
              {(isOther ? otherKpiFields : fields).map((f) => (
                <option key={f.key} value={f.key}>
                  {truncateLabel(`${f.name} (${f.key})`, 64)}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeMliField !== null && subFields.length > 0 && (
          <>
            <div style={{ flex: "1 1 150px", minWidth: "130px", maxWidth: "100%", boxSizing: "border-box" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Target Sub-field</label>
              <select value={refSubKey} onChange={(e) => setRefSubKey(e.target.value)} style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}>
                <option value="">
                  {useConditional && refGroupFn === "COUNT_ITEMS"
                    ? "— N/A for COUNT where —"
                    : refGroupFn === "COUNT_ITEMS" && !useConditional
                      ? "Row count (no sub-field)"
                      : "— Select —"}
                </option>
                {subFields.map((s: KPISubField) => (
                  <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 140px", minWidth: "120px", maxWidth: "100%", boxSizing: "border-box" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Group function</label>
              <select value={refGroupFn} onChange={(e) => setRefGroupFn(e.target.value)} style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}>
                {GROUP_FUNCTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 150px", minWidth: "130px", maxWidth: "100%", boxSizing: "border-box" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Group By</label>
              <select
                value={primaryGroupByKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setPrimaryGroupByKey(val);
                  if (!val) setSecondaryGroupByKey("");
                }}
                style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
              >
                <option value="">— None (No Group By) —</option>
                {subFields.map((s: KPISubField) => (
                  <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                ))}
              </select>
            </div>
            {primaryGroupByKey !== "" && (
              <div style={{ flex: "1 1 160px", minWidth: "140px", maxWidth: "100%", boxSizing: "border-box" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Secondary Group By (Optional)</label>
                <select
                  value={secondaryGroupByKey}
                  onChange={(e) => setSecondaryGroupByKey(e.target.value)}
                  style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
                >
                  <option value="">— None —</option>
                  {subFields
                    .filter((s: KPISubField) => s.key !== primaryGroupByKey)
                    .map((s: KPISubField) => (
                      <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                    ))}
                </select>
              </div>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", height: "34px", alignSelf: "flex-end", cursor: "pointer", marginBottom: "0.25rem" }}>
              <input
                type="checkbox"
                checked={refGroupFn === "FETCH_ITEMS" ? true : useConditional}
                disabled={refGroupFn === "FETCH_ITEMS"}
                onChange={(e) => setUseConditional(e.target.checked)}
              />
              Conditional (where)
            </label>
          </>
        )}

      </div>

      {refGroupFn === "FETCH_ITEMS" && activeMliField && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem", width: "100%", boxSizing: "border-box", padding: "0.75rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Separator</label>
            <input
              type="text"
              value={fetchSeparator}
              onChange={(e) => setFetchSeparator(e.target.value)}
              placeholder="e.g. , "
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Remove Duplicates</label>
            <select
              value={fetchRemoveDuplicates ? "yes" : "no"}
              onChange={(e) => setFetchRemoveDuplicates(e.target.value === "yes")}
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Sort Order</label>
            <select
              value={fetchSortOrder}
              onChange={(e) => setFetchSortOrder(e.target.value as any)}
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
            >
              <option value="none">Source Order</option>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Empty Fallback</label>
            <input
              type="text"
              value={fetchEmptyFallback}
              onChange={(e) => setFetchEmptyFallback(e.target.value)}
              placeholder="e.g. N/A"
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box" }}
            />
          </div>
        </div>
      )}

      {(useConditional || refGroupFn === "FETCH_ITEMS") && activeMliField && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%", boxSizing: "border-box", marginTop: "0.5rem" }}>
          {whereConditions.map((c, idx) => {
            const isLhsCurrent = c.filterSubKey.startsWith("CurrentRow.");
            const resolvedLhsSubKey = isLhsCurrent ? c.filterSubKey.substring(11) : c.filterSubKey;

            const sfCond = isLhsCurrent
              ? currentMliSubFields?.find((s: KPISubField) => s.key === resolvedLhsSubKey)
              : subFields.find((s: KPISubField) => s.key === resolvedLhsSubKey);
            const ftCond = sfCond?.field_type ?? "";
            const opChoices = operatorsForSubFieldType(ftCond);
            const opSelectValue = opChoices.some((o) => o.value === c.op) ? c.op : (opChoices[0]?.value ?? "op_eq");
            const refMetaRow = getRefSourceFromSubKey(c.filterSubKey);
            const refOptions = refMetaRow ? refAllowedValues[refMetaRow.cacheKey] || [] : [];
            const setRow = (patch: Partial<WhereCondition>) =>
              setWhereConditions((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

            return (
              <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end", borderBottom: "1px dashed var(--border)", paddingBottom: "0.75rem", width: "100%", boxSizing: "border-box" }}>
                {idx > 0 && (
                  <div style={{ flex: "1 1 80px", minWidth: "70px", maxWidth: "100%" }}>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Link</label>
                    <select
                      value={c.logicWithPrev}
                      onChange={(e) =>
                        setWhereConditions((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, logicWithPrev: e.target.value as "op_and" | "op_or" } : x))
                        )
                      }
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
                    >
                      <option value="op_and">AND</option>
                      <option value="op_or">OR</option>
                    </select>
                  </div>
                )}
                <div style={{ flex: "1 1 180px", minWidth: "160px", maxWidth: "100%" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
                  <select
                    value={c.filterSubKey}
                    onChange={(e) => {
                      const key = e.target.value;
                      const isCur = key.startsWith("CurrentRow.");
                      const sfKey = isCur ? key.substring(11) : key;
                      const sf = isCur
                        ? currentMliSubFields?.find((s: KPISubField) => s.key === sfKey)
                        : subFields.find((s: KPISubField) => s.key === sfKey);
                      const nextOps = operatorsForSubFieldType(sf?.field_type);
                      const nextOp = nextOps[0]?.value ?? "op_eq";
                      setWhereConditions((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, filterSubKey: key, op: nextOp, value: "", compareType: isCur ? "subfield" : "constant", multiValues: [] } : x
                        )
                      );
                    }}
                    style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
                  >
                    <option value="">— Select field —</option>
                    {subFields.map((s: KPISubField) => (
                      <option key={s.key} value={s.key}>
                        {s.name} ({s.key})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 130px", minWidth: "110px", maxWidth: "100%" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Operator</label>
                  <select
                    value={opSelectValue}
                    onChange={(e) => {
                      const next = e.target.value;
                      setWhereConditions((prev) =>
                        prev.map((x, i) => {
                          if (i !== idx) return x;
                          const collapseMulti =
                            next !== "op_eq" && next !== "op_neq" && (x.multiValues?.length ?? 0) > 0;
                          return {
                            ...x,
                            op: next,
                            ...(collapseMulti
                              ? { value: x.multiValues?.[0] ?? x.value, multiValues: [] }
                              : {}),
                          };
                        })
                      );
                    }}
                    style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
                  >
                    {opChoices.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "2 1 220px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Value</label>

                  {c.filterSubKey && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.25rem" }}>
                      {c.filterSubKey.startsWith("CurrentRow.") ? (
                        <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name={`compare_type_${idx}`}
                            checked={true}
                            readOnly
                          />
                          Selected MLI Subfield
                        </label>
                      ) : (
                        <>
                          <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name={`compare_type_${idx}`}
                              checked={!c.compareType || c.compareType === "constant"}
                              onChange={() => setRow({ compareType: "constant", value: "" })}
                            />
                            Constant
                          </label>
                          {currentMliSubFields && currentMliSubFields.length > 0 && (
                            <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                              <input
                                type="radio"
                                name={`compare_type_${idx}`}
                                checked={c.compareType === "subfield"}
                                onChange={() => setRow({ compareType: "subfield", value: "" })}
                              />
                              Row Subfield
                            </label>
                          )}
                          <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name={`compare_type_${idx}`}
                              checked={c.compareType === "scalar"}
                              onChange={() => setRow({ compareType: "scalar", value: "" })}
                            />
                            Scalar Field
                          </label>
                          <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name={`compare_type_${idx}`}
                              checked={c.compareType === "other_scalar"}
                              onChange={() => setRow({ compareType: "other_scalar", value: "" })}
                            />
                            {userRole === "SUPER_ADMIN" ? "Other KPI Field/Subfield" : "Other KPI Scalar"}
                          </label>
                        </>
                      )}
                    </div>
                  )}

                  {!c.filterSubKey ? (
                    <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "inline-block", padding: "0.35rem 0" }}>Select a field first</span>
                  ) : c.filterSubKey.startsWith("CurrentRow.") ? (
                    <select
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
                    >
                      <option value="">— Select selected KPI subfield —</option>
                      {subFields.map((sf) => (
                        <option key={sf.key} value={sf.key}>
                          {sf.name} ({sf.key})
                        </option>
                      ))}
                    </select>
                  ) : c.compareType === "subfield" ? (
                    <select
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
                    >
                      <option value="">— Select subfield —</option>
                      {currentMliSubFields
                        ?.filter((sf) => sf.key !== currentSubFieldKey)
                        .map((sf) => (
                          <option key={sf.key} value={`CurrentRow.${sf.key}`}>
                            {sf.name} ({sf.key})
                          </option>
                        ))}
                    </select>
                  ) : c.compareType === "scalar" ? (
                    <select
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
                    >
                      <option value="">— Select scalar field —</option>
                      {fields
                        .filter((f) => f.field_type !== "multi_line_items")
                        .map((f) => (
                          <option key={f.id} value={f.key}>
                            {f.name} ({f.key})
                          </option>
                        ))}
                    </select>
                  ) : c.compareType === "other_scalar" ? (
                    (() => {
                      const parseKpiFieldCall = (val: string) => {
                        const match = /^KPI_FIELD\((\d+),\s*["']([^"']*)["']\)$/.exec(val);
                        if (!match) return { kpiId: "", fieldKey: "", subKey: "" };
                        const kpiId = Number(match[1]);
                        const fullKey = match[2];
                        if (fullKey.includes(".")) {
                          const parts = fullKey.split(".");
                          return { kpiId, fieldKey: parts[0], subKey: parts[1] };
                        }
                        return { kpiId, fieldKey: fullKey, subKey: "" };
                      };
                      const parsed = parseKpiFieldCall(c.value);
                      const activeOtherKpi = parsed.kpiId ? otherKpis.find((k) => k.id === parsed.kpiId) : null;
                      
                      const isSuper = userRole === "SUPER_ADMIN";
                      const otherFields = activeOtherKpi?.fields?.filter((f) => isSuper || f.field_type !== "multi_line_items") ?? [];
                      const selectedField = otherFields.find((f) => f.key === parsed.fieldKey);
                      const isMli = selectedField?.field_type === "multi_line_items";
                      const otherSubFields = selectedField?.sub_fields ?? [];

                      return (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", width: "100%", boxSizing: "border-box" }}>
                          <select
                            value={parsed.kpiId}
                            onChange={(e) => {
                              const kid = e.target.value ? Number(e.target.value) : "";
                              setRow({ value: kid ? `KPI_FIELD(${kid}, "")` : "" });
                            }}
                            style={{ flex: "1 1 120px", minWidth: "100px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
                          >
                            <option value="">— Select KPI —</option>
                            {otherKpis.map((k) => (
                              <option key={k.id} value={k.id}>{k.name}</option>
                            ))}
                          </select>
                          <select
                            value={parsed.fieldKey}
                            onChange={(e) => {
                              const fk = e.target.value;
                              const f = otherFields.find((x) => x.key === fk);
                              if (f?.field_type === "multi_line_items") {
                                setRow({ value: parsed.kpiId ? `KPI_FIELD(${parsed.kpiId}, "${fk}.")` : "" });
                              } else {
                                setRow({ value: parsed.kpiId ? `KPI_FIELD(${parsed.kpiId}, "${fk}")` : "" });
                              }
                            }}
                            disabled={!parsed.kpiId}
                            style={{ flex: "1 1 120px", minWidth: "100px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
                          >
                            <option value="">— Select Field —</option>
                            {otherFields.map((f) => (
                              <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                            ))}
                          </select>
                          {isSuper && isMli && (
                            <select
                              value={parsed.subKey}
                              onChange={(e) => {
                                const sk = e.target.value;
                                setRow({ value: parsed.kpiId ? `KPI_FIELD(${parsed.kpiId}, "${parsed.fieldKey}.${sk}")` : "" });
                              }}
                              disabled={!parsed.fieldKey}
                              style={{ flex: "1 1 120px", minWidth: "100px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
                            >
                              <option value="">— Select Sub-field —</option>
                              {otherSubFields.map((sf) => (
                                <option key={sf.key} value={sf.key}>{sf.name} ({sf.key})</option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })()
                  ) : ftCond === "boolean" ? (
                    <select
                      value={c.value === "True" || c.value === "False" ? c.value : ""}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
                    >
                      <option value="">—</option>
                      <option value="True">Yes</option>
                      <option value="False">No</option>
                    </select>
                  ) : ftCond === "number" ? (
                    <input
                      type="number"
                      step="any"
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                      placeholder="Number"
                    />
                  ) : ftCond === "date" ? (
                    <CustomDatePicker
                      value={c.value.length >= 10 ? c.value.slice(0, 10) : c.value}
                      onChange={(nextVal) => setRow({ value: nextVal || "" })}
                      style={{ width: "100%" }}
                    />
                  ) : ftCond === "reference" && refMetaRow ? (
                    refOptions.length > 0 ? (
                      !c.value || refOptions.includes(c.value) ? (
                        <select
                          value={refOptions.includes(c.value) ? c.value : ""}
                          onChange={(e) => setRow({ value: e.target.value })}
                          style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis", background: "white" }}
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
                          style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                        />
                      )
                    ) : (
                      <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Loading values...</span>
                    )
                  ) : (
                    <input
                      type="text"
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  )}
                </div>
                {whereConditions.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setWhereConditions((prev) => prev.filter((_, i) => i !== idx))}
                    style={{ padding: "0.35rem 0.65rem", borderRadius: 6, height: "34px", display: "inline-flex", alignItems: "center", alignSelf: "flex-end" }}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              setWhereConditions((prev) => [
                ...prev,
                { filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" },
              ])
            }
            style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}
          >
            + Add condition
          </button>
        </div>
      )}

      <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Operators:</span>
          {[" + ", " - ", " * ", " / ", " ( ", " ) "].map((op) => (
            <button key={op} type="button" className="btn" onClick={() => onInsert(op)} style={{ padding: "0.25rem 0.5rem", fontSize: "0.9rem" }}>{op.trim() || op}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canInsertNumber && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (isOther) {
                  onInsert(`KPI_FIELD(${refOtherKpiId}, "${selectedFieldKey}")`);
                } else {
                  onInsert(selectedFieldKey);
                }
              }}
              style={{ height: "34px", display: "inline-flex", alignItems: "center" }}
            >
              Insert field
            </button>
          )}

          {canInsertItems && activeMliField && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleInsertItems}
              style={{ height: "34px", display: "inline-flex", alignItems: "center" }}
            >
              Insert
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CustomReportDesignPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgId = Number(searchParams.get("organization_id"));

  const [report, setReport] = useState<CustomReportDetail | null>(null);
  const [sections, setSections] = useState<CustomReportSection[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [openSectionMenuIdx, setOpenSectionMenuIdx] = useState<number | null>(null);
  const [openFieldMenuLoc, setOpenFieldMenuLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  const [editingFooterLoc, setEditingFooterLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  const [editingWidthsLoc, setEditingWidthsLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);

  // KPI Search lists
  const [allKpis, setAllKpis] = useState<KPI[]>([]);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSaving, setSaveSaving] = useState(false);
  const [fetchDataWithDate, setFetchDataWithDate] = useState<boolean>(false);
  const [dateFetchingConfig, setDateFetchingConfig] = useState<any>({});

  const [reportHeaderId, setReportHeaderId] = useState<number | null>(null);
  const [showReportName, setShowReportName] = useState<boolean>(false);
  const [brandingTitle, setBrandingTitle] = useState<string>("");
  const [scalarBold, setScalarBold] = useState<boolean>(true);
  const [scalarFontSize, setScalarFontSize] = useState<number>(11);
  const [mliFontSize, setMliFontSize] = useState<number>(10);
  const [scalarFontFamily, setScalarFontFamily] = useState<string>("Inter");
  const [mliFontFamily, setMliFontFamily] = useState<string>("Inter");
  const [showOdooButton, setShowOdooButton] = useState<boolean>(false);
  const [customReportHeaders, setCustomReportHeaders] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);

  const [localReportHeaderId, setLocalReportHeaderId] = useState<number | null>(null);
  const [localShowReportName, setLocalShowReportName] = useState<boolean>(false);
  const [localBrandingTitle, setLocalBrandingTitle] = useState<string>("");
  const [localScalarBold, setLocalScalarBold] = useState<boolean>(true);
  const [localScalarFontSize, setLocalScalarFontSize] = useState<number>(11);
  const [localMliFontSize, setLocalMliFontSize] = useState<number>(10);
  const [localScalarFontFamily, setLocalScalarFontFamily] = useState<string>("Inter");
  const [localMliFontFamily, setLocalMliFontFamily] = useState<string>("Inter");
  const [localShowOdooButton, setLocalShowOdooButton] = useState<boolean>(false);
  const [hoverBtn, setHoverBtn] = useState<string | null>(null);
  const [odooSyncKpiIds, setOdooSyncKpiIds] = useState<number[]>([]);
  const [localOdooSyncKpiIds, setLocalOdooSyncKpiIds] = useState<number[]>([]);
  const [odooConfiguredKpis, setOdooConfiguredKpis] = useState<{id: number; name: string}[]>([]);
  const [applyFurtherProcessing, setApplyFurtherProcessing] = useState<boolean>(false);
  const [localApplyFurtherProcessing, setLocalApplyFurtherProcessing] = useState<boolean>(false);

  // Live Preview properties (Explicit generation only)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewYear, setPreviewYear] = useState(() => new Date().getFullYear());
  const [previewLoading, setPreviewLoading] = useState(false);

  // Active workspace pane controls
  // activeItem: { type: 'outline' | 'general' | 'section' | 'field' | 'attachment' | 'kpi-create' | 'kpi-test', index?: number, secIdx?: number, fieldIdx?: number, kpiId?: number }
  const [activeItem, setActiveItem] = useState<{
    type: "outline" | "general" | "section" | "field" | "attachment" | "kpi-create" | "kpi-test";
    index?: number;
    secIdx?: number;
    fieldIdx?: number;
    kpiId?: number;
  }>({ type: "outline" });

  const [activeMliTab, setActiveMliTab] = useState<"columns" | "widths" | "filters" | "footer">("columns");

  // KPI Creator details state
  const [newKpiName, setNewKpiName] = useState("");
  const [newKpiDesc, setNewKpiDesc] = useState("");
  const [newKpiTag, setNewKpiTag] = useState<number | "">("");
  const [newKpiCategory, setNewKpiCategory] = useState<number | "">("");
  const [editingKpiId, setEditingKpiId] = useState<number | null>(null);
  const [deletedFieldIds, setDeletedFieldIds] = useState<number[]>([]);
  const [dismissedMissingFieldIds, setDismissedMissingFieldIds] = useState<number[]>([]);
  const [buildingFormulaKpiFieldIndex, setBuildingFormulaKpiFieldIndex] = useState<number | null>(null);
  const [newKpiFields, setNewKpiFields] = useState<Array<{
    id?: number;
    name: string;
    key: string;
    field_type: typeof FIELD_TYPES[number];
    formula_expression?: string;
    is_required: boolean;
    carry_forward_data: boolean;
    sub_fields: Array<{
      id?: number;
      name: string;
      key: string;
      field_type: typeof SUB_FIELD_TYPES[number];
      is_required: boolean;
      config?: any;
    }>;
  }>>([]);

  const loadKpiIntoEditor = (kpi: KPI) => {
    setEditingKpiId(kpi.id);
    setNewKpiName(kpi.name);
    setNewKpiDesc(kpi.description || "");
    const firstTag = kpi.organization_tag_ids?.[0] || kpi.organization_tags?.[0]?.id || "";
    setNewKpiTag(firstTag);
    setNewKpiCategory(kpi.category_id || "");
    
    const kpiFields = kpi.fields || [];
    setNewKpiFields(
      kpiFields.map((f) => ({
        id: f.id,
        name: f.name,
        key: f.key,
        field_type: f.field_type,
        is_required: f.is_required,
        carry_forward_data: f.carry_forward_data,
        formula_expression: f.formula_expression || "",
        sub_fields: (f.sub_fields || []).map((sf) => ({
          id: sf.id,
          name: sf.name,
          key: sf.key,
          field_type: sf.field_type,
          is_required: sf.is_required,
          config: sf.config || null,
        })),
      })) as any
    );
    setDeletedFieldIds([]);
    setActiveItem({ type: "kpi-create" });
  };

  const resetKpiEditor = () => {
    setEditingKpiId(null);
    setNewKpiName("");
    setNewKpiDesc("");
    setNewKpiTag("");
    setNewKpiCategory("");
    setNewKpiFields([]);
    setDeletedFieldIds([]);
  };

  const [originalFormulaExpr, setOriginalFormulaExpr] = useState<string>("");

  const [kpiCreatorFormulaModal, setKpiCreatorFormulaModal] = useState<{
    fieldIndex: number;
    subIndex: number;
    subField: any;
    allSubFields: any[];
  } | null>(null);

  const [kpiCreatorLinkModal, setKpiCreatorLinkModal] = useState<{
    fieldIndex: number;
    subIndex: number;
    subField: any;
    allSubFields: any[];
  } | null>(null);

  // KPI Testing console state
  const [testingKpiId, setTestingKpiId] = useState<number | null>(null);
  const [testYear, setTestYear] = useState(() => new Date().getFullYear());
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<{
    status: "valid" | "invalid";
    recordsFound: number;
    scalarValues: Array<{ name: string; key: string; val: string | number }>;
    mliFieldsData: Record<string, { columns: string[]; rows: any[] }>;
    errors: string[];
  } | null>(null);

  // Validation output list
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const [exportFormat, setExportFormat] = useState<"pdf" | "docx" | "xlsx">("xlsx");
  const [exportRunning, setExportRunning] = useState(false);

  // Identify all referenced KPI IDs
  const referencedKpiIds = useMemo(() => {
    const ids = new Set<number>();
    sections.forEach((s) => {
      if (s.kpi_id) ids.add(s.kpi_id);
    });
    attachments.forEach((a) => {
      if (a.kpi_id) ids.add(a.kpi_id);
    });
    return Array.from(ids);
  }, [sections, attachments]);

  // Identify all MLI fields
  const customReportMliFields = useMemo(() => {
    const list: Array<{ kpiId: number; kpiName: string; field: KPIField }> = [];
    sections.forEach((s) => {
      const kpiObj = allKpis.find((k) => Number(k.id) === Number(s.kpi_id));
      s.fields.forEach((f) => {
        const kpiField = kpiObj?.fields?.find((kf) => Number(kf.id) === Number(f.kpi_field_id));
        if (kpiField && kpiField.field_type === "multi_line_items") {
          list.push({
            kpiId: s.kpi_id!,
            kpiName: s.kpi_name || kpiObj?.name || `KPI #${s.kpi_id}`,
            field: kpiField,
          });
        }
      });
    });
    return list;
  }, [sections, allKpis]);

  const [organization, setOrganization] = useState<any>(null);
  const [localPeriodType, setLocalPeriodType] = useState<string>("");
  const [localDefaultPeriodType, setLocalDefaultPeriodType] = useState<string>("");
  const [localDefaultPeriod, setLocalDefaultPeriod] = useState<string>("");
  const [localDateBasedFetching, setLocalDateBasedFetching] = useState<boolean>(false);
  const [localDateColumn, setLocalDateColumn] = useState<string>("");
  const [localMliDateCols, setLocalMliDateCols] = useState<Record<string, string>>({});
  const [localConfiguredKpiIds, setLocalConfiguredKpiIds] = useState<number[]>([]);
  const [localKpiMlis, setLocalKpiMlis] = useState<Record<string, string>>({});

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !orgId) return;
    api<any>(`/organizations/${orgId}`, { token })
      .then((orgData) => setOrganization(orgData))
      .catch((err) => console.error("Failed to load org details", err));
  }, [orgId]);

  const syncSettingsLocal = () => {
    const defPeriodType = dateFetchingConfig?.default_period_type || dateFetchingConfig?.period_type || "";
    setLocalPeriodType(defPeriodType);
    setLocalDefaultPeriodType(defPeriodType);
    setLocalDefaultPeriod(dateFetchingConfig?.default_period || "");
    setLocalDateBasedFetching(fetchDataWithDate);
    setLocalDateColumn(dateFetchingConfig?.date_column || "");
    setLocalMliDateCols(dateFetchingConfig?.mli_date_cols || {});
    setLocalConfiguredKpiIds(dateFetchingConfig?.configured_kpi_ids || []);
    setLocalKpiMlis(dateFetchingConfig?.kpi_mlis || {});
    setLocalReportHeaderId(reportHeaderId);
    setLocalShowReportName(showReportName);
    setLocalBrandingTitle(brandingTitle);
    setLocalScalarBold(scalarBold);
    setLocalScalarFontSize(scalarFontSize);
    setLocalMliFontSize(mliFontSize);
    setLocalScalarFontFamily(scalarFontFamily);
    setLocalMliFontFamily(mliFontFamily);
    setLocalShowOdooButton(showOdooButton);
    setLocalOdooSyncKpiIds(odooSyncKpiIds);
    setLocalApplyFurtherProcessing(applyFurtherProcessing);
  };

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

  const defaultPeriodOptions = useMemo(() => {
    if (!localDefaultPeriodType) return [];
    if (localDefaultPeriodType === "by_default") {
      const currentYear = new Date().getFullYear();
      return Array.from({ length: 9 }, (_, i) => {
        const yr = String(currentYear - 4 + i);
        return { label: yr, value: yr };
      });
    }
    const matchingConfig = customPeriods.find((p: any) => p.custom_period_name === localDefaultPeriodType);
    if (!matchingConfig) return [];
    return generatePeriodOptions(matchingConfig);
  }, [localDefaultPeriodType, customPeriods]);

  // Drag and drop states
  const [draggedSectionIdx, setDraggedSectionIdx] = useState<number | null>(null);
  const [draggedFieldLoc, setDraggedFieldLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = useState<number | null>(null);
  const [dragOverFieldLoc, setDragOverFieldLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!report) return false;
    const currentLayout = {
      sections: sections.map(s => ({
        kpi_id: s.kpi_id,
        custom_header: s.custom_header,
        sort_order: s.sort_order,
        fields: s.fields.map(f => ({
          kpi_field_id: f.kpi_field_id,
          sort_order: f.sort_order,
          config: f.config || null,
        })),
      })),
      attachments: attachments.map(a => ({
        kpi_id: a.kpi_id,
        kpi_field_id: a.kpi_field_id,
        title: a.title,
        selected_columns: a.selected_columns || [],
        filters: a.filters || null,
        sort_order: a.sort_order,
      })),
      fetch_data_with_date: fetchDataWithDate,
      date_fetching_config: dateFetchingConfig,
      report_header_id: reportHeaderId,
      show_report_name: showReportName,
      branding_title: brandingTitle,
      scalar_bold: scalarBold,
      scalar_font_size: scalarFontSize,
      mli_font_size: mliFontSize,
      show_odoo_button: showOdooButton,
      odoo_sync_kpi_ids: odooSyncKpiIds,
      apply_further_processing_based_on_mli_filter: applyFurtherProcessing,
    };

    const reportLayout = {
      sections: report.sections.map(s => ({
        kpi_id: s.kpi_id,
        custom_header: s.custom_header,
        sort_order: s.sort_order,
        fields: s.fields.map(f => ({
          kpi_field_id: f.kpi_field_id,
          sort_order: f.sort_order,
          config: f.config || null,
        })),
      })),
      attachments: (report as any).attachments?.map((a: any) => ({
        kpi_id: a.kpi_id,
        kpi_field_id: a.kpi_field_id,
        title: a.title,
        selected_columns: a.selected_columns || [],
        filters: a.filters || null,
        sort_order: a.sort_order,
      })) || [],
      fetch_data_with_date: report.fetch_data_with_date ?? false,
      date_fetching_config: report.date_fetching_config ?? {},
      report_header_id: (report as any).report_header_id ?? null,
      show_report_name: (report as any).show_report_name ?? true,
      branding_title: (report as any).branding_title ?? "",
      scalar_bold: (report as any).scalar_bold ?? true,
      scalar_font_size: (report as any).scalar_font_size ?? 11,
      mli_font_size: (report as any).mli_font_size ?? 10,
      show_odoo_button: (report as any).show_odoo_button ?? false,
      odoo_sync_kpi_ids: (report as any).odoo_sync_kpi_ids ?? [],
      apply_further_processing_based_on_mli_filter: (report as any).apply_further_processing_based_on_mli_filter ?? false,
    };

    return JSON.stringify(currentLayout) !== JSON.stringify(reportLayout);
  }, [report, sections, attachments, fetchDataWithDate, dateFetchingConfig, reportHeaderId, showReportName, brandingTitle, scalarBold, scalarFontSize, mliFontSize, showOdooButton, odooSyncKpiIds, applyFurtherProcessing]);

  // Column Selection & Row Filtering States for MLIs
  const [editingFieldConfig, setEditingFieldConfig] = useState<{
    selected_columns: string[];
    filters: { conditions: any[]; _version: number };
    custom_sub_field_labels?: Record<string, string>;
    sort_column?: string;
    sort_direction?: string;
    merged_headers?: { title: string; start_key: string; end_key: string }[];
    custom_name?: string;
    formula_expression?: string;
    column_alignments?: Record<string, "left" | "center" | "right">;
  } | null>(null);

  const [fieldConfigSaving, setFieldConfigSaving] = useState(false);
  const [bulkAlignCols, setBulkAlignCols] = useState<string[]>([]);
  const [showDateConfigModal, setShowDateConfigModal] = useState(false);
  const [showLmsConfigModal, setShowLmsConfigModal] = useState(false);
  const [showFormulaBuilderModal, setShowFormulaBuilderModal] = useState(false);

  const [editingAttachmentIdx, setEditingAttachmentIdx] = useState<number | null>(null);
  const [editingAttachmentConfig, setEditingAttachmentConfig] = useState<{
    kpi_id: number;
    kpi_field_id: number;
    title: string;
    selected_columns: string[];
    filters: { conditions: any[]; _version: number; sort_column?: string; sort_direction?: string };
  } | null>(null);

  const [openFilterFieldKey, setOpenFilterFieldKey] = useState<boolean>(false);
  const [filterDraft, setFilterDraft] = useState<MultiFilterConditionRow[]>([emptyMultiFilterRow()]);
  const [sourceKpiFieldsById, setSourceKpiFieldsById] = useState<Record<number, FieldSummary[]>>({});
  const [refFilterOptions, setRefFilterOptions] = useState<Record<string, string[]>>({});

  const handleMoveSectionUp = (idx: number) => {
    if (idx === 0) return;
    setSections((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[idx - 1];
      next[idx - 1] = temp;
      return next.map((s, sIdx) => ({ ...s, sort_order: sIdx }));
    });
  };

  const handleMoveSectionDown = (idx: number) => {
    if (idx === sections.length - 1) return;
    setSections((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[idx + 1];
      next[idx + 1] = temp;
      return next.map((s, sIdx) => ({ ...s, sort_order: sIdx }));
    });
  };

  const handleMoveFieldUp = (secIdx: number, fIdx: number) => {
    if (fIdx === 0) return;
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const fields = [...s.fields];
        const temp = fields[fIdx];
        fields[fIdx] = fields[fIdx - 1];
        fields[fIdx - 1] = temp;
        return {
          ...s,
          fields: fields.map((f, idx) => ({ ...f, sort_order: idx })),
        };
      });
    });
  };

  const handleMoveFieldDown = (secIdx: number, fIdx: number) => {
    const sec = sections[secIdx];
    if (fIdx === sec.fields.length - 1) return;
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const fields = [...s.fields];
        const temp = fields[fIdx];
        fields[fIdx] = fields[fIdx + 1];
        fields[fIdx + 1] = temp;
        return {
          ...s,
          fields: fields.map((f, idx) => ({ ...f, sort_order: idx })),
        };
      });
    });
  };

  // Fetch Page Data
  useEffect(() => {
    const token = getAccessToken();
    if (!token || !id || !orgId) return;

    setLoading(true);
    Promise.all([
      api<CustomReportDetail>(`/custom-reports/${id}/detail?organization_id=${orgId}`, { token }),
      api<any[]>(`/kpis?organization_id=${orgId}`, { token }),
      api<KPIField[]>(`/fields?organization_id=${orgId}`, { token }),
      api<any[]>(`/reports/headers?organization_id=${orgId}`, { token }).catch(() => []),
      api<{id: number; name: string}[]>(`/custom-reports/odoo-configured-kpis?organization_id=${orgId}`, { token }).catch(() => []),
      api<DomainRow[]>(`/domains?organization_id=${orgId}`, { token }).catch(() => []),
      api<CategoryRow[]>(`/categories?organization_id=${orgId}`, { token }).catch(() => []),
      api<any[]>(`/organizations/${orgId}/tags`, { token }).catch(() => []),
      api<any>(`/reports/organizations/${orgId}/branding`, { token }).catch(() => null),
    ])
      .then(([detail, kpisData, allFields, headersData, odooKpis, domainsData, categoriesData, orgTagsData, brandingData]) => {
        setReport(detail);
        setSections(detail.sections.sort((a, b) => a.sort_order - b.sort_order));
        setAttachments((detail as any).attachments || []);
        setFetchDataWithDate(detail.fetch_data_with_date ?? false);
        setDateFetchingConfig(detail.date_fetching_config ?? {});
        setReportHeaderId((detail as any).report_header_id ?? null);
        setShowReportName((detail as any).show_report_name ?? true);
        setBrandingTitle(brandingData?.footer_label || (detail as any).branding_title || "");
        setScalarBold((detail as any).scalar_bold ?? true);
        setScalarFontSize((detail as any).scalar_font_size ?? 11);
        setMliFontSize((detail as any).mli_font_size ?? 10);
        setScalarFontFamily((detail as any).scalar_font_family || "Inter");
        setMliFontFamily((detail as any).mli_font_family || "Inter");
        setShowOdooButton((detail as any).show_odoo_button ?? false);
        setOdooSyncKpiIds((detail as any).odoo_sync_kpi_ids || []);
        setApplyFurtherProcessing((detail as any).apply_further_processing_based_on_mli_filter ?? false);
        setOdooConfiguredKpis(odooKpis || []);
        setCustomReportHeaders(headersData || []);
        setDomains(domainsData || []);
        setCategories(categoriesData || []);
        setTags(orgTagsData || []);

        const fieldsByKpi = (allFields || []).reduce((acc, f) => {
          if (!acc[f.kpi_id]) acc[f.kpi_id] = [];
          acc[f.kpi_id].push(f);
          return acc;
        }, {} as Record<number, KPIField[]>);

        const fullKpis: KPI[] = kpisData.map((k) => ({
          id: k.id,
          name: k.name,
          description: k.description,
          fields: fieldsByKpi[k.id] || [],
          domain_id: k.domain_id,
          category_id: k.category_id,
          entry_mode: k.entry_mode,
          api_endpoint_url: k.api_endpoint_url,
        }));
        
        setAllKpis(fullKpis);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load designer data"))
      .finally(() => {
        setLoading(false);
        syncSettingsLocal();
      });
  }, [id, orgId]);

  // Search filter for list
  const filteredKpis = useMemo(() => {
    return allKpis.filter((k) =>
      k.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allKpis, searchQuery]);

  // Add KPI as section
  const handleAddKpi = (kpi: KPI) => {
    if (sections.some((s) => s.kpi_id === kpi.id)) {
      toast.error("KPI is already added as a section in this report");
      return;
    }

    const kpiFields: CustomReportField[] = kpi.fields.map((f, idx) => ({
      kpi_field_id: f.id,
      field_key: f.key,
      field_name: f.name,
      field_type: f.field_type,
      sort_order: idx,
      kpi_id: kpi.id,
    }));

    const newSection: CustomReportSection = {
      kpi_id: kpi.id,
      kpi_name: kpi.name,
      custom_header: null,
      sort_order: sections.length,
      fields: kpiFields,
    };

    setSections((prev) => [...prev, newSection]);
    toast.success(`Added "${kpi.name}" section`);
    setActiveItem({ type: "outline" });
  };

  const handleRemoveSection = (secIdx: number) => {
    const sec = sections[secIdx];
    if (sec && sec.fields.length > 0) {
      setDeleteConfirmIdx(secIdx);
    } else {
      setSections((prev) => {
        const next = prev.filter((_, idx) => idx !== secIdx);
        return next.map((s, idx) => ({ ...s, sort_order: idx }));
      });
      toast.success("Section removed");
      setActiveItem({ type: "outline" });
    }
  };

  const confirmDeleteEverything = (secIdx: number) => {
    setSections((prev) => {
      const next = prev.filter((_, idx) => idx !== secIdx);
      return next.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    setDeleteConfirmIdx(null);
    toast.success("Heading and fields removed");
    setActiveItem({ type: "outline" });
  };

  const confirmMergeFields = (secIdx: number) => {
    setSections((prev) => {
      if (prev.length <= 1) {
        toast.error("No other section to merge fields into.");
        return prev;
      }
      const currentSec = prev[secIdx];
      const fieldsToMerge = currentSec.fields;
      const targetIdx = secIdx > 0 ? secIdx - 1 : secIdx + 1;
      
      const next = prev.map((s, idx) => {
        if (idx === targetIdx) {
          const mergedFields = [...s.fields, ...fieldsToMerge].map((f, fIdx) => ({
            ...f,
            sort_order: fIdx
          }));
          return { ...s, fields: mergedFields };
        }
        return s;
      });

      const filtered = next.filter((_, idx) => idx !== secIdx);
      return filtered.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    setDeleteConfirmIdx(null);
    toast.success("Heading removed and fields merged");
    setActiveItem({ type: "outline" });
  };

  const handleRemoveField = (secIdx: number, fieldIdx: number) => {
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const nextFields = s.fields.filter((_, fIdx) => fIdx !== fieldIdx);
        return {
          ...s,
          fields: nextFields.map((f, idx) => ({ ...f, sort_order: idx })),
        };
      });
    });
    setActiveItem({ type: "outline" });
  };

  const handleSectionHeaderChange = (secIdx: number, val: string) => {
    setSections((prev) => {
      return prev.map((s, idx) => {
        if (idx !== secIdx) return s;
        return { ...s, custom_header: val || null };
      });
    });
  };

  const handleFieldNameChange = (secIdx: number, fieldIdx: number, val: string) => {
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const fields = s.fields.map((f, fIdx) => {
          if (fIdx !== fieldIdx) return f;
          return {
            ...f,
            config: {
              ...(f.config || {}),
              custom_name: val || null
            }
          };
        });
        return { ...s, fields };
      });
    });
  };

  const handleSplitSection = (secIdx: number, fieldIdx: number) => {
    setSections((prev) => {
      const next = [];
      for (let i = 0; i < prev.length; i++) {
        if (i === secIdx) {
          const currentSec = prev[i];
          const splitFields = currentSec.fields.slice(fieldIdx);
          const firstSec = { ...currentSec, fields: currentSec.fields.slice(0, fieldIdx) };
          next.push(firstSec);

          const secondSec = {
            kpi_id: currentSec.kpi_id,
            kpi_name: currentSec.kpi_name,
            custom_header: "New Heading",
            sort_order: currentSec.sort_order + 1,
            fields: splitFields.map((f, fIdx) => ({ ...f, sort_order: fIdx }))
          };
          next.push(secondSec);
        } else {
          next.push(prev[i]);
        }
      }
      return next.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    toast.success("Heading split created");
  };

  const handleInsertBlankSection = (insertAfterIdx: number | null) => {
    setSections((prev) => {
      const defaultKpiId = prev.length > 0 
        ? (insertAfterIdx !== null ? prev[insertAfterIdx].kpi_id : prev[prev.length - 1].kpi_id)
        : (allKpis.length > 0 ? allKpis[0].id : 0);

      const defaultKpiName = prev.length > 0 
        ? (insertAfterIdx !== null ? prev[insertAfterIdx].kpi_name : prev[prev.length - 1].kpi_name)
        : (allKpis.length > 0 ? allKpis[0].name : "Custom Heading");

      const newSec = {
        kpi_id: defaultKpiId,
        kpi_name: defaultKpiName,
        custom_header: "New Custom Heading",
        sort_order: 0,
        fields: []
      };

      let next = [...prev];
      if (insertAfterIdx === null) {
        next.push(newSec);
      } else {
        next.splice(insertAfterIdx + 1, 0, newSec);
      }
      return next.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    toast.success("New custom heading inserted");
  };

  const displaySections = useMemo(() => {
    return sections.map((s, sIdx) => {
      const secNum = sIdx + 1;
      const fields = s.fields.map((f, fIdx) => ({
        ...f,
        number: `${secNum}.${fIdx + 1}`,
      }));
      return {
        ...s,
        number: String(secNum),
        fields,
      };
    });
  }, [sections]);

  // Outline reordering Drag and Drop Handlers
  const handleSectionDragStart = (idx: number) => {
    setDraggedSectionIdx(idx);
    setDraggedFieldLoc(null);
  };
  const handleSectionDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedSectionIdx === null || draggedSectionIdx === idx) return;
    setDragOverSectionIdx(idx);
  };
  const handleSectionDrop = (idx: number) => {
    if (draggedSectionIdx === null) return;
    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedSectionIdx, 1);
      next.splice(idx, 0, moved);
      return next.map((s, sIdx) => ({ ...s, sort_order: sIdx }));
    });
    setDraggedSectionIdx(null);
    setDragOverSectionIdx(null);
  };
  const handleFieldDragStart = (secIdx: number, fieldIdx: number) => {
    setDraggedFieldLoc({ secIdx, fieldIdx });
    setDraggedSectionIdx(null);
  };
  const handleFieldDragOver = (e: React.DragEvent, secIdx: number, fieldIdx: number) => {
    e.preventDefault();
    if (!draggedFieldLoc) return;
    if (draggedFieldLoc.secIdx === secIdx && draggedFieldLoc.fieldIdx === fieldIdx) return;
    setDragOverFieldLoc({ secIdx, fieldIdx });
  };
  const handleFieldDrop = (secIdx: number, targetFieldIdx: number) => {
    if (!draggedFieldLoc) return;
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, fields: [...s.fields] }));
      const { secIdx: sourceSecIdx, fieldIdx: sourceFieldIdx } = draggedFieldLoc;
      const [moved] = next[sourceSecIdx].fields.splice(sourceFieldIdx, 1);
      next[sourceSecIdx].fields = next[sourceSecIdx].fields.map((f, idx) => ({ ...f, sort_order: idx }));
      next[secIdx].fields.splice(targetFieldIdx, 0, moved);
      next[secIdx].fields = next[secIdx].fields.map((f, idx) => ({ ...f, sort_order: idx }));
      return next;
    });
    setDraggedFieldLoc(null);
    setDragOverFieldLoc(null);
  };

  const autoSaveSettings = async (updates: {
    fetch_data_with_date?: boolean;
    date_fetching_config?: any;
    report_header_id?: number | null;
    show_report_name?: boolean;
    branding_title?: string;
    scalar_bold?: boolean;
    scalar_font_size?: number;
    mli_font_size?: number;
    scalar_font_family?: string;
    mli_font_family?: string;
    show_odoo_button?: boolean;
    odoo_sync_kpi_ids?: number[];
    apply_further_processing_based_on_mli_filter?: boolean;
  }) => {
    const token = getAccessToken();
    if (!token || !id || !orgId) return;

    const payload = {
      sections: sections.map((s) => ({
        kpi_id: s.kpi_id,
        custom_header: s.custom_header,
        sort_order: s.sort_order,
        fields: s.fields.map((f) => ({
          kpi_field_id: f.kpi_field_id,
          sort_order: f.sort_order,
          config: f.config || null,
        })),
      })),
      attachments: attachments.map((a) => ({
        kpi_id: a.kpi_id,
        kpi_field_id: a.kpi_field_id,
        title: a.title,
        selected_columns: a.selected_columns || [],
        filters: a.filters || null,
        sort_order: a.sort_order,
      })),
      fetch_data_with_date: updates.hasOwnProperty("fetch_data_with_date") ? updates.fetch_data_with_date : fetchDataWithDate,
      date_fetching_config: updates.hasOwnProperty("date_fetching_config") ? updates.date_fetching_config : dateFetchingConfig,
      report_header_id: updates.hasOwnProperty("report_header_id") ? (updates.report_header_id !== undefined ? updates.report_header_id : null) : reportHeaderId,
      show_report_name: updates.hasOwnProperty("show_report_name") ? updates.show_report_name : showReportName,
      branding_title: updates.hasOwnProperty("branding_title") ? updates.branding_title : brandingTitle,
      scalar_bold: updates.hasOwnProperty("scalar_bold") ? updates.scalar_bold : scalarBold,
      scalar_font_size: updates.hasOwnProperty("scalar_font_size") ? updates.scalar_font_size : scalarFontSize,
      mli_font_size: updates.hasOwnProperty("mli_font_size") ? updates.mli_font_size : mliFontSize,
      scalar_font_family: updates.hasOwnProperty("scalar_font_family") ? updates.scalar_font_family : scalarFontFamily,
      mli_font_family: updates.hasOwnProperty("mli_font_family") ? updates.mli_font_family : mliFontFamily,
      show_odoo_button: updates.hasOwnProperty("show_odoo_button") ? updates.show_odoo_button : showOdooButton,
      odoo_sync_kpi_ids: updates.hasOwnProperty("odoo_sync_kpi_ids") ? updates.odoo_sync_kpi_ids : odooSyncKpiIds,
      apply_further_processing_based_on_mli_filter: updates.hasOwnProperty("apply_further_processing_based_on_mli_filter") ? updates.apply_further_processing_based_on_mli_filter : applyFurtherProcessing,
    };

    try {
      await api(`/custom-reports/${id}/layout?organization_id=${orgId}`, {
        method: "PUT",
        token,
        body: JSON.stringify(payload),
      });

      if (updates.hasOwnProperty("fetch_data_with_date")) setFetchDataWithDate(updates.fetch_data_with_date!);
      if (updates.hasOwnProperty("date_fetching_config")) {
        const cfg = updates.date_fetching_config;
        setDateFetchingConfig(cfg);
        const defPeriodType = cfg?.default_period_type || cfg?.period_type || "";
        setLocalPeriodType(defPeriodType);
        setLocalDefaultPeriodType(defPeriodType);
        setLocalDefaultPeriod(cfg?.default_period || "");
        setLocalDateColumn(cfg?.date_column || "");
        setLocalMliDateCols(cfg?.mli_date_cols || {});
        setLocalConfiguredKpiIds(cfg?.configured_kpi_ids || []);
        setLocalKpiMlis(cfg?.kpi_mlis || {});
      }
      if (updates.hasOwnProperty("report_header_id")) setReportHeaderId(updates.report_header_id !== undefined ? updates.report_header_id : null);
      if (updates.hasOwnProperty("show_report_name")) setShowReportName(updates.show_report_name!);
      if (updates.hasOwnProperty("branding_title")) setBrandingTitle(updates.branding_title || "");
      if (updates.hasOwnProperty("scalar_bold")) setScalarBold(updates.scalar_bold!);
      if (updates.hasOwnProperty("scalar_font_size")) setScalarFontSize(updates.scalar_font_size!);
      if (updates.hasOwnProperty("mli_font_size")) setMliFontSize(updates.mli_font_size!);
      if (updates.hasOwnProperty("scalar_font_family")) setScalarFontFamily(updates.scalar_font_family || "Inter");
      if (updates.hasOwnProperty("mli_font_family")) setMliFontFamily(updates.mli_font_family || "Inter");
      if (updates.hasOwnProperty("show_odoo_button")) setShowOdooButton(updates.show_odoo_button!);
      if (updates.hasOwnProperty("odoo_sync_kpi_ids")) setOdooSyncKpiIds(updates.odoo_sync_kpi_ids || []);
      if (updates.hasOwnProperty("apply_further_processing_based_on_mli_filter")) setApplyFurtherProcessing(updates.apply_further_processing_based_on_mli_filter!);

      if (updates.hasOwnProperty("fetch_data_with_date")) setLocalDateBasedFetching(updates.fetch_data_with_date!);
      if (updates.hasOwnProperty("report_header_id")) setLocalReportHeaderId(updates.report_header_id !== undefined ? updates.report_header_id : null);
      if (updates.hasOwnProperty("show_report_name")) setLocalShowReportName(updates.show_report_name!);
      if (updates.hasOwnProperty("branding_title")) setLocalBrandingTitle(updates.branding_title || "");
      if (updates.hasOwnProperty("scalar_bold")) setLocalScalarBold(updates.scalar_bold!);
      if (updates.hasOwnProperty("scalar_font_size")) setLocalScalarFontSize(updates.scalar_font_size!);
      if (updates.hasOwnProperty("mli_font_size")) setLocalMliFontSize(updates.mli_font_size!);
      if (updates.hasOwnProperty("scalar_font_family")) setLocalScalarFontFamily(updates.scalar_font_family || "Inter");
      if (updates.hasOwnProperty("mli_font_family")) setLocalMliFontFamily(updates.mli_font_family || "Inter");
      if (updates.hasOwnProperty("show_odoo_button")) setLocalShowOdooButton(updates.show_odoo_button!);
      if (updates.hasOwnProperty("odoo_sync_kpi_ids")) setLocalOdooSyncKpiIds(updates.odoo_sync_kpi_ids || []);
      if (updates.hasOwnProperty("apply_further_processing_based_on_mli_filter")) setLocalApplyFurtherProcessing(updates.apply_further_processing_based_on_mli_filter!);

      setReport((prev) => prev ? {
        ...prev,
        sections: sections,
        attachments: attachments,
        fetch_data_with_date: updates.hasOwnProperty("fetch_data_with_date") ? updates.fetch_data_with_date! : fetchDataWithDate,
        date_fetching_config: updates.hasOwnProperty("date_fetching_config") ? updates.date_fetching_config : dateFetchingConfig,
        report_header_id: updates.hasOwnProperty("report_header_id") ? updates.report_header_id : reportHeaderId,
        show_report_name: updates.hasOwnProperty("show_report_name") ? updates.show_report_name! : showReportName,
        branding_title: updates.hasOwnProperty("branding_title") ? updates.branding_title || "" : brandingTitle,
        scalar_bold: updates.hasOwnProperty("scalar_bold") ? updates.scalar_bold! : scalarBold,
        scalar_font_size: updates.hasOwnProperty("scalar_font_size") ? updates.scalar_font_size! : scalarFontSize,
        mli_font_size: updates.hasOwnProperty("mli_font_size") ? updates.mli_font_size! : mliFontSize,
        scalar_font_family: updates.hasOwnProperty("scalar_font_family") ? updates.scalar_font_family || "Inter" : scalarFontFamily,
        mli_font_family: updates.hasOwnProperty("mli_font_family") ? updates.mli_font_family || "Inter" : mliFontFamily,
        show_odoo_button: updates.hasOwnProperty("show_odoo_button") ? updates.show_odoo_button! : showOdooButton,
        odoo_sync_kpi_ids: updates.hasOwnProperty("odoo_sync_kpi_ids") ? updates.odoo_sync_kpi_ids || [] : odooSyncKpiIds,
        apply_further_processing_based_on_mli_filter: updates.hasOwnProperty("apply_further_processing_based_on_mli_filter") ? updates.apply_further_processing_based_on_mli_filter! : applyFurtherProcessing,
      } : null);

      toast.success("Saved successfully");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save setting");
    }
  };

  // Layout save trigger
  const handleSave = async (andExit = false) => {
    const token = getAccessToken();
    if (!token || !id) return;

    // Validate layout configuration first
    const errs = validateReportConfig();
    if (errs.length > 0) {
      setValidationIssues(errs);
      setShowValidationPanel(true);
      toast.error("Validation failed. Please review layout issues in the panel.");
      return;
    }

    // Automatically dismiss any missing scalar fields upon layout save
    const allMissingIds: number[] = [];
    sections.forEach((sec) => {
      const kpiObj = allKpis.find((k) => k.id === sec.kpi_id);
      const availableScalarFields = (kpiObj?.fields || []).filter((f) => f.field_type !== "multi_line_items");
      const reportFieldKpiFieldIds = sec.fields.map((f) => f.kpi_field_id);
      const missing = availableScalarFields.filter((f) => !reportFieldKpiFieldIds.includes(f.id));
      missing.forEach((f) => allMissingIds.push(f.id));
    });
    if (allMissingIds.length > 0) {
      setDismissedMissingFieldIds(prev => [...new Set([...prev, ...allMissingIds])]);
    }

    setSaveSaving(true);
    try {
      const payload = {
        sections: sections.map((s) => ({
          kpi_id: s.kpi_id,
          custom_header: s.custom_header,
          sort_order: s.sort_order,
          fields: s.fields.map((f) => ({
            kpi_field_id: f.kpi_field_id,
            sort_order: f.sort_order,
            config: f.config || null,
          })),
        })),
        attachments: attachments.map((a) => ({
          kpi_id: a.kpi_id,
          kpi_field_id: a.kpi_field_id,
          title: a.title,
          selected_columns: a.selected_columns || [],
          filters: a.filters || null,
          sort_order: a.sort_order,
        })),
        fetch_data_with_date: fetchDataWithDate,
        date_fetching_config: dateFetchingConfig,
        report_header_id: reportHeaderId,
        show_report_name: showReportName,
        branding_title: brandingTitle,
        scalar_bold: scalarBold,
        scalar_font_size: scalarFontSize,
        mli_font_size: mliFontSize,
        scalar_font_family: scalarFontFamily,
        mli_font_family: mliFontFamily,
        show_odoo_button: showOdooButton,
        odoo_sync_kpi_ids: odooSyncKpiIds,
        apply_further_processing_based_on_mli_filter: applyFurtherProcessing,
      };

      await api(`/custom-reports/${id}/layout?organization_id=${orgId}`, {
        method: "PUT",
        token,
        body: JSON.stringify(payload),
      });

      setReport((prev) => prev ? {
        ...prev,
        sections: sections,
        attachments: attachments,
        fetch_data_with_date: fetchDataWithDate,
        date_fetching_config: dateFetchingConfig,
        report_header_id: reportHeaderId,
        show_report_name: showReportName,
        branding_title: brandingTitle,
        scalar_bold: scalarBold,
        scalar_font_size: scalarFontSize,
        mli_font_size: mliFontSize,
        scalar_font_family: scalarFontFamily,
        mli_font_family: mliFontFamily,
        show_odoo_button: showOdooButton,
        odoo_sync_kpi_ids: odooSyncKpiIds,
        apply_further_processing_based_on_mli_filter: applyFurtherProcessing,
      } : null);

      toast.success("Report layout saved successfully");
      setValidationIssues([]);
      
      if (andExit) {
        router.push(`/dashboard/custom-reports?organization_id=${orgId}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save layout");
    } finally {
      setSaveSaving(false);
    }
  };

  // Export & Download handler
  const handleExportDownload = async () => {
    if (!token) return;
    setExportRunning(true);
    const toastId = toast.loading(`Generating report file in ${exportFormat.toUpperCase()}...`);
    try {
      // Validate configuration before exporting
      const errs = validateReportConfig();
      if (errs.length > 0) {
        setValidationIssues(errs);
        setShowValidationPanel(true);
        toast.error("Validation failed. Check configuration panel.", { id: toastId });
        setExportRunning(false);
        return;
      }

      const isByDefault = selectedPeriodType === "by_default" || !fetchDataWithDate;
      const yr = (fetchDataWithDate && !isByDefault) ? (dateFetchingConfig?.default_period || previewYear) : previewYear;
      let url = getApiUrl(`/custom-reports/${id}/export?year=${yr}&format=${exportFormat}&organization_id=${orgId}${isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(localPeriodType)}`}`);
      
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (res.status === 401) {
        toast.error("Session expired. Log in again.", { id: toastId });
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        toast.error("No permission to export this report.", { id: toastId });
        return;
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || "Export generation failed");
      }
      
      const blob = await res.blob();
      const cleanName = (report?.name || "custom_report")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const downloadName = `${cleanName}_${previewYear}.${exportFormat}`;
      
      downloadBlob(blob, downloadName);
      toast.success(`${exportFormat.toUpperCase()} report exported successfully!`, { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate report", { id: toastId });
    } finally {
      setExportRunning(false);
    }
  };

  // Test KPI Action
  const handleRunKpiTest = async (kpiId: number) => {
    const token = getAccessToken();
    if (!token || !orgId) return;

    setTestRunning(true);
    setTestResults(null);
    try {
      const kpiObj = allKpis.find(k => k.id === kpiId);
      if (!kpiObj) throw new Error("KPI definition not found");

      const scalarValuesList: Array<{ name: string; key: string; val: string | number }> = [];
      const mliFieldsData: Record<string, { columns: string[]; rows: any[] }> = {};
      const errorsList: string[] = [];
      let recordsFound = 0;

      // 1. Attempt to fetch custom report computed data for the KPI fields
      const reportRes = await api<any>(`/custom-reports/${id}/generate?year=${testYear}&organization_id=${orgId}&by_default=true`, { token }).catch(() => null);
      const targetSections = (reportRes?.sections || []).filter((s: any) => s.kpi_id === kpiId);

      if (targetSections && targetSections.length > 0) {
        // Map from report data!
        for (const sec of targetSections) {
          for (const f of sec.fields) {
            if (f.field_type === "multi_line_items") {
              const subFieldKeys = (f.sub_fields || []).map((sf: any) => sf.key);
              const rows = f.value_items || [];
              recordsFound += rows.length;
              mliFieldsData[f.field_key] = {
                columns: subFieldKeys,
                rows: rows
              };
            } else {
              const val = f.value !== null && f.value !== undefined ? f.value : "—";
              scalarValuesList.push({
                name: f.field_name,
                key: f.field_key,
                val: val
              });
            }
          }
        }
      } else {
        // Fallback: fetch raw entries for this KPI and year
        const entryRes = await api<any>(`/entries/for-period?kpi_id=${kpiId}&year=${testYear}&organization_id=${orgId}`, { token });
        if (!entryRes) throw new Error("Failed to fetch/create entry for period");

        const entryId = entryRes.id;
        for (const field of kpiObj.fields) {
          if (field.field_type === "multi_line_items") {
            try {
              const mliRes = await api<any>(`/entries/multi-items/rows?entry_id=${entryId}&field_id=${field.id}&organization_id=${orgId}&page_size=50&fetch_all=true`, { token });
              const rows = mliRes?.rows || [];
              recordsFound += rows.length;
              const subFieldKeys = (field.sub_fields || []).map(sf => sf.key);
              mliFieldsData[field.key] = {
                columns: subFieldKeys,
                rows: rows
              };
            } catch (e: any) {
              errorsList.push(`Failed to fetch MLI rows for field "${field.name}": ${e.message}`);
            }
          } else {
            const fv = (entryRes.values || []).find((v: any) => v.field_id === field.id);
            let scalarVal = "—";
            if (fv) {
              scalarVal = fv.value_number !== null ? fv.value_number : (fv.value_text || "—");
            }
            scalarValuesList.push({
              name: field.name,
              key: field.key,
              val: scalarVal
            });
          }
        }
      }

      setTestResults({
        status: errorsList.length === 0 ? "valid" : "invalid",
        recordsFound: recordsFound,
        scalarValues: scalarValuesList,
        mliFieldsData: mliFieldsData,
        errors: errorsList
      });
      toast.success("KPI Tested successfully.");
    } catch (e: any) {
      setTestResults({
        status: "invalid",
        recordsFound: 0,
        scalarValues: [],
        mliFieldsData: {},
        errors: [e.message || "Failed to query test values"]
      });
      toast.error(e.message || "Testing failed");
    } finally {
      setTestRunning(false);
    }
  };

  // Create & Save KPI Inplace
  const handleCreateKpiSubmit = async () => {
    const token = getAccessToken();
    if (!token || !orgId) return;

    if (!newKpiName.trim()) {
      toast.error("KPI name is required");
      return;
    }
    
    setSaveSaving(true);
    try {
      // 1. Create KPI object
      const kpiPayload: Record<string, any> = {
        name: newKpiName,
        description: newKpiDesc || null,
        entry_mode: "manual",
        is_joined: false,
        sort_order: allKpis.length + 1
      };
      if (newKpiTag) kpiPayload.organization_tag_ids = [Number(newKpiTag)];
      if (newKpiCategory) kpiPayload.category_ids = [Number(newKpiCategory)];

      const query = `?organization_id=${orgId}`;
      const newKpiObj = await api<any>(`/kpis${query}`, {
        method: "POST",
        body: JSON.stringify(kpiPayload),
        token
      });

      const kpiId = newKpiObj.id;

      // 2. Create Fields sequentially
      const createdFields: KPIField[] = [];
      for (let i = 0; i < newKpiFields.length; i++) {
        const f = newKpiFields[i];
        if (!f.name.trim()) continue;

        const fieldPayload: Record<string, any> = {
          kpi_id: kpiId,
          name: f.name,
          key: f.key || slugifyKey(f.name),
          field_type: f.field_type,
          formula_expression: f.field_type === "formula" ? f.formula_expression : null,
          is_required: f.is_required,
          sort_order: i + 1,
          carry_forward_data: f.carry_forward_data
        };

        if (f.field_type === "multi_line_items") {
          fieldPayload.sub_fields = f.sub_fields.map((sf, idx) => ({
            name: sf.name,
            key: sf.key || slugifyKey(sf.name),
            field_type: sf.field_type,
            is_required: sf.is_required,
            sort_order: idx + 1,
            config: sf.config || null
          }));
        }

        const createdField = await api<KPIField>(`/fields${query}`, {
          method: "POST",
          body: JSON.stringify(fieldPayload),
          token
        });
        createdFields.push(createdField);
      }

      // Hydrate allKpis in memory
      const fullNewKpi: KPI = {
        id: kpiId,
        name: newKpiName,
        description: newKpiDesc,
        fields: createdFields,
        category_id: newKpiCategory ? Number(newKpiCategory) : undefined,
        entry_mode: "manual"
      };

      setAllKpis(prev => [...prev, fullNewKpi]);
      toast.success(`KPI "${newKpiName}" created successfully!`);

      // Reset KPI Form
      setNewKpiName("");
      setNewKpiDesc("");
      setNewKpiTag("");
      setNewKpiCategory("");
      setNewKpiFields([]);

      // Auto Add to report sections
      handleAddKpi(fullNewKpi);
    } catch (e: any) {
      toast.error(e.message || "Failed to create new KPI");
    } finally {
      setSaveSaving(false);
    }
  };

  const handleUpdateKpiSubmit = async () => {
    const token = getAccessToken();
    if (!token || !orgId || !editingKpiId) return;

    if (!newKpiName.trim()) {
      toast.error("KPI name is required");
      return;
    }
    
    setSaveSaving(true);
    try {
      const query = `?organization_id=${orgId}`;

      // 1. Update KPI object
      const kpiPayload: Record<string, any> = {
        name: newKpiName,
        description: newKpiDesc || null
      };
      if (newKpiTag) kpiPayload.organization_tag_ids = [Number(newKpiTag)];
      else kpiPayload.organization_tag_ids = [];
      if (newKpiCategory) kpiPayload.category_ids = [Number(newKpiCategory)];
      else kpiPayload.category_ids = [];

      await api<any>(`/kpis/${editingKpiId}${query}`, {
        method: "PATCH",
        body: JSON.stringify(kpiPayload),
        token
      });

      // 2. Delete fields sequentially
      for (const fieldId of deletedFieldIds) {
        try {
          await api<any>(`/fields/${fieldId}${query}`, {
            method: "DELETE",
            token
          });
        } catch (err) {
          console.error("Failed to delete field ID", fieldId, err);
        }
      }

      // 3. Create or Update Fields sequentially
      const finalFields: KPIField[] = [];
      for (let i = 0; i < newKpiFields.length; i++) {
        const f = newKpiFields[i];
        if (!f.name.trim()) continue;

        const fieldPayload: Record<string, any> = {
          kpi_id: editingKpiId,
          name: f.name,
          key: f.key || slugifyKey(f.name),
          field_type: f.field_type,
          formula_expression: f.field_type === "formula" ? f.formula_expression : null,
          is_required: f.is_required,
          sort_order: i + 1,
          carry_forward_data: f.carry_forward_data
        };

        if (f.field_type === "multi_line_items") {
          fieldPayload.sub_fields = f.sub_fields.map((sf, idx) => ({
            id: sf.id || undefined,
            name: sf.name,
            key: sf.key || slugifyKey(sf.name),
            field_type: sf.field_type,
            is_required: sf.is_required,
            sort_order: idx + 1,
            config: sf.config || null
          }));
        }

        let savedField: KPIField;
        if (f.id) {
          // Update existing field
          savedField = await api<KPIField>(`/fields/${f.id}${query}`, {
            method: "PATCH",
            body: JSON.stringify(fieldPayload),
            token
          });
        } else {
          // Create new field
          savedField = await api<KPIField>(`/fields${query}`, {
            method: "POST",
            body: JSON.stringify(fieldPayload),
            token
          });
        }
        finalFields.push(savedField);
      }

      toast.success(`KPI "${newKpiName}" updated successfully!`);

      // Refetch KPIs and Fields list from server to re-hydrate memory
      const [refreshedKpis, refreshedFields] = await Promise.all([
        api<any[]>(`/kpis${query}`, { token }),
        api<KPIField[]>(`/fields${query}`, { token })
      ]);
      const fieldsByKpi = (refreshedFields || []).reduce((acc, f) => {
        if (!acc[f.kpi_id]) acc[f.kpi_id] = [];
        acc[f.kpi_id].push(f);
        return acc;
      }, {} as Record<number, KPIField[]>);

      const fullKpis: KPI[] = refreshedKpis.map((k) => ({
        ...k,
        fields: fieldsByKpi[k.id] || [],
      }));
      setAllKpis(fullKpis);

      // Also update name of this KPI in custom report sections if it matches
      setSections(prev => {
        return prev.map(sec => {
          if (sec.kpi_id === editingKpiId) {
            // Update section kpi name and match field names if custom_name is not set
            const updatedFields = sec.fields.map(rf => {
              const matchingKpiField = finalFields.find(f => Number(f.id) === Number(rf.kpi_field_id));
              if (matchingKpiField) {
                return {
                  ...rf,
                  field_name: matchingKpiField.name,
                  field_type: matchingKpiField.field_type,
                  config: {
                    ...rf.config,
                    carry_forward_data: matchingKpiField.carry_forward_data
                  }
                };
              }
              return rf;
            }).filter(rf => {
              // If the field was deleted from the KPI, we should remove it from the report layout as well!
              const stillExists = finalFields.some(f => Number(f.id) === Number(rf.kpi_field_id));
              return stillExists;
            });

            return {
              ...sec,
              kpi_name: newKpiName,
              fields: updatedFields
            };
          }
          return sec;
        });
      });

      // Reset KPI Form & return to outline
      resetKpiEditor();
      setActiveItem({ type: "outline" });
    } catch (e: any) {
      toast.error(e.message || "Failed to update KPI");
    } finally {
      setSaveSaving(false);
    }
  };

  // Client-Side Validation Engine
  const validateReportConfig = (): string[] => {
    const errs: string[] = [];
    if (!report?.name || !report.name.trim()) {
      errs.push("Report name cannot be empty.");
    }
    
    sections.forEach((sec, sIdx) => {
      const displayNum = sIdx + 1;
      if (sec.custom_header === "") {
        errs.push(`Heading section ${displayNum} has an empty header.`);
      }
      
      sec.fields.forEach((f, fIdx) => {
        const fieldName = (f.config as any)?.custom_name || f.field_name;
        const kpi = allKpis.find(k => Number(k.id) === Number(f.kpi_id));
        const kField = kpi?.fields.find(fld => Number(fld.id) === Number(f.kpi_field_id));
        const formulaExpr = kField?.formula_expression || f.config?.formula_expression;
        if (f.field_type === "formula" && (!formulaExpr || !formulaExpr.trim())) {
          errs.push(`Formula Field "${fieldName}" (${displayNum}.${fIdx + 1}) has no expression configured.`);
        }
        
        if (f.field_type === "multi_line_items") {
          // Validate widths
          const widths = (f.config as any)?.column_widths || {};
          Object.entries(widths).forEach(([colKey, widthVal]) => {
            const w = Number(widthVal);
            if (isNaN(w) || w < 30 || w > 800) {
              errs.push(`Table Field "${fieldName}" column "${colKey}" width of ${widthVal}px is invalid (must be between 30px and 800px).`);
            }
          });

          // Validate footer config
          const footerConfig = (f.config as any)?.footer_config;
          if (footerConfig && footerConfig.enabled && footerConfig.rows) {
            footerConfig.rows.forEach((row: any, rIdx: number) => {
              row.cells?.forEach((cell: any, cIdx: number) => {
                if (cell.content_type === "formula" && !cell.column_key) {
                  errs.push(`Table Field "${fieldName}" footer row ${rIdx + 1} cell ${cIdx + 1} formula has no target column mapped.`);
                }
              });
            });
          }
        }
      });
    });

    // Check broken KPI references
    sections.forEach((sec) => {
      if (sec.kpi_id && !allKpis.some(k => k.id === sec.kpi_id)) {
        errs.push(`Heading "${sec.custom_header || sec.kpi_name}" references KPI ID ${sec.kpi_id} which does not exist in the database.`);
      }
    });

    return errs;
  };

  const runValidatorCheck = () => {
    const errs = validateReportConfig();
    setValidationIssues(errs);
    setShowValidationPanel(true);
    if (errs.length === 0) {
      toast.success("Workspace validation passed! No configuration errors found.");
    } else {
      toast.error(`Validation found ${errs.length} issues in the report layout.`);
    }
  };

  const selectedPeriodType = localPeriodType || "by_default";
  const token = getAccessToken();

  if (loading) return <p style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading report builder workspace...</p>;
  if (error) return <p className="form-error" style={{ margin: "2rem" }}>{error}</p>;

  const activeType = activeItem.type;

  return (
    <div style={{ padding: "0 1rem 1rem", height: "calc(100vh - 80px)", display: "flex", flexDirection: "column" }}>
      
      {/* 1. Centered Header Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border)", marginBottom: "1rem" }}>
        
        {/* Back Link */}
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
          <Link href={`/dashboard/custom-reports?organization_id=${orgId}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "var(--primary)", fontSize: "0.88rem", fontWeight: 600 }}>
            <span>← Back to Custom Reports</span>
          </Link>
        </div>

        {/* Centered Report Title */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Custom Report Workspace</span>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 800, margin: "2px 0 0", color: "var(--text)" }}>
            {report?.name}
          </h1>
        </div>

        {/* Status Indicator */}
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
          <span style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: hasUnsavedChanges ? "#d97706" : "#059669",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            background: hasUnsavedChanges ? "rgba(245, 158, 11, 0.1)" : "rgba(16, 185, 129, 0.1)",
            padding: "0.25rem 0.75rem",
            borderRadius: "12px",
            userSelect: "none"
          }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: hasUnsavedChanges ? "#d97706" : "#059669" }} />
            {hasUnsavedChanges ? "Unsaved Changes" : "Synced to Database"}
          </span>
        </div>
      </div>

      {/* 2. Interactive Workspace Two-Panel Layout */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: "1.25rem" }}>
           {/* Left Pane: Actions Toolbar */}
        <div style={{ flex: "0 0 280px", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "1rem", gap: "0.5rem", boxShadow: "var(--shadow-sm)" }}>
          
          <div style={{ textAlign: "center", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem", marginBottom: "0.25rem" }}>
            <h3 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.08em" }}>
              Workspace Controls
            </h3>
          </div>

          <button
            type="button"
            className={`btn ${activeType === "outline" ? "btn-primary" : "btn-secondary"}`}
            style={{ width: "100%", padding: "0.45rem", fontSize: "0.85rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
            onClick={() => setActiveItem({ type: "outline" })}
          >
            Report Layout Outline
          </button>

          <button
            type="button"
            className={`btn ${activeType === "kpi-create" ? "btn-primary" : "btn-secondary"}`}
            style={{ width: "100%", padding: "0.45rem", fontSize: "0.85rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
            onClick={() => setActiveItem({ type: "kpi-create" })}
          >
            Create New KPI
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: "100%", padding: "0.4rem", fontSize: "0.82rem", background: hoverBtn === "heading" ? "#f1f5f9" : "white", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", border: "1px solid var(--border)", cursor: "pointer", transition: "background 0.2s ease" }}
            onMouseEnter={() => setHoverBtn("heading")}
            onMouseLeave={() => setHoverBtn(null)}
            onClick={() => handleInsertBlankSection(null)}
          >
            Add Custom Heading
          </button>

          <button
            type="button"
            className={`btn ${activeType === "general" ? "btn-primary" : "btn-secondary"}`}
            style={{ width: "100%", padding: "0.4rem", fontSize: "0.82rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", border: "1px solid var(--border)" }}
            onClick={() => { setActiveItem({ type: "general" }); syncSettingsLocal(); }}
          >
            Settings
          </button>

          <button
            type="button"
            className={`btn ${activeType === "kpi-test" ? "btn-primary" : "btn-secondary"}`}
            style={{ width: "100%", padding: "0.4rem", fontSize: "0.82rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", border: "1px solid var(--border)" }}
            onClick={() => {
              setActiveItem({ type: "kpi-test", kpiId: referencedKpiIds[0] || undefined });
              if (referencedKpiIds[0]) {
                setTestingKpiId(referencedKpiIds[0]);
                handleRunKpiTest(referencedKpiIds[0]);
              }
            }}
          >
            Test KPI Data
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: "100%", padding: "0.4rem", fontSize: "0.82rem", background: hoverBtn === "validate" ? "#f1f5f9" : "white", border: "1px solid var(--border)", color: "var(--accent)", cursor: "pointer", transition: "background 0.2s ease" }}
            onMouseEnter={() => setHoverBtn("validate")}
            onMouseLeave={() => setHoverBtn(null)}
            onClick={runValidatorCheck}
          >
            Validate Configuration
          </button>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", display: "flex", gap: "0.35rem", marginTop: "auto" }}>
            <button
              type="button"
              className="btn btn-success"
              style={{ flex: 1, padding: "0.45rem", fontSize: "0.82rem", fontWeight: 700 }}
              onClick={() => handleSave(false)}
              disabled={saveSaving}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-success"
              style={{ flex: 1, padding: "0.45rem", fontSize: "0.82rem", fontWeight: 700 }}
              onClick={() => handleSave(true)}
              disabled={saveSaving}
            >
              Save & Exit
            </button>
          </div>

          {/* Export & Download */}
          <div style={{ display: "flex", gap: "0.25rem", background: "white", border: "1px solid var(--border)", borderRadius: "6px", padding: "2px" }}>
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)} style={{ width: "90px", padding: "0.25rem", border: "none", fontSize: "0.8rem", background: "none", color: "var(--text)" }}>
              <option value="xlsx">Excel</option>
              <option value="pdf">PDF</option>
              <option value="docx">Word</option>
            </select>
            <button type="button" className="btn btn-primary" style={{ flex: 1, padding: "0.25rem 0.5rem", fontSize: "0.8rem" }} onClick={handleExportDownload} disabled={exportRunning}>
              {exportRunning ? "Exporting..." : "Export Report"}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: "100%", padding: "0.35rem", fontSize: "0.8rem", background: "white", border: "1px solid var(--border)", color: "var(--error)" }}
            onClick={() => router.push(`/dashboard/custom-reports?organization_id=${orgId}`)}
          >
            Close Workspace
          </button>
        </div>

        {/* Right Pane: Dynamic Options & Setting Console */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          
          {/* Header/Status block */}
          <div style={{ padding: "0.5rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-secondary)" }}>
              {activeItem.type === "outline" && "Report Outline Map Layout Builder"}
              {activeItem.type === "general" && "Settings"}
              {activeItem.type === "kpi-create" && (editingKpiId ? `Edit KPI Structure: ${newKpiName}` : "KPI Creator Workspace")}
              {activeItem.type === "kpi-test" && "Test KPI Data"}
              {activeItem.type === "section" && "Heading Section Configurator"}
              {activeItem.type === "field" && "Field Configurator"}
              {activeItem.type === "attachment" && "Attachment Configuration"}
            </span>

            {/* Validation Panel Trigger */}
            {validationIssues.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  fontSize: "0.78rem",
                  padding: "2px 8px",
                  background: "#fef2f2",
                  color: "var(--error)",
                  borderColor: "#fca5a5",
                  fontWeight: 700
                }}
                onClick={() => setShowValidationPanel(!showValidationPanel)}
              >
                ⚠ {validationIssues.length} Layout Issues
              </button>
            )}
          </div>

          {/* Validation Drawer Panel */}
          {showValidationPanel && (
            <div style={{ background: "#fffbeb", borderBottom: "2px solid #fef3c7", padding: "0.75rem 1rem", fontSize: "0.8rem", display: "grid", gap: "0.35rem", maxHeight: 150, overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ color: "#d97706" }}>Report Layout Warnings</strong>
                <button type="button" style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontWeight: 700 }} onClick={() => setShowValidationPanel(false)}>Dismiss</button>
              </div>
              {validationIssues.length === 0 ? (
                <p style={{ margin: 0, color: "var(--success)", fontWeight: 650 }}>✓ All checks passed. Report layout is healthy.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {validationIssues.map((iss, idx) => (
                    <div key={idx} style={{ display: "flex", gap: "0.35rem", alignItems: "flex-start", color: "var(--error)" }}>
                      <span>•</span>
                      <span>{iss}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dynamic Console Content Box */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem" }}>
            


            {/* TAB: OUTLINE LAYOUT MAP BUILDER (DEFAULT VIEW) */}
            {activeItem.type === "outline" && (
              <div style={{ display: "grid", gap: "1.25rem" }}>

                {/* KPI Search and Selector Row */}
                <div style={{ display: "flex", gap: "0.75rem", padding: "0.85rem", background: "var(--bg-subtle, #f9fafb)", borderRadius: 10, border: "1px solid var(--border)", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "0.5rem", flex: 1, alignItems: "center", flexWrap: "wrap", minWidth: 280 }}>
                    <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Add KPI Section:</span>
                    <input
                      type="text"
                      placeholder="Search KPI..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ padding: "4px 8px", fontSize: "0.8rem", width: "160px", border: "1px solid var(--border)", borderRadius: 5 }}
                    />
                    <select
                      onChange={(e) => {
                        const kid = Number(e.target.value);
                        if (!kid) return;
                        const kpi = allKpis.find(k => k.id === kid);
                        if (kpi) {
                          handleAddKpi(kpi);
                          setSearchQuery("");
                          e.target.value = "";
                        }
                      }}
                      style={{ padding: "4px", fontSize: "0.8rem", flex: 1, border: "1px solid var(--border)", borderRadius: 5, minWidth: "150px" }}
                      defaultValue=""
                    >
                      <option value="">Select KPI to Add...</option>
                      {filteredKpis.map(k => (
                        <option key={k.id} value={k.id}>
                          {k.name} ({(k.fields || []).length} fields)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Main Outline visual tree */}
                {displaySections.length === 0 ? (
                  <div style={{ padding: "4rem 2rem", textAlign: "center", border: "2px dashed var(--border)", borderRadius: 10, color: "var(--muted)", background: "#f8fafc" }}>
                    <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>Workspace layout has no KPIs yet.</p>
                    <p style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>Search for available KPIs in the search bar above to add them as report sections.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {displaySections.map((sec, sIdx) => {
                      const kpiObj = allKpis.find(k => Number(k.id) === Number(sec.kpi_id));
                      const availableScalarFields = (kpiObj?.fields || []).filter(f => f.field_type !== "multi_line_items");
                      const reportFieldKpiFieldIds = sec.fields.map(f => Number(f.kpi_field_id));
                      const missingFields = availableScalarFields.filter(f => !reportFieldKpiFieldIds.includes(Number(f.id)) && !dismissedMissingFieldIds.map(Number).includes(Number(f.id)));
                      return (
                        <div
                          key={sec.kpi_id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            background: "white",
                            boxShadow: "var(--shadow-sm)"
                          }}
                        >
                          {/* Heading Banner */}
                          <div style={{ padding: "0.6rem 0.85rem", background: "#f8fafc", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", borderTopLeftRadius: 9, borderTopRightRadius: 9 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--muted)" }}>{sec.number}</span>
                              <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text)" }}>{sec.custom_header || sec.kpi_name}</span>
                              {sec.custom_header && (
                                <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>({sec.kpi_name})</span>
                              )}
                            </div>

                            <div style={{ display: "flex", gap: "0.35rem" }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                style={{ padding: "2px 6px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)", color: "var(--primary)" }}
                                onClick={() => {
                                  const kpi = allKpis.find(k => k.id === sec.kpi_id);
                                  if (kpi) {
                                    loadKpiIntoEditor(kpi);
                                  } else {
                                    toast.error("KPI structure not found");
                                  }
                                }}
                              >
                                Edit KPI Structure
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                style={{ padding: "2px 6px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)" }}
                                onClick={() => setActiveItem({ type: "section", index: sIdx })}
                              >
                                Rename Heading
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                style={{ padding: "2px 6px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)", color: "var(--error)" }}
                                onClick={() => handleRemoveSection(sIdx)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          {/* Fields inside heading */}
                          <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {sec.fields.length === 0 ? (
                              <p style={{ margin: 0, padding: "0.5rem", fontSize: "0.8rem", color: "var(--muted)", fontStyle: "italic", textAlign: "center" }}>No fields inside this heading section.</p>
                            ) : (
                              sec.fields.map((f, fIdx) => (
                                <div
                                  key={f.kpi_field_id}
                                  draggable
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    handleFieldDragStart(sIdx, fIdx);
                                  }}
                                  onDragOver={(e) => handleFieldDragOver(e, sIdx, fIdx)}
                                  onDrop={(e) => {
                                    e.stopPropagation();
                                    handleFieldDrop(sIdx, fIdx);
                                  }}
                                  style={{
                                    padding: "0.5rem 0.75rem",
                                    background: "#f1f5f9",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: 6,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    cursor: "grab",
                                    opacity: (draggedFieldLoc?.secIdx === sIdx && draggedFieldLoc?.fieldIdx === fIdx) ? 0.4 : 1
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                    <span style={{ color: "#94a3b8", cursor: "grab", fontSize: "0.85rem" }}>⁝⁝</span>
                                    
                                    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleMoveFieldUp(sIdx, fIdx); }}
                                        disabled={fIdx === 0}
                                        style={{ border: "none", background: "none", color: fIdx === 0 ? "#cbd5e1" : "#64748b", cursor: fIdx === 0 ? "not-allowed" : "pointer", fontSize: "0.55rem", padding: 0 }}
                                      >
                                        ▲
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleMoveFieldDown(sIdx, fIdx); }}
                                        disabled={fIdx === sec.fields.length - 1}
                                        style={{ border: "none", background: "none", color: fIdx === sec.fields.length - 1 ? "#cbd5e1" : "#64748b", cursor: fIdx === sec.fields.length - 1 ? "not-allowed" : "pointer", fontSize: "0.55rem", padding: 0 }}
                                      >
                                        ▼
                                      </button>
                                    </div>

                                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 700 }}>{f.number}</span>
                                    <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text)" }}>{f.config?.custom_name || f.field_name}</span>
                                    {f.config?.custom_name && f.config.custom_name.trim() !== "" && f.config.custom_name !== f.field_name && (
                                      <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>({f.field_name})</span>
                                    )}
                                    <span style={{ fontSize: "0.7rem", padding: "1px 5px", background: f.field_type === "multi_line_items" ? "#e0f2fe" : "#f1f5f9", color: f.field_type === "multi_line_items" ? "#0369a1" : "#475569", borderRadius: 4, fontWeight: 700 }}>
                                      {f.field_type === "multi_line_items" ? "Table" : "Scalar"}
                                    </span>
                                  </div>

                                  <div style={{ display: "flex", gap: "0.35rem" }}>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      style={{ padding: "2px 8px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)" }}
                                      onClick={() => {
                                        setActiveItem({ type: "field", secIdx: sIdx, fieldIdx: fIdx });
                                        setBulkAlignCols([]);
                                        if (f.field_type === "multi_line_items") {
                                          const kpiObj = allKpis.find(k => Number(k.id) === Number(f.kpi_id));
                                          const kfield = (kpiObj?.fields || []).find(fld => Number(fld.id) === Number(f.kpi_field_id));
                                          const subFields = kfield?.sub_fields || [];
                                          setEditingFieldConfig({
                                            selected_columns: f.config?.selected_columns || subFields.map(sf => sf.key).slice(0, 5),
                                            filters: (f.config?.filters || { conditions: [], _version: 2 }) as any,
                                            sort_column: f.config?.sort_column || "",
                                            sort_direction: f.config?.sort_direction || "asc",
                                            merged_headers: f.config?.merged_headers || [],
                                            custom_sub_field_labels: f.config?.custom_sub_field_labels || {},
                                            column_alignments: f.config?.column_alignments || {}
                                          });
                                          setFilterDraft(payloadToFilterDraft((f.config?.filters || { conditions: [], _version: 2 }) as any));
                                        } else {
                                          const kpiObj = allKpis.find(k => Number(k.id) === Number(f.kpi_id));
                                          const kfield = (kpiObj?.fields || []).find(fld => Number(fld.id) === Number(f.kpi_field_id));
                                          setEditingFieldConfig({
                                            selected_columns: [],
                                            filters: { conditions: [], _version: 2 },
                                            custom_name: f.config?.custom_name || "",
                                            formula_expression: kfield?.formula_expression || ""
                                          });
                                        }
                                      }}
                                    >
                                      ⚙️ Configure
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      style={{ padding: "2px 8px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)", color: "var(--error)" }}
                                      onClick={() => handleRemoveField(sIdx, fIdx)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                          {missingFields.length > 0 && (
                            <div style={{ padding: "0.6rem 0.85rem", background: "rgba(245, 158, 11, 0.08)", borderTop: "1px solid rgba(245, 158, 11, 0.2)", borderBottomLeftRadius: 9, borderBottomRightRadius: 9, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "#d97706", fontWeight: 650 }}>
                                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#d97706", flexShrink: 0 }} />
                                This KPI has new scalar fields: {missingFields.map(f => f.name).join(", ")}
                              </span>
                              <div style={{ display: "flex", gap: "0.5rem" }}>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  style={{ fontSize: "0.72rem", padding: "2px 8px", background: "white", border: "1px solid rgba(245, 158, 11, 0.3)", color: "#d97706" }}
                                  onClick={() => {
                                    setDismissedMissingFieldIds(prev => [...prev, ...missingFields.map(f => f.id)]);
                                  }}
                                >
                                  Dismiss
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  style={{ fontSize: "0.72rem", padding: "2px 8px", background: "#d97706", border: "none", color: "white" }}
                                  onClick={() => {
                                    setSections(prev => {
                                      return prev.map((sec, idx) => {
                                        if (idx !== sIdx) return sec;

                                        const newFields = [...sec.fields];
                                        missingFields.forEach(f => {
                                          if (!newFields.some(rf => Number(rf.kpi_field_id) === Number(f.id))) {
                                            newFields.push({
                                              kpi_id: sec.kpi_id,
                                              kpi_field_id: f.id,
                                              field_name: f.name,
                                              field_type: f.field_type,
                                              sort_order: newFields.length,
                                              config: {
                                                custom_name: "",
                                                carry_forward_data: f.carry_forward_data
                                              }
                                            } as any);
                                          }
                                        });

                                        return {
                                          ...sec,
                                          fields: newFields
                                        };
                                      });
                                    });
                                    toast.success("Added new scalar fields to the report section!");
                                  }}
                                >
                                  Add to Report
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: General Branding & Configuration */}
            {activeItem.type === "general" && (
              <div style={{ display: "grid", gap: "1.25rem" }}>

                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                  
                  {/* Left block settings */}
                  <div style={{ display: "grid", gap: "1rem" }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Report Header Template</label>
                      <select
                        value={localReportHeaderId ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          const nextVal = val ? Number(val) : null;
                          setLocalReportHeaderId(nextVal);
                          autoSaveSettings({ report_header_id: nextVal });
                        }}
                        style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem", borderRadius: 6, border: "1px solid var(--border)", background: "white" }}
                      >
                        <option value="">No Header Template</option>
                        {customReportHeaders.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name} ({h.main_heading})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>Typography Settings</label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.25rem" }}>
                        <div>
                          <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>Scalar cells Font</label>
                          <select
                            value={localScalarFontFamily}
                            onChange={(e) => {
                              const val = e.target.value;
                              setLocalScalarFontFamily(val);
                              autoSaveSettings({ scalar_font_family: val });
                            }}
                            style={{ width: "100%", padding: "0.35rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)", background: "white" }}
                          >
                            {["Inter", "Roboto", "Outfit", "Helvetica", "Times-Roman", "Courier", "Georgia"].map(f => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 500 }}>Table cells Font</label>
                          <select
                            value={localMliFontFamily}
                            onChange={(e) => {
                              const val = e.target.value;
                              setLocalMliFontFamily(val);
                              autoSaveSettings({ mli_font_family: val });
                            }}
                            style={{ width: "100%", padding: "0.35rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)", background: "white" }}
                          >
                            {["Inter", "Roboto", "Outfit", "Helvetica", "Times-Roman", "Courier", "Georgia"].map(f => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Scalar cells (pt)</label>
                          <input
                            type="number"
                            min={6}
                            max={20}
                            value={localScalarFontSize}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setLocalScalarFontSize(val);
                              autoSaveSettings({ scalar_font_size: val });
                            }}
                            style={{ width: "100%", padding: "0.35rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Table cells (pt)</label>
                          <input
                            type="number"
                            min={6}
                            max={20}
                            value={localMliFontSize}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setLocalMliFontSize(val);
                              autoSaveSettings({ mli_font_size: val });
                            }}
                            style={{ width: "100%", padding: "0.35rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)" }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block" }}>Bold Scalar Values</label>
                      <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.82rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            checked={localScalarBold === true}
                            onChange={() => {
                              setLocalScalarBold(true);
                              autoSaveSettings({ scalar_bold: true });
                            }}
                          /> Yes (Bold)
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.82rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            checked={localScalarBold === false}
                            onChange={() => {
                              setLocalScalarBold(false);
                              autoSaveSettings({ scalar_bold: false });
                            }}
                          /> No (Regular)
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Right block settings */}
                  <div style={{ display: "grid", gap: "1rem" }}>
                    
                    <div style={{ display: "grid", gap: "0.4rem", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={localDateBasedFetching}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setLocalDateBasedFetching(checked);
                              autoSaveSettings({ fetch_data_with_date: checked });
                              if (checked) {
                                setShowDateConfigModal(true);
                              }
                            }}
                          />
                          Enable Date-Based Filtering
                        </label>
                        {localDateBasedFetching && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setShowDateConfigModal(true)}
                            style={{ padding: "2px 8px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)", borderRadius: "4px" }}
                          >
                            ⚙️ Configure
                          </button>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                        Allow mapping sections to organizational custom periods rather than calendar years.
                      </p>
                    </div>

                    <div style={{ display: "grid", gap: "0.4rem", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={localShowOdooButton}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setLocalShowOdooButton(checked);
                              autoSaveSettings({ show_odoo_button: checked });
                              if (checked) {
                                setShowLmsConfigModal(true);
                              }
                            }}
                          />
                          Display &quot;Load LMS Data&quot; Button
                        </label>
                        {localShowOdooButton && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setShowLmsConfigModal(true)}
                            style={{ padding: "2px 8px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)", borderRadius: "4px" }}
                          >
                            ⚙️ Configure
                          </button>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                        Let users manually trigger Odoo/LMS updates directly inside their report view.
                      </p>
                    </div>

                    <div style={{ display: "grid", gap: "0.4rem", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={localApplyFurtherProcessing}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setLocalApplyFurtherProcessing(checked);
                            autoSaveSettings({ apply_further_processing_based_on_mli_filter: checked });
                          }}
                        />
                        Apply Filter-Aware Scalar Calculation
                      </label>
                      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                        Apply MLI filters to table rows BEFORE scalar calculations run (avoids discrepancy in totals).
                      </p>
                    </div>

                    <div style={{ display: "grid", gap: "0.4rem", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={localShowReportName}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setLocalShowReportName(checked);
                            autoSaveSettings({ show_report_name: checked });
                          }}
                        />
                        Add Report Name as Header
                      </label>
                      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                        Display the custom report name as a main header on the page content when exporting.
                      </p>
                    </div>

                  </div>

                </div>

                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setActiveItem({ type: "outline" })}
                    style={{ fontSize: "0.85rem", padding: "0.45rem 1rem" }}
                  >
                    Cancel & Return
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      const nextConfig = {
                        ...dateFetchingConfig,
                        configured_kpi_ids: localConfiguredKpiIds,
                        kpi_mlis: localKpiMlis,
                        mli_date_cols: localMliDateCols,
                        period_type: localDefaultPeriodType,
                        default_period_type: localDefaultPeriodType,
                        default_period: localDefaultPeriod
                      };
                      setFetchDataWithDate(localDateBasedFetching);
                      setDateFetchingConfig(nextConfig);
                      setReportHeaderId(localReportHeaderId);
                      setShowReportName(localShowReportName);
                      setBrandingTitle(localBrandingTitle);
                      setScalarBold(localScalarBold);
                      setScalarFontSize(localScalarFontSize);
                      setMliFontSize(localMliFontSize);
                      setScalarFontFamily(localScalarFontFamily);
                      setMliFontFamily(localMliFontFamily);
                      setShowOdooButton(localShowOdooButton);
                      setOdooSyncKpiIds(localOdooSyncKpiIds);
                      setApplyFurtherProcessing(localApplyFurtherProcessing);

                      toast.success("Branding settings applied locally! (Save Layout to persist changes)");
                      setActiveItem({ type: "outline" });
                    }}
                    style={{ fontSize: "0.85rem", padding: "0.45rem 1rem" }}
                  >
                    Apply & Return
                  </button>
                </div>
              </div>
            )}

            {/* TAB: KPI Inplace Creator Panel */}
            {activeItem.type === "kpi-create" && (
              <div style={{ display: "grid", gap: "1rem" }}>

                {/* Mode Selector */}
                <div style={{ display: "flex", gap: "1rem", alignItems: "center", background: "#eff6ff", padding: "0.75rem", borderRadius: 8, border: "1px solid #bfdbfe", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e40af" }}>Workspace Mode:</span>
                    <button
                      type="button"
                      className={`btn btn-sm ${!editingKpiId ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => {
                        resetKpiEditor();
                      }}
                      style={{ fontSize: "0.75rem", padding: "3px 10px" }}
                    >
                      Create KPI
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${editingKpiId ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => {
                        if (allKpis.length > 0) {
                          loadKpiIntoEditor(allKpis[0]);
                        } else {
                          toast.error("No KPIs available to edit");
                        }
                      }}
                      style={{ fontSize: "0.75rem", padding: "3px 10px" }}
                    >
                      Edit Existing KPI
                    </button>
                  </div>

                  {editingKpiId && (
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: 1, minWidth: "200px" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e40af", whiteSpace: "nowrap" }}>Select KPI:</span>
                      <select
                        value={editingKpiId}
                        onChange={(e) => {
                          const kid = Number(e.target.value);
                          const kpi = allKpis.find(k => k.id === kid);
                          if (kpi) loadKpiIntoEditor(kpi);
                        }}
                        style={{ padding: "4px 8px", fontSize: "0.8rem", borderRadius: 6, background: "white", border: "1px solid #bfdbfe", flex: 1, minWidth: 0, maxWidth: "350px" }}
                      >
                        {allKpis.map(k => (
                          <option key={k.id} value={k.id}>{k.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* KPI Core Metadata */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", background: "#f8fafc", padding: "1rem", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>KPI Name (Required)</label>
                    <input type="text" className="form-control" value={newKpiName} onChange={(e) => setNewKpiName(e.target.value)} placeholder="Grants & Faculty Research" style={{ width: "100%", padding: "0.4rem" }} />
                  </div>
                  
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Description (Optional)</label>
                    <input type="text" className="form-control" value={newKpiDesc} onChange={(e) => setNewKpiDesc(e.target.value)} placeholder="Summary of metric details" style={{ width: "100%", padding: "0.4rem" }} />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Select Tag</label>
                    <select value={newKpiTag} onChange={(e) => setNewKpiTag(e.target.value === "" ? "" : Number(e.target.value))} style={{ width: "100%", padding: "0.4rem", borderRadius: 6, background: "white", border: "1px solid var(--border)" }}>
                      <option value="">Select Tag...</option>
                      {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: "0.82rem", fontWeight: 700 }}>Select Category</label>
                    <select value={newKpiCategory} onChange={(e) => setNewKpiCategory(e.target.value === "" ? "" : Number(e.target.value))} style={{ width: "100%", padding: "0.4rem", borderRadius: 6, background: "white", border: "1px solid var(--border)" }}>
                      <option value="">Select Category...</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* KPI Fields List Builder */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--text-secondary)" }}>KPI Fields Structures & Schema</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        setNewKpiFields(prev => [...prev, {
                          name: `Field #${prev.length + 1}`,
                          key: `field_${prev.length + 1}`,
                          field_type: "number",
                          is_required: false,
                          carry_forward_data: false,
                          sub_fields: []
                        }]);
                      }}
                      style={{ fontSize: "0.75rem", padding: "3px 8px" }}
                    >
                      ➕ Add Field Definition
                    </button>
                  </div>

                  {newKpiFields.length === 0 ? (
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", fontStyle: "italic", textAlign: "center", padding: "1.5rem", background: "#f8fafc", borderRadius: 8, border: "1px dashed var(--border)" }}>No fields added to KPI yet. Click &quot;Add Field Definition&quot; above to configure fields.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {newKpiFields.map((f, idx) => (
                        <div key={idx} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 8, padding: "0.85rem", display: "grid", gap: "0.5rem", boxShadow: "var(--shadow-sm)" }}>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <div style={{ flex: 2 }}>
                              <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 700 }}>Field Display Name</label>
                              <input
                                type="text"
                                value={f.name}
                                onChange={(e) => {
                                  const next = [...newKpiFields];
                                  next[idx].name = e.target.value;
                                  next[idx].key = slugifyKey(e.target.value);
                                  setNewKpiFields(next);
                                }}
                                placeholder="Total Faculty"
                                style={{ width: "100%", padding: "4px 8px", fontSize: "0.8rem" }}
                              />
                            </div>

                            <div style={{ flex: 1.5 }}>
                              <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 700 }}>Database Key</label>
                              <input
                                type="text"
                                value={f.key}
                                onChange={(e) => {
                                  const next = [...newKpiFields];
                                  next[idx].key = e.target.value;
                                  setNewKpiFields(next);
                                }}
                                placeholder="total_faculty"
                                style={{ width: "100%", padding: "4px 8px", fontSize: "0.8rem" }}
                              />
                            </div>

                            <div style={{ flex: 1.5 }}>
                              <label style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 700 }}>Data Type</label>
                              <select
                                value={f.field_type}
                                onChange={(e) => {
                                  const next = [...newKpiFields];
                                  const typeVal = e.target.value as typeof FIELD_TYPES[number];
                                  next[idx].field_type = typeVal;
                                  if (typeVal === "multi_line_items") {
                                    next[idx].sub_fields = [{ name: "Name", key: "name", field_type: "single_line_text", is_required: false }];
                                  } else {
                                    next[idx].sub_fields = [];
                                  }
                                  setNewKpiFields(next);
                                }}
                                style={{ width: "100%", padding: "4px", fontSize: "0.8rem" }}
                              >
                                {FIELD_TYPES.map((t) => (
                                  <option key={t} value={t}>{FIELD_TYPE_LABELS[t] || t}</option>
                                ))}
                              </select>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", justifyContent: "center", padding: "0 0.5rem" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={f.is_required}
                                  onChange={(e) => {
                                    const next = [...newKpiFields];
                                    next[idx].is_required = e.target.checked;
                                    setNewKpiFields(next);
                                  }}
                                /> Required
                              </label>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={f.carry_forward_data}
                                  onChange={(e) => {
                                    const next = [...newKpiFields];
                                    next[idx].carry_forward_data = e.target.checked;
                                    setNewKpiFields(next);
                                  }}
                                /> Carry Forward
                              </label>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                              {f.id && (
                                <span title="Warning: Deleting this existing field will remove all its saved data and references." style={{ cursor: "help", color: "#d97706", fontSize: "0.95rem" }}>
                                  ⚠️
                                </span>
                              )}
                              <button
                                type="button"
                                style={{ color: "var(--error)", border: "none", background: "none", fontSize: "1.3rem", fontWeight: 700, cursor: "pointer", padding: "0.25rem" }}
                                onClick={() => {
                                  if (f.id) {
                                    setDeletedFieldIds(prev => [...prev, f.id!]);
                                  }
                                  setNewKpiFields(newKpiFields.filter((_, i) => i !== idx));
                                }}
                              >
                                ×
                              </button>
                            </div>
                          </div>

                          {/* Formula Settings */}
                          {f.field_type === "formula" && (
                            <div style={{ background: "var(--bg-subtle)", padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
                                <label style={{ fontSize: "0.72rem", fontWeight: 700, margin: 0 }}>Formula Expression</label>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => {
                                    setOriginalFormulaExpr(f.formula_expression || "");
                                    setBuildingFormulaKpiFieldIndex(idx);
                                  }}
                                  style={{ padding: "1px 6px", fontSize: "0.68rem", background: "white", border: "1px solid var(--border)", borderRadius: "4px" }}
                                >
                                  ⚡ Open Formula Builder
                                </button>
                              </div>
                              <input
                                type="text"
                                value={f.formula_expression || ""}
                                onChange={(e) => {
                                  const next = [...newKpiFields];
                                  next[idx].formula_expression = e.target.value;
                                  setNewKpiFields(next);
                                }}
                                placeholder="e.g. SUM(total_faculty) or variable_a * variable_b"
                                style={{ width: "100%", padding: "4px 8px", fontSize: "0.8rem", border: "1px solid var(--border)", borderRadius: 4 }}
                              />
                            </div>
                          )}

                          {/* Table MLI Columns subfields list */}
                          {f.field_type === "multi_line_items" && (
                            <div style={{ borderLeft: "3px solid var(--primary)", paddingLeft: "0.75rem", display: "grid", gap: "0.35rem", marginTop: "0.25rem" }}>
                              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Table Columns (Sub Fields):</span>
                              
                              {f.sub_fields.map((sf, sfIdx) => (
                                <div key={sfIdx} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                                  <input
                                    type="text"
                                    value={sf.name}
                                    onChange={(e) => {
                                      const next = [...newKpiFields];
                                      next[idx].sub_fields[sfIdx].name = e.target.value;
                                      next[idx].sub_fields[sfIdx].key = slugifyKey(e.target.value);
                                      setNewKpiFields(next);
                                    }}
                                    placeholder="Column Name (e.g. Total Awarded)"
                                    style={{ flex: 2, padding: "2px 6px", fontSize: "0.75rem" }}
                                  />
                                  <input
                                    type="text"
                                    value={sf.key}
                                    onChange={(e) => {
                                      const next = [...newKpiFields];
                                      next[idx].sub_fields[sfIdx].key = e.target.value;
                                      setNewKpiFields(next);
                                    }}
                                    placeholder="total_awarded"
                                    style={{ flex: 1.5, padding: "2px 6px", fontSize: "0.75rem" }}
                                  />
                                  <select
                                    value={sf.field_type}
                                    onChange={(e) => {
                                      const next = [...newKpiFields];
                                      const nextType = e.target.value as any;
                                      next[idx].sub_fields[sfIdx].field_type = nextType;
                                      if (nextType !== "formula" && next[idx].sub_fields[sfIdx].config?.data_source !== "linked") {
                                        delete next[idx].sub_fields[sfIdx].config;
                                      }
                                      setNewKpiFields(next);
                                    }}
                                    style={{ flex: 1.5, padding: "2px", fontSize: "0.75rem" }}
                                  >
                                    {SUB_FIELD_TYPES.map((t) => (
                                      <option key={t} value={t}>{SUB_FIELD_TYPE_LABELS[t] || t}</option>
                                    ))}
                                  </select>

                                  {sf.field_type !== "formula" && (
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      style={{
                                        padding: "2px 6px",
                                        fontSize: "0.72rem",
                                        whiteSpace: "nowrap",
                                        background: sf.config?.data_source === "linked" ? "#e0f2fe" : "white",
                                        color: sf.config?.data_source === "linked" ? "#0369a1" : "var(--text)",
                                        border: "1px solid var(--border)",
                                        borderRadius: 4
                                      }}
                                      onClick={() => {
                                        setKpiCreatorLinkModal({
                                          fieldIndex: idx,
                                          subIndex: sfIdx,
                                          subField: {
                                            name: sf.name,
                                            key: sf.key || slugifyKey(sf.name),
                                            field_type: sf.field_type,
                                            config: sf.config || {}
                                          },
                                          allSubFields: f.sub_fields || []
                                        });
                                      }}
                                    >
                                      ⚙️ Link
                                    </button>
                                  )}

                                  {sf.field_type === "formula" && (
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-secondary"
                                      style={{
                                        padding: "2px 6px",
                                        fontSize: "0.72rem",
                                        whiteSpace: "nowrap",
                                        background: sf.config?.formula_expression ? "#e0f2fe" : "white",
                                        color: sf.config?.formula_expression ? "#0369a1" : "var(--text)",
                                        border: "1px solid var(--border)",
                                        borderRadius: 4
                                      }}
                                      onClick={() => {
                                        setKpiCreatorFormulaModal({
                                          fieldIndex: idx,
                                          subIndex: sfIdx,
                                          subField: {
                                            name: sf.name,
                                            key: sf.key || slugifyKey(sf.name),
                                            field_type: sf.field_type,
                                            config: sf.config || {}
                                          },
                                          allSubFields: f.sub_fields.map(s => ({
                                            name: s.name,
                                            key: s.key || slugifyKey(s.name),
                                            field_type: s.field_type,
                                            config: s.config || {}
                                          }))
                                        });
                                      }}
                                    >
                                      {sf.config?.formula_expression ? `⚙️ fx: ${sf.config.formula_expression}` : "⚙️ Config Formula"}
                                    </button>
                                  )}

                                  <label style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "0.68rem" }}>
                                    <input
                                      type="checkbox"
                                      checked={sf.is_required}
                                      onChange={(e) => {
                                        const next = [...newKpiFields];
                                        next[idx].sub_fields[sfIdx].is_required = e.target.checked;
                                        setNewKpiFields(next);
                                      }}
                                    /> Req
                                  </label>

                                  <button
                                    type="button"
                                    style={{ border: "none", background: "none", color: "var(--error)", fontSize: "1rem", cursor: "pointer" }}
                                    onClick={() => {
                                      const next = [...newKpiFields];
                                      next[idx].sub_fields = next[idx].sub_fields.filter((_, sfi) => sfi !== sfIdx);
                                      setNewKpiFields(next);
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}

                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                style={{ fontSize: "0.72rem", padding: "2px 8px", alignSelf: "flex-start", marginTop: "0.25rem" }}
                                onClick={() => {
                                  const next = [...newKpiFields];
                                  next[idx].sub_fields.push({
                                    name: `Column #${f.sub_fields.length + 1}`,
                                    key: `column_${f.sub_fields.length + 1}`,
                                    field_type: "single_line_text",
                                    is_required: false
                                  });
                                  setNewKpiFields(next);
                                }}
                              >
                                ➕ Add Column Header
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { resetKpiEditor(); setActiveItem({ type: "outline" }); }}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={editingKpiId ? handleUpdateKpiSubmit : handleCreateKpiSubmit} disabled={saveSaving}>
                    {saveSaving ? (editingKpiId ? "Updating..." : "Creating...") : (editingKpiId ? "Update KPI Structure" : "Save KPI & Add to Report")}
                  </button>
                </div>
              </div>
            )}

            {/* TAB: KPI Testing Console */}
            {activeItem.type === "kpi-test" && (
              <div style={{ display: "grid", gap: "1rem" }}>


                <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", background: "var(--bg-subtle)", padding: "0.75rem", borderRadius: 8, border: "1px solid var(--border)" }}>
                  
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 650 }}>Select Target KPI</label>
                    <select
                      value={testingKpiId ?? ""}
                      onChange={(e) => setTestingKpiId(e.target.value === "" ? null : Number(e.target.value))}
                      style={{ width: "100%", padding: "0.35rem", borderRadius: 5 }}
                    >
                      <option value="">Choose KPI...</option>
                      {allKpis.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </select>
                  </div>

                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 650 }}>Test Year</label>
                    <input
                      type="number"
                      value={testYear}
                      onChange={(e) => setTestYear(Number(e.target.value))}
                      style={{ width: "100%", padding: "0.3rem", borderRadius: 5, border: "1px solid var(--border)" }}
                    />
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: "0.35rem 1rem" }}
                    onClick={() => testingKpiId && handleRunKpiTest(testingKpiId)}
                    disabled={testRunning || !testingKpiId}
                  >
                    {testRunning ? "Running..." : "Fetch Data"}
                  </button>
                </div>

                {/* Test results printout */}
                {testResults && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "1rem", display: "grid", gap: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Test Status: <strong style={{ color: testResults.status === "valid" ? "var(--success)" : "var(--error)" }}>{testResults.status.toUpperCase()}</strong></span>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Records Found: <strong>{testResults.recordsFound}</strong></span>
                    </div>

                    {testResults.errors.length > 0 && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.5rem", color: "var(--error)", fontSize: "0.8rem" }}>
                        <strong>Errors/Warnings:</strong>
                        {testResults.errors.map((err, i) => <div key={i}>{err}</div>)}
                      </div>
                    )}

                    {/* Scalar Values output table */}
                    {testResults.scalarValues.length > 0 && (
                      <div>
                        <strong style={{ fontSize: "0.82rem", display: "block", marginBottom: "0.25rem" }}>Scalar Values:</strong>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                          <thead>
                            <tr style={{ background: "#f8fafc", borderBottom: "1px solid var(--border)" }}>
                              <th style={{ textAlign: "left", padding: "4px" }}>Field Name</th>
                              <th style={{ textAlign: "left", padding: "4px" }}>Key</th>
                              <th style={{ textAlign: "right", padding: "4px" }}>Computed Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {testResults.scalarValues.map((sv, i) => (
                              <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "4px" }}>{sv.name}</td>
                                <td style={{ padding: "4px" }}><code>{sv.key}</code></td>
                                <td style={{ padding: "4px", textAlign: "right", fontWeight: 700 }}>{String(sv.val)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* MLI Data Tables output */}
                    {Object.entries(testResults.mliFieldsData).map(([key, data]) => (
                      <div key={key} style={{ marginTop: "0.5rem" }}>
                        <strong style={{ fontSize: "0.82rem", display: "block", marginBottom: "0.25rem" }}>Table field: <code>{key}</code></strong>
                        {data.rows.length === 0 ? (
                          <div style={{ fontSize: "0.75rem", fontStyle: "italic", color: "var(--muted)", padding: "0.25rem" }}>Table has no rows for this period.</div>
                        ) : (
                          <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                            <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                              <thead>
                                <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
                                  {data.columns.map(col => <th key={col} style={{ padding: "4px", textAlign: "left" }}>{col}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {data.rows.map((row, rIdx) => (
                                  <tr key={rIdx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                    {data.columns.map(col => (
                                      <td key={col} style={{ padding: "4px" }}>
                                        {String(row?.data?.[col] ?? row?.[col] ?? "—")}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setActiveItem({ type: "outline" })}
                    style={{ fontSize: "0.85rem", padding: "0.45rem 1rem" }}
                  >
                    Return to Layout
                  </button>
                </div>
              </div>
            )}

            {/* TAB: Heading Section Configurator */}
            {activeItem.type === "section" && (() => {
              const sec = sections[activeItem.index!];
              if (!sec) return null;
              return (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div className="form-group">
                    <label style={{ fontSize: "0.82rem", fontWeight: 650 }}>Heading Title / Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={sec.custom_header || sec.kpi_name || ""}
                      onChange={(e) => handleSectionHeaderChange(activeItem.index!, e.target.value)}
                      style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
                      placeholder="e.g. Department Wise Patents Submission Status"
                      autoFocus
                    />
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                      Provide a custom label for this report heading section. If empty, the KPI name will be used.
                    </p>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "1rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setActiveItem({ type: "outline" })}
                    >
                      Done & Return
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* TAB: Field Detailed Settings */}
            {activeItem.type === "field" && (() => {
              const sec = sections[activeItem.secIdx!];
              const f = sec.fields[activeItem.fieldIdx!];
              const kpiObj = allKpis.find(k => Number(k.id) === Number(f.kpi_id));
              const kfield = kpiObj?.fields.find(fld => Number(fld.id) === Number(f.kpi_field_id));
              const subFields = kfield?.sub_fields || [];

              return (
                <div style={{ display: "grid", gap: "1rem" }}>


                  {/* Config selector for MLIs */}
                  {f.field_type === "multi_line_items" ? (
                    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", gap: "0.25rem", margin: "0.5rem 0" }}>
                      <button type="button" className={`btn btn-sm ${activeMliTab === "columns" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveMliTab("columns")} style={{ padding: "0.25rem 0.65rem", fontSize: "0.78rem" }}>📋 Columns & Headers</button>
                      <button type="button" className={`btn btn-sm ${activeMliTab === "widths" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveMliTab("widths")} style={{ padding: "0.25rem 0.65rem", fontSize: "0.78rem" }}>📐 Column Widths</button>
                      <button type="button" className={`btn btn-sm ${activeMliTab === "filters" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveMliTab("filters")} style={{ padding: "0.25rem 0.65rem", fontSize: "0.78rem" }}>🔍 Row Filters & Sort</button>
                      <button type="button" className={`btn btn-sm ${activeMliTab === "footer" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveMliTab("footer")} style={{ padding: "0.25rem 0.65rem", fontSize: "0.78rem" }}>📊 Table Footer</button>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: "1rem", background: "white", padding: "1rem", borderRadius: 8, border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem", marginBottom: "0.5rem" }}>
                        <strong>Scalar Field:</strong> {f.field_name} (System Key: <code>{f.field_key}</code>)
                      </div>
                      
                      <div className="form-group">
                        <label style={{ fontWeight: 650, fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>Rename Field (Report display only)</label>
                        <input
                          type="text"
                          className="form-control"
                          value={editingFieldConfig?.custom_name || ""}
                          onChange={(e) => setEditingFieldConfig(prev => prev ? { ...prev, custom_name: e.target.value } : { selected_columns: [], filters: { conditions: [], _version: 2 }, custom_name: e.target.value })}
                          placeholder={f.field_name}
                          style={{ width: "100%", padding: "0.45rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)" }}
                        />
                        <p style={{ margin: "4px 0 0", fontSize: "0.73rem", color: "var(--muted)" }}>
                          The new name will only be presented in reports. Leave empty to use system default name.
                        </p>
                      </div>

                      {f.field_type === "formula" && (
                        <div className="form-group" style={{ marginTop: "0.5rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                            <label style={{ fontWeight: 650, fontSize: "0.85rem", margin: 0 }}>Formula Expression</label>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => {
                                setOriginalFormulaExpr(editingFieldConfig?.formula_expression || "");
                                setShowFormulaBuilderModal(true);
                              }}
                              style={{ padding: "2px 8px", fontSize: "0.72rem", background: "white", border: "1px solid var(--border)", borderRadius: "4px" }}
                            >
                              ⚡ Open Formula Builder
                            </button>
                          </div>
                          <textarea
                            className="form-control"
                            value={editingFieldConfig?.formula_expression || ""}
                            onChange={(e) => setEditingFieldConfig(prev => prev ? { ...prev, formula_expression: e.target.value } : { selected_columns: [], filters: { conditions: [], _version: 2 }, formula_expression: e.target.value })}
                            placeholder="e.g. some_scalar_key + 10"
                            style={{ width: "100%", height: "80px", padding: "0.45rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "monospace" }}
                          />
                          <p style={{ margin: "4px 0 0", fontSize: "0.73rem", color: "var(--muted)" }}>
                            This formula is evaluated to calculate the field&apos;s value. Changes here will be reflected directly in the KPI values.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MLI Tab 1: Columns selector & Ordering */}
                  {f.field_type === "multi_line_items" && activeMliTab === "columns" && editingFieldConfig && (
                    <div style={{ display: "grid", gap: "1rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: "1rem" }}>
                        <div>
                          <label style={{ fontWeight: 650, fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>Select Visible Columns</label>
                          <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", maxHeight: 150, overflowY: "auto", background: "white" }}>
                            {subFields.map(sf => {
                              const isChecked = editingFieldConfig.selected_columns.includes(sf.key);
                              return (
                                <label key={sf.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", padding: "2px 0", cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      let nextCols = [...editingFieldConfig.selected_columns];
                                      if (isChecked) nextCols = nextCols.filter(c => c !== sf.key);
                                      else nextCols = [...nextCols, sf.key];
                                      setEditingFieldConfig({ ...editingFieldConfig, selected_columns: nextCols });
                                    }}
                                  />
                                  {sf.name}
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <label style={{ fontWeight: 655, fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>Reorder Columns & Labels</label>
                          <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.4rem", maxHeight: 150, overflowY: "auto", background: "#f8fafc" }}>
                            {editingFieldConfig.selected_columns.map((colKey, idx) => {
                              const sf = subFields.find(s => s.key === colKey);
                              const curLabel = editingFieldConfig.custom_sub_field_labels?.[colKey] ?? sf?.name ?? colKey;
                              return (
                                <div key={colKey} style={{ display: "flex", alignItems: "center", gap: "0.35rem", background: "white", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", marginBottom: "2px", fontSize: "0.78rem" }}>
                                  <input
                                    type="text"
                                    value={curLabel}
                                    onChange={(e) => {
                                      const nextLabels = { ...(editingFieldConfig.custom_sub_field_labels || {}), [colKey]: e.target.value };
                                      setEditingFieldConfig({ ...editingFieldConfig, custom_sub_field_labels: nextLabels });
                                    }}
                                    style={{ flex: 1, padding: "1px 4px", fontSize: "0.78rem", border: "1px solid var(--border)", borderRadius: 4 }}
                                  />
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => {
                                      const nextCols = [...editingFieldConfig.selected_columns];
                                      const temp = nextCols[idx];
                                      nextCols[idx] = nextCols[idx - 1];
                                      nextCols[idx - 1] = temp;
                                      setEditingFieldConfig({ ...editingFieldConfig, selected_columns: nextCols });
                                    }}
                                    style={{ padding: "0 4px", fontSize: "0.6rem" }}
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === editingFieldConfig.selected_columns.length - 1}
                                    onClick={() => {
                                      const nextCols = [...editingFieldConfig.selected_columns];
                                      const temp = nextCols[idx];
                                      nextCols[idx] = nextCols[idx + 1];
                                      nextCols[idx + 1] = temp;
                                      setEditingFieldConfig({ ...editingFieldConfig, selected_columns: nextCols });
                                    }}
                                    style={{ padding: "0 4px", fontSize: "0.6rem" }}
                                  >
                                    ▼
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Merged Headers */}
                      <div>
                        <label style={{ fontWeight: 650, fontSize: "0.85rem", display: "block" }}>Merged Group Columns Sizing</label>
                        <p style={{ margin: "2px 0 0.5rem", fontSize: "0.73rem", color: "var(--muted)" }}>Merge column header cells under a parent header title cell.</p>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                          {(editingFieldConfig.merged_headers || []).map((group, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.35rem", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 5 }}>
                              <input
                                type="text"
                                placeholder="Group Label (e.g. Total)"
                                value={group.title}
                                onChange={(e) => {
                                  const nextG = [...(editingFieldConfig.merged_headers || [])];
                                  nextG[idx] = { ...nextG[idx], title: e.target.value };
                                  setEditingFieldConfig({ ...editingFieldConfig, merged_headers: nextG });
                                }}
                                style={{ flex: 1, padding: "2px 6px", fontSize: "0.78rem", border: "1px solid var(--border)", borderRadius: 4 }}
                              />
                              <select
                                value={group.start_key}
                                onChange={(e) => {
                                  const nextG = [...(editingFieldConfig.merged_headers || [])];
                                  nextG[idx] = { ...nextG[idx], start_key: e.target.value };
                                  setEditingFieldConfig({ ...editingFieldConfig, merged_headers: nextG });
                                }}
                                style={{ padding: "2px", fontSize: "0.78rem" }}
                              >
                                {editingFieldConfig.selected_columns.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <span>to</span>
                              <select
                                value={group.end_key}
                                onChange={(e) => {
                                  const nextG = [...(editingFieldConfig.merged_headers || [])];
                                  nextG[idx] = { ...nextG[idx], end_key: e.target.value };
                                  setEditingFieldConfig({ ...editingFieldConfig, merged_headers: nextG });
                                }}
                                style={{ padding: "2px", fontSize: "0.78rem" }}
                              >
                                {editingFieldConfig.selected_columns.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <button
                                type="button"
                                style={{ color: "var(--error)", border: "none", background: "none", fontSize: "0.85rem" }}
                                onClick={() => {
                                  const nextG = (editingFieldConfig.merged_headers || []).filter((_, i) => i !== idx);
                                  setEditingFieldConfig({ ...editingFieldConfig, merged_headers: nextG });
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            style={{ alignSelf: "flex-start", fontSize: "0.75rem", padding: "2px 8px" }}
                            onClick={() => {
                              const nextG = [...(editingFieldConfig.merged_headers || []), { title: "New Group", start_key: editingFieldConfig.selected_columns[0] || "", end_key: editingFieldConfig.selected_columns[0] || "" }];
                              setEditingFieldConfig({ ...editingFieldConfig, merged_headers: nextG });
                            }}
                          >
                            + Add Merged Group
                          </button>
                        </div>
                      </div>

                      {/* Column Alignments Overrides */}
                      <div style={{ borderTop: "1px dashed var(--border)", paddingTop: "0.85rem" }}>
                        <label style={{ fontWeight: 650, fontSize: "0.85rem", display: "block" }}>Configure Column Alignments</label>
                        <p style={{ margin: "2px 0 0.5rem", fontSize: "0.73rem", color: "var(--muted)" }}>Select columns to configure their body alignment. By default, the first data column (after SR) is left-aligned, all others are center-aligned.</p>
                        
                        <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: "1rem", alignItems: "start" }}>
                          <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", maxHeight: 150, overflowY: "auto", background: "white" }}>
                            {editingFieldConfig.selected_columns.map((colKey, idx) => {
                              const sf = subFields.find(s => s.key === colKey);
                              const name = editingFieldConfig.custom_sub_field_labels?.[colKey] ?? sf?.name ?? colKey;
                              const alignVal = editingFieldConfig.column_alignments?.[colKey] ?? (idx === 0 ? "left" : "center");
                              const isChecked = bulkAlignCols.includes(colKey);

                              return (
                                <div key={colKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.78rem" }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", margin: 0 }}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {
                                        if (isChecked) {
                                          setBulkAlignCols(prev => prev.filter(c => c !== colKey));
                                        } else {
                                          setBulkAlignCols(prev => [...prev, colKey]);
                                        }
                                      }}
                                    />
                                    <span style={{ fontWeight: isChecked ? 600 : 400 }}>{name}</span>
                                  </label>
                                  <span style={{ fontSize: "0.72rem", color: "var(--muted)", textTransform: "capitalize", paddingRight: "4px" }}>
                                    ({alignVal})
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>Apply Alignment to ({bulkAlignCols.length} selected):</div>
                            <div style={{ display: "flex", gap: "0.25rem" }}>
                              {(["left", "center", "right"] as const).map(align => (
                                <button
                                  key={align}
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  disabled={bulkAlignCols.length === 0}
                                  onClick={() => {
                                    const nextAlignments = { ...(editingFieldConfig.column_alignments || {}) };
                                    bulkAlignCols.forEach(colKey => {
                                      nextAlignments[colKey] = align;
                                    });
                                    setEditingFieldConfig({ ...editingFieldConfig, column_alignments: nextAlignments });
                                  }}
                                  style={{ flex: 1, padding: "4px", fontSize: "0.75rem", textTransform: "capitalize" }}
                                >
                                  {align}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              style={{ fontSize: "0.72rem", padding: "2px 4px" }}
                              onClick={() => {
                                if (bulkAlignCols.length === editingFieldConfig.selected_columns.length) {
                                  setBulkAlignCols([]);
                                } else {
                                  setBulkAlignCols([...editingFieldConfig.selected_columns]);
                                }
                              }}
                            >
                              {bulkAlignCols.length === editingFieldConfig.selected_columns.length ? "Deselect All" : "Select All Columns"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MLI Tab 2: Column Width Configuration */}
                  {f.field_type === "multi_line_items" && activeMliTab === "widths" && (
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 650, fontSize: "0.85rem" }}>Set Column Widths (pixels)</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          style={{ fontSize: "0.72rem" }}
                          onClick={() => {
                            setEditingWidthsLoc({ secIdx: activeItem.secIdx!, fieldIdx: activeItem.fieldIdx! });
                          }}
                        >
                          📐 Visual Width Resizer Board
                        </button>
                      </div>
                      
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.5rem" }}>
                        {(f.config?.selected_columns || subFields.map(sf => sf.key).slice(0, 5)).map((colKey: string) => {
                          const sf = subFields.find(s => s.key === colKey);
                          const wVal = (f.config?.column_widths as any)?.[colKey] ?? 120;
                          return (
                            <div key={colKey} style={{ display: "flex", flexDirection: "column", gap: "2px", background: "#f8fafc", padding: "0.35rem", borderRadius: 5, border: "1px solid var(--border)" }}>
                              <span style={{ fontSize: "0.72rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sf?.name || colKey}>{sf?.name || colKey}</span>
                              <input
                                type="number"
                                min={30}
                                max={800}
                                value={wVal}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setSections(prev => {
                                    const next = prev.map((s, sIdx) => {
                                      if (sIdx !== activeItem.secIdx) return s;
                                      const fields = s.fields.map((fld, fldIdx) => {
                                        if (fldIdx !== activeItem.fieldIdx) return fld;
                                        const cWidths = { ...((fld.config?.column_widths || {}) as any), [colKey]: val };
                                        return { ...fld, config: { ...(fld.config || {}), column_widths: cWidths } };
                                      });
                                      return { ...s, fields };
                                    });
                                    return next;
                                  });
                                }}
                                style={{ width: "100%", padding: "1px 4px", fontSize: "0.78rem" }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* MLI Tab 3: Row filters & Sorting */}
                  {f.field_type === "multi_line_items" && activeMliTab === "filters" && editingFieldConfig && token && (
                    <div style={{ display: "grid", gap: "0.85rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 650 }}>Sort Column</label>
                          <select
                            value={editingFieldConfig.sort_column || ""}
                            onChange={(e) => setEditingFieldConfig({ ...editingFieldConfig, sort_column: e.target.value })}
                            style={{ width: "100%", padding: "0.25rem", fontSize: "0.8rem" }}
                          >
                            <option value="">No Sorting</option>
                            {subFields.map(sf => <option key={sf.key} value={sf.key}>{sf.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 650 }}>Sort Direction</label>
                          <select
                            value={editingFieldConfig.sort_direction || "asc"}
                            onChange={(e) => setEditingFieldConfig({ ...editingFieldConfig, sort_direction: e.target.value })}
                            style={{ width: "100%", padding: "0.25rem", fontSize: "0.8rem" }}
                          >
                            <option value="asc">Ascending (A-Z / 0-9)</option>
                            <option value="desc">Descending (Z-A / 9-0)</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                          <span style={{ fontWeight: 650, fontSize: "0.85rem" }}>Row Filtering Conditions</span>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setOpenFilterFieldKey(!openFilterFieldKey)}
                            style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                          >
                            {openFilterFieldKey ? "Hide Filter Builder ▲" : "Show Filter Builder ▼"}
                          </button>
                        </div>

                        {openFilterFieldKey && (
                          <div style={{ marginBottom: "0.5rem", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", background: "white" }}>
                            <MultiItemsAdvancedFiltersPanel
                              token={token}
                              effectiveOrgId={orgId}
                              subFields={subFields.map(sf => ({ ...sf, field_type: sf.field_type || null }))}
                              filterDraft={filterDraft}
                              setFilterDraft={setFilterDraft}
                              sourceKpiFieldsById={sourceKpiFieldsById}
                              setSourceKpiFieldsById={setSourceKpiFieldsById}
                              refFilterOptions={refFilterOptions}
                              setRefFilterOptions={setRefFilterOptions}
                              fieldId={f.kpi_field_id}
                              year={previewYear}
                              onApply={(draft) => {
                                const payload = filterDraftToPayload(draft, subFields.map(sf => ({ ...sf, field_type: sf.field_type || null })));
                                setEditingFieldConfig({
                                  ...editingFieldConfig,
                                  filters: (payload || { conditions: [], _version: 2 }) as any
                                });
                                setOpenFilterFieldKey(false);
                                toast.success("Filters applied locally.");
                              }}
                              onClose={() => setOpenFilterFieldKey(false)}
                              showCloseButton={true}
                            />
                          </div>
                        )}

                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}>
                          {editingFieldConfig.filters?.conditions.length === 0 ? (
                            <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>No active row filters.</span>
                          ) : (
                            editingFieldConfig.filters?.conditions.map((cond, condIdx) => {
                              const sub = subFields.find(s => s.key === cond.field);
                              return (
                                <div key={condIdx} style={{ display: "inline-flex", alignItems: "center", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 16, padding: "1px 8px", fontSize: "0.72rem", gap: "4px" }}>
                                  <span>{sub?.name || cond.field} {cond.op} {String(cond.value ?? cond.values?.join(", "))}</span>
                                  <button
                                    type="button"
                                    style={{ border: "none", background: "none", color: "var(--error)", cursor: "pointer", fontWeight: 700 }}
                                    onClick={() => {
                                      const nextPayload = removeConditionFromPayload(editingFieldConfig.filters as any, condIdx);
                                      setEditingFieldConfig({
                                        ...editingFieldConfig,
                                        filters: (nextPayload || { conditions: [], _version: 2 }) as any
                                      });
                                      setFilterDraft(payloadToFilterDraft(nextPayload as any));
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MLI Tab 4: Table Footer rows */}
                  {f.field_type === "multi_line_items" && activeMliTab === "footer" && (
                    <div style={{ display: "grid", gap: "0.85rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 650, fontSize: "0.85rem" }}>Table Footer Settings</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          style={{ fontSize: "0.75rem" }}
                          onClick={() => {
                            setEditingFooterLoc({ secIdx: activeItem.secIdx!, fieldIdx: activeItem.fieldIdx! });
                          }}
                        >
                          📊 Configure Footer Rows & Formulas
                        </button>
                      </div>
                      
                      <div style={{ background: "var(--bg-subtle)", padding: "0.5rem 0.75rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.78rem" }}>
                        Footer Status: <span style={{ fontWeight: 600 }}>{(f.config as any)?.footer_config?.enabled ? "🟢 Enabled" : "⚪ Disabled"}</span>
                        {(f.config as any)?.footer_config?.enabled && (
                          <div>Rows Configured: <span style={{ fontWeight: 600 }}>{(f.config as any).footer_config.rows?.length || 0}</span></div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Apply / Save local configs */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.85rem", display: "flex", justifyContent: "space-between" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleRemoveField(activeItem.secIdx!, activeItem.fieldIdx!)} style={{ color: "var(--error)", borderColor: "#fca5a5" }}>
                      Delete Field
                    </button>
                    <div style={{ display: "flex", gap: "0.35rem" }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveItem({ type: "outline" })}>Cancel</button>
                      {editingFieldConfig && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={fieldConfigSaving}
                          onClick={async () => {
                            if (f.field_type === "multi_line_items") {
                              setSections(prev => {
                                const next = [...prev];
                                const cur = next[activeItem.secIdx!].fields[activeItem.fieldIdx!];
                                next[activeItem.secIdx!].fields[activeItem.fieldIdx!] = {
                                  ...cur,
                                  config: {
                                    ...(cur.config || {}),
                                    selected_columns: editingFieldConfig.selected_columns || [],
                                    filters: editingFieldConfig.filters || { conditions: [], _version: 2 },
                                    sort_column: editingFieldConfig.sort_column,
                                    sort_direction: editingFieldConfig.sort_direction,
                                    merged_headers: editingFieldConfig.merged_headers,
                                    custom_sub_field_labels: editingFieldConfig.custom_sub_field_labels,
                                    column_alignments: editingFieldConfig.column_alignments || {}
                                  }
                                };
                                return next;
                              });
                              toast.success("Columns applied locally! (Save Layout to persist changes)");
                              setActiveItem({ type: "outline" });
                            } else {
                              // Scalar field configuration
                              setFieldConfigSaving(true);
                              try {
                                if (f.field_type === "formula") {
                                  const token = getAccessToken();
                                  if (!token) throw new Error("Not signed in");
                                  
                                  // Update formula expression on backend
                                  await api(`/fields/${f.kpi_field_id}?organization_id=${orgId}`, {
                                    method: "PATCH",
                                    token,
                                    body: JSON.stringify({
                                      formula_expression: editingFieldConfig.formula_expression || ""
                                    })
                                  });
                                  
                                  // Update the formula expression in allKpis so the builder is up to date
                                  setAllKpis(prev => prev.map(k => {
                                    if (k.id !== f.kpi_id) return k;
                                    return {
                                      ...k,
                                      fields: k.fields.map(fld => {
                                        if (fld.id !== f.kpi_field_id) return fld;
                                        return { ...fld, formula_expression: editingFieldConfig.formula_expression };
                                      })
                                    };
                                  }));
                                }
                                
                                // Apply custom rename locally
                                setSections(prev => {
                                  const next = [...prev];
                                  const cur = next[activeItem.secIdx!].fields[activeItem.fieldIdx!];
                                  next[activeItem.secIdx!].fields[activeItem.fieldIdx!] = {
                                    ...cur,
                                    config: {
                                      ...(cur.config || {}),
                                      custom_name: editingFieldConfig.custom_name || null
                                    }
                                  };
                                  return next;
                                });
                                
                                toast.success(
                                  f.field_type === "formula"
                                    ? "Formula saved and scalar rename applied locally! (Save Layout to persist report name)"
                                    : "Scalar rename applied locally! (Save Layout to persist changes)"
                                );
                                setActiveItem({ type: "outline" });
                              } catch (err: any) {
                                toast.error(err.message || "Failed to update field configuration");
                              } finally {
                                setFieldConfigSaving(false);
                              }
                            }
                          }}
                        >
                          {fieldConfigSaving ? "Saving..." : "Apply Config"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TAB: Attachment Configurator */}
            {activeItem.type === "attachment" && editingAttachmentConfig && (() => {
              return (
                <div style={{ display: "grid", gap: "1rem" }}>

                  
                  <div className="form-group">
                    <label style={{ fontSize: "0.82rem", fontWeight: 650 }}>Attachment Title</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editingAttachmentConfig.title}
                      onChange={(e) => setEditingAttachmentConfig({ ...editingAttachmentConfig, title: e.target.value })}
                      style={{ width: "100%", padding: "0.4rem" }}
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ fontSize: "0.82rem", fontWeight: 650 }}>Select Source KPI</label>
                    <select
                      value={editingAttachmentConfig.kpi_id || ""}
                      onChange={(e) => {
                        const kid = Number(e.target.value);
                        setEditingAttachmentConfig({
                          ...editingAttachmentConfig,
                          kpi_id: kid,
                          kpi_field_id: 0,
                          selected_columns: []
                        });
                      }}
                      style={{ width: "100%", padding: "0.4rem" }}
                    >
                      <option value="">Select KPI...</option>
                      {allKpis.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </select>
                  </div>

                  {editingAttachmentConfig.kpi_id > 0 && (() => {
                    const selKpi = allKpis.find(k => k.id === editingAttachmentConfig.kpi_id);
                    const mlis = (selKpi?.fields || []).filter(fd => fd.field_type === "multi_line_items");
                    return (
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 650 }}>Select Table Field (MLI)</label>
                        <select
                          value={editingAttachmentConfig.kpi_field_id || ""}
                          onChange={(e) => {
                            const fid = Number(e.target.value);
                            const sfld = mlis.find(m => m.id === fid);
                            setEditingAttachmentConfig({
                              ...editingAttachmentConfig,
                              kpi_field_id: fid,
                              selected_columns: (sfld?.sub_fields || []).map(s => s.key)
                            });
                          }}
                          style={{ width: "100%", padding: "0.4rem" }}
                        >
                          <option value="">Select Field...</option>
                          {mlis.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </div>
                    );
                  })()}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveItem({ type: "outline" })}>Cancel</button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        if (!editingAttachmentConfig.kpi_id || !editingAttachmentConfig.kpi_field_id) {
                          toast.error("Please map KPI and field.");
                          return;
                        }
                        setAttachments(prev => {
                          const next = [...prev];
                          next[activeItem.index!] = {
                            ...next[activeItem.index!],
                            ...editingAttachmentConfig
                          };
                          return next;
                        });
                        toast.success("Attachment config applied locally!");
                        setActiveItem({ type: "outline" });
                      }}
                    >
                      Apply Attachment
                    </button>
                  </div>
                </div>
              );
            })()}

          </div>

        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmIdx !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", padding: "1.5rem" }} onClick={() => setDeleteConfirmIdx(null)}>
          <div className="card" style={{ maxWidth: 480, width: "100%", boxShadow: "var(--shadow-md)", background: "var(--surface)", padding: "1.5rem" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem", fontWeight: 700 }}>Delete Heading Section</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
              This section contains <strong>{sections[deleteConfirmIdx]?.fields.length}</strong> fields. Please choose what to do with them:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => confirmMergeFields(deleteConfirmIdx!)}
                disabled={sections.length <= 1}
                style={{ textAlign: "left", padding: "0.5rem", display: "flex", flexDirection: "column", border: "1px solid var(--border)" }}
              >
                <span style={{ fontWeight: 650, color: "var(--primary)" }}>Option A: Merge Fields (Recommended)</span>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Move all fields in this section into the adjacent heading section.</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => confirmDeleteEverything(deleteConfirmIdx!)}
                style={{ textAlign: "left", padding: "0.5rem", display: "flex", flexDirection: "column", border: "1px solid var(--border)" }}
              >
                <span style={{ fontWeight: 650, color: "var(--error)" }}>Option B: Delete Everything</span>
                <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Permanently delete this heading and all its fields from the report.</span>
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setDeleteConfirmIdx(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Existing Width Config Modal Overlay Trigger */}
      {editingWidthsLoc && (() => {
        const sec = sections[editingWidthsLoc.secIdx];
        const f = sec?.fields[editingWidthsLoc.fieldIdx];
        if (!f) return null;

        const kpi = allKpis.find(k => Number(k.id) === Number(f.kpi_id));
        const kpiField = kpi?.fields.find(fld => Number(fld.id) === Number(f.kpi_field_id));
        const subFields = kpiField?.sub_fields || [];
        const selectedColKeys: string[] = f.config?.selected_columns || subFields.map(sf => sf.key).slice(0, 6);

        const customLabels = f.config?.custom_sub_field_labels || {};
        const cols = selectedColKeys.map(k => {
          const sf = subFields.find(s => s.key === k);
          const updatedLabel = customLabels[k] || sf?.name || k;
          return { key: k, name: updatedLabel };
        });

        return (
          <ColumnWidthConfigModal
            isOpen={true}
            onClose={() => setEditingWidthsLoc(null)}
            fieldName={f.field_name}
            columns={cols}
            initialWidths={f.config?.column_widths || null}
            h1Color="#1e3a8a"
            onSave={(newWidths) => {
              setSections(prev => {
                const next = [...prev];
                const curField = next[editingWidthsLoc.secIdx].fields[editingWidthsLoc.fieldIdx];
                const updatedConfig: Record<string, any> = { ...((curField.config) || {}) };
                if (newWidths && Object.keys(newWidths).length > 0) {
                  updatedConfig.column_widths = newWidths;
                } else {
                  delete updatedConfig.column_widths;
                }
                next[editingWidthsLoc.secIdx].fields[editingWidthsLoc.fieldIdx] = {
                  ...curField,
                  config: Object.keys(updatedConfig).length > 0 ? updatedConfig : null
                };
                return next;
              });
              setEditingWidthsLoc(null);
              toast.success("Column widths updated locally! (Save Layout to persist changes)");
            }}
          />
        );
      })()}

      {/* Existing Table Footer Config Modal Overlay Trigger */}
      {editingFooterLoc && (() => {
        const sec = sections[editingFooterLoc.secIdx];
        const f = sec?.fields[editingFooterLoc.fieldIdx];
        if (!f) return null;

        const kpi = allKpis.find(k => Number(k.id) === Number(f.kpi_id));
        const kpiField = kpi?.fields.find(fld => Number(fld.id) === Number(f.kpi_field_id));
        const subFields = kpiField?.sub_fields || [];
        const selectedColKeys: string[] = f.config?.selected_columns || subFields.map(sf => sf.key).slice(0, 6);

        const customLabels = f.config?.custom_sub_field_labels || {};
        const cols = selectedColKeys.map(k => {
          const sf = subFields.find(s => s.key === k);
          const updatedLabel = customLabels[k] || sf?.name || k;
          return { key: k, name: updatedLabel };
        });

        return (
          <TableFooterConfigModal
            isOpen={true}
            onClose={() => setEditingFooterLoc(null)}
            fieldName={f.field_name}
            allSubFields={cols}
            existingFooterConfig={f.config?.footer_config || null}
            onSave={(newFooterCfg) => {
              setSections((prev) => {
                const next = [...prev];
                const curF = next[editingFooterLoc.secIdx].fields[editingFooterLoc.fieldIdx];
                next[editingFooterLoc.secIdx].fields[editingFooterLoc.fieldIdx] = {
                  ...curF,
                  config: { ...(curF.config || {}), footer_config: newFooterCfg }
                };
                return next;
              });
              toast.success("Saved table footer configuration locally! (Save Layout to persist changes)");
              setEditingFooterLoc(null);
            }}
          />
        );
      })()}

      {buildingFormulaKpiFieldIndex !== null && (() => {
        const f = newKpiFields[buildingFormulaKpiFieldIndex];
        if (!f) return null;

        const tempFields: KPIField[] = newKpiFields.map((fld, fIdx) => ({
          id: fIdx,
          kpi_id: -1,
          key: fld.key,
          name: fld.name,
          field_type: fld.field_type,
          sub_fields: (fld.sub_fields || []).map((sf: any) => ({
            id: sf.id,
            key: sf.key,
            name: sf.name,
            field_type: sf.field_type,
            is_required: sf.is_required,
            config: sf.config || null,
          }))
        }));

        return (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0, 0, 0, 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}>
            <div style={{ background: "white", padding: "1.5rem", borderRadius: "10px", width: "800px", maxWidth: "95%", maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow-lg)", display: "grid", gap: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Formula Builder</h3>
              </div>
              
              <div style={{ padding: "0.25rem 0" }}>
                <label style={{ fontWeight: 650, fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>Current Expression</label>
                <textarea
                  className="form-control"
                  value={f.formula_expression || ""}
                  onChange={(e) => {
                    const next = [...newKpiFields];
                    next[buildingFormulaKpiFieldIndex].formula_expression = e.target.value;
                    setNewKpiFields(next);
                  }}
                  style={{ width: "100%", height: "80px", padding: "0.45rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "monospace", marginBottom: "1rem" }}
                />
                
                <FormulaBuilder
                  formulaValue={f.formula_expression || ""}
                  onInsert={(text) => {
                    const next = [...newKpiFields];
                    const currentExpr = next[buildingFormulaKpiFieldIndex].formula_expression || "";
                    next[buildingFormulaKpiFieldIndex].formula_expression = currentExpr + text;
                    setNewKpiFields(next);
                  }}
                  fields={tempFields}
                  organizationId={orgId}
                  currentKpiId={undefined}
                />
              </div>
              
              <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const next = [...newKpiFields];
                    next[buildingFormulaKpiFieldIndex].formula_expression = originalFormulaExpr;
                    setNewKpiFields(next);
                    setBuildingFormulaKpiFieldIndex(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setBuildingFormulaKpiFieldIndex(null)}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {kpiCreatorFormulaModal && (
        <MliFormulaBuilderModal
          isOpen={!!kpiCreatorFormulaModal}
          onClose={() => setKpiCreatorFormulaModal(null)}
          targetSubField={kpiCreatorFormulaModal.subField}
          allSubFields={kpiCreatorFormulaModal.allSubFields}
          parentFieldKey={newKpiFields[kpiCreatorFormulaModal.fieldIndex]?.key}
          orgId={orgId}
          onSave={(updatedConfig) => {
            setNewKpiFields((prev) => {
              const next = [...prev];
              next[kpiCreatorFormulaModal.fieldIndex].sub_fields[kpiCreatorFormulaModal.subIndex].config = updatedConfig.config || updatedConfig;
              return next;
            });
            setKpiCreatorFormulaModal(null);
            toast.success("Formula saved locally! Submit KPI definition to persist.");
          }}
        />
      )}

      {kpiCreatorLinkModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0, 0, 0, 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", padding: "1.5rem", borderRadius: "10px", width: "650px", maxWidth: "95%", boxShadow: "var(--shadow-lg)", display: "grid", gap: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
              Configure Linked Column: {kpiCreatorLinkModal.subField.name}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="form-group">
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Data Source Mode</label>
                <select
                  value={kpiCreatorLinkModal.subField.config?.data_source || "manual"}
                  onChange={(e) => {
                    const mode = e.target.value;
                    setKpiCreatorLinkModal((prev: any) => {
                      if (!prev) return null;
                      const nextConfig = { ...prev.subField.config };
                      if (mode === "linked") {
                        nextConfig.data_source = "linked";
                        nextConfig.link_source = nextConfig.link_source || {
                          source_kpi_id: undefined,
                          source_field_id: undefined,
                          source_column_key: undefined,
                          matching_rules: [{ current_column: "", source_column: "" }]
                        };
                      } else {
                        delete nextConfig.data_source;
                        delete nextConfig.link_source;
                      }
                      return {
                        ...prev,
                        subField: {
                          ...prev.subField,
                          config: nextConfig
                        }
                      };
                    });
                  }}
                  style={{ width: "100%", padding: "6px 8px", background: "white", border: "1px solid var(--border)", borderRadius: 6 }}
                >
                  <option value="manual">Manual Data Entry</option>
                  <option value="linked">Linked Column from Another MLI</option>
                </select>
              </div>

              {kpiCreatorLinkModal.subField.config?.data_source === "linked" && (
                <LinkedConfigUI
                  organizationId={orgId}
                  currentKpiId={editingKpiId ?? undefined}
                  currentMliSubFields={kpiCreatorLinkModal.allSubFields}
                  value={kpiCreatorLinkModal.subField.config}
                  onChange={(c) => {
                    setKpiCreatorLinkModal((prev: any) => {
                      if (!prev) return null;
                      return {
                        ...prev,
                        subField: {
                          ...prev.subField,
                          config: c
                        }
                      };
                    });
                  }}
                />
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setKpiCreatorLinkModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setNewKpiFields((prev) => {
                    const next = [...prev];
                    next[kpiCreatorLinkModal.fieldIndex].sub_fields[kpiCreatorLinkModal.subIndex].config = kpiCreatorLinkModal.subField.config;
                    return next;
                  });
                  setKpiCreatorLinkModal(null);
                  toast.success("Link configurations saved locally! Submit KPI definition to persist.");
                }}
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {showDateConfigModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0, 0, 0, 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", padding: "1.5rem", borderRadius: "10px", width: "480px", maxWidth: "90%", boxShadow: "var(--shadow-lg)", display: "grid", gap: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>Configure Date-Based Filtering</h3>
            
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 650, color: "var(--text-secondary)" }}>Period Range Type</label>
              <select
                value={localDefaultPeriodType}
                onChange={(e) => {
                  setLocalDefaultPeriodType(e.target.value);
                  setLocalDefaultPeriod("");
                }}
                style={{ width: "100%", padding: "0.45rem", fontSize: "0.82rem", borderRadius: 6, border: "1px solid var(--border)", marginTop: "0.25rem", background: "white" }}
              >
                <option value="">Choose period format...</option>
                <option value="by_default">Data entry</option>
                {periodOptionsList.map((pOpt: string) => (
                  <option key={pOpt} value={pOpt}>{pOpt}</option>
                ))}
              </select>
            </div>

            {localDefaultPeriodType && (
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 650, color: "var(--text-secondary)" }}>Reporting period</label>
                <select
                  value={localDefaultPeriod}
                  onChange={(e) => setLocalDefaultPeriod(e.target.value)}
                  style={{ width: "100%", padding: "0.45rem", fontSize: "0.82rem", borderRadius: 6, border: "1px solid var(--border)", marginTop: "0.25rem", background: "white" }}
                >
                  <option value="">Choose reporting period...</option>
                  {defaultPeriodOptions.map((opt: any) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "0.82rem", fontWeight: 650, margin: 0 }}>Date-Based Filtering KPIs</label>
                <select
                  value=""
                  onChange={(e) => {
                    const kid = Number(e.target.value);
                    if (kid && !localConfiguredKpiIds.includes(kid)) {
                      setLocalConfiguredKpiIds(prev => [...prev, kid]);
                    }
                    e.target.value = "";
                  }}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", borderRadius: "4px", border: "1px solid var(--border)", background: "white", width: "180px" }}
                >
                  <option value="">+ Add KPI...</option>
                  {allKpis
                    .filter(k => !localConfiguredKpiIds.includes(k.id))
                    .map(k => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ maxHeight: "200px", overflowY: "auto", display: "grid", gap: "0.5rem" }}>
                {localConfiguredKpiIds.length === 0 ? (
                  <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: 0, fontStyle: "italic" }}>
                    No KPIs selected. Select a KPI above to configure its date mapping.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {localConfiguredKpiIds.map((kpiId) => {
                      const kpiObj = allKpis.find(k => k.id === kpiId);
                      if (!kpiObj) return null;
                      const kpiName = kpiObj.name;
                      const mliFields = kpiObj.fields.filter(f => f.field_type === "multi_line_items");
                      const selectedMliKey = localKpiMlis[String(kpiId)] || (mliFields[0]?.key || "");
                      const selectedMliField = mliFields.find(f => f.key === selectedMliKey);
                      const dateSubFields = (selectedMliField?.sub_fields || []).filter(
                        (sf) => sf.field_type === "date" || sf.field_type === "datetime"
                      );
                      const mliDateKey = `${kpiId}_${selectedMliKey}`;

                      return (
                        <div key={kpiId} style={{ padding: "0.6rem", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--bg-subtle)", display: "grid", gap: "0.4rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontSize: "0.78rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "300px" }} title={kpiName}>
                              {kpiName}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setLocalConfiguredKpiIds(prev => prev.filter(id => id !== kpiId));
                              }}
                              style={{ border: "none", background: "transparent", color: "#ef4444", fontSize: "0.75rem", cursor: "pointer", fontWeight: 700 }}
                            >
                              Remove
                            </button>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                            <div>
                              <label style={{ fontSize: "0.68rem", color: "var(--muted)", display: "block", marginBottom: "0.2rem" }}>Select MLI Field:</label>
                              <select
                                value={selectedMliKey}
                                onChange={(e) => {
                                  const mliKey = e.target.value;
                                  setLocalKpiMlis(prev => ({ ...prev, [String(kpiId)]: mliKey }));
                                }}
                                style={{ padding: "0.25rem", fontSize: "0.75rem", borderRadius: "4px", border: "1px solid var(--border)", background: "white", width: "100%" }}
                              >
                                {mliFields.length === 0 ? (
                                  <option value="">No MLI fields</option>
                                ) : (
                                  mliFields.map((f) => (
                                    <option key={f.key} value={f.key}>
                                      {f.name || f.key}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>

                            <div>
                              <label style={{ fontSize: "0.68rem", color: "var(--muted)", display: "block", marginBottom: "0.2rem" }}>Date Column:</label>
                              <select
                                value={localMliDateCols[mliDateKey] || ""}
                                onChange={(e) => {
                                  const dateSubKey = e.target.value;
                                  setLocalMliDateCols(prev => ({ ...prev, [mliDateKey]: dateSubKey }));
                                }}
                                style={{ padding: "0.25rem", fontSize: "0.75rem", borderRadius: "4px", border: "1px solid var(--border)", background: "white", width: "100%" }}
                              >
                                <option value="">Select Date...</option>
                                {dateSubFields.map((sf) => (
                                  <option key={sf.key} value={sf.key}>
                                    {sf.name || sf.key}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const defPeriodType = dateFetchingConfig?.default_period_type || dateFetchingConfig?.period_type || "";
                  setLocalPeriodType(defPeriodType);
                  setLocalDefaultPeriodType(defPeriodType);
                  setLocalDefaultPeriod(dateFetchingConfig?.default_period || "");
                  setLocalMliDateCols(dateFetchingConfig?.mli_date_cols || {});
                  setLocalConfiguredKpiIds(dateFetchingConfig?.configured_kpi_ids || []);
                  setLocalKpiMlis(dateFetchingConfig?.kpi_mlis || {});
                  setShowDateConfigModal(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const nextConfig = {
                    ...dateFetchingConfig,
                    configured_kpi_ids: localConfiguredKpiIds,
                    kpi_mlis: localKpiMlis,
                    mli_date_cols: localMliDateCols,
                    period_type: localDefaultPeriodType,
                    default_period_type: localDefaultPeriodType,
                    default_period: localDefaultPeriod
                  };
                  setLocalPeriodType(localDefaultPeriodType);
                  setLocalDefaultPeriodType(localDefaultPeriodType);
                  setLocalDefaultPeriod(localDefaultPeriod);
                  autoSaveSettings({
                    date_fetching_config: nextConfig
                  });
                  setShowDateConfigModal(false);
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showLmsConfigModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0, 0, 0, 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", padding: "1.5rem", borderRadius: "10px", width: "450px", maxWidth: "90%", boxShadow: "var(--shadow-lg)", display: "grid", gap: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>Configure LMS Sync KPIs</h3>
            
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ fontSize: "0.82rem", fontWeight: 650, margin: 0 }}>Sync Odoo/LMS KPIs</label>
                <select
                  value=""
                  onChange={(e) => {
                    const kid = Number(e.target.value);
                    if (kid && !localOdooSyncKpiIds.includes(kid)) {
                      setLocalOdooSyncKpiIds(prev => [...prev, kid]);
                    }
                    e.target.value = "";
                  }}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", borderRadius: "4px", border: "1px solid var(--border)", background: "white", width: "160px" }}
                >
                  <option value="">+ Add KPI...</option>
                  {odooConfiguredKpis
                    .filter(k => !localOdooSyncKpiIds.includes(k.id))
                    .map(k => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.5rem", background: "var(--bg-subtle)" }}>
                {localOdooSyncKpiIds.length === 0 ? (
                  <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: 0, fontStyle: "italic" }}>
                    No KPIs selected for LMS sync. Select a KPI above to enable LMS sync for it.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    {localOdooSyncKpiIds.map((kpiId) => {
                      const kpiObj = allKpis.find(k => k.id === kpiId);
                      if (!kpiObj) return null;
                      return (
                        <div
                          key={kpiId}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            background: "white",
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            padding: "0.2rem 0.5rem",
                            fontSize: "0.75rem",
                            gap: "0.35rem"
                          }}
                        >
                          <span>{kpiObj.name}</span>
                          <button
                            type="button"
                            onClick={() => setLocalOdooSyncKpiIds(prev => prev.filter(id => id !== kpiId))}
                            style={{ border: "none", background: "none", color: "var(--error)", cursor: "pointer", fontWeight: 700 }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setLocalOdooSyncKpiIds(odooSyncKpiIds);
                  setShowLmsConfigModal(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  autoSaveSettings({
                    odoo_sync_kpi_ids: localOdooSyncKpiIds
                  });
                  setShowLmsConfigModal(false);
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showFormulaBuilderModal && activeItem.type === "field" && (() => {
        const sec = sections[activeItem.secIdx!];
        const f = sec?.fields[activeItem.fieldIdx!];
        if (!f) return null;

        const kpi = allKpis.find(k => k.id === f.kpi_id);
        const allKpiFields = kpi ? kpi.fields : [];
        const editingFieldKpiId = f.kpi_id;

        return (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0, 0, 0, 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
            <div style={{ background: "white", padding: "1.5rem", borderRadius: "10px", width: "800px", maxWidth: "95%", maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow-lg)", display: "grid", gap: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Formula Builder</h3>
              </div>
              
              <div style={{ padding: "0.25rem 0" }}>
                <label style={{ fontWeight: 650, fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>Current Expression</label>
                <textarea
                  className="form-control"
                  value={editingFieldConfig?.formula_expression || ""}
                  onChange={(e) => setEditingFieldConfig(prev => prev ? { ...prev, formula_expression: e.target.value } : { selected_columns: [], filters: { conditions: [], _version: 2 }, formula_expression: e.target.value })}
                  style={{ width: "100%", height: "80px", padding: "0.45rem", fontSize: "0.82rem", borderRadius: 5, border: "1px solid var(--border)", fontFamily: "monospace", marginBottom: "1rem" }}
                />
                
                <FormulaBuilder
                  formulaValue={editingFieldConfig?.formula_expression || ""}
                  onInsert={(text) => {
                    setEditingFieldConfig(prev => {
                      const currentExpr = prev?.formula_expression || "";
                      return prev
                        ? { ...prev, formula_expression: currentExpr + text }
                        : { selected_columns: [], filters: { conditions: [], _version: 2 }, formula_expression: text };
                    });
                  }}
                  fields={allKpiFields}
                  organizationId={orgId}
                  currentKpiId={editingFieldKpiId}
                />
              </div>
              
              <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setEditingFieldConfig(prev => {
                      if (!prev) return prev;
                      return { ...prev, formula_expression: originalFormulaExpr };
                    });
                    setShowFormulaBuilderModal(false);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowFormulaBuilderModal(false)}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
