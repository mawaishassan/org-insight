"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
import type { UserRow } from "../users/shared";

interface MeInfo {
  id: number;
  username: string;
  role: string;
  organization_id?: number | null;
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

export default function AccessDashboardPage() {
  const token = getAccessToken();

  const [me, setMe] = useState<MeInfo | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roleCreateModal, setRoleCreateModal] = useState(false);
  const [roleEditModal, setRoleEditModal] = useState<OrgRole | null>(null);
  const [roleUsersModal, setRoleUsersModal] = useState<OrgRole | null>(null);
  const [roleUsers, setRoleUsers] = useState<{ id: number; username: string; full_name: string | null }[]>([]);
  const [roleFormName, setRoleFormName] = useState("");
  const [roleFormDescription, setRoleFormDescription] = useState("");
  const [roleFormSaving, setRoleFormSaving] = useState(false);
  const [roleUsersSaving, setRoleUsersSaving] = useState(false);
  const [roleMembersByRoleId, setRoleMembersByRoleId] = useState<
    Record<number, { id: number; username: string; full_name: string | null }[]>
  >({});
  const [roleMembersLoading, setRoleMembersLoading] = useState(false);

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUserSaving, setCreateUserSaving] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserFullName, setNewUserFullName] = useState("");
  const [activeTab, setActiveTab] = useState<"roles" | "users">("roles");
  const [newUserType, setNewUserType] = useState<"internal" | "external">("internal");
  const [newExternalDescription, setNewExternalDescription] = useState("");
  const [newExternalIsActive, setNewExternalIsActive] = useState(true);
  const [userRoleAddForUserId, setUserRoleAddForUserId] = useState<number | null>(null);
  const [userRoleAddRoleId, setUserRoleAddRoleId] = useState<number | null>(null);
  const [userRoleSavingRoleId, setUserRoleSavingRoleId] = useState<number | null>(null);

  const [externalLoginUrl, setExternalLoginUrl] = useState<string>("");
  const [externalDbName, setExternalDbName] = useState<string>("OBE");
  const [externalLoginSaving, setExternalLoginSaving] = useState(false);
  const [externalBulkOpen, setExternalBulkOpen] = useState(false);
  const [externalBulkMode, setExternalBulkMode] = useState<"append" | "override">("append");
  const [externalBulkUploading, setExternalBulkUploading] = useState(false);

  const orgId = me?.organization_id ?? null;
  const isOrgAdmin = me?.role === "ORG_ADMIN";
  const isSuperAdmin = me?.role === "SUPER_ADMIN";

  // Load current user and then org/users/roles
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api<MeInfo>("/auth/me", { token })
      .then(async (meInfo) => {
        setMe(meInfo);
        const oid = meInfo.organization_id ?? null;
        if (!oid) {
          setOrg(null);
          setUsers([]);
          setRoles([]);
          return;
        }
        const [orgRes, usersRes, rolesRes] = await Promise.all([
          api<OrgInfo>(`/organizations/${oid}`, { token }).catch(() => null),
          api<UserRow[]>(`/users?organization_id=${oid}`, { token }).catch(() => []),
          api<OrgRole[]>(`/organizations/${oid}/roles`, { token }).catch(() => []),
        ]);
        setOrg(orgRes ?? null);
        setUsers(Array.isArray(usersRes) ? usersRes : []);
        setRoles(Array.isArray(rolesRes) ? rolesRes : []);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load access data");
        setMe(null);
        setOrg(null);
        setUsers([]);
        setRoles([]);
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Super admin: load the external XML-RPC login URL
  useEffect(() => {
    if (!token || !isSuperAdmin) return;
    api<{ login_url: string | null; db: string | null }>("/auth/external-auth/login-url", { token })
      .then((res) => {
        setExternalLoginUrl(res.login_url ?? "");
        setExternalDbName(res.db ?? "OBE");
      })
      .catch(() => setExternalLoginUrl(""));
  }, [token, isSuperAdmin]);

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

  // Load role membership map for chips in Users tab
  useEffect(() => {
    if (!token || !orgId || roles.length === 0) {
      setRoleMembersByRoleId({});
      return;
    }
    setRoleMembersLoading(true);
    Promise.all(
      roles.map((role) =>
        api<{ id: number; username: string; full_name: string | null }[]>(
          `/organizations/${orgId}/roles/${role.id}/users`,
          { token }
        )
          .then((list) => ({ roleId: role.id, list: list ?? [] }))
          .catch(() => ({ roleId: role.id, list: [] }))
      )
    )
      .then((results) => {
        const map: Record<
          number,
          { id: number; username: string; full_name: string | null }[]
        > = {};
        results.forEach(({ roleId, list }) => {
          map[roleId] = list;
        });
        setRoleMembersByRoleId(map);
      })
      .finally(() => setRoleMembersLoading(false));
  }, [token, orgId, roles]);

  if (!token) {
    return (
      <div style={{ padding: "2rem" }}>
        <p className="form-error">You must be signed in to manage access.</p>
        <Link href="/login">Go to login</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "var(--muted)" }}>Loading access dashboard…</p>
      </div>
    );
  }

  if (!isOrgAdmin && !isSuperAdmin) {
    return (
      <div style={{ padding: "2rem" }}>
        <p className="form-error">Only organization admins (and super admin) can access this page.</p>
        <Link href="/dashboard">Back to dashboard</Link>
      </div>
    );
  }

  if (isOrgAdmin && !orgId) {
    return (
      <div style={{ padding: "2rem" }}>
        <p className="form-error">Only organization admins with an organization can access this page.</p>
        <Link href="/dashboard">Back to dashboard</Link>
      </div>
    );
  }

  if (isSuperAdmin) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", paddingBottom: "2rem" }}>
        {error && (
          <p className="form-error" style={{ margin: "1rem 0" }}>
            {error}
          </p>
        )}
        <section className="card" style={{ padding: "1.25rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>External authentication</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
            Configure the external JSON-RPC login URL used to verify external users&apos; passwords.
          </p>

          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                External JSON-RPC login URL
              </label>
              <input
                value={externalLoginUrl}
                onChange={(e) => setExternalLoginUrl(e.target.value)}
                placeholder="https://your-host/web/session/authenticate"
                style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                External DB name (`db`)
              </label>
              <input
                value={externalDbName}
                onChange={(e) => setExternalDbName(e.target.value)}
                placeholder="OBE"
                style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
              />
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={externalLoginSaving || !externalLoginUrl.trim() || !externalDbName.trim()}
              onClick={async () => {
                if (!token) return;
                try {
                  setExternalLoginSaving(true);
                  await api<{ login_url: string | null }>("/auth/external-auth/login-url", {
                    method: "PUT",
                    token,
                    body: JSON.stringify({ login_url: externalLoginUrl.trim(), db: externalDbName.trim() }),
                  });
                  toast.success("External auth config saved");
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "Failed to save external login URL";
                  toast.error(msg);
                } finally {
                  setExternalLoginSaving(false);
                }
              }}
            >
              {externalLoginSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", paddingBottom: "2rem" }}>
      {error && (
        <p className="form-error" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          borderBottom: "1px solid var(--border)",
          marginBottom: "1rem",
          paddingBottom: "0.5rem",
        }}
      >
        <button
          type="button"
          className="btn"
          style={{
            ...(activeTab === "roles"
              ? { background: "var(--accent)", color: "var(--on-muted)" }
              : {}),
          }}
          onClick={() => setActiveTab("roles")}
        >
          Roles
        </button>
        <button
          type="button"
          className="btn"
          style={{
            ...(activeTab === "users"
              ? { background: "var(--accent)", color: "var(--on-muted)" }
              : {}),
          }}
          onClick={() => setActiveTab("users")}
        >
          Users
        </button>
      </div>

      {/* Roles tab */}
      {activeTab === "roles" && (
        <section className="card" style={{ padding: "1.25rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              marginBottom: "0.75rem",
            }}
          >
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Roles</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setRoleCreateModal(true);
                setRoleFormName("");
                setRoleFormDescription("");
              }}
            >
              Create role
            </button>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
            Define roles for your organization and assign users to them. Field and KPI security is managed on each KPI&apos;s Security tab.
          </p>
          {roles.length === 0 ? (
            <p style={{ marginTop: "0.25rem", color: "var(--muted)", fontSize: "0.9rem" }}>
              No roles yet. Create roles to group users by responsibility (for example: Finance, HR, Country Manager).
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                borderTop: "1px solid var(--border)",
              }}
            >
              {roles.map((role) => (
                <li
                  key={role.id}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    padding: "0.75rem 0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <strong>{role.name}</strong>
                    </div>
                    {role.description && (
                      <p
                        style={{
                          margin: "0.2rem 0 0",
                          fontSize: "0.85rem",
                          color: "var(--muted)",
                        }}
                      >
                        {role.description}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.85rem" }}
                      onClick={() => {
                        setRoleEditModal(role);
                        setRoleFormName(role.name);
                        setRoleFormDescription(role.description ?? "");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.85rem" }}
                      onClick={() => setRoleUsersModal(role)}
                    >
                      Users
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.85rem", color: "var(--danger, #c00)" }}
                      onClick={async () => {
                        if (!token || !confirm(`Delete role "${role.name}"? Users will be unassigned from this role.`)) {
                          return;
                        }
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
        </section>
      )}

      {/* Users tab */}
      {activeTab === "users" && (
        <section className="card" style={{ padding: "1.25rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              marginBottom: "0.75rem",
            }}
          >
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Users</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreateUser((v) => !v)}
            >
              {showCreateUser ? "Cancel" : "Add user"}
            </button>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
            View and manage all users in this organization. Use roles to control KPI and field access centrally.
          </p>
          {showCreateUser && (
            <div className="card" style={{ padding: "0.75rem 0.9rem", marginBottom: "0.9rem" }}>
              <div style={{ marginBottom: "0.6rem" }}>
                <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.95rem" }}>
                  {newUserType === "internal" ? "Create user" : "Add external user"}
                </h3>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      fontSize: "0.85rem",
                      background: newUserType === "internal" ? "var(--accent)" : undefined,
                      color: newUserType === "internal" ? "var(--on-muted)" : undefined,
                    }}
                    onClick={() => {
                      setNewUserType("internal");
                      setCreateUserError(null);
                    }}
                  >
                    Internal user
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      fontSize: "0.85rem",
                      background: newUserType === "external" ? "var(--accent)" : undefined,
                      color: newUserType === "external" ? "var(--on-muted)" : undefined,
                    }}
                    onClick={() => {
                      setNewUserType("external");
                      setCreateUserError(null);
                    }}
                  >
                    External user
                  </button>
                </div>
              </div>

              {createUserError && (
                <p className="form-error" style={{ marginBottom: "0.5rem" }}>
                  {createUserError}
                </p>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "0.5rem 0.75rem",
                  marginBottom: "0.75rem",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                    Username *
                  </label>
                  <input
                    value={newUserUsername}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                    style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                  />
                </div>

                {newUserType === "internal" && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                      Password * (min 8 chars)
                    </label>
                    <input
                      type="password"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                    />
                  </div>
                )}

                {newUserType === "internal" && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                    />
                  </div>
                )}

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                    Full name
                  </label>
                  <input
                    value={newUserFullName}
                    onChange={(e) => setNewUserFullName(e.target.value)}
                    style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                  />
                </div>

                {newUserType === "external" && (
                  <div style={{ gridColumn: "span 1" }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                      Description
                    </label>
                    <textarea
                      value={newExternalDescription}
                      onChange={(e) => setNewExternalDescription(e.target.value)}
                      rows={3}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                    />
                  </div>
                )}

                {newUserType === "external" && (
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={newExternalIsActive}
                        onChange={(e) => setNewExternalIsActive(e.target.checked)}
                      />
                      Active
                    </label>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  createUserSaving ||
                  !newUserUsername.trim() ||
                  (newUserType === "internal" &&
                    (!newUserPassword || newUserPassword.length < 8))
                }
                onClick={async () => {
                  if (!token || !orgId) return;
                  if (newUserType === "internal") {
                    if (!newUserUsername.trim() || !newUserPassword || newUserPassword.length < 8) {
                      setCreateUserError("Username and password (min 8 chars) are required.");
                      return;
                    }
                  }
                  if (newUserType === "external" && !newUserUsername.trim()) {
                    setCreateUserError("Username is required.");
                    return;
                  }
                  setCreateUserError(null);
                  setCreateUserSaving(true);
                  try {
                    if (newUserType === "internal") {
                      await api<UserRow>("/users", {
                        method: "POST",
                        body: JSON.stringify({
                          username: newUserUsername.trim(),
                          password: newUserPassword,
                          email: newUserEmail.trim() || null,
                          full_name: newUserFullName.trim() || null,
                          role: "USER",
                          organization_id: orgId,
                        }),
                        token,
                      });
                    } else {
                      await api<UserRow>("/users/external", {
                        method: "POST",
                        body: JSON.stringify({
                          username: newUserUsername.trim(),
                          full_name: newUserFullName.trim() || null,
                          description: newExternalDescription.trim() || null,
                          is_active: newExternalIsActive,
                        }),
                        token,
                      });
                    }
                    const refreshed = await api<UserRow[]>(
                      `/users?organization_id=${orgId}`,
                      { token },
                    ).catch(() => null);
                    if (Array.isArray(refreshed)) {
                      setUsers(refreshed);
                    }
                    setNewUserUsername("");
                    setNewUserPassword("");
                    setNewUserEmail("");
                    setNewUserFullName("");
                    setNewExternalDescription("");
                    setNewExternalIsActive(true);
                    setNewUserType("internal");
                    setShowCreateUser(false);
                    toast.success(newUserType === "internal" ? "User created" : "External user added");
                  } catch (e) {
                    const msg =
                      e instanceof Error ? e.message : "Failed to create user";
                    setCreateUserError(msg);
                    toast.error(msg);
                  } finally {
                    setCreateUserSaving(false);
                  }
                }}
              >
                {createUserSaving ? "Saving…" : newUserType === "internal" ? "Create user" : "Add external user"}
              </button>
            </div>
          )}

          {/* External users bulk upload */}
          <div className="card" style={{ padding: "0.75rem 0.9rem", marginBottom: "0.9rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                marginBottom: "0.5rem",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Bulk upload external users</h3>
              <button type="button" className="btn" style={{ fontSize: "0.85rem" }} onClick={() => setExternalBulkOpen((v) => !v)}>
                {externalBulkOpen ? "Hide" : "Bulk upload"}
              </button>
            </div>

            {externalBulkOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="radio"
                      name="externalBulkMode"
                      checked={externalBulkMode === "append"}
                      onChange={() => setExternalBulkMode("append")}
                    />
                    Append (create new only)
                  </label>
                  <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="radio"
                      name="externalBulkMode"
                      checked={externalBulkMode === "override"}
                      onChange={() => setExternalBulkMode("override")}
                    />
                    Override (update existing by username)
                  </label>
                </div>

                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    if (!token || orgId == null) return;
                    try {
                      const url = getApiUrl(
                        `/users/external/template?${new URLSearchParams({
                          organization_id: String(orgId),
                        }).toString()}`
                      );
                      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                      if (!res.ok) {
                        toast.error("Template download failed");
                        return;
                      }
                      const blob = await res.blob();
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `external_users_template_${orgId}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    } catch {
                      toast.error("Template download failed");
                    }
                  }}
                >
                  Download Excel template
                </button>

                <label
                  className="btn btn-primary"
                  style={{
                    cursor: !externalBulkUploading ? "pointer" : "not-allowed",
                    opacity: externalBulkUploading ? 0.7 : 1,
                  }}
                >
                  {externalBulkUploading ? "Uploading…" : "Upload Excel"}
                  <input
                    type="file"
                    accept=".xlsx"
                    style={{ display: "none" }}
                    disabled={externalBulkUploading || orgId == null}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file || !token || orgId == null) return;
                      if (externalBulkMode === "override") {
                        const ok = window.confirm(
                          "Override mode updates existing external users (matched by username) using the file values. Continue?"
                        );
                        if (!ok) return;
                      }
                      setExternalBulkUploading(true);
                      try {
                        const form = new FormData();
                        form.append("file", file);
                        const url = getApiUrl(
                          `/users/external/bulk-upload?${new URLSearchParams({
                            organization_id: String(orgId),
                            append: externalBulkMode === "append" ? "true" : "false",
                          }).toString()}`
                        );
                        const res = await fetch(url, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${token}` },
                          body: form,
                        });

                        if (res.ok) {
                          const payload = await res.json().catch(() => ({} as any));
                          const added = Number((payload as any)?.rows_added ?? 0);
                          const overridden = Number((payload as any)?.rows_overridden ?? 0);
                          const modeLabel = externalBulkMode === "append" ? "Appended" : "Updated";
                          toast.success(
                            overridden > 0
                              ? `${modeLabel}: ${added} users imported (updated ${overridden} existing)`
                              : `${modeLabel}: ${added} users imported`
                          );

                          const refreshed = await api<UserRow[]>(`/users?organization_id=${orgId}`, { token }).catch(() => null);
                          if (Array.isArray(refreshed)) setUsers(refreshed);

                          setExternalBulkOpen(false);
                        } else {
                          const err = await res.json().catch(() => ({} as any));
                          toast.error(err?.detail ?? "Bulk upload failed");
                        }
                      } catch (ex) {
                        toast.error(ex instanceof Error ? ex.message : "Bulk upload failed");
                      } finally {
                        setExternalBulkUploading(false);
                      }
                    }}
                  />
                </label>

                <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                  Expected columns: `username`, `full_name`, `description`, `is_active`
                </div>
              </div>
            )}
          </div>

          {users.length === 0 ? (
            <p style={{ marginTop: "0.25rem", color: "var(--muted)", fontSize: "0.9rem" }}>
              No users found for this organization.
            </p>
          ) : (
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>User</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Email / Description</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Role</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.5rem" }}>
                        <div style={{ fontWeight: 600 }}>{u.full_name || u.username}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{u.username}</div>
                      </td>
                      <td style={{ padding: "0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>
                        {u.email || u.description || "—"}
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                          <span
                            style={{
                              fontSize: "0.8rem",
                              padding: "0.15rem 0.45rem",
                              borderRadius: 6,
                              background: "var(--border)",
                              alignSelf: "flex-start",
                            }}
                          >
                            {u.role}
                          </span>
                          {roles.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center" }}>
                              {roles
                                .filter((role) =>
                                  (roleMembersByRoleId[role.id] ?? []).some((m) => m.id === u.id)
                                )
                                .map((role) => {
                                  const saving = userRoleSavingRoleId === role.id;
                                  return (
                                    <span
                                      key={role.id}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.25rem",
                                        padding: "0.1rem 0.4rem",
                                        borderRadius: 999,
                                        background: "var(--bg-subtle)",
                                        fontSize: "0.75rem",
                                        border: "1px solid var(--border)",
                                      }}
                                    >
                                      <span>{role.name}</span>
                                      <button
                                        type="button"
                                        disabled={saving}
                                        onClick={async () => {
                                          if (!token || !orgId) return;
                                          const currentMembers = roleMembersByRoleId[role.id] ?? [];
                                          const updatedMembers = currentMembers.filter(
                                            (m) => m.id !== u.id
                                          );
                                          setUserRoleSavingRoleId(role.id);
                                          setRoleMembersByRoleId((prev) => ({
                                            ...prev,
                                            [role.id]: updatedMembers,
                                          }));
                                          try {
                                            await api(`/organizations/${orgId}/roles/${role.id}/users`, {
                                              method: "PUT",
                                              body: JSON.stringify({
                                                user_ids: updatedMembers.map((m) => m.id),
                                              }),
                                              token,
                                            });
                                          } catch (e) {
                                            toast.error(
                                              e instanceof Error ? e.message : "Failed to update role"
                                            );
                                            setRoleMembersByRoleId((prev) => ({
                                              ...prev,
                                              [role.id]: currentMembers,
                                            }));
                                          } finally {
                                            setUserRoleSavingRoleId(null);
                                          }
                                        }}
                                        style={{
                                          border: "none",
                                          background: "transparent",
                                          cursor: "pointer",
                                          fontSize: "0.9rem",
                                          lineHeight: 1,
                                          padding: 0,
                                        }}
                                        aria-label={`Remove from role ${role.name}`}
                                      >
                                        ×
                                      </button>
                                    </span>
                                  );
                                })}
                              <button
                                type="button"
                                style={{
                                  border: "1px dashed var(--border)",
                                  background: "transparent",
                                  padding: "0.1rem 0.4rem",
                                  borderRadius: 999,
                                  fontSize: "0.75rem",
                                  cursor: "pointer",
                                }}
                                onClick={() =>
                                  setUserRoleAddForUserId(
                                    userRoleAddForUserId === u.id ? null : u.id
                                  )
                                }
                              >
                                + Role
                              </button>
                            </div>
                          )}
                          {userRoleAddForUserId === u.id && (
                            <div
                              style={{
                                marginTop: "0.25rem",
                                display: "flex",
                                gap: "0.35rem",
                                alignItems: "center",
                                flexWrap: "wrap",
                              }}
                            >
                              <select
                                value={userRoleAddRoleId ?? ""}
                                onChange={(e) =>
                                  setUserRoleAddRoleId(
                                    e.target.value ? Number(e.target.value) : null
                                  )
                                }
                                style={{
                                  padding: "0.3rem 0.45rem",
                                  borderRadius: 6,
                                  border: "1px solid var(--border)",
                                  fontSize: "0.8rem",
                                }}
                              >
                                <option value="">Select role…</option>
                                {roles
                                  .filter(
                                    (role) =>
                                      !(roleMembersByRoleId[role.id] ?? []).some(
                                        (m) => m.id === u.id
                                      )
                                  )
                                  .map((role) => (
                                    <option key={role.id} value={role.id}>
                                      {role.name}
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={
                                  userRoleAddRoleId == null ||
                                  userRoleSavingRoleId === userRoleAddRoleId
                                }
                                onClick={async () => {
                                  if (!token || !orgId || userRoleAddRoleId == null) return;
                                  const roleId = userRoleAddRoleId;
                                  const currentMembers =
                                    roleMembersByRoleId[roleId] ?? [];
                                  const updatedMembers = [
                                    ...currentMembers,
                                    { id: u.id, username: u.username, full_name: u.full_name },
                                  ];
                                  setUserRoleSavingRoleId(roleId);
                                  setRoleMembersByRoleId((prev) => ({
                                    ...prev,
                                    [roleId]: updatedMembers,
                                  }));
                                  try {
                                    await api(`/organizations/${orgId}/roles/${roleId}/users`, {
                                      method: "PUT",
                                      body: JSON.stringify({
                                        user_ids: updatedMembers.map((m) => m.id),
                                      }),
                                      token,
                                    });
                                    setUserRoleAddRoleId(null);
                                    setUserRoleAddForUserId(null);
                                  } catch (e) {
                                    toast.error(
                                      e instanceof Error
                                        ? e.message
                                        : "Failed to update role"
                                    );
                                    setRoleMembersByRoleId((prev) => ({
                                      ...prev,
                                      [roleId]: currentMembers,
                                    }));
                                  } finally {
                                    setUserRoleSavingRoleId(null);
                                  }
                                }}
                                style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                              >
                                Add
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            padding: "0.15rem 0.45rem",
                            borderRadius: 6,
                            background: u.is_active ? "var(--success)" : "var(--border)",
                            color: u.is_active ? "var(--on-muted)" : "var(--muted)",
                          }}
                        >
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={{ padding: "0.5rem" }}>
                        <Link href={`/dashboard/users/${u.id}`} className="btn" style={{ fontSize: "0.85rem" }}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Create role modal */}
      {roleCreateModal && (
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
          onClick={() => setRoleCreateModal(false)}
        >
          <div
            className="card"
            style={{ padding: "1.25rem", minWidth: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 1rem" }}>Create role</h3>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Name</label>
              <input
                type="text"
                value={roleFormName}
                onChange={(e) => setRoleFormName(e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
                placeholder="e.g. Finance"
              />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>
                Description (optional)
              </label>
              <input
                type="text"
                value={roleFormDescription}
                onChange={(e) => setRoleFormDescription(e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={roleFormSaving || !roleFormName.trim()}
                onClick={async () => {
                  if (!token || !orgId || !roleFormName.trim()) return;
                  setRoleFormSaving(true);
                  try {
                    const r = await api<OrgRole>(`/organizations/${orgId}/roles`, {
                      method: "POST",
                      body: JSON.stringify({
                        name: roleFormName.trim(),
                        description: roleFormDescription.trim() || null,
                      }),
                      token,
                    });
                    setRoles((prev) => [...prev, r]);
                    setRoleCreateModal(false);
                    toast.success("Role created");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  } finally {
                    setRoleFormSaving(false);
                  }
                }}
              >
                {roleFormSaving ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setRoleCreateModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit role modal */}
      {roleEditModal && (
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
          onClick={() => setRoleEditModal(null)}
        >
          <div
            className="card"
            style={{ padding: "1.25rem", minWidth: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 1rem" }}>Edit role</h3>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Name</label>
              <input
                type="text"
                value={roleFormName}
                onChange={(e) => setRoleFormName(e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>
                Description (optional)
              </label>
              <input
                type="text"
                value={roleFormDescription}
                onChange={(e) => setRoleFormDescription(e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={roleFormSaving || !roleFormName.trim()}
                onClick={async () => {
                  if (!token || !roleEditModal || !orgId || !roleFormName.trim()) return;
                  setRoleFormSaving(true);
                  try {
                    const r = await api<OrgRole>(`/organizations/${orgId}/roles/${roleEditModal.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        name: roleFormName.trim(),
                        description: roleFormDescription.trim() || null,
                      }),
                      token,
                    });
                    setRoles((prev) => prev.map((x) => (x.id === r.id ? r : x)));
                    setRoleEditModal(null);
                    toast.success("Role updated");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  } finally {
                    setRoleFormSaving(false);
                  }
                }}
              >
                {roleFormSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setRoleEditModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users in role modal */}
      {roleUsersModal && (
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
          onClick={() => setRoleUsersModal(null)}
        >
          <div
            className="card"
            style={{ padding: "1.25rem", maxWidth: 440, maxHeight: "85vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem" }}>Users in role: {roleUsersModal.name}</h3>
            <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
              Select which users belong to this role.
            </p>
            <div
              style={{
                marginBottom: "1rem",
                maxHeight: 260,
                overflow: "auto",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.5rem",
              }}
            >
              {users.map((u) => {
                const checked = roleUsers.some((r) => r.id === u.id);
                return (
                  <label
                    key={u.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.35rem 0",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setRoleUsers((prev) => [
                            ...prev,
                            { id: u.id, username: u.username, full_name: u.full_name },
                          ]);
                        } else {
                          setRoleUsers((prev) => prev.filter((r) => r.id !== u.id));
                        }
                      }}
                    />
                    <span>{u.full_name || u.username}</span>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>({u.username})</span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={roleUsersSaving}
                onClick={async () => {
                  if (!token || !roleUsersModal || !orgId) return;
                  setRoleUsersSaving(true);
                  try {
                    await api(`/organizations/${orgId}/roles/${roleUsersModal.id}/users`, {
                      method: "PUT",
                      body: JSON.stringify({ user_ids: roleUsers.map((r) => r.id) }),
                      token,
                    });
                    toast.success("Users updated");
                    setRoleUsersModal(null);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  } finally {
                    setRoleUsersSaving(false);
                  }
                }}
              >
                {roleUsersSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setRoleUsersModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

