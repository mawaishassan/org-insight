"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface TemplateRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  year: number;
}

export default function ReportsPage() {
  const [list, setList] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const canManageAssignments = userRole === "ORG_ADMIN" || userRole === "SUPER_ADMIN";

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<TemplateRow[]>("/reports/templates", { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<{ role: string; organization_id: number | null }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Reports</h1>
      <div className="card">
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
          View and print reports you have access to.
          {canManageAssignments && " Use “Assign users” to give others access with view/print/export rights."}
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {list.map((t) => (
            <li key={t.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <Link href={`/dashboard/reports/${t.id}/design`} style={{ fontWeight: 500, flex: "1 1 auto" }}>
                {t.name}
              </Link>
              <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Year {t.year}</span>
              {canManageAssignments && (
                <Link className="btn" href={`/dashboard/reports/${t.id}/assign`} style={{ fontSize: "0.85rem" }}>
                  Assign users
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
