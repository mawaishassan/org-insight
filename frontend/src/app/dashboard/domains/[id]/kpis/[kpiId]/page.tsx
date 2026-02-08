"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";

interface SubFieldDef {
  id: number;
  field_id: number;
  name: string;
  key: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
}

interface FieldDef {
  id: number;
  key: string;
  name: string;
  field_type: string;
  is_required: boolean;
  formula_expression?: string | null;
  sub_fields?: SubFieldDef[];
}

interface FieldValueResp {
  field_id: number;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown;
  value_boolean: boolean | null;
  value_date: string | null;
}

interface EntryRow {
  id: number;
  kpi_id: number;
  organization_id: number;
  user_id: number | null;
  year: number;
  is_draft: boolean;
  is_locked: boolean;
  submitted_at: string | null;
  values: FieldValueResp[];
}

interface OverviewItem {
  kpi_id: number;
  kpi_name: string;
  assigned_user_names?: string[];
  entry: {
    id: number;
    last_updated_at?: string | null;
    entered_by_user_name?: string | null;
  } | null;
}

interface UserRef {
  id: number;
  username: string;
  full_name: string | null;
  permission?: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return new URLSearchParams(entries as Record<string, string>).toString();
}

const FORMULA_BOX_COLORS = [
  "var(--primary)",
  "var(--success)",
  "var(--accent)",
  "var(--warning)",
];

function formatValue(f: FieldDef, v: FieldValueResp | undefined): string {
  if (!v) return "—";
  if (v.value_text != null) return String(v.value_text);
  if (v.value_number != null) return String(v.value_number);
  if (v.value_boolean != null) return v.value_boolean ? "Yes" : "No";
  if (v.value_date) return String(v.value_date).slice(0, 10);
  if (f.field_type === "multi_line_items" && Array.isArray(v.value_json)) return `${v.value_json.length} row(s)`;
  if (v.value_json != null) return String(v.value_json).slice(0, 50);
  return "—";
}

export default function DomainKpiDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const domainId = params.id != null ? Number(params.id) : undefined;
  const kpiId = Number(params.kpiId);
  const yearParam = searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  const orgIdParam = searchParams.get("organization_id");
  const organizationIdFromUrl = orgIdParam ? Number(orgIdParam) : undefined;

  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [kpiName, setKpiName] = useState<string>("");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [overviewItem, setOverviewItem] = useState<OverviewItem | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<UserRef[]>([]);
  const [orgUsers, setOrgUsers] = useState<UserRef[]>([]);
  const [kpiApiInfo, setKpiApiInfo] = useState<{ entry_mode?: string; api_endpoint_url?: string | null; can_edit?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"scalar" | number>("scalar");
  /** When editing: list of { user_id, permission } for PUT assignments */
  const [editAssignments, setEditAssignments] = useState<{ user_id: number; permission: string }[]>([]);
  const [uploadingFieldId, setUploadingFieldId] = useState<number | null>(null);
  const [uploadOption, setUploadOption] = useState<"append" | "override" | null>(null);
  const [syncOption, setSyncOption] = useState<"append" | "override" | null>(null);
  const [fetchingFromApi, setFetchingFromApi] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [bulkMethod, setBulkMethod] = useState<"upload" | "api">("upload");
  /** Bulk upload section is hidden until user clicks the "Bulk upload" link (per multi_line field) */
  const [bulkExpandedByFieldId, setBulkExpandedByFieldId] = useState<Record<number, boolean>>({});

  type FormCell = { value_text?: string; value_number?: number; value_boolean?: boolean; value_date?: string; value_json?: Record<string, unknown>[] };
  const [formValues, setFormValues] = useState<Record<number, FormCell>>({});

  const token = getAccessToken();
  const effectiveOrgId = organizationIdFromUrl ?? meOrgId ?? entry?.organization_id ?? undefined;

  const valuesByFieldId = useMemo(() => {
    const map = new Map<number, FieldValueResp>();
    (entry?.values ?? []).forEach((v) => map.set(v.field_id, v));
    return map;
  }, [entry?.values]);

  const formulaFields = useMemo(() => fields.filter((f) => f.field_type === "formula"), [fields]);
  const scalarFields = useMemo(
    () => fields.filter((f) => f.field_type !== "formula" && f.field_type !== "multi_line_items"),
    [fields]
  );
  const multiLineFields = useMemo(
    () => fields.filter((f) => f.field_type === "multi_line_items"),
    [fields]
  );

  const formulaBoxes = useMemo(() => {
    const withValues = formulaFields.map((f) => ({
      field: f,
      value: valuesByFieldId.get(f.id)?.value_number ?? null,
    }));
    return withValues.slice(0, 4);
  }, [formulaFields, valuesByFieldId]);

  const lastUpdatedFormatted =
    overviewItem?.entry?.last_updated_at &&
    (() => {
      const d = new Date(overviewItem.entry!.last_updated_at!);
      return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en", { month: "short" })}-${d.getFullYear()}`;
    })();

  useEffect(() => {
    if (!token) return;
    api<{ organization_id: number | null; role: string }>("/auth/me", { token })
      .then((me) => {
        setMeOrgId(me.organization_id ?? null);
        setMeRole(me.role ?? null);
      })
      .catch(() => {
        setMeOrgId(null);
        setMeRole(null);
      });
  }, [token]);

  const loadData = async () => {
    if (!token || !kpiId || effectiveOrgId == null) return;
    setError(null);
    const fieldsQuery = `?${qs({ kpi_id: kpiId, organization_id: effectiveOrgId })}`;
    const entriesQuery = `?${qs({ kpi_id: kpiId, year, organization_id: effectiveOrgId })}`;
    const overviewQuery = `?${qs({ year, organization_id: effectiveOrgId })}`;
    const kpiQuery = `?${qs({ organization_id: effectiveOrgId })}`;
    const usersQuery = `?${qs({ organization_id: effectiveOrgId })}`;
    const apiInfoQuery = `?${qs({ kpi_id: kpiId, organization_id: effectiveOrgId })}`;
    const [
      fieldsList,
      entriesList,
      overviewList,
      kpiResp,
      assignmentsList,
      usersList,
      apiInfo,
    ] = await Promise.all([
      api<FieldDef[]>(`/entries/fields${fieldsQuery}`, { token }).catch(() => []),
      api<EntryRow[]>(`/entries${entriesQuery}`, { token }).then((list) => list).catch(() => []),
      api<OverviewItem[]>(`/entries/overview${overviewQuery}`, { token }).catch(() => []),
      api<{ name: string }>(`/kpis/${kpiId}${kpiQuery}`, { token }).catch(() => null),
      api<UserRef[]>(`/kpis/${kpiId}/assignments${kpiQuery}`, { token }).catch(() => []),
      api<UserRef[]>(`/users${usersQuery}`, { token }).catch(() => []),
      api<{ entry_mode?: string; api_endpoint_url?: string | null; can_edit?: boolean }>(`/entries/kpi-api-info${apiInfoQuery}`, { token }).catch(() => null),
    ]);
    setFields(fieldsList);
    setEntry(entriesList[0] ?? null);
    setOverviewItem(overviewList.find((x) => x.kpi_id === kpiId) ?? null);
    const ov = overviewList.find((x) => x.kpi_id === kpiId);
    if (kpiResp?.name) setKpiName(kpiResp.name);
    else if (ov?.kpi_name) setKpiName(ov.kpi_name);
    else setKpiName(`KPI #${kpiId}`);
    setAssignedUsers(Array.isArray(assignmentsList) ? assignmentsList.map((u: UserRef & { permission?: string }) => ({ id: u.id, username: u.username, full_name: u.full_name ?? null, permission: u.permission || "data_entry" })) : []);
    setOrgUsers(Array.isArray(usersList) ? usersList : []);
    setKpiApiInfo(apiInfo ?? null);
  };

  useEffect(() => {
    if (!token || !kpiId || effectiveOrgId == null) return;
    setError(null);
    loadData().catch((e) => setError(e instanceof Error ? e.message : "Failed to load")).finally(() => setLoading(false));
  }, [token, kpiId, year, effectiveOrgId]);

  const buildFormValuesFromEntry = (e: EntryRow | null): Record<number, FormCell> => {
    const out: Record<number, FormCell> = {};
    const valueMap = new Map((e?.values ?? []).map((v) => [v.field_id, v]));
    fields.forEach((f) => {
      if (f.field_type === "formula") return;
      const v = valueMap.get(f.id);
      if (f.field_type === "multi_line_items") {
        out[f.id] = { value_json: Array.isArray(v?.value_json) ? (v!.value_json as Record<string, unknown>[]) : [] };
      } else {
        out[f.id] = {};
        if (v?.value_text != null) out[f.id].value_text = v.value_text;
        if (v?.value_number != null) out[f.id].value_number = v.value_number;
        if (v?.value_boolean != null) out[f.id].value_boolean = v.value_boolean;
        if (v?.value_date) out[f.id].value_date = String(v.value_date).slice(0, 10);
      }
    });
    return out;
  };

  const startEditing = () => {
    setFormValues(buildFormValuesFromEntry(entry));
    setEditAssignments(assignedUsers.map((u) => ({ user_id: u.id, permission: u.permission || "data_entry" })));
    setIsEditing(true);
    setSaveError(null);
  };

  const updateField = (fieldId: number, key: keyof FormCell, value: string | number | boolean | Record<string, unknown>[] | undefined) => {
    setFormValues((prev) => ({ ...prev, [fieldId]: { ...prev[fieldId], [key]: value } }));
  };

  const handleSave = async () => {
    if (!token || effectiveOrgId == null) return;
    setSaveError(null);
    setSaving(true);
    try {
      const values = fields
        .filter((f) => f.field_type !== "formula")
        .map((f) => {
          const v = formValues[f.id] ?? {};
          const payload: { field_id: number; value_text?: string | null; value_number?: number | null; value_boolean?: boolean | null; value_date?: string | null; value_json?: Record<string, unknown>[] | null } = {
            field_id: f.id,
            value_text: v.value_text ?? null,
            value_number: typeof v.value_number === "number" ? v.value_number : null,
            value_boolean: v.value_boolean ?? null,
            value_date: v.value_date || null,
          };
          if (f.field_type === "multi_line_items" && Array.isArray(v.value_json)) payload.value_json = v.value_json;
          return payload;
        });
      const saveQuery = `?${qs({ organization_id: effectiveOrgId })}`;
      const updated = await api<EntryRow>(`/entries${saveQuery}`, {
        method: "POST",
        body: JSON.stringify({ kpi_id: kpiId, year, is_draft: entry?.is_draft ?? true, values }),
        token,
      });
      setEntry(updated);
      const isOrgAdmin = meRole === "ORG_ADMIN" || meRole === "SUPER_ADMIN";
      if (isOrgAdmin) {
        await api(`/kpis/${kpiId}/assignments?${saveQuery}`, {
          method: "PUT",
          body: JSON.stringify({ assignments: editAssignments.map((a) => ({ user_id: a.user_id, permission: a.permission || "data_entry" })) }),
          token,
        });
      }
      await loadData();
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const backHref =
    domainId != null
      ? (effectiveOrgId != null
          ? `/dashboard/domains/${domainId}?organization_id=${effectiveOrgId}&year=${year}`
          : `/dashboard/domains/${domainId}?year=${year}`)
      : (effectiveOrgId != null
          ? `/dashboard/entries?year=${year}&organization_id=${effectiveOrgId}`
          : "/dashboard/entries");

  const canEditKpi = kpiApiInfo?.can_edit !== false;
  const dataEntryAssignees = useMemo(
    () => assignedUsers.filter((u) => (u.permission || "data_entry") === "data_entry"),
    [assignedUsers]
  );
  const viewOnlyAssignees = useMemo(
    () => assignedUsers.filter((u) => u.permission === "view"),
    [assignedUsers]
  );
  const assignedNames = useMemo(
    () => dataEntryAssignees.map((u) => (u.full_name || u.username || "").trim() || u.username),
    [dataEntryAssignees]
  );
  const totalFields = fields.length;
  const isLocked = entry?.is_locked ?? false;
  const isApiKpi = kpiApiInfo?.entry_mode === "api" && kpiApiInfo?.api_endpoint_url && effectiveOrgId != null;

  if (!kpiId) return <p>Invalid KPI.</p>;
  if (loading) return <p>Loading...</p>;
  if (effectiveOrgId == null) return <p>Organization context required.</p>;

  return (
    <div>
      {domainId != null && (
        <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <Link href={backHref} style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            ← Back to Domain
          </Link>
        </div>
      )}

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {saveError && <p className="form-error" style={{ marginBottom: "1rem" }}>{saveError}</p>}

      {/* Section 1: Formula fields in colored boxes (max 4) */}
      {formulaBoxes.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1.5rem",
          }}
        >
          {formulaBoxes.map(({ field, value }, idx) => (
            <div
              key={field.id}
              style={{
                minWidth: 120,
                padding: "0.75rem 1rem",
                borderRadius: 8,
                background: FORMULA_BOX_COLORS[idx % FORMULA_BOX_COLORS.length],
                color: "var(--on-muted)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div style={{ fontSize: "0.75rem", opacity: 0.9, marginBottom: "0.25rem" }}>{field.name}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                {value != null ? String(value) : "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section 2: KPI details + Edit */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <h1 style={{ fontSize: "1.5rem", margin: 0 }}>{kpiName}</h1>
              {!canEditKpi && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    padding: "0.2rem 0.5rem",
                    borderRadius: 4,
                    background: "var(--muted)",
                    color: "var(--text)",
                  }}
                >
                  View only
                </span>
              )}
            </div>
            <p style={{ color: "var(--muted)", marginBottom: "0.25rem" }}>Year {year}</p>
            <p style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>
              <strong>Total fields:</strong> {totalFields}
            </p>
            <p style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>
              <strong>Assigned:</strong>{" "}
              {isEditing ? (
                <span style={{ display: "inline-block", marginLeft: "0.25rem" }}>
                  {editAssignments.map((a) => {
                    const u = orgUsers.find((o) => o.id === a.user_id);
                    const name = u ? (u.full_name || u.username || "").trim() || u.username : `User #${a.user_id}`;
                    return (
                      <span
                        key={a.user_id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          marginRight: "0.5rem",
                          marginBottom: "0.25rem",
                          padding: "0.2rem 0.4rem",
                          background: "var(--border)",
                          borderRadius: 6,
                          fontSize: "0.85rem",
                        }}
                      >
                        {name}
                        <select
                          value={a.permission || "data_entry"}
                          onChange={(e) => {
                            const perm = e.target.value;
                            setEditAssignments((prev) =>
                              prev.map((x) => (x.user_id === a.user_id ? { ...x, permission: perm } : x))
                            );
                          }}
                          style={{ padding: "0.15rem 0.25rem", fontSize: "0.8rem" }}
                        >
                          <option value="data_entry">Data entry</option>
                          <option value="view">View only</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => setEditAssignments((prev) => prev.filter((x) => x.user_id !== a.user_id))}
                          style={{ padding: 0, border: "none", background: "none", cursor: "pointer", fontSize: "1rem" }}
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  {orgUsers.filter((u) => !editAssignments.some((a) => a.user_id === u.id)).length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) {
                          setEditAssignments((prev) => [...prev, { user_id: Number(v), permission: "data_entry" }]);
                          e.target.value = "";
                        }
                      }}
                      style={{ marginLeft: "0.25rem", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                    >
                      <option value="">Add user…</option>
                      {orgUsers
                        .filter((u) => !editAssignments.some((a) => a.user_id === u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name || u.username}
                          </option>
                        ))}
                    </select>
                  )}
                </span>
              ) : (
                <>
                  {dataEntryAssignees.length > 0 && (
                    <span style={{ marginRight: "0.75rem" }}>
                      Data entry: {dataEntryAssignees.map((u) => (u.full_name || u.username || "").trim() || u.username).join(", ")}
                    </span>
                  )}
                  {viewOnlyAssignees.length > 0 && (
                    <span>View only: {viewOnlyAssignees.map((u) => (u.full_name || u.username || "").trim() || u.username).join(", ")}</span>
                  )}
                  {assignedUsers.length === 0 && "None"}
                </>
              )}
            </p>
            {lastUpdatedFormatted && (
              <p style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>
                <strong>Last updated:</strong> {lastUpdatedFormatted}
                {overviewItem?.entry?.entered_by_user_name && ` by ${overviewItem.entry.entered_by_user_name}`}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {isEditing ? (
              <>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn" onClick={() => { setIsEditing(false); setSaveError(null); }}>
                  Cancel
                </button>
              </>
            ) : (
              !isLocked && canEditKpi && (
                <button type="button" className="btn btn-primary" onClick={startEditing}>
                  Edit
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Section 3: Tabs – Field details (scalar + formula), then one tab per multi_line_items */}
      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", borderBottom: "1px solid var(--border)", marginBottom: "1rem", paddingBottom: "0.5rem" }}>
          <button
            type="button"
            className="btn"
            style={{
              ...(activeTab === "scalar" ? { background: "var(--accent)", color: "var(--on-muted)" } : {}),
            }}
            onClick={() => setActiveTab("scalar")}
          >
            Field details
          </button>
          {multiLineFields.map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn"
              style={{
                ...(activeTab === f.id ? { background: "var(--accent)", color: "var(--on-muted)" } : {}),
              }}
              onClick={() => setActiveTab(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>

        {activeTab === "scalar" && (
          <div style={{ overflowX: "auto" }}>
            {isEditing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {fields
                  .filter((f) => f.field_type !== "multi_line_items")
                  .map((f) => {
                    if (f.field_type === "formula") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <label style={{ minWidth: 160, fontWeight: 500 }}>{f.name} (formula)</label>
                          <span style={{ color: "var(--muted)" }}>{formatValue(f, valuesByFieldId.get(f.id))}</span>
                        </div>
                      );
                    }
                    const val = formValues[f.id];
                    if (f.field_type === "single_line_text" || f.field_type === "multi_line_text") {
                      return (
                        <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <label style={{ fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          {f.field_type === "multi_line_text" ? (
                            <textarea
                              rows={3}
                              value={val?.value_text ?? ""}
                              onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                              style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6 }}
                            />
                          ) : (
                            <input
                              type="text"
                              value={val?.value_text ?? ""}
                              onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                              style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6 }}
                            />
                          )}
                        </div>
                      );
                    }
                    if (f.field_type === "number") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <label style={{ minWidth: 160, fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          <input
                            type="number"
                            step="any"
                            value={val?.value_number ?? ""}
                            onChange={(e) => updateField(f.id, "value_number", e.target.value === "" ? undefined : Number(e.target.value))}
                            style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6, maxWidth: 200 }}
                          />
                        </div>
                      );
                    }
                    if (f.field_type === "date") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <label style={{ minWidth: 160, fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          <input
                            type="date"
                            value={val?.value_date ?? ""}
                            onChange={(e) => updateField(f.id, "value_date", e.target.value)}
                            style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6 }}
                          />
                        </div>
                      );
                    }
                    if (f.field_type === "boolean") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <input
                            type="checkbox"
                            checked={val?.value_boolean ?? false}
                            onChange={(e) => updateField(f.id, "value_boolean", e.target.checked)}
                            id={`scalar-${f.id}`}
                          />
                          <label htmlFor={`scalar-${f.id}`} style={{ fontWeight: 500 }}>{f.name}</label>
                        </div>
                      );
                    }
                    return null;
                  })}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Field</th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((f) => f.field_type !== "multi_line_items")
                    .map((f) => (
                      <tr key={f.id}>
                        <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                          {f.name}
                          {f.field_type === "formula" && " (formula)"}
                        </td>
                        <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                          {formatValue(f, valuesByFieldId.get(f.id))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {multiLineFields.map((f) => {
          if (activeTab !== f.id) return null;
          const v = valuesByFieldId.get(f.id);
          const formRows = isEditing ? (formValues[f.id]?.value_json ?? []) : [];
          const rows = isEditing ? formRows : (Array.isArray(v?.value_json) ? (v!.value_json as Record<string, unknown>[]) : []);
          const subFields = f.sub_fields ?? [];
          const setRows = (next: Record<string, unknown>[]) => updateField(f.id, "value_json", next);
          const fieldQuery = `?field_id=${f.id}&organization_id=${effectiveOrgId}`;
          const appendUpload = uploadOption === "append";
          const uploadQuery = entry ? `?entry_id=${entry.id}&field_id=${f.id}&organization_id=${effectiveOrgId}&append=${appendUpload}` : "";
          return (
            <div key={f.id} style={{ overflowX: "auto" }}>
              {subFields.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No sub-fields defined.</p>
              ) : (
                <>
                  <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => setBulkExpandedByFieldId((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
                      style={{
                        padding: "0.35rem 0.5rem",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: "var(--surface)",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                        minWidth: 32,
                      }}
                      title={bulkExpandedByFieldId[f.id] ? "Collapse" : "Expand"}
                    >
                      {bulkExpandedByFieldId[f.id] ? "▲" : "▼"}
                    </button>
                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      Bulk upload
                    </span>
                  </div>
                  {bulkExpandedByFieldId[f.id] && (
                  <div
                    className="card"
                    style={{
                      marginBottom: "1.25rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                      {bulkMethod === "api" && kpiApiInfo?.api_endpoint_url && (
                        <a
                          href={kpiApiInfo.api_endpoint_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "0.9rem",
                            color: "var(--accent)",
                            textDecoration: "none",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={kpiApiInfo.api_endpoint_url}
                        >
                          {kpiApiInfo.api_endpoint_url}
                        </a>
                      )}
                      <select
                        value={isApiKpi ? bulkMethod : "upload"}
                        onChange={(e) => setBulkMethod(e.target.value as "upload" | "api")}
                        disabled={!isApiKpi}
                        style={{
                          padding: "0.5rem 0.75rem",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          fontSize: "0.9rem",
                          minWidth: 180,
                          background: "var(--surface)",
                        }}
                      >
                        <option value="upload">Upload file</option>
                        {isApiKpi && <option value="api">Sync from API</option>}
                      </select>
                    </div>

                    {bulkMethod === "upload" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div style={{ marginBottom: "0.25rem" }}>
                          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Choose an option:</span>
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input
                            type="radio"
                            name="uploadOption"
                            checked={uploadOption === "append"}
                            onChange={() => setUploadOption("append")}
                            disabled={!entry || isLocked}
                          />
                          Append to existing rows
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input
                            type="radio"
                            name="uploadOption"
                            checked={uploadOption === "override"}
                            onChange={() => setUploadOption("override")}
                            disabled={!entry || isLocked}
                          />
                          Override existing data (replace all)
                        </label>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginTop: "0.25rem" }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={async () => {
                              const url = getApiUrl(`/entries/multi-items/template${fieldQuery}`);
                              const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                              if (!res.ok) return;
                              const blob = await res.blob();
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(blob);
                              a.download = `multi_items_${f.key}_${year}.xlsx`;
                              a.click();
                              URL.revokeObjectURL(a.href);
                            }}
                          >
                            Download Excel template
                          </button>
                          <label
                            className="btn btn-primary"
                            style={{
                              cursor: entry && uploadOption != null && uploadingFieldId === null ? "pointer" : "not-allowed",
                              opacity: entry && uploadOption != null ? 1 : 0.6,
                            }}
                          >
                            {uploadingFieldId === f.id ? "Uploading…" : "Upload Excel"}
                            <input
                              type="file"
                              accept=".xlsx"
                              style={{ display: "none" }}
                              disabled={!entry || uploadOption == null || uploadingFieldId !== null || isLocked}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (!file || !entry || uploadOption == null) return;
                                if (uploadOption === "override" && !window.confirm("Are you sure you want to replace all existing data? This cannot be undone.")) return;
                                setUploadingFieldId(f.id);
                                try {
                                  const form = new FormData();
                                  form.append("file", file);
                                  const url = getApiUrl(`/entries/multi-items/upload${uploadQuery}`);
                                  const res = await fetch(url, {
                                    method: "POST",
                                    headers: { Authorization: `Bearer ${token}` },
                                    body: form,
                                  });
                                  if (res.ok) await loadData();
                                  else setSaveError("Excel upload failed");
                                } finally {
                                  setUploadingFieldId(null);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {bulkMethod === "api" && isApiKpi && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div style={{ marginBottom: "0.25rem" }}>
                          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Choose an option:</span>
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input type="radio" name="syncOption" checked={syncOption === "append"} onChange={() => setSyncOption("append")} />
                          Append to existing rows
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input type="radio" name="syncOption" checked={syncOption === "override"} onChange={() => setSyncOption("override")} />
                          Override existing data (replace all)
                        </label>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={syncOption == null || fetchingFromApi || isLocked}
                          style={{ opacity: syncOption != null ? 1 : 0.6, marginTop: "0.25rem" }}
                          onClick={async () => {
                            if (syncOption == null) return;
                            if (syncOption === "override" && !window.confirm("Are you sure you want to replace all existing data? This cannot be undone.")) return;
                            setFetchingFromApi(true);
                            setSaveError(null);
                            setSyncFeedback(null);
                            try {
                              const result = await api<{ fields_updated?: number }>(
                                `/entries/sync-from-api?${qs({ kpi_id: kpiId, year, organization_id: effectiveOrgId!, sync_mode: syncOption })}`,
                                { method: "POST", token }
                              );
                              await loadData();
                              const n = result?.fields_updated ?? 0;
                              setSyncFeedback(n > 0 ? `${n} field(s) updated.` : "Sync completed; no fields updated.");
                              setTimeout(() => setSyncFeedback(null), 5000);
                            } catch (err) {
                              setSaveError(err instanceof Error ? err.message : "Sync from API failed");
                            } finally {
                              setFetchingFromApi(false);
                            }
                          }}
                        >
                          {fetchingFromApi ? "Syncing…" : "Sync from API now"}
                        </button>
                        {syncFeedback && (
                          <p style={{ fontSize: "0.85rem", color: "var(--success)", margin: 0 }}>{syncFeedback}</p>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {isEditing && (
                    <div style={{ marginBottom: "0.75rem" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setRows([...rows, Object.fromEntries(subFields.map((s) => [s.key, undefined]))])}
                      >
                        Add row
                      </button>
                    </div>
                  )}
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr>
                        {subFields.map((s) => (
                          <th key={s.id} style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                            {s.name}
                          </th>
                        ))}
                        {isEditing && <th style={{ width: 80, borderBottom: "1px solid var(--border)" }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={subFields.length + (isEditing ? 1 : 0)} style={{ padding: "0.75rem", color: "var(--muted)" }}>
                            No rows entered.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {subFields.map((s) => (
                              <td key={s.id} style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                                {isEditing ? (
                                  s.field_type === "number" ? (
                                    <input
                                      type="number"
                                      step="any"
                                      value={typeof row[s.key] === "number" ? row[s.key] : ""}
                                      onChange={(e) => {
                                        const next = [...rows];
                                        next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value === "" ? undefined : Number(e.target.value) };
                                        setRows(next);
                                      }}
                                      style={{ width: "100%", maxWidth: 140, padding: "0.35rem" }}
                                    />
                                  ) : s.field_type === "date" ? (
                                    <input
                                      type="date"
                                      value={typeof row[s.key] === "string" ? row[s.key] : ""}
                                      onChange={(e) => {
                                        const next = [...rows];
                                        next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value || undefined };
                                        setRows(next);
                                      }}
                                      style={{ width: "100%", maxWidth: 140, padding: "0.35rem" }}
                                    />
                                  ) : s.field_type === "boolean" ? (
                                    <input
                                      type="checkbox"
                                      checked={Boolean(row[s.key])}
                                      onChange={(e) => {
                                        const next = [...rows];
                                        next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.checked };
                                        setRows(next);
                                      }}
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      value={typeof row[s.key] === "string" ? row[s.key] : String(row[s.key] ?? "")}
                                      onChange={(e) => {
                                        const next = [...rows];
                                        next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value };
                                        setRows(next);
                                      }}
                                      style={{ width: "100%", minWidth: 80, padding: "0.35rem" }}
                                    />
                                  )
                                ) : (
                                  row[s.key] != null ? String(row[s.key]) : "—"
                                )}
                              </td>
                            ))}
                            {isEditing && (
                              <td style={{ borderBottom: "1px solid var(--border)" }}>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => setRows(rows.filter((_, i) => i !== rowIdx))}
                                >
                                  Remove
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
