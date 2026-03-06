"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Redirect to the year-scoped entry page so period bar and data entry form are available.
 * Route: /dashboard/entries/kpi/[kpiId]?year=2026&organization_id=3
 * -> /dashboard/entries/[kpiId]/2026?organization_id=3
 */
export default function EntriesKpiRedirectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const kpiId = params.kpiId as string;
  const year = searchParams.get("year") || String(new Date().getFullYear());
  const organizationId = searchParams.get("organization_id");
  const periodKey = searchParams.get("period_key");

  useEffect(() => {
    if (!kpiId) return;
    const path = `/dashboard/entries/${kpiId}/${year}`;
    const q = new URLSearchParams();
    if (organizationId) q.set("organization_id", organizationId);
    if (periodKey) q.set("period_key", periodKey);
    const query = q.toString();
    router.replace(query ? `${path}?${query}` : path);
  }, [kpiId, year, organizationId, periodKey, router]);

  return <p style={{ padding: "1rem" }}>Redirecting to data entry…</p>;
}
