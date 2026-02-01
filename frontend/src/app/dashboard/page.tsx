"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

export default function DashboardPage() {
  const [me, setMe] = useState<{ username: string; role: string; full_name: string | null } | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api<{ username: string; role: string; full_name: string | null }>("/auth/me", { token }).then(setMe);
  }, []);

  return (
    <div>
      <h1 style={{ marginBottom: "1rem", fontSize: "1.5rem" }}>Dashboard</h1>
      <div className="card" style={{ maxWidth: 400 }}>
        {me && (
          <>
            <p><strong>Welcome,</strong> {me.full_name || me.username}</p>
            <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>Role: {me.role}</p>
          </>
        )}
      </div>
    </div>
  );
}
