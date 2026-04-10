"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface DashboardRow {
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

export default function DashboardsPage() {
  const [list, setList] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<number | null>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [organizations, setOrganizations] = useState<{ id: number; name: string }[]>([]);
  const [addOrgId, setAddOrgId] = useState<number | null>(null);

  const [renameDashboard, setRenameDashboard] = useState<DashboardRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const canManageAssignments = userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN";
  const canAddDashboard = userRole === "SUPER_ADMIN";

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

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<DashboardRow[]>("/dashboards", { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

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
  }, [addModalOpen, userRole, organizationId, addOrgId]);

  const effectiveAddOrgId = organizationId ?? addOrgId;

  const openAddModal = () => {
    setAddName("");
    setAddDescription("");
    setAddOrgId(organizationId ?? null);
    setError(null);
    setAddModalOpen(true);
  };

  const openRenameModal = (d: DashboardRow) => {
    setRenameDashboard(d);
    setRenameName(d.name);
    setRenameDescription(d.description ?? "");
    setError(null);
  };

  const handleAddDashboard = async () => {
    const token = getAccessToken();
    if (!token || !addName.trim() || effectiveAddOrgId == null) return;
    setAddSaving(true);
    setError(null);
    try {
      const created = await api<DashboardRow>(`/dashboards?${qs({ organization_id: effectiveAddOrgId })}`, {
        method: "POST",
        token,
        body: JSON.stringify({ name: addName.trim(), description: addDescription.trim() || null, layout: { widgets: [] } }),
      });
      setList((prev) => [created, ...prev]);
      setAddModalOpen(false);
      toast.success("Dashboard created");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create dashboard";
      setError(msg);
      toast.error(msg);
    } finally {
      setAddSaving(false);
    }
  };

  const handleRenameSave = async () => {
    const d = renameDashboard;
    const token = getAccessToken();
    if (!d || !token || userRole !== "SUPER_ADMIN") return;
    const name = renameName.trim();
    if (!name) return;
    setRenameSaving(true);
    setError(null);
    try {
      const updated = await api<DashboardRow>(`/dashboards/${d.id}?${qs({ organization_id: d.organization_id })}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ name, description: renameDescription.trim() || null }),
      });
      setList((prev) => prev.map((x) => (x.id === d.id ? { ...x, name: updated.name, description: updated.description } : x)));
      setRenameDashboard(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update dashboard");
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async (d: DashboardRow) => {
    const token = getAccessToken();
    if (!token || userRole !== "SUPER_ADMIN") return;
    if (!confirm(`Delete dashboard "${d.name}"? This cannot be undone.`)) return;
    setDeletingId(d.id);
    setError(null);
    try {
      await api(`/dashboards/${d.id}?${qs({ organization_id: d.organization_id })}`, { method: "DELETE", token });
      setList((prev) => prev.filter((x) => x.id !== d.id));
      toast.success("Dashboard deleted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete dashboard";
      setError(msg);
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Dashboards</h1>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <p style={{ color: "var(--muted)", margin: 0, flex: "1 1 auto" }}>
            {canManageAssignments
              ? "Create dashboards (Super Admin) and share view/edit access with users in an organization."
              : "Dashboards shared with you. Open a dashboard to view its widgets."}
          </p>
          {canAddDashboard && (
            <button type="button" className="btn btn-primary" onClick={openAddModal}>
              + Add dashboard
            </button>
          )}
        </div>

        {list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            {canManageAssignments ? "No dashboards yet." : "No dashboards assigned to you. Ask your admin to share one."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {list.map((d) => (
              <li key={d.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <Link href={`/dashboard/dashboards/${d.id}?organization_id=${d.organization_id}`} style={{ fontWeight: 500, flex: "1 1 auto" }}>
                  {d.name}
                </Link>
                <Link className="btn btn-primary" href={`/dashboard/dashboards/${d.id}?organization_id=${d.organization_id}`} style={{ fontSize: "0.85rem" }}>
                  Open
                </Link>
                {canManageAssignments && (
                  <Link className="btn" href={`/dashboard/dashboards/${d.id}/assign?organization_id=${d.organization_id}`} style={{ fontSize: "0.85rem" }}>
                    Assign users
                  </Link>
                )}
                {userRole === "SUPER_ADMIN" && (
                  <Link className="btn" href={`/dashboard/dashboards/${d.id}/design?organization_id=${d.organization_id}`} style={{ fontSize: "0.85rem" }}>
                    Design
                  </Link>
                )}
                {userRole === "SUPER_ADMIN" && (
                  <button type="button" className="btn" onClick={() => openRenameModal(d)} style={{ fontSize: "0.85rem" }}>
                    Rename
                  </button>
                )}
                {userRole === "SUPER_ADMIN" && (
                  <button type="button" className="btn btn-danger" onClick={() => handleDelete(d)} disabled={deletingId === d.id} style={{ fontSize: "0.85rem" }}>
                    {deletingId === d.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {addModalOpen && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 520 }}>
            <h2 style={{ marginTop: 0 }}>Add dashboard</h2>
            {organizationId == null && userRole === "SUPER_ADMIN" && (
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.35rem" }}>Organization</label>
                <select value={effectiveAddOrgId ?? ""} onChange={(e) => setAddOrgId(Number(e.target.value))} style={{ width: "100%", padding: "0.5rem" }}>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.35rem" }}>Name</label>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.35rem" }}>Description</label>
              <textarea value={addDescription} onChange={(e) => setAddDescription(e.target.value)} style={{ width: "100%", padding: "0.5rem", minHeight: 90 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button type="button" className="btn" onClick={() => setAddModalOpen(false)} disabled={addSaving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleAddDashboard} disabled={addSaving || !addName.trim()}>
                {addSaving ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameDashboard && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 520 }}>
            <h2 style={{ marginTop: 0 }}>Rename dashboard</h2>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.35rem" }}>Name</label>
              <input value={renameName} onChange={(e) => setRenameName(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.35rem" }}>Description</label>
              <textarea value={renameDescription} onChange={(e) => setRenameDescription(e.target.value)} style={{ width: "100%", padding: "0.5rem", minHeight: 90 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button type="button" className="btn" onClick={() => setRenameDashboard(null)} disabled={renameSaving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleRenameSave} disabled={renameSaving || !renameName.trim()}>
                {renameSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

