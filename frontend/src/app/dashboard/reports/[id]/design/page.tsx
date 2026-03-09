"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

const AUTO_SAVE_DELAY_MS = 45_000; // 45 seconds after last change
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
import {
  buildReportPrintDocument,
  openReportPrintWindow,
  type ReportData,
} from "@/app/dashboard/reports/reportPrint";
import { ReportLoadProgress } from "@/app/dashboard/reports/ReportLoadProgress";
import {
  buildFormulaPlaceholder,
  buildKpiValuePlaceholder,
  buildMultiLineTablePlaceholder,
  buildSubFieldGroupPlaceholder,
  type KpiInsertValue,
  ReportKpiInsertControls,
} from "./report-insert-shared";

interface AttachedDomain {
  id: number;
  name: string;
}

interface KpiFromDomain {
  kpi_id: number;
  kpi_name: string;
  fields_count: number;
  time_dimension?: string | null;
}

interface SubFieldOption {
  id: number;
  key: string;
  name: string;
}

interface FieldOption {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields: SubFieldOption[];
}

interface TemplateDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  body_template: string | null;
  body_blocks: ReportBlock[] | null;
  attached_domains: AttachedDomain[];
  kpis_from_domains: KpiFromDomain[];
}

export type ReportBlock =
  | { type: "title"; id?: string; useTemplateName?: boolean; customText?: string }
  | { type: "section_heading"; id?: string; text?: string; level?: number }
  | { type: "spacer"; id?: string; size?: "small" | "medium" | "large" }
  | { type: "text"; id?: string; content?: string }
  | { type: "domain_list"; id?: string; domainIds?: number[] }
  | { type: "domain_categories"; id?: string; domainIds?: number[] }
  | { type: "domain_kpis"; id?: string; domainIds?: number[] }
  | { type: "kpi_table"; id?: string; kpiIds?: number[]; fieldKeys?: string[]; oneTablePerKpi?: boolean; fieldsLayout?: "columns" | "rows"; multiLineSubFieldKeys?: Record<string, string[]>; fieldDisplayNames?: Record<string, string>; subFieldDisplayNames?: Record<string, Record<string, string>>; showTableHeading?: boolean; showMultiLineAsTable?: boolean; showMultiLineFieldLabel?: boolean; columnAlign?: Record<string, CellAlign>; timeDimensionMode?: "latest" | "single_period" | "all_periods"; periodKey?: string }
  | { type: "kpi_multi_table"; id?: string; kpiId?: number; fieldKey?: string }
  | { type: "simple_table"; id?: string; rows?: SimpleTableRow[] }
  | { type: "kpi_grid"; id?: string; kpiIds?: number[]; fieldKeys?: string[]; multiLineSubFieldKeys?: Record<string, string[]>; fieldDisplayNames?: Record<string, string>; subFieldDisplayNames?: Record<string, Record<string, string>>; timeDimensionMode?: "latest" | "single_period" | "all_periods"; periodKey?: string }
  | { type: "kpi_list"; id?: string; kpiIds?: number[]; fieldKeys?: string[]; multiLineSubFieldKeys?: Record<string, string[]>; fieldDisplayNames?: Record<string, string>; subFieldDisplayNames?: Record<string, Record<string, string>>; timeDimensionMode?: "latest" | "single_period" | "all_periods"; periodKey?: string }
  | { type: "single_value"; id?: string; kpiId?: number; fieldKey?: string; subFieldKey?: string; entryIndex?: number };

export type CellAlign = "left" | "center" | "right" | "justify";
export type SimpleTableCell =
  | { type: "text"; content?: string; align?: CellAlign }
  | { type: "kpi"; kpiId?: number; fieldKey?: string; subFieldKey?: string; subFieldGroupFn?: string; entryIndex?: number; asGroup?: boolean; align?: CellAlign }
  | { type: "formula"; kpiId?: number; fieldKey?: string; entryIndex?: number; formula?: string; align?: CellAlign };
export type SimpleTableRow = { cells: SimpleTableCell[] };
const DEFAULT_SIMPLE_TABLE_ROW: SimpleTableRow = { cells: [{ type: "text", content: "" }] };

/** Period options for report block "single period" time dimension */
const REPORT_PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Full year" },
  { value: "H1", label: "Half 1 (H1)" },
  { value: "H2", label: "Half 2 (H2)" },
  { value: "Q1", label: "Q1" },
  { value: "Q2", label: "Q2" },
  { value: "Q3", label: "Q3" },
  { value: "Q4", label: "Q4" },
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];

/** Expected period keys for a time dimension (for report block single-period dropdown). */
function expectedPeriodsForDimension(dimension: string | null | undefined): string[] {
  if (!dimension || dimension === "yearly" || dimension === "multi_year") return [""];
  if (dimension === "half_yearly") return ["", "H1", "H2"];
  if (dimension === "quarterly") return ["", "Q1", "Q2", "Q3", "Q4"];
  if (dimension === "monthly") return ["", ...Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))];
  return [""];
}

/** Build Jinja prefix for block time dimension (mirrors backend _block_time_dimension_vars). */
function blockTimeDimensionPrefix(b: { timeDimensionMode?: string; periodKey?: string }): string {
  const mode = (b.timeDimensionMode || "latest").trim().toLowerCase();
  const periodKey = (b.periodKey ?? "").trim();
  if (mode === "all_periods" || mode === "all") {
    return "{% set _td_period = none %}{% set _td_all = true %}";
  }
  if (mode === "single_period" && periodKey) {
    const pkEsc = periodKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `{% set _td_period = '${pkEsc}' %}{% set _td_all = false %}`;
  }
  return "{% set _td_period = none %}{% set _td_all = false %}";
}

/** Inject time dimension filter into content: prepend prefix and replace kpi.entries with _td_entries (mirrors backend _inject_time_dimension_filter). */
function injectTimeDimensionFilter(content: string, tdPrefix: string): string {
  if (!content.trim()) return content;
  // Use placeholder so the global replace doesn't overwrite the source in the inject line
  const inject = "{% set _td_entries = __KPI_ENTRIES__ | filter_entries_by_period(_td_period, _td_all) %}";
  let out = tdPrefix + content;
  out = out.replace("{% for kpi in kpis %}", "{% for kpi in kpis %}" + inject, 1);
  out = out.replace(/kpi\.entries/g, "_td_entries");
  out = out.replace(/__KPI_ENTRIES__/g, "kpi.entries");
  // Safe access when _td_entries is empty (e.g. latest with no data, or single_period with no match)
  out = out.replace(/_td_entries\[0\]\.fields/g, "((_td_entries|first)|default({})).fields|default([])");
  out = out.replace(/_td_entries\[0\]/g, "(_td_entries|first)");
  return out;
}

const BLOCK_LABELS: Record<string, string> = {
  title: "Report title",
  section_heading: "Section heading",
  spacer: "Spacer",
  text: "Text with KPI data",
  domain_list: "Domain list",
  domain_categories: "Domain categories",
  domain_kpis: "Domain KPIs",
  kpi_table: "KPI table",
  kpi_multi_table: "Multi-line items table",
  simple_table: "Simple table",
  kpi_grid: "KPI grid",
  kpi_list: "KPI list",
  single_value: "Single value",
};

const GROUP_FUNCTIONS = [
  { value: "SUM_ITEMS", label: "SUM (total)" },
  { value: "AVG_ITEMS", label: "AVG (average)" },
  { value: "COUNT_ITEMS", label: "COUNT" },
  { value: "MIN_ITEMS", label: "MIN" },
  { value: "MAX_ITEMS", label: "MAX" },
] as const;

const CONDITIONAL_GROUP_FUNCTIONS = [
  { value: "SUM_ITEMS_WHERE", label: "SUM where" },
  { value: "AVG_ITEMS_WHERE", label: "AVG where" },
  { value: "COUNT_ITEMS_WHERE", label: "COUNT where" },
  { value: "MIN_ITEMS_WHERE", label: "MIN where" },
  { value: "MAX_ITEMS_WHERE", label: "MAX where" },
] as const;

const WHERE_OPERATORS = [
  { value: "op_eq", label: "equals (=)" },
  { value: "op_neq", label: "not equals (≠)" },
  { value: "op_gt", label: "greater than (>)" },
  { value: "op_gte", label: "greater or equal (≥)" },
  { value: "op_lt", label: "less than (<)" },
  { value: "op_lte", label: "less or equal (≤)" },
] as const;

interface FormulaRefKpi {
  id: number;
  name: string;
  year: number;
  fields: Array<{ key: string; name: string; field_type: string }>;
}

function ReportFormulaBuilder({
  formulaValue,
  onInsert,
  fields,
  organizationId,
  currentKpiId,
}: {
  formulaValue: string;
  onInsert: (text: string) => void;
  fields: FieldOption[];
  organizationId?: number;
  currentKpiId?: number;
}) {
  const [refFieldId, setRefFieldId] = useState<number | "">("");
  const [refSubKey, setRefSubKey] = useState("");
  const [refGroupFn, setRefGroupFn] = useState<string>("SUM_ITEMS");
  const [useConditional, setUseConditional] = useState(false);
  const [refFilterSubKey, setRefFilterSubKey] = useState("");
  const [refWhereOp, setRefWhereOp] = useState<string>("op_eq");
  const [refWhereValue, setRefWhereValue] = useState<string>("0");
  const [otherKpis, setOtherKpis] = useState<FormulaRefKpi[]>([]);
  const [refOtherKpiId, setRefOtherKpiId] = useState<number | "">("");
  const [refOtherFieldKey, setRefOtherFieldKey] = useState("");
  const token = getAccessToken();
  useEffect(() => {
    if (!token || organizationId == null || currentKpiId == null) return;
    const params = new URLSearchParams({ organization_id: String(organizationId), exclude_kpi_id: String(currentKpiId) });
    api<FormulaRefKpi[]>(`/kpis/formula-refs?${params}`, { token })
      .then(setOtherKpis)
      .catch(() => setOtherKpis([]));
  }, [token, organizationId, currentKpiId]);
  const refField = refFieldId === "" ? null : fields.find((f) => f.id === refFieldId);
  const subFields = refField?.field_type === "multi_line_items" ? (refField.sub_fields ?? []) : [];
  const canInsertNumber = refField?.field_type === "number";
  const isCountItemsOnly = refGroupFn === "COUNT_ITEMS";
  const isConditionalWhere = useConditional && refField?.field_type === "multi_line_items" && !!refFilterSubKey;
  const isCountWhere = refGroupFn === "COUNT_ITEMS" || refGroupFn === "COUNT_ITEMS_WHERE";
  const canInsertItems = refField?.field_type === "multi_line_items" && (
    isConditionalWhere
      ? (isCountWhere ? !!refFilterSubKey : (subFields.length > 0 && !!refSubKey && !!refFilterSubKey))
      : (isCountItemsOnly || (subFields.length > 0 && !!refSubKey))
  );
  const selectedOtherKpi = refOtherKpiId === "" ? null : otherKpis.find((k) => k.id === refOtherKpiId);
  const otherKpiFields = selectedOtherKpi?.fields ?? [];
  const canInsertOtherKpiField = refOtherKpiId !== "" && refOtherFieldKey !== "";

  const handleInsertItems = () => {
    if (!refField) return;
    if (isConditionalWhere) {
      const op = refWhereOp;
      const val = refWhereValue.trim() === "" ? "0" : refWhereValue;
      const whereFn = refGroupFn.endsWith("_WHERE") ? refGroupFn : refGroupFn + "_WHERE";
      if (whereFn === "COUNT_ITEMS_WHERE") {
        onInsert(`COUNT_ITEMS_WHERE(${refField.key}, ${refFilterSubKey}, ${op}, ${val})`);
      } else {
        onInsert(`${whereFn}(${refField.key}, ${refSubKey}, ${refFilterSubKey}, ${op}, ${val})`);
      }
      return;
    }
    onInsert(isCountItemsOnly && !refSubKey ? `COUNT_ITEMS(${refField.key})` : `${refGroupFn}(${refField.key}, ${refSubKey})`);
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "0.75rem", background: "var(--bg-subtle, #f8f9fa)", marginTop: "0.5rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Insert reference</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
          <select value={refFieldId} onChange={(e) => { setRefFieldId(e.target.value ? Number(e.target.value) : ""); setRefSubKey(""); setRefFilterSubKey(""); }} style={{ minWidth: "160px" }}>
            <option value="">— Select field —</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>{f.name} ({f.key}) — {f.field_type.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        {refField?.field_type === "multi_line_items" && subFields.length > 0 && (
          <>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Sub-field</label>
              <select value={refSubKey} onChange={(e) => setRefSubKey(e.target.value)} style={{ minWidth: "140px" }}>
                <option value="">{(refGroupFn === "COUNT_ITEMS" || refGroupFn === "COUNT_ITEMS_WHERE") && !useConditional ? "Row count (no sub-field)" : refGroupFn === "COUNT_ITEMS_WHERE" ? "— N/A for COUNT where —" : "— Select —"}</option>
                {subFields.map((s) => (
                  <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Group function</label>
              <select value={refGroupFn} onChange={(e) => setRefGroupFn(e.target.value)} style={{ minWidth: "120px" }}>
                {GROUP_FUNCTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
                {CONDITIONAL_GROUP_FUNCTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", marginBottom: "0.25rem" }}>
              <input type="checkbox" checked={useConditional} onChange={(e) => setUseConditional(e.target.checked)} />
              Conditional (where)
            </label>
            {useConditional && (
              <>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Filter sub-field</label>
                  <select value={refFilterSubKey} onChange={(e) => setRefFilterSubKey(e.target.value)} style={{ minWidth: "120px" }}>
                    <option value="">— Select —</option>
                    {subFields.map((s) => (
                      <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Operator</label>
                  <select value={refWhereOp} onChange={(e) => setRefWhereOp(e.target.value)} style={{ minWidth: "100px" }}>
                    {WHERE_OPERATORS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Value (number)</label>
                  <input type="number" step="any" value={refWhereValue} onChange={(e) => setRefWhereValue(e.target.value)} style={{ width: "80px" }} placeholder="0" />
                </div>
              </>
            )}
          </>
        )}
        {canInsertNumber && <button type="button" className="btn btn-primary" onClick={() => refField && onInsert(refField.key)}>Insert field</button>}
        {canInsertItems && refField && (
          <button type="button" className="btn btn-primary" onClick={handleInsertItems}>Insert</button>
        )}
        {organizationId != null && currentKpiId != null && otherKpis.length > 0 && (
          <>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Other KPI</label>
              <select value={refOtherKpiId} onChange={(e) => { setRefOtherKpiId(e.target.value ? Number(e.target.value) : ""); setRefOtherFieldKey(""); }} style={{ minWidth: "180px" }}>
                <option value="">— Select KPI —</option>
                {otherKpis.map((k) => (
                  <option key={k.id} value={k.id}>{k.name} (year {k.year})</option>
                ))}
              </select>
            </div>
            {selectedOtherKpi && (
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
                <select value={refOtherFieldKey} onChange={(e) => setRefOtherFieldKey(e.target.value)} style={{ minWidth: "140px" }}>
                  <option value="">— Select —</option>
                  {otherKpiFields.map((f) => (
                    <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                  ))}
                </select>
              </div>
            )}
            {canInsertOtherKpiField && (
              <button type="button" className="btn btn-primary" onClick={() => onInsert(`KPI_FIELD(${refOtherKpiId}, "${refOtherFieldKey}")`)}>Insert other KPI field</button>
            )}
          </>
        )}
      </div>
      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Operators:</span>
        {[" + ", " - ", " * ", " / ", " ( ", " ) "].map((op) => (
          <button key={op} type="button" className="btn" onClick={() => onInsert(op)} style={{ padding: "0.25rem 0.5rem", fontSize: "0.9rem" }}>{op.trim() || op}</button>
        ))}
      </div>
    </div>
  );
}

function qs(params: Record<string, string | number | undefined>): string {
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    ) as Record<string, string>
  ).toString();
}

function generateId(): string {
  return `b-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addBlockId(b: ReportBlock): ReportBlock {
  return { ...b, id: (b as { id?: string }).id || generateId() } as ReportBlock;
}

function buildFieldSubFieldKeysJinja(multiLineSubFieldKeys: Record<string, string[]> | undefined): string {
  const m = multiLineSubFieldKeys || {};
  const pairs = Object.entries(m).map(([fk, keys]) => `'${fk.replace(/'/g, "\\'")}': [${(keys || []).map((k) => `'${String(k).replace(/'/g, "\\'")}'`).join(", ")}]`);
  return "{% set field_sub_field_keys = {" + pairs.join(", ") + "} %}";
}

function buildFieldDisplayNamesJinja(fieldDisplayNames: Record<string, string> | undefined): string {
  const m = fieldDisplayNames || {};
  const pairs = Object.entries(m)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `'${String(k).replace(/'/g, "\\'")}': '${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  return pairs.length ? "{% set field_display_names = {" + pairs.join(", ") + "} %}" : "{% set field_display_names = {} %}";
}

/** Label for a field in report: custom display name or default (f.field_name / kpi.field_names.get(key, key)) */
const fieldLabelF = "{{ (field_display_names.get(f.field_key) or f.field_name) | default(f.field_name) }}";
const fieldLabelKey = "{{ (field_display_names.get(key) or kpi.field_names.get(key, key)) | default(key) }}";

/** Sub-field column header: custom display or sf.name (uses sub_field_display_names[field_key][sub_key]) */
function subFieldLabelExpr(v: "f" | "ef"): string {
  return `{{ ((sub_field_display_names.get(${v}.field_key) or {}) | default({})).get(sf.key) or sf.name | default(sf.name) }}`;
}

function buildSubFieldDisplayNamesJinja(subFieldDisplayNames: Record<string, Record<string, string>> | undefined): string {
  const m = subFieldDisplayNames || {};
  const outer: string[] = [];
  for (const [fk, inner] of Object.entries(m)) {
    if (!inner || typeof inner !== "object") continue;
    const innerPairs = Object.entries(inner)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => `'${String(k).replace(/'/g, "\\'")}': '${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
    if (innerPairs.length) outer.push(`'${String(fk).replace(/'/g, "\\'")}': {${innerPairs.join(", ")}}`);
  }
  return outer.length ? "{% set sub_field_display_names = {" + outer.join(", ") + "} %}" : "{% set sub_field_display_names = {} %}";
}

function multiLineCellSnippet(v: "f" | "ef"): string {
  const subFields = `(${v}.sub_fields | default([]))`;
  const thLabel = subFieldLabelExpr(v);
  return `{% set show_sub_keys = field_sub_field_keys.get(${v}.field_key, []) | default([]) %}{% if ${v}.field_type == 'multi_line_items' and ${v}.value_items %}<table border="1" cellpadding="4" style="border-collapse: collapse; width: 100%;"><tr>{% for sf in ${subFields} %}{% if not show_sub_keys or sf.key in show_sub_keys %}<th>${thLabel}</th>{% endif %}{% endfor %}</tr>{% for item in ${v}.value_items %}<tr>{% for sf in ${subFields} %}{% if not show_sub_keys or sf.key in show_sub_keys %}<td>{{ item[sf.key] }}</td>{% endif %}{% endfor %}</tr>{% endfor %}</table>{% else %}{{ ${v}.value }}{% endif %}`;
}

/** Generate Jinja2 template source from blocks (mirrors backend _blocks_to_jinja). */
function blocksToJinja(blocks: ReportBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    const type = (b as { type: string }).type?.trim() || "";
    if (!type) continue;
    if (type === "title") {
      const useName = (b as { useTemplateName?: boolean }).useTemplateName !== false;
      const custom = ((b as { customText?: string }).customText || "").trim();
      if (custom) out.push(`<h1 class="report-title">${custom}</h1>`);
      else if (useName) out.push("<h1 class=\"report-title\">{{ template_name }}</h1>");
      out.push("<p class=\"report-year\">Year: {{ year }}</p>");
    } else if (type === "section_heading") {
      const text = ((b as { text?: string }).text || "").trim() || "Section";
      const level = Math.min(4, Math.max(1, (b as { level?: number }).level ?? 2));
      out.push(`<h${level} class="report-section">${text}</h${level}>`);
    } else if (type === "spacer") {
      const size = (b as { size?: string }).size || "medium";
      const height = { small: "16px", medium: "24px", large: "40px" }[size] || "24px";
      out.push(`<div class="report-spacer" style="height: ${height}"></div>`);
    } else if (type === "text") {
      const content = ((b as { content?: string }).content || "").trim();
      if (content) out.push(`<div class="report-text-block">${content}</div>`);
    } else if (type === "domain_list") {
      const domainIds = (b as { domainIds?: number[] }).domainIds || [];
      if (domainIds.length) {
        const idsStr = domainIds.join(", ");
        out.push(`{% for domain in domains %}{% if domain.id in [${idsStr}] %}<div class="report-domain"><h3>{{ domain.name }}</h3></div>{% endif %}{% endfor %}`);
      } else {
        out.push("{% for domain in domains %}<div class=\"report-domain\"><h3>{{ domain.name }}</h3></div>{% endfor %}");
      }
    } else if (type === "domain_categories") {
      const domainIds = (b as { domainIds?: number[] }).domainIds || [];
      if (domainIds.length) {
        const idsStr = domainIds.join(", ");
        out.push(`{% for domain in domains %}{% if domain.id in [${idsStr}] %}<div class="report-domain"><h3>{{ domain.name }}</h3><ul>{% for cat in domain.categories %}<li>{{ cat.name }}</li>{% endfor %}</ul></div>{% endif %}{% endfor %}`);
      } else {
        out.push("{% for domain in domains %}<div class=\"report-domain\"><h3>{{ domain.name }}</h3><ul>{% for cat in domain.categories %}<li>{{ cat.name }}</li>{% endfor %}</ul></div>{% endfor %}");
      }
    } else if (type === "domain_kpis") {
      const domainIds = (b as { domainIds?: number[] }).domainIds || [];
      if (domainIds.length) {
        const idsStr = domainIds.join(", ");
        out.push(`{% for domain in domains %}{% if domain.id in [${idsStr}] %}<div class="report-domain"><h3>{{ domain.name }}</h3><ul>{% for cat in domain.categories %}<li>{{ cat.name }}<ul>{% for kpi in cat.kpis %}<li>{{ kpi.kpi_name }}</li>{% endfor %}</ul></li>{% endfor %}</ul></div>{% endif %}{% endfor %}`);
      } else {
        out.push("{% for domain in domains %}<div class=\"report-domain\"><h3>{{ domain.name }}</h3><ul>{% for cat in domain.categories %}<li>{{ cat.name }}<ul>{% for kpi in cat.kpis %}<li>{{ kpi.kpi_name }}</li>{% endfor %}</ul></li>{% endfor %}</ul></div>{% endfor %}");
      }
    } else if (type === "single_value") {
      const kpiId = (b as { kpiId?: number }).kpiId ?? 0;
      const fieldKey = ((b as { fieldKey?: string }).fieldKey || "").trim();
      const subKey = ((b as { subFieldKey?: string }).subFieldKey || "").trim() || "";
      const entryIdx = (b as { entryIndex?: number }).entryIndex ?? 0;
      if (!fieldKey) continue;
      const subArg = subKey ? `, '${subKey.replace(/'/g, "\\'")}'` : ", none";
      out.push(`<span class="report-single-value">{{ get_kpi_field_value(kpis, ${kpiId}, '${fieldKey.replace(/'/g, "\\'")}'${subArg}, ${entryIdx}) }}</span>`);
    } else if (type === "kpi_table") {
      const kpiIds = (b as { kpiIds?: number[] }).kpiIds || [];
      const fieldKeys = (b as { fieldKeys?: string[] }).fieldKeys || [];
      const columnAlign = (b as { columnAlign?: Record<string, CellAlign> }).columnAlign || {};
      const alignMap: Record<string, string> = {};
      (fieldKeys || []).forEach((k) => { alignMap[k] = (columnAlign[k] && ["left", "center", "right", "justify"].includes(columnAlign[k]) ? columnAlign[k] : "left") as string; });
      Object.entries(columnAlign).forEach(([k, v]) => { if (["left", "center", "right", "justify"].includes(v)) alignMap[k] = v; });
      const columnAlignEntries = Object.entries(alignMap).map(([k, v]) => `'${k.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}': '${v}'`).join(", ");
      const columnAlignPrefix = `{% set column_align = { ${columnAlignEntries} } %}`;
      const thStyle = ' style="text-align: {{ column_align.get(key, \'left\') }}"';
      const tdStyleKey = ' style="text-align: {{ column_align.get(key, \'left\') }}"';
      const tdStyleF = ' style="text-align: {{ column_align.get(f.field_key, \'left\') }}"';
      const tdStyleEf = ' style="text-align: {{ column_align.get(ef.field_key, \'left\') }}"';
      const fieldsLayout = (b as { fieldsLayout?: "columns" | "rows" }).fieldsLayout ?? "columns";
      const showTableHeading = (b as { showTableHeading?: boolean }).showTableHeading;
      const headingPart = showTableHeading === false ? "" : "<h4>{{ kpi.kpi_name }}</h4>";
      const showMultiLineFieldLabel = (b as { showMultiLineFieldLabel?: boolean }).showMultiLineFieldLabel !== false;
      const showMlLabelPrefix = `{% set show_multi_line_field_label = ${showMultiLineFieldLabel ? "true" : "false"} %}`;
      const fieldLabelFCond = `{% if show_multi_line_field_label or f.field_type != 'multi_line_items' %}${fieldLabelF}{% endif %}`;
      const fieldLabelKeyCond = `{% set _fl = (kpi.entries[0].fields | default([]) | selectattr('field_key', 'equalto', key) | list) %}{% if show_multi_line_field_label or (_fl | length == 0) or (((_fl|first)|default({})).field_type != 'multi_line_items') %}${fieldLabelKey}{% endif %}`;
      const multiLineSubFieldKeys = (b as { multiLineSubFieldKeys?: Record<string, string[]> }).multiLineSubFieldKeys;
      const fieldDisplayNames = (b as { fieldDisplayNames?: Record<string, string> }).fieldDisplayNames;
      const subFieldDisplayNames = (b as { subFieldDisplayNames?: Record<string, Record<string, string>> }).subFieldDisplayNames;
      const displayPrefix = buildFieldDisplayNamesJinja(fieldDisplayNames);
      const subFieldDisplayPrefix = buildSubFieldDisplayNamesJinja(subFieldDisplayNames);
      const subKeysPrefix = buildFieldSubFieldKeysJinja(multiLineSubFieldKeys);
      const cellMulti = multiLineCellSnippet("f");
      const cellMultiEf = multiLineCellSnippet("ef");
      const cellByKey = `{% for f in entry.fields %}{% if f.field_key == key %}<td${tdStyleKey}>${cellMulti}</td>{% endif %}{% endfor %}`;
      const tdPrefix = blockTimeDimensionPrefix(b);
      if (fieldsLayout === "rows") {
        if (!kpiIds.length && !fieldKeys.length) {
          const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + showMlLabelPrefix + columnAlignPrefix + `<div class="report-kpi-table">{% if kpis %}{% for kpi in kpis %}${headingPart}<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;"><tbody>{% for f in kpi.entries[0].fields if kpi.entries %}<tr><td${tdStyleF}>${fieldLabelFCond}</td>{% for entry in kpi.entries %}{% for ef in entry.fields %}{% if ef.field_key == f.field_key %}<td${tdStyleEf}>${cellMultiEf}</td>{% endif %}{% endfor %}{% endfor %}</tr>{% endfor %}</tbody></table>{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`;
          out.push(injectTimeDimensionFilter(raw, tdPrefix));
        } else {
          const fidList = kpiIds.join(", ");
          const fkeysList = fieldKeys.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");
          const rowCellByKey = `{% for f in entry.fields %}{% if f.field_key == key %}<td${tdStyleKey}>${cellMulti}</td>{% endif %}{% endfor %}`;
          const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + showMlLabelPrefix + columnAlignPrefix + `{% set kpi_ids_set = [${fidList}] %}{% set field_keys_list = [${fkeysList}] %}<div class="report-kpi-table">{% if kpis %}{% for kpi in kpis %}{% if kpi.kpi_id in kpi_ids_set %}${headingPart}<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;"><tbody>{% for key in field_keys_list %}<tr><td>${fieldLabelKeyCond}</td>{% for entry in kpi.entries %}${rowCellByKey}{% endfor %}</tr>{% endfor %}</tbody></table>{% endif %}{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`;
          out.push(injectTimeDimensionFilter(raw, tdPrefix));
        }
      } else {
        if (!kpiIds.length && !fieldKeys.length) {
          const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + showMlLabelPrefix + columnAlignPrefix + `<div class="report-kpi-table">{% if kpis %}{% for kpi in kpis %}${headingPart}<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;"><thead><tr>{% for f in kpi.entries[0].fields if kpi.entries %}<th${tdStyleF}>${fieldLabelFCond}</th>{% endfor %}</tr></thead><tbody>{% for entry in kpi.entries %}<tr>{% for f in entry.fields %}<td${tdStyleF}>${cellMulti}</td>{% endfor %}</tr>{% endfor %}</tbody></table>{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`;
          out.push(injectTimeDimensionFilter(raw, tdPrefix));
        } else {
          const fidList = kpiIds.join(", ");
          const fkeysList = fieldKeys.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");
          const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + showMlLabelPrefix + columnAlignPrefix + `{% set kpi_ids_set = [${fidList}] %}{% set field_keys_list = [${fkeysList}] %}<div class="report-kpi-table">{% if kpis %}{% for kpi in kpis %}{% if kpi.kpi_id in kpi_ids_set %}${headingPart}<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;"><thead><tr>{% for key in field_keys_list %}<th${thStyle}>${fieldLabelKeyCond}</th>{% endfor %}</tr></thead><tbody>{% for entry in kpi.entries %}<tr>{% for key in field_keys_list %}${cellByKey}{% endfor %}</tr>{% endfor %}</tbody></table>{% endif %}{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`;
          out.push(injectTimeDimensionFilter(raw, tdPrefix));
        }
      }
    } else if (type === "kpi_multi_table") {
      const kpiId = (b as { kpiId?: number }).kpiId ?? 0;
      const fieldKey = ((b as { fieldKey?: string }).fieldKey || "").trim();
      if (!kpiId || !fieldKey) continue;
      const fieldKeyEsc = fieldKey.replace(/'/g, "\\'");
      out.push(
        `<div class="report-kpi-multi-table">{% set _ml = get_multi_line_field(kpis, ${kpiId}, '${fieldKeyEsc}', 0) %}{% if _ml %}<table border="1" cellpadding="4" style="border-collapse: collapse; width: 100%;"><tr>{% for sf in (_ml.sub_fields | default([])) %}<th>{{ sf.name }}</th>{% endfor %}</tr>{% for item in _ml.value_items %}<tr>{% for sf in (_ml.sub_fields | default([])) %}<td>{{ item[sf.key] }}</td>{% endfor %}</tr>{% endfor %}</table>{% endif %}</div>`
      );
    } else if (type === "simple_table") {
      const rows = (b as { rows?: SimpleTableRow[] }).rows || [];
      const rowParts: string[] = [];
      for (const row of rows) {
        const cells = row.cells || [];
        const cellParts: string[] = [];
        for (const cell of cells) {
          const align = (cell as { align?: CellAlign }).align || "left";
          const tdStyle = ` style="text-align: ${align}"`;
          if (cell.type === "text") {
            const content = (cell.content || "").trim();
            cellParts.push("<td" + tdStyle + ">" + escapeHtml(content) + "</td>");
          } else if (cell.type === "kpi") {
            const kpiId = cell.kpiId ?? 0;
            const fieldKey = (cell.fieldKey || "").replace(/'/g, "\\'");
            const subKey = (cell.subFieldKey || "").trim() || "";
            const subFieldGroupFn = (cell.subFieldGroupFn || "SUM_ITEMS").trim() || "SUM_ITEMS";
            const entryIdx = cell.entryIndex ?? 0;
            if (cell.asGroup) {
              cellParts.push(
                `<td${tdStyle}>{% set _ml = get_multi_line_field(kpis, ${kpiId}, '${fieldKey}', ${entryIdx}) %}{% if _ml %}<table border="1" cellpadding="4" style="border-collapse: collapse;"><tr>{% for sf in (_ml.sub_fields | default([])) %}<th>{{ sf.name }}</th>{% endfor %}</tr>{% for item in _ml.value_items %}<tr>{% for sf in (_ml.sub_fields | default([])) %}<td>{{ item[sf.key] }}</td>{% endfor %}</tr>{% endfor %}</table>{% endif %}</td>`
              );
            } else if (subKey) {
              const formula = `${subFieldGroupFn}(${cell.fieldKey || ""}, ${subKey})`.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
              cellParts.push(
                `<td${tdStyle}>{{ evaluate_report_formula(kpis, '${formula}', ${kpiId}, ${entryIdx}) }}</td>`
              );
            } else {
              const subArg = ", none";
              cellParts.push(
                `<td${tdStyle}>{{ get_kpi_field_value(kpis, ${kpiId}, '${fieldKey}'${subArg}, ${entryIdx}) }}</td>`
              );
            }
          } else if (cell.type === "formula") {
            const kpiId = cell.kpiId ?? 0;
            const entryIdx = cell.entryIndex ?? 0;
            const formula = (cell.formula || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            cellParts.push(
              `<td${tdStyle}>{{ evaluate_report_formula(kpis, '${formula}', ${kpiId}, ${entryIdx}) }}</td>`
            );
          } else {
            cellParts.push("<td" + tdStyle + "></td>");
          }
        }
        rowParts.push("<tr>" + cellParts.join("") + "</tr>");
      }
      out.push(
        '<div class="report-simple-table"><table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;"><tbody>' +
          rowParts.join("") +
          "</tbody></table></div>"
      );
    } else if (type === "kpi_grid") {
      const kpiIds = (b as { kpiIds?: number[] }).kpiIds || [];
      const fieldKeys = (b as { fieldKeys?: string[] }).fieldKeys || [];
      const displayPrefix = buildFieldDisplayNamesJinja((b as { fieldDisplayNames?: Record<string, string> }).fieldDisplayNames);
      const subFieldDisplayPrefix = buildSubFieldDisplayNamesJinja((b as { subFieldDisplayNames?: Record<string, Record<string, string>> }).subFieldDisplayNames);
      const subKeysPrefix = buildFieldSubFieldKeysJinja((b as { multiLineSubFieldKeys?: Record<string, string[]> }).multiLineSubFieldKeys);
      const gridCellMulti = multiLineCellSnippet("f");
      const tdPrefixGrid = blockTimeDimensionPrefix(b);
      if (!kpiIds.length && !fieldKeys.length) {
        const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + `<div class="report-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">{% if kpis %}{% for kpi in kpis %}{% for entry in kpi.entries %}<div class="report-card" style="border: 1px solid #ddd; padding: 1rem; border-radius: 8px;"><h4 style="margin-top: 0;">{{ kpi.kpi_name }}</h4>{% for f in entry.fields %}<p style="margin: 0.25rem 0;"><strong>${fieldLabelF}:</strong> ${gridCellMulti}</p>{% endfor %}</div>{% endfor %}{% endfor %}{% endif %}</div>`;
        out.push(injectTimeDimensionFilter(raw, tdPrefixGrid));
      } else {
        const fidList = kpiIds.join(", ");
        const fkeysList = fieldKeys.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");
        const gridCellByKey = `{% for f in entry.fields %}{% if f.field_key == key %}${gridCellMulti}{% endif %}{% endfor %}`;
        const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + `{% set kpi_ids_set = [${fidList}] %}{% set field_keys_list = [${fkeysList}] %}<div class="report-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">{% if kpis %}{% for kpi in kpis %}{% if kpi.kpi_id in kpi_ids_set %}{% for entry in kpi.entries %}<div class="report-card" style="border: 1px solid #ddd; padding: 1rem; border-radius: 8px;"><h4 style="margin-top: 0;">{{ kpi.kpi_name }}</h4>{% for key in field_keys_list %}<p style="margin: 0.25rem 0;"><strong>${fieldLabelKey}:</strong> ${gridCellByKey}</p>{% endfor %}</div>{% endfor %}{% endif %}{% endfor %}{% endif %}</div>`;
        out.push(injectTimeDimensionFilter(raw, tdPrefixGrid));
      }
    } else if (type === "kpi_list") {
      const kpiIds = (b as { kpiIds?: number[] }).kpiIds || [];
      const fieldKeys = (b as { fieldKeys?: string[] }).fieldKeys || [];
      const displayPrefix = buildFieldDisplayNamesJinja((b as { fieldDisplayNames?: Record<string, string> }).fieldDisplayNames);
      const subFieldDisplayPrefix = buildSubFieldDisplayNamesJinja((b as { subFieldDisplayNames?: Record<string, Record<string, string>> }).subFieldDisplayNames);
      const subKeysPrefix = buildFieldSubFieldKeysJinja((b as { multiLineSubFieldKeys?: Record<string, string[]> }).multiLineSubFieldKeys);
      const listCellMulti = multiLineCellSnippet("f");
      const tdPrefixList = blockTimeDimensionPrefix(b);
      if (!kpiIds.length && !fieldKeys.length) {
        const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + `<div class="report-kpi-list">{% if kpis %}{% for kpi in kpis %}<h4>{{ kpi.kpi_name }}</h4><dl style="margin: 0.5rem 0;">{% for entry in kpi.entries %}{% for f in entry.fields %}<dt style="font-weight: 600;">${fieldLabelF}</dt><dd style="margin-left: 1rem;">${listCellMulti}</dd>{% endfor %}{% endfor %}</dl>{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`;
        out.push(injectTimeDimensionFilter(raw, tdPrefixList));
      } else {
        const fidList = kpiIds.join(", ");
        const fkeysList = fieldKeys.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");
        const listCellByKey = `{% for f in entry.fields %}{% if f.field_key == key %}${listCellMulti}{% endif %}{% endfor %}`;
        const raw = displayPrefix + subFieldDisplayPrefix + subKeysPrefix + `{% set kpi_ids_set = [${fidList}] %}{% set field_keys_list = [${fkeysList}] %}<div class="report-kpi-list">{% if kpis %}{% for kpi in kpis %}{% if kpi.kpi_id in kpi_ids_set %}<h4>{{ kpi.kpi_name }}</h4><dl style="margin: 0.5rem 0;">{% for entry in kpi.entries %}{% for key in field_keys_list %}<dt style="font-weight: 600;">${fieldLabelKey}</dt><dd style="margin-left: 1rem;">${listCellByKey}</dd>{% endfor %}{% endfor %}</dl>{% endif %}{% endfor %}{% endif %}</div>`;
        out.push(injectTimeDimensionFilter(raw, tdPrefixList));
      }
    }
  }
  return out.length ? out.join("\n") : "<p>No content. Add blocks in the visual designer.</p>";
}

export default function ReportDesignPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const token = getAccessToken();
  const [designAllowed, setDesignAllowed] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bodyTemplate, setBodyTemplate] = useState("");

  const [isDirty, setIsDirty] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null);
  const [autoSave, setAutoSave] = useState(true);
  const autoSaveRef = useRef(true);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef<ReportBlock[]>([]);
  const bodyTemplateRef = useRef("");

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [previewFrameHeight, setPreviewFrameHeight] = useState<number>(480);

  const [reportContentMinimized, setReportContentMinimized] = useState(false);
  const [livePreviewMinimized, setLivePreviewMinimized] = useState(false);
  const [minimizedBlockIds, setMinimizedBlockIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"both" | "design" | "preview">("both");
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printModalYear, setPrintModalYear] = useState(() => new Date().getFullYear());

  const toggleBlockMinimized = useCallback((blockId: string) => {
    setMinimizedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, []);

  const [fieldsByKpiId, setFieldsByKpiId] = useState<Record<number, FieldOption[]>>({});

  const loadDetail = useCallback(() => {
    if (!id || !token) return;
    setError(null);
    api<TemplateDetail>(`/reports/templates/${id}/detail`, { token })
      .then((d) => {
        setDetail(d);
        const blocksList = Array.isArray(d.body_blocks) ? d.body_blocks.map(addBlockId) : [];
        setBlocks(blocksList);
        setBodyTemplate(d.body_template || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id, token]);

  // Only SUPER_ADMIN may access the design page
  useEffect(() => {
    if (!token) return;
    api<{ role: string }>("/auth/me", { token })
      .then((me) => {
        const allowed = me.role === "SUPER_ADMIN";
        setDesignAllowed(allowed);
        if (!allowed) router.replace(`/dashboard/reports/${id}`);
      })
      .catch(() => setDesignAllowed(false));
  }, [token, id, router]);

  useEffect(() => {
    if (designAllowed !== true) return;
    loadDetail();
  }, [loadDetail, designAllowed]);

  blocksRef.current = blocks;
  bodyTemplateRef.current = bodyTemplate;

  const performAutoSave = useCallback(async () => {
    if (!token || !detail) return;
    const currentBlocks = blocksRef.current;
    const currentBodyTemplate = bodyTemplateRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      if (currentBlocks.length > 0) {
        await api(`/reports/templates/${id}?${qs({ organization_id: detail.organization_id })}`, {
          method: "PATCH",
          token,
          body: JSON.stringify({
            body_blocks: currentBlocks.map(({ id: _id, ...rest }) => rest),
          }),
        });
      } else {
        await api(`/reports/templates/${id}?${qs({ organization_id: detail.organization_id })}`, {
          method: "PATCH",
          token,
          body: JSON.stringify({
            body_template: currentBodyTemplate,
            body_blocks: null,
          }),
        });
      }
      setLastAutoSavedAt(Date.now());
      setIsDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Draft save failed");
    } finally {
      setSaving(false);
    }
  }, [id, token, detail]);

  const scheduleAutoSave = useCallback(() => {
    if (!autoSaveRef.current) return;
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSaveTimeoutRef.current = null;
      if (!autoSaveRef.current) return;
      performAutoSave();
    }, AUTO_SAVE_DELAY_MS);
  }, [performAutoSave]);

  autoSaveRef.current = autoSave;

  useEffect(() => {
    if (!autoSave && autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  }, [autoSave]);

  const loadFieldsForKpis = useCallback(
    (kpiIds: number[]) => {
      if (!token || !detail?.organization_id || kpiIds.length === 0) return;
      const missing = kpiIds.filter((kid) => !fieldsByKpiId[kid]);
      missing.forEach((kpiId) => {
        api<FieldOption[]>(
          `/fields?${qs({ kpi_id: kpiId, organization_id: detail.organization_id })}`,
          { token }
        )
          .then((fields) => setFieldsByKpiId((prev) => ({ ...prev, [kpiId]: fields })))
          .catch(() => {});
      });
    },
    [token, detail?.organization_id, fieldsByKpiId]
  );

  const markDirtyAndScheduleAutoSave = useCallback(() => {
    setIsDirty(true);
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  const addBlock = (block: ReportBlock) => {
    setBlocks((prev) => [...prev, addBlockId(block)]);
    markDirtyAndScheduleAutoSave();
  };

  const updateBlock = (index: number, updates: Partial<ReportBlock>) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b = next[index] as Record<string, unknown>;
      next[index] = { ...b, ...updates } as ReportBlock;
      return next;
    });
    markDirtyAndScheduleAutoSave();
  };

  const removeBlock = (index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
    markDirtyAndScheduleAutoSave();
  };

  const moveBlock = (index: number, dir: "up" | "down") => {
    const newIndex = dir === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= blocks.length) return;
    setBlocks((prev) => {
      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next;
    });
    markDirtyAndScheduleAutoSave();
  };

  const saveVisual = async () => {
    if (!token || !detail) return;
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api(`/reports/templates/${id}?${qs({ organization_id: detail.organization_id })}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          body_blocks: blocks.map(({ id: _id, ...rest }) => rest),
        }),
      });
      setIsDirty(false);
      fetchPreview();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const generatedTemplate = useMemo(() => blocksToJinja(blocks), [blocks]);
  const templateSourceDisplay = blocks.length > 0 ? generatedTemplate : bodyTemplate;
  const isTemplateFromBlocks = blocks.length > 0;
  const templateForPreview = templateSourceDisplay;

  const PREVIEW_TIMEOUT_MS = 90_000;
  const fetchPreview = useCallback(() => {
    if (!detail || !token || !templateForPreview.trim()) {
      setPreviewHtml(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const query = qs({
      organization_id: detail.organization_id,
      year: reportYear,
    });
    const url = getApiUrl(`/reports/templates/${id}/preview?${query}`);
    const doRequest = (retry = false): Promise<void> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
      return fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body_template: templateForPreview }),
        signal: controller.signal,
      })
        .then((res) => {
          clearTimeout(timeoutId);
          if (!res.ok) {
            return res.json().catch(() => ({ detail: res.statusText })).then((err: { detail?: string | { msg?: string }[] }) => {
              throw new Error(Array.isArray(err?.detail) ? err.detail.map((d: { msg?: string }) => d?.msg).join(", ") : (err?.detail as string) || res.statusText);
            });
          }
          return res.json();
        })
        .then((data: { html: string }) => {
          setPreviewHtml(data.html);
          setPreviewLoading(false);
        })
        .catch((e: unknown) => {
          clearTimeout(timeoutId);
          const err = e as { name?: string; message?: string };
          const isAbort = err?.name === "AbortError";
          const isNetwork = err?.message === "Failed to fetch" || (typeof err?.message === "string" && err.message.includes("Load failed"));
          if ((isAbort || isNetwork) && !retry) {
            setTimeout(() => doRequest(true), 1500);
            return;
          }
          setPreviewLoading(false);
          const msg = err instanceof Error ? err.message : "Preview failed";
          setPreviewError(
            isAbort
              ? "Preview timed out. Try simplifying the report or try again."
              : isNetwork
                ? "Preview request failed (network or CORS). Ensure the backend is running and reachable."
                : String(msg)
          );
        });
    };
    doRequest();
  }, [id, token, detail?.organization_id, reportYear, templateForPreview]);

  const hasAutoRefreshedPreviewOnLoad = useRef(false);
  useEffect(() => {
    if (!detail || loading || !templateForPreview.trim()) return;
    if (hasAutoRefreshedPreviewOnLoad.current) return;
    hasAutoRefreshedPreviewOnLoad.current = true;
    fetchPreview();
  }, [detail, loading, templateForPreview, fetchPreview]);

  const openReportForPrint = (year?: number) => {
    const t = getAccessToken();
    if (!t) return;
    const yr = year ?? reportYear;
    setPrintError(null);
    setPrintLoading(true);
    const url = `/reports/templates/${id}/generate?format=json&year=${yr}&_t=${Date.now()}`;
    api<ReportData>(url, { token: t, cache: "no-store" })
      .then((reportData) => {
        const doc = buildReportPrintDocument(reportData);
        const opened = openReportPrintWindow(doc, true);
        if (!opened) setPrintError("Pop-up was blocked. Allow pop-ups for this site to open print/PDF in a new tab.");
      })
      .catch((e) => setPrintError(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => {
        setPrintLoading(false);
        setPrintModalOpen(false);
      });
  };

  const openPrintModal = () => {
    setPrintModalYear(reportYear);
    setPrintModalOpen(true);
  };

  const confirmPrintFromModal = () => {
    openReportForPrint(printModalYear);
    // Modal stays open; progress shown inside until load finishes
  };

  const saveAdvanced = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !detail) return;
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const templateToSave = isTemplateFromBlocks ? generatedTemplate : bodyTemplate;
      await api(`/reports/templates/${id}?${qs({ organization_id: detail.organization_id })}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          body_template: templateToSave,
          body_blocks: null,
        }),
      });
      setIsDirty(false);
      loadDetail();
      fetchPreview();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (designAllowed === null) return <p style={{ padding: "1rem" }}>Checking access…</p>;
  if (designAllowed === false) return <p style={{ padding: "1rem" }}>Redirecting…</p>;
  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!detail) return null;

  const kpis = detail.kpis_from_domains;
  const domains = detail.attached_domains;

  const previewDoc = previewHtml != null
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:inherit;margin:1rem;color:var(--text,#111);}</style></head><body>${previewHtml}</body></html>`
    : "";

  const toggleReportContent = () => setReportContentMinimized((m) => !m);
  const toggleLivePreview = () => setLivePreviewMinimized((m) => !m);

  return (
    <div style={{ padding: "0 1rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Design report: {detail.name}</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {livePreviewMinimized && (
          <button
            type="button"
            className="btn"
            style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem", marginLeft: "0.5rem" }}
            onClick={() => setLivePreviewMinimized(false)}
          >
            Show Preview
          </button>
        )}
        {reportContentMinimized && (
          <button
            type="button"
            className="btn"
            style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem", marginLeft: "0.5rem" }}
            onClick={() => setReportContentMinimized(false)}
          >
            Show Design
          </button>
        )}
      </div>

      {/* Grid: Report content | Live preview — hide one to give the other full space */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: viewMode === "both" && !livePreviewMinimized && !reportContentMinimized ? "repeat(2, minmax(0, 1fr))" : "1fr",
          gap: "1.5rem",
          alignItems: "start",
        }}
        className="report-design-grid"
      >
        {/* Left column: Report content — hidden when viewMode === "preview" or when Hide Design is active */}
        {((viewMode === "both" || viewMode === "design") && !reportContentMinimized) && (
        <div className="card" style={{ padding: 0, marginBottom: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "0.75rem 1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              border: "none",
              background: "var(--surface)",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            <span>Report content</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  color: "var(--text)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                title={autoSave ? "Draft is saved automatically every 45 seconds" : "Auto-save is off; use Save when done"}
              >
                <input
                  type="checkbox"
                  checked={autoSave}
                  onChange={(e) => setAutoSave(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                Auto-save
              </label>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0.25rem 0.6rem",
                  borderRadius: 6,
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  ...(isDirty
                    ? { background: "rgba(217, 119, 6, 0.15)", color: "var(--warning)", border: "1px solid var(--warning)" }
                    : { background: "rgba(5, 150, 105, 0.12)", color: "var(--success)", border: "1px solid var(--success)" }),
                }}
                title={isDirty ? (autoSave ? "Unsaved changes; draft auto-saves every 45s" : "Unsaved changes; use Save when done") : "All changes saved"}
              >
                {saving ? "Saving…" : isDirty ? "Draft" : "Saved"}
              </span>
              <button
                type="button"
                onClick={() => {
                  const allIds = new Set(blocks.map((block, index) => (block as { id?: string }).id ?? `idx-${index}`));
                  const allCollapsed = allIds.size > 0 && Array.from(allIds).every((bid) => minimizedBlockIds.has(bid));
                  setMinimizedBlockIds(allCollapsed ? new Set() : allIds);
                }}
                style={{
                  padding: "0.35rem 0.65rem",
                  fontSize: "0.85rem",
                  color: "var(--muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--surface)",
                  cursor: "pointer",
                }}
              >
                {blocks.length > 0 && [...blocks].every((_, i) => minimizedBlockIds.has((blocks[i] as { id?: string }).id ?? `idx-${i}`))
                  ? "Expand blocks"
                  : "Collapse blocks"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReportContentMinimized(true);
                  if (viewMode === "design") {
                    setViewMode("both");
                    setLivePreviewMinimized(false);
                  }
                }}
                style={{
                  padding: "0.35rem 0.65rem",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                }}
              >
                Hide Design
              </button>
            </div>
          </div>
          {(
            <div style={{ padding: "1.25rem", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--muted)", marginRight: "0.25rem" }}>Add:</span>
            {[
              { v: "title", label: "Title" },
              { v: "section_heading", label: "Section" },
              { v: "text", label: "Text" },
              { v: "kpi_table", label: "KPI table" },
              { v: "simple_table", label: "Simple table" },
            ].map(({ v, label }) => (
              <button
                key={v}
                type="button"
                className="btn"
                style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem" }}
                onClick={() => {
                  if (v === "title") addBlock({ type: "title", useTemplateName: true, customText: "" });
                  else if (v === "section_heading") addBlock({ type: "section_heading", text: "New section", level: 2 });
                  else if (v === "text") addBlock({ type: "text", content: "" });
                  else if (v === "kpi_table") addBlock({ type: "kpi_table", kpiIds: [], fieldKeys: [], oneTablePerKpi: true, fieldsLayout: "columns", multiLineSubFieldKeys: {}, timeDimensionMode: "latest", periodKey: "" });
                  else if (v === "simple_table") addBlock({ type: "simple_table", rows: [{ cells: [{ type: "text", content: "" }] }] });
                }}
              >
                {label}
              </button>
            ))}
            <select
              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem" }}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (!v) return;
                if (v === "spacer") addBlock({ type: "spacer", size: "medium" });
                else if (v === "domain_list") addBlock({ type: "domain_list", domainIds: [] });
                else if (v === "domain_categories") addBlock({ type: "domain_categories", domainIds: [] });
                else if (v === "domain_kpis") addBlock({ type: "domain_kpis", domainIds: [] });
                else if (v === "kpi_grid") addBlock({ type: "kpi_grid", kpiIds: [], fieldKeys: [], multiLineSubFieldKeys: {}, timeDimensionMode: "latest", periodKey: "" });
                else if (v === "kpi_list") addBlock({ type: "kpi_list", kpiIds: [], fieldKeys: [], multiLineSubFieldKeys: {}, timeDimensionMode: "latest", periodKey: "" });
                else if (v === "single_value") addBlock({ type: "single_value", kpiId: kpis[0]?.kpi_id ?? 0, fieldKey: "", subFieldKey: "", entryIndex: 0 });
                else if (v === "kpi_multi_table") addBlock({ type: "kpi_multi_table", kpiId: kpis[0]?.kpi_id ?? 0, fieldKey: "" });
              }}
            >
              <option value="">More…</option>
              <option value="spacer">{BLOCK_LABELS.spacer}</option>
              <option value="domain_list">{BLOCK_LABELS.domain_list}</option>
              <option value="domain_categories">{BLOCK_LABELS.domain_categories}</option>
              <option value="domain_kpis">{BLOCK_LABELS.domain_kpis}</option>
              <option value="kpi_grid">{BLOCK_LABELS.kpi_grid}</option>
              <option value="kpi_list">{BLOCK_LABELS.kpi_list}</option>
              <option value="single_value">{BLOCK_LABELS.single_value}</option>
              <option value="kpi_multi_table">{BLOCK_LABELS.kpi_multi_table}</option>
            </select>
            <button type="button" className="btn btn-primary" onClick={saveVisual} disabled={saving || previewLoading} style={{ marginLeft: "0.5rem" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {saveError && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{saveError}</p>}

        {blocks.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8, background: "var(--bg-muted, #fafafa)" }}>
            <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>No content yet. Start with a title or a text block.</p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={() => addBlock({ type: "title", useTemplateName: true, customText: "" })}>
                Add title
              </button>
              <button type="button" className="btn" onClick={() => addBlock({ type: "text", content: "" })}>
                Add text
              </button>
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {blocks.map((block, index) => {
              const blockId = (block as { id?: string }).id ?? `idx-${index}`;
              return (
                <li key={blockId} style={{ marginBottom: "0.75rem" }}>
                  <BlockCard
                    block={block}
                    blockId={blockId}
                    index={index}
                    total={blocks.length}
                    detail={detail}
                    templateId={id}
                    reportYear={reportYear}
                    fieldsByKpiId={fieldsByKpiId}
                    loadFieldsForKpis={loadFieldsForKpis}
                    isMinimized={minimizedBlockIds.has(blockId)}
                    onToggleMinimize={() => toggleBlockMinimized(blockId)}
                    onUpdate={(u) => updateBlock(index, u)}
                    onRemove={() => removeBlock(index)}
                    onMoveUp={() => moveBlock(index, "up")}
                    onMoveDown={() => moveBlock(index, "down")}
                  />
                </li>
              );
            })}
          </ul>
        )}
            </div>
          )}
        </div>
        )}

        {/* Right column: Live preview — hidden when viewMode === "design" or when Hide Preview is active */}
        {(viewMode === "both" && !livePreviewMinimized) || viewMode === "preview" ? (
        <div
          className="card"
          style={{
            padding: 0,
            marginBottom: 0,
            overflow: "hidden",
            position: "sticky",
            top: 0,
            alignSelf: "flex-start",
          }}
        >
          <div
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
              border: "none",
              background: "var(--surface)",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            <span>Live preview</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", fontWeight: 500, color: "var(--text)" }}>
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>Year</span>
                <select
                  value={reportYear}
                  onChange={(e) => setReportYear(Number(e.target.value))}
                  style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setLivePreviewMinimized(true);
                  if (viewMode === "preview") setViewMode("both");
                }}
                style={{
                  padding: "0.35rem 0.65rem",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                }}
              >
                Hide Preview
              </button>
            </div>
          </div>
          {!livePreviewMinimized && (
            <div style={{ padding: "1rem", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: "0.9rem" }}
                  onClick={fetchPreview}
                  disabled={previewLoading || !templateForPreview.trim()}
                >
                  {previewLoading ? "Loading…" : "Refresh preview"}
                </button>
                {!previewLoading && !previewError && previewHtml != null && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: "0.9rem" }}
                      onClick={openPrintModal}
                      disabled={printLoading}
                    >
                      {printLoading ? "Opening…" : "Print / Export PDF"}
                    </button>
                    {printLoading && (
                      <ReportLoadProgress label="Preparing report for view/print…" compact />
                    )}
                    {printError && <p className="form-error" style={{ margin: 0, fontSize: "0.9rem" }}>{printError}</p>}
                  </>
                )}
              </div>
              {previewLoading && <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.5rem 0" }}>Updating…</p>}
              {previewError && <p className="form-error" style={{ margin: "0.5rem 0", fontSize: "0.9rem" }}>{previewError}</p>}
              {!previewLoading && !previewError && previewHtml != null && (
                <>
                <iframe
                  ref={previewFrameRef}
                  title="Report preview"
                  srcDoc={previewDoc}
                  onLoad={() => {
                    const frame = previewFrameRef.current;
                    if (!frame) return;
                    try {
                      const doc = frame.contentDocument || frame.contentWindow?.document;
                      const body = doc?.body;
                      const html = doc?.documentElement;
                      const h = Math.max(
                        body?.scrollHeight || 0,
                        html?.scrollHeight || 0,
                        480
                      );
                      setPreviewFrameHeight(h);
                    } catch {
                      // ignore cross-origin or measurement errors
                    }
                  }}
                  style={{
                    width: "100%",
                    minHeight: 480,
                    height: previewFrameHeight,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface)",
                  }}
                />
                </>
              )}
              {!previewLoading && !previewError && previewHtml == null && templateForPreview.trim() && (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Click Save or Refresh preview to load the report.</p>
              )}
            </div>
          )}
        </div>
        ) : null}
      </div>

      {/* Advanced: raw template (full width below grid) */}
      <section className="card" style={{ marginTop: "1.5rem", padding: "0" }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          style={{
            width: "100%",
            padding: "0.75rem 1rem",
            textAlign: "left",
            border: "none",
            background: "var(--surface)",
            cursor: "pointer",
            fontSize: "0.95rem",
            fontWeight: 600,
            borderBottom: advancedOpen ? "1px solid var(--border)" : "none",
          }}
        >
          {advancedOpen ? "▼" : "▶"} Advanced: edit raw template (Jinja2)
        </button>
        {advancedOpen && (
          <div style={{ padding: "1rem" }}>
            {isTemplateFromBlocks ? (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                This is the template code generated from your blocks above. It updates as you add, edit, or reorder blocks. Save your design with the Save button above to keep changes.
              </p>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                Edit the raw Jinja2/HTML template. Saving here will replace any block-based design.
              </p>
            )}
            <form onSubmit={saveAdvanced}>
              <textarea
                value={templateSourceDisplay}
                onChange={(e) => {
                if (!isTemplateFromBlocks) {
                  setBodyTemplate(e.target.value);
                  markDirtyAndScheduleAutoSave();
                }
              }}
                readOnly={isTemplateFromBlocks}
                rows={12}
                placeholder="HTML + Jinja2..."
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  background: isTemplateFromBlocks ? "var(--bg-muted, #f8f9fa)" : undefined,
                }}
              />
              <button type="submit" className="btn btn-primary" disabled={saving || previewLoading} style={{ marginTop: "0.5rem" }}>
                {isTemplateFromBlocks ? "Use this as raw template (replace blocks)" : "Save raw template"}
              </button>
            </form>
          </div>
        )}
      </section>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginTop: "1rem" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openPrintModal}
          disabled={printLoading}
        >
          {printLoading ? "Opening…" : "Print / Export PDF"}
        </button>
        {printLoading && (
          <ReportLoadProgress label="Preparing report for view/print…" compact />
        )}
        {printError && <p className="form-error" style={{ margin: 0 }}>{printError}</p>}
      </div>

      {printModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="design-print-year-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            padding: "1rem",
          }}
          onClick={(e) => e.target === e.currentTarget && setPrintModalOpen(false)}
        >
          <div className="card" style={{ maxWidth: 360, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            {printLoading ? (
              <>
                <h3 id="design-print-year-modal-title" style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem" }}>Preparing report</h3>
                <ReportLoadProgress label="Loading report data…" />
              </>
            ) : (
              <>
                <h3 id="design-print-year-modal-title" style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Select year for report</h3>
                <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>Choose the reporting year for data in the report.</p>
                <div className="form-group" style={{ marginBottom: "1rem" }}>
                  <label htmlFor="design-print-modal-year">Year</label>
                  <select
                    id="design-print-modal-year"
                    value={printModalYear}
                    onChange={(e) => setPrintModalYear(Number(e.target.value))}
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" onClick={() => setPrintModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={confirmPrintFromModal}>
                    Print / Export PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function insertAtCursor(
  placeholder: string,
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>,
  content: string,
  onContentChange: (content: string) => void
) {
  const ta = textAreaRef.current;
  const start = ta?.selectionStart ?? content.length;
  const end = ta?.selectionEnd ?? content.length;
  const newContent = content.slice(0, start) + placeholder + content.slice(end);
  onContentChange(newContent);
  setTimeout(() => {
    ta?.focus();
    ta?.setSelectionRange(start + placeholder.length, start + placeholder.length);
  }, 0);
}

function TextBlockWithKpiInsert({
  content,
  onContentChange,
  textAreaRef,
  kpis,
  fieldsByKpiId,
  detail,
  templateId,
  reportYear,
}: {
  content: string;
  onContentChange: (content: string) => void;
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
  kpis: KpiFromDomain[];
  fieldsByKpiId: Record<number, FieldOption[]>;
  detail: TemplateDetail;
  templateId: number;
  reportYear: number;
}) {
  const token = getAccessToken();
  const [addMode, setAddMode] = useState<"kpi_value" | "formula">("kpi_value");
  const [modalOpen, setModalOpen] = useState(false);
  const [kpiValueConfig, setKpiValueConfig] = useState<KpiInsertValue>({
    kpiId: kpis[0]?.kpi_id,
    fieldKey: "",
    subFieldKey: "",
    subFieldGroupFn: "SUM_ITEMS",
    asGroup: false,
    entryIndex: 0,
  });
  const [formulaKpiId, setFormulaKpiId] = useState<number>(kpis[0]?.kpi_id ?? 0);
  const [formulaEntryIndex, setFormulaEntryIndex] = useState(0);
  const [formulaExpression, setFormulaExpression] = useState("");
  const [evaluatedValue, setEvaluatedValue] = useState<string | number | null>(null);
  const [evaluateLoading, setEvaluateLoading] = useState(false);
  const [evaluateError, setEvaluateError] = useState<string | null>(null);

  const doInsertAtCursor = useCallback(
    (placeholder: string) => {
      insertAtCursor(placeholder, textAreaRef, content, onContentChange);
      setModalOpen(false);
    },
    [textAreaRef, content, onContentChange]
  );

  const handleEvaluate = useCallback(async () => {
    if (!token || detail.organization_id == null) return;
    setEvaluateError(null);
    setEvaluatedValue(null);
    setEvaluateLoading(true);
    try {
      const body: Record<string, unknown> = {
        type: addMode,
        organization_id: detail.organization_id,
        year: reportYear,
        entry_index: addMode === "kpi_value" ? (kpiValueConfig.entryIndex ?? 0) : formulaEntryIndex,
      };
      if (addMode === "kpi_value") {
        body.kpi_id = kpiValueConfig.kpiId ?? 0;
        body.field_key = kpiValueConfig.fieldKey || null;
        body.sub_field_key = kpiValueConfig.subFieldKey || null;
        body.sub_field_group_fn = kpiValueConfig.subFieldKey && kpiValueConfig.subFieldGroupFn ? kpiValueConfig.subFieldGroupFn : null;
        if (kpiValueConfig.asGroup) {
          setEvaluatedValue("(table – preview not available)");
          setEvaluateLoading(false);
          return;
        }
      } else {
        body.kpi_id = formulaKpiId;
        body.expression = formulaExpression.trim() || null;
      }
      const res = await api<{ value: string | number | null }>(
        `/reports/templates/${templateId}/evaluate-snippet`,
        { method: "POST", token, body: JSON.stringify(body) }
      );
      setEvaluatedValue(res.value ?? "(empty)");
    } catch (e) {
      setEvaluateError(e instanceof Error ? e.message : "Evaluate failed");
    } finally {
      setEvaluateLoading(false);
    }
  }, [addMode, token, detail.organization_id, reportYear, templateId, kpiValueConfig, formulaKpiId, formulaEntryIndex, formulaExpression]);

  const handleInsertFromModal = useCallback(() => {
    if (addMode === "formula") {
      if (!formulaExpression.trim()) return;
      doInsertAtCursor(buildFormulaPlaceholder(formulaKpiId, formulaEntryIndex, formulaExpression));
      return;
    }
    const kpiId = kpiValueConfig.kpiId ?? 0;
    const fieldKey = kpiValueConfig.fieldKey ?? "";
    const entryIdx = kpiValueConfig.entryIndex ?? 0;
    if (!fieldKey) return;
    if (kpiValueConfig.asGroup) {
      doInsertAtCursor(buildMultiLineTablePlaceholder(kpiId, fieldKey, entryIdx));
    } else if (kpiValueConfig.subFieldKey && kpiValueConfig.subFieldGroupFn) {
      doInsertAtCursor(buildSubFieldGroupPlaceholder(kpiId, fieldKey, kpiValueConfig.subFieldKey, kpiValueConfig.subFieldGroupFn, entryIdx));
    } else {
      doInsertAtCursor(buildKpiValuePlaceholder(kpiId, fieldKey, kpiValueConfig.subFieldKey || undefined, entryIdx));
    }
  }, [addMode, formulaExpression, formulaKpiId, formulaEntryIndex, kpiValueConfig, doInsertAtCursor]);

  const canInsert = addMode === "formula"
    ? !!formulaExpression.trim()
    : !!(kpiValueConfig.fieldKey && (!kpiValueConfig.subFieldKey || kpiValueConfig.subFieldGroupFn));

  return (
    <div className="form-group" style={{ margin: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <label style={{ fontSize: "0.85rem" }}>Add to text:</label>
        <select
          value={addMode}
          onChange={(e) => setAddMode(e.target.value as "kpi_value" | "formula")}
          style={{ padding: "0.35rem 0.5rem", fontSize: "0.85rem", minWidth: 140 }}
        >
          <option value="kpi_value">KPI Value</option>
          <option value="formula">Formula</option>
        </select>
        <button
          type="button"
          className="btn btn-primary"
          style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem" }}
          onClick={() => { setModalOpen(true); setEvaluatedValue(null); setEvaluateError(null); }}
        >
          Add
        </button>
      </div>
      <textarea
        ref={textAreaRef}
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        rows={4}
        placeholder="Write your text. Click Add to insert KPI values or formulas at the cursor."
        style={{ width: "100%", padding: "0.5rem" }}
      />
      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}
          onClick={() => setModalOpen(false)}
        >
          <div
            style={{
              background: "var(--surface, #fff)",
              borderRadius: 8,
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              maxWidth: 560,
              width: "90%",
              maxHeight: "90vh",
              overflow: "auto",
              padding: "1.25rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>
              {addMode === "kpi_value" ? "Add KPI value" : "Add formula"}
            </h3>
            {addMode === "kpi_value" ? (
              <ReportKpiInsertControls
                mode="bound"
                kpis={kpis}
                fieldsByKpiId={fieldsByKpiId}
                value={kpiValueConfig}
                onChange={(patch) => setKpiValueConfig((prev) => ({ ...prev, ...patch }))}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
                  <div style={{ minWidth: 160 }}>
                    <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Context KPI</label>
                    <select
                      value={formulaKpiId || ""}
                      onChange={(e) => setFormulaKpiId(Number(e.target.value))}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                    >
                      {kpis.map((k) => (
                        <option key={k.kpi_id} value={k.kpi_id}>{k.kpi_name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ minWidth: 80 }}>
                    <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Entry index</label>
                    <input
                      type="number"
                      min={0}
                      value={formulaEntryIndex}
                      onChange={(e) => setFormulaEntryIndex(parseInt(e.target.value, 10) || 0)}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Formula expression</label>
                  <input
                    type="text"
                    value={formulaExpression}
                    onChange={(e) => setFormulaExpression(e.target.value)}
                    placeholder="e.g. total_count + SUM_ITEMS(students, score)"
                    style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                  />
                </div>
                {detail.organization_id != null && (
                  <ReportFormulaBuilder
                    formulaValue={formulaExpression}
                    onInsert={(text) => setFormulaExpression((prev) => prev + text)}
                    fields={(fieldsByKpiId[formulaKpiId] || []).filter((f) => f.field_type === "number" || f.field_type === "multi_line_items")}
                    organizationId={detail.organization_id}
                    currentKpiId={formulaKpiId || undefined}
                  />
                )}
              </div>
            )}
            <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--bg-muted, #f5f5f5)", borderRadius: 6, fontSize: "0.9rem" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>Evaluated value</div>
              {evaluateError && <div style={{ color: "var(--error, #c00)" }}>{evaluateError}</div>}
              {evaluateLoading && <div style={{ color: "var(--muted)" }}>Evaluating…</div>}
              {!evaluateLoading && evaluatedValue !== null && <div style={{ fontFamily: "monospace" }}>{String(evaluatedValue)}</div>}
              {!evaluateLoading && evaluatedValue === null && !evaluateError && <div style={{ color: "var(--muted)" }}>Click Evaluate to see the value that will appear in the report.</div>}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={handleEvaluate} disabled={evaluateLoading}>
                Evaluate
              </button>
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleInsertFromModal} disabled={!canInsert}>
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BlockCard({
  block,
  blockId,
  index,
  total,
  detail,
  templateId,
  reportYear,
  fieldsByKpiId,
  loadFieldsForKpis,
  isMinimized,
  onToggleMinimize,
  onUpdate,
  onRemove,
  onMoveDown,
  onMoveUp,
}: {
  block: ReportBlock;
  blockId: string;
  index: number;
  total: number;
  detail: TemplateDetail;
  templateId: number;
  reportYear: number;
  fieldsByKpiId: Record<number, FieldOption[]>;
  loadFieldsForKpis: (kpiIds: number[]) => void;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onUpdate: (u: Partial<ReportBlock>) => void;
  onRemove: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
}) {
  const type = block.type;
  const kpis = detail.kpis_from_domains;
  const domains = detail.attached_domains;

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [customNamesModalOpen, setCustomNamesModalOpen] = useState(false);
  const [localFieldDisplayNames, setLocalFieldDisplayNames] = useState<Record<string, string>>({});
  const [localSubFieldDisplayNames, setLocalSubFieldDisplayNames] = useState<Record<string, Record<string, string>>>({});
  const [localColumnAlign, setLocalColumnAlign] = useState<Record<string, CellAlign>>({});
  const [customNamesActiveTab, setCustomNamesActiveTab] = useState<string>("fields");

  const [simpleTableFormulaModal, setSimpleTableFormulaModal] = useState<{ rowIdx: number; cellIdx: number } | null>(null);
  const [simpleTableFormulaDraft, setSimpleTableFormulaDraft] = useState<{ kpiId: number; entryIndex: number; formula: string } | null>(null);
  const [simpleTableEvalValue, setSimpleTableEvalValue] = useState<string | number | null>(null);
  const [simpleTableEvalLoading, setSimpleTableEvalLoading] = useState(false);
  const [simpleTableEvalError, setSimpleTableEvalError] = useState<string | null>(null);
  const token = getAccessToken();
  const handleSimpleTableEvaluate = useCallback(async () => {
    if (!simpleTableFormulaDraft || !token || detail.organization_id == null) return;
    setSimpleTableEvalError(null);
    setSimpleTableEvalValue(null);
    setSimpleTableEvalLoading(true);
    try {
      const res = await api<{ value: string | number | null }>(
        `/reports/templates/${templateId}/evaluate-snippet`,
        {
          method: "POST",
          token,
          body: JSON.stringify({
            type: "formula",
            organization_id: detail.organization_id,
            year: reportYear,
            entry_index: simpleTableFormulaDraft.entryIndex,
            kpi_id: simpleTableFormulaDraft.kpiId,
            expression: simpleTableFormulaDraft.formula.trim() || null,
          }),
        }
      );
      setSimpleTableEvalValue(res.value ?? "(empty)");
    } catch (e) {
      setSimpleTableEvalError(e instanceof Error ? e.message : "Evaluate failed");
    } finally {
      setSimpleTableEvalLoading(false);
    }
  }, [simpleTableFormulaDraft, templateId, detail.organization_id, reportYear, token]);

  useEffect(() => {
    if (type === "text") {
      const toLoad = detail.kpis_from_domains.map((k) => k.kpi_id);
      if (toLoad.length) loadFieldsForKpis(toLoad);
    } else if (type === "kpi_table" || type === "kpi_grid" || type === "kpi_list") {
      const ids = (block as { kpiIds?: number[] }).kpiIds || [];
      const toLoad = ids.length ? ids : detail.kpis_from_domains.map((k) => k.kpi_id);
      if (toLoad.length) loadFieldsForKpis(toLoad);
    } else if (type === "simple_table") {
      const toLoad = detail.kpis_from_domains.map((k) => k.kpi_id);
      if (toLoad.length) loadFieldsForKpis(toLoad);
    } else if (type === "single_value" || type === "kpi_multi_table") {
      const kpiId = (block as { kpiId?: number }).kpiId;
      if (kpiId) loadFieldsForKpis([kpiId]);
    }
  }, [type, (block as { kpiIds?: number[] }).kpiIds, (block as { kpiId?: number }).kpiId, detail.kpis_from_domains, loadFieldsForKpis]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0.75rem", background: "var(--bg-subtle)", borderBottom: isMinimized ? "none" : "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
          <button
            type="button"
            onClick={onToggleMinimize}
            style={{
              padding: "0.2rem",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: "0.85rem",
              color: "var(--muted)",
              flexShrink: 0,
            }}
            title={isMinimized ? "Expand block" : "Minimize block"}
          >
            {isMinimized ? "▶" : "▼"}
          </button>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{BLOCK_LABELS[type] || type}</span>
        </div>
        <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
          <button type="button" className="btn" style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem" }} onClick={onMoveUp} disabled={index === 0} title="Move up">
            ↑
          </button>
          <button type="button" className="btn" style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem" }} onClick={onMoveDown} disabled={index >= total - 1} title="Move down">
            ↓
          </button>
          <button type="button" className="btn" style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem", color: "var(--error)" }} onClick={onRemove} title="Remove">
            ×
          </button>
        </div>
      </div>
      {!isMinimized && (
      <div style={{ padding: "0.75rem 1rem" }}>
        {type === "title" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={(block as { useTemplateName?: boolean }).useTemplateName !== false}
                onChange={(e) => onUpdate({ useTemplateName: e.target.checked })}
              />
              Use report name as title
            </label>
            <div className="form-group" style={{ margin: 0, flex: "1 1 200px" }}>
              <label style={{ fontSize: "0.85rem" }}>Or custom title</label>
              <input
                type="text"
                value={(block as { customText?: string }).customText || ""}
                onChange={(e) => onUpdate({ customText: e.target.value })}
                placeholder="Leave empty to use report name"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}
        {type === "section_heading" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <div className="form-group" style={{ margin: 0, flex: "1 1 200px" }}>
              <label style={{ fontSize: "0.85rem" }}>Heading text</label>
              <input
                type="text"
                value={(block as { text?: string }).text || ""}
                onChange={(e) => onUpdate({ text: e.target.value })}
                placeholder="Section title"
                style={{ width: "100%" }}
              />
            </div>
            <div className="form-group" style={{ margin: 0, width: 100 }}>
              <label style={{ fontSize: "0.85rem" }}>Level</label>
              <select
                value={(block as { level?: number }).level ?? 2}
                onChange={(e) => onUpdate({ level: Number(e.target.value) })}
                style={{ width: "100%" }}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>H{n}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {type === "spacer" && (
          <div className="form-group" style={{ margin: 0, maxWidth: 200 }}>
            <label style={{ fontSize: "0.85rem" }}>Size</label>
            <select
              value={(block as { size?: string }).size || "medium"}
              onChange={(e) => onUpdate({ size: e.target.value as "small" | "medium" | "large" })}
              style={{ width: "100%" }}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        )}
        {type === "text" && (
          <TextBlockWithKpiInsert
            content={(block as { content?: string }).content || ""}
            onContentChange={(content) => onUpdate({ content })}
            textAreaRef={textAreaRef}
            kpis={kpis}
            fieldsByKpiId={fieldsByKpiId}
            detail={detail}
            templateId={templateId}
            reportYear={reportYear}
          />
        )}
        {(type === "domain_list" || type === "domain_categories" || type === "domain_kpis") && (
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: "0.85rem" }}>Limit to domains (all checked = all domains)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
              {domains.map((d) => {
                const ids = (block as { domainIds?: number[] }).domainIds || [];
                const checked = ids.length === 0 || ids.includes(d.id);
                return (
                  <label key={d.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const prev = (block as { domainIds?: number[] }).domainIds || [];
                        const next = e.target.checked
                          ? prev.length === 0 ? [] : [...prev, d.id]
                          : prev.length === 0 ? domains.map((x) => x.id).filter((id) => id !== d.id) : prev.filter((id) => id !== d.id);
                        onUpdate({ domainIds: next });
                      }}
                    />
                    {d.name}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {(type === "kpi_table" || type === "kpi_grid" || type === "kpi_list") && (
          <>
            <div className="form-group" style={{ margin: 0, marginBottom: "0.5rem" }}>
              <label style={{ fontSize: "0.85rem" }}>KPIs (empty = all)</label>
              <select
                multiple
                value={(block as { kpiIds?: number[] }).kpiIds?.map(String) || []}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, (o) => Number(o.value));
                  onUpdate({ kpiIds: selected });
                }}
                style={{ width: "100%", minHeight: 80 }}
              >
                {kpis.map((k) => (
                  <option key={k.kpi_id} value={k.kpi_id}>{k.kpi_name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Fields (empty = all)</label>
              <select
                multiple
                value={(block as { fieldKeys?: string[] }).fieldKeys || []}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                  onUpdate({ fieldKeys: selected });
                }}
                style={{ width: "100%", minHeight: 80 }}
              >
                {(() => {
                  const kpiIdsBlock = (block as { kpiIds?: number[] }).kpiIds || [];
                  const kids = kpiIdsBlock.length ? kpiIdsBlock : kpis.map((k) => k.kpi_id);
                  const fieldList = kids.flatMap((kid) => (fieldsByKpiId[kid] || []).map((f) => ({ ...f, kpiId: kid })));
                  const seen = new Set<string>();
                  return fieldList.filter((f) => {
                    const key = f.key;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  }).map((f) => (
                    <option key={`${f.kpiId}-${f.key}`} value={f.key}>
                      {kpiIdsBlock.length > 1 ? `${kpis.find((k) => k.kpi_id === f.kpiId)?.kpi_name || ""} – ` : ""}{f.name} ({f.key})
                    </option>
                  ));
                })()}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0, marginTop: "0.5rem" }}>
              <label style={{ fontSize: "0.85rem" }}>Data period</label>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0 0.35rem 0" }}>
                Choose which time dimension data to show: latest entry only, all periods (e.g. Q1–Q4), or a single period.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                {(() => {
                  const kpiIdsBlock = (block as { kpiIds?: number[] }).kpiIds || [];
                  const blockKpis = kpiIdsBlock.length
                    ? kpis.filter((k) => kpiIdsBlock.includes(k.kpi_id))
                    : kpis;
                  const hasSubPeriods = blockKpis.some(
                    (k) => k.time_dimension && k.time_dimension !== "yearly" && k.time_dimension !== "multi_year"
                  );
                  const periodKeysSet = new Set<string>();
                  blockKpis.forEach((k) => {
                    if (k.time_dimension && k.time_dimension !== "yearly" && k.time_dimension !== "multi_year") {
                      expectedPeriodsForDimension(k.time_dimension).forEach((pk) => periodKeysSet.add(pk));
                    }
                  });
                  const periodOptionsForBlock = Array.from(periodKeysSet).map((value) => ({
                    value,
                    label: REPORT_PERIOD_OPTIONS.find((o) => o.value === value)?.label ?? (value || "Full year"),
                  })).sort((a, b) => {
                    const order = ["", "H1", "H2", "Q1", "Q2", "Q3", "Q4", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
                    return order.indexOf(a.value) - order.indexOf(b.value);
                  });
                  const effectiveMode = !hasSubPeriods && (block as { timeDimensionMode?: string }).timeDimensionMode === "single_period"
                    ? "latest"
                    : ((block as { timeDimensionMode?: string }).timeDimensionMode ?? "latest");
                  return (
                    <>
                      <select
                        value={effectiveMode}
                        onChange={(e) => {
                          const v = e.target.value as "latest" | "single_period" | "all_periods";
                          onUpdate({ timeDimensionMode: v, ...(v !== "single_period" ? { periodKey: "" } : {}) });
                        }}
                        style={{ minWidth: 180 }}
                      >
                        <option value="latest">Use latest entry</option>
                        <option value="all_periods">All periods (consolidated)</option>
                        {hasSubPeriods && <option value="single_period">Single period</option>}
                      </select>
                      {(block as { timeDimensionMode?: string }).timeDimensionMode === "single_period" && (
                        <select
                          value={(block as { periodKey?: string }).periodKey ?? ""}
                          onChange={(e) => onUpdate({ periodKey: e.target.value })}
                          style={{ minWidth: 140 }}
                        >
                          {periodOptionsForBlock.map((o) => (
                            <option key={o.value || "full"} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setLocalFieldDisplayNames((block as { fieldDisplayNames?: Record<string, string> }).fieldDisplayNames ?? {});
                  setLocalSubFieldDisplayNames((block as { subFieldDisplayNames?: Record<string, Record<string, string>> }).subFieldDisplayNames ?? {});
                  setLocalColumnAlign((block as { columnAlign?: Record<string, CellAlign> }).columnAlign ?? {});
                  setCustomNamesActiveTab("fields");
                  setCustomNamesModalOpen(true);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--primary, #0066cc)",
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: "0.9rem",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}
              >
                <span style={{ opacity: 0.9 }}>✎</span> Custom names…
              </button>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Override labels for fields and sub-fields in the report</span>
            </div>
            {(() => {
              const kpiIdsBlock = (block as { kpiIds?: number[] }).kpiIds || [];
              const fieldKeysBlock = (block as { fieldKeys?: string[] }).fieldKeys || [];
              const multiLineSubFieldKeys = (block as { multiLineSubFieldKeys?: Record<string, string[]> }).multiLineSubFieldKeys ?? {};
              const showMultiLineAsTable = (block as { showMultiLineAsTable?: boolean }).showMultiLineAsTable !== false;
              const kids = kpiIdsBlock.length ? kpiIdsBlock : kpis.map((k) => k.kpi_id);
              const allFields = kids.flatMap((kid) => (fieldsByKpiId[kid] || []).map((f) => ({ ...f, kpiId: kid })));
              const seenKeys = new Set<string>();
              const multiLineFields = allFields.filter((f) => {
                if (seenKeys.has(f.key)) return false;
                if (f.field_type !== "multi_line_items" || !(f.sub_fields?.length)) return false;
                seenKeys.add(f.key);
                return fieldKeysBlock.length === 0 || fieldKeysBlock.includes(f.key);
              });
              if (multiLineFields.length === 0) return null;
              return (
                <div className="form-group" style={{ margin: 0, marginTop: "0.5rem" }}>
                  <label style={{ fontSize: "0.85rem" }}>Sub-fields to show (multi-line fields; empty = all)</label>
                  <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0 0.5rem 0" }}>
                    Choose which sub-field columns to include. Use <strong>Custom names…</strong> above to set display labels.
                    {showMultiLineAsTable
                      ? " Multi-line values are shown as a nested table inside each cell."
                      : " Multi-line values are shown as stacked labels and values inside each cell (no nested table)."}
                  </p>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", marginBottom: "0.35rem" }}>
                    <input
                      type="checkbox"
                      checked={showMultiLineAsTable}
                      onChange={(e) => onUpdate({ showMultiLineAsTable: e.target.checked })}
                    />
                    Show multi-line items as nested table
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
                    {multiLineFields.map((f) => {
                      const selected = multiLineSubFieldKeys[f.key] ?? [];
                      const isChecked = (subKey: string) => selected.length === 0 || selected.includes(subKey);
                      const toggleSub = (subKey: string, checked: boolean) => {
                        const next = { ...multiLineSubFieldKeys };
                        const list = next[f.key] ?? [];
                        const allSubKeys = (f.sub_fields || []).map((s) => s.key);
                        if (checked) {
                          next[f.key] = list.length === 0 ? allSubKeys : list.includes(subKey) ? list : [...list, subKey];
                        } else {
                          next[f.key] = list.length === 0
                            ? allSubKeys.filter((k) => k !== subKey)
                            : list.filter((k) => k !== subKey);
                        }
                        onUpdate({ ...block, multiLineSubFieldKeys: next });
                      };
                      const selectAll = () => {
                        const next = { ...multiLineSubFieldKeys, [f.key]: (f.sub_fields || []).map((s) => s.key) };
                        onUpdate({ ...block, multiLineSubFieldKeys: next });
                      };
                      const selectNone = () => {
                        const next = { ...multiLineSubFieldKeys, [f.key]: [] };
                        onUpdate({ ...block, multiLineSubFieldKeys: next });
                      };
                      return (
                        <div key={f.key} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", background: "var(--bg-subtle)" }}>
                          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>{f.name} ({f.key})</div>
                          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
                            <button type="button" onClick={selectAll} style={{ fontSize: "0.75rem", padding: "0.15rem 0.4rem" }}>All</button>
                            <button type="button" onClick={selectNone} style={{ fontSize: "0.75rem", padding: "0.15rem 0.4rem" }}>None (show all)</button>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                            {(f.sub_fields || []).map((sf) => (
                              <label key={sf.key} style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked(sf.key)}
                                  onChange={() => toggleSub(sf.key, !isChecked(sf.key))}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                {sf.name || sf.key}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {type === "kpi_table" && (
              <div style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={(block as { oneTablePerKpi?: boolean }).oneTablePerKpi !== false}
                    onChange={(e) => onUpdate({ oneTablePerKpi: e.target.checked })}
                  />
                  One table per KPI
                </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={(block as { showTableHeading?: boolean }).showTableHeading !== false}
                onChange={(e) => onUpdate({ showTableHeading: e.target.checked })}
              />
              Show KPI heading above table
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }} title="When unchecked, the field name (e.g. Grant List) is hidden for multi-line fields; only the inner table with sub-fields remains.">
              <input
                type="checkbox"
                checked={(block as { showMultiLineFieldLabel?: boolean }).showMultiLineFieldLabel !== false}
                onChange={(e) => onUpdate({ showMultiLineFieldLabel: e.target.checked })}
              />
              Show multi-line field name (parent label)
            </label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Fields:</span>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.9rem" }}>
                    <input
                      type="radio"
                      name={`fieldsLayout-${blockId}`}
                      checked={((block as { fieldsLayout?: "columns" | "rows" }).fieldsLayout ?? "columns") === "columns"}
                      onChange={() => onUpdate({ fieldsLayout: "columns" })}
                    />
                    As columns
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.9rem" }}>
                    <input
                      type="radio"
                      name={`fieldsLayout-${blockId}`}
                      checked={((block as { fieldsLayout?: "columns" | "rows" }).fieldsLayout ?? "columns") === "rows"}
                      onChange={() => onUpdate({ fieldsLayout: "rows" })}
                    />
                    As rows
                  </label>
                </div>
              </div>
            )}
            {customNamesModalOpen && (() => {
              const kpiIdsBlock = (block as { kpiIds?: number[] }).kpiIds || [];
              const fieldKeysBlock = (block as { fieldKeys?: string[] }).fieldKeys || [];
              const kids = kpiIdsBlock.length ? kpiIdsBlock : kpis.map((k) => k.kpi_id);
              const allFields = kids.flatMap((kid) => (fieldsByKpiId[kid] || []).map((f) => ({ ...f, kpiId: kid })));
              const seenKeys = new Set<string>();
              const selectedFields = allFields.filter((f) => {
                if (seenKeys.has(f.key)) return false;
                seenKeys.add(f.key);
                return fieldKeysBlock.length === 0 || fieldKeysBlock.includes(f.key);
              });
              const seenKeys2 = new Set<string>();
              const multiLineFields = allFields.filter((f) => {
                if (seenKeys2.has(f.key)) return false;
                if (f.field_type !== "multi_line_items" || !(f.sub_fields?.length)) return false;
                seenKeys2.add(f.key);
                return fieldKeysBlock.length === 0 || fieldKeysBlock.includes(f.key);
              });
              return (
                <div
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 1000,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(0,0,0,0.4)",
                  }}
                  onClick={() => setCustomNamesModalOpen(false)}
                >
                  <div
                    style={{
                      background: "var(--surface, #fff)",
                      borderRadius: 8,
                      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                      maxWidth: 720,
                      width: "92%",
                      maxHeight: "85vh",
                      overflow: "auto",
                      padding: "1.25rem",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                      <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Custom names in report</h3>
                      <button type="button" className="btn" style={{ padding: "0.25rem 0.5rem" }} onClick={() => setCustomNamesModalOpen(false)} aria-label="Close">×</button>
                    </div>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 1rem 0" }}>
                      Override the labels shown for fields and sub-fields. Leave display name empty to use the default.
                      {type === "kpi_table" && " For KPI table, set alignment per column in the Fields tab."}
                    </p>
                    <div>
                      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: "0.75rem", overflowX: "auto" }}>
                        <button
                          type="button"
                          onClick={() => setCustomNamesActiveTab("fields")}
                          style={{
                            padding: "0.35rem 0.75rem",
                            border: "none",
                            borderBottom: customNamesActiveTab === "fields" ? "2px solid var(--primary, #0066cc)" : "2px solid transparent",
                            background: "none",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            fontWeight: customNamesActiveTab === "fields" ? 600 : 500,
                            color: customNamesActiveTab === "fields" ? "var(--primary, #0066cc)" : "inherit",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Fields
                        </button>
                        {multiLineFields.map((f) => {
                          const tabKey = `multi:${f.key}`;
                          return (
                            <button
                              key={tabKey}
                              type="button"
                              onClick={() => setCustomNamesActiveTab(tabKey)}
                              style={{
                                padding: "0.35rem 0.75rem",
                                border: "none",
                                borderBottom: customNamesActiveTab === tabKey ? "2px solid var(--primary, #0066cc)" : "2px solid transparent",
                                background: "none",
                                cursor: "pointer",
                                fontSize: "0.85rem",
                                fontWeight: customNamesActiveTab === tabKey ? 600 : 500,
                                color: customNamesActiveTab === tabKey ? "var(--primary, #0066cc)" : "inherit",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {f.name || f.key}
                            </button>
                          );
                        })}
                      </div>
                      <div>
                        {customNamesActiveTab === "fields" && (
                          <>
                            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>Fields</h4>
                            {selectedFields.length === 0 ? (
                              <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>Select KPIs and fields above first.</p>
                            ) : (
                              <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                                  <thead>
                                    <tr style={{ background: "var(--bg-subtle)" }}>
                                      <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--border)" }}>Field</th>
                                      <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--border)", width: "50%" }}>Display name</th>
                                      {type === "kpi_table" && (
                                        <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--border)" }}>Alignment</th>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedFields.map((f) => (
                                      <tr key={f.key} style={{ borderBottom: "1px solid var(--border)" }}>
                                        <td style={{ padding: "0.4rem 0.6rem", verticalAlign: "middle" }}>{f.name} <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>({f.key})</span></td>
                                        <td style={{ padding: "0.35rem 0.6rem" }}>
                                          <input
                                            type="text"
                                            value={localFieldDisplayNames[f.key] ?? ""}
                                            onChange={(e) => setLocalFieldDisplayNames((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                            placeholder={f.name || f.key}
                                            style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                                          />
                                        </td>
                                        {type === "kpi_table" && (
                                          <td style={{ padding: "0.35rem 0.6rem", verticalAlign: "middle" }}>
                                            <select
                                              value={localColumnAlign[f.key] ?? "left"}
                                              onChange={(e) => setLocalColumnAlign((prev) => ({ ...prev, [f.key]: e.target.value as CellAlign }))}
                                              style={{ padding: "0.3rem 0.4rem", fontSize: "0.85rem", minWidth: 90 }}
                                            >
                                              <option value="left">Left</option>
                                              <option value="center">Center</option>
                                              <option value="right">Right</option>
                                              <option value="justify">Justify</option>
                                            </select>
                                          </td>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )}
                        {customNamesActiveTab !== "fields" && customNamesActiveTab.startsWith("multi:") && (() => {
                          const targetKey = customNamesActiveTab.slice("multi:".length);
                          const mf = multiLineFields.find((f) => f.key === targetKey);
                          if (!mf) {
                            return (
                              <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>
                                No multi-line field selected. Choose another tab.
                              </p>
                            );
                          }
                          return (
                            <>
                              <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>
                                {mf.name || mf.key} <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>({mf.key})</span>
                              </h4>
                              <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                                  <thead>
                                    <tr style={{ background: "var(--surface)" }}>
                                      <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" }}>Sub-field</th>
                                      <th style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)", width: "55%" }}>Display name</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(mf.sub_fields || []).map((sf) => (
                                      <tr key={sf.key} style={{ borderBottom: "1px solid var(--border)" }}>
                                        <td style={{ padding: "0.3rem 0.5rem", verticalAlign: "middle" }}>{sf.name || sf.key}</td>
                                        <td style={{ padding: "0.25rem 0.5rem" }}>
                                          <input
                                            type="text"
                                            value={localSubFieldDisplayNames[mf.key]?.[sf.key] ?? ""}
                                            onChange={(e) => {
                                              const nextInner = { ...(localSubFieldDisplayNames[mf.key] ?? {}), [sf.key]: e.target.value };
                                              setLocalSubFieldDisplayNames((prev) => ({ ...prev, [mf.key]: nextInner }));
                                            }}
                                            placeholder={sf.name || sf.key}
                                            style={{ width: "100%", padding: "0.3rem 0.4rem", fontSize: "0.85rem" }}
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", justifyContent: "flex-end" }}>
                      <button type="button" className="btn" onClick={() => setCustomNamesModalOpen(false)}>Cancel</button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          const trimRecord = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v ?? "").trim()]));
                          const trimNested = (n: Record<string, Record<string, string>>) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, trimRecord(v ?? {})]));
                          const payload: Partial<ReportBlock> = {
                            fieldDisplayNames: trimRecord(localFieldDisplayNames),
                            subFieldDisplayNames: trimNested(localSubFieldDisplayNames),
                          };
                          if (type === "kpi_table") {
                            (payload as { columnAlign?: Record<string, CellAlign> }).columnAlign = localColumnAlign;
                          }
                          onUpdate(payload);
                          setCustomNamesModalOpen(false);
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
        {type === "simple_table" && (() => {
          const rows: SimpleTableRow[] = (block as { rows?: SimpleTableRow[] }).rows?.length
            ? (block as { rows?: SimpleTableRow[] }).rows!
            : [DEFAULT_SIMPLE_TABLE_ROW];
          const setRows = (next: SimpleTableRow[]) => onUpdate({ rows: next });
          const addRow = () => setRows([...rows, { cells: [{ type: "text", content: "" }] }]);
          const removeRow = (rowIdx: number) => setRows(rows.filter((_, i) => i !== rowIdx));
          const moveRow = (rowIdx: number, dir: "up" | "down") => {
            const newIdx = dir === "up" ? rowIdx - 1 : rowIdx + 1;
            if (newIdx < 0 || newIdx >= rows.length) return;
            const next = [...rows];
            const [moved] = next.splice(rowIdx, 1);
            next.splice(newIdx, 0, moved);
            setRows(next);
          };
          const addCell = (rowIdx: number) => {
            const next = rows.map((r, i) =>
              i === rowIdx ? { cells: [...r.cells, { type: "text" as const, content: "" }] } : r
            );
            setRows(next);
          };
          const removeCell = (rowIdx: number, cellIdx: number) => {
            const next = rows.map((r, i) =>
              i === rowIdx ? { cells: r.cells.filter((_, j) => j !== cellIdx) } : r
            );
            setRows(next.filter((r) => r.cells.length > 0));
          };
          const moveCell = (rowIdx: number, fromIdx: number, toIdx: number) => {
            if (toIdx < 0) return;
            const next = rows.map((r, i) => {
              if (i !== rowIdx) return r;
              const cells = [...r.cells];
              if (toIdx >= cells.length) return r;
              const [moved] = cells.splice(fromIdx, 1);
              cells.splice(toIdx, 0, moved);
              return { cells };
            });
            setRows(next);
          };
          const updateCell = (rowIdx: number, cellIdx: number, patch: Partial<SimpleTableCell>) => {
            const next = rows.map((r, i) =>
              i === rowIdx
                ? { cells: r.cells.map((c, j) => (j === cellIdx ? { ...c, ...patch } as SimpleTableCell : c)) }
                : r
            );
            setRows(next);
          };
          return (
            <>
            <div style={{ marginTop: "0.5rem" }}>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.5rem 0" }}>
                Add rows and columns. Each cell: <strong>Text</strong>, <strong>KPI value</strong> (for multi-line fields pick a sub-field and group function: SUM, AVG, COUNT, MIN, MAX), <strong>Group (table)</strong> to show all sub-fields as a table, or <strong>Formula</strong>.
              </p>
              {rows.map((row, rowIdx) => (
                <div key={rowIdx} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", marginBottom: "0.5rem", background: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap", gap: "0.25rem" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Row {rowIdx + 1}</span>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem" }}
                        onClick={() => moveRow(rowIdx, "up")}
                        disabled={rowIdx === 0}
                        title="Move row up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem" }}
                        onClick={() => moveRow(rowIdx, "down")}
                        disabled={rowIdx >= rows.length - 1}
                        title="Move row down"
                      >
                        ↓
                      </button>
                      <button type="button" className="btn" style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem" }} onClick={() => addCell(rowIdx)}>+ Column</button>
                      <button type="button" className="btn" style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem", color: "var(--error)" }} onClick={() => removeRow(rowIdx)} disabled={rows.length <= 1}>− Row</button>
                    </div>
                  </div>
                  {(row.cells || []).map((cell, cellIdx) => (
                    <div key={cellIdx} style={{ marginBottom: "0.5rem", padding: "0.35rem", background: "var(--bg-muted, #f5f5f5)", borderRadius: 4 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "flex-start" }}>
                        <select
                          value={cell.type}
                          onChange={(e) => {
                            const t = e.target.value as "text" | "kpi" | "formula";
                            if (t === "text") updateCell(rowIdx, cellIdx, { type: "text", content: (cell as { content?: string }).content ?? "" });
                            else if (t === "kpi") updateCell(rowIdx, cellIdx, { type: "kpi", kpiId: kpis[0]?.kpi_id ?? 0, fieldKey: "", subFieldKey: "", subFieldGroupFn: "SUM_ITEMS", entryIndex: 0, asGroup: false });
                            else if (t === "formula") {
                              const kpiId = kpis[0]?.kpi_id ?? 0;
                              updateCell(rowIdx, cellIdx, { type: "formula", kpiId, fieldKey: "", entryIndex: 0, formula: "" });
                              setSimpleTableFormulaModal({ rowIdx, cellIdx });
                              setSimpleTableFormulaDraft({ kpiId, entryIndex: 0, formula: "" });
                              setSimpleTableEvalValue(null);
                              setSimpleTableEvalError(null);
                            }
                          }}
                          style={{ minWidth: 100, fontSize: "0.85rem" }}
                        >
                          <option value="text">Text</option>
                          <option value="kpi">KPI value</option>
                          <option value="formula">Formula</option>
                        </select>
                        <select
                          value={(cell as { align?: CellAlign }).align ?? "left"}
                          onChange={(e) => updateCell(rowIdx, cellIdx, { align: e.target.value as CellAlign })}
                          title="Text alignment"
                          style={{ width: 90, padding: "0.25rem 0.4rem", fontSize: "0.8rem" }}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                          <option value="justify">Justify</option>
                        </select>
                        {cell.type === "text" && (
                          <input
                            type="text"
                            value={(cell as { content?: string }).content ?? ""}
                            onChange={(e) => updateCell(rowIdx, cellIdx, { content: e.target.value })}
                            placeholder="Static text"
                            style={{ flex: 1, minWidth: 120, padding: "0.25rem 0.4rem", fontSize: "0.85rem" }}
                          />
                        )}
                        {(cell.type === "kpi" || cell.type === "formula") && (
                          <>
                            {cell.type === "kpi" && (
                              <ReportKpiInsertControls
                                mode="bound"
                                kpis={kpis}
                                fieldsByKpiId={fieldsByKpiId}
                                value={{
                                  kpiId: (cell as { kpiId?: number }).kpiId,
                                  fieldKey: (cell as { fieldKey?: string }).fieldKey,
                                  subFieldKey: (cell as { subFieldKey?: string }).subFieldKey,
                                  subFieldGroupFn: (cell as { subFieldGroupFn?: string }).subFieldGroupFn,
                                  asGroup: (cell as { asGroup?: boolean }).asGroup,
                                  entryIndex: (cell as { entryIndex?: number }).entryIndex,
                                }}
                                onChange={(patch) => updateCell(rowIdx, cellIdx, patch)}
                              />
                            )}
                            {cell.type === "formula" && (
                              <>
                                <span style={{ fontSize: "0.85rem", color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {(cell as { formula?: string }).formula?.trim() ? (cell as { formula?: string }).formula : "Empty formula"}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                                  onClick={() => {
                                    const c = cell as { kpiId?: number; entryIndex?: number; formula?: string };
                                    setSimpleTableFormulaModal({ rowIdx, cellIdx });
                                    setSimpleTableFormulaDraft({ kpiId: c.kpiId ?? kpis[0]?.kpi_id ?? 0, entryIndex: c.entryIndex ?? 0, formula: c.formula ?? "" });
                                    setSimpleTableEvalValue(null);
                                    setSimpleTableEvalError(null);
                                  }}
                                >
                                  Edit formula…
                                </button>
                              </>
                            )}
                          </>
                        )}
                        <div style={{ display: "flex", gap: "0.2rem", marginLeft: "auto" }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "0.2rem 0.35rem", fontSize: "0.8rem" }}
                            onClick={() => moveCell(rowIdx, cellIdx, cellIdx - 1)}
                            disabled={cellIdx === 0}
                            title="Move column left"
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "0.2rem 0.35rem", fontSize: "0.8rem" }}
                            onClick={() => moveCell(rowIdx, cellIdx, cellIdx + 1)}
                            disabled={cellIdx >= (row.cells?.length || 0) - 1}
                            title="Move column right"
                          >
                            →
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem", color: "var(--error)" }}
                            onClick={() => removeCell(rowIdx, cellIdx)}
                            title="Remove column"
                          >
                            −
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <button type="button" className="btn" style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem" }} onClick={addRow}>+ Add row</button>
            </div>
            {simpleTableFormulaModal !== null && simpleTableFormulaDraft !== null && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 1000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.4)",
                }}
                onClick={() => { setSimpleTableFormulaModal(null); setSimpleTableFormulaDraft(null); setSimpleTableEvalValue(null); setSimpleTableEvalError(null); }}
              >
                <div
                  style={{
                    background: "var(--surface, #fff)",
                    borderRadius: 8,
                    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                    maxWidth: 560,
                    width: "90%",
                    maxHeight: "90vh",
                    overflow: "auto",
                    padding: "1.25rem",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Edit formula</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
                      <div style={{ minWidth: 160 }}>
                        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Context KPI</label>
                        <select
                          value={simpleTableFormulaDraft.kpiId || ""}
                          onChange={(e) => setSimpleTableFormulaDraft((prev) => prev ? { ...prev, kpiId: Number(e.target.value) } : null)}
                          style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                        >
                          {kpis.map((k) => (
                            <option key={k.kpi_id} value={k.kpi_id}>{k.kpi_name}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ minWidth: 80 }}>
                        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Entry index</label>
                        <input
                          type="number"
                          min={0}
                          value={simpleTableFormulaDraft.entryIndex}
                          onChange={(e) => setSimpleTableFormulaDraft((prev) => prev ? { ...prev, entryIndex: parseInt(e.target.value, 10) || 0 } : null)}
                          style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Formula expression</label>
                      <input
                        type="text"
                        value={simpleTableFormulaDraft.formula}
                        onChange={(e) => setSimpleTableFormulaDraft((prev) => prev ? { ...prev, formula: e.target.value } : null)}
                        placeholder="e.g. total_count + SUM_ITEMS(students, score)"
                        style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                      />
                    </div>
                    {detail?.organization_id != null && (
                      <ReportFormulaBuilder
                        formulaValue={simpleTableFormulaDraft.formula}
                        onInsert={(text) => setSimpleTableFormulaDraft((prev) => prev ? { ...prev, formula: prev.formula + text } : null)}
                        fields={(fieldsByKpiId[simpleTableFormulaDraft.kpiId] || []).filter((f) => f.field_type === "number" || f.field_type === "multi_line_items")}
                        organizationId={detail.organization_id}
                        currentKpiId={simpleTableFormulaDraft.kpiId || undefined}
                      />
                    )}
                  </div>
                  <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--bg-muted, #f5f5f5)", borderRadius: 6, fontSize: "0.9rem" }}>
                    <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>Evaluated value</div>
                    {simpleTableEvalError && <div style={{ color: "var(--error, #c00)" }}>{simpleTableEvalError}</div>}
                    {simpleTableEvalLoading && <div style={{ color: "var(--muted)" }}>Evaluating…</div>}
                    {!simpleTableEvalLoading && simpleTableEvalValue !== null && <div style={{ fontFamily: "monospace" }}>{String(simpleTableEvalValue)}</div>}
                    {!simpleTableEvalLoading && simpleTableEvalValue === null && !simpleTableEvalError && <div style={{ color: "var(--muted)" }}>Click Evaluate to see the value that will appear in the report.</div>}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={handleSimpleTableEvaluate} disabled={simpleTableEvalLoading}>
                      Evaluate
                    </button>
                    <button type="button" className="btn" onClick={() => { setSimpleTableFormulaModal(null); setSimpleTableFormulaDraft(null); setSimpleTableEvalValue(null); setSimpleTableEvalError(null); }}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        if (simpleTableFormulaModal && simpleTableFormulaDraft) {
                          updateCell(simpleTableFormulaModal.rowIdx, simpleTableFormulaModal.cellIdx, {
                            type: "formula",
                            kpiId: simpleTableFormulaDraft.kpiId,
                            entryIndex: simpleTableFormulaDraft.entryIndex,
                            formula: simpleTableFormulaDraft.formula,
                          });
                          setSimpleTableFormulaModal(null);
                          setSimpleTableFormulaDraft(null);
                          setSimpleTableEvalValue(null);
                          setSimpleTableEvalError(null);
                        }
                      }}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
          );
        })()}
        {type === "single_value" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
              <label style={{ fontSize: "0.85rem" }}>KPI</label>
              <select
                value={(block as { kpiId?: number }).kpiId ?? ""}
                onChange={(e) => onUpdate({ kpiId: e.target.value ? Number(e.target.value) : 0 })}
                style={{ width: "100%" }}
              >
                {kpis.map((k) => (
                  <option key={k.kpi_id} value={k.kpi_id}>{k.kpi_name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0, minWidth: 160 }}>
              <label style={{ fontSize: "0.85rem" }}>Field</label>
              <select
                value={(block as { fieldKey?: string }).fieldKey || ""}
                onChange={(e) => onUpdate({ fieldKey: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="">— Select —</option>
                {((block as { kpiId?: number }).kpiId
                  ? fieldsByKpiId[(block as { kpiId?: number }).kpiId!] || []
                  : []
                ).map((f) => (
                  <option key={f.id} value={f.key}>{f.name} ({f.key})</option>
                ))}
              </select>
            </div>
            {(() => {
              const kpiId = (block as { kpiId?: number }).kpiId;
              const fields = kpiId ? fieldsByKpiId[kpiId] || [] : [];
              const field = fields.find((f) => f.key === (block as { fieldKey?: string }).fieldKey);
              const subFields = field?.field_type === "multi_line_items" ? field?.sub_fields || [] : [];
              return subFields.length > 0 ? (
                <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
                  <label style={{ fontSize: "0.85rem" }}>Sub-field</label>
                  <select
                    value={(block as { subFieldKey?: string }).subFieldKey || ""}
                    onChange={(e) => onUpdate({ subFieldKey: e.target.value })}
                    style={{ width: "100%" }}
                  >
                    <option value="">— None —</option>
                    {subFields.map((s) => (
                      <option key={s.id} value={s.key}>{s.name}</option>
                    ))}
                  </select>
                </div>
              ) : null;
            })()}
            <div className="form-group" style={{ margin: 0, width: 80 }}>
              <label style={{ fontSize: "0.85rem" }}>Entry</label>
              <input
                type="number"
                min={0}
                value={(block as { entryIndex?: number }).entryIndex ?? 0}
                onChange={(e) => onUpdate({ entryIndex: parseInt(e.target.value, 10) || 0 })}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}
        {type === "kpi_multi_table" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
              <label style={{ fontSize: "0.85rem" }}>KPI</label>
              <select
                value={(block as { kpiId?: number }).kpiId ?? ""}
                onChange={(e) => onUpdate({ kpiId: e.target.value ? Number(e.target.value) : 0, fieldKey: "" })}
                style={{ width: "100%" }}
              >
                <option value="">— Select —</option>
                {kpis.map((k) => (
                  <option key={k.kpi_id} value={k.kpi_id}>{k.kpi_name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
              <label style={{ fontSize: "0.85rem" }}>Multi-line field</label>
              <select
                value={(block as { fieldKey?: string }).fieldKey || ""}
                onChange={(e) => onUpdate({ fieldKey: e.target.value })}
                style={{ width: "100%" }}
              >
                <option value="">— Select —</option>
                {(() => {
                  const kid = (block as { kpiId?: number }).kpiId;
                  const fields = kid ? (fieldsByKpiId[kid] || []) : [];
                  return fields
                    .filter((f) => f.field_type === "multi_line_items")
                    .map((f) => (
                      <option key={f.id} value={f.key}>
                        {f.name} ({f.key})
                      </option>
                    ));
                })()}
              </select>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0 0" }}>
                Renders only the sub-items table for this field (no outer KPI table row).
              </p>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
