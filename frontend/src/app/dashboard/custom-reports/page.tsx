"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface CustomReportRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

export default function CustomReportsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orgIdParam = searchParams.get("organization_id");

  const [list, setList] = useState<CustomReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [renameTemplate, setRenameTemplate] = useState<CustomReportRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const [organizations, setOrganizations] = useState<{ id: number; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.push("/login");
      return;
    }

    api<{ role: string; organization_id: number | null }>("/auth/me", { token })
      .then((me) => {
        setUserRole(me.role);
        setUserOrgId(me.organization_id);
        if (me.role !== "SUPER_ADMIN") {
          toast.error("Access denied: Custom Report Designer is only for Super Admins");
          router.push("/dashboard/reports");
        }
      })
      .catch(() => {
        router.push("/login");
      });
  }, [router]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    // Load organizations for Super Admin organization picker
    api<{ id: number; name: string }[]>(`/organizations?with_summary=false`, { token })
      .then((list) => {
        setOrganizations(list);
        if (orgIdParam) {
          setSelectedOrgId(Number(orgIdParam));
        } else if (list.length > 0) {
          setSelectedOrgId(list[0].id);
        }
      })
      .catch(() => setOrganizations([]));
  }, [orgIdParam]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || userRole !== "SUPER_ADMIN") return;

    setLoading(true);
    const query = selectedOrgId ? `?organization_id=${selectedOrgId}` : "";
    api<CustomReportRow[]>(`/custom-reports${query}`, { token })
      .then((data) => {
        setList(data);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load custom reports"))
      .finally(() => setLoading(false));
  }, [selectedOrgId, userRole]);

  const openRenameModal = (t: CustomReportRow) => {
    setRenameTemplate(t);
    setRenameName(t.name);
    setRenameDescription(t.description ?? "");
    setError(null);
  };

  const handleRenameSave = async () => {
    const t = renameTemplate;
    const token = getAccessToken();
    if (!t || !token) return;

    const name = renameName.trim();
    if (!name) return;

    setRenameSaving(true);
    setError(null);
    try {
      const query = qs({ organization_id: t.organization_id });
      const updated = await api<CustomReportRow>(`/custom-reports/${t.id}?${query}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ name, description: renameDescription.trim() || null }),
      });
      setList((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, name: updated.name, description: updated.description } : x))
      );
      setRenameTemplate(null);
      toast.success("Report template updated successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update report");
      toast.error(err instanceof Error ? err.message : "Failed to update report");
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async (t: CustomReportRow) => {
    const token = getAccessToken();
    if (!token) return;

    if (!confirm(`Delete custom report template "${t.name}"? This will delete all custom layouts and assignments.`)) return;

    setError(null);
    setDeletingId(t.id);
    try {
      const query = qs({ organization_id: t.organization_id });
      await api(`/custom-reports/${t.id}?${query}`, {
        method: "DELETE",
        token,
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

  const handleDuplicate = async (t: CustomReportRow) => {
    const token = getAccessToken();
    if (!token) return;

    setError(null);
    try {
      const query = qs({ organization_id: t.organization_id });
      const duplicated = await api<CustomReportRow>(`/custom-reports/${t.id}/duplicate?${query}`, {
        method: "POST",
        token,
      });
      setList((prev) => [duplicated, ...prev]);
      toast.success("Template duplicated successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate report");
      toast.error(err instanceof Error ? err.message : "Failed to duplicate report");
    }
  };

  const openAddModal = () => {
    setAddName("");
    setAddDescription("");
    setError(null);
    setAddModalOpen(true);
  };

  const handleAddReport = async () => {
    const token = getAccessToken();
    if (!token || selectedOrgId == null || !addName.trim()) return;

    setAddSaving(true);
    setError(null);
    try {
      const query = qs({ organization_id: selectedOrgId });
      const created = await api<CustomReportRow>(`/custom-reports?${query}`, {
        method: "POST",
        token,
        body: JSON.stringify({ name: addName.trim(), description: addDescription.trim() || null }),
      });
      setList((prev) => [created, ...prev]);
      setAddModalOpen(false);
      toast.success("Custom report template created successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create custom report");
      toast.error(err instanceof Error ? err.message : "Failed to create custom report");
    } finally {
      setAddSaving(false);
    }
  };

  if (userRole !== "SUPER_ADMIN") return <p style={{ padding: "1.5rem" }}>Loading authorization...</p>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--text)", margin: 0 }}>Custom Reports Designer</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0 0", fontSize: "0.95rem" }}>
            Design and organize reusable report templates for university tenants.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openAddModal}
          disabled={selectedOrgId == null}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.2rem", fontWeight: 500 }}
        >
          <span>+ Create Template</span>
        </button>
      </div>

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1.5rem", padding: "1rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <label htmlFor="org-select" style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text)" }}>Select Organization:</label>
        <select
          id="org-select"
          value={selectedOrgId ?? ""}
          onChange={(e) => {
            const val = e.target.value ? Number(e.target.value) : null;
            setSelectedOrgId(val);
            router.replace(`/dashboard/custom-reports?organization_id=${val || ""}`);
          }}
          style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem", minWidth: 260 }}
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1.5rem" }}>{error}</p>}

      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading templates...</p>
      ) : list.length === 0 ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", background: "var(--surface)" }}>
          <p style={{ color: "var(--muted)", margin: 0 }}>No custom report templates designed for this organization yet.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden", background: "var(--surface)", border: "1px solid var(--border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "1rem", fontSize: "0.85rem", textTransform: "uppercase", color: "var(--muted)" }}>Template Details</th>
                <th style={{ textAlign: "right", padding: "1rem", fontSize: "0.85rem", textTransform: "uppercase", color: "var(--muted)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "1rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "1.05rem", color: "var(--text)" }}>{t.name}</div>
                    {t.description && <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.2rem" }}>{t.description}</div>}
                  </td>
                  <td style={{ padding: "1rem", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <Link
                        className="btn btn-primary"
                        href={`/dashboard/custom-reports/${t.id}/design?organization_id=${t.organization_id}`}
                        style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                      >
                        Design Layout
                      </Link>
                      <Link
                        className="btn"
                        href={`/dashboard/custom-reports/${t.id}/assign?organization_id=${t.organization_id}`}
                        style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                      >
                        Assign Users
                      </Link>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleDuplicate(t)}
                        style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => openRenameModal(t)}
                        style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={deletingId === t.id}
                        onClick={() => handleDelete(t)}
                        style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem", color: "var(--error)" }}
                      >
                        {deletingId === t.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-report-modal-title"
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
            style={{ maxWidth: 460, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.15)", background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="add-report-modal-title" style={{ margin: "0 0 0.5rem 0", fontSize: "1.3rem", fontWeight: 600 }}>
              Create Custom Report Template
            </h3>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1.25rem 0" }}>
              Initialize a custom layout structure for the selected organization.
            </p>

            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label style={{ fontWeight: 500 }}>Target Organization</label>
              <input
                disabled
                value={organizations.find((o) => o.id === selectedOrgId)?.name || ""}
                style={{ width: "100%", padding: "0.5rem 0.6rem", background: "#f1f5f9", cursor: "not-allowed" }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label htmlFor="add-report-name" style={{ fontWeight: 500 }}>Template Name *</label>
              <input
                id="add-report-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. Annual Academic & Research Report"
                style={{ width: "100%", padding: "0.5rem 0.6rem" }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: "1.25rem" }}>
              <label htmlFor="add-report-description" style={{ fontWeight: 500 }}>Description</label>
              <textarea
                id="add-report-description"
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder="Brief summary of the report layout purpose"
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
                disabled={addSaving || !addName.trim() || selectedOrgId == null}
                onClick={handleAddReport}
              >
                {addSaving ? "Creating..." : "Create"}
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
            style={{ maxWidth: 460, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.15)", background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rename-report-modal-title" style={{ margin: "0 0 1rem 0", fontSize: "1.3rem", fontWeight: 600 }}>
              Edit Custom Report Details
            </h3>

            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label htmlFor="rename-report-name" style={{ fontWeight: 500 }}>Template Name *</label>
              <input
                id="rename-report-name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                style={{ width: "100%", padding: "0.5rem 0.6rem" }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: "1.25rem" }}>
              <label htmlFor="rename-report-description" style={{ fontWeight: 500 }}>Description</label>
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
                {renameSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
