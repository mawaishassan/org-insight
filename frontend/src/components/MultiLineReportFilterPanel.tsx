"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import {
  buildReferenceAttributeOptions,
  computeChainKpiIds,
  emptyMultiFilterRow,
  filterDraftToPayload,
  getFieldTypeAtPath,
  getNextSourceKpiIdForPath,
  isReferenceLikeFieldType,
  operatorsForMultiItemSubField,
  parseComparePath,
  pathsForChainComputation,
  payloadToFilterDraft,
  terminalRefAllowedValuesKey,
  truncateLabel,
  type FieldSummaryLike,
  type MultiFilterConditionRow,
  type MultiFilterSubField,
  type MultiItemsFilterPayloadV2,
} from "@/lib/multi-line-filter-payload";

type Props = {
  organizationId: number;
  token: string | null;
  fieldKey: string;
  subFields: MultiFilterSubField[];
  value: MultiItemsFilterPayloadV2 | null;
  onChange: (payload: MultiItemsFilterPayloadV2 | null) => void;
};

export function MultiLineReportFilterPanel({ organizationId, token, fieldKey, subFields, value, onChange }: Props) {
  const [filterDraft, setFilterDraft] = useState<MultiFilterConditionRow[]>(() => payloadToFilterDraft(value));
  const [sourceKpiFieldsById, setSourceKpiFieldsById] = useState<Record<number, FieldSummaryLike[]>>({});
  const [refFilterOptions, setRefFilterOptions] = useState<Record<string, string[]>>({});

  const valueJson = JSON.stringify(value);
  useEffect(() => {
    setFilterDraft(payloadToFilterDraft(JSON.parse(valueJson) as MultiItemsFilterPayloadV2 | null));
  }, [fieldKey, valueJson]);

  useEffect(() => {
    if (!token) return;
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
      api<FieldSummaryLike[]>(
        `/fields?${new URLSearchParams({
          kpi_id: String(kid),
          organization_id: String(organizationId),
        }).toString()}`,
        { token }
      )
        .then((list) => setSourceKpiFieldsById((prev) => ({ ...prev, [kid]: list })))
        .catch(() => setSourceKpiFieldsById((prev) => ({ ...prev, [kid]: [] })));
    });
  }, [token, organizationId, filterDraft, subFields, sourceKpiFieldsById]);

  useEffect(() => {
    if (!token) return;
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
      const { fieldKey: fk, subKey } = parseComparePath(path);
      if (!fk) return;
      const params = new URLSearchParams({
        source_kpi_id: String(kpiId),
        source_field_key: fk,
        organization_id: String(organizationId),
      });
      if (subKey) params.set("source_sub_field_key", subKey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params.toString()}`, { token })
        .then((r) => setRefFilterOptions((prev) => ({ ...prev, [term.cacheKey]: r.values ?? [] })))
        .catch(() => setRefFilterOptions((prev) => ({ ...prev, [term.cacheKey]: [] })));
    });
  }, [token, organizationId, filterDraft, subFields, refFilterOptions, sourceKpiFieldsById]);

  const applyPayload = useCallback(() => {
    const payload = filterDraftToPayload(filterDraft, subFields);
    onChange(payload);
  }, [filterDraft, subFields, onChange]);

  if (!subFields.length) return null;

  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "0.65rem 0.75rem",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-subtle)",
      }}
    >
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Row filters (report only)</div>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0 0 0.5rem 0" }}>
        Same rules as the full-page advanced filter. Only rows matching these conditions appear in this report block.
      </p>
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
            sourceKpiIdForRef != null ? computeChainKpiIds(sourceKpiIdForRef, pcComp, sourceKpiFieldsById) : [];
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
                    onChange={(e) => setRow({ logicWithPrev: e.target.value === "or" ? "or" : "and" })}
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
                      {truncateLabel(`${s.name ?? s.key} — ${s.key}`, 56)}
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
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
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
                            <option key={v} value={v}>
                              {truncateLabel(v, 72)}
                            </option>
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
                            <option key={v} value={v}>
                              {truncateLabel(v, 80)}
                            </option>
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
                            <option key={v} value={v}>
                              {truncateLabel(v, 72)}
                            </option>
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
        <button type="button" className="btn" style={{ fontSize: "0.85rem" }} onClick={() => setFilterDraft((prev) => [...prev, emptyMultiFilterRow()])}>
          + Add condition
        </button>
        <button
          type="button"
          className="btn"
          style={{ fontSize: "0.85rem" }}
          onClick={() => {
            setFilterDraft([emptyMultiFilterRow()]);
            onChange(null);
          }}
        >
          Clear filters
        </button>
        <button type="button" className="btn btn-primary" style={{ fontSize: "0.85rem" }} onClick={applyPayload}>
          Save filters to block
        </button>
      </div>
    </div>
  );
}
