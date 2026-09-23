"use client";

import { useEffect, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SingleDashboardAssignRedirect() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id;
  const orgId = searchParams?.get("organization_id");

  useEffect(() => {
    if (!id) return;
    const q = new URLSearchParams();
    q.set("tab", "resource");
    q.set("resource_type", "dashboard");
    q.set("resource_id", String(id));
    if (orgId) q.set("organization_id", orgId);

    router.replace(`/dashboard/access/rights?${q.toString()}`);
  }, [router, id, orgId]);

  return (
    <div style={{ maxWidth: 600, margin: "4rem auto", textAlign: "center", padding: "2rem" }}>
      <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🛡️</div>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Redirecting to Centralized Rights Management...
      </h2>
      <p style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Dashboard access management has been unified into the centralized Access Management module.
      </p>
      {id && (
        <Link
          href={`/dashboard/access/rights?tab=resource&resource_type=dashboard&resource_id=${id}`}
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
          Manage Dashboard Rights →
        </Link>
      )}
    </div>
  );
}

export default function DashboardAssignPage() {
  return (
    <Suspense fallback={<div style={{ padding: "3rem", textAlign: "center" }}>Loading...</div>}>
      <SingleDashboardAssignRedirect />
    </Suspense>
  );
}
