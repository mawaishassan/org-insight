"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
import toast from "react-hot-toast";
import { generatePeriodOptions } from "@/lib/periodHelpers";
import { downloadBlob } from "@/lib/download";
import {
  buildReportPrintDocument,
  openReportPrintWindow,
  type ReportData,
} from "@/app/dashboard/reports/reportPrint";

interface TemplateRow {
  id: number;
  organization_id: number;
  group_id?: number | null;
  name: string;
  description: string | null;
  fetch_data_with_date?: boolean;
  can_change_period?: boolean;
  date_fetching_config?: {
    default_period_type?: string;
    default_period?: string;
    period_type?: string;
    period?: string;
    [key: string]: any;
  } | null;
}

interface CustomReportGroup {
  id: number;
  organization_id: number;
  name: string;
  sort_order: number;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

export default function ReportsPage() {
  const [list, setList] = useState<TemplateRow[]>([]);
  const [customList, setCustomList] = useState<TemplateRow[]>([]);
  const [groups, setGroups] = useState<CustomReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [renameTemplate, setRenameTemplate] = useState<TemplateRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [createdMsg, setCreatedMsg] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<{ id: number; name: string }[]>([]);
  const [addOrgId, setAddOrgId] = useState<number | null>(null);

  // End-user Generate / Download Report Modal State
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<TemplateRow | null>(null);
  const [activeReportType, setActiveReportType] = useState<"standard" | "custom">("standard");
  const [selectedFormat, setSelectedFormat] = useState<"pdf" | "docx" | "xlsx">("pdf");
  const [org, setOrg] = useState<any | null>(null);
  const [selectedPeriodType, setSelectedPeriodType] = useState<string>("by_default");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("by_default");
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateStep, setGenerateStep] = useState<string>("");

  const canManageAssignments = userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN";
  const canAddReport = userRole === "SUPER_ADMIN";

  const openRenameModal = (t: TemplateRow) => {
    setRenameTemplate(t);
    setRenameName(t.name);
    setRenameDescription(t.description ?? "");
    setError(null);
  };

  const handleRenameSave = async () => {
    const t = renameTemplate;
    const authToken = getAccessToken();
    if (!t || !authToken || userRole !== "SUPER_ADMIN") return;
    const name = renameName.trim();
    if (!name) return;
    setRenameSaving(true);
    setError(null);
    try {
      const updated = await api<TemplateRow>(`/reports/templates/${t.id}?${qs({ organization_id: t.organization_id })}`, {
        method: "PATCH",
        token: authToken,
        body: JSON.stringify({ name, description: renameDescription.trim() || null }),
      });
      setList((prev) => prev.map((x) => (x.id === t.id ? { ...x, name: updated.name, description: updated.description } : x)));
      setRenameTemplate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update report");
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async (t: TemplateRow) => {
    const authToken = getAccessToken();
    if (!authToken || userRole !== "SUPER_ADMIN") return;
    if (!confirm(`Delete report template "${t.name}"? This cannot be undone.`)) return;
    setError(null);
    setDeletingId(t.id);
    try {
      await api(`/reports/templates/${t.id}?${qs({ organization_id: t.organization_id })}`, {
        method: "DELETE",
        token: authToken,
      });
      setList((prev) => prev.filter((x) => x.id !== t.id));
      toast.success("Template deleted successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete report");
      toast.error(err instanceof Error ? err.message : "Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    setLoading(true);
    Promise.all([
      api<TemplateRow[]>("/reports/templates", { token }).catch(() => []),
      api<TemplateRow[]>("/custom-reports", { token }).catch(() => []),
      api<CustomReportGroup[]>("/custom-report-groups", { token }).catch(() => []),
      api<{ role: string; organization_id: number | null }>("/auth/me", { token }).catch(() => null),
    ])
      .then(([templates, customs, reportGroups, me]) => {
        setList(templates);
        setCustomList(customs);
        setGroups(reportGroups);
        if (me) {
          setUserRole(me.role);
          setOrganizationId(me.organization_id ?? null);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reports"))
      .finally(() => setLoading(false));
  }, []);

  const openAddModal = () => {
    setAddName("");
    setAddDescription("");
    setAddOrgId(organizationId ?? null);
    setCreatedMsg(null);
    setError(null);
    setAddModalOpen(true);
  };

  useEffect(() => {
    if (!addModalOpen || userRole !== "SUPER_ADMIN" || organizationId != null) return;
    const token = getAccessToken();
    if (!token) return;
    api<{ id: number; name: string }[]>(`/organizations?with_summary=false`, { token })
      .then((list) => {
        setOrganizations(list);
        if (list.length > 0 && addOrgId == null) setAddOrgId(list[0].id);
      })
      .catch(() => setOrganizations([]));
  }, [addModalOpen, userRole, organizationId]);

  const effectiveAddOrgId = organizationId ?? addOrgId;

  const handleAddReport = async () => {
    const authToken = getAccessToken();
    if (!authToken || effectiveAddOrgId == null || !addName.trim()) return;
    setAddSaving(true);
    setError(null);
    setCreatedMsg(null);
    try {
      const created = await api<TemplateRow>(`/reports/templates?${qs({ organization_id: effectiveAddOrgId })}`, {
        method: "POST",
        token: authToken,
        body: JSON.stringify({ name: addName.trim(), description: addDescription.trim() || null }),
      });
      setList((prev) => [created, ...prev]);
      setAddName("");
      setAddDescription("");
      setAddModalOpen(false);
      setCreatedMsg("Report template created.");
      toast.success("Template created successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create report");
      toast.error(err instanceof Error ? err.message : "Failed to create report");
    } finally {
      setAddSaving(false);
    }
  };

  // Load organization custom periods for end-users
  useEffect(() => {
    const token = getAccessToken();
    if (!token || !organizationId) return;
    api<any>(`/organizations/${organizationId}`, { token })
      .then(setOrg)
      .catch((e) => console.error("Failed to load organization details", e));
  }, [organizationId]);

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

  const defaultPeriodOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const options = [];
    for (let y = currentYear - 4; y <= currentYear + 4; y++) {
      options.push({ value: String(y), label: String(y) });
    }
    return options;
  }, []);

  const activePeriodConfig = useMemo(() => {
    return customPeriods.find((p: any) => p.custom_period_name === selectedPeriodType) || null;
  }, [customPeriods, selectedPeriodType]);

  const periodOptions = useMemo(() => {
    if (!activePeriodConfig) return [];
    return generatePeriodOptions(activePeriodConfig);
  }, [activePeriodConfig]);

  const activePeriodOptions = useMemo(() => {
    if (selectedPeriodType === "by_default" || periodOptions.length === 0) {
      return defaultPeriodOptions;
    }
    return periodOptions;
  }, [selectedPeriodType, periodOptions, defaultPeriodOptions]);

  useEffect(() => {
    if (!genModalOpen || !activeReport) return;
    const config = activeReport.date_fetching_config;
    const adminPeriodType = config?.default_period_type || config?.period_type;
    const adminPeriod = config?.default_period || config?.period;

    if (selectedPeriodType === adminPeriodType && adminPeriod) {
      setSelectedPeriod(adminPeriod);
      return;
    }

    if (selectedPeriodType === "by_default") {
      setSelectedPeriod(adminPeriodType === "by_default" && adminPeriod ? adminPeriod : String(new Date().getFullYear()));
    } else if (activePeriodOptions.length > 0) {
      if (!selectedPeriod || selectedPeriod === "by_default" || !activePeriodOptions.some(opt => opt.value === selectedPeriod)) {
        const curYearStr = String(new Date().getFullYear());
        const match = activePeriodOptions.find((opt) => opt.value.includes(curYearStr)) || activePeriodOptions[0];
        setSelectedPeriod(match.value);
      }
    } else {
      setSelectedPeriod("");
    }
  }, [activePeriodOptions, selectedPeriodType, activeReport, genModalOpen]);

  const handleGenerateReport = async (reportOverride?: TemplateRow, periodTypeOverride?: string, periodOverride?: string) => {
    const token = getAccessToken();
    const active = reportOverride || activeReport;
    if (!token || !active) {
      toast.error("Unable to generate report: Missing session or active report configuration");
      return;
    }

    // Pre-open pop-up window synchronously to bypass browser pop-up blocker
    const printWin = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (printWin) {
      printWin.document.write(`
        <!DOCTYPE html>
        <html>
          <head><title>Generating Report...</title></head>
          <body style="font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #475569;">
            <div style="text-align: center;">
              <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem; color: #1e293b;">Generating PDF Report...</h3>
              <p style="font-size: 0.9rem; margin: 0; color: #64748b;">Please wait while the report data is fetched and formatted.</p>
            </div>
          </body>
        </html>
      `);
    }

    setGenerateLoading(true);
    setGenerateStep("Accessing report database...");
    
    const pType = periodTypeOverride || selectedPeriodType || "by_default";
    const yr = periodOverride || selectedPeriod || String(new Date().getFullYear());
    const isByDefault = pType === "by_default";
    let url = `/reports/templates/${active.id}/generate?format=json&year=${encodeURIComponent(yr)}${isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(pType)}`}&_t=${Date.now()}`;
    if (active.organization_id) {
      url += `&organization_id=${active.organization_id}`;
    }

    try {
      setGenerateStep("Compiling formulas...");
      const res = await api<ReportData>(url, { token, cache: "no-store" });
      setGenerateStep("Finalizing print layout...");
      const doc = buildReportPrintDocument(res);

      if (printWin && !printWin.closed) {
        printWin.document.open();
        printWin.document.write(doc);
        printWin.document.close();
        setTimeout(() => {
          try {
            printWin.focus();
            printWin.print();
          } catch (err) {
            console.error("Print error", err);
          }
        }, 250);
        toast.success("PDF/Print layout generated successfully");
      } else {
        const opened = openReportPrintWindow(doc, true);
        if (!opened) {
          toast.error("Pop-up was blocked. Allow pop-ups for this site to view the PDF/Print layout.");
        } else {
          toast.success("PDF/Print layout generated successfully");
        }
      }
      setGenModalOpen(false);
    } catch (e) {
      if (printWin && !printWin.closed) {
        printWin.close();
      }
      toast.error(e instanceof Error ? e.message : "Failed to generate report");
      setGenModalOpen(false);
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleDownloadCustomReport = async (
    reportOverride?: TemplateRow,
    formatOverride?: "pdf" | "docx" | "xlsx",
    periodTypeOverride?: string,
    periodOverride?: string
  ) => {
    const token = getAccessToken();
    const active = reportOverride || activeReport;
    if (!token || !active) {
      toast.error("Unable to download report: Missing session or active report configuration");
      return;
    }
    const format = formatOverride || selectedFormat || "pdf";
    setGenerateLoading(true);
    setGenerateStep(`Preparing ${format.toUpperCase()} report...`);

    const pType = periodTypeOverride || selectedPeriodType || "by_default";
    const isByDefault = pType === "by_default" || !active.fetch_data_with_date;
    const yr = isByDefault
      ? (periodOverride || (selectedPeriod && selectedPeriod !== "by_default" ? selectedPeriod : String(new Date().getFullYear())))
      : (periodOverride || selectedPeriod || String(new Date().getFullYear()));
    const targetOrgId = active.organization_id || organizationId;
    let url = getApiUrl(
      `/custom-reports/${active.id}/export?year=${encodeURIComponent(yr)}&format=${format}&organization_id=${targetOrgId}${
        isByDefault ? "&by_default=true" : `&period_type=${encodeURIComponent(pType)}`
      }`
    );

    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || "Export failed");
      }
      setGenerateStep(`Downloading ${format.toUpperCase()} report file...`);
      const blob = await res.blob();
      const cleanName = (active.name || "custom_report")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const downloadName = `${cleanName}_${yr}.${format}`;
      downloadBlob(blob, downloadName);
      toast.success(`${format.toUpperCase()} report downloaded successfully!`);
      setGenModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to download custom report (${format.toUpperCase()})`);
      setGenModalOpen(false);
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleGenerateClick = () => {
    if (activeReportType === "custom") {
      void handleDownloadCustomReport();
    } else {
      void handleGenerateReport();
    }
  };

  const openCustomReportDownload = (t: TemplateRow) => {
    setActiveReport(t);
    setActiveReportType("custom");
    setSelectedFormat("pdf");

    const targetOrgId = t.organization_id || organizationId;
    const token = getAccessToken();
    if (token && targetOrgId && (!org || org.id !== targetOrgId)) {
      api<any>(`/organizations/${targetOrgId}`, { token })
        .then(setOrg)
        .catch((e) => console.error("Failed to load organization details", e));
    }

    const config = t.date_fetching_config;
    const adminPeriodType = config?.default_period_type || config?.period_type;
    const adminPeriod = config?.default_period || config?.period;

    let resolvedPeriodType = "by_default";
    if (t.fetch_data_with_date && adminPeriodType) {
      resolvedPeriodType = adminPeriodType;
    }

    let resolvedPeriod = adminPeriod || String(new Date().getFullYear());

    setSelectedPeriodType(resolvedPeriodType);
    setSelectedPeriod(resolvedPeriod);
    setGenerateLoading(false);
    setGenerateStep("");

    // For end-users, if the report does not require selecting a date period, immediately start downloading PDF
    if (!canManageAssignments && (!t.fetch_data_with_date || t.can_change_period === false)) {
      setGenModalOpen(true);
      void handleDownloadCustomReport(t, "pdf", resolvedPeriodType, resolvedPeriod);
    } else {
      setGenModalOpen(true);
    }
  };

  const openGenModal = (t: TemplateRow, type: "standard" | "custom") => {
    if (type === "custom") {
      openCustomReportDownload(t);
      return;
    }

    setActiveReport(t);
    setActiveReportType(type);

    const config = t.date_fetching_config;
    const adminPeriodType = config?.default_period_type || config?.period_type;
    const adminPeriod = config?.default_period || config?.period;

    let resolvedPeriodType = "by_default";
    if (t.fetch_data_with_date && adminPeriodType) {
      resolvedPeriodType = adminPeriodType;
    }

    let resolvedPeriod = adminPeriod || String(new Date().getFullYear());

    setSelectedPeriodType(resolvedPeriodType);
    setSelectedPeriod(resolvedPeriod);
    setGenerateLoading(false);
    setGenerateStep("");

    if (t.can_change_period === false) {
      setGenModalOpen(true);
      void handleGenerateReport(t, resolvedPeriodType, resolvedPeriod);
    } else {
      setGenModalOpen(true);
    }
  };

  const groupedCustomReports = useMemo(() => {
    const map: Record<string, TemplateRow[]> = {
      uncategorized: [],
    };
    groups.forEach((g) => {
      map[g.id] = [];
    });
    customList.forEach((r) => {
      if (r.group_id && map[r.group_id]) {
        map[r.group_id].push(r);
      } else {
        map.uncategorized.push(r);
      }
    });
    return map;
  }, [groups, customList]);

  const renderDownloadModal = () => {
    if (!genModalOpen || !activeReport) return null;

    const isCustom = activeReportType === "custom";
    const dateFetchingEnabled = isCustom && !!activeReport.fetch_data_with_date;

    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(15, 23, 42, 0.45)",
          backdropFilter: "blur(6px)",
          padding: "1.5rem",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !generateLoading) {
            setGenModalOpen(false);
            setGenerateLoading(false);
          }
        }}
      >
        <div
          className="card"
          style={{
            maxWidth: 480,
            width: "100%",
            padding: "1.75rem",
            borderRadius: "16px",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
            position: "relative",
            background: "#ffffff",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {generateLoading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2.5rem 0", textAlign: "center" }}>
              <div style={{ position: "relative", width: "64px", height: "64px", marginBottom: "1.25rem" }}>
                <div style={{ position: "absolute", width: "100%", height: "100%", border: "4px solid var(--border)", borderRadius: "50%" }}></div>
                <div style={{ position: "absolute", width: "100%", height: "100%", border: "4px solid transparent", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
              </div>
              <h4 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "#0f172a" }}>
                {isCustom ? `Downloading ${selectedFormat.toUpperCase()} Report` : "Generating Report"}
              </h4>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : (
            <>
              <div>
                <h3 style={{ margin: "0 0 0.4rem 0", fontSize: "1.35rem", fontWeight: 700, color: "#0f172a" }}>
                  Generate PDF Report
                </h3>
                <p style={{ color: "#475569", fontSize: "0.95rem", margin: "0 0 1.5rem 0", lineHeight: "1.5" }}>
                  Select reporting period parameters for{" "}
                  <strong style={{ color: "#1e3a8a", fontWeight: 700 }}>{activeReport.name}</strong>.
                </p>
              </div>

              {/* Reporting Period */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ display: "block", marginBottom: "0.45rem", fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                  Reporting Period *
                </label>
                <select
                  value={selectedPeriodType}
                  onChange={(e) => setSelectedPeriodType(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "#ffffff",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "0.95rem",
                    color: "#0f172a",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="by_default">Fiscal Year</option>
                  {customPeriods.map((cp: any) => (
                    <option key={cp.custom_period_name} value={cp.custom_period_name}>
                      {cp.custom_period_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reporting Time */}
              <div style={{ marginBottom: "1.5rem" }}>
                <label style={{ display: "block", marginBottom: "0.45rem", fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                  Reporting Time *
                </label>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "#ffffff",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "0.95rem",
                    color: "#0f172a",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                >
                  {activePeriodOptions.length > 0 ? (
                    activePeriodOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                  ) : (
                    <option value={String(new Date().getFullYear())}>
                      {new Date().getFullYear()}/{String(new Date().getFullYear() + 1).slice(-2)}
                    </option>
                  )}
                </select>
              </div>

              {/* Format Selection for Custom Reports: PDF, Excel, Word - Org Admin and Super Admin ONLY */}
              {isCustom && canManageAssignments && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.9rem", color: "#1e293b" }}>
                    Choose Format (PDF, Excel, Word) *
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.65rem" }}>
                    {/* PDF Card */}
                    <div
                      onClick={() => setSelectedFormat("pdf")}
                      style={{
                        padding: "0.85rem 0.5rem",
                        borderRadius: "10px",
                        border: selectedFormat === "pdf" ? "2px solid #ef4444" : "1px solid #e2e8f0",
                        background: selectedFormat === "pdf" ? "rgba(239, 68, 68, 0.05)" : "#ffffff",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s ease",
                        boxShadow: selectedFormat === "pdf" ? "0 2px 8px rgba(239, 68, 68, 0.15)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>📄</div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: selectedFormat === "pdf" ? "#b91c1c" : "#1e293b" }}>PDF</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Document</div>
                    </div>

                    {/* Excel Card */}
                    <div
                      onClick={() => setSelectedFormat("xlsx")}
                      style={{
                        padding: "0.85rem 0.5rem",
                        borderRadius: "10px",
                        border: selectedFormat === "xlsx" ? "2px solid #10b981" : "1px solid #e2e8f0",
                        background: selectedFormat === "xlsx" ? "rgba(16, 185, 129, 0.05)" : "#ffffff",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s ease",
                        boxShadow: selectedFormat === "xlsx" ? "0 2px 8px rgba(16, 185, 129, 0.15)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>📊</div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: selectedFormat === "xlsx" ? "#047857" : "#1e293b" }}>Excel</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Spreadsheet</div>
                    </div>

                    {/* Word Card */}
                    <div
                      onClick={() => setSelectedFormat("docx")}
                      style={{
                        padding: "0.85rem 0.5rem",
                        borderRadius: "10px",
                        border: selectedFormat === "docx" ? "2px solid #2563eb" : "1px solid #e2e8f0",
                        background: selectedFormat === "docx" ? "rgba(37, 99, 235, 0.05)" : "#ffffff",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s ease",
                        boxShadow: selectedFormat === "docx" ? "0 2px 8px rgba(37, 99, 235, 0.15)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>📝</div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: selectedFormat === "docx" ? "#1d4ed8" : "#1e293b" }}>Word</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Document</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.75rem" }}>
                <button
                  type="button"
                  className="modal-btn-cancel"
                  onClick={() => {
                    setGenModalOpen(false);
                    setGenerateLoading(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="modal-btn-confirm"
                  disabled={
                    isCustom &&
                    dateFetchingEnabled &&
                    selectedPeriodType !== "by_default" &&
                    !selectedPeriod
                  }
                  onClick={handleGenerateClick}
                >
                  {isCustom
                    ? canManageAssignments
                      ? `Download ${selectedFormat === "xlsx" ? "Excel" : selectedFormat === "docx" ? "Word" : "PDF"}`
                      : "Generate PDF"
                    : "Generate PDF"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  if (loading) return null;
  if (error) return <p className="form-error">{error}</p>;

  if (!canManageAssignments) {
    if (list.length === 0 && customList.length === 0) {
      return (
        <div>
          <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Reports</h1>
          <div className="card">
            <p style={{ color: "var(--muted)", margin: 0 }}>No reports assigned to you.</p>
          </div>
        </div>
      );
    }

    return (
      <div>
        <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Reports</h1>
        
        {/* Standard Reports Section */}
        {list.length > 0 && (
          <div style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text)", margin: "2rem 0 1.25rem 0" }}>
              Standard Reports
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.25rem" }}>
              {list.map((t) => (
                <div key={`std-${t.id}`} className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-sm)", transition: "transform 0.15s ease, box-shadow 0.15s ease", position: "relative" }}>
                  <div>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", margin: "0 0 0.5rem 0" }}>{t.name}</h3>
                    {t.description && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>{t.description}</p>}
                  </div>
                  <div style={{ marginTop: "1.25rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openGenModal(t, "standard")}
                      style={{ width: "100%", padding: "0.5rem", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
                    >
                      Generate Report
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Report Sections */}
        {groups.map((g) => {
          const groupReports = groupedCustomReports[g.id] || [];
          if (groupReports.length === 0) return null;
          return (
            <div key={`group-${g.id}`} style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text)", margin: "2rem 0 1.25rem 0" }}>
                {g.name}
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.25rem" }}>
                {groupReports.map((t) => (
                  <div key={`cust-${t.id}`} className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-sm)", transition: "transform 0.15s ease, box-shadow 0.15s ease", position: "relative" }}>
                    <div>
                      <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", margin: "0 0 0.5rem 0" }}>{t.name}</h3>
                      {t.description && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>{t.description}</p>}
                    </div>
                    <div style={{ marginTop: "1.25rem" }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => openCustomReportDownload(t)}
                        style={{ width: "100%", padding: "0.5rem", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download Report
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Uncategorized Custom Reports */}
        {groupedCustomReports.uncategorized.length > 0 && (
          <div style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text)", margin: "2rem 0 1.25rem 0" }}>
                General Custom Reports
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.25rem" }}>
              {groupedCustomReports.uncategorized.map((t) => (
                <div key={`cust-uncat-${t.id}`} className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "1.5rem", borderRadius: "12px", border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "var(--shadow-sm)", transition: "transform 0.15s ease, box-shadow 0.15s ease", position: "relative" }}>
                  <div>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", margin: "0 0 0.5rem 0" }}>{t.name}</h3>
                    {t.description && <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>{t.description}</p>}
                  </div>
                  <div style={{ marginTop: "1.25rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openCustomReportDownload(t)}
                      style={{ width: "100%", padding: "0.5rem", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download Report
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Render Download / Generate Modal */}
        {renderDownloadModal()}
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Reports</h1>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <p style={{ color: "var(--muted)", margin: 0, flex: "1 1 auto" }}>
            View and print reports. Use “Assign users” to give others access with view/print/export rights.
          </p>
          {canAddReport && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={openAddModal}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
            >
              <span aria-hidden style={{ fontSize: "1.1rem", lineHeight: 1 }}>+</span>
              Add report
            </button>
          )}
        </div>
        {createdMsg && (
          <p style={{ fontSize: "0.9rem", color: "var(--success)", marginBottom: "0.75rem" }}>{createdMsg}</p>
        )}
        {list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            No report templates yet.
          </p>
        ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {list.map((t) => (
            <li key={t.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <Link href={`/dashboard/reports/${t.id}`} style={{ fontWeight: 500, flex: "1 1 auto" }}>
                {t.name}
              </Link>
              <Link className="btn btn-primary" href={`/dashboard/reports/${t.id}`} style={{ fontSize: "0.85rem" }}>
                View print report
              </Link>
              {canManageAssignments && (
                <Link className="btn" href={`/dashboard/reports/${t.id}/assign`} style={{ fontSize: "0.85rem" }}>
                  Assign users
                </Link>
              )}
              {userRole === "SUPER_ADMIN" && (
                <Link className="btn" href={`/dashboard/reports/${t.id}/design`} style={{ fontSize: "0.85rem" }}>
                  Design
                </Link>
              )}
              {userRole === "SUPER_ADMIN" && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => openRenameModal(t)}
                  style={{ fontSize: "0.85rem" }}
                >
                  Rename
                </button>
              )}
              {userRole === "SUPER_ADMIN" && (
                <button
                  type="button"
                  className="btn"
                  disabled={deletingId === t.id}
                  onClick={() => handleDelete(t)}
                  style={{ fontSize: "0.85rem", color: "var(--error)" }}
                >
                  {deletingId === t.id ? "Deleting…" : "Delete"}
                </button>
              )}
            </li>
          ))}
        </ul>
        )}
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Custom Reports</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          View and assign custom report templates built by Super Admins.
        </p>

        {customList.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No custom reports available.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {groups.map((g) => {
              const groupReports = groupedCustomReports[g.id] || [];
              if (groupReports.length === 0) return null;
              return (
                <div key={`admin-group-${g.id}`}>
                  <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "#475569", marginBottom: "0.5rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "0.25rem" }}>
                    {g.name}
                  </h3>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {groupReports.map((t) => (
                      <li key={t.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                          <Link href={`/dashboard/custom-reports/${t.id}?organization_id=${t.organization_id}`} style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text)", textDecoration: "none" }} title="Open report viewer">
                            {t.name}
                          </Link>
                        {t.description && <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.1rem 0 0 0", width: "100%" }}>{t.description}</p>}
                      </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => openCustomReportDownload(t)}
                            style={{ fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Download
                          </button>
                          <Link className="btn" href={`/dashboard/custom-reports/${t.id}?organization_id=${t.organization_id}`} style={{ fontSize: "0.85rem" }}>
                            View print report
                          </Link>
                          {canManageAssignments && userRole !== "SUPER_ADMIN" && (
                            <Link className="btn" href={`/dashboard/custom-reports/${t.id}/assign?organization_id=${t.organization_id}`} style={{ fontSize: "0.85rem" }}>
                              Assign users
                            </Link>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {/* Uncategorized Custom Reports */}
            {groupedCustomReports.uncategorized.length > 0 && (
              <div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "#475569", marginBottom: "0.5rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "0.25rem" }}>
                  Uncategorized Reports
                </h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {groupedCustomReports.uncategorized.map((t) => (
                    <li key={t.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                        <Link href={`/dashboard/custom-reports/${t.id}?organization_id=${t.organization_id}`} style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text)", textDecoration: "none" }} title="Open report viewer">
                          {t.name}
                        </Link>
                        {t.description && <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.1rem 0 0 0", width: "100%" }}>{t.description}</p>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => openCustomReportDownload(t)}
                          style={{ fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Download
                        </button>
                        <Link className="btn" href={`/dashboard/custom-reports/${t.id}?organization_id=${t.organization_id}`} style={{ fontSize: "0.85rem" }}>
                          View print report
                        </Link>
                        {canManageAssignments && userRole !== "SUPER_ADMIN" && (
                          <Link className="btn" href={`/dashboard/custom-reports/${t.id}/assign?organization_id=${t.organization_id}`} style={{ fontSize: "0.85rem" }}>
                            Assign users
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>


      {addModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-report-modal-title"
          aria-describedby="add-report-modal-desc"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: "1.5rem",
          }}
          onClick={(e) => e.target === e.currentTarget && setAddModalOpen(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="add-report-modal-title" style={{ margin: "0 0 0.25rem 0", fontSize: "1.25rem", fontWeight: 600 }}>
              Add report template
            </h3>
            <p id="add-report-modal-desc" style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 1.25rem 0" }}>
              Create a new report template. You can assign it to users after saving.
            </p>
            {organizationId == null && (
              <div className="form-group" style={{ marginBottom: "1rem" }}>
                <label htmlFor="add-report-org">Organization *</label>
                <select
                  id="add-report-org"
                  value={addOrgId ?? ""}
                  onChange={(e) => setAddOrgId(e.target.value ? Number(e.target.value) : null)}
                  style={{ width: "100%", padding: "0.5rem 0.6rem" }}
                >
                  <option value="">Select organization</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label htmlFor="add-report-name">Name *</label>
              <input
                id="add-report-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. Annual performance report"
                style={{ width: "100%", padding: "0.5rem 0.6rem" }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: "1.25rem" }}>
              <label htmlFor="add-report-description">Description</label>
              <textarea
                id="add-report-description"
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder="Optional short description"
                rows={3}
                style={{ width: "100%", padding: "0.5rem 0.6rem", resize: "vertical" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setAddModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={addSaving || !addName.trim() || effectiveAddOrgId == null}
                onClick={handleAddReport}
              >
                {addSaving ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameTemplate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-report-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: "1.5rem",
          }}
          onClick={(e) => e.target === e.currentTarget && setRenameTemplate(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rename-report-modal-title" style={{ margin: "0 0 1rem 0", fontSize: "1.25rem" }}>
              Rename report
            </h3>
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label htmlFor="rename-report-name">Name *</label>
              <input
                id="rename-report-name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                style={{ width: "100%", padding: "0.5rem 0.6rem" }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: "1.25rem" }}>
              <label htmlFor="rename-report-description">Description</label>
              <textarea
                id="rename-report-description"
                value={renameDescription}
                onChange={(e) => setRenameDescription(e.target.value)}
                rows={3}
                style={{ width: "100%", padding: "0.5rem 0.6rem", resize: "vertical" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setRenameTemplate(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={renameSaving || !renameName.trim()}
                onClick={handleRenameSave}
              >
                {renameSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Render Download / Generate Modal in Admin View */}
      {renderDownloadModal()}
    </div>
  );
}
