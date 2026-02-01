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

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<TemplateRow[]>("/reports/templates", { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Reports</h1>
      <div className="card">
        <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>View and print reports you have access to.</p>
        <ul style={{ listStyle: "none" }}>
          {list.map((t) => (
            <li key={t.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
              <Link href={`/dashboard/reports/${t.id}`} style={{ fontWeight: 500 }}>
                {t.name}
              </Link>
              <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>Year {t.year}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
