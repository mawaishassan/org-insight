"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import {
  buildReportPrintDocument,
  openReportPrintWindow,
  type ReportData,
} from "@/app/dashboard/reports/reportPrint";

interface TemplateRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  year: number;
}

interface AssignmentRow {
  user_id: number;
  email: string | null;
  full_name: string | null;
  can_view: boolean;
  can_print: boolean;
  can_export: boolean;
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

/** Same document structure as design live preview so report view matches exactly */
const REPORT_IFRAME_STYLE = `
body { font-family: inherit; margin: 1rem; color: #111; line-height: 1.5; }
table { border-collapse: collapse; width: 100%; border: 1px solid #333; }
td, th { border: 1px solid #333; padding: 6px; }
.report-card { border: 1px solid #ddd; padding: 1rem; border-radius: 8px; }
`;

export default function ReportViewPage() {
  const params = useParams();
  const id = Number(params.id);
  const reportContentRef = useRef<HTMLDivElement>(null);
  const reportIframeRef = useRef<HTMLIFrameElement>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [userRole, setUserRole] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [orgUsers, setOrgUsers] = useState<UserRow[]>([]);
  const [assignUserId, setAssignUserId] = useState<number | "">("");
  const [assignCanView, setAssignCanView] = useState(true);
  const [assignCanPrint, setAssignCanPrint] = useState(true);
  const [assignCanExport, setAssignCanExport] = useState(true);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  useEffect(() => {
    if (!id) return;
    const token = getAccessToken();
    if (!token) return;
    const url = `/reports/templates/${id}/generate?format=json&_t=${Date.now()}`;
    api<ReportData>(url, { token, cache: "no-store" })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [id]);

  const canManageAssignments = userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN";
  const orgId = template?.organization_id;

  useEffect(() => {
    if (!id || !data || !canManageAssignments) return;
    const token = getAccessToken();
    if (!token) return;
    api<TemplateRow>(`/reports/templates/${id}`, { token })
      .then(setTemplate)
      .catch(() => setTemplate(null));
  }, [id, data, canManageAssignments]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<{ role: string; organization_id: number | null }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, []);

  useEffect(() => {
    if (!id || !canManageAssignments) return;
    const token = getAccessToken();
    if (!token) return;
    setLoadingAssignments(true);
    api<AssignmentRow[]>(`/reports/templates/${id}/users`, { token })
      .then(setAssignments)
      .catch(() => setAssignments([]))
      .finally(() => setLoadingAssignments(false));
  }, [id, canManageAssignments]);

  useEffect(() => {
    if (!canManageAssignments) return;
    const token = getAccessToken();
    if (!token) return;
    const query = orgId != null ? qs({ organization_id: orgId }) : "";
    api<UserRow[]>(`/users${query ? `?${query}` : ""}`, { token })
      .then(setOrgUsers)
      .catch(() => setOrgUsers([]));
  }, [canManageAssignments, orgId]);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return null;

  const handlePrint = () => openReportPrintWindow(buildReportPrintDocument(data), true);

  const refreshReport = () => {
    const token = getAccessToken();
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    const url = `/reports/templates/${id}/generate?format=json&_t=${Date.now()}`;
    api<ReportData>(url, { token, cache: "no-store" })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  function handleExportPdf() {
    if (!data) return;
    setExportingPdf(true);
    openReportPrintWindow(buildReportPrintDocument(data), true);
    setExportingPdf(false);
  }

  async function handleExportCsv() {
    const token = getAccessToken();
    if (!token) return;
    const base = typeof window !== "undefined" && window.location.origin ? "" : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const url = base ? `${base}/api/reports/templates/${id}/generate?format=csv&_t=${Date.now()}` : `/api/reports/templates/${id}/generate?format=csv&_t=${Date.now()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report_${id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onAssign() {
    if (assignUserId === "" || !id) return;
    const token = getAccessToken();
    if (!token) return;
    setAssignError(null);
    setAssignLoading(true);
    try {
      const query = orgId != null ? qs({ organization_id: orgId }) : "";
      await api(`/reports/templates/${id}/assign${query ? `?${query}` : ""}`, {
        method: "POST",
        body: JSON.stringify({
          user_id: assignUserId,
          can_view: assignCanView,
          can_print: assignCanPrint,
          can_export: assignCanExport,
        }),
        token,
      });
      setAssignUserId("");
      setAssignCanView(true);
      setAssignCanPrint(true);
      setAssignCanExport(true);
      const next = await api<AssignmentRow[]>(`/reports/templates/${id}/users`, { token });
      setAssignments(next);
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setAssignLoading(false);
    }
  }

  async function onUnassign(userId: number) {
    if (!id) return;
    const token = getAccessToken();
    if (!token) return;
    try {
      const query = orgId != null ? qs({ organization_id: orgId }) : "";
      await api(`/reports/templates/${id}/users/${userId}${query ? `?${query}` : ""}`, { method: "DELETE", token });
      setAssignments((prev) => prev.filter((a) => a.user_id !== userId));
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "0.5rem" }}>
        <Link href="/dashboard/reports" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {"\u2190"} Back to reports
        </Link>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>{data.template_name}</h1>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={refreshReport} title="Load latest report (e.g. after editing in Design)">
            Refresh
          </button>
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
          <iframe
            ref={reportIframeRef}
            title="Report content"
            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${REPORT_IFRAME_STYLE}</style></head><body>${data.rendered_html}</body></html>`}
            style={{ width: "100%", minHeight: "80vh", border: "none", display: "block" }}
            className="report-view-iframe"
          />
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

      {canManageAssignments && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Assign to users</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            Users assigned to this report can view, print, and export it. Only users in the same organization can be assigned.
          </p>
          {loadingAssignments ? (
            <p style={{ color: "var(--muted)" }}>Loading assignments…</p>
          ) : (
            <>
              {assignments.length === 0 ? (
                <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>No users assigned yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
                  {assignments.map((a) => (
                    <li key={a.user_id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                      <div>
                        <strong>{a.full_name || a.email || `User #${a.user_id}`}</strong>
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem", marginLeft: "0.5rem" }}>
                          View {a.can_view ? "✓" : "—"} · Print {a.can_print ? "✓" : "—"} · Export {a.can_export ? "✓" : "—"}
                        </span>
                      </div>
                      <button type="button" className="btn" onClick={() => onUnassign(a.user_id)} style={{ color: "var(--error)" }}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Add user</label>
                  <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value === "" ? "" : Number(e.target.value))} style={{ minWidth: "200px" }}>
                    <option value="">— Select user —</option>
                    {orgUsers.filter((u) => !assignments.some((a) => a.user_id === u.id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name || u.email || u.username}</option>
                    ))}
                  </select>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={assignCanView} onChange={(e) => setAssignCanView(e.target.checked)} />
                  View
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={assignCanPrint} onChange={(e) => setAssignCanPrint(e.target.checked)} />
                  Print
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                  <input type="checkbox" checked={assignCanExport} onChange={(e) => setAssignCanExport(e.target.checked)} />
                  Export
                </label>
                <button type="button" className="btn btn-primary" onClick={onAssign} disabled={assignLoading || assignUserId === ""}>
                  {assignLoading ? "Adding…" : "Assign"}
                </button>
                {assignError && <p className="form-error" style={{ margin: 0 }}>{assignError}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
