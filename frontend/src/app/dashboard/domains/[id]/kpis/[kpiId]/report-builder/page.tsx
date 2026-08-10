"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
import {
  SubField,
  FieldSummary,
  MultiFilterConditionRow,
  emptyMultiFilterRow,
  payloadToFilterDraft,
  filterDraftToPayload,
  removeConditionFromPayload,
} from "@/lib/multiItemsFiltersHelper";
import MultiItemsAdvancedFiltersPanel from "@/components/MultiItemsAdvancedFiltersPanel";
import { isFieldVisible } from "@/lib/conditionalRules";

interface KpiSectionInfo {
  id: number;
  name: string;
  sort_order: number;
}

interface FieldDef {
  id: number;
  key: string;
  name: string;
  field_type: string;
  is_required: boolean;
  section_id?: number | null;
  config?: any;
  sub_fields?: SubField[];
}

interface FieldNode {
  field: FieldDef;
  children: FieldNode[];
}

const getParentField = (field: FieldDef, allFields: FieldDef[]): FieldDef | undefined => {
  if (field.config && field.config.condition_trigger_field_id !== undefined && field.config.condition_trigger_field_id !== null) {
    const triggerId = Number(field.config.condition_trigger_field_id);
    const parent = allFields.find(x => x.id === triggerId);
    if (parent) return parent;
  }
  for (const other of allFields) {
    if (other.config && Array.isArray(other.config.conditional_rules)) {
      for (const rule of other.config.conditional_rules) {
        const depFields = rule.dependent_fields || rule.dependent_field_ids || [];
        if (depFields.some((dep: any) => String(dep) === String(field.id) || String(dep) === String(field.key))) {
          return other;
        }
      }
    }
  }
  return undefined;
};

const buildTree = (allFields: FieldDef[]): FieldNode[] => {
  const nodesMap = new Map<number, FieldNode>();
  for (const f of allFields) {
    nodesMap.set(f.id, { field: f, children: [] });
  }

  const roots: FieldNode[] = [];
  for (const f of allFields) {
    const node = nodesMap.get(f.id)!;
    const parent = getParentField(f, allFields);

    if (parent && parent.id !== f.id) {
      const parentNode = nodesMap.get(parent.id);
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (node: FieldNode) => {
    node.children.sort((a, b) => {
      const sa = a.field.config?.sort_order ?? 0;
      const sb = b.field.config?.sort_order ?? 0;
      if (sa !== sb) return sa - sb;
      return a.field.id - b.field.id;
    });
    node.children.forEach(sortChildren);
  };

  roots.forEach(sortChildren);
  return roots;
};

export default function KpiReportBuilder() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const domainId = params.id;
  const kpiId = Number(params.kpiId);
  const organizationIdFromUrl = searchParams.get("organization_id");
  const yearParam = searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  const periodKeyFromUrl = searchParams.get("period_key") ?? "";
  const fromEntries = searchParams.get("from_entries") === "true";

  const backUrl = (() => {
    const backParams = new URLSearchParams();
    if (organizationIdFromUrl) backParams.set("organization_id", organizationIdFromUrl);
    if (yearParam && !fromEntries) backParams.set("year", yearParam);
    if (periodKeyFromUrl) backParams.set("period_key", periodKeyFromUrl);
    const queryStr = backParams.toString() ? `?${backParams.toString()}` : "";
    return fromEntries
      ? `/dashboard/entries/${kpiId}/${year}${queryStr}`
      : `/dashboard/domains/${domainId}/kpis/${kpiId}${queryStr}`;
  })();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth / Me States
  const [meRole, setMeRole] = useState<string | null>(null);
  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const token = getAccessToken();

  // KPI Data States
  const [kpiName, setKpiName] = useState("");
  const [kpiDesc, setKpiDesc] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [sections, setSections] = useState<KpiSectionInfo[]>([]);
  const [orgName, setOrgName] = useState("");

  // Report Form States
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfDescription, setPdfDescription] = useState("");
  const [scalarFieldOverrides, setScalarFieldOverrides] = useState<Record<string, string>>({});
  const [excludedScalarFields, setExcludedScalarFields] = useState<string[]>([]);
  const [editingScalarFieldId, setEditingScalarFieldId] = useState<number | null>(null);
  const [editingScalarValue, setEditingScalarValue] = useState("");
  const [customReportName, setCustomReportName] = useState("");
  const [fieldTree, setFieldTree] = useState<FieldNode[]>([]);
  
  // Multi line fields config
  // Key = field key (e.g. "research_pubs")
  const [multiLineConfig, setMultiLineConfig] = useState<Record<string, {
    selected_columns: string[];
    table_name: string;
    table_heading: string;
    table_subheader: string;
    filters: { conditions: any[]; _version: number };
    sort_order?: number | "" | null;
  }>>({});

  // Background PDF Job states
  const [pdfJobId, setPdfJobId] = useState<string | null>(null);
  const [pdfJobStatus, setPdfJobStatus] = useState<string | null>(null);
  const [pdfJobError, setPdfJobError] = useState<string | null>(null);
  const [pdfProgressInterval, setPdfProgressInterval] = useState<any>(null);
  const [showFormatModal, setShowFormatModal] = useState(false);

  // Tab views
  const [activeTab, setActiveTab] = useState<"general" | "tables">("general");
  const [expandedTableKeys, setExpandedTableKeys] = useState<Record<string, boolean>>({});
  const [excludedMultiLineFields, setExcludedMultiLineFields] = useState<string[]>([]);

  // Advanced Filters UI Draft State (per table field key)
  const [openFilterFieldKey, setOpenFilterFieldKey] = useState<string | null>(null);
  const [filterDrafts, setFilterDrafts] = useState<Record<string, MultiFilterConditionRow[]>>({});
  const [sourceKpiFieldsById, setSourceKpiFieldsById] = useState<Record<number, FieldSummary[]>>({});
  const [refFilterOptions, setRefFilterOptions] = useState<Record<string, string[]>>({});

  const effectiveOrgId = organizationIdFromUrl ? Number(organizationIdFromUrl) : (meOrgId ?? undefined);

  // Retrieve user role & organization
  useEffect(() => {
    if (!token) {
      router.push("/auth/login");
      return;
    }
    api<{ organization_id: number | null; role?: string | { value?: string } }>("/auth/me", { token })
      .then((me) => {
        setMeOrgId(me.organization_id ?? null);
        const r = me.role;
        const roleStr = typeof r === "string" ? r : r?.value ?? null;
        setMeRole(roleStr);
        if (roleStr !== "ORG_ADMIN") {
          setError("Access Denied: Only Organizational Admins can access this KPI Report Builder page.");
          setLoading(false);
        }
      })
      .catch(() => {
        router.push("/auth/login");
      });
  }, [token, router]);

  // Load KPI definitions
  useEffect(() => {
    if (!token || !kpiId || !effectiveOrgId || meRole !== "ORG_ADMIN") return;

    setLoading(true);
    setError(null);

    Promise.all([
      api<{ name: string; description?: string }>(`/kpis/${kpiId}?organization_id=${effectiveOrgId}`, { token }),
      api<FieldDef[]>(`/entries/fields?kpi_id=${kpiId}&organization_id=${effectiveOrgId}`, { token }),
      api<KpiSectionInfo[]>(`/kpis/${kpiId}/sections?organization_id=${effectiveOrgId}`, { token }).catch(() => []),
      api<{ name: string }>(`/organizations/${effectiveOrgId}`, { token }).catch(() => ({ name: "" })),
      api<any>(`/entries/for-period?kpi_id=${kpiId}&year=${year}&period_key=${periodKeyFromUrl || ""}&organization_id=${effectiveOrgId}`, { token }).catch(() => null),
    ])
      .then(([kpiData, fieldsData, sectionsData, orgData, entryData]) => {
        setKpiName(kpiData.name);
        setKpiDesc(kpiData.description ?? "");
        setSections(sectionsData);
        setOrgName(orgData.name);

        const valuesList = entryData?.values || [];
        const valuesMap: Record<number, any> = {};
        valuesList.forEach((v: any) => {
          valuesMap[v.field_id] = v;
        });

        // Filter out conditionally hidden fields using isFieldVisible
        const visibleFieldsData = fieldsData.filter(f => 
          isFieldVisible(f as any, fieldsData as any, {}, valuesMap, false)
        );
        setFields(visibleFieldsData);

        // Prepopulate defaults
        setPdfTitle(`${kpiData.name} Report`);
        setCustomReportName(kpiData.name);

        const tree = buildTree(visibleFieldsData);
        tree.sort((a, b) => {
          const sa = a.field.config?.sort_order ?? 0;
          const sb = b.field.config?.sort_order ?? 0;
          if (sa !== sb) return sa - sb;
          return a.field.id - b.field.id;
        });
        setFieldTree(tree);

        const initialConfig: typeof multiLineConfig = {};
        const drafts: typeof filterDrafts = {};
        const initialExpanded: Record<string, boolean> = {};
        
        visibleFieldsData.forEach((f) => {
          if (f.field_type === "multi_line_items") {
            const cols = f.sub_fields?.map((sf) => sf.key) || [];
            initialConfig[f.key] = {
              selected_columns: cols.slice(0, 8), // Keep max 8 initially
              table_name: f.name || "",
              table_heading: f.name || "",
              table_subheader: "Performance Metrics & Details",
              filters: { conditions: [], _version: 2 },
              sort_order: ""
            };
            drafts[f.key] = [emptyMultiFilterRow()];
            initialExpanded[f.key] = true;
          }
        });

        setMultiLineConfig(initialConfig);
        setFilterDrafts(drafts);
        setExpandedTableKeys(initialExpanded);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load KPI details");
        setLoading(false);
      });
  }, [token, kpiId, effectiveOrgId, meRole]);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (pdfProgressInterval) clearInterval(pdfProgressInterval);
    };
  }, [pdfProgressInterval]);

  // Validation: limit 8 columns
  const columnWarnings = useMemo(() => {
    const warnings: Record<string, string | null> = {};
    Object.entries(multiLineConfig).forEach(([key, cfg]) => {
      if (cfg.selected_columns.length > 8) {
        warnings[key] = "Selected columns exceed the readable limit of this report format. Please unselect some previous columns before generating the report.";
      } else {
        warnings[key] = null;
      }
    });
    return warnings;
  }, [multiLineConfig]);

  const hasTooManyColumns = Object.values(columnWarnings).some((w) => w !== null);

  const handleGeneratePdf = async (format: "pdf" | "docx") => {
    if (!token || !effectiveOrgId || !kpiId) return;
    if (hasTooManyColumns) {
      toast.error("Please resolve the column limits before exporting.");
      return;
    }

    setPdfJobStatus("pending");
    setPdfJobError(null);
    try {
      const url = getApiUrl(`/kpis/${kpiId}/reports/generate?organization_id=${effectiveOrgId}`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          year: year,
          period_key: periodKeyFromUrl || "",
          title: pdfTitle,
          description: pdfDescription,
          scalar_fields: scalarFieldOverrides,
          excluded_scalar_fields: excludedScalarFields,
          excluded_multi_line_fields: excludedMultiLineFields,
          ordered_scalar_fields: fieldTree.map(node => String(node.field.id)),
          multi_line_fields: multiLineConfig,
          format: format
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to start report generation");
      }

      const data = await res.json();
      setPdfJobId(data.job_id);
      setPdfJobStatus(data.status);
      toast("Report generation started in the background...");

      const interval = setInterval(async () => {
        try {
          const pollUrl = getApiUrl(`/kpis/${kpiId}/reports/jobs/${data.job_id}?organization_id=${effectiveOrgId}`);
          const pollRes = await fetch(pollUrl, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!pollRes.ok) throw new Error("Failed to check status");
          const pollData = await pollRes.json();
          setPdfJobStatus(pollData.status);

          if (pollData.status === "completed") {
            clearInterval(interval);
            setPdfProgressInterval(null);
            toast.success(format === "docx" ? "Word Report generated successfully!" : "PDF Report generated successfully!");

            const downloadUrl = getApiUrl(`/kpis/${kpiId}/reports/jobs/${data.job_id}/download?organization_id=${effectiveOrgId}`);
            const downloadRes = await fetch(downloadUrl, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (downloadRes.ok) {
              const blob = await downloadRes.blob();
              const contentType = downloadRes.headers.get("content-type") || "";
              const isZip = contentType.toLowerCase().includes("zip") || blob.type.toLowerCase().includes("zip");
              const isDocx = contentType.toLowerCase().includes("wordprocessingml") || contentType.toLowerCase().includes("docx") || format === "docx";
              const finalFilename = customReportName.trim() || kpiName || "kpi_report";
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              let ext = "pdf";
              if (isZip) ext = "zip";
              else if (isDocx) ext = "docx";
              a.download = `${finalFilename.replace(/\s+/g, "_")}.${ext}`;
              a.click();
              URL.revokeObjectURL(a.href);
              setPdfJobStatus(null);
            }
          } else if (pollData.status === "failed") {
            clearInterval(interval);
            setPdfProgressInterval(null);
            setPdfJobError(pollData.error_message || "Generation failed");
            toast.error(`Report generation failed: ${pollData.error_message || "Unknown error"}`);
          }
        } catch (e: any) {
          clearInterval(interval);
          setPdfProgressInterval(null);
          setPdfJobStatus("failed");
          setPdfJobError(e.message || "Status check failed");
        }
      }, 2000);

      setPdfProgressInterval(interval);
    } catch (e: any) {
      setPdfJobStatus("failed");
      setPdfJobError(e.message || "Failed to trigger report generation");
      toast.error(e.message || "Failed to start generation");
    }
  };

  const handleToggleColumn = (fieldKey: string, colKey: string) => {
    setMultiLineConfig((prev) => {
      const cfg = prev[fieldKey];
      if (!cfg) return prev;
      const isSelected = cfg.selected_columns.includes(colKey);
      const nextCols = isSelected
        ? cfg.selected_columns.filter((c) => c !== colKey)
        : [...cfg.selected_columns, colKey];
      return {
        ...prev,
        [fieldKey]: { ...cfg, selected_columns: nextCols }
      };
    });
  };

  const handleMoveColumn = (fieldKey: string, index: number, direction: "up" | "down") => {
    setMultiLineConfig((prev) => {
      const cfg = prev[fieldKey];
      if (!cfg) return prev;
      const cols = [...cfg.selected_columns];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= cols.length) return prev;

      // Swap
      const temp = cols[index];
      cols[index] = cols[targetIndex];
      cols[targetIndex] = temp;

      return {
        ...prev,
        [fieldKey]: { ...cfg, selected_columns: cols }
      };
    });
  };

  const moveRootNode = (index: number, direction: "up" | "down") => {
    setFieldTree((prev) => {
      const list = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= list.length) return prev;
      
      // Swap blocks
      const temp = list[index];
      list[index] = list[targetIndex];
      list[targetIndex] = temp;
      return list;
    });
  };

  const renderTableConfig = (f: FieldDef) => {
    const cfg = multiLineConfig[f.key];
    if (!cfg) return null;
    const isExpanded = expandedTableKeys[f.key] !== false;
    const warning = columnWarnings[f.key];

    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "8px",
          overflow: "hidden",
          background: "var(--bg-card)",
          marginTop: "0.25rem",
          marginBottom: "0.5rem"
        }}
      >
        <div
          onClick={() => setExpandedTableKeys((prev) => ({ ...prev, [f.key]: !isExpanded }))}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.5rem 0.75rem",
            background: "var(--bg-subtle)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.85rem"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span>Table Settings</span>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 400 }}>
              ({cfg.selected_columns.length} cols)
            </span>
            {warning && (
              <span style={{ color: "var(--error)", fontSize: "0.75rem" }}>⚠️ Limit Exceeded</span>
            )}
          </div>
          <span>{isExpanded ? "▲" : "▼"}</span>
        </div>

        {isExpanded && (
          <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {warning && (
              <div style={{ color: "var(--error)", fontSize: "0.8rem", padding: "0.4rem", background: "rgba(220, 38, 38, 0.08)", borderRadius: "6px", border: "1px solid rgba(220, 38, 38, 0.2)" }}>
                {warning}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: "0.75rem" }}>Table Title</label>
                <input
                  type="text"
                  value={cfg.table_heading}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMultiLineConfig((prev) => ({
                      ...prev,
                      [f.key]: { ...prev[f.key], table_heading: val }
                    }));
                  }}
                  style={{ padding: "0.3rem 0.5rem", fontSize: "0.8rem", width: "100%" }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: "0.75rem" }}>Table Subtitle</label>
                <input
                  type="text"
                  value={cfg.table_subheader}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMultiLineConfig((prev) => ({
                      ...prev,
                      [f.key]: { ...prev[f.key], table_subheader: val }
                    }));
                  }}
                  style={{ padding: "0.3rem 0.5rem", fontSize: "0.8rem", width: "100%" }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary)" }}>
                Select & Order Columns (Max 8)
              </label>
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem", maxHeight: "150px", overflowY: "auto", background: "var(--surface)" }}>
                  {f.sub_fields?.map((sf) => {
                    const isChecked = cfg.selected_columns.includes(sf.key);
                    return (
                      <label
                        key={sf.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          fontSize: "0.8rem",
                          padding: "0.15rem 0",
                          cursor: "pointer",
                          color: isChecked ? "var(--text)" : "var(--text-secondary)"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleColumn(f.key, sf.key)}
                        />
                        <span>{sf.name}</span>
                      </label>
                    );
                  })}
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem", maxHeight: "150px", overflowY: "auto", background: "var(--bg-subtle)" }}>
                  {cfg.selected_columns.length === 0 ? (
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
                      No columns selected
                    </span>
                  ) : (
                    cfg.selected_columns.map((col, idx) => {
                      const sf = f.sub_fields?.find((s) => s.key === col);
                      return (
                        <div
                          key={col}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            padding: "0.15rem 0.3rem",
                            marginBottom: "0.15rem",
                            fontSize: "0.75rem"
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>{sf?.name || col}</span>
                          <div style={{ display: "flex", gap: "0.1rem" }}>
                            <button
                              type="button"
                              className="btn"
                              disabled={idx === 0}
                              onClick={() => handleMoveColumn(f.key, idx, "up")}
                              style={{ padding: "0.05rem 0.2rem", fontSize: "0.65rem" }}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={idx === cfg.selected_columns.length - 1}
                              onClick={() => handleMoveColumn(f.key, idx, "down")}
                              style={{ padding: "0.05rem 0.2rem", fontSize: "0.65rem" }}
                            >
                              ▼
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                  Filters
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setOpenFilterFieldKey(openFilterFieldKey === f.key ? null : f.key)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem"
                  }}
                >
                  <span>Filters {openFilterFieldKey === f.key ? "▲" : "▼"}</span>
                </button>
              </div>

              {openFilterFieldKey === f.key && token && effectiveOrgId && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <MultiItemsAdvancedFiltersPanel
                    token={token}
                    effectiveOrgId={effectiveOrgId}
                    subFields={(f.sub_fields || [])}
                    filterDraft={filterDrafts[f.key] || [emptyMultiFilterRow()]}
                    setFilterDraft={(action) => {
                      setFilterDrafts((prev) => {
                        const old = prev[f.key] || [emptyMultiFilterRow()];
                        const next = typeof action === "function" ? action(old) : action;
                        return { ...prev, [f.key]: next };
                      });
                    }}
                    sourceKpiFieldsById={sourceKpiFieldsById}
                    setSourceKpiFieldsById={setSourceKpiFieldsById}
                    refFilterOptions={refFilterOptions}
                    setRefFilterOptions={setRefFilterOptions}
                    onApply={(draft) => {
                      const payload = filterDraftToPayload(draft, f.sub_fields || []);
                      setMultiLineConfig((prev) => ({
                        ...prev,
                        [f.key]: {
                          ...prev[f.key],
                          filters: payload || { conditions: [], _version: 2 }
                        }
                      }));
                      setOpenFilterFieldKey(null);
                    }}
                    onClose={() => setOpenFilterFieldKey(null)}
                    showCloseButton={false}
                  />
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                {cfg.filters.conditions.length === 0 ? (
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>No active filters</span>
                ) : (
                  cfg.filters.conditions.map((cond, condIdx) => {
                    const sub = f.sub_fields?.find((s) => s.key === cond.field);
                    return (
                      <div
                        key={condIdx}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          background: "var(--bg-subtle)",
                          border: "1px solid var(--border)",
                          borderRadius: "16px",
                          padding: "0.1rem 0.4rem",
                          fontSize: "0.7rem",
                          gap: "0.2rem"
                        }}
                      >
                        <span>
                          {sub?.name || cond.field} {cond.op} {String(cond.value ?? cond.values?.join(", "))}
                        </span>
                        <button
                          type="button"
                          style={{ border: "none", background: "none", color: "var(--error)", cursor: "pointer", fontWeight: 700 }}
                          onClick={() => {
                            const nextPayload = removeConditionFromPayload(cfg.filters as any, condIdx);
                            setMultiLineConfig((prev) => ({
                              ...prev,
                              [f.key]: {
                                ...prev[f.key],
                                filters: nextPayload || { conditions: [], _version: 2 }
                              }
                            }));
                            setFilterDrafts((prev) => ({
                              ...prev,
                              [f.key]: payloadToFilterDraft(nextPayload)
                            }));
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
      </div>
    );
  };

  const renderFieldNode = (node: FieldNode, depth: number, index: number) => {
    const field = node.field;
    const isExcluded = field.field_type === "multi_line_items"
      ? excludedMultiLineFields.includes(field.key) || excludedMultiLineFields.includes(String(field.id))
      : excludedScalarFields.includes(field.key) || excludedScalarFields.includes(String(field.id));

    if (isExcluded) return null;

    const val = field.field_type === "multi_line_items"
      ? field.name
      : scalarFieldOverrides[field.key] || scalarFieldOverrides[String(field.id)] || field.name;

    const isEditing = editingScalarFieldId === field.id;
    const isRoot = depth === 0;

    return (
      <div 
        key={field.id} 
        style={{ 
          display: "flex", 
          flexDirection: "column", 
          gap: "0.5rem",
          marginLeft: depth > 0 ? `${depth * 1.25}rem` : "0",
          borderLeft: depth > 0 ? "1px dashed var(--border)" : "none",
          paddingLeft: depth > 0 ? "0.75rem" : "0",
          marginBottom: "0.5rem"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            background: isRoot ? "var(--bg-subtle)" : "var(--surface)"
          }}
        >
          {isEditing ? (
            <div style={{ display: "flex", flex: 1, gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                value={editingScalarValue}
                onChange={(e) => setEditingScalarValue(e.target.value)}
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem", flex: 1, background: "var(--bg-subtle)", color: "var(--text)" }}
                placeholder="Label override..."
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                onClick={() => {
                  setScalarFieldOverrides((prev) => ({
                    ...prev,
                    [field.key]: editingScalarValue,
                    [String(field.id)]: editingScalarValue,
                  }));
                  setEditingScalarFieldId(null);
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="btn"
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                onClick={() => setEditingScalarFieldId(null)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  {val}
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 400, marginLeft: "0.4rem" }}>
                    ({field.field_type})
                  </span>
                </span>
                {val !== field.name && (
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                    Original: {field.name}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {isRoot && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={index === 0}
                      onClick={() => moveRootNode(index, "up")}
                      style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={index === fieldTree.length - 1}
                      onClick={() => moveRootNode(index, "down")}
                      style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
                    >
                      ▼
                    </button>
                  </>
                )}
                {field.field_type !== "multi_line_items" && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
                    onClick={() => {
                      setEditingScalarFieldId(field.id);
                      setEditingScalarValue(val);
                    }}
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  style={{
                    padding: "0.2rem 0.4rem",
                    fontSize: "0.75rem",
                    color: "var(--error)",
                    borderColor: "var(--error)"
                  }}
                  onClick={() => {
                    if (field.field_type === "multi_line_items") {
                      setExcludedMultiLineFields((prev) => [...prev, field.key, String(field.id)]);
                    } else {
                      setExcludedScalarFields((prev) => [...prev, field.key, String(field.id)]);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>

        {field.field_type === "multi_line_items" && renderTableConfig(field)}

        {node.children.map((child, childIdx) => renderFieldNode(child, depth + 1, childIdx))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="container" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh" }}>
        <div className="report-load-progress-bar">
          <div className="report-load-progress-bar__fill" />
        </div>
        <p style={{ marginTop: "1rem", color: "var(--text-secondary)" }}>Loading Report Builder configurations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ padding: "2rem", maxWidth: "600px", margin: "10vh auto" }}>
        <div className="card" style={{ borderColor: "var(--error)" }}>
          <h2 style={{ color: "var(--error)", marginBottom: "1rem" }}>Access Denied / Error</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{error}</p>
          <button className="btn btn-primary" onClick={() => router.push(backUrl)}>
            Back to KPI
          </button>
        </div>
      </div>
    );
  }

  const scalarFields = fields.filter((f) => f.field_type !== "multi_line_items");
  const multiLineFields = fields.filter((f) => f.field_type === "multi_line_items");

  return (
    <div className="container" style={{ maxWidth: "1280px", margin: "0 auto", padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <button
              onClick={() => router.push(backUrl)}
              className="btn btn-secondary"
              style={{
                padding: "0.4rem 1rem",
                fontSize: "0.85rem",
                fontWeight: 600,
                borderRadius: "6px",
              }}
            >
              Back
            </button>
          </div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--text)", marginTop: "0.25rem" }}>
            PDF Report Builder
          </h1>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            KPI: <span style={{ fontWeight: 600 }}>{kpiName}</span>
          </p>
        </div>
        
        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {pdfJobStatus && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="report-load-progress-bar" style={{ minWidth: "100px" }}>
                <span className="report-load-progress-bar__fill" />
              </span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Generating...
              </span>
            </div>
          )}
          <button
            onClick={() => {
              if (hasTooManyColumns) {
                toast.error("Please resolve the column limits before exporting.");
                return;
              }
              setShowFormatModal(true);
            }}
            disabled={pdfJobStatus === "pending" || pdfJobStatus === "running"}
            className="btn btn-primary"
            style={{ fontWeight: 600, padding: "0.6rem 1.25rem" }}
          >
            Generate & Export
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="report-design-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "1.5rem" }}>
        
        {/* Left Column: General Configuration & Exclusions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card">
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1.25rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
              General Settings
            </h2>
            
            <div className="form-group">
              <label>Report Header <span style={{ color: "var(--error)" }}>*</span></label>
              <input
                type="text"
                value={pdfTitle}
                onChange={(e) => setPdfTitle(e.target.value)}
                placeholder="Enter report title..."
                required
              />
            </div>

            <div className="form-group">
              <label>Report File Name (Optional)</label>
              <input
                type="text"
                value={customReportName}
                onChange={(e) => setCustomReportName(e.target.value)}
                placeholder="Enter name of report / filename..."
              />
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginTop: "0.25rem" }}>
                This name will be used as the filename for the downloaded PDF or ZIP file. Defaults to KPI name.
              </span>
            </div>

            <div className="form-group">
              <label>Description (Optional)</label>
              <textarea
                value={pdfDescription}
                onChange={(e) => setPdfDescription(e.target.value)}
                placeholder="Enter description text..."
                rows={4}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontSize: "0.9rem",
                  fontFamily: "inherit",
                  resize: "vertical"
                }}
              />
            </div>
          </div>

          {/* Excluded Fields & Tables Card */}
          {(excludedScalarFields.length > 0 || excludedMultiLineFields.length > 0) && (
            <div className="card">
              <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
                Excluded Fields & Tables
              </h2>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                Click "+" to restore any field or table back to the report.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {fields
                  .filter(f => 
                    excludedScalarFields.includes(f.key) || 
                    excludedScalarFields.includes(String(f.id)) || 
                    excludedMultiLineFields.includes(f.key) || 
                    excludedMultiLineFields.includes(String(f.id))
                  )
                  .map(f => (
                    <div
                      key={f.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        background: "var(--bg-subtle)",
                        border: "1px solid var(--border)",
                        borderRadius: "16px",
                        padding: "0.2rem 0.5rem",
                        fontSize: "0.75rem",
                        gap: "0.25rem"
                      }}
                    >
                      <span>{f.name}</span>
                      <button
                        type="button"
                        style={{ border: "none", background: "none", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 700 }}
                        onClick={() => {
                          if (f.field_type === "multi_line_items") {
                            setExcludedMultiLineFields((prev) => prev.filter(k => k !== f.key && k !== String(f.id)));
                          } else {
                            setExcludedScalarFields((prev) => prev.filter(k => k !== f.key && k !== String(f.id)));
                          }
                        }}
                      >
                        +
                      </button>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Unified KPI Fields Hierarchy */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card">
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
              KPI Report Structure
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
              Dependent fields are nested hierarchically and will stay with their parents. Reorder root fields using ▲/▼. Tables can be configured inline.
            </p>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "800px", overflowY: "auto", paddingRight: "0.25rem" }}>
              {fieldTree.length === 0 ? (
                <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
                  No visible fields available in this period.
                </p>
              ) : (
                fieldTree.map((node, index) => renderFieldNode(node, 0, index))
              )}
            </div>
          </div>
        </div>

      </div>

      {showFormatModal && (
        <div
          role="dialog"
          aria-modal="true"
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
          onClick={() => setShowFormatModal(false)}
        >
          <div className="card" style={{ maxWidth: 380, width: "100%", padding: "1.5rem" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.15rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Select Export Format
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
              Please choose the file format you want to export your KPI report in.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  borderColor: "var(--border)",
                  borderRadius: "0.375rem",
                  textAlign: "left",
                  background: "var(--bg-card)",
                  cursor: "pointer",
                  width: "100%"
                }}
                onClick={() => {
                  setShowFormatModal(false);
                  handleGeneratePdf("pdf");
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-primary)" }}>PDF Document (.pdf)</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Includes zipped attachments if present</div>
                </div>
                <span style={{ fontSize: "1.25rem", color: "var(--text-secondary)" }}>→</span>
              </button>
              
              <button
                type="button"
                className="btn btn-outline"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  borderColor: "var(--border)",
                  borderRadius: "0.375rem",
                  textAlign: "left",
                  background: "var(--bg-card)",
                  cursor: "pointer",
                  width: "100%"
                }}
                onClick={() => {
                  setShowFormatModal(false);
                  handleGeneratePdf("docx");
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-primary)" }}>Word Document (.docx)</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Formatted text and tables (excluding attachments)</div>
                </div>
                <span style={{ fontSize: "1.25rem", color: "var(--text-secondary)" }}>→</span>
              </button>
            </div>
            
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowFormatModal(false)}
                style={{ fontSize: "0.875rem" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
