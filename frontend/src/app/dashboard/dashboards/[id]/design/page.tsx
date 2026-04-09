"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { WidgetRenderer } from "../widgets";

type WidgetType =
  | "text"
  | "kpi_single_value"
  | "kpi_table"
  | "kpi_line_chart"
  | "kpi_bar_chart"
  | "kpi_multi_line_table";
type EditTab = "basics" | "options";

type Widget =
  | { id: string; type: "text"; title?: string; text?: string; full_width?: boolean }
  | { id: string; type: "kpi_single_value"; title?: string; kpi_id: number; year: number; period_key?: string | null; field_key: string; full_width?: boolean }
  | { id: string; type: "kpi_table"; title?: string; kpi_id: number; year: number; period_key?: string | null; field_keys?: string[]; full_width?: boolean }
  | {
      id: string;
      type: "kpi_line_chart";
      title?: string;
      kpi_id: number;
      field_key: string;
      start_year: number;
      end_year: number;
      period_key?: string | null;
      full_width?: boolean;
    }
  | {
      id: string;
      type: "kpi_bar_chart";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      field_keys: string[];
      chart_type?: "bar" | "pie";
      mode?: "fields" | "multi_line_items";
      source_field_key?: string;
      agg?: "count_rows" | "sum" | "avg";
      group_by_sub_field_key?: string;
      value_sub_field_key?: string;
      filter_sub_field_key?: string;
      filter_label?: string;
      full_width?: boolean;
    }
  | {
      id: string;
      type: "kpi_multi_line_table";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      source_field_key: string;
      sub_field_keys: string[];
      join?: {
        kpi_id: number;
        source_field_key: string;
        on_left_sub_field_key: string;
        on_right_sub_field_key: string;
        sub_field_keys: string[];
      };
      full_width?: boolean;
    };

interface DashboardDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  layout: any;
}

interface KpiRow {
  id: number;
  name: string;
  year: number | null;
}

interface KpiFieldRow {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields?: Array<{ id: number; key: string; name: string; field_type: string }>;
}

function ensureLayout(layout: any): { widgets: Widget[] } {
  if (layout && typeof layout === "object" && Array.isArray(layout.widgets)) return { widgets: layout.widgets as Widget[] };
  if (Array.isArray(layout)) return { widgets: layout as Widget[] };
  return { widgets: [] };
}

function newId() {
  return `w_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export default function DashboardDesignPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const token = getAccessToken();
  const orgIdFromQuery = searchParams.get("organization_id");

  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [fieldsByKpiId, setFieldsByKpiId] = useState<Record<number, KpiFieldRow[]>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [fullWidth, setFullWidth] = useState(false);

  const [addType, setAddType] = useState<WidgetType>("text");
  const [addTitle, setAddTitle] = useState("");
  const [addText, setAddText] = useState("");
  const [addKpiId, setAddKpiId] = useState<number | null>(null);
  const [addFieldKey, setAddFieldKey] = useState<string>("");
  const [addYear, setAddYear] = useState<number>(new Date().getFullYear());
  const [addStartYear, setAddStartYear] = useState<number>(new Date().getFullYear() - 4);
  const [addEndYear, setAddEndYear] = useState<number>(new Date().getFullYear());
  const [addPeriodKey, setAddPeriodKey] = useState<string>("");
  const [addFieldKeys, setAddFieldKeys] = useState<string>("");
  const [addChartType, setAddChartType] = useState<"bar" | "pie">("bar");
  const [addChartMode, setAddChartMode] = useState<"fields" | "multi_line_items">("fields");
  const [addMultiLineFieldKey, setAddMultiLineFieldKey] = useState<string>("");
  const [addAggFn, setAddAggFn] = useState<"count_rows" | "sum" | "avg">("count_rows");
  const [addGroupBySubFieldKey, setAddGroupBySubFieldKey] = useState<string>("");
  const [addValueSubFieldKey, setAddValueSubFieldKey] = useState<string>("");
  const [addFilterSubFieldKey, setAddFilterSubFieldKey] = useState<string>("");
  const [addFilterLabel, setAddFilterLabel] = useState<string>("");
  const [addMultiLineTableFieldKey, setAddMultiLineTableFieldKey] = useState<string>("");
  const [addMultiLineTableSubKeys, setAddMultiLineTableSubKeys] = useState<string[]>([]);
  const [addMultiLineTableJoinEnabled, setAddMultiLineTableJoinEnabled] = useState(false);
  const [addMultiLineTableJoinKpiId, setAddMultiLineTableJoinKpiId] = useState<number | null>(null);
  const [addMultiLineTableJoinFieldKey, setAddMultiLineTableJoinFieldKey] = useState<string>("");
  const [addMultiLineTableJoinOnLeftKey, setAddMultiLineTableJoinOnLeftKey] = useState<string>("");
  const [addMultiLineTableJoinOnRightKey, setAddMultiLineTableJoinOnRightKey] = useState<string>("");
  const [addMultiLineTableJoinSubKeys, setAddMultiLineTableJoinSubKeys] = useState<string[]>([]);
  const [editTab, setEditTab] = useState<EditTab>("basics");

  const isEditing = editingWidgetId != null;

  const openAddWidget = () => {
    setEditingWidgetId(null);
    setEditTab("basics");
    setFullWidth(false);
    setAddType("text");
    setAddTitle("");
    setAddText("");
    setAddFieldKey("");
    setAddFieldKeys("");
    setAddPeriodKey("");
    setAddChartType("bar");
    setAddChartMode("fields");
    setAddMultiLineFieldKey("");
    setAddAggFn("count_rows");
    setAddGroupBySubFieldKey("");
    setAddValueSubFieldKey("");
    setAddFilterSubFieldKey("");
    setAddFilterLabel("");
    setAddMultiLineTableFieldKey("");
    setAddMultiLineTableSubKeys([]);
    setAddMultiLineTableJoinEnabled(false);
    setAddMultiLineTableJoinKpiId(null);
    setAddMultiLineTableJoinFieldKey("");
    setAddMultiLineTableJoinOnLeftKey("");
    setAddMultiLineTableJoinOnRightKey("");
    setAddMultiLineTableJoinSubKeys([]);
    setWidgetModalOpen(true);
  };

  const openEditWidget = (w: Widget) => {
    setEditingWidgetId(w.id);
    setEditTab("basics");
    setFullWidth(!!(w as any).full_width);
    setAddType(w.type as WidgetType);
    setAddTitle((w as any).title || "");
    setAddText((w as any).text || "");
    if ("kpi_id" in w) setAddKpiId((w as any).kpi_id);
    if ("year" in w) setAddYear((w as any).year);
    if ("start_year" in w) setAddStartYear((w as any).start_year);
    if ("end_year" in w) setAddEndYear((w as any).end_year);
    setAddPeriodKey(((w as any).period_key || "") as string);
    if ("field_key" in w) setAddFieldKey((w as any).field_key || "");
    if ("field_keys" in w && Array.isArray((w as any).field_keys)) setAddFieldKeys(((w as any).field_keys || []).join(", "));
    setAddChartType(((w as any).chart_type as any) || "bar");
    setAddChartMode((((w as any).mode as any) || "fields") as any);
    setAddMultiLineFieldKey((w as any).source_field_key || "");
    setAddAggFn((((w as any).agg as any) || "count_rows") as any);
    setAddGroupBySubFieldKey((w as any).group_by_sub_field_key || "");
    setAddValueSubFieldKey((w as any).value_sub_field_key || "");
    setAddFilterSubFieldKey((w as any).filter_sub_field_key || "");
    setAddFilterLabel((w as any).filter_label || "");
    if (w.type === "kpi_multi_line_table") {
      setAddMultiLineTableFieldKey(w.source_field_key || "");
      setAddMultiLineTableSubKeys(Array.isArray(w.sub_field_keys) ? [...w.sub_field_keys] : []);
      const j = (w as any).join;
      if (j && typeof j === "object") {
        setAddMultiLineTableJoinEnabled(true);
        setAddMultiLineTableJoinKpiId(typeof j.kpi_id === "number" ? j.kpi_id : null);
        setAddMultiLineTableJoinFieldKey(j.source_field_key || "");
        setAddMultiLineTableJoinOnLeftKey(j.on_left_sub_field_key || "");
        setAddMultiLineTableJoinOnRightKey(j.on_right_sub_field_key || "");
        setAddMultiLineTableJoinSubKeys(Array.isArray(j.sub_field_keys) ? [...j.sub_field_keys] : []);
      } else {
        setAddMultiLineTableJoinEnabled(false);
        setAddMultiLineTableJoinKpiId(null);
        setAddMultiLineTableJoinFieldKey("");
        setAddMultiLineTableJoinOnLeftKey("");
        setAddMultiLineTableJoinOnRightKey("");
        setAddMultiLineTableJoinSubKeys([]);
      }
    } else {
      setAddMultiLineTableFieldKey("");
      setAddMultiLineTableSubKeys([]);
      setAddMultiLineTableJoinEnabled(false);
      setAddMultiLineTableJoinKpiId(null);
      setAddMultiLineTableJoinFieldKey("");
      setAddMultiLineTableJoinOnLeftKey("");
      setAddMultiLineTableJoinOnRightKey("");
      setAddMultiLineTableJoinSubKeys([]);
    }
    setWidgetModalOpen(true);
  };

  useEffect(() => {
    if (!token) return;
    api<{ role: string }>("/auth/me", { token })
      .then((m) => setUserRole(m.role))
      .catch(() => setUserRole(null));
  }, [token]);

  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    const query = orgIdFromQuery ? `?organization_id=${orgIdFromQuery}` : "";
    api<DashboardDetail>(`/dashboards/${id}${query}`, { token })
      .then((d) => {
        setDashboard(d);
        setWidgets(ensureLayout(d.layout).widgets);
        return d;
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [id, token, orgIdFromQuery]);

  useEffect(() => {
    if (!token || !dashboard?.organization_id) return;
    api<KpiRow[]>(`/kpis?organization_id=${dashboard.organization_id}`, { token })
      .then((list) => {
        setKpis(list);
        if (!addKpiId && list.length > 0) setAddKpiId(list[0].id);
      })
      .catch(() => setKpis([]));
  }, [token, dashboard?.organization_id]);

  useEffect(() => {
    if (!token || !dashboard?.organization_id || !addKpiId) return;
    if (fieldsByKpiId[addKpiId]) return;
    api<KpiFieldRow[]>(`/fields?kpi_id=${addKpiId}&organization_id=${dashboard.organization_id}`, { token })
      .then((fields) => setFieldsByKpiId((prev) => ({ ...prev, [addKpiId]: fields })))
      .catch(() => setFieldsByKpiId((prev) => ({ ...prev, [addKpiId]: [] })));
  }, [token, dashboard?.organization_id, addKpiId, fieldsByKpiId]);

  useEffect(() => {
    if (!token || !dashboard?.organization_id || !addMultiLineTableJoinKpiId) return;
    if (fieldsByKpiId[addMultiLineTableJoinKpiId]) return;
    api<KpiFieldRow[]>(`/fields?kpi_id=${addMultiLineTableJoinKpiId}&organization_id=${dashboard.organization_id}`, { token })
      .then((fields) => setFieldsByKpiId((prev) => ({ ...prev, [addMultiLineTableJoinKpiId]: fields })))
      .catch(() => setFieldsByKpiId((prev) => ({ ...prev, [addMultiLineTableJoinKpiId]: [] })));
  }, [token, dashboard?.organization_id, addMultiLineTableJoinKpiId, fieldsByKpiId]);

  const addFields = useMemo(() => {
    if (!addKpiId) return [];
    return fieldsByKpiId[addKpiId] ?? [];
  }, [addKpiId, fieldsByKpiId]);

  const addMultiLineFields = useMemo(() => addFields.filter((f) => f.field_type === "multi_line_items"), [addFields]);
  const selectedMultiLineField = useMemo(
    () => addMultiLineFields.find((f) => f.key === addMultiLineFieldKey) ?? null,
    [addMultiLineFields, addMultiLineFieldKey]
  );
  const selectedMultiLineSubFields = useMemo(() => selectedMultiLineField?.sub_fields ?? [], [selectedMultiLineField]);
  const numericSubFields = useMemo(
    () => selectedMultiLineSubFields.filter((sf) => sf.field_type === "number"),
    [selectedMultiLineSubFields]
  );

  const selectedTableMultiLineField = useMemo(
    () => addMultiLineFields.find((f) => f.key === addMultiLineTableFieldKey) ?? null,
    [addMultiLineFields, addMultiLineTableFieldKey]
  );
  const tableMultiLineSubFields = useMemo(() => selectedTableMultiLineField?.sub_fields ?? [], [selectedTableMultiLineField]);

  const joinKpiFields = useMemo(() => {
    if (!addMultiLineTableJoinKpiId) return [];
    return fieldsByKpiId[addMultiLineTableJoinKpiId] ?? [];
  }, [addMultiLineTableJoinKpiId, fieldsByKpiId]);
  const joinMultiLineFields = useMemo(() => joinKpiFields.filter((f) => f.field_type === "multi_line_items"), [joinKpiFields]);
  const selectedJoinMultiLineField = useMemo(
    () => joinMultiLineFields.find((f) => f.key === addMultiLineTableJoinFieldKey) ?? null,
    [joinMultiLineFields, addMultiLineTableJoinFieldKey]
  );
  const joinMultiLineSubFields = useMemo(() => selectedJoinMultiLineField?.sub_fields ?? [], [selectedJoinMultiLineField]);

  const persistWidgets = async (nextWidgets: Widget[]) => {
    if (!token || !dashboard) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/dashboards/${dashboard.id}?organization_id=${dashboard.organization_id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ layout: { widgets: nextWidgets } }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const applyWidgetUpsert = (w: Widget) => {
    const nextWidgets = editingWidgetId ? widgets.map((x) => (x.id === editingWidgetId ? w : x)) : [...widgets, w];
    setWidgets(nextWidgets);
    toast.success(editingWidgetId ? "Widget updated" : "Widget added");
    setWidgetModalOpen(false);
    // Auto-persist so refresh doesn't lose title/filter label/etc.
    persistWidgets(nextWidgets);
  };

  const upsertWidget = () => {
    const title = addTitle.trim() || undefined;
    if (addType === "text") {
      const w: Widget = { id: editingWidgetId ?? newId(), type: "text", title, text: addText, full_width: fullWidth };
      applyWidgetUpsert(w);
      return;
    }
    if (!addKpiId) return;
    const period_key = addPeriodKey.trim() ? addPeriodKey.trim() : null;
    if (addType === "kpi_single_value") {
      if (!addFieldKey.trim()) return;
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_single_value",
        title,
        kpi_id: addKpiId,
        year: addYear,
        period_key,
        field_key: addFieldKey.trim(),
        full_width: fullWidth,
      };
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_table") {
      const keys = addFieldKeys
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_table",
        title,
        kpi_id: addKpiId,
        year: addYear,
        period_key,
        field_keys: keys.length ? keys : undefined,
        full_width: fullWidth,
      };
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_line_chart") {
      if (!addFieldKey.trim()) return;
      const a = Math.min(addStartYear, addEndYear);
      const b = Math.max(addStartYear, addEndYear);
      if (b - a > 30) {
        toast.error("Year range: max 31 years");
        return;
      }
      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_line_chart",
        title,
        kpi_id: addKpiId,
        field_key: addFieldKey.trim(),
        start_year: a,
        end_year: b,
        period_key,
        full_width: fullWidth,
      };
      applyWidgetUpsert(w);
      return;
    }
    if (addType === "kpi_bar_chart") {
      // Basic validation messages (keep it simple)
      if (addChartMode === "fields") {
        const keys = addFieldKeys
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (keys.length === 0) {
          toast.error("Add at least one field key for the chart");
          return;
        }
      } else {
        if (!addMultiLineFieldKey.trim()) {
          toast.error("Select a multi-line items field");
          return;
        }
        if (!addGroupBySubFieldKey.trim()) {
          toast.error("Select a group-by sub-field");
          return;
        }
        if (addFilterSubFieldKey.trim() && addFilterSubFieldKey.trim() === addGroupBySubFieldKey.trim()) {
          toast.error("Filter column should be different from Group by");
          return;
        }
        if ((addAggFn === "sum" || addAggFn === "avg") && !addValueSubFieldKey.trim()) {
          toast.error("Select a numeric sub-field to aggregate");
          return;
        }
      }
      const w: any =
        addChartMode === "multi_line_items"
          ? {
              id: editingWidgetId ?? newId(),
              type: "kpi_bar_chart",
              title,
              kpi_id: addKpiId,
              year: addYear,
              period_key,
              chart_type: addChartType,
              mode: "multi_line_items",
              source_field_key: addMultiLineFieldKey.trim(),
              agg: addAggFn,
              group_by_sub_field_key: addGroupBySubFieldKey.trim(),
              value_sub_field_key: addAggFn === "count_rows" ? undefined : addValueSubFieldKey.trim(),
              filter_sub_field_key: addFilterSubFieldKey.trim() || undefined,
              filter_label: addFilterLabel.trim() || undefined,
              full_width: fullWidth,
            }
          : {
              id: editingWidgetId ?? newId(),
              type: "kpi_bar_chart",
              title,
              kpi_id: addKpiId,
              year: addYear,
              period_key,
              chart_type: addChartType,
              mode: "fields",
              field_keys: addFieldKeys
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              full_width: fullWidth,
            };
      applyWidgetUpsert(w as Widget);
      return;
    }
    if (addType === "kpi_multi_line_table") {
      if (!addMultiLineTableFieldKey.trim()) {
        toast.error("Select a multi-line items field");
        return;
      }
      const subKeys = addMultiLineTableSubKeys.filter((k) => k.trim());
      if (subKeys.length === 0) {
        toast.error("Select at least one sub-field column");
        return;
      }

      const join =
        addMultiLineTableJoinEnabled && addMultiLineTableJoinKpiId && addMultiLineTableJoinFieldKey.trim()
          ? {
              kpi_id: addMultiLineTableJoinKpiId,
              source_field_key: addMultiLineTableJoinFieldKey.trim(),
              on_left_sub_field_key: addMultiLineTableJoinOnLeftKey.trim(),
              on_right_sub_field_key: addMultiLineTableJoinOnRightKey.trim(),
              sub_field_keys: addMultiLineTableJoinSubKeys.filter((k) => k.trim()),
            }
          : undefined;
      if (join) {
        if (!join.on_left_sub_field_key || !join.on_right_sub_field_key) {
          toast.error("Select join keys (left and right)");
          return;
        }
        if (join.sub_field_keys.length === 0) {
          toast.error("Select at least one joined sub-field column");
          return;
        }
      }

      const w: Widget = {
        id: editingWidgetId ?? newId(),
        type: "kpi_multi_line_table",
        title,
        kpi_id: addKpiId,
        year: addYear,
        period_key,
        source_field_key: addMultiLineTableFieldKey.trim(),
        sub_field_keys: subKeys,
        join,
        full_width: fullWidth,
      };
      applyWidgetUpsert(w);
      return;
    }
  };

  const handleSave = async () => {
    if (!token || !dashboard) return;
    await persistWidgets(widgets);
    if (!error) toast.success("Saved");
  };

  const removeWidget = (wid: string) => setWidgets((prev) => prev.filter((w) => w.id !== wid));

  const toggleWidgetFullWidth = (wid: string) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === wid ? ({ ...w, full_width: !(w as any).full_width } as any) : w))
    );
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!dashboard) return null;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem", fontSize: "1.5rem" }}>Design: {dashboard.name}</h1>
          <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 0 }}>
            This page renders the dashboard exactly as users will see it. Use the inline controls on widgets to edit the layout.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save layout"}
          </button>
          <button type="button" className="btn btn-primary" onClick={openAddWidget}>
            + Add widget
          </button>
        </div>
      </div>

      {!widgetModalOpen &&
        (widgets.length === 0 ? (
          <div className="card" style={{ padding: "1rem" }}>
            <p style={{ color: "var(--muted)", margin: 0 }}>No widgets yet. Click “Add widget”.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {widgets.map((w) => (
              <div key={w.id} style={{ gridColumn: (w as any).full_width ? "1 / -1" : undefined }}>
                <WidgetRenderer
                  widget={w as any}
                  organizationId={dashboard.organization_id}
                  dashboardId={dashboard.id}
                  designActions={
                    userRole === "SUPER_ADMIN"
                      ? {
                          onEdit: () => openEditWidget(w),
                          onDelete: () => removeWidget(w.id),
                          onToggleFullWidth: () => toggleWidgetFullWidth(w.id),
                          isFullWidth: !!(w as any).full_width,
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        ))}

      {widgetModalOpen && (
        <div className="modal-backdrop">
          <div
            className="modal"
            style={{
              width: "min(980px, 100%)",
              height: "min(100vh, 100%)",
              maxWidth: "none",
              maxHeight: "none",
              borderRadius: 0,
              padding: 0,
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: "auto 1fr",
            }}
          >
            <div
              style={{
                padding: "0.9rem 1rem",
                borderBottom: "1px solid var(--border)",
                background: "var(--surface)",
                display: "grid",
                gap: "0.75rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: "0.15rem" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>{isEditing ? "Edit widget" : "Add widget"}</div>
                  <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Preview is hidden while editing.</div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <button type="button" className="btn" onClick={() => setWidgetModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={upsertWidget}>
                    {isEditing ? "Update widget" : "Add widget"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditTab("basics")}
                  aria-pressed={editTab === "basics"}
                  style={{ fontSize: "0.85rem", borderColor: editTab === "basics" ? "var(--accent)" : undefined, color: editTab === "basics" ? "var(--accent)" : undefined }}
                >
                  Basics
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditTab("options")}
                  aria-pressed={editTab === "options"}
                  style={{ fontSize: "0.85rem", borderColor: editTab === "options" ? "var(--accent)" : undefined, color: editTab === "options" ? "var(--accent)" : undefined }}
                >
                  Options
                </button>
              </div>
            </div>

            <div style={{ overflow: "auto", overflowX: "hidden", padding: "0.9rem" }}>
              <div style={{ maxWidth: 680, margin: "0 auto", display: "grid", gap: "0.75rem" }}>
                {editTab === "basics" && (
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Type</label>
                      <select
                        value={addType}
                        onChange={(e) => setAddType(e.target.value as WidgetType)}
                        style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                      >
                        <option value="text">Text</option>
                        <option value="kpi_single_value">KPI single value</option>
                        <option value="kpi_table">KPI table</option>
                        <option value="kpi_line_chart">KPI line chart (by year)</option>
                        <option value="kpi_bar_chart">KPI chart (bar/pie)</option>
                        <option value="kpi_multi_line_table">KPI multi-line table</option>
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Title</label>
                      <input
                        value={addTitle}
                        onChange={(e) => setAddTitle(e.target.value)}
                        style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                        placeholder="Optional"
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Layout</label>
                      <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                        <input type="checkbox" checked={fullWidth} onChange={(e) => setFullWidth(e.target.checked)} />
                        Full width
                      </label>
                    </div>
                    {addType !== "text" && (
                      <>
                        <div style={{ height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>KPI</label>
                          <select
                            value={addKpiId ?? ""}
                            onChange={(e) => setAddKpiId(Number(e.target.value))}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            {kpis.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.name} (#{k.id})
                              </option>
                            ))}
                          </select>
                        </div>

                        {addType === "kpi_line_chart" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Start year</label>
                              <input
                                type="number"
                                value={addStartYear}
                                onChange={(e) => setAddStartYear(Number(e.target.value))}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>End year</label>
                              <input
                                type="number"
                                value={addEndYear}
                                onChange={(e) => setAddEndYear(Number(e.target.value))}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Year</label>
                            <input
                              type="number"
                              value={addYear}
                              onChange={(e) => setAddYear(Number(e.target.value))}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            />
                          </div>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Period</label>
                          <input
                            value={addPeriodKey}
                            onChange={(e) => setAddPeriodKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            placeholder="Optional"
                          />
                        </div>

                        {(addType === "kpi_single_value" || addType === "kpi_line_chart") && (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field</label>
                            <select
                              value={addFieldKey}
                              onChange={(e) => setAddFieldKey(e.target.value)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            >
                              <option value="">Select…</option>
                              {addFields.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.name} ({f.key})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </>
                    )}
                    {addType === "text" && (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Text</label>
                        <textarea
                          value={addText}
                          onChange={(e) => setAddText(e.target.value)}
                          style={{ padding: "0.55rem", minHeight: 220, fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {editTab === "options" && (
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    {addType === "kpi_table" && (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field keys</label>
                        <input
                          value={addFieldKeys}
                          onChange={(e) => setAddFieldKeys(e.target.value)}
                          style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          placeholder="Comma-separated (optional)"
                        />
                      </div>
                    )}

                    {addType === "kpi_bar_chart" && (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Chart</label>
                          <select
                            value={addChartType}
                            onChange={(e) => setAddChartType(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="bar">Bar</option>
                            <option value="pie">Pie</option>
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Data</label>
                          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                              <input type="radio" checked={addChartMode === "fields"} onChange={() => setAddChartMode("fields")} />
                              Fields
                            </label>
                            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                              <input type="radio" checked={addChartMode === "multi_line_items"} onChange={() => setAddChartMode("multi_line_items")} />
                              Multi-line items
                            </label>
                          </div>
                        </div>
                      </>
                    )}

                    {addType === "kpi_bar_chart" && addChartMode === "fields" && (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Field keys</label>
                        <input
                          value={addFieldKeys}
                          onChange={(e) => setAddFieldKeys(e.target.value)}
                          style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          placeholder="Comma-separated (required)"
                        />
                      </div>
                    )}

                    {addType === "kpi_multi_line_table" && (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Source</label>
                          <select
                            value={addMultiLineTableFieldKey}
                            onChange={(e) => {
                              setAddMultiLineTableFieldKey(e.target.value);
                              setAddMultiLineTableSubKeys([]);
                            }}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">Select…</option>
                            {addMultiLineFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.name} ({f.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        {tableMultiLineSubFields.length > 0 && (
                          <div style={{ display: "grid", gap: "0.35rem" }}>
                            <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Columns viewers may see</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                              {tableMultiLineSubFields.map((sf) => (
                                <label key={sf.key} style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                                  <input
                                    type="checkbox"
                                    checked={addMultiLineTableSubKeys.includes(sf.key)}
                                    onChange={(e) => {
                                      setAddMultiLineTableSubKeys((prev) =>
                                        e.target.checked ? [...prev, sf.key] : prev.filter((k) => k !== sf.key)
                                      );
                                    }}
                                  />
                                  <span>
                                    {sf.name} <span style={{ color: "var(--muted)" }}>({sf.key})</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
                        <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                          <input
                            type="checkbox"
                            checked={addMultiLineTableJoinEnabled}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setAddMultiLineTableJoinEnabled(on);
                              if (!on) {
                                setAddMultiLineTableJoinKpiId(null);
                                setAddMultiLineTableJoinFieldKey("");
                                setAddMultiLineTableJoinOnLeftKey("");
                                setAddMultiLineTableJoinOnRightKey("");
                                setAddMultiLineTableJoinSubKeys([]);
                              }
                            }}
                          />
                          Join another KPI’s multi-line items
                        </label>

                        {addMultiLineTableJoinEnabled && (
                          <div style={{ display: "grid", gap: "0.75rem" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join KPI</label>
                              <select
                                value={addMultiLineTableJoinKpiId ?? ""}
                                onChange={(e) => {
                                  const next = Number(e.target.value);
                                  setAddMultiLineTableJoinKpiId(Number.isFinite(next) ? next : null);
                                  setAddMultiLineTableJoinFieldKey("");
                                  setAddMultiLineTableJoinOnRightKey("");
                                  setAddMultiLineTableJoinSubKeys([]);
                                }}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              >
                                <option value="">Select…</option>
                                {kpis.map((k) => (
                                  <option key={k.id} value={k.id}>
                                    {k.name} (#{k.id})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                              <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join source</label>
                              <select
                                value={addMultiLineTableJoinFieldKey}
                                onChange={(e) => {
                                  setAddMultiLineTableJoinFieldKey(e.target.value);
                                  setAddMultiLineTableJoinOnRightKey("");
                                  setAddMultiLineTableJoinSubKeys([]);
                                }}
                                style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                disabled={!addMultiLineTableJoinKpiId}
                              >
                                <option value="">Select…</option>
                                {joinMultiLineFields.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.name} ({f.key})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                              <div style={{ display: "grid", gap: "0.25rem" }}>
                                <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join key (this table)</label>
                                <select
                                  value={addMultiLineTableJoinOnLeftKey}
                                  onChange={(e) => setAddMultiLineTableJoinOnLeftKey(e.target.value)}
                                  style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                  disabled={!addMultiLineTableFieldKey}
                                >
                                  <option value="">Select…</option>
                                  {tableMultiLineSubFields.map((sf) => (
                                    <option key={sf.key} value={sf.key}>
                                      {sf.name} ({sf.key})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div style={{ display: "grid", gap: "0.25rem" }}>
                                <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Join key (joined KPI)</label>
                                <select
                                  value={addMultiLineTableJoinOnRightKey}
                                  onChange={(e) => setAddMultiLineTableJoinOnRightKey(e.target.value)}
                                  style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                                  disabled={!addMultiLineTableJoinFieldKey}
                                >
                                  <option value="">Select…</option>
                                  {joinMultiLineSubFields.map((sf) => (
                                    <option key={sf.key} value={sf.key}>
                                      {sf.name} ({sf.key})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {joinMultiLineSubFields.length > 0 && (
                              <div style={{ display: "grid", gap: "0.35rem" }}>
                                <div style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Joined columns viewers may see</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                  {joinMultiLineSubFields.map((sf) => (
                                    <label key={sf.key} style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.9rem" }}>
                                      <input
                                        type="checkbox"
                                        checked={addMultiLineTableJoinSubKeys.includes(sf.key)}
                                        onChange={(e) => {
                                          setAddMultiLineTableJoinSubKeys((prev) =>
                                            e.target.checked ? [...prev, sf.key] : prev.filter((k) => k !== sf.key)
                                          );
                                        }}
                                      />
                                      <span>
                                        {sf.name} <span style={{ color: "var(--muted)" }}>({sf.key})</span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {addType === "kpi_bar_chart" && addChartMode === "multi_line_items" && (
                      <div style={{ display: "grid", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Source</label>
                          <select
                            value={addMultiLineFieldKey}
                            onChange={(e) => setAddMultiLineFieldKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">Select…</option>
                            {addMultiLineFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.name} ({f.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Aggregate</label>
                          <select
                            value={addAggFn}
                            onChange={(e) => setAddAggFn(e.target.value as any)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            disabled={!addMultiLineFieldKey}
                          >
                            <option value="count_rows">Count rows</option>
                            <option value="sum">Sum</option>
                            <option value="avg">Average</option>
                          </select>
                        </div>
                        {(addAggFn === "sum" || addAggFn === "avg") && (
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Value</label>
                            <select
                              value={addValueSubFieldKey}
                              onChange={(e) => setAddValueSubFieldKey(e.target.value)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                            >
                              <option value="">Select numeric…</option>
                              {numericSubFields.map((sf) => (
                                <option key={sf.key} value={sf.key}>
                                  {sf.name} ({sf.key})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Group by</label>
                          <select
                            value={addGroupBySubFieldKey}
                            onChange={(e) => setAddGroupBySubFieldKey(e.target.value)}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">Select…</option>
                            {selectedMultiLineSubFields.map((sf) => (
                              <option key={sf.key} value={sf.key}>
                                {sf.name} ({sf.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: "0.5rem", alignItems: "center" }}>
                          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Filter</label>
                          <select
                            value={addFilterSubFieldKey}
                            onChange={(e) => {
                              const next = e.target.value;
                              setAddFilterSubFieldKey(next);
                              if (!next) setAddFilterLabel("");
                            }}
                            style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">None</option>
                            {selectedMultiLineSubFields.map((sf) => (
                              <option key={sf.key} value={sf.key}>
                                {sf.name} ({sf.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        {addFilterSubFieldKey.trim() && (
                          <div style={{ display: "grid", gap: "0.35rem" }}>
                            <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Filter button text</label>
                            <input
                              value={addFilterLabel}
                              onChange={(e) => setAddFilterLabel(e.target.value)}
                              style={{ padding: "0.35rem 0.45rem", fontSize: "0.9rem", width: "100%", minWidth: 0, boxSizing: "border-box" }}
                              placeholder={`Optional (defaults to ${addFilterSubFieldKey})`}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {addType !== "kpi_table" &&
                      addType !== "kpi_bar_chart" &&
                      addType !== "kpi_multi_line_table" &&
                      addType !== "text" && (
                      <div className="card" style={{ padding: "0.9rem" }}>
                        <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>No extra options</div>
                        <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>This widget type doesn’t have additional options.</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
