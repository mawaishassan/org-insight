"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { makeAttachmentCellValue } from "@/lib/attachmentCellValue";
import { AttachmentFieldControl } from "@/components/AttachmentFieldControl";
import { toast } from "react-toastify";
import MultiReferenceInput from "@/components/MultiReferenceInput";

type MixedAtom = string | number;

function inferMixedAtom(raw: string): MixedAtom | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; // ISO date
  const num = Number(t.replace(/,/g, ""));
  if (!Number.isNaN(num) && Number.isFinite(num) && /^[+-]?\d[\d,]*(\.\d+)?$/.test(t)) {
    return Number.isInteger(num) ? Math.trunc(num) : num;
  }
  return t;
}

function MixedListCellEditor({
  label,
  required,
  items,
  onChange,
  disabled,
}: {
  label?: string;
  required?: boolean;
  items: MixedAtom[];
  onChange: (next: MixedAtom[]) => void;
  disabled?: boolean;
}) {
  const [newDraft, setNewDraft] = useState("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const addItem = () => {
    const atom = inferMixedAtom(newDraft);
    if (atom == null) return;
    onChange([...(Array.isArray(items) ? items : []), atom]);
    setNewDraft("");
  };

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
    if (editIndex === idx) {
      setEditIndex(null);
      setEditDraft("");
    }
  };

  const startEdit = (idx: number) => {
    setEditIndex(idx);
    setEditDraft(String(items[idx] ?? ""));
  };

  const saveEdit = () => {
    if (editIndex == null) return;
    const atom = inferMixedAtom(editDraft);
    const next = [...items];
    if (atom == null) {
      next.splice(editIndex, 1);
    } else {
      next[editIndex] = atom;
    }
    onChange(next);
    setEditIndex(null);
    setEditDraft("");
  };

  return (
    <div className="form-group">
      {label ? (
        <label>
          {label}
          {required ? " *" : ""}
        </label>
      ) : null}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
        <input
          type="text"
          value={newDraft}
          disabled={disabled}
          onChange={(e) => setNewDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!disabled) addItem();
            }
          }}
          placeholder="Add item (text, number, or YYYY-MM-DD)"
          style={{
            flex: "1 1 260px",
            minWidth: 200,
            padding: "0.5rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        />
        <button type="button" className="btn btn-primary" disabled={disabled || !newDraft.trim()} onClick={addItem}>
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No items yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.45rem 0.4rem", borderBottom: "1px solid var(--border)", width: 48 }}>#</th>
              <th style={{ textAlign: "left", padding: "0.45rem 0.4rem", borderBottom: "1px solid var(--border)" }}>Item</th>
              <th style={{ textAlign: "right", padding: "0.45rem 0.4rem", borderBottom: "1px solid var(--border)", width: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const isEditingRow = editIndex === idx;
              return (
                <tr key={`${String(it)}:${idx}`}>
                  <td style={{ padding: "0.4rem", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{idx + 1}</td>
                  <td style={{ padding: "0.4rem", borderBottom: "1px solid var(--border)" }}>
                    {isEditingRow ? (
                      <input
                        type="text"
                        value={editDraft}
                        disabled={disabled}
                        onChange={(e) => setEditDraft(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.45rem 0.5rem",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                        }}
                        autoFocus
                      />
                    ) : (
                      <span>{String(it)}</span>
                    )}
                  </td>
                  <td style={{ padding: "0.4rem", borderBottom: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    {isEditingRow ? (
                      <>
                        <button type="button" className="btn btn-primary" disabled={disabled} onClick={saveEdit} style={{ marginRight: "0.35rem" }}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={disabled}
                          onClick={() => {
                            setEditIndex(null);
                            setEditDraft("");
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn" disabled={disabled} onClick={() => startEdit(idx)} style={{ marginRight: "0.35rem" }}>
                          Edit
                        </button>
                        <button type="button" className="btn" disabled={disabled} onClick={() => removeItem(idx)} style={{ color: "var(--error)" }}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MultiReferenceListEditor({
  label,
  required,
  items,
  options,
  onChange,
  disabled,
}: {
  label?: string;
  required?: boolean;
  items: string[];
  options: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [newDraft, setNewDraft] = useState("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const addItem = () => {
    const v = (newDraft ?? "").trim();
    if (!v) return;
    onChange([...(Array.isArray(items) ? items : []), v]);
    setNewDraft("");
  };

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
    if (editIndex === idx) {
      setEditIndex(null);
      setEditDraft("");
    }
  };

  const startEdit = (idx: number) => {
    setEditIndex(idx);
    setEditDraft(String(items[idx] ?? ""));
  };

  const saveEdit = () => {
    if (editIndex == null) return;
    const v = (editDraft ?? "").trim();
    const next = [...items];
    if (!v) {
      next.splice(editIndex, 1);
    } else {
      next[editIndex] = v;
    }
    onChange(next);
    setEditIndex(null);
    setEditDraft("");
  };

  return (
    <div className="form-group">
      {label ? (
        <label>
          {label}
          {required ? " *" : ""}
        </label>
      ) : null}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
        <select
          value={newDraft}
          disabled={disabled}
          onChange={(e) => setNewDraft(e.target.value)}
          style={{
            flex: "1 1 260px",
            minWidth: 200,
            padding: "0.5rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface)",
          }}
        >
          <option value="">— Select value —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" disabled={disabled || !newDraft.trim()} onClick={addItem}>
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No values yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.45rem 0.4rem", borderBottom: "1px solid var(--border)", width: 48 }}>#</th>
              <th style={{ textAlign: "left", padding: "0.45rem 0.4rem", borderBottom: "1px solid var(--border)" }}>Value</th>
              <th style={{ textAlign: "right", padding: "0.45rem 0.4rem", borderBottom: "1px solid var(--border)", width: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const isEditingRow = editIndex === idx;
              return (
                <tr key={`${String(it)}:${idx}`}>
                  <td style={{ padding: "0.4rem", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{idx + 1}</td>
                  <td style={{ padding: "0.4rem", borderBottom: "1px solid var(--border)" }}>
                    {isEditingRow ? (
                      <select
                        value={editDraft}
                        disabled={disabled}
                        onChange={(e) => setEditDraft(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.45rem 0.5rem",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface)",
                        }}
                        autoFocus
                      >
                        <option value="">—</option>
                        {options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{String(it)}</span>
                    )}
                  </td>
                  <td style={{ padding: "0.4rem", borderBottom: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    {isEditingRow ? (
                      <>
                        <button type="button" className="btn btn-primary" disabled={disabled} onClick={saveEdit} style={{ marginRight: "0.35rem" }}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={disabled}
                          onClick={() => {
                            setEditIndex(null);
                            setEditDraft("");
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn" disabled={disabled} onClick={() => startEdit(idx)} style={{ marginRight: "0.35rem" }}>
                          Edit
                        </button>
                        <button type="button" className="btn" disabled={disabled} onClick={() => removeItem(idx)} style={{ color: "var(--error)" }}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

type SubField = {
  key: string;
  name: string;
  field_type?: string | null;
  is_required?: boolean;
  can_view?: boolean;
  can_edit?: boolean;
  sort_order?: number;
  config?: { ui_section?: string; [key: string]: unknown } | null;
};

interface FieldSummary {
  id: number;
  key: string;
  name: string;
  field_type: string;
  full_page_multi_items?: boolean;
  sub_fields?: SubField[];
}

interface KpiInfo {
  name: string;
}

interface MultiItemsRow {
  index: number;
  data: Record<string, unknown>;
}

export default function MultiItemRowDetail() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const kpiId = Number(params.kpiId);
  const year = Number(params.year);
  const fieldId = Number(params.fieldId);
  const rowIndexParam = params.rowIndex as string;
  const isNew = rowIndexParam === "new";
  const rowIndex = isNew ? null : Number(rowIndexParam);
  const isEditMode = isNew || searchParams.get("mode") === "edit";
  const organizationIdFromUrl = searchParams.get("organization_id");
  const periodKey = searchParams.get("period_key") || "";
  const dashboardIdFromUrl = searchParams.get("dashboard_id");
  const widgetIdFromUrl = searchParams.get("widget_id");

  const token = getAccessToken();

  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const [kpiName, setKpiName] = useState<string>("");
  const [field, setField] = useState<FieldSummary | null>(null);
  const [dashboardName, setDashboardName] = useState<string>("");
  const [dashboardWidgetTitle, setDashboardWidgetTitle] = useState<string>("");
  const [entryId, setEntryId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refAllowedValues, setRefAllowedValues] = useState<Record<string, string[]>>({});
  const [activeSectionTab, setActiveSectionTab] = useState<string>("");
  const [activeMixedListTabByGroup, setActiveMixedListTabByGroup] = useState<Record<string, string>>({});
  const [activeListLikeTabByGroup, setActiveListLikeTabByGroup] = useState<Record<string, string>>({});

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

  const backToList = () => {
    router.push(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}?${baseQueryParams.toString()}`);
  };

  const exitEditMode = () => {
    if (isNew) {
      backToList();
      return;
    }
    router.push(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/${rowIndexParam}?${baseQueryParams.toString()}`);
  };

  const handleDelete = async () => {
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    if (isNew || rowIndex == null) return;
    if (!entryId || !fieldId) {
      toast.error("Entry is still loading. Please wait and try again.");
      return;
    }
    if (!window.confirm("Delete this row?")) return;
    try {
      await api(
        `/entries/multi-items/rows/${rowIndex}?${new URLSearchParams({
          entry_id: String(entryId),
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId ?? ""),
        }).toString()}`,
        { method: "DELETE", token }
      );
      toast.success("Row deleted");
      backToList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const rowPageContextLoadGenRef = useRef(0);

  const effectiveOrgId = useMemo(
    () => (organizationIdFromUrl ? Number(organizationIdFromUrl) : meOrgId ?? undefined),
    [organizationIdFromUrl, meOrgId]
  );

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
    if (!token) {
      router.push("/login");
      return;
    }
    api<{ organization_id: number | null }>("/auth/me", { token })
      .then((me) => setMeOrgId(me.organization_id ?? null))
      .catch(() => setMeOrgId(null));
  }, [token, router]);

  const loadContext = async (loadId: number) => {
    if (!token || !kpiId || effectiveOrgId == null || !fieldId) return;
    setError(null);
    try {
      const kpi = await api<KpiInfo>(
        `/kpis/${kpiId}?${new URLSearchParams({ organization_id: String(effectiveOrgId) }).toString()}`,
        { token }
      ).catch(() => null);
      if (loadId !== rowPageContextLoadGenRef.current) return;
      if (kpi?.name) setKpiName(kpi.name);

      const fields = await api<FieldSummary[]>(
        `/entries/fields?${new URLSearchParams({
          kpi_id: String(kpiId),
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      ).catch(() => []);
      if (loadId !== rowPageContextLoadGenRef.current) return;
      const f = fields.find((x) => x.id === fieldId && x.field_type === "multi_line_items") || null;
      setField(f);

      const forPeriod = await api<{ id: number }>(
        `/entries/for-period?${new URLSearchParams({
          kpi_id: String(kpiId),
          year: String(year),
          period_key: periodKey || "",
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      );
      if (loadId !== rowPageContextLoadGenRef.current) return;
      setEntryId(forPeriod.id);

      if (!isNew && rowIndex != null) {
        // Fetch the specific row's page with a server-allowed page_size (<= 200)
        const pageSizeForFetch = 200;
        const pageForFetch = Math.floor(rowIndex / pageSizeForFetch) + 1;
        const params = new URLSearchParams({
          entry_id: String(forPeriod.id),
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId),
          page: String(pageForFetch),
          page_size: String(pageSizeForFetch),
        });
        const res = await api<{
          rows: MultiItemsRow[];
        }>(`/entries/multi-items/rows?${params.toString()}`, { token });
        if (loadId !== rowPageContextLoadGenRef.current) return;
        const found = res.rows.find((r) => r.index === rowIndex);
        if (found) {
          setEditData(found.data || {});
        } else {
          setError("Row not found");
        }
      }
    } catch (e) {
      if (loadId === rowPageContextLoadGenRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load row");
      }
    } finally {
      if (loadId === rowPageContextLoadGenRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!token || effectiveOrgId == null) return;
    const loadId = ++rowPageContextLoadGenRef.current;
    setLoading(true);
    loadContext(loadId).catch(() => undefined);
    return () => {
      rowPageContextLoadGenRef.current += 1;
    };
  }, [token, effectiveOrgId, kpiId, year, fieldId, rowIndex, isNew, periodKey]);

  const subFields = field?.sub_fields ?? [];

  const sectionGroups = useMemo(() => {
    const hasAnyExplicit = subFields.some((sf) => {
      const section = (sf as any)?.config?.ui_section;
      return typeof section === "string" && section.trim().length > 0;
    });

    const groupMap = new Map<
      string,
      { label: string; fields: SubField[]; order: number; isOther: boolean }
    >();

    subFields.forEach((sf, idx) => {
      const rawSection = (sf as any)?.config?.ui_section;
      const section = typeof rawSection === "string" ? rawSection.trim() : "";
      const label = section.length > 0 ? section : hasAnyExplicit ? "Other" : "";
      const isOther = label === "Other" || label === "";
      const sortOrder = typeof (sf as any)?.sort_order === "number" ? (sf as any).sort_order : idx;

      const existing = groupMap.get(label);
      if (!existing) {
        groupMap.set(label, { label, fields: [sf], order: sortOrder, isOther });
      } else {
        existing.fields.push(sf);
        existing.order = Math.min(existing.order, sortOrder);
      }
    });

    const groups = Array.from(groupMap.values()).sort((a, b) => a.order - b.order);
    if (!hasAnyExplicit) {
      return [{ label: "", fields: subFields, showHeading: false }] as const;
    }

    return groups
      .filter((g) => g.fields.length > 0)
      .map((g) => ({
        label: g.isOther ? "Other" : g.label,
        fields: g.fields,
        showHeading: !g.isOther,
      }));
  }, [subFields]);

  const hasSectionTabs = sectionGroups.length > 1 || (sectionGroups.length === 1 && sectionGroups[0].label !== "");

  useEffect(() => {
    if (!hasSectionTabs) {
      setActiveSectionTab("");
      return;
    }
    const labels = sectionGroups.map((g) => g.label);
    // Keep current selection if still exists; otherwise default to first tab.
    setActiveSectionTab((prev) => (prev && labels.includes(prev) ? prev : labels[0] || ""));
  }, [hasSectionTabs, sectionGroups]);

  // Load reference allowed values for reference / multi_reference sub-fields (same logic as inline editor)
  useEffect(() => {
    if (!token || effectiveOrgId == null || !field || !field.sub_fields?.length) return;
    const keys: { k: string; sid: number; skey: string; subKey?: string }[] = [];
    field.sub_fields.forEach((s) => {
      if (
        (s.field_type === "reference" || s.field_type === "multi_reference") &&
        (s as any).config?.reference_source_kpi_id &&
        (s as any).config?.reference_source_field_key
      ) {
        const cfg = (s as any).config as {
          reference_source_kpi_id: number;
          reference_source_field_key: string;
          reference_source_sub_field_key?: string;
        };
        keys.push({
          k: `${cfg.reference_source_kpi_id}-${cfg.reference_source_field_key}${
            cfg.reference_source_sub_field_key ? `-${cfg.reference_source_sub_field_key}` : ""
          }`,
          sid: cfg.reference_source_kpi_id,
          skey: cfg.reference_source_field_key,
          subKey: cfg.reference_source_sub_field_key,
        });
      }
    });
    const uniq = Array.from(new Map(keys.map((x) => [x.k, x])).values());
    uniq.forEach(({ k, sid, skey, subKey }) => {
      const params = new URLSearchParams({
        source_kpi_id: String(sid),
        source_field_key: skey,
        organization_id: String(effectiveOrgId),
      });
      if (subKey) params.set("source_sub_field_key", subKey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params.toString()}`, { token })
        .then((r) => setRefAllowedValues((prev) => ({ ...prev, [k]: r.values })))
        .catch(() => setRefAllowedValues((prev) => ({ ...prev, [k]: [] })));
    });
  }, [token, effectiveOrgId, field]);

  const handleChangeCell = (key: string, value: unknown) => {
    setEditData((prev) => ({ ...prev, [key]: value }));
  };

  const Toggle = ({
    checked,
    onChange,
    disabled,
    label,
  }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    label?: string;
  }) => (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.6rem",
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
      }}
    >
      <span
        style={{
          position: "relative",
          width: 44,
          height: 24,
          borderRadius: 999,
          background: checked ? "var(--accent)" : "var(--border)",
          display: "inline-flex",
          alignItems: "center",
          padding: 2,
          opacity: disabled ? 0.6 : 1,
          transition: "background 140ms ease, opacity 140ms ease",
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "var(--surface)",
            transform: checked ? "translateX(20px)" : "translateX(0)",
            transition: "transform 140ms ease",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ display: "none" }}
        aria-label={label || "Toggle"}
      />
      {label ? <span style={{ fontSize: "0.9rem", color: "var(--text)" }}>{label}</span> : null}
    </label>
  );

  /** Persist row data for an existing row (no navigation). Used after attachment upload. */
  const persistExistingRow = async (data: Record<string, unknown>) => {
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    if (!entryId || !fieldId) {
      toast.error("Entry is still loading. Please wait and try again.");
      return;
    }
    if (isNew) return;
    await api<MultiItemsRow>(
      `/entries/multi-items/rows/${rowIndex}?${new URLSearchParams({
        entry_id: String(entryId),
        field_id: String(fieldId),
        organization_id: String(effectiveOrgId ?? ""),
      }).toString()}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
        token,
      }
    );
  };

  /** Create the row on the server (same as Save on a new row), then go to the row URL so further edits use PUT. */
  const persistNewRow = async (data: Record<string, unknown>) => {
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    if (!entryId || !fieldId || !isNew) return;
    const created = await api<MultiItemsRow>(
      `/entries/multi-items/rows?${new URLSearchParams({
        entry_id: String(entryId),
        field_id: String(fieldId),
        organization_id: String(effectiveOrgId ?? ""),
      }).toString()}`,
      {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }
    );
    toast.success("File attached and saved.");
    const backParams = new URLSearchParams({
      organization_id: String(effectiveOrgId ?? ""),
      ...(periodKey ? { period_key: periodKey } : {}),
    });
    router.replace(
      `/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/${created.index}?${backParams.toString()}`
    );
  };

  const handleSave = async () => {
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    if (!entryId || !fieldId) {
      toast.error("Entry is still loading. Please wait and try again.");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await api<MultiItemsRow>(
          `/entries/multi-items/rows?${new URLSearchParams({
            entry_id: String(entryId),
            field_id: String(fieldId),
            organization_id: String(effectiveOrgId ?? ""),
          }).toString()}`,
          {
            method: "POST",
            body: JSON.stringify(editData),
            token,
          }
        );
        toast.success("Row added successfully");
        const next = new URLSearchParams({
          organization_id: String(effectiveOrgId ?? ""),
          ...(periodKey ? { period_key: periodKey } : {}),
        });
        router.replace(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/${created.index}?${next.toString()}`);
      } else {
        await persistExistingRow(editData);
        toast.success("Row updated successfully");
        const next = new URLSearchParams(searchParams.toString());
        next.delete("mode");
        next.set("row_updated", "1");
        router.replace(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/${rowIndexParam}?${next.toString()}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return;
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => backToList();

  if (!token) {
    return null;
  }

  return (
    <div style={{ padding: "1rem 1.25rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1120, margin: "0 auto" }}>
      {error && (
        <div className="card" style={{ padding: "0.75rem", color: "var(--error)" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: "1rem" }}>
        {loading ? (
          <p style={{ color: "var(--muted)" }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                <button type="button" className="btn" onClick={handleCancel}>
                  Back
                </button>
                <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                  {cameFromDashboard && dashboardId != null && Number.isFinite(dashboardId) ? (
                    <>
                      <Link
                        href={`/dashboard/dashboards/${dashboardId}?${new URLSearchParams({ organization_id: String(effectiveOrgId ?? "") }).toString()}`}
                        style={{ color: "var(--accent)", textDecoration: "none" }}
                      >
                        {dashboardName || "Dashboard"}
                      </Link>
                      <span style={{ margin: "0 0.35rem" }}>/</span>
                      <Link
                        href={`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}?${baseQueryParams.toString()}`}
                        style={{ color: "var(--accent)", textDecoration: "none" }}
                      >
                        {dashboardWidgetTitle || field?.name || "Full Page"}
                      </Link>
                      <span style={{ margin: "0 0.35rem" }}>/</span>
                      <span style={{ color: "var(--text)", fontWeight: 600 }}>Record #{(rowIndex ?? 0) + 1}</span>
                    </>
                  ) : (
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>
                      {kpiName ? `${kpiName} · ` : ""}{field?.name || "Row"} · Record #{(rowIndex ?? 0) + 1}
                    </span>
                  )}
                </span>
              </div>
              {!isNew && (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  {isEditMode ? (
                    <>
                      <button type="button" className="btn" onClick={exitEditMode} disabled={saving}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" disabled={saving || !entryId} onClick={handleSave}>
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        const next = new URLSearchParams(searchParams.toString());
                        next.set("mode", "edit");
                        router.push(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/${rowIndexParam}?${next.toString()}`);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {!isEditMode ? (
                    <button type="button" className="btn" onClick={handleDelete} style={{ color: "var(--error)" }}>
                      Delete
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            {/* Summary strip with a few key attributes */}
            {subFields.length > 0 && (
              <div
                style={{
                  marginBottom: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: 6,
                  background: "var(--bg-subtle, #f9fafb)",
                  border: "1px solid var(--border)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "0.5rem 1rem",
                }}
              >
                {subFields.slice(0, 4).map((sf) => {
                  const key = sf.key;
                  const val = editData[key];
                  let display: string;
                  if (sf.field_type === "boolean") {
                    display = Boolean(val) ? "Yes" : "No";
                  } else if (sf.field_type === "date") {
                    display = typeof val === "string" && val ? val : "—";
                  } else if (sf.field_type === "number") {
                    display =
                      typeof val === "number"
                        ? String(val)
                        : val != null
                        ? String(val)
                        : "—";
                  } else if (sf.field_type === "multi_reference") {
                    const arr = Array.isArray(val) ? (val as unknown[]).filter((x) => x != null && String(x).trim() !== "") : [];
                    display = arr.length > 0 ? arr.map((x) => String(x)).join("; ") : "—";
                  } else if (sf.field_type === "mixed_list") {
                    const arr = Array.isArray(val) ? (val as unknown[]).filter((x) => x != null && String(x).trim() !== "") : [];
                    display = arr.length > 0 ? arr.map((x) => String(x)).join("; ") : "—";
                  } else {
                    display = val != null && String(val).trim() !== "" ? String(val) : "—";
                  }
                  return (
                    <div key={key} style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={sf.name}
                      >
                        {sf.name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.9rem",
                          fontWeight: 500,
                          color: "var(--text)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={display}
                      >
                        {display}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {hasSectionTabs && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  marginBottom: "0.9rem",
                  paddingBottom: "0.75rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {sectionGroups.map((g) => {
                  const active = activeSectionTab === g.label;
                  return (
                    <button
                      key={g.label}
                      type="button"
                      className={active ? "btn btn-primary" : "btn"}
                      onClick={() => setActiveSectionTab(g.label)}
                      style={{
                        padding: "0.4rem 0.7rem",
                        fontSize: "0.9rem",
                        borderRadius: 999,
                      }}
                    >
                      {g.label || "Fields"}
                    </button>
                  );
                })}
              </div>
            )}

            {sectionGroups
              .filter((g) => !hasSectionTabs || activeSectionTab === g.label)
              .map((group, groupIdx) => {
              const groupKey = `${group.label || "default"}:${groupIdx}`;
              return (
              <div
                key={groupKey}
                style={{
                  marginTop: groupIdx === 0 ? 0 : "1rem",
                  padding: "0.9rem",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  background: "var(--surface)",
                }}
              >
                {(() => {
                  const mixedListFields = group.fields.filter((sf) => sf.field_type === "mixed_list");
                  const multiRefFields = group.fields.filter((sf) => sf.field_type === "multi_reference");
                  const compactFields = group.fields.filter(
                    (sf) =>
                      sf.field_type !== "multi_line_text" &&
                      sf.field_type !== "mixed_list" &&
                      sf.field_type !== "multi_reference"
                  );
                  const multiLineFields = group.fields.filter((sf) => sf.field_type === "multi_line_text");

                  // Place multi-line textareas into two columns, 1 textarea per column cell (balanced).
                  const mlLeft: SubField[] = [];
                  const mlRight: SubField[] = [];
                  multiLineFields.forEach((sf, idx) => (idx % 2 === 0 ? mlLeft : mlRight).push(sf));

                  const listLikeTabs = [
                    ...mixedListFields.map((sf) => ({ kind: "mixed_list" as const, sf })),
                    ...multiRefFields.map((sf) => ({ kind: "multi_reference" as const, sf })),
                  ];
                  const listLikeKeys = listLikeTabs.map((t) => `${t.kind}:${t.sf.key}`);
                  const activeListLikeKey = (() => {
                    const current = activeListLikeTabByGroup[groupKey] || activeMixedListTabByGroup[groupKey];
                    if (current && listLikeKeys.includes(current)) return current;
                    return listLikeKeys[0] || "";
                  })();

                  if (!isEditMode) {
                    const renderValue = (sf: SubField) => {
                      const key = sf.key;
                      const val = editData[key];
                      if (sf.field_type === "attachment") {
                        const url = (val as any)?.download_url || (typeof val === "string" ? val : "");
                        const name =
                          typeof (val as any)?.filename === "string"
                            ? (val as any).filename
                            : typeof (val as any)?.name === "string"
                              ? (val as any).name
                              : url
                                ? "Attachment"
                                : "—";
                        if (!url) return <span style={{ color: "var(--muted)" }}>—</span>;
                        return (
                          <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                            {name}
                          </a>
                        );
                      }
                      if (sf.field_type === "multi_reference" || sf.field_type === "mixed_list") {
                        const arr = Array.isArray(val) ? (val as unknown[]).filter((x) => x != null && String(x).trim() !== "") : [];
                        return <span>{arr.length ? arr.map((x) => String(x)).join("; ") : "—"}</span>;
                      }
                      if (sf.field_type === "boolean") return <span>{Boolean(val) ? "Yes" : "No"}</span>;
                      if (val == null || String(val).trim() === "") return <span style={{ color: "var(--muted)" }}>—</span>;
                      return <span>{String(val)}</span>;
                    };
                    const allFields = group.fields;
                    return (
                      <div style={{ display: "grid", gap: "0.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                        {allFields.map((sf) => (
                          <div key={sf.key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.75rem", background: "var(--bg-subtle, #f9fafb)" }}>
                            <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 6 }}>
                              {sf.name}
                              {sf.is_required ? " *" : ""}
                            </div>
                            <div style={{ fontSize: "0.95rem", color: "var(--text)" }}>{renderValue(sf)}</div>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: "grid", gap: "1rem" }}>
                      {compactFields.length > 0 && (
                        <div
                          style={{
                            padding: "0.85rem",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            background: "var(--bg-subtle, #f9fafb)",
                          }}
                        >
                          <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                            {compactFields.map((sf) => {
                const key = sf.key;
                const val = editData[key];
                const canEdit = sf.can_edit !== false;
                const displayVal =
                  sf.field_type === "boolean"
                    ? Boolean(val) ? "Yes" : "No"
                    : sf.field_type === "date"
                      ? (typeof val === "string" && val ? val : "—")
                      : sf.field_type === "multi_reference"
                        ? (() => {
                            const arr = Array.isArray(val) ? (val as unknown[]).filter((x) => x != null && String(x).trim() !== "") : [];
                            return arr.length > 0 ? arr.map((x) => String(x)).join("; ") : "—";
                          })()
                      : val != null && String(val).trim() !== "" ? String(val) : "—";
                if (!canEdit) {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <div style={{ padding: "0.35rem 0", color: "var(--muted)" }}>{displayVal}</div>
                    </div>
                  );
                }
                if (sf.field_type === "number") {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <input
                        type="number"
                        value={typeof val === "number" ? val : val != null ? String(val) : ""}
                        onChange={(e) =>
                          handleChangeCell(key, e.target.value === "" ? undefined : Number(e.target.value))
                        }
                      />
                    </div>
                  );
                }
                if (sf.field_type === "date") {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <input
                        type="date"
                        value={typeof val === "string" ? val : ""}
                        onChange={(e) => handleChangeCell(key, e.target.value || undefined)}
                      />
                    </div>
                  );
                }
                if (sf.field_type === "boolean") {
                  return (
                    <div key={key} className="form-group">
                      <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.35rem" }}>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </div>
                      <Toggle
                        checked={Boolean(val)}
                        onChange={(next) => handleChangeCell(key, next)}
                        label={Boolean(val) ? "Yes" : "No"}
                      />
                    </div>
                  );
                }
                if (sf.field_type === "reference") {
                  const cfg = (sf as any).config as
                    | {
                        reference_source_kpi_id?: number;
                        reference_source_field_key?: string;
                        reference_source_sub_field_key?: string;
                      }
                    | undefined;
                  const refKey =
                    cfg?.reference_source_kpi_id && cfg?.reference_source_field_key
                      ? `${cfg.reference_source_kpi_id}-${cfg.reference_source_field_key}${
                          cfg.reference_source_sub_field_key ? `-${cfg.reference_source_sub_field_key}` : ""
                        }`
                      : "";
                  const options = refAllowedValues[refKey] ?? [];
                  const strVal = typeof val === "string" ? val : val != null ? String(val) : "";
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <select
                        value={strVal}
                        onChange={(e) => handleChangeCell(key, e.target.value || undefined)}
                        style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                      >
                        <option value="">—</option>
                        {options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                if (sf.field_type === "multi_reference") {
                  const cfg = (sf as any).config as
                    | {
                        reference_source_kpi_id?: number;
                        reference_source_field_key?: string;
                        reference_source_sub_field_key?: string;
                      }
                    | undefined;
                  const refKey =
                    cfg?.reference_source_kpi_id && cfg?.reference_source_field_key
                      ? `${cfg.reference_source_kpi_id}-${cfg.reference_source_field_key}${
                          cfg.reference_source_sub_field_key ? `-${cfg.reference_source_sub_field_key}` : ""
                        }`
                      : "";
                  const options = refAllowedValues[refKey] ?? [];
                  const arr = Array.isArray(val) ? (val as string[]) : [];
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <MultiReferenceInput
                        options={options}
                        value={arr}
                        onChange={(next) => handleChangeCell(key, next)}
                      />
                    </div>
                  );
                }
                if (sf.field_type === "attachment") {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <AttachmentFieldControl
                        value={val}
                        uploadSuccessAlert={false}
                        onUploaded={(downloadUrl, filename) => {
                          const cell = makeAttachmentCellValue(downloadUrl, filename);
                          setEditData((prev) => {
                            const merged = { ...prev, [key]: cell };
                            if (entryId && fieldId) {
                              if (isNew) {
                                void persistNewRow(merged).catch((e) =>
                                  toast.error(e instanceof Error ? e.message : "Could not save row"),
                                );
                              } else {
                                void persistExistingRow(merged)
                                  .then(() => toast.success("File attached and saved."))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not save"));
                              }
                            }
                            return merged;
                          });
                        }}
                        onClear={() => handleChangeCell(key, "")}
                        token={token}
                        kpiId={kpiId}
                        entryId={entryId}
                        year={year}
                        onNotAuthenticated={() => {
                          toast.error("Session expired. Please log in again.");
                          router.push("/login");
                        }}
                        onError={(m) => toast.error(m)}
                      />
                    </div>
                  );
                }
                return (
                  <div key={key} className="form-group">
                    <label>
                      {sf.name}
                      {sf.is_required ? " *" : ""}
                    </label>
                    <input
                      type="text"
                      value={typeof val === "string" ? val : val != null ? String(val) : ""}
                      onChange={(e) => handleChangeCell(key, e.target.value)}
                    />
                  </div>
                );
              })}
                          </div>
                        </div>
                      )}

                      {listLikeTabs.length > 0 && (
                        <div
                          style={{
                            padding: "0.85rem",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            background: "var(--surface)",
                          }}
                        >
                          {listLikeTabs.length > 1 && (
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "0.5rem",
                                marginBottom: "0.9rem",
                                paddingBottom: "0.75rem",
                                borderBottom: "1px solid var(--border)",
                              }}
                            >
                              {listLikeTabs.map(({ kind, sf }) => {
                                const tabKey = `${kind}:${sf.key}`;
                                const isActive = activeListLikeKey === tabKey;
                                return (
                                  <button
                                    key={tabKey}
                                    type="button"
                                    className={isActive ? "btn btn-primary" : "btn"}
                                    onClick={() =>
                                      setActiveListLikeTabByGroup((prev) => ({ ...prev, [groupKey]: tabKey }))
                                    }
                                    style={{
                                      padding: "0.4rem 0.7rem",
                                      fontSize: "0.9rem",
                                      borderRadius: 999,
                                    }}
                                  >
                                    {sf.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {listLikeTabs
                            .filter(({ kind, sf }) => listLikeTabs.length <= 1 || `${kind}:${sf.key}` === activeListLikeKey)
                            .map(({ kind, sf }) => {
                              const key = sf.key;
                              const val = editData[key];

                              if (kind === "mixed_list") {
                                return (
                                  <div key={`${kind}:${key}`}>
                                    <div style={{ fontSize: "0.95rem", fontWeight: 650, marginBottom: "0.6rem" }}>
                                      {sf.name}
                                      {sf.is_required ? " *" : ""}
                                    </div>
                                    <MixedListCellEditor
                                      label="" // heading is rendered by the card title above
                                      required={false}
                                      items={Array.isArray(val) ? (val as MixedAtom[]) : []}
                                      onChange={(next) => handleChangeCell(key, next)}
                                      disabled={sf.can_edit === false}
                                    />
                                  </div>
                                );
                              }

                              const cfg = (sf as any).config as
                                | {
                                    reference_source_kpi_id?: number;
                                    reference_source_field_key?: string;
                                    reference_source_sub_field_key?: string;
                                  }
                                | undefined;
                              const refKey =
                                cfg?.reference_source_kpi_id && cfg?.reference_source_field_key
                                  ? `${cfg.reference_source_kpi_id}-${cfg.reference_source_field_key}${
                                      cfg.reference_source_sub_field_key ? `-${cfg.reference_source_sub_field_key}` : ""
                                    }`
                                  : "";
                              const options = refAllowedValues[refKey] ?? [];
                              const arr = Array.isArray(val) ? (val as string[]) : [];
                              return (
                                <div key={`${kind}:${key}`}>
                                  <div style={{ fontSize: "0.95rem", fontWeight: 650, marginBottom: "0.6rem" }}>
                                    {sf.name}
                                    {sf.is_required ? " *" : ""}
                                  </div>
                                  <MultiReferenceListEditor
                                    label="" // heading is rendered by the card title above
                                    required={false}
                                    items={arr}
                                    options={options}
                                    onChange={(next) => handleChangeCell(key, next)}
                                    disabled={sf.can_edit === false}
                                  />
                                </div>
                              );
                            })}
                        </div>
                      )}

                      {multiLineFields.length > 0 && (
                        <div
                          style={{
                            padding: "0.85rem",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            background: "var(--surface)",
                          }}
                        >
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                              {mlLeft.map((sf) => {
                                const key = sf.key;
                                const val = editData[key];
                                const canEdit = sf.can_edit !== false;
                                const displayVal = val != null && String(val).trim() !== "" ? String(val) : "—";
                                if (!canEdit) {
                                  return (
                                    <div key={key} className="form-group">
                                      <label>
                                        {sf.name}
                                        {sf.is_required ? " *" : ""}
                                      </label>
                                      <div style={{ padding: "0.35rem 0", color: "var(--muted)" }}>{displayVal}</div>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={key} className="form-group">
                                    <label>
                                      {sf.name}
                                      {sf.is_required ? " *" : ""}
                                    </label>
                                    <textarea
                                      rows={6}
                                      value={typeof val === "string" ? val : val != null ? String(val) : ""}
                                      onChange={(e) => handleChangeCell(key, e.target.value)}
                                      style={{ width: "100%", resize: "vertical", minHeight: 160 }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                              {mlRight.map((sf) => {
                                const key = sf.key;
                                const val = editData[key];
                                const canEdit = sf.can_edit !== false;
                                const displayVal = val != null && String(val).trim() !== "" ? String(val) : "—";
                                if (!canEdit) {
                                  return (
                                    <div key={key} className="form-group">
                                      <label>
                                        {sf.name}
                                        {sf.is_required ? " *" : ""}
                                      </label>
                                      <div style={{ padding: "0.35rem 0", color: "var(--muted)" }}>{displayVal}</div>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={key} className="form-group">
                                    <label>
                                      {sf.name}
                                      {sf.is_required ? " *" : ""}
                                    </label>
                                    <textarea
                                      rows={6}
                                      value={typeof val === "string" ? val : val != null ? String(val) : ""}
                                      onChange={(e) => handleChangeCell(key, e.target.value)}
                                      style={{ width: "100%", resize: "vertical", minHeight: 160 }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
              })}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end", alignItems: "center" }}>
              {!entryId && <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Loading entry…</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

