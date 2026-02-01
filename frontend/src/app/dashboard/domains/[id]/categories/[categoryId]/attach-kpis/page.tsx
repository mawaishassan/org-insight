"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface CategoryInfo {
  id: number;
  domain_id: number;
  name: string;
  description: string | null;
  sort_order: number;
  kpi_count?: number;
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
  domain_id: number | null;
  name: string;
  description: string | null;
  year: number;
  sort_order: number;
  category_tags?: CategoryTagRef[];
  organization_tags?: OrganizationTagRef[];
}

interface OrgTagRow {
  id: number;
  organization_id: number;
  name: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return new URLSearchParams(entries as Record<string, string>).toString();
}

function isKpiInCategory(kpi: KpiRow, categoryId: number): boolean {
  return (kpi.category_tags || []).some((t) => t.id === categoryId);
}

/** True if KPI is attached to any category in the given domain. */
function isKpiAttachedToAnyCategoryInDomain(kpi: KpiRow, domainId: number): boolean {
  return (kpi.category_tags || []).some((t) => t.domain_id === domainId);
}

/** Categories in the same domain (by domain_id) that are not the current category. */
function getOtherCategoriesInSameDomain(
  kpi: KpiRow,
  domainId: number,
  currentCategoryId: number
): CategoryTagRef[] {
  return (kpi.category_tags || []).filter(
    (t) => t.domain_id === domainId && t.id !== currentCategoryId
  );
}

function formatAttachedDomainsAndCategories(tags: CategoryTagRef[]): string {
  if (!tags.length) return "";
  return tags
    .map((t) => (t.domain_name ? `${t.domain_name} \u2192 ${t.name}` : t.name))
    .join("; ");
}

type AttachmentFilter = "all" | "attached" | "not_attached";

export default function AttachKpisPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const domainId = Number(params.id);
  const categoryId = Number(params.categoryId);
  const orgIdParam = searchParams.get("organization_id");
  const organizationId = orgIdParam ? Number(orgIdParam) : undefined;

  const token = getAccessToken();
  const [category, setCategory] = useState<CategoryInfo | null>(null);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpiSearch, setKpiSearch] = useState("");
  const [togglingKpiId, setTogglingKpiId] = useState<number | null>(null);
  const [attachmentFilter, setAttachmentFilter] = useState<AttachmentFilter>("all");
  const [tagFilterId, setTagFilterId] = useState<number | null>(null);
  const [orgTags, setOrgTags] = useState<OrgTagRow[]>([]);

  const loadCategory = () => {
    if (!token || !domainId || !categoryId) return;
    const query = `?${qs({ domain_id: domainId, ...(organizationId != null && { organization_id: organizationId }) })}`;
    api<CategoryInfo>(`/categories/${categoryId}${query}`, { token })
      .then(setCategory)
      .catch(() => setCategory(null));
  };

  const loadOrgTags = () => {
    if (!token || organizationId == null) return;
    api<OrgTagRow[]>(`/organizations/${organizationId}/tags`, { token })
      .then(setOrgTags)
      .catch(() => setOrgTags([]));
  };

  const loadKpis = () => {
    if (!token || organizationId == null) return;
    const queryParams: Record<string, string | number> = { organization_id: organizationId };
    if (tagFilterId != null) queryParams.organization_tag_id = tagFilterId;
    api<KpiRow[]>(`/kpis?${qs(queryParams)}`, { token })
      .then(setKpis)
      .catch(() => setKpis([]));
  };

  useEffect(() => {
    loadCategory();
  }, [domainId, categoryId, organizationId]);

  useEffect(() => {
    if (organizationId != null) {
      loadOrgTags();
    }
  }, [organizationId]);

  useEffect(() => {
    if (organizationId != null) {
      loadKpis();
    }
  }, [organizationId, tagFilterId]);

  useEffect(() => {
    setLoading(false);
  }, [category, kpis]);

  const onToggleKpiCategory = async (kpiId: number, currentlyLinked: boolean) => {
    if (organizationId == null || !token) return;
    setTogglingKpiId(kpiId);
    setError(null);
    try {
      const query = `?${qs({ organization_id: organizationId })}`;
      if (currentlyLinked) {
        await api(`/kpis/${kpiId}/categories/${categoryId}${query}`, { method: "DELETE", token });
      } else {
        await api(`/kpis/${kpiId}/categories/${categoryId}${query}`, { method: "POST", token });
      }
      loadKpis();
      loadCategory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update association");
    } finally {
      setTogglingKpiId(null);
    }
  };

  const filteredKpis = useMemo(() => {
    let list = kpis;
    const searchLower = kpiSearch.trim().toLowerCase();
    if (searchLower) list = list.filter((k) => k.name.toLowerCase().includes(searchLower));
    if (attachmentFilter === "attached") {
      list = list.filter((k) => isKpiInCategory(k, categoryId));
    } else if (attachmentFilter === "not_attached") {
      list = list.filter((k) => !isKpiAttachedToAnyCategoryInDomain(k, domainId));
    }
    return list;
  }, [kpis, kpiSearch, attachmentFilter, categoryId, domainId]);

  const domainDetailHref =
    organizationId != null
      ? `/dashboard/domains/${domainId}?organization_id=${organizationId}`
      : `/dashboard/domains/${domainId}`;

  if (!domainId || isNaN(domainId) || !categoryId || isNaN(categoryId)) {
    return (
      <div>
        <p className="form-error">Invalid domain or category.</p>
        <Link href="/dashboard/domains">Back to Domains</Link>
      </div>
    );
  }

  if (organizationId == null && !category) {
    return (
      <div>
        <p className="form-error">Organization context required (e.g. open this page from an organization).</p>
        <Link href="/dashboard/domains">Back to Domains</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <Link href={domainDetailHref} style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {"\u2190"} Back to domain
        </Link>
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        Attach KPIs to category: {category ? category.name : `Category #${categoryId}`}
      </h1>
      {category?.description && (
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>{category.description}</p>
      )}
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        In this domain, a KPI can be in only one category. Attaching a KPI here will remove it from any other category in this domain. A KPI can still be in categories from other domains.
      </p>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="form-group" style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.95rem" }}>Search by KPI name</label>
          <input
            type="text"
            placeholder="Type to search KPIs..."
            value={kpiSearch}
            onChange={(e) => setKpiSearch(e.target.value)}
            style={{ width: "100%", maxWidth: "400px" }}
          />
        </div>
        {orgTags.length > 0 && (
          <div className="form-group" style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.95rem" }}>Filter by organization tag</label>
            <select
              value={tagFilterId ?? ""}
              onChange={(e) => setTagFilterId(e.target.value ? Number(e.target.value) : null)}
              style={{ minWidth: "180px" }}
            >
              <option value="">All tags</option>
              {orgTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem", marginLeft: "0.5rem" }}>
              Only KPIs with this tag are loaded from the server.
            </span>
          </div>
        )}
        <div className="form-group" style={{ marginBottom: "0.75rem" }}>
          <label style={{ fontSize: "0.95rem" }}>Filter by attachment</label>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="attachmentFilter"
                checked={attachmentFilter === "all"}
                onChange={() => setAttachmentFilter("all")}
              />
              All
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="attachmentFilter"
                checked={attachmentFilter === "attached"}
                onChange={() => setAttachmentFilter("attached")}
              />
              Attached
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer" }}>
              <input
                type="radio"
                name="attachmentFilter"
                checked={attachmentFilter === "not_attached"}
                onChange={() => setAttachmentFilter("not_attached")}
              />
              Not attached
            </label>
          </div>
        </div>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: 0 }}>
          {filteredKpis.length} of {kpis.length} KPIs
          {(kpiSearch.trim() || attachmentFilter !== "all" || tagFilterId != null) && " (filtered)"}
        </p>
      </div>

      <div className="card">
        {loading && kpis.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>Loading KPIs…</p>
        ) : filteredKpis.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            {kpis.length === 0 ? "No KPIs in this organization." : "No KPIs match your search."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {filteredKpis.map((kpi) => {
              const linked = isKpiInCategory(kpi, categoryId);
              const busy = togglingKpiId === kpi.id;
              const otherInSameDomain = getOtherCategoriesInSameDomain(kpi, domainId, categoryId);
              const attachedElsewhereInDomain = otherInSameDomain.length > 0;
              const unbindMessage =
                otherInSameDomain.length === 1
                  ? otherInSameDomain[0].name
                  : otherInSameDomain.map((t) => t.name).join(", ");
              return (
                <li
                  key={kpi.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0.75rem",
                    borderBottom: "1px solid var(--border)",
                    ...(attachedElsewhereInDomain
                      ? {
                          backgroundColor: "rgba(245, 158, 11, 0.12)",
                          borderLeft: "4px solid #d97706",
                          marginLeft: "-0.75rem",
                          paddingLeft: "0.75rem",
                        }
                      : {}),
                  }}
                >
                  <input
                    type="checkbox"
                    id={`kpi-${kpi.id}`}
                    checked={linked}
                    disabled={busy}
                    onChange={() => onToggleKpiCategory(kpi.id, linked)}
                  />
                  <label htmlFor={`kpi-${kpi.id}`} style={{ flex: 1, cursor: "pointer", margin: 0 }}>
                    <span>{kpi.name}</span>
                    {kpi.year != null && (
                      <span style={{ color: "var(--muted)", fontSize: "0.9rem", marginLeft: "0.35rem" }}>
                        ({kpi.year})
                      </span>
                    )}
                    {(kpi.organization_tags?.length ?? 0) > 0 && (
                      <span style={{ marginLeft: "0.5rem" }}>
                        {(kpi.organization_tags ?? []).map((t) => (
                          <span key={t.id} style={{ background: "var(--muted)", color: "var(--bg)", padding: "0.1rem 0.4rem", borderRadius: "4px", marginRight: "0.25rem", fontSize: "0.8rem" }}>{t.name}</span>
                        ))}
                      </span>
                    )}
                    {attachedElsewhereInDomain && (
                      <span style={{ display: "block", color: "#b45309", fontSize: "0.85rem", marginTop: "0.25rem", fontWeight: 500 }}>
                        Attaching to this category will unbind it from {unbindMessage} in this domain.
                      </span>
                    )}
                    {(kpi.category_tags?.length ?? 0) > 0 && (
                      <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.2rem" }}>
                        Attached: {formatAttachedDomainsAndCategories(kpi.category_tags)}
                      </span>
                    )}
                    {(kpi.category_tags?.length ?? 0) === 0 && !attachedElsewhereInDomain && (
                      <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.2rem", fontStyle: "italic" }}>
                        Not attached to any category
                      </span>
                    )}
                  </label>
                  {busy && <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Updating…</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
