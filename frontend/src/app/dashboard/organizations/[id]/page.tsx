"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";

const FIELD_TYPES = [
  "single_line_text",
  "multi_line_text",
  "number",
  "date",
  "boolean",
  "multi_line_items",
  "formula",
] as const;

const SUB_FIELD_TYPES = ["single_line_text", "number", "date", "boolean"] as const;

const GROUP_FUNCTIONS = [
  { value: "SUM_ITEMS", label: "SUM (total)" },
  { value: "AVG_ITEMS", label: "AVG (average)" },
  { value: "COUNT_ITEMS", label: "COUNT" },
  { value: "MIN_ITEMS", label: "MIN" },
  { value: "MAX_ITEMS", label: "MAX" },
] as const;

const CONDITIONAL_GROUP_FUNCTIONS = [
  { value: "SUM_ITEMS_WHERE", label: "SUM where" },
  { value: "AVG_ITEMS_WHERE", label: "AVG where" },
  { value: "COUNT_ITEMS_WHERE", label: "COUNT where" },
  { value: "MIN_ITEMS_WHERE", label: "MIN where" },
  { value: "MAX_ITEMS_WHERE", label: "MAX where" },
] as const;

const WHERE_OPERATORS = [
  { value: "op_eq", label: "equals (=)" },
  { value: "op_neq", label: "not equals (≠)" },
  { value: "op_gt", label: "greater than (>)" },
  { value: "op_gte", label: "greater or equal (≥)" },
  { value: "op_lt", label: "less than (<)" },
  { value: "op_lte", label: "less or equal (≤)" },
] as const;

type TabId = "domains" | "kpis" | "fields" | "tags" | "reports";

interface SubFieldDef {
  id?: number;
  field_id?: number;
  name: string;
  key: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
}

interface OrgInfo {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface DomainRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  sort_order: number;
}

interface DomainSummary {
  category_count: number;
  kpi_count: number;
}

interface DomainWithSummary extends DomainRow {
  summary: DomainSummary;
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

interface OrgTagRow {
  id: number;
  organization_id: number;
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
  domain_tags?: DomainTagRef[];
  category_tags?: CategoryTagRef[];
  organization_tags?: OrganizationTagRef[];
}

interface KpiField {
  id: number;
  kpi_id: number;
  name: string;
  key: string;
  field_type: string;
  formula_expression: string | null;
  is_required: boolean;
  sort_order: number;
  options: Array<{ id: number; value: string; label: string; sort_order: number }>;
  sub_fields?: SubFieldDef[];
}

const domainCreateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  sort_order: z.coerce.number().int().min(0),
});

const domainUpdateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  sort_order: z.coerce.number().int().min(0),
});

const kpiCreateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  sort_order: z.coerce.number().int().min(0),
  entry_mode: z.enum(["manual", "api"]),
  api_endpoint_url: z.string().max(2048).optional(),
  organization_tag_ids: z.array(z.number().int()).optional(),
});

const kpiUpdateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  sort_order: z.coerce.number().int().min(0),
  entry_mode: z.enum(["manual", "api"]),
  api_endpoint_url: z.string().max(2048).optional(),
  organization_tag_ids: z.array(z.number().int()).optional(),
});

const tagCreateSchema = z.object({
  name: z.string().min(1, "Name required").max(255),
});

const tagUpdateSchema = z.object({
  name: z.string().min(1, "Name required").max(255),
});

const fieldCreateSchema = z.object({
  name: z.string().min(1, "Name required"),
  key: z.string().min(1, "Key required").regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers, underscore only"),
  field_type: z.enum(FIELD_TYPES),
  formula_expression: z.string().optional(),
  is_required: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
});

const fieldUpdateSchema = z.object({
  name: z.string().min(1, "Name required"),
  key: z.string().min(1, "Key required").regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers, underscore only"),
  field_type: z.enum(FIELD_TYPES),
  formula_expression: z.string().optional(),
  is_required: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
});

const reportTemplateCreateSchema = z.object({
  name: z.string().min(1, "Name required").max(255),
  description: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
});

type DomainCreateFormData = z.infer<typeof domainCreateSchema>;
type DomainUpdateFormData = z.infer<typeof domainUpdateSchema>;
type KpiCreateFormData = z.infer<typeof kpiCreateSchema>;
type KpiUpdateFormData = z.infer<typeof kpiUpdateSchema>;
type TagCreateFormData = z.infer<typeof tagCreateSchema>;
type TagUpdateFormData = z.infer<typeof tagUpdateSchema>;
type FieldCreateFormData = z.infer<typeof fieldCreateSchema>;
type FieldUpdateFormData = z.infer<typeof fieldUpdateSchema>;
type ReportTemplateCreateFormData = z.infer<typeof reportTemplateCreateSchema>;

interface ReportTemplateRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  year: number;
}

function qs(params: Record<string, string | number | boolean>): string {
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    )
  ).toString();
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

export default function OrganizationDetailPage() {
  const params = useParams();
  const orgId = Number(params.id);
  const token = getAccessToken();

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [tab, setTab] = useState<TabId>("domains");
  const [domains, setDomains] = useState<DomainWithSummary[]>([]);
  const [orgTags, setOrgTags] = useState<OrgTagRow[]>([]);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [kpiFilterTagId, setKpiFilterTagId] = useState<number | null>(null);
  const [selectedKpiId, setSelectedKpiId] = useState<number | null>(null);
  const [fields, setFields] = useState<KpiField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [domainShowCreate, setDomainShowCreate] = useState(false);
  const [domainEditingId, setDomainEditingId] = useState<number | null>(null);
  const [kpiShowCreate, setKpiShowCreate] = useState(false);
  const [kpiEditingId, setKpiEditingId] = useState<number | null>(null);
  const [fieldShowCreate, setFieldShowCreate] = useState(false);
  const [fieldEditingId, setFieldEditingId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  const loadOrg = () => {
    if (!token || !orgId) return;
    api<OrgInfo>(`/organizations/${orgId}`, { token })
      .then(setOrg)
      .catch(() => setOrg(null));
  };

  const loadDomains = () => {
    if (!token || !orgId) return;
    setError(null);
    api<DomainWithSummary[]>(`/domains?${qs({ organization_id: orgId, with_summary: true })}`, { token })
      .then(setDomains)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  const loadOrgTags = () => {
    if (!token || !orgId) return;
    api<OrgTagRow[]>(`/organizations/${orgId}/tags`, { token })
      .then(setOrgTags)
      .catch(() => setOrgTags([]));
  };

  const loadKpis = () => {
    if (!token || !orgId) return;
    setError(null);
    const params: Record<string, string | number> = { organization_id: orgId };
    if (kpiFilterTagId != null) params.organization_tag_id = kpiFilterTagId;
    api<KpiRow[]>(`/kpis?${qs(params)}`, { token })
      .then(setKpis)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  const loadFields = () => {
    if (!token || !orgId || !selectedKpiId) return;
    setError(null);
    api<KpiField[]>(`/fields?${qs({ kpi_id: selectedKpiId, organization_id: orgId })}`, { token })
      .then(setFields)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  useEffect(() => {
    loadOrg();
  }, [orgId]);

  useEffect(() => {
    loadDomains();
    loadOrgTags();
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    loadKpis();
  }, [orgId, kpiFilterTagId]);

  useEffect(() => {
    if (selectedKpiId) loadFields();
    else setFields([]);
  }, [selectedKpiId, orgId]);

  useEffect(() => {
    if (!token) return;
    api<{ role: UserRole }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  const domainById = (id: number) => domains.find((d) => d.id === id)?.name ?? `Domain #${id}`;
  const selectedKpi = selectedKpiId ? kpis.find((k) => k.id === selectedKpiId) : null;

  if (!orgId || isNaN(orgId)) {
    return (
      <div>
        <p className="form-error">Invalid organization.</p>
        <Link href="/dashboard/organizations">Back to Organizations</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard/organizations" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {"\u2190"} Organizations
        </Link>
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        {org ? org.name : `Organization #${orgId}`}
      </h1>
      {org?.description && (
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>{org.description}</p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
        <button
          type="button"
          className={tab === "domains" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("domains")}
        >
          Domains
        </button>
        <button
          type="button"
          className={tab === "kpis" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("kpis")}
        >
          KPIs
        </button>
        <button
          type="button"
          className={tab === "tags" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("tags")}
        >
          Tags
        </button>
        <button
          type="button"
          className={tab === "fields" ? "btn btn-primary" : "btn"}
          onClick={() => setTab("fields")}
          disabled={!selectedKpiId}
          title={!selectedKpiId ? "Select a KPI first" : undefined}
        >
          KPI Fields
          {selectedKpi && ` (${selectedKpi.name})`}
        </button>
        {userRole === "SUPER_ADMIN" && (
          <button
            type="button"
            className={tab === "reports" ? "btn btn-primary" : "btn"}
            onClick={() => setTab("reports")}
          >
            Reports
          </button>
        )}
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {tab === "domains" && (
        <DomainsSection
          orgId={orgId}
          token={token!}
          list={domains}
          loadList={loadDomains}
          showCreate={domainShowCreate}
          setShowCreate={setDomainShowCreate}
          editingId={domainEditingId}
          setEditingId={setDomainEditingId}
        />
      )}

      {tab === "kpis" && (
        <KpisSection
          orgId={orgId}
          token={token!}
          domains={domains}
          orgTags={orgTags}
          loadOrgTags={loadOrgTags}
          filterTagId={kpiFilterTagId}
          setFilterTagId={setKpiFilterTagId}
          list={kpis}
          loadList={loadKpis}
          showCreate={kpiShowCreate}
          setShowCreate={setKpiShowCreate}
          editingId={kpiEditingId}
          setEditingId={setKpiEditingId}
          userRole={userRole}
          onManageFields={(kpiId) => {
            setSelectedKpiId(kpiId);
            setTab("fields");
          }}
        />
      )}

      {tab === "tags" && (
        <TagsSection
          orgId={orgId}
          token={token!}
          list={orgTags}
          loadList={loadOrgTags}
        />
      )}

      {tab === "fields" && (
        <FieldsSection
          orgId={orgId}
          token={token!}
          kpis={kpis}
          selectedKpiId={selectedKpiId}
          setSelectedKpiId={setSelectedKpiId}
          list={fields}
          loadList={loadFields}
          showCreate={fieldShowCreate}
          setShowCreate={setFieldShowCreate}
          editingId={fieldEditingId}
          setEditingId={setFieldEditingId}
          userRole={userRole}
        />
      )}

      {tab === "reports" && userRole === "SUPER_ADMIN" && (
        <ReportsSection
          orgId={orgId}
          token={token!}
        />
      )}
    </div>
  );
}

function DomainsSection({
  orgId,
  token,
  list,
  loadList,
  showCreate,
  setShowCreate,
  editingId,
  setEditingId,
}: {
  orgId: number;
  token: string;
  list: DomainWithSummary[];
  loadList: () => void;
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  editingId: number | null;
  setEditingId: (v: number | null) => void;
}) {
  const createForm = useForm<DomainCreateFormData>({
    resolver: zodResolver(domainCreateSchema),
    defaultValues: { name: "", description: "", sort_order: 0 },
  });

  const onCreateSubmit = async (data: DomainCreateFormData) => {
    setError(null);
    try {
      await api(`/domains?${qs({ organization_id: orgId })}`, {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          sort_order: data.sort_order,
        }),
        token,
      });
      createForm.reset({ name: "", description: "", sort_order: 0 });
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (domainId: number, data: DomainUpdateFormData) => {
    try {
      await api(`/domains/${domainId}?${qs({ organization_id: orgId })}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          sort_order: data.sort_order,
        }),
        token,
      });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (domainId: number) => {
    if (!confirm("Delete this domain? Categories and KPIs under it will also be removed.")) return;
    try {
      await api(`/domains/${domainId}?${qs({ organization_id: orgId })}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Domains</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? "Cancel" : "Add domain"}
        </button>
      </div>
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Name *</label>
              <input {...createForm.register("name")} />
              {createForm.formState.errors.name && <p className="form-error">{createForm.formState.errors.name.message}</p>}
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
      {list.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No domains yet. Add one above.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {list.map((d) => (
            <div key={d.id} className="card" style={{ marginBottom: 0 }}>
              {editingId === d.id ? (
                <DomainEditForm
                  domain={d}
                  onSave={(data) => onUpdateSubmit(d.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <Link
                    href={`/dashboard/domains/${d.id}?organization_id=${orgId}`}
                    style={{ textDecoration: "none", color: "inherit", display: "block", marginBottom: "0.75rem" }}
                  >
                    <strong style={{ fontSize: "1.1rem" }}>{d.name}</strong>
                    {d.description && (
                      <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0", lineHeight: 1.3 }}>
                        {d.description}
                      </p>
                    )}
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Order: {d.sort_order}</span>
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Categories">
                        {d.summary?.category_count ?? 0} categories
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="KPIs">
                        {d.summary?.kpi_count ?? 0} KPIs
                      </span>
                    </div>
                  </Link>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
                    <Link href={`/dashboard/domains/${d.id}?organization_id=${orgId}`} className="btn btn-primary" style={{ textDecoration: "none" }}>
                      Manage categories
                    </Link>
                    <button type="button" className="btn" onClick={() => setEditingId(d.id)}>Edit</button>
                    <button type="button" className="btn" onClick={() => onDelete(d.id)} style={{ color: "var(--error)" }}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagsSection({
  orgId,
  token,
  list,
  loadList,
}: {
  orgId: number;
  token: string;
  list: OrgTagRow[];
  loadList: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const createForm = useForm<TagCreateFormData>({
    resolver: zodResolver(tagCreateSchema),
    defaultValues: { name: "" },
  });

  const onCreateSubmit = async (data: TagCreateFormData) => {
    setError(null);
    try {
      await api(`/organizations/${orgId}/tags`, {
        method: "POST",
        body: JSON.stringify({ name: data.name.trim() }),
        token,
      });
      createForm.reset({ name: "" });
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (tagId: number, data: TagUpdateFormData) => {
    try {
      await api(`/organizations/${orgId}/tags/${tagId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: data.name.trim() }),
        token,
      });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (tagId: number) => {
    if (!confirm("Delete this tag? It will be removed from all KPIs.")) return;
    try {
      await api(`/organizations/${orgId}/tags/${tagId}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Organization tags</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? "Cancel" : "Add tag"}
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        Tags are organization-wide. Attach them to KPIs in the KPIs tab to filter and search.
      </p>
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Tag name *</label>
              <input {...createForm.register("name")} placeholder="e.g. Strategic" />
              {createForm.formState.errors.name && (
                <p className="form-error">{createForm.formState.errors.name.message}</p>
              )}
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
      {list.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No tags yet. Add one above.</p>
      ) : (
        <ul style={{ listStyle: "none" }} className="card">
          {list.map((t) => (
            <li key={t.id} style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
              {editingId === t.id ? (
                <TagEditForm
                  tag={t}
                  onSave={(data) => onUpdateSubmit(t.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                  <span>{t.name}</span>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="button" className="btn" onClick={() => setEditingId(t.id)}>Edit</button>
                    <button type="button" className="btn" onClick={() => onDelete(t.id)} style={{ color: "var(--error)" }}>Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TagEditForm({
  tag,
  onSave,
  onCancel,
}: {
  tag: OrgTagRow;
  onSave: (data: TagUpdateFormData) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<TagUpdateFormData>({
    resolver: zodResolver(tagUpdateSchema),
    defaultValues: { name: tag.name },
  });
  return (
    <form onSubmit={handleSubmit(onSave)} style={{ width: "100%" }}>
      <div className="form-group" style={{ marginBottom: "0.5rem" }}>
        <input {...register("name")} style={{ maxWidth: "20rem" }} />
        {errors.name && <p className="form-error">{errors.name.message}</p>}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>Save</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function DomainEditForm({
  domain,
  onSave,
  onCancel,
}: {
  domain: DomainRow;
  onSave: (data: DomainUpdateFormData) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<DomainUpdateFormData>({
    resolver: zodResolver(domainUpdateSchema),
    defaultValues: {
      name: domain.name,
      description: domain.description ?? "",
      sort_order: domain.sort_order,
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

function KpisSection({
  orgId,
  token,
  domains,
  orgTags,
  loadOrgTags,
  filterTagId,
  setFilterTagId,
  list,
  loadList,
  showCreate,
  setShowCreate,
  editingId,
  setEditingId,
  userRole,
  onManageFields,
}: {
  orgId: number;
  token: string;
  domains: DomainRow[];
  orgTags: OrgTagRow[];
  loadOrgTags: () => void;
  filterTagId: number | null;
  setFilterTagId: (v: number | null) => void;
  list: KpiRow[];
  loadList: () => void;
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  editingId: number | null;
  setEditingId: (v: number | null) => void;
  userRole: UserRole | null;
  onManageFields: (kpiId: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const createForm = useForm<KpiCreateFormData>({
    resolver: zodResolver(kpiCreateSchema),
    defaultValues: {
      name: "",
      description: "",
      year: new Date().getFullYear(),
      sort_order: 0,
      entry_mode: "manual",
      api_endpoint_url: "",
      organization_tag_ids: [],
    },
  });

  const onCreateSubmit = async (data: KpiCreateFormData) => {
    setError(null);
    try {
      await api(`/kpis?${qs({ organization_id: orgId })}`, {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          year: data.year,
          sort_order: data.sort_order,
          entry_mode: data.entry_mode ?? "manual",
          api_endpoint_url: data.entry_mode === "api" && data.api_endpoint_url ? data.api_endpoint_url.trim() : null,
          organization_tag_ids: data.organization_tag_ids ?? [],
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
        organization_tag_ids: [],
      });
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (kpiId: number, data: KpiUpdateFormData) => {
    try {
      await api(`/kpis/${kpiId}?${qs({ organization_id: orgId })}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          year: data.year,
          sort_order: data.sort_order,
          entry_mode: data.entry_mode ?? "manual",
          api_endpoint_url: data.entry_mode === "api" && data.api_endpoint_url ? data.api_endpoint_url.trim() : null,
          organization_tag_ids: data.organization_tag_ids,
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
    try {
      const summary = await api<{
        has_child_data: boolean;
        assignments_count: number;
        entries_count: number;
        fields_count: number;
        field_values_count: number;
        report_template_kpis_count: number;
      }>(`/kpis/${kpiId}/child_data_summary?${qs({ organization_id: orgId })}`, { token });
      const message = summary.has_child_data
        ? `This KPI has ${summary.assignments_count} assignment(s), ${summary.entries_count} entry/entries, ${summary.fields_count} field(s), ${summary.field_values_count} stored value(s), and ${summary.report_template_kpis_count} report template reference(s). Deleting will remove all of them. Continue?`
        : "Delete this KPI?";
      if (!confirm(message)) return;
      await api(`/kpis/${kpiId}?${qs({ organization_id: orgId })}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const domainById = (id: number) => domains.find((d) => d.id === id)?.name ?? `Domain #${id}`;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>KPIs</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {orgTags.length > 0 && (
            <>
              <label style={{ fontSize: "0.9rem" }}>Filter by tag:</label>
              <select
                value={filterTagId ?? ""}
                onChange={(e) => setFilterTagId(e.target.value ? Number(e.target.value) : null)}
                style={{ padding: "0.5rem", minWidth: "140px" }}
              >
                <option value="">All tags</option>
                {orgTags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreate((s) => !s)}
          >
            {showCreate ? "Cancel" : "Add KPI"}
          </button>
        </div>
      </div>
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Name *</label>
              <input {...createForm.register("name")} />
              {createForm.formState.errors.name && <p className="form-error">{createForm.formState.errors.name.message}</p>}
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea {...createForm.register("description")} rows={2} />
            </div>
            <div className="form-group">
              <label>Year *</label>
              <input type="number" min={2000} max={2100} {...createForm.register("year")} />
            </div>
            <div className="form-group">
              <label>Sort order</label>
              <input type="number" min={0} {...createForm.register("sort_order")} />
            </div>
            <div className="form-group">
            <label>Entry mode</label>
            <select
              {...createForm.register("entry_mode")}
              disabled={userRole !== "SUPER_ADMIN"}
            >
              <option value="manual">Manual (default)</option>
              <option value="api">API</option>
            </select>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
              API entry can be configured by Super Admin only from this screen.
            </p>
          </div>
          {userRole === "SUPER_ADMIN" && createForm.watch("entry_mode") === "api" && (
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
            {orgTags.length > 0 && (
              <div className="form-group">
                <label>Organization tags</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem" }}>
                  {orgTags.map((t) => {
                    const ids = createForm.watch("organization_tag_ids") ?? [];
                    const checked = ids.includes(t.id);
                    return (
                      <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const prev = createForm.getValues("organization_tag_ids") ?? [];
                            const next = prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id];
                            createForm.setValue("organization_tag_ids", next);
                          }}
                        />
                        <span>{t.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>Create</button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
      <div className="card">
        {list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No KPIs yet. Add one above.</p>
        ) : (
          <ul style={{ listStyle: "none" }}>
            {list.map((k) => (
              <li key={k.id} style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                {editingId === k.id ? (
                  <KpiEditForm
                    kpi={k}
                    orgId={orgId}
                    orgTags={orgTags}
                    token={token}
                    userRole={userRole}
                    onSave={(data) => onUpdateSubmit(k.id, data)}
                    onCancel={() => setEditingId(null)}
                    onSyncSuccess={() => loadList()}
                  />
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                      <strong>{k.name}</strong>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>Year {k.year}</span>
                      {(k.domain_tags?.length ?? 0) > 0 && (
                        <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.9rem" }}>
                          — {(k.domain_tags ?? []).map((t) => t.name).join(", ")}
                        </span>
                      )}
                      {(k.organization_tags?.length ?? 0) > 0 && (
                        <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                          { (k.organization_tags ?? []).map((t) => (
                            <span key={t.id} style={{ background: "var(--muted)", color: "var(--on-muted)", padding: "0.1rem 0.4rem", borderRadius: "4px", marginRight: "0.25rem" }}>{t.name}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      {(k.entry_mode === "api" && k.api_endpoint_url) && (
                        <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginRight: "0.25rem" }} title="API entry">API</span>
                      )}
                      <button type="button" className="btn btn-primary" onClick={() => onManageFields(k.id)}>
                        Manage fields
                      </button>
                      <button type="button" className="btn" onClick={() => setEditingId(k.id)}>Edit</button>
                      <button type="button" className="btn" onClick={() => onDelete(k.id)} style={{ color: "var(--error)" }}>Delete</button>
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
}

function KpiEditForm({
  kpi,
  orgId,
  orgTags,
  token,
  onSave,
  onCancel,
  onSyncSuccess,
  userRole,
}: {
  kpi: KpiRow;
  orgId: number;
  orgTags: OrgTagRow[];
  token: string;
  onSave: (data: KpiUpdateFormData) => void;
  onCancel: () => void;
  onSyncSuccess: () => void;
  userRole: UserRole | null;
}) {
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMode, setSyncMode] = useState<"override" | "append">("override");
  const [contractOpen, setContractOpen] = useState(false);
  const [contract, setContract] = useState<Record<string, unknown> | null>(null);
  const { register, handleSubmit, watch, setValue, getValues, formState: { errors, isSubmitting } } = useForm<KpiUpdateFormData>({
    resolver: zodResolver(kpiUpdateSchema),
    defaultValues: {
      name: kpi.name,
      description: kpi.description ?? "",
      year: kpi.year,
      sort_order: kpi.sort_order,
      entry_mode: kpi.entry_mode ?? "manual",
      api_endpoint_url: kpi.api_endpoint_url ?? "",
      organization_tag_ids: (kpi.organization_tags ?? []).map((t) => t.id),
    },
  });
  const isApiMode = watch("entry_mode") === "api";
  const fetchContract = async () => {
    if (contract !== null) { setContractOpen((o) => !o); return; }
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
      </div>
      <div className="form-group">
        <label>Sort order</label>
        <input type="number" min={0} {...register("sort_order")} />
      </div>
      <div className="form-group">
        <label>Entry mode</label>
        <select
          {...register("entry_mode")}
          disabled={userRole !== "SUPER_ADMIN"}
        >
          <option value="manual">Manual (default)</option>
          <option value="api">API</option>
        </select>
      </div>
      {userRole === "SUPER_ADMIN" && isApiMode && (
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
          {kpi.entry_mode === "api" && kpi.api_endpoint_url && (
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
      {orgTags.length > 0 && (
        <div className="form-group">
          <label>Organization tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem" }}>
            {orgTags.map((t) => {
              const ids = watch("organization_tag_ids") ?? [];
              const checked = ids.includes(t.id);
              return (
                <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const prev = getValues("organization_tag_ids") ?? [];
                      const next = prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id];
                      setValue("organization_tag_ids", next);
                    }}
                  />
                  <span>{t.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>Save</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function FieldsSection({
  orgId,
  token,
  kpis,
  selectedKpiId,
  setSelectedKpiId,
  list,
  loadList,
  showCreate,
  setShowCreate,
  editingId,
  setEditingId,
  userRole,
}: {
  orgId: number;
  token: string;
  kpis: KpiRow[];
  selectedKpiId: number | null;
  setSelectedKpiId: (v: number | null) => void;
  list: KpiField[];
  loadList: () => void;
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  editingId: number | null;
  setEditingId: (v: number | null) => void;
  userRole: UserRole | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [createSubFields, setCreateSubFields] = useState<Array<{ name: string; key: string; field_type: string; is_required: boolean; sort_order: number }>>([]);
  const [cardDisplayFieldIds, setCardDisplayFieldIds] = useState<number[]>([]);
  const [savingCardDisplay, setSavingCardDisplay] = useState(false);
  const [cardDisplaySaved, setCardDisplaySaved] = useState(false);
  const [cardDisplaySaveError, setCardDisplaySaveError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const createForm = useForm<FieldCreateFormData>({
    resolver: zodResolver(fieldCreateSchema),
    defaultValues: {
      name: "",
      key: "",
      field_type: "single_line_text",
      formula_expression: "",
      is_required: false,
      sort_order: 0,
    },
  });

  const onCreateSubmit = async (data: FieldCreateFormData) => {
    if (!selectedKpiId) return;
    setError(null);
    try {
      const body: Record<string, unknown> = {
        kpi_id: selectedKpiId,
        name: data.name,
        key: data.key,
        field_type: data.field_type,
        formula_expression: data.field_type === "formula" ? (data.formula_expression || null) : null,
        is_required: data.is_required,
        sort_order: data.sort_order,
        options: [],
      };
      if (data.field_type === "multi_line_items" && createSubFields.length > 0) {
        body.sub_fields = createSubFields.map((s, i) => ({
          name: s.name,
          key: s.key,
          field_type: s.field_type,
          is_required: s.is_required,
          sort_order: s.sort_order ?? i,
        }));
      }
      await api(`/fields?${qs({ organization_id: orgId })}`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
      });
      createForm.reset({
        name: "",
        key: "",
        field_type: "single_line_text",
        formula_expression: "",
        is_required: false,
        sort_order: list.length + 1,
      });
      setCreateSubFields([]);
      setShowCreate(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (fieldId: number, data: FieldUpdateFormData, subFields?: SubFieldDef[]) => {
    try {
      const body: Record<string, unknown> = {
        name: data.name,
        key: data.key,
        field_type: data.field_type,
        formula_expression: data.field_type === "formula" ? (data.formula_expression || null) : null,
        is_required: data.is_required,
        sort_order: data.sort_order,
      };
      if (data.field_type === "multi_line_items" && subFields != null) {
        body.sub_fields = subFields.map((s, i) => ({
          name: s.name,
          key: s.key,
          field_type: s.field_type,
          is_required: s.is_required,
          sort_order: s.sort_order ?? i,
        }));
      }
      await api(`/fields/${fieldId}?${qs({ organization_id: orgId })}`, {
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

  const onDelete = async (fieldId: number) => {
    try {
      const summary = await api<{ has_child_data: boolean; field_values_count: number; report_template_fields_count: number }>(
        `/fields/${fieldId}/child_data_summary?${qs({ organization_id: orgId })}`,
        { token }
      );
      const message = summary.has_child_data
        ? `This field has ${summary.field_values_count} stored value(s) and ${summary.report_template_fields_count} report template reference(s). Deleting will remove them. Continue?`
        : "Delete this field?";
      if (!confirm(message)) return;
      await api(`/fields/${fieldId}?${qs({ organization_id: orgId })}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const saveCardDisplayFields = async (ids: number[]) => {
    if (!selectedKpiId) return;
    setSavingCardDisplay(true);
    setCardDisplaySaveError(null);
    try {
      const orderedIds = list.filter((f) => ids.includes(f.id)).map((f) => f.id);
      await api(`/kpis/${selectedKpiId}?${qs({ organization_id: orgId })}`, {
        method: "PATCH",
        body: JSON.stringify({ card_display_field_ids: orderedIds }),
        token,
      });
      setCardDisplayFieldIds(orderedIds);
      setCardDisplaySaved(true);
    } catch (e) {
      setCardDisplaySaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingCardDisplay(false);
    }
  };

  const onToggleCardDisplayField = (fieldId: number, checked: boolean) => {
    const next = checked
      ? [...cardDisplayFieldIds, fieldId]
      : cardDisplayFieldIds.filter((id) => id !== fieldId);
    setCardDisplayFieldIds(next);
    setCardDisplaySaved(false);
    setCardDisplaySaveError(null);
    if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      saveCardDisplayFields(next);
      autosaveTimerRef.current = null;
    }, 500);
  };

  useEffect(() => {
    if (!selectedKpiId || !token) return;
    api<{ card_display_field_ids?: number[] | null }>(`/kpis/${selectedKpiId}?${qs({ organization_id: orgId })}`, { token })
      .then((data) => setCardDisplayFieldIds(Array.isArray(data.card_display_field_ids) ? [...data.card_display_field_ids] : []))
      .catch(() => setCardDisplayFieldIds([]));
  }, [selectedKpiId, orgId, token]);

  if (!selectedKpiId) {
    return (
      <div className="card">
        <p style={{ color: "var(--muted)" }}>
          Select a KPI from the KPIs tab (click &quot;Manage fields&quot;) to manage its fields here, or choose one below.
        </p>
        {kpis.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Select KPI</label>
            <select
              value=""
              onChange={(e) => setSelectedKpiId(e.target.value ? Number(e.target.value) : null)}
              style={{ padding: "0.5rem", minWidth: "200px" }}
            >
              <option value="">— Select —</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id}>{k.name} ({k.year})</option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.9rem" }}>KPI:</label>
          <select
            value={selectedKpiId}
            onChange={(e) => setSelectedKpiId(e.target.value ? Number(e.target.value) : null)}
            style={{ padding: "0.5rem", minWidth: "200px" }}
          >
            {kpis.map((k) => (
              <option key={k.id} value={k.id}>{k.name} ({k.year})</option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? "Cancel" : "Add field"}
        </button>
      </div>
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "1rem" }}>Create field</h3>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Name *</label>
              <input {...createForm.register("name")} placeholder="e.g. Total students" />
              {createForm.formState.errors.name && <p className="form-error">{createForm.formState.errors.name.message}</p>}
            </div>
            <div className="form-group">
              <label>Key * (lowercase, e.g. total_students)</label>
              <input {...createForm.register("key")} placeholder="total_students" />
              {createForm.formState.errors.key && <p className="form-error">{createForm.formState.errors.key.message}</p>}
            </div>
            <div className="form-group">
              <label>Field type *</label>
              <select {...createForm.register("field_type")}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            {createForm.watch("field_type") === "formula" && (
              <div className="form-group">
                <label>Formula</label>
                <input {...createForm.register("formula_expression")} placeholder="e.g. total_count + SUM_ITEMS(students, score)" style={{ width: "100%", marginBottom: "0.5rem" }} />
                <FormulaBuilder
                  formulaValue={createForm.watch("formula_expression") ?? ""}
                  onInsert={(text) => createForm.setValue("formula_expression", (createForm.getValues("formula_expression") ?? "") + text)}
                  fields={list.filter((f) => f.field_type === "number" || f.field_type === "multi_line_items")}
                  organizationId={orgId}
                  currentKpiId={selectedKpiId ?? undefined}
                />
              </div>
            )}
            {createForm.watch("field_type") === "multi_line_items" && (
              <div className="form-group">
                <label>Sub-fields (columns for each row)</label>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 0" }}>
                  Define columns so data entry uses a table instead of raw JSON.
                </p>
                <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Name</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Key</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Type</th>
                        <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Required</th>
                        <th style={{ width: "80px", padding: "0.5rem", borderBottom: "2px solid var(--border)" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {createSubFields.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.9rem", textAlign: "center" }}>
                            No sub-fields yet. Click &quot;Add sub-field&quot; below.
                          </td>
                        </tr>
                      ) : createSubFields.map((s, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "0.4rem 0.5rem" }}>
                            <input
                              placeholder="Display name"
                              value={s.name}
                              onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                              style={{ width: "100%", minWidth: "100px" }}
                            />
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem" }}>
                            <input
                              placeholder="key_name"
                              value={s.key}
                              onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)))}
                              style={{ width: "100%", minWidth: "90px" }}
                            />
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem" }}>
                            <select
                              value={s.field_type}
                              onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, field_type: e.target.value } : x)))}
                              style={{ minWidth: "120px" }}
                            >
                              {SUB_FIELD_TYPES.map((t) => (
                                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={s.is_required}
                              onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, is_required: e.target.checked } : x)))}
                              title="Required"
                            />
                            {s.is_required && <span style={{ marginLeft: "0.35rem", color: "var(--warning)", fontSize: "0.8rem", fontWeight: 600 }}>Yes</span>}
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem" }}>
                            <button type="button" className="btn" onClick={() => setCreateSubFields((prev) => prev.filter((_, i) => i !== idx))} style={{ fontSize: "0.85rem" }}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => setCreateSubFields((prev) => [...prev, { name: "", key: "", field_type: "single_line_text", is_required: false, sort_order: prev.length }])}>
                  Add sub-field
                </button>
              </div>
            )}
            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" {...createForm.register("is_required")} />
                Required
              </label>
            </div>
            <div className="form-group">
              <label>Sort order</label>
              <input type="number" min={0} {...createForm.register("sort_order")} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>Create</button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
      <div className="card">
        {list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No fields for this KPI yet. Add one above.</p>
        ) : (
          <ul style={{ listStyle: "none" }}>
            {userRole === "SUPER_ADMIN" && (
              <li style={{ padding: "0 0 0.75rem 0", borderBottom: "1px solid var(--border)", marginBottom: "0.75rem" }}>
                <strong>Show on KPI card</strong>
                <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
                  Tick fields below to show them on this KPI&apos;s card on the domain page.
                </p>
                {savingCardDisplay && <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>Saving…</p>}
                {!savingCardDisplay && cardDisplaySaved && !cardDisplaySaveError && <p style={{ color: "var(--success)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>Saved</p>}
                {cardDisplaySaveError && <p className="form-error" style={{ margin: "0.25rem 0 0" }}>{cardDisplaySaveError}</p>}
              </li>
            )}
            {list.map((f) => (
              <li key={f.id} style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                {editingId === f.id ? (
                  <FieldEditForm
                    field={f}
                    list={list}
                    onSave={(data, subFields) => onUpdateSubmit(f.id, data, subFields)}
                    onCancel={() => setEditingId(null)}
                    organizationId={orgId}
                    currentKpiId={selectedKpiId ?? undefined}
                  />
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                      <strong>{f.name}</strong>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.9rem" }}>({f.key})</span>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>— {f.field_type.replace(/_/g, " ")}</span>
                      {f.is_required && <span style={{ marginLeft: "0.5rem", color: "var(--warning)" }}>Required</span>}
                      {f.field_type === "multi_line_items" && f.sub_fields && f.sub_fields.length > 0 && (
                        <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Sub-fields: {f.sub_fields.map((s) => s.name).join(", ")}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      {userRole === "SUPER_ADMIN" && (
                        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", color: "var(--muted)" }}>
                          <input
                            type="checkbox"
                            checked={cardDisplayFieldIds.includes(f.id)}
                            onChange={(e) => onToggleCardDisplayField(f.id, e.target.checked)}
                          />
                          Show on card
                        </label>
                      )}
                      <button type="button" className="btn" onClick={() => setEditingId(f.id)}>Edit</button>
                      <button type="button" className="btn" onClick={() => onDelete(f.id)} style={{ color: "var(--error)" }}>Delete</button>
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
}

interface FormulaRefKpi {
  id: number;
  name: string;
  year: number;
  fields: Array<{ key: string; name: string; field_type: string }>;
}

function FormulaBuilder({
  formulaValue,
  onInsert,
  fields,
  organizationId,
  currentKpiId,
}: {
  formulaValue: string;
  onInsert: (text: string) => void;
  fields: KpiField[];
  organizationId?: number;
  currentKpiId?: number;
}) {
  const [refFieldId, setRefFieldId] = useState<number | "">("");
  const [refSubKey, setRefSubKey] = useState("");
  const [refGroupFn, setRefGroupFn] = useState<string>("SUM_ITEMS");
  const [useConditional, setUseConditional] = useState(false);
  const [refFilterSubKey, setRefFilterSubKey] = useState("");
  const [refWhereOp, setRefWhereOp] = useState<string>("op_eq");
  const [refWhereValue, setRefWhereValue] = useState<string>("0");
  const [otherKpis, setOtherKpis] = useState<FormulaRefKpi[]>([]);
  const [refOtherKpiId, setRefOtherKpiId] = useState<number | "">("");
  const [refOtherFieldKey, setRefOtherFieldKey] = useState("");
  const token = getAccessToken();
  useEffect(() => {
    if (!token || organizationId == null || currentKpiId == null) return;
    const qs = new URLSearchParams({ organization_id: String(organizationId), exclude_kpi_id: String(currentKpiId) });
    api<FormulaRefKpi[]>(`/kpis/formula-refs?${qs}`, { token })
      .then(setOtherKpis)
      .catch(() => setOtherKpis([]));
  }, [token, organizationId, currentKpiId]);
  const refField = refFieldId === "" ? null : fields.find((f) => f.id === refFieldId);
  const subFields = refField?.field_type === "multi_line_items" ? (refField.sub_fields ?? []) : [];
  const canInsertNumber = refField?.field_type === "number";
  const isCountItemsOnly = refGroupFn === "COUNT_ITEMS";
  const isConditionalWhere = useConditional && refField?.field_type === "multi_line_items" && !!refFilterSubKey;
  const isCountWhere = refGroupFn === "COUNT_ITEMS" || refGroupFn === "COUNT_ITEMS_WHERE";
  const canInsertItems = refField?.field_type === "multi_line_items" && (
    isConditionalWhere
      ? (isCountWhere ? !!refFilterSubKey : (subFields.length > 0 && !!refSubKey && !!refFilterSubKey))
      : (isCountItemsOnly || (subFields.length > 0 && !!refSubKey))
  );
  const selectedOtherKpi = refOtherKpiId === "" ? null : otherKpis.find((k) => k.id === refOtherKpiId);
  const otherKpiFields = selectedOtherKpi?.fields ?? [];
  const canInsertOtherKpiField = refOtherKpiId !== "" && refOtherFieldKey !== "";

  const handleInsertItems = () => {
    if (!refField) return;
    if (isConditionalWhere) {
      const op = refWhereOp;
      const val = refWhereValue.trim() === "" ? "0" : refWhereValue;
      // When conditional is checked, always use the _WHERE variant (map COUNT_ITEMS -> COUNT_ITEMS_WHERE etc.)
      const whereFn = refGroupFn.endsWith("_WHERE") ? refGroupFn : refGroupFn + "_WHERE";
      if (whereFn === "COUNT_ITEMS_WHERE") {
        onInsert(`COUNT_ITEMS_WHERE(${refField.key}, ${refFilterSubKey}, ${op}, ${val})`);
      } else {
        onInsert(`${whereFn}(${refField.key}, ${refSubKey}, ${refFilterSubKey}, ${op}, ${val})`);
      }
      return;
    }
    onInsert(isCountItemsOnly && !refSubKey ? `COUNT_ITEMS(${refField.key})` : `${refGroupFn}(${refField.key}, ${refSubKey})`);
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "6px", padding: "0.75rem", background: "var(--bg-subtle, #f8f9fa)" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Insert reference</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
          <select value={refFieldId} onChange={(e) => { setRefFieldId(e.target.value ? Number(e.target.value) : ""); setRefSubKey(""); setRefFilterSubKey(""); }} style={{ minWidth: "160px" }}>
            <option value="">— Select field —</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>{f.name} ({f.key}) — {f.field_type.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        {refField?.field_type === "multi_line_items" && subFields.length > 0 && (
          <>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Sub-field</label>
              <select value={refSubKey} onChange={(e) => setRefSubKey(e.target.value)} style={{ minWidth: "140px" }}>
                <option value="">{(refGroupFn === "COUNT_ITEMS" || refGroupFn === "COUNT_ITEMS_WHERE") && !useConditional ? "Row count (no sub-field)" : refGroupFn === "COUNT_ITEMS_WHERE" ? "— N/A for COUNT where —" : "— Select —"}</option>
                {subFields.map((s) => (
                  <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Group function</label>
              <select value={refGroupFn} onChange={(e) => setRefGroupFn(e.target.value)} style={{ minWidth: "120px" }}>
                {GROUP_FUNCTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
                {CONDITIONAL_GROUP_FUNCTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", marginBottom: "0.25rem" }}>
              <input type="checkbox" checked={useConditional} onChange={(e) => setUseConditional(e.target.checked)} />
              Conditional (where)
            </label>
            {useConditional && (
              <>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Filter sub-field</label>
                  <select value={refFilterSubKey} onChange={(e) => setRefFilterSubKey(e.target.value)} style={{ minWidth: "120px" }}>
                    <option value="">— Select —</option>
                    {subFields.map((s) => (
                      <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Operator</label>
                  <select value={refWhereOp} onChange={(e) => setRefWhereOp(e.target.value)} style={{ minWidth: "100px" }}>
                    {WHERE_OPERATORS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Value (number)</label>
                  <input type="number" step="any" value={refWhereValue} onChange={(e) => setRefWhereValue(e.target.value)} style={{ width: "80px" }} placeholder="0" />
                </div>
              </>
            )}
          </>
        )}
        {canInsertNumber && <button type="button" className="btn btn-primary" onClick={() => refField && onInsert(refField.key)}>Insert field</button>}
        {canInsertItems && refField && (
          <button type="button" className="btn btn-primary" onClick={handleInsertItems}>Insert</button>
        )}
        {organizationId != null && currentKpiId != null && otherKpis.length > 0 && (
          <>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Other KPI</label>
              <select value={refOtherKpiId} onChange={(e) => { setRefOtherKpiId(e.target.value ? Number(e.target.value) : ""); setRefOtherFieldKey(""); }} style={{ minWidth: "180px" }}>
                <option value="">— Select KPI —</option>
                {otherKpis.map((k) => (
                  <option key={k.id} value={k.id}>{k.name} (year {k.year})</option>
                ))}
              </select>
            </div>
            {selectedOtherKpi && (
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
                <select value={refOtherFieldKey} onChange={(e) => setRefOtherFieldKey(e.target.value)} style={{ minWidth: "140px" }}>
                  <option value="">— Select —</option>
                  {otherKpiFields.map((f) => (
                    <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                  ))}
                </select>
              </div>
            )}
            {canInsertOtherKpiField && (
              <button type="button" className="btn btn-primary" onClick={() => onInsert(`KPI_FIELD(${refOtherKpiId}, "${refOtherFieldKey}")`)}>Insert other KPI field</button>
            )}
          </>
        )}
      </div>
      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Operators:</span>
        {[" + ", " - ", " * ", " / ", " ( ", " ) "].map((op) => (
          <button key={op} type="button" className="btn" onClick={() => onInsert(op)} style={{ padding: "0.25rem 0.5rem", fontSize: "0.9rem" }}>{op.trim() || op}</button>
        ))}
      </div>
    </div>
  );
}

function FieldEditForm({
  field,
  list,
  onSave,
  onCancel,
  organizationId,
  currentKpiId,
}: {
  field: KpiField;
  list: KpiField[];
  onSave: (data: FieldUpdateFormData, subFields?: SubFieldDef[]) => void;
  onCancel: () => void;
  organizationId?: number;
  currentKpiId?: number;
}) {
  const [editSubFields, setEditSubFields] = useState<SubFieldDef[]>(
    () => (field.sub_fields ?? []).map((s) => ({ ...s, name: s.name, key: s.key, field_type: s.field_type, is_required: s.is_required ?? false, sort_order: s.sort_order ?? 0 }))
  );
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FieldUpdateFormData>({
    resolver: zodResolver(fieldUpdateSchema),
    defaultValues: {
      name: field.name,
      key: field.key,
      field_type: field.field_type as FieldCreateFormData["field_type"],
      formula_expression: field.formula_expression ?? "",
      is_required: field.is_required,
      sort_order: field.sort_order,
    },
  });
  const currentFieldType = watch("field_type");
  return (
    <form onSubmit={handleSubmit((data) => onSave(data, currentFieldType === "multi_line_items" ? editSubFields : undefined))} style={{ width: "100%" }}>
      <div className="form-group">
        <label>Name *</label>
        <input {...register("name")} />
        {errors.name && <p className="form-error">{errors.name.message}</p>}
      </div>
      <div className="form-group">
        <label>Key *</label>
        <input {...register("key")} />
        {errors.key && <p className="form-error">{errors.key.message}</p>}
      </div>
      <div className="form-group">
        <label>Field type *</label>
        <select {...register("field_type")}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      {currentFieldType === "formula" && (
        <div className="form-group">
          <label>Formula</label>
          <input {...register("formula_expression")} style={{ width: "100%", marginBottom: "0.5rem" }} />
          <FormulaBuilder
            formulaValue={watch("formula_expression") ?? ""}
            onInsert={(text) => setValue("formula_expression", (watch("formula_expression") ?? "") + text)}
            fields={list.filter((f) => f.id !== field.id && (f.field_type === "number" || f.field_type === "multi_line_items"))}
            organizationId={organizationId}
            currentKpiId={currentKpiId}
          />
        </div>
      )}
      {currentFieldType === "multi_line_items" && (
        <div className="form-group">
          <label>Sub-fields (columns for each row)</label>
          <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Key</th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Required</th>
                  <th style={{ width: "80px", padding: "0.5rem", borderBottom: "2px solid var(--border)" }} />
                </tr>
              </thead>
              <tbody>
                {editSubFields.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.9rem", textAlign: "center" }}>
                      No sub-fields yet. Click &quot;Add sub-field&quot; below.
                    </td>
                  </tr>
                ) : editSubFields.map((s, idx) => (
                  <tr key={s.id ?? idx} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <input
                        placeholder="Display name"
                        value={s.name}
                        onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                        style={{ width: "100%", minWidth: "100px" }}
                      />
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <input
                        placeholder="key_name"
                        value={s.key}
                        onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)))}
                        style={{ width: "100%", minWidth: "90px" }}
                      />
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <select
                        value={s.field_type}
                        onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, field_type: e.target.value } : x)))}
                        style={{ minWidth: "120px" }}
                      >
                        {SUB_FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={s.is_required}
                        onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, is_required: e.target.checked } : x)))}
                        title="Required"
                      />
                      {s.is_required && <span style={{ marginLeft: "0.35rem", color: "var(--warning)", fontSize: "0.8rem", fontWeight: 600 }}>Yes</span>}
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <button type="button" className="btn" onClick={() => setEditSubFields((prev) => prev.filter((_, i) => i !== idx))} style={{ fontSize: "0.85rem" }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setEditSubFields((prev) => [...prev, { name: "", key: "", field_type: "single_line_text", is_required: false, sort_order: prev.length }])}>
            Add sub-field
          </button>
        </div>
      )}
      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" {...register("is_required")} />
          Required
        </label>
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

function ReportsSection({
  orgId,
  token,
}: {
  orgId: number;
  token: string;
}) {
  const [list, setList] = useState<ReportTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdMsg, setCreatedMsg] = useState<string | null>(null);

  const loadTemplates = () => {
    if (!token || !orgId) return;
    setError(null);
    api<ReportTemplateRow[]>(`/reports/templates?${qs({ organization_id: orgId })}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load templates"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTemplates();
  }, [orgId, token]);

  const createForm = useForm<ReportTemplateCreateFormData>({
    resolver: zodResolver(reportTemplateCreateSchema),
    defaultValues: {
      name: "",
      description: "",
      year: new Date().getFullYear(),
    },
  });

  const onCreate = async (data: ReportTemplateCreateFormData) => {
    if (!token || !orgId) return;
    setError(null);
    setCreatedMsg(null);
    try {
      await api(`/reports/templates?${qs({ organization_id: orgId })}`, {
        method: "POST",
        token,
        body: JSON.stringify({
          name: data.name,
          description: data.description?.trim() || null,
          year: data.year,
        }),
      });
      createForm.reset({ name: "", description: "", year: data.year });
      setCreatedMsg("Template created.");
      loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create template");
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: "1.2rem", marginBottom: "0.75rem" }}>Report templates</h2>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem" }}>Create template</h3>
        <form onSubmit={createForm.handleSubmit(onCreate)}>
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
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
              {createForm.formState.isSubmitting ? "Creating…" : "Create"}
            </button>
            {createdMsg && <span style={{ color: "var(--success)" }}>{createdMsg}</span>}
          </div>
          {error && <p className="form-error" style={{ marginTop: "0.75rem" }}>{error}</p>}
        </form>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Templates</h3>
          <button type="button" className="btn" onClick={loadTemplates} disabled={loading}>
            Refresh
          </button>
        </div>
        {loading ? (
          <p style={{ color: "var(--muted)" }}>Loading…</p>
        ) : list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No templates yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0" }}>
            {list.map((t) => (
              <li key={t.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div>
                    <strong>{t.name}</strong>
                    <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>Year {t.year}</span>
                    {t.description && (
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{t.description}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <Link className="btn" href={`/dashboard/reports/${t.id}/design`}>
                      Design
                    </Link>
                    <Link className="btn btn-primary" href={`/dashboard/reports/${t.id}`}>
                      View / Print
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
