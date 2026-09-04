"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { generatePeriodOptions } from "@/lib/periodHelpers";
import {
  buildReportPrintDocument,
  openReportPrintWindow,
  type ReportData,
} from "@/app/dashboard/reports/reportPrint";
import { ReportLoadProgress } from "@/app/dashboard/reports/ReportLoadProgress";

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);
  const token = getAccessToken();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [template, setTemplate] = useState<any | null>(null);
  const [org, setOrg] = useState<any | null>(null);
  const [selectedPeriodType, setSelectedPeriodType] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
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

  // Load template details and organization custom periods
  useEffect(() => {
    if (!id || !token) return;
    api<any>(`/reports/templates/${id}`, { token })
      .then((t) => {
        setTemplate(t);
        if (t.organization_id) {
          api<any>(`/organizations/${t.organization_id}`, { token })
            .then((orgData) => {
              setOrg(orgData);
            })
            .catch((e) => console.error("Failed to load org details", e));
        }
      })
      .catch((e) => console.error("Failed to load template", e));
  }, [id, token]);

  const customPeriods = useMemo(() => {
    if (!org) return [];
    if (org.custom_periods && org.custom_periods.length > 0) {
      return org.custom_periods;
    }
    if (org.custom_period_name) {
      return [{
        custom_period_name: org.custom_period_name,
        custom_period_start_month: org.custom_period_start_month,
        custom_period_start_day: org.custom_period_start_day,
        custom_period_duration_months: org.custom_period_duration_months,
        custom_period_display_format: org.custom_period_display_format,
        custom_period_prefix: org.custom_period_prefix,
        custom_period_suffix: org.custom_period_suffix,
      }];
    }
    return [];
  }, [org]);

  const requestGenRef = useRef(0);

  useEffect(() => {
    if (!selectedPeriodType) {
      setSelectedPeriodType("by_default");
    } else if (selectedPeriodType !== "by_default" && customPeriods.length > 0 && !customPeriods.some((p: any) => p.custom_period_name === selectedPeriodType)) {
      setSelectedPeriodType("by_default");
    }
  }, [customPeriods, selectedPeriodType]);

  const activePeriodConfig = useMemo(() => {
    return customPeriods.find((p: any) => p.custom_period_name === selectedPeriodType) || null;
  }, [customPeriods, selectedPeriodType]);

  const periodOptions = useMemo(() => {
    if (!activePeriodConfig) return [];
    return generatePeriodOptions(activePeriodConfig);
  }, [activePeriodConfig]);

  useEffect(() => {
    if (selectedPeriodType === "by_default") {
      setSelectedPeriod("by_default");
    } else if (periodOptions.length > 0) {
      if (!selectedPeriod || selectedPeriod === "by_default" || !periodOptions.some(opt => opt.value === selectedPeriod)) {
        const curYearStr = String(new Date().getFullYear());
        const match = periodOptions.find((opt) => opt.value.includes(curYearStr)) || periodOptions[0];
        setSelectedPeriod(match.value);
      }
    } else {
      setSelectedPeriod("");
    }
  }, [periodOptions, selectedPeriod, selectedPeriodType]);

  useEffect(() => {
    if (!id || !token) return;
    if (template?.fetch_data_with_date && selectedPeriodType !== "by_default" && !selectedPeriod) return;

    const currentGen = ++requestGenRef.current;
    setLoading(true);
    setError(null);
    const isByDefault = selectedPeriodType === "by_default";
    const yr = (template?.fetch_data_with_date && !isByDefault) ? selectedPeriod : reportYear;
    let url = `/reports/templates/${id}/generate?format=json&year=${yr}${isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(selectedPeriodType)}`}&_t=${Date.now()}`;
    if (template?.organization_id) {
      url += `&organization_id=${template.organization_id}`;
    }
    api<ReportData>(url, { token, cache: "no-store" })
      .then((res) => {
        if (currentGen === requestGenRef.current) {
          setData(res);
        }
      })
      .catch((e) => {
        if (currentGen === requestGenRef.current) {
          setError(e instanceof Error ? e.message : "Failed to load report");
        }
      })
      .finally(() => {
        if (currentGen === requestGenRef.current) {
          setLoading(false);
        }
      });
  }, [id, reportYear, selectedPeriod, selectedPeriodType, template, token]);

  const handlePrint = () => {
    if (!data || !token) return;
    setPopupBlockedMsg(null);
    setPrintLoading(true);
    const isByDefault = selectedPeriodType === "by_default";
    const yr = (template?.fetch_data_with_date && !isByDefault) ? selectedPeriod : reportYear;
    const useCached = String(data.year) === String(yr);
    const run = (reportData: ReportData) => {
      const doc = buildReportPrintDocument(reportData);
      const opened = openReportPrintWindow(doc, true);
      if (!opened) setPopupBlockedMsg("Pop-up was blocked. Allow pop-ups for this site to open print/PDF in a new tab.");
    };
    if (useCached) {
      try {
        run(data);
      } finally {
        setPrintLoading(false);
      }
      return;
    }
    let url = `/reports/templates/${id}/generate?format=json&year=${yr}${isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(selectedPeriodType)}`}&_t=${Date.now()}`;
    if (template?.organization_id) {
      url += `&organization_id=${template.organization_id}`;
    }
    api<ReportData>(url, { token, cache: "no-store" })
      .then(run)
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
        {template?.can_change_period !== false && (
          (template?.fetch_data_with_date || customPeriods.length > 0) ? (
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Period Type:</label>
                <select
                  value={selectedPeriodType}
                  onChange={(e) => setSelectedPeriodType(e.target.value)}
                  style={{
                    padding: "0.35rem 0.5rem",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    fontSize: "0.875rem",
                    background: "var(--surface)"
                  }}
                >
                  <option value="by_default">Default</option>
                  {customPeriods.map((cp: any) => (
                    <option key={cp.custom_period_name} value={cp.custom_period_name}>
                      {cp.custom_period_name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedPeriodType === "by_default" ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Year</label>
                  <select
                    value={reportYear}
                    onChange={(e) => setReportYear(Number(e.target.value))}
                    style={{
                      padding: "0.35rem 0.5rem",
                      borderRadius: "4px",
                      border: "1px solid var(--border)",
                      fontSize: "0.875rem",
                      background: "var(--surface)"
                    }}
                  >
                    {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              ) : (
                periodOptions.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Reporting Period:</label>
                    <select
                      value={selectedPeriod}
                      onChange={(e) => setSelectedPeriod(e.target.value)}
                      style={{
                        padding: "0.35rem 0.5rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border)",
                        fontSize: "0.875rem",
                        background: "var(--surface)"
                      }}
                    >
                      {periodOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              )}
            </div>
          ) : (
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
          )
        )}
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
