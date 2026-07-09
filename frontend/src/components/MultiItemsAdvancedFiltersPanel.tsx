import React, { Dispatch, SetStateAction, ReactNode } from "react";
import { api } from "@/lib/api";
import {
  SubField,
  FieldSummary,
  MultiFilterConditionRow,
  operatorsForMultiItemSubField,
  pathsForChainComputation,
  computeChainKpiIds,
  terminalRefAllowedValuesKey,
  buildReferenceAttributeOptions,
  truncateLabel,
  emptyMultiFilterRow,
  getFieldTypeAtPath,
  isReferenceLikeFieldType,
  parseComparePath,
  defaultReferenceComparePath,
  filterDraftToPayload,
} from "@/lib/multiItemsFiltersHelper";

interface MultiItemsAdvancedFiltersPanelProps {
  token: string;
  effectiveOrgId: number;
  subFields: SubField[];
  filterDraft: MultiFilterConditionRow[];
  setFilterDraft: Dispatch<SetStateAction<MultiFilterConditionRow[]>>;
  sourceKpiFieldsById: Record<number, FieldSummary[]>;
  setSourceKpiFieldsById: Dispatch<SetStateAction<Record<number, FieldSummary[]>>>;
  refFilterOptions: Record<string, string[]>;
  setRefFilterOptions: Dispatch<SetStateAction<Record<string, string[]>>>;
  onApply: (draft: MultiFilterConditionRow[]) => void;
  onClose: () => void;
  showCloseButton?: boolean;
}

export default function MultiItemsAdvancedFiltersPanel({
  token,
  effectiveOrgId,
  subFields,
  filterDraft,
  setFilterDraft,
  sourceKpiFieldsById,
  setSourceKpiFieldsById,
  refFilterOptions,
  setRefFilterOptions,
  onApply,
  onClose,
  showCloseButton = true,
}: MultiItemsAdvancedFiltersPanelProps) {
  // Load source KPI fields as needed
  React.useEffect(() => {
    if (!token || effectiveOrgId == null) return;
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
  }, [token, effectiveOrgId, filterDraft, subFields, sourceKpiFieldsById, setSourceKpiFieldsById]);

  // Load reference allowed values as needed
  React.useEffect(() => {
    if (!token || effectiveOrgId == null) return;
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
  }, [token, effectiveOrgId, filterDraft, subFields, refFilterOptions, setRefFilterOptions, sourceKpiFieldsById]);

  const setRow = (idx: number, patch: Partial<MultiFilterConditionRow>) => {
    setFilterDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  };

  return (
    <div className="card" style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Advanced filters</span>
        {showCloseButton && (
          <button
            type="button"
            className="btn"
            onClick={onClose}
            style={{ fontSize: "0.85rem" }}
          >
            Close
          </button>
        )}
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
                      setRow(idx, { logicWithPrev: e.target.value === "or" ? "or" : "and" })
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
                    setRow(idx, {
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
                    onChange={(e) => setRow(idx, { value: e.target.value })}
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
                    onChange={(e) => setRow(idx, { value: e.target.value })}
                    style={{ width: "100%", maxWidth: "200px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    placeholder="Number"
                  />
                ) : ftCond === "date" ? (
                  <input
                    type="date"
                    value={c.value.length >= 10 ? c.value.slice(0, 10) : c.value}
                    onChange={(e) => setRow(idx, { value: e.target.value })}
                    style={{ maxWidth: "200px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                  />
                ) : ftCond === "reference" && sourceKpiIdForRef ? (
                  termKey ? (
                    refOptions.length > 0 ? (
                      !c.value || refOptions.includes(c.value) ? (
                        <select
                          value={refOptions.includes(c.value) ? c.value : ""}
                          onChange={(e) => setRow(idx, { value: e.target.value })}
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
                          onChange={(e) => setRow(idx, { value: e.target.value })}
                          style={{ minWidth: "180px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                          placeholder="Custom value"
                        />
                      )
                    ) : (
                      <input
                        type="text"
                        value={c.value}
                        onChange={(e) => setRow(idx, { value: e.target.value })}
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
                            setRow(idx, { multiValues: sel, value: sel[0] ?? "" });
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
                          onChange={(e) => setRow(idx, { value: e.target.value })}
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
                          onChange={(e) => setRow(idx, { value: e.target.value })}
                          style={{ minWidth: "180px", width: "100%", maxWidth: "360px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                          placeholder="Custom value"
                        />
                      )
                    ) : (
                      <input
                        type="text"
                        value={c.value}
                        onChange={(e) => setRow(idx, { value: e.target.value })}
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
                    onChange={(e) => setRow(idx, { value: e.target.value })}
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
            onApply([emptyMultiFilterRow()]);
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onApply(filterDraft);
          }}
        >
          Apply filters
        </button>
      </div>
    </div>
  );
}
