"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  type UserKpiAssignmentRow,
  type KpiPermission,
  type KpiGroup,
  qs,
  groupKpisByName,
  kpiAssignmentsToMap,
  buildKpiAssignmentsPayload,
} from "../shared";
import { KpiRightsTable } from "../KpiRightsTable";

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
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  full_name: z.string().optional(),
  password: z.string().min(8, "Min 8 characters").optional().or(z.literal("")),
  role: z.enum(["USER", "REPORT_VIEWER"]),
  is_active: z.boolean(),
});

type UpdateFormData = z.infer<typeof updateSchema>;

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id ? Number(params.id) : NaN;
  const token = getAccessToken();

  const [user, setUser] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KpiOption[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [orgTags, setOrgTags] = useState<OrgTagOption[]>([]);
  const [kpiFilterName, setKpiFilterName] = useState("");
  const [kpiFilterDomainId, setKpiFilterDomainId] = useState<number | "">("");
  const [kpiFilterCategoryId, setKpiFilterCategoryId] = useState<number | "">("");
  const [kpiFilterTagId, setKpiFilterTagId] = useState<number | "">("");
  const [kpiFilterRights, setKpiFilterRights] = useState<string>("all");
  const [kpiPermissions, setKpiPermissions] = useState<Record<number, KpiPermission>>({});
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  const form = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      email: "",
      full_name: "",
      password: "",
      role: "USER",
      is_active: true,
    },
  });

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
          email: u.email ?? "",
          full_name: u.full_name ?? "",
          password: "",
          role: (u.role === "USER" || u.role === "REPORT_VIEWER" ? u.role : "USER") as "USER" | "REPORT_VIEWER",
          is_active: u.is_active,
        });
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "User not found");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token, userId]);

  const orgId = user?.organization_id ?? null;

  useEffect(() => {
    if (!token || !orgId) return;
    api<DomainOption[]>(`/domains?${qs({ organization_id: orgId })}`, { token }).then(setDomains).catch(() => setDomains([]));
  }, [token, orgId]);

  useEffect(() => {
    if (!token || !orgId) return;
    api<CategoryOption[]>(`/categories?${qs({ organization_id: orgId })}`, { token }).then(setCategories).catch(() => setCategories([]));
  }, [token, orgId]);

  useEffect(() => {
    if (!token || !orgId) return;
    api<OrgTagOption[]>(`/organizations/${orgId}/tags`, { token }).then(setOrgTags).catch(() => setOrgTags([]));
  }, [token, orgId]);

  useEffect(() => {
    if (!token || !orgId) return;
    const params: Record<string, string | number> = { organization_id: orgId };
    if (kpiFilterName?.trim()) params.name = kpiFilterName.trim();
    if (kpiFilterDomainId !== "") params.domain_id = kpiFilterDomainId;
    if (kpiFilterCategoryId !== "") params.category_id = kpiFilterCategoryId;
    if (kpiFilterTagId !== "") params.organization_tag_id = kpiFilterTagId;
    const query = qs(params);
    api<KpiOption[]>(`/kpis?${query}`, { token }).then(setKpis).catch(() => setKpis([]));
  }, [token, orgId, kpiFilterName, kpiFilterDomainId, kpiFilterCategoryId, kpiFilterTagId]);

  useEffect(() => {
    if (!token || !Number.isInteger(userId) || kpis.length === 0) return;
    setAssignmentsLoading(true);
    api<UserKpiAssignmentRow[]>(`/users/${userId}/kpi-assignments`, { token })
      .then((assignments) => setKpiPermissions(kpiAssignmentsToMap(assignments)))
      .catch(() => setKpiPermissions({}))
      .finally(() => setAssignmentsLoading(false));
  }, [token, userId, kpis.length]);

  const onSaveGeneral = async (data: UpdateFormData) => {
    if (!token || !user) return;
    setError(null);
    try {
      const body: Record<string, unknown> = {
        email: data.email || null,
        full_name: data.full_name || null,
        role: data.role,
        is_active: data.is_active,
      };
      if (data.password && data.password.length >= 8) body.password = data.password;
      const updated = await api<UserRow>(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      });
      setUser(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onSaveKpiRights = async () => {
    if (!token || !user) return;
    setError(null);
    try {
      const payload = buildKpiAssignmentsPayload(kpiPermissions);
      await api(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ kpi_assignments: payload }),
        token,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async () => {
    if (!token || !user || !confirm("Delete this user? This cannot be undone.")) return;
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: "DELETE", token });
      router.push("/dashboard/users");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading && !user) return <p>Loading...</p>;
  if (!user) return <div><p className="form-error">{error ?? "User not found"}</p><Link href="/dashboard/users">Users</Link></div>;

  const allGroups = groupKpisByName(kpis);
  const getGroupPerm = (g: KpiGroup) => (g.kpiIds[0] != null ? (kpiPermissions[g.kpiIds[0]] ?? "") : "") as KpiPermission;
  const filteredGroups =
    kpiFilterRights === "all"
      ? allGroups
      : allGroups.filter((g) => getGroupPerm(g) === kpiFilterRights);

  const categoriesForDomain =
    kpiFilterDomainId !== ""
      ? categories.filter((c) => c.domain_id === kpiFilterDomainId)
      : categories;

  return (
    <div>
      {error && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{error}</p>}

      {/* Section 1: General user information — compact, all fields including username/role/active */}
      <section className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1rem", margin: 0, fontWeight: 600 }}>General information</h2>
          <button type="button" className="btn" onClick={onDelete} style={{ color: "var(--error)", fontSize: "0.85rem", padding: "0.35rem 0.6rem" }}>Delete user</button>
        </div>
        <form onSubmit={form.handleSubmit(onSaveGeneral)}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.5rem 1.25rem", maxWidth: "560px" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Username</label>
              <div style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem", color: "var(--muted)", background: "var(--bg-subtle)", borderRadius: 6, border: "1px solid var(--border)" }}>{user.username}</div>
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
              <input type="email" {...form.register("email")} style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
              {form.formState.errors.email && <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>{form.formState.errors.email.message}</p>}
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>Full name</label>
              <input {...form.register("full_name")} style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: "0.85rem" }}>New password (leave blank to keep)</label>
              <input type="password" {...form.register("password")} style={{ padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
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
          </div>
          <button type="submit" className="btn btn-primary" disabled={form.formState.isSubmitting} style={{ marginTop: "0.5rem", fontSize: "0.9rem", padding: "0.4rem 0.75rem" }}>
            {form.formState.isSubmitting ? "Saving..." : "Save"}
          </button>
        </form>
      </section>

      {/* Section 2: KPI rights with filter bar */}
      <section className="card" style={{ padding: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem", fontWeight: 600 }}>KPI rights</h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            flexWrap: "wrap",
            marginBottom: "0.75rem",
          }}
        >
          <input
            type="search"
            placeholder="Search KPIs…"
            value={kpiFilterName}
            onChange={(e) => setKpiFilterName(e.target.value)}
            style={{
              padding: "0.35rem 0.6rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              fontSize: "0.85rem",
              width: "clamp(120px, 20vw, 200px)",
            }}
          />
          <select
            value={kpiFilterDomainId}
            onChange={(e) => {
              setKpiFilterDomainId(e.target.value === "" ? "" : Number(e.target.value));
              setKpiFilterCategoryId("");
            }}
            style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 100 }}
          >
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            value={kpiFilterCategoryId}
            onChange={(e) => setKpiFilterCategoryId(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 100 }}
          >
            <option value="">All categories</option>
            {categoriesForDomain.map((c) => (
              <option key={c.id} value={c.id}>{c.domain_name ? `${c.name} (${c.domain_name})` : c.name}</option>
            ))}
          </select>
          {orgTags.length > 0 && (
            <select
              value={kpiFilterTagId}
              onChange={(e) => setKpiFilterTagId(e.target.value === "" ? "" : Number(e.target.value))}
              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 90 }}
            >
              <option value="">All tags</option>
              {orgTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          <select
            value={kpiFilterRights}
            onChange={(e) => setKpiFilterRights(e.target.value)}
            style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 120 }}
          >
            <option value="all">All status</option>
            <option value="data_entry">Data entry</option>
            <option value="view">View only</option>
            <option value="">No access</option>
          </select>
        </div>
        {assignmentsLoading ? (
          <p style={{ color: "var(--muted)" }}>Loading assignments...</p>
        ) : (
          <>
            <KpiRightsTable
              groups={filteredGroups}
              permissions={kpiPermissions}
              setPermissions={setKpiPermissions}
            />
            <div style={{ marginTop: "1rem" }}>
              <button type="button" className="btn btn-primary" onClick={onSaveKpiRights}>
                Save KPI rights
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
