"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    api<{ role: string }>("/auth/me", { token })
      .then((me) => {
        router.replace(me.role === "SUPER_ADMIN" ? "/dashboard/organizations" : "/dashboard/entries");
      })
      .catch(() => router.replace("/dashboard/entries"));
  }, [router]);
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--muted)" }}>Redirecting…</p>
    </div>
  );
}
