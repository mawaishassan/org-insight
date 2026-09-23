"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import {
  type UserRow,
  type KpiOption,
  type DomainOption,
  type ReportTemplateOption,
  type KpiPermission,
  qs,
  groupKpisByName,
  buildKpiAssignmentsPayload,
} from "./shared";
import { KpiRightsTable } from "./KpiRightsTable";

const createSchema = z.object({
  username: z.string().min(1, "Username required"),
  password: z.string().min(8, "Password at least 8 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  full_name: z.string().optional(),
  role: z.enum(["USER", "REPORT_VIEWER"]),
});

type CreateFormData = z.infer<typeof createSchema>;

export default function UsersPage() {
  const searchParams = useSearchParams();
  const orgIdFromQuery = searchParams?.get("organization_id");

  const [list, setList] = useState<UserRow[]>([]);
  const [kpis, setKpis] = useState<KpiOption[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [templates, setTemplates] = useState<ReportTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [kpiFilterDomainId, setKpiFilterDomainId] = useState<number | "">("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const token = getAccessToken();

  const loadList = () => {
    if (!token) return;
    setError(null);
    const query = orgIdFromQuery ? `?organization_id=${orgIdFromQuery}` : "";
    api<UserRow[]>(`/users${query}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    api<{ role: string }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  useEffect(() => {
    loadList();
  }, [token, orgIdFromQuery]);

  useEffect(() => {
    if (!token) return;
    const query = orgIdFromQuery ? `?organization_id=${orgIdFromQuery}` : "";
    api<DomainOption[]>(`/domains${query}`, { token }).then(setDomains).catch(() => setDomains([]));
    api<ReportTemplateOption[]>(`/reports/templates${query}`, { token }).then(setTemplates).catch(() => setTemplates([]));
  }, [token, orgIdFromQuery]);

  useEffect(() => {
    if (!token) return;
    const params: Record<string, string | number> = {};
    if (kpiFilterDomainId !== "") params.domain_id = kpiFilterDomainId;
    if (orgIdFromQuery) params.organization_id = orgIdFromQuery;
    const query = qs(params);
    api<KpiOption[]>(`/kpis${query ? `?${query}` : ""}`, { token }).then(setKpis).catch(() => setKpis([]));
  }, [token, kpiFilterDomainId, orgIdFromQuery]);

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

  const [createKpiPermissions, setCreateKpiPermissions] = useState<Record<number, KpiPermission>>({});
  const [createReportIds, setCreateReportIds] = useState<number[]>([]);

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token) return;
    setError(null);
    try {
      const kpi_assignments = buildKpiAssignmentsPayload(createKpiPermissions);
      await api("/users", {
        method: "POST",
        body: JSON.stringify({
          username: data.username,
          password: data.password,
          email: data.email || null,
          full_name: data.full_name || null,
          role: data.role,
          ...(orgIdFromQuery ? { organization_id: Number(orgIdFromQuery) } : {}),
          ...(kpi_assignments.length > 0 ? { kpi_assignments } : {}),
          report_template_ids: createReportIds,
        }),
        token,
      });
      createForm.reset({ username: "", password: "", email: "", full_name: "", role: "USER" });
      setCreateKpiPermissions({});
      setCreateReportIds([]);
      setShowCreate(false);
      loadList();
      toast.success("User created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  if (loading && list.length === 0) return <p>Loading...</p>;

  return (
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
            {userRole === "ORG_ADMIN" && (
              <div className="form-group">
                <label>KPI rights (optional)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem" }}>
                    Domain
                    <select
                      value={kpiFilterDomainId}
                      onChange={(e) => setKpiFilterDomainId(e.target.value === "" ? "" : Number(e.target.value))}
                      style={{ padding: "0.35rem 0.5rem", minWidth: "10rem" }}
                    >
                      <option value="">All domains</option>
                      {domains.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <KpiRightsTable
                  groups={groupKpisByName(kpis)}
                  permissions={createKpiPermissions}
                  setPermissions={setCreateKpiPermissions}
                  disabled={createForm.formState.isSubmitting}
                />
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

      {list.length > 0 && (
        <div style={{ marginBottom: "1rem", position: "relative", maxWidth: "360px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users by name, username, email..."
            style={{
              width: "100%",
              padding: "0.4rem 0.65rem",
              fontSize: "0.85rem",
              borderRadius: "6px",
              border: "1px solid var(--border, #cbd5e1)",
              background: "var(--surface, #ffffff)",
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: "0.4rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "var(--muted, #94a3b8)",
                fontSize: "0.85rem",
                cursor: "pointer",
                padding: "0 0.2rem",
              }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No users yet. Add one above to get started.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {list
            .filter((u) => {
              if (!searchQuery.trim()) return true;
              const q = searchQuery.trim().toLowerCase();
              return (
                (u.username || "").toLowerCase().includes(q) ||
                (u.full_name || "").toLowerCase().includes(q) ||
                (u.email || "").toLowerCase().includes(q) ||
                (u.role || "").toLowerCase().includes(q)
              );
            })
            .map((u) => (
            <Link
              key={u.id}
              href={`/dashboard/users/${u.id}${orgIdFromQuery ? `?organization_id=${orgIdFromQuery}` : ""}`}
              style={{ textDecoration: "none", color: "inherit" }}
              className="card"
            >
              <div style={{ padding: "1rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                  <strong style={{ fontSize: "1.05rem" }}>{u.username}</strong>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.2rem 0.45rem",
                      borderRadius: "6px",
                      background: u.is_active ? "var(--success)" : "var(--border)",
                      color: u.is_active ? "var(--on-muted)" : "var(--muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                {u.full_name && (
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "var(--text-secondary)" }}>{u.full_name}</p>
                )}
                {u.email && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.email}
                  </p>
                )}
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.8rem", padding: "0.15rem 0.4rem", background: "var(--border)", borderRadius: "4px" }}>
                    {u.role}
                  </span>
                  {u.is_external ? (
                    <span
                      style={{
                        fontSize: "0.72rem",
                        padding: "0.15rem 0.45rem",
                        borderRadius: "4px",
                        background: "rgba(139, 92, 246, 0.12)",
                        color: "#7c3aed",
                        fontWeight: 600,
                        border: "1px solid rgba(139, 92, 246, 0.25)",
                      }}
                    >
                      External (LMS)
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "0.72rem",
                        padding: "0.15rem 0.45rem",
                        borderRadius: "4px",
                        background: "rgba(59, 130, 246, 0.1)",
                        color: "#2563eb",
                        fontWeight: 600,
                        border: "1px solid rgba(59, 130, 246, 0.2)",
                      }}
                    >
                      System
                    </span>
                  )}
                </div>
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>Click to view details & manage KPI rights</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
