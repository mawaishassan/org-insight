"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
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
  year: number;
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
  | { type: "kpi_table"; id?: string; kpiIds?: number[]; fieldKeys?: string[]; oneTablePerKpi?: boolean }
  | { type: "simple_table"; id?: string; rows?: SimpleTableRow[] }
  | { type: "kpi_grid"; id?: string; kpiIds?: number[]; fieldKeys?: string[] }
  | { type: "kpi_list"; id?: string; kpiIds?: number[]; fieldKeys?: string[] }
  | { type: "single_value"; id?: string; kpiId?: number; fieldKey?: string; subFieldKey?: string; entryIndex?: number };

export type SimpleTableCell =
  | { type: "text"; content?: string }
  | { type: "kpi"; kpiId?: number; fieldKey?: string; subFieldKey?: string; subFieldGroupFn?: string; entryIndex?: number; asGroup?: boolean }
  | { type: "formula"; kpiId?: number; fieldKey?: string; entryIndex?: number; formula?: string };
export type SimpleTableRow = { cells: SimpleTableCell[] };
const DEFAULT_SIMPLE_TABLE_ROW: SimpleTableRow = { cells: [{ type: "text", content: "" }] };

const BLOCK_LABELS: Record<string, string> = {
  title: "Report title",
  section_heading: "Section heading",
  spacer: "Spacer",
  text: "Text with KPI data",
  domain_list: "Domain list",
  domain_categories: "Domain categories",
  domain_kpis: "Domain KPIs",
  kpi_table: "KPI table",
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
      const cellMulti =
        '{% if f.field_type == \'multi_line_items\' and f.value_items %}<table border="1" cellpadding="4" style="border-collapse: collapse; width: 100%;">{% for item in f.value_items %}<tr>{% for sub_key in f.sub_field_keys %}<td>{{ item[sub_key] }}</td>{% endfor %}</tr>{% endfor %}</table>{% else %}{{ f.value }}{% endif %}';
      if (!kpiIds.length && !fieldKeys.length) {
        out.push(
          `<div class="report-kpi-table">{% if kpis %}{% for kpi in kpis %}<h4>{{ kpi.kpi_name }}</h4><table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;"><thead><tr>{% for f in kpi.entries[0].fields if kpi.entries %}<th>{{ f.field_name }}</th>{% endfor %}</tr></thead><tbody>{% for entry in kpi.entries %}<tr>{% for f in entry.fields %}<td>${cellMulti}</td>{% endfor %}</tr>{% endfor %}</tbody></table>{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`
        );
      } else {
        const fidList = kpiIds.join(", ");
        const fkeysList = fieldKeys.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");
        const cellByKey = `{% for f in entry.fields %}{% if f.field_key == key %}<td>${cellMulti}</td>{% endif %}{% endfor %}`;
        out.push(
          `{% set kpi_ids_set = [${fidList}] %}{% set field_keys_list = [${fkeysList}] %}<div class="report-kpi-table">{% if kpis %}{% for kpi in kpis %}{% if kpi.kpi_id in kpi_ids_set %}<h4>{{ kpi.kpi_name }}</h4><table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;"><thead><tr>{% for key in field_keys_list %}<th>{{ key }}</th>{% endfor %}</tr></thead><tbody>{% for entry in kpi.entries %}<tr>{% for key in field_keys_list %}${cellByKey}{% endfor %}</tr>{% endfor %}</tbody></table>{% endif %}{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`
        );
      }
    } else if (type === "simple_table") {
      const rows = (b as { rows?: SimpleTableRow[] }).rows || [];
      const rowParts: string[] = [];
      for (const row of rows) {
        const cells = row.cells || [];
        const cellParts: string[] = [];
        for (const cell of cells) {
          if (cell.type === "text") {
            const content = (cell.content || "").trim();
            cellParts.push("<td>" + escapeHtml(content) + "</td>");
          } else if (cell.type === "kpi") {
            const kpiId = cell.kpiId ?? 0;
            const fieldKey = (cell.fieldKey || "").replace(/'/g, "\\'");
            const subKey = (cell.subFieldKey || "").trim() || "";
            const subFieldGroupFn = (cell.subFieldGroupFn || "SUM_ITEMS").trim() || "SUM_ITEMS";
            const entryIdx = cell.entryIndex ?? 0;
            if (cell.asGroup) {
              cellParts.push(
                `<td>{% set _ml = get_multi_line_field(kpis, ${kpiId}, '${fieldKey}', ${entryIdx}) %}{% if _ml %}<table border="1" cellpadding="4" style="border-collapse: collapse;"><tr>{% for sk in _ml.sub_field_keys %}<th>{{ sk }}</th>{% endfor %}</tr>{% for item in _ml.value_items %}<tr>{% for sk in _ml.sub_field_keys %}<td>{{ item[sk] }}</td>{% endfor %}</tr>{% endfor %}</table>{% endif %}</td>`
              );
            } else if (subKey) {
              const formula = `${subFieldGroupFn}(${cell.fieldKey || ""}, ${subKey})`.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
              cellParts.push(
                `<td>{{ evaluate_report_formula(kpis, '${formula}', ${kpiId}, ${entryIdx}) }}</td>`
              );
            } else {
              const subArg = ", none";
              cellParts.push(
                `<td>{{ get_kpi_field_value(kpis, ${kpiId}, '${fieldKey}'${subArg}, ${entryIdx}) }}</td>`
              );
            }
          } else if (cell.type === "formula") {
            const kpiId = cell.kpiId ?? 0;
            const entryIdx = cell.entryIndex ?? 0;
            const formula = (cell.formula || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            cellParts.push(
              `<td>{{ evaluate_report_formula(kpis, '${formula}', ${kpiId}, ${entryIdx}) }}</td>`
            );
          } else {
            cellParts.push("<td></td>");
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
      const gridCellMulti =
        '{% if f.field_type == \'multi_line_items\' and f.value_items %}<table border="1" cellpadding="4" style="border-collapse: collapse;">{% for item in f.value_items %}<tr>{% for sub_key in f.sub_field_keys %}<td>{{ item[sub_key] }}</td>{% endfor %}</tr>{% endfor %}</table>{% else %}{{ f.value }}{% endif %}';
      if (!kpiIds.length && !fieldKeys.length) {
        out.push(
          `<div class="report-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">{% if kpis %}{% for kpi in kpis %}{% for entry in kpi.entries %}<div class="report-card" style="border: 1px solid #ddd; padding: 1rem; border-radius: 8px;"><h4 style="margin-top: 0;">{{ kpi.kpi_name }}</h4>{% for f in entry.fields %}<p style="margin: 0.25rem 0;"><strong>{{ f.field_name }}:</strong> ${gridCellMulti}</p>{% endfor %}</div>{% endfor %}{% endfor %}{% endif %}</div>`
        );
      } else {
        const fidList = kpiIds.join(", ");
        const fkeysList = fieldKeys.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");
        const gridCellByKey = `{% for f in entry.fields %}{% if f.field_key == key %}${gridCellMulti}{% endif %}{% endfor %}`;
        out.push(
          `{% set kpi_ids_set = [${fidList}] %}{% set field_keys_list = [${fkeysList}] %}<div class="report-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">{% if kpis %}{% for kpi in kpis %}{% if kpi.kpi_id in kpi_ids_set %}{% for entry in kpi.entries %}<div class="report-card" style="border: 1px solid #ddd; padding: 1rem; border-radius: 8px;"><h4 style="margin-top: 0;">{{ kpi.kpi_name }}</h4>{% for key in field_keys_list %}<p style="margin: 0.25rem 0;"><strong>{{ key }}:</strong> ${gridCellByKey}</p>{% endfor %}</div>{% endfor %}{% endif %}{% endfor %}{% endif %}</div>`
        );
      }
    } else if (type === "kpi_list") {
      const kpiIds = (b as { kpiIds?: number[] }).kpiIds || [];
      const fieldKeys = (b as { fieldKeys?: string[] }).fieldKeys || [];
      const listCellMulti =
        '{% if f.field_type == \'multi_line_items\' and f.value_items %}<ul style="margin: 0.25rem 0;">{% for item in f.value_items %}<li>{% for sub_key in f.sub_field_keys %}{{ item[sub_key] }}{% if not loop.last %} – {% endif %}{% endfor %}</li>{% endfor %}</ul>{% else %}{{ f.value }}{% endif %}';
      if (!kpiIds.length && !fieldKeys.length) {
        out.push(
          `<div class="report-kpi-list">{% if kpis %}{% for kpi in kpis %}<h4>{{ kpi.kpi_name }}</h4><dl style="margin: 0.5rem 0;">{% for entry in kpi.entries %}{% for f in entry.fields %}<dt style="font-weight: 600;">{{ f.field_name }}</dt><dd style="margin-left: 1rem;">${listCellMulti}</dd>{% endfor %}{% endfor %}</dl>{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>`
        );
      } else {
        const fidList = kpiIds.join(", ");
        const fkeysList = fieldKeys.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");
        const listCellByKey = `{% for f in entry.fields %}{% if f.field_key == key %}${listCellMulti}{% endif %}{% endfor %}`;
        out.push(
          `{% set kpi_ids_set = [${fidList}] %}{% set field_keys_list = [${fkeysList}] %}<div class="report-kpi-list">{% if kpis %}{% for kpi in kpis %}{% if kpi.kpi_id in kpi_ids_set %}<h4>{{ kpi.kpi_name }}</h4><dl style="margin: 0.5rem 0;">{% for entry in kpi.entries %}{% for key in field_keys_list %}<dt style="font-weight: 600;">{{ key }}</dt><dd style="margin-left: 1rem;">${listCellByKey}</dd>{% endfor %}{% endfor %}</dl>{% endif %}{% endfor %}{% endif %}</div>`
        );
      }
    }
  }
  return out.length ? out.join("\n") : "<p>No content. Add blocks in the visual designer.</p>";
}

export default function ReportDesignPage() {
  const params = useParams();
  const id = Number(params.id);
  const token = getAccessToken();
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bodyTemplate, setBodyTemplate] = useState("");

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

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

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

  const addBlock = (block: ReportBlock) => {
    setBlocks((prev) => [...prev, addBlockId(block)]);
  };

  const updateBlock = (index: number, updates: Partial<ReportBlock>) => {
    setBlocks((prev) => {
      const next = [...prev];
      const b = next[index] as Record<string, unknown>;
      next[index] = { ...b, ...updates } as ReportBlock;
      return next;
    });
  };

  const removeBlock = (index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  };

  const moveBlock = (index: number, dir: "up" | "down") => {
    const newIndex = dir === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= blocks.length) return;
    setBlocks((prev) => {
      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next;
    });
  };

  const saveVisual = async () => {
    if (!token || !detail) return;
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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const generatedTemplate = useMemo(() => blocksToJinja(blocks), [blocks]);
  const templateSourceDisplay = blocks.length > 0 ? generatedTemplate : bodyTemplate;
  const isTemplateFromBlocks = blocks.length > 0;

  const saveAdvanced = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !detail) return;
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
      loadDetail();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!detail) return null;

  const kpis = detail.kpis_from_domains;
  const domains = detail.attached_domains;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: "1rem" }}>
        <Link href={`/dashboard/reports/${id}`} style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {"\u2190"} Back to report
        </Link>
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Design report: {detail.name}</h1>
      <p style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>Year {detail.year}. Add blocks below—drag to reorder, then Save.</p>
      <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
        Use <strong>Text with KPI data</strong> to write paragraphs and insert numbers or text from KPIs anywhere in the text.
      </p>

      {detail.attached_domains.length === 0 && (
        <div className="card" style={{ marginBottom: "1rem", borderLeft: "4px solid var(--warn, #c90)", background: "var(--surface)" }}>
          <p style={{ margin: 0, fontWeight: 500 }}>No domains attached.</p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
            Attach this template to domains in Organization → Reports to include KPIs and fields.
          </p>
        </div>
      )}

      {/* Visual builder */}
      <section className="card" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.15rem", margin: 0, marginBottom: "0.25rem" }}>Report content</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>Add blocks in order. Use ↑↓ to reorder.</p>
          </div>
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
                  else if (v === "kpi_table") addBlock({ type: "kpi_table", kpiIds: [], fieldKeys: [], oneTablePerKpi: true });
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
                else if (v === "kpi_grid") addBlock({ type: "kpi_grid", kpiIds: [], fieldKeys: [] });
                else if (v === "kpi_list") addBlock({ type: "kpi_list", kpiIds: [], fieldKeys: [] });
                else if (v === "single_value") addBlock({ type: "single_value", kpiId: kpis[0]?.kpi_id ?? 0, fieldKey: "", subFieldKey: "", entryIndex: 0 });
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
            </select>
            <button type="button" className="btn btn-primary" onClick={saveVisual} disabled={saving} style={{ marginLeft: "0.5rem" }}>
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
            {blocks.map((block, index) => (
              <li key={(block as { id?: string }).id || index} style={{ marginBottom: "0.75rem" }}>
                <BlockCard
                  block={block}
                  index={index}
                  total={blocks.length}
                  detail={detail}
                  templateId={id}
                  fieldsByKpiId={fieldsByKpiId}
                  loadFieldsForKpis={loadFieldsForKpis}
                  onUpdate={(u) => updateBlock(index, u)}
                  onRemove={() => removeBlock(index)}
                  onMoveUp={() => moveBlock(index, "up")}
                  onMoveDown={() => moveBlock(index, "down")}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Advanced: raw template */}
      <section className="card" style={{ marginBottom: "1rem", padding: "0" }}>
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
                onChange={(e) => !isTemplateFromBlocks && setBodyTemplate(e.target.value)}
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
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: "0.5rem" }}>
                {isTemplateFromBlocks ? "Use this as raw template (replace blocks)" : "Save raw template"}
              </button>
            </form>
          </div>
        )}
      </section>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Link className="btn btn-primary" href={`/dashboard/reports/${id}`}>
          View / Print report
        </Link>
      </div>
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
}: {
  content: string;
  onContentChange: (content: string) => void;
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
  kpis: KpiFromDomain[];
  fieldsByKpiId: Record<number, FieldOption[]>;
  detail: TemplateDetail;
  templateId: number;
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
        year: detail.year ?? undefined,
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
  }, [addMode, token, detail.organization_id, detail.year, templateId, kpiValueConfig, formulaKpiId, formulaEntryIndex, formulaExpression]);

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
  index,
  total,
  detail,
  templateId,
  fieldsByKpiId,
  loadFieldsForKpis,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  block: ReportBlock;
  index: number;
  total: number;
  detail: TemplateDetail;
  templateId: number;
  fieldsByKpiId: Record<number, FieldOption[]>;
  loadFieldsForKpis: (kpiIds: number[]) => void;
  onUpdate: (u: Partial<ReportBlock>) => void;
  onRemove: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
}) {
  const type = block.type;
  const kpis = detail.kpis_from_domains;
  const domains = detail.attached_domains;

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

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
    } else if (type === "single_value") {
      const kpiId = (block as { kpiId?: number }).kpiId;
      if (kpiId) loadFieldsForKpis([kpiId]);
    }
  }, [type, (block as { kpiIds?: number[] }).kpiIds, (block as { kpiId?: number }).kpiId, detail.kpis_from_domains, loadFieldsForKpis]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0.75rem", background: "var(--bg-muted, #f5f5f5)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{BLOCK_LABELS[type] || type}</span>
        <div style={{ display: "flex", gap: "0.25rem" }}>
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
            {type === "kpi_table" && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={(block as { oneTablePerKpi?: boolean }).oneTablePerKpi !== false}
                  onChange={(e) => onUpdate({ oneTablePerKpi: e.target.checked })}
                />
                One table per KPI
              </label>
            )}
          </>
        )}
        {type === "simple_table" && (() => {
          const rows: SimpleTableRow[] = (block as { rows?: SimpleTableRow[] }).rows?.length
            ? (block as { rows?: SimpleTableRow[] }).rows!
            : [DEFAULT_SIMPLE_TABLE_ROW];
          const setRows = (next: SimpleTableRow[]) => onUpdate({ rows: next });
          const addRow = () => setRows([...rows, { cells: [{ type: "text", content: "" }] }]);
          const removeRow = (rowIdx: number) => setRows(rows.filter((_, i) => i !== rowIdx));
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
          const updateCell = (rowIdx: number, cellIdx: number, patch: Partial<SimpleTableCell>) => {
            const next = rows.map((r, i) =>
              i === rowIdx
                ? { cells: r.cells.map((c, j) => (j === cellIdx ? { ...c, ...patch } as SimpleTableCell : c)) }
                : r
            );
            setRows(next);
          };
          return (
            <div style={{ marginTop: "0.5rem" }}>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.5rem 0" }}>
                Add rows and columns. Each cell: <strong>Text</strong>, <strong>KPI value</strong> (for multi-line fields pick a sub-field and group function: SUM, AVG, COUNT, MIN, MAX), <strong>Group (table)</strong> to show all sub-fields as a table, or <strong>Formula</strong>.
              </p>
              {rows.map((row, rowIdx) => (
                <div key={rowIdx} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", marginBottom: "0.5rem", background: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap", gap: "0.25rem" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Row {rowIdx + 1}</span>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
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
                            else if (t === "formula") updateCell(rowIdx, cellIdx, { type: "formula", kpiId: kpis[0]?.kpi_id ?? 0, fieldKey: "", entryIndex: 0, formula: "" });
                          }}
                          style={{ minWidth: 100, fontSize: "0.85rem" }}
                        >
                          <option value="text">Text</option>
                          <option value="kpi">KPI value</option>
                          <option value="formula">Formula</option>
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
                                <input
                                  type="text"
                                  value={(cell as { formula?: string }).formula ?? ""}
                                  onChange={(e) => updateCell(rowIdx, cellIdx, { formula: e.target.value })}
                                  placeholder="e.g. total_count + SUM_ITEMS(students, score)"
                                  style={{ minWidth: 200, padding: "0.25rem 0.4rem", fontSize: "0.85rem" }}
                                />
                                <input
                                  type="number"
                                  min={0}
                                  value={(cell as { entryIndex?: number }).entryIndex ?? 0}
                                  onChange={(e) => updateCell(rowIdx, cellIdx, { entryIndex: parseInt(e.target.value, 10) || 0 })}
                                  title="Entry index"
                                  style={{ width: 52, padding: "0.25rem", fontSize: "0.85rem" }}
                                />
                              </>
                            )}
                          </>
                        )}
                        <button type="button" className="btn" style={{ padding: "0.2rem 0.4rem", fontSize: "0.8rem", color: "var(--error)" }} onClick={() => removeCell(rowIdx, cellIdx)}>−</button>
                      </div>
                      {cell.type === "formula" && detail?.organization_id != null && (
                        <ReportFormulaBuilder
                          formulaValue={(cell as { formula?: string }).formula ?? ""}
                          onInsert={(text) => updateCell(rowIdx, cellIdx, { formula: ((cell as { formula?: string }).formula ?? "") + text })}
                          fields={(fieldsByKpiId[(cell as { kpiId?: number }).kpiId ?? 0] || []).filter((f) => f.field_type === "number" || f.field_type === "multi_line_items")}
                          organizationId={detail.organization_id}
                          currentKpiId={(cell as { kpiId?: number }).kpiId ?? 0}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <button type="button" className="btn" style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem" }} onClick={addRow}>+ Add row</button>
            </div>
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
      </div>
    </div>
  );
}
