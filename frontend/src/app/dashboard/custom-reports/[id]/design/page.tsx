"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface KPIField {
  id: number;
  key: string;
  name: string;
  field_type: string;
}

interface KPI {
  id: number;
  name: string;
  fields: KPIField[];
}

interface CustomReportField {
  id?: number;
  kpi_field_id: number;
  field_key: string;
  field_name: string;
  field_type: string;
  sort_order: number;
  kpi_id: number;
}

interface CustomReportSection {
  id?: number;
  kpi_id: number;
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
}

export default function CustomReportDesignPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgId = Number(searchParams.get("organization_id"));

  const [report, setReport] = useState<CustomReportDetail | null>(null);
  const [sections, setSections] = useState<CustomReportSection[]>([]);
  
  // KPI Search lists
  const [allKpis, setAllKpis] = useState<KPI[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSaving, setSaveSaving] = useState(false);

  // Live Preview properties
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewYear, setPreviewYear] = useState(() => new Date().getFullYear());
  const [previewLoading, setPreviewLoading] = useState(false);

  // Drag and drop states
  const [draggedSectionIdx, setDraggedSectionIdx] = useState<number | null>(null);
  const [draggedFieldLoc, setDraggedFieldLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = useState<number | null>(null);
  const [dragOverFieldLoc, setDragOverFieldLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);

  // Fetch report details and KPIs list
  useEffect(() => {
    const token = getAccessToken();
    if (!token || !id || !orgId) return;

    setLoading(true);
    Promise.all([
      api<CustomReportDetail>(`/custom-reports/${id}/detail?organization_id=${orgId}`, { token }),
      api<any[]>(`/kpis?organization_id=${orgId}`, { token }),
    ])
      .then(async ([detail, kpisData]) => {
        setReport(detail);
        setSections(detail.sections.sort((a, b) => a.sort_order - b.sort_order));

        // Fetch fields for each organization KPI to construct full KPI options
        const fullKpis: KPI[] = [];
        for (const k of kpisData) {
          try {
            const fields = await api<KPIField[]>(`/fields?kpi_id=${k.id}&organization_id=${orgId}`, { token });
            fullKpis.push({
              id: k.id,
              name: k.name,
              fields: fields || [],
            });
          } catch (e) {
            fullKpis.push({ id: k.id, name: k.name, fields: [] });
          }
        }
        setAllKpis(fullKpis);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load designer data"))
      .finally(() => setLoading(false));
  }, [id, orgId]);

  // Load live preview
  const fetchPreview = async (yearVal: number) => {
    const token = getAccessToken();
    if (!token || !id) return;

    setPreviewLoading(true);
    try {
      const data = await api<{ rendered_html?: string }>(
        `/custom-reports/${id}/generate?year=${yearVal}&organization_id=${orgId}`,
        { token }
      );
      setPreviewHtml(data.rendered_html || "<p>No content generated</p>");
    } catch (e) {
      setPreviewHtml(`<p style="color: var(--error);">Failed to generate preview: ${e instanceof Error ? e.message : "error"}</p>`);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (id && orgId && !loading) {
      fetchPreview(previewYear);
    }
  }, [id, orgId, loading, previewYear]);

  // Search filter
  const filteredKpis = useMemo(() => {
    return allKpis.filter((k) =>
      k.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allKpis, searchQuery]);

  // Add KPI as section
  const handleAddKpi = (kpi: KPI) => {
    // Check if section for this KPI already exists
    if (sections.some((s) => s.kpi_id === kpi.id)) {
      toast.error("KPI is already added as a section in this report");
      return;
    }

    // Map fields
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
  };

  // Remove section
  const handleRemoveSection = (secIdx: number) => {
    setSections((prev) => {
      const next = prev.filter((_, idx) => idx !== secIdx);
      // Re-index sort order
      return next.map((s, idx) => ({ ...s, sort_order: idx }));
    });
  };

  // Remove field
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
  };

  // Handle section header edit
  const handleSectionHeaderChange = (secIdx: number, val: string) => {
    setSections((prev) => {
      return prev.map((s, idx) => {
        if (idx !== secIdx) return s;
        return { ...s, custom_header: val || null };
      });
    });
  };

  // Reordering calculations for display numbering
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

  // Section Drag and Drop handlers
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

  // Field Drag and Drop handlers
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

      // Extract field from source section
      const [moved] = next[sourceSecIdx].fields.splice(sourceFieldIdx, 1);

      // Re-index source section fields
      next[sourceSecIdx].fields = next[sourceSecIdx].fields.map((f, idx) => ({ ...f, sort_order: idx }));

      // Insert field into target section
      next[secIdx].fields.splice(targetFieldIdx, 0, moved);

      // Re-index target section fields
      next[secIdx].fields = next[secIdx].fields.map((f, idx) => ({ ...f, sort_order: idx }));

      return next;
    });

    setDraggedFieldLoc(null);
    setDragOverFieldLoc(null);
  };

  // Layout save trigger
  const handleSave = async (andExit = false) => {
    const token = getAccessToken();
    if (!token || !id) return;

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
          })),
        })),
      };

      await api(`/custom-reports/${id}/layout?organization_id=${orgId}`, {
        method: "PUT",
        token,
        body: JSON.stringify(payload),
      });

      toast.success("Report layout saved successfully");
      fetchPreview(previewYear);

      if (andExit) {
        router.push(`/dashboard/custom-reports?organization_id=${orgId}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save layout");
    } finally {
      setSaveSaving(false);
    }
  };

  if (loading) return <p style={{ padding: "1.5rem" }}>Loading designer configuration...</p>;
  if (error) return <p className="form-error" style={{ margin: "1.5rem" }}>{error}</p>;

  return (
    <div style={{ padding: "0 1rem 1rem", height: "calc(100vh - 80px)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            Designer: {report?.name}
          </h1>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.85rem" }}>
            Drag sections and fields to arrange layouts. Rename headings directly.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn" onClick={() => router.push(`/dashboard/custom-reports?organization_id=${orgId}`)}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => handleSave(false)} disabled={saveSaving}>
            Save Layout
          </button>
          <button type="button" className="btn btn-primary" onClick={() => handleSave(true)} disabled={saveSaving}>
            {saveSaving ? "Saving..." : "Save & Close"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: "1.5rem" }}>
        {/* Left Column: Layout designer */}
        <div style={{ flex: "0 0 520px", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "1rem", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)" }}>Add KPIs to Report</h3>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search available KPIs..."
              style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            {searchQuery && (
              <div style={{ maxHeight: 150, overflowY: "auto", marginTop: "0.5rem", border: "1px solid var(--border)", borderRadius: 6, background: "white" }}>
                {filteredKpis.length === 0 ? (
                  <p style={{ padding: "0.5rem", fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>No KPIs found</p>
                ) : (
                  filteredKpis.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => handleAddKpi(k)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "0.5rem",
                        textAlign: "left",
                        fontSize: "0.85rem",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.2s"
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      + {k.name} <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>({k.fields.length} fields)</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)" }}>Report Structure</h3>
            {displaySections.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", border: "2px dashed var(--border)", borderRadius: 8, color: "var(--muted)" }}>
                No sections added yet. Search and click a KPI above to add it.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {displaySections.map((sec, sIdx) => {
                  const isSectionDragged = draggedSectionIdx === sIdx;
                  const isSectionDragOver = dragOverSectionIdx === sIdx;
                  return (
                    <div
                      key={sec.kpi_id}
                      draggable
                      onDragStart={() => handleSectionDragStart(sIdx)}
                      onDragOver={(e) => handleSectionDragOver(e, sIdx)}
                      onDrop={() => handleSectionDrop(sIdx)}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: isSectionDragOver ? "#eff6ff" : "white",
                        opacity: isSectionDragged ? 0.4 : 1,
                        cursor: "grab",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                      }}
                    >
                      {/* Section Header */}
                      <div
                        style={{
                          padding: "0.6rem 0.75rem",
                          background: "#f8fafc",
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          borderTopLeftRadius: 7,
                          borderTopRightRadius: 7
                        }}
                      >
                        <span style={{ fontSize: "1.1rem", color: "#94a3b8", cursor: "grab" }}>☰</span>
                        <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: "0.9rem" }}>{sec.number}</span>
                        <input
                          value={sec.custom_header || ""}
                          onChange={(e) => handleSectionHeaderChange(sIdx, e.target.value)}
                          placeholder={sec.kpi_name}
                          style={{
                            flex: 1,
                            padding: "0.2rem 0.4rem",
                            fontSize: "0.9rem",
                            fontWeight: 600,
                            borderRadius: 4,
                            border: "1px solid transparent",
                            background: "transparent"
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.border = "1px solid var(--border)";
                            e.currentTarget.style.background = "white";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.border = "1px solid transparent";
                            e.currentTarget.style.background = "transparent";
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveSection(sIdx)}
                          style={{
                            border: "none",
                            background: "none",
                            color: "var(--error)",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            fontWeight: 500
                          }}
                        >
                          Remove
                        </button>
                      </div>

                      {/* Section Fields (Drop Target for Fields) */}
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleFieldDrop(sIdx, sec.fields.length)}
                        style={{ padding: "0.5rem", minHeight: 40, display: "flex", flexDirection: "column", gap: "0.4rem" }}
                      >
                        {sec.fields.length === 0 ? (
                          <div style={{ padding: "0.5rem", textAlign: "center", color: "var(--muted)", fontSize: "0.8rem", fontStyle: "italic" }}>
                            Drop fields here
                          </div>
                        ) : (
                          sec.fields.map((f, fIdx) => {
                            const isFieldDragged = draggedFieldLoc?.secIdx === sIdx && draggedFieldLoc?.fieldIdx === fIdx;
                            const isFieldDragOver = dragOverFieldLoc?.secIdx === sIdx && dragOverFieldLoc?.fieldIdx === fIdx;
                            return (
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
                                  padding: "0.4rem 0.6rem",
                                  background: isFieldDragOver ? "#eff6ff" : "#f1f5f9",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: 6,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.4rem",
                                  opacity: isFieldDragged ? 0.4 : 1,
                                  cursor: "grab"
                                }}
                              >
                                <span style={{ color: "#cbd5e1" }}>⁝⁝</span>
                                <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>{f.number}</span>
                                <span style={{ fontSize: "0.85rem", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {f.field_name}
                                </span>
                                {f.kpi_id !== sec.kpi_id && (
                                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.3rem", borderRadius: 4, background: "#e2e8f0", color: "#64748b" }}>
                                    Moved
                                  </span>
                                )}
                                <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
                                  {f.field_type === "multi_line_items" ? "MLI" : "Scalar"}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveField(sIdx, fIdx);
                                  }}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    color: "#94a3b8",
                                    cursor: "pointer",
                                    fontSize: "0.9rem"
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--error)")}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Preview iframe */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text)" }}>Live Preview</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Year</label>
              <select
                value={previewYear}
                onChange={(e) => setPreviewYear(Number(e.target.value))}
                style={{ padding: "0.25rem 0.5rem", borderRadius: 4, border: "1px solid var(--border)", fontSize: "0.85rem" }}
              >
                {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                onClick={() => fetchPreview(previewYear)}
                disabled={previewLoading}
              >
                {previewLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, padding: "1rem", background: "#f8fafc", position: "relative" }}>
            {previewLoading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
                <p>Generating preview...</p>
              </div>
            )}
            <iframe
              title="Layout live preview"
              srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:inherit;margin:1rem;color:#111;line-height:1.5;}</style></head><body>${previewHtml || "<p style='color: #64748b;'>Save layout to refresh preview content.</p>"}</body></html>`}
              style={{ width: "100%", height: "100%", background: "white", border: "1px solid var(--border)", borderRadius: 6 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
