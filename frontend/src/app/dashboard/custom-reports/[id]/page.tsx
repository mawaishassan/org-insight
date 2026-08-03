"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import {
  buildReportPrintDocument,
  openReportPrintWindow,
  type ReportData,
} from "@/app/dashboard/reports/reportPrint";
import { ReportLoadProgress } from "@/app/dashboard/reports/ReportLoadProgress";

export default function CustomReportViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgId = Number(searchParams.get("organization_id"));
  const token = getAccessToken();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [popupBlockedMsg, setPopupBlockedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    api<{ role: string }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token, router]);

  useEffect(() => {
    if (!id || !token || !orgId) return;
    setLoading(true);
    setError(null);
    const url = `/custom-reports/${id}/generate?year=${reportYear}&organization_id=${orgId}&_t=${Date.now()}`;
    api<any>(url, { token, cache: "no-store" })
      .then((res) => {
        // Map the payload to match the expected ReportData shape
        setData({
          template_id: res.template_id,
          template_name: res.template_name,
          year: res.year,
          rendered_html: res.rendered_html,
          kpis: [], // Feed empty kpis array since we use rendered_html anyway
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load custom report"))
      .finally(() => setLoading(false));
  }, [id, reportYear, token, orgId]);

  const handlePrint = () => {
    if (!data || !token) return;
    setPopupBlockedMsg(null);
    setPrintLoading(true);
    const useCached = data.year === reportYear;
    
    const run = (reportData: ReportData) => {
      const doc = buildReportPrintDocument(reportData);
      const opened = openReportPrintWindow(doc, true);
      if (!opened) {
        setPopupBlockedMsg("Pop-up was blocked. Allow pop-ups for this site to open print/PDF in a new tab.");
      }
    };

    if (useCached) {
      try {
        run(data);
      } finally {
        setPrintLoading(false);
      }
      return;
    }

    const url = `/custom-reports/${id}/generate?year=${reportYear}&organization_id=${orgId}&_t=${Date.now()}`;
    api<any>(url, { token, cache: "no-store" })
      .then((res) => {
        run({
          template_id: res.template_id,
          template_name: res.template_name,
          year: res.year,
          rendered_html: res.rendered_html,
          kpis: [],
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load report"))
      .finally(() => setPrintLoading(false));
  };

  const previewDoc =
    data?.rendered_html != null
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:inherit;margin:1rem;color:#111;line-height:1.5;}</style></head><body>${data.rendered_html}</body></html>`
      : null;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 1rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0, flex: "1 1 auto" }}>
          {data?.template_name || "Custom Report"}
        </h1>
        
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.9rem", color: "var(--muted)", fontWeight: 500 }}>Select Year:</label>
          <select
            value={reportYear}
            onChange={(e) => setReportYear(Number(e.target.value))}
            style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem" }}
          >
            {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {userRole === "SUPER_ADMIN" && (
          <Link
            className="btn"
            href={`/dashboard/custom-reports/${id}/design?organization_id=${orgId}`}
            style={{ fontSize: "0.9rem", padding: "0.4rem 0.8rem" }}
          >
            Edit Layout
          </Link>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePrint}
          disabled={loading || printLoading || !data}
          style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
        >
          {printLoading ? "Opening…" : "Print / Export PDF"}
        </button>

        <button
          type="button"
          className="btn"
          onClick={() => {
            if (userRole === "SUPER_ADMIN") {
              router.push(`/dashboard/custom-reports?organization_id=${orgId}`);
            } else {
              router.push("/dashboard/reports");
            }
          }}
          style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem" }}
        >
          Back
        </button>
      </div>

      {popupBlockedMsg && (
        <p style={{ fontSize: "0.9rem", color: "var(--error)", marginBottom: "1rem" }}>{popupBlockedMsg}</p>
      )}
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
      
      {loading && (
        <ReportLoadProgress label="Loading report..." />
      )}
      {printLoading && !loading && (
        <ReportLoadProgress label="Preparing report for view/print..." />
      )}
      
      {!loading && data && previewDoc && (
        <div className="card" style={{ padding: 0, overflow: "hidden", background: "white", border: "1px solid var(--border)", borderRadius: 8 }}>
          <iframe
            title="Custom report preview"
            srcDoc={previewDoc}
            style={{
              width: "100%",
              minHeight: 520,
              height: 700,
              border: "none",
              display: "block",
            }}
          />
        </div>
      )}
      {!loading && data && !previewDoc && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem" }}>No content to display.</p>
      )}
    </div>
  );
}
