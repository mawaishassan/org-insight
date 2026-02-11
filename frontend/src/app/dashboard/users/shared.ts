/** Shared types and helpers for dashboard users (list + detail). */

export type KpiPermission = "" | "data_entry" | "view";

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  organization_id: number | null;
  is_active: boolean;
}

export interface KpiOption {
  id: number;
  name: string;
  year: number;
  domain_id?: number | null;
}

/** One row in KPI rights: same name may exist for multiple years; rights apply to all years. */
export interface KpiGroup {
  name: string;
  kpiIds: number[];
}

export interface DomainOption {
  id: number;
  name: string;
}

export interface ReportTemplateOption {
  id: number;
  name: string;
  year: number;
}

export interface UserKpiAssignmentRow {
  kpi_id: number;
  permission: string;
}

export const currentYear = new Date().getFullYear();
export const yearOptions = [currentYear, currentYear - 1, currentYear - 2, currentYear + 1];

export function kpiAssignmentsToMap(assignments: UserKpiAssignmentRow[]): Record<number, KpiPermission> {
  const map: Record<number, KpiPermission> = {};
  for (const a of assignments) {
    const p = a.permission === "view" ? "view" : "data_entry";
    map[a.kpi_id] = p;
  }
  return map;
}

export function buildKpiAssignmentsPayload(perKpi: Record<number, KpiPermission>): { kpi_id: number; permission: string }[] {
  return Object.entries(perKpi)
    .filter(([, perm]) => perm !== "")
    .map(([kpiId, permission]) => ({ kpi_id: Number(kpiId), permission }));
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") search.set(k, String(v));
  });
  return search.toString();
}

/** Group KPIs by name so rights are per-KPI (all years). Same name = one row, one permission for all year variants. */
export function groupKpisByName(kpis: KpiOption[]): KpiGroup[] {
  const byName = new Map<string, number[]>();
  for (const k of kpis) {
    const list = byName.get(k.name) ?? [];
    list.push(k.id);
    byName.set(k.name, list);
  }
  return Array.from(byName.entries(), ([name, kpiIds]) => ({ name, kpiIds: kpiIds.sort((a, b) => a - b) }));
}
