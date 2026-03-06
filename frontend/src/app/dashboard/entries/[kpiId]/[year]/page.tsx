"use client";

import DomainKpiDetailPage from "../../../domains/[id]/kpis/[kpiId]/page";

/**
 * Entry detail page: same full UX as domain KPI detail (Part 1: header/actions, Part 2: attachments, Part 3: field tabs)
 * with time dimension: period bar and period_key in API calls. No domain context (domainId undefined).
 */
export default function EntryDetailPage() {
  return <DomainKpiDetailPage />;
}
