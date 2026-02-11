"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, canEditDomainsAndCategories, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";
import { KpiCardsGrid } from "@/components/KpiCardsGrid";

interface DomainInfo {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  sort_order: number;
}

interface CategoryRow {
  id: number;
  domain_id: number;
  name: string;
  description: string | null;
  sort_order: number;
  kpi_count?: number;
}

interface OrgTagRow {
  id: number;
  organization_id: number;
  name: string;
}

interface CategoryTagRef {
  id: number;
  name: string;
  domain_id?: number | null;
  domain_name?: string | null;
}

interface OrganizationTagRef {
  id: number;
  name: string;
}

interface KpiRow {
  id: number;
  name: string;
  description: string | null;
  year: number;
  sort_order: number;
  category_tags?: CategoryTagRef[];
  organization_tags?: OrganizationTagRef[];
}

interface ReportTemplateRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  year: number;
}

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  sort_order: z.coerce.number().int().min(0),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  sort_order: z.coerce.number().int().min(0),
});

type CreateFormData = z.infer<typeof createSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

export default function DomainDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const domainId = Number(params.id);
  const orgIdParam = searchParams.get("organization_id");
  const organizationId = orgIdParam ? Number(orgIdParam) : undefined;

  const token = getAccessToken();
  const [domain, setDomain] = useState<DomainInfo | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [domainTemplates, setDomainTemplates] = useState<ReportTemplateRow[]>([]);
  const [allTemplates, setAllTemplates] = useState<ReportTemplateRow[]>([]);
  const [attachTemplateId, setAttachTemplateId] = useState<number | "">("");
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [orgTags, setOrgTags] = useState<OrgTagRow[]>([]);
  const [kpiFilterTagId, setKpiFilterTagId] = useState<number | "">("");
  const [kpiFilterName, setKpiFilterName] = useState("");
  const [kpiFilterCategoryId, setKpiFilterCategoryId] = useState<number | "">("");

  const canEdit = userRole !== null && canEditDomainsAndCategories(userRole);
  const effectiveOrgId = organizationId ?? meOrgId ?? domain?.organization_id ?? undefined;

  const loadDomain = () => {
    if (!token || !domainId) return;
    const query = organizationId != null ? `?${qs({ organization_id: organizationId })}` : "";
    api<DomainInfo>(`/domains/${domainId}${query}`, { token })
      .then(setDomain)
      .catch(() => setDomain(null));
  };

  const loadCategories = () => {
    if (!token || !domainId) return;
    const query = `?${qs({ domain_id: domainId, ...(organizationId != null && { organization_id: organizationId }) })}`;
    api<CategoryRow[]>(`/categories${query}`, { token })
      .then(setCategories)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load categories"));
  };


  const loadKpis = () => {
    if (!token || effectiveOrgId == null || !domainId) return;
    const params: Record<string, string | number> = { organization_id: effectiveOrgId, domain_id: domainId };
    if (kpiFilterTagId !== "") params.organization_tag_id = kpiFilterTagId;
    if (kpiFilterCategoryId !== "") params.category_id = kpiFilterCategoryId;
    api<KpiRow[]>(`/kpis?${qs(params)}`, { token })
      .then(setKpis)
      .catch(() => setKpis([]));
  };

  const loadOrgTags = () => {
    if (!token || effectiveOrgId == null) return;
    api<OrgTagRow[]>(`/organizations/${effectiveOrgId}/tags`, { token })
      .then(setOrgTags)
      .catch(() => setOrgTags([]));
  };

  const loadDomainTemplates = () => {
    if (!token || effectiveOrgId == null || !domainId) return;
    api<ReportTemplateRow[]>(`/reports/domains/${domainId}/templates?${qs({ organization_id: effectiveOrgId })}`, { token })
      .then(setDomainTemplates)
      .catch(() => setDomainTemplates([]));
  };

  const loadAllTemplates = () => {
    if (!token || effectiveOrgId == null) return;
    api<ReportTemplateRow[]>(`/reports/templates?${qs({ organization_id: effectiveOrgId })}`, { token })
      .then(setAllTemplates)
      .catch(() => setAllTemplates([]));
  };

  const filteredKpis = useMemo(() => {
    const searchLower = kpiFilterName.trim().toLowerCase();
    if (!searchLower) return kpis;
    return kpis.filter((k) => k.name.toLowerCase().includes(searchLower));
  }, [kpis, kpiFilterName]);

  useEffect(() => {
    loadDomain();
  }, [domainId, organizationId]);

  useEffect(() => {
    loadCategories();
    setLoading(false);
  }, [domainId, organizationId]);

  useEffect(() => {
    if (!token) return;
    api<{ role: UserRole; organization_id: number | null }>("/auth/me", { token })
      .then((me) => {
        setUserRole(me.role);
        setMeOrgId(me.organization_id ?? null);
      })
      .catch(() => {
        setUserRole(null);
        setMeOrgId(null);
      });
  }, [token]);

  useEffect(() => {
    if (effectiveOrgId != null) loadOrgTags();
  }, [effectiveOrgId]);

  useEffect(() => {
    loadDomainTemplates();
    if (userRole === "SUPER_ADMIN") loadAllTemplates();
  }, [effectiveOrgId, domainId, userRole]);

  useEffect(() => {
    setKpis([]);
  }, [domainId]);

  const onAttachTemplate = async () => {
    if (!token || effectiveOrgId == null || attachTemplateId === "" || !domainId) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await api(`/reports/templates/${attachTemplateId}/domains/${domainId}?${qs({ organization_id: effectiveOrgId })}`, {
        method: "POST",
        token,
      });
      setAttachTemplateId("");
      loadDomainTemplates();
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : "Failed to attach");
    } finally {
      setAttaching(false);
    }
  };

  useEffect(() => {
    if (!canEdit && effectiveOrgId != null && domainId) loadKpis();
  }, [canEdit, effectiveOrgId, domainId, kpiFilterTagId, kpiFilterCategoryId]);

  const onCreateCategory = async (data: CreateFormData) => {
    if (!token || !domainId) return;
    setError(null);
    try {
      const query = `?${qs({ domain_id: domainId, ...(organizationId != null && { organization_id: organizationId }) })}`;
      await api(`/categories${query}`, {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          sort_order: data.sort_order,
        }),
        token,
      });
      createForm.reset({ name: "", description: "", sort_order: categories.length });
      setShowCreate(false);
      loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateCategory = async (categoryId: number, data: UpdateFormData) => {
    if (!token || !domainId) return;
    try {
      const query = `?${qs({ domain_id: domainId, ...(organizationId != null && { organization_id: organizationId }) })}`;
      await api(`/categories/${categoryId}${query}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          sort_order: data.sort_order,
        }),
        token,
      });
      setEditingId(null);
      loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDeleteCategory = async (categoryId: number) => {
    if (!token || !domainId) return;
    if (!confirm("Delete this category? KPI associations will be removed.")) return;
    try {
      const query = `?${qs({ domain_id: domainId, ...(organizationId != null && { organization_id: organizationId }) })}`;
      await api(`/categories/${categoryId}${query}`, { method: "DELETE", token });
      setEditingId(null);
      loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", description: "", sort_order: 0 },
  });

  if (!domainId || isNaN(domainId)) {
    return (
      <div>
        <p className="form-error">Invalid domain.</p>
        <Link href="/dashboard/domains">Back to Domains</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        {organizationId != null ? (
          <Link href={`/dashboard/organizations/${organizationId}`} style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {"\u2190"} Back to Organization
          </Link>
        ) : (
          <Link href="/dashboard/domains" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {"\u2190"} Domains
          </Link>
        )}
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        {domain ? domain.name : `Domain #${domainId}`}
      </h1>
      {domain?.description && (
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>{domain.description}</p>
      )}

      {!canEdit && effectiveOrgId != null && (
        <>
          <h2 style={{ fontSize: "1.1rem", marginTop: "0.5rem", marginBottom: "0.75rem" }}>KPIs</h2>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end", marginBottom: "0.75rem" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: "0.9rem" }}>Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  style={{ minWidth: "100px" }}
                >
                  {Array.from({ length: 11 }, (_, i) => currentYear - 5 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: "0.9rem" }}>Name</label>
                <input
                  type="text"
                  placeholder="Search by name..."
                  value={kpiFilterName}
                  onChange={(e) => setKpiFilterName(e.target.value)}
                  style={{ minWidth: "160px" }}
                />
              </div>
              {orgTags.length > 0 && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.9rem" }}>Tag</label>
                  <select
                    value={kpiFilterTagId}
                    onChange={(e) => setKpiFilterTagId(e.target.value === "" ? "" : Number(e.target.value))}
                    style={{ minWidth: "140px" }}
                  >
                    <option value="">All tags</option>
                    {orgTags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {categories.length > 0 && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.9rem" }}>Category</label>
                  <select
                    value={kpiFilterCategoryId}
                    onChange={(e) => setKpiFilterCategoryId(e.target.value === "" ? "" : Number(e.target.value))}
                    style={{ minWidth: "160px" }}
                  >
                    <option value="">All categories</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <button type="button" className="btn btn-primary" onClick={() => loadKpis()}>
                Apply filters
              </button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: 0 }}>
              {filteredKpis.length} of {kpis.length} KPI{filteredKpis.length === 1 ? "" : "s"}
              {(kpiFilterName.trim() || kpiFilterTagId !== "" || kpiFilterCategoryId !== "") && " (filtered)"}
            </p>
          </div>
          {effectiveOrgId != null && (
            <KpiCardsGrid
              organizationId={effectiveOrgId}
              year={selectedYear}
              domainId={domainId}
              kpisOverride={filteredKpis}
              filterName={kpiFilterName}
              emptyMessage={kpis.length === 0 ? "No KPIs in this domain." : "No KPIs match the filters."}
            />
          )}
        </>
      )}

      {effectiveOrgId != null && (
        <>
          <h2 style={{ fontSize: "1.1rem", margin: "1.25rem 0 0.75rem" }}>Reports</h2>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Reports attached to this domain can be viewed and printed by Organization Admins.
            </p>
            {userRole === "SUPER_ADMIN" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end", marginBottom: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Attach template</label>
                  <select value={attachTemplateId} onChange={(e) => setAttachTemplateId(e.target.value ? Number(e.target.value) : "")} style={{ minWidth: "220px" }}>
                    <option value="">— Select template —</option>
                    {allTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} (Year {t.year})</option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn-primary" onClick={onAttachTemplate} disabled={attaching || attachTemplateId === ""}>
                  {attaching ? "Attaching…" : "Attach"}
                </button>
                {attachError && <p className="form-error" style={{ margin: 0 }}>{attachError}</p>}
              </div>
            )}
            {domainTemplates.length === 0 ? (
              <p style={{ color: "var(--muted)", marginBottom: 0 }}>No reports attached yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {domainTemplates.map((t) => (
                  <li key={t.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                      <div>
                        <strong>{t.name}</strong>
                        <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>Year {t.year}</span>
                        {t.description && <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{t.description}</div>}
                      </div>
                      <Link className="btn btn-primary" href={`/dashboard/reports/${t.id}`}>
                        View / Print
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {canEdit && (
        <>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Categories</h2>
          {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{categories.length} categories</span>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
              {showCreate ? "Cancel" : "Add category"}
            </button>
          </div>

          {showCreate && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3 style={{ marginBottom: "0.75rem", fontSize: "1rem" }}>Create category</h3>
              <form onSubmit={createForm.handleSubmit(onCreateCategory)}>
                <div className="form-group">
                  <label>Name *</label>
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
                  <label>Sort order</label>
                  <input type="number" min={0} {...createForm.register("sort_order")} />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                    Create
                  </button>
                  <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
            {categories.map((c) => (
              <div key={c.id} className="card" style={{ marginBottom: 0 }}>
                {editingId === c.id ? (
                  <CategoryEditForm
                    category={c}
                    onSave={(data) => onUpdateCategory(c.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div style={{ marginBottom: "0.5rem" }}>
                      <strong>{c.name}</strong>
                      {c.description && (
                        <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>{c.description}</p>
                      )}
                      <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Order: {c.sort_order}</span>
                      <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", fontWeight: 500 }}>
                        {c.kpi_count != null ? c.kpi_count : 0} KPI{(c.kpi_count != null ? c.kpi_count : 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                      <Link
                        href={
                          effectiveOrgId != null
                            ? `/dashboard/domains/${domainId}/categories/${c.id}/attach-kpis?organization_id=${effectiveOrgId}`
                            : `/dashboard/domains/${domainId}/categories/${c.id}/attach-kpis`
                        }
                        className="btn btn-primary"
                        style={{ textDecoration: "none" }}
                      >
                        Attach KPIs
                      </Link>
                      <button type="button" className="btn" onClick={() => setEditingId(c.id)}>Edit</button>
                      <button type="button" className="btn" onClick={() => onDeleteCategory(c.id)} style={{ color: "var(--error)" }}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {categories.length === 0 && !showCreate && (
            <p style={{ color: "var(--muted)" }}>No categories yet. Add one above.</p>
          )}
        </>
      )}
    </div>
  );
}

function CategoryEditForm({
  category,
  onSave,
  onCancel,
}: {
  category: CategoryRow;
  onSave: (data: UpdateFormData) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      name: category.name,
      description: category.description ?? "",
      sort_order: category.sort_order,
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
        <label>Sort order</label>
        <input type="number" min={0} {...register("sort_order")} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>Save</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
