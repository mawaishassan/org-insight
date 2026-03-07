"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface TemplateRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

export default function ReportsPage() {
  const [list, setList] = useState<TemplateRow[]>([]);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<TemplateRow[]>("/reports/templates", { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<{ role: string; organization_id: number | null }>("/auth/me", { token })
      .then((me) => {
        setUserRole(me.role);
        setOrganizationId(me.organization_id ?? null);
      })
      .catch(() => {
        setUserRole(null);
        setOrganizationId(null);
      });
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create report");
    } finally {
      setAddSaving(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Reports</h1>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <p style={{ color: "var(--muted)", margin: 0, flex: "1 1 auto" }}>
          {canManageAssignments
            ? "View and print reports. Use “Assign users” to give others access with view/print/export rights."
            : "Reports assigned to you. Open a report to view, print, or export PDF."}
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
            {canManageAssignments ? "No report templates yet." : "You have no reports assigned. Ask your organization admin to assign reports to you."}
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
    </div>
  );
}
