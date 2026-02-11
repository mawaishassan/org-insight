"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

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

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

export default function EntryDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const kpiId = Number(params.kpiId);
  const year = Number(params.year);
  const orgIdParam = searchParams.get("organization_id");
  const organizationIdFromUrl = orgIdParam ? Number(orgIdParam) : undefined;
  const fromDomainId = searchParams.get("from_domain");
  const domainId = fromDomainId ? Number(fromDomainId) : undefined;

  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const [kpiName, setKpiName] = useState<string>("");
  const [kpiEntryMode, setKpiEntryMode] = useState<string | null>(null);
  const [kpiApiEndpointUrl, setKpiApiEndpointUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [existingEntry, setExistingEntry] = useState<EntryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = getAccessToken();
  const effectiveOrgId = organizationIdFromUrl ?? meOrgId ?? existingEntry?.organization_id ?? undefined;

  const entriesQuery = effectiveOrgId != null ? `?${qs({ kpi_id: kpiId, year, organization_id: effectiveOrgId })}` : `?kpi_id=${kpiId}&year=${year}`;
  const fieldsQuery = effectiveOrgId != null ? `?${qs({ kpi_id: kpiId, organization_id: effectiveOrgId })}` : `?kpi_id=${kpiId}`;
  const availableKpisQuery = effectiveOrgId != null ? `?${qs({ organization_id: effectiveOrgId })}` : "";
  const loadEntry = async (opts?: { cacheBust?: boolean }) => {
    if (!token) return;
    try {
      let q = effectiveOrgId != null ? `?${qs({ kpi_id: kpiId, year, organization_id: effectiveOrgId })}` : `?kpi_id=${kpiId}&year=${year}`;
      if (opts?.cacheBust) q += (q ? "&" : "?") + "_=" + Date.now();
      const entries = await api<EntryRow[]>(`/entries${q}`, { token });
      setExistingEntry(entries[0] ?? null);
    } catch {
      setExistingEntry(null);
    }
  };

  useEffect(() => {
    if (!token) return;
    api<{ organization_id: number | null }>("/auth/me", { token })
      .then((me) => setMeOrgId(me.organization_id ?? null))
      .catch(() => setMeOrgId(null));
  }, [token]);

  useEffect(() => {
    if (!token || !kpiId || !year) return;
    setError(null);
    Promise.all([
      api<{ id: number; name: string; year: number }[]>(`/entries/available-kpis${availableKpisQuery}`, { token }).then((kpis) => {
        const k = kpis.find((x) => x.id === kpiId);
        if (k) setKpiName(k.name);
      }),
      api<FieldDef[]>(`/entries/fields${fieldsQuery}`, { token }).then(setFields).catch(() => setFields([])),
      api<EntryRow[]>(`/entries${entriesQuery}`, { token })
        .then((entries) => setExistingEntry(entries[0] ?? null))
        .catch(() => setExistingEntry(null)),
      effectiveOrgId != null
        ? api<{ entry_mode?: string; api_endpoint_url?: string | null }>(`/entries/kpi-api-info?${qs({ kpi_id: kpiId, organization_id: effectiveOrgId })}`, { token })
            .then((info) => {
              setKpiEntryMode(info.entry_mode ?? null);
              setKpiApiEndpointUrl(info.api_endpoint_url ?? null);
            })
            .catch(() => {
              setKpiEntryMode(null);
              setKpiApiEndpointUrl(null);
            })
        : Promise.resolve(),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [token, kpiId, year, entriesQuery, fieldsQuery, availableKpisQuery, effectiveOrgId]);

  if (!kpiId || !year) return <p>Invalid KPI or year.</p>;
  if (loading) return <p>Loading...</p>;

  const backDomainHref =
    domainId != null
      ? effectiveOrgId != null
        ? `/dashboard/domains/${domainId}?organization_id=${effectiveOrgId}`
        : `/dashboard/domains/${domainId}`
      : null;

  const content = (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        {backDomainHref != null && (
          <Link href={backDomainHref} style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{"\u2190"} Back to Domain</Link>
        )}
        <Link href="/dashboard/entries" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {backDomainHref != null ? "Data entry" : "\u2190 Back to Data entry"}
        </Link>
      </div>
      <h1 style={{ marginBottom: "0.5rem", fontSize: "1.5rem" }}>{kpiName || `KPI #${kpiId}`}</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>Year {year}</p>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {fields.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No fields defined for this KPI. Ask admin to add fields, or you may not have access.</p>
        </div>
      ) : (
        <div className="card">
          <EntryForm
            kpiId={kpiId}
            year={year}
            kpiName={kpiName}
            fields={fields}
            existingEntry={existingEntry}
            setExistingEntry={setExistingEntry}
            token={token!}
            organizationId={effectiveOrgId}
            loadEntry={loadEntry}
            entryMode={kpiEntryMode}
            apiEndpointUrl={kpiApiEndpointUrl}
          />
        </div>
      )}
    </div>
  );
  return content;
}

function EntryForm({
  kpiId,
  year,
  kpiName,
  fields,
  existingEntry,
  setExistingEntry,
  token,
  organizationId,
  loadEntry,
  entryMode,
  apiEndpointUrl,
}: {
  kpiId: number;
  year: number;
  kpiName: string;
  fields: FieldDef[];
  existingEntry: EntryRow | null;
  setExistingEntry: (e: EntryRow | null) => void;
  token: string;
  organizationId?: number;
  loadEntry?: (opts?: { cacheBust?: boolean }) => Promise<void>;
  entryMode?: string | null;
  apiEndpointUrl?: string | null;
}) {
  const buildInitialValues = () => {
    const o: Record<number, { value_text?: string; value_number?: number; value_boolean?: boolean; value_date?: string; value_json?: Record<string, unknown>[] }> = {};
    fields.forEach((f) => {
      if (f.field_type === "formula") return;
      const v = existingEntry?.values?.find((x) => x.field_id === f.id);
      if (v) {
        o[f.id] = {};
        if (v.value_text != null) o[f.id].value_text = v.value_text;
        if (v.value_number != null) o[f.id].value_number = v.value_number;
        if (v.value_boolean != null) o[f.id].value_boolean = v.value_boolean;
        if (v.value_date) o[f.id].value_date = v.value_date;
        if (f.field_type === "multi_line_items" && Array.isArray(v.value_json)) o[f.id].value_json = v.value_json as Record<string, unknown>[];
      } else {
        o[f.id] = f.field_type === "multi_line_items" ? { value_json: [] } : {};
      }
    });
    return o;
  };

  const [formValues, setFormValues] = useState(buildInitialValues);
  const [saving, setSaving] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [fetchingFromApi, setFetchingFromApi] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploadingFieldId, setUploadingFieldId] = useState<number | null>(null);
  const [appendExcelUpload, setAppendExcelUpload] = useState(true);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [lastSyncFieldsUpdated, setLastSyncFieldsUpdated] = useState<number>(-1);
  const [syncMode, setSyncMode] = useState<"override" | "append">("override");

  useEffect(() => {
    const o: Record<number, { value_text?: string; value_number?: number; value_boolean?: boolean; value_date?: string; value_json?: Record<string, unknown>[] }> = {};
    fields.forEach((f) => {
      if (f.field_type === "formula") return;
      const v = existingEntry?.values?.find((x) => x.field_id === f.id);
      if (v) {
        o[f.id] = {};
        if (v.value_text != null) o[f.id].value_text = v.value_text;
        if (v.value_number != null) o[f.id].value_number = v.value_number;
        if (v.value_boolean != null) o[f.id].value_boolean = v.value_boolean;
        if (v.value_date) o[f.id].value_date = v.value_date;
        if (f.field_type === "multi_line_items" && Array.isArray(v.value_json)) o[f.id].value_json = v.value_json as Record<string, unknown>[];
      } else {
        o[f.id] = f.field_type === "multi_line_items" ? { value_json: [] } : {};
      }
    });
    setFormValues(o);
  }, [existingEntry, fields]);

  const updateField = (fieldId: number, key: string, value: string | number | boolean | undefined | Record<string, unknown>[]) => {
    setFormValues((prev) => ({
      ...prev,
      [fieldId]: { ...prev[fieldId], [key]: value },
    }));
    setSaved(false);
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaving(true);
    try {
      const values = fields
        .filter((f) => f.field_type !== "formula")
        .map((f) => {
          const v = formValues[f.id] || {};
          const payload: { field_id: number; value_text?: string | null; value_number?: number | null; value_boolean?: boolean | null; value_date?: string | null; value_json?: Record<string, unknown>[] | null } = {
            field_id: f.id,
            value_text: v.value_text ?? null,
            value_number: typeof v.value_number === "number" ? v.value_number : null,
            value_boolean: v.value_boolean ?? null,
            value_date: v.value_date || null,
          };
          if (f.field_type === "multi_line_items" && Array.isArray(v.value_json)) {
            payload.value_json = v.value_json;
          }
          return payload;
        });
      const saveQuery = organizationId != null ? `?${qs({ organization_id: organizationId })}` : "";
      const entry = await api<EntryRow>(`/entries${saveQuery}`, {
        method: "POST",
        body: JSON.stringify({ kpi_id: kpiId, year, is_draft: true, values }),
        token,
      });
      setExistingEntry(entry);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!existingEntry?.id) return;
    setSaveError(null);
    setSubmitLoading(true);
    try {
      await api("/entries/submit", { method: "POST", body: JSON.stringify({ entry_id: existingEntry.id }), token });
      setExistingEntry({ ...existingEntry, is_draft: false, submitted_at: new Date().toISOString() });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const isLocked = existingEntry?.is_locked ?? false;

  const isApiKpi = entryMode === "api" && apiEndpointUrl && organizationId != null;
  const hasMultiLineItems = fields.some((x) => x.field_type === "multi_line_items");
  const firstMultiLineFieldId = fields.find((x) => x.field_type === "multi_line_items")?.id;

  const syncRow = isApiKpi && loadEntry && (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>When syncing:</span>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
          <input
            type="radio"
            name="syncMode"
            checked={syncMode === "override"}
            onChange={() => setSyncMode("override")}
          />
          Override existing data
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
          <input
            type="radio"
            name="syncMode"
            checked={syncMode === "append"}
            onChange={() => setSyncMode("append")}
          />
          Append to existing (multi-line rows)
        </label>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={fetchingFromApi || isLocked}
        onClick={async () => {
          setFetchingFromApi(true);
          setSaveError(null);
          setSyncFeedback(null);
          try {
            const result = await api<{ entry_id?: number; fields_updated?: number }>(
              `/entries/sync-from-api?${qs({ kpi_id: kpiId, year, organization_id: organizationId!, sync_mode: syncMode })}`,
              { method: "POST", token }
            );
            await loadEntry({ cacheBust: true });
            const n = result?.fields_updated ?? 0;
            setLastSyncFieldsUpdated(n);
            setSyncFeedback(
              n > 0
                ? `${n} field(s) updated. Data loaded below.`
                : "Sync completed but no fields were updated. Ensure your API returns { year, values: { \"field_key\": value } } with keys matching the KPI field keys."
            );
            setTimeout(() => {
              setSyncFeedback(null);
              setLastSyncFieldsUpdated(-1);
            }, 8000);
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
        <p
          style={{
            fontSize: "0.85rem",
            color: lastSyncFieldsUpdated > 0 ? "var(--success)" : "var(--muted)",
            marginTop: "0.35rem",
          }}
        >
          {syncFeedback}
        </p>
      )}
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.35rem" }}>
        Load entry data from the configured API endpoint. Override or append is chosen above. You can still edit values manually below and save.
      </p>
    </div>
  );

  return (
    <form onSubmit={handleSaveDraft}>
      {saveError && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{saveError}</p>}
      {saved && <p style={{ color: "var(--success)", marginBottom: "0.75rem", fontSize: "0.9rem" }}>Draft saved.</p>}

      {!hasMultiLineItems && syncRow}

      {fields.map((f) => {
        if (f.field_type === "formula") {
          return (
            <div key={f.id} className="form-group">
              <label>{f.name} (formula)</label>
              <input type="text" readOnly disabled placeholder={f.formula_expression || ""} style={{ opacity: 0.8 }} />
            </div>
          );
        }
        const val = formValues[f.id];
        if (f.field_type === "single_line_text") {
          return (
            <div key={f.id} className="form-group">
              <label>{f.name}{f.is_required ? " *" : ""}</label>
              <input
                type="text"
                value={val?.value_text ?? ""}
                onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                disabled={isLocked}
              />
            </div>
          );
        }
        if (f.field_type === "multi_line_text") {
          return (
            <div key={f.id} className="form-group">
              <label>{f.name}{f.is_required ? " *" : ""}</label>
              <textarea
                rows={3}
                value={val?.value_text ?? ""}
                onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                disabled={isLocked}
              />
            </div>
          );
        }
        if (f.field_type === "number") {
          return (
            <div key={f.id} className="form-group">
              <label>{f.name}{f.is_required ? " *" : ""}</label>
              <input
                type="number"
                step="any"
                value={val?.value_number ?? ""}
                onChange={(e) => updateField(f.id, "value_number", e.target.value === "" ? undefined : Number(e.target.value))}
                disabled={isLocked}
              />
            </div>
          );
        }
        if (f.field_type === "date") {
          return (
            <div key={f.id} className="form-group">
              <label>{f.name}{f.is_required ? " *" : ""}</label>
              <input
                type="date"
                value={val?.value_date ?? ""}
                onChange={(e) => updateField(f.id, "value_date", e.target.value)}
                disabled={isLocked}
              />
            </div>
          );
        }
        if (f.field_type === "boolean") {
          return (
            <div key={f.id} className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={val?.value_boolean ?? false}
                  onChange={(e) => updateField(f.id, "value_boolean", e.target.checked)}
                  disabled={isLocked}
                />
                {f.name}
              </label>
            </div>
          );
        }
        if (f.field_type === "multi_line_items") {
          const subFields = f.sub_fields ?? [];
          const rows = Array.isArray(val?.value_json) ? val.value_json : [];
          if (subFields.length > 0) {
            return (
              <div key={f.id} className="form-group">
                <label>{f.name}{f.is_required ? " *" : ""}</label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const q = organizationId != null ? `?field_id=${f.id}&organization_id=${organizationId}` : `?field_id=${f.id}`;
                      const base =
                        typeof window !== "undefined" && window.location.origin
                          ? ""
                          : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                      const url = base
                        ? `${base}/api/entries/multi-items/template${q}`
                        : `/api/entries/multi-items/template${q}`;
                      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                      if (!res.ok) return;
                      const blob = await res.blob();
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `multi_items_${f.key}_${year}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    disabled={uploadingFieldId === f.id}
                  >
                    Download Excel template
                  </button>
                  <label className="btn" style={{ gap: "0.5rem", ...(existingEntry ? {} : { opacity: 0.7, cursor: "not-allowed" }) }}>
                    {uploadingFieldId === f.id ? "Uploading…" : "Upload Excel"}
                    <input
                      type="file"
                      accept=".xlsx"
                      style={{ display: "none" }}
                      disabled={isLocked || uploadingFieldId === f.id || !existingEntry}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file || !existingEntry) return;
                        setUploadingFieldId(f.id);
                        try {
                          const form = new FormData();
                          form.append("file", file);
                          const q =
                            organizationId != null
                              ? `?entry_id=${existingEntry.id}&field_id=${f.id}&organization_id=${organizationId}`
                              : `?entry_id=${existingEntry.id}&field_id=${f.id}`;
                          const q2 = `${q}&append=${appendExcelUpload ? "true" : "false"}`;
                          const base =
                            typeof window !== "undefined" && window.location.origin
                              ? ""
                              : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                          const url = base
                            ? `${base}/api/entries/multi-items/upload${q2}`
                            : `/api/entries/multi-items/upload${q2}`;
                          const res = await fetch(url, {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}` },
                            body: form,
                          });
                          if (!res.ok) {
                            setSaveError("Excel upload failed");
                            return;
                          }
                          const json = await res.json();
                          if (Array.isArray(json.items)) {
                            updateField(f.id, "value_json", json.items);
                            setSaved(false);
                          }
                        } finally {
                          setUploadingFieldId(null);
                        }
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", color: "var(--muted)" }}>
                    <input
                      type="checkbox"
                      checked={appendExcelUpload}
                      onChange={(e) => setAppendExcelUpload(e.target.checked)}
                      disabled={isLocked || uploadingFieldId === f.id || !existingEntry}
                    />
                    Append
                  </label>
                  <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                    {existingEntry
                      ? "If unchecked, upload replaces all rows for this field."
                      : "Save draft first to upload Excel."}
                  </span>
                </div>
                {f.id === firstMultiLineFieldId && syncRow}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr>
                        {subFields.map((s) => (
                          <th key={s.id} style={{ textAlign: "left", padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" }}>{s.name}{s.is_required ? " *" : ""}</th>
                        ))}
                        <th style={{ width: "80px", borderBottom: "1px solid var(--border)" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          {subFields.map((s) => {
                            const cellVal = row[s.key];
                            return (
                              <td key={s.id} style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" }}>
                                {s.field_type === "number" ? (
                                  <input
                                    type="number"
                                    step="any"
                                    value={typeof cellVal === "number" ? cellVal : ""}
                                    onChange={(e) => {
                                      const next = [...rows];
                                      next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value === "" ? undefined : Number(e.target.value) };
                                      updateField(f.id, "value_json", next);
                                    }}
                                    disabled={isLocked}
                                    style={{ width: "100%", maxWidth: "140px" }}
                                  />
                                ) : s.field_type === "date" ? (
                                  <input
                                    type="date"
                                    value={typeof cellVal === "string" ? cellVal : ""}
                                    onChange={(e) => {
                                      const next = [...rows];
                                      next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value || undefined };
                                      updateField(f.id, "value_json", next);
                                    }}
                                    disabled={isLocked}
                                    style={{ width: "100%", maxWidth: "140px" }}
                                  />
                                ) : s.field_type === "boolean" ? (
                                  <input
                                    type="checkbox"
                                    checked={Boolean(cellVal)}
                                    onChange={(e) => {
                                      const next = [...rows];
                                      next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.checked };
                                      updateField(f.id, "value_json", next);
                                    }}
                                    disabled={isLocked}
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    value={typeof cellVal === "string" ? cellVal : String(cellVal ?? "")}
                                    onChange={(e) => {
                                      const next = [...rows];
                                      next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value };
                                      updateField(f.id, "value_json", next);
                                    }}
                                    disabled={isLocked}
                                    style={{ width: "100%", minWidth: "80px" }}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td style={{ borderBottom: "1px solid var(--border)" }}>
                            <button type="button" className="btn" onClick={() => { const next = rows.filter((_, i) => i !== rowIdx); updateField(f.id, "value_json", next); }} disabled={isLocked}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn" style={{ marginTop: "0.5rem" }} onClick={() => { const newRow: Record<string, unknown> = {}; subFields.forEach((s) => { newRow[s.key] = s.field_type === "boolean" ? false : s.field_type === "number" ? undefined : ""; }); updateField(f.id, "value_json", [...rows, newRow]); }} disabled={isLocked}>
                  Add row
                </button>
              </div>
            );
          }
          return (
            <div key={f.id} className="form-group">
              <label>{f.name}{f.is_required ? " *" : ""}</label>
              <textarea
                rows={4}
                value={typeof val?.value_text === "string" ? val.value_text : (Array.isArray(val?.value_json) ? JSON.stringify(val.value_json, null, 2) : "")}
                onChange={(e) => {
                  const t = e.target.value;
                  try {
                    const parsed = JSON.parse(t);
                    if (Array.isArray(parsed)) updateField(f.id, "value_json", parsed); else updateField(f.id, "value_text", t);
                  } catch {
                    updateField(f.id, "value_text", t);
                  }
                }}
                placeholder="JSON array of objects, or paste text"
                disabled={isLocked}
              />
            </div>
          );
        }
        return (
          <div key={f.id} className="form-group">
            <label>{f.name}</label>
            <input
              type="text"
              value={val?.value_text ?? ""}
              onChange={(e) => updateField(f.id, "value_text", e.target.value)}
              disabled={isLocked}
            />
          </div>
        );
      })}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.5rem", alignItems: "center" }}>
        {!isLocked && (
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving..." : "Save draft"}
          </button>
        )}
        {existingEntry?.id && existingEntry.is_draft && !isLocked && (
          <button type="button" className="btn" onClick={handleSubmit} disabled={submitLoading}>
            {submitLoading ? "Submitting..." : "Submit entry"}
          </button>
        )}
        {existingEntry?.is_draft === false && (
          <span style={{ color: "var(--success)", fontSize: "0.9rem" }}>Submitted</span>
        )}
        {isLocked && <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Entry is locked</span>}
      </div>
    </form>
  );
}
