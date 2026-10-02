import { Suspense } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import PageLoader from "@/components/PageLoader";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg, #f8fafc)" }}>
        <PageLoader size="large" text="Loading workspace…" />
      </div>
    }>
      <DashboardLayout>{children}</DashboardLayout>
    </Suspense>
  );
}
