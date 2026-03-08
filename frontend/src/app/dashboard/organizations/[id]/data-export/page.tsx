"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";

/** Redirect to organization Settings tab with API export sub-panel. */
export default function OrganizationDataExportPage() {
  const params = useParams();
  const router = useRouter();
  const orgIdParam = params?.id;
  const orgId = useMemo(() => {
    if (!orgIdParam) return null;
    if (Array.isArray(orgIdParam)) return parseInt(orgIdParam[0] as string, 10) || null;
    const n = parseInt(orgIdParam as string, 10);
    return Number.isNaN(n) ? null : n;
  }, [orgIdParam]);

  useEffect(() => {
    if (orgId != null) {
      router.replace(`/dashboard/organizations/${orgId}?tab=settings&sub=api_export`);
    }
  }, [orgId, router]);

  if (orgId == null) {
    return <p>Invalid organization id.</p>;
  }
  return <p style={{ color: "var(--muted)" }}>Redirecting to API export settings…</p>;
}
