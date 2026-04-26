"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
import {
  getAccessToken,
  clearTokens,
  type CurrentUser,
  type UserRole,
  canManageOrgs,
  canManageUsers,
  canManageDomains,
  canManageKpis,
  canEnterData,
  canViewReports,
  canUseChat,
} from "@/lib/auth";

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);

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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [orgTags, setOrgTags] = useState<OrgTagRow[]>([]);
  const [selectedOrgName, setSelectedOrgName] = useState<string | null>(null);
  /** For routes outside /dashboard/organizations/[id] that still have org context (e.g. kpis/[id]/fields?organization_id=3). */
  const [breadcrumbTail, setBreadcrumbTail] = useState<{ orgId: number; orgName: string | null; segments: { label: string; href: string }[] } | null>(null);
  /** Ignore stale breadcrumb API responses when pathname/query changes quickly (avoids clearing tail or showing wrong year). */
  const breadcrumbFetchGenRef = useRef(0);

  const onEntries = pathname === "/dashboard/entries";
  const yearParam = onEntries ? searchParams.get("year") : null;
  const year = yearParam ? Number(yearParam) : currentYear;
  const orgId = user?.organization_id ?? null;
  const canEnter = user && canEnterData(user.role as UserRole);
  const canShowFilters = onEntries && canEnter && orgId != null;

  /** When super admin is in any organization context: org detail path, or organization_id in URL, or breadcrumb (e.g. report page loads org from API). */
  const orgDetailMatch = pathname.match(/^\/dashboard\/organizations\/(\d+)(?:\/|$)/);
  const orgIdFromPath = orgDetailMatch ? Number(orgDetailMatch[1]) : null;
  const orgIdFromQuery = searchParams.get("organization_id");
  const orgIdFromBreadcrumb = breadcrumbTail?.orgId && breadcrumbTail.orgId > 0 ? breadcrumbTail.orgId : null;
  const selectedOrgId = orgIdFromPath ?? (orgIdFromQuery ? Number(orgIdFromQuery) : null) ?? orgIdFromBreadcrumb;

  const kpiFieldsMatch = pathname.match(/^\/dashboard\/kpis\/(\d+)\/fields\/?$/);
  const domainDetailMatch = pathname.match(/^\/dashboard\/domains\/(\d+)\/?$/);
  const reportDetailMatch = pathname.match(/^\/dashboard\/reports\/(\d+)(?:\/|$)/);
  const dashboardDetailMatch = pathname.match(/^\/dashboard\/dashboards\/(\d+)(?:\/|$)/);
  const dataExportMatch = pathname.match(/^\/dashboard\/organizations\/(\d+)\/data-export\/?$/);
  const usersDetailMatch = pathname.match(/^\/dashboard\/users\/(\d+)\/?$/);
  const entryDetailMatch = pathname.match(/^\/dashboard\/entries\/(\d+)\/(\d+)\/?$/);
  const entryMultiMatch = pathname.match(/^\/dashboard\/entries\/(\d+)\/(\d+)\/multi\/(\d+)\/?$/);
  const entryMultiRowMatch = pathname.match(/^\/dashboard\/entries\/(\d+)\/(\d+)\/multi\/(\d+)\/row\/([^/]+)\/?$/);

  const dashboardDesignMatch = pathname.match(/^\/dashboard\/dashboards\/(\d+)\/design\/?$/);
  const isDashboardDesign = !!dashboardDesignMatch;
  const dashboardDesignId = dashboardDesignMatch ? Number(dashboardDesignMatch[1]) : null;
  const dashboardViewMatch = pathname.match(/^\/dashboard\/dashboards\/(\d+)\/?$/);
  const isDashboardView = !!dashboardViewMatch;
  const dashboardViewId = dashboardViewMatch ? Number(dashboardViewMatch[1]) : null;
  const dashboardWidgetFullMatch = pathname.match(/^\/dashboard\/dashboards\/(\d+)\/widgets\/([^/]+)\/?$/);
  const isDashboardWidgetFull = !!dashboardWidgetFullMatch;
  const dashboardWidgetFullDashboardId = dashboardWidgetFullMatch ? Number(dashboardWidgetFullMatch[1]) : null;

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.push("/login");
      return;
    }
    api<CurrentUser>("/auth/me", { token })
      .then(setUser)
      .catch(() => {
        clearTokens();
        router.push("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!getAccessToken() || !orgId || !onEntries) return;
    const query = `?${qs({ organization_id: orgId })}`;
    api<DomainRow[]>(`/domains${query}`, { token: getAccessToken() })
      .then(setDomains)
      .catch(() => setDomains([]));
    api<OrgTagRow[]>(`/organizations/${orgId}/tags`, { token: getAccessToken() })
      .then(setOrgTags)
      .catch(() => setOrgTags([]));
  }, [orgId, onEntries]);

  useEffect(() => {
    const domainId = searchParams.get("domain_id");
    if (!getAccessToken() || !domainId || !orgId) {
      setCategories([]);
      return;
    }
    const query = `?${qs({ domain_id: Number(domainId), organization_id: orgId })}`;
    api<CategoryRow[]>(`/categories${query}`, { token: getAccessToken() })
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [searchParams.get("domain_id"), orgId]);

  useEffect(() => {
    // Organization detail endpoint is Super Admin only; avoid triggering 403 spam for org admins.
    if (!selectedOrgId || !getAccessToken() || user?.role !== "SUPER_ADMIN") {
      setSelectedOrgName(null);
      return;
    }
    api<{ id: number; name: string }>(`/organizations/${selectedOrgId}`, { token: getAccessToken()! })
      .then((org) => setSelectedOrgName(org.name))
      .catch(() => setSelectedOrgName(null));
  }, [selectedOrgId, user?.role]);

  useEffect(() => {
    const token = getAccessToken();
    const fetchId = ++breadcrumbFetchGenRef.current;
    const applyBreadcrumbTail = (tail: Parameters<typeof setBreadcrumbTail>[0]) => {
      if (fetchId !== breadcrumbFetchGenRef.current) return;
      setBreadcrumbTail(tail);
    };
    if (!token) {
      applyBreadcrumbTail(null);
      return;
    }
    const orgIdFromQuery = searchParams.get("organization_id");
    const oid = orgIdFromQuery ? Number(orgIdFromQuery) : null;

    if (kpiFieldsMatch && oid) {
      const kpiId = Number(kpiFieldsMatch[1]);
      Promise.all([
        api<{ id: number; name: string }>(`/organizations/${oid}`, { token }),
        api<{ id: number; name: string }>(`/kpis/${kpiId}?${qs({ organization_id: oid })}`, { token }),
      ])
        .then(([org, kpi]) => {
          applyBreadcrumbTail({
            orgId: oid,
            orgName: org.name,
            segments: [
              { label: "KPIs", href: `/dashboard/organizations/${oid}?tab=kpis` },
              { label: kpi.name, href: `/dashboard/kpis/${kpiId}/fields?organization_id=${oid}` },
            ],
          });
        })
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    if (domainDetailMatch && oid) {
      const domainId = Number(domainDetailMatch[1]);
      Promise.all([
        api<{ id: number; name: string }>(`/organizations/${oid}`, { token }),
        api<{ id: number; name: string }>(`/domains/${domainId}?${qs({ organization_id: oid })}`, { token }),
      ])
        .then(([org, domain]) => {
          applyBreadcrumbTail({
            orgId: oid,
            orgName: org.name,
            segments: [
              { label: "Domains", href: `/dashboard/organizations/${oid}?tab=domains` },
              { label: domain.name, href: `/dashboard/domains/${domainId}?organization_id=${oid}` },
            ],
          });
        })
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    if (reportDetailMatch) {
      const reportId = Number(reportDetailMatch[1]);
      const designMatch = pathname.match(/^\/dashboard\/reports\/\d+\/design\/?$/);
      const assignMatch = pathname.match(/^\/dashboard\/reports\/\d+\/assign\/?$/);
      api<{ id: number; name: string; organization_id: number }>(`/reports/templates/${reportId}`, { token })
        .then((report) => {
          const rid = report.organization_id;
          return api<{ id: number; name: string }>(`/organizations/${rid}`, { token }).then((org) => {
            const segments: { label: string; href: string }[] = [
              { label: "Reports", href: `/dashboard/organizations/${rid}?tab=reports` },
              { label: report.name, href: `/dashboard/reports/${reportId}?organization_id=${rid}` },
            ];
            if (designMatch) {
              segments.push({ label: "Design", href: `/dashboard/reports/${reportId}/design?organization_id=${rid}` });
            } else if (assignMatch) {
              segments.push({ label: "Assign", href: `/dashboard/reports/${reportId}/assign?organization_id=${rid}` });
            }
            return { orgId: rid, orgName: org.name, segments };
          });
        })
        .then((tail) => applyBreadcrumbTail(tail))
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    if (dashboardDetailMatch) {
      const dashboardId = Number(dashboardDetailMatch[1]);
      const designMatch = pathname.match(/^\/dashboard\/dashboards\/\d+\/design\/?$/);
      const assignMatch = pathname.match(/^\/dashboard\/dashboards\/\d+\/assign\/?$/);
      api<{ id: number; name: string; organization_id: number }>(`/dashboards/${dashboardId}`, { token })
        .then((d) => {
          const oid = d.organization_id;
          const segments: { label: string; href: string }[] = [
            { label: "Dashboards", href: `/dashboard/dashboards?${qs({ organization_id: oid })}` },
            { label: d.name, href: `/dashboard/dashboards/${dashboardId}?organization_id=${oid}` },
          ];
          if (designMatch) {
            segments.push({ label: "Design", href: `/dashboard/dashboards/${dashboardId}/design?organization_id=${oid}` });
          } else if (assignMatch) {
            segments.push({ label: "Assign", href: `/dashboard/dashboards/${dashboardId}/assign?organization_id=${oid}` });
          }

          // Organization detail endpoint is Super Admin only; for other roles, show breadcrumbs without org name.
          if (user?.role !== "SUPER_ADMIN") {
            return { orgId: oid, orgName: null, segments };
          }

          return api<{ id: number; name: string }>(`/organizations/${oid}`, { token })
            .then((org) => ({ orgId: oid, orgName: org.name, segments }))
            .catch(() => ({ orgId: oid, orgName: null, segments }));
        })
        .then((tail) => applyBreadcrumbTail(tail))
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    if (usersDetailMatch) {
      const userId = usersDetailMatch[1];
      api<{ id: number; username: string; full_name: string | null }>(`/users/${userId}`, { token })
        .then((u) => {
          applyBreadcrumbTail({
            orgId: 0,
            orgName: null,
            segments: [
              { label: "Users", href: "/dashboard/users" },
              { label: u.full_name || u.username, href: `/dashboard/users/${userId}` },
            ],
          });
        })
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    if (entryMultiRowMatch) {
      const kpiId = Number(entryMultiRowMatch[1]);
      const targetYear = entryMultiRowMatch[2];
      const fieldId = Number(entryMultiRowMatch[3]);
      const rowIndexStr = entryMultiRowMatch[4];
      const isNew = rowIndexStr === "new";
      const rowIndexNum = isNew ? null : Number(rowIndexStr);
      const orgForQuery = oid || undefined;
      const params = qs({
        kpi_id: kpiId,
        field_id: fieldId,
        minimal: 1,
        organization_id: orgForQuery,
      });

      Promise.all([
        api<{ id: number; name: string }>(`/kpis/${kpiId}/minimal?${qs({ organization_id: orgForQuery })}`, { token }),
        api<Array<{ id: number; name: string }>>(`/entries/fields?${params}`, { token }),
      ])
        .then(([kpi, fields]) => {
          const field = fields.find((f) => f.id === fieldId) || null;
          const yearHref = `/dashboard/entries?${qs({ year: targetYear, organization_id: orgForQuery })}`;
          const entryHref = `/dashboard/entries/${kpiId}/${targetYear}${
            orgForQuery ? `?${qs({ organization_id: orgForQuery })}` : ""
          }`;
          const multiHref = `/dashboard/entries/${kpiId}/${targetYear}/multi/${fieldId}${
            orgForQuery ? `?${qs({ organization_id: orgForQuery })}` : ""
          }`;
          const lastLabel = isNew
            ? "New record"
            : rowIndexNum != null
            ? `Record #${rowIndexNum + 1} detail`
            : "Record detail";
          const segments = [
            { label: targetYear, href: yearHref },
            { label: kpi.name, href: entryHref },
            {
              label: field ? `${field.name} (multiple record entry)` : "Multiple record entry",
              href: multiHref,
            },
            { label: lastLabel, href: pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "") },
          ];
          applyBreadcrumbTail({
            orgId: oid || 0,
            orgName: null,
            segments,
          });
        })
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    if (entryMultiMatch) {
      const kpiId = Number(entryMultiMatch[1]);
      const targetYear = entryMultiMatch[2];
      const fieldId = Number(entryMultiMatch[3]);
      const orgForQuery = oid || undefined;
      const params = qs({
        kpi_id: kpiId,
        field_id: fieldId,
        minimal: 1,
        organization_id: orgForQuery,
      });

      Promise.all([
        api<{ id: number; name: string }>(`/kpis/${kpiId}/minimal?${qs({ organization_id: orgForQuery })}`, { token }),
        api<Array<{ id: number; name: string }>>(`/entries/fields?${params}`, { token }),
      ])
        .then(([kpi, fields]) => {
          const field = fields.find((f) => f.id === fieldId) || null;
          const yearHref = `/dashboard/entries?${qs({ year: targetYear, organization_id: orgForQuery })}`;
          const entryHref = `/dashboard/entries/${kpiId}/${targetYear}${
            orgForQuery ? `?${qs({ organization_id: orgForQuery })}` : ""
          }`;
          const multiHref = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
          const lastLabel = field ? `${field.name} (multiple record entry)` : "Multiple record entry";
          const segments = [
            { label: targetYear, href: yearHref },
            { label: kpi.name, href: entryHref },
            { label: lastLabel, href: multiHref },
          ];
          applyBreadcrumbTail({
            orgId: oid || 0,
            orgName: null,
            segments,
          });
        })
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    if (entryDetailMatch) {
      const kpiId = Number(entryDetailMatch[1]);
      const targetYear = entryDetailMatch[2];
      const orgQuery = oid ? `?organization_id=${oid}` : "";
      api<{ id: number; name: string }>(`/kpis/${kpiId}${orgQuery}`, { token })
        .then((kpi) => {
          const segments = [
            { label: targetYear, href: `/dashboard/entries?year=${targetYear}${oid ? `&organization_id=${oid}` : ""}` },
            { label: kpi.name, href: searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname },
          ];
          applyBreadcrumbTail({
            orgId: oid || 0,
            orgName: null, // we don't need the org name prefixed before segments here, the layout handles "Home" 
            segments,
          });
        })
        .catch(() => applyBreadcrumbTail(null));
      return;
    }
    applyBreadcrumbTail(null);
  }, [pathname, searchParams.get("organization_id"), user?.role]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading…
      </div>
    );
  }

  if (!user) return null;

  const role = user.role as UserRole;
  const isSuperAdmin = role === "SUPER_ADMIN";
  /** Data-entry-only user (USER role): no Year/filters in header, only Home + hamburger */
  const isDataEntryOnlyUser = role === "USER";

  const updateEntriesParams = (updates: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v === undefined || v === "" || v === "all") next.delete(k);
      else next.set(k, String(v));
    });
    router.push(`/dashboard/entries?${next.toString()}`);
  };

  const dashboardsHref =
    selectedOrgId != null
      ? `/dashboard/dashboards?organization_id=${selectedOrgId}`
      : user.organization_id != null
        ? `/dashboard/dashboards?organization_id=${user.organization_id}`
        : "/dashboard/dashboards";

  const hamburgerItems: { href: string; label: string; show: boolean }[] = [
    { href: dashboardsHref, label: "Dashboards", show: true },
    { href: "/dashboard/reports", label: "Reports", show: !isSuperAdmin && canViewReports(role) },
    { href: "/dashboard/access", label: "Access", show: canManageUsers(role) || isSuperAdmin },
  ].filter((x) => x.show);

  const tabLabel: Record<string, string> = {
    overview: "Overview",
    kpis: "KPIs",
    domains: "Domains",
    reports: "Reports",
    dashboards: "Dashboards",
    settings: "Settings",
  };
  const orgTabFromUrl = selectedOrgId ? searchParams.get("tab") : null;
  const orgTabLabel = orgTabFromUrl && tabLabel[orgTabFromUrl] ? tabLabel[orgTabFromUrl] : null;
  const onDataExport = pathname.match(/^\/dashboard\/organizations\/\d+\/data-export\/?$/);
  const onAccessControl = pathname.match(/^\/dashboard\/organizations\/\d+\/access\/?$/);

  /** Organization "home" = overview (cards) at /dashboard/organizations/[id] with no tab. */
  const orgHomeHref = (id: number) => `/dashboard/organizations/${id}`;

  const breadcrumbs: { label: string; href: string }[] = [];
  if (breadcrumbTail) {
    breadcrumbs.push({ label: "Home", href: isSuperAdmin ? "/dashboard/organizations" : "/dashboard/entries" });
    if (breadcrumbTail.orgId > 0 && breadcrumbTail.orgName) {
      breadcrumbs.push({
        label: breadcrumbTail.orgName,
        href: orgHomeHref(breadcrumbTail.orgId),
      });
    }
    breadcrumbTail.segments.forEach((s) => breadcrumbs.push(s));
  } else if (isSuperAdmin) {
    breadcrumbs.push({ label: "Home", href: "/dashboard/organizations" });
    if (selectedOrgId) {
      breadcrumbs.push({
        label: selectedOrgName ?? `Organization #${selectedOrgId}`,
        href: orgHomeHref(selectedOrgId),
      });
      if (onDataExport) {
        breadcrumbs.push({ label: "Settings", href: `/dashboard/organizations/${selectedOrgId}?tab=settings&sub=storage` });
        breadcrumbs.push({ label: "API export", href: `/dashboard/organizations/${selectedOrgId}?tab=settings&sub=api_export` });
      } else if (onAccessControl) {
        breadcrumbs.push({ label: "Access control", href: `/dashboard/organizations/${selectedOrgId}/access` });
      } else if (orgTabLabel) {
        const subHref = orgTabFromUrl === "settings" ? `/dashboard/organizations/${selectedOrgId}?tab=settings&sub=storage` : `/dashboard/organizations/${selectedOrgId}?tab=${orgTabFromUrl}`;
        breadcrumbs.push({ label: orgTabLabel, href: subHref });
      }
    }
  } else {
    breadcrumbs.push({ label: "Home", href: "/dashboard/entries" });
    if (pathname.startsWith("/dashboard/users/") && pathname !== "/dashboard/users") {
      breadcrumbs.push({ label: "Users", href: "/dashboard/users" });
    }
    if (pathname === "/dashboard/dashboards") {
      breadcrumbs.push({ label: "Dashboards", href: dashboardsHref });
    } else if (pathname.startsWith("/dashboard/dashboards/")) {
      // Tail should normally handle this; keep a safe fallback.
      breadcrumbs.push({ label: "Dashboards", href: dashboardsHref });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.6rem 1rem",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          flexWrap: "wrap",
        }}
      >
        <nav style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.95rem", flexWrap: "wrap" }} aria-label="Breadcrumb">
          {breadcrumbs.length === 0 ? (
            <Link
              href={isSuperAdmin ? "/dashboard/organizations" : "/dashboard/entries"}
              style={{
                fontWeight: 700,
                fontSize: "1rem",
                color: (isSuperAdmin ? pathname === "/dashboard/organizations" : pathname === "/dashboard/entries") ? "var(--accent)" : "var(--text)",
                textDecoration: "none",
              }}
            >
              Home
            </Link>
          ) : (
            breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                  {i > 0 && <span style={{ color: "var(--muted)", marginRight: "0.15rem" }} aria-hidden>{"\u203A"}</span>}
                  <Link
                    href={crumb.href}
                    style={{
                      color: isLast ? "var(--text)" : "var(--muted)",
                      textDecoration: "none",
                      fontWeight: isLast ? 600 : undefined,
                    }}
                  >
                    {crumb.label}
                  </Link>
                </span>
              );
            })
          )}
        </nav>

        {onEntries && canEnter && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label htmlFor="menu-year" style={{ fontSize: "0.85rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
              Year
            </label>
            <select
              id="menu-year"
              value={year}
              onChange={(e) => updateEntriesParams({ year: e.target.value })}
              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.9rem", minWidth: 80 }}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}

        {canShowFilters && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <input
              type="search"
              placeholder={'Search KPIs...'}
              value={searchParams.get("q") ?? ""}
              onChange={(e) => updateEntriesParams({ q: e.target.value || undefined })}
              style={{
                padding: "0.35rem 0.6rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                fontSize: "0.85rem",
                width: "clamp(120px, 20vw, 200px)",
              }}
            />
            <select
              value={searchParams.get("domain_id") ?? ""}
              onChange={(e) => updateEntriesParams({ domain_id: e.target.value || undefined, category_id: undefined })}
              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 100 }}
            >
              <option value="">All domains</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              value={searchParams.get("category_id") ?? ""}
              onChange={(e) => updateEntriesParams({ category_id: e.target.value || undefined })}
              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 100 }}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={searchParams.get("status") ?? "all"}
              onChange={(e) => updateEntriesParams({ status: e.target.value === "all" ? undefined : e.target.value })}
              style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 140 }}
            >
              <option value="all">All status</option>
              <option value="submitted">Submitted</option>
              <option value="draft">Drafted</option>
              <option value="not_entered">Not entered</option>
              <option value="no_user_assigned">No user assigned</option>
            </select>
            {orgTags.length > 0 && (
              <select
                value={searchParams.get("tag_id") ?? ""}
                onChange={(e) => updateEntriesParams({ tag_id: e.target.value || undefined })}
                style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem", minWidth: 90 }}
              >
                <option value="">All tags</option>
                {orgTags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div style={{ marginLeft: "auto", position: "relative" }} ref={menuRef}>
          {isDashboardWidgetFull && dashboardWidgetFullDashboardId ? (
            <Link
              href={`/dashboard/dashboards/${dashboardWidgetFullDashboardId}?${qs({ organization_id: selectedOrgId ?? undefined })}`}
              className="btn"
              style={{ marginRight: "0.5rem" }}
              onClick={() => setMenuOpen(false)}
            >
              Back to dashboard
            </Link>
          ) : null}
          {isSuperAdmin && isDashboardView && dashboardViewId ? (
            <Link
              href={`/dashboard/dashboards/${dashboardViewId}/design?${qs({ organization_id: selectedOrgId ?? undefined })}`}
              className="btn btn-primary"
              style={{ marginRight: "0.5rem" }}
              onClick={() => setMenuOpen(false)}
            >
              Design mode
            </Link>
          ) : null}
          {isSuperAdmin && isDashboardDesign && dashboardDesignId ? (
            <Link
              href={`${pathname}?${qs({
                organization_id: selectedOrgId ?? undefined,
                add_widget: 1,
              })}`}
              className="btn btn-primary"
              style={{ marginRight: "0.5rem" }}
              onClick={() => setMenuOpen(false)}
            >
              + Add widget
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              padding: "0.4rem 0.6rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              cursor: "pointer",
              fontSize: "1.1rem",
            }}
            aria-label="Menu"
          >
            ☰
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                minWidth: 200,
                padding: "0.5rem 0",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "var(--shadow-md)",
                zIndex: 100,
              }}
            >
              {isSuperAdmin && selectedOrgId ? (
                <>
                  <Link
                    href="/dashboard/organizations"
                    style={{ display: "block", padding: "0.5rem 1rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    Home
                  </Link>
                  <div style={{ borderTop: "1px solid var(--border)", margin: "0.35rem 0" }} />
                  <div style={{ padding: "0.35rem 1rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                    {selectedOrgName ?? `Organization #${selectedOrgId}`}
                  </div>
                  <Link
                    href={`/dashboard/organizations/${selectedOrgId}?tab=kpis`}
                    style={{ display: "block", padding: "0.5rem 1rem", paddingLeft: "1.5rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    KPIs
                  </Link>
                  <Link
                    href={`/dashboard/organizations/${selectedOrgId}?tab=domains`}
                    style={{ display: "block", padding: "0.5rem 1rem", paddingLeft: "1.5rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    Domains
                  </Link>
                  <Link
                    href={`/dashboard/organizations/${selectedOrgId}?tab=reports`}
                    style={{ display: "block", padding: "0.5rem 1rem", paddingLeft: "1.5rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    Reports
                  </Link>
                  <Link
                    href={dashboardsHref}
                    style={{ display: "block", padding: "0.5rem 1rem", paddingLeft: "1.5rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    Dashboards
                  </Link>
                  {/* Legacy per-organization access page removed in favor of /dashboard/access */}
                  <Link
                    href={`/dashboard/organizations/${selectedOrgId}?tab=settings&sub=storage`}
                    style={{ display: "block", padding: "0.5rem 1rem", paddingLeft: "1.5rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <div style={{ borderTop: "1px solid var(--border)", margin: "0.35rem 0" }} />
                  <div style={{ padding: "0.35rem 1rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                    Account
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      clearTokens();
                      router.push("/login");
                      router.refresh();
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "0.5rem 1rem",
                      paddingLeft: "1.5rem",
                      textAlign: "left",
                      border: "none",
                      background: "none",
                      font: "inherit",
                      color: "var(--text)",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                    }}
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  {canManageOrgs(role) && (
                    <Link
                      href="/dashboard/organizations"
                      style={{ display: "block", padding: "0.5rem 1rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                      onClick={() => setMenuOpen(false)}
                    >
                      Home
                    </Link>
                  )}
                  {hamburgerItems.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      style={{ display: "block", padding: "0.5rem 1rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                      onClick={() => setMenuOpen(false)}
                    >
                      {label}
                    </Link>
                  ))}
                  {/* Per-organization Access control entry removed; use /dashboard/access instead */}
                  {!isSuperAdmin && canManageDomains(role) && (
                    <Link
                      href="/dashboard/domains"
                      style={{ display: "block", padding: "0.5rem 1rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                      onClick={() => setMenuOpen(false)}
                    >
                      Domains
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      clearTokens();
                      router.push("/login");
                      router.refresh();
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "0.5rem 1rem",
                      textAlign: "left",
                      border: "none",
                      background: "none",
                      font: "inherit",
                      color: "var(--text)",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                    }}
                  >
                    Logout
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
    </div>
  );
}
