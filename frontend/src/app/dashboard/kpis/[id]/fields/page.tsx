"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

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
  "attachment",
  "reference",
  "multi_line_items",
  "formula",
] as const;

const SUB_FIELD_TYPES = ["single_line_text", "multi_line_text", "number", "date", "boolean", "reference", "attachment"] as const;

function slugifyKey(name: string): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

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
  { value: "op_contains", label: "contains" },
  { value: "op_not_contains", label: "does not contain" },
  { value: "op_starts_with", label: "starts with" },
  { value: "op_ends_with", label: "ends with" },
] as const;

interface ReferenceConfig {
  reference_source_kpi_id?: number;
  reference_source_field_key?: string;
  /** When source is a multi_line_items field, the sub-field key to use for values */
  reference_source_sub_field_key?: string;
}

interface SubFieldDef {
  id?: number;
  field_id?: number;
  name: string;
  key: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
  config?: (ReferenceConfig & { ui_section?: string }) | Record<string, unknown> | null;
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
  config?: ReferenceConfig | null;
  carry_forward_data?: boolean;
  full_page_multi_items?: boolean;
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
  year?: number | null;
  sort_order?: number;
  organization_id: number;
  card_display_field_ids?: number[] | null;
  entry_mode?: string;
  api_endpoint_url?: string | null;
  time_dimension?: string | null;
  carry_forward_data?: boolean;
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
  carry_forward_data: z.boolean().optional(),
  full_page_multi_items: z.boolean().optional(),
  multi_items_api_endpoint_url: z.union([z.literal(""), z.string().url("Must be a valid URL")]).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name required"),
  key: z.string().min(1, "Key required").regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers, underscore only"),
  field_type: z.enum(FIELD_TYPES),
  formula_expression: z.string().optional(),
  is_required: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
  carry_forward_data: z.boolean().optional(),
  full_page_multi_items: z.boolean().optional(),
  multi_items_api_endpoint_url: z.union([z.literal(""), z.string().url("Must be a valid URL")]).optional(),
});

const kpiUpdateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  sort_order: z.coerce.number().int().min(0),
  entry_mode: z.enum(["manual", "api"]),
  api_endpoint_url: z.string().max(2048).optional(),
  time_dimension: z.string().optional(),
  carry_forward_data: z.boolean().optional(),
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
  const [orgDomains, setOrgDomains] = useState<Array<{ id: number; name: string }>>([]);
  const [orgCategories, setOrgCategories] = useState<Array<{ id: number; name: string; domain_id?: number; domain_name?: string }>>([]);
  const [tagSaving, setTagSaving] = useState(false);
  const [domainCategorySaving, setDomainCategorySaving] = useState(false);
  const [addModal, setAddModal] = useState<null | "categories" | "tags">(null);
  const [addModalSearch, setAddModalSearch] = useState("");
  const [addModalCategorySearch, setAddModalCategorySearch] = useState("");
  const [addModalSelectedIds, setAddModalSelectedIds] = useState<number[]>([]);
  const [addModalSelectedDomainIds, setAddModalSelectedDomainIds] = useState<number[]>([]);
  type EditTabId = "details" | "fields" | "settings";
  const tabFromUrl = searchParams.get("tab") as EditTabId | null;
  const [activeEditTab, setActiveEditTab] = useState<EditTabId>(
    tabFromUrl === "details" || tabFromUrl === "fields" || tabFromUrl === "settings" ? tabFromUrl : "details"
  );
  const [settingsPanel, setSettingsPanel] = useState<"order" | "time_dimension" | "entry_mode" | "domain" | "tags" | "danger_zone" | null>(null);
  const [syncYear, setSyncYear] = useState<number>(() => new Date().getFullYear());
  const [keyTouched, setKeyTouched] = useState(false);
  /** For super admin without org in URL: org resolved from KPI by id so create/update field works. */
  const [kpiOrgId, setKpiOrgId] = useState<number | null>(null);

  const token = getAccessToken();
  const router = useRouter();

  useEffect(() => {
    if (tabFromUrl === "details" || tabFromUrl === "fields" || tabFromUrl === "settings") {
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
      sort_order: 0,
      entry_mode: "manual",
      api_endpoint_url: "",
      time_dimension: "",
      carry_forward_data: false,
      organization_tag_ids: [],
    },
  });

  useEffect(() => {
    if (kpi && orgIdFromUrl != null) {
      kpiEditForm.reset({
        name: kpi.name,
        description: kpi.description ?? "",
        sort_order: kpi.sort_order ?? 0,
        entry_mode: kpi.entry_mode === "api" ? "api" : "manual",
        api_endpoint_url: kpi.api_endpoint_url ?? "",
        time_dimension: kpi.time_dimension ?? "",
        carry_forward_data: kpi.carry_forward_data ?? false,
        organization_tag_ids: (kpi.organization_tags ?? []).map((t) => t.id),
      });
    }
  }, [kpi?.id, kpi?.name, kpi?.description, kpi?.sort_order, kpi?.entry_mode, kpi?.api_endpoint_url, kpi?.time_dimension, kpi?.carry_forward_data, kpi?.organization_tags, orgIdFromUrl]);

  useEffect(() => {
    if (!token) return;
    api<{ role: UserRole }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  // Super admin without org in URL: resolve org from KPI by id so create/update field and loadList work
  useEffect(() => {
    if (!token || !kpiId || userRole !== "SUPER_ADMIN") return;
    if (orgIdFromUrl != null) return;
    api<{ organization_id: number }>(`/kpis/${kpiId}`, { token })
      .then((data) => setKpiOrgId(data.organization_id))
      .catch(() => setKpiOrgId(null));
  }, [token, kpiId, userRole, orgIdFromUrl]);

  const orgId = kpi?.organization_id ?? kpiOrgId ?? orgIdFromUrl ?? null;
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

  // When super admin resolved org via kpiOrgId but loadKpi failed, still load fields list
  useEffect(() => {
    if (!token || !kpiId || kpiOrgId == null || kpi != null) return;
    loadList(kpiOrgId);
  }, [token, kpiId, kpiOrgId, kpi]);

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

  type CreateSubFieldRow = { name: string; key: string; field_type: string; is_required: boolean; sort_order: number; keyTouched?: boolean; config?: ReferenceConfig };
  const [createSubFields, setCreateSubFields] = useState<CreateSubFieldRow[]>([]);
  const [createRefConfig, setCreateRefConfig] = useState<ReferenceConfig>({});

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      key: "",
      field_type: "single_line_text",
      formula_expression: "",
      is_required: false,
      sort_order: list.length,
      carry_forward_data: false,
      full_page_multi_items: false,
      multi_items_api_endpoint_url: "",
    },
  });

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token || !kpiId) {
      setError("Session or KPI missing. Please refresh.");
      return;
    }
    if (orgId == null) {
      toast.error("Organization context is still loading. Please wait a moment and try again.");
      setError("Organization context is loading.");
      return;
    }
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
        carry_forward_data: data.carry_forward_data ?? false,
        full_page_multi_items: data.full_page_multi_items ?? false,
        options: [],
      };
      if (data.field_type === "reference" && createRefConfig.reference_source_kpi_id && createRefConfig.reference_source_field_key) {
        body.config = {
          reference_source_kpi_id: createRefConfig.reference_source_kpi_id,
          reference_source_field_key: createRefConfig.reference_source_field_key,
          ...(createRefConfig.reference_source_sub_field_key ? { reference_source_sub_field_key: createRefConfig.reference_source_sub_field_key } : {}),
        };
      }
      if (data.field_type === "multi_line_items" && createSubFields.length > 0) {
        body.sub_fields = createSubFields.map((s, i) => {
          const sub: Record<string, unknown> = {
            name: s.name,
            key: s.key,
            field_type: s.field_type,
            is_required: s.is_required,
            sort_order: s.sort_order ?? i,
          };
          const uiSection =
            s.config && typeof s.config === "object" && "ui_section" in s.config
              ? String((s.config as any).ui_section ?? "").trim()
              : "";
          const hasUiSection = uiSection.length > 0;
          const hasRefConfig =
            s.field_type === "reference" &&
            s.config?.reference_source_kpi_id &&
            s.config?.reference_source_field_key;

          if (hasUiSection || hasRefConfig) {
            sub.config = {
              ...(hasUiSection ? { ui_section: uiSection } : {}),
              ...(hasRefConfig
                ? {
                    reference_source_kpi_id: (s.config as any).reference_source_kpi_id,
                    reference_source_field_key: (s.config as any).reference_source_field_key,
                    ...((s.config as any).reference_source_sub_field_key
                      ? { reference_source_sub_field_key: (s.config as any).reference_source_sub_field_key }
                      : {}),
                  }
                : {}),
            };
          }
          return sub;
        });
        if (data.multi_items_api_endpoint_url) {
          body.config = {
            ...(body.config as Record<string, unknown> | undefined ?? {}),
            multi_items_api_endpoint_url: data.multi_items_api_endpoint_url.trim(),
          };
        }
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
        carry_forward_data: false,
      });
      setKeyTouched(false);
      setCreateSubFields([]);
      setCreateRefConfig({});
      setShowCreate(false);
      loadList();
      toast.success("Field created");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Create failed";
      setError(msg);
      toast.error(msg);
    }
  };

  const onUpdateSubmit = async (fieldId: number, data: UpdateFormData, subFields?: SubFieldDef[], refConfig?: ReferenceConfig) => {
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
        carry_forward_data: data.carry_forward_data,
        full_page_multi_items: data.full_page_multi_items,
      };
      if (data.field_type === "reference" && refConfig?.reference_source_kpi_id && refConfig?.reference_source_field_key) {
        body.config = {
          reference_source_kpi_id: refConfig.reference_source_kpi_id,
          reference_source_field_key: refConfig.reference_source_field_key,
          ...(refConfig.reference_source_sub_field_key ? { reference_source_sub_field_key: refConfig.reference_source_sub_field_key } : {}),
        };
      }
      if (data.field_type === "multi_line_items") {
        const existingField = list.find((f) => f.id === fieldId);
        const existingConfig = (existingField?.config as Record<string, unknown> | null) ?? {};
        if (data.multi_items_api_endpoint_url) {
          body.config = {
            ...(body.config as Record<string, unknown> | undefined ?? existingConfig),
            multi_items_api_endpoint_url: data.multi_items_api_endpoint_url.trim(),
          };
        } else if (existingConfig && "multi_items_api_endpoint_url" in existingConfig) {
          const { multi_items_api_endpoint_url, ...rest } = existingConfig;
          body.config = rest;
        }
      }
      if (data.field_type === "multi_line_items" && subFields != null) {
        body.sub_fields = subFields.map((s, i) => {
          const sub: Record<string, unknown> = {
            name: s.name,
            key: s.key,
            field_type: s.field_type,
            is_required: s.is_required,
            sort_order: s.sort_order ?? i,
          };
          const uiSection =
            s.config && typeof s.config === "object" && "ui_section" in s.config
              ? String((s.config as any).ui_section ?? "").trim()
              : "";
          const hasUiSection = uiSection.length > 0;
          const hasRefConfig =
            s.field_type === "reference" &&
            s.config?.reference_source_kpi_id &&
            s.config?.reference_source_field_key;

          if (hasUiSection || hasRefConfig) {
            sub.config = {
              ...(hasUiSection ? { ui_section: uiSection } : {}),
              ...(hasRefConfig
                ? {
                    reference_source_kpi_id: (s.config as any).reference_source_kpi_id,
                    reference_source_field_key: (s.config as any).reference_source_field_key,
                    ...((s.config as any).reference_source_sub_field_key
                      ? { reference_source_sub_field_key: (s.config as any).reference_source_sub_field_key }
                      : {}),
                  }
                : {}),
            };
          }
          return sub;
        });
      }
      await api(`/fields/${fieldId}?${fieldsQuery()}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      });
      setEditingId(null);
      loadList();
      toast.success("Field updated successfully");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      setError(msg);
      toast.error(msg);
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
      toast.success("Field deleted successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      toast.error(e instanceof Error ? e.message : "Delete failed");
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
          sort_order: data.sort_order,
          entry_mode: data.entry_mode ?? "manual",
          api_endpoint_url: data.entry_mode === "api" && data.api_endpoint_url ? data.api_endpoint_url.trim() : null,
          time_dimension: data.time_dimension && data.time_dimension.trim() ? data.time_dimension.trim() : null,
          carry_forward_data: data.carry_forward_data,
          organization_tag_ids: data.organization_tag_ids ?? [],
        }),
      });
      setKpi(updated);
      toast.success("KPI settings updated successfully");
    } catch (e) {
      setKpiSaveError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
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
      toast.success("Categories attached successfully");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to attach categories");
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
      toast.success("Category unattached successfully");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unattach category");
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
      toast.success("KPI deleted successfully");
      window.location.href = `/dashboard/organizations/${orgIdFromUrl}?tab=kpis`;
    } catch (e) {
      setKpiSaveError(e instanceof Error ? e.message : "Delete failed");
      toast.error(e instanceof Error ? e.message : "Delete failed");
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
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em", color: "var(--text)" }}>
                {kpi.name}
              </h1>
              {kpi.entry_mode === "api" && (
                <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--primary)", padding: "0.2rem 0.5rem", borderRadius: 6, background: "rgba(var(--primary-rgb, 59, 130, 246), 0.12)" }}>
                  API
                </span>
              )}
            </div>
            {(kpi.category_tags?.length ?? 0) > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem", marginTop: "0.5rem" }}>
                {kpi.category_tags!.map((c) => {
                  const full = c.domain_name ? `${c.domain_name} → ${c.name}` : c.name;
                  return (
                    <span
                      key={c.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
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
                      {userRole === "SUPER_ADMIN" && (
                        <button type="button" onClick={() => removeCategory(c.id)} disabled={domainCategorySaving} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)", fontSize: "1rem", lineHeight: 1 }} aria-label={`Remove ${full}`}>×</button>
                      )}
                    </span>
                  );
                })}
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
            <button
              type="button"
              role="tab"
              aria-selected={activeEditTab === "settings"}
              style={tabButtonStyle(activeEditTab === "settings")}
              onClick={() => setEditTab("settings")}
            >
              Settings
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
            {kpiSaveError && <p className="form-error" style={{ marginBottom: "0.5rem" }}>{kpiSaveError}</p>}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={kpiEditForm.formState.isSubmitting || kpiSaving}
              >
                {kpiSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isOrgContext && activeEditTab === "settings" && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Settings</h2>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "1.5rem", minHeight: 320, alignItems: "start" }}>
            <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem", borderRight: "1px solid var(--border)", paddingRight: "1rem" }}>
              {[
                { id: "order" as const, label: "Order" },
                { id: "time_dimension" as const, label: "Time dimension" },
                { id: "entry_mode" as const, label: "Entry mode" },
                { id: "domain" as const, label: "Domain" },
                { id: "tags" as const, label: "Tags" },
                { id: "danger_zone" as const, label: "Danger zone" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSettingsPanel(id)}
                  style={{
                    textAlign: "left",
                    padding: "0.5rem 0.6rem",
                    borderRadius: 6,
                    border: "none",
                    background: settingsPanel === id ? "rgba(var(--primary-rgb, 59, 130, 246), 0.12)" : "transparent",
                    color: settingsPanel === id ? "var(--primary)" : "var(--text)",
                    cursor: "pointer",
                    fontSize: "0.9rem",
                    fontWeight: settingsPanel === id ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div style={{ minWidth: 0 }}>
              {settingsPanel === "order" && (
                <form onSubmit={kpiEditForm.handleSubmit(onKpiUpdateSubmit)}>
                  <div className="form-group">
                    <label>Sort order</label>
                    <input type="number" min={0} {...kpiEditForm.register("sort_order")} />
                  </div>
                  {kpiSaveError && <p className="form-error" style={{ marginBottom: "0.5rem" }}>{kpiSaveError}</p>}
                  <button type="submit" className="btn btn-primary" disabled={kpiEditForm.formState.isSubmitting || kpiSaving}>
                    {kpiSaving ? "Saving…" : "Save"}
                  </button>
                </form>
              )}
              {settingsPanel === "time_dimension" && (
                <form onSubmit={kpiEditForm.handleSubmit(onKpiUpdateSubmit)}>
                  <div className="form-group">
                    <label>Time dimension</label>
                    <select {...kpiEditForm.register("time_dimension")}>
                      <option value="">Inherit from organization ({TIME_DIMENSION_LABELS[orgTimeDimension] ?? orgTimeDimension})</option>
                      {TIME_DIMENSION_ORDER.filter((td) => {
                        const orgIdx = TIME_DIMENSION_ORDER.indexOf(orgTimeDimension as (typeof TIME_DIMENSION_ORDER)[number]);
                        const kpiIdx = TIME_DIMENSION_ORDER.indexOf(td);
                        return orgIdx >= 0 && kpiIdx >= orgIdx;
                      }).map((td) => (
                        <option key={td} value={td}>{TIME_DIMENSION_LABELS[td] ?? td}</option>
                      ))}
                    </select>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                      Leave as inherit to use the organization default.
                    </p>
                  </div>
                  {userRole === "SUPER_ADMIN" && (
                    <div className="form-group" style={{ marginTop: "1rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                        <input type="checkbox" {...kpiEditForm.register("carry_forward_data")} />
                        Carry forward data (non-cyclic)
                      </label>
                      <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.35rem" }}>
                        When enabled, new time cycles will pre-fill with values from the previous period until the user changes them. History is preserved per period.
                      </p>
                    </div>
                  )}
                  {kpiSaveError && <p className="form-error" style={{ marginBottom: "0.5rem" }}>{kpiSaveError}</p>}
                  <button type="submit" className="btn btn-primary" disabled={kpiEditForm.formState.isSubmitting || kpiSaving}>
                    {kpiSaving ? "Saving…" : "Save"}
                  </button>
                </form>
              )}
              {settingsPanel === "entry_mode" && (
                <form onSubmit={kpiEditForm.handleSubmit(onKpiUpdateSubmit)}>
                  <div className="form-group">
                    <label>Entry mode</label>
                    <select {...kpiEditForm.register("entry_mode")} disabled={userRole !== "SUPER_ADMIN"}>
                      <option value="manual">Manual (default)</option>
                      <option value="api">API</option>
                    </select>
                  </div>
                  {userRole === "SUPER_ADMIN" && kpiEditForm.watch("entry_mode") === "api" && (
                    <>
                      <div className="form-group">
                        <label>API endpoint URL</label>
                        <input type="url" placeholder="https://your-server.com/kpi-data" {...kpiEditForm.register("api_endpoint_url")} style={{ width: "100%", maxWidth: "480px" }} />
                      </div>
                      <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                        <button type="button" className="btn" onClick={fetchContract}>
                          {contractOpen ? "Hide" : "Show"} operation contract
                        </button>
                        {contractOpen && contract && (
                          <pre style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "0.85rem", overflow: "auto", maxHeight: 320 }}>
                            {JSON.stringify(contract, null, 2)}
                          </pre>
                        )}
                      </div>
                      {kpi?.entry_mode === "api" && kpi?.api_endpoint_url && (
                        <div className="form-group">
                          <p style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: "0.35rem" }}>When syncing:</p>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                              <input type="radio" name="syncMode" checked={syncMode === "override"} onChange={() => setSyncMode("override")} />
                              Override existing data
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                              <input type="radio" name="syncMode" checked={syncMode === "append"} onChange={() => setSyncMode("append")} />
                              Append to existing (multi-line rows)
                            </label>
                          </div>
                          <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                            <label>Year to sync</label>
                            <input type="number" min={2000} max={2100} value={syncYear} onChange={(e) => setSyncYear(Number(e.target.value) || new Date().getFullYear())} style={{ width: "6rem" }} />
                          </div>
                          <button
                            type="button"
                            className="btn"
                            disabled={syncLoading}
                            onClick={async () => {
                              setSyncLoading(true);
                              try {
                                await api(`/kpis/${kpiId}/sync-from-api?${qs({ year: syncYear, organization_id: orgIdFromUrl!, sync_mode: syncMode })}`, { method: "POST", token: token! });
                                loadKpi();
                              } finally {
                                setSyncLoading(false);
                              }
                            }}
                          >
                            {syncLoading ? "Syncing…" : "Sync from API now"}
                          </button>
                          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>Fetches entry data for the selected year from your endpoint.</p>
                        </div>
                      )}
                    </>
                  )}
                  {kpiSaveError && <p className="form-error" style={{ marginBottom: "0.5rem" }}>{kpiSaveError}</p>}
                  <button type="submit" className="btn btn-primary" disabled={kpiEditForm.formState.isSubmitting || kpiSaving}>
                    {kpiSaving ? "Saving…" : "Save"}
                  </button>
                </form>
              )}
              {settingsPanel === "domain" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.25rem" }}>Domain → Category</div>
                  {(kpi?.category_tags?.length ?? 0) > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
                      {kpi!.category_tags!.map((c) => {
                        const full = c.domain_name ? `${c.domain_name} → ${c.name}` : c.name;
                        return (
                          <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.25rem 0.5rem", borderRadius: 6, background: "rgba(var(--primary-rgb, 59, 130, 246), 0.12)", border: "1px solid rgba(var(--primary-rgb, 59, 130, 246), 0.35)", fontSize: "0.8rem" }}>
                            <span>{full}</span>
                            <button type="button" onClick={() => removeCategory(c.id)} disabled={domainCategorySaving} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)", fontSize: "1rem", lineHeight: 1 }} aria-label={`Remove ${full}`}>×</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "1rem", flex: 1, minHeight: 200, overflow: "hidden" }}>
                    <div style={{ flex: "0 0 44%", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", paddingRight: "0.75rem" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.5rem" }}>Domains</div>
                      <input type="text" placeholder="Search domains..." value={addModalSearch} onChange={(e) => setAddModalSearch(e.target.value)} style={{ marginBottom: "0.5rem", padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: 1 }}>
                        {orgDomains.filter((d) => !addModalSearch.trim() || d.name.toLowerCase().includes(addModalSearch.trim().toLowerCase())).map((d) => {
                          const selected = addModalSelectedDomainIds.includes(d.id);
                          return (
                            <li key={d.id} style={{ marginBottom: "0.2rem" }}>
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                  cursor: "pointer",
                                  fontSize: "0.9rem",
                                  padding: "0.35rem 0.5rem",
                                  borderRadius: 6,
                                  background: selected ? "rgba(var(--primary-rgb, 59, 130, 246), 0.12)" : "transparent",
                                  border: selected ? "1px solid rgba(var(--primary-rgb, 59, 130, 246), 0.35)" : "1px solid transparent",
                                  fontWeight: selected ? 600 : 400,
                                  color: selected ? "var(--primary)" : "var(--text)",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(e) => {
                                    if (e.target.checked) setAddModalSelectedDomainIds((prev) => [...prev, d.id]);
                                    else {
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
                          );
                        })}
                      </ul>
                    </div>
                    <div style={{ flex: "1", display: "flex", flexDirection: "column", minWidth: 0 }}>
                      {addModalSelectedDomainIds.length === 0 ? (
                        <>
                          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.5rem" }}>Categories</div>
                          <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Select one or more domains to see their categories.</p>
                        </>
                      ) : (() => {
                        const selectedDomainNames = orgDomains.filter((d) => addModalSelectedDomainIds.includes(d.id)).map((d) => d.name);
                        const categoriesLabel = selectedDomainNames.length === 1
                          ? `Categories for: ${selectedDomainNames[0]}`
                          : `Categories for: ${selectedDomainNames.join(", ")}`;
                        const allInSelectedDomains = orgCategories.filter((c) => c.domain_id != null && addModalSelectedDomainIds.includes(c.domain_id));
                        const filtered = addModalCategorySearch.trim() ? allInSelectedDomains.filter((c) => c.name.toLowerCase().includes(addModalCategorySearch.trim().toLowerCase())) : allInSelectedDomains;
                        const attachedIds = new Set((kpi?.category_tags ?? []).map((t) => t.id));
                        return (
                          <>
                            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.5rem" }}>{categoriesLabel}</div>
                            <input type="text" placeholder="Search categories..." value={addModalCategorySearch} onChange={(e) => setAddModalCategorySearch(e.target.value)} style={{ marginBottom: "0.5rem", padding: "0.4rem 0.5rem", fontSize: "0.9rem" }} />
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
                                            } else setAddModalSelectedIds((prev) => prev.filter((id) => id !== c.id));
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={addModalSelectedIds.length === 0 || domainCategorySaving}
                    onClick={() => {
                      if (addModalSelectedIds.length === 0) return;
                      addCategoriesBatch(addModalSelectedIds);
                      setAddModalSearch("");
                      setAddModalCategorySearch("");
                      setAddModalSelectedIds([]);
                      setAddModalSelectedDomainIds([]);
                    }}
                  >
                    {domainCategorySaving ? "Adding…" : "Add selected"}
                  </button>
                </div>
              )}
              {settingsPanel === "tags" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.25rem" }}>Organization tags</div>
                  {(kpi?.organization_tags?.length ?? 0) > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
                      {kpi!.organization_tags!.map((t) => (
                        <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.25rem 0.5rem", borderRadius: 6, background: "rgba(99, 102, 241, 0.12)", border: "1px solid rgba(99, 102, 241, 0.35)", fontSize: "0.8rem" }}>
                          <span>{t.name}</span>
                          <button type="button" onClick={() => updateOrgTags((kpi!.organization_tags ?? []).filter((x) => x.id !== t.id).map((x) => x.id))} disabled={tagSaving} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)", fontSize: "1rem", lineHeight: 1 }} aria-label={`Remove ${t.name}`}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input type="text" placeholder="Search..." value={addModalSearch} onChange={(e) => setAddModalSearch(e.target.value)} style={{ marginBottom: "0.25rem", padding: "0.5rem 0.6rem" }} />
                  <div style={{ flex: 1, overflowY: "auto", minHeight: 120, marginBottom: "0.5rem" }}>
                    {(() => {
                      const available = orgTags.filter((t) => !kpi?.organization_tags?.some((ot) => ot.id === t.id));
                      const filtered = addModalSearch.trim() ? available.filter((t) => t.name.toLowerCase().includes(addModalSearch.trim().toLowerCase())) : available;
                      return filtered.length === 0 ? (
                        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No tags to add.</p>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                          {filtered.map((t) => {
                            const checked = addModalSelectedIds.includes(t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  if (!checked) setAddModalSelectedIds((prev) => [...prev, t.id]);
                                  else setAddModalSelectedIds((prev) => prev.filter((id) => id !== t.id));
                                }}
                                style={{
                                  padding: "0.35rem 0.75rem",
                                  borderRadius: "999px",
                                  fontSize: "0.85rem",
                                  border: checked ? "1px solid var(--primary)" : "1px solid var(--border)",
                                  background: checked ? "var(--primary)" : "transparent",
                                  color: checked ? "var(--on-primary)" : "var(--text)",
                                  cursor: "pointer",
                                  transition: "all 0.2s ease-in-out",
                                }}
                              >
                                {t.name}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={addModalSelectedIds.length === 0 || tagSaving}
                    onClick={() => {
                      if (addModalSelectedIds.length === 0) return;
                      addTagsBatch(addModalSelectedIds);
                      setAddModalSearch("");
                      setAddModalSelectedIds([]);
                    }}
                  >
                    {tagSaving ? "Adding…" : "Add selected"}
                  </button>
                </div>
              )}
              {settingsPanel === "danger_zone" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ padding: "1rem", border: "1px solid var(--error)", borderRadius: "8px", background: "rgba(239, 68, 68, 0.05)" }}>
                    <h3 style={{ fontSize: "1rem", color: "var(--error)", margin: "0 0 0.5rem 0" }}>Danger Zone</h3>
                    <p style={{ fontSize: "0.9rem", color: "var(--text)", margin: "0 0 1rem 0" }}>
                      Once you delete a KPI, there is no going back. Please be certain.
                    </p>
                    <button
                      type="button"
                      className="btn"
                      style={{ color: "var(--error)", border: "1px solid var(--error)", background: "transparent" }}
                      onClick={onDeleteKpi}
                    >
                      Delete KPI
                    </button>
                  </div>
                </div>
              )}
              {!settingsPanel && (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Select a setting from the left.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {(!isOrgContext || activeEditTab === "fields") && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <h2 style={{ fontSize: isOrgContext ? "1.15rem" : "1.5rem", margin: 0 }}>
                {isOrgContext ? "Fields" : `Fields for ${kpi ? kpi.name : `KPI #${kpiId}`}`}
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
          <h2 style={{ marginBottom: "0.75rem", fontSize: "1.1rem" }}>Create field</h2>
          <form
            onSubmit={createForm.handleSubmit(onCreateSubmit, (errors) => {
              const first = Object.entries(errors)[0];
              if (first) {
                const msg = typeof first[1]?.message === "string" ? first[1].message : "Please fix the form errors.";
                toast.error(msg);
              }
            })}
          >
            {/* Row 1: Name, Key, Field type — one row on wide screens, wraps on narrow */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: "0.75rem 1rem",
                alignItems: "flex-start",
                marginBottom: "0.75rem",
              }}
            >
              <div className="form-group" style={{ marginBottom: 0, minWidth: 0 }}>
                <label>Name *</label>
                <input
                  placeholder="e.g. Total students"
                  style={{ width: "100%" }}
                  value={createForm.watch("name") ?? ""}
                  onChange={(e) => {
                    const name = e.target.value;
                    createForm.setValue("name", name, { shouldValidate: true });
                    if (!keyTouched) {
                      createForm.setValue("key", slugifyKey(name), { shouldValidate: false, shouldDirty: true });
                    }
                  }}
                />
                {createForm.formState.errors.name && (
                  <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>
                    {createForm.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: 0, minWidth: 0 }}>
                <label>Key * <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: "0.8rem" }}>(auto from name)</span></label>
                <input
                  {...createForm.register("key", { onChange: () => setKeyTouched(true) })}
                  placeholder="key_name (auto from name)"
                  style={{ width: "100%" }}
                />
                {createForm.formState.errors.key && (
                  <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>
                    {createForm.formState.errors.key.message}
                  </p>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: 0, minWidth: 0 }}>
                <label>Type *</label>
                <select {...createForm.register("field_type")} style={{ width: "100%" }}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Row 2: Required, Sort order */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "1rem 1.5rem",
                marginBottom: "0.75rem",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.9rem" }}>
                <input type="checkbox" {...createForm.register("is_required")} />
                Required
              </label>
              {createForm.watch("field_type") === "multi_line_items" && (
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                  <span style={{ fontWeight: 500 }}>Full-page editor</span>
                  <span
                    style={{
                      position: "relative",
                      width: 40,
                      height: 22,
                      borderRadius: 999,
                      background: createForm.watch("full_page_multi_items") ? "var(--accent)" : "var(--border)",
                      display: "inline-flex",
                      alignItems: "center",
                      padding: 2,
                      transition: "background 120ms ease",
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "var(--surface)",
                        transform: createForm.watch("full_page_multi_items") ? "translateX(18px)" : "translateX(0)",
                        transition: "transform 120ms ease",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                      }}
                    />
                  </span>
                  <input
                    type="checkbox"
                    {...createForm.register("full_page_multi_items")}
                    style={{ display: "none" }}
                    aria-label="Use full-page editor for this multi-line field"
                  />
                </label>
              )}
              {userRole === "SUPER_ADMIN" && (
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.9rem" }}>
                  <input type="checkbox" {...createForm.register("carry_forward_data")} />
                  Carry forward (non-cyclic)
                </label>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <label style={{ fontSize: "0.9rem", whiteSpace: "nowrap" }}>Sort order</label>
                <input type="number" min={0} {...createForm.register("sort_order")} style={{ width: "4.5rem", padding: "0.35rem 0.5rem" }} />
              </div>
            </div>
            {createForm.watch("field_type") === "reference" && (
              <div className="form-group">
                <label>Reference source</label>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 0" }}>
                  Values for this field will be restricted to distinct values from the selected KPI field.
                </p>
                <ReferenceConfigUI
                  organizationId={kpi?.organization_id ?? orgId ?? undefined}
                  currentKpiId={kpiId}
                  value={createRefConfig}
                  onChange={setCreateRefConfig}
                />
              </div>
            )}
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
                <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Name</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Key</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Type</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Reference source (if type = reference)</th>
                        <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Required</th>
                        <th style={{ width: "80px", padding: "0.5rem", borderBottom: "2px solid var(--border)" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {createSubFields.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.9rem", textAlign: "center" }}>
                            No sub-fields yet. Click &quot;Add sub-field&quot; below.
                          </td>
                        </tr>
                      ) : createSubFields.map((s, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "0.4rem 0.5rem" }}>
                            <input
                              placeholder="Display name"
                              value={s.name}
                              onChange={(e) => {
                                const name = e.target.value;
                                setCreateSubFields((prev) =>
                                  prev.map((x, i) =>
                                    i === idx
                                      ? { ...x, name, key: x.keyTouched ? x.key : slugifyKey(name) }
                                      : x
                                  )
                                );
                              }}
                              style={{ width: "100%", minWidth: "100px" }}
                            />
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem" }}>
                            <input
                              placeholder="key_name (auto from name)"
                              value={s.key}
                              onChange={(e) =>
                                setCreateSubFields((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, key: e.target.value, keyTouched: true } : x))
                                )
                              }
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
                          <td style={{ padding: "0.4rem 0.5rem", minWidth: "200px" }}>
                            {s.field_type === "reference" ? (
                              <ReferenceConfigUI
                                organizationId={kpi?.organization_id ?? orgId ?? undefined}
                                currentKpiId={kpiId}
                                value={s.config ?? {}}
                                onChange={(c) => setCreateSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, config: c } : x)))}
                                labelPrefix="Source"
                              />
                            ) : (
                              <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>—</span>
                            )}
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
                <button type="button" className="btn btn-primary" onClick={() => setCreateSubFields((prev) => [...prev, { name: "", key: "", field_type: "single_line_text", is_required: false, sort_order: prev.length, keyTouched: false, config: undefined }])}>
                  Add sub-field
                </button>
              </div>
            )}
            {createForm.watch("field_type") === "multi_line_items" && (
              <>
                <div style={{ marginTop: "-0.25rem", marginBottom: "0.5rem", color: "var(--muted)", fontSize: "0.85rem" }}>
                  Tip: Enable <strong>Full-page editor</strong> above for large datasets (search, paging, bulk delete, bulk upload).
                </div>
                <div className="form-group">
                  <label>Multi-line API endpoint URL (optional)</label>
                  <input
                    type="url"
                    placeholder="https://example.com/multi-items-api"
                    {...createForm.register("multi_items_api_endpoint_url")}
                    style={{ width: "100%" }}
                  />
                  <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    When set, Org Admins can sync this multi-line field from API on the full-page editor.
                  </p>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
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
                    onSave={(data, subFields, refConfig) => onUpdateSubmit(f.id, data, subFields, refConfig)}
                    onCancel={() => setEditingId(null)}
                    organizationId={kpi?.organization_id}
                    currentKpiId={kpiId}
                    userRole={userRole}
                  />
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                      <strong
                        style={{
                          cursor: f.field_type === "multi_line_items" ? "pointer" : "default",
                          textDecoration: f.field_type === "multi_line_items" ? "underline" : "none",
                        }}
                        onClick={() => {
                          if (f.field_type !== "multi_line_items") return;
                          const orgId = kpi?.organization_id ?? orgIdFromUrl ?? orgId;
                          const year = new Date().getFullYear();
                          if (!orgId) return;
                          router.push(
                            `/dashboard/entries/${kpiId}/${year}/multi/${f.id}?${qs({
                              organization_id: orgId,
                            })}`
                          );
                        }}
                      >
                        {f.name}
                      </strong>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.9rem" }}>({f.key})</span>
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}> - {f.field_type.replace(/_/g, " ")}</span>
                      {f.is_required && <span style={{ marginLeft: "0.5rem", color: "var(--warning)" }}>Required</span>}
                      {f.field_type === "formula" && f.formula_expression && (
                        <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Formula: {f.formula_expression}
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

/** Source KPI + source field dropdowns for reference/lookup field config. */
function ReferenceConfigUI({
  organizationId,
  currentKpiId,
  value,
  onChange,
  labelPrefix = "Reference source",
}: {
  organizationId: number | undefined;
  currentKpiId?: number;
  value: ReferenceConfig;
  onChange: (c: ReferenceConfig) => void;
  labelPrefix?: string;
}) {
  const [kpis, setKpis] = useState<Array<{ id: number; name: string }>>([]);
  const [sourceFields, setSourceFields] = useState<KpiField[]>([]);
  const token = getAccessToken();
  useEffect(() => {
    if (!token || organizationId == null) return;
    api<Array<{ id: number; name: string }>>(`/kpis?${qs({ organization_id: organizationId })}`, { token })
      .then((list) => setKpis(list))
      .catch(() => setKpis([]));
  }, [token, organizationId]);
  useEffect(() => {
    if (!token || organizationId == null || !value.reference_source_kpi_id) {
      setSourceFields([]);
      return;
    }
    api<KpiField[]>(`/fields?${qs({ kpi_id: value.reference_source_kpi_id, organization_id: organizationId })}`, { token })
      .then((list) => setSourceFields(list))
      .catch(() => setSourceFields([]));
  }, [token, organizationId, value.reference_source_kpi_id]);
  const scalarFieldTypes = ["single_line_text", "multi_line_text", "number", "date", "boolean", "reference"];
  const sourceFieldOptions: { value: string; label: string }[] = [];
  sourceFields.forEach((f) => {
    if (scalarFieldTypes.includes(f.field_type)) {
      sourceFieldOptions.push({ value: f.key, label: `${f.name} (${f.key})` });
    }
    if (f.field_type === "multi_line_items" && f.sub_fields?.length) {
      f.sub_fields.forEach((s) => {
        sourceFieldOptions.push({ value: `${f.key}|${s.key}`, label: `${f.name} → ${s.name} (${s.key})` });
      });
    }
  });
  const selectedFieldValue = value.reference_source_field_key
    ? (value.reference_source_sub_field_key ? `${value.reference_source_field_key}|${value.reference_source_sub_field_key}` : value.reference_source_field_key)
    : "";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1rem", alignItems: "flex-end" }}>
      <div>
        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>{labelPrefix}: KPI</label>
        <select
          value={value.reference_source_kpi_id ?? ""}
          onChange={(e) => onChange({ reference_source_kpi_id: e.target.value ? Number(e.target.value) : undefined, reference_source_field_key: undefined, reference_source_sub_field_key: undefined })}
          style={{ minWidth: "180px" }}
        >
          <option value="">— Select KPI —</option>
          {kpis.filter((k) => k.id !== currentKpiId).map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>{labelPrefix}: Field</label>
        <select
          value={selectedFieldValue}
          onChange={(e) => {
            const raw = e.target.value || "";
            if (raw.includes("|")) {
              const [fieldKey, subKey] = raw.split("|", 2);
              onChange({ ...value, reference_source_field_key: fieldKey, reference_source_sub_field_key: subKey || undefined });
            } else {
              onChange({ ...value, reference_source_field_key: raw || undefined, reference_source_sub_field_key: undefined });
            }
          }}
          style={{ minWidth: "220px" }}
          disabled={!value.reference_source_kpi_id}
        >
          <option value="">— Select field —</option>
          {sourceFieldOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
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
  type WhereCondition = {
    filterSubKey: string;
    op: string;
    value: string;
    logicWithPrev: "op_and" | "op_or";
  };
  const [refFieldId, setRefFieldId] = useState<number | "">("");
  const [refSubKey, setRefSubKey] = useState("");
  const [refGroupFn, setRefGroupFn] = useState<string>("SUM_ITEMS");
  const [useConditional, setUseConditional] = useState(false);
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([
    { filterSubKey: "", op: "op_eq", value: "0", logicWithPrev: "op_and" },
  ]);
  const [refAllowedValues, setRefAllowedValues] = useState<Record<string, string[]>>({});
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
  const primaryCond = whereConditions[0];
  const refFilterSubKey = primaryCond?.filterSubKey ?? "";
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
  const getRefSourceFromSubKey = (subKey: string): { cacheKey: string; sid: number; skey: string; sourceSubKey?: string } | null => {
    const sf = subFields.find((s) => s.key === subKey);
    if (!sf || sf.field_type !== "reference") return null;
    const cfg = (sf.config ?? {}) as ReferenceConfig;
    const sid = cfg.reference_source_kpi_id;
    const skey = cfg.reference_source_field_key;
    if (!sid || !skey) return null;
    const sourceSubKey = cfg.reference_source_sub_field_key;
    const cacheKey = `${sid}-${skey}${sourceSubKey ? `-${sourceSubKey}` : ""}`;
    return { cacheKey, sid, skey, sourceSubKey };
  };

  useEffect(() => {
    if (!token || organizationId == null || subFields.length === 0) return;
    const refs = whereConditions
      .map((c) => getRefSourceFromSubKey(c.filterSubKey))
      .filter((x): x is { cacheKey: string; sid: number; skey: string; sourceSubKey?: string } => !!x);
    const unique = new Map<string, { sid: number; skey: string; sourceSubKey?: string }>();
    refs.forEach((r) => {
      if (!unique.has(r.cacheKey)) unique.set(r.cacheKey, { sid: r.sid, skey: r.skey, sourceSubKey: r.sourceSubKey });
    });
    unique.forEach((meta, cacheKey) => {
      if (refAllowedValues[cacheKey]) return;
      const params = new URLSearchParams({
        source_kpi_id: String(meta.sid),
        source_field_key: meta.skey,
        organization_id: String(organizationId),
      });
      if (meta.sourceSubKey) params.set("source_sub_field_key", meta.sourceSubKey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params.toString()}`, { token })
        .then((r) => setRefAllowedValues((prev) => ({ ...prev, [cacheKey]: r.values || [] })))
        .catch(() => setRefAllowedValues((prev) => ({ ...prev, [cacheKey]: [] })));
    });
  }, [token, organizationId, subFields, whereConditions, refAllowedValues]);

  const handleInsertItems = () => {
    if (!refField) return;
    if (isConditionalWhere) {
      const condArgs: string[] = [];
      whereConditions.forEach((c, idx) => {
        if (!c.filterSubKey) return;
        const raw = c.value.trim();
        const isNumeric = raw !== "" && !Number.isNaN(Number(raw));
        const val = isNumeric ? raw : `'${raw.replace(/'/g, "\\'")}'`;
        if (idx > 0) condArgs.push(c.logicWithPrev);
        condArgs.push(c.filterSubKey, c.op, val);
      });
      if (condArgs.length < 3) return;
      // When conditional is checked, always use the _WHERE variant (map COUNT_ITEMS -> COUNT_ITEMS_WHERE etc.)
      const whereFn = refGroupFn.endsWith("_WHERE") ? refGroupFn : refGroupFn + "_WHERE";
      if (whereFn === "COUNT_ITEMS_WHERE") {
        onInsert(`COUNT_ITEMS_WHERE(${refField.key}, ${condArgs.join(", ")})`);
      } else {
        onInsert(`${whereFn}(${refField.key}, ${refSubKey}, ${condArgs.join(", ")})`);
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
            onChange={(e) => {
              setRefFieldId(e.target.value ? Number(e.target.value) : "");
              setRefSubKey("");
              setWhereConditions((prev) => prev.map((c, i) => (i === 0 ? { ...c, filterSubKey: "" } : c)));
            }}
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
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
                {whereConditions.map((c, idx) => (
                  <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
                    {idx > 0 && (
                      <div>
                        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Logical</label>
                        <select
                          value={c.logicWithPrev}
                          onChange={(e) =>
                            setWhereConditions((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, logicWithPrev: e.target.value as "op_and" | "op_or" } : x))
                            )
                          }
                          style={{ minWidth: "110px" }}
                        >
                          <option value="op_and">AND</option>
                          <option value="op_or">OR</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Filter sub-field</label>
                      <select
                        value={c.filterSubKey}
                        onChange={(e) =>
                          setWhereConditions((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, filterSubKey: e.target.value } : x))
                          )
                        }
                        style={{ minWidth: "140px" }}
                      >
                        <option value="">— Select —</option>
                        {subFields.map((s) => (
                          <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Operator</label>
                      <select
                        value={c.op}
                        onChange={(e) =>
                          setWhereConditions((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, op: e.target.value } : x))
                          )
                        }
                        style={{ minWidth: "120px" }}
                      >
                        {WHERE_OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Value</label>
                      {(() => {
                        const refMeta = getRefSourceFromSubKey(c.filterSubKey);
                        const options = refMeta ? (refAllowedValues[refMeta.cacheKey] || []) : [];
                        if (refMeta) {
                          const listId = `formula-ref-values-${idx}`;
                          return (
                            <>
                              <input
                                type="text"
                                list={listId}
                                value={c.value}
                                onChange={(e) =>
                                  setWhereConditions((prev) =>
                                    prev.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x))
                                  )
                                }
                                style={{ minWidth: "180px" }}
                                placeholder={options.length ? "Type or select value" : "No values available"}
                              />
                              <datalist id={listId}>
                                {options.map((v) => (
                                  <option key={v} value={v} />
                                ))}
                              </datalist>
                            </>
                          );
                        }
                        return (
                          <input
                            type="text"
                            value={c.value}
                            onChange={(e) =>
                              setWhereConditions((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x))
                              )
                            }
                            style={{ width: "120px" }}
                            placeholder="e.g. 100 or A"
                          />
                        );
                      })()}
                    </div>
                    {whereConditions.length > 1 && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setWhereConditions((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ fontSize: "0.85rem" }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setWhereConditions((prev) => [
                        ...prev,
                        { filterSubKey: "", op: "op_eq", value: "0", logicWithPrev: "op_and" },
                      ])
                    }
                    style={{ fontSize: "0.85rem" }}
                  >
                    + Add condition
                  </button>
                </div>
              </div>
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
  userRole,
}: {
  field: KpiField;
  list: KpiField[];
  onSave: (data: UpdateFormData, subFields?: SubFieldDef[], refConfig?: ReferenceConfig) => void;
  onCancel: () => void;
  organizationId?: number;
  currentKpiId?: number;
  userRole?: UserRole | null;
}) {
  type EditSubFieldRow = SubFieldDef & { keyTouched?: boolean };
  const [editKeyTouched, setEditKeyTouched] = useState(false);
  const [editSubFields, setEditSubFields] = useState<EditSubFieldRow[]>(
    () => (field.sub_fields ?? []).map((s) => ({ ...s, name: s.name, key: s.key, field_type: s.field_type, is_required: s.is_required ?? false, sort_order: s.sort_order ?? 0, config: s.config ?? undefined, keyTouched: false }))
  );
  const [editRefConfig, setEditRefConfig] = useState<ReferenceConfig>(field.config ?? {});
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      name: field.name,
      key: field.key,
      field_type: field.field_type as CreateFormData["field_type"],
      formula_expression: field.formula_expression ?? "",
      is_required: field.is_required,
      sort_order: field.sort_order,
      carry_forward_data: field.carry_forward_data ?? false,
      full_page_multi_items: field.full_page_multi_items ?? false,
      multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
    },
  });
  const currentFieldType = watch("field_type");

  return (
    <form
      onSubmit={handleSubmit((data) =>
        onSave(
          data,
          currentFieldType === "multi_line_items"
            ? editSubFields.map(({ keyTouched: _, ...s }) => s)
            : undefined,
          currentFieldType === "reference" ? editRefConfig : undefined
        )
      )}
      style={{ width: "100%" }}
    >
      {/* Row 1: Name, Key, Type — aligned with create field layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem 1rem",
          alignItems: "flex-start",
          marginBottom: "0.75rem",
        }}
      >
        <div className="form-group" style={{ marginBottom: 0, minWidth: 0 }}>
          <label>Name *</label>
          <input
            style={{ width: "100%" }}
            value={watch("name") ?? ""}
            onChange={(e) => {
              const name = e.target.value;
              setValue("name", name, { shouldValidate: true });
              if (!editKeyTouched) {
                setValue("key", slugifyKey(name), { shouldValidate: false, shouldDirty: true });
              }
            }}
          />
          {errors.name && (
            <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>
              {errors.name.message}
            </p>
          )}
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 0 }}>
          <label>Key * <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: "0.8rem" }}>(auto from name)</span></label>
          <input
            {...register("key", { onChange: () => setEditKeyTouched(true) })}
            placeholder="key_name (auto from name)"
            style={{ width: "100%" }}
          />
          {errors.key && (
            <p className="form-error" style={{ marginTop: "0.2rem", fontSize: "0.8rem" }}>
              {errors.key.message}
            </p>
          )}
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 0 }}>
          <label>Type *</label>
          <select {...register("field_type")} style={{ width: "100%" }}>
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </div>
      {/* Row 2: Required, Sort order */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "1rem 1.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
          <input type="checkbox" {...register("is_required")} />
          Required
        </label>
        {userRole === "SUPER_ADMIN" && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
            <input type="checkbox" {...register("carry_forward_data")} />
            Carry forward (non-cyclic)
          </label>
        )}
        {currentFieldType === "multi_line_items" && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
            <span style={{ fontWeight: 500 }}>Full-page editor</span>
            <span
              style={{
                position: "relative",
                width: 40,
                height: 22,
                borderRadius: 999,
                background: watch("full_page_multi_items") ? "var(--accent)" : "var(--border)",
                display: "inline-flex",
                alignItems: "center",
                padding: 2,
                transition: "background 120ms ease",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "var(--surface)",
                  transform: watch("full_page_multi_items") ? "translateX(18px)" : "translateX(0)",
                  transition: "transform 120ms ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                }}
              />
            </span>
            <input
              type="checkbox"
              {...register("full_page_multi_items")}
              style={{ display: "none" }}
              aria-label="Use full-page editor for this multi-line field"
            />
          </label>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <label style={{ fontSize: "0.9rem", whiteSpace: "nowrap" }}>Sort order</label>
          <input
            type="number"
            min={0}
            {...register("sort_order")}
            style={{ width: "4.5rem", padding: "0.35rem 0.5rem" }}
          />
        </div>
      </div>
      {currentFieldType === "reference" && (
        <div className="form-group">
          <label>Reference source</label>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 0" }}>
            Values for this field will be restricted to distinct values from the selected KPI field.
          </p>
          <ReferenceConfigUI
            organizationId={organizationId}
            currentKpiId={currentKpiId}
            value={editRefConfig}
            onChange={setEditRefConfig}
          />
        </div>
      )}
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
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Reference source (if type = reference)</th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Section (UI)</th>
                  <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Required</th>
                  <th style={{ width: "80px", padding: "0.5rem", borderBottom: "2px solid var(--border)" }} />
                </tr>
              </thead>
              <tbody>
                {editSubFields.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.9rem", textAlign: "center" }}>
                      No sub-fields yet. Click &quot;Add sub-field&quot; below.
                    </td>
                  </tr>
                ) : editSubFields.map((s, idx) => (
                  <tr key={s.id ?? idx} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <input
                        placeholder="Display name"
                        value={s.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          setEditSubFields((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, name, key: x.keyTouched ? x.key : slugifyKey(name) } : x
                            )
                          );
                        }}
                        style={{ width: "100%", minWidth: "100px" }}
                      />
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <input
                        placeholder="key_name (auto from name)"
                        value={s.key}
                        onChange={(e) =>
                          setEditSubFields((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, key: e.target.value, keyTouched: true } : x))
                          )
                        }
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
                    <td style={{ padding: "0.4rem 0.5rem", minWidth: "200px" }}>
                      {s.field_type === "reference" ? (
                        <ReferenceConfigUI
                          organizationId={organizationId}
                          currentKpiId={currentKpiId}
                          value={s.config ?? {}}
                          onChange={(c) => setEditSubFields((prev) => prev.map((x, i) => (i === idx ? { ...x, config: c } : x)))}
                          labelPrefix="Source"
                        />
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem", minWidth: "200px" }}>
                      {userRole === "SUPER_ADMIN" ? (
                        <input
                          placeholder="e.g. Program details"
                          value={typeof s.config === "object" && s.config && "ui_section" in s.config ? String((s.config as any).ui_section ?? "") : ""}
                          onChange={(e) => {
                            const section = e.target.value;
                            setEditSubFields((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? {
                                      ...x,
                                      config: {
                                        ...(x.config ?? {}),
                                        ui_section: section,
                                      },
                                    }
                                  : x
                              )
                            );
                          }}
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <div style={{ padding: "0.35rem 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                          {typeof s.config === "object" && s.config && "ui_section" in s.config && (s.config as any).ui_section
                            ? String((s.config as any).ui_section)
                            : "—"}
                        </div>
                      )}
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              setEditSubFields((prev) => [
                ...prev,
                { name: "", key: "", field_type: "single_line_text", is_required: false, sort_order: prev.length, config: undefined, keyTouched: false },
              ])
            }
          >
            Add sub-field
          </button>
          <div style={{ marginTop: "0.5rem", color: "var(--muted)", fontSize: "0.85rem" }}>
            Tip: Enable <strong>Full-page editor</strong> above for large datasets (search, paging, bulk delete, bulk upload).
          </div>
          <div className="form-group" style={{ marginTop: "0.75rem" }}>
            <label>Multi-line API endpoint URL (optional)</label>
            <input
              type="url"
              placeholder="https://example.com/multi-items-api"
              {...register("multi_items_api_endpoint_url")}
              style={{ width: "100%" }}
            />
            <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
              When set, Org Admins can sync this multi-line field from API on the full-page editor.
            </p>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
