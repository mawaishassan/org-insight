"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== "all");
  return new URLSearchParams(entries as Record<string, string>).toString();
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
  const router = useRouter();
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

  const removeFilter = (key: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(key);
    if (key === "domain_id") next.delete("category_id");
    const query = next.toString();
    router.push(query ? `/dashboard/entries?${query}` : "/dashboard/entries");
  };

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

  const headingText =
    filteredKpiCount !== null ? `${filteredKpiCount} Data Points` : "Data Points";

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 0 }}>
          {headingText}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Show:</span>
          <button
            type="button"
            onClick={() => setAssignedToMeOnly(false)}
            style={{
              padding: "0.35rem 0.65rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: !assignedToMeOnly ? "var(--accent)" : "var(--surface)",
              color: !assignedToMeOnly ? "var(--on-muted)" : "var(--text)",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setAssignedToMeOnly(true)}
            style={{
              padding: "0.35rem 0.65rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: assignedToMeOnly ? "var(--accent)" : "var(--surface)",
              color: assignedToMeOnly ? "var(--on-muted)" : "var(--text)",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
            }}
          >
            Only assigned to me
          </button>
        </div>
      </div>
      {filterTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          {filterTags.map(({ key, label }) => (
            <span
              key={key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.25rem 0.5rem",
                borderRadius: 6,
                background: "var(--border)",
                fontSize: "0.85rem",
                color: "var(--text)",
              }}
            >
              {label}
              <button
                type="button"
                onClick={() => removeFilter(key)}
                aria-label={`Remove ${label}`}
                style={{
                  padding: 0,
                  margin: 0,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1,
                  color: "var(--muted)",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

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
          emptyMessage={
            filterTags.length > 0
              ? "There are no KPIs for the selected filters. Change filters to view KPIs or ask your admin to add or assign KPIs for these filters."
              : "You have no KPIs assigned for data entry. Ask your admin to assign KPIs to your user."
          }
        />
      )}
    </div>
  );
}
