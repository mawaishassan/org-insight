"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
import {
  coerceScalarValueTextFromApi,
  getAttachmentDisplayName,
  getAttachmentUrl,
  makeAttachmentCellValue,
  parseScalarAttachmentValueText,
  stringifyScalarAttachment,
} from "@/lib/attachmentCellValue";
import { AttachmentFieldControl } from "@/components/AttachmentFieldControl";
import MultiReferenceInput from "@/components/MultiReferenceInput";

interface ReferenceConfig {
  reference_source_kpi_id?: number;
  reference_source_field_key?: string;
  reference_source_sub_field_key?: string;
}

interface SubFieldDef {
  id: number;
  field_id: number;
  name: string;
  key: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
  config?: ReferenceConfig | null;
  can_view?: boolean;
  can_edit?: boolean;
}

interface FieldDef {
  id: number;
  key: string;
  name: string;
  field_type: string;
  is_required: boolean;
  formula_expression?: string | null;
  config?: ReferenceConfig | null;
  sub_fields?: SubFieldDef[];
  /** When field-level access is used: true if user can view this field (API may omit fields without access). */
  can_view?: boolean;
  /** When field-level access is used: true if user can edit this field. */
  can_edit?: boolean;
  /** Multi-line only: when true, row-level user access is enforced; when false, all rows follow role/field access. */
  row_level_user_access_enabled?: boolean;
}

interface FieldValueResp {
  field_id: number;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown;
  value_boolean: boolean | null;
  value_date: string | null;
}

interface EntryRow {
  id: number;
  kpi_id: number;
  organization_id: number;
  user_id: number | null;
  year: number;
  period_key?: string;
  is_draft: boolean;
  is_locked: boolean;
  submitted_at: string | null;
  values: FieldValueResp[];
  entered_by_user_name?: string | null;
  updated_at?: string | null;
}

interface OverviewItem {
  kpi_id: number;
  kpi_name: string;
  assigned_user_names?: string[];
  entry: {
    id: number;
    last_updated_at?: string | null;
    entered_by_user_name?: string | null;
  } | null;
}

interface UserRef {
  id: number;
  username: string;
  full_name: string | null;
  permission?: string;
}

interface KpiFileItem {
  id: number;
  original_filename: string;
  size: number;
  content_type: string | null;
  created_at: string;
  download_url: string | null;
}

interface FullRowAccessUser {
  user_id: number;
  full_name: string | null;
  username: string;
  mode: "view" | "edit" | "edit_delete";
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

const FORMULA_BOX_COLORS = [
  "var(--primary)",
  "var(--success)",
  "var(--accent)",
  "var(--warning)",
];

const PERIOD_LABELS: Record<string, string> = {
  "": "Full year", H1: "H1", H2: "H2",
  Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4",
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

function expectedPeriods(dimension: string): string[] {
  if (!dimension || dimension === "yearly") return [""];
  if (dimension === "half_yearly") return ["H1", "H2"];
  if (dimension === "quarterly") return ["Q1", "Q2", "Q3", "Q4"];
  if (dimension === "monthly") return Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  return [""];
}

function formatValue(f: FieldDef, v: FieldValueResp | undefined): string {
  if (!v) return "—";
  if (f.field_type === "multi_reference" && Array.isArray(v.value_json)) {
    return (v.value_json as string[]).join(", ") || "—";
  }
  if (f.field_type === "attachment" && v.value_text != null) {
    const p = parseScalarAttachmentValueText(v.value_text);
    if (p.url) return p.filename?.trim() || "Attached file";
  }
  if (v.value_text != null) return String(v.value_text);
  if (v.value_number != null) return String(v.value_number);
  if (v.value_boolean != null) return v.value_boolean ? "Yes" : "No";
  if (v.value_date) return String(v.value_date).slice(0, 10);
  if (f.field_type === "multi_line_items" && Array.isArray(v.value_json)) return `${v.value_json.length} row(s)`;
  if (v.value_json != null) return String(v.value_json).slice(0, 50);
  return "—";
}

export default function DomainKpiDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const domainId = params.id != null ? Number(params.id) : undefined;
  const isEntriesRoute = domainId === undefined;
  const kpiId = Number(params.kpiId);
  const yearParam = isEntriesRoute ? (params.year as string) : searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  const orgIdParam = searchParams.get("organization_id");
  const organizationIdFromUrl = orgIdParam ? Number(orgIdParam) : undefined;
  const periodKeyFromUrl = searchParams.get("period_key") ?? "";

  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [meId, setMeId] = useState<number | null>(null);
  const [kpiName, setKpiName] = useState<string>("");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [overviewItem, setOverviewItem] = useState<OverviewItem | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<UserRef[]>([]);
  const [orgUsers, setOrgUsers] = useState<UserRef[]>([]);
  const [kpiApiInfo, setKpiApiInfo] = useState<{ entry_mode?: string; api_endpoint_url?: string | null; can_edit?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"scalar" | "security" | number>("scalar");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  /** When editing: list of { user_id, permission } for PUT assignments (legacy user assignments) */
  const [editAssignments, setEditAssignments] = useState<{ user_id: number; permission: string }[]>([]);
  /** Role assignments at KPI level (from GET assignments-by-role). */
  const [assignedRoles, setAssignedRoles] = useState<Array<{ id: number; name: string; description?: string | null; permission: string }>>([]);
  /** When editing: list of { role_id, permission } for PUT assignments-by-role. */
  const [editRoleAssignments, setEditRoleAssignments] = useState<{ role_id: number; permission: string }[]>([]);
  /** Saving flag for KPI-level role assignments when edited inline. */
  const [savingRoleAssignments, setSavingRoleAssignments] = useState(false);
  const [uploadingFieldId, setUploadingFieldId] = useState<number | null>(null);
  const [uploadOption, setUploadOption] = useState<"append" | "override" | "upsert" | null>(null);
  const [upsertMatchKeyByFieldId, setUpsertMatchKeyByFieldId] = useState<Record<number, string>>({});
  const [syncOption, setSyncOption] = useState<"append" | "override" | "upsert" | null>(null);
  /** KPI-level API sync upsert: parent field key -> sub_field key */
  const [kpiSyncUpsertByFieldKey, setKpiSyncUpsertByFieldKey] = useState<Record<string, string>>({});
  const [fetchingFromApi, setFetchingFromApi] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [bulkMethod, setBulkMethod] = useState<"upload" | "api">("upload");
  const [bulkUploadError, setBulkUploadError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [importExcelLoading, setImportExcelLoading] = useState(false);
  /** Bulk upload section is hidden until user clicks the "Bulk upload" link (per multi_line field) */
  const [bulkExpandedByFieldId, setBulkExpandedByFieldId] = useState<Record<number, boolean>>({});
  /** KPI file attachments */
  const [kpiFiles, setKpiFiles] = useState<KpiFileItem[]>([]);
  const [kpiFilesUploading, setKpiFilesUploading] = useState(false);
  const [kpiFilesError, setKpiFilesError] = useState<string | null>(null);
  /** Entries route: time dimension and all entries for period bar */
  const [kpiTimeDimension, setKpiTimeDimension] = useState<string | null>(null);
  const [orgTimeDimension, setOrgTimeDimension] = useState<string | null>(null);
  const [allEntriesForPeriodBar, setAllEntriesForPeriodBar] = useState<EntryRow[]>([]);
  /** Reference allowed values: key = `${sourceKpiId}-${sourceFieldKey}` */
  const [refAllowedValues, setRefAllowedValues] = useState<Record<string, string[]>>({});
  /** Reverse references: child KPIs that reference this KPI via multi_line_items reference sub-fields */
  const [reverseRefTabs, setReverseRefTabs] = useState<
    Array<{
      child_kpi_id: number;
      child_kpi_name: string;
      values: Array<{ token: string; label: string; count: number }>;
      rows: Array<{
        entry_id: number;
        year: number;
        period_key: string;
        value_token: string;
        value_display: string;
        child_field_id: number;
        child_field_key: string;
        child_field_name: string;
        child_sub_field_key: string;
        child_sub_field_name: string;
        row_index: number;
        row: Record<string, unknown>;
      }>;
      sub_fields: Array<{ key: string; name: string }>;
    }>
  >([]);
  const [reverseRefActiveKpiId, setReverseRefActiveKpiId] = useState<number | null>(null);
  const [reverseRefSelectedTokenByKpi, setReverseRefSelectedTokenByKpi] = useState<Record<number, string>>({});
  const [reverseRefTimeFilter, setReverseRefTimeFilter] = useState<{ year: number; period_key: string; effective_time_dimension: string } | null>(null);
  /** When set, show field-level rights modal for this user (org admin only). */
  const [fieldRightsModalUserId, setFieldRightsModalUserId] = useState<number | null>(null);
  /** Field-level access rows for the modal: list we edit and save. */
  const [fieldRightsAccessList, setFieldRightsAccessList] = useState<Array<{ field_id: number; sub_field_id: number | null; access_type: string }>>([]);
  const [fieldRightsLoading, setFieldRightsLoading] = useState(false);
  const [fieldRightsSaving, setFieldRightsSaving] = useState(false);
  /** For super admin without org in URL: org resolved from KPI by id so data loads and save works. */
  const [kpiOrgId, setKpiOrgId] = useState<number | null>(null);
  /** Column (subfield) access panel: which multi-line field is expanded (org admin only). */
  const [columnAccessFieldId, setColumnAccessFieldId] = useState<number | null>(null);
  /** When set, we're updating row_level_user_access_enabled for this multi-line field (PATCH). */
  const [rowLevelAccessUpdatingFieldId, setRowLevelAccessUpdatingFieldId] = useState<number | null>(null);
  /** Security tab: full-row access management (per field + entry). */
  const [rowAccessEntryIdByField, setRowAccessEntryIdByField] = useState<Record<number, number | "">>({});
  const [fullRowAccessByField, setFullRowAccessByField] = useState<Record<number, FullRowAccessUser[]>>({});
  const [fullRowAccessLoadingFieldId, setFullRowAccessLoadingFieldId] = useState<number | null>(null);
  const [fullRowAccessSavingFieldId, setFullRowAccessSavingFieldId] = useState<number | null>(null);
  const [fullRowAccessAddUserIdByField, setFullRowAccessAddUserIdByField] = useState<Record<number, number | "">>({});
  const [fullRowAccessAddModeByField, setFullRowAccessAddModeByField] = useState<Record<number, "view" | "edit" | "edit_delete">>({});
  /** Security tab: add-row permission management (per multi-line field). */
  const [addRowUsersByField, setAddRowUsersByField] = useState<Record<number, Array<{ id: number; username: string; full_name: string | null }>>>({});
  const [addRowLoadingFieldId, setAddRowLoadingFieldId] = useState<number | null>(null);
  const [addRowSavingFieldId, setAddRowSavingFieldId] = useState<number | null>(null);
  const [addRowAddUserIdByField, setAddRowAddUserIdByField] = useState<Record<number, number | "">>({});
  /** Loaded field access per user for the column-access panel. Key = userId. */
  const [columnAccessByUser, setColumnAccessByUser] = useState<Record<number, Array<{ field_id: number; sub_field_id: number | null; access_type: string }>>>({});
  const [columnAccessLoading, setColumnAccessLoading] = useState(false);
  const [columnAccessSavingUserId, setColumnAccessSavingUserId] = useState<number | null>(null);
  /** Role-based column access: org roles and per-role field access (used on entry page instead of user-based). */
  const [orgRoles, setOrgRoles] = useState<Array<{ id: number; name: string; description: string | null }>>([]);
  const [columnAccessByRole, setColumnAccessByRole] = useState<Record<number, Array<{ field_id: number; sub_field_id: number | null; access_type: string }>>>({});
  const [columnAccessByRoleLoading, setColumnAccessByRoleLoading] = useState(false);
  const [columnAccessByRoleSavingRoleId, setColumnAccessByRoleSavingRoleId] = useState<number | null>(null);
  /** Scalar field access popup state: which field is being edited, search text, selected role and permission. */
  const [scalarAccessTargetFieldId, setScalarAccessTargetFieldId] = useState<number | null>(null);
  const [scalarAccessSearch, setScalarAccessSearch] = useState<string>("");
  const [scalarAccessRoleId, setScalarAccessRoleId] = useState<number | null>(null);
  const [scalarAccessPermission, setScalarAccessPermission] = useState<"view" | "data_entry">("data_entry");
  /** UI state: when set, show Add-role controls for this (field_id, sub_field_id) in column access table. */
  const [columnAccessAddTarget, setColumnAccessAddTarget] = useState<{ fieldId: number; subFieldId: number } | null>(null);
  const [columnAccessAddRoleId, setColumnAccessAddRoleId] = useState<number | null>(null);
  const [columnAccessAddPermission, setColumnAccessAddPermission] = useState<"view" | "data_entry">("data_entry");

  type FormCell = {
    value_text?: string;
    value_number?: number;
    value_boolean?: boolean;
    value_date?: string;
    /** multi_line_items rows or multi_reference string[] */
    value_json?: Record<string, unknown>[] | string[];
  };
  const [formValues, setFormValues] = useState<Record<number, FormCell>>({});

  const token = getAccessToken();
  const effectiveOrgId = organizationIdFromUrl ?? meOrgId ?? kpiOrgId ?? entry?.organization_id ?? undefined;
  const canManageColumnAccess = (meRole === "ORG_ADMIN" || meRole === "SUPER_ADMIN") && effectiveOrgId != null;
  const canSeeSecurityTab = meRole === "ORG_ADMIN";

  const valuesByFieldId = useMemo(() => {
    const map = new Map<number, FieldValueResp>();
    (entry?.values ?? []).forEach((v) => map.set(v.field_id, v));
    return map;
  }, [entry?.values]);

  const fetchFullRowAccessUsers = useCallback(
    async (fieldId: number, entryId: number) => {
      if (!token || !kpiId || effectiveOrgId == null) return;
      setFullRowAccessLoadingFieldId(fieldId);
      try {
        const list = await api<FullRowAccessUser[]>(
          `/kpis/${kpiId}/row-access-full-users?${qs({
            entry_id: entryId,
            field_id: fieldId,
            organization_id: effectiveOrgId,
          })}`,
          { token }
        );
        setFullRowAccessByField((prev) => ({ ...prev, [fieldId]: Array.isArray(list) ? list : [] }));
      } catch {
        setFullRowAccessByField((prev) => ({ ...prev, [fieldId]: [] }));
      } finally {
        setFullRowAccessLoadingFieldId(null);
      }
    },
    [token, kpiId, effectiveOrgId]
  );

  const getRowCountForEntryField = useCallback(
    async (entryId: number, fieldId: number) => {
      if (!token || effectiveOrgId == null) return 0;
      const res = await api<{ total: number }>(
        `/entries/multi-items/rows?${qs({
          entry_id: entryId,
          field_id: fieldId,
          organization_id: effectiveOrgId,
          page: 1,
          page_size: 1,
          editable_only: "false",
        })}`,
        { token }
      ).catch(() => ({ total: 0 }));
      return Number(res?.total ?? 0) || 0;
    },
    [token, effectiveOrgId]
  );

  const grantAllRowsToUser = useCallback(
    async (fieldId: number, entryId: number, userId: number, mode: "view" | "edit" | "edit_delete") => {
      if (!token || !kpiId || effectiveOrgId == null) return;
      setFullRowAccessSavingFieldId(fieldId);
      try {
        if (mode === "view") {
          await api(`/kpis/${kpiId}/row-access/grant-view-all?${qs({ organization_id: effectiveOrgId })}`, {
            method: "POST",
            body: JSON.stringify({
              user_id: userId,
              entry_id: entryId,
              field_id: fieldId,
            }),
            token,
          });
          toast.success("Full row access granted (View)");
        } else {
          const totalRows = await getRowCountForEntryField(entryId, fieldId);
          const rows = Array.from({ length: totalRows }, (_, i) => ({
            row_index: i,
            can_edit: true,
            can_delete: mode === "edit_delete",
          }));
          await api(`/kpis/${kpiId}/row-access?${qs({ organization_id: effectiveOrgId })}`, {
            method: "PUT",
            body: JSON.stringify({
              user_id: userId,
              entry_id: entryId,
              field_id: fieldId,
              rows,
            }),
            token,
          });
          toast.success(mode === "edit_delete" ? "Full row access granted (Edit+Delete)" : "Full row access granted (Edit)");
        }
        await fetchFullRowAccessUsers(fieldId, entryId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to grant full row access");
      } finally {
        setFullRowAccessSavingFieldId(null);
      }
    },
    [token, kpiId, effectiveOrgId, getRowCountForEntryField, fetchFullRowAccessUsers]
  );

  const revokeAllRowsForUser = useCallback(
    async (fieldId: number, entryId: number, userId: number) => {
      if (!token || !kpiId || effectiveOrgId == null) return;
      setFullRowAccessSavingFieldId(fieldId);
      try {
        await api(`/kpis/${kpiId}/row-access/revoke-all?${qs({ organization_id: effectiveOrgId })}`, {
          method: "POST",
          body: JSON.stringify({
            user_id: userId,
            entry_id: entryId,
            field_id: fieldId,
          }),
          token,
        });
        toast.success("Row access removed");
        await fetchFullRowAccessUsers(fieldId, entryId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove row access");
      } finally {
        setFullRowAccessSavingFieldId(null);
      }
    },
    [token, kpiId, effectiveOrgId, fetchFullRowAccessUsers]
  );

  const fetchAddRowUsers = useCallback(
    async (fieldId: number) => {
      if (!token || !kpiId || effectiveOrgId == null) return;
      setAddRowLoadingFieldId(fieldId);
      try {
        const list = await api<Array<{ id: number; username: string; full_name: string | null }>>(
          `/kpis/${kpiId}/add-row-users?${qs({ field_id: fieldId, organization_id: effectiveOrgId })}`,
          { token }
        );
        setAddRowUsersByField((prev) => ({ ...prev, [fieldId]: Array.isArray(list) ? list : [] }));
      } catch {
        setAddRowUsersByField((prev) => ({ ...prev, [fieldId]: [] }));
      } finally {
        setAddRowLoadingFieldId(null);
      }
    },
    [token, kpiId, effectiveOrgId]
  );

  const setAddRowUsers = useCallback(
    async (fieldId: number, nextUserIds: number[]) => {
      if (!token || !kpiId || effectiveOrgId == null) return;
      setAddRowSavingFieldId(fieldId);
      try {
        await api(`/kpis/${kpiId}/add-row-users?${qs({ organization_id: effectiveOrgId })}`, {
          method: "PUT",
          body: JSON.stringify({ field_id: fieldId, user_ids: nextUserIds }),
          token,
        });
        toast.success("Add Row permission updated");
        await fetchAddRowUsers(fieldId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update Add Row permission");
      } finally {
        setAddRowSavingFieldId(null);
      }
    },
    [token, kpiId, effectiveOrgId, fetchAddRowUsers]
  );

  const formulaFields = useMemo(() => fields.filter((f) => f.field_type === "formula"), [fields]);
  const scalarFields = useMemo(
    () => fields.filter((f) => f.field_type !== "formula" && f.field_type !== "multi_line_items"),
    [fields]
  );
  const multiLineFields = useMemo(
    () => fields.filter((f) => f.field_type === "multi_line_items"),
    [fields]
  );
  const inlineMultiLineFields = useMemo(
    () =>
      multiLineFields.filter(
        (f) => !(f as any).full_page_multi_items && (f.sub_fields?.length ?? 0) > 0
      ),
    [multiLineFields]
  );
  /** Multi-line fields that use full-page view only (no inline table). Tab shows column access + link to full page. */
  const fullPageMultiLineFields = useMemo(
    () =>
      multiLineFields.filter(
        (f) => (f as any).full_page_multi_items && (f.sub_fields?.length ?? 0) > 0
      ),
    [multiLineFields]
  );
  /** Fields the user can edit (scalar only; formula is always view). When can_edit is undefined, treat as true for backward compat. */
  const scalarFieldsEdit = useMemo(
    () => scalarFields.filter((f) => f.can_edit !== false),
    [scalarFields]
  );
  /** Scalar fields the user can only view (read-only). */
  const scalarFieldsViewOnly = useMemo(
    () => scalarFields.filter((f) => f.can_edit === false && f.can_view !== false),
    [scalarFields]
  );
  const multiLineFieldsEdit = useMemo(
    () => multiLineFields.filter((f) => (f as FieldDef).can_edit !== false),
    [multiLineFields]
  );
  const multiLineFieldsViewOnly = useMemo(
    () => multiLineFields.filter((f) => (f as FieldDef).can_edit === false && (f as FieldDef).can_view !== false),
    [multiLineFields]
  );

  const formulaBoxes = useMemo(() => {
    const withValues = formulaFields.map((f) => ({
      field: f,
      value: valuesByFieldId.get(f.id)?.value_number ?? null,
    }));
    return withValues.slice(0, 4);
  }, [formulaFields, valuesByFieldId]);

  const lastUpdatedFormatted =
    (entry?.updated_at &&
      (() => {
        const d = new Date(entry.updated_at);
        return Number.isNaN(d.getTime()) ? undefined : `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en", { month: "short" })}-${d.getFullYear()}`;
      })()) ||
    (overviewItem?.entry?.last_updated_at &&
      (() => {
        const d = new Date(overviewItem.entry!.last_updated_at!);
        return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en", { month: "short" })}-${d.getFullYear()}`;
      })());

  useEffect(() => {
    if (!token) return;
    api<{ organization_id: number | null; role?: string | { value?: string } }>("/auth/me", { token })
      .then((me) => {
        setMeOrgId(me.organization_id ?? null);
        setMeId((me as any)?.id ?? null);
        const r = (me as { role?: string | { value?: string } }).role;
        setMeRole(typeof r === "string" ? r : r?.value ?? null);
      })
      .catch(() => {
        setMeOrgId(null);
        setMeRole(null);
        setMeId(null);
      });
  }, [token]);

  // Super admin without org in URL: resolve org from KPI by id so loadData and save work
  useEffect(() => {
    if (!token || !kpiId || meRole !== "SUPER_ADMIN") return;
    if (organizationIdFromUrl != null || meOrgId != null) return;
    api<{ organization_id: number }>(`/kpis/${kpiId}`, { token })
      .then((kpi) => setKpiOrgId(kpi.organization_id))
      .catch(() => setKpiOrgId(null));
  }, [token, kpiId, meRole, organizationIdFromUrl, meOrgId]);

  const loadData = async () => {
    if (!token || !kpiId || effectiveOrgId == null) return;
    setError(null);
    const fieldsQuery = `?${qs({ kpi_id: kpiId, organization_id: effectiveOrgId })}`;
    const entriesQuery = `?${qs({ kpi_id: kpiId, year, organization_id: effectiveOrgId })}`;
    const overviewQuery = `?${qs({ year, organization_id: effectiveOrgId })}`;
    const kpiQuery = `?${qs({ organization_id: effectiveOrgId })}`;
    const usersQuery = `?${qs({ organization_id: effectiveOrgId })}`;
    const apiInfoQuery = `?${qs({ kpi_id: kpiId, organization_id: effectiveOrgId })}`;
    const [
      fieldsList,
      entriesList,
      overviewList,
      kpiResp,
      assignmentsList,
      roleAssignmentsList,
      usersList,
      apiInfo,
    ] = await Promise.all([
      api<FieldDef[]>(`/entries/fields${fieldsQuery}`, { token }).catch(() => []),
      api<EntryRow[]>(`/entries${entriesQuery}`, { token }).then((list) => list).catch(() => []),
      api<OverviewItem[]>(`/entries/overview${overviewQuery}`, { token }).catch(() => []),
      api<{ name: string }>(`/kpis/${kpiId}${kpiQuery}`, { token }).catch(() => null),
      api<UserRef[]>(`/kpis/${kpiId}/assignments${kpiQuery}`, { token }).catch(() => []),
      api<Array<{ id: number; name: string; description?: string | null; permission: string }>>(`/kpis/${kpiId}/assignments-by-role${kpiQuery}`, { token }).catch(() => []),
      api<UserRef[]>(`/users${usersQuery}`, { token }).catch(() => []),
      api<{ entry_mode?: string; api_endpoint_url?: string | null; can_edit?: boolean }>(`/entries/kpi-api-info${apiInfoQuery}`, { token }).catch(() => null),
    ]);
    setFields(fieldsList);
    if (isEntriesRoute) {
      setAllEntriesForPeriodBar(entriesList);
      const pk = periodKeyFromUrl ?? "";
      const match = entriesList.find((e) => (e.period_key ?? "") === pk);
      if (match) {
        setEntry(match);
      } else if (effectiveOrgId != null) {
        // No entry for this period: get-or-create so carry-forward from previous period is shown
        try {
          const forPeriod = await api<EntryRow>(
            `/entries/for-period?${qs({ kpi_id: kpiId, year, period_key: pk, organization_id: effectiveOrgId })}`,
            { token }
          );
          setAllEntriesForPeriodBar((prev) => [...prev, forPeriod]);
          setEntry(forPeriod);
        } catch {
          setEntry(entriesList[0] ?? null);
        }
      } else {
        setEntry(entriesList[0] ?? null);
      }
    } else {
      setEntry(entriesList[0] ?? null);
    }
    setOverviewItem(overviewList.find((x) => x.kpi_id === kpiId) ?? null);
    const ov = overviewList.find((x) => x.kpi_id === kpiId);
    if (kpiResp?.name) setKpiName(kpiResp.name);
    else if (ov?.kpi_name) setKpiName(ov.kpi_name);
    else setKpiName(`KPI #${kpiId}`);
    setAssignedUsers(Array.isArray(assignmentsList) ? assignmentsList.map((u: UserRef & { permission?: string }) => ({ id: u.id, username: u.username, full_name: u.full_name ?? null, permission: u.permission || "data_entry" })) : []);
    setAssignedRoles(Array.isArray(roleAssignmentsList) ? roleAssignmentsList.map((r) => ({ ...r, permission: r.permission || "data_entry" })) : []);
    setEditRoleAssignments(Array.isArray(roleAssignmentsList) ? roleAssignmentsList.map((r) => ({ role_id: r.id, permission: r.permission || "data_entry" })) : []);
    setOrgUsers(Array.isArray(usersList) ? usersList : []);
    setKpiApiInfo(apiInfo ?? null);
    api<KpiFileItem[]>(`/kpis/${kpiId}/files?${qs({ year })}`, { token })
      .then(setKpiFiles)
      .catch(() => setKpiFiles([]));

    if (isEntriesRoute && effectiveOrgId != null) {
      api<{ time_dimension: string }>(`/organizations/${effectiveOrgId}/time-dimension`, { token })
        .then((r) => setOrgTimeDimension(r.time_dimension ?? null))
        .catch(() => setOrgTimeDimension(null));
      api<{ time_dimension?: string | null }>(`/kpis/${kpiId}?${kpiQuery}`, { token })
        .then((k) => setKpiTimeDimension(k.time_dimension ?? null))
        .catch(() => setKpiTimeDimension(null));
    }
  };

  useEffect(() => {
    if (!token || !kpiId || effectiveOrgId == null) return;
    setError(null);
    loadData().catch((e) => setError(e instanceof Error ? e.message : "Failed to load")).finally(() => setLoading(false));
  }, [token, kpiId, year, effectiveOrgId, periodKeyFromUrl, isEntriesRoute]);

  // Load field-level access when field-rights modal opens
  useEffect(() => {
    if (!token || !kpiId || effectiveOrgId == null || fieldRightsModalUserId == null) return;
    setFieldRightsLoading(true);
    const kpiPermission = editAssignments.find((a) => a.user_id === fieldRightsModalUserId)?.permission || "data_entry";
    api<Array<{ field_id: number; sub_field_id: number | null; access_type: string }>>(
      `/kpis/${kpiId}/field-access?${qs({ user_id: fieldRightsModalUserId, organization_id: effectiveOrgId })}`,
      { token }
    )
      .then((list) => {
        if (list && list.length > 0) {
          setFieldRightsAccessList(list);
        } else {
          setFieldRightsAccessList(
            fields.map((f) => ({ field_id: f.id, sub_field_id: null as number | null, access_type: kpiPermission }))
          );
        }
      })
      .catch(() => setFieldRightsAccessList(
        fields.map((f) => ({ field_id: f.id, sub_field_id: null as number | null, access_type: kpiPermission }))
      ))
      .finally(() => setFieldRightsLoading(false));
  }, [token, kpiId, effectiveOrgId, fieldRightsModalUserId]);

  // When modal is open and fields load (or we had no field-access), ensure we have rows for every field
  useEffect(() => {
    if (fieldRightsModalUserId == null || fields.length === 0 || fieldRightsLoading) return;
    const kpiPermission = editAssignments.find((a) => a.user_id === fieldRightsModalUserId)?.permission || "data_entry";
    setFieldRightsAccessList((prev) => {
      const byKey = new Map(prev.map((r) => [`${r.field_id}-${r.sub_field_id ?? ""}`, r]));
      let added = false;
      fields.forEach((f) => {
        const key = `${f.id}-`;
        if (!byKey.has(key)) {
          byKey.set(key, { field_id: f.id, sub_field_id: null, access_type: kpiPermission });
          added = true;
        }
      });
      if (!added) return prev;
      return Array.from(byKey.values()).filter((r) => fields.some((f) => f.id === r.field_id));
    });
  }, [fieldRightsModalUserId, fields, fieldRightsLoading, editAssignments]);

  // Load org roles when org admin on entry page (for role-based column access)
  useEffect(() => {
    if (!token || effectiveOrgId == null || !canManageColumnAccess) return;
    api<Array<{ id: number; name: string; description: string | null }>>(
      `/organizations/${effectiveOrgId}/roles`,
      { token }
    )
      .then((list) => setOrgRoles(Array.isArray(list) ? list : []))
      .catch(() => setOrgRoles([]));
  }, [token, effectiveOrgId, canManageColumnAccess]);

  // Prevent non-org-admins from landing on Security tab
  useEffect(() => {
    if (activeTab === "security" && !canSeeSecurityTab) {
      setActiveTab("scalar");
    }
  }, [activeTab, canSeeSecurityTab]);

  // When Security tab opens (and fields are loaded), pre-load Add Row users for multi-line fields
  useEffect(() => {
    if (activeTab !== "security") return;
    if (!token || !kpiId || effectiveOrgId == null) return;
    if (!canManageColumnAccess) return;
    if (!fields || fields.length === 0) return;
    (fields.filter((f) => (f as any).field_type === "multi_line_items") as any[]).forEach((f) => {
      const fid = Number(f.id);
      if (!Number.isFinite(fid) || fid <= 0) return;
      if (addRowUsersByField[fid] == null) {
        fetchAddRowUsers(fid);
      }
    });
  }, [activeTab, token, kpiId, effectiveOrgId, canManageColumnAccess, fields, addRowUsersByField, fetchAddRowUsers]);

  // Load field access by role when scalar or security tab active, or when a multi-line column panel is expanded (org admin)
  useEffect(() => {
    const shouldLoad =
      canManageColumnAccess &&
      (columnAccessFieldId != null || activeTab === "scalar" || activeTab === "security");
    if (!token || !kpiId || effectiveOrgId == null || !shouldLoad) {
      if (!shouldLoad) setColumnAccessByRole({});
      return;
    }
    if (orgRoles.length === 0) {
      setColumnAccessByRole({});
      return;
    }
    setColumnAccessByRoleLoading(true);
    const orgId = effectiveOrgId;
    Promise.all(
      orgRoles.map((role) =>
        api<Array<{ field_id: number; sub_field_id: number | null; access_type: string }>>(
          `/kpis/${kpiId}/field-access-by-role?${qs({ role_id: role.id, organization_id: orgId })}`,
          { token }
        ).then((list) => ({ roleId: role.id, list: list ?? [] }))
      )
    )
      .then((results) => {
        const byRole: Record<number, Array<{ field_id: number; sub_field_id: number | null; access_type: string }>> = {};
        results.forEach(({ roleId, list }) => { byRole[roleId] = list; });
        setColumnAccessByRole(byRole);
      })
      .catch(() => setColumnAccessByRole({}))
      .finally(() => setColumnAccessByRoleLoading(false));
  }, [token, kpiId, effectiveOrgId, columnAccessFieldId, activeTab, canManageColumnAccess, orgRoles]);

  // Load reverse-reference info (child KPIs that reference this KPI via multi_line_items reference sub-fields)
  useEffect(() => {
    if (!token || !entry?.id || effectiveOrgId == null) {
      setReverseRefTabs([]);
      setReverseRefActiveKpiId(null);
      setReverseRefSelectedTokenByKpi({});
      setReverseRefTimeFilter(null);
      return;
    }
    api<
      {
        time_filter: { year: number; period_key: string; effective_time_dimension: string };
        tabs: Array<{
          child_kpi_id: number;
          child_kpi_name: string;
          values: Array<{ token: string; label: string; count: number }>;
          rows: Array<{
            entry_id: number;
            year: number;
            period_key: string;
            value_token: string;
            value_display: string;
            child_field_id: number;
            child_field_key: string;
            child_field_name: string;
            child_sub_field_key: string;
            child_sub_field_name: string;
            row_index: number;
            row: Record<string, unknown>;
          }>;
          sub_fields: Array<{ key: string; name: string }>;
        }>;
      }
    >(`/entries/reverse-references?${qs({ kpi_id: kpiId, entry_id: entry.id, organization_id: effectiveOrgId })}`, { token })
      .then((res) => {
        const tabs = res?.tabs ?? [];
        setReverseRefTimeFilter(res?.time_filter ?? null);
        setReverseRefTabs(tabs);
        if (tabs.length > 0) {
          setReverseRefActiveKpiId((prev) => prev && tabs.some((t) => t.child_kpi_id === prev) ? prev : tabs[0].child_kpi_id);
          const initialSelected: Record<number, string> = {};
          tabs.forEach((t) => {
            if (t.values.length > 0) initialSelected[t.child_kpi_id] = t.values[0].token;
          });
          setReverseRefSelectedTokenByKpi(initialSelected);
        } else {
          setReverseRefActiveKpiId(null);
          setReverseRefSelectedTokenByKpi({});
        }
      })
      .catch(() => {
        setReverseRefTabs([]);
        setReverseRefActiveKpiId(null);
        setReverseRefSelectedTokenByKpi({});
        setReverseRefTimeFilter(null);
      });
  }, [token, kpiId, entry?.id, effectiveOrgId]);

  useEffect(() => {
    if (!token || effectiveOrgId == null || fields.length === 0) return;
    const keys: Array<{ k: string; sid: number; skey: string; subKey?: string }> = [];
    fields.forEach((f) => {
      const refLike = (ft: string) => ft === "reference" || ft === "multi_reference";
      if (refLike(f.field_type) && f.config?.reference_source_kpi_id && f.config?.reference_source_field_key) {
        keys.push({
          k: `${f.config.reference_source_kpi_id}-${f.config.reference_source_field_key}${f.config.reference_source_sub_field_key ? `-${f.config.reference_source_sub_field_key}` : ""}`,
          sid: f.config.reference_source_kpi_id,
          skey: f.config.reference_source_field_key,
          subKey: f.config.reference_source_sub_field_key,
        });
      }
      (f.sub_fields ?? []).forEach((s) => {
        if (refLike(s.field_type) && s.config?.reference_source_kpi_id && s.config?.reference_source_field_key) {
          keys.push({
            k: `${s.config.reference_source_kpi_id}-${s.config.reference_source_field_key}${s.config.reference_source_sub_field_key ? `-${s.config.reference_source_sub_field_key}` : ""}`,
            sid: s.config.reference_source_kpi_id,
            skey: s.config.reference_source_field_key,
            subKey: s.config.reference_source_sub_field_key,
          });
        }
      });
    });
    const uniq = Array.from(new Map(keys.map((x) => [x.k, x])).values());
    uniq.forEach(({ k, sid, skey, subKey }) => {
      const params = new URLSearchParams({ source_kpi_id: String(sid), source_field_key: skey, organization_id: String(effectiveOrgId) });
      if (subKey) params.set("source_sub_field_key", subKey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params}`, { token })
        .then((r) => setRefAllowedValues((prev) => ({ ...prev, [k]: r.values })))
        .catch(() => setRefAllowedValues((prev) => ({ ...prev, [k]: [] })));
    });
  }, [token, effectiveOrgId, fields]);

  const buildFormValuesFromEntry = (e: EntryRow | null): Record<number, FormCell> => {
    const out: Record<number, FormCell> = {};
    const valueMap = new Map((e?.values ?? []).map((v) => [v.field_id, v]));
    fields.forEach((f) => {
      if (f.field_type === "formula") return;
      const v = valueMap.get(f.id);
      if (f.field_type === "multi_line_items") {
        out[f.id] = { value_json: Array.isArray(v?.value_json) ? (v!.value_json as Record<string, unknown>[]) : [] };
      } else if (f.field_type === "multi_reference") {
        out[f.id] = { value_json: Array.isArray(v?.value_json) ? (v!.value_json as string[]) : [] };
      } else {
        out[f.id] = {};
        if (v?.value_text != null) {
          if (f.field_type === "attachment") {
            const coerced = coerceScalarValueTextFromApi(v.value_text);
            if (coerced != null) out[f.id].value_text = coerced;
          } else {
            out[f.id].value_text = v.value_text;
          }
        }
        if (v?.value_number != null) out[f.id].value_number = v.value_number;
        if (v?.value_boolean != null) out[f.id].value_boolean = v.value_boolean;
        if (v?.value_date) out[f.id].value_date = String(v.value_date).slice(0, 10);
      }
    });
    return out;
  };

  const startEditing = () => {
    setFormValues(buildFormValuesFromEntry(entry));
    setEditAssignments(assignedUsers.map((u) => ({ user_id: u.id, permission: u.permission || "data_entry" })));
    setIsEditing(true);
    setEditRoleAssignments(assignedRoles.map((r) => ({ role_id: r.id, permission: r.permission || "data_entry" })));
    setSaveError(null);
  };

  const saveRoleAssignments = async (next: { role_id: number; permission: string }[]) => {
    if (!token || effectiveOrgId == null || !kpiId) return;
    setSavingRoleAssignments(true);
    try {
      const saveQuery = qs({ organization_id: effectiveOrgId });
      await api(`/kpis/${kpiId}/assignments-by-role?${saveQuery}`, {
        method: "PUT",
        body: JSON.stringify({
          assignments: next.map((a) => ({
            role_id: a.role_id,
            permission: a.permission || "data_entry",
          })),
        }),
        token,
      });
      // Keep local assignedRoles in sync for view mode
      setAssignedRoles(
        next.map((a) => {
          const role = orgRoles.find((r) => r.id === a.role_id);
          return {
            id: a.role_id,
            name: role?.name ?? `Role #${a.role_id}`,
            description: role?.description ?? null,
            permission: a.permission || "data_entry",
          };
        }),
      );
      toast.success("KPI role assignments updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update KPI roles");
    } finally {
      setSavingRoleAssignments(false);
    }
  };

  const updateRoleAssignments = (
    updater: (prev: { role_id: number; permission: string }[]) => {
      role_id: number;
      permission: string;
    }[],
  ) => {
    setEditRoleAssignments((prev) => {
      const next = updater(prev);
      void saveRoleAssignments(next);
      return next;
    });
  };

  const updateField = (
    fieldId: number,
    key: keyof FormCell,
    value: string | number | boolean | Record<string, unknown>[] | string[] | undefined
  ) => {
    setFormValues((prev) => ({ ...prev, [fieldId]: { ...prev[fieldId], [key]: value } }));
  };

  const saveEntryWithFormValues = async (
    fv: Record<number, FormCell>,
    options?: { silent?: boolean; keepEditing?: boolean },
  ) => {
    const silent = options?.silent ?? false;
    const keepEditing = options?.keepEditing ?? false;
    if (!token || effectiveOrgId == null) return;
    if (!silent) setSaveError(null);
    if (!silent) setSaving(true);
    try {
      const values = fields
        .filter((f) => f.field_type !== "formula" && (f.can_edit !== false))
        .map((f) => {
          const v = fv[f.id] ?? {};
          const payload: {
            field_id: number;
            value_text?: string | null;
            value_number?: number | null;
            value_boolean?: boolean | null;
            value_date?: string | null;
            value_json?: Record<string, unknown>[] | string[] | null;
          } = {
            field_id: f.id,
            value_text: v.value_text ?? null,
            value_number: typeof v.value_number === "number" ? v.value_number : null,
            value_boolean: v.value_boolean ?? null,
            value_date: v.value_date || null,
          };
          if (f.field_type === "multi_line_items" && Array.isArray(v.value_json)) payload.value_json = v.value_json as Record<string, unknown>[];
          if (f.field_type === "multi_reference") {
            payload.value_text = null;
            payload.value_json = Array.isArray(v.value_json) ? (v.value_json as string[]) : [];
          }
          return payload;
        });
      const saveQuery = `?${qs({ organization_id: effectiveOrgId })}`;
      const body: { kpi_id: number; year: number; is_draft: boolean; values: unknown[]; period_key?: string } = {
        kpi_id: kpiId,
        year,
        is_draft: entry?.is_draft ?? true,
        values,
      };
      if (isEntriesRoute && (periodKeyFromUrl ?? "") !== "") body.period_key = periodKeyFromUrl!.trim().slice(0, 8);
      const updated = await api<EntryRow>(`/entries${saveQuery}`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
      });
      setEntry(updated);
      const isOrgAdmin = meRole === "ORG_ADMIN";
      if (isOrgAdmin && !silent) {
        await api(`/kpis/${kpiId}/assignments?${saveQuery}`, {
          method: "PUT",
          body: JSON.stringify({ assignments: editAssignments.map((a) => ({ user_id: a.user_id, permission: a.permission || "data_entry" })) }),
          token,
        });
        await api(`/kpis/${kpiId}/assignments-by-role?${saveQuery}`, {
          method: "PUT",
          body: JSON.stringify({ assignments: editRoleAssignments.map((a) => ({ role_id: a.role_id, permission: a.permission || "data_entry" })) }),
          token,
        });
      }
      await loadData();
      if (!silent) {
        if (!keepEditing) setIsEditing(false);
        toast.success("Entry saved successfully");
      }
    } catch (err) {
      const errWithList = err as Error & { errors?: Array<{ field_key?: string; sub_field_key?: string; row_index?: number; value?: string; message?: string }> };
      if (silent) {
        toast.error(err instanceof Error ? err.message : "Could not save attachment");
      } else {
        if (Array.isArray(errWithList.errors) && errWithList.errors.length > 0) {
          const lines = errWithList.errors.map((e) => {
            const loc = e.sub_field_key != null ? `Field "${e.field_key}", row ${(e.row_index ?? 0) + 1}, "${e.sub_field_key}"` : `Field "${e.field_key}"`;
            return `${loc}: value "${e.value ?? ""}" ${e.message ?? "not allowed"}`;
          });
          setSaveError(`Validation failed:\n${lines.join("\n")}`);
        } else {
          setSaveError(err instanceof Error ? err.message : "Save failed");
        }
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
      throw err;
    } finally {
      if (!silent) setSaving(false);
    }
  };

  const handleSave = async () => {
    await saveEntryWithFormValues(formValues, { silent: false, keepEditing: false });
  };

  /** Persist scalar attachment `value_text` immediately (upload, KPI file pick, etc.). */
  const persistScalarAttachmentThenSave = (fieldId: number, nextText: string, successMsg = "Saved.") => {
    setFormValues((prev) => {
      const merged = { ...prev, [fieldId]: { ...(prev[fieldId] ?? {}), value_text: nextText } };
      void saveEntryWithFormValues(merged, { silent: true, keepEditing: true })
        .then(() => toast.success(successMsg))
        .catch(() => undefined);
      return merged;
    });
  };

  const handleSubmitEntry = async () => {
    if (!token || !entry?.id || effectiveOrgId == null) return;
    setSaveError(null);
    setSubmitLoading(true);
    try {
      const submitQuery = `?${qs({ organization_id: effectiveOrgId })}`;
      const updated = await api<EntryRow>(`/entries/submit${submitQuery}`, {
        method: "POST",
        body: JSON.stringify({ entry_id: entry.id }),
        token,
      });
      setEntry(updated);
      await loadData();
      toast.success("Entry submitted successfully");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Submit failed");
      toast.error(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const canEditKpi = kpiApiInfo?.can_edit !== false;
  const dataEntryAssignees = useMemo(
    () => assignedUsers.filter((u) => (u.permission || "data_entry") === "data_entry"),
    [assignedUsers]
  );
  const viewOnlyAssignees = useMemo(
    () => assignedUsers.filter((u) => u.permission === "view"),
    [assignedUsers]
  );
  const dataEntryRoles = useMemo(
    () => assignedRoles.filter((r) => (r.permission || "data_entry") === "data_entry"),
    [assignedRoles]
  );
  const viewOnlyRoles = useMemo(
    () => assignedRoles.filter((r) => r.permission === "view"),
    [assignedRoles]
  );
  const assignedNames = useMemo(
    () => dataEntryAssignees.map((u) => (u.full_name || u.username || "").trim() || u.username),
    [dataEntryAssignees]
  );
  const totalFields = fields.length;
  const isLocked = entry?.is_locked ?? false;
  const isApiKpi = kpiApiInfo?.entry_mode === "api" && kpiApiInfo?.api_endpoint_url && effectiveOrgId != null;

  const expectedPeriodsList = kpiTimeDimension ? expectedPeriods(kpiTimeDimension) : [""];
  const hasSubPeriods = expectedPeriodsList.length > 1;
  const requirePeriodSelection = isEntriesRoute && hasSubPeriods && (periodKeyFromUrl ?? "") === "";
  const currentPeriodKey = (periodKeyFromUrl ?? "").trim();
  const currentPeriodLabel = currentPeriodKey !== "" ? (PERIOD_LABELS[currentPeriodKey] ?? currentPeriodKey) : (hasSubPeriods ? "Full year" : null);
  const timeDimensionLabel = currentPeriodLabel != null ? currentPeriodLabel : null;
  const formatDate = (s: string | null | undefined) => {
    if (!s) return "—";
    try {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return s;
    }
  };

  const periodBar = isEntriesRoute && hasSubPeriods && expectedPeriodsList.length > 0 ? (
    <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
      <span style={{ fontSize: "0.9rem", color: "var(--muted)", marginRight: "0.5rem" }}>Period:</span>
      {expectedPeriodsList.map((pk) => {
        const ent = allEntriesForPeriodBar.find((e) => (e.period_key ?? "") === pk);
        const isSubmitted = ent && !ent.is_draft && ent.submitted_at;
        const isDraft = ent?.is_draft ?? false;
        const isActive = (periodKeyFromUrl ?? "") === pk;
        const periodLabel = (PERIOD_LABELS[pk] ?? pk) || "Full year";
        const href = `/dashboard/entries/${kpiId}/${year}?${qs({
          ...(effectiveOrgId != null ? { organization_id: effectiveOrgId } : {}),
          period_key: pk,
        })}`;
        return (
          <Link
            key={pk || "full"}
            href={href}
            style={{
              padding: "0.35rem 0.65rem",
              borderRadius: 6,
              fontSize: "0.9rem",
              fontWeight: 500,
              textDecoration: "none",
              border: `1px solid ${isActive ? "var(--primary)" : isSubmitted ? "var(--success)" : isDraft ? "var(--warning)" : "var(--border)"}`,
              background: isActive ? "var(--primary)" : isSubmitted ? "var(--success)" : isDraft ? "var(--warning)" : "transparent",
              color: isActive ? "var(--on-primary)" : "var(--text)",
            }}
          >
            {periodLabel}
          </Link>
        );
      })}
    </div>
  ) : null;

  if (!kpiId) return <p>Invalid KPI.</p>;
  if (loading) return <p>Loading...</p>;
  if (effectiveOrgId == null) return <p>Organization context required.</p>;

  return (
    <div>
      {bulkUploadError && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            background: "var(--error, #c00)",
            color: "var(--on-error, #fff)",
            padding: "0.75rem 1rem",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.75rem",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          <div style={{ whiteSpace: "pre-line", fontSize: "0.9rem" }}>{bulkUploadError}</div>
          <button
            type="button"
            onClick={() => setBulkUploadError(null)}
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              fontSize: "1.1rem",
              cursor: "pointer",
              padding: "0 0.25rem",
              lineHeight: 1,
            }}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}
      {saveError && <p className="form-error" style={{ marginBottom: "1rem" }}>{saveError}</p>}

      {periodBar}

      {requirePeriodSelection ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          <p style={{ margin: 0, fontSize: "1rem" }}>This KPI has sub-periods. Select a period above to view or edit the entry.</p>
        </div>
      ) : (
        <>
      {/* Section 1: Formula fields in colored boxes (max 4) */}
      {formulaBoxes.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1.5rem",
          }}
        >
          {formulaBoxes.map(({ field, value }, idx) => (
            <div
              key={field.id}
              style={{
                minWidth: 120,
                padding: "0.75rem 1rem",
                borderRadius: 8,
                background: FORMULA_BOX_COLORS[idx % FORMULA_BOX_COLORS.length],
                color: "var(--on-muted)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div style={{ fontSize: "0.75rem", opacity: 0.9, marginBottom: "0.25rem" }}>{field.name}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                {value != null ? String(value) : "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Section 2: KPI details + Edit */}
      <div className="card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "1.5rem" }}>
          <div style={{ flex: "1 1 300px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <h1 style={{ fontSize: "1.4rem", margin: 0, fontWeight: 600 }}>{kpiName}</h1>
              <span
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  padding: "0.25rem 0.6rem",
                  borderRadius: 12,
                  background: "var(--accent)",
                  color: "var(--on-muted)",
                }}
              >
                {year}
              </span>
              {timeDimensionLabel != null && (
                <span
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    padding: "0.25rem 0.6rem",
                    borderRadius: 12,
                    background: "var(--bg-subtle, #f0f0f0)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                  title={hasSubPeriods ? "Time dimension period" : undefined}
                >
                  {timeDimensionLabel}
                </span>
              )}
              {!canEditKpi && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    padding: "0.2rem 0.5rem",
                    borderRadius: 4,
                    background: "var(--border)",
                    color: "var(--muted)",
                  }}
                >
                  View only
                </span>
              )}
              {isLocked && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    padding: "0.2rem 0.5rem",
                    borderRadius: 4,
                    background: "var(--error, #c00)",
                    color: "#fff",
                  }}
                >
                  Locked
                </span>
              )}
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ padding: "0.5rem 0.75rem", background: "var(--bg-subtle, #f8f9fa)", borderRadius: 8 }}>
                <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "0.15rem" }}>Status</div>
                <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>
                  {entry ? (
                    entry.is_draft ? (
                      <span style={{ color: "var(--warning)" }}>● Draft</span>
                    ) : (
                      <span style={{ color: "var(--success)" }}>● Submitted</span>
                    )
                  ) : (
                    <span style={{ color: "var(--muted)" }}>○ No entry</span>
                  )}
                </div>
              </div>
              <div style={{ padding: "0.5rem 0.75rem", background: "var(--bg-subtle, #f8f9fa)", borderRadius: 8 }}>
                <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "0.15rem" }}>Fields</div>
                <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{totalFields}</div>
              </div>
              {lastUpdatedFormatted && (
                <div style={{ padding: "0.5rem 0.75rem", background: "var(--bg-subtle, #f8f9fa)", borderRadius: 8 }}>
                  <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "0.15rem" }}>Last updated</div>
                  <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{lastUpdatedFormatted}</div>
                </div>
              )}
              {entry && (entry.entered_by_user_name != null || entry.user_id != null) && (
                <div style={{ padding: "0.5rem 0.75rem", background: "var(--bg-subtle, #f8f9fa)", borderRadius: 8 }}>
                  <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "0.15rem" }}>Entry by</div>
                  <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{entry.entered_by_user_name ?? `User #${entry.user_id}`}</div>
                </div>
              )}
              {entry?.submitted_at && (
                <div style={{ padding: "0.5rem 0.75rem", background: "var(--bg-subtle, #f8f9fa)", borderRadius: 8 }}>
                  <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: "0.15rem" }}>Submitted at</div>
                  <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{formatDate(entry.submitted_at)}</div>
                </div>
              )}
            </div>
            {(meRole === "ORG_ADMIN" || meRole === "SUPER_ADMIN") && (assignedRoles.length > 0 || isEditing) && (
              <div style={{ fontSize: "0.85rem" }}>
                <span style={{ color: "var(--muted)", marginRight: "0.5rem" }}>Assigned roles:</span>
                {isEditing ? (
                  <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                    {editRoleAssignments.map((a) => {
                      const role = orgRoles.find((r) => r.id === a.role_id);
                      const name = role ? role.name : `Role #${a.role_id}`;
                      return (
                        <span
                          key={a.role_id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.25rem",
                            padding: "0.15rem 0.4rem",
                            background: "var(--border)",
                            borderRadius: 4,
                            fontSize: "0.8rem",
                          }}
                        >
                          {name}
                          <select
                            value={a.permission || "data_entry"}
                            onChange={(e) => {
                              const perm = e.target.value;
                              updateRoleAssignments((prev) =>
                                prev.map((x) =>
                                  x.role_id === a.role_id ? { ...x, permission: perm } : x,
                                ),
                              );
                            }}
                            style={{ padding: "0.1rem 0.2rem", fontSize: "0.75rem", border: "none", background: "transparent" }}
                          >
                            <option value="data_entry">Edit</option>
                            <option value="view">View</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              updateRoleAssignments((prev) =>
                                prev.filter((x) => x.role_id !== a.role_id),
                              )
                            }
                            style={{ padding: 0, border: "none", background: "none", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1 }}
                            aria-label="Remove"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    {orgRoles.filter((r) => !editRoleAssignments.some((a) => a.role_id === r.id)).length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) {
                            const roleId = Number(v);
                            updateRoleAssignments((prev) => [
                              ...prev,
                              { role_id: roleId, permission: "data_entry" },
                            ]);
                            e.target.value = "";
                          }
                        }}
                        style={{ padding: "0.25rem 0.4rem", fontSize: "0.8rem", border: "1px solid var(--border)", borderRadius: 4 }}
                      >
                        <option value="">+ Add role</option>
                        {orgRoles
                          .filter((r) => !editRoleAssignments.some((a) => a.role_id === r.id))
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </span>
                ) : (
                  <span>
                    {dataEntryRoles.map((r) => r.name).join(", ")}
                    {dataEntryRoles.length > 0 && viewOnlyRoles.length > 0 && " • "}
                    {viewOnlyRoles.length > 0 && (
                      <span style={{ color: "var(--muted)" }}>
                        (view: {viewOnlyRoles.map((r) => r.name).join(", ")})
                      </span>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "flex-end" }}>
            {/* Primary actions */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              {isEditing ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: "0.4rem 0.75rem", fontSize: "0.9rem" }}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "0.4rem 0.75rem", fontSize: "0.9rem" }}
                    onClick={() => { setIsEditing(false); setSaveError(null); }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {!isLocked && canEditKpi && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: "0.4rem 0.75rem", fontSize: "0.9rem" }}
                      onClick={startEditing}
                    >
                      Edit
                    </button>
                  )}
                  {entry?.id && entry.is_draft && !isLocked && canEditKpi && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "0.4rem 0.75rem", fontSize: "0.9rem", background: "var(--success)", color: "var(--on-muted)" }}
                      onClick={handleSubmitEntry}
                      disabled={submitLoading}
                    >
                      {submitLoading ? "Submitting…" : "Submit entry"}
                    </button>
                  )}
                  {entry?.id && !entry.is_draft && (
                    <span
                      style={{
                        padding: "0.4rem 0.75rem",
                        borderRadius: 6,
                        background: "var(--success)",
                        color: "var(--on-muted)",
                        fontSize: "0.9rem",
                        fontWeight: 500,
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      ✓ Submitted
                    </span>
                  )}
                </>
              )}
            </div>
            {/* Data import/export actions */}
            {effectiveOrgId != null && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  paddingTop: "0.5rem",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0, fontWeight: 500 }}>
                  You are entering data for <span style={{ color: "var(--text)" }}>{timeDimensionLabel != null ? `${timeDimensionLabel} (${year})` : year}</span>.
                </p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginRight: "0.25rem" }}>Excel:</span>
                <button
                  type="button"
                  style={{
                    padding: "0.35rem 0.65rem",
                    fontSize: "0.85rem",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--surface)",
                    cursor: exportExcelLoading ? "not-allowed" : "pointer",
                    opacity: exportExcelLoading ? 0.7 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                  }}
                  disabled={exportExcelLoading}
                  onClick={async () => {
                    if (!token) return;
                    setExportExcelLoading(true);
                    try {
                      const url = getApiUrl(`/entries/export-excel?${qs({ kpi_id: kpiId, year, organization_id: effectiveOrgId, ...(periodKeyFromUrl ? { period_key: periodKeyFromUrl } : {}) })}`);
                      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                      if (!res.ok) throw new Error("Export failed");
                      const blob = await res.blob();
                      const disp = res.headers.get("Content-Disposition");
                      const match = disp?.match(/filename="?([^";]+)"?/);
                      const name = match ? match[1] : `KPI_${kpiId}_${year}.xlsx`;
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = name;
                      a.click();
                      URL.revokeObjectURL(a.href);
                      toast.success("Export successful");
                    } catch {
                      setError("Download failed");
                      toast.error("Download failed");
                    } finally {
                      setExportExcelLoading(false);
                    }
                  }}
                >
                  <span style={{ fontSize: "1rem" }}>↓</span>
                  {exportExcelLoading ? "Preparing…" : "Download"}
                </button>
                {canEditKpi && !isLocked && (
                  <label
                    style={{
                      padding: "0.35rem 0.65rem",
                      fontSize: "0.85rem",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--surface)",
                      cursor: importExcelLoading ? "not-allowed" : "pointer",
                      opacity: importExcelLoading ? 0.7 : 1,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    <span style={{ fontSize: "1rem" }}>↑</span>
                    {importExcelLoading ? "Uploading…" : "Upload"}
                    <input
                      type="file"
                      accept=".xlsx"
                      style={{ display: "none" }}
                      disabled={importExcelLoading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file || !token) return;
                        const periodPhrase = timeDimensionLabel != null
                          ? ` You are about to add data for the period: ${timeDimensionLabel} (${year}).`
                          : "";
                        const confirmed = window.confirm(
                          `This will replace all existing data for this KPI entry with the data from the uploaded file.${periodPhrase}\n\nAre you sure you want to continue?`
                        );
                        if (!confirmed) return;
                        setImportExcelLoading(true);
                        setError(null);
                        try {
                          const form = new FormData();
                          form.append("file", file);
                          const url = getApiUrl(`/entries/import-excel?${qs({ kpi_id: kpiId, year, organization_id: effectiveOrgId, ...(periodKeyFromUrl ? { period_key: periodKeyFromUrl } : {}) })}`);
                          const res = await fetch(url, {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}` },
                            body: form,
                          });
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            const validationErrors = Array.isArray(err.errors) ? err.errors as Array<{ field_key?: string; sub_field_key?: string; row_index?: number; value?: string; message?: string }> : [];
                            if (validationErrors.length > 0) {
                              const lines = validationErrors.map((e) => {
                                const loc = e.sub_field_key != null ? `Field "${e.field_key}", row ${(e.row_index ?? 0) + 1}, "${e.sub_field_key}"` : `Field "${e.field_key}"`;
                                return `${loc}: value "${e.value ?? ""}" ${e.message ?? "not allowed"}`;
                              });
                              const msg = `Validation failed:\n${lines.join("\n")}`;
                              setError(msg);
                              toast.error("Validation failed – see message below");
                              return;
                            }
                            throw new Error(err.detail ?? res.statusText);
                          }
                          await loadData();
                          toast.success("Excel imported successfully");
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Upload failed");
                          toast.error(err instanceof Error ? err.message : "Upload failed");
                        } finally {
                          setImportExcelLoading(false);
                        }
                      }}
                    />
                  </label>
                )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section: Attachments (collapsible, at KPI level) */}
      <div className="card" style={{ marginBottom: "1rem", padding: "0", border: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => setAttachmentsOpen((prev) => !prev)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.85rem 1rem",
            background: attachmentsOpen ? "var(--surface)" : "rgba(var(--accent-rgb, 100, 100, 100), 0.08)",
            border: "none",
            borderRadius: attachmentsOpen ? "0.5rem 0.5rem 0 0" : "0.5rem",
            cursor: "pointer",
            fontSize: "1rem",
            fontWeight: 600,
            textAlign: "left",
            transition: "background 0.15s ease",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--muted)" }}
            >
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            Attachments
            {kpiFiles.length > 0 && (
              <span
                style={{
                  marginLeft: "0.25rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  background: "var(--accent)",
                  color: "var(--on-muted)",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                }}
              >
                {kpiFiles.length}
              </span>
            )}
          </span>
          <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>{attachmentsOpen ? "▲" : "▼"}</span>
        </button>
        {attachmentsOpen && (
          <div style={{ padding: "0 1rem 1rem 1rem", borderTop: "1px solid var(--border)" }}>
            {kpiFilesError && <p className="form-error" style={{ marginTop: "0.75rem", marginBottom: "0.5rem" }}>{kpiFilesError}</p>}
            {(meRole === "ORG_ADMIN" || meRole === "SUPER_ADMIN" || kpiApiInfo?.can_edit) && (
              <div style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
                <label
                  className="btn btn-primary"
                  style={{ cursor: kpiFilesUploading ? "not-allowed" : "pointer", opacity: kpiFilesUploading ? 0.7 : 1, padding: "0.4rem 0.75rem", fontSize: "0.9rem" }}
                >
                  {kpiFilesUploading ? "Uploading…" : "Upload files"}
                  <input
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    disabled={kpiFilesUploading}
                    onChange={async (e) => {
                      const fileList = e.target.files;
                      e.target.value = "";
                      if (!fileList?.length || !token || !kpiId || effectiveOrgId == null) return;
                      setKpiFilesUploading(true);
                      setKpiFilesError(null);
                      const form = new FormData();
                      for (let i = 0; i < fileList.length; i++) form.append("files", fileList[i]);
                      form.append("year", String(year));
                      if (entry?.id) form.append("entry_id", String(entry.id));
                      try {
                        const url = getApiUrl(`/kpis/${kpiId}/files`);
                        const res = await fetch(url, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${token}` },
                          body: form,
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          throw new Error(err.detail ?? res.statusText);
                        }
                        const created = await res.json() as KpiFileItem[];
                        setKpiFiles((prev) => [...(created ?? []), ...prev]);
                        const storageHint = `org_${effectiveOrgId}/kpi_${kpiId}/year_${year}`;
                        toast.success(`Files uploaded successfully to ${storageHint}`);
                      } catch (err) {
                        setKpiFilesError(err instanceof Error ? err.message : "Upload failed");
                        toast.error(err instanceof Error ? err.message : "Upload failed");
                      } finally {
                        setKpiFilesUploading(false);
                      }
                    }}
                  />
                </label>
              </div>
            )}
            {kpiFiles.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "0.5rem" }}>No attachments yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {kpiFiles.map((f) => (
                  <li
                    key={f.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.5rem 0",
                      borderBottom: "1px solid var(--border)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: "0.9rem" }} title={f.original_filename}>
                      {f.original_filename}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                      {typeof f.size === "number" && f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size ?? 0} B`}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                      {f.created_at ? new Date(f.created_at).toLocaleDateString() : ""}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem" }}
                      onClick={async () => {
                        if (!f.download_url || !token) return;
                        const url = getApiUrl(f.download_url.replace(/^\/api/, ""));
                        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                        if (!res.ok) return;
                        const blob = await res.blob();
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = f.original_filename || "download";
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      Download
                    </button>
                    {(meRole === "ORG_ADMIN" || meRole === "SUPER_ADMIN" || kpiApiInfo?.can_edit) && (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem", color: "var(--error, #c00)" }}
                        onClick={async () => {
                          if (!token || !window.confirm("Delete this file?")) return;
                          try {
                            await api(`/kpis/${kpiId}/files/${f.id}`, { method: "DELETE", token });
                            setKpiFiles((prev) => prev.filter((x) => x.id !== f.id));
                            toast.success("File deleted successfully");
                          } catch {
                            setKpiFilesError("Delete failed");
                            toast.error("Delete failed");
                          }
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Section 3: Tabs – Scalar fields, Security, then one tab per multi_line_items (inline-only) */}
      <div className="card">
        <div
          style={{
            padding: "0.6rem 1rem",
            marginBottom: "1rem",
            borderRadius: 8,
            background: isEditing ? "var(--warning)" : "var(--bg-subtle, #f0f0f0)",
            color: isEditing ? "var(--on-warning, #000)" : "var(--text)",
            fontSize: "0.9rem",
            fontWeight: 500,
            border: isEditing ? "1px solid var(--warning-dark, #b38600)" : "1px solid var(--border)",
          }}
        >
          {isEditing
            ? `You are updating data for ${timeDimensionLabel != null ? `${timeDimensionLabel} (${year})` : year}.`
            : `You are viewing the data for ${timeDimensionLabel != null ? `${timeDimensionLabel} (${year})` : year}.`}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", borderBottom: "1px solid var(--border)", marginBottom: "1rem", paddingBottom: "0.5rem" }}>
          <button
            type="button"
            className="btn"
            style={{
              ...(activeTab === "scalar" ? { background: "var(--accent)", color: "var(--on-muted)" } : {}),
            }}
            onClick={() => setActiveTab("scalar")}
          >
            Scalar Fields
          </button>
          {multiLineFields
            .filter((f) => (f as any).full_page_multi_items || (f.sub_fields?.length ?? 0) > 0)
            .map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn"
              style={{
                ...(activeTab === f.id ? { background: "var(--accent)", color: "var(--on-muted)" } : {}),
              }}
              onClick={() => {
                const isFullPage = Boolean((f as any).full_page_multi_items);
                if (isFullPage && effectiveOrgId != null) {
                  const fullPageUrl = `/dashboard/entries/${kpiId}/${year}/multi/${f.id}?${new URLSearchParams({
                    organization_id: String(effectiveOrgId),
                    ...(periodKeyFromUrl ? { period_key: periodKeyFromUrl } : {}),
                  }).toString()}`;
                  router.push(fullPageUrl);
                  return;
                }
                setActiveTab(f.id);
              }}
            >
              {f.name}
            </button>
          ))}
          {canSeeSecurityTab && (
            <button
              type="button"
              className="btn"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
                ...(activeTab === "security" ? { background: "var(--accent)", color: "var(--on-muted)" } : {}),
              }}
              onClick={() => setActiveTab("security")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                focusable="false"
                style={{ opacity: activeTab === "security" ? 1 : 0.85 }}
              >
                <path
                  d="M12 2l7 4v6c0 5-3.5 9.5-7 10-3.5-.5-7-5-7-10V6l7-4z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 12.5l1.8 1.8L15 10.6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Security</span>
            </button>
          )}
        </div>

        {activeTab === "scalar" && (
          <div style={{ overflowX: "auto" }}>
            {/* Fields you can edit */}
            {(formulaFields.length > 0 || scalarFieldsEdit.length > 0) && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem", color: "var(--text)", borderBottom: "1px solid var(--border)", paddingBottom: "0.35rem" }}>
                  Fields you can edit
                </h3>
            {isEditing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {[...formulaFields, ...scalarFieldsEdit].map((f) => {
                    if (f.field_type === "formula") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <label style={{ minWidth: 160, fontWeight: 500 }}>{f.name} (formula)</label>
                          <span style={{ color: "var(--muted)" }}>{formatValue(f, valuesByFieldId.get(f.id))}</span>
                        </div>
                      );
                    }
                    const val = formValues[f.id];
                    if (f.field_type === "single_line_text" || f.field_type === "multi_line_text") {
                      return (
                        <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <label style={{ fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          {f.field_type === "multi_line_text" ? (
                            <textarea
                              rows={3}
                              value={val?.value_text ?? ""}
                              onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                              style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6 }}
                            />
                          ) : (
                            <input
                              type="text"
                              value={val?.value_text ?? ""}
                              onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                              style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6 }}
                            />
                          )}
                        </div>
                      );
                    }
                    if (f.field_type === "attachment") {
                      const parsed = parseScalarAttachmentValueText(val?.value_text);
                      const valueForControl = parsed.url
                        ? { url: parsed.url, filename: parsed.filename }
                        : "";
                      return (
                        <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                          <label style={{ fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          <AttachmentFieldControl
                            value={valueForControl}
                            uploadSuccessAlert={false}
                            onUploaded={(downloadUrl, filename) =>
                              persistScalarAttachmentThenSave(
                                f.id,
                                stringifyScalarAttachment(downloadUrl, filename),
                                "File attached and saved.",
                              )
                            }
                            onClear={() => updateField(f.id, "value_text", "")}
                            token={token}
                            kpiId={kpiId}
                            entryId={entry?.id ?? null}
                            year={year}
                            onNotAuthenticated={() => toast.error("Session expired. Please log in again.")}
                            onError={(m) => toast.error(m)}
                            attachDisabled={!entry || !token}
                            emptySlot={
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                                <input
                                  type="url"
                                  value={val?.value_text ?? ""}
                                  onChange={(e) => updateField(f.id, "value_text", e.target.value)}
                                  placeholder="Paste external file URL (optional)"
                                  style={{
                                    flex: "1 1 220px",
                                    minWidth: 160,
                                    padding: "0.5rem",
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                  }}
                                />
                                {kpiFiles.length > 0 ? (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const fileId = Number(e.target.value || "0");
                                      const file = kpiFiles.find((x) => x.id === fileId);
                                      if (!file?.download_url) return;
                                      e.target.value = "";
                                      persistScalarAttachmentThenSave(
                                        f.id,
                                        stringifyScalarAttachment(
                                          file.download_url,
                                          file.original_filename || `File ${file.id}`
                                        ),
                                        "Saved.",
                                      );
                                    }}
                                    style={{
                                      padding: "0.45rem 0.6rem",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      fontSize: "0.85rem",
                                    }}
                                  >
                                    <option value="">Select from KPI files…</option>
                                    {kpiFiles.map((file) => (
                                      <option key={file.id} value={file.id}>
                                        {file.original_filename}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                              </div>
                            }
                          />
                          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: 0 }}>
                            Uploading or choosing a KPI file saves the attachment immediately. Paste an external URL and click Save to store it with the rest of the entry.
                          </p>
                        </div>
                      );
                    }
                    if (f.field_type === "number") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <label style={{ minWidth: 160, fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          <input
                            type="number"
                            step="any"
                            value={val?.value_number ?? ""}
                            onChange={(e) => updateField(f.id, "value_number", e.target.value === "" ? undefined : Number(e.target.value))}
                            style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6, maxWidth: 200 }}
                          />
                        </div>
                      );
                    }
                    if (f.field_type === "date") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <label style={{ minWidth: 160, fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          <input
                            type="date"
                            value={val?.value_date ?? ""}
                            onChange={(e) => updateField(f.id, "value_date", e.target.value)}
                            style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6 }}
                          />
                        </div>
                      );
                    }
                    if (f.field_type === "boolean") {
                      return (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <input
                            type="checkbox"
                            checked={val?.value_boolean ?? false}
                            onChange={(e) => updateField(f.id, "value_boolean", e.target.checked)}
                            id={`scalar-${f.id}`}
                          />
                          <label htmlFor={`scalar-${f.id}`} style={{ fontWeight: 500 }}>{f.name}</label>
                        </div>
                      );
                    }
                    if (f.field_type === "reference") {
                      const refKey = f.config?.reference_source_kpi_id && f.config?.reference_source_field_key
                        ? `${f.config.reference_source_kpi_id}-${f.config.reference_source_field_key}${f.config.reference_source_sub_field_key ? `-${f.config.reference_source_sub_field_key}` : ""}`
                        : "";
                      const options = refAllowedValues[refKey] ?? [];
                      return (
                        <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <label style={{ fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          <select
                            value={val?.value_text ?? ""}
                            onChange={(e) => updateField(f.id, "value_text", e.target.value || undefined)}
                            style={{ padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 6, maxWidth: 320 }}
                          >
                            <option value="">— Select —</option>
                            {options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      );
                    }
                    if (f.field_type === "multi_reference") {
                      const refKey = f.config?.reference_source_kpi_id && f.config?.reference_source_field_key
                        ? `${f.config.reference_source_kpi_id}-${f.config.reference_source_field_key}${f.config.reference_source_sub_field_key ? `-${f.config.reference_source_sub_field_key}` : ""}`
                        : "";
                      const options = refAllowedValues[refKey] ?? [];
                      const arr = Array.isArray(val?.value_json) ? (val!.value_json as string[]) : [];
                      return (
                        <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxWidth: 480 }}>
                          <label style={{ fontWeight: 500 }}>{f.name}{f.is_required ? " *" : ""}</label>
                          <MultiReferenceInput options={options} value={arr} onChange={(next) => updateField(f.id, "value_json", next)} />
                        </div>
                      );
                    }
                    return null;
                  })}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Field</th>
                    <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[...formulaFields, ...scalarFieldsEdit].map((f) => (
                    <tr key={f.id}>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                        {f.name}
                        {f.field_type === "formula" && " (formula)"}
                      </td>
                      <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                        {formatValue(f, valuesByFieldId.get(f.id))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
              </div>
            )}

            {/* Fields you can view (read-only) */}
            {scalarFieldsViewOnly.length > 0 && (
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem", color: "var(--text)", borderBottom: "1px solid var(--border)", paddingBottom: "0.35rem" }}>
                  Fields you can view (read-only)
                </h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Field</th>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scalarFieldsViewOnly.map((f) => (
                      <tr key={f.id}>
                        <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>{f.name}</td>
                        <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                          {formatValue(f, valuesByFieldId.get(f.id))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        )}

        {activeTab === "security" && canSeeSecurityTab && canManageColumnAccess && (
          <div style={{ padding: "0.5rem 0.25rem" }}>
            {(scalarFieldsEdit.length > 0 || scalarFieldsViewOnly.length > 0) && orgRoles.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                {columnAccessByRoleLoading ? (
                  <p style={{ color: "var(--muted)" }}>Loading…</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                      <thead>
                        <tr>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "0.5rem",
                              borderBottom: "1px solid var(--border)",
                              width: "30%",
                            }}
                          >
                            Field
                          </th>
                          <th
                            style={{
                              textAlign: "left",
                              padding: "0.5rem",
                              borderBottom: "1px solid var(--border)",
                            }}
                          >
                            Access by role
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...scalarFieldsEdit, ...scalarFieldsViewOnly].map((f) => (
                          <tr key={f.id}>
                            <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>{f.name}</td>
                            <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: "0.35rem",
                                  alignItems: "center",
                                }}
                              >
                                {orgRoles.map((role) => {
                                  const list = columnAccessByRole[role.id] ?? [];
                                  const row = list.find((r) => r.field_id === f.id && r.sub_field_id == null);
                                  if (!row) return null;
                                  const saving = columnAccessByRoleSavingRoleId === role.id;
                                  const label = row.access_type === "data_entry" ? "Edit" : "View";
                                  return (
                                    <span
                                      key={role.id}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.25rem",
                                        padding: "0.15rem 0.4rem",
                                        borderRadius: 12,
                                        background: "var(--border)",
                                        fontSize: "0.8rem",
                                      }}
                                    >
                                      <span>{role.name}</span>
                                      <span style={{ fontWeight: 600 }}>{label}</span>
                                      <button
                                        type="button"
                                        disabled={saving}
                                        onClick={async () => {
                                          const prevList = columnAccessByRole[role.id] ?? [];
                                          const updated = prevList.filter(
                                            (r) => !(r.field_id === f.id && r.sub_field_id == null)
                                          );
                                          setColumnAccessByRole((prev) => ({ ...prev, [role.id]: updated }));
                                          setColumnAccessByRoleSavingRoleId(role.id);
                                          try {
                                            const accesses = updated.filter(
                                              (r) => r.access_type === "view" || r.access_type === "data_entry"
                                            );
                                            await api(
                                              `/kpis/${kpiId}/field-access-by-role?${qs({
                                                organization_id: effectiveOrgId,
                                              })}`,
                                              {
                                                method: "PUT",
                                                body: JSON.stringify({ role_id: role.id, accesses }),
                                                token,
                                              }
                                            );
                                            toast.success("Access updated");
                                          } catch (err) {
                                            toast.error(err instanceof Error ? err.message : "Failed to save");
                                            setColumnAccessByRole((prev) => ({ ...prev, [role.id]: prevList }));
                                          } finally {
                                            setColumnAccessByRoleSavingRoleId(null);
                                          }
                                        }}
                                        style={{
                                          border: "none",
                                          background: "transparent",
                                          cursor: "pointer",
                                          fontSize: "0.85rem",
                                        }}
                                        aria-label={`Remove access for ${role.name}`}
                                      >
                                        ×
                                      </button>
                                    </span>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (scalarAccessTargetFieldId === f.id) {
                                      setScalarAccessTargetFieldId(null);
                                      setScalarAccessSearch("");
                                      setScalarAccessRoleId(null);
                                    } else {
                                      setScalarAccessTargetFieldId(f.id);
                                      setScalarAccessSearch("");
                                      setScalarAccessRoleId(null);
                                      setScalarAccessPermission("data_entry");
                                    }
                                  }}
                                  style={{
                                    padding: "0.25rem 0.5rem",
                                    fontSize: "0.8rem",
                                    borderRadius: 6,
                                    border: "1px solid var(--border)",
                                    background: "var(--surface)",
                                    cursor: "pointer",
                                  }}
                                >
                                  {scalarAccessTargetFieldId === f.id ? "Cancel" : "Add rights"}
                                </button>
                              </div>
                              {scalarAccessTargetFieldId === f.id && (
                                <div
                                  style={{
                                    marginTop: "0.35rem",
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "0.35rem",
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    type="text"
                                    placeholder="Search role…"
                                    value={scalarAccessSearch}
                                    onChange={(e) => setScalarAccessSearch(e.target.value)}
                                    style={{
                                      padding: "0.3rem 0.45rem",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      fontSize: "0.8rem",
                                      minWidth: 160,
                                    }}
                                  />
                                  <select
                                    value={scalarAccessRoleId ?? ""}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setScalarAccessRoleId(v ? Number(v) : null);
                                    }}
                                    style={{
                                      padding: "0.3rem 0.45rem",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      fontSize: "0.8rem",
                                    }}
                                  >
                                    <option value="">Select role…</option>
                                    {orgRoles
                                      .filter((role) => {
                                        const name = (role.name || "").toLowerCase();
                                        const q = scalarAccessSearch.trim().toLowerCase();
                                        if (q && !name.includes(q)) return false;
                                        const list = columnAccessByRole[role.id] ?? [];
                                        return !list.some(
                                          (r) =>
                                            r.field_id === f.id &&
                                            r.sub_field_id == null &&
                                            (r.access_type === "view" || r.access_type === "data_entry")
                                        );
                                      })
                                      .map((role) => (
                                        <option key={role.id} value={role.id}>
                                          {role.name}
                                        </option>
                                      ))}
                                  </select>
                                  <select
                                    value={scalarAccessPermission}
                                    onChange={(e) =>
                                      setScalarAccessPermission(
                                        e.target.value === "view" ? "view" : "data_entry"
                                      )
                                    }
                                    style={{
                                      padding: "0.3rem 0.45rem",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      fontSize: "0.8rem",
                                    }}
                                  >
                                    <option value="data_entry">Edit</option>
                                    <option value="view">View</option>
                                  </select>
                                  <button
                                    type="button"
                                    disabled={
                                      scalarAccessRoleId == null ||
                                      columnAccessByRoleSavingRoleId === scalarAccessRoleId
                                    }
                                    onClick={async () => {
                                      if (scalarAccessRoleId == null) return;
                                      const roleId = scalarAccessRoleId;
                                      const prevList = columnAccessByRole[roleId] ?? [];
                                      const updated = prevList
                                        .filter(
                                          (r) => !(r.field_id === f.id && r.sub_field_id == null)
                                        )
                                        .concat([
                                          {
                                            field_id: f.id,
                                            sub_field_id: null,
                                            access_type: scalarAccessPermission,
                                          },
                                        ]);
                                      setColumnAccessByRole((prev) => ({
                                        ...prev,
                                        [roleId]: updated,
                                      }));
                                      setColumnAccessByRoleSavingRoleId(roleId);
                                      try {
                                        const accesses = updated.filter(
                                          (r) =>
                                            r.access_type === "view" ||
                                            r.access_type === "data_entry"
                                        );
                                        await api(
                                          `/kpis/${kpiId}/field-access-by-role?${qs({
                                            organization_id: effectiveOrgId,
                                          })}`,
                                          {
                                            method: "PUT",
                                            body: JSON.stringify({
                                              role_id: roleId,
                                              accesses,
                                            }),
                                            token,
                                          }
                                        );
                                        toast.success("Access updated");
                                        setScalarAccessTargetFieldId(null);
                                        setScalarAccessRoleId(null);
                                        setScalarAccessSearch("");
                                      } catch (err) {
                                        toast.error(
                                          err instanceof Error ? err.message : "Failed to save"
                                        );
                                        setColumnAccessByRole((prev) => ({
                                          ...prev,
                                          [roleId]: prevList,
                                        }));
                                      } finally {
                                        setColumnAccessByRoleSavingRoleId(null);
                                      }
                                    }}
                                    style={{
                                      padding: "0.3rem 0.7rem",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      background: "var(--primary)",
                                      color: "var(--on-muted)",
                                      fontSize: "0.8rem",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Add
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Multi-line fields security (row-level toggle + collapse to show columns) */}
            {multiLineFields.length > 0 && orgRoles.length > 0 && (
              <div>
                {multiLineFields.map((f) => {
                  const subFields = f.sub_fields ?? [];
                  if (subFields.length === 0) return null;
                  return (
                    <div
                      key={f.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "0.6rem 0.75rem",
                        marginBottom: "0.6rem",
                        background: "var(--bg-subtle, #f9fafb)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setColumnAccessFieldId((prev) => (prev === f.id ? null : f.id))
                          }
                          style={{
                            padding: "0.25rem 0.45rem",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--surface)",
                            fontSize: "0.8rem",
                            cursor: "pointer",
                            minWidth: 28,
                          }}
                          title={columnAccessFieldId === f.id ? "Collapse" : "Expand"}
                        >
                          {columnAccessFieldId === f.id ? "▲" : "▼"}
                        </button>
                        <span style={{ fontWeight: 600 }}>{f.name}</span>
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--muted)",
                          }}
                        >
                          {subFields.length} column{subFields.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {/* Row-based user-level access for this multi-line field */}
                      <div style={{ marginTop: "0.5rem" }}>
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={(f as FieldDef).row_level_user_access_enabled ?? false}
                            disabled={rowLevelAccessUpdatingFieldId === f.id}
                            onChange={async () => {
                              const next = !((f as FieldDef).row_level_user_access_enabled ?? false);
                              setRowLevelAccessUpdatingFieldId(f.id);
                              try {
                                await api(`/fields/${f.id}?${qs({ organization_id: effectiveOrgId })}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ row_level_user_access_enabled: next }),
                                  token,
                                });
                                setFields((prev) =>
                                  prev.map((field) =>
                                    field.id === f.id ? { ...field, row_level_user_access_enabled: next } : field
                                  )
                                );
                                toast.success(
                                  next ? "Row-based user access enabled" : "Row-based user access disabled"
                                );
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Failed to update");
                              } finally {
                                setRowLevelAccessUpdatingFieldId(null);
                              }
                            }}
                          />
                          <span>Row-based user-level access</span>
                        </label>
                        <p
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--muted)",
                            margin: "0.25rem 0 0 1.5rem",
                          }}
                        >
                          When enabled, rows are restricted by user-level row access; when disabled, all rows
                          follow role/field access.
                        </p>
                      </div>

                      {/* Add-row permission panel (separate from edit/delete) */}
                      <div
                        style={{
                          marginTop: "0.6rem",
                          padding: "0.6rem",
                          border: "1px dashed var(--border)",
                          borderRadius: 8,
                          background: "var(--surface)",
                        }}
                      >
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
                          Add Row permission (who can create new rows)
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: "0.5rem",
                            alignItems: "end",
                          }}
                        >
                          <div>
                            <label
                              style={{
                                display: "block",
                                fontSize: "0.75rem",
                                color: "var(--muted)",
                                marginBottom: "0.25rem",
                              }}
                            >
                              User
                            </label>
                            <select
                              value={addRowAddUserIdByField[f.id] ?? ""}
                              onChange={(e) =>
                                setAddRowAddUserIdByField((prev) => ({
                                  ...prev,
                                  [f.id]: e.target.value ? Number(e.target.value) : "",
                                }))
                              }
                              style={{
                                width: "100%",
                                padding: "0.4rem 0.6rem",
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                fontSize: "0.8rem",
                              }}
                            >
                              <option value="">Select user</option>
                              {orgUsers.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.full_name || u.username}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={addRowSavingFieldId === f.id || !addRowAddUserIdByField[f.id]}
                            onClick={async () => {
                              const nextId = Number(addRowAddUserIdByField[f.id]);
                              if (!nextId) return;
                              const current = addRowUsersByField[f.id] ?? [];
                              const next = Array.from(new Set([...current.map((x) => x.id), nextId]));
                              await setAddRowUsers(f.id, next);
                              setAddRowAddUserIdByField((prev) => ({ ...prev, [f.id]: "" }));
                            }}
                          >
                            {addRowSavingFieldId === f.id ? "Saving..." : "Grant Add Row"}
                          </button>
                        </div>
                        <div style={{ marginTop: "0.6rem" }}>
                          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                            Users with Add Row
                          </div>
                          {addRowLoadingFieldId === f.id ? (
                            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8rem" }}>Loading...</p>
                          ) : (addRowUsersByField[f.id] || []).length === 0 ? (
                            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8rem" }}>
                              No users currently have Add Row permission for this field.
                            </p>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                              {(addRowUsersByField[f.id] || []).map((u) => (
                                <span
                                  key={u.id}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.35rem",
                                    padding: "0.2rem 0.45rem",
                                    borderRadius: 12,
                                    background: "var(--bg-subtle)",
                                    fontSize: "0.8rem",
                                  }}
                                >
                                  {(u.full_name || u.username)}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const current = addRowUsersByField[f.id] ?? [];
                                      const next = current.filter((x) => x.id !== u.id).map((x) => x.id);
                                      await setAddRowUsers(f.id, next);
                                    }}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      cursor: "pointer",
                                      color: "var(--danger, #c00)",
                                      fontSize: "0.9rem",
                                    }}
                                    title="Remove Add Row"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ marginTop: "0.35rem", fontSize: "0.75rem", color: "var(--muted)" }}>
                          Note: Org Admin can always add rows.
                        </div>
                      </div>
                      {(f as FieldDef).row_level_user_access_enabled && (
                        <div
                          style={{
                            marginTop: "0.6rem",
                            padding: "0.6rem",
                            border: "1px dashed var(--border)",
                            borderRadius: 8,
                            background: "var(--surface)",
                          }}
                        >
                          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
                            Full row access for selected entry
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0.5rem", alignItems: "end" }}>
                            <div>
                              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Entry</label>
                              <select
                                value={rowAccessEntryIdByField[f.id] ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value ? Number(e.target.value) : "";
                                  setRowAccessEntryIdByField((prev) => ({ ...prev, [f.id]: val }));
                                  if (typeof val === "number" && val > 0) {
                                    fetchFullRowAccessUsers(f.id, val);
                                  } else {
                                    setFullRowAccessByField((prev) => ({ ...prev, [f.id]: [] }));
                                  }
                                }}
                                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.8rem" }}
                              >
                                <option value="">Select entry</option>
                                {(allEntriesForPeriodBar || []).map((en) => (
                                  <option key={en.id} value={en.id}>
                                    {en.year} {en.period_key ? `(${en.period_key})` : "(full year)"} - #{en.id}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.25rem" }}>User</label>
                              <select
                                value={fullRowAccessAddUserIdByField[f.id] ?? ""}
                                onChange={(e) =>
                                  setFullRowAccessAddUserIdByField((prev) => ({
                                    ...prev,
                                    [f.id]: e.target.value ? Number(e.target.value) : "",
                                  }))
                                }
                                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.8rem" }}
                              >
                                <option value="">Select user</option>
                                {orgUsers.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.full_name || u.username}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.25rem" }}>Mode</label>
                              <select
                                value={fullRowAccessAddModeByField[f.id] ?? "edit"}
                                onChange={(e) =>
                                  setFullRowAccessAddModeByField((prev) => ({
                                    ...prev,
                                    [f.id]:
                                      e.target.value === "view"
                                        ? "view"
                                        : e.target.value === "edit_delete"
                                          ? "edit_delete"
                                          : "edit",
                                  }))
                                }
                                style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.8rem" }}
                              >
                                <option value="view">View</option>
                                <option value="edit">Edit</option>
                                <option value="edit_delete">Edit + Delete</option>
                              </select>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={
                                fullRowAccessSavingFieldId === f.id ||
                                !rowAccessEntryIdByField[f.id] ||
                                !fullRowAccessAddUserIdByField[f.id]
                              }
                              onClick={() =>
                                grantAllRowsToUser(
                                  f.id,
                                  Number(rowAccessEntryIdByField[f.id]),
                                  Number(fullRowAccessAddUserIdByField[f.id]),
                                  fullRowAccessAddModeByField[f.id] ?? "edit"
                                )
                              }
                            >
                              {fullRowAccessSavingFieldId === f.id ? "Saving..." : "Grant all rows"}
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={
                                fullRowAccessSavingFieldId === f.id ||
                                !rowAccessEntryIdByField[f.id] ||
                                !fullRowAccessAddUserIdByField[f.id]
                              }
                              onClick={() =>
                                revokeAllRowsForUser(
                                  f.id,
                                  Number(rowAccessEntryIdByField[f.id]),
                                  Number(fullRowAccessAddUserIdByField[f.id])
                                )
                              }
                            >
                              {fullRowAccessSavingFieldId === f.id ? "Saving..." : "Revoke all rows"}
                            </button>
                          </div>
                          <div style={{ marginTop: "0.6rem" }}>
                            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                              Users with full access
                            </div>
                            {fullRowAccessLoadingFieldId === f.id ? (
                              <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8rem" }}>Loading...</p>
                            ) : (fullRowAccessByField[f.id] || []).length === 0 ? (
                              <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8rem" }}>
                                No users currently have full row access for the selected entry.
                              </p>
                            ) : (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                                {(fullRowAccessByField[f.id] || []).map((u) => (
                                  <span
                                    key={u.user_id}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "0.35rem",
                                      padding: "0.2rem 0.45rem",
                                      borderRadius: 12,
                                      background: "var(--bg-subtle)",
                                      fontSize: "0.8rem",
                                    }}
                                  >
                                    {(u.full_name || u.username)} ({u.mode === "view" ? "View" : u.mode === "edit_delete" ? "Edit+Delete" : "Edit"})
                                    <button
                                      type="button"
                                      onClick={() =>
                                        revokeAllRowsForUser(
                                          f.id,
                                          Number(rowAccessEntryIdByField[f.id]),
                                          u.user_id
                                        )
                                      }
                                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--danger, #c00)", fontSize: "0.9rem" }}
                                      title="Revoke all rows"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {columnAccessFieldId === f.id && (
                        <div
                          className="card"
                          style={{ padding: "0.6rem", marginTop: "0.5rem", overflowX: "auto" }}
                        >
                          {columnAccessByRoleLoading ? (
                            <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
                          ) : orgRoles.length === 0 ? (
                            <p style={{ color: "var(--muted)", margin: 0 }}>
                              No roles. Create roles and assign users in Full access control.
                            </p>
                          ) : (
                            <table
                              style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: "0.85rem",
                              }}
                            >
                              <thead>
                                <tr>
                                  <th
                                    style={{
                                      textAlign: "left",
                                      padding: "0.5rem",
                                      borderBottom: "1px solid var(--border)",
                                      width: "30%",
                                    }}
                                  >
                                    Column
                                  </th>
                                  <th
                                    style={{
                                      textAlign: "left",
                                      padding: "0.5rem",
                                      borderBottom: "1px solid var(--border)",
                                    }}
                                  >
                                    Access by role
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {subFields.map((s) => {
                                  const isAdding =
                                    columnAccessAddTarget != null &&
                                    columnAccessAddTarget.fieldId === f.id &&
                                    columnAccessAddTarget.subFieldId === s.id;
                                  return (
                                    <tr key={s.id}>
                                      <td
                                        style={{
                                          padding: "0.5rem",
                                          borderBottom: "1px solid var(--border)",
                                        }}
                                      >
                                        {s.name}
                                      </td>
                                      <td
                                        style={{
                                          padding: "0.5rem",
                                          borderBottom: "1px solid var(--border)",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: "0.35rem",
                                            alignItems: "center",
                                          }}
                                        >
                                          {orgRoles.map((role) => {
                                            const list = columnAccessByRole[role.id] ?? [];
                                            const row = list.find(
                                              (r) => r.field_id === f.id && r.sub_field_id === s.id
                                            );
                                            if (!row) return null;
                                            const saving =
                                              columnAccessByRoleSavingRoleId === role.id;
                                            const label =
                                              row.access_type === "data_entry" ? "Edit" : "View";
                                            return (
                                              <span
                                                key={role.id}
                                                style={{
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  gap: "0.25rem",
                                                  padding: "0.15rem 0.4rem",
                                                  borderRadius: 12,
                                                  background: "var(--border)",
                                                  fontSize: "0.8rem",
                                                }}
                                              >
                                                <span>{role.name}</span>
                                                <span style={{ fontWeight: 600 }}>{label}</span>
                                                <button
                                                  type="button"
                                                  disabled={saving}
                                                  onClick={async () => {
                                                    const prevList = columnAccessByRole[role.id] ?? [];
                                                    const updated = prevList.filter(
                                                      (r) =>
                                                        !(
                                                          r.field_id === f.id &&
                                                          r.sub_field_id === s.id
                                                        )
                                                    );
                                                    setColumnAccessByRole((prev) => ({
                                                      ...prev,
                                                      [role.id]: updated,
                                                    }));
                                                    setColumnAccessByRoleSavingRoleId(role.id);
                                                    try {
                                                      const accesses = updated.filter(
                                                        (r) =>
                                                          r.access_type === "view" ||
                                                          r.access_type === "data_entry"
                                                      );
                                                      await api(
                                                        `/kpis/${kpiId}/field-access-by-role?${qs({
                                                          organization_id: effectiveOrgId,
                                                        })}`,
                                                        {
                                                          method: "PUT",
                                                          body: JSON.stringify({
                                                            role_id: role.id,
                                                            accesses,
                                                          }),
                                                          token,
                                                        }
                                                      );
                                                      toast.success("Column access updated");
                                                    } catch (err) {
                                                      toast.error(
                                                        err instanceof Error
                                                          ? err.message
                                                          : "Failed to save"
                                                      );
                                                      setColumnAccessByRole((prev) => ({
                                                        ...prev,
                                                        [role.id]: prevList,
                                                      }));
                                                    } finally {
                                                      setColumnAccessByRoleSavingRoleId(null);
                                                    }
                                                  }}
                                                  style={{
                                                    border: "none",
                                                    background: "transparent",
                                                    cursor: "pointer",
                                                    fontSize: "0.85rem",
                                                  }}
                                                  aria-label={`Remove access for ${role.name}`}
                                                >
                                                  ×
                                                </button>
                                              </span>
                                            );
                                          })}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (isAdding) {
                                                setColumnAccessAddTarget(null);
                                                setColumnAccessAddRoleId(null);
                                              } else {
                                                setColumnAccessAddTarget({
                                                  fieldId: f.id,
                                                  subFieldId: s.id,
                                                });
                                                setColumnAccessAddRoleId(null);
                                                setColumnAccessAddPermission("data_entry");
                                              }
                                            }}
                                            style={{
                                              padding: "0.25rem 0.5rem",
                                              fontSize: "0.8rem",
                                              borderRadius: 6,
                                              border: "1px solid var(--border)",
                                              background: "var(--surface)",
                                              cursor: "pointer",
                                            }}
                                          >
                                            {isAdding ? "Cancel" : "Add"}
                                          </button>
                                        </div>
                                        {isAdding && (
                                          <div
                                            style={{
                                              marginTop: "0.35rem",
                                              display: "flex",
                                              flexWrap: "wrap",
                                              gap: "0.35rem",
                                              alignItems: "center",
                                            }}
                                          >
                                            <select
                                              value={columnAccessAddRoleId ?? ""}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setColumnAccessAddRoleId(v ? Number(v) : null);
                                              }}
                                              style={{
                                                padding: "0.3rem 0.45rem",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                fontSize: "0.8rem",
                                              }}
                                            >
                                              <option value="">Select role…</option>
                                              {orgRoles
                                                .filter((role) => {
                                                  const list = columnAccessByRole[role.id] ?? [];
                                                  return !list.some(
                                                    (r) =>
                                                      r.field_id === f.id &&
                                                      r.sub_field_id === s.id &&
                                                      (r.access_type === "view" ||
                                                        r.access_type === "data_entry")
                                                  );
                                                })
                                                .map((role) => (
                                                  <option key={role.id} value={role.id}>
                                                    {role.name}
                                                  </option>
                                                ))}
                                            </select>
                                            <select
                                              value={columnAccessAddPermission}
                                              onChange={(e) =>
                                                setColumnAccessAddPermission(
                                                  e.target.value === "view"
                                                    ? "view"
                                                    : "data_entry"
                                                )
                                              }
                                              style={{
                                                padding: "0.3rem 0.45rem",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                fontSize: "0.8rem",
                                              }}
                                            >
                                              <option value="data_entry">Edit</option>
                                              <option value="view">View</option>
                                            </select>
                                            <button
                                              type="button"
                                              disabled={
                                                columnAccessAddRoleId == null ||
                                                columnAccessByRoleSavingRoleId ===
                                                  columnAccessAddRoleId
                                              }
                                              onClick={async () => {
                                                if (columnAccessAddRoleId == null) return;
                                                const roleId = columnAccessAddRoleId;
                                                const prevList =
                                                  columnAccessByRole[roleId] ?? [];
                                                const updated = prevList
                                                  .filter(
                                                    (r) =>
                                                      !(
                                                        r.field_id === f.id &&
                                                        r.sub_field_id === s.id
                                                      )
                                                  )
                                                  .concat([
                                                    {
                                                      field_id: f.id,
                                                      sub_field_id: s.id,
                                                      access_type: columnAccessAddPermission,
                                                    },
                                                  ]);
                                                setColumnAccessByRole((prev) => ({
                                                  ...prev,
                                                  [roleId]: updated,
                                                }));
                                                setColumnAccessByRoleSavingRoleId(roleId);
                                                try {
                                                  const accesses = updated.filter(
                                                    (r) =>
                                                      r.access_type === "view" ||
                                                      r.access_type === "data_entry"
                                                  );
                                                  await api(
                                                    `/kpis/${kpiId}/field-access-by-role?${qs({
                                                      organization_id: effectiveOrgId,
                                                    })}`,
                                                    {
                                                      method: "PUT",
                                                      body: JSON.stringify({
                                                        role_id: roleId,
                                                        accesses,
                                                      }),
                                                      token,
                                                    }
                                                  );
                                                  toast.success("Column access updated");
                                                  setColumnAccessAddTarget(null);
                                                  setColumnAccessAddRoleId(null);
                                                } catch (err) {
                                                  toast.error(
                                                    err instanceof Error
                                                      ? err.message
                                                      : "Failed to save"
                                                  );
                                                  setColumnAccessByRole((prev) => ({
                                                    ...prev,
                                                    [roleId]: prevList,
                                                  }));
                                                } finally {
                                                  setColumnAccessByRoleSavingRoleId(null);
                                                }
                                              }}
                                              style={{
                                                padding: "0.3rem 0.7rem",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                background: "var(--primary)",
                                                color: "var(--on-muted)",
                                                fontSize: "0.8rem",
                                                cursor: "pointer",
                                              }}
                                            >
                                              Add
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

          {inlineMultiLineFields.map((f) => {
          if (activeTab !== f.id) return null;
          const v = valuesByFieldId.get(f.id);
          const multiFieldCanEdit = (f as FieldDef).can_edit !== false;
          const formRows: Record<string, unknown>[] =
            isEditing && multiFieldCanEdit && Array.isArray(formValues[f.id]?.value_json)
              ? (formValues[f.id]!.value_json as Record<string, unknown>[])
              : [];
          const rows: Record<string, unknown>[] = !multiFieldCanEdit
            ? (Array.isArray(v?.value_json) ? (v!.value_json as Record<string, unknown>[]) : [])
            : (isEditing ? formRows : (Array.isArray(v?.value_json) ? (v!.value_json as Record<string, unknown>[]) : []));
          const subFields = f.sub_fields ?? [];
          const setRows = (next: Record<string, unknown>[]) => updateField(f.id, "value_json", next);
          const fieldQuery = `?field_id=${f.id}&organization_id=${effectiveOrgId}`;
          const templateQuery = entry ? `?field_id=${f.id}&entry_id=${entry.id}&organization_id=${effectiveOrgId}` : fieldQuery;
          const uploadQuery =
            entry && effectiveOrgId != null
              ? (() => {
                  const p = new URLSearchParams({
                    entry_id: String(entry.id),
                    field_id: String(f.id),
                    organization_id: String(effectiveOrgId),
                  });
                  if (uploadOption === "upsert") {
                    p.set("import_mode", "upsert");
                    p.set("match_sub_field_key", (upsertMatchKeyByFieldId[f.id] ?? "").trim());
                  } else {
                    p.set("import_mode", uploadOption === "append" ? "append" : "replace");
                  }
                  return `?${p.toString()}`;
                })()
              : "";
          return (
            <div key={f.id} style={{ overflowX: "auto" }}>
              {subFields.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No sub-fields defined.</p>
              ) : (
                <>
                  {isEditing && (f as FieldDef).can_edit !== false && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-primary" disabled={saving || isLocked} onClick={handleSave}>
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                          Rows are in <strong>draft</strong> until you click Save.
                        </span>
                      </div>
                      {(meRole === "ORG_ADMIN" || meRole === "SUPER_ADMIN" || (addRowUsersByField[f.id] || []).some((u) => u.id === (meId ?? -1))) && (
                        <button
                          type="button"
                          className="btn"
                          disabled={isLocked}
                          onClick={() => {
                            const empty: Record<string, unknown> = {};
                            for (const s of subFields) {
                              empty[s.key] = s.field_type === "multi_reference" ? [] : undefined;
                            }
                            setRows([...rows, empty]);
                          }}
                        >
                          Add row
                        </button>
                      )}
                    </div>
                  )}

                  {(f as FieldDef).can_edit !== false &&
                    (meRole === "ORG_ADMIN" ||
                      meRole === "SUPER_ADMIN" ||
                      (addRowUsersByField[f.id] || []).some((u) => u.id === (meId ?? -1))) && (
                  <>
                  <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => setBulkExpandedByFieldId((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
                      style={{
                        padding: "0.35rem 0.5rem",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: "var(--surface)",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                        minWidth: 32,
                      }}
                      title={bulkExpandedByFieldId[f.id] ? "Collapse" : "Expand"}
                    >
                      {bulkExpandedByFieldId[f.id] ? "▲" : "▼"}
                    </button>
                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      Bulk upload
                    </span>
                  </div>
                  {bulkExpandedByFieldId[f.id] && (
                  <div
                    className="card"
                    style={{
                      marginBottom: "1.25rem",
                      padding: "1rem",
                      background: "var(--bg-subtle)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                      {bulkMethod === "api" && kpiApiInfo?.api_endpoint_url && (
                        <a
                          href={kpiApiInfo.api_endpoint_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "0.9rem",
                            color: "var(--accent)",
                            textDecoration: "none",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={kpiApiInfo.api_endpoint_url}
                        >
                          {kpiApiInfo.api_endpoint_url}
                        </a>
                      )}
                      <select
                        value={isApiKpi ? bulkMethod : "upload"}
                        onChange={(e) => setBulkMethod(e.target.value as "upload" | "api")}
                        disabled={!isApiKpi}
                        style={{
                          padding: "0.5rem 0.75rem",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          fontSize: "0.9rem",
                          minWidth: 180,
                          background: "var(--surface)",
                        }}
                      >
                        <option value="upload">Upload file</option>
                        {isApiKpi && <option value="api">Sync from API</option>}
                      </select>
                    </div>

                    {bulkMethod === "upload" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div style={{ marginBottom: "0.25rem" }}>
                          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Choose an option:</span>
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input
                            type="radio"
                            name="uploadOption"
                            checked={uploadOption === "append"}
                            onChange={() => setUploadOption("append")}
                            disabled={!entry || isLocked}
                          />
                          Append to existing rows
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input
                            type="radio"
                            name="uploadOption"
                            checked={uploadOption === "override"}
                            onChange={() => setUploadOption("override")}
                            disabled={!entry || isLocked}
                          />
                          Override existing data (replace all)
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input
                            type="radio"
                            name="uploadOption"
                            checked={uploadOption === "upsert"}
                            onChange={() => setUploadOption("upsert")}
                            disabled={!entry || isLocked}
                          />
                          Update or add (match on a column)
                        </label>
                        {uploadOption === "upsert" && subFields.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.25rem" }}>
                            <label style={{ fontSize: "0.85rem", fontWeight: 500 }}>Match column (same value updates the row; new value adds a row)</label>
                            <select
                              value={upsertMatchKeyByFieldId[f.id] ?? ""}
                              onChange={(e) =>
                                setUpsertMatchKeyByFieldId((prev) => ({ ...prev, [f.id]: e.target.value }))
                              }
                              style={{
                                maxWidth: 360,
                                padding: "0.45rem 0.6rem",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                fontSize: "0.9rem",
                                background: "var(--surface)",
                              }}
                            >
                              <option value="">— Select sub-field —</option>
                              {subFields.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.name} ({s.key})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginTop: "0.25rem" }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={async () => {
                              const url = getApiUrl(`/entries/multi-items/template${templateQuery}`);
                              const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                              if (!res.ok) return;
                              const blob = await res.blob();
                              const a = document.createElement("a");
                              a.href = URL.createObjectURL(blob);
                              a.download = `multi_items_${f.key}_${year}.xlsx`;
                              a.click();
                              URL.revokeObjectURL(a.href);
                            }}
                          >
                            Download Excel template
                          </button>
                          <label
                            className="btn btn-primary"
                            style={{
                              cursor:
                                entry &&
                                uploadOption != null &&
                                uploadingFieldId === null &&
                                (uploadOption !== "upsert" || (upsertMatchKeyByFieldId[f.id] ?? "").trim())
                                  ? "pointer"
                                  : "not-allowed",
                              opacity:
                                entry &&
                                uploadOption != null &&
                                (uploadOption !== "upsert" || (upsertMatchKeyByFieldId[f.id] ?? "").trim())
                                  ? 1
                                  : 0.6,
                            }}
                          >
                            {uploadingFieldId === f.id ? "Uploading…" : "Upload Excel"}
                            <input
                              type="file"
                              accept=".xlsx"
                              style={{ display: "none" }}
                              disabled={
                                !entry ||
                                uploadOption == null ||
                                uploadingFieldId !== null ||
                                isLocked ||
                                (uploadOption === "upsert" && !(upsertMatchKeyByFieldId[f.id] ?? "").trim())
                              }
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (!file || !entry || uploadOption == null) return;
                                if (uploadOption === "upsert" && !(upsertMatchKeyByFieldId[f.id] ?? "").trim()) {
                                  setBulkUploadError("Select which sub-field to use for matching.");
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                  return;
                                }
                                if (uploadOption === "override") {
                                  const periodNote = timeDimensionLabel != null ? ` Data will apply to period: ${timeDimensionLabel} (${year}).` : "";
                                  if (!window.confirm(`Are you sure you want to replace all existing data for this field?${periodNote} This cannot be undone.`)) return;
                                }
                                setUploadingFieldId(f.id);
                                try {
                                  const form = new FormData();
                                  form.append("file", file);
                                  const url = getApiUrl(`/entries/multi-items/upload${uploadQuery}`);
                                  const res = await fetch(url, {
                                    method: "POST",
                                    headers: { Authorization: `Bearer ${token}` },
                                    body: form,
                                  });
                                  if (res.ok) {
                                    const payload = await res.json().catch(() => ({} as Record<string, unknown>));
                                    await loadData();
                                    if (uploadOption === "upsert") {
                                      const u = Number(payload.rows_updated ?? 0);
                                      const a = Number(payload.rows_added ?? 0);
                                      toast.success(`Update or add: ${u} row(s) updated, ${a} new row(s) added`);
                                    } else {
                                      toast.success("Excel uploaded successfully");
                                    }
                                  } else {
                                    const err = await res.json().catch(() => ({}));
                                    const validationErrors = Array.isArray(err.errors)
                                      ? (err.errors as Array<{
                                          field_key?: string;
                                          sub_field_key?: string;
                                          row_index?: number;
                                          value?: string;
                                          message?: string;
                                          row?: unknown;
                                        }>)
                                      : [];
                                    if (validationErrors.length > 0) {
                                      const first = validationErrors[0];
                                      const loc =
                                        first.sub_field_key != null
                                          ? `Field "${first.field_key}", row ${(first.row_index ?? 0) + 1}, "${first.sub_field_key}"`
                                          : `Field "${first.field_key}"`;
                                      const details =
                                        first.row != null
                                          ? ` | row: ${
                                              typeof first.row === "string"
                                                ? first.row
                                                : JSON.stringify(first.row)
                                            }`
                                          : "";
                                      const msg = `Consistency check failed:\n${loc}: value "${first.value ?? ""}" ${
                                        first.message ?? "not allowed"
                                      }${details}`;
                                      setBulkUploadError(msg);
                                      window.scrollTo({ top: 0, behavior: "smooth" });
                                    } else {
                                      setBulkUploadError("Excel upload failed");
                                      window.scrollTo({ top: 0, behavior: "smooth" });
                                    }
                                  }
                                } finally {
                                  setUploadingFieldId(null);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {bulkMethod === "api" && isApiKpi && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div style={{ marginBottom: "0.25rem" }}>
                          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Choose an option:</span>
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input type="radio" name="syncOption" checked={syncOption === "append"} onChange={() => setSyncOption("append")} />
                          Append to existing rows
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input type="radio" name="syncOption" checked={syncOption === "override"} onChange={() => setSyncOption("override")} />
                          Override existing data (replace all)
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                          <input type="radio" name="syncOption" checked={syncOption === "upsert"} onChange={() => setSyncOption("upsert")} />
                          Update or add (match on a column per multi-line table)
                        </label>
                        {syncOption === "upsert" &&
                          multiLineFields.filter((mf) => (mf.sub_fields?.length ?? 0) > 0).map((mf) => (
                            <div key={mf.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.25rem" }}>
                              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                                Match column for <strong>{mf.name}</strong> ({mf.key})
                              </span>
                              <select
                                value={kpiSyncUpsertByFieldKey[mf.key] ?? ""}
                                onChange={(e) =>
                                  setKpiSyncUpsertByFieldKey((prev) => ({ ...prev, [mf.key]: e.target.value }))
                                }
                                style={{
                                  maxWidth: 360,
                                  padding: "0.45rem 0.6rem",
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  fontSize: "0.9rem",
                                  background: "var(--surface)",
                                }}
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
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={
                            syncOption == null ||
                            fetchingFromApi ||
                            isLocked ||
                            (syncOption === "upsert" &&
                              multiLineFields.some(
                                (mf) =>
                                  (mf.sub_fields?.length ?? 0) > 0 && !(kpiSyncUpsertByFieldKey[mf.key] ?? "").trim()
                              ))
                          }
                          style={{ opacity: syncOption != null ? 1 : 0.6, marginTop: "0.25rem" }}
                          onClick={async () => {
                            if (syncOption == null) return;
                            if (syncOption === "override") {
                              const periodNote = timeDimensionLabel != null ? ` Data will apply to period: ${timeDimensionLabel} (${year}).` : "";
                              if (!window.confirm(`Are you sure you want to replace all existing data?${periodNote} This cannot be undone.`)) return;
                            }
                            if (syncOption === "upsert") {
                              const need = multiLineFields.filter((mf) => (mf.sub_fields?.length ?? 0) > 0);
                              for (const mf of need) {
                                if (!(kpiSyncUpsertByFieldKey[mf.key] ?? "").trim()) {
                                  setSaveError(`Select a match column for multi-line field "${mf.name}".`);
                                  toast.error(`Select a match column for "${mf.name}".`);
                                  return;
                                }
                              }
                            }
                            setFetchingFromApi(true);
                            setSaveError(null);
                            setSyncFeedback(null);
                            try {
                              const upsertPayload: Record<string, string> = {};
                              if (syncOption === "upsert") {
                                for (const mf of multiLineFields) {
                                  if ((mf.sub_fields?.length ?? 0) === 0) continue;
                                  const mk = (kpiSyncUpsertByFieldKey[mf.key] ?? "").trim();
                                  if (mk) upsertPayload[mf.key] = mk;
                                }
                              }
                              const q =
                                syncOption === "upsert" && Object.keys(upsertPayload).length > 0
                                  ? qs({
                                      kpi_id: kpiId,
                                      year,
                                      organization_id: effectiveOrgId!,
                                      sync_mode: syncOption,
                                      upsert_match_keys: JSON.stringify(upsertPayload),
                                    })
                                  : qs({
                                      kpi_id: kpiId,
                                      year,
                                      organization_id: effectiveOrgId!,
                                      sync_mode: syncOption,
                                    });
                              const result = await api<{ fields_updated?: number; skipped?: boolean; reason?: string }>(
                                `/entries/sync-from-api?${q}`,
                                { method: "POST", token }
                              );
                              if (result?.skipped) {
                                const msg = result.reason ?? "Sync was skipped.";
                                setSaveError(msg);
                                toast.error(msg);
                                return;
                              }
                              await loadData();
                              const n = result?.fields_updated ?? 0;
                              setSyncFeedback(n > 0 ? `${n} field(s) updated.` : "Sync completed; no fields updated.");
                              setTimeout(() => setSyncFeedback(null), 5000);
                              toast.success("Sync completed successfully");
                            } catch (err) {
                              setSaveError(err instanceof Error ? err.message : "Sync from API failed");
                              toast.error(err instanceof Error ? err.message : "Sync from API failed");
                            } finally {
                              setFetchingFromApi(false);
                            }
                          }}
                        >
                          {fetchingFromApi ? "Syncing…" : "Sync from API now"}
                        </button>
                        {syncFeedback && (
                          <p style={{ fontSize: "0.85rem", color: "var(--success)", margin: 0 }}>{syncFeedback}</p>
                        )}
                      </div>
                    )}
                  </div>
                  )}
                  </>
                  )}


                  {/* Column (subfield) access — org admin only */}
                  {false && (
                    <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                        <button
                          type="button"
                          onClick={() => setColumnAccessFieldId((prev) => (prev === f.id ? null : f.id))}
                          style={{
                            padding: "0.35rem 0.5rem",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            background: "var(--surface)",
                            fontSize: "0.85rem",
                            cursor: "pointer",
                            minWidth: 32,
                          }}
                          title={columnAccessFieldId === f.id ? "Collapse" : "Expand"}
                        >
                          {columnAccessFieldId === f.id ? "▲" : "▼"}
                        </button>
                        <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                          Column (subfield) access
                        </span>
                        <Link
                          href={`/dashboard/organizations/${effectiveOrgId}/access${kpiId ? `?kpi_id=${kpiId}` : ""}`}
                          style={{ fontSize: "0.85rem", marginLeft: "auto" }}
                        >
                          Full access control →
                        </Link>
                      </div>
                      {columnAccessFieldId === f.id && (
                        <div className="card" style={{ padding: "0.75rem", overflowX: "auto" }}>
                          {columnAccessByRoleLoading ? (
                            <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
                          ) : orgRoles.length === 0 ? (
                            <p style={{ color: "var(--muted)", margin: 0 }}>No roles. Create roles and assign users in Full access control.</p>
                          ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)", width: "30%" }}>Subfield</th>
                                  <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Access by role</th>
                                </tr>
                              </thead>
                              <tbody>
                                {subFields.map((s) => {
                                  const isAdding =
                                    columnAccessAddTarget != null &&
                                    columnAccessAddTarget.fieldId === f.id &&
                                    columnAccessAddTarget.subFieldId === s.id;
                                  return (
                                    <tr key={s.id}>
                                      <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>{s.name}</td>
                                      <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                                          {orgRoles.map((role) => {
                                            const list = columnAccessByRole[role.id] ?? [];
                                            const row = list.find((r) => r.field_id === f.id && r.sub_field_id === s.id);
                                            if (!row) return null;
                                            const saving = columnAccessByRoleSavingRoleId === role.id;
                                            const label = row.access_type === "data_entry" ? "Edit" : "View";
                                            return (
                                              <span
                                                key={role.id}
                                                style={{
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  gap: "0.25rem",
                                                  padding: "0.15rem 0.4rem",
                                                  borderRadius: 12,
                                                  background: "var(--border)",
                                                  fontSize: "0.8rem",
                                                }}
                                              >
                                                <span>{role.name}</span>
                                                <span style={{ fontWeight: 600 }}>{label}</span>
                                                <button
                                                  type="button"
                                                  disabled={saving}
                                                  onClick={async () => {
                                                    const prevList = columnAccessByRole[role.id] ?? [];
                                                    const updated = prevList.filter(
                                                      (r) => !(r.field_id === f.id && r.sub_field_id === s.id)
                                                    );
                                                    setColumnAccessByRole((prev) => ({ ...prev, [role.id]: updated }));
                                                    setColumnAccessByRoleSavingRoleId(role.id);
                                                    try {
                                                      const accesses = updated.filter(
                                                        (r) => r.access_type === "view" || r.access_type === "data_entry"
                                                      );
                                                      await api(
                                                        `/kpis/${kpiId}/field-access-by-role?${qs({
                                                          organization_id: effectiveOrgId,
                                                        })}`,
                                                        {
                                                          method: "PUT",
                                                          body: JSON.stringify({ role_id: role.id, accesses }),
                                                          token,
                                                        }
                                                      );
                                                      toast.success("Column access updated");
                                                    } catch (err) {
                                                      toast.error(
                                                        err instanceof Error ? err.message : "Failed to save"
                                                      );
                                                      setColumnAccessByRole((prev) => ({
                                                        ...prev,
                                                        [role.id]: prevList,
                                                      }));
                                                    } finally {
                                                      setColumnAccessByRoleSavingRoleId(null);
                                                    }
                                                  }}
                                                  style={{
                                                    border: "none",
                                                    background: "transparent",
                                                    cursor: "pointer",
                                                    fontSize: "0.85rem",
                                                  }}
                                                  aria-label={`Remove access for ${role.name}`}
                                                >
                                                  ×
                                                </button>
                                              </span>
                                            );
                                          })}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (isAdding) {
                                                setColumnAccessAddTarget(null);
                                                setColumnAccessAddRoleId(null);
                                              } else {
                                                setColumnAccessAddTarget({ fieldId: f.id, subFieldId: s.id });
                                                setColumnAccessAddRoleId(null);
                                                setColumnAccessAddPermission("data_entry");
                                              }
                                            }}
                                            style={{
                                              padding: "0.25rem 0.5rem",
                                              fontSize: "0.8rem",
                                              borderRadius: 6,
                                              border: "1px solid var(--border)",
                                              background: "var(--surface)",
                                              cursor: "pointer",
                                            }}
                                          >
                                            {isAdding ? "Cancel" : "Add"}
                                          </button>
                                        </div>
                                        {isAdding && (
                                          <div
                                            style={{
                                              marginTop: "0.35rem",
                                              display: "flex",
                                              flexWrap: "wrap",
                                              gap: "0.35rem",
                                              alignItems: "center",
                                            }}
                                          >
                                            <select
                                              value={columnAccessAddRoleId ?? ""}
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setColumnAccessAddRoleId(v ? Number(v) : null);
                                              }}
                                              style={{
                                                padding: "0.3rem 0.45rem",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                fontSize: "0.8rem",
                                              }}
                                            >
                                              <option value="">Select role…</option>
                                              {orgRoles
                                                .filter((role) => {
                                                  const list = columnAccessByRole[role.id] ?? [];
                                                  return !list.some(
                                                    (r) =>
                                                      r.field_id === f.id &&
                                                      r.sub_field_id === s.id &&
                                                      (r.access_type === "view" ||
                                                        r.access_type === "data_entry")
                                                  );
                                                })
                                                .map((role) => (
                                                  <option key={role.id} value={role.id}>
                                                    {role.name}
                                                  </option>
                                                ))}
                                            </select>
                                            <select
                                              value={columnAccessAddPermission}
                                              onChange={(e) =>
                                                setColumnAccessAddPermission(
                                                  e.target.value === "view" ? "view" : "data_entry"
                                                )
                                              }
                                              style={{
                                                padding: "0.3rem 0.45rem",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                fontSize: "0.8rem",
                                              }}
                                            >
                                              <option value="data_entry">Edit</option>
                                              <option value="view">View</option>
                                            </select>
                                            <button
                                              type="button"
                                              disabled={
                                                columnAccessAddRoleId == null ||
                                                columnAccessByRoleSavingRoleId === columnAccessAddRoleId
                                              }
                                              onClick={async () => {
                                                if (columnAccessAddRoleId == null) return;
                                                const roleId = columnAccessAddRoleId;
                                                const prevList = columnAccessByRole[roleId] ?? [];
                                                const updated = prevList
                                                  .filter(
                                                    (r) =>
                                                      !(
                                                        r.field_id === f.id &&
                                                        r.sub_field_id === s.id
                                                      )
                                                  )
                                                  .concat([
                                                    {
                                                      field_id: f.id,
                                                      sub_field_id: s.id,
                                                      access_type: columnAccessAddPermission,
                                                    },
                                                  ]);
                                                setColumnAccessByRole((prev) => ({
                                                  ...prev,
                                                  [roleId]: updated,
                                                }));
                                                setColumnAccessByRoleSavingRoleId(roleId);
                                                try {
                                                  const accesses = updated.filter(
                                                    (r) =>
                                                      r.access_type === "view" ||
                                                      r.access_type === "data_entry"
                                                  );
                                                  await api(
                                                    `/kpis/${kpiId}/field-access-by-role?${qs({
                                                      organization_id: effectiveOrgId,
                                                    })}`,
                                                    {
                                                      method: "PUT",
                                                      body: JSON.stringify({
                                                        role_id: roleId,
                                                        accesses,
                                                      }),
                                                      token,
                                                    }
                                                  );
                                                  toast.success("Column access updated");
                                                  setColumnAccessAddTarget(null);
                                                  setColumnAccessAddRoleId(null);
                                                } catch (err) {
                                                  toast.error(
                                                    err instanceof Error
                                                      ? err.message
                                                      : "Failed to save"
                                                  );
                                                  setColumnAccessByRole((prev) => ({
                                                    ...prev,
                                                    [roleId]: prevList,
                                                  }));
                                                } finally {
                                                  setColumnAccessByRoleSavingRoleId(null);
                                                }
                                              }}
                                              style={{
                                                padding: "0.3rem 0.7rem",
                                                borderRadius: 6,
                                                border: "1px solid var(--border)",
                                                background: "var(--primary)",
                                                color: "var(--on-muted)",
                                                fontSize: "0.8rem",
                                                cursor: "pointer",
                                              }}
                                            >
                                              Add
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add row button moved to top while editing */}
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr>
                        {subFields.map((s) => (
                          <th key={s.id} style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                            {s.name}
                          </th>
                        ))}
                        {isEditing && multiFieldCanEdit && <th style={{ width: 80, borderBottom: "1px solid var(--border)" }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={subFields.length + (isEditing && multiFieldCanEdit ? 1 : 0)} style={{ padding: "0.75rem", color: "var(--muted)" }}>
                            No rows entered.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {subFields.map((s) => (
                              <td key={s.id} style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                                {isEditing && multiFieldCanEdit && (s as SubFieldDef).can_edit !== false ? (
                                  s.field_type === "number" ? (
                                    (() => {
                                      const cellVal = row[s.key];
                                      return (
                                        <input
                                          type="number"
                                          step="any"
                                          value={typeof cellVal === "number" ? cellVal : ""}
                                          onChange={(e) => {
                                        const next = [...rows];
                                        next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value === "" ? undefined : Number(e.target.value) };
                                        setRows(next);
                                      }}
                                          style={{ width: "100%", maxWidth: 140, padding: "0.35rem" }}
                                        />
                                      );
                                    })()
                                  ) : s.field_type === "date" ? (
                                    (() => {
                                      const cellVal = row[s.key];
                                      return (
                                        <input
                                          type="date"
                                          value={typeof cellVal === "string" ? cellVal : ""}
                                          onChange={(e) => {
                                            const next = [...rows];
                                            next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value || undefined };
                                            setRows(next);
                                          }}
                                          style={{ width: "100%", maxWidth: 140, padding: "0.35rem" }}
                                        />
                                      );
                                    })()
                                  ) : s.field_type === "boolean" ? (
                                    <input
                                      type="checkbox"
                                      checked={Boolean(row[s.key])}
                                      onChange={(e) => {
                                        const next = [...rows];
                                        next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.checked };
                                        setRows(next);
                                      }}
                                    />
                                  ) : s.field_type === "reference" ? (
                                    (() => {
                                      const refKey = s.config?.reference_source_kpi_id && s.config?.reference_source_field_key
                                        ? `${s.config.reference_source_kpi_id}-${s.config.reference_source_field_key}${s.config.reference_source_sub_field_key ? `-${s.config.reference_source_sub_field_key}` : ""}`
                                        : "";
                                      const options = refAllowedValues[refKey] ?? [];
                                      const cellVal = row[s.key];
                                      const strVal = typeof cellVal === "string" ? cellVal : String(cellVal ?? "");
                                      return (
                                        <select
                                          value={strVal}
                                          onChange={(e) => {
                                            const next = [...rows];
                                            next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value || undefined };
                                            setRows(next);
                                          }}
                                          style={{ width: "100%", minWidth: 100, padding: "0.35rem" }}
                                        >
                                          <option value="">—</option>
                                          {options.map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                          ))}
                                        </select>
                                      );
                                    })()
                                  ) : s.field_type === "multi_reference" ? (
                                    (() => {
                                      const refKey = s.config?.reference_source_kpi_id && s.config?.reference_source_field_key
                                        ? `${s.config.reference_source_kpi_id}-${s.config.reference_source_field_key}${s.config.reference_source_sub_field_key ? `-${s.config.reference_source_sub_field_key}` : ""}`
                                        : "";
                                      const options = refAllowedValues[refKey] ?? [];
                                      const cellVal = row[s.key];
                                      const arr = Array.isArray(cellVal) ? (cellVal as string[]) : [];
                                      return (
                                        <div style={{ minWidth: 140, maxWidth: 320 }}>
                                          <MultiReferenceInput
                                            options={options}
                                            value={arr}
                                            onChange={(next) => {
                                              const nextRows = [...rows];
                                              nextRows[rowIdx] = { ...nextRows[rowIdx], [s.key]: next };
                                              setRows(nextRows);
                                            }}
                                          />
                                        </div>
                                      );
                                    })()
                                  ) : s.field_type === "attachment" ? (
                                    (() => {
                                      const cellVal = row[s.key];
                                      const setCell = (v: unknown) => {
                                        const next = [...rows];
                                        next[rowIdx] = { ...next[rowIdx], [s.key]: v };
                                        setRows(next);
                                      };
                                      return (
                                        <div style={{ minWidth: 160, maxWidth: 320 }}>
                                          <AttachmentFieldControl
                                            compact
                                            value={cellVal}
                                            uploadSuccessAlert={false}
                                            onUploaded={(downloadUrl, filename) => {
                                              setFormValues((prev) => {
                                                const curRows = Array.isArray(prev[f.id]?.value_json)
                                                  ? ([...(prev[f.id]!.value_json as Record<string, unknown>[])])
                                                  : [...rows];
                                                const nextRows = [...curRows];
                                                nextRows[rowIdx] = {
                                                  ...(nextRows[rowIdx] as Record<string, unknown>),
                                                  [s.key]: makeAttachmentCellValue(downloadUrl, filename),
                                                };
                                                const merged = { ...prev, [f.id]: { ...prev[f.id], value_json: nextRows } };
                                                void saveEntryWithFormValues(merged, { silent: true, keepEditing: true })
                                                  .then(() => toast.success("File attached and saved."))
                                                  .catch(() => undefined);
                                                return merged;
                                              });
                                            }}
                                            onClear={() => setCell("")}
                                            token={token}
                                            kpiId={kpiId}
                                            entryId={entry?.id ?? null}
                                            year={year}
                                            onNotAuthenticated={() => toast.error("Session expired. Please log in again.")}
                                            onError={(m) => toast.error(m)}
                                            attachDisabled={!entry || !token}
                                            emptySlot={
                                              <input
                                                type="url"
                                                value={typeof cellVal === "string" ? cellVal : ""}
                                                onChange={(e) => setCell(e.target.value)}
                                                placeholder="Paste URL (optional)"
                                                style={{
                                                  width: "100%",
                                                  minWidth: 120,
                                                  padding: "0.35rem",
                                                  fontSize: "0.85rem",
                                                  marginBottom: "0.25rem",
                                                }}
                                              />
                                            }
                                          />
                                        </div>
                                      );
                                    })()
                                  ) : (
                                    (() => {
                                      const cellVal = row[s.key];
                                      return (
                                        <input
                                          type="text"
                                          value={typeof cellVal === "string" ? cellVal : String(cellVal ?? "")}
                                          onChange={(e) => {
                                            const next = [...rows];
                                            next[rowIdx] = { ...next[rowIdx], [s.key]: e.target.value };
                                            setRows(next);
                                          }}
                                          style={{ width: "100%", minWidth: 80, padding: "0.35rem" }}
                                        />
                                      );
                                    })()
                                  )
                                ) : s.field_type === "attachment" ? (
                                  (() => {
                                    const cellVal = row[s.key];
                                    const url = getAttachmentUrl(cellVal);
                                    if (!url) return "—";
                                    return (
                                      <span title={url} style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                                        {getAttachmentDisplayName(cellVal)}
                                      </span>
                                    );
                                  })()
                                ) : (
                                  row[s.key] != null ? String(row[s.key]) : "—"
                                )}
                              </td>
                            ))}
                            {isEditing && multiFieldCanEdit && (
                              <td style={{ borderBottom: "1px solid var(--border)" }}>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => setRows(rows.filter((_, i) => i !== rowIdx))}
                                >
                                  Remove
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })}

          {/* Full-page multi-line tab content: column access + link to full page data entries */}
          {fullPageMultiLineFields.map((f) => {
            if (activeTab !== f.id) return null;
            const subFields = f.sub_fields ?? [];
            const fullPageUrl = effectiveOrgId != null
              ? `/dashboard/entries/${kpiId}/${year}/multi/${f.id}?${new URLSearchParams({
                  organization_id: String(effectiveOrgId),
                  ...(periodKeyFromUrl ? { period_key: periodKeyFromUrl } : {}),
                }).toString()}`
              : null;
            return (
              <div key={f.id} style={{ overflowX: "auto" }}>
                {/* Full-page multi-line fields open directly from the tab button above. */}

                {/* Row-based user-level access — org admin only (full-page multi-line) */}
                {false && (
                  <div style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.9rem" }}>
                      <input
                        type="checkbox"
                        checked={(f as FieldDef).row_level_user_access_enabled ?? false}
                        disabled={rowLevelAccessUpdatingFieldId === f.id}
                        onChange={async () => {
                          const next = !((f as FieldDef).row_level_user_access_enabled ?? false);
                          setRowLevelAccessUpdatingFieldId(f.id);
                          try {
                            await api(`/fields/${f.id}?${qs({ organization_id: effectiveOrgId })}`, {
                              method: "PATCH",
                              body: JSON.stringify({ row_level_user_access_enabled: next }),
                              token,
                            });
                            setFields((prev) => prev.map((field) => (field.id === f.id ? { ...field, row_level_user_access_enabled: next } : field)));
                            toast.success(next ? "Row-based user access enabled" : "Row-based user access disabled");
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed to update");
                          } finally {
                            setRowLevelAccessUpdatingFieldId(null);
                          }
                        }}
                      />
                      <span>Row-based user-level access</span>
                    </label>
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0 0 1.5rem" }}>
                      When enabled, rows are restricted by user-level row access; when disabled, all rows follow role/field access.
                    </p>
                  </div>
                )}

                {/* Column (subfield) access — same as inline multi-line */}
                {false && (
                  <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                      <button
                        type="button"
                        onClick={() => setColumnAccessFieldId((prev) => (prev === f.id ? null : f.id))}
                        style={{
                          padding: "0.35rem 0.5rem",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          background: "var(--surface)",
                          fontSize: "0.85rem",
                          cursor: "pointer",
                          minWidth: 32,
                        }}
                        title={columnAccessFieldId === f.id ? "Collapse" : "Expand"}
                      >
                        {columnAccessFieldId === f.id ? "▲" : "▼"}
                      </button>
                      <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                        Column (subfield) access
                      </span>
                      <Link
                        href={`/dashboard/organizations/${effectiveOrgId}/access${kpiId ? `?kpi_id=${kpiId}` : ""}`}
                        style={{ fontSize: "0.85rem", marginLeft: "auto" }}
                      >
                        Full access control →
                      </Link>
                    </div>
                    {columnAccessFieldId === f.id && (
                      <div className="card" style={{ padding: "0.75rem", overflowX: "auto" }}>
                        {columnAccessByRoleLoading ? (
                          <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
                        ) : orgRoles.length === 0 ? (
                          <p style={{ color: "var(--muted)", margin: 0 }}>No roles. Create roles and assign users in Full access control.</p>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)", width: "30%" }}>Subfield</th>
                                <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Access by role</th>
                              </tr>
                            </thead>
                            <tbody>
                              {subFields.map((s) => {
                                const isAdding =
                                  columnAccessAddTarget != null &&
                                  columnAccessAddTarget.fieldId === f.id &&
                                  columnAccessAddTarget.subFieldId === s.id;
                                return (
                                  <tr key={s.id}>
                                    <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>{s.name}</td>
                                    <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                                        {orgRoles.map((role) => {
                                          const list = columnAccessByRole[role.id] ?? [];
                                          const row = list.find((r) => r.field_id === f.id && r.sub_field_id === s.id);
                                          if (!row) return null;
                                          const saving = columnAccessByRoleSavingRoleId === role.id;
                                          const label = row.access_type === "data_entry" ? "Edit" : "View";
                                          return (
                                            <span
                                              key={role.id}
                                              style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "0.25rem",
                                                padding: "0.15rem 0.4rem",
                                                borderRadius: 12,
                                                background: "var(--border)",
                                                fontSize: "0.8rem",
                                              }}
                                            >
                                              <span>{role.name}</span>
                                              <span style={{ fontWeight: 600 }}>{label}</span>
                                              <button
                                                type="button"
                                                disabled={saving}
                                                onClick={async () => {
                                                  const prevList = columnAccessByRole[role.id] ?? [];
                                                  const updated = prevList.filter(
                                                    (r) => !(r.field_id === f.id && r.sub_field_id === s.id)
                                                  );
                                                  setColumnAccessByRole((prev) => ({ ...prev, [role.id]: updated }));
                                                  setColumnAccessByRoleSavingRoleId(role.id);
                                                  try {
                                                    const accesses = updated.filter(
                                                      (r) => r.access_type === "view" || r.access_type === "data_entry"
                                                    );
                                                    await api(
                                                      `/kpis/${kpiId}/field-access-by-role?${qs({
                                                        organization_id: effectiveOrgId,
                                                      })}`,
                                                      {
                                                        method: "PUT",
                                                        body: JSON.stringify({ role_id: role.id, accesses }),
                                                        token,
                                                      }
                                                    );
                                                    toast.success("Column access updated");
                                                  } catch (err) {
                                                    toast.error(
                                                      err instanceof Error ? err.message : "Failed to save"
                                                    );
                                                    setColumnAccessByRole((prev) => ({
                                                      ...prev,
                                                      [role.id]: prevList,
                                                    }));
                                                  } finally {
                                                    setColumnAccessByRoleSavingRoleId(null);
                                                  }
                                                }}
                                                style={{
                                                  border: "none",
                                                  background: "transparent",
                                                  cursor: "pointer",
                                                  fontSize: "0.85rem",
                                                }}
                                                aria-label={`Remove access for ${role.name}`}
                                              >
                                                ×
                                              </button>
                                            </span>
                                          );
                                        })}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (isAdding) {
                                              setColumnAccessAddTarget(null);
                                              setColumnAccessAddRoleId(null);
                                            } else {
                                              setColumnAccessAddTarget({ fieldId: f.id, subFieldId: s.id });
                                              setColumnAccessAddRoleId(null);
                                              setColumnAccessAddPermission("data_entry");
                                            }
                                          }}
                                          style={{
                                            padding: "0.25rem 0.5rem",
                                            fontSize: "0.8rem",
                                            borderRadius: 6,
                                            border: "1px solid var(--border)",
                                            background: "var(--surface)",
                                            cursor: "pointer",
                                          }}
                                        >
                                          {isAdding ? "Cancel" : "Add"}
                                        </button>
                                      </div>
                                      {isAdding && (
                                        <div
                                          style={{
                                            marginTop: "0.35rem",
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: "0.35rem",
                                            alignItems: "center",
                                          }}
                                        >
                                          <select
                                            value={columnAccessAddRoleId ?? ""}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setColumnAccessAddRoleId(v ? Number(v) : null);
                                            }}
                                            style={{
                                              padding: "0.3rem 0.45rem",
                                              borderRadius: 6,
                                              border: "1px solid var(--border)",
                                              fontSize: "0.8rem",
                                            }}
                                          >
                                            <option value="">Select role…</option>
                                            {orgRoles
                                              .filter((role) => {
                                                const list = columnAccessByRole[role.id] ?? [];
                                                return !list.some(
                                                  (r) =>
                                                    r.field_id === f.id &&
                                                    r.sub_field_id === s.id &&
                                                    (r.access_type === "view" ||
                                                      r.access_type === "data_entry")
                                                );
                                              })
                                              .map((role) => (
                                                <option key={role.id} value={role.id}>
                                                  {role.name}
                                                </option>
                                              ))}
                                          </select>
                                          <select
                                            value={columnAccessAddPermission}
                                            onChange={(e) =>
                                              setColumnAccessAddPermission(
                                                e.target.value === "view" ? "view" : "data_entry"
                                              )
                                            }
                                            style={{
                                              padding: "0.3rem 0.45rem",
                                              borderRadius: 6,
                                              border: "1px solid var(--border)",
                                              fontSize: "0.8rem",
                                            }}
                                          >
                                            <option value="data_entry">Edit</option>
                                            <option value="view">View</option>
                                          </select>
                                          <button
                                            type="button"
                                            disabled={
                                              columnAccessAddRoleId == null ||
                                              columnAccessByRoleSavingRoleId === columnAccessAddRoleId
                                            }
                                            onClick={async () => {
                                              if (columnAccessAddRoleId == null) return;
                                              const roleId = columnAccessAddRoleId;
                                              const prevList = columnAccessByRole[roleId] ?? [];
                                              const updated = prevList
                                                .filter(
                                                  (r) =>
                                                    !(
                                                      r.field_id === f.id &&
                                                      r.sub_field_id === s.id
                                                    )
                                                )
                                                .concat([
                                                  {
                                                    field_id: f.id,
                                                    sub_field_id: s.id,
                                                    access_type: columnAccessAddPermission,
                                                  },
                                                ]);
                                              setColumnAccessByRole((prev) => ({
                                                ...prev,
                                                [roleId]: updated,
                                              }));
                                              setColumnAccessByRoleSavingRoleId(roleId);
                                              try {
                                                const accesses = updated.filter(
                                                  (r) =>
                                                    r.access_type === "view" ||
                                                    r.access_type === "data_entry"
                                                );
                                                await api(
                                                  `/kpis/${kpiId}/field-access-by-role?${qs({
                                                    organization_id: effectiveOrgId,
                                                  })}`,
                                                  {
                                                    method: "PUT",
                                                    body: JSON.stringify({
                                                      role_id: roleId,
                                                      accesses,
                                                    }),
                                                    token,
                                                  }
                                                );
                                                toast.success("Column access updated");
                                                setColumnAccessAddTarget(null);
                                                setColumnAccessAddRoleId(null);
                                              } catch (err) {
                                                toast.error(
                                                  err instanceof Error ? err.message : "Failed to save"
                                                );
                                                setColumnAccessByRole((prev) => ({
                                                  ...prev,
                                                  [roleId]: prevList,
                                                }));
                                              } finally {
                                                setColumnAccessByRoleSavingRoleId(null);
                                              }
                                            }}
                                            style={{
                                              padding: "0.3rem 0.7rem",
                                              borderRadius: 6,
                                              border: "1px solid var(--border)",
                                              background: "var(--primary)",
                                              color: "var(--on-muted)",
                                              fontSize: "0.8rem",
                                              cursor: "pointer",
                                            }}
                                          >
                                            Add
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Section 4: Reverse-reference tabs – child KPIs that reference this KPI via multi_line_items */}
      {reverseRefTabs.length > 0 && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
            <strong>Related records (referencing KPIs)</strong>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
              These KPIs reference this record via reference sub-fields in multi-line items. Data is read-only here.
            </p>
            {reverseRefTimeFilter && (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Filtered by time dimension: <strong>{reverseRefTimeFilter.year}</strong>
                {reverseRefTimeFilter.period_key ? ` · ${reverseRefTimeFilter.period_key}` : ""}
                <span style={{ color: "var(--muted)", fontWeight: "normal" }}>
                  {" "}({reverseRefTimeFilter.effective_time_dimension.replace(/_/g, " ")})
                </span>
              </p>
            )}
          </div>
          <div style={{ padding: "0.75rem 1rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
              {reverseRefTabs.map((tab) => (
                <button
                  key={tab.child_kpi_id}
                  type="button"
                  className="btn"
                  style={reverseRefActiveKpiId === tab.child_kpi_id ? { background: "var(--accent)", color: "var(--on-muted)" } : {}}
                  onClick={() => setReverseRefActiveKpiId(tab.child_kpi_id)}
                >
                  {tab.child_kpi_name}
                </button>
              ))}
            </div>
            {reverseRefTabs.map((tab) => {
              if (reverseRefActiveKpiId !== tab.child_kpi_id) return null;
              const selectedToken = reverseRefSelectedTokenByKpi[tab.child_kpi_id] ?? (tab.values[0]?.token ?? "");
              const rowsForToken = tab.rows.filter((r) => r.value_token === selectedToken);
              const selectedMeta = tab.values.find((v) => v.token === selectedToken);
              return (
                <div key={tab.child_kpi_id}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                    <label style={{ fontSize: "0.9rem", fontWeight: 500 }}>Select value</label>
                    <select
                      value={selectedToken}
                      onChange={(e) =>
                        setReverseRefSelectedTokenByKpi((prev) => ({ ...prev, [tab.child_kpi_id]: e.target.value }))
                      }
                      style={{
                        minWidth: 200,
                        padding: "0.4rem 0.5rem",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {tab.values.map((v) => (
                        <option key={v.token} value={v.token}>
                          {v.label} ({v.count})
                        </option>
                      ))}
                    </select>
                    {selectedMeta && (
                      <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                        Showing {rowsForToken.length} row(s) referencing this value.
                      </span>
                    )}
                  </div>
                  {rowsForToken.length === 0 ? (
                    <p style={{ fontSize: "0.9rem", color: "var(--muted)" }}>No related rows for the selected value.</p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
                        <thead>
                          <tr>
                            <th style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Year</th>
                            <th style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Period</th>
                            {tab.sub_fields.map((sf) => (
                              <th
                                key={sf.key}
                                style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", textAlign: "left" }}
                              >
                                {sf.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rowsForToken.map((row) => (
                            <tr key={`${row.entry_id}-${row.row_index}`}>
                              <td style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)" }}>{row.year}</td>
                              <td style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)" }}>
                                {row.period_key || "—"}
                              </td>
                              {tab.sub_fields.map((sf) => (
                                <td key={sf.key} style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)" }}>
                                  {String((row.row as Record<string, unknown>)[sf.key] ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

        </>
      )}

      {/* Field-level rights modal (org admin) */}
      {fieldRightsModalUserId != null && (meRole === "ORG_ADMIN" || meRole === "SUPER_ADMIN") && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setFieldRightsModalUserId(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 520,
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
              padding: "1.25rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Field-level rights</h2>
              <button type="button" className="btn" onClick={() => setFieldRightsModalUserId(null)} aria-label="Close">×</button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1rem" }}>
              Set view or edit per field for this user. If you clear all, they use the KPI-level permission for every field.
            </p>
            {fieldRightsLoading ? (
              <p style={{ color: "var(--muted)" }}>Loading…</p>
            ) : (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Field</th>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldRightsAccessList.map((row, idx) => {
                      const field = fields.find((f) => f.id === row.field_id);
                      return (
                        <tr key={`${row.field_id}-${row.sub_field_id ?? ""}`}>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                            {field ? field.name : `Field #${row.field_id}`}
                          </td>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)" }}>
                            <select
                              value={row.access_type}
                              onChange={(e) => {
                                const v = e.target.value;
                                setFieldRightsAccessList((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, access_type: v } : r))
                                );
                              }}
                              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", minWidth: 120 }}
                            >
                              <option value="view">View</option>
                              <option value="data_entry">Edit</option>
                              <option value="">No access</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {fieldRightsAccessList.length === 0 && !fieldRightsLoading && (
                  <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No fields. Save with empty list to use KPI-level permission for all.</p>
                )}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={fieldRightsSaving}
                    onClick={async () => {
                      if (!token) return;
                      if (effectiveOrgId == null) {
                        toast.error("Organization context is missing. Please refresh or open this KPI from an organization context.");
                        return;
                      }
                      setFieldRightsSaving(true);
                      try {
                        const accesses = fieldRightsAccessList
                          .filter((r) => r.access_type === "view" || r.access_type === "data_entry")
                          .map((r) => ({ field_id: r.field_id, sub_field_id: r.sub_field_id, access_type: r.access_type }));
                        await api(`/kpis/${kpiId}/field-access?${qs({ organization_id: effectiveOrgId })}`, {
                          method: "PUT",
                          body: JSON.stringify({ user_id: fieldRightsModalUserId, accesses }),
                          token,
                        });
                        toast.success("Field rights saved");
                        setFieldRightsModalUserId(null);
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : "Failed to save field rights";
                        toast.error(msg);
                      } finally {
                        setFieldRightsSaving(false);
                      }
                    }}
                  >
                    {fieldRightsSaving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="btn" onClick={() => setFieldRightsModalUserId(null)}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
