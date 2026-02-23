"use client";

import React, { useState, useEffect } from "react";

// Minimal types so this module stays decoupled from page types
export interface KpiFromDomainMinimal {
  kpi_id: number;
  kpi_name: string;
}

export interface SubFieldOptionMinimal {
  id?: number;
  key: string;
  name: string;
}

export interface FieldOptionMinimal {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields?: SubFieldOptionMinimal[];
}

export interface KpiInsertValue {
  kpiId?: number;
  fieldKey?: string;
  subFieldKey?: string;
  subFieldGroupFn?: string;
  asGroup?: boolean;
  entryIndex?: number;
}

// Placeholder builders (Jinja strings for report template)
export function buildKpiValuePlaceholder(
  kpiId: number,
  fieldKey: string,
  subFieldKey: string | undefined,
  entryIndex: number
): string {
  const safeField = (fieldKey || "").replace(/'/g, "\\'");
  const subArg = subFieldKey ? `, '${subFieldKey.replace(/'/g, "\\'")}'` : ", none";
  return `{{ get_kpi_field_value(kpis, ${kpiId}, '${safeField}'${subArg}, ${entryIndex}) }}`;
}

export function buildMultiLineTablePlaceholder(
  kpiId: number,
  fieldKey: string,
  entryIndex: number
): string {
  const safeKey = (fieldKey || "").replace(/'/g, "\\'");
  return `{% set ml = get_multi_line_field(kpis, ${kpiId}, '${safeKey}', ${entryIndex}) %}{% if ml and ml.value_items %}<table border="1" cellpadding="4" style="border-collapse: collapse;"><tr>{% for sub_key in ml.sub_field_keys %}<th>{{ sub_key }}</th>{% endfor %}</tr>{% for item in ml.value_items %}<tr>{% for sub_key in ml.sub_field_keys %}<td>{{ item[sub_key] }}</td>{% endfor %}</tr>{% endfor %}</table>{% endif %}`;
}

export function buildSubFieldGroupPlaceholder(
  kpiId: number,
  fieldKey: string,
  subFieldKey: string,
  groupFn: string,
  entryIndex: number
): string {
  const formula = `${groupFn}(${fieldKey}, ${subFieldKey})`.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `{{ evaluate_report_formula(kpis, '${formula}', ${kpiId}, ${entryIndex}) }}`;
}

export function buildFormulaPlaceholder(
  kpiId: number,
  entryIndex: number,
  formulaExpr: string
): string {
  const escaped = formulaExpr.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `{{ evaluate_report_formula(kpis, '${escaped}', ${kpiId}, ${entryIndex}) }}`;
}

export const KPI_SUB_FIELD_GROUP_FUNCTIONS = [
  { value: "SUM_ITEMS", label: "SUM" },
  { value: "AVG_ITEMS", label: "AVG" },
  { value: "COUNT_ITEMS", label: "COUNT" },
  { value: "MIN_ITEMS", label: "MIN" },
  { value: "MAX_ITEMS", label: "MAX" },
] as const;

type PropsInsert = {
  mode: "insert";
  kpis: KpiFromDomainMinimal[];
  fieldsByKpiId: Record<number, FieldOptionMinimal[]>;
  onInsertValue: (placeholder: string) => void;
  onInsertTable: (placeholder: string) => void;
  onInsertSubFieldGroup: (placeholder: string) => void;
  showKpiSearch?: boolean;
  defaultEntryIndex?: number;
};

type PropsBound = {
  mode: "bound";
  kpis: KpiFromDomainMinimal[];
  fieldsByKpiId: Record<number, FieldOptionMinimal[]>;
  value: KpiInsertValue;
  onChange: (patch: Partial<KpiInsertValue>) => void;
};

export function ReportKpiInsertControls(props: PropsInsert | PropsBound) {
  const { mode, kpis, fieldsByKpiId } = props;
  const isInsert = mode === "insert";

  const [kpiSearch, setKpiSearch] = useState("");
  const [localKpiId, setLocalKpiId] = useState<number>(kpis[0]?.kpi_id ?? 0);
  const [localFieldKey, setLocalFieldKey] = useState("");
  const [localSubFieldKey, setLocalSubFieldKey] = useState("");
  const [localSubFieldGroupFn, setLocalSubFieldGroupFn] = useState("SUM_ITEMS");
  const [localAsGroup, setLocalAsGroup] = useState(false);
  const [localEntryIndex, setLocalEntryIndex] = useState(isInsert ? (props.defaultEntryIndex ?? 0) : 0);

  const value = isInsert ? undefined : props.value;
  const effectiveKpiId = isInsert ? localKpiId : (value?.kpiId ?? 0);
  const effectiveFieldKey = isInsert ? localFieldKey : (value?.fieldKey ?? "");
  const effectiveSubFieldKey = isInsert ? localSubFieldKey : (value?.subFieldKey ?? "");
  const effectiveSubFieldGroupFn = isInsert ? localSubFieldGroupFn : (value?.subFieldGroupFn ?? "SUM_ITEMS");
  const effectiveAsGroup = isInsert ? localAsGroup : (value?.asGroup ?? false);
  const effectiveEntryIndex = isInsert ? localEntryIndex : (value?.entryIndex ?? 0);

  const filteredKpis = kpiSearch.trim()
    ? kpis.filter((k) => k.kpi_name.toLowerCase().includes(kpiSearch.trim().toLowerCase()))
    : kpis;
  const resolvedKpiId = filteredKpis.length === 0 ? 0 : (filteredKpis.some((k) => k.kpi_id === effectiveKpiId) ? effectiveKpiId : filteredKpis[0]?.kpi_id ?? effectiveKpiId);
  const fields = fieldsByKpiId[resolvedKpiId] || [];
  const selectedField = fields.find((f) => f.key === effectiveFieldKey);
  const subFields = selectedField?.field_type === "multi_line_items" ? (selectedField.sub_fields || []) : [];

  useEffect(() => {
    if (kpis.length && !isInsert) return;
    if (kpis.length && localKpiId === 0) setLocalKpiId(kpis[0].kpi_id);
  }, [kpis, localKpiId, isInsert]);
  useEffect(() => {
    if (!isInsert) return;
    setLocalFieldKey("");
    setLocalSubFieldKey("");
  }, [effectiveKpiId, isInsert]);

  const handleKpiChange = (kpiId: number) => {
    if (isInsert) setLocalKpiId(kpiId);
    else props.onChange({ kpiId });
  };
  const handleFieldChange = (fieldKey: string) => {
    if (isInsert) {
      setLocalFieldKey(fieldKey);
      setLocalSubFieldKey("");
    } else props.onChange({ fieldKey, subFieldKey: "" });
  };
  const handleSubFieldChange = (subFieldKey: string) => {
    if (isInsert) {
      setLocalSubFieldKey(subFieldKey);
      if (!localSubFieldGroupFn) setLocalSubFieldGroupFn("SUM_ITEMS");
    } else props.onChange({ subFieldKey, subFieldGroupFn: props.value.subFieldGroupFn || "SUM_ITEMS" });
  };
  const handleSubFieldGroupFnChange = (subFieldGroupFn: string) => {
    if (isInsert) setLocalSubFieldGroupFn(subFieldGroupFn);
    else props.onChange({ subFieldGroupFn });
  };
  const handleAsGroupChange = (asGroup: boolean) => {
    if (isInsert) setLocalAsGroup(asGroup);
    else props.onChange({ asGroup });
  };
  const handleEntryIndexChange = (entryIndex: number) => {
    if (isInsert) setLocalEntryIndex(entryIndex);
    else props.onChange({ entryIndex });
  };

  const doInsertValue = () => {
    if (!isInsert || !effectiveFieldKey) return;
    props.onInsertValue(buildKpiValuePlaceholder(resolvedKpiId, effectiveFieldKey, effectiveSubFieldKey || undefined, effectiveEntryIndex));
  };
  const doInsertTable = () => {
    if (!isInsert || !effectiveFieldKey || selectedField?.field_type !== "multi_line_items") return;
    props.onInsertTable(buildMultiLineTablePlaceholder(resolvedKpiId, effectiveFieldKey, effectiveEntryIndex));
  };
  const doInsertSubFieldGroup = () => {
    if (!isInsert || !effectiveFieldKey || !effectiveSubFieldKey) return;
    props.onInsertSubFieldGroup(buildSubFieldGroupPlaceholder(resolvedKpiId, effectiveFieldKey, effectiveSubFieldKey, effectiveSubFieldGroupFn, effectiveEntryIndex));
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
      {isInsert && props.showKpiSearch && (
        <div style={{ minWidth: 180 }}>
          <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Search KPI</label>
          <input
            type="search"
            value={kpiSearch}
            onChange={(e) => setKpiSearch(e.target.value)}
            placeholder="Type to search KPIs..."
            style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem", borderRadius: 4, border: "1px solid var(--border)" }}
          />
        </div>
      )}
      <div style={{ minWidth: 180 }}>
        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>KPI</label>
        <select
          value={resolvedKpiId || ""}
          onChange={(e) => handleKpiChange(Number(e.target.value))}
          style={{ width: "100%", padding: "0.3rem 0.4rem", fontSize: "0.85rem" }}
        >
          {filteredKpis.length === 0 ? (
            <option value="">No KPIs match</option>
          ) : (
            filteredKpis.map((k) => (
              <option key={k.kpi_id} value={k.kpi_id}>{k.kpi_name}</option>
            ))
          )}
        </select>
      </div>
      <div style={{ minWidth: 140 }}>
        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Field</label>
        <select
          value={effectiveFieldKey}
          onChange={(e) => handleFieldChange(e.target.value)}
          style={{ width: "100%", padding: "0.3rem 0.4rem", fontSize: "0.85rem" }}
        >
          <option value="">— Select field —</option>
          {fields.map((f) => (
            <option key={f.id} value={f.key}>{f.name}</option>
          ))}
        </select>
      </div>
      {subFields.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem" }}>
          <input
            type="checkbox"
            checked={effectiveAsGroup}
            onChange={(e) => handleAsGroupChange(e.target.checked)}
          />
          Group (table)
        </label>
      )}
      {subFields.length > 0 && !effectiveAsGroup && (
        <>
          <div style={{ minWidth: 120 }}>
            <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Sub-field</label>
            <select
              value={effectiveSubFieldKey}
              onChange={(e) => handleSubFieldChange(e.target.value)}
              style={{ width: "100%", padding: "0.3rem 0.4rem", fontSize: "0.85rem" }}
            >
              <option value="">— Sub-field —</option>
              {subFields.map((s) => (
                <option key={s.id ?? s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
          </div>
          {effectiveSubFieldKey && (
            <div style={{ minWidth: 100 }}>
              <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Group function</label>
              <select
                value={effectiveSubFieldGroupFn}
                onChange={(e) => handleSubFieldGroupFnChange(e.target.value)}
                style={{ width: "100%", padding: "0.3rem 0.4rem", fontSize: "0.85rem" }}
              >
                {KPI_SUB_FIELD_GROUP_FUNCTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
      <div style={{ minWidth: 80 }}>
        <label style={{ fontSize: "0.75rem", display: "block", marginBottom: "0.2rem" }}>Entry index</label>
        <input
          type="number"
          min={0}
          value={effectiveEntryIndex}
          onChange={(e) => handleEntryIndexChange(parseInt(e.target.value, 10) || 0)}
          style={{ width: "100%", padding: "0.3rem 0.4rem", fontSize: "0.85rem" }}
        />
      </div>
      {isInsert && (
        <>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem" }}
            onClick={doInsertValue}
            disabled={!effectiveFieldKey}
          >
            Insert value
          </button>
          {selectedField?.field_type === "multi_line_items" && (
            <button
              type="button"
              className="btn"
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem" }}
              onClick={doInsertTable}
              title="Insert table of all items"
            >
              Insert as table
            </button>
          )}
          {selectedField?.field_type === "multi_line_items" && effectiveSubFieldKey && (
            <button
              type="button"
              className="btn"
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.85rem" }}
              onClick={doInsertSubFieldGroup}
              title="Insert aggregated sub-field (SUM/AVG/etc.)"
            >
              Insert (group fn)
            </button>
          )}
        </>
      )}
    </div>
  );
}
