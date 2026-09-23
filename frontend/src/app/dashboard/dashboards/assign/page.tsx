"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function BulkDashboardAssignRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const dashboardId = searchParams?.get("dashboard_id");
    const orgId = searchParams?.get("organization_id");

    const params = new URLSearchParams();
    params.set("tab", "assign");
    params.set("resource_type", "dashboard");
    if (dashboardId) params.set("resource_id", dashboardId);
    if (orgId) params.set("organization_id", orgId);

    router.replace(`/dashboard/access/rights?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div style={{ maxWidth: 600, margin: "4rem auto", textAlign: "center", padding: "2rem" }}>
      <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🛡️</div>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Redirecting to Centralized Rights Management...
      </h2>
      <p style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Dashboard and report rights management has been unified into the centralized Access Management module.
      </p>
      <Link
        href="/dashboard/access/rights?tab=assign&resource_type=dashboard"
        style={{
          display: "inline-block",
          padding: "0.5rem 1.25rem",
          background: "#2563eb",
          color: "#ffffff",
          borderRadius: "6px",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.875rem",
        }}
      >
        Go to Rights Management →
      </Link>
    </div>
  );
}

export default function BulkDashboardAssignPage() {
  return (
    <Suspense fallback={<div style={{ padding: "3rem", textAlign: "center" }}>Loading...</div>}>
      <BulkDashboardAssignRedirect />
    </Suspense>
  );
}
