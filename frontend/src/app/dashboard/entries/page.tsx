"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { KpiCardsGrid } from "@/components/KpiCardsGrid";
import { canManageKpis } from "@/lib/auth";

const currentYear = new Date().getFullYear();

interface KpiRow {
  id: number;
  name: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

interface DomainRow {
  id: number;
  name: string;
}
interface CategoryRow {
  id: number;
  name: string;
  domain_id: number;
}
interface OrgTagRow {
  id: number;
  name: string;
}

export default function EntriesPage() {
  const searchParams = useSearchParams();
  const yearParam = searchParams.get("year");
  const year = yearParam ? Number(yearParam) : currentYear;
  const q = searchParams.get("q") ?? "";
  const domainIdParam = searchParams.get("domain_id");
  const categoryIdParam = searchParams.get("category_id");
  const tagIdParam = searchParams.get("tag_id");
  const status = (searchParams.get("status") as "all" | "submitted" | "draft" | "not_entered" | "no_user_assigned") ?? "all";

  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [kpisOverride, setKpisOverride] = useState<KpiRow[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domainName, setDomainName] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [tagName, setTagName] = useState<string | null>(null);
  const [filteredKpiCount, setFilteredKpiCount] = useState<number | null>(null);
  const [assignedToMeOnly, setAssignedToMeOnly] = useState(false);

  const token = getAccessToken();
  const canFetchKpis = userRole && canManageKpis(userRole as "SUPER_ADMIN" | "ORG_ADMIN" | "USER" | "REPORT_VIEWER");
  const hasKpiFilters = domainIdParam || categoryIdParam || tagIdParam;

  useEffect(() => {
    if (!token) return;
    api<{ organization_id: number | null; role: string }>("/auth/me", { token })
      .then((me) => {
        setOrganizationId(me.organization_id ?? null);
        setUserRole(me.role ?? null);
      })
      .catch(() => {
        setOrganizationId(null);
        setUserRole(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token || !organizationId || !canFetchKpis || !hasKpiFilters) {
      setKpisOverride(undefined);
      return;
    }
    const params: Record<string, string | number> = { organization_id: organizationId };
    if (domainIdParam) params.domain_id = Number(domainIdParam);
    if (categoryIdParam) params.category_id = Number(categoryIdParam);
    if (tagIdParam) params.organization_tag_id = Number(tagIdParam);
    api<KpiRow[]>(`/kpis?${qs(params)}`, { token })
      .then(setKpisOverride)
      .catch(() => setKpisOverride([]));
  }, [token, organizationId, canFetchKpis, domainIdParam, categoryIdParam, tagIdParam, hasKpiFilters]);

  useEffect(() => {
    if (!token || !organizationId || !domainIdParam) {
      setDomainName(null);
      return;
    }
    api<DomainRow[]>(`/domains?${qs({ organization_id: organizationId })}`, { token })
      .then((list) => {
        const d = list.find((x) => x.id === Number(domainIdParam));
        setDomainName(d?.name ?? null);
      })
      .catch(() => setDomainName(null));
  }, [token, organizationId, domainIdParam]);

  useEffect(() => {
    if (!token || !organizationId || !domainIdParam || !categoryIdParam) {
      setCategoryName(null);
      return;
    }
    api<CategoryRow[]>(`/categories?${qs({ domain_id: Number(domainIdParam), organization_id: organizationId })}`, { token })
      .then((list) => {
        const c = list.find((x) => x.id === Number(categoryIdParam));
        setCategoryName(c?.name ?? null);
      })
      .catch(() => setCategoryName(null));
  }, [token, organizationId, domainIdParam, categoryIdParam]);

  useEffect(() => {
    if (!token || !organizationId || !tagIdParam) {
      setTagName(null);
      return;
    }
    api<OrgTagRow[]>(`/organizations/${organizationId}/tags`, { token })
      .then((list) => {
        const t = list.find((x) => x.id === Number(tagIdParam));
        setTagName(t?.name ?? null);
      })
      .catch(() => setTagName(null));
  }, [token, organizationId, tagIdParam]);

  const filterTags: { key: string; label: string }[] = [];
  if (domainIdParam) filterTags.push({ key: "domain_id", label: domainName ? `Domain: ${domainName}` : `Domain` });
  if (categoryIdParam) filterTags.push({ key: "category_id", label: categoryName ? `Category: ${categoryName}` : `Category` });
  if (tagIdParam) filterTags.push({ key: "tag_id", label: tagName ? `Tag: ${tagName}` : `Tag` });
  if (status && status !== "all") {
    const statusLabels: Record<string, string> = {
      submitted: "Submitted",
      draft: "Drafted",
      not_entered: "Not entered",
      no_user_assigned: "No user assigned",
    };
    filterTags.push({ key: "status", label: statusLabels[status] ?? status });
  }
  if (q.trim()) filterTags.push({ key: "q", label: `Search: ${q.trim()}` });

  if (loading && organizationId == null) return <p>Loading...</p>;

  return (
    <div>
      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {organizationId == null ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>You are not assigned to an organization. Ask your admin to assign you.</p>
        </div>
      ) : (
        <KpiCardsGrid
            organizationId={organizationId}
            year={year}
            kpisOverride={kpisOverride}
            filterName={q}
            statusFilter={status}
            assignedToMeOnly={assignedToMeOnly}
            onFilteredCountChange={setFilteredKpiCount}
            cardLayout="org_admin"
            emptyMessage={
              filterTags.length > 0 || q.trim() || status !== "all" || assignedToMeOnly
                ? "No KPIs match the filters. Change filters or ask your admin to add or assign KPIs."
                : "You have no KPIs assigned for data entry. Ask your admin to assign KPIs to your user."
            }
          />
      )}
    </div>
  );
}
