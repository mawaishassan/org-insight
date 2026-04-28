"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [msg, setMsg] = useState<string>("Redirecting…");
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const me = await api<{ role: string; organization_id: number | null }>("/auth/me", { token });
        if (me.role === "SUPER_ADMIN") {
          router.replace("/dashboard/organizations");
          return;
        }

        // For tenant users, prefer dashboards/reports they can view.
        const orgId = me.organization_id;
        if (!orgId) {
          router.replace("/dashboard/no-access");
          return;
        }

        setMsg("Checking your access…");
        const [dashboards, reports] = await Promise.all([
          api<Array<{ id: number }>>(`/dashboards?organization_id=${orgId}`, { token }).catch(() => []),
          api<Array<{ id: number }>>(`/reports/templates?organization_id=${orgId}`, { token }).catch(() => []),
        ]);

        if (Array.isArray(dashboards) && dashboards.length > 0) {
          router.replace(`/dashboard/dashboards/${dashboards[0]!.id}?organization_id=${orgId}`);
          return;
        }
        if (Array.isArray(reports) && reports.length > 0) {
          router.replace(`/dashboard/reports/${reports[0]!.id}?organization_id=${orgId}`);
          return;
        }

        // Fall back to entries; if user has no KPI rights the page will show an empty state.
        router.replace("/dashboard/entries");
      } catch {
        router.replace("/dashboard/no-access");
      }
    })();
  }, [router]);
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--muted)" }}>{msg}</p>
    </div>
  );
}
