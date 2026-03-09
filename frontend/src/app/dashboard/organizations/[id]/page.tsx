"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { getAccessToken, clearTokens, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";
import { ApiExportContent } from "./ApiExportContent";
import {
  buildReportPrintDocument,
  openReportPrintWindow,
  type ReportData,
} from "@/app/dashboard/reports/reportPrint";
import { ReportLoadProgress } from "@/app/dashboard/reports/ReportLoadProgress";

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

type TabId = "overview" | "domains" | "kpis" | "reports" | "settings";
type SettingsSubId = "storage" | "time_dimension" | "tags" | "organization" | "admin_user" | "api_export";

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
  time_dimension?: string;
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

interface CategoryRow {
  id: number;
  domain_id: number;
  name: string;
  domain_name?: string | null;
}

interface KpiRow {
  id: number;
  organization_id?: number;
  domain_id: number | null;
  name: string;
  description: string | null;
  year?: number | null;
  sort_order: number;
  entry_mode?: string;
  api_endpoint_url?: string | null;
  fields_count?: number;
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

/** Build example JSON response that the bound API should return for this KPI (for API binding UI). */
function buildExampleApiResponse(fields: KpiField[], year: number): { year: number; values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.field_type === "formula") continue;
    if (f.field_type === "single_line_text") values[f.key] = "Example text";
    else if (f.field_type === "multi_line_text") values[f.key] = "First paragraph.\n\nSecond paragraph.";
    else if (f.field_type === "number") values[f.key] = 100;
    else if (f.field_type === "date") values[f.key] = "2025-01-15";
    else if (f.field_type === "boolean") values[f.key] = 1;
    else if (f.field_type === "multi_line_items") {
      const subs = f.sub_fields ?? [];
      const subKeys = subs.map((s) => s.key);
      const keys = subKeys.length ? subKeys : ["item_name", "quantity"];
      const numeric = new Set(subs.filter((s) => s.field_type === "number").map((s) => s.key));
      values[f.key] = [
        Object.fromEntries(keys.map((k) => [k, numeric.has(k) ? 85 : "Alice"])),
        Object.fromEntries(keys.map((k) => [k, numeric.has(k) ? 90 : "Bob"])),
      ];
    }
  }
  return { year, values };
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
  sort_order: z.coerce.number().int().min(0),
  entry_mode: z.enum(["manual", "api"]),
  api_endpoint_url: z.string().max(2048).optional(),
  organization_tag_ids: z.array(z.number().int()).optional(),
});

const kpiUpdateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
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

const TAB_IDS: TabId[] = ["overview", "domains", "kpis", "reports", "settings"];
const SETTINGS_SUB_IDS: SettingsSubId[] = ["storage", "time_dimension", "tags", "organization", "admin_user", "api_export"];

export default function OrganizationDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orgId = Number(params.id);
  const token = getAccessToken();
  const tabFromUrl = searchParams.get("tab") as TabId | null;
  const settingsSubFromUrl = searchParams.get("sub") as SettingsSubId | null;
  const initialTab: TabId =
    tabFromUrl && TAB_IDS.includes(tabFromUrl)
      ? tabFromUrl
      : "overview";

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [settingsSub, setSettingsSub] = useState<SettingsSubId>(
    settingsSubFromUrl && SETTINGS_SUB_IDS.includes(settingsSubFromUrl) ? settingsSubFromUrl : "storage"
  );
  const [domains, setDomains] = useState<DomainWithSummary[]>([]);
  useEffect(() => {
    if (tabFromUrl && TAB_IDS.includes(tabFromUrl)) {
      setTab(tabFromUrl);
    } else {
      setTab("overview");
    }
  }, [tabFromUrl]);
  useEffect(() => {
    if (tab === "settings" && settingsSubFromUrl && SETTINGS_SUB_IDS.includes(settingsSubFromUrl)) {
      setSettingsSub(settingsSubFromUrl);
    }
  }, [tab, settingsSubFromUrl]);
  const [orgTags, setOrgTags] = useState<OrgTagRow[]>([]);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [kpiFilterName, setKpiFilterName] = useState("");
  const [kpiFilterDomainId, setKpiFilterDomainId] = useState<number | null>(null);
  const [kpiFilterCategoryId, setKpiFilterCategoryId] = useState<number | null>(null);
  const [kpiFilterTagId, setKpiFilterTagId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [domainShowCreate, setDomainShowCreate] = useState(false);
  const [domainEditingId, setDomainEditingId] = useState<number | null>(null);
  const [kpiShowCreate, setKpiShowCreate] = useState(false);
  const [kpiEditingId, setKpiEditingId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [timeDimension, setTimeDimension] = useState(org?.time_dimension ?? "yearly");
  const [timeDimensionSaving, setTimeDimensionSaving] = useState(false);
  const [overviewSummary, setOverviewSummary] = useState<{
    domainCount: number;
    categoryCount: number;
    kpiTotal: number;
    kpiManual: number;
    kpiApi: number;
    tagCount: number;
    reportCount: number;
  } | null>(null);

  useEffect(() => {
    setTimeDimension(org?.time_dimension ?? "yearly");
  }, [org?.time_dimension]);

  useEffect(() => {
    if (!token || !orgId) return;
    Promise.all([
      api<DomainWithSummary[]>(`/domains?${qs({ organization_id: orgId, with_summary: true })}`, { token }),
      api<KpiRow[]>(`/kpis?${qs({ organization_id: orgId })}`, { token }),
      api<OrgTagRow[]>(`/organizations/${orgId}/tags`, { token }),
      api<{ id: number }[]>(`/reports/templates?${qs({ organization_id: orgId })}`, { token }),
    ])
      .then(([domainsList, kpisList, tagsList, reportsList]) => {
        const categoryCount = domainsList.reduce((s, d) => s + (d.summary?.category_count ?? 0), 0);
        const kpiManual = kpisList.filter((k) => (k.entry_mode ?? "manual") === "manual").length;
        const kpiApi = kpisList.filter((k) => k.entry_mode === "api").length;
        setOverviewSummary({
          domainCount: domainsList.length,
          categoryCount,
          kpiTotal: kpisList.length,
          kpiManual,
          kpiApi,
          tagCount: tagsList.length,
          reportCount: reportsList.length,
        });
      })
      .catch(() => setOverviewSummary(null));
  }, [orgId, token]);

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

  const loadCategories = () => {
    if (!token || !orgId) return;
    api<CategoryRow[]>(`/categories?${qs({ organization_id: orgId })}`, { token })
      .then(setCategories)
      .catch(() => setCategories([]));
  };

  const loadKpis = () => {
    if (!token || !orgId) return;
    setError(null);
    const params: Record<string, string | number> = { organization_id: orgId };
    if (kpiFilterName?.trim()) params.name = kpiFilterName.trim();
    if (kpiFilterDomainId != null) params.domain_id = kpiFilterDomainId;
    if (kpiFilterCategoryId != null) params.category_id = kpiFilterCategoryId;
    if (kpiFilterTagId != null) params.organization_tag_id = kpiFilterTagId;
    api<KpiRow[]>(`/kpis?${qs(params)}`, { token })
      .then(setKpis)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  useEffect(() => {
    loadOrg();
  }, [orgId]);

  useEffect(() => {
    loadDomains();
    loadOrgTags();
    loadCategories();
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    loadKpis();
  }, [orgId, kpiFilterName, kpiFilterDomainId, kpiFilterCategoryId, kpiFilterTagId]);

  useEffect(() => {
    if (!token) return;
    api<{ role: UserRole }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  const domainById = (id: number) => domains.find((d) => d.id === id)?.name ?? `Domain #${id}`;

  if (!orgId || isNaN(orgId)) {
    return (
      <div>
        <p className="form-error">Invalid organization.</p>
        <Link href="/dashboard/organizations">Organizations</Link>
      </div>
    );
  }

  const updateUrl = (newTab: TabId, newSub?: SettingsSubId) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", newTab);
    if (newTab === "settings" && newSub) p.set("sub", newSub);
    else p.delete("sub");
    router.replace(`/dashboard/organizations/${orgId}?${p.toString()}`, { scroll: false });
  };

  return (
    <div>
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {tab === "overview" && (
        <OrganizationOverviewCards
          orgId={orgId}
          summary={overviewSummary}
          updateUrl={updateUrl}
        />
      )}

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
          categories={categories}
          orgTags={orgTags}
          loadOrgTags={loadOrgTags}
          filterName={kpiFilterName}
          setFilterName={setKpiFilterName}
          filterDomainId={kpiFilterDomainId}
          setFilterDomainId={(id) => {
            setKpiFilterDomainId(id);
            setKpiFilterCategoryId(null);
          }}
          filterCategoryId={kpiFilterCategoryId}
          setFilterCategoryId={setKpiFilterCategoryId}
          filterTagId={kpiFilterTagId}
          setFilterTagId={setKpiFilterTagId}
          list={kpis}
          loadList={loadKpis}
          showCreate={kpiShowCreate}
          setShowCreate={setKpiShowCreate}
          editingId={kpiEditingId}
          setEditingId={setKpiEditingId}
          userRole={userRole}
          onManageFields={(kpiId) => router.push(`/dashboard/kpis/${kpiId}/fields?organization_id=${orgId}`)}
        />
      )}

      {tab === "reports" && (userRole === "SUPER_ADMIN" || userRole === "ORG_ADMIN") && (
        <ReportsSection
          orgId={orgId}
          token={token!}
          userRole={userRole}
        />
      )}

      {tab === "settings" && userRole === "SUPER_ADMIN" && (
        <SettingsPage
          orgId={orgId}
          org={org}
          token={token!}
          orgTags={orgTags}
          loadOrgTags={loadOrgTags}
          settingsSub={settingsSub}
          setSettingsSub={(sub) => { setSettingsSub(sub); updateUrl("settings", sub); }}
          timeDimension={timeDimension}
          setTimeDimension={setTimeDimension}
          timeDimensionSaving={timeDimensionSaving}
          setTimeDimensionSaving={setTimeDimensionSaving}
          loadOrg={loadOrg}
        />
      )}
    </div>
  );
}

const cardLinkStyle = {
  display: "block",
  padding: "1.25rem",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "inherit",
  textDecoration: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
} as const;

function OrganizationOverviewCards({
  orgId,
  summary,
  updateUrl,
}: {
  orgId: number;
  summary: { domainCount: number; categoryCount: number; kpiTotal: number; kpiManual: number; kpiApi: number; tagCount: number; reportCount: number } | null;
  updateUrl: (tab: TabId, sub?: SettingsSubId) => void;
}) {
  if (!summary) {
    return <p style={{ color: "var(--muted)" }}>Loading overview…</p>;
  }
  const cards: { id: string; title: string; icon: React.ReactNode; lines: string[]; href?: string; onClick?: () => void }[] = [
    {
      id: "kpis",
      title: "KPIs",
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
        </svg>
      ),
      lines: [
        `${summary.kpiTotal} total KPIs`,
        `${summary.kpiManual} manual entry`,
        `${summary.kpiApi} API-bound`,
      ],
      onClick: () => updateUrl("kpis"),
    },
    {
      id: "domains",
      title: "Domains",
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <path d="M2 10h20" />
        </svg>
      ),
      lines: [
        `${summary.domainCount} domains`,
        `${summary.categoryCount} categories`,
      ],
      onClick: () => updateUrl("domains"),
    },
    {
      id: "reports",
      title: "Reports",
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
        </svg>
      ),
      lines: [
        `${summary.reportCount} report template${summary.reportCount !== 1 ? "s" : ""}`,
      ],
      onClick: () => updateUrl("reports"),
    },
    {
      id: "chat",
      title: "Chat with Data",
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      lines: ["Ask questions about your KPI data in natural language."],
      href: `/dashboard/chat?organization_id=${orgId}`,
    },
    {
      id: "settings",
      title: "Settings",
      icon: (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
      lines: ["Storage, time dimension, tags.", `${summary.tagCount} tag${summary.tagCount !== 1 ? "s" : ""} configured.`],
      onClick: () => updateUrl("settings", "storage"),
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1.25rem" }}>
      {cards.map((card) => {
        const content = (
          <>
            <div style={{ color: "var(--accent)", marginBottom: "0.75rem" }}>{card.icon}</div>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem", fontWeight: 600 }}>{card.title}</h3>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
              {card.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </>
        );
        if (card.href) {
          return (
            <Link key={card.id} href={card.href} style={cardLinkStyle}>
              {content}
            </Link>
          );
        }
        return (
          <button
            key={card.id}
            type="button"
            onClick={card.onClick}
            style={{ ...cardLinkStyle, width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" }}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

const SETTINGS_SUB_LABELS: Record<SettingsSubId, string> = {
  storage: "Storage settings",
  time_dimension: "Time dimension",
  tags: "Tags settings",
  organization: "Organization",
  admin_user: "Admin user",
  api_export: "API export",
};

interface UserResponse {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  organization_id: number | null;
  is_active: boolean;
}

const orgUpdateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  is_active: z.boolean(),
});
const adminEditSchema = z.object({
  username: z.string().min(1, "Username required").max(100),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  full_name: z.string().optional(),
  password: z.union([z.string().min(8, "Min 8 characters"), z.literal("")]).optional(),
});
type OrgUpdateFormData = z.infer<typeof orgUpdateSchema>;
type AdminEditFormData = z.infer<typeof adminEditSchema>;

function SettingsPage({
  orgId,
  org,
  token,
  orgTags,
  loadOrgTags,
  settingsSub,
  setSettingsSub,
  timeDimension,
  setTimeDimension,
  timeDimensionSaving,
  setTimeDimensionSaving,
  loadOrg,
}: {
  orgId: number;
  org: OrgInfo | null;
  token: string;
  orgTags: OrgTagRow[];
  loadOrgTags: () => void;
  settingsSub: SettingsSubId;
  setSettingsSub: (s: SettingsSubId) => void;
  timeDimension: string;
  setTimeDimension: (s: string) => void;
  timeDimensionSaving: boolean;
  setTimeDimensionSaving: (v: boolean) => void;
  loadOrg: () => void;
}) {
  const [settingsSearch, setSettingsSearch] = useState("");
  const sortedSubIds = useMemo(() => {
    const byLabel = [...SETTINGS_SUB_IDS].sort((a, b) =>
      SETTINGS_SUB_LABELS[a].localeCompare(SETTINGS_SUB_LABELS[b], undefined, { sensitivity: "base" })
    );
    if (!settingsSearch.trim()) return byLabel;
    const q = settingsSearch.trim().toLowerCase();
    return byLabel.filter((sub) => SETTINGS_SUB_LABELS[sub].toLowerCase().includes(q));
  }, [settingsSearch]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "1.5rem", alignItems: "start", maxWidth: 960 }}>
      <nav className="card" style={{ padding: "0.5rem 0", position: "sticky", top: "1rem" }}>
        <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
          <input
            type="search"
            placeholder="Search settings…"
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "0.45rem 0.6rem",
              fontSize: "0.9rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
            }}
          />
        </div>
        {sortedSubIds.map((sub) => (
          <button
            key={sub}
            type="button"
            onClick={() => setSettingsSub(sub)}
            style={{
              display: "block",
              width: "100%",
              padding: "0.6rem 1rem",
              textAlign: "left",
              border: "none",
              background: settingsSub === sub ? "var(--accent-subtle, rgba(0,0,0,0.06))" : "transparent",
              font: "inherit",
              fontSize: "0.95rem",
              color: settingsSub === sub ? "var(--accent)" : "var(--text)",
              cursor: "pointer",
              borderLeft: settingsSub === sub ? "3px solid var(--accent)" : "3px solid transparent",
            }}
          >
            {SETTINGS_SUB_LABELS[sub]}
          </button>
        ))}
      </nav>
      <div className="card" style={{ padding: "1.25rem" }}>
        {settingsSub === "storage" && <StorageConfigSection orgId={orgId} token={token} />}
        {settingsSub === "time_dimension" && (
          <div>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Time dimension</h3>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
              Default reporting period for this organization. KPIs can use this or a finer dimension (e.g. Quarterly when org is Yearly).
            </p>
            <div className="form-group">
              <label htmlFor="time_dimension">Period</label>
              <select
                id="time_dimension"
                value={timeDimension}
                onChange={(e) => setTimeDimension(e.target.value)}
                disabled={timeDimensionSaving}
                style={{ maxWidth: 240 }}
              >
                <option value="yearly">Yearly</option>
                <option value="half_yearly">Half-yearly</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={timeDimensionSaving || !token}
              onClick={async () => {
                if (!token || !orgId) return;
                setTimeDimensionSaving(true);
                try {
                  await api(`/organizations/${orgId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ time_dimension: timeDimension }),
                    token,
                  });
                  loadOrg();
                } catch {
                  // leave state unchanged
                } finally {
                  setTimeDimensionSaving(false);
                }
              }}
            >
              {timeDimensionSaving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
        {settingsSub === "tags" && (
          <TagsSection orgId={orgId} token={token} list={orgTags} loadList={loadOrgTags} />
        )}
        {settingsSub === "organization" && (
          <OrganizationSettingsSection orgId={orgId} org={org} token={token} loadOrg={loadOrg} />
        )}
        {settingsSub === "admin_user" && (
          <AdminUserSettingsSection orgId={orgId} token={token} />
        )}
        {settingsSub === "api_export" && (
          <ApiExportContent orgId={orgId} token={token} />
        )}
      </div>
    </div>
  );
}

function OrganizationSettingsSection({
  orgId,
  org,
  token,
  loadOrg,
}: {
  orgId: number;
  org: OrgInfo | null;
  token: string;
  loadOrg: () => void;
}) {
  const [adminUser, setAdminUser] = useState<UserResponse | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [orgSaveError, setOrgSaveError] = useState<string | null>(null);
  const [adminSaveError, setAdminSaveError] = useState<string | null>(null);

  const orgForm = useForm<OrgUpdateFormData>({
    resolver: zodResolver(orgUpdateSchema),
    defaultValues: {
      name: org?.name ?? "",
      description: org?.description ?? "",
      is_active: true,
    },
  });
  useEffect(() => {
    orgForm.reset({
      name: org?.name ?? "",
      description: org?.description ?? "",
      is_active: org?.is_active ?? true,
    });
  }, [org?.name, org?.description, org?.is_active]);

  const onOrgSubmit = async (data: OrgUpdateFormData) => {
    setOrgSaveError(null);
    try {
      await api(`/organizations/${orgId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ name: data.name, description: data.description || null, is_active: org?.is_active ?? true }),
      });
      loadOrg();
      toast.success("Organization updated successfully");
    } catch (e) {
      setOrgSaveError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };
  const toggleActive = async () => {
    if (!org) return;
    setOrgSaveError(null);
    try {
      await api(`/organizations/${orgId}`, { method: "PATCH", token, body: JSON.stringify({ is_active: !org.is_active }) });
      loadOrg();
      toast.success(org.is_active ? "Organization deactivated" : "Organization activated");
    } catch (e) {
      setOrgSaveError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Organization</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        Edit organization name and description. Use the toggle to activate or deactivate the organization.
      </p>
      {orgSaveError && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{orgSaveError}</p>}
      <form onSubmit={orgForm.handleSubmit(onOrgSubmit)} style={{ marginBottom: "1rem" }}>
        <div className="form-group">
          <label>Name *</label>
          <input {...orgForm.register("name")} />
          {orgForm.formState.errors.name && <p className="form-error">{orgForm.formState.errors.name.message}</p>}
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea {...orgForm.register("description")} rows={2} />
        </div>
        <div className="form-group" style={{ marginBottom: "1rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer", userSelect: "none" }}>
            <span style={{ fontWeight: 500 }}>Active</span>
            <button
              type="button"
              role="switch"
              aria-checked={org?.is_active ?? false}
              onClick={toggleActive}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: "none",
                background: org?.is_active ? "var(--success)" : "var(--muted)",
                cursor: "pointer",
                position: "relative",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: org?.is_active ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  transition: "left 0.2s ease",
                }}
              />
            </button>
            <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
              {org?.is_active ? "Organization is active" : "Organization is inactive"}
            </span>
          </label>
        </div>
        <button type="submit" className="btn btn-primary" disabled={orgForm.formState.isSubmitting}>
          {orgForm.formState.isSubmitting ? "Saving…" : "Save organization"}
        </button>
      </form>
    </div>
  );
}

function AdminUserSettingsSection({ orgId, token }: { orgId: number; token: string }) {
  const [adminUser, setAdminUser] = useState<UserResponse | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [adminSaveError, setAdminSaveError] = useState<string | null>(null);

  const adminForm = useForm<AdminEditFormData>({
    resolver: zodResolver(adminEditSchema),
    defaultValues: {
      username: "",
      email: "",
      full_name: "",
      password: "",
    },
  });

  useEffect(() => {
    if (!token || !orgId) return;
    setLoadingAdmin(true);
    api<UserResponse[]>(`/users?organization_id=${orgId}`, { token })
      .then((users) => {
        const admin = users.find((u) => u.role === "ORG_ADMIN") ?? users[0] ?? null;
        setAdminUser(admin);
      })
      .catch(() => setAdminUser(null))
      .finally(() => setLoadingAdmin(false));
  }, [orgId, token]);

  useEffect(() => {
    adminForm.reset({
      username: adminUser?.username ?? "",
      email: adminUser?.email ?? "",
      full_name: adminUser?.full_name ?? "",
      password: "",
    });
  }, [adminUser]);

  const onAdminSubmit = async (data: AdminEditFormData) => {
    if (!adminUser) return;
    setAdminSaveError(null);
    try {
      const body: Record<string, unknown> = { username: data.username, email: data.email || null, full_name: data.full_name || null };
      if (data.password && data.password.trim().length >= 8) body.password = data.password;
      await api(`/users/${adminUser.id}?organization_id=${orgId}`, { method: "PATCH", token, body: JSON.stringify(body) });
      toast.success("Admin updated successfully");
    } catch (e) {
      setAdminSaveError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Admin user</h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        Edit the organization admin user (username, email, full name, password).
      </p>
      {adminSaveError && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{adminSaveError}</p>}
      {loadingAdmin ? (
        <p style={{ color: "var(--muted)" }}>Loading admin…</p>
      ) : adminUser ? (
        <form onSubmit={adminForm.handleSubmit(onAdminSubmit)}>
          <div className="form-group">
            <label>Username *</label>
            <input {...adminForm.register("username")} />
            {adminForm.formState.errors.username && <p className="form-error">{adminForm.formState.errors.username.message}</p>}
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" {...adminForm.register("email")} />
          </div>
          <div className="form-group">
            <label>Full name</label>
            <input {...adminForm.register("full_name")} />
          </div>
          <div className="form-group">
            <label>New password (leave blank to keep current)</label>
            <input type="password" {...adminForm.register("password")} placeholder="Optional" />
            {adminForm.formState.errors.password && <p className="form-error">{adminForm.formState.errors.password.message}</p>}
          </div>
          <button type="submit" className="btn btn-primary" disabled={adminForm.formState.isSubmitting}>
            {adminForm.formState.isSubmitting ? "Saving…" : "Save admin"}
          </button>
        </form>
      ) : (
        <p style={{ color: "var(--muted)" }}>No org admin user found.</p>
      )}
    </div>
  );
}

const STORAGE_TYPES = [
  { value: "local", label: "Local (server path)" },
  { value: "gcs", label: "Google Cloud Storage" },
  { value: "ftp", label: "FTP" },
  { value: "s3", label: "Amazon S3" },
  { value: "onedrive", label: "OneDrive" },
] as const;

interface StorageConfigResponse {
  organization_id: number;
  storage_type: string;
  params: Record<string, string | number | undefined>;
  created_at: string | null;
  updated_at: string | null;
}

function StorageConfigSection({ orgId, token }: { orgId: number; token: string }) {
  const [config, setConfig] = useState<StorageConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{ storage_type: string; params: Record<string, string> }>({
    storage_type: "local",
    params: {},
  });

  const loadConfig = () => {
    setLoading(true);
    api<StorageConfigResponse>(`/organizations/${orgId}/storage-config`, { token })
      .then((c) => {
        setConfig(c);
        setForm((prev) => ({
          storage_type: c.storage_type,
          params: { ...prev.params, ...Object.fromEntries(Object.entries(c.params).filter(([, v]) => v !== "***" && v !== undefined) as [string, string][]) },
        }));
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadConfig();
  }, [orgId, token]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    api<StorageConfigResponse>(`/organizations/${orgId}/storage-config`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ storage_type: form.storage_type, params: form.params }),
    })
      .then((c) => {
        setConfig(c);
        setMessage("Saved. Secrets are stored securely and are not displayed after save.");
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Failed to save"))
      .finally(() => setSaving(false));
  };

  const updateParam = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, params: { ...prev.params, [key]: value } }));
  };

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading storage config…</p>;

  return (
    <div style={{ maxWidth: "32rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Storage configuration</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        Choose where this organization&apos;s files (e.g. KPI attachments) are stored. One backend per organization.
      </p>
      <form onSubmit={handleSave}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>Storage type</label>
          <select
            value={form.storage_type}
            onChange={(e) => setForm((p) => ({ ...p, storage_type: e.target.value, params: {} }))}
            style={{ width: "100%", padding: "0.5rem" }}
          >
            {STORAGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        {form.storage_type === "local" && (
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Base path (optional)</label>
            <input
              type="text"
              value={form.params.base_path ?? ""}
              onChange={(e) => updateParam("base_path", e.target.value)}
              placeholder="e.g. uploads (default from server)"
              style={{ width: "100%", padding: "0.5rem" }}
            />
          </div>
        )}
        {form.storage_type === "gcs" && (
          <>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Bucket name</label>
              <input
                type="text"
                value={form.params.bucket_name ?? form.params.bucket ?? ""}
                onChange={(e) => updateParam("bucket_name", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Credentials path (optional)</label>
              <input
                type="text"
                value={form.params.credentials_path ?? ""}
                onChange={(e) => updateParam("credentials_path", e.target.value)}
                placeholder="Path to service account JSON"
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
          </>
        )}
        {form.storage_type === "ftp" && (
          <>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Host</label>
              <input
                type="text"
                value={form.params.host ?? ""}
                onChange={(e) => updateParam("host", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Port</label>
              <input
                type="text"
                value={form.params.port ?? "21"}
                onChange={(e) => updateParam("port", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Username</label>
              <input
                type="text"
                value={form.params.username ?? ""}
                onChange={(e) => updateParam("username", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Password</label>
              <input
                type="password"
                value={form.params.password ?? ""}
                onChange={(e) => updateParam("password", e.target.value)}
                placeholder="Stored securely; leave blank to keep existing"
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Base path (optional)</label>
              <input
                type="text"
                value={form.params.base_path ?? ""}
                onChange={(e) => updateParam("base_path", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
          </>
        )}
        {form.storage_type === "s3" && (
          <>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Bucket</label>
              <input
                type="text"
                value={form.params.bucket ?? ""}
                onChange={(e) => updateParam("bucket", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Region</label>
              <input
                type="text"
                value={form.params.region ?? "us-east-1"}
                onChange={(e) => updateParam("region", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Access key ID</label>
              <input
                type="text"
                value={form.params.access_key_id ?? ""}
                onChange={(e) => updateParam("access_key_id", e.target.value)}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", marginBottom: "0.25rem" }}>Secret access key</label>
              <input
                type="password"
                value={form.params.secret_access_key ?? ""}
                onChange={(e) => updateParam("secret_access_key", e.target.value)}
                placeholder="Stored securely; leave blank to keep existing"
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>
          </>
        )}
        {form.storage_type === "onedrive" && (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            OneDrive requires OAuth or app-based auth; not yet implemented. Choose another storage type.
          </p>
        )}
        {message && <p style={{ marginBottom: "0.75rem", color: "var(--success, green)" }}>{message}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      <p style={{ marginTop: "1rem", color: "var(--muted)", fontSize: "0.85rem" }}>
        Secrets are stored securely and are not displayed after save.
      </p>
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
      toast.success("Domain created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      toast.error(e instanceof Error ? e.message : "Create failed");
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
      toast.success("Domain updated successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (domainId: number) => {
    if (!confirm("Delete this domain? Categories and KPIs under it will also be removed.")) return;
    try {
      await api(`/domains/${domainId}?${qs({ organization_id: orgId })}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
      toast.success("Domain deleted successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Domains</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem", alignItems: "stretch" }}>
          {list.map((d) => (
            <div
              key={d.id}
              className="card"
              style={{
                marginBottom: 0,
                minHeight: 200,
                display: "flex",
                flexDirection: "column",
              }}
            >
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
                    style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginBottom: "0.75rem" }}
                  >
                    <strong style={{ fontSize: "1.1rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>{d.name}</strong>
                    <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0, lineHeight: 1.3, minHeight: "2.6em" }}>
                      {d.description && d.description.trim() ? d.description : "No description"}
                    </p>
                    <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Order: {d.sort_order}</span>
                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Categories">
                        <strong style={{ color: "var(--text)" }}>{d.summary?.category_count ?? 0}</strong> categories
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="KPIs">
                        <strong style={{ color: "var(--text)" }}>{d.summary?.kpi_count ?? 0}</strong> KPIs
                      </span>
                    </div>
                  </Link>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      paddingTop: "0.75rem",
                      borderTop: "1px solid var(--border)",
                      marginTop: "auto",
                      flexWrap: "nowrap",
                    }}
                  >
                    <Link
                      href={`/dashboard/domains/${d.id}?organization_id=${orgId}`}
                      className="btn btn-primary"
                      style={{ textDecoration: "none", flex: "1 1 auto", minWidth: 0, justifyContent: "center", padding: "0.5rem 0.75rem", fontSize: "0.875rem" }}
                    >
                      Manage
                    </Link>
                    <button
                      type="button"
                      onClick={() => setEditingId(d.id)}
                      title="Edit domain"
                      aria-label="Edit domain"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        flexShrink: 0,
                        padding: 0,
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--surface)",
                        color: "var(--text)",
                        cursor: "pointer",
                        transition: "background 0.2s, border-color 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-subtle)";
                        e.currentTarget.style.borderColor = "var(--border-focus)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--surface)";
                        e.currentTarget.style.borderColor = "var(--border)";
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(d.id)}
                      title="Delete domain"
                      aria-label="Delete domain"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        flexShrink: 0,
                        padding: 0,
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--surface)",
                        color: "var(--error)",
                        cursor: "pointer",
                        transition: "background 0.2s, border-color 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(220, 38, 38, 0.08)";
                        e.currentTarget.style.borderColor = "var(--error)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--surface)";
                        e.currentTarget.style.borderColor = "var(--border)";
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
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
      toast.success("Tag created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      toast.error(e instanceof Error ? e.message : "Create failed");
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
      toast.success("Tag updated successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (tagId: number) => {
    if (!confirm("Delete this tag? It will be removed from all KPIs.")) return;
    try {
      await api(`/organizations/${orgId}/tags/${tagId}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
      toast.success("Tag deleted successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Organization tags</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
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
  categories,
  orgTags,
  loadOrgTags,
  filterName,
  setFilterName,
  filterDomainId,
  setFilterDomainId,
  filterCategoryId,
  setFilterCategoryId,
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
  categories: CategoryRow[];
  orgTags: OrgTagRow[];
  loadOrgTags: () => void;
  filterName: string;
  setFilterName: (v: string) => void;
  filterDomainId: number | null;
  setFilterDomainId: (v: number | null) => void;
  filterCategoryId: number | null;
  setFilterCategoryId: (v: number | null) => void;
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
        sort_order: 0,
        entry_mode: "manual",
        api_endpoint_url: "",
        organization_tag_ids: [],
      });
      setShowCreate(false);
      loadList();
      toast.success("KPI created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (kpiId: number, data: KpiUpdateFormData) => {
    try {
      await api(`/kpis/${kpiId}?${qs({ organization_id: orgId })}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
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

  const domainById = (id: number) => domains.find((d) => d.id === id)?.name ?? `Domain #${id}`;

  const categoriesForDomain = filterDomainId != null
    ? categories.filter((c) => c.domain_id === filterDomainId)
    : categories;

  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);

  const activeFilterChips: { key: string; label: string; onClear: () => void }[] = [];
  if (filterName.trim()) activeFilterChips.push({ key: "name", label: `Search: "${filterName.trim()}"`, onClear: () => setFilterName("") });
  if (filterDomainId != null) {
    const name = domains.find((d) => d.id === filterDomainId)?.name ?? `Domain #${filterDomainId}`;
    activeFilterChips.push({ key: "domain", label: `Domain: ${name}`, onClear: () => { setFilterDomainId(null); setFilterCategoryId(null); } });
  }
  if (filterCategoryId != null) {
    const cat = categories.find((c) => c.id === filterCategoryId);
    activeFilterChips.push({ key: "category", label: `Category: ${cat?.name ?? filterCategoryId}`, onClear: () => setFilterCategoryId(null) });
  }
  if (filterTagId != null) {
    const tag = orgTags.find((t) => t.id === filterTagId);
    activeFilterChips.push({ key: "tag", label: `Tag: ${tag?.name ?? filterTagId}`, onClear: () => setFilterTagId(null) });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          <input
            type="search"
            placeholder="Search KPIs…"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              fontSize: "0.9rem",
              width: "clamp(180px, 24vw, 280px)",
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setShowAdvancedFilter((v) => !v)}
            style={{ fontSize: "0.85rem" }}
          >
            {showAdvancedFilter ? "Hide advanced filters" : "Advanced filter"}
          </button>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? "Cancel" : "Add KPI"}
        </button>
      </div>

      {showAdvancedFilter && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            marginBottom: "0.75rem",
            padding: "0.75rem",
            background: "var(--bg-subtle)",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "var(--muted)", marginRight: "0.25rem" }}>Filter by:</span>
          <select
            value={filterDomainId ?? ""}
            onChange={(e) => setFilterDomainId(e.target.value ? Number(e.target.value) : null)}
            style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 120 }}
          >
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            value={filterCategoryId ?? ""}
            onChange={(e) => setFilterCategoryId(e.target.value ? Number(e.target.value) : null)}
            style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 120 }}
          >
            <option value="">All categories</option>
            {categoriesForDomain.map((c) => (
              <option key={c.id} value={c.id}>{c.domain_name ? `${c.name} (${c.domain_name})` : c.name}</option>
            ))}
          </select>
          {orgTags.length > 0 && (
            <select
              value={filterTagId ?? ""}
              onChange={(e) => setFilterTagId(e.target.value ? Number(e.target.value) : null)}
              style={{ padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 100 }}
            >
              <option value="">All tags</option>
              {orgTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {activeFilterChips.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginRight: "0.25rem" }}>Active:</span>
          {activeFilterChips.map((chip) => (
            <span
              key={chip.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.25rem 0.5rem",
                borderRadius: 6,
                background: "var(--accent-subtle, rgba(0,0,0,0.06))",
                border: "1px solid var(--border)",
                fontSize: "0.8rem",
              }}
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onClear}
                aria-label={`Remove ${chip.label}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  padding: 0,
                  border: "none",
                  background: "var(--muted)",
                  color: "var(--surface)",
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {orgTags.map((t) => {
                    const ids = createForm.watch("organization_tag_ids") ?? [];
                    const checked = ids.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          const prev = createForm.getValues("organization_tag_ids") ?? [];
                          const next = prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id];
                          createForm.setValue("organization_tag_ids", next);
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
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>Create</button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
      {list.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No KPIs yet. Add one above.</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "1rem",
          }}
        >
          {list.map((k) => {
            const cardColorPalette = [
              { bg: "rgba(239, 68, 68, 0.08)", border: "rgba(239, 68, 68, 0.3)", accent: "#dc2626", accentBg: "rgba(239, 68, 68, 0.15)" },
              { bg: "rgba(245, 158, 11, 0.08)", border: "rgba(245, 158, 11, 0.3)", accent: "#d97706", accentBg: "rgba(245, 158, 11, 0.15)" },
              { bg: "rgba(16, 185, 129, 0.08)", border: "rgba(16, 185, 129, 0.3)", accent: "#059669", accentBg: "rgba(16, 185, 129, 0.15)" },
              { bg: "rgba(99, 102, 241, 0.08)", border: "rgba(99, 102, 241, 0.3)", accent: "#6366f1", accentBg: "rgba(99, 102, 241, 0.15)" },
              { bg: "rgba(168, 85, 247, 0.08)", border: "rgba(168, 85, 247, 0.3)", accent: "#9333ea", accentBg: "rgba(168, 85, 247, 0.15)" },
              { bg: "rgba(236, 72, 153, 0.08)", border: "rgba(236, 72, 153, 0.3)", accent: "#db2777", accentBg: "rgba(236, 72, 153, 0.15)" },
              { bg: "rgba(20, 184, 166, 0.08)", border: "rgba(20, 184, 166, 0.3)", accent: "#0d9488", accentBg: "rgba(20, 184, 166, 0.15)" },
              { bg: "rgba(59, 130, 246, 0.08)", border: "rgba(59, 130, 246, 0.3)", accent: "#3b82f6", accentBg: "rgba(59, 130, 246, 0.15)" },
            ];
            let colorKey: number;
            if ((k.organization_tags?.length ?? 0) > 0) {
              colorKey = k.organization_tags![0].id;
            } else if ((k.domain_tags?.length ?? 0) > 0) {
              colorKey = k.domain_tags![0].id + 100;
            } else if (k.domain_id != null) {
              colorKey = k.domain_id + 200;
            } else {
              colorKey = k.id;
            }
            const cardColor = cardColorPalette[colorKey % cardColorPalette.length];
            const kpiFieldsHref = `/dashboard/kpis/${k.id}/fields?organization_id=${orgId}`;
            const kpiEditHref = `/dashboard/organizations/${orgId}/kpis/${k.id}`;
            return (
            <Link
              key={k.id}
              href={kpiFieldsHref}
              className="card"
              style={{
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: "180px",
                transition: "box-shadow 0.15s ease, transform 0.15s ease",
                background: cardColor.bg,
                borderLeft: `3px solid ${cardColor.accent}`,
                cursor: "pointer",
                textDecoration: "none",
                color: "inherit",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `0 4px 12px ${cardColor.border}`;
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "";
                e.currentTarget.style.transform = "";
              }}
            >
              <>
                {/* Card header */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", gap: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span
                          style={{
                            background: "rgba(107, 114, 128, 0.12)",
                            color: "#6b7280",
                            padding: "0.2rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                          }}
                          title="Time Dimension"
                        >
                          {((k as any).time_dimension || "") === "half_yearly" ? "Half Yearly" : ((k as any).time_dimension || "") === "quarterly" ? "Quarterly" : ((k as any).time_dimension || "") === "monthly" ? "Monthly" : "Yearly"}
                        </span>
                      </div>
                      {k.entry_mode === "api" ? (
                        <span
                          style={{
                            background: "rgba(107, 114, 128, 0.15)",
                            color: "#6b7280",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            fontSize: "0.7rem",
                          }}
                          title="API entry mode"
                        >
                          API
                        </span>
                      ) : (
                        <span
                          style={{
                            background: "rgba(16, 185, 129, 0.15)",
                            color: "#059669",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            fontSize: "0.7rem",
                          }}
                          title="Manual entry mode"
                        >
                          Manual
                        </span>
                      )}
                    </div>
                    <h3
                      style={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        margin: "0 0 0.5rem 0",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                      title={k.name}
                    >
                      {k.name}
                    </h3>
                    {k.description && (
                      <p
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--muted)",
                          margin: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          lineHeight: "1.4",
                          cursor: "pointer",
                        }}
                        title={k.description}
                      >
                        {k.description}
                      </p>
                    )}
                    {/* Tags with distinct colors */}
                    {((k.domain_tags?.length ?? 0) > 0 || (k.organization_tags?.length ?? 0) > 0) && (
                      <div style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                        {(k.domain_tags ?? []).slice(0, 3).map((t, idx) => {
                          const domainColors = [
                            { bg: "rgba(239, 68, 68, 0.15)", color: "#dc2626" },
                            { bg: "rgba(245, 158, 11, 0.15)", color: "#d97706" },
                            { bg: "rgba(16, 185, 129, 0.15)", color: "#059669" },
                          ];
                          const c = domainColors[idx % domainColors.length];
                          return (
                            <span
                              key={`d-${t.id}`}
                              style={{
                                background: c.bg,
                                color: c.color,
                                padding: "0.12rem 0.4rem",
                                borderRadius: "3px",
                                fontSize: "0.7rem",
                                fontWeight: 500,
                              }}
                              title={t.name}
                            >
                              {t.name.length > 12 ? `${t.name.slice(0, 12)}…` : t.name}
                            </span>
                          );
                        })}
                        {(k.organization_tags ?? []).slice(0, 3).map((t, idx) => {
                          const orgColors = [
                            { bg: "rgba(99, 102, 241, 0.15)", color: "#6366f1" },
                            { bg: "rgba(168, 85, 247, 0.15)", color: "#9333ea" },
                            { bg: "rgba(236, 72, 153, 0.15)", color: "#db2777" },
                          ];
                          const c = orgColors[idx % orgColors.length];
                          return (
                            <span
                              key={`o-${t.id}`}
                              style={{
                                background: c.bg,
                                color: c.color,
                                padding: "0.12rem 0.4rem",
                                borderRadius: "3px",
                                fontSize: "0.7rem",
                                fontWeight: 500,
                              }}
                              title={t.name}
                            >
                              {t.name.length > 12 ? `${t.name.slice(0, 12)}…` : t.name}
                            </span>
                          );
                        })}
                        {((k.domain_tags?.length ?? 0) + (k.organization_tags?.length ?? 0) > 6) && (
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>+more</span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Card actions: removed edit and delete buttons */}
                </>
            </Link>
          );
          })}
        </div>
      )}
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
  const [syncYear, setSyncYear] = useState<number>(() => new Date().getFullYear());
  const { register, handleSubmit, watch, setValue, getValues, formState: { errors, isSubmitting } } = useForm<KpiUpdateFormData>({
    resolver: zodResolver(kpiUpdateSchema),
    defaultValues: {
      name: kpi.name,
      description: kpi.description ?? "",
      sort_order: kpi.sort_order,
      entry_mode: kpi.entry_mode === "api" ? "api" : "manual",
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
                    await api(`/kpis/${kpi.id}/sync-from-api?${qs({ year: syncYear, organization_id: orgId, sync_mode: syncMode })}`, { method: "POST", token });
                    onSyncSuccess();
                    toast.success("Sync completed successfully");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Sync failed");
                  } finally {
                    setSyncLoading(false);
                  }
                }}
              >
                {syncLoading ? "Syncing…" : "Sync from API now"}
              </button>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>Fetches entry data for the selected year from your endpoint. Override or append is chosen above.</p>
            </div>
          )}
        </>
      )}
      {orgTags.length > 0 && (
        <div className="form-group">
          <label>Organization tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {orgTags.map((t) => {
              const ids = watch("organization_tag_ids") ?? [];
              const checked = ids.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    const prev = getValues("organization_tag_ids") ?? [];
                    const next = prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id];
                    setValue("organization_tag_ids", next);
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
  onKpiUpdated,
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
  onKpiUpdated?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [createSubFields, setCreateSubFields] = useState<Array<{ name: string; key: string; field_type: string; is_required: boolean; sort_order: number }>>([]);
  const [cardDisplayFieldIds, setCardDisplayFieldIds] = useState<number[]>([]);
  const [savingCardDisplay, setSavingCardDisplay] = useState(false);
  const [cardDisplaySaved, setCardDisplaySaved] = useState(false);
  const [cardDisplaySaveError, setCardDisplaySaveError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  /** API binding for multi-line items (Super Admin only) – bind KPI to API endpoint */
  const selectedKpi = selectedKpiId ? kpis.find((k) => k.id === selectedKpiId) : null;
  const [apiConfigEntryMode, setApiConfigEntryMode] = useState<"manual" | "api">("manual");
  const [apiConfigUrl, setApiConfigUrl] = useState("");
  const [apiConfigSaving, setApiConfigSaving] = useState(false);
  const [apiConfigError, setApiConfigError] = useState<string | null>(null);

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

  useEffect(() => {
    const mode = selectedKpi?.entry_mode === "api" ? "api" : "manual";
    const url = selectedKpi?.api_endpoint_url ?? "";
    setApiConfigEntryMode(mode);
    setApiConfigUrl(url);
  }, [selectedKpi?.entry_mode, selectedKpi?.api_endpoint_url]);

  const saveApiConfig = async () => {
    if (!selectedKpiId || !token) return;
    setApiConfigError(null);
    setApiConfigSaving(true);
    try {
      await api(`/kpis/${selectedKpiId}?${qs({ organization_id: orgId })}`, {
        method: "PATCH",
        body: JSON.stringify({
          entry_mode: apiConfigEntryMode,
          api_endpoint_url: apiConfigEntryMode === "api" && apiConfigUrl.trim() ? apiConfigUrl.trim() : null,
        }),
        token,
      });
      onKpiUpdated?.();
      loadList();
    } catch (e) {
      setApiConfigError(e instanceof Error ? e.message : "Failed to save API config");
    } finally {
      setApiConfigSaving(false);
    }
  };

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
      toast.success("Field created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      toast.error(e instanceof Error ? e.message : "Create failed");
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
      toast.success("Field updated successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
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
      toast.success("Field deleted successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      toast.error(e instanceof Error ? e.message : "Delete failed");
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
      toast.success("Card display settings saved");
    } catch (e) {
      setCardDisplaySaveError(e instanceof Error ? e.message : "Failed to save");
      toast.error(e instanceof Error ? e.message : "Failed to save");
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

  const exampleApiResponse = React.useMemo(
    () => buildExampleApiResponse(list, new Date().getFullYear()),
    [list]
  );

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
                <option key={k.id} value={k.id}>{k.name}</option>
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
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "Add field"}
        </button>
      </div>
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {/* Super Admin: bind API for this KPI so multi-line fields can use "Sync from API" */}
      {userRole === "SUPER_ADMIN" && selectedKpiId && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>API for multi-line items</h3>
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
            Bind an API endpoint to this KPI so data-entry users can use &quot;Sync from API&quot; on multi-line fields.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 640 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <label style={{ fontWeight: 500, minWidth: 100 }}>Data source</label>
              <select
                value={apiConfigEntryMode}
                onChange={(e) => setApiConfigEntryMode(e.target.value as "manual" | "api")}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  fontSize: "0.9rem",
                  background: "var(--surface)",
                }}
              >
                <option value="manual">Manual entry only</option>
                <option value="api">API (sync from endpoint)</option>
              </select>
            </div>
            {apiConfigEntryMode === "api" && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label style={{ fontWeight: 500 }}>API endpoint URL</label>
                  <input
                    type="url"
                    value={apiConfigUrl}
                    onChange={(e) => setApiConfigUrl(e.target.value)}
                    placeholder="https://..."
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      fontSize: "0.9rem",
                      width: "100%",
                    }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label style={{ fontWeight: 500 }}>Example response (your API should return JSON in this shape)</label>
                  <pre
                    style={{
                      margin: 0,
                      padding: "0.75rem 1rem",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-subtle)",
                      fontSize: "0.8rem",
                      overflow: "auto",
                      maxHeight: 320,
                    }}
                  >
                    {JSON.stringify(exampleApiResponse, null, 2)}
                  </pre>
                  <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: 0 }}>
                    The system will call your URL with <code style={{ fontSize: "0.8rem" }}>?year=YYYY</code> (or POST body). Return this structure; <code style={{ fontSize: "0.8rem" }}>values</code> keys must match field keys. Formula fields are computed server-side and should be omitted.
                  </p>
                </div>
              </>
            )}
            {apiConfigError && <p className="form-error" style={{ margin: 0 }}>{apiConfigError}</p>}
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveApiConfig}
              disabled={apiConfigSaving}
              style={{ alignSelf: "flex-start" }}
            >
              {apiConfigSaving ? "Saving…" : "Save API config"}
            </button>
          </div>
        </div>
      )}

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
                  <option key={k.id} value={k.id}>{k.name}</option>
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
  userRole,
}: {
  orgId: number;
  token: string;
  userRole: UserRole | null;
}) {
  const [list, setList] = useState<ReportTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdMsg, setCreatedMsg] = useState<string | null>(null);
  const [printLoadingId, setPrintLoadingId] = useState<number | null>(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printPendingTemplateId, setPrintPendingTemplateId] = useState<number | null>(null);
  const [printModalYear, setPrintModalYear] = useState(() => new Date().getFullYear());
  const [addReportModalOpen, setAddReportModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [renameTemplate, setRenameTemplate] = useState<ReportTemplateRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const canManageAssignments = userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN";
  const canAddReport = userRole === "SUPER_ADMIN" || userRole === "ORG_ADMIN";

  const openRenameModal = (t: ReportTemplateRow) => {
    setRenameTemplate(t);
    setRenameName(t.name);
    setRenameDescription(t.description ?? "");
    setError(null);
  };

  const handleRenameSave = async () => {
    if (!renameTemplate || !token || !orgId || userRole !== "SUPER_ADMIN") return;
    const name = renameName.trim();
    if (!name) return;
    setRenameSaving(true);
    setError(null);
    try {
      const updated = await api<ReportTemplateRow>(`/reports/templates/${renameTemplate.id}?${qs({ organization_id: orgId })}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ name, description: renameDescription.trim() || null }),
      });
      setList((prev) => prev.map((x) => (x.id === renameTemplate.id ? { ...x, name: updated.name, description: updated.description } : x)));
      setRenameTemplate(null);
      toast.success("Template updated successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update report template");
      toast.error(err instanceof Error ? err.message : "Failed to update report template");
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDeleteTemplate = async (t: ReportTemplateRow) => {
    if (!token || !orgId || userRole !== "SUPER_ADMIN") return;
    if (!confirm(`Delete report template "${t.name}"? This cannot be undone.`)) return;
    setError(null);
    setDeletingId(t.id);
    try {
      await api(`/reports/templates/${t.id}?${qs({ organization_id: orgId })}`, {
        method: "DELETE",
        token,
      });
      setDeletingId(null);
      setLoading(true);
      const next = await api<ReportTemplateRow[]>(`/reports/templates?${qs({ organization_id: orgId })}`, { token });
      setList(next);
      toast.success("Template deleted successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete report template");
      toast.error(err instanceof Error ? err.message : "Failed to delete report template");
    } finally {
      setDeletingId(null);
      setLoading(false);
    }
  };

  const loadTemplates = () => {
    if (!token || !orgId) return;
    setError(null);
    setLoading(true);
    api<ReportTemplateRow[]>(`/reports/templates?${qs({ organization_id: orgId })}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load templates"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTemplates();
  }, [orgId, token]);

  const openReportPrint = (templateId: number, year: number) => {
    setPrintLoadingId(templateId);
    setError(null);
    const url = `/reports/templates/${templateId}/generate?format=json&year=${year}&_t=${Date.now()}`;
    api<ReportData>(url, { token, cache: "no-store" })
      .then((data) => {
        const doc = buildReportPrintDocument(data);
        const opened = openReportPrintWindow(doc, true);
        if (!opened) setError("Pop-up was blocked. Allow pop-ups for this site to open print/PDF in a new tab.");
      })
      .catch(() => {
        setError("Failed to load report.");
      })
      .finally(() => {
        setPrintLoadingId(null);
        setPrintModalOpen(false);
        setPrintPendingTemplateId(null);
      });
  };

  const openPrintModal = (templateId: number) => {
    setPrintPendingTemplateId(templateId);
    setPrintModalYear(new Date().getFullYear());
    setPrintModalOpen(true);
  };

  const confirmPrintFromModal = () => {
    if (printPendingTemplateId == null) return;
    openReportPrint(printPendingTemplateId, printModalYear);
    // Modal stays open; progress shown inside until openReportPrint finishes
  };

  const createForm = useForm<ReportTemplateCreateFormData>({
    resolver: zodResolver(reportTemplateCreateSchema),
    defaultValues: {
      name: "",
      description: "",
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
        }),
      });
      createForm.reset({ name: "", description: "" });
      setCreatedMsg("Report template created.");
      setAddReportModalOpen(false);
      loadTemplates();
      toast.success("Report template created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create template");
      toast.error(e instanceof Error ? e.message : "Failed to create template");
    }
  };

  const openAddReportModal = () => {
    setError(null);
    setCreatedMsg(null);
    createForm.reset({ name: "", description: "" });
    setAddReportModalOpen(true);
  };

  return (
    <div>
      <h2 style={{ fontSize: "1.2rem", marginBottom: "0.75rem" }}>Report templates</h2>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Templates</h3>
            {canAddReport && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={openAddReportModal}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
              >
                <span aria-hidden style={{ fontSize: "1.1rem", lineHeight: 1 }}>+</span>
                Add report
              </button>
            )}
          </div>
          <button type="button" className="btn" onClick={loadTemplates} disabled={loading}>
            Refresh
          </button>
        </div>
        {createdMsg && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", color: "var(--success)" }}>{createdMsg}</p>
        )}
        {printLoadingId != null && (
          <div style={{ marginTop: "0.75rem" }}>
            <ReportLoadProgress label="Preparing report for view/print…" />
          </div>
        )}
        {error && (
          <p className="form-error" style={{ marginTop: "0.75rem" }}>{error}</p>
        )}
        {loading ? (
          <p style={{ color: "var(--muted)" }}>Loading…</p>
        ) : list.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No templates yet.</p>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0" }}>
            {list.map((t) => (
              <li key={t.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div>
                    <strong>{t.name}</strong>
                    {t.description && (
                      <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{t.description}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {userRole === "SUPER_ADMIN" && (
                      <Link className="btn" href={`/dashboard/reports/${t.id}/design?organization_id=${orgId}`}>
                        Design
                      </Link>
                    )}
                    {userRole === "SUPER_ADMIN" && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => openRenameModal(t)}
                        style={{ fontSize: "0.85rem" }}
                      >
                        Rename
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={printLoadingId === t.id}
                      onClick={() => openPrintModal(t.id)}
                    >
                      {printLoadingId === t.id ? "Loading…" : "View / Print"}
                    </button>
                    {userRole === "SUPER_ADMIN" && (
                      <button
                        type="button"
                        className="btn"
                        disabled={deletingId === t.id}
                        onClick={() => handleDeleteTemplate(t)}
                        style={{ color: "var(--error)", fontSize: "0.85rem" }}
                      >
                        {deletingId === t.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                    {canManageAssignments && (
                      <Link className="btn" href={`/dashboard/reports/${t.id}/assign?organization_id=${orgId}`} style={{ fontSize: "0.85rem" }}>
                        Assign users
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
            </ul>
          </>
        )}
      </div>

      {renameTemplate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-report-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: "1.5rem",
          }}
          onClick={(e) => e.target === e.currentTarget && setRenameTemplate(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rename-report-modal-title" style={{ margin: "0 0 1rem 0", fontSize: "1.25rem" }}>
              Rename report
            </h3>
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label htmlFor="rename-report-name">Name *</label>
              <input
                id="rename-report-name"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                style={{ width: "100%", padding: "0.5rem 0.6rem" }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: "1.25rem" }}>
              <label htmlFor="rename-report-description">Description</label>
              <textarea
                id="rename-report-description"
                value={renameDescription}
                onChange={(e) => setRenameDescription(e.target.value)}
                rows={3}
                style={{ width: "100%", padding: "0.5rem 0.6rem", resize: "vertical" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setRenameTemplate(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={renameSaving || !renameName.trim()}
                onClick={handleRenameSave}
              >
                {renameSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {addReportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-report-modal-title"
          aria-describedby="add-report-modal-desc"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: "1.5rem",
          }}
          onClick={(e) => e.target === e.currentTarget && setAddReportModalOpen(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: 420,
              width: "100%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
              borderRadius: 8,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="add-report-modal-title" style={{ margin: "0 0 0.25rem 0", fontSize: "1.25rem", fontWeight: 600 }}>
              Add report template
            </h3>
            <p id="add-report-modal-desc" style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 1.25rem 0" }}>
              Create a new report template for this organization. You can design the layout and assign users after saving.
            </p>
            <form onSubmit={createForm.handleSubmit(onCreate)}>
              <div className="form-group" style={{ marginBottom: "1rem" }}>
                <label htmlFor="add-report-name">Name *</label>
                <input
                  id="add-report-name"
                  {...createForm.register("name")}
                  placeholder="e.g. Annual performance report"
                  autoFocus
                  style={{ width: "100%", padding: "0.5rem 0.6rem" }}
                />
                {createForm.formState.errors.name && (
                  <p className="form-error" style={{ marginTop: "0.25rem" }}>{createForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: "1.25rem" }}>
                <label htmlFor="add-report-description">Description</label>
                <textarea
                  id="add-report-description"
                  {...createForm.register("description")}
                  placeholder="Optional short description of this report"
                  rows={3}
                  style={{ width: "100%", padding: "0.5rem 0.6rem", resize: "vertical", minHeight: 72 }}
                />
              </div>
              {error && <p className="form-error" style={{ marginBottom: "0.75rem" }}>{error}</p>}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setAddReportModalOpen(false); setError(null); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createForm.formState.isSubmitting}
                >
                  {createForm.formState.isSubmitting ? "Creating…" : "Create template"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {printModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-year-modal-title"
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
          onClick={(e) => e.target === e.currentTarget && (setPrintModalOpen(false), setPrintPendingTemplateId(null))}
        >
          <div className="card" style={{ maxWidth: 360, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            {printLoadingId === printPendingTemplateId ? (
              <>
                <h3 id="print-year-modal-title" style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem" }}>Preparing report</h3>
                <ReportLoadProgress label="Loading report data…" />
              </>
            ) : (
              <>
                <h3 id="print-year-modal-title" style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Select year for report</h3>
                <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>Choose the reporting year for data in the report.</p>
                <div className="form-group" style={{ marginBottom: "1rem" }}>
                  <label htmlFor="print-modal-year">Year</label>
                  <select
                    id="print-modal-year"
                    value={printModalYear}
                    onChange={(e) => setPrintModalYear(Number(e.target.value))}
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" onClick={() => { setPrintModalOpen(false); setPrintPendingTemplateId(null); }}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={confirmPrintFromModal}>
                    View / Print
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
