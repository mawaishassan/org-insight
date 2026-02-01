"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface ReportData {
  template_name: string;
  template_id: number;
  year: number;
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
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn" onClick={handleExportCsv}>
            Export CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            Print
          </button>
        </div>
      </div>
      <div className="card print-report">
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>Year: {data.year}</p>
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
      </div>
    </div>
  );
}
