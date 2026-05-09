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
        const available = await api<Array<{ id: number }>>(
          `/entries/available-kpis?organization_id=${orgId}&limit=1`,
          { token }
        ).catch(() => []);
        const hasKpiRights = Array.isArray(available) && available.length > 0;
        if (hasKpiRights) {
          router.replace("/dashboard/entries");
          return;
        }

        // No KPI rights: land on dashboard home (list), not a specific dashboard.
        router.replace(`/dashboard/dashboards?organization_id=${orgId}`);
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
