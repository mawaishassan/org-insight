"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Organization KPI edit page.
 * Redirects to the KPI fields page with organization_id so the user can edit
 * the KPI and manage fields on the same page.
 */
export default function OrganizationKpiEditPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.id;
  const kpiId = params.kpiId;

  useEffect(() => {
    if (orgId && kpiId) {
      router.replace(`/dashboard/kpis/${kpiId}/fields?organization_id=${orgId}&tab=details`);
    }
  }, [orgId, kpiId, router]);

  return (
    <div style={{ padding: "1rem" }}>
      <p style={{ color: "var(--muted)" }}>Redirecting to KPI edit page…</p>
    </div>
  );
}
