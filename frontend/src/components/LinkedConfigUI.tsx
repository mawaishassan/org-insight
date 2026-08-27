"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

function qs(params: Record<string, string | number | boolean | undefined>): string {
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    )
  ).toString();
}

interface ReferenceConfig {
  [key: string]: any;
}

export function LinkedConfigUI({
  organizationId,
  currentKpiId,
  currentMliSubFields,
  value,
  onChange,
  onCancel,
}: {
  organizationId: number | undefined;
  currentKpiId?: number;
  currentMliSubFields?: Array<{ name: string; key: string; field_type?: string; config?: any }>;
  value: ReferenceConfig;
  onChange: (c: ReferenceConfig) => void;
  onCancel?: () => void;
}) {
  const [kpis, setKpis] = useState<Array<{ id: number; name: string }>>([]);
  const [sourceFields, setSourceFields] = useState<any[]>([]);
  const token = getAccessToken();

  // Local draft state to hold changes before clicking "Save Configuration"
  const [draft, setDraft] = useState<ReferenceConfig>(value || {});

  useEffect(() => {
    setDraft(value || {});
  }, [value]);

  useEffect(() => {
    if (!token || organizationId == null) return;
    api<Array<{ id: number; name: string }>>(`/kpis?${qs({ organization_id: organizationId })}`, { token })
      .then((list) => setKpis(list))
      .catch(() => setKpis([]));
  }, [token, organizationId]);

  const dataSource = draft.data_source || "manual";
  const linkSrc = draft.link_source || {};
  const sourceKpiId = linkSrc.source_kpi_id;
  const sourceFieldId = linkSrc.source_field_id;
  const columnMappings = linkSrc.column_mappings || {};

  useEffect(() => {
    if (!token || organizationId == null || !sourceKpiId) {
      setSourceFields([]);
      return;
    }
    api<any[]>(`/fields?${qs({ kpi_id: sourceKpiId, organization_id: organizationId })}`, { token })
      .then((list) => setSourceFields(list))
      .catch(() => setSourceFields([]));
  }, [token, organizationId, sourceKpiId]);

  const mliFields = sourceFields.filter(f => f.field_type === "multi_line_items");
  const selectedMliField = mliFields.find(f => f.id === sourceFieldId);
  const sourceSubFields = selectedMliField?.sub_fields || [];

  const updateDraftLinkSource = (updated: Record<string, any>) => {
    setDraft((prev) => ({
      ...prev,
      data_source: "linked",
      link_source: {
        ...(prev.link_source || {}),
        ...updated,
      }
    }));
  };

  const updateDraftDuplicateHandling = (updated: Record<string, any>) => {
    setDraft((prev) => ({
      ...prev,
      duplicate_handling: {
        ...(prev.duplicate_handling || {}),
        ...updated,
      }
    }));
  };

  const removeDuplicates = !!draft.duplicate_handling?.remove_duplicates;
  const duplicateKeys = draft.duplicate_handling?.duplicate_keys || [];

  const handleSave = () => {
    onChange(draft);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", width: "100%", boxSizing: "border-box" }}>
      
      {/* 1. Data Source Mode Selector */}
      <div style={{ width: "100%", boxSizing: "border-box" }}>
        <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Data Source Mode</label>
        <select
          value={dataSource}
          onChange={(e) => {
            const nextMode = e.target.value;
            if (nextMode === "linked") {
              setDraft({
                data_source: "linked",
                link_source: {
                  source_kpi_id: undefined,
                  source_field_id: undefined,
                  column_mappings: {},
                },
                duplicate_handling: {
                  remove_duplicates: false,
                  duplicate_keys: []
                }
              });
            } else {
              setDraft({
                data_source: "manual",
                link_source: null,
                duplicate_handling: null
              });
            }
          }}
          style={{ width: "100%", padding: "6px 8px", background: "white", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" }}
        >
          <option value="manual">Manual Data Entry</option>
          <option value="linked">Linked Column from Another MLI</option>
        </select>
      </div>

      {dataSource === "linked" && (
        <>
          {/* 2. Source KPI & MLI Table selectors */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", width: "100%", boxSizing: "border-box" }}>
            <div style={{ flex: "1 1 200px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Source KPI *</label>
              <select
                value={sourceKpiId ?? ""}
                onChange={(e) => {
                  const kid = e.target.value ? Number(e.target.value) : undefined;
                  updateDraftLinkSource({
                    source_kpi_id: kid,
                    source_field_id: undefined,
                    column_mappings: {},
                  });
                }}
                style={{ width: "100%", maxWidth: "100%", padding: "6px 8px", background: "white", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" }}
              >
                <option value="">— Select Source KPI —</option>
                {kpis.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} {k.id === currentKpiId ? "(Current KPI)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "1 1 200px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Source MLI Table *</label>
              <select
                value={sourceFieldId ?? ""}
                onChange={(e) => {
                  const fid = e.target.value ? Number(e.target.value) : undefined;
                  updateDraftLinkSource({
                    source_field_id: fid,
                    column_mappings: {},
                  });
                }}
                disabled={!sourceKpiId}
                style={{ width: "100%", maxWidth: "100%", padding: "6px 8px", background: "white", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" }}
              >
                <option value="">— Select Table —</option>
                {mliFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.key})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Column Mappings Grid */}
          {sourceFieldId && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%", boxSizing: "border-box", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 700, paddingBottom: "0.25rem" }}>
                Column Mappings (Map Current columns to Source columns)
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {(currentMliSubFields || []).map((sf) => {
                  const mappedVal = columnMappings[sf.key] || "";
                  return (
                    <div key={sf.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", padding: "0.35rem 0" }}>
                      <div style={{ flex: "1 1 180px", fontSize: "0.85rem", fontWeight: 600 }}>
                        {sf.name} ({sf.key})
                      </div>
                      <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>←</span>
                      <div style={{ flex: "1 1 200px" }}>
                        <select
                          value={mappedVal}
                          onChange={(e) => {
                            const targetVal = e.target.value;
                            const nextMappings = { ...columnMappings };
                            if (targetVal) {
                              nextMappings[sf.key] = targetVal;
                            } else {
                              delete nextMappings[sf.key];
                            }
                            updateDraftLinkSource({ column_mappings: nextMappings });
                          }}
                          style={{ width: "100%", padding: "4px 8px", background: "white", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.82rem" }}
                        >
                          <option value="">— Do Not Copy / Manual Entry —</option>
                          {sourceSubFields.map((s: any) => (
                            <option key={s.key} value={s.key}>
                              {s.name} ({s.key})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Duplicate Handling Configuration */}
          <div style={{ marginTop: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", width: "100%", boxSizing: "border-box" }}>
            <label style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.25rem", display: "block" }}>Duplicate Handling</label>
            
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", width: "100%", boxSizing: "border-box" }}>
              <div style={{ flex: "1 1 200px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Remove Duplicates?</label>
                <select
                  value={removeDuplicates ? "yes" : "no"}
                  onChange={(e) => {
                    const yes = e.target.value === "yes";
                    updateDraftDuplicateHandling({
                      remove_duplicates: yes,
                      duplicate_keys: yes ? Object.keys(columnMappings).slice(0, 1) : []
                    });
                  }}
                  style={{ width: "100%", maxWidth: "100%", padding: "6px 8px", background: "white", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" }}
                >
                  <option value="no">No — Keep All Records</option>
                  <option value="yes">Yes — Remove Duplicate Records Based on Selected Column(s)</option>
                </select>
              </div>

              {removeDuplicates && (
                <div style={{ flex: "1 1 200px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Remove Duplicates Based On: *</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", padding: "0.5rem", borderRadius: 6, background: "white" }}>
                    {(currentMliSubFields || [])
                      .filter((sf) => !!columnMappings[sf.key])
                      .map((sf) => {
                        const isChecked = duplicateKeys.includes(sf.key);
                        return (
                          <label key={sf.key} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", cursor: "pointer", margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const nextKeys = e.target.checked
                                  ? [...duplicateKeys, sf.key]
                                  : duplicateKeys.filter((k: string) => k !== sf.key);
                                updateDraftDuplicateHandling({ duplicate_keys: nextKeys });
                              }}
                            />
                            {sf.name} ({sf.key})
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 5. Save Configuration Button */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="btn"
            style={{ padding: "6px 16px", borderRadius: 6, fontSize: "0.85rem", fontWeight: 600, border: "1px solid var(--border)" }}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="btn btn-primary"
          style={{ padding: "6px 16px", borderRadius: 6, fontSize: "0.85rem", fontWeight: 600 }}
        >
          Save Configuration
        </button>
      </div>

    </div>
  );
}
