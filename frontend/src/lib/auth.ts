/**
 * Auth helpers: token storage and current user.
 */

import Cookies from "js-cookie";

const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

export function getAccessToken(): string | undefined {
  return Cookies.get(ACCESS_KEY);
}

export function setTokens(access: string, refresh: string): void {
  Cookies.set(ACCESS_KEY, access, { sameSite: "lax", secure: typeof window !== "undefined" && window.location?.protocol === "https:" });
  Cookies.set(REFRESH_KEY, refresh, { sameSite: "lax", secure: typeof window !== "undefined" && window.location?.protocol === "https:" });
}

export function clearTokens(): void {
  Cookies.remove(ACCESS_KEY);
  Cookies.remove(REFRESH_KEY);
}

export type UserRole = "SUPER_ADMIN" | "ORG_ADMIN" | "USER" | "REPORT_VIEWER";

export interface CurrentUser {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  organization_id: number | null;
  is_active: boolean;
}

export function canManageOrgs(role: UserRole): boolean {
  return role === "SUPER_ADMIN";
}

export function canManageUsers(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "ORG_ADMIN";
}

export function canManageDomains(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "ORG_ADMIN";
}

/** Only Super Admin may create/edit/delete domains and categories. Org Admin can view only. */
export function canEditDomainsAndCategories(role: UserRole): boolean {
  return role === "SUPER_ADMIN";
}

/** Only Super Admin may edit, delete, or manage fields on KPIs page. Org Admin can assign users only. */
export function canEditKpis(role: UserRole): boolean {
  return role === "SUPER_ADMIN";
}

export function canManageKpis(role: UserRole): boolean {
  return role === "SUPER_ADMIN" || role === "ORG_ADMIN";
}

export function canEnterData(role: UserRole): boolean {
  return role === "USER" || role === "ORG_ADMIN" || role === "SUPER_ADMIN";
}

export function canViewReports(role: UserRole): boolean {
  return role === "REPORT_VIEWER" || role === "ORG_ADMIN" || role === "SUPER_ADMIN" || role === "USER";
}
