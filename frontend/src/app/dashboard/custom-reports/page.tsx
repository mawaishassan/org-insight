"use client";

import { useEffect, useState, Fragment } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import { WidgetSpinnerLoader } from "@/components/WidgetSpinnerLoader";

interface CustomReportRow {
  id: number;
  organization_id: number;
  group_id: number | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
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

let cachedCustomReports: Record<string, CustomReportRow[]> = {};

export default function CustomReportsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orgIdParam = searchParams.get("organization_id");

  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(() => {
    return orgIdParam ? Number(orgIdParam) : null;
  });

  const orgKey = selectedOrgId ? String(selectedOrgId) : "all";

  const [list, setList] = useState<CustomReportRow[]>(() => {
    return cachedCustomReports[orgKey] ?? [];
  });
  const [loading, setLoading] = useState(() => {
    return !cachedCustomReports[orgKey];
  });
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [renameTemplate, setRenameTemplate] = useState<CustomReportRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [renameGroupId, setRenameGroupId] = useState<number | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addGroupId, setAddGroupId] = useState<number | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const [groups, setGroups] = useState<CustomReportGroup[]>([]);
  const [manageGroupsOpen, setManageGroupsOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [updatingGroup, setUpdatingGroup] = useState(false);

  const [organizations, setOrganizations] = useState<{ id: number; name: string }[]>([]);

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
    if (userRole !== "SUPER_ADMIN") return;
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
  }, [orgIdParam, userRole]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || userRole !== "SUPER_ADMIN" || selectedOrgId === null) return;

    setLoading(true);
    const query = `?organization_id=${selectedOrgId}`;
    api<CustomReportRow[]>(`/custom-reports${query}`, { token })
      .then((data) => {
        setList(data);
        cachedCustomReports[orgKey] = data;
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load custom reports"))
      .finally(() => setLoading(false));
  }, [selectedOrgId, userRole, orgKey]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || userRole !== "SUPER_ADMIN" || selectedOrgId === null) return;

    api<CustomReportGroup[]>(`/custom-report-groups?organization_id=${selectedOrgId}`, { token })
      .then((data) => setGroups(data))
      .catch(() => setGroups([]));
  }, [selectedOrgId, userRole]);

  const handleCreateGroup = async () => {
    const token = getAccessToken();
    if (!token || selectedOrgId === null || !newGroupName.trim()) return;

    setCreatingGroup(true);
    try {
      const created = await api<CustomReportGroup>(`/custom-report-groups?organization_id=${selectedOrgId}`, {
        method: "POST",
        token,
        body: JSON.stringify({ name: newGroupName.trim() }),
      });
      setGroups((prev) => [...prev, created]);
      setNewGroupName("");
      toast.success("Section created successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create section");
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleUpdateGroup = async (g: CustomReportGroup) => {
    const token = getAccessToken();
    if (!token || selectedOrgId === null || !editingGroupName.trim()) return;

    setUpdatingGroup(true);
    try {
      const updated = await api<CustomReportGroup>(`/custom-report-groups/${g.id}?organization_id=${selectedOrgId}`, {
        method: "PUT",
        token,
        body: JSON.stringify({ name: editingGroupName.trim() }),
      });
      setGroups((prev) => prev.map((x) => (x.id === g.id ? updated : x)));
      setEditingGroupId(null);
      setEditingGroupName("");
      toast.success("Section updated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update section");
    } finally {
      setUpdatingGroup(false);
    }
  };

  const handleDeleteGroup = async (g: CustomReportGroup) => {
    const token = getAccessToken();
    if (!token || selectedOrgId === null) return;

    if (!confirm(`Delete section "${g.name}"? Reports in this section will be moved to uncategorized.`)) return;

    try {
      await api(`/custom-report-groups/${g.id}?organization_id=${selectedOrgId}`, {
        method: "DELETE",
        token,
      });
      setGroups((prev) => prev.filter((x) => x.id !== g.id));
      setList((prev) => prev.map((x) => (x.group_id === g.id ? { ...x, group_id: null } : x)));
      toast.success("Section deleted successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete section");
    }
  };

  const openRenameModal = (t: CustomReportRow) => {
    setRenameTemplate(t);
    setRenameName(t.name);
    setRenameDescription(t.description ?? "");
    setRenameGroupId(t.group_id);
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
        body: JSON.stringify({ name, description: renameDescription.trim() || null, group_id: renameGroupId }),
      });
      setList((prev) => {
        const next = prev.map((x) => (x.id === t.id ? { ...x, name: updated.name, description: updated.description, group_id: updated.group_id } : x));
        const key = t.organization_id ? String(t.organization_id) : "all";
        cachedCustomReports[key] = next;
        return next;
      });
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
      setList((prev) => {
        const next = prev.filter((x) => x.id !== t.id);
        const key = t.organization_id ? String(t.organization_id) : "all";
        cachedCustomReports[key] = next;
        return next;
      });
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
      setList((prev) => {
        const next = [duplicated, ...prev];
        const key = t.organization_id ? String(t.organization_id) : "all";
        cachedCustomReports[key] = next;
        return next;
      });
      toast.success("Template duplicated successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate report");
      toast.error(err instanceof Error ? err.message : "Failed to duplicate report");
    }
  };

  const openAddModal = () => {
    setAddName("");
    setAddDescription("");
    setAddGroupId(null);
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
        body: JSON.stringify({ name: addName.trim(), description: addDescription.trim() || null, group_id: addGroupId }),
      });
      setList((prev) => {
        const next = [created, ...prev];
        const key = selectedOrgId ? String(selectedOrgId) : "all";
        cachedCustomReports[key] = next;
        return next;
      });
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

  // Group reports by group_id
  const groupedReports = (() => {
    const map: Record<string, CustomReportRow[]> = {
      uncategorized: [],
    };
    groups.forEach((g) => {
      map[g.id] = [];
    });
    list.forEach((r) => {
      if (r.group_id && map[r.group_id]) {
        map[r.group_id].push(r);
      } else {
        map.uncategorized.push(r);
      }
    });
    return map;
  })();

  const renderReportRow = (t: CustomReportRow) => (
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
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--text)", margin: 0 }}>Custom Reports Designer</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0 0", fontSize: "0.95rem" }}>
            Design and organize reusable report templates for university tenants.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn"
            onClick={() => setManageGroupsOpen(true)}
            disabled={selectedOrgId == null}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1.2rem", fontWeight: 500 }}
          >
            <span>Manage Sections</span>
          </button>
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
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1.5rem" }}>{error}</p>}

      {loading && list.length === 0 ? (
        <WidgetSpinnerLoader text="Loading templates..." minHeight={200} />
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
              {groups.map((g) => {
                const groupReports = groupedReports[g.id] || [];
                return (
                  <Fragment key={g.id}>
                    <tr style={{ background: "#f1f5f9", borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={2} style={{ padding: "0.75rem 1rem", fontWeight: 700, color: "#1e293b", fontSize: "0.95rem" }}>
                        {g.name}
                      </td>
                    </tr>
                    {groupReports.length === 0 ? (
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <td colSpan={2} style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.9rem", fontStyle: "italic" }}>
                          No reports in this section.
                        </td>
                      </tr>
                    ) : (
                      groupReports.map((t) => renderReportRow(t))
                    )}
                  </Fragment>
                );
              })}
              
              {/* Uncategorized Reports */}
              {(groupedReports.uncategorized.length > 0 || groups.length === 0) && (
                <>
                  <tr style={{ background: "#f1f5f9", borderBottom: "1px solid var(--border)" }}>
                    <td colSpan={2} style={{ padding: "0.75rem 1rem", fontWeight: 700, color: "#1e293b", fontSize: "0.95rem" }}>
                      Uncategorized Reports
                    </td>
                  </tr>
                  {groupedReports.uncategorized.length === 0 ? (
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={2} style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.9rem", fontStyle: "italic" }}>
                        No uncategorized reports.
                      </td>
                    </tr>
                  ) : (
                    groupedReports.uncategorized.map((t) => renderReportRow(t))
                  )}
                </>
              )}
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

            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label htmlFor="add-report-group" style={{ fontWeight: 500 }}>Report Section</label>
              <select
                id="add-report-group"
                value={addGroupId || ""}
                onChange={(e) => setAddGroupId(e.target.value ? Number(e.target.value) : null)}
                style={{ width: "100%", padding: "0.5rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--surface)" }}
              >
                <option value="">Uncategorized</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
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

            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label htmlFor="rename-report-group" style={{ fontWeight: 500 }}>Report Section</label>
              <select
                id="rename-report-group"
                value={renameGroupId || ""}
                onChange={(e) => setRenameGroupId(e.target.value ? Number(e.target.value) : null)}
                style={{ width: "100%", padding: "0.5rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--surface)" }}
              >
                <option value="">Uncategorized</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
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

      {manageGroupsOpen && (
        <div
          role="dialog"
          aria-modal="true"
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
          onClick={(e) => e.target === e.currentTarget && setManageGroupsOpen(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 500, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 40px rgba(0,0,0,0.15)", background: "var(--surface)", padding: "1.5rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.3rem", fontWeight: 600 }}>
              Manage Report Sections
            </h3>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0 0 1.25rem 0" }}>
              Add, rename, or delete categories to organize custom reports for this organization.
            </p>

            <div style={{ flex: 1, overflowY: "auto", marginBottom: "1.25rem", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.5rem" }}>
              {groups.length === 0 ? (
                <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.5rem 0", margin: 0, fontSize: "0.9rem" }}>
                  No sections created yet.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {groups.map((g) => (
                    <div key={g.id} style={{ display: "flex", alignItems: "center", justifyItems: "center", gap: "0.5rem", padding: "0.5rem", borderBottom: "1px solid #f1f5f9" }}>
                      {editingGroupId === g.id ? (
                        <>
                          <input
                            value={editingGroupName}
                            onChange={(e) => setEditingGroupName(e.target.value)}
                            style={{ flex: 1, padding: "0.3rem 0.5rem", fontSize: "0.9rem" }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={updatingGroup || !editingGroupName.trim()}
                            onClick={() => handleUpdateGroup(g)}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setEditingGroupId(null)}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontWeight: 500, color: "var(--text)", fontSize: "0.95rem" }}>{g.name}</span>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setEditingGroupId(g.id);
                              setEditingGroupName(g.name);
                            }}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => handleDeleteGroup(g)}
                            style={{ padding: "0.3rem 0.6rem", fontSize: "0.8rem", color: "var(--error)" }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="New section name (e.g. Finance)"
                style={{ flex: 1, padding: "0.5rem 0.6rem" }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingGroup || !newGroupName.trim()}
                onClick={handleCreateGroup}
              >
                {creatingGroup ? "Adding..." : "Add"}
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setManageGroupsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
