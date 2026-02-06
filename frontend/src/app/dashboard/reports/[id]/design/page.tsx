"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface AttachedDomain {
  id: number;
  name: string;
}

interface KpiFromDomain {
  kpi_id: number;
  kpi_name: string;
  fields_count: number;
}

interface SubFieldOption {
  id: number;
  key: string;
  name: string;
}

interface FieldOption {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields: SubFieldOption[];
}

interface TemplateDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  year: number;
  body_template: string | null;
  attached_domains: AttachedDomain[];
  kpis_from_domains: KpiFromDomain[];
}

function qs(params: Record<string, string | number | undefined>): string {
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    ) as Record<string, string>
  ).toString();
}

export default function ReportDesignPage() {
  const params = useParams();
  const id = Number(params.id);
  const token = getAccessToken();
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bodyTemplate, setBodyTemplate] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [selectedKpiId, setSelectedKpiId] = useState<number | "">("");
  const [selectedFieldKey, setSelectedFieldKey] = useState("");
  const [selectedSubFieldKey, setSelectedSubFieldKey] = useState("");
  const [fieldsForKpi, setFieldsForKpi] = useState<FieldOption[]>([]);
  const templateTextareaRef = useRef<HTMLTextAreaElement>(null);

  const loadDetail = () => {
    if (!id || !token) return;
    setError(null);
    api<TemplateDetail>(`/reports/templates/${id}/detail`, { token })
      .then((d) => {
        setDetail(d);
        setBodyTemplate(d.body_template || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDetail();
  }, [id, token]);

  useEffect(() => {
    if (!token || !detail || selectedKpiId === "") {
      setFieldsForKpi([]);
      setSelectedFieldKey("");
      setSelectedSubFieldKey("");
      return;
    }
    api<FieldOption[]>(
      `/fields?${qs({ kpi_id: selectedKpiId, organization_id: detail.organization_id })}`,
      { token }
    )
      .then(setFieldsForKpi)
      .catch(() => setFieldsForKpi([]));
    setSelectedFieldKey("");
    setSelectedSubFieldKey("");
  }, [token, detail?.organization_id, selectedKpiId]);

  const selectedField = fieldsForKpi.find((f) => f.key === selectedFieldKey);
  const subFields = selectedField?.field_type === "multi_line_items" ? selectedField?.sub_fields || [] : [];

  const insertPlaceholder = () => {
    if (selectedKpiId === "" || selectedFieldKey === "") return;
    const subArg = selectedSubFieldKey ? `, '${selectedSubFieldKey.replace(/'/g, "\\'")}'` : "";
    const placeholder = `{{ get_kpi_field_value(kpis, ${selectedKpiId}, '${selectedFieldKey.replace(/'/g, "\\'")}'${subArg}) }}`;
    const textarea = templateTextareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = bodyTemplate.slice(0, start);
      const after = bodyTemplate.slice(end);
      setBodyTemplate(before + placeholder + after);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else {
      setBodyTemplate((prev) => prev + placeholder);
    }
  };

  const onSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !detail) return;
    setSavingTemplate(true);
    setTemplateError(null);
    try {
      await api(`/reports/templates/${id}?${qs({ organization_id: detail.organization_id })}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          body_template: bodyTemplate,
        }),
      });
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSavingTemplate(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!detail) return null;

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <Link href={`/dashboard/reports/${id}`} style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {"\u2190"} Back to report
        </Link>
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Design report: {detail.name}</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>Year {detail.year}. Use the template source and KPIs below to build the report.</p>

      {detail.attached_domains.length === 0 && (
        <div className="card" style={{ marginBottom: "1.5rem", borderLeft: "4px solid var(--warn, #c90)", background: "var(--bg-muted, #f5f5f5)" }}>
          <p style={{ margin: 0, fontWeight: 500 }}>No domains attached.</p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
            Attach this template to one or more domains (Organization → Reports tab) to include all KPIs and fields from those domains in the report.
          </p>
        </div>
      )}

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Template source (advanced)</h2>

        <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--bg-muted, #f8f9fa)", borderRadius: 6, border: "1px solid var(--border)" }}>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", fontWeight: 500 }}>Insert KPI field placeholder</p>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
            Select a KPI, field, and optionally sub-field (for multi-line items), then click Add KPI to insert a placeholder that will show the value when the report is printed.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
            <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
              <label style={{ fontSize: "0.85rem" }}>KPI</label>
              <select
                value={selectedKpiId}
                onChange={(e) => setSelectedKpiId(e.target.value ? Number(e.target.value) : "")}
                style={{ minWidth: "100%" }}
              >
                <option value="">— Select KPI —</option>
                {detail.kpis_from_domains.map((k) => (
                  <option key={k.kpi_id} value={k.kpi_id}>{k.kpi_name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0, minWidth: 160 }}>
              <label style={{ fontSize: "0.85rem" }}>Field</label>
              <select
                value={selectedFieldKey}
                onChange={(e) => { setSelectedFieldKey(e.target.value); setSelectedSubFieldKey(""); }}
                style={{ minWidth: "100%" }}
                disabled={!selectedKpiId}
              >
                <option value="">— Select field —</option>
                {fieldsForKpi.map((f) => (
                  <option key={f.id} value={f.key}>{f.name} ({f.key})</option>
                ))}
              </select>
            </div>
            {subFields.length > 0 && (
              <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
                <label style={{ fontSize: "0.85rem" }}>Sub-field</label>
                <select
                  value={selectedSubFieldKey}
                  onChange={(e) => setSelectedSubFieldKey(e.target.value)}
                  style={{ minWidth: "100%" }}
                >
                  <option value="">— None —</option>
                  {subFields.map((s) => (
                    <option key={s.id} value={s.key}>{s.name} ({s.key})</option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={insertPlaceholder}
              disabled={selectedKpiId === "" || selectedFieldKey === ""}
            >
              Add KPI
            </button>
          </div>
        </div>

        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          Use a simple Jinja-like syntax to layout the report. You can access <code>template_name</code>, <code>year</code>,{" "}
          <code>kpis</code>, and <code>domains</code>. Each <code>domain</code> has <code>name</code> and <code>categories</code>; each category has <code>name</code> and <code>kpis</code> (same structure as top-level kpis). Each field has <code>field_name</code>, <code>field_key</code>, <code>value</code>, <code>field_type</code>, and <code>show_on_card</code>. Use the box above to insert{" "}
          <code>get_kpi_field_value(kpis, kpi_id, field_key)</code> placeholders.
        </p>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          Example (use {"{% if kpis %}"} so a message shows when no KPIs are added):
          <br />
          <code>{"<h1>{{ template_name }}</h1>"}</code>
          <br />
          <code>{"<p>Year: {{ year }}</p>"}</code>
          <br />
          <code>{"{% if kpis %}"}</code>
          <br />
          <code>{"{% for kpi in kpis %}"}</code>
          <br />
          <code>{"  <h2>{{ kpi.kpi_name }}</h2>"}</code>
          <br />
          <code>{"  {% for entry in kpi.entries %}"}</code>
          <br />
          <code>{"    {% for f in entry.fields %}<p>...</p>{% endfor %}"}</code>
          <br />
          <code>{"  {% endfor %}"}</code>
          <br />
          <code>{"{% endfor %}"}</code>
          <br />
          <code>{"{% else %}"}</code>
          <br />
          <code>{"<p>No KPIs in this report. Add KPIs below.</p>"}</code>
          <br />
          <code>{"{% endif %}"}</code>
        </p>
        <form onSubmit={onSaveTemplate}>
          <div className="form-group">
            <label>Template body</label>
            <textarea
              ref={templateTextareaRef}
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              rows={10}
              placeholder="Write HTML + placeholders here..."
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingTemplate}>
            {savingTemplate ? "Saving…" : "Save template"}
          </button>
          {templateError && <p className="form-error" style={{ marginTop: "0.5rem" }}>{templateError}</p>}
        </form>
      </section>

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Included from domains</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
          The report automatically includes <strong>all KPIs and all their fields</strong> from the domains this template is attached to. Attach or detach domains in the Organization → Reports tab.
        </p>
        {detail.attached_domains.length > 0 && (
          <p style={{ marginBottom: "0.5rem", fontSize: "0.9rem" }}>
            <strong>Attached domains:</strong> {detail.attached_domains.map((d) => d.name).join(", ")}
          </p>
        )}
        {detail.kpis_from_domains.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <strong style={{ fontSize: "0.9rem" }}>KPIs included ({detail.kpis_from_domains.length}):</strong>
            <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
              {detail.kpis_from_domains.map((k) => (
                <li key={k.kpi_id} style={{ padding: "0.25rem 0", borderBottom: "1px solid var(--border)" }}>
                  {k.kpi_name} <span style={{ color: "var(--muted)" }}>({k.fields_count} fields)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Link className="btn btn-primary" href={`/dashboard/reports/${id}`}>
          View / Print report
        </Link>
      </div>
    </div>
  );
}
