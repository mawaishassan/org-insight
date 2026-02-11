import { Suspense } from "react";
import DashboardLayout from "@/components/DashboardLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div style={{ padding: "1rem", color: "var(--muted)" }}>Loading…</div>}>
      <DashboardLayout>{children}</DashboardLayout>
    </Suspense>
  );
}
