"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
import { generatePeriodOptions } from "@/lib/periodHelpers";
import { VirtualTable } from "@/components/VirtualTable";
import toast from "react-hot-toast";
import { downloadBlob } from "@/lib/download";


interface Field {
  id: number;
  kpi_field_id: number;
  field_key: string;
  field_name: string;
  field_type: string;
  number: string;
  value?: any;
  config?: any;
  sub_fields?: { key: string; name: string; field_type: string }[];
  sub_field_keys?: string[];
  value_items?: any[];
  total_count?: number;
  loading?: boolean;
}

interface Section {
  id: number;
  kpi_id: number;
  custom_header: string;
  number: string;
  fields: Field[];
}

interface ReportMetadata {
  name: string;
  description: string | null;
  year: number;
}

export default function CustomReportViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgId = Number(searchParams.get("organization_id"));
  const token = getAccessToken();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [template, setTemplate] = useState<any | null>(null);
  const [org, setOrg] = useState<any | null>(null);
  const [selectedPeriodType, setSelectedPeriodType] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [metadata, setMetadata] = useState<ReportMetadata | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Period Shifting states
  const [initialLoadCompleted, setInitialLoadCompleted] = useState(false);
  const [isShiftingPeriod, setIsShiftingPeriod] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  // Printing / Exporting loaders
  const [printLoading, setPrintLoading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<number[]>([]);
  const [odooSyncing, setOdooSyncing] = useState(false);

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    api<{ role: string }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token, router]);

  // Load custom report metadata and organization custom periods
  useEffect(() => {
    if (!id || !token || !orgId) return;
    api<any>(`/custom-reports/${id}/detail?organization_id=${orgId}`, { token })
      .then((t) => {
        setTemplate(t);
        if (t.date_fetching_config?.default_period_type === "by_default" && t.date_fetching_config?.default_period) {
          const parsedYear = Number(t.date_fetching_config.default_period);
          if (!isNaN(parsedYear)) {
            setReportYear(parsedYear);
          }
        }
      })
      .catch((e) => console.error("Failed to load custom report details", e));

    api<any>(`/organizations/${orgId}`, { token })
      .then((orgData) => {
        setOrg(orgData);
      })
      .catch((e) => console.error("Failed to load org details", e));
  }, [id, orgId, token]);

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

  const showDatePeriods = useMemo(() => {
    if (!template) return false;
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const dateFetchingEnabled = !!template.fetch_data_with_date;
    if (!isSuperAdmin && !dateFetchingEnabled) {
      return false;
    }
    return dateFetchingEnabled || customPeriods.length > 0;
  }, [userRole, template, customPeriods]);

  const requestGenRef = useRef(0);

  useEffect(() => {
    if (!template) return;
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const dateFetchingDisabled = !template.fetch_data_with_date;
    const forceDefault = userRole !== null && !isSuperAdmin && dateFetchingDisabled;

    if (forceDefault) {
      setSelectedPeriodType("by_default");
    } else if (!selectedPeriodType) {
      const defPeriodType = template.date_fetching_config?.default_period_type;
      if (defPeriodType) {
        setSelectedPeriodType(defPeriodType);
      } else {
        setSelectedPeriodType("by_default");
      }
    } else if (selectedPeriodType !== "by_default" && customPeriods.length > 0 && !customPeriods.some((p: any) => p.custom_period_name === selectedPeriodType)) {
      setSelectedPeriodType("by_default");
    }
  }, [customPeriods, selectedPeriodType, userRole, template]);

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
        const defPeriod = template?.date_fetching_config?.default_period;
        if (defPeriod && periodOptions.some(opt => opt.value === defPeriod)) {
          setSelectedPeriod(defPeriod);
        } else {
          const curYearStr = String(new Date().getFullYear());
          const match = periodOptions.find((opt) => opt.value.includes(curYearStr)) || periodOptions[0];
          setSelectedPeriod(match.value);
        }
      }
    } else {
      setSelectedPeriod("");
    }
  }, [periodOptions, selectedPeriod, selectedPeriodType, template]);

  useEffect(() => {
    if (!id || !token || !orgId || !template) return;
    if (template?.fetch_data_with_date && selectedPeriodType !== "by_default" && !selectedPeriod) return;

    const currentGen = ++requestGenRef.current;
    if (initialLoadCompleted) {
      setIsShiftingPeriod(true);
      setShiftError(null);
    } else {
      setLoading(true);
      setError(null);
    }

    const isByDefault = selectedPeriodType === "by_default";
    // For Data Entry mode, always send the numeric reportYear (e.g. 2026).
    // For custom periods (e.g. "2026/27"), send the selectedPeriod string so the backend can resolve the date range.
    const yr = isByDefault ? reportYear : (selectedPeriod || reportYear);
    const url = `/custom-reports/${id}/generate?year=${yr}&organization_id=${orgId}${isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(selectedPeriodType)}`}&_t=${Date.now()}`;
    api<any>(url, { token, cache: "no-store" })
      .then((res) => {
        if (currentGen === requestGenRef.current) {
          setMetadata({
            name: res.custom_report_name || res.template_name || "Custom Report",
            description: res.custom_report_description || null,
            year: res.year || reportYear,
          });
          setSections(res.sections || []);
          setAttachments(res.attachments || []);
          setInitialLoadCompleted(true);
        }
      })
      .catch((e) => {
        if (currentGen === requestGenRef.current) {
          const msg = e instanceof Error ? e.message : "Failed to load custom report";
          if (initialLoadCompleted) {
            setShiftError(msg);
          } else {
            setError(msg);
          }
        }
      })
      .finally(() => {
        if (currentGen === requestGenRef.current) {
          setLoading(false);
          setIsShiftingPeriod(false);
        }
      });
  }, [id, reportYear, selectedPeriod, selectedPeriodType, template, token, orgId, retryCount]);

  const handleExport = async (format: "pdf" | "docx" | "xlsx") => {
    if (!token) return;
    setPrintLoading(true);
    setExportModalOpen(false);
    const toastId = toast.loading(`Exporting as ${format.toUpperCase()}...`);
    try {
      const isByDefault = selectedPeriodType === "by_default";
      // For Data Entry mode, always send the numeric reportYear; for custom periods send the period string.
      const yr = isByDefault ? reportYear : (selectedPeriod || reportYear);
      let url = getApiUrl(`/custom-reports/${id}/export?year=${yr}&format=${format}&organization_id=${orgId}${isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(selectedPeriodType)}`}`);
      if (selectedAttachmentIds.length > 0) {
        url += `&attachment_ids=${selectedAttachmentIds.join(",")}`;
      }
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.status === 401) {
        toast.error("Session expired. Please log in again.", { id: toastId });
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        toast.error("You don't have permission to export this data.", { id: toastId });
        return;
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || "Export failed");
      }
      
      const blob = await res.blob();
      const cleanName = (metadata?.name || "custom_report")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const downloadName = `${cleanName}_${reportYear}.${format}`;
      
      downloadBlob(blob, downloadName);
      toast.success(`${format.toUpperCase()} exported successfully!`, { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export report", { id: toastId });
    } finally {
      setPrintLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!token) return;
    setPrintLoading(true);
    try {
      const isByDefault = selectedPeriodType === "by_default";
      const yr = (template?.fetch_data_with_date && !isByDefault) ? selectedPeriod : reportYear;
      const res = await api<{ rendered_html?: string }>(
        `/custom-reports/${id}/generate?year=${yr}&organization_id=${orgId}&preview=false${isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(selectedPeriodType)}`}&_t=${Date.now()}`,
        { token, useCache: false }
      );
      if (!res.rendered_html) {
        throw new Error("No printable content found");
      }

      const displayPeriodType = isByDefault ? "Default" : selectedPeriodType;
      const displayReportingPeriod = isByDefault ? String(reportYear) : selectedPeriod;

      let finalHtml = res.rendered_html;
      try {
        const parser = new DOMParser();
        const docParsed = parser.parseFromString(res.rendered_html, "text/html");
        const firstSectionH2 = docParsed.querySelector("section h2");
        if (firstSectionH2) {
          firstSectionH2.setAttribute(
            "style",
            (firstSectionH2.getAttribute("style") || "") + " display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.5rem;"
          );
          const titleText = firstSectionH2.innerHTML;
          firstSectionH2.innerHTML = `<span>${titleText}</span><span style="font-size: 0.8rem; font-weight: normal; color: #475569; font-style: normal; white-space: nowrap;">Period Type: ${displayPeriodType} | Reporting Period: ${displayReportingPeriod}</span>`;
        }
        finalHtml = docParsed.body.innerHTML;
      } catch (e) {
        console.error("Failed to inject period metadata to heading", e);
      }

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document || iframe.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;margin:2rem;color:#111;line-height:1.5;position:relative;}</style></head><body>${finalHtml}</body></html>`);
        doc.close();

        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          document.body.removeChild(iframe);
        }, 500);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trigger print");
    } finally {
      setPrintLoading(false);
    }
  };

  const handleOdooSync = async () => {
    if (!token) return;
    setOdooSyncing(true);
    const toastId = toast.loading("Syncing data from LMS...");

    try {
      const isByDefault = selectedPeriodType === "by_default";
      // For Data Entry mode, always send the numeric reportYear; for custom periods send the period string.
      const yr = isByDefault ? reportYear : (selectedPeriod || reportYear);
      const pTypeParam = isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(selectedPeriodType)}`;
      const res = await api<any>(
        `/custom-reports/${id}/sync-odoo?year=${yr}&organization_id=${orgId}${pTypeParam}`,
        { method: "POST", token }
      );
      if (res.errors && res.errors.length > 0) {
        toast.success(`Synced ${res.synced_kpis} KPI(s) with ${res.errors.length} warning(s)`, { id: toastId });
      } else {
        toast.success(res.message || `Successfully synced ${res.synced_kpis} KPI(s) from LMS`, { id: toastId });
      }
      // Re-fetch report data with cache-buster to get fresh MLI values
      setLoading(true);
      // Small delay to let backend DB commit propagate fully
      await new Promise(resolve => setTimeout(resolve, 300));
      const cacheBuster = Date.now();
      const freshUrl = `/custom-reports/${id}/generate?year=${yr}&organization_id=${orgId}&preview=true${pTypeParam}&_t=${cacheBuster}`;
      const freshData = await api<any>(freshUrl, { token });
      setMetadata({
        name: freshData.custom_report_name || freshData.template_name || "Custom Report",
        description: freshData.custom_report_description || null,
        year: freshData.year || reportYear,
      });
      setSections(freshData.sections || []);
      setAttachments(freshData.attachments || []);
      setLoading(false);

    } catch (err) {
      toast.dismiss(toastId);
      const msg = String(err instanceof Error ? err.message : err || "").toLowerCase();
      const isTimeout =
        msg.includes("socket hang up") ||
        msg.includes("hang up") ||
        msg.includes("econnreset") ||
        msg.includes("timeout") ||
        msg.includes("abort") ||
        msg.includes("failed to fetch") ||
        msg.includes("network error") ||
        msg.includes("502") ||
        msg.includes("504");

      if (isTimeout) {
        toast((t) => (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.9rem", color: "#374151" }}>
              The sync request timed out or connection was lost. This is often due to a weak internet connection or slow network response. Please try again.
            </span>
            <button
              onClick={() => {
                toast.dismiss(t.id);
                handleOdooSync();
              }}
              style={{
                alignSelf: "flex-end",
                padding: "0.3rem 0.8rem",
                background: "#2563eb",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 600,
                boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)"
              }}
            >
              Try Again
            </button>
          </div>
        ), { duration: 15000 });
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to sync from LMS");
      }
    } finally {
      setOdooSyncing(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1rem" }}>
      {/* Top Left Back Navigation */}
      <div style={{ marginBottom: "1rem" }}>
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
          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
        >
          ← Back
        </button>
      </div>

      {/* Top Header Panel */}
      <div style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem", background: "linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)", padding: "1.25rem 1.5rem", borderRadius: 12, boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)", color: "white" }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            {metadata?.name || "Custom Report"}
          </h1>
          {metadata?.description && (
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.9rem", color: "#bfdbfe" }}>
              {metadata.description}
            </p>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          {/* Period & Year selector */}          {template?.can_change_period !== false && (
            showDatePeriods ? (
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <label style={{ fontSize: "0.9rem", color: "#93c5fd", fontWeight: 600 }}>Period Type:</label>
                  <select
                    value={selectedPeriodType}
                    onChange={(e) => setSelectedPeriodType(e.target.value)}
                    disabled={loading || isShiftingPeriod}
                    style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: "1px solid #3b82f6", background: "#1e3a8a", color: "white", fontSize: "0.9rem", cursor: (loading || isShiftingPeriod) ? "not-allowed" : "pointer", opacity: (loading || isShiftingPeriod) ? 0.6 : 1, fontWeight: 500 }}
                  >
                    <option value="by_default">Data entry</option>
                    {customPeriods.map((cp: any) => (
                      <option key={cp.custom_period_name} value={cp.custom_period_name}>
                        {cp.custom_period_name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedPeriodType === "by_default" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.9rem", color: "#93c5fd", fontWeight: 600 }}>Reporting period:</label>
                    <select
                      value={reportYear}
                      onChange={(e) => setReportYear(Number(e.target.value))}
                      disabled={loading || isShiftingPeriod}
                      style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: "1px solid #3b82f6", background: "#1e3a8a", color: "white", fontSize: "0.9rem", cursor: (loading || isShiftingPeriod) ? "not-allowed" : "pointer", opacity: (loading || isShiftingPeriod) ? 0.6 : 1, fontWeight: 500 }}
                    >
                      {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  periodOptions.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <label style={{ fontSize: "0.9rem", color: "#93c5fd", fontWeight: 600 }}>Reporting period:</label>
                      <select
                        value={selectedPeriod}
                        onChange={(e) => setSelectedPeriod(e.target.value)}
                        disabled={loading || isShiftingPeriod}
                        style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: "1px solid #3b82f6", background: "#1e3a8a", color: "white", fontSize: "0.9rem", cursor: (loading || isShiftingPeriod) ? "not-allowed" : "pointer", opacity: (loading || isShiftingPeriod) ? 0.6 : 1, fontWeight: 500 }}
                      >
                        {periodOptions.map((opt: any) => (
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
                <label style={{ fontSize: "0.9rem", color: "#93c5fd", fontWeight: 600 }}>Year:</label>
                <select
                  value={reportYear}
                  onChange={(e) => setReportYear(Number(e.target.value))}
                  disabled={loading || isShiftingPeriod}
                  style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: "1px solid #3b82f6", background: "#1e3a8a", color: "white", fontSize: "0.9rem", cursor: (loading || isShiftingPeriod) ? "not-allowed" : "pointer", opacity: (loading || isShiftingPeriod) ? 0.6 : 1, fontWeight: 500 }}
                >
                  {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )
          )})}

          <div style={{ display: "flex", gap: "0.5rem" }}>
            {userRole === "SUPER_ADMIN" && (
              <Link
                className="btn"
                href={`/dashboard/custom-reports/${id}/design?organization_id=${orgId}`}
                style={{ fontSize: "0.9rem", padding: "0.4rem 0.8rem", background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8 }}
              >
                Layout Designer
              </Link>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setExportModalOpen(true)}
              disabled={loading || printLoading || isShiftingPeriod}
              style={{ padding: "0.4rem 0.8rem", fontSize: "0.9rem", background: "#10b981", color: "white", border: "none", borderRadius: 8, cursor: (loading || printLoading || isShiftingPeriod) ? "not-allowed" : "pointer", opacity: (loading || printLoading || isShiftingPeriod) ? 0.6 : 1 }}
            >
              {printLoading ? "Working..." : "Print / Export"}
            </button>
          </div>
        </div>
      </div>

      {/* Load Data from LMS Button */}
      {template?.show_odoo_button && (
        <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "1rem" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={odooSyncing || loading || isShiftingPeriod}
            onClick={handleOdooSync}
            style={{
              padding: "0.45rem 1rem",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: (odooSyncing || loading || isShiftingPeriod) ? "not-allowed" : "pointer",
              opacity: (odooSyncing || loading || isShiftingPeriod) ? 0.6 : 1,
            }}
          >
            {odooSyncing ? "Syncing from LMS..." : "Load Data from LMS"}
          </button>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Premium Loading Card (matches period shifting layout) */}
      {loading && !isShiftingPeriod && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "6rem 1rem",
          width: "100%"
        }}>
          <div style={{
            background: "var(--surface)",
            padding: "2.5rem 2rem",
            borderRadius: 12,
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
            border: "1px solid var(--border)",
            textAlign: "center",
            maxWidth: 420,
            width: "calc(100% - 2rem)",
            margin: "0 1rem"
          }}>
            <div style={{
              display: "inline-block",
              width: 36,
              height: 36,
              border: "3px solid var(--border)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              marginBottom: "1.25rem"
            }} />
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text)", margin: "0 0 0.5rem 0", letterSpacing: "-0.02em" }}>
              Loading Report Data
            </h3>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
              Please wait while we fetch and compile the report...
            </p>
          </div>
        </div>
      )}

      {/* Main Report View */}
      {error && (
        <div style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #fee2e2", borderRadius: 8, color: "#b91c1c", marginBottom: "1.5rem", fontWeight: 500 }}>
          ⚠️ {error}
        </div>
      )}

      {!loading && sections.length === 0 && !error && (
        <div style={{ padding: "3rem", textAlign: "center", background: "#f8fafc", borderRadius: 12, border: "2px dashed #cbd5e1", color: "#64748b" }}>
          No content has been generated for this custom report.
        </div>
      )}

      {!loading && (
        <div style={{ position: "relative", minHeight: (isShiftingPeriod || shiftError) ? "280px" : "auto" }}>
        {/* Shifting period overlay */}
        {isShiftingPeriod && (
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(248, 250, 252, 0.65)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            zIndex: 40,
            borderRadius: 12,
            paddingTop: "6rem"
          }}>
            <div style={{
              background: "var(--surface)",
              padding: "2.5rem 2rem",
              borderRadius: 12,
              boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
              border: "1px solid var(--border)",
              textAlign: "center",
              maxWidth: 420,
              width: "calc(100% - 2rem)",
              margin: "0 1rem"
            }}>
              <div style={{
                display: "inline-block",
                width: 36,
                height: 36,
                border: "3px solid var(--border)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                marginBottom: "1.25rem"
              }} />
              <h3 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text)", margin: "0 0 0.5rem 0", letterSpacing: "-0.02em" }}>
                Adjusting Report Period
              </h3>
              <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                Recalculating and updating report data…
              </p>
            </div>
          </div>
        )}

        {/* Shifting error card */}
        {shiftError && (
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(248, 250, 252, 0.85)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            zIndex: 40,
            borderRadius: 12,
            paddingTop: "4rem"
          }}>
            <div style={{
              background: "var(--surface)",
              padding: "2.5rem 2rem",
              borderRadius: 12,
              boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
              border: "1px solid #fecaca",
              textAlign: "center",
              maxWidth: 440,
              width: "calc(100% - 2rem)",
              margin: "0 1rem"
            }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "#fee2e2",
                color: "var(--error)",
                fontSize: "1.5rem",
                marginBottom: "1.25rem"
              }}>
                ⚠️
              </div>
              <h3 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--error)", margin: "0 0 0.5rem 0", letterSpacing: "-0.02em" }}>
                Period Adjustment Failed
              </h3>
              <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1.5rem", wordBreak: "break-word", lineHeight: 1.6 }}>
                {shiftError}
              </p>
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setRetryCount(prev => prev + 1)}
                  style={{
                    fontSize: "0.9rem",
                    padding: "0.5rem 1.25rem",
                    background: "var(--accent)",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontWeight: 600
                  }}
                >
                  🔄 Retry Adjustment
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShiftError(null)}
                  style={{
                    fontSize: "0.9rem",
                    padding: "0.5rem 1.25rem",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: "var(--surface)",
                    color: "var(--text-secondary)",
                    fontWeight: 600
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Existing report layout with faded opacity during shifting */}
        <div style={{
          opacity: isShiftingPeriod ? 0.35 : 1,
          pointerEvents: (isShiftingPeriod || shiftError) ? "none" : "auto",
          transition: "opacity 0.2s ease"
        }}>
          {sections.map((sec) => (
            <div key={sec.id} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              {/* Section Header */}
              <h2 style={{ fontSize: "1.2rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem", margin: "0 0 1rem 0", color: "#1e3a8a", borderBottom: "1.5px solid #eff6ff", paddingBottom: "0.5rem" }}>
                <span style={{ background: "#dbeafe", color: "#1e40af", fontSize: "0.85rem", padding: "0.2rem 0.5rem", borderRadius: 6, fontWeight: 700 }}>
                  {sec.number}
                </span>
                {sec.custom_header}
              </h2>

              {/* Scalar fields grid */}
              {sec.fields.filter(f => f.field_type !== "multi_line_items").length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
                  {sec.fields
                    .filter(f => f.field_type !== "multi_line_items")
                    .map((f) => (
                      <div key={f.id} style={{ display: "flex", justifySelf: "stretch", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", background: "#f8fafc", borderRadius: 8, border: "1px solid #f1f5f9", transition: "all 0.15s ease" }} className="scalar-card-hover">
                        <span style={{ fontSize: "0.85rem", color: "#64748b", fontWeight: 500 }}>
                          {f.number} {f.field_name}
                        </span>
                        <strong style={{ fontSize: "0.95rem", color: "#1e293b" }}>
                          {f.value !== null && f.value !== undefined ? String(f.value) : "—"}
                        </strong>
                      </div>
                    ))}
                </div>
              )}

              {/* Multi Line Item (Relational Tables) */}
              {sec.fields
                .filter(f => f.field_type === "multi_line_items")
                .map((f) => {
                  const cols = (f.sub_fields || []).map(sf => ({
                    key: sf.key,
                    name: sf.name || sf.key
                  }));

                  return (
                    <div key={f.id} style={{ marginTop: "1rem" }}>
                      <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "#475569", display: "flex", alignItems: "center", gap: "0.4rem", margin: "0 0 0.5rem 0" }}>
                        📊 {f.number} {f.field_name}
                        {f.loading && (
                          <span style={{ fontSize: "0.75rem", background: "#fef3c7", color: "#d97706", padding: "0.1rem 0.4rem", borderRadius: 4, animation: "pulse 1.5s infinite" }}>
                            Progressive Loading...
                          </span>
                        )}
                      </h3>
                      
                      <VirtualTable
                        columns={cols}
                        rows={f.value_items || []}
                        totalCount={f.total_count}
                        mergedHeaders={f.config?.merged_headers}
                        columnWidths={f.config?.column_widths}
                        footerRows={(f as any).evaluated_footer_rows}
                      />
                    </div>
                  );
                })}
            </div>
          ))}

          {/* Attachments Section */}
          {attachments && attachments.length > 0 && (
            <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: "1.5rem", marginBottom: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0 0 1rem 0", color: "#1e3a8a", borderBottom: "1.5px solid #eff6ff", paddingBottom: "0.5rem" }}>
                Exportable Attachments
              </h2>
              <p style={{ fontSize: "0.9rem", color: "#64748b", marginBottom: "1rem" }}>
                Select attachments below and click Export to download them.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {attachments.map((att, attIdx) => {
                  const isChecked = selectedAttachmentIds.includes(att.id);
                  return (
                    <label key={attIdx} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer", padding: "0.75rem", background: isChecked ? "#eff6ff" : "#f8fafc", border: `1px solid ${isChecked ? "#bfdbfe" : "#e2e8f0"}`, borderRadius: "8px", transition: "all 0.2s" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAttachmentIds(prev => [...prev, att.id]);
                          } else {
                            setSelectedAttachmentIds(prev => prev.filter(id => id !== att.id));
                          }
                        }}
                        style={{ marginTop: "0.25rem", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#1e293b", marginBottom: "0.15rem" }}>
                          📎 {att.title}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          Source KPI: {att.kpi_name} — Field: {att.field_name}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Print / Export Modal */}
      {exportModalOpen && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0, 0, 0, 0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div className="card" style={{ width: "100%", maxWidth: "420px", padding: "1.5rem", background: "white", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#1e3a8a" }}>Export custom report</h3>
              <button type="button" onClick={() => setExportModalOpen(false)} style={{ border: "none", background: "transparent", fontSize: "1.25rem", cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            
            <p style={{ fontSize: "0.9rem", color: "#64748b", marginBottom: "1rem" }}>
              Select a format to print or download this report:
            </p>

            <div style={{ marginBottom: "1rem" }}>
              {selectedAttachmentIds.length > 0 ? (
                <div style={{ padding: "0.75rem", background: "#f0fdf4", color: "#166534", borderRadius: "8px", fontSize: "0.9rem", border: "1px solid #bbf7d0" }}>
                  <strong>Exporting Attachments:</strong> You have selected {selectedAttachmentIds.length} attachment(s). The export will contain <strong>only</strong> the selected attachments {selectedAttachmentIds.length > 1 ? "as a ZIP file" : ""}.
                </div>
              ) : (
                <div style={{ padding: "0.75rem", background: "#f8fafc", color: "#475569", borderRadius: "8px", fontSize: "0.9rem", border: "1px solid var(--border)" }}>
                  <strong>Exporting Main Report:</strong> You have not selected any attachments, so the main report will be exported.
                </div>
              )}
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <button
                type="button"
                className="btn"
                onClick={handlePrint}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "0.65rem 1rem", fontWeight: 600, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print Report (PDF System Dialog)
              </button>

              <button
                type="button"
                className="btn"
                onClick={() => handleExport("pdf")}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "0.65rem 1rem", fontWeight: 600, background: "#fff5f5", color: "#991b1b", border: "1px solid #fca5a5" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Direct Download PDF (.pdf)
              </button>
              
              <button
                type="button"
                className="btn"
                onClick={() => handleExport("docx")}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "0.65rem 1rem", fontWeight: 600, backgroundColor: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Export Word (.docx)
              </button>
              
              <button
                type="button"
                className="btn"
                onClick={() => handleExport("xlsx")}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "0.65rem 1rem", fontWeight: 600, backgroundColor: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                Export Excel (.xlsx)
              </button>
            </div>
          </div>
        </div>
      )}


      
      {/* Global CSS transitions shim */}
      <style>{`
        .scalar-card-hover:hover {
          background: #eff6ff !important;
          border-color: #bfdbfe !important;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
