"use client";

import DomainKpiDetailPage from "@/app/dashboard/domains/[id]/kpis/[kpiId]/page";

/**
 * Standalone KPI detail page (no domain context).
 * Same UI as domain KPI detail; back link goes to Data entry.
 * Route: /dashboard/entries/kpi/[kpiId] — params only have kpiId (no id), so domainId is undefined.
 */
export default function StandaloneKpiDetailPage() {
  return <DomainKpiDetailPage />;
}
