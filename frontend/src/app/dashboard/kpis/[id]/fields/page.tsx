"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";

function qs(params: Record<string, string | number | boolean | undefined>): string {
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    )
  ).toString();
}

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

interface SubFieldDef {
  id?: number;
  field_id?: number;
  name: string;
  key: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
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

interface OrgTagRef {
  id: number;
  name: string;
}

interface DomainTagRef {
  id: number;
  name: string;
}

interface CategoryTagRef {
  id: number;
  name: string;
  domain_id?: number | null;
  domain_name?: string | null;
}

interface UsedInReportRef {
  report_id: number;
  report_name: string;
  organization_id: number;
}

interface KpiInfo {
  id: number;
  name: string;
  description?: string | null;
  year: number;
  sort_order?: number;
  organization_id: number;
  card_display_field_ids?: number[] | null;
  entry_mode?: string;
  api_endpoint_url?: string | null;
  time_dimension?: string | null;
  organization_tags?: OrgTagRef[];
  domain_tags?: DomainTagRef[];
  category_tags?: CategoryTagRef[];
  used_in_reports?: UsedInReportRef[];
}

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  key: z.string().min(1, "Key required").regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers, underscore only"),
  field_type: z.enum(FIELD_TYPES),
  formula_expression: z.string().optional(),
  is_required: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name required"),
  key: z.string().min(1, "Key required").regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers, underscore only"),
  field_type: z.enum(FIELD_TYPES),
  formula_expression: z.string().optional(),
  is_required: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
});

const kpiUpdateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  sort_order: z.coerce.number().int().min(0),
  entry_mode: z.enum(["manual", "api"]),
  api_endpoint_url: z.string().max(2048).optional(),
  time_dimension: z.string().optional(),
  organization_tag_ids: z.array(z.number().int()).optional(),
});

const TIME_DIMENSION_ORDER = ["yearly", "half_yearly", "quarterly", "monthly"] as const;
const TIME_DIMENSION_LABELS: Record<string, string> = {
  yearly: "Yearly",
  half_yearly: "Half-yearly",
  quarterly: "Quarterly",
  monthly: "Monthly",
};

type CreateFormData = z.infer<typeof createSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;
type KpiUpdateFormData = z.infer<typeof kpiUpdateSchema>;

export default function KpiFieldsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const organizationIdFromUrl = searchParams.get("organization_id");
  const orgIdFromUrl = organizationIdFromUrl ? Number(organizationIdFromUrl) : null;
  const kpiId = Number(params.id);
  const [kpi, setKpi] = useState<KpiInfo | null>(null);
  const [orgTags, setOrgTags] = useState<OrgTagRef[]>([]);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [list, setList] = useState<KpiField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cardDisplayFieldIds, setCardDisplayFieldIds] = useState<number[]>([]);
  const [savingCardDisplay, setSavingCardDisplay] = useState(false);
  const [cardDisplaySaved, setCardDisplaySaved] = useState(false);
  const [cardDisplaySaveError, setCardDisplaySaveError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const [kpiSaveError, setKpiSaveError] = useState<string | null>(null);
  const [kpiSaving, setKpiSaving] = useState(false);
  const [orgTimeDimension, setOrgTimeDimension] = useState<string>("yearly");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMode, setSyncMode] = useState<"override" | "append">("override");
  const [contractOpen, setContractOpen] = useState(false);
  const [contract, setContract] = useState<Record<string, unknown> | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [orgDomains, setOrgDomains] = useState<Array<{ id: number; name: string }>>([]);
  const [orgCategories, setOrgCategories] = useState<Array<{ id: number; name: string; domain_id?: number; domain_name?: string }>>([]);
  const [tagSaving, setTagSaving] = useState(false);
  const [domainCategorySaving, setDomainCategorySaving] = useState(false);
  const [addModal, setAddModal] = useState<null | "categories" | "tags">(null);
  const [addModalSearch, setAddModalSearch] = useState("");
  const [addModalCategorySearch, setAddModalCategorySearch] = useState("");
  const [addModalSelectedIds, setAddModalSelectedIds] = useState<number[]>([]);
  const [addModalSelectedDomainIds, setAddModalSelectedDomainIds] = useState<number[]>([]);
  type EditTabId = "details" | "fields";
  const tabFromUrl = searchParams.get("tab") as EditTabId | null;
  const [activeEditTab, setActiveEditTab] = useState<EditTabId>(
    tabFromUrl === "details" || tabFromUrl === "fields" ? tabFromUrl : "details"
  );

  const token = getAccessToken();
  const router = useRouter();

  useEffect(() => {
    if (tabFromUrl === "details" || tabFromUrl === "fields") {
      setActiveEditTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  const setEditTab = (tab: EditTabId) => {
    setActiveEditTab(tab);
    if (orgIdFromUrl != null) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`/dashboard/kpis/${kpiId}/fields?${params.toString()}`, { scroll: false });
    }
  };

  const kpiEditForm = useForm<KpiUpdateFormData>({
    resolver: zodResolver(kpiUpdateSchema),
    defaultValues: {
      name: "",
      description: "",
      year: new Date().getFullYear(),
      sort_order: 0,
      entry_mode: "manual",
      api_endpoint_url: "",
      time_dimension: "",
      organization_tag_ids: [],
    },
  });

  useEffect(() => {
    if (kpi && orgIdFromUrl != null) {
      kpiEditForm.reset({
        name: kpi.name,
        description: kpi.description ?? "",
        year: kpi.year,
        sort_order: kpi.sort_order ?? 0,
        entry_mode: kpi.entry_mode === "api" ? "api" : "manual",
        api_endpoint_url: kpi.api_endpoint_url ?? "",
        time_dimension: kpi.time_dimension ?? "",
        organization_tag_ids: (kpi.organization_tags ?? []).map((t) => t.id),
      });
    }
  }, [kpi?.id, kpi?.name, kpi?.description, kpi?.year, kpi?.sort_order, kpi?.entry_mode, kpi?.api_endpoint_url, kpi?.time_dimension, kpi?.organization_tags, orgIdFromUrl]);

  useEffect(() => {
    if (!token) return;
    api<{ role: UserRole }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  const orgId = kpi?.organization_id;
  const fieldsQuery = (o?: number) => {
    const id = o ?? orgId;
    return id != null ? `kpi_id=${kpiId}&organization_id=${id}` : `kpi_id=${kpiId}`;
  };

  const loadList = (organizationId?: number) => {
    if (!token || !kpiId) return;
    setError(null);
    api<KpiField[]>(`/fields?${fieldsQuery(organizationId)}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  const loadKpi = () => {
    if (!token || !kpiId) return;
    const query = orgIdFromUrl != null ? `?${qs({ organization_id: orgIdFromUrl })}` : "";
    api<KpiInfo>(`/kpis/${kpiId}${query}`, { token })
      .then((data) => {
        setKpi(data);
        setCardDisplayFieldIds(Array.isArray(data.card_display_field_ids) ? [...data.card_display_field_ids] : []);
        loadList(data.organization_id);
      })
      .catch(() => {
        setKpi(null);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadKpi();
  }, [kpiId, orgIdFromUrl]);

  useEffect(() => {
    if (!token || orgIdFromUrl == null) return;
    api<OrgTagRef[]>(`/organizations/${orgIdFromUrl}/tags`, { token })
      .then(setOrgTags)
      .catch(() => setOrgTags([]));
  }, [token, orgIdFromUrl]);

  useEffect(() => {
    if (!token || orgIdFromUrl == null) return;
    api<{ organization_id: number; time_dimension: string }>(`/organizations/${orgIdFromUrl}/time-dimension`, { token })
      .then((r) => setOrgTimeDimension(r.time_dimension ?? "yearly"))
      .catch(() => setOrgTimeDimension("yearly"));
  }, [token, orgIdFromUrl]);

  useEffect(() => {
    if (!token || orgIdFromUrl == null) return;
    api<Array<{ id: number; name: string }>>(`/domains?${qs({ organization_id: orgIdFromUrl })}`, { token })
      .then(setOrgDomains)
      .catch(() => setOrgDomains([]));
  }, [token, orgIdFromUrl]);

  useEffect(() => {
    if (!token || orgIdFromUrl == null) return;
    api<Array<{ id: number; name: string; domain_id?: number; domain_name?: string }>>(`/categories?${qs({ organization_id: orgIdFromUrl })}`, { token })
      .then(setOrgCategories)
      .catch(() => setOrgCategories([]));
  }, [token, orgIdFromUrl]);

  const [createSubFields, setCreateSubFields] = useState<Array<{ name: string; key: string; field_type: string; is_required: boolean; sort_order: number }>>([]);

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      key: "",
      field_type: "single_line_text",
      formula_expression: "",
      is_required: false,
      sort_order: list.length,
    },
  });

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token || !kpiId || orgId == null) return;
    setError(null);
    try {
      const body: Record<string, unknown> = {
        kpi_id: kpiId,
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
      await api(`/fields?${fieldsQuery()}`, {
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

  const onUpdateSubmit = async (fieldId: number, data: UpdateFormData, subFields?: SubFieldDef[]) => {
    if (!token || orgId == null) return;
    setError(null);
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
      await api(`/fields/${fieldId}?${fieldsQuery()}`, {
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

  const onSaveCardDisplayFields = async (ids: number[]) => {
    if (!token || !kpiId) return;
    setSavingCardDisplay(true);
    setCardDisplaySaveError(null);
    try {
      const orderedIds = list.filter((f) => ids.includes(f.id)).map((f) => f.id);
      const query = orgId != null ? `?organization_id=${orgId}` : "";
      await api(`/kpis/${kpiId}${query}`, {
        method: "PATCH",
        body: JSON.stringify({ card_display_field_ids: orderedIds }),
        token,
      });
      setKpi((prev) => (prev ? { ...prev, card_display_field_ids: orderedIds } : null));
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
      onSaveCardDisplayFields(next);
      autosaveTimerRef.current = null;
    }, 500);
  };

  const onDelete = async (fieldId: number) => {
    if (!token || orgId == null) return;
    setError(null);
    try {
      const summary = await api<{ has_child_data: boolean; field_values_count: number; report_template_fields_count: number }>(
        `/fields/${fieldId}/child_data_summary?${fieldsQuery()}`,
        { token }
      );
      const message = summary.has_child_data
        ? `This field has ${summary.field_values_count} stored value(s) and ${summary.report_template_fields_count} report template reference(s). Deleting will remove them. Continue?`
        : "Delete this field?";
      if (!confirm(message)) return;
      await api(`/fields/${fieldId}?${fieldsQuery()}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const onKpiUpdateSubmit = async (data: KpiUpdateFormData) => {
    if (!token || !kpiId || orgIdFromUrl == null) return;
    setKpiSaveError(null);
    setKpiSaving(true);
    try {
      const updated = await api<KpiInfo>(`/kpis/${kpiId}?${qs({ organization_id: orgIdFromUrl })}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          year: data.year,
          sort_order: data.sort_order,
          entry_mode: data.entry_mode ?? "manual",
          api_endpoint_url: data.entry_mode === "api" && data.api_endpoint_url ? data.api_endpoint_url.trim() : null,
          time_dimension: data.time_dimension && data.time_dimension.trim() ? data.time_dimension.trim() : null,
          organization_tag_ids: data.organization_tag_ids ?? [],
        }),
      });
      setKpi(updated);
    } catch (e) {
      setKpiSaveError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setKpiSaving(false);
    }
  };

  const fetchContract = async () => {
    if (!token || !kpiId || orgIdFromUrl == null) return;
    if (contract !== null) {
      setContractOpen((o) => !o);
      return;
    }
    try {
      const c = await api<Record<string, unknown>>(
        `/kpis/${kpiId}/api-contract?${qs({ organization_id: orgIdFromUrl })}`,
        { token }
      );
      setContract(c);
      setContractOpen(true);
    } catch {
      setContract({});
      setContractOpen(true);
    }
  };

  const addCategoriesBatch = async (categoryIds: number[]) => {
    if (!token || !kpiId || orgIdFromUrl == null || categoryIds.length === 0) return;
    setDomainCategorySaving(true);
    try {
      for (const id of categoryIds) {
        await api(`/kpis/${kpiId}/categories/${id}?${qs({ organization_id: orgIdFromUrl })}`, { method: "POST", token });
      }
      loadKpi();
      setAddModal(null);
      setAddModalSearch("");
      setAddModalCategorySearch("");
      setAddModalSelectedIds([]);
      setAddModalSelectedDomainIds([]);
    } finally {
      setDomainCategorySaving(false);
    }
  };

  const addTagsBatch = async (tagIds: number[]) => {
    if (!token || !kpiId || orgIdFromUrl == null || tagIds.length === 0) return;
    const currentIds = (kpi?.organization_tags ?? []).map((t) => t.id);
    await updateOrgTags([...currentIds, ...tagIds]);
    setAddModal(null);
    setAddModalSearch("");
    setAddModalSelectedIds([]);
  };

  const removeCategory = async (categoryId: number) => {
    if (!token || !kpiId || orgIdFromUrl == null) return;
    setDomainCategorySaving(true);
    try {
      await api(`/kpis/${kpiId}/categories/${categoryId}?${qs({ organization_id: orgIdFromUrl })}`, { method: "DELETE", token });
      loadKpi();
    } finally {
      setDomainCategorySaving(false);
    }
  };

  const updateOrgTags = async (tagIds: number[]) => {
    if (!token || !kpiId || orgIdFromUrl == null) return;
    setTagSaving(true);
    try {
      const updated = await api<KpiInfo>(`/kpis/${kpiId}?${qs({ organization_id: orgIdFromUrl })}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ organization_tag_ids: tagIds }),
      });
      setKpi(updated);
    } finally {
      setTagSaving(false);
    }
  };

  const onDeleteKpi = async () => {
    if (!token || !kpiId || orgIdFromUrl == null) return;
    try {
      const summary = await api<{
        has_child_data: boolean;
        assignments_count: number;
        entries_count: number;
        fields_count: number;
        field_values_count: number;
        report_template_kpis_count: number;
      }>(`/kpis/${kpiId}/child_data_summary?${qs({ organization_id: orgIdFromUrl })}`, { token });
      const message = summary.has_child_data
        ? `This KPI has ${summary.assignments_count} assignment(s), ${summary.entries_count} entry/entries, ${summary.fields_count} field(s), ${summary.field_values_count} stored value(s), and ${summary.report_template_kpis_count} report template reference(s). Deleting will remove all of them. Continue?`
        : "Delete this KPI?";
      if (!confirm(message)) return;
      await api(`/kpis/${kpiId}?${qs({ organization_id: orgIdFromUrl })}`, { method: "DELETE", token });
      window.location.href = `/dashboard/organizations/${orgIdFromUrl}?tab=kpis`;
    } catch (e) {
      setKpiSaveError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (!kpiId) return <p>Invalid KPI.</p>;
  if (loading && list.length === 0 && !kpi) return <p>Loading...</p>;

  const isOrgContext = orgIdFromUrl != null && kpi != null;

  const tabBarStyle = {
    display: "flex",
    gap: "0.25rem",
    borderBottom: "1px solid var(--border)",
    marginBottom: "1.25rem",
    paddingBottom: 0,
  } as const;

  const tabButtonStyle = (active: boolean) =>
    ({
      padding: "0.6rem 1rem",
      fontSize: "0.95rem",
      fontWeight: 500,
      border: "none",
      borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
      background: "none",
      color: active ? "var(--primary)" : "var(--muted)",
      cursor: "pointer",
      marginBottom: "-1px",
      borderRadius: "6px 6px 0 0",
    }) as const;

  const content = (
    <>
    <div>
      {!isOrgContext && (
        <div style={{ marginBottom: "1rem" }}>
          <Link href="/dashboard/kpis" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {"\u2190"} KPIs
          </Link>
        </div>
      )}

      {isOrgContext && (
        <>
          {kpi && (
          <>
          {/* KPI summary card: name, collapse toggle, domains/categories/tags (add/remove), used in reports */}
          <div
            className="card"
            style={{
              marginBottom: "1.25rem",
              padding: "1.25rem 1.5rem",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setDetailsExpanded((e) => !e)}
                style={{
                  padding: "0.2rem 0.35rem",
                  border: "none",
                  background: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                }}
                title={detailsExpanded ? "Hide details" : "Show details"}
                aria-expanded={detailsExpanded}
              >
                <span style={{ display: "inline-block", transform: detailsExpanded ? "rotate(0deg)" : "rotate(-90deg)" }}>▼</span>
                <span>{detailsExpanded ? "Hide details" : "Show details"}</span>
              </button>
              <h1
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  margin: 0,
                  letterSpacing: "-0.02em",
                  color: "var(--text)",
                }}
              >
                {kpi.name}
              </h1>
              {kpi.entry_mode === "api" && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: "var(--primary)",
                    padding: "0.2rem 0.5rem",
                    borderRadius: 6,
                    background: "rgba(var(--primary-rgb, 59, 130, 246), 0.12)",
                  }}
                >
                  API
                </span>
              )}
            </div>

            {detailsExpanded && (
            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
              {[
                {
                  label: "Domain → Category",
                  content: (kpi.category_tags?.length ?? 0) > 0 ? (
                    <>
                      {kpi.category_tags!.map((c) => {
                        const full = c.domain_name ? `${c.domain_name} → ${c.name}` : c.name;
                        return (
                          <span
                            key={c.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem",
                              marginRight: "0.35rem",
                              marginBottom: "0.35rem",
                              padding: "0.25rem 0.5rem",
                              borderRadius: 6,
                              background: "rgba(var(--primary-rgb, 59, 130, 246), 0.12)",
                              border: "1px solid rgba(var(--primary-rgb, 59, 130, 246), 0.35)",
                              fontSize: "0.8rem",
                              color: "var(--text)",
                              fontWeight: 500,
                            }}
                          >
                            <span>{full}</span>
                            <button type="button" onClick={() => removeCategory(c.id)} disabled={domainCategorySaving} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)", fontSize: "1rem", lineHeight: 1 }} aria-label={`Remove ${full}`}>×</button>
                          </span>
                        );
                      })}
                      <button type="button" onClick={() => { setAddModal("categories"); setAddModalSearch(""); setAddModalCategorySearch(""); setAddModalSelectedIds([]); setAddModalSelectedDomainIds([...new Set((kpi.category_tags ?? []).map((c) => c.domain_id).filter((id): id is number => id != null))]); }} disabled={domainCategorySaving} style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline", marginLeft: "0.15rem" }}>Add</button>
                    </>
                  ) : orgCategories.length > 0 ? (
                    <button type="button" onClick={() => { setAddModal("categories"); setAddModalSearch(""); setAddModalCategorySearch(""); setAddModalSelectedIds([]); setAddModalSelectedDomainIds([...new Set((kpi.category_tags ?? []).map((c) => c.domain_id).filter((id): id is number => id != null))]); }} disabled={domainCategorySaving} style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline" }}>Add</button>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>—</span>
                  ),
                },
                {
                  label: "Tags",
                  content: (kpi.organization_tags?.length ?? 0) > 0 ? (
                    <>
                      {kpi.organization_tags!.map((t) => {
                        const full = t.name;
                        return (
                          <span
                            key={t.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.35rem",
                              marginRight: "0.35rem",
                              marginBottom: "0.35rem",
                              padding: "0.25rem 0.5rem",
                              borderRadius: 6,
                              background: "rgba(99, 102, 241, 0.12)",
                              border: "1px solid rgba(99, 102, 241, 0.35)",
                              fontSize: "0.8rem",
                              color: "var(--text)",
                              fontWeight: 500,
                            }}
                          >
                            <span>{full}</span>
                            <button type="button" onClick={() => updateOrgTags((kpi.organization_tags ?? []).filter((x) => x.id !== t.id).map((x) => x.id))} disabled={tagSaving} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)", fontSize: "1rem", lineHeight: 1 }} aria-label={`Remove ${full}`}>×</button>
                          </span>
                        );
                      })}
                      <button type="button" onClick={() => { setAddModal("tags"); setAddModalSearch(""); setAddModalSelectedIds([]); }} disabled={tagSaving} style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline", marginLeft: "0.15rem" }}>Add</button>
                    </>
                  ) : orgTags.length > 0 ? (
                    <button type="button" onClick={() => { setAddModal("tags"); setAddModalSearch(""); setAddModalSelectedIds([]); }} disabled={tagSaving} style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline" }}>Add</button>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>—</span>
                  ),
                },
                {
                  label: "Reports",
                  content: (kpi.used_in_reports?.length ?? 0) > 0 ? (
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.2rem 0.35rem" }}>
                      {kpi.used_in_reports!.map((r) => (
                        <Link
                          key={r.report_id}
                          href={`/dashboard/reports/${r.report_id}?organization_id=${r.organization_id}`}
                          title={r.report_name}
                          style={{ color: "var(--primary)", textDecoration: "none", fontSize: "0.8rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}
                        >
                          {r.report_name}
                        </Link>
                      ))}
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>—</span>
                  ),
                },
              ].map((row, idx) => (
                <div
                  key={row.label}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.75rem",
                    padding: "0.35rem 0",
                    borderBottom: idx < 2 ? "1px solid var(--border)" : "none",
                    minHeight: 28,
                  }}
                >
                  <span style={{ flexShrink: 0, width: 110, fontSize: "0.75rem", color: "var(--muted)" }}>{row.label}</span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.2rem" }}>
                    {row.content}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
          </>
          )}
          <div style={tabBarStyle} role="tablist" aria-label="KPI edit sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeEditTab === "details"}
              style={tabButtonStyle(activeEditTab === "details")}
              onClick={() => setEditTab("details")}
            >
              Details
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeEditTab === "fields"}
              style={tabButtonStyle(activeEditTab === "fields")}
              onClick={() => setEditTab("fields")}
            >
              Fields {list.length > 0 && <span style={{ marginLeft: "0.35rem", opacity: 0.8 }}>({list.length})</span>}
            </button>
          </div>
        </>
      )}

      {isOrgContext && activeEditTab === "details" && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>KPI details</h2>
          <form onSubmit={kpiEditForm.handleSubmit(onKpiUpdateSubmit)}>
            <div className="form-group">
              <label>Name *</label>
              <input {...kpiEditForm.register("name")} />
              {kpiEditForm.formState.errors.name && (
                <p className="form-error">{kpiEditForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea {...kpiEditForm.register("description")} rows={2} />
            </div>
            <div className="form-group">
              <label>Year *</label>
              <input type="number" min={2000} max={2100} {...kpiEditForm.register("year")} />
            </div>
            <div className="form-group">
              <label>Sort order</label>
              <input type="number" min={0} {...kpiEditForm.register("sort_order")} />
            </div>
            <div className="form-group">
              <label>Time dimension</label>
              <select {...kpiEditForm.register("time_dimension")}>
                <option value="">Inherit from organization ({TIME_DIMENSION_LABELS[orgTimeDimension] ?? orgTimeDimension})</option>
                {TIME_DIMENSION_ORDER.filter((td) => {
                  const orgIdx = TIME_DIMENSION_ORDER.indexOf(orgTimeDimension as (typeof TIME_DIMENSION_ORDER)[number]);
                  const kpiIdx = TIME_DIMENSION_ORDER.indexOf(td);
                  return orgIdx >= 0 && kpiIdx >= orgIdx;
                }).map((td) => (
                  <option key={td} value={td}>
                    {TIME_DIMENSION_LABELS[td] ?? td}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                Leave as inherit to use the organization default. Otherwise choose same or finer (e.g. Quarterly when org is Yearly).
              </p>
            </div>
            <div className="form-group">
              <label>Entry mode</label>
              <select
                {...kpiEditForm.register("entry_mode")}
                disabled={userRole !== "SUPER_ADMIN"}
              >
                <option value="manual">Manual (default)</option>
                <option value="api">API</option>
              </select>
            </div>
            {userRole === "SUPER_ADMIN" && kpiEditForm.watch("entry_mode") === "api" && (
              <>
                <div className="form-group">
                  <label>API endpoint URL</label>
                  <input
                    type="url"
                    placeholder="https://your-server.com/kpi-data"
                    {...kpiEditForm.register("api_endpoint_url")}
                    style={{ width: "100%", maxWidth: "480px" }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                  <button type="button" className="btn" onClick={fetchContract}>
                    {contractOpen ? "Hide" : "Show"} operation contract
                  </button>
                  {contractOpen && contract && (
                    <pre
                      style={{
                        marginTop: "0.5rem",
                        padding: "0.75rem",
                        background: "var(--bg-subtle)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: "0.85rem",
                        overflow: "auto",
                        maxHeight: 320,
                      }}
                    >
                      {JSON.stringify(contract, null, 2)}
                    </pre>
                  )}
                </div>
                {kpi?.entry_mode === "api" && kpi?.api_endpoint_url && (
                  <div className="form-group">
                    <p style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: "0.35rem" }}>When syncing:</p>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="syncMode"
                          checked={syncMode === "override"}
                          onChange={() => setSyncMode("override")}
                        />
                        Override existing data
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="syncMode"
                          checked={syncMode === "append"}
                          onChange={() => setSyncMode("append")}
                        />
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
                          await api(
                            `/kpis/${kpiId}/sync-from-api?${qs({
                              year: kpi.year,
                              organization_id: orgIdFromUrl!,
                              sync_mode: syncMode,
                            })}`,
                            { method: "POST", token: token! }
                          );
                          loadKpi();
                        } finally {
                          setSyncLoading(false);
                        }
                      }}
                    >
                      {syncLoading ? "Syncing…" : "Sync from API now"}
                    </button>
                  </div>
                )}
              </>
            )}
            {orgTags.length > 0 && (
              <div className="form-group">
                <label>Organization tags</label>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.35rem 0" }}>
                  Use tags to group and filter KPIs inside this organization.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {orgTags.map((t) => {
                    const ids = kpiEditForm.watch("organization_tag_ids") ?? [];
                    const checked = ids.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          const prev = kpiEditForm.getValues("organization_tag_ids") ?? [];
                          const next = prev.includes(t.id)
                            ? prev.filter((id) => id !== t.id)
                            : [...prev, t.id];
                          kpiEditForm.setValue("organization_tag_ids", next);
                        }}
                        style={{
                          borderRadius: 999,
                          padding: "0.25rem 0.75rem",
                          fontSize: "0.85rem",
                          border: checked ? "1px solid var(--primary)" : "1px solid var(--border)",
                          backgroundColor: checked ? "rgba(59, 130, 246, 0.08)" : "transparent",
                          color: checked ? "var(--primary)" : "var(--muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          cursor: "pointer",
                          transition: "background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease",
                        }}
                      >
                        {checked && (
                          <span aria-hidden="true" style={{ fontSize: "0.8rem" }}>
                            ✓
                          </span>
                        )}
                        <span>{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {kpiSaveError && <p className="form-error" style={{ marginBottom: "0.5rem" }}>{kpiSaveError}</p>}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={kpiEditForm.formState.isSubmitting || kpiSaving}
              >
                {kpiSaving ? "Saving…" : "Save KPI"}
              </button>
              <button
                type="button"
                className="btn"
                style={{ color: "var(--error)" }}
                onClick={onDeleteKpi}
              >
                Delete KPI
              </button>
            </div>
          </form>
        </div>
      )}

      {(!isOrgContext || activeEditTab === "fields") && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <h2 style={{ fontSize: isOrgContext ? "1.15rem" : "1.5rem", margin: 0 }}>
                {isOrgContext ? "Fields" : `Fields for ${kpi ? `${kpi.name} (${kpi.year})` : `KPI #${kpiId}`}`}
              </h2>
              {userRole === "SUPER_ADMIN" && (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
                  Use &quot;Show on card&quot; next to each field to choose which fields appear on this KPI&apos;s card on the domain page.
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreate((s) => !s)}
            >
              {showCreate ? "Cancel" : "Add field"}
            </button>
          </div>

          {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create field</h2>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Name * (display label)</label>
              <input {...createForm.register("name")} placeholder="e.g. Total students" />
              {createForm.formState.errors.name && (
                <p className="form-error">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Key * (unique, lowercase, e.g. total_students)</label>
              <input {...createForm.register("key")} placeholder="total_students" />
              {createForm.formState.errors.key && (
                <p className="form-error">{createForm.formState.errors.key.message}</p>
              )}
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
                  organizationId={kpi?.organization_id}
                  currentKpiId={kpiId}
                />
              </div>
            )}
            {createForm.watch("field_type") === "multi_line_items" && (
              <div className="form-group">
                <label>Sub-fields (columns for each row)</label>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 0" }}>
                  Define columns so data entry uses a table instead of raw JSON.
                </p>
                {createSubFields.map((s, idx) => (
                  <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                    <input
                      placeholder="Name"
                      value={s.name}
                      onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                      style={{ width: "120px" }}
                    />
                    <input
                      placeholder="key"
                      value={s.key}
                      onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)))}
                      style={{ width: "100px" }}
                    />
                    <select
                      value={s.field_type}
                      onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, field_type: e.target.value } : x)))}
                    >
                      {SUB_FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.9rem" }}>
                      <input
                        type="checkbox"
                        checked={s.is_required}
                        onChange={(e) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, is_required: e.target.checked } : x)))}
                      />
                      Required
                    </label>
                    <button type="button" className="btn" onClick={() => setCreateSubFields((prev) => prev.filter((_, i) => i !== idx))}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn" onClick={() => setCreateSubFields((prev) => [...prev, { name: "", key: "", field_type: "single_line_text", is_required: false, sort_order: prev.length }])}>
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
          <p style={{ color: "var(--muted)" }}>No fields yet. Add one above to build the data entry form for this KPI.</p>
        ) : (
          <ul style={{ listStyle: "none" }}>
            {userRole === "SUPER_ADMIN" && (
              <li style={{ padding: "0 0 0.75rem 0", borderBottom: "1px solid var(--border)", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div>
                    <strong>Shown on domain KPI card</strong>
                    <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
                      Tick fields below to show on KPI cards on the domain page.
                    </p>
                    {savingCardDisplay && (
                      <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>Saving…</p>
                    )}
                    {!savingCardDisplay && cardDisplaySaved && !cardDisplaySaveError && (
                      <p style={{ color: "var(--success)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>Saved</p>
                    )}
                    {cardDisplaySaveError && (
                      <p className="form-error" style={{ margin: "0.25rem 0 0" }}>{cardDisplaySaveError}</p>
                    )}
                  </div>
                </div>
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
                    organizationId={kpi?.organization_id}
                    currentKpiId={kpiId}
                  />
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                      <strong>{f.name}</strong>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.9rem" }}>({f.key})</span>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}> - {f.field_type.replace(/_/g, " ")}</span>
                      {f.is_required && <span style={{ marginLeft: "0.5rem", color: "var(--warning)" }}>Required</span>}
                      {f.field_type === "formula" && f.formula_expression && (
                        <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Formula: {f.formula_expression}
                        </span>
                      )}
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
        </>
      )}
    </div>

    {addModal && kpi && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.4)",
        }}
        onClick={() => setAddModal(null)}
        role="dialog"
        aria-modal="true"
        aria-label={addModal === "categories" ? "Add domain → category" : "Add tags"}
      >
        <div
          className="card"
          style={{
            maxWidth: addModal === "categories" ? 560 : 420,
            width: "90%",
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 style={{ fontSize: "1.1rem", margin: "0 0 1rem 0", paddingRight: "2rem" }}>
            {addModal === "categories" ? "Add domain → category" : "Add tags"}
          </h2>
          {addModal === "categories" ? (
            <div style={{ display: "flex", gap: "1rem", flex: 1, minHeight: 200, overflow: "hidden" }}>
              <div style={{ flex: "0 0 44%", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", paddingRight: "0.75rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.5rem" }}>Domains</div>
                <input
                  type="text"
                  placeholder="Search domains..."
                  value={addModalSearch}
                  onChange={(e) => setAddModalSearch(e.target.value)}
                  style={{ marginBottom: "0.5rem", padding: "0.4rem 0.5rem", fontSize: "0.9rem" }}
                />
                <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 }}>
                  {orgDomains
                    .filter((d) => !addModalSearch.trim() || d.name.toLowerCase().includes(addModalSearch.trim().toLowerCase()))
                    .map((d) => (
                      <li key={d.id} style={{ marginBottom: "0.2rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input
                            type="checkbox"
                            checked={addModalSelectedDomainIds.includes(d.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAddModalSelectedDomainIds((prev) => [...prev, d.id]);
                              } else {
                                setAddModalSelectedDomainIds((prev) => prev.filter((id) => id !== d.id));
                                setAddModalSelectedIds((prev) => {
                                  const inDomain = orgCategories.filter((c) => c.domain_id === d.id).map((c) => c.id);
                                  return prev.filter((id) => !inDomain.includes(id));
                                });
                              }
                            }}
                          />
                          {d.name}
                        </label>
                      </li>
                    ))}
                </ul>
              </div>
              <div style={{ flex: "1", display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.5rem" }}>Categories (select domains first)</div>
                {addModalSelectedDomainIds.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Select one or more domains to see their categories.</p>
                ) : (() => {
                  const allInSelectedDomains = orgCategories.filter(
                    (c) => c.domain_id != null && addModalSelectedDomainIds.includes(c.domain_id)
                  );
                  const filtered = addModalCategorySearch.trim()
                    ? allInSelectedDomains.filter((c) => c.name.toLowerCase().includes(addModalCategorySearch.trim().toLowerCase()))
                    : allInSelectedDomains;
                  const attachedIds = new Set((kpi.category_tags ?? []).map((t) => t.id));
                  return (
                    <>
                      <input
                        type="text"
                        placeholder="Search categories..."
                        value={addModalCategorySearch}
                        onChange={(e) => setAddModalCategorySearch(e.target.value)}
                        style={{ marginBottom: "0.5rem", padding: "0.4rem 0.5rem", fontSize: "0.9rem" }}
                      />
                      {filtered.length === 0 ? (
                        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No categories match.</p>
                      ) : (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 }}>
                          {filtered.map((c) => {
                            const isAttached = attachedIds.has(c.id);
                            return (
                              <li key={c.id} style={{ marginBottom: "0.2rem" }}>
                                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: isAttached ? "default" : "pointer", fontSize: "0.9rem", opacity: isAttached ? 0.85 : 1 }}>
                                  <input
                                    type="checkbox"
                                    checked={isAttached || addModalSelectedIds.includes(c.id)}
                                    disabled={isAttached}
                                    onChange={(e) => {
                                      if (isAttached) return;
                                      if (e.target.checked) {
                                        setAddModalSelectedIds((prev) => {
                                          const otherInDomain = orgCategories.filter((x) => x.domain_id === c.domain_id && x.id !== c.id).map((x) => x.id);
                                          return [...prev.filter((id) => !otherInDomain.includes(id)), c.id];
                                        });
                                      } else {
                                        setAddModalSelectedIds((prev) => prev.filter((id) => id !== c.id));
                                      }
                                    }}
                                  />
                                  <span style={{ color: isAttached ? "var(--muted)" : undefined }}>{c.name}</span>
                                  {isAttached && <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>(attached)</span>}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            <>
          <input
            type="text"
            placeholder="Search..."
            value={addModalSearch}
            onChange={(e) => setAddModalSearch(e.target.value)}
            style={{ marginBottom: "0.75rem", padding: "0.5rem 0.6rem" }}
            autoFocus
          />
          <div style={{ flex: 1, overflowY: "auto", minHeight: 120, marginBottom: "1rem" }}>
            {addModal === "tags" && (() => {
              const available = orgTags.filter((t) => !kpi.organization_tags?.some((ot) => ot.id === t.id));
              const filtered = addModalSearch.trim()
                ? available.filter((t) => t.name.toLowerCase().includes(addModalSearch.trim().toLowerCase()))
                : available;
              return filtered.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No tags to add.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {filtered.map((t) => (
                    <li key={t.id} style={{ marginBottom: "0.25rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.95rem" }}>
                        <input
                          type="checkbox"
                          checked={addModalSelectedIds.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) setAddModalSelectedIds((prev) => [...prev, t.id]);
                            else setAddModalSelectedIds((prev) => prev.filter((id) => id !== t.id));
                          }}
                        />
                        {t.name}
                      </label>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
          </>
          )}
          {addModal === "categories" && <div style={{ marginBottom: "1rem" }} />}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn"
              onClick={() => { setAddModal(null); setAddModalSearch(""); setAddModalCategorySearch(""); setAddModalSelectedIds([]); setAddModalSelectedDomainIds([]); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={addModalSelectedIds.length === 0 || (addModal === "categories" && domainCategorySaving) || (addModal === "tags" && tagSaving)}
              onClick={() => {
                if (addModal === "categories") addCategoriesBatch(addModalSelectedIds);
                else addTagsBatch(addModalSelectedIds);
              }}
            >
              {addModal === "categories" ? (domainCategorySaving ? "Adding…" : "Add selected") : (tagSaving ? "Adding…" : "Add selected")}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
  return content;
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
          <select
            value={refFieldId}
            onChange={(e) => { setRefFieldId(e.target.value ? Number(e.target.value) : ""); setRefSubKey(""); setRefFilterSubKey(""); }}
            style={{ minWidth: "160px" }}
          >
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
        {canInsertNumber && (
          <button type="button" className="btn btn-primary" onClick={() => refField && onInsert(refField.key)}>Insert field</button>
        )}
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
  onSave: (data: UpdateFormData, subFields?: SubFieldDef[]) => void;
  onCancel: () => void;
  organizationId?: number;
  currentKpiId?: number;
}) {
  const [editSubFields, setEditSubFields] = useState<SubFieldDef[]>(
    () => (field.sub_fields ?? []).map((s) => ({ ...s, name: s.name, key: s.key, field_type: s.field_type, is_required: s.is_required ?? false, sort_order: s.sort_order ?? 0 }))
  );
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      name: field.name,
      key: field.key,
      field_type: field.field_type as CreateFormData["field_type"],
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
          {editSubFields.map((s, idx) => (
            <div key={s.id ?? idx} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
              <input
                placeholder="Name"
                value={s.name}
                onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                style={{ width: "120px" }}
              />
              <input
                placeholder="key"
                value={s.key}
                onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, key: e.target.value } : x)))}
                style={{ width: "100px" }}
              />
              <select
                value={s.field_type}
                onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, field_type: e.target.value } : x)))}
              >
                {SUB_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.9rem" }}>
                <input
                  type="checkbox"
                  checked={s.is_required}
                  onChange={(e) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, is_required: e.target.checked } : x)))}
                />
                Required
              </label>
              <button type="button" className="btn" onClick={() => setEditSubFields((prev) => prev.filter((_, i) => i !== idx))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setEditSubFields((prev) => [...prev, { name: "", key: "", field_type: "single_line_text", is_required: false, sort_order: prev.length }])}>
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
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
