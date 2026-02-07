"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
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
  const [list, setList] = useState<UserRow[]>([]);
  const [kpis, setKpis] = useState<KpiOption[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [templates, setTemplates] = useState<ReportTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [kpiFilterDomainId, setKpiFilterDomainId] = useState<number | "">("");

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
    api<DomainOption[]>("/domains", { token }).then(setDomains).catch(() => setDomains([]));
    api<ReportTemplateOption[]>("/reports/templates", { token }).then(setTemplates).catch(() => setTemplates([]));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const params: Record<string, string | number> = {};
    if (kpiFilterDomainId !== "") params.domain_id = kpiFilterDomainId;
    const query = qs(params);
    api<KpiOption[]>(`/kpis${query ? `?${query}` : ""}`, { token }).then(setKpis).catch(() => setKpis([]));
  }, [token, kpiFilterDomainId]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
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

      {list.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No users yet. Add one above to get started.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {list.map((u) => (
            <Link
              key={u.id}
              href={`/dashboard/users/${u.id}`}
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
                <div style={{ marginTop: "0.5rem" }}>
                  <span style={{ fontSize: "0.8rem", padding: "0.15rem 0.4rem", background: "var(--border)", borderRadius: "4px" }}>
                    {u.role}
                  </span>
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
