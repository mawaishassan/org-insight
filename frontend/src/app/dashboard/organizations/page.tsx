"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

/** Settings icon (gear) for organization card - links to org Settings tab. */
function SettingsIcon({ orgId }: { orgId: number }) {
  return (
    <Link
      href={`/dashboard/organizations/${orgId}?tab=settings&sub=organization`}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, color: "var(--muted)", textDecoration: "none" }}
      title="Settings"
      aria-label="Settings"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </Link>
  );
}

interface FilterOption {
  id: number;
  name: string;
}

interface FilterOptions {
  domains: FilterOption[];
  kpis: FilterOption[];
  categories: FilterOption[];
  tags: FilterOption[];
}

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

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  admin_username: z.string().min(1, "Admin username required"),
  admin_password: z.string().min(8, "Password at least 8 characters"),
  admin_email: z.union([z.string().email(), z.literal("")]).optional(),
  admin_full_name: z.string().optional(),
});

type CreateFormData = z.infer<typeof createSchema>;

function buildQuery(params: {
  name?: string;
  is_active?: string;
  domain_id?: string;
  kpi_id?: string;
  category_id?: string;
  organization_tag_id?: string;
}): string {
  const search = new URLSearchParams();
  if (params.name?.trim()) search.set("name", params.name.trim());
  if (params.is_active === "true") search.set("is_active", "true");
  if (params.is_active === "false") search.set("is_active", "false");
  if (params.domain_id) search.set("domain_id", params.domain_id);
  if (params.kpi_id) search.set("kpi_id", params.kpi_id);
  if (params.category_id) search.set("category_id", params.category_id);
  if (params.organization_tag_id) search.set("organization_tag_id", params.organization_tag_id);
  return search.toString();
}

export default function OrganizationsPage() {
  const [list, setList] = useState<OrgWithSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ domains: [], kpis: [], categories: [], tags: [] });
  const [filterName, setFilterName] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterDomainId, setFilterDomainId] = useState<string>("");
  const [filterKpiId, setFilterKpiId] = useState<string>("");
  const [filterCategoryId, setFilterCategoryId] = useState<string>("");
  const [filterTagId, setFilterTagId] = useState<string>("");

  const token = getAccessToken();

  const loadList = () => {
    if (!token) return;
    setLoading(true);
    const query = buildQuery({
      name: filterName || undefined,
      is_active: filterStatus || undefined,
      domain_id: filterDomainId || undefined,
      kpi_id: filterKpiId || undefined,
      category_id: filterCategoryId || undefined,
      organization_tag_id: filterTagId || undefined,
    });
    api<OrgWithSummary[]>(`/organizations?with_summary=true${query ? `&${query}` : ""}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadList();
  }, [filterName, filterStatus, filterDomainId, filterKpiId, filterCategoryId, filterTagId]);

  useEffect(() => {
    if (!token) return;
    api<FilterOptions>("/organizations/filter-options", { token })
      .then(setFilterOptions)
      .catch(() => setFilterOptions({ domains: [], kpis: [], categories: [], tags: [] }));
  }, [token]);

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

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1rem",
          padding: "0.75rem",
          background: "var(--bg-subtle)",
          borderRadius: "8px",
          border: "1px solid var(--border)",
        }}
      >
        <input
          type="search"
          placeholder="Search organizations…"
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          style={{
            padding: "0.4rem 0.6rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            fontSize: "0.9rem",
            minWidth: "160px",
          }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem", minWidth: "100px" }}
        >
          <option value="">All status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <select
          value={filterDomainId}
          onChange={(e) => setFilterDomainId(e.target.value)}
          style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem", minWidth: "120px" }}
        >
          <option value="">All domains</option>
          {filterOptions.domains.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select
          value={filterKpiId}
          onChange={(e) => setFilterKpiId(e.target.value)}
          style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem", minWidth: "120px" }}
        >
          <option value="">All KPIs</option>
          {filterOptions.kpis.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>
        <select
          value={filterCategoryId}
          onChange={(e) => setFilterCategoryId(e.target.value)}
          style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem", minWidth: "120px" }}
        >
          <option value="">All categories</option>
          {filterOptions.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filterTagId}
          onChange={(e) => setFilterTagId(e.target.value)}
          style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem", minWidth: "100px" }}
        >
          <option value="">All tags</option>
          {filterOptions.tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
              <Link
                href={`/dashboard/organizations/${o.id}`}
                style={{ textDecoration: "none", color: "inherit", flex: 1, minWidth: 0 }}
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
              <SettingsIcon orgId={o.id} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
