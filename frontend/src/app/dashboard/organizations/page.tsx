"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface OrgSummary {
  user_count: number;
  domain_count: number;
  kpi_count: number;
}

interface OrgWithSummary {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  summary: OrgSummary;
}

interface Org {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface UserResponse {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  organization_id: number | null;
  is_active: boolean;
}

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  admin_username: z.string().min(1, "Admin username required"),
  admin_password: z.string().min(8, "Password at least 8 characters"),
  admin_email: z.union([z.string().email(), z.literal("")]).optional(),
  admin_full_name: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  is_active: z.boolean(),
});

const adminEditSchema = z.object({
  username: z.string().min(1, "Username required").max(100),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  full_name: z.string().optional(),
  password: z.union([z.string().min(8, "Min 8 characters"), z.literal("")]).optional(),
});

type CreateFormData = z.infer<typeof createSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;
type AdminEditFormData = z.infer<typeof adminEditSchema>;

export default function OrganizationsPage() {
  const [list, setList] = useState<OrgWithSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingAdminOrgId, setEditingAdminOrgId] = useState<number | null>(null);
  const [editingAdminUser, setEditingAdminUser] = useState<UserResponse | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  const token = getAccessToken();

  const loadList = () => {
    if (!token) return;
    api<OrgWithSummary[]>("/organizations?with_summary=true", { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadList();
  }, []);

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      description: "",
      admin_username: "",
      admin_password: "",
      admin_email: "",
      admin_full_name: "",
    },
  });

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token) return;
    setError(null);
    try {
      await api("/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          admin_username: data.admin_username,
          admin_password: data.admin_password,
          admin_email: data.admin_email || null,
          admin_full_name: data.admin_full_name || null,
        }),
        token,
      });
      createForm.reset();
      setShowCreate(false);
      setLoading(true);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (orgId: number, data: UpdateFormData) => {
    if (!token) return;
    setError(null);
    try {
      await api(`/organizations/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          is_active: data.is_active,
        }),
        token,
      });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const toggleActive = async (e: React.MouseEvent, org: OrgWithSummary) => {
    e.preventDefault();
    e.stopPropagation();
    if (!token) return;
    setError(null);
    try {
      await api(`/organizations/${org.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !org.is_active }),
        token,
      });
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const startEditAdmin = async (orgId: number) => {
    if (!token) return;
    setError(null);
    setEditingAdminOrgId(orgId);
    setLoadingAdmin(true);
    setEditingAdminUser(null);
    try {
      const users = await api<UserResponse[]>(`/users?organization_id=${orgId}`, { token });
      const admin = users.find((u) => u.role === "ORG_ADMIN") ?? users[0] ?? null;
      setEditingAdminUser(admin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
      setEditingAdminOrgId(null);
    } finally {
      setLoadingAdmin(false);
    }
  };

  const cancelEditAdmin = () => {
    setEditingAdminOrgId(null);
    setEditingAdminUser(null);
  };

  const onAdminSave = async (orgId: number, userId: number, data: AdminEditFormData) => {
    if (!token) return;
    setError(null);
    try {
      const body: { username?: string; email?: string | null; full_name?: string | null; password?: string } = {
        username: data.username,
        email: data.email || null,
        full_name: data.full_name || null,
      };
      if (data.password && data.password.trim().length >= 8) {
        body.password = data.password;
      }
      await api(`/users/${userId}?organization_id=${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      });
      cancelEditAdmin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  if (loading && list.length === 0) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Organizations</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreate((s) => !s)}
        >
          {showCreate ? "Cancel" : "Add organization"}
        </button>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create organization</h2>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Organization name *</label>
              <input {...createForm.register("name")} />
              {createForm.formState.errors.name && (
                <p className="form-error">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea {...createForm.register("description")} rows={2} />
            </div>
            <div className="form-group">
              <label>Admin username *</label>
              <input {...createForm.register("admin_username")} />
              {createForm.formState.errors.admin_username && (
                <p className="form-error">{createForm.formState.errors.admin_username.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Admin password * (min 8 characters)</label>
              <input type="password" {...createForm.register("admin_password")} />
              {createForm.formState.errors.admin_password && (
                <p className="form-error">{createForm.formState.errors.admin_password.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Admin email</label>
              <input type="email" {...createForm.register("admin_email")} />
              {createForm.formState.errors.admin_email && (
                <p className="form-error">{createForm.formState.errors.admin_email.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Admin full name</label>
              <input {...createForm.register("admin_full_name")} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Creating…" : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
        {list.map((o) => (
          <div key={o.id} className="card" style={{ marginBottom: 0 }}>
            {editingId === o.id ? (
              <OrgEditForm
                org={o}
                onSave={(data) => onUpdateSubmit(o.id, data)}
                onCancel={() => setEditingId(null)}
                token={token!}
              />
            ) : editingAdminOrgId === o.id ? (
              <>
                {loadingAdmin ? (
                  <p style={{ color: "var(--muted)" }}>Loading admin…</p>
                ) : editingAdminUser ? (
                  <AdminEditForm
                    user={editingAdminUser}
                    onSave={(data) => onAdminSave(o.id, editingAdminUser.id, data)}
                    onCancel={cancelEditAdmin}
                  />
                ) : (
                  <div>
                    <p style={{ color: "var(--muted)", marginBottom: "0.5rem" }}>No org admin user found.</p>
                    <button type="button" className="btn" onClick={cancelEditAdmin}>Close</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <Link
                  href={`/dashboard/organizations/${o.id}`}
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <div style={{ marginBottom: "0.75rem" }}>
                    <strong style={{ fontSize: "1.1rem" }}>{o.name}</strong>
                    {o.description && (
                      <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0", lineHeight: 1.3 }}>
                        {o.description}
                      </p>
                    )}
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: "0.5rem",
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.8rem",
                        background: o.is_active ? "var(--success)" : "var(--muted)",
                        color: "white",
                      }}
                    >
                      {o.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Users">
                      {o.summary.user_count} users
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Domains">
                      {o.summary.domain_count} domains
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="KPIs">
                      {o.summary.kpi_count} KPIs
                    </span>
                  </div>
                </Link>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => setEditingId(o.id)}>
                    Edit
                  </button>
                  <button type="button" className="btn" onClick={() => startEditAdmin(o.id)}>
                    Edit admin
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={(e) => toggleActive(e, o)}
                    style={{ color: o.is_active ? "var(--warning)" : "var(--success)" }}
                  >
                    {o.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <Link href={`/dashboard/organizations/${o.id}`} className="btn btn-primary" style={{ textDecoration: "none", marginLeft: "auto" }}>
                    Manage
                  </Link>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OrgEditForm({
  org,
  onSave,
  onCancel,
  token,
}: {
  org: OrgWithSummary;
  onSave: (data: UpdateFormData) => void;
  onCancel: () => void;
  token: string;
}) {
  const plainOrg: Org = { id: org.id, name: org.name, description: org.description, is_active: org.is_active };
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      name: plainOrg.name,
      description: plainOrg.description ?? "",
      is_active: plainOrg.is_active,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSave)} style={{ width: "100%" }}>
      <div className="form-group">
        <label>Name *</label>
        <input {...register("name")} />
        {errors.name && <p className="form-error">{errors.name.message}</p>}
      </div>
      <div className="form-group">
        <label>Description</label>
        <textarea {...register("description")} rows={2} />
      </div>
      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" {...register("is_active")} />
          Active
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AdminEditForm({
  user,
  onSave,
  onCancel,
}: {
  user: UserResponse;
  onSave: (data: AdminEditFormData) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AdminEditFormData>({
    resolver: zodResolver(adminEditSchema),
    defaultValues: {
      username: user.username,
      email: user.email ?? "",
      full_name: user.full_name ?? "",
      password: "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSave)} style={{ width: "100%" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Edit organization admin</h3>
      <div className="form-group">
        <label>Username *</label>
        <input {...register("username")} />
        {errors.username && <p className="form-error">{errors.username.message}</p>}
      </div>
      <div className="form-group">
        <label>Email</label>
        <input type="email" {...register("email")} />
        {errors.email && <p className="form-error">{errors.email.message}</p>}
      </div>
      <div className="form-group">
        <label>Full name</label>
        <input {...register("full_name")} />
      </div>
      <div className="form-group">
        <label>New password (leave blank to keep current)</label>
        <input type="password" {...register("password")} placeholder="Optional" />
        {errors.password && <p className="form-error">{errors.password.message}</p>}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
