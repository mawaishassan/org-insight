"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
}

interface KpiOption {
  id: number;
  name: string;
  year: number;
}

interface ReportTemplateOption {
  id: number;
  name: string;
  year: number;
}

const createSchema = z.object({
  username: z.string().min(1, "Username required"),
  password: z.string().min(8, "Password at least 8 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  full_name: z.string().optional(),
  role: z.enum(["USER", "REPORT_VIEWER"]),
});

const updateSchema = z.object({
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  full_name: z.string().optional(),
  password: z.string().min(8, "Min 8 characters").optional().or(z.literal("")),
  role: z.enum(["USER", "REPORT_VIEWER"]),
  is_active: z.boolean(),
});

type CreateFormData = z.infer<typeof createSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;

export default function UsersPage() {
  const [list, setList] = useState<UserRow[]>([]);
  const [kpis, setKpis] = useState<KpiOption[]>([]);
  const [templates, setTemplates] = useState<ReportTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const token = getAccessToken();

  const loadList = () => {
    if (!token) return;
    setError(null);
    api<UserRow[]>("/users", { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!token) return;
    api<KpiOption[]>("/kpis", { token }).then(setKpis).catch(() => setKpis([]));
    api<ReportTemplateOption[]>("/reports/templates", { token }).then(setTemplates).catch(() => setTemplates([]));
  }, [token]);

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      username: "",
      password: "",
      email: "",
      full_name: "",
      role: "USER",
    },
  });

  const [createKpiIds, setCreateKpiIds] = useState<number[]>([]);
  const [createReportIds, setCreateReportIds] = useState<number[]>([]);

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token) return;
    setError(null);
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          username: data.username,
          password: data.password,
          email: data.email || null,
          full_name: data.full_name || null,
          role: data.role,
          kpi_ids: createKpiIds,
          report_template_ids: createReportIds,
        }),
        token,
      });
      createForm.reset({ username: "", password: "", email: "", full_name: "", role: "USER" });
      setCreateKpiIds([]);
      setCreateReportIds([]);
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (userId: number, data: UpdateFormData) => {
    if (!token) return;
    setError(null);
    try {
      const body: Record<string, unknown> = {
        email: data.email || null,
        full_name: data.full_name || null,
        role: data.role,
        is_active: data.is_active,
      };
      if (data.password && data.password.length >= 8) body.password = data.password;
      await api(`/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (userId: number) => {
    if (!token) return;
    if (!confirm("Delete this user? This cannot be undone.")) return;
    setError(null);
    try {
      await api(`/users/${userId}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading && list.length === 0) return <p>Loading...</p>;

  const content = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Users</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? "Cancel" : "Add user"}
        </button>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create user</h2>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Username *</label>
              <input {...createForm.register("username")} />
              {createForm.formState.errors.username && (
                <p className="form-error">{createForm.formState.errors.username.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Password * (min 8 characters)</label>
              <input type="password" {...createForm.register("password")} />
              {createForm.formState.errors.password && (
                <p className="form-error">{createForm.formState.errors.password.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" {...createForm.register("email")} />
              {createForm.formState.errors.email && (
                <p className="form-error">{createForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Full name</label>
              <input {...createForm.register("full_name")} />
            </div>
            <div className="form-group">
              <label>Role *</label>
              <select {...createForm.register("role")}>
                <option value="USER">USER (data entry)</option>
                <option value="REPORT_VIEWER">REPORT_VIEWER (view/print reports only)</option>
              </select>
            </div>
            {kpis.length > 0 && (
              <div className="form-group">
                <label>Assign KPIs (optional)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {kpis.map((k) => (
                    <label key={k.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginRight: "1rem" }}>
                      <input
                        type="checkbox"
                        checked={createKpiIds.includes(k.id)}
                        onChange={(e) => {
                          if (e.target.checked) setCreateKpiIds((ids) => [...ids, k.id]);
                          else setCreateKpiIds((ids) => ids.filter((id) => id !== k.id));
                        }}
                      />
                      {k.name} ({k.year})
                    </label>
                  ))}
                </div>
              </div>
            )}
            {templates.length > 0 && (
              <div className="form-group">
                <label>Assign report templates (optional)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {templates.map((t) => (
                    <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginRight: "1rem" }}>
                      <input
                        type="checkbox"
                        checked={createReportIds.includes(t.id)}
                        onChange={(e) => {
                          if (e.target.checked) setCreateReportIds((ids) => [...ids, t.id]);
                          else setCreateReportIds((ids) => ids.filter((id) => id !== t.id));
                        }}
                      />
                      {t.name} ({t.year})
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Creating..." : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No users yet. Add one above to get started.</p>
        ) : (
          <ul style={{ listStyle: "none" }}>
            {list.map((u) => (
              <li key={u.id} style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                {editingId === u.id ? (
                  <UserEditForm
                    user={u}
                    onSave={(data) => onUpdateSubmit(u.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                      <strong>{u.username}</strong>
                      {u.full_name && <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>({u.full_name})</span>}
                      <span style={{ marginLeft: "0.5rem" }}>{u.role}</span>
                      <span style={{ marginLeft: "0.5rem", color: u.is_active ? "var(--success)" : "var(--muted)" }}>
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="button" className="btn" onClick={() => setEditingId(u.id)}>Edit</button>
                      <button type="button" className="btn" onClick={() => onDelete(u.id)} style={{ color: "var(--error)" }}>Delete</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
  return content;
}

function UserEditForm({
  user,
  onSave,
  onCancel,
}: {
  user: UserRow;
  onSave: (data: UpdateFormData) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      email: user.email ?? "",
      full_name: user.full_name ?? "",
      password: "",
      role: (user.role === "USER" || user.role === "REPORT_VIEWER" ? user.role : "USER") as "USER" | "REPORT_VIEWER",
      is_active: user.is_active,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSave)} style={{ width: "100%" }}>
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
        <input type="password" {...register("password")} />
        {errors.password && <p className="form-error">{errors.password.message}</p>}
      </div>
      <div className="form-group">
        <label>Role</label>
        <select {...register("role")}>
          <option value="USER">USER</option>
          <option value="REPORT_VIEWER">REPORT_VIEWER</option>
        </select>
      </div>
      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" {...register("is_active")} />
          Active
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
