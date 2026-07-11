"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import { OdooMultiLineImportAdmin } from "@/components/OdooMultiLineImportConfig";

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
  "multi_reference",
  "mixed_list",
  "multi_line_items",
  "formula",
] as const;

const SUB_FIELD_TYPES = ["single_line_text", "multi_line_text", "number", "date", "boolean", "reference", "multi_reference", "attachment", "mixed_list", "formula"] as const;

function slugifyKey(name: string): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function truncateLabel(label: string, max = 48): string {
  const s = String(label ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Sub-field UI section dropdowns: merge saved sub_fields with in-session sections from "+ Add section" (not yet on any column). */
function mergeUiSectionLabelsForMultiField(
  subFields: SubFieldDef[] | undefined,
  customSections: string[] | undefined
): string[] {
  const uniq = new Set<string>();
  (subFields ?? []).forEach((s) => {
    const sec = (s as { config?: { ui_section?: string } })?.config?.ui_section;
    const label = typeof sec === "string" ? sec.trim() : "";
    uniq.add(label || "Other");
  });
  (customSections ?? []).forEach((raw) => {
    const label = typeof raw === "string" ? raw.trim() : "";
    if (label && label !== "Other") uniq.add(label);
  });
  if (uniq.size === 0) uniq.add("Other");
  return Array.from(uniq).sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
}

const GROUP_FUNCTIONS = [
  { value: "SUM_ITEMS", label: "SUM (total)" },
  { value: "AVG_ITEMS", label: "AVG (average)" },
  { value: "COUNT_ITEMS", label: "COUNT" },
  { value: "MIN_ITEMS", label: "MIN" },
  { value: "MAX_ITEMS", label: "MAX" },
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

/** Comparison operators allowed for a multi-line sub-field type (formula WHERE clause). */
function operatorsForSubFieldType(fieldType: string | undefined): readonly { value: string; label: string }[] {
  const ft = fieldType ?? "";
  const cmp = WHERE_OPERATORS.filter((o) =>
    ["op_eq", "op_neq", "op_gt", "op_gte", "op_lt", "op_lte"].includes(o.value)
  );
  const text = WHERE_OPERATORS.filter((o) =>
    ["op_eq", "op_neq", "op_contains", "op_not_contains", "op_starts_with", "op_ends_with"].includes(o.value)
  );
  if (ft === "number" || ft === "date") return cmp;
  if (ft === "boolean") return WHERE_OPERATORS.filter((o) => ["op_eq", "op_neq"].includes(o.value));
  if (ft === "reference" || ft === "multi_reference") return text;
  return text;
}

function quoteFormulaWhereValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("CurrentRow.")) {
    return trimmed;
  }
  const isNumeric = trimmed !== "" && !Number.isNaN(Number(trimmed));
  return isNumeric ? trimmed : `'${trimmed.replace(/'/g, "\\'")}'`;
}

interface ReferenceConfig {
  reference_source_kpi_id?: number;
  reference_source_field_key?: string;
  /** When source is a multi_line_items field, the sub-field key to use for values */
  reference_source_sub_field_key?: string;
  condition_trigger_field_id?: number;
  condition_trigger_value?: boolean;
  formula_expression?: string;
  conditional_rules?: any[];
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
  section_id?: number | null;
  carry_forward_data?: boolean;
  full_page_multi_items?: boolean;
  options: Array<{ id: number; value: string; label: string; sort_order: number }>;
  sub_fields?: SubFieldDef[];
}

interface KpiSection {
  id: number;
  kpi_id: number;
  name: string;
  sort_order: number;
  field_count: number;
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
  section_id: z.coerce.number().int().optional(),
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
  section_id: z.coerce.number().int().optional(),
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
  const [sections, setSections] = useState<KpiSection[]>([]);
  const [newSectionName, setNewSectionName] = useState("");
  const [sectionRenameId, setSectionRenameId] = useState<number | null>(null);
  const [sectionRenameDraft, setSectionRenameDraft] = useState("");
  const [sectionsSaving, setSectionsSaving] = useState(false);
  const [sectionFieldModal, setSectionFieldModal] = useState<{
    mode: "create" | "manage";
    sectionId: number | null;
    name: string;
    selectedFieldIds: number[];
  } | null>(null);
  const [sectionFieldModalSaving, setSectionFieldModalSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cardDisplayFieldIds, setCardDisplayFieldIds] = useState<number[]>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const [superAdminFieldsTab, setSuperAdminFieldsTab] = useState<string>("scalar");
  const [activeSubSectionByMultiFieldId, setActiveSubSectionByMultiFieldId] = useState<Record<number, string>>({});
  const [uiSectionCustomByMultiFieldId, setUiSectionCustomByMultiFieldId] = useState<Record<number, string[]>>({});
  const [uiSectionRenameDraft, setUiSectionRenameDraft] = useState<{ fieldId: number; from: string; to: string } | null>(null);
  const [multiFieldSettingsOpenById, setMultiFieldSettingsOpenById] = useState<Record<number, boolean>>({});
  const [multiFieldEditDraftById, setMultiFieldEditDraftById] = useState<
    Record<
      number,
      {
        data: UpdateFormData;
        subFields: SubFieldDef[];
      }
    >
  >({});
  const [multiFieldKeyTouchedById, setMultiFieldKeyTouchedById] = useState<Record<number, boolean>>({});
  const [multiFieldEditingPanelById, setMultiFieldEditingPanelById] = useState<Record<number, "general" | "subfields" | null>>({});
  const [addSubFieldModal, setAddSubFieldModal] = useState<{ fieldId: number; activeSection: string } | null>(null);
  const [editSubFieldModal, setEditSubFieldModal] = useState<{ fieldId: number; subIndex: number } | null>(null);
  const [deleteSubFieldModal, setDeleteSubFieldModal] = useState<{ fieldId: number; subIndex: number; name: string; key: string } | null>(null);
  const [deleteSubFieldConfirm, setDeleteSubFieldConfirm] = useState<{ name: string; key: string }>({ name: "", key: "" });
  const [deleteFieldModal, setDeleteFieldModal] = useState<{ fieldId: number; name: string; key: string } | null>(null);
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<{ name: string; key: string }>({ name: "", key: "" });
  const [deleteFieldSummary, setDeleteFieldSummary] = useState<{ field_values_count: number; report_template_fields_count: number } | null>(null);
  const [deleteFieldSummaryLoading, setDeleteFieldSummaryLoading] = useState(false);
  const [deleteFieldSummaryError, setDeleteFieldSummaryError] = useState<string | null>(null);
  const [editSubFieldDraft, setEditSubFieldDraft] = useState<{
    name: string;
    key: string;
    keyTouched: boolean;
    field_type: string;
    is_required: boolean;
    ui_section: string;
    config: ReferenceConfig;
  }>({ name: "", key: "", keyTouched: false, field_type: "single_line_text", is_required: false, ui_section: "", config: {} });
  const [addSubFieldDraft, setAddSubFieldDraft] = useState<{
    name: string;
    key: string;
    keyTouched: boolean;
    field_type: string;
    is_required: boolean;
    ui_section: string;
    config: ReferenceConfig;
  }>({ name: "", key: "", keyTouched: false, field_type: "single_line_text", is_required: false, ui_section: "", config: {} });
  const [isCondModalOpen, setIsCondModalOpen] = useState(false);
  const [condEditingFieldId, setCondEditingFieldId] = useState<number | string | null>(null);
  const [condTriggerId, setCondTriggerId] = useState<number | string | "">("");
  const [condTriggerVal, setCondTriggerVal] = useState<boolean>(true);
  const [condDepType, setCondDepType] = useState<"existing" | "new">("existing");
  const [condDepFieldId, setCondDepFieldId] = useState<number | string | "">("");
  const [condNewName, setCondNewName] = useState("");
  const [condNewKey, setCondNewKey] = useState("");
  const [condNewFieldType, setCondNewFieldType] = useState("single_line_text");
  const [condNewRequired, setCondNewRequired] = useState(false);
  const [condNewRefConfig, setCondNewRefConfig] = useState<ReferenceConfig>({});
  const [condOperator, setCondOperator] = useState<string>("eq");
  const [condValueText, setCondValueText] = useState<string>("");
  const [condValueText2, setCondValueText2] = useState<string>("");
  const [condDepFieldIds, setCondDepFieldIds] = useState<(number | string)[]>([]);
  const [condLogicalOperator, setCondLogicalOperator] = useState<string>("or");
  const [condAdditionalConditions, setCondAdditionalConditions] = useState<{ operator: string; value: string }[]>([]);
  const [refAllowedValuesList, setRefAllowedValuesList] = useState<string[]>([]);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [typeChangeWarning, setTypeChangeWarning] = useState<{
    fieldId: number;
    data: UpdateFormData;
    subFields?: SubFieldDef[];
    refConfig?: ReferenceConfig;
    count: number;
  } | null>(null);

  // selectedTriggerForEffect and useEffect moved below token declaration to avoid Block-scoped variable 'token' used before its declaration error.

  const [kpiSaveError, setKpiSaveError] = useState<string | null>(null);
  const [kpiSaving, setKpiSaving] = useState(false);
  const [orgTimeDimension, setOrgTimeDimension] = useState<string>("yearly");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMode, setSyncMode] = useState<"override" | "append" | "upsert">("override");
  const [kpiSyncUpsertByFieldKey, setKpiSyncUpsertByFieldKey] = useState<Record<string, string>>({});
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
  type EditTabId = "details" | "fields" | "settings" | "odoo";
  const tabFromUrl = searchParams.get("tab") as EditTabId | null;
  const [activeEditTab, setActiveEditTab] = useState<EditTabId>(
    tabFromUrl === "details" || tabFromUrl === "fields" || tabFromUrl === "settings" || tabFromUrl === "odoo"
      ? tabFromUrl
      : "details"
  );
  const [settingsPanel, setSettingsPanel] = useState<"order" | "time_dimension" | "entry_mode" | "domain" | "tags" | "danger_zone" | null>(null);
  const [syncYear, setSyncYear] = useState<number>(() => new Date().getFullYear());
  const [keyTouched, setKeyTouched] = useState(false);
  /** For super admin without org in URL: org resolved from KPI by id so create/update field works. */
  const [kpiOrgId, setKpiOrgId] = useState<number | null>(null);

  const token = getAccessToken();

  const selectedTriggerForEffect = useMemo(() => {
    if (!condTriggerId) return null;
    const isMultiTab = superAdminFieldsTab.startsWith("multi:");
    if (isMultiTab) {
      const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
      const activeParentFieldId = match ? Number(match[1]) : null;
      const f = activeParentFieldId ? list.find((x) => x.id === activeParentFieldId) : null;
      return (f?.sub_fields ?? []).find((s) => String(s.id || s.key) === String(condTriggerId));
    } else {
      return list.find((f) => String(f.id) === String(condTriggerId));
    }
  }, [condTriggerId, list, superAdminFieldsTab]);

  useEffect(() => {
    if (selectedTriggerForEffect && (selectedTriggerForEffect.field_type === "reference" || selectedTriggerForEffect.field_type === "multi_reference")) {
      const cfg = selectedTriggerForEffect.config;
      if (cfg?.reference_source_kpi_id && cfg?.reference_source_field_key) {
        const resolvedOrgId = kpi?.organization_id ?? kpiOrgId ?? orgIdFromUrl ?? null;
        const orgParam = resolvedOrgId != null ? `&organization_id=${resolvedOrgId}` : "";
        api<{ values: string[] }>(
          `/fields/reference-allowed-values?source_kpi_id=${cfg.reference_source_kpi_id}&source_field_key=${cfg.reference_source_field_key}${
            cfg.reference_source_sub_field_key ? `&source_sub_field_key=${cfg.reference_source_sub_field_key}` : ""
          }${orgParam}`,
          { token }
        )
          .then((res) => setRefAllowedValuesList(res.values || []))
          .catch(() => setRefAllowedValuesList([]));
      } else {
        setRefAllowedValuesList([]);
      }
    } else {
      setRefAllowedValuesList([]);
    }
  }, [selectedTriggerForEffect, token, kpi?.organization_id, kpiOrgId, orgIdFromUrl]);
  const router = useRouter();

  const multiLineFieldsForSync = useMemo(
    () => list.filter((f) => f.field_type === "multi_line_items" && (f.sub_fields?.length ?? 0) > 0),
    [list]
  );

  const scalarFields = useMemo(() => list.filter((f) => f.field_type !== "multi_line_items"), [list]);
  const multiLineFields = useMemo(() => list.filter((f) => f.field_type === "multi_line_items"), [list]);

  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") return;
    setSuperAdminFieldsTab((prev) => {
      if (prev === "scalar") return "scalar";
      const match = /^multi:(\d+)$/.exec(prev);
      if (!match) return "scalar";
      const id = Number(match[1]);
      return multiLineFields.some((f) => f.id === id) ? prev : "scalar";
    });
  }, [userRole, multiLineFields]);

  const isMultiTab = superAdminFieldsTab.startsWith("multi:");
  const activeParentFieldId = useMemo(() => {
    const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
    return match ? Number(match[1]) : null;
  }, [superAdminFieldsTab]);
  const activeParentField = useMemo(() => {
    return activeParentFieldId ? list.find((f) => f.id === activeParentFieldId) : null;
  }, [list, activeParentFieldId]);
  const subs = useMemo(() => {
    return activeParentField?.sub_fields ?? [];
  }, [activeParentField]);

  useEffect(() => {
    if (tabFromUrl === "details" || tabFromUrl === "fields" || tabFromUrl === "settings" || tabFromUrl === "odoo") {
      setActiveEditTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    if (typeof window === "undefined" || userRole !== "SUPER_ADMIN") return;
    if (window.location.hash === "#odoo-bulk-import" || tabFromUrl === "odoo") {
      setActiveEditTab("odoo");
    }
  }, [userRole, tabFromUrl]);

  const setEditTab = (tab: EditTabId) => {
    setActiveEditTab(tab);
    const oid = orgIdFromUrl ?? kpi?.organization_id ?? kpiOrgId;
    if (oid != null) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("organization_id", String(oid));
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

  const loadSections = (organizationId?: number) => {
    if (!token || !kpiId) return;
    const id = organizationId ?? orgId;
    const query = id != null ? `?${qs({ organization_id: id })}` : "";
    api<KpiSection[]>(`/kpis/${kpiId}/sections${query}`, { token })
      .then(setSections)
      .catch(() => setSections([]));
  };

  const loadKpi = () => {
    if (!token || !kpiId) return;
    const query = orgIdFromUrl != null ? `?${qs({ organization_id: orgIdFromUrl })}` : "";
    api<KpiInfo>(`/kpis/${kpiId}${query}`, { token })
      .then((data) => {
        setKpi(data);
        setCardDisplayFieldIds(Array.isArray(data.card_display_field_ids) ? [...data.card_display_field_ids] : []);
        loadList(data.organization_id);
        loadSections(data.organization_id);
      })
      .catch(() => {
        setKpi(null);
        setLoading(false);
      });
  };

  const sectionsOrgQuery = () => (orgId != null ? `?${qs({ organization_id: orgId })}` : "");

  const handleCreateSection = () => {
    const name = newSectionName.trim();
    if (!name) return;
    // Creating a section always opens the field picker first, so the Super Admin can
    // immediately assign currently-unassigned (General) fields to it during creation.
    setSectionFieldModal({ mode: "create", sectionId: null, name, selectedFieldIds: [] });
  };

  const openManageSectionModal = (section: KpiSection) => {
    const currentIds = list.filter((f) => f.section_id === section.id).map((f) => f.id);
    setSectionFieldModal({ mode: "manage", sectionId: section.id, name: section.name, selectedFieldIds: currentIds });
  };

  const toggleSectionFieldSelection = (fieldId: number) => {
    setSectionFieldModal((prev) => {
      if (!prev) return prev;
      const has = prev.selectedFieldIds.includes(fieldId);
      return {
        ...prev,
        selectedFieldIds: has
          ? prev.selectedFieldIds.filter((id) => id !== fieldId)
          : [...prev.selectedFieldIds, fieldId],
      };
    });
  };

  const submitSectionFieldModal = async () => {
    if (!token || !sectionFieldModal) return;
    setSectionFieldModalSaving(true);
    try {
      if (sectionFieldModal.mode === "create") {
        await api<KpiSection>(`/kpis/${kpiId}/sections${sectionsOrgQuery()}`, {
          method: "POST",
          body: JSON.stringify({ name: sectionFieldModal.name, field_ids: sectionFieldModal.selectedFieldIds }),
          token,
        });
        setNewSectionName("");
        toast.success("Section created");
      } else if (sectionFieldModal.sectionId != null) {
        const sectionId = sectionFieldModal.sectionId;
        const originalIds = list.filter((f) => f.section_id === sectionId).map((f) => f.id);
        const selected = new Set(sectionFieldModal.selectedFieldIds);
        const original = new Set(originalIds);
        const toAdd = sectionFieldModal.selectedFieldIds.filter((id) => !original.has(id));
        const toRemove = originalIds.filter((id) => !selected.has(id));
        if (toAdd.length > 0) {
          await api(`/kpis/${kpiId}/sections/${sectionId}/assign-fields${sectionsOrgQuery()}`, {
            method: "POST",
            body: JSON.stringify({ field_ids: toAdd }),
            token,
          });
        }
        if (toRemove.length > 0) {
          await api(`/kpis/${kpiId}/sections/${sectionId}/unassign-fields${sectionsOrgQuery()}`, {
            method: "POST",
            body: JSON.stringify({ field_ids: toRemove }),
            token,
          });
        }
        toast.success("Section fields updated");
      }
      setSectionFieldModal(null);
      loadSections();
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save section fields");
    } finally {
      setSectionFieldModalSaving(false);
    }
  };

  const handleRenameSection = async (id: number) => {
    const name = sectionRenameDraft.trim();
    if (!token || !name) return;
    setSectionsSaving(true);
    try {
      await api<KpiSection>(`/kpis/${kpiId}/sections/${id}${sectionsOrgQuery()}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
        token,
      });
      setSectionRenameId(null);
      setSectionRenameDraft("");
      loadSections();
      toast.success("Section renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename section");
    } finally {
      setSectionsSaving(false);
    }
  };

  const handleDeleteSection = async (section: KpiSection) => {
    if (!token) return;
    if (section.field_count > 0) {
      toast.error("Reassign this section's fields to another section before deleting it");
      return;
    }
    if (!window.confirm(`Delete section "${section.name}"?`)) return;
    setSectionsSaving(true);
    try {
      await api(`/kpis/${kpiId}/sections/${section.id}${sectionsOrgQuery()}`, { method: "DELETE", token });
      loadSections();
      toast.success("Section deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete section");
    } finally {
      setSectionsSaving(false);
    }
  };

  const handleMoveSection = async (index: number, direction: "up" | "down") => {
    const otherIndex = direction === "up" ? index - 1 : index + 1;
    if (!token || otherIndex < 0 || otherIndex >= sections.length) return;
    const a = sections[index];
    const b = sections[otherIndex];
    setSectionsSaving(true);
    try {
      await Promise.all([
        api(`/kpis/${kpiId}/sections/${a.id}${sectionsOrgQuery()}`, {
          method: "PATCH",
          body: JSON.stringify({ sort_order: b.sort_order }),
          token,
        }),
        api(`/kpis/${kpiId}/sections/${b.id}${sectionsOrgQuery()}`, {
          method: "PATCH",
          body: JSON.stringify({ sort_order: a.sort_order }),
          token,
        }),
      ]);
      loadSections();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder sections");
    } finally {
      setSectionsSaving(false);
    }
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
  const [activeCreateSubSection, setActiveCreateSubSection] = useState<string>("Other");

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

  const createSubSections = useMemo(() => {
    const set = new Set<string>();
    createSubFields.forEach((s) => {
      const sec = s.config && typeof s.config === "object" && "ui_section" in s.config ? String((s.config as any).ui_section ?? "").trim() : "";
      set.add(sec || "Other");
    });
    if (set.size === 0) set.add("Other");
    const arr = Array.from(set);
    // Keep "Other" last for readability
    arr.sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
    return arr;
  }, [createSubFields]);

  useEffect(() => {
    if (!createSubSections.includes(activeCreateSubSection)) {
      setActiveCreateSubSection(createSubSections[0] || "Other");
    }
  }, [createSubSections, activeCreateSubSection]);

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
        section_id: data.field_type === "multi_line_items" ? (data.section_id ?? null) : null,
        carry_forward_data: data.carry_forward_data ?? false,
        full_page_multi_items: data.full_page_multi_items ?? false,
        options: [],
      };
      if (
        (data.field_type === "reference" || data.field_type === "multi_reference") &&
        createRefConfig.reference_source_kpi_id &&
        createRefConfig.reference_source_field_key
      ) {
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
            (s.field_type === "reference" || s.field_type === "multi_reference") &&
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

  const executeFieldUpdate = async (fieldId: number, data: UpdateFormData, subFields?: SubFieldDef[], refConfig?: ReferenceConfig) => {
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
        section_id: data.field_type === "multi_line_items" ? (data.section_id ?? null) : null,
        carry_forward_data: data.carry_forward_data,
        full_page_multi_items: data.full_page_multi_items,
      };
      if (
        (data.field_type === "reference" || data.field_type === "multi_reference") &&
        refConfig?.reference_source_kpi_id &&
        refConfig?.reference_source_field_key
      ) {
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
            (s.field_type === "reference" || s.field_type === "multi_reference") &&
            s.config?.reference_source_kpi_id &&
            s.config?.reference_source_field_key;

          const sCfg = s.config && typeof s.config === "object" ? { ...s.config } : {};
          if (uiSection) {
            sCfg.ui_section = uiSection;
          } else {
            delete sCfg.ui_section;
          }
          if (hasRefConfig) {
            sCfg.reference_source_kpi_id = (s.config as any).reference_source_kpi_id;
            sCfg.reference_source_field_key = (s.config as any).reference_source_field_key;
            if ((s.config as any).reference_source_sub_field_key) {
              sCfg.reference_source_sub_field_key = (s.config as any).reference_source_sub_field_key;
            }
          }
          
          sub.config = Object.keys(sCfg).length > 0 ? sCfg : undefined;
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

  const onUpdateSubmit = async (fieldId: number, data: UpdateFormData, subFields?: SubFieldDef[], refConfig?: ReferenceConfig) => {
    if (!token || orgId == null) return;
    const currentField = list.find((f) => f.id === fieldId);
    const isTypeChanged = currentField && currentField.field_type !== data.field_type;

    if (isTypeChanged) {
      if (currentField && isFieldOrSubFieldUsedInRules(currentField.key, currentField.id, false)) {
        const ruleOk = window.confirm(
          "Warning: Changing the data type of this field will delete the conditional visibility rules associated with it. Do you want to proceed?"
        );
        if (!ruleOk) return;
      }
      try {
        const orgParam = orgId != null ? `&organization_id=${orgId}` : "";
        const res = await api<{ compatible: boolean; incompatible_count: number }>(
          `/fields/${fieldId}/check-type-compatibility?new_type=${data.field_type}${orgParam}`,
          { token }
        );
        if (!res.compatible && res.incompatible_count > 0) {
          setTypeChangeWarning({ fieldId, data, subFields, refConfig, count: res.incompatible_count });
          return;
        }
      } catch (err: any) {
        console.error("Failed to check type compatibility:", err);
      }
    }

    if (currentField && currentField.field_type === "multi_line_items" && subFields != null) {
      const prevSubs = currentField.sub_fields || [];
      let warnSub = false;
      for (const ps of prevSubs) {
        const nextSub = subFields.find((s) => s.key === ps.key);
        if (!nextSub || nextSub.field_type !== ps.field_type) {
          if (isFieldOrSubFieldUsedInRules(ps.key, ps.id, true)) {
            warnSub = true;
            break;
          }
        }
      }
      if (warnSub) {
        const ruleOk = window.confirm(
          "Warning: You have deleted or changed the data type of one or more subfields that are currently used in conditional visibility rules. Saving these changes will delete/update those rules. Do you want to proceed?"
        );
        if (!ruleOk) return;
      }
    }

    await executeFieldUpdate(fieldId, data, subFields, refConfig);
  };

  const handleSaveConditionalRule = async () => {
    if (!token || !condTriggerId || orgId == null) return;

    const isMultiTab = superAdminFieldsTab.startsWith("multi:");
    let activeParentFieldId: number | null = null;
    let field: any = null;
    let subs: any[] = [];
    if (isMultiTab) {
      const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
      activeParentFieldId = match ? Number(match[1]) : null;
      field = list.find((f) => f.id === activeParentFieldId);
      if (!field) {
        toast.error("Multi-line field not found");
        return;
      }
      subs = (field.sub_fields ?? []) as any[];
    }

    // Determine the trigger field object
    const triggerField = isMultiTab
      ? subs.find((s) => String(s.id) === String(condTriggerId) || s.key === String(condTriggerId))
      : list.find((f) => String(f.id) === String(condTriggerId));

    if (!triggerField) {
      toast.error("Trigger field not found");
      return;
    }

    // Construct the rule value
    let ruleValue: any = condTriggerVal;
    if (triggerField.field_type === "reference" || triggerField.field_type === "single_line_text") {
      ruleValue = condValueText;
    } else if (triggerField.field_type === "number") {
      if (condOperator === "between" || condOperator === "outside") {
        ruleValue = [Number(condValueText), Number(condValueText2)];
      } else {
        ruleValue = Number(condValueText);
      }
    }

    // Collect all rules to find old trigger field if editing
    const allRules: any[] = [];
    if (isMultiTab) {
      subs.forEach((s: any) => {
        const triggerId = s.config?.condition_trigger_field_id;
        const triggerKey = s.config?.condition_trigger_field_key;
        if (triggerId != null || triggerKey != null) {
          allRules.push({
            id: `legacy:${s.id || s.key}`,
            triggerFieldId: triggerId || triggerKey || "",
          });
        }
        const rules = s.config?.conditional_rules;
        if (Array.isArray(rules)) {
          rules.forEach((r: any) => {
            allRules.push({
              id: r.id,
              triggerFieldId: s.id || s.key,
            });
          });
        }
      });
    } else {
      list.forEach((f: any) => {
        const triggerId = f.config?.condition_trigger_field_id;
        if (triggerId != null) {
          allRules.push({
            id: `legacy:${f.id}`,
            triggerFieldId: triggerId,
          });
        }
        const rules = f.config?.conditional_rules;
        if (Array.isArray(rules)) {
          rules.forEach((r: any) => {
            allRules.push({
              id: r.id,
              triggerFieldId: f.id,
            });
          });
        }
      });
    }

    try {
      if (condDepType === "existing") {
        const finalDepFieldIds = condDepFieldIds.filter(x => x !== "");
        if (finalDepFieldIds.length === 0) {
          toast.error("Please select at least one dependent field");
          return;
        }

        // 1. If we are editing a legacy rule, we remove the legacy config from the dependent field
        if (editingRuleId && editingRuleId.startsWith("legacy:")) {
          const depId = editingRuleId.replace("legacy:", "");
          if (isMultiTab) {
            const nextSubs = subs.map((s) => {
              if (String(s.id || s.key) === depId) {
                const oldCfg = { ...(s.config ?? {}) };
                delete oldCfg.condition_trigger_field_id;
                delete oldCfg.condition_trigger_field_key;
                delete oldCfg.condition_trigger_value;
                return { ...s, config: oldCfg };
              }
              return s;
            });
            const body: UpdateFormData = {
              name: String(field.name ?? ""),
              key: String(field.key ?? ""),
              field_type: "multi_line_items" as any,
              formula_expression: String(field.formula_expression ?? ""),
              is_required: !!field.is_required,
              sort_order: Number(field.sort_order ?? 0),
              carry_forward_data: !!field.carry_forward_data,
              full_page_multi_items: !!field.full_page_multi_items,
              multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
            };
            await executeFieldUpdate(field.id, body, nextSubs, undefined);
          } else {
            const depField = list.find((f) => String(f.id) === depId);
            if (depField) {
              const oldConfig = { ...(depField.config ?? {}) };
              delete oldConfig.condition_trigger_field_id;
              delete oldConfig.condition_trigger_value;
              await api(`/fields/${depField.id}?organization_id=${orgId}`, {
                method: "PATCH",
                body: JSON.stringify({ config: oldConfig }),
                token,
              });
            }
          }
        }

        // 2. Prepare new rule object
        const ruleId = (editingRuleId && !editingRuleId.startsWith("legacy:")) 
          ? editingRuleId 
          : `rule_${Date.now()}`;

        const newRule = {
          id: ruleId,
          operator: condOperator,
          value: ruleValue,
          dependent_fields: finalDepFieldIds,
          logical_operator: condLogicalOperator,
          additional_conditions: condAdditionalConditions,
        };

        // 3. Update the trigger field's configuration
        if (isMultiTab) {
          // MLI subfields rule: trigger subfield config updated
          let nextSubs = subs.map((s) => {
            const sIdOrKey = String(s.id || s.key);
            const triggerIdOrKey = String(triggerField.id || triggerField.key);
            
            if (sIdOrKey === triggerIdOrKey) {
              const oldCfg = { ...(s.config ?? {}) };
              let rules = Array.isArray(oldCfg.conditional_rules) ? [...oldCfg.conditional_rules] : [];
              rules = rules.filter((r: any) => r.id !== ruleId);
              rules.push(newRule);
              return { ...s, config: { ...oldCfg, conditional_rules: rules } };
            }
            return s;
          });

          // Also, if the trigger subfield was changed, remove the rule from the old trigger subfield
          if (editingRuleId && !editingRuleId.startsWith("legacy:")) {
            const oldTriggerId = allRules.find(r => r.id === editingRuleId)?.triggerFieldId;
            if (oldTriggerId && String(oldTriggerId) !== String(triggerField.id || triggerField.key)) {
              nextSubs = nextSubs.map((s) => {
                if (String(s.id || s.key) === String(oldTriggerId)) {
                  const oldCfg = { ...(s.config ?? {}) };
                  let rules = Array.isArray(oldCfg.conditional_rules) ? [...oldCfg.conditional_rules] : [];
                  rules = rules.filter((r: any) => r.id !== ruleId);
                  return { ...s, config: { ...oldCfg, conditional_rules: rules } };
                }
                return s;
              });
            }
          }

          const body: UpdateFormData = {
            name: String(field.name ?? ""),
            key: String(field.key ?? ""),
            field_type: "multi_line_items" as any,
            formula_expression: String(field.formula_expression ?? ""),
            is_required: !!field.is_required,
            sort_order: Number(field.sort_order ?? 0),
            carry_forward_data: !!field.carry_forward_data,
            full_page_multi_items: !!field.full_page_multi_items,
            multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
          };

          await executeFieldUpdate(field.id, body, nextSubs, undefined);
        } else {
          // Scalar rule: trigger field config updated
          const oldConfig = { ...(triggerField.config ?? {}) };
          let rules = Array.isArray(oldConfig.conditional_rules) ? [...oldConfig.conditional_rules] : [];
          rules = rules.filter((r: any) => r.id !== ruleId);
          rules.push(newRule);
          
          await api(`/fields/${triggerField.id}?organization_id=${orgId}`, {
            method: "PATCH",
            body: JSON.stringify({ config: { ...oldConfig, conditional_rules: rules } }),
            token,
          });

          // If trigger field changed, remove rule from old trigger field
          if (editingRuleId && !editingRuleId.startsWith("legacy:")) {
            const oldTriggerId = allRules.find(r => r.id === editingRuleId)?.triggerFieldId;
            if (oldTriggerId && Number(oldTriggerId) !== triggerField.id) {
              const oldTriggerField = list.find(f => f.id === Number(oldTriggerId));
              if (oldTriggerField) {
                const oldCfg = { ...(oldTriggerField.config ?? {}) };
                let oldRules = Array.isArray(oldCfg.conditional_rules) ? [...oldCfg.conditional_rules] : [];
                oldRules = oldRules.filter((r: any) => r.id !== ruleId);
                await api(`/fields/${oldTriggerField.id}?organization_id=${orgId}`, {
                  method: "PATCH",
                  body: JSON.stringify({ config: { ...oldCfg, conditional_rules: oldRules } }),
                  token,
                });
              }
            }
          }
        }
        
        toast.success("Conditional visibility rule saved successfully");
        setIsCondModalOpen(false);
        loadList();
      } else {
        // Create new scalar field
        if (!condNewName.trim() || !condNewKey.trim()) {
          toast.error("Please enter field name and key");
          return;
        }
        if (!/^[a-z_][a-z0-9_]*$/.test(condNewKey)) {
          toast.error("Field key must start with a letter and contain only lowercase letters, numbers, and underscores.");
          return;
        }
        if (list.some((f) => f.key.toLowerCase() === condNewKey.toLowerCase())) {
          toast.error("Field key already exists in this KPI");
          return;
        }

        const newFieldBody: Record<string, unknown> = {
          kpi_id: kpiId,
          name: condNewName,
          key: condNewKey.toLowerCase(),
          field_type: condNewFieldType,
          is_required: condNewRequired,
          sort_order: 0,
          config: {
            ...condNewRefConfig,
          },
          options: [],
        };

        const resField = await api<any>(`/fields?organization_id=${orgId}`, {
          method: "POST",
          body: JSON.stringify(newFieldBody),
          token,
        });

        if (resField && resField.id) {
          const ruleId = `rule_${Date.now()}`;
          const newRule = {
            id: ruleId,
            operator: condOperator,
            value: ruleValue,
            dependent_fields: [resField.id],
          };

          const oldConfig = { ...(triggerField.config ?? {}) };
          let rules = Array.isArray(oldConfig.conditional_rules) ? [...oldConfig.conditional_rules] : [];
          rules.push(newRule);

          await api(`/fields/${triggerField.id}?organization_id=${orgId}`, {
            method: "PATCH",
            body: JSON.stringify({ config: { ...oldConfig, conditional_rules: rules } }),
            token,
          });

          toast.success("New conditional field created and rule saved successfully");
          setIsCondModalOpen(false);
          loadList();
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save conditional visibility rule");
    }
  };

  const handleRemoveConditionalRule = async (ruleId: string) => {
    if (!token || orgId == null) return;
    try {
      const isMultiTab = superAdminFieldsTab.startsWith("multi:");
      
      if (ruleId.startsWith("legacy:")) {
        const depId = ruleId.replace("legacy:", "");
        if (isMultiTab) {
          const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
          const activeParentFieldId = match ? Number(match[1]) : null;
          const field = list.find((f) => f.id === activeParentFieldId) as any;
          if (!field) return;
          const nextSubs = (field.sub_fields ?? []).map((s: any) => {
            if (String(s.id || s.key) === depId) {
              const newConfig = { ...(s.config ?? {}) };
              delete newConfig.condition_trigger_field_id;
              delete newConfig.condition_trigger_field_key;
              delete newConfig.condition_trigger_value;
              return { ...s, config: newConfig };
            }
            return s;
          });
          const body: UpdateFormData = {
            name: String(field.name ?? ""),
            key: String(field.key ?? ""),
            field_type: "multi_line_items" as any,
            formula_expression: String(field.formula_expression ?? ""),
            is_required: !!field.is_required,
            sort_order: Number(field.sort_order ?? 0),
            carry_forward_data: !!field.carry_forward_data,
            full_page_multi_items: !!field.full_page_multi_items,
            multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
          };
          await executeFieldUpdate(field.id, body, nextSubs, undefined);
        } else {
          const depField = list.find((f) => String(f.id) === depId);
          if (depField) {
            const oldConfig = { ...(depField.config ?? {}) };
            delete oldConfig.condition_trigger_field_id;
            delete oldConfig.condition_trigger_value;
            await api(`/fields/${depField.id}?organization_id=${orgId}`, {
              method: "PATCH",
              body: JSON.stringify({ config: oldConfig }),
              token,
            });
          }
        }
      } else {
        // New rules
        if (isMultiTab) {
          const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
          const activeParentFieldId = match ? Number(match[1]) : null;
          const field = list.find((f) => f.id === activeParentFieldId) as any;
          if (!field) return;
          const nextSubs = (field.sub_fields ?? []).map((s: any) => {
            const oldCfg = { ...(s.config ?? {}) };
            if (Array.isArray(oldCfg.conditional_rules)) {
              const rules = oldCfg.conditional_rules.filter((r: any) => r.id !== ruleId);
              return { ...s, config: { ...oldCfg, conditional_rules: rules } };
            }
            return s;
          });
          const body: UpdateFormData = {
            name: String(field.name ?? ""),
            key: String(field.key ?? ""),
            field_type: "multi_line_items" as any,
            formula_expression: String(field.formula_expression ?? ""),
            is_required: !!field.is_required,
            sort_order: Number(field.sort_order ?? 0),
            carry_forward_data: !!field.carry_forward_data,
            full_page_multi_items: !!field.full_page_multi_items,
            multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
          };
          await executeFieldUpdate(field.id, body, nextSubs, undefined);
        } else {
          const triggerField = list.find(f => 
            Array.isArray(f.config?.conditional_rules) && 
            f.config.conditional_rules.some((r: any) => r.id === ruleId)
          );
          if (triggerField) {
            const oldConfig = { ...(triggerField.config ?? {}) };
            const rules = (oldConfig.conditional_rules ?? []).filter((r: any) => r.id !== ruleId);
            await api(`/fields/${triggerField.id}?organization_id=${orgId}`, {
              method: "PATCH",
              body: JSON.stringify({ config: { ...oldConfig, conditional_rules: rules } }),
              token,
            });
          }
        }
      }
      toast.success("Conditional visibility rule removed");
      loadList();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove conditional visibility rule");
    }
  };

  const onSaveCardDisplayFields = async (ids: number[]) => {
    if (!token || !kpiId) return;
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save KPI card fields");
    }
  };

  const onToggleCardDisplayField = (fieldId: number, checked: boolean) => {
    const next = checked
      ? [...cardDisplayFieldIds, fieldId]
      : cardDisplayFieldIds.filter((id) => id !== fieldId);
    setCardDisplayFieldIds(next);
    if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      onSaveCardDisplayFields(next);
      autosaveTimerRef.current = null;
    }, 500);
  };

  const isFieldOrSubFieldUsedInRules = (
    targetKey: string,
    targetId?: number,
    isSubField: boolean = false
  ): boolean => {
    for (const f of list) {
      const fConfig = f.config as any;
      if (!isSubField) {
        if (
          fConfig?.condition_trigger_field_id != null &&
          String(fConfig.condition_trigger_field_id) === String(targetId)
        ) {
          return true;
        }
        if (f.id === targetId && Array.isArray(fConfig?.conditional_rules) && fConfig.conditional_rules.length > 0) {
          return true;
        }
        if (Array.isArray(fConfig?.conditional_rules)) {
          for (const r of fConfig.conditional_rules) {
            const deps = r.dependent_fields || r.dependent_field_ids || [];
            if (deps.map(String).includes(String(targetId)) || deps.map(String).includes(String(targetKey))) {
              return true;
            }
          }
        }
      } else {
        const subfields = f.sub_fields || [];
        for (const sf of subfields) {
          const sfConfig = sf.config as any;
          if (
            sfConfig?.condition_trigger_field_id != null &&
            (String(sfConfig.condition_trigger_field_id) === String(targetId) ||
             String(sfConfig.condition_trigger_field_id) === String(targetKey))
          ) {
            return true;
          }
          if (
            sfConfig?.condition_trigger_field_key != null &&
            String(sfConfig.condition_trigger_field_key) === String(targetKey)
          ) {
            return true;
          }
          if (
            (sf.id === targetId || sf.key === targetKey) &&
            Array.isArray(sfConfig?.conditional_rules) &&
            sfConfig.conditional_rules.length > 0
          ) {
            return true;
          }
          if (Array.isArray(sfConfig?.conditional_rules)) {
            for (const r of sfConfig.conditional_rules) {
              const deps = r.dependent_fields || r.dependent_field_ids || [];
              if (deps.map(String).includes(String(targetId)) || deps.map(String).includes(String(targetKey))) {
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  };

  const openDeleteFieldModal = async (field: { id: number; name: string; key: string }) => {
    if (!token || orgId == null) return;
    setDeleteFieldConfirm({ name: "", key: "" });
    setDeleteFieldSummary(null);
    setDeleteFieldSummaryError(null);
    setDeleteFieldSummaryLoading(true);
    setDeleteFieldModal({ fieldId: field.id, name: field.name, key: field.key });
    try {
      const summary = await api<{ has_child_data: boolean; field_values_count: number; report_template_fields_count: number }>(
        `/fields/${field.id}/child_data_summary?${fieldsQuery()}`,
        { token }
      );
      setDeleteFieldSummary({ field_values_count: summary.field_values_count ?? 0, report_template_fields_count: summary.report_template_fields_count ?? 0 });
    } catch (e) {
      setDeleteFieldSummaryError(e instanceof Error ? e.message : "Failed to load delete summary");
    } finally {
      setDeleteFieldSummaryLoading(false);
    }
  };

  const performDeleteField = async (fieldId: number) => {
    if (!token || orgId == null) return;
    setError(null);
    try {
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

  const isOrgContext = kpi != null && (orgIdFromUrl != null || userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN");

  const buildMultiLineUpdateFromField = (field: any): UpdateFormData => ({
    name: String(field?.name ?? ""),
    key: String(field?.key ?? ""),
    field_type: "multi_line_items" as any,
    formula_expression: String(field?.formula_expression ?? ""),
    is_required: !!field?.is_required,
    sort_order: Number(field?.sort_order ?? 0),
    carry_forward_data: !!field?.carry_forward_data,
    full_page_multi_items: !!field?.full_page_multi_items,
    multi_items_api_endpoint_url: (field?.config as any)?.multi_items_api_endpoint_url ?? "",
  });

  const tabBarStyle = {
    display: "flex",
    gap: "0.25rem",
    borderBottom: "1px solid var(--border)",
    marginBottom: "1.25rem",
    paddingBottom: 0,
  } as const;

  const tabButtonStyle = (active: boolean) => ({
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
  });

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
            {userRole === "SUPER_ADMIN" && (
              <button
                type="button"
                role="tab"
                aria-selected={activeEditTab === "odoo"}
                style={tabButtonStyle(activeEditTab === "odoo")}
                onClick={() => setEditTab("odoo")}
              >
                Odoo import
              </button>
            )}
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
                            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                              <input type="radio" name="syncMode" checked={syncMode === "upsert"} onChange={() => setSyncMode("upsert")} />
                              Update or add (match per multi-line table)
                            </label>
                          </div>
                          {syncMode === "upsert" &&
                            multiLineFieldsForSync.map((mf) => (
                              <div key={mf.id} className="form-group" style={{ marginBottom: "0.5rem" }}>
                                <label style={{ fontSize: "0.9rem" }}>
                                  Match column — {mf.name} <span style={{ color: "var(--muted)" }}>({mf.key})</span>
                                </label>
                                <select
                                  value={kpiSyncUpsertByFieldKey[mf.key] ?? ""}
                                  onChange={(e) =>
                                    setKpiSyncUpsertByFieldKey((prev) => ({ ...prev, [mf.key]: e.target.value }))
                                  }
                                  style={{ display: "block", marginTop: "0.25rem", maxWidth: 400, padding: "0.4rem 0.5rem" }}
                                >
                                  <option value="">— Select sub-field —</option>
                                  {(mf.sub_fields ?? []).map((s) => (
                                    <option key={s.key} value={s.key}>
                                      {s.name} ({s.key})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                            <label>Year to sync</label>
                            <input type="number" min={2000} max={2100} value={syncYear} onChange={(e) => setSyncYear(Number(e.target.value) || new Date().getFullYear())} style={{ width: "6rem" }} />
                          </div>
                          <button
                            type="button"
                            className="btn"
                            disabled={
                              syncLoading ||
                              (syncMode === "upsert" &&
                                multiLineFieldsForSync.some((mf) => !(kpiSyncUpsertByFieldKey[mf.key] ?? "").trim()))
                            }
                            onClick={async () => {
                              if (syncMode === "upsert") {
                                for (const mf of multiLineFieldsForSync) {
                                  if (!(kpiSyncUpsertByFieldKey[mf.key] ?? "").trim()) {
                                    toast.error(`Select a match column for "${mf.name}".`);
                                    return;
                                  }
                                }
                              }
                              setSyncLoading(true);
                              try {
                                const upsertPayload: Record<string, string> = {};
                                if (syncMode === "upsert") {
                                  for (const mf of multiLineFieldsForSync) {
                                    upsertPayload[mf.key] = (kpiSyncUpsertByFieldKey[mf.key] ?? "").trim();
                                  }
                                }
                                const syncQs =
                                  syncMode === "upsert" && Object.keys(upsertPayload).length > 0
                                    ? qs({
                                        year: syncYear,
                                        organization_id: orgIdFromUrl!,
                                        sync_mode: syncMode,
                                        upsert_match_keys: JSON.stringify(upsertPayload),
                                      })
                                    : qs({ year: syncYear, organization_id: orgIdFromUrl!, sync_mode: syncMode });
                                const res = await api<{ skipped?: boolean; reason?: string }>(
                                  `/kpis/${kpiId}/sync-from-api?${syncQs}`,
                                  { method: "POST", token: token! }
                                );
                                if (res && typeof res === "object" && "skipped" in res && (res as { skipped?: boolean }).skipped) {
                                  toast.error((res as { reason?: string }).reason ?? "Sync skipped");
                                  return;
                                }
                                loadKpi();
                                toast.success("Sync completed");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Sync failed");
                              } finally {
                                setSyncLoading(false);
                              }
                            }}
                          >
                            {syncLoading ? "Syncing…" : "Sync from API now"}
                          </button>
                          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>Fetches entry data for the selected year from your endpoint. Override, append, or upsert applies to multi-line tables; other fields follow override behavior.</p>
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

      {isOrgContext && userRole === "SUPER_ADMIN" && activeEditTab === "odoo" && orgId != null && token && (
        <OdooMultiLineImportAdmin
          kpiId={kpiId}
          orgId={orgId}
          token={token}
          fieldId={
            editingId ??
            list.find((f) => f.field_type === "multi_line_items")?.id
          }
          subFields={
            (list.find((f) => f.id === editingId) || list.find((f) => f.field_type === "multi_line_items"))?.sub_fields?.map((s) => ({
              key: s.key,
              name: s.name,
              field_type: s.field_type,
              config: s.config ?? null,
            })) ?? []
          }
          fieldConfig={
            (list.find((f) => f.id === editingId) || list.find((f) => f.field_type === "multi_line_items"))?.config as Record<string, unknown> | null
          }
        />
      )}

      {(!isOrgContext || activeEditTab === "fields") && (
        <>
          {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}



          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
            <button
              type="button"
              className={showCreate ? "btn" : "btn btn-primary"}
              onClick={() => setShowCreate((s) => !s)}
            >
              {showCreate ? "Cancel" : "Add field"}
            </button>
          </div>

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
              {createForm.watch("field_type") === "multi_line_items" && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <label style={{ fontSize: "0.9rem", whiteSpace: "nowrap" }}>Section</label>
                  <select {...createForm.register("section_id")} style={{ padding: "0.35rem 0.5rem" }}>
                    {sections.length === 0 && <option value="">General (default)</option>}
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {(createForm.watch("field_type") === "reference" || createForm.watch("field_type") === "multi_reference") && (
              <div className="form-group">
                <label>Reference source</label>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 0" }}>
                  {createForm.watch("field_type") === "multi_reference"
                    ? "Users may pick multiple values; each must appear in the distinct values from the selected KPI field."
                    : "Values for this field will be restricted to distinct values from the selected KPI field."}
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
                  fields={list}
                  organizationId={orgId ?? undefined}
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
                {createSubSections.length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    {createSubSections.map((sec) => {
                      const isActive = sec === activeCreateSubSection;
                      return (
                        <button
                          key={sec}
                          type="button"
                          className={isActive ? "btn btn-primary" : "btn"}
                          onClick={() => setActiveCreateSubSection(sec)}
                          style={{ borderRadius: 999, padding: "0.35rem 0.65rem", fontSize: "0.9rem" }}
                        >
                          {sec}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Name</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Key</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Type</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Reference source (reference / multi reference)</th>
                        <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Section (UI)</th>
                        <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Required</th>
                        <th style={{ width: "80px", padding: "0.5rem", borderBottom: "2px solid var(--border)" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {createSubFields.filter((s) => {
                        const sec = s.config && typeof s.config === "object" && "ui_section" in s.config ? String((s.config as any).ui_section ?? "").trim() : "";
                        const label = sec || "Other";
                        return createSubSections.length <= 1 ? true : label === activeCreateSubSection;
                      }).length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.9rem", textAlign: "center" }}>
                            No sub-fields in this section yet. Click &quot;Add sub-field&quot; below.
                          </td>
                        </tr>
                      ) : createSubFields
                        .map((s, idx) => ({ s, idx }))
                        .filter(({ s }) => {
                          const sec = s.config && typeof s.config === "object" && "ui_section" in s.config ? String((s.config as any).ui_section ?? "").trim() : "";
                          const label = sec || "Other";
                          return createSubSections.length <= 1 ? true : label === activeCreateSubSection;
                        })
                        .map(({ s, idx }) => (
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
                            {s.field_type === "reference" || s.field_type === "multi_reference" ? (
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
                          <td style={{ padding: "0.4rem 0.5rem", minWidth: "200px" }}>
                            {userRole === "SUPER_ADMIN" ? (
                              <input
                                placeholder="e.g. Program details"
                                value={s.config && typeof s.config === "object" && "ui_section" in s.config ? String((s.config as any).ui_section ?? "") : ""}
                                onChange={(e) => {
                                  const section = e.target.value;
                                  setCreateSubFields((prev) =>
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
                                {s.config && typeof s.config === "object" && "ui_section" in s.config && (s.config as any).ui_section
                                  ? String((s.config as any).ui_section)
                                  : "—"}
                              </div>
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
              <div
                className="form-group"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}
              >
                <label style={{ margin: 0, whiteSpace: "nowrap" }}>API URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/multi-items-api"
                  {...createForm.register("multi_items_api_endpoint_url")}
                  style={{ flex: "1 1 220px", minWidth: 0 }}
                />
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Creating..." : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
          )}

      <div className="card">
        {list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No fields yet. Click &quot;Add field&quot; to create one.</p>
        ) : (
          <ul style={{ listStyle: "none" }}>
            {userRole === "SUPER_ADMIN" ? (
              <li style={{ padding: "0.75rem 0 0 0" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.9rem" }}>
                  <button
                    type="button"
                    className={superAdminFieldsTab === "scalar" ? "btn btn-primary" : "btn"}
                    onClick={() => setSuperAdminFieldsTab("scalar")}
                    style={{ borderRadius: 999, padding: "0.35rem 0.65rem" }}
                  >
                    Scalar fields <span style={{ opacity: 0.8 }}>({scalarFields.length})</span>
                  </button>
                  {multiLineFields.map((mf) => {
                    const tabKey = `multi:${mf.id}`;
                    const active = superAdminFieldsTab === tabKey;
                    return (
                      <button
                        key={mf.id}
                        type="button"
                        className={active ? "btn btn-primary" : "btn"}
                        onClick={() => setSuperAdminFieldsTab(tabKey)}
                        style={{ borderRadius: 999, padding: "0.35rem 0.65rem" }}
                        title={mf.key}
                      >
                        {mf.name}
                      </button>
                    );
                  })}
                </div>

                {superAdminFieldsTab === "scalar" ? (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {scalarFields.map((f) => (
                      <li key={f.id} style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                        {editingId === f.id ? (
                          <FieldEditForm
                            field={f}
                            list={list}
                            onSave={(data, subFields, refConfig) => onUpdateSubmit(f.id, data, subFields, refConfig)}
                            onCancel={() => setEditingId(null)}
                            organizationId={orgId ?? undefined}
                            currentKpiId={kpiId}
                            userRole={userRole}
                            sections={sections}
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
                            </div>
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", color: "var(--muted)" }}>
                                <input
                                  type="checkbox"
                                  checked={cardDisplayFieldIds.includes(f.id)}
                                  onChange={(e) => onToggleCardDisplayField(f.id, e.target.checked)}
                                />
                                Show on card
                              </label>
                              <button type="button" className="btn" onClick={() => setEditingId(f.id)}>Edit</button>
                              <button type="button" className="btn" onClick={() => openDeleteFieldModal(f)} style={{ color: "var(--error)" }}>Delete</button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (() => {
                  const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
                  const fieldId = match ? Number(match[1]) : null;
                  const f = fieldId ? multiLineFields.find((x) => x.id === fieldId) : null;
                  if (!f) return null;

                  const subs = f.sub_fields ?? [];
                  const editingPanel = multiFieldEditingPanelById[f.id] ?? null;
                  const sections = (() => {
                    const uniq = new Set<string>();
                    subs.forEach((s) => {
                      const sec = (s as any)?.config?.ui_section;
                      const label = typeof sec === "string" ? sec.trim() : "";
                      uniq.add(label || "Other");
                    });
                    (uiSectionCustomByMultiFieldId[f.id] ?? []).forEach((s) => {
                      const label = typeof s === "string" ? s.trim() : "";
                      if (label) uniq.add(label);
                    });
                    if (uniq.size === 0) uniq.add("Other");
                    return Array.from(uniq).sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
                  })();

                  const activeSection = (() => {
                    const current = activeSubSectionByMultiFieldId[f.id];
                    if (current && sections.includes(current)) return current;
                    return sections[0] || "Other";
                  })();

                  const isEditing = editingId === f.id;
                  const draft = multiFieldEditDraftById[f.id];
                  const effectiveDraft = draft ?? {
                    data: {
                      name: f.name,
                      key: f.key,
                      field_type: f.field_type as any,
                      formula_expression: f.formula_expression ?? "",
                      is_required: f.is_required,
                      sort_order: (f as any).sort_order ?? 0,
                      carry_forward_data: (f as any).carry_forward_data ?? false,
                      full_page_multi_items: (f as any).full_page_multi_items ?? false,
                      multi_items_api_endpoint_url: ((f as any).config as any)?.multi_items_api_endpoint_url ?? "",
                    } as UpdateFormData,
                    subFields: (f.sub_fields ?? []).map((s) => ({
                      ...(s as any),
                      name: s.name,
                      key: s.key,
                      field_type: s.field_type as any,
                      is_required: (s as any).is_required ?? false,
                      sort_order: (s as any).sort_order ?? 0,
                      config: (s as any).config ?? undefined,
                      keyTouched: false,
                    })) as SubFieldDef[],
                  };

                  return (
                    <div style={{ padding: "0.25rem 0 0.75rem 0" }}>
                      <div
                        style={{
                          marginTop: "-0.15rem",
                          marginBottom: "0.6rem",
                          padding: "0.6rem",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          background: "var(--bg-subtle, #f9fafb)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                          <div style={{ fontWeight: 650, color: "var(--muted)" }}>Settings</div>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                            {isEditing && editingPanel === "general" ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={async () => {
                                    const payload = effectiveDraft.data as any;
                                    const update: UpdateFormData = { ...payload };
                                    await onUpdateSubmit(f.id, update, effectiveDraft.subFields, undefined);
                                    setMultiFieldEditingPanelById((prev) => ({ ...prev, [f.id]: null }));
                                    setEditingId(null);
                                    setMultiFieldEditDraftById((prev) => {
                                      const { [f.id]: _, ...rest } = prev;
                                      return rest;
                                    });
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => {
                                    setMultiFieldEditingPanelById((prev) => ({ ...prev, [f.id]: null }));
                                    setEditingId(null);
                                    setMultiFieldEditDraftById((prev) => {
                                      const { [f.id]: _, ...rest } = prev;
                                      return rest;
                                    });
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  setMultiFieldEditDraftById((prev) => (prev[f.id] ? prev : { ...prev, [f.id]: effectiveDraft }));
                                  setMultiFieldKeyTouchedById((prev) => (prev[f.id] != null ? prev : { ...prev, [f.id]: false }));
                                  setEditingId(f.id);
                                  setMultiFieldEditingPanelById((prev) => ({ ...prev, [f.id]: "general" }));
                                }}
                              >
                                Edit
                              </button>
                            )}
                            <button type="button" className="btn" onClick={() => openDeleteFieldModal(f)} style={{ color: "var(--error)" }}>
                              Delete
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                const resolvedOrgId = kpi?.organization_id ?? orgIdFromUrl ?? orgId;
                                const year = new Date().getFullYear();
                                if (!resolvedOrgId) return;
                                router.push(
                                  `/dashboard/entries/${kpiId}/${year}/multi/${f.id}?${qs({
                                    organization_id: resolvedOrgId,
                                  })}`
                                );
                              }}
                            >
                              Open data entry
                            </button>
                          </div>
                        </div>

                        {isEditing && editingPanel === "general" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.5rem 1rem" }}>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label>Name *</label>
                              <input
                                value={effectiveDraft.data.name ?? ""}
                                onChange={(e) =>
                                  setMultiFieldEditDraftById((prev) => {
                                    const nextName = e.target.value;
                                    const touched = !!multiFieldKeyTouchedById[f.id];
                                    return {
                                      ...prev,
                                      [f.id]: {
                                        ...effectiveDraft,
                                        data: {
                                          ...effectiveDraft.data,
                                          name: nextName,
                                          ...(touched ? {} : { key: slugifyKey(nextName) }),
                                        },
                                      },
                                    };
                                  })
                                }
                              />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label>Key *</label>
                              <input
                                value={effectiveDraft.data.key ?? ""}
                                onChange={(e) => {
                                  const nextKey = e.target.value;
                                  setMultiFieldKeyTouchedById((prev) => ({ ...prev, [f.id]: true }));
                                  setMultiFieldEditDraftById((prev) => ({
                                    ...prev,
                                    [f.id]: { ...effectiveDraft, data: { ...effectiveDraft.data, key: nextKey } },
                                  }));
                                }}
                              />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label>Type *</label>
                              <select
                                value={effectiveDraft.data.field_type as any}
                                onChange={(e) =>
                                  setMultiFieldEditDraftById((prev) => ({
                                    ...prev,
                                    [f.id]: { ...effectiveDraft, data: { ...effectiveDraft.data, field_type: e.target.value as any } },
                                  }))
                                }
                              >
                                {FIELD_TYPES.map((t) => (
                                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                                ))}
                              </select>
                            </div>
                            <div
                              className="form-group"
                              style={{
                                margin: 0,
                                gridColumn: "1 / -1",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                flexWrap: "wrap",
                              }}
                            >
                              <label style={{ margin: 0, whiteSpace: "nowrap" }}>API URL</label>
                              <input
                                type="url"
                                placeholder="https://example.com/multi-items-api"
                                value={(effectiveDraft.data as any).multi_items_api_endpoint_url ?? ""}
                                onChange={(e) =>
                                  setMultiFieldEditDraftById((prev) => ({
                                    ...prev,
                                    [f.id]: {
                                      ...effectiveDraft,
                                      data: { ...(effectiveDraft.data as any), multi_items_api_endpoint_url: e.target.value },
                                    },
                                  }))
                                }
                                style={{ flex: "1 1 220px", minWidth: 0 }}
                              />
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem 1.25rem", alignItems: "center", gridColumn: "1 / -1" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={!!effectiveDraft.data.is_required}
                                  onChange={(e) =>
                                    setMultiFieldEditDraftById((prev) => ({
                                      ...prev,
                                      [f.id]: { ...effectiveDraft, data: { ...effectiveDraft.data, is_required: e.target.checked } },
                                    }))
                                  }
                                />
                                Required
                              </label>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={!!(effectiveDraft.data as any).carry_forward_data}
                                  onChange={(e) =>
                                    setMultiFieldEditDraftById((prev) => ({
                                      ...prev,
                                      [f.id]: {
                                        ...effectiveDraft,
                                        data: { ...(effectiveDraft.data as any), carry_forward_data: e.target.checked },
                                      },
                                    }))
                                  }
                                />
                                Carry forward
                              </label>
                              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={!!(effectiveDraft.data as any).full_page_multi_items}
                                  onChange={(e) =>
                                    setMultiFieldEditDraftById((prev) => ({
                                      ...prev,
                                      [f.id]: {
                                        ...effectiveDraft,
                                        data: { ...(effectiveDraft.data as any), full_page_multi_items: e.target.checked },
                                      },
                                    }))
                                  }
                                />
                                Full-page
                              </label>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                <label>Sort</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={Number(effectiveDraft.data.sort_order ?? 0)}
                                  onChange={(e) =>
                                    setMultiFieldEditDraftById((prev) => ({
                                      ...prev,
                                      [f.id]: { ...effectiveDraft, data: { ...effectiveDraft.data, sort_order: Number(e.target.value || 0) } },
                                    }))
                                  }
                                  style={{ width: "5rem" }}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.4rem 0.9rem" }}>
                            <div><strong>Type</strong><div style={{ color: "var(--muted)" }}>{f.field_type.replace(/_/g, " ")}</div></div>
                            <div><strong>Required</strong><div style={{ color: "var(--muted)" }}>{f.is_required ? "Yes" : "No"}</div></div>
                            <div><strong>Carry forward</strong><div style={{ color: "var(--muted)" }}>{(f as any).carry_forward_data ? "Yes" : "No"}</div></div>
                            <div><strong>Full-page</strong><div style={{ color: "var(--muted)" }}>{(f as any).full_page_multi_items ? "Yes" : "No"}</div></div>
                            <div><strong>Sort</strong><div style={{ color: "var(--muted)" }}>{String((f as any).sort_order ?? "—")}</div></div>
                            <div
                              style={{
                                gridColumn: "1 / -1",
                                display: "flex",
                                alignItems: "baseline",
                                gap: "0.5rem",
                                flexWrap: "wrap",
                              }}
                            >
                              <strong style={{ whiteSpace: "nowrap" }}>API URL</strong>
                              <span style={{ color: "var(--muted)", wordBreak: "break-all", flex: "1 1 200px", minWidth: 0 }}>
                                {((f as any).config as any)?.multi_items_api_endpoint_url
                                  ? String(((f as any).config as any).multi_items_api_endpoint_url)
                                  : "—"}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "0.75rem",
                          background: "var(--surface)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                          <div style={{ fontWeight: 750 }}>Sub-fields</div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                              const nextUiSection = activeSection === "Other" ? "" : activeSection;
                              setAddSubFieldDraft({ name: "", key: "", keyTouched: false, field_type: "single_line_text", is_required: false, ui_section: nextUiSection, config: {} });
                              setAddSubFieldModal({ fieldId: f.id, activeSection });
                            }}
                          >
                            Add Sub Field
                          </button>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
                          {sections.map((sec) => {
                            const isActive = sec === activeSection;
                            const isRenaming = uiSectionRenameDraft?.fieldId === f.id && uiSectionRenameDraft.from === sec;
                            const canDelete = sec !== "Other";
                            return (
                              <div key={sec} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                                {isRenaming ? (
                                  <>
                                    <input
                                      value={uiSectionRenameDraft.to}
                                      onChange={(e) => setUiSectionRenameDraft((p) => (p ? { ...p, to: e.target.value } : p))}
                                      onKeyDown={async (e) => {
                                        if (e.key === "Escape") setUiSectionRenameDraft(null);
                                        if (e.key !== "Enter") return;
                                        const to = uiSectionRenameDraft.to.trim();
                                        const from = uiSectionRenameDraft.from;
                                        if (!to || to === "Other" || to === from) {
                                          setUiSectionRenameDraft(null);
                                          return;
                                        }
                                        const field = list.find((x) => x.id === f.id) as any;
                                        if (!field) return;
                                        const nextSubs = (field.sub_fields ?? []).map((sf: any) => {
                                          const raw = sf?.config?.ui_section;
                                          const label = typeof raw === "string" ? raw.trim() : "";
                                          if ((label || "Other") !== from) return sf;
                                          return { ...sf, config: { ...(sf.config ?? {}), ui_section: to } };
                                        });
                                        setUiSectionCustomByMultiFieldId((prev) => {
                                          const current = prev[f.id] ?? [];
                                          const mapped = current.map((x) => (x === from ? to : x));
                                          const unique = Array.from(new Set(mapped.filter((x) => x && x !== "Other")));
                                          return { ...prev, [f.id]: unique };
                                        });
                                        if (activeSection === from) setActiveSubSectionByMultiFieldId((prev) => ({ ...prev, [f.id]: to }));
                                        setUiSectionRenameDraft(null);
                                        await onUpdateSubmit(f.id, buildMultiLineUpdateFromField(field), nextSubs as any, undefined);
                                      }}
                                      onBlur={() => setUiSectionRenameDraft(null)}
                                      style={{
                                        padding: "0.32rem 0.55rem",
                                        borderRadius: 999,
                                        border: "1px solid var(--border)",
                                        minWidth: 120,
                                        fontSize: "0.9rem",
                                      }}
                                      autoFocus
                                    />
                                    {canDelete && (
                                      <button
                                        type="button"
                                        className="btn"
                                        style={{ borderRadius: 999, padding: "0.25rem 0.45rem", color: "var(--error)" }}
                                        title="Delete section (move fields to Other)"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const field = list.find((x) => x.id === f.id) as any;
                                          if (!field) return;
                                          const affected = (field.sub_fields ?? []).filter((sf: any) => {
                                            const raw = sf?.config?.ui_section;
                                            const label = typeof raw === "string" ? raw.trim() : "";
                                            return (label || "Other") === sec;
                                          }).length;
                                          const ok = window.confirm(
                                            `Delete UI section "${sec}"?\n\n` +
                                              `This will move ${affected} sub-field(s) to "Other".`
                                          );
                                          if (!ok) return;
                                          const nextSubs = (field.sub_fields ?? []).map((sf: any) => {
                                            const raw = sf?.config?.ui_section;
                                            const label = typeof raw === "string" ? raw.trim() : "";
                                            if ((label || "Other") !== sec) return sf;
                                            const cfg = { ...(sf.config ?? {}) } as any;
                                            delete cfg.ui_section;
                                            return { ...sf, config: cfg };
                                          });
                                          setUiSectionCustomByMultiFieldId((prev) => {
                                            const current = prev[f.id] ?? [];
                                            return { ...prev, [f.id]: current.filter((x) => x !== sec) };
                                          });
                                          if (activeSection === sec) setActiveSubSectionByMultiFieldId((prev) => ({ ...prev, [f.id]: "Other" }));
                                          setUiSectionRenameDraft(null);
                                          await onUpdateSubmit(f.id, buildMultiLineUpdateFromField(field), nextSubs as any, undefined);
                                        }}
                                      >
                                        ×
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className={isActive ? "btn btn-primary" : "btn"}
                                    onClick={() => setActiveSubSectionByMultiFieldId((prev) => ({ ...prev, [f.id]: sec }))}
                                    onDoubleClick={() => {
                                      if (sec === "Other") return;
                                      setUiSectionRenameDraft({ fieldId: f.id, from: sec, to: sec });
                                    }}
                                    title={sec === "Other" ? undefined : "Double-click to rename"}
                                    style={{ borderRadius: 999, padding: "0.35rem 0.65rem", fontSize: "0.9rem" }}
                                  >
                                    {sec}
                                  </button>
                                )}
                              </div>
                            );
                          })}

                          <button
                            type="button"
                            className="btn"
                            style={{ borderRadius: 999, padding: "0.35rem 0.65rem", fontSize: "0.9rem" }}
                            onClick={() => {
                              const name = window.prompt("New UI section name");
                              const trimmed = (name ?? "").trim();
                              if (!trimmed || trimmed === "Other") return;
                              setUiSectionCustomByMultiFieldId((prev) => {
                                const current = prev[f.id] ?? [];
                                const next = Array.from(new Set([...current, trimmed].filter((x) => x && x !== "Other")));
                                return { ...prev, [f.id]: next };
                              });
                              setActiveSubSectionByMultiFieldId((prev) => ({ ...prev, [f.id]: trimmed }));
                            }}
                            title="Add UI section"
                          >
                            + Add section
                          </button>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Name</th>
                                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Key</th>
                                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Type</th>
                                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Reference source</th>
                                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>UI section</th>
                                <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Required</th>
                                <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600, width: 140 }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(() => {
                                const rows = subs.map((s, i) => ({ s, i }));
                                const filtered = rows.filter(({ s, i }) => {
                                  const sec = (s as any)?.config?.ui_section;
                                  const label = typeof sec === "string" ? sec.trim() : "";
                                  const group = label || "Other";
                                  return sections.length <= 1 ? true : group === activeSection;
                                });
                                return filtered.map(({ s, i }) => {
                                  const fieldType = String((s as any).field_type ?? "");
                                  const uiSectionVal = typeof (s as any)?.config?.ui_section === "string" ? String((s as any).config.ui_section) : "";
                                  const keyForRow = (s as any).id ?? `${(s as any).key}:${i}`;
                                  const cfg = ((s as any).config ?? {}) as any;
                                  const refLabel =
                                    (fieldType === "reference" || fieldType === "multi_reference") &&
                                    (cfg.reference_source_kpi_id || cfg.reference_source_field_key)
                                      ? `${cfg.reference_source_kpi_id ?? "?"} • ${String(cfg.reference_source_field_key ?? "—")}${cfg.reference_source_sub_field_key ? ` • ${String(cfg.reference_source_sub_field_key)}` : ""}`
                                      : "—";
                                  return (
                                    <tr key={keyForRow} style={{ borderBottom: "1px solid var(--border)" }}>
                                      <>
                                        <td style={{ padding: "0.4rem 0.5rem" }}>{(s as any).name}</td>
                                        <td style={{ padding: "0.4rem 0.5rem", color: "var(--muted)" }}>{(s as any).key}</td>
                                        <td style={{ padding: "0.4rem 0.5rem", color: "var(--muted)" }}>{fieldType.replace(/_/g, " ")}</td>
                                        <td style={{ padding: "0.4rem 0.5rem", color: "var(--muted)" }}>{refLabel}</td>
                                        <td style={{ padding: "0.4rem 0.5rem", color: "var(--muted)" }}>
                                          {uiSectionVal.trim() ? uiSectionVal : "—"}
                                        </td>
                                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "center" }}>{(s as any).is_required ? "Yes" : "No"}</td>
                                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", whiteSpace: "nowrap" }}>
                                          <button
                                            type="button"
                                            className="btn"
                                            onClick={() => {
                                              const cfgObj = ((s as any).config ?? {}) as any;
                                              const uiSec = typeof cfgObj.ui_section === "string" ? String(cfgObj.ui_section) : "";
                                              setEditSubFieldDraft({
                                                name: String((s as any).name ?? ""),
                                                key: String((s as any).key ?? ""),
                                                keyTouched: true,
                                                field_type: fieldType || "single_line_text",
                                                is_required: !!(s as any).is_required,
                                                ui_section: uiSec,
                                                config: {
                                                  ...cfgObj,
                                                  reference_source_kpi_id: cfgObj.reference_source_kpi_id,
                                                  reference_source_field_key: cfgObj.reference_source_field_key,
                                                  reference_source_sub_field_key: cfgObj.reference_source_sub_field_key,
                                                },
                                              });
                                              setEditSubFieldModal({ fieldId: f.id, subIndex: i });
                                            }}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            className="btn"
                                            style={{ color: "var(--error)", marginLeft: "0.35rem" }}
                                            onClick={() => {
                                              const n = String((s as any).name ?? "");
                                              const k = String((s as any).key ?? "");
                                              setDeleteSubFieldConfirm({ name: "", key: "" });
                                              setDeleteSubFieldModal({ fieldId: f.id, subIndex: i, name: n, key: k });
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </td>
                                      </>
                                    </tr>
                                  );
                                });
                              })()}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </li>
            ) : (
              list.map((f) => (
                <li key={f.id} style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                  {editingId === f.id ? (
                    <FieldEditForm
                      field={f}
                      list={list}
                      onSave={(data, subFields, refConfig) => onUpdateSubmit(f.id, data, subFields, refConfig)}
                      onCancel={() => setEditingId(null)}
                      organizationId={orgId ?? undefined}
                      currentKpiId={kpiId}
                      userRole={userRole}
                      extraUiSections={f.field_type === "multi_line_items" ? uiSectionCustomByMultiFieldId[f.id] ?? [] : undefined}
                      sections={sections}
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
                            const resolvedOrgId = kpi?.organization_id ?? orgIdFromUrl ?? orgId;
                            const year = new Date().getFullYear();
                            if (!resolvedOrgId) return;
                            router.push(
                              `/dashboard/entries/${kpiId}/${year}/multi/${f.id}?${qs({
                                organization_id: resolvedOrgId,
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
                        {f.config?.condition_trigger_field_id != null && (
                          <span style={{ display: "block", color: "var(--primary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                            Only visible when trigger field <strong>{list.find(x => x.id === f.config?.condition_trigger_field_id)?.name || f.config?.condition_trigger_field_id}</strong> is <strong>{f.config?.condition_trigger_value ? 'Yes' : 'No'}</strong>
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                        <button type="button" className="btn" onClick={() => setEditingId(f.id)}>Edit</button>
                        <button type="button" className="btn" onClick={() => openDeleteFieldModal(f)} style={{ color: "var(--error)" }}>Delete</button>
                      </div>
                    </div>
                  )}
                </li>
              ))
            )}
          </ul>
        )}

        {/* Conditional Visibility Rules Card */}
        {(superAdminFieldsTab === "scalar" || superAdminFieldsTab.startsWith("multi:")) && (() => {
          const isMultiTab = superAdminFieldsTab.startsWith("multi:");
          const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
          const activeParentFieldId = match ? Number(match[1]) : null;
          const activeParentField = activeParentFieldId ? list.find(f => f.id === activeParentFieldId) : null;
          
          if (isMultiTab && !activeParentField) return null;
          
          const subs = (activeParentField?.sub_fields ?? []) as any[];

          // Collect all rules: legacy and new format
          const allRules: {
            id: string;
            isLegacy: boolean;
            triggerFieldId: number | string;
            triggerFieldKey?: string;
            operator: string;
            value: any;
            dependentFieldIds: (number | string)[];
            dependentNames: string;
            logical_operator?: string;
            additional_conditions?: { operator: string; value: string }[];
          }[] = [];

          if (isMultiTab) {
            // MLI Subfields
            subs.forEach((s: any) => {
              const triggerId = s.config?.condition_trigger_field_id;
              const triggerKey = s.config?.condition_trigger_field_key;
              if (triggerId != null || triggerKey != null) {
                allRules.push({
                  id: `legacy:${s.id || s.key}`,
                  isLegacy: true,
                  triggerFieldId: triggerId || triggerKey || "",
                  triggerFieldKey: triggerKey,
                  operator: "eq",
                  value: s.config.condition_trigger_value ?? true,
                  dependentFieldIds: [s.id || s.key],
                  dependentNames: s.name,
                });
              }
              const rules = s.config?.conditional_rules;
              if (Array.isArray(rules)) {
                rules.forEach((r: any) => {
                  const depKeys = r.dependent_fields || r.dependent_field_ids || [];
                  const depNames = depKeys
                    .map((k: any) => subs.find(x => String(x.id) === String(k) || String(x.key) === String(k))?.name || k)
                    .join(", ");
                  allRules.push({
                    id: r.id || `rule:${s.id || s.key}:${Date.now()}`,
                    isLegacy: false,
                    triggerFieldId: s.id || s.key,
                    triggerFieldKey: s.key,
                    operator: r.operator || "eq",
                    value: r.value,
                    dependentFieldIds: depKeys,
                    dependentNames: depNames,
                    logical_operator: r.logical_operator || "or",
                    additional_conditions: r.additional_conditions || [],
                  });
                });
              }
            });
          } else {
            // Scalar Fields
            list.forEach((f: any) => {
              const triggerId = f.config?.condition_trigger_field_id;
              if (triggerId != null) {
                allRules.push({
                  id: `legacy:${f.id}`,
                  isLegacy: true,
                  triggerFieldId: triggerId,
                  operator: "eq",
                  value: f.config.condition_trigger_value ?? true,
                  dependentFieldIds: [f.id],
                  dependentNames: f.name,
                });
              }
              const rules = f.config?.conditional_rules;
              if (Array.isArray(rules)) {
                rules.forEach((r: any) => {
                  const depIds = r.dependent_fields || r.dependent_field_ids || [];
                  const depNames = depIds
                    .map((id: any) => list.find(x => String(x.id) === String(id))?.name || id)
                    .join(", ");
                  allRules.push({
                    id: r.id || `rule:${f.id}:${Date.now()}`,
                    isLegacy: false,
                    triggerFieldId: f.id,
                    operator: r.operator || "eq",
                    value: r.value,
                    dependentFieldIds: depIds,
                    dependentNames: depNames,
                    logical_operator: r.logical_operator || "or",
                    additional_conditions: r.additional_conditions || [],
                  });
                });
              }
            });
          }

          function formatConditionText(operator: string, value: any, triggerFieldType?: string): string {
            const op = operator.toLowerCase();
            const isBool = triggerFieldType === "boolean" || typeof value === "boolean";
            if (op === "eq") {
              if (isBool) return value ? "is Yes" : "is No";
              return `= ${value}`;
            }
            if (op === "neq") {
              if (isBool) return value ? "is No" : "is Yes";
              return `!= ${value}`;
            }
            if (op === "gt") return `> ${value}`;
            if (op === "lt") return `< ${value}`;
            if (op === "gte") return `>= ${value}`;
            if (op === "lte") return `<= ${value}`;
            if (op === "between") {
              const vals = Array.isArray(value) ? value : [value, ""];
              return `Between ${vals[0]} and ${vals[1]}`;
            }
            if (op === "outside") {
              const vals = Array.isArray(value) ? value : [value, ""];
              return `Outside ${vals[0]} and ${vals[1]}`;
            }
            return `${operator} ${value}`;
          }

          return (
            <div className="card" style={{ marginTop: "2rem", padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
                    Conditional Visibility Rules
                  </h3>
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>
                    Configure fields to dynamically show or hide based on the value of another field.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setCondEditingFieldId(null);
                    setCondTriggerId("");
                    setCondTriggerVal(true);
                    setCondDepType("existing");
                    setCondDepFieldId("");
                    setCondNewName("");
                    setCondNewKey("");
                    setCondNewFieldType("single_line_text");
                    setCondNewRequired(false);
                    setCondNewRefConfig({});
                    setCondOperator("eq");
                    setCondValueText("");
                    setCondValueText2("");
                    setCondDepFieldIds([]);
                    setCondLogicalOperator("or");
                    setCondAdditionalConditions([]);
                    setEditingRuleId(null);
                    setIsCondModalOpen(true);
                  }}
                >
                  Add Rule
                </button>
              </div>

              {allRules.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "1rem 0 0" }}>
                  No conditional visibility rules configured yet.
                </p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", marginTop: "1rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Dependent Field(s)</th>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Trigger Field</th>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Condition</th>
                      <th style={{ textAlign: "right", padding: "0.5rem", borderBottom: "1px solid var(--border)", width: 140 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRules.map((rule) => {
                      let triggerName = "";
                      let triggerKey = "";
                      let triggerType = "";
                      
                      const trigger = isMultiTab
                        ? subs.find(t => String(t.id || t.key) === String(rule.triggerFieldId))
                        : list.find(t => t.id === Number(rule.triggerFieldId));
                      if (trigger) {
                        triggerName = trigger.name;
                        triggerKey = trigger.key;
                        triggerType = trigger.field_type;
                      }
                      
                      return (
                        <tr key={rule.id}>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                            <strong>{rule.dependentNames}</strong>
                          </td>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                            {triggerName ? (
                              <span>{triggerName} <span style={{ color: "var(--muted)" }}>({triggerKey})</span></span>
                            ) : (
                              <span style={{ color: "var(--error)" }}>Missing Trigger</span>
                            )}
                          </td>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                             Show when trigger {formatConditionText(rule.operator, rule.value, triggerType)}
                             {Array.isArray(rule.additional_conditions) && rule.additional_conditions.length > 0 && (
                               <span>
                                 {" "}{rule.logical_operator?.toUpperCase() || "OR"}{" "}
                                 {rule.additional_conditions.map((ac: any, i: number) => (
                                   <span key={i}>
                                     {i > 0 ? ` ${rule.logical_operator?.toUpperCase() || "OR"} ` : ""}
                                     {formatConditionText(ac.operator, ac.value, triggerType)}
                                   </span>
                                 ))}
                               </span>
                             )}
                          </td>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn"
                              style={{ marginRight: "0.35rem" }}
                              onClick={() => {
                                setCondEditingFieldId(rule.id);
                                setEditingRuleId(rule.id);
                                setCondTriggerId(rule.triggerFieldId);
                                setCondOperator(rule.operator);
                                setCondDepFieldIds(rule.dependentFieldIds);
                                setCondDepType("existing");
                                setCondLogicalOperator(rule.logical_operator || "or");
                                setCondAdditionalConditions(rule.additional_conditions || []);
                                
                                if (trigger && trigger.field_type === "boolean") {
                                  setCondTriggerVal(rule.value);
                                } else {
                                  if (Array.isArray(rule.value)) {
                                    setCondValueText(String(rule.value[0] ?? ""));
                                    setCondValueText2(String(rule.value[1] ?? ""));
                                  } else {
                                    setCondValueText(String(rule.value ?? ""));
                                    setCondValueText2("");
                                  }
                                }
                                setIsCondModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn"
                              style={{ color: "var(--error)" }}
                              onClick={() => handleRemoveConditionalRule(rule.id)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}
      </div>
        </>
      )}
    </div>

    {/* Conditional Visibility Rule Modal */}
    {isCondModalOpen && (() => {
      const isMultiTab = superAdminFieldsTab.startsWith("multi:");
      const match = /^multi:(\d+)$/.exec(superAdminFieldsTab);
      const activeParentFieldId = match ? Number(match[1]) : null;
      const activeParentField = activeParentFieldId ? list.find(f => f.id === activeParentFieldId) : null;
      const subs = (activeParentField?.sub_fields ?? []) as any[];

      // Filter eligible trigger fields: Boolean, Dropdown/Reference, Number
      const triggerFields = isMultiTab
        ? subs.filter((s: any) => ["boolean", "reference", "number"].includes(s.field_type))
        : list.filter((f) => ["boolean", "reference", "number"].includes(f.field_type));

      const selectedTrigger = isMultiTab
        ? subs.find((s) => String(s.id) === String(condTriggerId) || s.key === String(condTriggerId))
        : list.find((f) => String(f.id) === String(condTriggerId));

      const eligibleDependents = isMultiTab
        ? subs.filter((s: any) => s.field_type !== "multi_line_items" && s.field_type !== "formula" && String(s.id || s.key) !== String(condTriggerId))
        : list.filter((f) => f.field_type !== "multi_line_items" && f.field_type !== "formula" && f.id !== Number(condTriggerId));

      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            padding: "1rem",
          }}
          onClick={() => setIsCondModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Add/Edit Conditional Visibility Rule"
        >
          <div
            className="card"
            style={{ width: "min(560px, 95vw)", padding: "1.5rem", maxHeight: "90vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>
              {editingRuleId ? "Edit Conditional Visibility Rule" : "Add Conditional Visibility Rule"}
            </h2>

            {/* 1. Select Trigger Field */}
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: "0.35rem" }}>Trigger Field</label>
              <select
                value={condTriggerId}
                onChange={(e) => {
                  const val = e.target.value ? (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) : "";
                  setCondTriggerId(val);
                  setCondOperator("eq");
                  setCondValueText("");
                  setCondValueText2("");
                  setCondTriggerVal(true);
                }}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                <option value="">— Select Trigger Field —</option>
                {triggerFields.map((f: any) => (
                  <option key={f.id || f.key} value={f.id || f.key}>
                    {f.name} ({f.key} - {f.field_type})
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Condition & Values */}
            {selectedTrigger && (
              <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: 8, marginBottom: "1rem" }}>
                <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>Rule Condition</h4>
                
                {/* Operator Selection */}
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Operator</label>
                  <select
                    value={condOperator}
                    onChange={(e) => setCondOperator(e.target.value)}
                    style={{ width: "100%", padding: "0.45rem" }}
                  >
                    {selectedTrigger.field_type === "number" ? (
                      <>
                        <option value="eq">Equal (=)</option>
                        <option value="neq">Not Equal (!=)</option>
                        <option value="gt">Greater Than (&gt;)</option>
                        <option value="lt">Less Than (&lt;)</option>
                        <option value="gte">Greater Than or Equal (&gt;=)</option>
                        <option value="lte">Less Than or Equal (&lt;=)</option>
                        <option value="between">Between (Inclusive)</option>
                        <option value="outside">Outside Range</option>
                      </>
                    ) : (
                      <>
                        <option value="eq">Equal (=)</option>
                        <option value="neq">Not Equal (!=)</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Values Inputs based on trigger type */}
                {selectedTrigger.field_type === "boolean" && (
                  <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Value</label>
                    <select
                      value={condTriggerVal ? "true" : "false"}
                      onChange={(e) => setCondTriggerVal(e.target.value === "true")}
                      style={{ width: "100%", padding: "0.45rem" }}
                    >
                      <option value="true">Yes / True</option>
                      <option value="false">No / False</option>
                    </select>
                  </div>
                )}

                {(selectedTrigger.field_type === "reference" || selectedTrigger.field_type === "multi_reference") && (
                  <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Value</label>
                    <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
                      {refAllowedValuesList.length > 0 && (
                        <select
                          value={condValueText}
                          onChange={(e) => setCondValueText(e.target.value)}
                          style={{ width: "100%", padding: "0.45rem" }}
                        >
                          <option value="">— Select Extracted Value —</option>
                          {refAllowedValuesList.map((val) => (
                            <option key={val} value={val}>
                              {val}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        type="text"
                        value={condValueText}
                        onChange={(e) => setCondValueText(e.target.value)}
                        placeholder="Or enter value manually"
                        style={{ width: "100%", padding: "0.45rem" }}
                      />
                    </div>
                  </div>
                )}

                {selectedTrigger.field_type === "number" && (
                  <div className="form-group" style={{ marginBottom: "0.5rem" }}>
                    {["between", "outside"].includes(condOperator) ? (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Min Value</label>
                          <input
                            type="number"
                            value={condValueText}
                            onChange={(e) => setCondValueText(e.target.value)}
                            style={{ width: "100%", padding: "0.45rem" }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Max Value</label>
                          <input
                            type="number"
                            value={condValueText2}
                            onChange={(e) => setCondValueText2(e.target.value)}
                            style={{ width: "100%", padding: "0.45rem" }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Numeric Value</label>
                        <input
                          type="number"
                          value={condValueText}
                          onChange={(e) => setCondValueText(e.target.value)}
                          style={{ width: "100%", padding: "0.45rem" }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Additional Conditions and logical operators */}
            {selectedTrigger && (
              <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: 8, marginBottom: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Additional Conditions</h4>
                  {condAdditionalConditions.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Operator:</label>
                      <select
                        value={condLogicalOperator}
                        onChange={(e) => setCondLogicalOperator(e.target.value)}
                        style={{ padding: "0.25rem" }}
                      >
                        <option value="or">OR</option>
                        <option value="and">AND</option>
                      </select>
                    </div>
                  )}
                </div>

                {condAdditionalConditions.map((ac, acIdx) => (
                  <div key={acIdx} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                    <select
                      value={ac.operator}
                      onChange={(e) => {
                        const next = [...condAdditionalConditions];
                        next[acIdx].operator = e.target.value;
                        setCondAdditionalConditions(next);
                      }}
                      style={{ padding: "0.35rem", flex: 1 }}
                    >
                      {selectedTrigger.field_type === "number" ? (
                        <>
                          <option value="eq">Equal (=)</option>
                          <option value="neq">Not Equal (!=)</option>
                          <option value="gt">Greater Than (&gt;)</option>
                          <option value="lt">Less Than (&lt;)</option>
                          <option value="gte">Greater Than or Equal (&gt;=)</option>
                          <option value="lte">Less Than or Equal (&lt;=)</option>
                        </>
                      ) : (
                        <>
                          <option value="eq">Equal (=)</option>
                          <option value="neq">Not Equal (!=)</option>
                        </>
                      )}
                    </select>

                    {selectedTrigger.field_type === "boolean" ? (
                      <select
                        value={ac.value}
                        onChange={(e) => {
                          const next = [...condAdditionalConditions];
                          next[acIdx].value = e.target.value;
                          setCondAdditionalConditions(next);
                        }}
                        style={{ padding: "0.35rem", flex: 2 }}
                      >
                        <option value="true">Yes / True</option>
                        <option value="false">No / False</option>
                      </select>
                    ) : (selectedTrigger.field_type === "reference" || selectedTrigger.field_type === "multi_reference") ? (
                      <div style={{ display: "flex", gap: "0.25rem", flex: 2, flexDirection: "column" }}>
                        {refAllowedValuesList.length > 0 && (
                          <select
                            value={ac.value}
                            onChange={(e) => {
                              const next = [...condAdditionalConditions];
                              next[acIdx].value = e.target.value;
                              setCondAdditionalConditions(next);
                            }}
                            style={{ padding: "0.35rem", flex: 1 }}
                          >
                            <option value="">— Select Extracted Value —</option>
                            {refAllowedValuesList.map((val) => (
                              <option key={val} value={val}>{val}</option>
                            ))}
                          </select>
                        )}
                        <input
                          type="text"
                          value={ac.value}
                          onChange={(e) => {
                            const next = [...condAdditionalConditions];
                            next[acIdx].value = e.target.value;
                            setCondAdditionalConditions(next);
                          }}
                          placeholder="Or enter value manually"
                          style={{ padding: "0.35rem", flex: 1, minWidth: 0 }}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={ac.value}
                        onChange={(e) => {
                          const next = [...condAdditionalConditions];
                          next[acIdx].value = e.target.value;
                          setCondAdditionalConditions(next);
                        }}
                        placeholder="Value"
                        style={{ padding: "0.35rem", flex: 2 }}
                      />
                    )}

                    <button
                      type="button"
                      className="btn"
                      style={{ color: "var(--error)", padding: "0.35rem 0.5rem" }}
                      onClick={() => {
                        setCondAdditionalConditions(condAdditionalConditions.filter((_, idx) => idx !== acIdx));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem" }}
                  onClick={() => {
                    setCondAdditionalConditions([...condAdditionalConditions, { operator: "eq", value: "" }]);
                  }}
                >
                  + Add Condition
                </button>
              </div>
            )}

            {/* 3. Choose Dependency Type */}
            {!editingRuleId && !isMultiTab && (
              <div className="form-group" style={{ marginBottom: "1rem" }}>
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.35rem" }}>Choose Dependency Type</label>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="condDepType"
                      checked={condDepType === "existing"}
                      onChange={() => setCondDepType("existing")}
                    />
                    Use Existing Scalar Field
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="condDepType"
                      checked={condDepType === "new"}
                      onChange={() => setCondDepType("new")}
                    />
                    Create New Scalar Field
                  </label>
                </div>
              </div>
            )}

            {/* 4. Select Dependent Field(s) */}
            {condDepType === "existing" ? (
              <div className="form-group" style={{ marginBottom: "1.5rem" }}>
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.35rem" }}>
                  Select Dependent Field(s)
                </label>
                <div style={{ maxHeight: "180px", overflowY: "auto", border: "1px solid var(--border)", padding: "0.5rem", borderRadius: 4 }}>
                  {eligibleDependents.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.5rem" }}>No eligible fields available.</p>
                  ) : (
                    eligibleDependents.map((f: any) => {
                      const idOrKey = isMultiTab ? f.key : f.id;
                      const isChecked = condDepFieldIds.map(String).includes(String(idOrKey));
                      return (
                        <label key={idOrKey} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCondDepFieldIds([...condDepFieldIds.filter(x => String(x) !== String(idOrKey)), idOrKey]);
                              } else {
                                setCondDepFieldIds(condDepFieldIds.filter(x => String(x) !== String(idOrKey)));
                              }
                            }}
                          />
                          <span>{f.name} <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>({f.key} - {f.field_type})</span></span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: 8, marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>Create Dependent Scalar Field</h4>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Field Name</label>
                  <input
                    type="text"
                    value={condNewName}
                    onChange={(e) => {
                      setCondNewName(e.target.value);
                      setCondNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 50));
                    }}
                    placeholder="e.g. Funding Amount"
                    style={{ width: "100%", padding: "0.45rem" }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Field Key</label>
                  <input
                    type="text"
                    value={condNewKey}
                    onChange={(e) => setCondNewKey(e.target.value)}
                    placeholder="e.g. funding_amount"
                    style={{ width: "100%", padding: "0.45rem" }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Field Type</label>
                  <select
                    value={condNewFieldType}
                    onChange={(e) => setCondNewFieldType(e.target.value)}
                    style={{ width: "100%", padding: "0.45rem" }}
                  >
                    <option value="single_line_text">Single line text</option>
                    <option value="multi_line_text">Multi line text</option>
                    <option value="number">Numeric</option>
                    <option value="date">Date</option>
                    <option value="boolean">Boolean</option>
                    <option value="attachment">Attachment</option>
                    <option value="mixed_list">Mixed list</option>
                    <option value="reference">Reference</option>
                    <option value="multi_reference">Multi Reference</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={condNewRequired}
                      onChange={(e) => setCondNewRequired(e.target.checked)}
                    />
                    Required Field
                  </label>
                </div>

                {(condNewFieldType === "reference" || condNewFieldType === "multi_reference") && (
                  <div className="form-group" style={{ marginTop: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>Reference config</label>
                    <ReferenceConfigUI
                      organizationId={kpi?.organization_id ?? orgId ?? undefined}
                      currentKpiId={kpiId}
                      value={condNewRefConfig}
                      onChange={setCondNewRefConfig}
                    />
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setIsCondModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveConditionalRule}
              >
                Save Rule
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {typeChangeWarning && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.45)",
          padding: "1rem",
        }}
        onClick={() => setTypeChangeWarning(null)}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm Field Data Type Change"
      >
        <div
          className="card"
          style={{ width: "min(480px, 95vw)", padding: "1.5rem" }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            Warning: Data Loss Potential
          </h3>
          <p style={{ fontSize: "0.9rem", color: "var(--text)", margin: "0 0 1.25rem", lineHeight: 1.5 }}>
            Changing this field data type may delete existing saved values because the current data cannot be converted to the new type. Do you want to continue?
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn"
              onClick={() => setTypeChangeWarning(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: "var(--error, #ef4444)", borderColor: "var(--error, #ef4444)" }}
              onClick={async () => {
                const info = typeChangeWarning;
                setTypeChangeWarning(null);
                await executeFieldUpdate(info.fieldId, info.data, info.subFields, info.refConfig);
              }}
            >
              Continue and Delete Invalid Values
            </button>
          </div>
        </div>
      </div>
    )}

    {addSubFieldModal && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.45)",
          padding: "1rem",
        }}
        onClick={() => setAddSubFieldModal(null)}
        role="dialog"
        aria-modal="true"
        aria-label="Add sub field"
      >
        <div
          className="card"
          style={{ width: "min(680px, 95vw)", maxHeight: "85vh", overflow: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const field = list.find((x) => x.id === addSubFieldModal.fieldId) as any;
            const uiSectionOptions = mergeUiSectionLabelsForMultiField(
              field?.sub_fields as SubFieldDef[] | undefined,
              uiSectionCustomByMultiFieldId[addSubFieldModal.fieldId] ?? []
            );
            return (
              <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Add Sub Field</h2>
            <button type="button" className="btn" onClick={() => setAddSubFieldModal(null)}>Close</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem 1rem", marginTop: "1rem" }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Name *</label>
              <input
                value={addSubFieldDraft.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setAddSubFieldDraft((p) => ({ ...p, name: nextName, ...(p.keyTouched ? {} : { key: slugifyKey(nextName) }) }));
                }}
                placeholder="e.g. Campus"
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
                autoFocus
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Key *</label>
              <input
                value={addSubFieldDraft.key}
                onChange={(e) => setAddSubFieldDraft((p) => ({ ...p, key: e.target.value, keyTouched: true }))}
                placeholder="campus"
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Type *</label>
              <select
                value={addSubFieldDraft.field_type}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setAddSubFieldDraft((p) => ({
                    ...p,
                    field_type: nextType,
                    config: nextType === "reference" || nextType === "multi_reference" ? p.config : {},
                  }));
                }}
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
              >
                {SUB_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>UI section</label>
              <select
                value={addSubFieldDraft.ui_section.trim() ? addSubFieldDraft.ui_section : "Other"}
                onChange={(e) => setAddSubFieldDraft((p) => ({ ...p, ui_section: e.target.value === "Other" ? "" : e.target.value }))}
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10, maxWidth: "100%" }}
              >
                {uiSectionOptions.map((sec) => (
                  <option key={sec} value={sec}>{truncateLabel(sec, 40)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem 1.25rem", alignItems: "center", marginTop: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={addSubFieldDraft.is_required}
                onChange={(e) => setAddSubFieldDraft((p) => ({ ...p, is_required: e.target.checked }))}
              />
              Required
            </label>
          </div>

          {(addSubFieldDraft.field_type === "reference" || addSubFieldDraft.field_type === "multi_reference") && (
            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 650, marginBottom: "0.5rem" }}>Reference source</div>
              <ReferenceConfigUI
                organizationId={kpi?.organization_id ?? orgId ?? undefined}
                currentKpiId={kpiId}
                value={addSubFieldDraft.config}
                onChange={(c) => setAddSubFieldDraft((p) => ({ ...p, config: c }))}
                labelPrefix="Source"
              />
            </div>
          )}

          {addSubFieldDraft.field_type === "formula" && (() => {
            const parentField = addSubFieldModal ? list.find(x => x.id === addSubFieldModal.fieldId) : null;
            return (
              <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Formula Expression *</label>
                  <textarea
                    value={addSubFieldDraft.config.formula_expression || ""}
                    onChange={(e) => setAddSubFieldDraft((p) => ({
                      ...p,
                      config: { ...p.config, formula_expression: e.target.value }
                    }))}
                    placeholder="e.g. CurrentRow.quantity * CurrentRow.price"
                    rows={3}
                    style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10, fontFamily: "monospace" }}
                  />
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <FormulaBuilder
                    formulaValue={addSubFieldDraft.config.formula_expression || ""}
                    onInsert={(text) => {
                      const current = addSubFieldDraft.config.formula_expression || "";
                      setAddSubFieldDraft((p) => ({
                        ...p,
                        config: { ...p.config, formula_expression: current + text }
                      }));
                    }}
                    fields={list}
                    organizationId={orgId ?? undefined}
                    currentKpiId={kpiId}
                    currentMliSubFields={parentField?.sub_fields}
                    currentSubFieldKey={addSubFieldDraft.key}
                  />
                </div>
              </div>
            );
          })()}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="button" className="btn" onClick={() => setAddSubFieldModal(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const modal = addSubFieldModal;
                if (!modal) return;
                const name = addSubFieldDraft.name.trim();
                const key = addSubFieldDraft.key.trim();
                if (!name || !key) {
                  toast.error("Name and key are required.");
                  return;
                }
                if (
                  (addSubFieldDraft.field_type === "reference" || addSubFieldDraft.field_type === "multi_reference") &&
                  (!addSubFieldDraft.config.reference_source_kpi_id || !addSubFieldDraft.config.reference_source_field_key)
                ) {
                  toast.error("Please select a source KPI and field.");
                  return;
                }
                if (
                  addSubFieldDraft.field_type === "formula" &&
                  !addSubFieldDraft.config.formula_expression?.trim()
                ) {
                  toast.error("Please enter a formula expression.");
                  return;
                }
                const field = list.find((x) => x.id === modal.fieldId) as any;
                if (!field) return;
                const sectionLabel = addSubFieldDraft.ui_section.trim();
                const existingSubs = (field.sub_fields ?? []) as any[];
                const nextIndex = existingSubs.length;
                const cfg: Record<string, unknown> = {};
                if (sectionLabel) cfg.ui_section = sectionLabel;
                if (addSubFieldDraft.field_type === "reference" || addSubFieldDraft.field_type === "multi_reference") {
                  cfg.reference_source_kpi_id = addSubFieldDraft.config.reference_source_kpi_id;
                  cfg.reference_source_field_key = addSubFieldDraft.config.reference_source_field_key;
                  if (addSubFieldDraft.config.reference_source_sub_field_key) cfg.reference_source_sub_field_key = addSubFieldDraft.config.reference_source_sub_field_key;
                } else if (addSubFieldDraft.field_type === "formula") {
                  cfg.formula_expression = addSubFieldDraft.config.formula_expression;
                }
                const nextSub = {
                  name,
                  key,
                  field_type: addSubFieldDraft.field_type,
                  is_required: addSubFieldDraft.is_required,
                  sort_order: nextIndex,
                  config: cfg,
                } as any;
                const update: UpdateFormData = {
                  name: String(field.name ?? ""),
                  key: String(field.key ?? ""),
                  field_type: "multi_line_items" as any,
                  formula_expression: String(field.formula_expression ?? ""),
                  is_required: !!field.is_required,
                  sort_order: Number(field.sort_order ?? 0),
                  carry_forward_data: !!field.carry_forward_data,
                  full_page_multi_items: !!field.full_page_multi_items,
                  multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
                };
                await onUpdateSubmit(modal.fieldId, update, [...existingSubs, nextSub] as any, undefined);
                setAddSubFieldModal(null);
              }}
            >
              Add
            </button>
          </div>
              </>
            );
          })()}
        </div>
      </div>
    )}

    {editSubFieldModal && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.45)",
          padding: "1rem",
        }}
        onClick={() => setEditSubFieldModal(null)}
        role="dialog"
        aria-modal="true"
        aria-label="Edit sub field"
      >
        <div
          className="card"
          style={{ width: "min(720px, 95vw)", maxHeight: "85vh", overflow: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const field = list.find((x) => x.id === editSubFieldModal.fieldId) as any;
            const uiSectionOptions = mergeUiSectionLabelsForMultiField(
              field?.sub_fields as SubFieldDef[] | undefined,
              uiSectionCustomByMultiFieldId[editSubFieldModal.fieldId] ?? []
            );
            return (
              <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Edit Sub Field</h2>
            <button type="button" className="btn" onClick={() => setEditSubFieldModal(null)}>Close</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem 1rem", marginTop: "1rem" }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Name *</label>
              <input
                value={editSubFieldDraft.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setEditSubFieldDraft((p) => ({ ...p, name: nextName, ...(p.keyTouched ? {} : { key: slugifyKey(nextName) }) }));
                }}
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
                autoFocus
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Key *</label>
              <input
                value={editSubFieldDraft.key}
                onChange={(e) => setEditSubFieldDraft((p) => ({ ...p, key: e.target.value, keyTouched: true }))}
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Type *</label>
              <select
                value={editSubFieldDraft.field_type}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setEditSubFieldDraft((p) => ({
                    ...p,
                    field_type: nextType,
                    config: nextType === "reference" || nextType === "multi_reference" ? p.config : {},
                  }));
                }}
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
              >
                {SUB_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>UI section</label>
              <select
                value={editSubFieldDraft.ui_section.trim() ? editSubFieldDraft.ui_section : "Other"}
                onChange={(e) => setEditSubFieldDraft((p) => ({ ...p, ui_section: e.target.value === "Other" ? "" : e.target.value }))}
                style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10, maxWidth: "100%" }}
              >
                {uiSectionOptions.map((sec) => (
                  <option key={sec} value={sec}>{truncateLabel(sec, 40)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem 1.25rem", alignItems: "center", marginTop: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={editSubFieldDraft.is_required}
                onChange={(e) => setEditSubFieldDraft((p) => ({ ...p, is_required: e.target.checked }))}
              />
              Required
            </label>
          </div>

          {(editSubFieldDraft.field_type === "reference" || editSubFieldDraft.field_type === "multi_reference") && (
            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 650, marginBottom: "0.5rem" }}>Reference source</div>
              <ReferenceConfigUI
                organizationId={kpi?.organization_id ?? orgId ?? undefined}
                currentKpiId={kpiId}
                value={editSubFieldDraft.config}
                onChange={(c) => setEditSubFieldDraft((p) => ({ ...p, config: c }))}
                labelPrefix="Source"
              />
            </div>
          )}

          {editSubFieldDraft.field_type === "formula" && (() => {
            const parentField = editSubFieldModal ? list.find(x => x.id === editSubFieldModal.fieldId) : null;
            return (
              <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Formula Expression *</label>
                  <textarea
                    value={editSubFieldDraft.config.formula_expression || ""}
                    onChange={(e) => setEditSubFieldDraft((p) => ({
                      ...p,
                      config: { ...p.config, formula_expression: e.target.value }
                    }))}
                    placeholder="e.g. CurrentRow.quantity * CurrentRow.price"
                    rows={3}
                    style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10, fontFamily: "monospace" }}
                  />
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <FormulaBuilder
                    formulaValue={editSubFieldDraft.config.formula_expression || ""}
                    onInsert={(text) => {
                      const current = editSubFieldDraft.config.formula_expression || "";
                      setEditSubFieldDraft((p) => ({
                        ...p,
                        config: { ...p.config, formula_expression: current + text }
                      }));
                    }}
                    fields={list}
                    organizationId={orgId ?? undefined}
                    currentKpiId={kpiId}
                    currentMliSubFields={parentField?.sub_fields}
                    currentSubFieldKey={editSubFieldDraft.key}
                  />
                </div>
              </div>
            );
          })()}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="button" className="btn" onClick={() => setEditSubFieldModal(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const modal = editSubFieldModal;
                if (!modal) return;
                const name = editSubFieldDraft.name.trim();
                const key = editSubFieldDraft.key.trim();
                if (!name || !key) {
                  toast.error("Name and key are required.");
                  return;
                }
                if (
                  (editSubFieldDraft.field_type === "reference" || editSubFieldDraft.field_type === "multi_reference") &&
                  (!editSubFieldDraft.config.reference_source_kpi_id || !editSubFieldDraft.config.reference_source_field_key)
                ) {
                  toast.error("Please select a source KPI and field.");
                  return;
                }
                if (
                  editSubFieldDraft.field_type === "formula" &&
                  !editSubFieldDraft.config.formula_expression?.trim()
                ) {
                  toast.error("Please enter a formula expression.");
                  return;
                }
                const field = list.find((x) => x.id === modal.fieldId) as any;
                if (!field) return;
                const existingSubs = (field.sub_fields ?? []) as any[];
                if (modal.subIndex < 0 || modal.subIndex >= existingSubs.length) {
                  toast.error("Sub-field no longer exists. Please refresh.");
                  return;
                }
                const uiSection = editSubFieldDraft.ui_section.trim();
                const cfg: Record<string, unknown> = {
                  ...(editSubFieldDraft.config ?? {}),
                };
                if (uiSection) {
                  cfg.ui_section = uiSection;
                } else {
                  delete cfg.ui_section;
                }
                if (editSubFieldDraft.field_type === "reference" || editSubFieldDraft.field_type === "multi_reference") {
                  cfg.reference_source_kpi_id = editSubFieldDraft.config.reference_source_kpi_id;
                  cfg.reference_source_field_key = editSubFieldDraft.config.reference_source_field_key;
                  if (editSubFieldDraft.config.reference_source_sub_field_key) {
                    cfg.reference_source_sub_field_key = editSubFieldDraft.config.reference_source_sub_field_key;
                  }
                  delete cfg.formula_expression;
                } else if (editSubFieldDraft.field_type === "formula") {
                  cfg.formula_expression = editSubFieldDraft.config.formula_expression;
                  delete cfg.reference_source_kpi_id;
                  delete cfg.reference_source_field_key;
                  delete cfg.reference_source_sub_field_key;
                } else {
                  delete cfg.reference_source_kpi_id;
                  delete cfg.reference_source_field_key;
                  delete cfg.reference_source_sub_field_key;
                  delete cfg.formula_expression;
                }
                const nextSub = {
                  ...existingSubs[modal.subIndex],
                  name,
                  key,
                  field_type: editSubFieldDraft.field_type,
                  is_required: editSubFieldDraft.is_required,
                  config: cfg,
                } as any;
                const nextSubs = existingSubs.map((s, idx) => (idx === modal.subIndex ? nextSub : s));
                const update: UpdateFormData = {
                  name: String(field.name ?? ""),
                  key: String(field.key ?? ""),
                  field_type: "multi_line_items" as any,
                  formula_expression: String(field.formula_expression ?? ""),
                  is_required: !!field.is_required,
                  sort_order: Number(field.sort_order ?? 0),
                  carry_forward_data: !!field.carry_forward_data,
                  full_page_multi_items: !!field.full_page_multi_items,
                  multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
                };
                await onUpdateSubmit(modal.fieldId, update, nextSubs as any, undefined);
                setEditSubFieldModal(null);
              }}
            >
              Save
            </button>
          </div>
              </>
            );
          })()}
        </div>
      </div>
    )}

    {deleteSubFieldModal && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.45)",
          padding: "1rem",
        }}
        onClick={() => setDeleteSubFieldModal(null)}
        role="dialog"
        aria-modal="true"
        aria-label="Delete sub field"
      >
        <div
          className="card"
          style={{ width: "min(620px, 95vw)", maxHeight: "85vh", overflow: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "1.1rem", margin: 0, color: "var(--error)" }}>Delete Sub Field</h2>
            <button type="button" className="btn" onClick={() => setDeleteSubFieldModal(null)}>Close</button>
          </div>

          <div style={{ marginTop: "0.75rem", color: "var(--muted)", fontSize: "0.95rem" }}>
            You are about to delete the sub-field <strong>{deleteSubFieldModal.name}</strong>{" "}
            (<span style={{ fontFamily: "monospace" }}>{deleteSubFieldModal.key}</span>) from this multi-line field.
          </div>
          <div style={{ marginTop: "0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>
            This is permanent. Existing multi-line rows may lose this column&apos;s values after deletion.
          </div>

          <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 10, border: "1px solid var(--border)", background: "rgba(239, 68, 68, 0.04)" }}>
            <div style={{ fontWeight: 650, marginBottom: "0.35rem" }}>Type to confirm</div>
            <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
              Enter the exact <strong>name</strong> and <strong>key</strong> to enable deletion.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem 1rem" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Name</label>
                <input
                  value={deleteSubFieldConfirm.name}
                  onChange={(e) => setDeleteSubFieldConfirm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={deleteSubFieldModal.name}
                  style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Key</label>
                <input
                  value={deleteSubFieldConfirm.key}
                  onChange={(e) => setDeleteSubFieldConfirm((p) => ({ ...p, key: e.target.value }))}
                  placeholder={deleteSubFieldModal.key}
                  style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10, fontFamily: "monospace" }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="button" className="btn" onClick={() => setDeleteSubFieldModal(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: "var(--error)", borderColor: "var(--error)" }}
              disabled={
                deleteSubFieldConfirm.name.trim() !== deleteSubFieldModal.name.trim() ||
                deleteSubFieldConfirm.key.trim() !== deleteSubFieldModal.key.trim()
              }
              onClick={async () => {
                const modal = deleteSubFieldModal;
                if (!modal) return;
                if (isFieldOrSubFieldUsedInRules(modal.key, modal.fieldId, true)) {
                  const ruleOk = window.confirm(
                    "Warning: Deleting this subfield will delete the conditional visibility rules associated with it. Do you want to proceed?"
                  );
                  if (!ruleOk) return;
                }
                const ok = window.confirm(
                  `Permanently delete this sub-field?\n\n` +
                    `Name: ${modal.name}\n` +
                    `Key: ${modal.key}\n\n` +
                    `This may remove existing stored values for this column.`
                );
                if (!ok) return;
                const field = list.find((x) => x.id === modal.fieldId) as any;
                if (!field) return;
                const existingSubs = (field.sub_fields ?? []) as any[];
                if (modal.subIndex < 0 || modal.subIndex >= existingSubs.length) {
                  toast.error("Sub-field no longer exists. Please refresh.");
                  return;
                }
                const nextSubs = existingSubs.filter((_, idx) => idx !== modal.subIndex);
                const update: UpdateFormData = {
                  name: String(field.name ?? ""),
                  key: String(field.key ?? ""),
                  field_type: "multi_line_items" as any,
                  formula_expression: String(field.formula_expression ?? ""),
                  is_required: !!field.is_required,
                  sort_order: Number(field.sort_order ?? 0),
                  carry_forward_data: !!field.carry_forward_data,
                  full_page_multi_items: !!field.full_page_multi_items,
                  multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
                };
                await onUpdateSubmit(modal.fieldId, update, nextSubs as any, undefined);
                setDeleteSubFieldModal(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )}

    {deleteFieldModal && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.45)",
          padding: "1rem",
        }}
        onClick={() => setDeleteFieldModal(null)}
        role="dialog"
        aria-modal="true"
        aria-label="Delete field"
      >
        <div
          className="card"
          style={{ width: "min(680px, 95vw)", maxHeight: "85vh", overflow: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "1.1rem", margin: 0, color: "var(--error)" }}>Delete Field</h2>
            <button type="button" className="btn" onClick={() => setDeleteFieldModal(null)}>Close</button>
          </div>

          <div style={{ marginTop: "0.75rem", color: "var(--muted)", fontSize: "0.95rem" }}>
            You are about to delete the field <strong>{deleteFieldModal.name}</strong> (
            <span style={{ fontFamily: "monospace" }}>{deleteFieldModal.key}</span>).
          </div>

          <div style={{ marginTop: "0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>
            This is permanent. Existing entries may lose stored values for this field.
          </div>

          <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 10, border: "1px solid var(--border)", background: "rgba(239, 68, 68, 0.04)" }}>
            <div style={{ fontWeight: 650, marginBottom: "0.35rem" }}>Type to confirm</div>
            <div style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
              Enter the exact <strong>name</strong> and <strong>key</strong> to enable deletion.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem 1rem" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Name</label>
                <input
                  value={deleteFieldConfirm.name}
                  onChange={(e) => setDeleteFieldConfirm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={deleteFieldModal.name}
                  style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10 }}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Key</label>
                <input
                  value={deleteFieldConfirm.key}
                  onChange={(e) => setDeleteFieldConfirm((p) => ({ ...p, key: e.target.value }))}
                  placeholder={deleteFieldModal.key}
                  style={{ width: "100%", padding: "0.45rem 0.55rem", border: "1px solid var(--border)", borderRadius: 10, fontFamily: "monospace" }}
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: "0.75rem", padding: "0.75rem", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-subtle, #f8f9fa)" }}>
            <div style={{ fontWeight: 650, marginBottom: "0.35rem" }}>Impact</div>
            {deleteFieldSummaryLoading ? (
              <div style={{ color: "var(--muted)" }}>Loading…</div>
            ) : deleteFieldSummaryError ? (
              <div className="form-error">{deleteFieldSummaryError}</div>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                Stored values: <strong>{deleteFieldSummary?.field_values_count ?? "—"}</strong> · Report template references:{" "}
                <strong>{deleteFieldSummary?.report_template_fields_count ?? "—"}</strong>
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="button" className="btn" onClick={() => setDeleteFieldModal(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: "var(--error)", borderColor: "var(--error)" }}
              disabled={
                deleteFieldConfirm.name.trim() !== deleteFieldModal.name.trim() ||
                deleteFieldConfirm.key.trim() !== deleteFieldModal.key.trim()
              }
              onClick={async () => {
                const modal = deleteFieldModal;
                if (!modal) return;
                if (isFieldOrSubFieldUsedInRules(modal.key, modal.fieldId, false)) {
                  const ruleOk = window.confirm(
                    "Warning: This field is used in conditional visibility rules. Deleting it will also delete those rules. Do you want to proceed?"
                  );
                  if (!ruleOk) return;
                }
                const ok = window.confirm(
                  `Permanently delete this field?\n\n` +
                    `Name: ${modal.name}\n` +
                    `Key: ${modal.key}\n\n` +
                    `This may remove existing stored values for this field.`
                );
                if (!ok) return;
                await performDeleteField(modal.fieldId);
                setDeleteFieldModal(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )}


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
  const scalarFieldTypes = ["single_line_text", "multi_line_text", "number", "date", "boolean", "reference", "multi_reference", "mixed_list"];
  const sourceFieldOptions: { value: string; label: string }[] = [];
  sourceFields.forEach((f) => {
    if (scalarFieldTypes.includes(f.field_type)) {
      sourceFieldOptions.push({ value: f.key, label: `${f.name} (${f.key})` });
    }
    if (f.field_type === "multi_line_items" && f.sub_fields?.length) {
      f.sub_fields.forEach((s) => {
        sourceFieldOptions.push({ value: `${f.key}|${s.key}`, label: `${f.name} → ${s.key}` });
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
          style={{ minWidth: 0, width: "100%", maxWidth: 320 }}
        >
          <option value="">— Select KPI —</option>
          {kpis.filter((k) => k.id !== currentKpiId).map((k) => (
            <option key={k.id} value={k.id}>
              {truncateLabel(k.name, 52)}
            </option>
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
          style={{ minWidth: 0, width: "100%", maxWidth: 420 }}
          disabled={!value.reference_source_kpi_id}
        >
          <option value="">— Select field —</option>
          {sourceFieldOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {truncateLabel(opt.label, 64)}
            </option>
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
  fields: Array<{
    id?: number;
    key: string;
    name: string;
    field_type: string;
    sub_fields?: SubFieldDef[];
  }>;
}

function FormulaBuilder({
  formulaValue,
  onInsert,
  fields,
  organizationId,
  currentKpiId,
  currentMliSubFields,
  currentSubFieldKey,
}: {
  formulaValue: string;
  onInsert: (text: string) => void;
  fields: KpiField[];
  organizationId?: number;
  currentKpiId?: number;
  currentMliSubFields?: SubFieldDef[];
  currentSubFieldKey?: string;
}) {
  type WhereCondition = {
    filterSubKey: string;
    op: string;
    value: string;
    compareType?: "constant" | "subfield" | "scalar" | "other_scalar";
    /** For multi_reference with equals / not equals: multiple related values (OR / AND expansion). */
    multiValues: string[];
    logicWithPrev: "op_and" | "op_or";
  };

  const [sourceKpi, setSourceKpi] = useState<"current" | "other">("current");
  const [selectedFieldKey, setSelectedFieldKey] = useState<string>("");
  const [refSubKey, setRefSubKey] = useState("");
  const [refGroupFn, setRefGroupFn] = useState<string>("SUM_ITEMS");
  const [useConditional, setUseConditional] = useState(false);
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([
    { filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" },
  ]);
  const [refAllowedValues, setRefAllowedValues] = useState<Record<string, string[]>>({});
  const [otherKpis, setOtherKpis] = useState<FormulaRefKpi[]>([]);
  const [refOtherKpiId, setRefOtherKpiId] = useState<number | "">("");

  const token = getAccessToken();

  const currentMliFieldKey = useMemo(() => {
    if (!currentMliSubFields || currentMliSubFields.length === 0) return null;
    const match = fields.find((f) => {
      if (!f.sub_fields || f.sub_fields.length !== currentMliSubFields.length) return false;
      return f.sub_fields.every((sf, idx) => sf.key === currentMliSubFields[idx].key);
    });
    return match?.key || null;
  }, [fields, currentMliSubFields]);

  const isCurrentMliSelected = sourceKpi === "current" && selectedFieldKey === currentMliFieldKey;

  useEffect(() => {
    if (!token || organizationId == null || currentKpiId == null) return;
    const qs = new URLSearchParams({ organization_id: String(organizationId), exclude_kpi_id: String(currentKpiId) });
    api<FormulaRefKpi[]>(`/kpis/formula-refs?${qs}`, { token })
      .then(setOtherKpis)
      .catch(() => setOtherKpis([]));
  }, [token, organizationId, currentKpiId]);

  const handleSourceKpiChange = (type: "current" | "other") => {
    setSourceKpi(type);
    setSelectedFieldKey("");
    setRefOtherKpiId("");
    setRefSubKey("");
    setUseConditional(false);
    setWhereConditions([{ filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" }]);
  };

  const isOther = sourceKpi === "other";
  const selectedOtherKpi = refOtherKpiId === "" ? null : otherKpis.find((k) => k.id === refOtherKpiId);
  const otherKpiFields = selectedOtherKpi?.fields ?? [];
  
  const activeField = isOther
    ? (selectedOtherKpi?.fields.find((f) => f.key === selectedFieldKey) ?? null)
    : (fields.find((f) => f.key === selectedFieldKey) ?? null);

  const activeMliField = activeField?.field_type === "multi_line_items" ? activeField : null;
  const subFields = activeMliField ? (activeMliField.sub_fields ?? []) : [];
  const primaryCond = whereConditions[0];
  const refFilterSubKey = primaryCond?.filterSubKey ?? "";
  const canInsertNumber = activeField?.field_type === "number" || activeField?.field_type === "formula";
  const isCountItemsOnly = refGroupFn === "COUNT_ITEMS";
  const isConditionalWhere = useConditional && activeMliField !== null && !!refFilterSubKey;
  const isCountWhere = refGroupFn === "COUNT_ITEMS";
  const canInsertItems = activeMliField !== null && (
    isConditionalWhere
      ? (isCountWhere ? !!refFilterSubKey : (subFields.length > 0 && !!refSubKey && !!refFilterSubKey))
      : (isCountItemsOnly || (subFields.length > 0 && !!refSubKey))
  );

  const getRefSourceFromSubKey = (subKey: string): { cacheKey: string; sid: number; skey: string; sourceSubKey?: string } | null => {
    const isCur = subKey.startsWith("CurrentRow.");
    const sfKey = isCur ? subKey.substring(11) : subKey;
    const sf = isCur
      ? currentMliSubFields?.find((s: SubFieldDef) => s.key === sfKey)
      : subFields.find((s: SubFieldDef) => s.key === sfKey);
    if (!sf || (sf.field_type !== "reference" && sf.field_type !== "multi_reference")) return null;
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
    if (!activeMliField) return;
    const isOther = sourceKpi === "other";
    const kpiIdPrefix = isOther ? `${refOtherKpiId}, ` : "";
    
    let baseFn = refGroupFn;
    if (isOther) {
      baseFn = refGroupFn.replace("_ITEMS", "_KPI_ITEMS");
    }

    if (isConditionalWhere) {
      const condArgs: string[] = [];
      whereConditions.forEach((c, idx) => {
        if (!c.filterSubKey) return;
        const isLhsCurrent = c.filterSubKey.startsWith("CurrentRow.");
        const resolvedFilterSubKey = isLhsCurrent ? c.filterSubKey.substring(11) : c.filterSubKey;
        
        const sfRow = subFields.find((s: SubFieldDef) => s.key === (isLhsCurrent ? c.value : resolvedFilterSubKey));
        const allowedOps = operatorsForSubFieldType(sfRow?.field_type);
        const resolvedOp = allowedOps.some((o) => o.value === c.op) ? c.op : (allowedOps[0]?.value ?? "op_eq");
        
        const rawVals: string[] = [c.value];
        const trimmedVals = rawVals.map((r) => String(r ?? "").trim()).filter((v) => v !== "");
        if (trimmedVals.length === 0) return;
        
        const raw = trimmedVals[0]!;
        
        if (idx > 0) condArgs.push(c.logicWithPrev);
        
        if (isLhsCurrent) {
          const val = `CurrentRow.${resolvedFilterSubKey}`;
          if (isOther) {
            condArgs.push(`"${raw}"`, `"${resolvedOp}"`, val);
          } else {
            condArgs.push(raw, resolvedOp, val);
          }
        } else {
          const isUnquoted = c.compareType === "subfield" || c.compareType === "scalar" || c.compareType === "other_scalar";
          const val = isUnquoted ? raw : quoteFormulaWhereValue(raw);
          if (isOther) {
            condArgs.push(`"${resolvedFilterSubKey}"`, `"${resolvedOp}"`, val);
          } else {
            condArgs.push(resolvedFilterSubKey, resolvedOp, val);
          }
        }
      });
      if (condArgs.length < 3) return;
      const whereFn = baseFn.endsWith("_WHERE") ? baseFn : baseFn + "_WHERE";
      if (whereFn === "COUNT_ITEMS_WHERE" || whereFn === "COUNT_KPI_ITEMS_WHERE") {
        onInsert(isOther
          ? `${whereFn}(${kpiIdPrefix}"${activeMliField.key}", ${condArgs.join(", ")})`
          : `${whereFn}(${activeMliField.key}, ${condArgs.join(", ")})`
        );
      } else {
        onInsert(isOther
          ? `${whereFn}(${kpiIdPrefix}"${activeMliField.key}", "${refSubKey}", ${condArgs.join(", ")})`
          : `${whereFn}(${activeMliField.key}, ${refSubKey}, ${condArgs.join(", ")})`
        );
      }
      return;
    }

    if (isCountItemsOnly && !refSubKey) {
      onInsert(isOther
        ? `COUNT_KPI_ITEMS(${refOtherKpiId}, "${activeMliField.key}")`
        : `COUNT_ITEMS(${activeMliField.key})`
      );
    } else {
      onInsert(isOther
        ? `${baseFn}(${kpiIdPrefix}"${activeMliField.key}", "${refSubKey}")`
        : `${baseFn}(${activeMliField.key}, ${refSubKey})`
      );
    }
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem", background: "var(--bg-subtle, #f8f9fa)", width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowX: "hidden" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Insert reference</div>
      
      {/* Step 1: Source Selector */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)", fontWeight: 500 }}>Source:</span>
        <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
          <input
            type="radio"
            name="source_kpi_type"
            checked={sourceKpi === "current"}
            onChange={() => handleSourceKpiChange("current")}
          />
          Current KPI
        </label>
        {organizationId != null && currentKpiId != null && otherKpis.length > 0 && (
          <label style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input
              type="radio"
              name="source_kpi_type"
              checked={sourceKpi === "other"}
              onChange={() => handleSourceKpiChange("other")}
            />
            Other KPI
          </label>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", marginBottom: "0.75rem", width: "100%", boxSizing: "border-box" }}>
        {/* Step 2: Select Other KPI (if source is other) */}
        {isOther && (
          <div style={{ flex: "1 1 180px", minWidth: "160px", maxWidth: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Select KPI</label>
            <select
              value={refOtherKpiId}
              onChange={(e) => {
                setRefOtherKpiId(e.target.value ? Number(e.target.value) : "");
                setSelectedFieldKey("");
                setRefSubKey("");
                setUseConditional(false);
                setWhereConditions([{ filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" }]);
              }}
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}
            >
              <option value="">— Select KPI —</option>
              {otherKpis.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Step 3: Select Field */}
        {(!isOther || refOtherKpiId !== "") && (
          <div style={{ flex: "1 1 200px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
            <select
              value={selectedFieldKey}
              onChange={(e) => {
                setSelectedFieldKey(e.target.value);
                setRefSubKey("");
                setUseConditional(false);
                setWhereConditions([{ filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" }]);
              }}
              style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}
            >
              <option value="">— Select field —</option>
              {(isOther ? otherKpiFields : fields).map((f) => (
                <option key={f.key} value={f.key}>
                  {truncateLabel(`${f.name} (${f.key})`, 64)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Step 4: MLI Configurations */}
        {activeMliField !== null && subFields.length > 0 && (
          <>
            <div style={{ flex: "1 1 150px", minWidth: "130px", maxWidth: "100%", boxSizing: "border-box" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Sub-field</label>
              <select value={refSubKey} onChange={(e) => setRefSubKey(e.target.value)} style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}>
                <option value="">
                  {useConditional && refGroupFn === "COUNT_ITEMS"
                    ? "— N/A for COUNT where —"
                    : refGroupFn === "COUNT_ITEMS" && !useConditional
                      ? "Row count (no sub-field)"
                      : "— Select —"}
                </option>
                {subFields.map((s: SubFieldDef) => (
                  <option key={s.id ?? s.key} value={s.key}>{s.name} ({s.key})</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 140px", minWidth: "120px", maxWidth: "100%", boxSizing: "border-box" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Group function</label>
              <select value={refGroupFn} onChange={(e) => setRefGroupFn(e.target.value)} style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}>
                {GROUP_FUNCTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", height: "34px", alignSelf: "flex-end", cursor: "pointer", marginBottom: "0.25rem" }}>
              <input type="checkbox" checked={useConditional} onChange={(e) => setUseConditional(e.target.checked)} />
              Conditional (where)
            </label>
          </>
        )}

      </div>

      {/* Conditions grid */}
      {useConditional && activeMliField && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%", boxSizing: "border-box", marginTop: "0.5rem" }}>
          {whereConditions.map((c, idx) => {
            const isLhsCurrent = c.filterSubKey.startsWith("CurrentRow.");
            const resolvedLhsSubKey = isLhsCurrent ? c.filterSubKey.substring(11) : c.filterSubKey;
            
            const sfCond = isLhsCurrent
              ? currentMliSubFields?.find((s: SubFieldDef) => s.key === resolvedLhsSubKey)
              : subFields.find((s: SubFieldDef) => s.key === resolvedLhsSubKey);
            const ftCond = sfCond?.field_type ?? "";
            const opChoices = operatorsForSubFieldType(ftCond);
            const opSelectValue = opChoices.some((o) => o.value === c.op) ? c.op : (opChoices[0]?.value ?? "op_eq");
            const refMetaRow = getRefSourceFromSubKey(c.filterSubKey);
            const refOptions = refMetaRow ? refAllowedValues[refMetaRow.cacheKey] || [] : [];
            const showMultiRefPick =
              ftCond === "multi_reference" && (c.op === "op_eq" || c.op === "op_neq") && refOptions.length > 0;
            const setRow = (patch: Partial<WhereCondition>) =>
              setWhereConditions((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

            return (
              <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end", borderBottom: "1px dashed var(--border)", paddingBottom: "0.75rem", width: "100%", boxSizing: "border-box" }}>
                {idx > 0 && (
                  <div style={{ flex: "1 1 80px", minWidth: "70px", maxWidth: "100%" }}>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Link</label>
                    <select
                      value={c.logicWithPrev}
                      onChange={(e) =>
                        setWhereConditions((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, logicWithPrev: e.target.value as "op_and" | "op_or" } : x))
                        )
                      }
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    >
                      <option value="op_and">AND</option>
                      <option value="op_or">OR</option>
                    </select>
                  </div>
                )}
                <div style={{ flex: "1 1 180px", minWidth: "160px", maxWidth: "100%" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Field</label>
                  <select
                    value={c.filterSubKey}
                    onChange={(e) => {
                      const key = e.target.value;
                      const isCur = key.startsWith("CurrentRow.");
                      const sfKey = isCur ? key.substring(11) : key;
                      const sf = isCur
                        ? currentMliSubFields?.find((s: SubFieldDef) => s.key === sfKey)
                        : subFields.find((s: SubFieldDef) => s.key === sfKey);
                      const nextOps = operatorsForSubFieldType(sf?.field_type);
                      const nextOp = nextOps[0]?.value ?? "op_eq";
                      setWhereConditions((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, filterSubKey: key, op: nextOp, value: "", compareType: isCur ? "subfield" : "constant", multiValues: [] } : x
                        )
                      );
                    }}
                    style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}
                  >
                    <option value="">— Select field —</option>
                    {subFields.map((s: SubFieldDef) => (
                      <option key={s.key} value={s.key}>
                        {s.name} ({s.key})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 130px", minWidth: "110px", maxWidth: "100%" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Operator</label>
                  <select
                    value={opSelectValue}
                    onChange={(e) => {
                      const next = e.target.value;
                      setWhereConditions((prev) =>
                        prev.map((x, i) => {
                          if (i !== idx) return x;
                          const collapseMulti =
                            next !== "op_eq" && next !== "op_neq" && (x.multiValues?.length ?? 0) > 0;
                          return {
                            ...x,
                            op: next,
                            ...(collapseMulti
                                ? { value: x.multiValues?.[0] ?? x.value, multiValues: [] }
                                : {}),
                          };
                        })
                      );
                    }}
                    style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    {opChoices.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "2 1 220px", minWidth: "180px", maxWidth: "100%", boxSizing: "border-box" }}>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Value</label>
                  
                  {c.filterSubKey && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.25rem" }}>
                      {c.filterSubKey.startsWith("CurrentRow.") ? (
                        <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name={`compare_type_${idx}`}
                            checked={true}
                            readOnly
                          />
                          Selected MLI Subfield
                        </label>
                      ) : (
                        <>
                          <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name={`compare_type_${idx}`}
                              checked={!c.compareType || c.compareType === "constant"}
                              onChange={() => setRow({ compareType: "constant", value: "" })}
                            />
                            Constant
                          </label>
                          {currentMliSubFields && currentMliSubFields.length > 0 && (
                            <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                              <input
                                type="radio"
                                name={`compare_type_${idx}`}
                                checked={c.compareType === "subfield"}
                                onChange={() => setRow({ compareType: "subfield", value: "" })}
                              />
                               Row Subfield
                            </label>
                          )}
                          <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name={`compare_type_${idx}`}
                              checked={c.compareType === "scalar"}
                              onChange={() => setRow({ compareType: "scalar", value: "" })}
                            />
                            Scalar Field
                          </label>
                          <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                            <input
                              type="radio"
                              name={`compare_type_${idx}`}
                              checked={c.compareType === "other_scalar"}
                              onChange={() => setRow({ compareType: "other_scalar", value: "" })}
                            />
                            Other KPI Scalar
                          </label>
                        </>
                      )}
                    </div>
                  )}

                  {!c.filterSubKey ? (
                    <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "inline-block", padding: "0.35rem 0" }}>Select a field first</span>
                  ) : c.filterSubKey.startsWith("CurrentRow.") ? (
                    <select
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}
                    >
                      <option value="">— Select selected KPI subfield —</option>
                      {subFields.map((sf) => (
                        <option key={sf.key} value={sf.key}>
                          {sf.name} ({sf.key})
                        </option>
                      ))}
                    </select>
                  ) : c.compareType === "subfield" ? (
                    <select
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}
                    >
                      <option value="">— Select subfield —</option>
                      {currentMliSubFields
                        ?.filter((sf) => sf.key !== currentSubFieldKey)
                        .map((sf) => (
                          <option key={sf.key} value={`CurrentRow.${sf.key}`}>
                            {sf.name} ({sf.key})
                          </option>
                        ))}
                    </select>
                  ) : c.compareType === "scalar" ? (
                    <select
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}
                    >
                      <option value="">— Select scalar field —</option>
                      {fields
                        .filter((f) => f.field_type !== "multi_line_items")
                        .map((f) => (
                          <option key={f.id} value={f.key}>
                            {f.name} ({f.key})
                          </option>
                        ))}
                    </select>
                  ) : c.compareType === "other_scalar" ? (
                    (() => {
                      const parseKpiFieldCall = (val: string) => {
                        const match = /^KPI_FIELD\((\d+),\s*["']([^"']*)["']\)$/.exec(val);
                        return match ? { kpiId: Number(match[1]), fieldKey: match[2] } : { kpiId: "", fieldKey: "" };
                      };
                      const parsed = parseKpiFieldCall(c.value);
                      const activeOtherKpi = parsed.kpiId ? otherKpis.find((k) => k.id === parsed.kpiId) : null;
                      const otherFields = activeOtherKpi?.fields?.filter((f) => f.field_type !== "multi_line_items") ?? [];
                      return (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", width: "100%", boxSizing: "border-box" }}>
                          <select
                            value={parsed.kpiId}
                            onChange={(e) => {
                              const kid = e.target.value ? Number(e.target.value) : "";
                              setRow({ value: kid ? `KPI_FIELD(${kid}, "")` : "" });
                            }}
                            style={{ flex: "1 1 120px", minWidth: "100px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                          >
                            <option value="">— Select KPI —</option>
                            {otherKpis.map((k) => (
                              <option key={k.id} value={k.id}>{k.name}</option>
                            ))}
                          </select>
                          <select
                            value={parsed.fieldKey}
                            onChange={(e) => {
                              const fk = e.target.value;
                              setRow({ value: parsed.kpiId ? `KPI_FIELD(${parsed.kpiId}, "${fk}")` : "" });
                            }}
                            disabled={!parsed.kpiId}
                            style={{ flex: "1 1 120px", minWidth: "100px", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                          >
                            <option value="">— Select Field —</option>
                            {otherFields.map((f) => (
                              <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                            ))}
                          </select>
                        </div>
                      );
                    })()
                  ) : ftCond === "boolean" ? (
                    <select
                      value={c.value === "True" || c.value === "False" ? c.value : ""}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    >
                      <option value="">—</option>
                      <option value="True">Yes</option>
                      <option value="False">No</option>
                    </select>
                  ) : ftCond === "number" ? (
                    <input
                      type="number"
                      step="any"
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                      placeholder="Number"
                    />
                  ) : ftCond === "date" ? (
                    <input
                      type="date"
                      value={c.value.length >= 10 ? c.value.slice(0, 10) : c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  ) : ftCond === "reference" && refMetaRow ? (
                    refOptions.length > 0 ? (
                      !c.value || refOptions.includes(c.value) ? (
                        <select
                          value={refOptions.includes(c.value) ? c.value : ""}
                          onChange={(e) => setRow({ value: e.target.value })}
                          style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", textOverflow: "ellipsis" }}
                        >
                          <option value="">— Select value —</option>
                          {refOptions.map((v) => (
                            <option key={v} value={v}>{truncateLabel(v, 72)}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={c.value}
                          onChange={(e) => setRow({ value: e.target.value })}
                          style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                        />
                      )
                    ) : (
                      <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Loading values...</span>
                    )
                  ) : (
                    <input
                      type="text"
                      value={c.value}
                      onChange={(e) => setRow({ value: e.target.value })}
                      style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  )}
                </div>
                {whereConditions.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setWhereConditions((prev) => prev.filter((_, i) => i !== idx))}
                    style={{ padding: "0.35rem 0.65rem", borderRadius: 6, height: "34px", display: "inline-flex", alignItems: "center", alignSelf: "flex-end" }}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              setWhereConditions((prev) => [
                ...prev,
                { filterSubKey: "", op: "op_eq", value: "", compareType: "constant", multiValues: [], logicWithPrev: "op_and" },
              ])
            }
            style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}
          >
            + Add condition
          </button>
        </div>
      )}

      {/* Operators and Insert buttons at the bottom of the box */}
      <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        {/* Operators list */}
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Operators:</span>
          {[" + ", " - ", " * ", " / ", " ( ", " ) "].map((op) => (
            <button key={op} type="button" className="btn" onClick={() => onInsert(op)} style={{ padding: "0.25rem 0.5rem", fontSize: "0.9rem" }}>{op.trim() || op}</button>
          ))}
        </div>

        {/* Insert buttons */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canInsertNumber && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (isOther) {
                  onInsert(`KPI_FIELD(${refOtherKpiId}, "${selectedFieldKey}")`);
                } else {
                  onInsert(selectedFieldKey);
                }
              }}
              style={{ height: "34px", display: "inline-flex", alignItems: "center" }}
            >
              Insert field
            </button>
          )}

          {canInsertItems && activeMliField && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleInsertItems}
              style={{ height: "34px", display: "inline-flex", alignItems: "center" }}
            >
              Insert
            </button>
          )}
        </div>
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
  extraUiSections,
  sections,
}: {
  field: KpiField;
  list: KpiField[];
  onSave: (data: UpdateFormData, subFields?: SubFieldDef[], refConfig?: ReferenceConfig) => void;
  onCancel: () => void;
  organizationId?: number;
  currentKpiId?: number;
  userRole?: UserRole | null;
  /** In-session UI section names from "+ Add section" on the fields list (merged into section tabs / dropdowns). */
  extraUiSections?: string[];
  /** KPI-level sections (collapsible grouping) this field can be assigned to. */
  sections?: KpiSection[];
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
      section_id: field.section_id ?? undefined,
      carry_forward_data: field.carry_forward_data ?? false,
      full_page_multi_items: field.full_page_multi_items ?? false,
      multi_items_api_endpoint_url: (field.config as any)?.multi_items_api_endpoint_url ?? "",
    },
  });
  const currentFieldType = watch("field_type");
  const [activeEditSubSection, setActiveEditSubSection] = useState<string>("Other");
  const [multiLineSettingsOpen, setMultiLineSettingsOpen] = useState<boolean>(true);

  const editSubSections = useMemo(() => {
    return mergeUiSectionLabelsForMultiField(editSubFields, extraUiSections);
  }, [editSubFields, extraUiSections]);

  useEffect(() => {
    if (!editSubSections.includes(activeEditSubSection)) {
      setActiveEditSubSection(editSubSections[0] || "Other");
    }
  }, [editSubSections, activeEditSubSection]);

  useEffect(() => {
    if (currentFieldType !== "multi_line_items") return;
    // If the current active section disappears, fall back to first.
    if (!editSubSections.includes(activeEditSubSection)) {
      setActiveEditSubSection(editSubSections[0] || "Other");
    }
  }, [currentFieldType, editSubSections, activeEditSubSection]);

  return (
    <form
      onSubmit={handleSubmit((data) =>
        onSave(
          data,
          currentFieldType === "multi_line_items"
            ? editSubFields.map(({ keyTouched: _, ...s }) => s)
            : undefined,
          currentFieldType === "reference" || currentFieldType === "multi_reference" ? editRefConfig : undefined
        )
      )}
      style={{ width: "100%" }}
    >
      {(currentFieldType !== "multi_line_items" || multiLineSettingsOpen) && (
        <>
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
            {currentFieldType === "multi_line_items" && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: "1 1 320px", minWidth: 260 }}>
                <label style={{ fontSize: "0.9rem", whiteSpace: "nowrap" }}>API URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/multi-items-api"
                  {...register("multi_items_api_endpoint_url")}
                  style={{ flex: 1, minWidth: 220, padding: "0.35rem 0.5rem" }}
                />
              </div>
            )}
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
            {currentFieldType === "multi_line_items" && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <label style={{ fontSize: "0.9rem", whiteSpace: "nowrap" }}>Section</label>
                <select {...register("section_id")} style={{ padding: "0.35rem 0.5rem" }}>
                  {(sections ?? []).length === 0 && <option value="">General (default)</option>}
                  {(sections ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </>
      )}
      {(currentFieldType === "reference" || currentFieldType === "multi_reference") && (
        <div className="form-group">
          <label>Reference source</label>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 0" }}>
            {currentFieldType === "multi_reference"
              ? "Users may pick multiple values; each must appear in the distinct values from the selected KPI field."
              : "Values for this field will be restricted to distinct values from the selected KPI field."}
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
            fields={list.filter((f) => f.id !== field.id)}
            organizationId={organizationId}
            currentKpiId={currentKpiId}
          />
        </div>
      )}
      {currentFieldType === "multi_line_items" && (
        <div className="form-group">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.25rem 0 0.75rem" }}>
            <button
              type="button"
              className={activeEditSubSection === (editSubSections[0] || "Other") ? "btn btn-primary" : "btn"}
              onClick={() => setActiveEditSubSection(editSubSections[0] || "Other")}
              style={{ borderRadius: 999, padding: "0.35rem 0.65rem", fontSize: "0.9rem" }}
            >
              {editSubSections[0] || "Other"}
            </button>
            {editSubSections.slice(1).map((sec) => {
              const isActive = activeEditSubSection === sec;
              return (
                <button
                  key={sec}
                  type="button"
                  className={isActive ? "btn btn-primary" : "btn"}
                  onClick={() => setActiveEditSubSection(sec)}
                  style={{ borderRadius: 999, padding: "0.35rem 0.65rem", fontSize: "0.9rem" }}
                >
                  {sec}
                </button>
              );
            })}
          </div>

          <div style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.5rem 0" }}>
            Sub-fields (columns) for UI section: <strong>{activeEditSubSection}</strong>
          </div>
          <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Key</th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Reference source (reference / multi reference)</th>
                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Section (UI)</th>
                  <th style={{ textAlign: "center", padding: "0.5rem", borderBottom: "2px solid var(--border)", fontWeight: 600 }}>Required</th>
                  <th style={{ width: "80px", padding: "0.5rem", borderBottom: "2px solid var(--border)" }} />
                </tr>
              </thead>
              <tbody>
                {editSubFields
                  .map((s, idx) => ({ s, idx }))
                  .filter(({ s }) => {
                    const sec = s.config && typeof s.config === "object" && "ui_section" in s.config ? String((s.config as any).ui_section ?? "").trim() : "";
                    const label = sec || "Other";
                    return label === activeEditSubSection;
                  }).length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: "0.75rem", color: "var(--muted)", fontSize: "0.9rem", textAlign: "center" }}>
                      No sub-fields in this section yet. Click &quot;Add sub-field&quot; below.
                    </td>
                  </tr>
                ) : (
                  editSubFields
                    .map((s, idx) => ({ s, idx }))
                    .filter(({ s }) => {
                      const sec = s.config && typeof s.config === "object" && "ui_section" in s.config ? String((s.config as any).ui_section ?? "").trim() : "";
                      const label = sec || "Other";
                      return label === activeEditSubSection;
                    })
                    .map(({ s, idx }) => (
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
                          {s.field_type === "reference" || s.field_type === "multi_reference" ? (
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
                    ))
                )}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              setEditSubFields((prev) => [
                ...prev,
                { name: "", key: "", field_type: "single_line_text", is_required: false, sort_order: prev.length, config: { ui_section: activeEditSubSection }, keyTouched: false },
              ])
            }
          >
            Add sub-field
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
