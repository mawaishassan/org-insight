"use client";

import Link from "next/link";

export default function NoAccessPage() {
  return (
    <div className="container" style={{ maxWidth: 720, marginTop: "3rem" }}>
      <div className="card" style={{ padding: "1.25rem" }}>
        <h1 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1.4rem" }}>Welcome</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          You are signed in, but you are not assigned to any dashboards, reports, or KPIs yet.
        </p>
        <p style={{ marginBottom: 0 }}>
          Please contact your Organization Admin to assign access.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
          <Link className="btn" href="/dashboard/dashboards">
            Dashboards
          </Link>
          <Link className="btn" href="/dashboard/reports">
            Reports
          </Link>
          <Link className="btn" href="/dashboard/entries">
            Entries
          </Link>
        </div>
      </div>
    </div>
  );
}

