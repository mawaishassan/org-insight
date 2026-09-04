"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import {
  type UserRow,
} from "../shared";

interface CategoryOption {
  id: number;
  domain_id: number;
  name: string;
  domain_name?: string | null;
}

interface OrgTagOption {
  id: number;
  name: string;
}

const updateSchema = z.object({
  username: z.string().min(1, "Username required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  full_name: z.string().optional(),
  password: z.string().min(8, "Min 8 characters").optional().or(z.literal("")),
  role: z.enum(["USER", "REPORT_VIEWER"]),
  is_active: z.boolean(),
  unique_user_key: z.string().optional().or(z.literal("")),
  force_password_reset: z.boolean().optional(),
});

type UpdateFormData = z.infer<typeof updateSchema>;

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id ? Number(params.id) : NaN;
  const token = getAccessToken();

  const [user, setUser] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  const form = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      username: "",
      email: "",
      full_name: "",
      password: "",
      role: "USER",
      is_active: true,
      unique_user_key: "",
      force_password_reset: false,
    },
  });

  useEffect(() => {
    if (!token) return;
    api<{ role: string }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  useEffect(() => {
    if (!token || !Number.isInteger(userId)) {
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    api<UserRow>(`/users/${userId}`, { token })
      .then((u) => {
        setUser(u);
        form.reset({
          username: u.username ?? "",
          email: u.email ?? "",
          full_name: u.full_name ?? "",
          password: "",
          role: (u.role === "USER" || u.role === "REPORT_VIEWER" ? u.role : "USER") as "USER" | "REPORT_VIEWER",
          is_active: u.is_active,
          unique_user_key: u.unique_user_key ?? "",
          force_password_reset: !!u.force_password_reset,
        });
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "User not found");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token, userId]);

  const orgId = user?.organization_id ?? null;

  const onSaveGeneral = async (data: UpdateFormData) => {
    if (!token || !user) return;
    setError(null);
    try {
      const body: Record<string, unknown> = {
        username: data.username,
        email: data.email || null,
        full_name: data.full_name || null,
        role: data.role,
        is_active: data.is_active,
        unique_user_key: data.unique_user_key || null,
        force_password_reset: data.force_password_reset ?? false,
      };
      if (data.password && data.password.length >= 8) body.password = data.password;
      const updated = await api<UserRow>(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      });
      setUser(updated);
      toast.success("User updated successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async () => {
    if (!token || !user || !confirm("Delete this user? This cannot be undone.")) return;
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: "DELETE", token });
      toast.success("User deleted successfully");
      router.push("/dashboard/access");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading && !user) return <p>Loading...</p>;
  if (!user) return <div><p className="form-error">{error ?? "User not found"}</p><Link href="/dashboard/access">Back to Access</Link></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.01rem" }}>
      {error && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{error}</p>}
      
      {/* Section 1: General user information — compact, all fields including username/role/active */}
      <section className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1rem", margin: 0, fontWeight: 600 }}>General information</h2>
          <button type="button" className="btn" onClick={onDelete} style={{ color: "var(--error)", fontSize: "0.85rem", padding: "0.35rem 0.6rem" }}>Delete user</button>
        </div>
        <form onSubmit={form.handleSubmit(onSaveGeneral)} autoComplete="off">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.5rem 1.25rem", maxWidth: "560px" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Username *</label>
              <input {...form.register("username")} autoComplete="username-off" style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
              {form.formState.errors.username && <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>{form.formState.errors.username.message}</p>}
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Role</label>
              <select {...form.register("role")} style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }}>
                <option value="USER">USER</option>
                <option value="REPORT_VIEWER">REPORT_VIEWER</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Email</label>
              <input type="email" {...form.register("email")} autoComplete="email-off" style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
              {form.formState.errors.email && <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>{form.formState.errors.email.message}</p>}
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Full name</label>
              <input {...form.register("full_name")} style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Unique user key</label>
              <input {...form.register("unique_user_key")} style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} placeholder="e.g. CS-001" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>New password (leave blank to keep)</label>
              <input type="password" {...form.register("password")} autoComplete="new-password" style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
              {form.formState.errors.password && <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>{form.formState.errors.password.message}</p>}
            </div>
            <div className="form-group" style={{ marginBottom: 0, display: "flex", alignItems: "flex-end", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.85rem", flex: "0 0 auto" }}>Active</label>
              <button
                type="button"
                role="switch"
                aria-checked={form.watch("is_active")}
                onClick={() => form.setValue("is_active", !form.getValues("is_active"))}
                style={{
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  border: "1px solid var(--border)",
                  background: form.watch("is_active") ? "var(--success)" : "var(--border)",
                  cursor: "pointer",
                  position: "relative",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: form.watch("is_active") ? 20 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "white",
                    boxShadow: "var(--shadow-sm)",
                    transition: "left 0.15s ease",
                  }}
                />
              </button>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{form.watch("is_active") ? "On" : "Off"}</span>
            </div>

            {/* Force Password Reset Field */}
            <div className="form-group" style={{ marginBottom: 0, display: "flex", alignItems: "flex-end", gap: "0.5rem" }}>
              <label style={{ fontSize: "0.85rem", flex: "0 0 auto" }}>Force Password Reset</label>
              <button
                type="button"
                role="switch"
                aria-checked={form.watch("force_password_reset")}
                onClick={() => form.setValue("force_password_reset", !form.getValues("force_password_reset"))}
                style={{
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  border: "1px solid var(--border)",
                  background: form.watch("force_password_reset") ? "#f59e0b" : "var(--border)",
                  cursor: "pointer",
                  position: "relative",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: form.watch("force_password_reset") ? 20 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "white",
                    boxShadow: "var(--shadow-sm)",
                    transition: "left 0.15s ease",
                  }}
                />
              </button>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: form.watch("force_password_reset") ? "#f59e0b" : "var(--muted)" }}>
                {form.watch("force_password_reset") ? "Yes (Required)" : "No"}
              </span>
            </div>
          </div>

          {/* Reset Status Tracker Banner */}
          {user && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.6rem 0.85rem",
                borderRadius: "8px",
                background: "var(--bg-subtle, rgba(255, 255, 255, 0.03))",
                border: "1px solid var(--border)",
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "var(--muted)" }}>Current Reset Status:</span>
              <span
                style={{
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  background:
                    user.reset_status === "Pending"
                      ? "rgba(245, 158, 11, 0.15)"
                      : user.reset_status === "Completed"
                      ? "rgba(16, 185, 129, 0.15)"
                      : "var(--border)",
                  color:
                    user.reset_status === "Pending"
                      ? "#f59e0b"
                      : user.reset_status === "Completed"
                      ? "#10b981"
                      : "var(--muted)",
                }}
              >
                {user.reset_status || "Not Required"}
              </span>
              {user.password_reset_requested_at && (
                <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                  Requested: {new Date(user.password_reset_requested_at).toLocaleDateString()}
                </span>
              )}
              {user.password_reset_completed_at && (
                <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                  Completed: {new Date(user.password_reset_completed_at).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button type="submit" className="btn btn-primary" disabled={form.formState.isSubmitting} style={{ fontSize: "0.9rem", padding: "0.4rem 0.75rem" }}>
              {form.formState.isSubmitting ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.9rem", padding: "0.4rem 0.75rem" }}
              onClick={() => router.push("/dashboard/access")}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>

      {/* KPI rights section removed */}
    </div>
  );
}
