"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, canEditKpis, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";

interface DomainRow {
  id: number;
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
  domain_name?: string;
}

interface DomainTagRef {
  id: number;
  name: string;
}

interface CategoryTagRef {
  id: number;
  name: string;
}

interface OrganizationTagRef {
  id: number;
  name: string;
}

interface KpiRow {
  id: number;
  organization_id?: number;
  domain_id: number | null;
  name: string;
  description: string | null;
  year: number;
  sort_order: number;
  entry_mode?: string;
  api_endpoint_url?: string | null;
  domain_tags: DomainTagRef[];
  category_tags: CategoryTagRef[];
  organization_tags?: OrganizationTagRef[];
  assigned_users?: AssignedUserRef[];
}

interface OrgTagRow {
  id: number;
  organization_id: number;
  name: string;
}

interface AssignedUserRef {
  id: number;
  username: string;
  full_name: string | null;
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
}

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  sort_order: z.coerce.number().int().min(0),
  entry_mode: z.enum(["manual", "api"]),
  api_endpoint_url: z.string().max(2048).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  sort_order: z.coerce.number().int().min(0),
  entry_mode: z.enum(["manual", "api"]),
  api_endpoint_url: z.string().max(2048).optional(),
});

type CreateFormData = z.infer<typeof createSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== 0);
  return new URLSearchParams(entries as Record<string, string>).toString();
}

interface ApiContractField {
  key: string;
  name: string;
  field_type: string;
  sub_field_keys?: string[];
  example_value?: unknown;
  accepted_value_hint?: string | null;
}

type ApiContract = Record<string, unknown>;

const contractBlockStyle = { marginTop: "0.5rem", padding: "0.75rem", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "0.85rem" } as const;

function ApiContractBlock({ contract }: { contract: ApiContract }) {
  const exampleBody = contract.example_request_body as Record<string, unknown> | undefined;
  const fields = (contract.fields ?? []) as ApiContractField[];
  const exampleResponse = contract.example_response as Record<string, unknown> | undefined;
  const hasDetails = Array.isArray(fields) && fields.length >= 1 && Boolean(exampleBody && exampleResponse);

  return React.createElement(
    "div",
    { style: contractBlockStyle },
    React.createElement("p", null, React.createElement("strong", null, "Request we send (POST)")),
    React.createElement("p", { style: { color: "var(--muted)", margin: "0.25rem 0 0.5rem 0" } }, "Body (JSON):"),
    React.createElement(
      "pre",
      { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" } },
      React.createElement(
        "code",
        null,
        JSON.stringify(exampleBody ?? { year: "int", kpi_id: "int", organization_id: "int" }, null, 2)
      )
    ),
    React.createElement("p", { style: { marginTop: "1rem" } }, React.createElement("strong", null, "Response your API must return")),
    React.createElement("p", { style: { color: "var(--muted)", margin: "0.25rem 0 0.5rem 0" } }, "Top-level: ", React.createElement("code", null, "year"), " (int), ", React.createElement("code", null, "values"), " (object – field_key to value). Override or append is chosen in the UI when you sync."),
    hasDetails && React.createElement(React.Fragment, null,
      React.createElement("p", { style: { marginTop: "0.75rem", fontWeight: 600 } }, "Fields to include in ", React.createElement("code", null, "values"), " (use exact key):"),
      React.createElement(
        "ul",
        { style: { margin: "0.25rem 0 0", paddingLeft: "1.25rem" } },
        fields.map((f) =>
          React.createElement(
            "li",
            { key: f.key, style: { marginBottom: "0.35rem" } },
            React.createElement("code", null, f.key),
            " — ",
            f.name,
            " ",
            React.createElement("strong", null, "(", f.field_type, ")"),
            f.field_type === "formula" && React.createElement("span", { style: { color: "var(--muted)", marginLeft: "0.35rem" } }, "(computed server-side – do not include in response)"),
            f.accepted_value_hint && React.createElement("span", { style: { color: "var(--muted)", marginLeft: "0.35rem" } }, "— Accepted: ", f.accepted_value_hint),
            f.sub_field_keys && f.sub_field_keys.length >= 1 && React.createElement("span", { style: { color: "var(--muted)" } }, " Row keys: ", f.sub_field_keys.join(", ")),
            f.field_type !== "formula" && f.example_value !== undefined && f.example_value !== null && React.createElement("div", { style: { marginTop: "0.2rem", padding: "0.35rem", background: "var(--bg)", borderRadius: 4, fontSize: "0.8rem" } }, "Example: ", React.createElement("code", null, typeof f.example_value === "object" ? JSON.stringify(f.example_value) : String(f.example_value)))
          )
        )
      ),
      React.createElement("p", { style: { marginTop: "0.75rem", fontWeight: 600 } }, "Full example response:"),
      React.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, React.createElement("code", null, JSON.stringify(exampleResponse, null, 2)))
    ),
    !hasDetails && React.createElement("pre", { style: { margin: "0.5rem 0 0", whiteSpace: "pre-wrap" } }, React.createElement("code", null, JSON.stringify({ year: "int", values: "object (field_key to value)" }, null, 2)))
  );
}

export default function KPIsPage() {
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organization_id") ? Number(searchParams.get("organization_id")) : undefined;
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [list, setList] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filterDomainId, setFilterDomainId] = useState<number | "">("");
  const [filterCategoryId, setFilterCategoryId] = useState<number | "">("");
  const [filterName, setFilterName] = useState("");
  const [filterTagId, setFilterTagId] = useState<number | "">("");
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const [orgTags, setOrgTags] = useState<OrgTagRow[]>([]);
  const [assigningKpiId, setAssigningKpiId] = useState<number | null>(null);
  const [orgUsers, setOrgUsers] = useState<UserRow[]>([]);

  const token = getAccessToken();
  const effectiveOrgId = organizationId ?? meOrgId ?? undefined;
  const canEdit = userRole !== null && canEditKpis(userRole);

  const loadDomains = () => {
    if (!token || effectiveOrgId == null) return;
    api<DomainRow[]>(`/domains?${qs({ organization_id: effectiveOrgId })}`, { token })
      .then(setDomains)
      .catch(() => setDomains([]));
  };

  const loadCategories = () => {
    if (!token || effectiveOrgId == null) return;
    api<CategoryRow[]>(`/categories?${qs({ organization_id: effectiveOrgId })}`, { token })
      .then(setCategories)
      .catch(() => setCategories([]));
  };

  const loadList = () => {
    if (!token) return;
    setError(null);
    const query = qs({
      ...(effectiveOrgId != null && { organization_id: effectiveOrgId }),
      ...(filterDomainId && { domain_id: filterDomainId }),
      ...(filterCategoryId && { category_id: filterCategoryId }),
      ...(filterTagId && { organization_tag_id: filterTagId }),
      ...(filterName.trim() && { name: filterName.trim() }),
    });
    api<KpiRow[]>(`/kpis${query ? `?${query}` : ""}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  const loadOrgTags = () => {
    if (!token || effectiveOrgId == null) return;
    api<OrgTagRow[]>(`/organizations/${effectiveOrgId}/tags`, { token })
      .then(setOrgTags)
      .catch(() => setOrgTags([]));
  };

  const loadOrgUsers = () => {
    if (!token || effectiveOrgId == null) return;
    api<UserRow[]>(`/users?organization_id=${effectiveOrgId}`, { token })
      .then((users) => setOrgUsers(users.filter((u) => u.role === "USER" || u.role === "REPORT_VIEWER")))
      .catch(() => setOrgUsers([]));
  };

  const assignUserToKpi = async (kpiId: number, userId: number) => {
    if (!token || effectiveOrgId == null) return;
    setError(null);
    try {
      await api(`/kpis/${kpiId}/assignments?organization_id=${effectiveOrgId}`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
        token,
      });
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assign failed");
    }
  };

  const unassignUserFromKpi = async (kpiId: number, userId: number) => {
    if (!token || effectiveOrgId == null) return;
    setError(null);
    try {
      await api(`/kpis/${kpiId}/assignments/${userId}?organization_id=${effectiveOrgId}`, { method: "DELETE", token });
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unassign failed");
    }
  };

  useEffect(() => {
    if (!token) return;
    api<{ role: UserRole; organization_id: number | null }>("/auth/me", { token })
      .then((me) => {
        setUserRole(me.role);
        setMeOrgId(me.organization_id ?? null);
      })
      .catch(() => setUserRole(null));
  }, [token]);

  useEffect(() => {
    if (effectiveOrgId != null) {
      loadDomains();
      loadCategories();
    }
  }, [effectiveOrgId]);

  useEffect(() => {
    if (effectiveOrgId != null) loadOrgTags();
  }, [effectiveOrgId]);

  useEffect(() => {
    if (effectiveOrgId != null && !canEdit) loadOrgUsers();
  }, [effectiveOrgId, canEdit]);

  useEffect(() => {
    loadList();
  }, [organizationId, effectiveOrgId, filterDomainId, filterCategoryId, filterTagId]);

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      description: "",
      year: new Date().getFullYear(),
      sort_order: 0,
      entry_mode: "manual",
      api_endpoint_url: "",
    },
  });

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token) return;
    setError(null);
    try {
      const query = effectiveOrgId != null ? `?${qs({ organization_id: effectiveOrgId })}` : "";
      await api(`/kpis${query}`, {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          year: data.year,
          sort_order: data.sort_order,
          entry_mode: data.entry_mode ?? "manual",
          api_endpoint_url: data.entry_mode === "api" && data.api_endpoint_url ? data.api_endpoint_url.trim() : null,
        }),
        token,
      });
      createForm.reset({
        name: "",
        description: "",
        year: new Date().getFullYear(),
        sort_order: 0,
        entry_mode: "manual",
        api_endpoint_url: "",
      });
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (kpiId: number, data: UpdateFormData) => {
    if (!token) return;
    setError(null);
    try {
      const query = effectiveOrgId != null ? `?${qs({ organization_id: effectiveOrgId })}` : "";
      await api(`/kpis/${kpiId}${query}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          year: data.year,
          sort_order: data.sort_order,
          entry_mode: data.entry_mode ?? "manual",
          api_endpoint_url: data.entry_mode === "api" && data.api_endpoint_url ? data.api_endpoint_url.trim() : null,
        }),
        token,
      });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (kpiId: number) => {
    if (!token) return;
    setError(null);
    try {
      const query = effectiveOrgId != null ? `?organization_id=${effectiveOrgId}` : "";
      const summary = await api<{
        has_child_data: boolean;
        assignments_count: number;
        entries_count: number;
        fields_count: number;
        field_values_count: number;
        report_template_kpis_count: number;
      }>(`/kpis/${kpiId}/child_data_summary${query}`, { token });
      const message = summary.has_child_data
        ? `This KPI has ${summary.assignments_count} assignment(s), ${summary.entries_count} entry/entries, ${summary.fields_count} field(s), ${summary.field_values_count} stored value(s), and ${summary.report_template_kpis_count} report template reference(s). Deleting will remove all of them. Continue?`
        : "Delete this KPI?";
      if (!confirm(message)) return;
      await api(`/kpis/${kpiId}${query}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading && list.length === 0 && !userRole) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>KPIs</h1>
        {effectiveOrgId != null && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreate((s) => !s)}
          >
            {showCreate ? "Cancel" : "Add KPI"}
          </button>
        )}
      </div>

      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        Create KPIs without a domain; you can attach them to domains and categories later from domain pages.
      </p>

      {/* Filters */}
      <div className="card" style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
        <div className="form-group" style={{ marginBottom: 0, minWidth: "160px" }}>
          <label style={{ fontSize: "0.9rem" }}>Name</label>
          <input
            type="text"
            placeholder="Search by name..."
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadList()}
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </div>
        {orgTags.length > 0 && (
          <div className="form-group" style={{ marginBottom: 0, minWidth: "140px" }}>
            <label style={{ fontSize: "0.9rem" }}>Tag</label>
            <select
              value={filterTagId}
              onChange={(e) => setFilterTagId(e.target.value === "" ? "" : Number(e.target.value))}
              style={{ padding: "0.5rem", width: "100%" }}
            >
              <option value="">All tags</option>
              {orgTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-group" style={{ marginBottom: 0, minWidth: "160px" }}>
          <label style={{ fontSize: "0.9rem" }}>Domain</label>
          <select
            value={filterDomainId}
            onChange={(e) => setFilterDomainId(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ padding: "0.5rem", width: "100%" }}
          >
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: "160px" }}>
          <label style={{ fontSize: "0.9rem" }}>Category</label>
          <select
            value={filterCategoryId}
            onChange={(e) => setFilterCategoryId(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ padding: "0.5rem", width: "100%" }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.domain_name ? ` (${c.domain_name})` : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => loadList()}>
          Apply filters
        </button>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create KPI</h2>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
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
              <label>Year *</label>
              <input type="number" min={2000} max={2100} {...createForm.register("year")} />
              {createForm.formState.errors.year && (
                <p className="form-error">{createForm.formState.errors.year.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Sort order</label>
              <input type="number" min={0} {...createForm.register("sort_order")} />
            </div>
            <div className="form-group">
              <label>Entry mode</label>
              <select {...createForm.register("entry_mode")}>
                <option value="manual">Manual (default)</option>
                <option value="api">API</option>
              </select>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                API: system will call your endpoint to fetch entry data. Provide URL below.
              </p>
            </div>
            {createForm.watch("entry_mode") === "api" && (
              <div className="form-group">
                <label>API endpoint URL</label>
                <input
                  type="url"
                  placeholder="https://your-server.com/kpi-data"
                  {...createForm.register("api_endpoint_url")}
                  style={{ width: "100%", maxWidth: "480px" }}
                />
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Creating…" : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
        {list.map((k) => {
          const assignedList = k.assigned_users ?? [];
          const assignedUser = assignedList[0] ?? null;
          const hasAssigned = assignedUser != null;
          const unassignedUsers = orgUsers.filter((u) => u.id !== assignedUser?.id);
          const isUnassignedHighlight = !canEdit && !hasAssigned && effectiveOrgId != null;
          return (
          <div
            key={k.id}
            className="card"
            style={{
              marginBottom: 0,
              ...(isUnassignedHighlight
                ? { borderLeft: "4px solid var(--warning)", backgroundColor: "rgba(255, 193, 7, 0.08)" }
                : {}),
            }}
          >
            {editingId === k.id ? (
              <KpiEditForm
                kpi={k}
                orgId={effectiveOrgId ?? undefined}
                token={token ?? ""}
                onSave={(data) => onUpdateSubmit(k.id, data)}
                onCancel={() => setEditingId(null)}
                onSyncSuccess={() => loadList()}
              />
            ) : (
              <>
                <div style={{ marginBottom: "0.75rem" }}>
                  <strong style={{ fontSize: "1.05rem" }}>{k.name}</strong>
                  {(k.entry_mode === "api" && k.api_endpoint_url) && (
                    <span style={{ fontSize: "0.75rem", marginLeft: "0.5rem", color: "var(--muted)" }} title="API entry">(API)</span>
                  )}
                  <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
                    Year {k.year}
                    {k.description && ` — ${k.description}`}
                  </p>
                </div>
                {/* Domain labels - separate line, distinct color */}
                {(k.domain_tags?.length ?? 0) > 0 && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginRight: "0.35rem" }}>Domain:</span>
                    {(k.domain_tags || []).map((t) => (
                      <span
                        key={`d-${t.id}`}
                        style={{
                          display: "inline-block",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          background: "#2563eb",
                          color: "white",
                          marginRight: "0.25rem",
                          marginBottom: "0.2rem",
                        }}
                        title="Domain"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {/* Organization tag labels - separate line, different color */}
                {(k.organization_tags?.length ?? 0) > 0 && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginRight: "0.35rem" }}>Tag:</span>
                    {(k.organization_tags ?? []).map((t) => (
                      <span
                        key={`o-${t.id}`}
                        style={{
                          display: "inline-block",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          background: "#059669",
                          color: "white",
                          marginRight: "0.25rem",
                          marginBottom: "0.2rem",
                        }}
                        title="Tag"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                {!canEdit && effectiveOrgId != null && (
                  <AssignDropdown
                    kpiId={k.id}
                    assignedUser={assignedUser}
                    unassignedUsers={unassignedUsers}
                    orgUsers={orgUsers}
                    isOpen={assigningKpiId === k.id}
                    onToggle={() => setAssigningKpiId(assigningKpiId === k.id ? null : k.id)}
                    onAssign={(userId) => assignUserToKpi(k.id, userId)}
                    onUnassign={(userId) => unassignUserFromKpi(k.id, userId)}
                  />
                )}
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
                  {canEdit && (
                    <>
                      <Link href={`/dashboard/kpis/${k.id}/fields`} className="btn btn-primary" style={{ textDecoration: "none" }}>
                        Manage fields
                      </Link>
                      <button type="button" className="btn" onClick={() => setEditingId(k.id)}>Edit</button>
                      <button type="button" className="btn" onClick={() => onDelete(k.id)} style={{ color: "var(--error)" }}>Delete</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          );
        })}
      </div>

      {list.length === 0 && !showCreate && (
        <p style={{ color: "var(--muted)" }}>
          {effectiveOrgId == null
            ? "Select an organization (Super Admin) or ensure you are in an organization."
            : domains.length === 0
              ? "Add domains first, then add KPIs here."
              : "No KPIs match the filters. Try changing filters or add a new KPI."}
        </p>
      )}
    </div>
  );
}

function KpiEditForm({
  kpi,
  orgId,
  token,
  onSave,
  onCancel,
  onSyncSuccess,
}: {
  kpi: KpiRow;
  orgId: number | undefined;
  token: string;
  onSave: (data: UpdateFormData) => void;
  onCancel: () => void;
  onSyncSuccess: () => void;
}) {
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMode, setSyncMode] = useState<"override" | "append">("override");
  const [contractOpen, setContractOpen] = useState(false);
  const [contract, setContract] = useState<Record<string, unknown> | null>(null);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      name: kpi.name,
      description: kpi.description ?? "",
      year: kpi.year,
      sort_order: kpi.sort_order,
      entry_mode: kpi.entry_mode ?? "manual",
      api_endpoint_url: kpi.api_endpoint_url ?? "",
    },
  });
  const isApiMode = watch("entry_mode") === "api";
  const fetchContract = async () => {
    if (contract !== null) { setContractOpen((o) => !o); return; }
    if (orgId == null || !token) return;
    try {
      const c = await api<Record<string, unknown>>(`/kpis/${kpi.id}/api-contract?${qs({ organization_id: orgId })}`, { token });
      setContract(c);
      setContractOpen(true);
    } catch {
      setContract({});
      setContractOpen(true);
    }
  };

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
        <label>Year *</label>
        <input type="number" min={2000} max={2100} {...register("year")} />
        {errors.year && <p className="form-error">{errors.year.message}</p>}
      </div>
      <div className="form-group">
        <label>Sort order</label>
        <input type="number" min={0} {...register("sort_order")} />
      </div>
      <div className="form-group">
        <label>Entry mode</label>
        <select {...register("entry_mode")}>
          <option value="manual">Manual (default)</option>
          <option value="api">API</option>
        </select>
      </div>
      {isApiMode && (
        <>
          <div className="form-group">
            <label>API endpoint URL</label>
            <input
              type="url"
              placeholder="https://your-server.com/kpi-data"
              {...register("api_endpoint_url")}
              style={{ width: "100%", maxWidth: "480px" }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: "0.5rem" }}>
            <button type="button" className="btn" onClick={fetchContract}>
              {contractOpen ? "Hide" : "Show"} operation contract
            </button>
            {contractOpen && contract && (
              <ApiContractBlock contract={contract} />
            )}
          </div>
          {kpi.entry_mode === "api" && kpi.api_endpoint_url && orgId != null && token && (
            <div className="form-group">
              <p style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: "0.35rem" }}>When syncing:</p>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                  <input type="radio" name={`syncMode-${kpi.id}`} checked={syncMode === "override"} onChange={() => setSyncMode("override")} />
                  Override existing data
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                  <input type="radio" name={`syncMode-${kpi.id}`} checked={syncMode === "append"} onChange={() => setSyncMode("append")} />
                  Append to existing (multi-line rows)
                </label>
              </div>
              <button
                type="button"
                className="btn"
                disabled={syncLoading}
                onClick={async () => {
                  setSyncLoading(true);
                  try {
                    await api(`/kpis/${kpi.id}/sync-from-api?${qs({ year: kpi.year, organization_id: orgId, sync_mode: syncMode })}`, { method: "POST", token });
                    onSyncSuccess();
                  } finally {
                    setSyncLoading(false);
                  }
                }}
              >
                {syncLoading ? "Syncing…" : "Sync from API now"}
              </button>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>Fetches entry data for year {kpi.year} from your endpoint. Override or append is chosen above.</p>
            </div>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function AssignDropdown({
  kpiId,
  assignedUser,
  unassignedUsers,
  orgUsers,
  isOpen,
  onToggle,
  onAssign,
  onUnassign,
}: {
  kpiId: number;
  assignedUser: AssignedUserRef | null;
  unassignedUsers: UserRow[];
  orgUsers: UserRow[];
  isOpen: boolean;
  onToggle: () => void;
  onAssign: (userId: number) => void;
  onUnassign: (userId: number) => void;
}) {
  const hasAssigned = assignedUser != null;

  return (
    <div style={{ marginBottom: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", position: "relative" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.4rem 0.5rem",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          cursor: "pointer",
          fontSize: "0.9rem",
        }}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.35rem", flex: 1, minWidth: 0 }}>
          <span style={{ color: "var(--muted)", fontWeight: 500, flexShrink: 0 }}>Data entry:</span>
          {hasAssigned && assignedUser ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.2rem",
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                fontSize: "0.8rem",
                background: "var(--muted)",
                color: "white",
              }}
              onClick={(e) => { e.stopPropagation(); onUnassign(assignedUser.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onUnassign(assignedUser.id); } }}
              role="button"
              tabIndex={0}
            >
              {assignedUser.full_name || assignedUser.username}
              <span style={{ cursor: "pointer", marginLeft: "0.15rem" }} aria-label="Remove">×</span>
            </span>
          ) : (
            <span style={{ color: "var(--muted)", fontWeight: 500 }}>No one assigned</span>
          )}
        </span>
        <span style={{ color: "var(--muted)", flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </div>
      {isOpen && (
        <ul
          style={{
            margin: "0.25rem 0 0",
            padding: "0.25rem 0",
            listStyle: "none",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            background: "var(--bg)",
            maxHeight: "200px",
            overflowY: "auto",
          }}
          role="listbox"
        >
          {unassignedUsers.length === 0 ? (
            <li style={{ padding: "0.5rem 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              All users assigned
            </li>
          ) : (
            unassignedUsers.map((u) => (
              <li
                key={u.id}
                role="option"
                onClick={(e) => { e.stopPropagation(); onAssign(u.id); }}
                style={{
                  padding: "0.4rem 0.75rem",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent)";
                  e.currentTarget.style.color = "white";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "";
                  e.currentTarget.style.color = "";
                }}
              >
                {u.full_name || u.username}
                {u.username !== (u.full_name || u.username) && (
                  <span style={{ color: "inherit", opacity: 0.9, marginLeft: "0.25rem" }}>({u.username})</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
