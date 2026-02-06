"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface ReportData {
  template_name: string;
  template_id: number;
  year: number;
  rendered_html?: string | null;
  text_blocks?: Array<{ id: number; title: string | null; content: string; sort_order: number }>;
  kpis: Array<{
    kpi_id: number;
    kpi_name: string;
    entries: Array<{
      entry_id: number;
      fields: Array<{ field_key: string; field_name: string; value: unknown }>;
    }>;
  }>;
}

export default function ReportViewPage() {
  const params = useParams();
  const id = Number(params.id);
  const reportContentRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    if (!id) return;
    const token = getAccessToken();
    if (!token) return;
    api<ReportData>(`/reports/templates/${id}/generate?format=json`, { token })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return null;

  const handlePrint = () => window.print();

  async function handleExportPdf() {
    const el = reportContentRef.current;
    if (!el || !data) return;
    setExportingPdf(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          filename: `report_${data.template_name.replace(/[^a-z0-9-_]/gi, "_")}_${data.year}.pdf`,
          margin: [10, 10, 10, 10],
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(el)
        .save();
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportCsv() {
    const token = getAccessToken();
    if (!token) return;
    const base = typeof window !== "undefined" && window.location.origin ? "" : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const url = base ? `${base}/api/reports/templates/${id}/generate?format=csv` : `/api/reports/templates/${id}/generate?format=csv`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report_${id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>{data.template_name}</h1>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={handleExportCsv}>
            Export CSV
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleExportPdf}
            disabled={exportingPdf}
          >
            {exportingPdf ? "Exporting…" : "Export PDF"}
          </button>
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            Print
          </button>
        </div>
      </div>
      <div ref={reportContentRef} className="card print-report">
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>Year: {data.year}</p>
        {data.rendered_html ? (
          <div dangerouslySetInnerHTML={{ __html: data.rendered_html }} />
        ) : (
          <>
            {Array.isArray(data.text_blocks) && data.text_blocks.length > 0 && (
              <section style={{ marginBottom: "1.25rem" }}>
                {data.text_blocks.map((b) => (
                  <div key={b.id} style={{ marginBottom: "0.75rem" }}>
                    {b.title && <h2 style={{ fontSize: "1.05rem", marginBottom: "0.25rem" }}>{b.title}</h2>}
                    <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{b.content}</p>
                  </div>
                ))}
              </section>
            )}
            {data.kpis.map((k) => (
              <section key={k.kpi_id} style={{ marginBottom: "1.5rem" }}>
                <h2 style={{ fontSize: "1.15rem", marginBottom: "0.5rem" }}>{k.kpi_name}</h2>
                {k.entries.map((ent) => (
                  <div key={ent.entry_id} style={{ marginLeft: "1rem", marginBottom: "0.75rem" }}>
                    {ent.fields.map((f) => (
                      <div key={f.field_key} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.25rem" }}>
                        <strong style={{ minWidth: 140 }}>{f.field_name}:</strong>
                        <span>{String(f.value ?? "—")}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
