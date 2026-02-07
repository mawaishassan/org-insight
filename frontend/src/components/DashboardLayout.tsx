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
} from "@/lib/auth";

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);

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

  const onEntries = pathname === "/dashboard/entries";
  const yearParam = onEntries ? searchParams.get("year") : null;
  const year = yearParam ? Number(yearParam) : currentYear;
  const orgId = user?.organization_id ?? null;
  const canEnter = user && canEnterData(user.role as UserRole);
  const canShowFilters = onEntries && canEnter && orgId != null;

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

  const hamburgerItems: { href: string; label: string; show: boolean }[] = [
    { href: "/dashboard/reports", label: "Reports", show: !isSuperAdmin && !isDataEntryOnlyUser && canViewReports(role) },
    { href: "/dashboard/reports/templates", label: "Report templates", show: isSuperAdmin },
    { href: "/dashboard/users", label: "Users", show: !isSuperAdmin && canManageUsers(role) },
  ].filter((x) => x.show);

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
        <Link
          href="/dashboard/entries"
          style={{
            fontWeight: 700,
            fontSize: "1rem",
            color: pathname === "/dashboard/entries" ? "var(--accent)" : "var(--text)",
            textDecoration: "none",
          }}
        >
          Home
        </Link>

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
                minWidth: 160,
                padding: "0.5rem 0",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "var(--shadow-md)",
                zIndex: 100,
              }}
            >
              {canManageOrgs(role) && (
                <Link
                  href="/dashboard/organizations"
                  style={{ display: "block", padding: "0.5rem 1rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                  onClick={() => setMenuOpen(false)}
                >
                  Organizations
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
              {!isSuperAdmin && canManageDomains(role) && (
                <Link
                  href="/dashboard/domains"
                  style={{ display: "block", padding: "0.5rem 1rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                  onClick={() => setMenuOpen(false)}
                >
                  Domains
                </Link>
              )}
              {isSuperAdmin && canManageKpis(role) && (
                <Link
                  href="/dashboard/kpis"
                  style={{ display: "block", padding: "0.5rem 1rem", color: "var(--text)", textDecoration: "none", fontSize: "0.9rem" }}
                  onClick={() => setMenuOpen(false)}
                >
                  KPIs
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
            </div>
          )}
        </div>
      </header>

      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
    </div>
  );
}
