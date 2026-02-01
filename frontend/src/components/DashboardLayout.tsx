"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getAccessToken, clearTokens, type CurrentUser, type UserRole, canManageOrgs, canManageUsers, canManageDomains, canManageKpis, canEnterData, canViewReports } from "@/lib/auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

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
  // Super Admin accesses Domains, KPIs, Users, Data entry, Report templates, Reports only through Organizations
  const nav: { href: string; label: string; show: boolean }[] = [
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/dashboard/organizations", label: "Organizations", show: canManageOrgs(role) },
    { href: "/dashboard/users", label: "Users", show: !isSuperAdmin && canManageUsers(role) },
    { href: "/dashboard/domains", label: "Domains", show: !isSuperAdmin && canManageDomains(role) },
    { href: "/dashboard/kpis", label: "KPIs", show: !isSuperAdmin && canManageKpis(role) },
    { href: "/dashboard/entries", label: "Data entry", show: !isSuperAdmin && canEnterData(role) },
    { href: "/dashboard/reports/templates", label: "Report templates", show: !isSuperAdmin && canManageKpis(role) },
    { href: "/dashboard/reports", label: "Reports", show: !isSuperAdmin && canViewReports(role) },
  ].filter((x) => x.show);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 220, borderRight: "1px solid var(--border)", padding: "1rem 0" }}>
        <div style={{ padding: "0 1rem", marginBottom: "1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          {user.full_name || user.username} · {user.role}
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{
                padding: "0.5rem 1rem",
                color: pathname === href || (href !== "/dashboard" && pathname.startsWith(href)) ? "var(--accent)" : "var(--text)",
                fontWeight: pathname === href || (href !== "/dashboard" && pathname.startsWith(href)) ? 600 : 400,
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <button
          className="btn"
          style={{ marginTop: "1rem", marginLeft: "1rem" }}
          onClick={() => {
            clearTokens();
            router.push("/login");
            router.refresh();
          }}
        >
          Sign out
        </button>
      </aside>
      <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
    </div>
  );
}
