"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface FieldDef {
  id: number;
  key: string;
  name: string;
  field_type: string;
  is_required: boolean;
  formula_expression?: string | null;
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
  user_id: number;
  year: number;
  is_draft: boolean;
  is_locked: boolean;
  submitted_at: string | null;
  values: FieldValueResp[];
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return new URLSearchParams(entries as Record<string, string>).toString();
}

export default function EntryDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const kpiId = Number(params.kpiId);
  const year = Number(params.year);
  const orgIdParam = searchParams.get("organization_id");
  const organizationId = orgIdParam ? Number(orgIdParam) : undefined;
  const fromDomainId = searchParams.get("from_domain");
  const domainId = fromDomainId ? Number(fromDomainId) : undefined;

  const [kpiName, setKpiName] = useState<string>("");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [existingEntry, setExistingEntry] = useState<EntryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = getAccessToken();

  const entriesQuery = organizationId != null ? `?${qs({ kpi_id: kpiId, year, organization_id: organizationId })}` : `?kpi_id=${kpiId}&year=${year}`;
  const fieldsQuery = organizationId != null ? `?${qs({ kpi_id: kpiId, organization_id: organizationId })}` : `?kpi_id=${kpiId}`;
  const availableKpisQuery = organizationId != null ? `?${qs({ organization_id: organizationId })}` : "";

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
    ])
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [token, kpiId, year, entriesQuery, fieldsQuery, availableKpisQuery]);

  if (!kpiId || !year) return <p>Invalid KPI or year.</p>;
  if (loading) return <p>Loading...</p>;

  const backDomainHref =
    domainId != null
      ? organizationId != null
        ? `/dashboard/domains/${domainId}?organization_id=${organizationId}`
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
            organizationId={organizationId}
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
}: {
  kpiId: number;
  year: number;
  kpiName: string;
  fields: FieldDef[];
  existingEntry: EntryRow | null;
  setExistingEntry: (e: EntryRow | null) => void;
  token: string;
  organizationId?: number;
}) {
  const [formValues, setFormValues] = useState<Record<number, { value_text?: string; value_number?: number; value_boolean?: boolean; value_date?: string }>>(() => {
    const o: Record<number, { value_text?: string; value_number?: number; value_boolean?: boolean; value_date?: string }> = {};
    fields.forEach((f) => {
      if (f.field_type === "formula") return;
      const v = existingEntry?.values?.find((x) => x.field_id === f.id);
      if (v) {
        o[f.id] = {};
        if (v.value_text != null) o[f.id].value_text = v.value_text;
        if (v.value_number != null) o[f.id].value_number = v.value_number;
        if (v.value_boolean != null) o[f.id].value_boolean = v.value_boolean;
        if (v.value_date) o[f.id].value_date = v.value_date;
      } else {
        o[f.id] = {};
      }
    });
    return o;
  });
  const [saving, setSaving] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateField = (fieldId: number, key: string, value: string | number | boolean | undefined) => {
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
          return {
            field_id: f.id,
            value_text: v.value_text ?? null,
            value_number: typeof v.value_number === "number" ? v.value_number : null,
            value_boolean: v.value_boolean ?? null,
            value_date: v.value_date || null,
          };
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

  return (
    <form onSubmit={handleSaveDraft}>
      {saveError && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{saveError}</p>}
      {saved && <p style={{ color: "var(--success)", marginBottom: "0.75rem", fontSize: "0.9rem" }}>Draft saved.</p>}

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
          return (
            <div key={f.id} className="form-group">
              <label>{f.name}{f.is_required ? " *" : ""}</label>
              <textarea
                rows={4}
                value={val?.value_text ?? ""}
                onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                placeholder="One item per line or JSON"
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
