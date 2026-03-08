"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import {
  buildReportPrintDocument,
  openReportPrintWindow,
  type ReportData,
} from "@/app/dashboard/reports/reportPrint";
import { ReportLoadProgress } from "@/app/dashboard/reports/ReportLoadProgress";

export default function ReportViewPage() {
  const params = useParams();
  const id = Number(params.id);
  const token = getAccessToken();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [popupBlockedMsg, setPopupBlockedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<{ role: string }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    const url = `/reports/templates/${id}/generate?format=json&year=${reportYear}&_t=${Date.now()}`;
    api<ReportData>(url, { token, cache: "no-store" })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => setLoading(false));
  }, [id, reportYear, token]);

  const handlePrint = () => {
    if (!data || !token) return;
    setPopupBlockedMsg(null);
    setPrintLoading(true);
    const url = `/reports/templates/${id}/generate?format=json&year=${reportYear}&_t=${Date.now()}`;
    api<ReportData>(url, { token, cache: "no-store" })
      .then((reportData) => {
        const doc = buildReportPrintDocument(reportData);
        const opened = openReportPrintWindow(doc, true);
        if (!opened) setPopupBlockedMsg("Pop-up was blocked. Allow pop-ups for this site to open print/PDF in a new tab.");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => setPrintLoading(false));
  };

  const previewDoc =
    data?.rendered_html != null
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:inherit;margin:1rem;color:#111;line-height:1.5;}</style></head><body>${data.rendered_html}</body></html>`
      : data
        ? buildReportPrintDocument(data)
        : null;

  return (
    <div style={{ padding: "0 1rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Report</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Year</label>
          <select
            value={reportYear}
            onChange={(e) => setReportYear(Number(e.target.value))}
            style={{ padding: "0.35rem 0.5rem" }}
          >
            {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        {userRole === "SUPER_ADMIN" && (
          <Link className="btn" href={`/dashboard/reports/${id}/design`} style={{ fontSize: "0.9rem" }}>
            Design report
          </Link>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePrint}
          disabled={loading || printLoading || !data}
        >
          {printLoading ? "Opening…" : "Print / Export PDF"}
        </button>
      </div>

      {popupBlockedMsg && (
        <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>{popupBlockedMsg}</p>
      )}
      {error && <p className="form-error">{error}</p>}
      {loading && (
        <ReportLoadProgress label="Loading report…" />
      )}
      {printLoading && !loading && (
        <ReportLoadProgress label="Preparing report for view/print…" />
      )}
      {!loading && data && previewDoc && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <iframe
            title="Report preview"
            srcDoc={previewDoc}
            style={{
              width: "100%",
              minHeight: 480,
              height: 600,
              border: "none",
              display: "block",
            }}
          />
        </div>
      )}
      {!loading && data && !previewDoc && (
        <p style={{ color: "var(--muted)" }}>No content to display.</p>
      )}
    </div>
  );
}
