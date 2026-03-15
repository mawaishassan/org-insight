"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

function qs(params: Record<string, string | number | undefined>) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();
}

interface UserRef {
  id: number;
  username: string;
  full_name: string | null;
}

interface KpiRow {
  id: number;
  name: string;
  organization_id: number;
  entry_mode?: string;
}

interface FieldDef {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields?: { id: number; key: string; name: string }[];
}

interface FieldAccessItem {
  field_id: number;
  sub_field_id: number | null;
  access_type: string;
}

interface RowAccessItem {
  row_index: number;
  can_edit: boolean;
  can_delete: boolean;
}

interface RowAccessUser {
  user_id: number;
  full_name: string | null;
  username: string;
  can_edit: boolean;
  can_delete: boolean;
}

interface RowWithAccess {
  row_index: number;
  preview: string;
  users: RowAccessUser[];
}

interface OrgInfo {
  id: number;
  name: string;
}

interface OrgRole {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const EMPTY_FIELD_ACCESS: FieldAccessItem[] = [];

export default function AccessControlPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgId = Number(params.id);
  const token = getAccessToken();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const kpiIdFromUrl = searchParams.get("kpi_id");
  const [selectedKpiId, setSelectedKpiId] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<{ id: number; username: string; full_name: string | null; permission: string }[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [fieldAccessByUser, setFieldAccessByUser] = useState<Record<number, FieldAccessItem[]>>({});
  const [rowAccessModal, setRowAccessModal] = useState<{
    userId: number;
    userName: string;
    fieldId: number;
    fieldName: string;
    entryId: number;
    rowCount: number;
  } | null>(null);
  const [entries, setEntries] = useState<{ id: number; year: number; period_key: string }[]>([]);
  const [rowAccessList, setRowAccessList] = useState<RowAccessItem[]>([]);
  const [rowAccessSaving, setRowAccessSaving] = useState(false);
  const [firstNRowsValue, setFirstNRowsValue] = useState<string>("");
  // Row/Record-level section: field + entry selection and record count
  const [selectedRowFieldId, setSelectedRowFieldId] = useState<number | null>(null);
  const [selectedRowEntryId, setSelectedRowEntryId] = useState<number | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [rowsWithAccess, setRowsWithAccess] = useState<RowWithAccess[]>([]);
  const [rowsWithAccessLoading, setRowsWithAccessLoading] = useState(false);
  const [addUserToRowModal, setAddUserToRowModal] = useState<{ rowIndex: number; preview: string } | null>(null);
  const [addUserToRowUserId, setAddUserToRowUserId] = useState<number | null>(null);
  const [addUserToRowAccess, setAddUserToRowAccess] = useState<"edit" | "edit_delete">("edit_delete");
  const [addUserToRowSaving, setAddUserToRowSaving] = useState(false);
  // Organization roles
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [roleCreateModal, setRoleCreateModal] = useState(false);
  const [roleEditModal, setRoleEditModal] = useState<OrgRole | null>(null);
  const [roleUsersModal, setRoleUsersModal] = useState<OrgRole | null>(null);
  const [roleUsers, setRoleUsers] = useState<{ id: number; username: string; full_name: string | null }[]>([]);
  const [roleUsersSaving, setRoleUsersSaving] = useState(false);
  const [roleFormName, setRoleFormName] = useState("");
  const [roleFormDescription, setRoleFormDescription] = useState("");
  const [roleFormSaving, setRoleFormSaving] = useState(false);
  // Column access by role (for selected KPI)
  const [fieldAccessByRole, setFieldAccessByRole] = useState<Record<number, FieldAccessItem[]>>({});
  const [columnByRoleFieldId, setColumnByRoleFieldId] = useState<number | null>(null);
  const [columnByRoleLoading, setColumnByRoleLoading] = useState(false);
  const [columnByRoleSavingRoleId, setColumnByRoleSavingRoleId] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !orgId || isNaN(orgId)) return;
    Promise.all([
      api<OrgInfo>(`/organizations/${orgId}`, { token }).catch(() => null),
      api<KpiRow[]>(`/kpis?${qs({ organization_id: orgId })}`, { token }).catch(() => []),
      api<UserRef[]>(`/users?${qs({ organization_id: orgId })}`, { token }).catch(() => []),
      api<OrgRole[]>(`/organizations/${orgId}/roles`, { token }).catch(() => []),
    ]).then(([o, k, u, r]) => {
      setOrg(o ?? null);
      setKpis(Array.isArray(k) ? k : []);
      setUsers(Array.isArray(u) ? u : []);
      setRoles(Array.isArray(r) ? r : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token, orgId]);

  // Load users in role when "Users in role" modal opens
  useEffect(() => {
    if (!token || !orgId || !roleUsersModal) return;
    api<{ id: number; username: string; full_name: string | null }[]>(
      `/organizations/${orgId}/roles/${roleUsersModal.id}/users`,
      { token }
    )
      .then((list) => setRoleUsers(Array.isArray(list) ? list : []))
      .catch(() => setRoleUsers([]));
  }, [token, orgId, roleUsersModal]);

  // Preselect KPI when opening from entry page link (e.g. Full access control → ?kpi_id=...)
  useEffect(() => {
    const n = kpiIdFromUrl ? Number(kpiIdFromUrl) : NaN;
    if (Number.isFinite(n)) setSelectedKpiId(n);
  }, [kpiIdFromUrl]);

  useEffect(() => {
    if (!token || !orgId || !selectedKpiId) {
      setAssignments([]);
      setFields([]);
      return;
    }
    setError(null);
    Promise.all([
      api<{ id: number; username: string; full_name: string | null; permission?: string }[]>(
        `/kpis/${selectedKpiId}/assignments?${qs({ organization_id: orgId })}`,
        { token }
      ).catch(() => []),
      api<FieldDef[]>(`/fields?${qs({ kpi_id: selectedKpiId, organization_id: orgId })}`, { token }).catch(() => []),
    ]).then(([a, f]) => {
      setAssignments((a || []).map((x) => ({ ...x, permission: x.permission || "data_entry" })));
      setFields(Array.isArray(f) ? f : []);
    }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [token, orgId, selectedKpiId]);

  const loadFieldAccess = (userId: number) => {
    if (!token || !selectedKpiId || !orgId) return;
    api<FieldAccessItem[]>(
      `/kpis/${selectedKpiId}/field-access?${qs({ user_id: userId, organization_id: orgId })}`,
      { token }
    )
      .then((list) => setFieldAccessByUser((prev) => ({ ...prev, [userId]: list || [] })))
      .catch(() => setFieldAccessByUser((prev) => ({ ...prev, [userId]: [] })));
  };

  const handleReplaceFieldAccess = async (userId: number, accesses: FieldAccessItem[]) => {
    if (!token || !selectedKpiId || !orgId) return;
    setSaving(true);
    try {
      await api(`/kpis/${selectedKpiId}/field-access?${qs({ organization_id: orgId })}`, {
        method: "PUT",
        body: JSON.stringify({ user_id: userId, accesses }),
        token,
      });
      setFieldAccessByUser((prev) => ({ ...prev, [userId]: accesses }));
      toast.success("Field-level access saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const multiLineFields = fields.filter((f) => f.field_type === "multi_line_items");

  // Load field access by role when "Column access by role" is expanded for a field
  useEffect(() => {
    if (!token || !selectedKpiId || !orgId || columnByRoleFieldId == null || roles.length === 0) {
      if (columnByRoleFieldId == null) setFieldAccessByRole({});
      return;
    }
    setColumnByRoleLoading(true);
    Promise.all(
      roles.map((role) =>
        api<FieldAccessItem[]>(
          `/kpis/${selectedKpiId}/field-access-by-role?${qs({ role_id: role.id, organization_id: orgId })}`,
          { token }
        ).then((list) => ({ roleId: role.id, list: list ?? [] }))
      )
    )
      .then((results) => {
        const byRole: Record<number, FieldAccessItem[]> = {};
        results.forEach(({ roleId, list }) => { byRole[roleId] = list; });
        setFieldAccessByRole(byRole);
      })
      .catch(() => setFieldAccessByRole({}))
      .finally(() => setColumnByRoleLoading(false));
  }, [token, selectedKpiId, orgId, columnByRoleFieldId, roles]);

  // Load entries for this KPI (for row-level entry dropdown and field panel)
  useEffect(() => {
    if (!token || !selectedKpiId || !orgId) {
      setEntries([]);
      return;
    }
    api<{ id: number; year: number; period_key?: string }[]>(
      `/entries?${qs({ kpi_id: selectedKpiId, organization_id: orgId, year: new Date().getFullYear() })}`,
      { token }
    )
      .then((list) => setEntries(Array.isArray(list) ? list : []))
      .catch(() => setEntries([]));
  }, [token, selectedKpiId, orgId]);

  // Load actual rows with access (row-centric) when field + entry selected
  useEffect(() => {
    if (!token || !selectedKpiId || !selectedRowFieldId || !selectedRowEntryId || !orgId) {
      setRowsWithAccess([]);
      setRowCount(null);
      return;
    }
    setRowsWithAccessLoading(true);
    api<RowWithAccess[]>(
      `/kpis/${selectedKpiId}/row-access-by-entry?${qs({
        entry_id: selectedRowEntryId,
        field_id: selectedRowFieldId,
        organization_id: orgId,
      })}`,
      { token }
    )
      .then((data) => {
        setRowsWithAccess(Array.isArray(data) ? data : []);
        setRowCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => {
        setRowsWithAccess([]);
        setRowCount(null);
      })
      .finally(() => setRowsWithAccessLoading(false));
  }, [token, selectedKpiId, selectedRowFieldId, selectedRowEntryId, orgId]);

  const openRowAccessModal = (userId: number, userName: string, fieldId: number, fieldName: string, entryId: number, count: number) => {
    setRowAccessModal({ userId, userName, fieldId, fieldName, entryId, rowCount: count });
    if (!token || !selectedKpiId || !orgId) return;
    setFirstNRowsValue(String(count));
    api<RowAccessItem[]>(
      `/kpis/${selectedKpiId}/row-access?${qs({ user_id: userId, entry_id: entryId, field_id: fieldId, organization_id: orgId })}`,
      { token }
    )
      .then((existing) => {
        const byIndex = new Map(existing.map((r) => [r.row_index, r]));
        const list: RowAccessItem[] = [];
        for (let i = 0; i < count; i++) {
          const r = byIndex.get(i);
          list.push(r ? { row_index: i, can_edit: r.can_edit, can_delete: r.can_delete } : { row_index: i, can_edit: false, can_delete: false });
        }
        setRowAccessList(list);
      })
      .catch(() => {
        setRowAccessList(Array.from({ length: count }, (_, i) => ({ row_index: i, can_edit: false, can_delete: false })));
      });
  };

  const saveRowAccess = async () => {
    if (!rowAccessModal || !token || !selectedKpiId || !orgId) return;
    setRowAccessSaving(true);
    try {
      const rowsToSend = rowAccessList.filter((r) => r.can_edit || r.can_delete).map((r) => ({ row_index: r.row_index, can_edit: r.can_edit, can_delete: r.can_delete }));
      await api(`/kpis/${selectedKpiId}/row-access?${qs({ organization_id: orgId })}`, {
        method: "PUT",
        body: JSON.stringify({
          user_id: rowAccessModal.userId,
          entry_id: rowAccessModal.entryId,
          field_id: rowAccessModal.fieldId,
          rows: rowsToSend,
        }),
        token,
      });
      toast.success("Record-level access saved");
      setRowAccessModal(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setRowAccessSaving(false);
    }
  };

  const getRowCount = (entryId: number, fieldId: number): Promise<number> => {
    if (!token || !orgId) return Promise.resolve(0);
    return api<{ total: number }>(
      `/entries/multi-items/rows?${qs({ entry_id: entryId, field_id: fieldId, organization_id: orgId, page: 1, page_size: 1 })}`,
      { token }
    ).then((res) => res?.total ?? 0);
  };

  const refetchRowsWithAccess = () => {
    if (!token || !selectedKpiId || !selectedRowFieldId || !selectedRowEntryId || !orgId) return;
    api<RowWithAccess[]>(
      `/kpis/${selectedKpiId}/row-access-by-entry?${qs({
        entry_id: selectedRowEntryId,
        field_id: selectedRowFieldId,
        organization_id: orgId,
      })}`,
      { token }
    )
      .then((data) => {
        setRowsWithAccess(Array.isArray(data) ? data : []);
        setRowCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => {});
  };

  const removeUserFromRow = async (rowIndex: number, userId: number) => {
    if (!token || !selectedKpiId || !selectedRowEntryId || !selectedRowFieldId || !orgId) return;
    try {
      const existing = await api<RowAccessItem[]>(
        `/kpis/${selectedKpiId}/row-access?${qs({ user_id: userId, entry_id: selectedRowEntryId, field_id: selectedRowFieldId, organization_id: orgId })}`,
        { token }
      );
      const rowsToSend = existing
        .filter((r) => r.row_index !== rowIndex)
        .map((r) => ({ row_index: r.row_index, can_edit: r.can_edit, can_delete: r.can_delete }));
      await api(`/kpis/${selectedKpiId}/row-access?${qs({ organization_id: orgId })}`, {
        method: "PUT",
        body: JSON.stringify({ user_id: userId, entry_id: selectedRowEntryId, field_id: selectedRowFieldId, rows: rowsToSend }),
        token,
      });
      toast.success("User removed from row");
      refetchRowsWithAccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  };

  const saveAddUserToRow = async () => {
    if (!addUserToRowModal || addUserToRowUserId == null || !token || !selectedKpiId || !selectedRowEntryId || !selectedRowFieldId || !orgId) return;
    setAddUserToRowSaving(true);
    try {
      const existing = await api<RowAccessItem[]>(
        `/kpis/${selectedKpiId}/row-access?${qs({ user_id: addUserToRowUserId, entry_id: selectedRowEntryId, field_id: selectedRowFieldId, organization_id: orgId })}`,
        { token }
      );
      const can_edit = true;
      const can_delete = addUserToRowAccess === "edit_delete";
      const merged = existing.filter((r) => r.row_index !== addUserToRowModal.rowIndex);
      merged.push({ row_index: addUserToRowModal.rowIndex, can_edit, can_delete });
      merged.sort((a, b) => a.row_index - b.row_index);
      await api(`/kpis/${selectedKpiId}/row-access?${qs({ organization_id: orgId })}`, {
        method: "PUT",
        body: JSON.stringify({
          user_id: addUserToRowUserId,
          entry_id: selectedRowEntryId,
          field_id: selectedRowFieldId,
          rows: merged.map((r) => ({ row_index: r.row_index, can_edit: r.can_edit, can_delete: r.can_delete })),
        }),
        token,
      });
      toast.success("User access added to row");
      setAddUserToRowModal(null);
      setAddUserToRowUserId(null);
      refetchRowsWithAccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setAddUserToRowSaving(false);
    }
  };

  if (!token || isNaN(orgId)) {
    return (
      <div>
        <p className="form-error">Invalid organization or not signed in.</p>
        <Link href="/dashboard/organizations">Organizations</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "var(--muted)" }}>Loading access control…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <nav style={{ marginBottom: "1.5rem", fontSize: "0.9rem" }} aria-label="Breadcrumb">
        <Link href="/dashboard/organizations" style={{ color: "var(--muted)", textDecoration: "none" }}>Organizations</Link>
        {" / "}
        <Link href={`/dashboard/organizations/${orgId}`} style={{ color: "var(--muted)", textDecoration: "none" }}>{org?.name ?? `Org #${orgId}`}</Link>
        {" / "}
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Access control</span>
      </nav>

      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>Access control</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
        Manage KPI assignments, field-level (and column-level) access, and record-level edit/delete for multi-line items.
      </p>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      <div className="card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Organization roles</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
          Create roles and assign users. Column-level access for multi-line fields can be set per role below.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => { setRoleCreateModal(true); setRoleFormName(""); setRoleFormDescription(""); }}>
          Create role
        </button>
        {roles.length === 0 ? (
          <p style={{ marginTop: "1rem", color: "var(--muted)", fontSize: "0.9rem" }}>No roles yet. Create one to assign users and set column access by role.</p>
        ) : (
          <ul style={{ marginTop: "1rem", listStyle: "none", padding: 0 }}>
            {roles.map((role) => (
              <li key={role.id} style={{ borderBottom: "1px solid var(--border)", padding: "0.75rem 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <strong>{role.name}</strong>
                  {role.description && <span style={{ marginLeft: "0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>{role.description}</span>}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="btn" style={{ fontSize: "0.85rem" }} onClick={() => { setRoleEditModal(role); setRoleFormName(role.name); setRoleFormDescription(role.description ?? ""); }}>
                    Edit
                  </button>
                  <button type="button" className="btn" style={{ fontSize: "0.85rem" }} onClick={() => setRoleUsersModal(role)}>
                    Users
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: "0.85rem", color: "var(--danger, #c00)" }}
                    onClick={async () => {
                      if (!token || !confirm(`Delete role "${role.name}"? Users will be unassigned from this role.`)) return;
                      try {
                        await api(`/organizations/${orgId}/roles/${role.id}`, { method: "DELETE", token });
                        setRoles((prev) => prev.filter((r) => r.id !== role.id));
                        toast.success("Role deleted");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Delete failed");
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem" }}>Select KPI</label>
        <select
          value={selectedKpiId ?? ""}
          onChange={(e) => setSelectedKpiId(e.target.value ? Number(e.target.value) : null)}
          style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)", minWidth: 280 }}
        >
          <option value="">— Select a KPI —</option>
          {kpis.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>
      </div>

      {selectedKpiId && (
        <div className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Assigned users</h2>
          {assignments.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No users assigned to this KPI. Assign users from the KPI entry page (Edit → Assigned).</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>User</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>KPI permission</th>
                  <th style={{ textAlign: "left", padding: "0.75rem" }}>Field / column / record-level</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.75rem", verticalAlign: "top" }}>
                      <strong>{a.full_name || a.username}</strong>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{a.username}</div>
                    </td>
                    <td style={{ padding: "0.75rem", verticalAlign: "top" }}>
                      <span style={{ padding: "0.2rem 0.5rem", borderRadius: 6, background: "var(--bg-subtle)", fontSize: "0.85rem" }}>
                        {a.permission === "data_entry" ? "Edit" : "View"}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem", verticalAlign: "top" }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: "0.85rem" }}
                        onClick={() => {
                          setExpandedUserId(expandedUserId === a.id ? null : a.id);
                          if (expandedUserId !== a.id) loadFieldAccess(a.id);
                        }}
                      >
                        {expandedUserId === a.id ? "Hide" : "Field & column rights"}
                      </button>
                      {multiLineFields.length > 0 && entries.length > 0 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: "0.85rem", marginLeft: "0.5rem" }}
                          onClick={() =>
                            getRowCount(entries[0].id, multiLineFields[0].id).then((count) =>
                              openRowAccessModal(a.id, a.full_name || a.username, multiLineFields[0].id, multiLineFields[0].name, entries[0].id, count)
                            )
                          }
                        >
                          Record-level (rows)
                        </button>
                      )}
                      {expandedUserId === a.id && (
                        <FieldAccessPanel
                          userId={a.id}
                          fields={fields}
                          fieldAccess={fieldAccessByUser[a.id] ?? EMPTY_FIELD_ACCESS}
                          saving={saving}
                          onSave={(accesses) => handleReplaceFieldAccess(a.id, accesses)}
                          onOpenRowAccess={(fieldId, fieldName, entryId) =>
                            getRowCount(entryId, fieldId).then((count) =>
                              openRowAccessModal(a.id, a.full_name || a.username, fieldId, fieldName, entryId, count)
                            )
                          }
                          entries={entries}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedKpiId && multiLineFields.length > 0 && roles.length > 0 && (
        <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Column (subfield) access by role</h2>
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
            Set view or edit per column for each role. Users in a role get this access on multi-line fields. Row-level access remains per user above.
          </p>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Multi-line field</label>
            <select
              value={columnByRoleFieldId ?? ""}
              onChange={(e) => setColumnByRoleFieldId(e.target.value ? Number(e.target.value) : null)}
              style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)", minWidth: 220 }}
            >
              <option value="">— Select field —</option>
              {multiLineFields.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          {columnByRoleFieldId != null && (() => {
            const f = multiLineFields.find((x) => x.id === columnByRoleFieldId);
            const subFields = f?.sub_fields ?? [];
            return subFields.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No sub-fields.</p>
            ) : columnByRoleLoading ? (
              <p style={{ color: "var(--muted)" }}>Loading…</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Role</th>
                      {subFields.map((s) => (
                        <th key={s.id} style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)", minWidth: 90 }}>{s.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role) => (
                      <tr key={role.id}>
                        <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>{role.name}</td>
                        {subFields.map((s) => {
                          const list = fieldAccessByRole[role.id] ?? [];
                          const row = list.find((r) => r.field_id === f!.id && r.sub_field_id === s.id);
                          const value = row?.access_type ?? "";
                          const saving = columnByRoleSavingRoleId === role.id;
                          return (
                            <td key={s.id} style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                              <select
                                value={value}
                                disabled={saving}
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  const prevList = fieldAccessByRole[role.id] ?? [];
                                  const updated = prevList
                                    .filter((r) => !(r.field_id === f!.id && r.sub_field_id === s.id))
                                    .concat(v === "view" || v === "data_entry" ? [{ field_id: f!.id, sub_field_id: s.id, access_type: v }] : []);
                                  setFieldAccessByRole((prev) => ({ ...prev, [role.id]: updated }));
                                  setColumnByRoleSavingRoleId(role.id);
                                  try {
                                    const accesses = updated.filter((r) => r.access_type === "view" || r.access_type === "data_entry");
                                    await api(`/kpis/${selectedKpiId}/field-access-by-role?${qs({ organization_id: orgId })}`, {
                                      method: "PUT",
                                      body: JSON.stringify({ role_id: role.id, accesses }),
                                      token,
                                    });
                                    toast.success("Column access by role updated");
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : "Failed to save");
                                    setFieldAccessByRole((prev) => ({ ...prev, [role.id]: prevList }));
                                  } finally {
                                    setColumnByRoleSavingRoleId(null);
                                  }
                                }}
                                style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", minWidth: 85 }}
                              >
                                <option value="">None</option>
                                <option value="view">View</option>
                                <option value="data_entry">Edit</option>
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {selectedKpiId && multiLineFields.length > 0 && (
        <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Row/Record-level access</h2>
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
            Assign which users can edit or delete each row (record). Select field and entry, then edit access per row.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Multi-line field</label>
              <select
                value={selectedRowFieldId ?? ""}
                onChange={(e) => {
                  setSelectedRowFieldId(e.target.value ? Number(e.target.value) : null);
                  setSelectedRowEntryId(null);
                  setRowCount(null);
                  setRowsWithAccess([]);
                }}
                style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)", minWidth: 220 }}
              >
                <option value="">— Select field —</option>
                {multiLineFields.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Entry (year / period)</label>
              <select
                value={selectedRowEntryId ?? ""}
                onChange={(e) => {
                  setSelectedRowEntryId(e.target.value ? Number(e.target.value) : null);
                  setRowCount(null);
                  setRowsWithAccess([]);
                }}
                style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)", minWidth: 180 }}
              >
                <option value="">— Select entry —</option>
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>{e.year}{e.period_key ? ` ${e.period_key}` : ""}</option>
                ))}
              </select>
            </div>
            {rowsWithAccessLoading && <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Loading…</span>}
            {!rowsWithAccessLoading && rowCount !== null && selectedRowFieldId != null && selectedRowEntryId != null && (
              <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Records: {rowCount}</span>
            )}
          </div>
          {selectedRowFieldId != null && selectedRowEntryId != null && !rowsWithAccessLoading && (
            <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", minWidth: 80 }}>Record #</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", minWidth: 160 }}>Preview</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Users with access</th>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", width: 100 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithAccess.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: "1rem", color: "var(--muted)" }}>
                        No rows in this entry yet. Add data from the KPI entry page first.
                      </td>
                    </tr>
                  ) : (
                    rowsWithAccess.map((row) => (
                      <tr key={row.row_index} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "0.5rem 0.75rem", verticalAlign: "top" }}>{row.row_index + 1}</td>
                        <td style={{ padding: "0.5rem 0.75rem", verticalAlign: "top", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.preview}>
                          {row.preview || "—"}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", verticalAlign: "top" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                            {row.users.map((u) => (
                              <span
                                key={u.user_id}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.25rem",
                                  padding: "0.2rem 0.5rem",
                                  borderRadius: 6,
                                  background: "var(--bg-subtle)",
                                  fontSize: "0.8rem",
                                }}
                              >
                                {u.full_name || u.username} ({u.can_delete ? "Edit+Delete" : "Edit"})
                                <button
                                  type="button"
                                  onClick={() => removeUserFromRow(row.row_index, u.user_id)}
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    padding: "0 0.15rem",
                                    color: "var(--muted)",
                                    fontSize: "1rem",
                                    lineHeight: 1,
                                  }}
                                  aria-label="Remove user from row"
                                  title="Remove from row"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", verticalAlign: "top" }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: "0.8rem" }}
                            onClick={() => {
                              setAddUserToRowModal({ rowIndex: row.row_index, preview: row.preview });
                              setAddUserToRowUserId(assignments[0]?.id ?? null);
                              setAddUserToRowAccess("edit_delete");
                            }}
                          >
                            Add user
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {addUserToRowModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
              }}
              onClick={() => setAddUserToRowModal(null)}
            >
              <div
                className="card"
                style={{ width: "90%", maxWidth: 400, padding: "1.25rem" }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3 style={{ margin: "0 0 0.5rem 0" }}>Add user to row</h3>
                <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1rem" }}>
                  Record #{addUserToRowModal.rowIndex + 1}{addUserToRowModal.preview ? ` — ${addUserToRowModal.preview.slice(0, 50)}${addUserToRowModal.preview.length > 50 ? "…" : ""}` : ""}
                </p>
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>User</label>
                  <select
                    value={addUserToRowUserId ?? ""}
                    onChange={(e) => setAddUserToRowUserId(e.target.value ? Number(e.target.value) : null)}
                    style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)" }}
                  >
                    <option value="">— Select user —</option>
                    {assignments.map((a) => (
                      <option key={a.id} value={a.id}>{a.full_name || a.username}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Access</label>
                  <select
                    value={addUserToRowAccess}
                    onChange={(e) => setAddUserToRowAccess(e.target.value as "edit" | "edit_delete")}
                    style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--border)" }}
                  >
                    <option value="edit">Edit only</option>
                    <option value="edit_delete">Edit + Delete</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="btn btn-primary" disabled={addUserToRowSaving || addUserToRowUserId == null} onClick={saveAddUserToRow}>
                    {addUserToRowSaving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="btn" onClick={() => setAddUserToRowModal(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {rowAccessModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setRowAccessModal(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 560, width: "95%", maxHeight: "90vh", overflow: "auto", padding: "1.25rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem 0" }}>Row/Record-level access</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              User: <strong>{rowAccessModal.userName}</strong>. Field: {rowAccessModal.fieldName}. Entry ID: {rowAccessModal.entryId}.
            </p>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "1rem" }}>
              Set access per row. No access = user cannot edit or delete that record. Empty list saved = no row limit (field-level applies to all rows).
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Bulk:</span>
              <button
                type="button"
                className="btn"
                style={{ fontSize: "0.8rem" }}
                onClick={() => setRowAccessList((prev) => prev.map((r) => ({ ...r, can_edit: true, can_delete: true })))}
              >
                Allow all (Edit + Delete)
              </button>
              <button
                type="button"
                className="btn"
                style={{ fontSize: "0.8rem" }}
                onClick={() => setRowAccessList((prev) => prev.map((r) => ({ ...r, can_edit: false, can_delete: false })))}
              >
                Clear all (field-level only)
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                First
                <input
                  type="number"
                  min={0}
                  max={rowAccessList.length}
                  value={firstNRowsValue}
                  onChange={(e) => setFirstNRowsValue(e.target.value)}
                  style={{ width: 56, padding: "0.25rem 0.35rem" }}
                />
                rows:
              </label>
              <button
                type="button"
                className="btn"
                style={{ fontSize: "0.8rem" }}
                onClick={() => {
                  const n = Math.min(Math.max(0, parseInt(firstNRowsValue, 10) || 0), rowAccessList.length);
                  setRowAccessList((prev) => prev.map((r, i) => ({ ...r, can_edit: i < n, can_delete: i < n })));
                }}
              >
                Apply
              </button>
            </div>

            <div style={{ maxHeight: 320, overflow: "auto", marginBottom: "1rem", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Record #</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {rowAccessList.map((r, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.4rem" }}>{r.row_index + 1}</td>
                      <td style={{ padding: "0.4rem" }}>
                        <select
                          value={r.can_edit && r.can_delete ? "edit_delete" : r.can_edit ? "edit" : "none"}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRowAccessList((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? { ...x, can_edit: v !== "none", can_delete: v === "edit_delete" }
                                  : x
                              )
                            );
                          }}
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", minWidth: 140 }}
                        >
                          <option value="none">No access</option>
                          <option value="edit">Edit</option>
                          <option value="edit_delete">Edit + Delete</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" disabled={rowAccessSaving} onClick={saveRowAccess}>
                {rowAccessSaving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn" onClick={() => setRowAccessModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Create role modal */}
      {roleCreateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setRoleCreateModal(false)}>
          <div className="card" style={{ padding: "1.25rem", minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 1rem" }}>Create role</h3>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Name</label>
              <input type="text" value={roleFormName} onChange={(e) => setRoleFormName(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} placeholder="e.g. Finance" />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Description (optional)</label>
              <input type="text" value={roleFormDescription} onChange={(e) => setRoleFormDescription(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" disabled={roleFormSaving || !roleFormName.trim()} onClick={async () => {
                if (!token || !roleFormName.trim()) return;
                setRoleFormSaving(true);
                try {
                  const r = await api<OrgRole>(`/organizations/${orgId}/roles`, { method: "POST", body: JSON.stringify({ name: roleFormName.trim(), description: roleFormDescription.trim() || null }), token });
                  setRoles((prev) => [...prev, r]);
                  setRoleCreateModal(false);
                  toast.success("Role created");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setRoleFormSaving(false);
                }
              }}>
                {roleFormSaving ? "Creating…" : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setRoleCreateModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit role modal */}
      {roleEditModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setRoleEditModal(null)}>
          <div className="card" style={{ padding: "1.25rem", minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 1rem" }}>Edit role</h3>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Name</label>
              <input type="text" value={roleFormName} onChange={(e) => setRoleFormName(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Description (optional)</label>
              <input type="text" value={roleFormDescription} onChange={(e) => setRoleFormDescription(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" disabled={roleFormSaving || !roleFormName.trim()} onClick={async () => {
                if (!token || !roleEditModal || !roleFormName.trim()) return;
                setRoleFormSaving(true);
                try {
                  const r = await api<OrgRole>(`/organizations/${orgId}/roles/${roleEditModal.id}`, { method: "PATCH", body: JSON.stringify({ name: roleFormName.trim(), description: roleFormDescription.trim() || null }), token });
                  setRoles((prev) => prev.map((x) => (x.id === r.id ? r : x)));
                  setRoleEditModal(null);
                  toast.success("Role updated");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setRoleFormSaving(false);
                }
              }}>
                {roleFormSaving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn" onClick={() => setRoleEditModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Users in role modal */}
      {roleUsersModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setRoleUsersModal(null)}>
          <div className="card" style={{ padding: "1.25rem", maxWidth: 440, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 0.5rem" }}>Users in role: {roleUsersModal.name}</h3>
            <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>Select users to assign to this role. They will get column-level access granted to the role.</p>
            <div style={{ marginBottom: "1rem", maxHeight: 260, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem" }}>
              {users.map((u) => {
                const checked = roleUsers.some((r) => r.id === u.id);
                return (
                  <label key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0", cursor: "pointer" }}>
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      if (e.target.checked) setRoleUsers((prev) => [...prev, { id: u.id, username: u.username, full_name: u.full_name }]);
                      else setRoleUsers((prev) => prev.filter((r) => r.id !== u.id));
                    }} />
                    <span>{u.full_name || u.username}</span>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>({u.username})</span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="btn btn-primary" disabled={roleUsersSaving} onClick={async () => {
                if (!token || !roleUsersModal) return;
                setRoleUsersSaving(true);
                try {
                  await api(`/organizations/${orgId}/roles/${roleUsersModal.id}/users`, { method: "PUT", body: JSON.stringify({ user_ids: roleUsers.map((r) => r.id) }), token });
                  toast.success("Users updated");
                  setRoleUsersModal(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setRoleUsersSaving(false);
                }
              }}>
                {roleUsersSaving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn" onClick={() => setRoleUsersModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldAccessPanel({
  userId,
  fields,
  fieldAccess,
  saving,
  onSave,
  onOpenRowAccess,
  entries,
}: {
  userId: number;
  fields: FieldDef[];
  fieldAccess: FieldAccessItem[];
  saving: boolean;
  onSave: (accesses: FieldAccessItem[]) => void;
  onOpenRowAccess: (fieldId: number, fieldName: string, entryId: number) => void;
  entries: { id: number; year: number; period_key: string }[];
}) {
  const buildDefaultFromFields = (): FieldAccessItem[] =>
    fields.flatMap((f) => {
      if (f.field_type === "multi_line_items" && f.sub_fields?.length) {
        return (f.sub_fields as { id: number }[]).map((s) => ({
          field_id: f.id,
          sub_field_id: s.id as number | null,
          access_type: "data_entry",
        }));
      }
      return [{ field_id: f.id, sub_field_id: null, access_type: "data_entry" as string }];
    });

  const [draft, setDraft] = useState<FieldAccessItem[]>(() =>
    fieldAccess.length > 0 ? [...fieldAccess] : buildDefaultFromFields()
  );

  useEffect(() => {
    if (fieldAccess.length > 0) {
      setDraft([...fieldAccess]);
    } else if (fields.length > 0) {
      setDraft(buildDefaultFromFields());
    }
  }, [fieldAccess, fields]);

  const updateDraft = (fieldId: number, subFieldId: number | null, accessType: string) => {
    setDraft((prev) => {
      const rest = prev.filter((a) => !(a.field_id === fieldId && (a.sub_field_id ?? null) === subFieldId));
      if (accessType === "none") return rest;
      return [...rest, { field_id: fieldId, sub_field_id: subFieldId, access_type: accessType }];
    });
  };

  const getAccess = (fieldId: number, subFieldId: number | null) =>
    draft.find((a) => a.field_id === fieldId && (a.sub_field_id ?? null) === subFieldId)?.access_type ?? "none";

  const rowsToSave = draft.filter((a) => a.access_type === "view" || a.access_type === "data_entry");

  return (
    <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--bg-subtle)", borderRadius: 8 }}>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
        Set view or edit per field (and per column for multi-line items). Empty = KPI-level permission for all.
      </p>
      <table style={{ width: "100%", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "0.4rem" }}>Field / column</th>
            <th style={{ textAlign: "left", padding: "0.4rem" }}>Access</th>
            <th style={{ textAlign: "left", padding: "0.4rem" }}>Record-level</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            if (f.field_type === "multi_line_items" && f.sub_fields?.length) {
              return (f.sub_fields as { id: number; key: string; name: string }[]).map((s) => (
                <tr key={`${f.id}-${s.id}`}>
                  <td style={{ padding: "0.4rem" }}>{f.name} → {s.name}</td>
                  <td style={{ padding: "0.4rem" }}>
                    <select
                      value={getAccess(f.id, s.id)}
                      onChange={(e) => updateDraft(f.id, s.id, e.target.value)}
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                    >
                      <option value="none">No access</option>
                      <option value="view">View</option>
                      <option value="data_entry">Edit</option>
                    </select>
                  </td>
                  <td style={{ padding: "0.4rem" }}>—</td>
                </tr>
              ));
            }
            return (
              <tr key={f.id}>
                <td style={{ padding: "0.4rem" }}>{f.name}</td>
                <td style={{ padding: "0.4rem" }}>
                  <select
                    value={getAccess(f.id, null)}
                    onChange={(e) => updateDraft(f.id, null, e.target.value)}
                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                  >
                    <option value="none">No access</option>
                    <option value="view">View</option>
                    <option value="data_entry">Edit</option>
                  </select>
                </td>
                <td style={{ padding: "0.4rem" }}>
                  {f.field_type === "multi_line_items" && entries.length > 0 && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.75rem" }}
                      onClick={() => onOpenRowAccess(f.id, f.name, entries[0].id)}
                    >
                      Rows
                    </button>
                  )}
                  {f.field_type === "multi_line_items" && entries.length === 0 && (
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>No entries for this year.</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={() => onSave(rowsToSave)}>
        {saving ? "Saving…" : "Save field & column access"}
      </button>
    </div>
  );
}
