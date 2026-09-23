"use client";

import React, { Suspense, useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { WidgetSpinnerLoader } from "@/components/WidgetSpinnerLoader";

// ===========================================================================
// SECTION 1: TYPES & INTERFACES
// ===========================================================================

type ResourceType = "dashboard" | "report" | "custom_report";
type AccessType = "full" | "unique_key";
type UserTypeFilter = "all" | "internal" | "external";
type ResourceTypeFilter = "all" | "dashboard" | "report";
type AccessTypeFilter = "all" | "full" | "unique_key";
type StatusFilter = "all" | "active" | "inactive";

interface RightItem {
  id: number;
  resource_type: ResourceType;
  resource_id: number;
  resource_name: string;
  user_id: number;
  user_name: string;
  username: string;
  user_email: string | null;
  user_type: "internal" | "external";
  user_unique_key: string | null;
  access_type: AccessType;
  restriction_summary: string;
  is_active: boolean;
  can_view: boolean;
  can_edit: boolean;
  can_print: boolean;
  can_export: boolean;
  can_download_word: boolean;
  can_change_period: boolean;
  can_load_lms: boolean;
  can_download_widget_pdf?: boolean;
  can_view_drilldown?: boolean;
  filter_column_configs: Record<string, string> | null;
  filter_sub_field_key: string | null;
  filter_kpi_id: number | null;
  filter_mli_id: number | null;
  created_at: string | null;
}

interface RightsListResponse {
  items: RightItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  active_count: number;
  inactive_count: number;
  full_access_count: number;
  unique_key_count: number;
}

interface UserOption {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_external?: boolean;
  unique_user_key?: string | null;
}

interface ResourceOption {
  id: number;
  name: string;
  description: string | null;
  resource_type: ResourceType;
}

interface FilterColumnItem {
  kpi_id: number;
  kpi_title: string;
  mli_id: number;
  mli_title: string;
  sub_field_id: number;
  sub_field_key: string;
  label: string;
  column_name?: string | null;
}

function formatMliColumnOption(col: FilterColumnItem): string {
  if (col.column_name) {
    return `${col.column_name} (${col.sub_field_key})`;
  }
  if (col.label) {
    if (col.label.includes("->")) {
      const parts = col.label.split("->").map((p) => p.trim());
      return parts[parts.length - 1];
    }
    if (col.label.includes(`(${col.sub_field_key})`)) {
      return col.label;
    }
    return `${col.label} (${col.sub_field_key})`;
  }
  return col.sub_field_key;
}

interface BulkAssignPayload {
  user_ids: number[];
  dashboard_ids: number[];
  custom_report_ids: number[];
  report_template_ids: number[];
  access_type: AccessType;
  can_view: boolean;
  can_edit: boolean;
  can_print: boolean;
  can_export: boolean;
  can_download_word: boolean;
  can_change_period: boolean;
  can_change_period_dashboards?: boolean;
  can_change_period_reports?: boolean;
  can_load_lms: boolean;
  can_download_widget_pdf?: boolean;
  can_view_drilldown?: boolean;
  filter_kpi_id?: number | null;
  filter_mli_id?: number | null;
  filter_sub_field_key?: string | null;
  filter_column_configs?: Record<string, string> | null;
  filter_operator?: string;
}

interface BulkAssignPreview {
  users_count: number;
  dashboards_count: number;
  reports_count: number;
  total_targets: number;
  new_assignments_count: number;
  existing_assignments_count: number;
  rights_to_update_count: number;
  no_changes_count: number;
  access_type: AccessType;
  restriction_preview: string | null;
}

interface BulkAssignResult {
  message: string;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  failed_count: number;
  failed_items: any[];
}

interface RightUpdatePayload {
  access_type?: AccessType;
  is_active?: boolean;
  can_view?: boolean;
  can_edit?: boolean;
  can_print?: boolean;
  can_export?: boolean;
  can_download_word?: boolean;
  can_change_period?: boolean;
  can_load_lms?: boolean;
  can_download_widget_pdf?: boolean;
  can_view_drilldown?: boolean;
  filter_kpi_id?: number | null;
  filter_mli_id?: number | null;
  filter_sub_field_key?: string | null;
  filter_column_configs?: Record<string, string> | null;
}

interface BulkTargetItem {
  permission_id: number;
  resource_type: ResourceType;
  user_id: number;
  resource_id: number;
}

interface UserAssignedResource {
  permission_id: number;
  resource_type: ResourceType;
  resource_id: number;
  resource_name: string;
  access_type: AccessType;
  restriction_summary: string;
  is_active: boolean;
  can_view: boolean;
  can_edit: boolean;
  can_print: boolean;
  can_export: boolean;
  can_download_word: boolean;
  can_change_period: boolean;
  can_load_lms: boolean;
  can_download_widget_pdf?: boolean;
  can_view_drilldown?: boolean;
  is_default?: boolean;
}

interface UserRightsSummary {
  user_id: number;
  username: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_external: boolean;
  unique_user_key: string | null;
  dashboards: UserAssignedResource[];
  reports: UserAssignedResource[];
  default_dashboard_id?: number | null;
}

interface ResourceAssignedUser {
  permission_id: number;
  user_id: number;
  username: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_external: boolean;
  unique_user_key: string | null;
  access_type: AccessType;
  restriction_summary: string;
  is_active: boolean;
  can_view: boolean;
  can_edit: boolean;
  can_print: boolean;
  can_export: boolean;
  can_change_period: boolean;
  can_load_lms: boolean;
  can_download_word?: boolean;
  can_download_widget_pdf?: boolean;
  can_view_drilldown?: boolean;
}

interface ResourceRightsSummary {
  resource_type: ResourceType;
  resource_id: number;
  resource_name: string;
  assigned_users: ResourceAssignedUser[];
}

interface AuditLogItem {
  id: number;
  organization_id: number;
  user_id: number;
  username: string;
  user_full_name: string | null;
  resource_type: string;
  resource_id: number;
  resource_name: string | null;
  action: string;
  previous_access: any;
  new_access: any;
  previous_config: any;
  new_config: any;
  changed_by_id: number | null;
  changed_by_name: string | null;
  created_at: string;
}

interface AuditLogListResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ===========================================================================
// SECTION 2: API SERVICE CLIENT
// ===========================================================================

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

const rightsService = {
  async getRights(
    token: string,
    params: {
      organization_id?: number | null;
      page?: number;
      page_size?: number;
      user_type?: string;
      resource_type?: string;
      access_type?: string;
      status?: string;
      search?: string;
      user_id?: number | null;
      resource_id?: number | null;
    }
  ): Promise<RightsListResponse> {
    const query = qs(params);
    return api<RightsListResponse>(`/access-management/rights?${query}`, { token });
  },

  async previewBulkAssign(token: string, payload: BulkAssignPayload, orgId?: number | null): Promise<BulkAssignPreview> {
    const query = qs({ organization_id: orgId });
    return api<BulkAssignPreview>(`/access-management/rights/preview?${query}`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },

  async executeBulkAssign(token: string, payload: BulkAssignPayload, orgId?: number | null): Promise<BulkAssignResult> {
    const query = qs({ organization_id: orgId });
    return api<BulkAssignResult>(`/access-management/rights/bulk-assign?${query}`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
  },

  async updateRight(
    token: string,
    resourceType: string,
    permissionId: number,
    patch: RightUpdatePayload,
    orgId?: number | null
  ): Promise<{ message: string; id: number }> {
    const query = qs({ organization_id: orgId });
    return api<{ message: string; id: number }>(`/access-management/rights/${resourceType}/${permissionId}?${query}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(patch),
    });
  },

  async revokeRight(token: string, resourceType: string, permissionId: number, orgId?: number | null): Promise<void> {
    const query = qs({ organization_id: orgId });
    return api<void>(`/access-management/rights/${resourceType}/${permissionId}?${query}`, {
      method: "DELETE",
      token,
    });
  },

  async bulkUpdate(
    token: string,
    items: BulkTargetItem[],
    action: "activate" | "deactivate" | "set_full_access" | "set_unique_key",
    options?: {
      filter_column_configs?: Record<string, string> | null;
      filter_sub_field_key?: string | null;
      orgId?: number | null;
    }
  ): Promise<{ message: string; updated_count: number }> {
    const query = qs({ organization_id: options?.orgId });
    return api<{ message: string; updated_count: number }>(`/access-management/rights/bulk-update?${query}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        items,
        action,
        filter_column_configs: options?.filter_column_configs,
        filter_sub_field_key: options?.filter_sub_field_key,
      }),
    });
  },

  async bulkRevoke(token: string, items: BulkTargetItem[], orgId?: number | null): Promise<{ message: string; revoked_count: number }> {
    const query = qs({ organization_id: orgId });
    return api<{ message: string; revoked_count: number }>(`/access-management/rights/bulk-revoke?${query}`, {
      method: "POST",
      token,
      body: JSON.stringify({ items }),
    });
  },

  async getUserRights(token: string, userId: number, orgId?: number | null): Promise<UserRightsSummary | null> {
    const query = qs({ organization_id: orgId });
    try {
      return await api<UserRightsSummary>(`/access-management/users/${userId}/rights?${query}`, { token });
    } catch (err) {
      console.warn("Could not load user rights:", err);
      return null;
    }
  },

  async setUserDefaultDashboard(token: string, userId: number, dashboardId: number | null, orgId?: number | null): Promise<{ message: string; user_id: number; default_dashboard_id: number | null }> {
    const query = qs({ organization_id: orgId });
    return api<{ message: string; user_id: number; default_dashboard_id: number | null }>(
      `/access-management/users/${userId}/default-dashboard?${query}`,
      {
        method: "PUT",
        token,
        body: JSON.stringify({ dashboard_id: dashboardId }),
      }
    );
  },

  async getResourceRights(token: string, resourceType: string, resourceId: number, orgId?: number | null): Promise<ResourceRightsSummary | null> {
    const query = qs({ organization_id: orgId });
    try {
      return await api<ResourceRightsSummary>(`/access-management/resources/${resourceType}/${resourceId}/rights?${query}`, { token });
    } catch (err) {
      console.warn("Could not load resource rights:", err);
      return null;
    }
  },

  async getFilterableColumns(token: string, resourceType: string, resourceId: number, orgId?: number | null): Promise<FilterColumnItem[]> {
    const params: Record<string, any> = { resource_type: resourceType, resource_id: resourceId, organization_id: orgId };
    if (resourceType === "dashboard") params.dashboard_id = resourceId;
    else if (resourceType === "custom_report") params.custom_report_id = resourceId;
    else params.report_template_id = resourceId;
    const query = qs(params);
    return api<FilterColumnItem[]>(`/access-management/filterable-columns?${query}`, { token });
  },

  async getAuditLogs(
    token: string,
    params: {
      organization_id?: number | null;
      page?: number;
      page_size?: number;
      user_id?: number | null;
      resource_type?: string;
      resource_id?: number | null;
      action?: string;
      search?: string;
    }
  ): Promise<AuditLogListResponse> {
    const query = qs(params);
    return api<AuditLogListResponse>(`/access-management/audit?${query}`, { token });
  },

  async fetchOrgUsers(token: string, orgId?: number | null): Promise<UserOption[]> {
    const query = qs({ organization_id: orgId });
    return api<UserOption[]>(`/users?${query}`, { token });
  },

  async fetchDashboards(token: string, orgId?: number | null): Promise<ResourceOption[]> {
    const query = qs({ organization_id: orgId });
    const list = await api<any[]>(`/dashboards?${query}`, { token }).catch(() => []);
    return list.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? null,
      resource_type: "dashboard" as const,
    }));
  },

  async fetchCustomReports(token: string, orgId?: number | null): Promise<ResourceOption[]> {
    const query = qs({ organization_id: orgId });
    const list = await api<any[]>(`/custom-reports?${query}`, { token }).catch(() => []);
    return list.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      resource_type: "custom_report" as const,
    }));
  },

  async fetchStandardReports(token: string, orgId?: number | null): Promise<ResourceOption[]> {
    const query = qs({ organization_id: orgId });
    const list = await api<any[]>(`/reports/templates?${query}`, { token }).catch(() => []);
    return list.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      resource_type: "report" as const,
    }));
  },
};

// ===========================================================================
// SECTION 3: SHARED UI BADGES
// ===========================================================================

function AccessBadge({
  accessType,
  summary,
  restrictionSummary,
  isActive = true,
}: {
  accessType: AccessType;
  summary?: string | null;
  restrictionSummary?: string | null;
  isActive?: boolean;
}) {
  const displaySummary = restrictionSummary ?? summary ?? undefined;
  if (!isActive) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.25rem 0.6rem",
          borderRadius: "6px",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: "#fee2e2",
          color: "#991b1b",
          border: "1px solid #fca5a5",
        }}
      >
        Deactivated
      </span>
    );
  }

  if (accessType === "full") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.25rem 0.6rem",
          borderRadius: "6px",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: "#ecfdf5",
          color: "#065f46",
          border: "1px solid #a7f3d0",
        }}
      >
        Full Access
      </span>
    );
  }

  return (
    <div
      style={{
        display: "inline-block",
        maxWidth: "420px",
        padding: "0.35rem 0.65rem",
        borderRadius: "6px",
        fontSize: "0.75rem",
        lineHeight: "1.4",
        background: "#eff6ff",
        color: "#1e40af",
        border: "1px solid #bfdbfe",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        whiteSpace: "normal",
        boxSizing: "border-box",
      }}
      title={displaySummary}
    >
      {displaySummary && displaySummary !== "Full Access" ? (
        displaySummary.startsWith("Unique-Key (") ? (
          <div>
            <span style={{ fontWeight: 700, color: "#1d4ed8" }}>Unique-Key </span>
            <span style={{ fontWeight: 500, color: "#1e40af" }}>
              {displaySummary.replace(/^Unique-Key\s*/, "")}
            </span>
          </div>
        ) : (
          <span style={{ fontWeight: 500 }}>{displaySummary}</span>
        )
      ) : (
        <span style={{ fontWeight: 600 }}>Unique-Key Based</span>
      )}
    </div>
  );
}

function ResourceTypeBadge({
  type,
  resourceType,
}: {
  type?: ResourceType;
  resourceType?: ResourceType;
}) {
  const actualType = resourceType ?? type ?? "dashboard";
  const isDash = actualType === "dashboard";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.2rem 0.55rem",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: 600,
        background: isDash ? "#f3e8ff" : "#fef3c7",
        color: isDash ? "#6b21a8" : "#92400e",
        border: `1px solid ${isDash ? "#d8b4fe" : "#fde68a"}`,
      }}
    >
      {isDash ? "Dashboard" : actualType === "custom_report" ? "Custom Report" : "Report"}
    </span>
  );
}

function UserTypeBadge({
  userType,
  uniqueKey,
}: {
  userType: "internal" | "external";
  uniqueKey?: string | null;
}) {
  const isExternal = userType === "external";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        maxWidth: "280px",
        wordBreak: "break-word",
        gap: "0.3rem",
        padding: "0.2rem 0.55rem",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: 600,
        background: isExternal ? "#eff6ff" : "#f1f5f9",
        color: isExternal ? "#1d4ed8" : "#475569",
        border: `1px solid ${isExternal ? "#bfdbfe" : "#e2e8f0"}`,
      }}
    >
      <span>{isExternal ? "External" : "Internal"}</span>
      {uniqueKey && (
        <span
          style={{
            background: isExternal ? "#dbeafe" : "#e2e8f0",
            padding: "1px 5px",
            borderRadius: "4px",
            fontSize: "0.7rem",
            color: "#0f172a",
            wordBreak: "break-word",
            maxWidth: "200px",
          }}
        >
          {uniqueKey}
        </span>
      )}
    </span>
  );
}

// ===========================================================================
// SECTION 4: MANAGE RIGHTS COMPONENTS (Filter, Table, Actions, Drawer)
// ===========================================================================

function RightsFilterBar({
  search,
  onSearchChange,
  onClearSearch,
  onImmediateSearch,
  activeResourceId,
  onClearResourceId,
  activeUserId,
  onClearUserId,
  userType,
  onUserTypeChange,
  resourceType,
  onResourceTypeChange,
  accessType,
  onAccessTypeChange,
  status,
  onStatusChange,
  pageSize,
  onPageSizeChange,
  total,
  onResetFilters,
  hasActiveFilters,
}: {
  search: string;
  onSearchChange: (val: string) => void;
  onClearSearch?: () => void;
  onImmediateSearch?: () => void;
  activeResourceId?: number | null;
  onClearResourceId?: () => void;
  activeUserId?: number | null;
  onClearUserId?: () => void;
  userType: UserTypeFilter;
  onUserTypeChange: (val: UserTypeFilter) => void;
  resourceType: ResourceTypeFilter;
  onResourceTypeChange: (val: ResourceTypeFilter) => void;
  accessType: AccessTypeFilter;
  onAccessTypeChange: (val: AccessTypeFilter) => void;
  status: StatusFilter;
  onStatusChange: (val: StatusFilter) => void;
  pageSize: number;
  onPageSizeChange: (val: number) => void;
  total: number;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--surface, #ffffff)",
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: "10px",
        padding: "1rem",
        marginBottom: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.85rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 280px" }}>
          <input
            type="text"
            className="rights-field-interactive"
            placeholder="Search by user, email, resource, restriction key..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onImmediateSearch?.();
              }
            }}
            style={{
              width: "100%",
              padding: "0.55rem 0.85rem",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              fontSize: "0.875rem",
              outline: "none",
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => (onClearSearch ? onClearSearch() : onSearchChange(""))}
              style={{
                position: "absolute",
                right: "0.6rem",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {(activeResourceId || activeUserId) && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {activeResourceId && (
              <span
                style={{
                  fontSize: "0.75rem",
                  background: "#dbeafe",
                  color: "#1e40af",
                  padding: "3px 8px",
                  borderRadius: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  fontWeight: 600,
                }}
              >
                Resource #{activeResourceId}
                {onClearResourceId && (
                  <button
                    type="button"
                    onClick={onClearResourceId}
                    title="Remove resource filter"
                    style={{ border: "none", background: "none", color: "#1e40af", cursor: "pointer", fontWeight: 700, padding: 0 }}
                  >
                    ×
                  </button>
                )}
              </span>
            )}
            {activeUserId && (
              <span
                style={{
                  fontSize: "0.75rem",
                  background: "#fef3c7",
                  color: "#92400e",
                  padding: "3px 8px",
                  borderRadius: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  fontWeight: 600,
                }}
              >
                User #{activeUserId}
                {onClearUserId && (
                  <button
                    type="button"
                    onClick={onClearUserId}
                    title="Remove user filter"
                    style={{ border: "none", background: "none", color: "#92400e", cursor: "pointer", fontWeight: 700, padding: 0 }}
                  >
                    ×
                  </button>
                )}
              </span>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <button type="button" className="btn" onClick={onResetFilters} style={{ fontSize: "0.8rem", padding: "0.5rem 0.75rem", color: "#64748b" }}>
            Reset Filters
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
            User Type
          </label>
          <select
            value={userType}
            className="rights-field-interactive"
            onChange={(e) => onUserTypeChange(e.target.value as UserTypeFilter)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
          >
            <option value="all">All Users</option>
            <option value="internal">Internal Users Only</option>
            <option value="external">External Users Only</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
            Resource Type
          </label>
          <select
            value={resourceType}
            className="rights-field-interactive"
            onChange={(e) => onResourceTypeChange(e.target.value as ResourceTypeFilter)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
          >
            <option value="all">All Resources</option>
            <option value="dashboard">Dashboards Only</option>
            <option value="report">Reports Only</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
            Access Mode
          </label>
          <select
            value={accessType}
            className="rights-field-interactive"
            onChange={(e) => onAccessTypeChange(e.target.value as AccessTypeFilter)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
          >
            <option value="all">All Access Modes</option>
            <option value="full">Full Access</option>
            <option value="unique_key">Unique-Key Based</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
            Status
          </label>
          <select
            value={status}
            className="rights-field-interactive"
            onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
            style={{ width: "100%", padding: "0.45rem 0.6rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Deactivated Only</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.25rem" }}>
            Show
          </label>
          <select
            value={pageSize >= total && total > 20 ? "all" : pageSize}
            className="rights-field-interactive"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "all") {
                onPageSizeChange(Math.max(total, 500));
              } else {
                onPageSizeChange(Number(v));
              }
            }}
            style={{
              width: "100%",
              padding: "0.45rem 0.6rem",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              fontSize: "0.85rem",
              background: "#ffffff",
              color: "#334155",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
            <option value={250}>250 per page</option>
            <option value={500}>500 per page</option>
            <option value="all">All ({total})</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function BulkActionBar({
  selectedCount,
  onClearSelection,
  onActivate,
  onDeactivate,
  onSetFullAccess,
  onRevoke,
  showActivate = true,
  showDeactivate = true,
  loading = false,
}: {
  selectedCount: number;
  onClearSelection: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onSetFullAccess: () => void;
  onRevoke: () => void;
  showActivate?: boolean;
  showDeactivate?: boolean;
  loading?: boolean;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="bulk-action-bar">
      <div className="bulk-action-info">
        <span className="bulk-action-badge">
          {selectedCount}
        </span>
        <span className="bulk-action-text">rights selected</span>
        <button
          type="button"
          onClick={onClearSelection}
          className="bulk-action-deselect"
        >
          Deselect all
        </button>
      </div>

      <div className="bulk-action-buttons">
        {showActivate && (
          <button
            type="button"
            onClick={onActivate}
            disabled={loading}
            className="bulk-btn bulk-btn-activate"
          >
            Activate
          </button>
        )}
        {showDeactivate && (
          <button
            type="button"
            onClick={onDeactivate}
            disabled={loading}
            className="bulk-btn bulk-btn-deactivate"
          >
            Deactivate
          </button>
        )}
        <button
          type="button"
          onClick={onSetFullAccess}
          disabled={loading}
          className="bulk-btn bulk-btn-full"
        >
          Set Full Access
        </button>
        <button
          type="button"
          onClick={onRevoke}
          disabled={loading}
          className="bulk-btn bulk-btn-revoke"
        >
          Revoke Access
        </button>
      </div>
    </div>
  );
}

function ManageRightsTable({
  items,
  selectedKeys,
  onToggleSelect,
  onToggleSelectAll,
  onEdit,
  onRevokeSingle,
  onToggleStatusSingle,
  loading = false,
}: {
  items: RightItem[];
  selectedKeys: Set<string>;
  onToggleSelect: (key: string) => void;
  onToggleSelectAll: () => void;
  onEdit: (item: RightItem) => void;
  onRevokeSingle: (item: RightItem) => void;
  onToggleStatusSingle: (item: RightItem) => void;
  loading?: boolean;
}) {
  const allSelected = items.length > 0 && items.every((x) => selectedKeys.has(`${x.resource_type}_${x.id}`));

  return (
    <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "10px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
              <th style={{ padding: "0.75rem 1rem", width: "40px" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  style={{ transform: "scale(1.1)", cursor: "pointer" }}
                />
              </th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>User</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>User Type</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Resource</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Resource Type</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Access Mode</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Status</th>
              <th style={{ padding: "0.75rem 1rem", fontWeight: 600, textAlign: "right", minWidth: "135px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>
                  Loading permissions...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>
                  No rights match your active filters.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const itemKey = `${item.resource_type}_${item.id}`;
                const isChecked = selectedKeys.has(itemKey);

                return (
                  <tr
                    key={itemKey}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: isChecked ? "rgba(59, 130, 246, 0.04)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleSelect(itemKey)}
                        style={{ transform: "scale(1.1)", cursor: "pointer" }}
                      />
                    </td>

                    <td style={{ padding: "0.75rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#1e293b" }}>{item.user_name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>@{item.username}</div>
                    </td>

                    <td style={{ padding: "0.75rem 1rem" }}>
                      <UserTypeBadge userType={item.user_type} uniqueKey={item.user_unique_key} />
                    </td>

                    <td style={{ padding: "0.75rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#1e293b" }}>{item.resource_name}</div>
                    </td>

                    <td style={{ padding: "0.75rem 1rem" }}>
                      <ResourceTypeBadge resourceType={item.resource_type} />
                    </td>

                    <td style={{ padding: "0.75rem 1rem", minWidth: "220px", maxWidth: "420px" }}>
                      <AccessBadge accessType={item.access_type} restrictionSummary={item.restriction_summary} isActive={item.is_active} />
                    </td>

                    <td style={{ padding: "0.75rem 1rem" }}>
                      <button
                        type="button"
                        onClick={() => onToggleStatusSingle(item)}
                        className={item.is_active ? "table-btn-status-active" : "table-btn-status-inactive"}
                      >
                        {item.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>

                    <td style={{ padding: "0.75rem 1rem", textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="table-btn-edit"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onRevokeSingle(item)}
                          className="table-btn-revoke"
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditRightDrawer({
  isOpen,
  onClose,
  right,
  token,
  orgId,
  onUpdated,
}: {
  isOpen: boolean;
  onClose: () => void;
  right: RightItem | null;
  token: string;
  orgId?: number | null;
  onUpdated: () => void;
}) {
  const [isActive, setIsActive] = useState(true);
  const [accessType, setAccessType] = useState<AccessType>("full");
  const [canView, setCanView] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [canPrint, setCanPrint] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [canDownloadWord, setCanDownloadWord] = useState(false);
  const [canChangePeriod, setCanChangePeriod] = useState(false);
  const [canLoadLms, setCanLoadLms] = useState(false);
  const [canDownloadWidgetPdf, setCanDownloadWidgetPdf] = useState(true);
  const [canViewDrilldown, setCanViewDrilldown] = useState(true);
  const [filterColumns, setFilterColumns] = useState<Record<string, string>>({});
  const [availableColumns, setAvailableColumns] = useState<FilterColumnItem[]>([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (!right) return;
    setIsActive(right.is_active);
    setAccessType(right.access_type);
    setCanView(right.can_view);
    setCanEdit(right.can_edit);
    setCanPrint(right.can_print);
    setCanExport(right.can_export);
    setCanDownloadWord(right.can_download_word || false);
    setCanChangePeriod(right.can_change_period);
    setCanLoadLms(right.can_load_lms);
    setCanDownloadWidgetPdf(right.can_download_widget_pdf !== false);
    setCanViewDrilldown(right.can_view_drilldown !== false);
    const initCols: Record<string, string> = { ...(right.filter_column_configs || {}) };
    if (right.filter_sub_field_key && right.filter_kpi_id && right.filter_mli_id) {
      const gKey = `${right.filter_kpi_id}_${right.filter_mli_id}`;
      if (!initCols[gKey]) {
        initCols[gKey] = right.filter_sub_field_key;
      }
    }
    setFilterColumns(initCols);

    setLoadingColumns(true);
    rightsService
      .getFilterableColumns(token, right.resource_type, right.resource_id, orgId)
      .then((cols) => setAvailableColumns(cols))
      .catch(() => setAvailableColumns([]))
      .finally(() => setLoadingColumns(false));
  }, [right, token, orgId]);

  // Auto-match restricted column selection when availableColumns loads
  useEffect(() => {
    if (!right || availableColumns.length === 0) return;

    setFilterColumns((prev) => {
      const next = { ...prev };
      let changed = false;

      const groups = Array.from(new Set(availableColumns.map((c) => `${c.kpi_id}_${c.mli_id}`)));

      for (const gKey of groups) {
        const cols = availableColumns.filter((c) => `${c.kpi_id}_${c.mli_id}` === gKey);
        if (cols.length === 0) continue;

        const currentValue = next[gKey];

        // Check if current value already directly matches a sub_field_key in cols
        const exactMatch = cols.find((c) => c.sub_field_key === currentValue);
        if (exactMatch) continue;

        // Collect search targets
        const targets = [
          currentValue,
          right.filter_sub_field_key,
          ...(right.filter_column_configs ? Object.values(right.filter_column_configs) : []),
        ].filter((v): v is string => Boolean(v && typeof v === "string"));

        let matchedCol: FilterColumnItem | undefined;

        for (const target of targets) {
          const tLower = target.trim().toLowerCase();

          // 1) Exact sub_field_key case-insensitive
          matchedCol = cols.find((c) => c.sub_field_key.toLowerCase() === tLower);
          if (matchedCol) break;

          // 2) Exact column_name case-insensitive
          matchedCol = cols.find((c) => c.column_name && c.column_name.trim().toLowerCase() === tLower);
          if (matchedCol) break;

          // 3) Label match
          matchedCol = cols.find((c) => c.label && c.label.toLowerCase().includes(tLower));
          if (matchedCol) break;
        }

        // Fallback for custom report with 1 MLI group
        if (!matchedCol && right.filter_sub_field_key) {
          const subKeyLower = right.filter_sub_field_key.trim().toLowerCase();
          matchedCol = cols.find(
            (c) =>
              c.sub_field_key.toLowerCase() === subKeyLower ||
              (c.column_name && c.column_name.trim().toLowerCase() === subKeyLower)
          );
        }

        if (matchedCol) {
          next[gKey] = matchedCol.sub_field_key;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [availableColumns, right]);

  if (!isOpen || !right) return null;

  const isDashboardRight = right.resource_type === "dashboard";

  const handleSave = async () => {
    setSaving(true);
    try {
      let primaryCol: string | null = null;
      let kpiId: number | null = null;
      let mliId: number | null = null;

      if (accessType === "unique_key") {
        for (const [key, val] of Object.entries(filterColumns)) {
          if (val) {
            primaryCol = val;
            const [k, m] = key.split("_");
            kpiId = Number(k) || null;
            mliId = Number(m) || null;
            break;
          }
        }
      }

      await rightsService.updateRight(
        token,
        right.resource_type,
        right.id,
        {
          is_active: isActive,
          access_type: accessType,
          can_view: canView,
          can_edit: canEdit,
          can_print: canPrint,
          can_export: canExport,
          can_download_word: canDownloadWord,
          can_change_period: canChangePeriod,
          can_load_lms: canLoadLms,
          can_download_widget_pdf: canDownloadWidgetPdf,
          can_view_drilldown: canViewDrilldown,
          filter_column_configs: accessType === "unique_key" ? filterColumns : null,
          filter_sub_field_key: primaryCol,
          filter_kpi_id: kpiId,
          filter_mli_id: mliId,
        },
        orgId
      );

      toast.success("Permission updated successfully.");
      onUpdated();
      onClose();
    } catch (e) {
      toast.error("Failed to update right: " + (e instanceof Error ? e.message : ""));
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    if (!confirm(`Revoke access to "${right.resource_name}" for ${right.user_name}?`)) return;
    setRevoking(true);
    try {
      await rightsService.revokeRight(token, right.resource_type, right.id, orgId);
      toast.success("Right revoked successfully.");
      onUpdated();
      onClose();
    } catch (e) {
      toast.error("Failed to revoke right: " + (e instanceof Error ? e.message : ""));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "500px",
          background: "#ffffff",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-10px 0 25px -5px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#1e293b" }}>Edit User Right</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "6px", flexWrap: "wrap" }}>
              <ResourceTypeBadge resourceType={right.resource_type} />
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>{right.resource_name}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="drawer-btn-close"
          >
            Close
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "1rem", border: "1px solid #e2e8f0" }}>
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
                {right.resource_type === "dashboard" ? "Dashboard Name" : "Report Name"}
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>{right.resource_name}</div>
            </div>

            <div>
              <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>ASSIGNED USER</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "2px" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1e293b" }}>
                  {right.user_name} (@{right.username})
                </span>
                <UserTypeBadge userType={right.user_type} uniqueKey={right.user_unique_key} />
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
              padding: "0.85rem 1rem",
              borderRadius: "8px",
              border: `1px solid ${isActive ? "#bbf7d0" : "#fed7aa"}`,
              background: isActive ? "#f0fdf4" : "#fffbeb",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.875rem", color: isActive ? "#166534" : "#9a3412" }}>
                Status: {isActive ? "Active Permission" : "Inactive / Suspended"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                {isActive ? "User can currently access this resource" : "Access temporarily blocked without revoking"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={isActive ? "drawer-status-btn-deactivate" : "drawer-status-btn-activate"}
            >
              {isActive ? "Deactivate" : "Activate"}
            </button>
          </div>

          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: "0.5rem" }}>
              Access Mode
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setAccessType("full")}
                className={`drawer-mode-btn ${accessType === "full" ? "active" : ""}`}
              >
                Full Access
              </button>
              <button
                type="button"
                onClick={() => setAccessType("unique_key")}
                className={`drawer-mode-btn ${accessType === "unique_key" ? "active" : ""}`}
              >
                Unique-Key Based
              </button>
            </div>
          </div>

          {accessType === "unique_key" && (
            <div style={{ background: "#f8fafc", padding: "0.85rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#334155", marginBottom: "0.4rem" }}>
                Multi-Line Column Restrictions:
              </div>
              {loadingColumns ? (
                <div style={{ fontSize: "0.8rem", color: "#64748b" }}>Loading MLI columns...</div>
              ) : availableColumns.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "#64748b" }}>No MLI columns found for this resource.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {Array.from(new Set(availableColumns.map((c) => `${c.kpi_id}_${c.mli_id}`))).map((gKey) => {
                    const cols = availableColumns.filter((c) => `${c.kpi_id}_${c.mli_id}` === gKey);
                    const kpiTitle = cols[0]?.kpi_title || "KPI";
                    const mliTitle = cols[0]?.mli_title || "MLI";
                    return (
                      <div
                        key={gKey}
                        style={{
                          background: "#ffffff",
                          padding: "0.75rem 0.85rem",
                          borderRadius: "8px",
                          border: "1px solid #e2e8f0",
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                          gap: "0.65rem",
                          alignItems: "flex-end",
                        }}
                      >
                        <div>
                          <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 700, color: "#64748b", marginBottom: "0.25rem", textTransform: "uppercase" }}>
                            Multi-Line Item (MLI)
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={`${mliTitle} (${kpiTitle})`}
                            title={`${kpiTitle} - ${mliTitle}`}
                            style={{
                              width: "100%",
                              padding: "0.45rem 0.65rem",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              background: "#f8fafc",
                              color: "#334155",
                              fontWeight: 600,
                              fontSize: "0.8rem",
                              cursor: "default",
                              outline: "none",
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 700, color: "#64748b", marginBottom: "0.25rem", textTransform: "uppercase" }}>
                            Restricted Column
                          </label>
                          <select
                            value={filterColumns[gKey] || ""}
                            className="rights-field-interactive"
                            onChange={(e) => setFilterColumns({ ...filterColumns, [gKey]: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "0.45rem 0.65rem",
                              borderRadius: "6px",
                              border: "1px solid #cbd5e1",
                              fontSize: "0.8rem",
                              background: "#ffffff",
                              outline: "none",
                            }}
                          >
                            <option value="">Do not filter (Show all)</option>
                            {cols.map((c) => (
                              <option key={c.sub_field_key} value={c.sub_field_key}>
                                {formatMliColumnOption(c)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e293b", display: "block", marginBottom: "0.5rem" }}>
              Feature View / Report Permissions
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem" }}>
              {!isDashboardRight ? (
                <>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canChangePeriod} onChange={(e) => setCanChangePeriod(e.target.checked)} />
                    Can Change Period
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canExport} onChange={(e) => setCanExport(e.target.checked)} />
                    Can Download Excel
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canDownloadWord} onChange={(e) => setCanDownloadWord(e.target.checked)} />
                    Can Download Word
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canPrint} onChange={(e) => setCanPrint(e.target.checked)} />
                    Can Print
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canLoadLms} onChange={(e) => setCanLoadLms(e.target.checked)} />
                    Can LMS Sync
                  </label>
                </>
              ) : (
                <>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canView} onChange={(e) => setCanView(e.target.checked)} />
                    Can View
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} />
                    Can Edit
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canChangePeriod} onChange={(e) => setCanChangePeriod(e.target.checked)} />
                    Can Change Period
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canLoadLms} onChange={(e) => setCanLoadLms(e.target.checked)} />
                    Can LMS Sync
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canViewDrilldown} onChange={(e) => setCanViewDrilldown(e.target.checked)} />
                    Can View Drill Down
                  </label>
                  <label className="feature-permission-label">
                    <input type="checkbox" checked={canDownloadWidgetPdf} onChange={(e) => setCanDownloadWidgetPdf(e.target.checked)} />
                    Can Download Widget PDF File
                  </label>
                </>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "1rem 1.25rem",
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.65rem",
          }}
        >
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking || saving}
            className="drawer-btn-revoke"
          >
            {revoking ? "Revoking..." : "Revoke Right"}
          </button>
          <div style={{ display: "flex", gap: "0.5rem", flex: "1 1 200px", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onClose}
              className="drawer-btn-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || revoking}
              className="drawer-btn-save"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManageRightsView({
  token,
  orgId,
  initialResourceType = "all",
  initialResourceId,
  initialUserId,
  onNavigateToAssign,
  dataVersion,
  onMutationSuccess,
}: {
  token: string;
  orgId?: number | null;
  initialResourceType?: ResourceTypeFilter;
  initialResourceId?: number | null;
  initialUserId?: number | null;
  onNavigateToAssign?: () => void;
  dataVersion?: number;
  onMutationSuccess?: () => void;
}) {
  const [items, setItems] = useState<RightItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);

  const [activeCount, setActiveCount] = useState(0);
  const [inactiveCount, setInactiveCount] = useState(0);
  const [fullAccessCount, setFullAccessCount] = useState(0);
  const [uniqueKeyCount, setUniqueKeyCount] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeResourceId, setActiveResourceId] = useState<number | null>(initialResourceId || null);
  const [activeUserId, setActiveUserId] = useState<number | null>(initialUserId || null);

  useEffect(() => {
    setActiveResourceId(initialResourceId || null);
  }, [initialResourceId]);

  useEffect(() => {
    setActiveUserId(initialUserId || null);
  }, [initialUserId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [userType, setUserType] = useState<UserTypeFilter>("all");
  const [resourceType, setResourceType] = useState<ResourceTypeFilter>(initialResourceType);
  const [accessType, setAccessType] = useState<AccessTypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [editingRight, setEditingRight] = useState<RightItem | null>(null);

  const itemCacheRef = useRef<Map<string, RightItem>>(new Map());
  const reqIdRef = useRef(0);

  useEffect(() => {
    items.forEach((it) => {
      itemCacheRef.current.set(`${it.resource_type}_${it.id}`, it);
    });
  }, [items]);

  const fetchRights = useCallback(() => {
    if (!token) return;
    const currentReqId = ++reqIdRef.current;
    setLoading(true);

    rightsService
      .getRights(token, {
        organization_id: orgId,
        page,
        page_size: pageSize,
        user_type: userType !== "all" ? userType : undefined,
        resource_type: resourceType !== "all" ? resourceType : undefined,
        access_type: accessType !== "all" ? accessType : undefined,
        status: status !== "all" ? status : undefined,
        search: debouncedSearch.trim() || undefined,
        resource_id: activeResourceId || undefined,
        user_id: activeUserId || undefined,
      })
      .then((res) => {
        if (currentReqId !== reqIdRef.current) return;
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.total_pages);
        setActiveCount(res.active_count);
        setInactiveCount(res.inactive_count);
        setFullAccessCount(res.full_access_count);
        setUniqueKeyCount(res.unique_key_count);
      })
      .catch((e) => {
        if (currentReqId !== reqIdRef.current) return;
        toast.error("Failed to load rights: " + (e instanceof Error ? e.message : ""));
      })
      .finally(() => {
        if (currentReqId === reqIdRef.current) setLoading(false);
      });
  }, [token, orgId, page, pageSize, userType, resourceType, accessType, status, debouncedSearch, activeResourceId, activeUserId, dataVersion]);

  useEffect(() => {
    fetchRights();
  }, [fetchRights]);

  const handleResetFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setUserType("all");
    setResourceType("all");
    setAccessType("all");
    setStatus("all");
    setActiveResourceId(null);
    setActiveUserId(null);
    setPage(1);
  };

  const handleClearSearch = () => {
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
  };

  const handleImmediateSearch = () => {
    setDebouncedSearch(search);
    setPage(1);
  };

  const hasActiveFilters =
    Boolean(search.trim()) ||
    userType !== "all" ||
    resourceType !== "all" ||
    accessType !== "all" ||
    status !== "all" ||
    activeResourceId !== null ||
    activeUserId !== null;

  const handleToggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (items.length === 0) return;
    const allSelected = items.every((x) => selectedKeys.has(`${x.resource_type}_${x.id}`));
    if (allSelected) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        items.forEach((x) => next.delete(`${x.resource_type}_${x.id}`));
        return next;
      });
    } else {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        items.forEach((x) => next.add(`${x.resource_type}_${x.id}`));
        return next;
      });
    }
  };

  const getSelectedTargetItems = (): BulkTargetItem[] => {
    const targets: BulkTargetItem[] = [];
    selectedKeys.forEach((key) => {
      const item = itemCacheRef.current.get(key) || items.find((it) => `${it.resource_type}_${it.id}` === key);
      if (item) {
        targets.push({
          permission_id: item.id,
          resource_type: item.resource_type,
          user_id: item.user_id,
          resource_id: item.resource_id,
        });
      }
    });
    return targets;
  };

  const handleBulkActivate = async () => {
    const targets = getSelectedTargetItems();
    if (targets.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await rightsService.bulkUpdate(token, targets, "activate", { orgId });
      toast.success(res.message || `${res.updated_count} rights activated`);
      setSelectedKeys(new Set());
      fetchRights();
      onMutationSuccess?.();
    } catch (e) {
      toast.error("Bulk activation failed: " + (e instanceof Error ? e.message : ""));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDeactivate = async () => {
    const targets = getSelectedTargetItems();
    if (targets.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await rightsService.bulkUpdate(token, targets, "deactivate", { orgId });
      toast.success(res.message || `${res.updated_count} rights deactivated`);
      setSelectedKeys(new Set());
      fetchRights();
      onMutationSuccess?.();
    } catch (e) {
      toast.error("Bulk deactivation failed: " + (e instanceof Error ? e.message : ""));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkSetFullAccess = async () => {
    const targets = getSelectedTargetItems();
    if (targets.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await rightsService.bulkUpdate(token, targets, "set_full_access", { orgId });
      toast.success(res.message || `${res.updated_count} rights updated to Full Access`);
      setSelectedKeys(new Set());
      fetchRights();
      onMutationSuccess?.();
    } catch (e) {
      toast.error("Bulk update failed: " + (e instanceof Error ? e.message : ""));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkRevoke = async () => {
    const targets = getSelectedTargetItems();
    if (targets.length === 0) return;
    if (!confirm(`Are you sure you want to permanently revoke ${targets.length} selected rights?`)) return;

    setBulkLoading(true);
    try {
      const res = await rightsService.bulkRevoke(token, targets, orgId);
      toast.success(res.message || `${res.revoked_count} rights revoked`);
      setSelectedKeys(new Set());
      fetchRights();
      onMutationSuccess?.();
    } catch (e) {
      toast.error("Bulk revoke failed: " + (e instanceof Error ? e.message : ""));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleRevokeSingle = async (item: RightItem) => {
    if (!confirm(`Revoke rights to "${item.resource_name}" for ${item.user_name}?`)) return;
    try {
      await rightsService.revokeRight(token, item.resource_type, item.id, orgId);
      toast.success("Right revoked.");
      fetchRights();
      onMutationSuccess?.();
    } catch (e) {
      toast.error("Failed to revoke: " + (e instanceof Error ? e.message : ""));
    }
  };

  const handleToggleStatusSingle = async (item: RightItem) => {
    const newActive = !item.is_active;
    // Optimistic in-place update — no full reload, scroll stays in place
    setItems((prev) => prev.map((it) => it.id === item.id && it.resource_type === item.resource_type ? { ...it, is_active: newActive } : it));
    try {
      await rightsService.updateRight(
        token,
        item.resource_type,
        item.id,
        { is_active: newActive },
        orgId
      );
      toast.success(newActive ? "Right activated" : "Right deactivated");
      onMutationSuccess?.();
    } catch (e) {
      // Rollback on failure
      setItems((prev) => prev.map((it) => it.id === item.id && it.resource_type === item.resource_type ? { ...it, is_active: item.is_active } : it));
      toast.error("Failed to update status: " + (e instanceof Error ? e.message : ""));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
        <div style={{ background: "#ffffff", padding: "1rem 1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>Total Rights</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1e293b", marginTop: "2px" }}>{total}</div>
        </div>

        <div style={{ background: "#ffffff", padding: "1rem 1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600 }}>Active Rights</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>{activeCount}</div>
        </div>

        <div style={{ background: "#ffffff", padding: "1rem 1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.8rem", color: "#ea580c", fontWeight: 600 }}>Deactivated / Suspended</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#ea580c", marginTop: "2px" }}>{inactiveCount}</div>
        </div>

        <div style={{ background: "#ffffff", padding: "1rem 1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.8rem", color: "#2563eb", fontWeight: 600 }}>Full Access</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#2563eb", marginTop: "2px" }}>{fullAccessCount}</div>
        </div>

        <div style={{ background: "#ffffff", padding: "1rem 1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.8rem", color: "#7c3aed", fontWeight: 600 }}>Key Restricted</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#7c3aed", marginTop: "2px" }}>{uniqueKeyCount}</div>
        </div>
      </div>

      <RightsFilterBar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        onClearSearch={handleClearSearch}
        onImmediateSearch={handleImmediateSearch}
        activeResourceId={activeResourceId}
        onClearResourceId={() => {
          setActiveResourceId(null);
          setPage(1);
        }}
        activeUserId={activeUserId}
        onClearUserId={() => {
          setActiveUserId(null);
          setPage(1);
        }}
        userType={userType}
        onUserTypeChange={(v) => {
          setUserType(v);
          setPage(1);
        }}
        resourceType={resourceType}
        onResourceTypeChange={(v) => {
          setResourceType(v);
          setPage(1);
        }}
        accessType={accessType}
        onAccessTypeChange={(v) => {
          setAccessType(v);
          setPage(1);
        }}
        status={status}
        onStatusChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        pageSize={pageSize}
        onPageSizeChange={(sz) => {
          setPageSize(sz);
          setPage(1);
        }}
        total={total}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {(() => {
        const selectedItems = Array.from(selectedKeys)
          .map((k) => itemCacheRef.current.get(k) || items.find((it) => `${it.resource_type}_${it.id}` === k))
          .filter((x): x is RightItem => Boolean(x));

        const hasSelectedActive = selectedItems.length > 0 ? selectedItems.some((x) => x.is_active) : true;
        const hasSelectedInactive = selectedItems.length > 0 ? selectedItems.some((x) => !x.is_active) : true;

        // If all selected rights are active -> only show Deactivate
        // If all selected rights are inactive -> only show Activate
        // If mixed (both active and inactive selected) -> show both
        const showActivate = hasSelectedInactive;
        const showDeactivate = hasSelectedActive;

        return (
          <BulkActionBar
            selectedCount={selectedKeys.size}
            onClearSelection={() => setSelectedKeys(new Set())}
            onActivate={handleBulkActivate}
            onDeactivate={handleBulkDeactivate}
            onSetFullAccess={handleBulkSetFullAccess}
            onRevoke={handleBulkRevoke}
            showActivate={showActivate}
            showDeactivate={showDeactivate}
            loading={bulkLoading}
          />
        );
      })()}

      <ManageRightsTable
        items={items}
        selectedKeys={selectedKeys}
        onToggleSelect={handleToggleSelect}
        onToggleSelectAll={handleToggleSelectAll}
        onEdit={(item) => setEditingRight(item)}
        onRevokeSingle={handleRevokeSingle}
        onToggleStatusSingle={handleToggleStatusSingle}
        loading={loading}
      />

      <div className="pagination-bar" style={{ borderRadius: "8px", border: "1px solid #e2e8f0", marginTop: "0.75rem", justifyContent: "flex-end" }}>
        <div className="pagination-group">
          <button
            type="button"
            className="pagination-btn pagination-btn-prev"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="pagination-info">
            Page <strong style={{ color: "#1e293b" }}>{page}</strong> of <strong style={{ color: "#1e293b" }}>{totalPages}</strong>
            <span style={{ color: "#94a3b8" }}>({total} rights)</span>
          </span>
          <button
            type="button"
            className="pagination-btn pagination-btn-next"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      <EditRightDrawer
        isOpen={Boolean(editingRight)}
        onClose={() => setEditingRight(null)}
        right={editingRight}
        token={token}
        orgId={orgId}
        onUpdated={() => {
          fetchRights();
          onMutationSuccess?.();
        }}
      />
    </div>
  );
}

// ===========================================================================
// SECTION 5: ASSIGN RIGHTS WIZARD (Resources, Users, Config, Review)
// ===========================================================================

function ResourceSelectionStep({
  dashboards,
  customReports,
  standardReports,
  selectedDashboardIds,
  selectedCustomReportIds,
  selectedStandardReportIds,
  onToggleDashboard,
  onToggleCustomReport,
  onToggleStandardReport,
  onSelectAllDashboards,
  onSelectAllCustomReports,
  onSelectAllStandardReports,
  onClearAll,
}: {
  dashboards: ResourceOption[];
  customReports: ResourceOption[];
  standardReports: ResourceOption[];
  selectedDashboardIds: number[];
  selectedCustomReportIds: number[];
  selectedStandardReportIds: number[];
  onToggleDashboard: (id: number) => void;
  onToggleCustomReport: (id: number) => void;
  onToggleStandardReport: (id: number) => void;
  onSelectAllDashboards: (ids: number[]) => void;
  onSelectAllCustomReports: (ids: number[]) => void;
  onSelectAllStandardReports: (ids: number[]) => void;
  onClearAll: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"all" | "dashboard" | "custom_report" | "report">("all");
  const [search, setSearch] = useState("");

  const allResources = useMemo(() => [...dashboards, ...customReports, ...standardReports], [dashboards, customReports, standardReports]);

  const filteredResources = useMemo(() => {
    let list: ResourceOption[] = [];
    if (activeTab === "all") list = allResources;
    else if (activeTab === "dashboard") list = dashboards;
    else if (activeTab === "custom_report") list = customReports;
    else if (activeTab === "report") list = standardReports;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q)));
    }
    return list;
  }, [activeTab, allResources, dashboards, customReports, standardReports, search]);

  const totalSelectedCount = selectedDashboardIds.length + selectedCustomReportIds.length + selectedStandardReportIds.length;

  const isResourceSelected = (r: ResourceOption) => {
    if (r.resource_type === "dashboard") return selectedDashboardIds.includes(r.id);
    if (r.resource_type === "custom_report") return selectedCustomReportIds.includes(r.id);
    return selectedStandardReportIds.includes(r.id);
  };

  const handleToggle = (r: ResourceOption) => {
    if (r.resource_type === "dashboard") onToggleDashboard(r.id);
    else if (r.resource_type === "custom_report") onToggleCustomReport(r.id);
    else onToggleStandardReport(r.id);
  };

  const allFilteredSelected = filteredResources.length > 0 && filteredResources.every((r) => isResourceSelected(r));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const fD = new Set(filteredResources.filter((r) => r.resource_type === "dashboard").map((r) => r.id));
      const fCR = new Set(filteredResources.filter((r) => r.resource_type === "custom_report").map((r) => r.id));
      const fSR = new Set(filteredResources.filter((r) => r.resource_type === "report").map((r) => r.id));

      onSelectAllDashboards(selectedDashboardIds.filter((id) => !fD.has(id)));
      onSelectAllCustomReports(selectedCustomReportIds.filter((id) => !fCR.has(id)));
      onSelectAllStandardReports(selectedStandardReportIds.filter((id) => !fSR.has(id)));
    } else {
      const newD = Array.from(new Set([...selectedDashboardIds, ...filteredResources.filter((r) => r.resource_type === "dashboard").map((r) => r.id)]));
      const newCR = Array.from(new Set([...selectedCustomReportIds, ...filteredResources.filter((r) => r.resource_type === "custom_report").map((r) => r.id)]));
      const newSR = Array.from(new Set([...selectedStandardReportIds, ...filteredResources.filter((r) => r.resource_type === "report").map((r) => r.id)]));

      onSelectAllDashboards(newD);
      onSelectAllCustomReports(newCR);
      onSelectAllStandardReports(newSR);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", background: "#f8fafc", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
        <div style={{ display: "inline-flex", background: "#e2e8f0", padding: "2px", borderRadius: "8px", flexWrap: "wrap" }}>
          {[
            { key: "all" as const, label: `All Resources (${allResources.length})` },
            { key: "dashboard" as const, label: `Dashboards (${dashboards.length})` },
            { key: "custom_report" as const, label: `Custom Reports (${customReports.length})` },
            { key: "report" as const, label: `Standard Reports (${standardReports.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "0.35rem 0.75rem",
                borderRadius: "6px",
                border: "none",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === tab.key ? "#ffffff" : "transparent",
                color: activeTab === tab.key ? "#1e293b" : "#64748b",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: "1 1 200px" }}>
          <input
            type="text"
            placeholder="Search dashboards or reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "0.45rem 0.75rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.75rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "6px", fontSize: "0.85rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", fontWeight: 600 }}>
          <input type="checkbox" checked={allFilteredSelected} onChange={handleToggleSelectAll} style={{ transform: "scale(1.1)", cursor: "pointer" }} />
          <span>Select All Filtered ({filteredResources.length})</span>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          {totalSelectedCount > 0 ? (
            <>
              <span style={{ fontSize: "0.75rem", background: "#eff6ff", color: "#1d4ed8", padding: "2px 8px", borderRadius: "12px", fontWeight: 600, border: "1px solid #bfdbfe" }}>
                {selectedDashboardIds.length} Dashboards
              </span>
              <span style={{ fontSize: "0.75rem", background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: "12px", fontWeight: 600, border: "1px solid #fde68a" }}>
                {selectedCustomReportIds.length} Custom Reports
              </span>
              <span style={{ fontSize: "0.75rem", background: "#f3e8ff", color: "#6b21a8", padding: "2px 8px", borderRadius: "12px", fontWeight: 600, border: "1px solid #d8b4fe" }}>
                {selectedStandardReportIds.length} Standard Reports
              </span>
              <button
                type="button"
                onClick={onClearAll}
                style={{
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  color: "#991b1b",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  marginLeft: "0.25rem",
                }}
              >
                Clear All ({totalSelectedCount})
              </button>
            </>
          ) : (
            <span style={{ color: "#64748b", fontWeight: 500, fontSize: "0.8rem" }}>No resources selected</span>
          )}
        </div>
      </div>

      <div style={{ maxHeight: "360px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#ffffff" }}>
        {filteredResources.length === 0 ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "#64748b" }}>No resources match criteria.</div>
        ) : (
          filteredResources.map((resource) => {
            const isSelected = isResourceSelected(resource);
            return (
              <label
                key={`${resource.resource_type}_${resource.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.85rem",
                  padding: "0.65rem 0.85rem",
                  borderBottom: "1px solid #f1f5f9",
                  background: isSelected ? "rgba(59, 130, 246, 0.05)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={isSelected} onChange={() => handleToggle(resource)} style={{ transform: "scale(1.15)", cursor: "pointer" }} />
                <div style={{ flex: "1 1 auto" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontWeight: 600, color: "#1e293b", fontSize: "0.9rem" }}>{resource.name}</span>
                  </div>
                  {resource.description && <div style={{ fontSize: "0.78rem", color: "#64748b" }}>{resource.description}</div>}
                </div>
                <ResourceTypeBadge resourceType={resource.resource_type} />
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function UserSelectionStep({
  users,
  selectedUserIds,
  onToggleUser,
  onSelectAll,
  onClearAll,
}: {
  users: UserOption[];
  selectedUserIds: number[];
  onToggleUser: (userId: number) => void;
  onSelectAll: (userIds: number[]) => void;
  onClearAll: () => void;
}) {
  const [userTypeFilter, setUserTypeFilter] = useState<UserTypeFilter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (userTypeFilter === "internal" && u.is_external) return false;
      if (userTypeFilter === "external" && !u.is_external) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matches =
          (u.full_name || "").toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.unique_user_key || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [users, userTypeFilter, roleFilter, search]);

  const allFilteredSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedUserIds.includes(u.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredIdSet = new Set(filteredUsers.map((u) => u.id));
      onSelectAll(selectedUserIds.filter((id) => !filteredIdSet.has(id)));
    } else {
      onSelectAll(Array.from(new Set([...selectedUserIds, ...filteredUsers.map((u) => u.id)])));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", background: "#f8fafc", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
        <div style={{ display: "inline-flex", background: "#e2e8f0", padding: "2px", borderRadius: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setUserTypeFilter("all")}
            style={{ padding: "0.35rem 0.75rem", borderRadius: "6px", border: "none", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", background: userTypeFilter === "all" ? "#ffffff" : "transparent", color: userTypeFilter === "all" ? "#1e293b" : "#64748b" }}
          >
            All Users ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setUserTypeFilter("internal")}
            style={{ padding: "0.35rem 0.75rem", borderRadius: "6px", border: "none", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", background: userTypeFilter === "internal" ? "#ffffff" : "transparent", color: userTypeFilter === "internal" ? "#1e293b" : "#64748b" }}
          >
            Internal ({users.filter((u) => !u.is_external).length})
          </button>
          <button
            type="button"
            onClick={() => setUserTypeFilter("external")}
            style={{ padding: "0.35rem 0.75rem", borderRadius: "6px", border: "none", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", background: userTypeFilter === "external" ? "#ffffff" : "transparent", color: userTypeFilter === "external" ? "#1e293b" : "#64748b" }}
          >
            External ({users.filter((u) => Boolean(u.is_external)).length})
          </button>
        </div>

        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ padding: "0.4rem 0.6rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}>
          <option value="all">All Roles</option>
          <option value="ORG_ADMIN">Org Admin</option>
          <option value="USER">User</option>
          <option value="REPORT_VIEWER">Report Viewer</option>
        </select>

        <div style={{ flex: "1 1 200px" }}>
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "0.45rem 0.75rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem" }}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.75rem", borderBottom: "1px solid #e2e8f0", fontSize: "0.85rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", fontWeight: 600 }}>
          <input type="checkbox" checked={allFilteredSelected} onChange={handleToggleSelectAll} style={{ transform: "scale(1.1)", cursor: "pointer" }} />
          <span>Select All Filtered ({filteredUsers.length})</span>
        </label>
        <div style={{ color: "#475569", fontWeight: 600 }}>
          {selectedUserIds.length} user(s) selected
          {selectedUserIds.length > 0 && (
            <button type="button" onClick={onClearAll} style={{ marginLeft: "0.75rem", background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ maxHeight: "360px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#ffffff" }}>
        {filteredUsers.length === 0 ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "#64748b" }}>No users match criteria.</div>
        ) : (
          filteredUsers.map((user) => {
            const isSelected = selectedUserIds.includes(user.id);
            return (
              <label
                key={user.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.85rem",
                  padding: "0.65rem 0.85rem",
                  borderBottom: "1px solid #f1f5f9",
                  background: isSelected ? "rgba(59, 130, 246, 0.05)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={isSelected} onChange={() => onToggleUser(user.id)} style={{ transform: "scale(1.15)", cursor: "pointer" }} />
                <div style={{ flex: "1 1 auto" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontWeight: 600, color: "#1e293b", fontSize: "0.9rem" }}>{user.full_name || user.username}</span>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>@{user.username}</span>
                  </div>
                  {user.email && <div style={{ fontSize: "0.78rem", color: "#64748b" }}>{user.email}</div>}
                </div>
                <UserTypeBadge userType={user.is_external ? "external" : "internal"} uniqueKey={user.unique_user_key} />
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function AccessConfigStep({
  token,
  orgId,
  selectedDashboardIds,
  selectedCustomReportIds,
  selectedStandardReportIds,
  accessType,
  onChangeAccessType,
  canView,
  canEdit,
  canPrint,
  canExport,
  canDownloadWord,
  canChangePeriod,
  canChangePeriodDashboards = false,
  canChangePeriodReports = false,
  canLoadLms,
  canDownloadWidgetPdf = true,
  canViewDrilldown = true,
  onChangePermissions,
  selectedFilterColumns,
  onFilterColumnsChange,
}: {
  token: string;
  orgId?: number | null;
  selectedDashboardIds: number[];
  selectedCustomReportIds: number[];
  selectedStandardReportIds: number[];
  accessType: AccessType;
  onChangeAccessType: (accessType: AccessType) => void;
  canView: boolean;
  canEdit: boolean;
  canPrint: boolean;
  canExport: boolean;
  canDownloadWord: boolean;
  canChangePeriod?: boolean;
  canChangePeriodDashboards?: boolean;
  canChangePeriodReports?: boolean;
  canLoadLms: boolean;
  canDownloadWidgetPdf?: boolean;
  canViewDrilldown?: boolean;
  onChangePermissions: (perms: any) => void;
  selectedFilterColumns: Record<string, string>;
  onFilterColumnsChange: (configs: Record<string, string>) => void;
}) {
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [availableColumns, setAvailableColumns] = useState<FilterColumnItem[]>([]);

  const isOnlyDashboards = selectedDashboardIds.length > 0 && selectedCustomReportIds.length === 0 && selectedStandardReportIds.length === 0;
  const isOnlyReports = selectedDashboardIds.length === 0 && (selectedCustomReportIds.length > 0 || selectedStandardReportIds.length > 0);
  const isMixedSelection = selectedDashboardIds.length > 0 && (selectedCustomReportIds.length > 0 || selectedStandardReportIds.length > 0);
  const totalSelectedResources = selectedDashboardIds.length + selectedCustomReportIds.length + selectedStandardReportIds.length;
  useEffect(() => {
    if (!token || totalSelectedResources === 0 || accessType !== "unique_key") {
      setAvailableColumns([]);
      return;
    }

    setLoadingColumns(true);
    const requests: Promise<FilterColumnItem[]>[] = [];
    selectedDashboardIds.forEach((id) => {
      requests.push(rightsService.getFilterableColumns(token, "dashboard", id, orgId).catch(() => []));
    });
    selectedCustomReportIds.forEach((id) => {
      requests.push(rightsService.getFilterableColumns(token, "custom_report", id, orgId).catch(() => []));
    });
    selectedStandardReportIds.forEach((id) => {
      requests.push(rightsService.getFilterableColumns(token, "report_template", id, orgId).catch(() => []));
    });

    Promise.all(requests)
      .then((colLists) => {
        const merged: FilterColumnItem[] = [];
        const seen = new Set<string>();
        colLists.forEach((list) => {
          list.forEach((col) => {
            const key = `${col.kpi_id}_${col.mli_id}_${col.sub_field_key}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(col);
            }
          });
        });
        setAvailableColumns(merged);
      })
      .finally(() => setLoadingColumns(false));
  }, [token, selectedDashboardIds, selectedCustomReportIds, selectedStandardReportIds, accessType, orgId, totalSelectedResources]);

  const mliGroups = useMemo(() => {
    const map = new Map<string, { kpi_title: string; mli_title: string; kpi_id: number; mli_id: number; columns: FilterColumnItem[] }>();
    availableColumns.forEach((col) => {
      const key = `${col.kpi_id}_${col.mli_id}`;
      if (!map.has(key)) {
        map.set(key, { kpi_title: col.kpi_title, mli_title: col.mli_title, kpi_id: col.kpi_id, mli_id: col.mli_id, columns: [] });
      }
      map.get(key)!.columns.push(col);
    });
    return Array.from(map.values());
  }, [availableColumns]);

  const periodItems = [];
  if (selectedDashboardIds.length > 0 || totalSelectedResources === 0) {
    periodItems.push({
      label: "Can Change Period (Dashboards)",
      desc: "Shift dates on dashboards",
      checked: canChangePeriodDashboards,
      key: "canChangePeriodDashboards",
    });
  }
  if (selectedCustomReportIds.length > 0 || selectedStandardReportIds.length > 0 || totalSelectedResources === 0) {
    periodItems.push({
      label: "Can Change Period (Reports)",
      desc: "Shift reporting period on reports",
      checked: canChangePeriodReports,
      key: "canChangePeriodReports",
    });
  }

  const permissionItems = isOnlyReports
    ? [
        ...periodItems,
        { label: "Can Download Excel", desc: "Export Excel spreadsheet", checked: canExport, key: "canExport" },
        { label: "Can Download Word", desc: "Export Word document", checked: canDownloadWord, key: "canDownloadWord" },
        { label: "Can Print", desc: "Print report", checked: canPrint, key: "canPrint" },
        { label: "Can LMS Sync", desc: "Synchronize LMS data", checked: canLoadLms, key: "canLoadLms" },
      ]
    : [
        { label: "Can View", desc: "Read access", checked: canView, key: "canView" },
        ...(!isOnlyDashboards
          ? [{ label: "Can Edit" + (isMixedSelection ? " (Reports)" : ""), desc: "Modify layout", checked: canEdit, key: "canEdit" }]
          : []),
        ...periodItems,
        { label: "Can LMS Sync", desc: "Trigger LMS sync", checked: canLoadLms, key: "canLoadLms" },
        ...(!isOnlyDashboards
          ? [{ label: "Can Print" + (isMixedSelection ? " (Reports)" : ""), desc: "Print reports", checked: canPrint, key: "canPrint" }]
          : []),
        { label: "Can View Drill Down" + (isMixedSelection ? " (Dashboards)" : ""), desc: "Click chart bars / slices", checked: canViewDrilldown, key: "canViewDrilldown" },
        { label: "Can Download Widget PDF File" + (isMixedSelection ? " (Dashboards)" : ""), desc: "Download MLI table PDF", checked: canDownloadWidgetPdf, key: "canDownloadWidgetPdf" },
        ...(!isOnlyDashboards
          ? [
              { label: "Can Download Excel" + (isMixedSelection ? " (Reports)" : ""), desc: "Export Excel", checked: canExport, key: "canExport" },
              { label: "Can Download Word" + (isMixedSelection ? " (Reports)" : ""), desc: "Export Word", checked: canDownloadWord, key: "canDownloadWord" },
            ]
          : []),
      ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>1. Select Access Mode</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
          <div
            onClick={() => onChangeAccessType("full")}
            style={{
              padding: "1rem",
              borderRadius: "8px",
              border: `2px solid ${accessType === "full" ? "#3b82f6" : "#e2e8f0"}`,
              background: accessType === "full" ? "#eff6ff" : "#ffffff",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="radio" checked={accessType === "full"} onChange={() => onChangeAccessType("full")} style={{ cursor: "pointer" }} />
              <strong style={{ color: "#0f172a", fontSize: "0.9rem" }}>Full Access (Unrestricted)</strong>
            </div>
            <p style={{ margin: "4px 0 0 1.5rem", fontSize: "0.8rem", color: "#64748b", lineHeight: "1.35" }}>
              Recipients view all data without row-level restrictions.
            </p>
          </div>

          <div
            onClick={() => onChangeAccessType("unique_key")}
            style={{
              padding: "1rem",
              borderRadius: "8px",
              border: `2px solid ${accessType === "unique_key" ? "#3b82f6" : "#e2e8f0"}`,
              background: accessType === "unique_key" ? "#eff6ff" : "#ffffff",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="radio"
                checked={accessType === "unique_key"}
                onChange={() => onChangeAccessType("unique_key")}
                style={{ cursor: "pointer" }}
              />
              <strong style={{ color: "#0f172a", fontSize: "0.9rem" }}>Unique-Key Based Access</strong>
            </div>
            <p style={{ margin: "4px 0 0 1.5rem", fontSize: "0.8rem", color: "#64748b", lineHeight: "1.35" }}>
              Restricts visibility so users only see rows matching their Unique User Key across Dashboards, Custom Reports, and Standard Reports.
            </p>
          </div>
        </div>
      </div>

      {accessType === "unique_key" && totalSelectedResources > 0 && (
        <div style={{ padding: "1.2rem", background: "#f8fafc", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", fontWeight: 700 }}>
            Multi-Line Item (MLI) Column Mapping
          </h4>
          {loadingColumns ? (
            <div style={{ padding: "1rem", color: "#64748b" }}>Loading MLI columns...</div>
          ) : mliGroups.length === 0 ? (
            <div style={{ padding: "0.75rem", background: "#fef2f2", color: "#991b1b", borderRadius: "6px", fontSize: "0.85rem" }}>
              No MLI fields found in selected resources.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {mliGroups.map((group) => {
                const groupKey = `${group.kpi_id}_${group.mli_id}`;
                return (
                  <div
                    key={groupKey}
                    style={{
                      background: "#ffffff",
                      padding: "0.85rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: "0.75rem",
                      alignItems: "flex-end",
                    }}
                  >
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                        Multi-Line Item (MLI)
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={`${group.mli_title} (${group.kpi_title})`}
                        title={`${group.kpi_title} - ${group.mli_title}`}
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          background: "#f8fafc",
                          color: "#334155",
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          cursor: "default",
                          outline: "none",
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", marginBottom: "0.3rem", textTransform: "uppercase" }}>
                        Restricted Column
                      </label>
                      <select
                        value={selectedFilterColumns[groupKey] || ""}
                        onChange={(e) => onFilterColumnsChange({ ...selectedFilterColumns, [groupKey]: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "0.5rem 0.75rem",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "0.85rem",
                          background: "#ffffff",
                          outline: "none",
                        }}
                      >
                        <option value="">Do not restrict (Show all data for this MLI)</option>
                        {group.columns.map((col) => (
                          <option key={col.sub_field_key} value={col.sub_field_key}>
                            {formatMliColumnOption(col)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>2. Feature Permissions</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
          {permissionItems.map((item) => (
            <label
              key={item.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.65rem",
                padding: "0.75rem 0.85rem",
                background: item.checked ? "#eff6ff" : "#ffffff",
                border: `1.5px solid ${item.checked ? "#3b82f6" : "#cbd5e1"}`,
                borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxSizing: "border-box",
              }}
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => onChangePermissions({ [item.key]: e.target.checked })}
                style={{ marginTop: "0.15rem", flexShrink: 0, cursor: "pointer", transform: "scale(1.1)", accentColor: "#2563eb" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: "0.85rem", color: "#1e293b", lineHeight: "1.3", wordBreak: "normal", overflowWrap: "break-word" }}>
                  {item.label}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "2px", lineHeight: "1.25", wordBreak: "normal", overflowWrap: "break-word" }}>
                  {item.desc}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssignmentPreviewModal({
  isOpen,
  onClose,
  onConfirm,
  submitting,
  preview,
  loadingPreview,
  accessType,
  permissions,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
  preview: BulkAssignPreview | null;
  loadingPreview: boolean;
  accessType: AccessType;
  permissions: any;
}) {
  if (!isOpen) return null;

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1rem" }}>
      <div style={{ background: "#ffffff", borderRadius: "12px", width: "100%", maxWidth: "540px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>Confirm Rights Assignment</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: "#f1f5f9",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              padding: "0.3rem 0.75rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#475569",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: "1.5rem", maxHeight: "70vh", overflowY: "auto" }}>
          {loadingPreview ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>Calculating preview impact...</div>
          ) : preview ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", textAlign: "center" }}>
                <div style={{ padding: "0.65rem", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#2563eb" }}>{preview.users_count}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Users</div>
                </div>
                <div style={{ padding: "0.65rem", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#0891b2" }}>{preview.dashboards_count + preview.reports_count}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Resources</div>
                </div>
                <div style={{ padding: "0.65rem", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#4f46e5" }}>{preview.total_targets}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Total Targets</div>
                </div>
              </div>

              <div style={{ padding: "0.75rem 1rem", background: "#f1f5f9", borderRadius: "6px", fontSize: "0.825rem" }}>
                <div>New: <strong style={{ color: "#16a34a" }}>+{preview.new_assignments_count}</strong></div>
                <div>Updates: <strong style={{ color: "#d97706" }}>{preview.rights_to_update_count}</strong></div>
                <div>Unchanged: <strong>{preview.no_changes_count}</strong></div>
              </div>

              <div>
                <AccessBadge accessType={accessType} restrictionSummary={preview.restriction_preview} />
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "0.6rem 1.25rem",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#475569",
              fontWeight: 600,
              cursor: "pointer",
              minHeight: "40px",
              fontSize: "0.875rem",
              transition: "all 0.15s ease",
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || loadingPreview}
            style={{
              padding: "0.6rem 1.5rem",
              borderRadius: "8px",
              border: "none",
              background: "#2563eb",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
              minHeight: "40px",
              fontSize: "0.875rem",
              boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
              transition: "all 0.15s ease",
            }}
          >
            {submitting ? "Applying..." : "Confirm & Apply Rights"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignRightsWizard({
  token,
  orgId,
  initialResourceType,
  initialResourceId,
  onAssignmentComplete,
}: {
  token: string;
  orgId?: number | null;
  initialResourceType?: string | null;
  initialResourceId?: number | null;
  onAssignmentComplete: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loadingInitial, setLoadingInitial] = useState(true);

  const [dashboards, setDashboards] = useState<ResourceOption[]>([]);
  const [customReports, setCustomReports] = useState<ResourceOption[]>([]);
  const [standardReports, setStandardReports] = useState<ResourceOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [selectedDashboardIds, setSelectedDashboardIds] = useState<number[]>([]);
  const [selectedCustomReportIds, setSelectedCustomReportIds] = useState<number[]>([]);
  const [selectedStandardReportIds, setSelectedStandardReportIds] = useState<number[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  const [accessType, setAccessType] = useState<AccessType>("full");
  const [canView, setCanView] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [canPrint, setCanPrint] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [canDownloadWord, setCanDownloadWord] = useState(false);
  const [canChangePeriodDashboards, setCanChangePeriodDashboards] = useState(false);
  const [canChangePeriodReports, setCanChangePeriodReports] = useState(false);
  const [canLoadLms, setCanLoadLms] = useState(false);
  const [canDownloadWidgetPdf, setCanDownloadWidgetPdf] = useState(true);
  const [canViewDrilldown, setCanViewDrilldown] = useState(true);
  const [selectedFilterColumns, setSelectedFilterColumns] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelectedFilterColumns({});
  }, [selectedDashboardIds, selectedCustomReportIds, selectedStandardReportIds]);

  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<BulkAssignPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoadingInitial(true);

    Promise.all([
      rightsService.fetchDashboards(token, orgId),
      rightsService.fetchCustomReports(token, orgId),
      rightsService.fetchStandardReports(token, orgId),
      rightsService.fetchOrgUsers(token, orgId),
    ])
      .then(([dList, crList, srList, uList]) => {
        setDashboards(dList);
        setCustomReports(crList);
        setStandardReports(srList);
        setUsers(uList);

        if (initialResourceId && initialResourceType) {
          if (initialResourceType === "dashboard") setSelectedDashboardIds([initialResourceId]);
          else if (initialResourceType === "custom_report") setSelectedCustomReportIds([initialResourceId]);
          else if (initialResourceType === "report") setSelectedStandardReportIds([initialResourceId]);
        }
      })
      .catch((e) => toast.error("Failed to load options: " + (e instanceof Error ? e.message : "")))
      .finally(() => setLoadingInitial(false));
  }, [token, orgId, initialResourceType, initialResourceId]);

  const totalSelectedResources = selectedDashboardIds.length + selectedCustomReportIds.length + selectedStandardReportIds.length;

  const handleToggleResource = (list: number[], setList: React.Dispatch<React.SetStateAction<number[]>>, id: number) => {
    setList((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleToggleUser = (id: number) => {
    setSelectedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const buildPayload = (): BulkAssignPayload => {
    let primaryCol: string | null = null;
    let kpiId: number | null = null;
    let mliId: number | null = null;

    if (accessType === "unique_key") {
      for (const [key, val] of Object.entries(selectedFilterColumns)) {
        if (val) {
          primaryCol = val;
          const [k, m] = key.split("_");
          kpiId = Number(k) || null;
          mliId = Number(m) || null;
          break;
        }
      }
    }

    return {
      user_ids: selectedUserIds,
      dashboard_ids: selectedDashboardIds,
      custom_report_ids: selectedCustomReportIds,
      report_template_ids: selectedStandardReportIds,
      access_type: accessType,
      can_view: canView,
      can_edit: canEdit,
      can_print: canPrint,
      can_export: canExport,
      can_download_word: canDownloadWord,
      can_change_period: canChangePeriodDashboards || canChangePeriodReports,
      can_change_period_dashboards: canChangePeriodDashboards,
      can_change_period_reports: canChangePeriodReports,
      can_load_lms: canLoadLms,
      can_download_widget_pdf: canDownloadWidgetPdf,
      can_view_drilldown: canViewDrilldown,
      filter_column_configs: accessType === "unique_key" ? selectedFilterColumns : null,
      filter_sub_field_key: primaryCol,
      filter_kpi_id: kpiId,
      filter_mli_id: mliId,
    };
  };

  const handleOpenPreview = async () => {
    if (totalSelectedResources === 0) {
      toast.error("Please select at least one Dashboard or Report.");
      return;
    }
    if (selectedUserIds.length === 0) {
      toast.error("Please select at least one User.");
      return;
    }

    setShowPreviewModal(true);
    setLoadingPreview(true);
    try {
      const payload = buildPayload();
      const preview = await rightsService.previewBulkAssign(token, payload, orgId);
      setPreviewData(preview);
    } catch (e) {
      toast.error("Failed to calculate preview: " + (e instanceof Error ? e.message : ""));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleExecuteAssignment = async () => {
    setSubmitting(true);
    try {
      const payload = buildPayload();
      const res = await rightsService.executeBulkAssign(token, payload, orgId);
      toast.success(`Rights applied! ${res.created_count} created, ${res.updated_count} updated.`);
      setShowPreviewModal(false);
      onAssignmentComplete();
    } catch (e) {
      toast.error("Assignment failed: " + (e instanceof Error ? e.message : ""));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingInitial) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>Loading wizard resources...</div>;
  }

  const steps = [
    { num: 1, label: "Select Resources" },
    { num: 2, label: "Select Users" },
    { num: 3, label: "Configure Access & Permissions" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", background: "#ffffff", borderRadius: "8px", overflow: "hidden", border: "1px solid #e2e8f0", flexWrap: "wrap" }}>
        {steps.map((s) => {
          const isActive = currentStep === s.num;
          const isDone = currentStep > s.num;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => setCurrentStep(s.num)}
              style={{
                flex: "1 1 180px",
                padding: "0.85rem 1rem",
                minHeight: "44px",
                border: "none",
                background: isActive ? "#eff6ff" : "#ffffff",
                borderBottom: isActive ? "3px solid #2563eb" : "3px solid transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "#1d4ed8" : isDone ? "#16a34a" : "#64748b",
                fontSize: "0.875rem",
              }}
            >
              <span>Step {s.num}:</span>
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {currentStep === 1 && (
        <div style={{ background: "#ffffff", padding: "1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.5rem" }}>Step 1: Choose Dashboards & Reports</h2>
          <ResourceSelectionStep
            dashboards={dashboards}
            customReports={customReports}
            standardReports={standardReports}
            selectedDashboardIds={selectedDashboardIds}
            selectedCustomReportIds={selectedCustomReportIds}
            selectedStandardReportIds={selectedStandardReportIds}
            onToggleDashboard={(id) => handleToggleResource(selectedDashboardIds, setSelectedDashboardIds, id)}
            onToggleCustomReport={(id) => handleToggleResource(selectedCustomReportIds, setSelectedCustomReportIds, id)}
            onToggleStandardReport={(id) => handleToggleResource(selectedStandardReportIds, setSelectedStandardReportIds, id)}
            onSelectAllDashboards={setSelectedDashboardIds}
            onSelectAllCustomReports={setSelectedCustomReportIds}
            onSelectAllStandardReports={setSelectedStandardReportIds}
            onClearAll={() => {
              setSelectedDashboardIds([]);
              setSelectedCustomReportIds([]);
              setSelectedStandardReportIds([]);
            }}
          />
          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              disabled={totalSelectedResources === 0}
              style={{
                padding: "0.6rem 1.25rem",
                minHeight: "40px",
                borderRadius: "6px",
                border: "none",
                background: totalSelectedResources > 0 ? "#2563eb" : "#cbd5e1",
                color: "#ffffff",
                fontWeight: 600,
                cursor: totalSelectedResources > 0 ? "pointer" : "not-allowed",
                flex: "1 1 auto",
                maxWidth: "420px",
                textAlign: "center",
              }}
            >
              Next: Select Users ({totalSelectedResources} selected)
            </button>
          </div>
        </div>
      )}

      {currentStep === 2 && (
        <div style={{ background: "#ffffff", padding: "1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.5rem" }}>Step 2: Choose Users</h2>
          <UserSelectionStep
            users={users}
            selectedUserIds={selectedUserIds}
            onToggleUser={handleToggleUser}
            onSelectAll={setSelectedUserIds}
            onClearAll={() => setSelectedUserIds([])}
          />
          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              style={{
                padding: "0.6rem 1rem",
                minHeight: "40px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontWeight: 600,
                cursor: "pointer",
                flex: "1 1 auto",
                maxWidth: "200px",
                textAlign: "center",
              }}
            >
              Back to Resources
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              disabled={selectedUserIds.length === 0}
              style={{
                padding: "0.6rem 1.25rem",
                minHeight: "40px",
                borderRadius: "6px",
                border: "none",
                background: selectedUserIds.length > 0 ? "#2563eb" : "#cbd5e1",
                color: "#ffffff",
                fontWeight: 600,
                cursor: selectedUserIds.length > 0 ? "pointer" : "not-allowed",
                flex: "1 1 auto",
                maxWidth: "400px",
                textAlign: "center",
              }}
            >
              Next: Configure Access ({selectedUserIds.length} users)
            </button>
          </div>
        </div>
      )}

      {currentStep === 3 && (
        <div style={{ background: "#ffffff", padding: "1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.5rem" }}>Step 3: Configure Access & Feature Permissions</h2>
          <AccessConfigStep
            token={token}
            orgId={orgId}
            selectedDashboardIds={selectedDashboardIds}
            selectedCustomReportIds={selectedCustomReportIds}
            selectedStandardReportIds={selectedStandardReportIds}
            accessType={accessType}
            onChangeAccessType={setAccessType}
            canView={canView}
            canEdit={canEdit}
            canPrint={canPrint}
            canExport={canExport}
            canDownloadWord={canDownloadWord}
            canChangePeriodDashboards={canChangePeriodDashboards}
            canChangePeriodReports={canChangePeriodReports}
            canLoadLms={canLoadLms}
            canDownloadWidgetPdf={canDownloadWidgetPdf}
            canViewDrilldown={canViewDrilldown}
            onChangePermissions={(patch: any) => {
              if (patch.canView !== undefined) setCanView(patch.canView);
              if (patch.canEdit !== undefined) setCanEdit(patch.canEdit);
              if (patch.canPrint !== undefined) setCanPrint(patch.canPrint);
              if (patch.canExport !== undefined) setCanExport(patch.canExport);
              if (patch.canDownloadWord !== undefined) setCanDownloadWord(patch.canDownloadWord);
              if (patch.canChangePeriodDashboards !== undefined) setCanChangePeriodDashboards(patch.canChangePeriodDashboards);
              if (patch.canChangePeriodReports !== undefined) setCanChangePeriodReports(patch.canChangePeriodReports);
              if (patch.canLoadLms !== undefined) setCanLoadLms(patch.canLoadLms);
              if (patch.canDownloadWidgetPdf !== undefined) setCanDownloadWidgetPdf(patch.canDownloadWidgetPdf);
              if (patch.canViewDrilldown !== undefined) setCanViewDrilldown(patch.canViewDrilldown);
            }}
            selectedFilterColumns={selectedFilterColumns}
            onFilterColumnsChange={setSelectedFilterColumns}
          />
          <div style={{ marginTop: "1.75rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.85rem" }}>
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              style={{
                padding: "0.65rem 1.25rem",
                minHeight: "42px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "0.875rem",
                transition: "all 0.15s ease",
              }}
            >
              Back to Users
            </button>
            <button
              type="button"
              onClick={handleOpenPreview}
              style={{
                padding: "0.65rem 1.5rem",
                minHeight: "42px",
                borderRadius: "8px",
                border: "none",
                background: "#2563eb",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "0.875rem",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
                transition: "all 0.15s ease",
              }}
            >
              Review & Apply Rights ({totalSelectedResources} resources x {selectedUserIds.length} users)
            </button>
          </div>
        </div>
      )}

      <AssignmentPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        onConfirm={handleExecuteAssignment}
        submitting={submitting}
        preview={previewData}
        loadingPreview={loadingPreview}
        accessType={accessType}
        permissions={{ canView, canEdit, canPrint, canExport, canChangePeriodDashboards, canChangePeriodReports, canLoadLms }}
      />
    </div>
  );
}

// ===========================================================================
// SECTION 6: USER-CENTRIC & RESOURCE-CENTRIC VIEWS
// ===========================================================================

function UserCentricView({
  token,
  orgId,
  initialUserId,
  dataVersion,
  onMutationSuccess,
}: {
  token: string;
  orgId?: number | null;
  initialUserId?: number | null;
  dataVersion?: number;
  onMutationSuccess?: () => void;
}) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(initialUserId || null);
  const [summary, setSummary] = useState<UserRightsSummary | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) return;
    let isCancelled = false;
    setLoadingUsers(true);
    setSummary(null);
    rightsService
      .fetchOrgUsers(token, orgId)
      .then((res) => {
        if (isCancelled) return;
        setUsers(res);
        if (res.length > 0) {
          setSelectedUserId((prev) => {
            if (prev && res.some((u) => u.id === prev)) return prev;
            return res[0].id;
          });
        } else {
          setSelectedUserId(null);
          setSummary(null);
        }
      })
      .catch((e) => {
        if (!isCancelled) toast.error("Failed to load users: " + (e instanceof Error ? e.message : ""));
      })
      .finally(() => {
        if (!isCancelled) setLoadingUsers(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [token, orgId]);

  const loadUserSummary = (userId: number, silent = false) => {
    if (!silent) setLoadingSummary(true);
    rightsService
      .getUserRights(token, userId, orgId)
      .then((data) => setSummary(data))
      .catch((e) => {
        console.warn("Could not load user rights:", e);
        if (!silent) setSummary(null);
      })
      .finally(() => {
        if (!silent) setLoadingSummary(false);
      });
  };

  useEffect(() => {
    if (!token || !selectedUserId || loadingUsers || users.length === 0) {
      if (!selectedUserId || users.length === 0) setSummary(null);
      return;
    }
    // Only load summary if selectedUserId belongs to currently loaded users list
    if (!users.some((u) => u.id === selectedUserId)) {
      setSummary(null);
      return;
    }
    loadUserSummary(selectedUserId);
  }, [token, selectedUserId, orgId, users, loadingUsers, dataVersion]);

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (u.full_name || "").toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.unique_user_key || "").toLowerCase().includes(q);
  });

  const handleToggleActive = async (resource: UserAssignedResource) => {
    const newActive = !resource.is_active;
    setSummary((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        dashboards: prev.dashboards.map((d) =>
          d.permission_id === resource.permission_id ? { ...d, is_active: newActive } : d
        ),
        reports: prev.reports.map((r) =>
          r.permission_id === resource.permission_id ? { ...r, is_active: newActive } : r
        ),
      };
    });

    try {
      await rightsService.updateRight(token, resource.resource_type, resource.permission_id, { is_active: newActive }, orgId);
      toast.success(newActive ? "Activated" : "Deactivated");
      if (selectedUserId) loadUserSummary(selectedUserId, true);
      onMutationSuccess?.();
    } catch (e) {
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          dashboards: prev.dashboards.map((d) =>
            d.permission_id === resource.permission_id ? { ...d, is_active: !newActive } : d
          ),
          reports: prev.reports.map((r) =>
            r.permission_id === resource.permission_id ? { ...r, is_active: !newActive } : r
          ),
        };
      });
      toast.error("Failed to update status: " + (e instanceof Error ? e.message : ""));
    }
  };

  const handleRevoke = async (resource: UserAssignedResource) => {
    if (!confirm(`Revoke access to "${resource.resource_name}"?`)) return;
    const oldSummary = summary;
    setSummary((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        dashboards: prev.dashboards.filter((d) => d.permission_id !== resource.permission_id),
        reports: prev.reports.filter((r) => r.permission_id !== resource.permission_id),
      };
    });

    try {
      await rightsService.revokeRight(token, resource.resource_type, resource.permission_id, orgId);
      toast.success("Right revoked.");
      if (selectedUserId) loadUserSummary(selectedUserId, true);
      onMutationSuccess?.();
    } catch (e) {
      setSummary(oldSummary);
      toast.error("Failed to revoke: " + (e instanceof Error ? e.message : ""));
    }
  };

  const handleSetDefaultDashboard = async (dashboardId: number | null) => {
    if (!token || !selectedUserId) return;
    try {
      await rightsService.setUserDefaultDashboard(token, selectedUserId, dashboardId, orgId);
      toast.success(dashboardId ? "Default dashboard updated" : "Default dashboard cleared");
      loadUserSummary(selectedUserId, true);
      onMutationSuccess?.();
    } catch (e) {
      toast.error("Failed to set default dashboard: " + (e instanceof Error ? e.message : ""));
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem", alignItems: "flex-start" }}>
      <div
        style={{
          background: "#ffffff",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100vh - 120px)",
          position: "sticky",
          top: "1.25rem",
          alignSelf: "flex-start",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "1rem", borderBottom: "1px solid #e2e8f0" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>Select User</h3>
          <input
            type="text"
            placeholder="Filter users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "0.4rem 0.65rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.8rem" }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loadingUsers ? (
            <div style={{ padding: "2rem 1rem", textAlign: "center", color: "#64748b" }}>Loading...</div>
          ) : (
            filteredUsers.map((u) => {
              const isSelected = selectedUserId === u.id;
              return (
                <div
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  style={{
                    padding: "0.75rem 1rem",
                    borderBottom: "1px solid #f1f5f9",
                    background: isSelected ? "#eff6ff" : "transparent",
                    borderLeft: isSelected ? "3px solid #2563eb" : "3px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", color: isSelected ? "#1d4ed8" : "#1e293b" }}>{u.full_name || u.username}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>@{u.username}</div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {loadingSummary ? (
          <div style={{ background: "#ffffff", padding: "3rem", textAlign: "center", borderRadius: "10px", color: "#64748b" }}>Loading user rights...</div>
        ) : summary ? (
          <>
            <div style={{ background: "#ffffff", padding: "1.25rem 1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>{summary.full_name || summary.username}</h2>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.8rem", background: "#e2e8f0", padding: "2px 8px", borderRadius: "4px", fontWeight: 600 }}>{summary.role}</span>
                  <UserTypeBadge userType={summary.is_external ? "external" : "internal"} uniqueKey={summary.unique_user_key} />
                  {summary.default_dashboard_id && (
                    <span
                      style={{
                        fontSize: "0.78rem",
                        background: "#fef3c7",
                        color: "#92400e",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontWeight: 600,
                        border: "1px solid #fde68a",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                      }}
                      title="Default Dashboard"
                    >
                      ★ Default: {summary.dashboards.find((d) => d.resource_id === summary.default_dashboard_id)?.resource_name || `#${summary.default_dashboard_id}`}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: "1rem" }}>
                <div style={{ padding: "0.6rem 1rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", textAlign: "center" }}>
                  <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "#2563eb" }}>{summary.dashboards.length}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>Dashboards</div>
                </div>
                <div style={{ padding: "0.6rem 1rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", textAlign: "center" }}>
                  <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "#0891b2" }}>{summary.reports.length}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>Reports</div>
                </div>
              </div>
            </div>

            <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.95rem" }}>
                Assigned Dashboards ({summary.dashboards.length})
              </div>
              {summary.dashboards.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>No dashboards assigned.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left", color: "#64748b" }}>
                      <th style={{ padding: "0.6rem 1rem" }}>Dashboard</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Access Mode</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Restrictions</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Status</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Default</th>
                      <th style={{ padding: "0.6rem 1rem", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.dashboards.map((d) => {
                      const isDefault = Boolean(d.is_default || summary.default_dashboard_id === d.resource_id);
                      return (
                        <tr key={d.permission_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "0.65rem 1rem", fontWeight: 600 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span>{d.resource_name}</span>
                              {isDefault && (
                                <span
                                  style={{
                                    fontSize: "0.72rem",
                                    padding: "2px 7px",
                                    borderRadius: "999px",
                                    background: "#fef3c7",
                                    color: "#b45309",
                                    fontWeight: 700,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "3px",
                                    border: "1px solid #fde68a",
                                  }}
                                  title="Default dashboard for this user"
                                >
                                  ★ Default
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "0.65rem 1rem" }}><AccessBadge accessType={d.access_type} /></td>
                          <td style={{ padding: "0.65rem 1rem", color: "#64748b" }}>{d.restriction_summary}</td>
                          <td style={{ padding: "0.65rem 1rem" }}>
                            <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600, background: d.is_active ? "#dcfce7" : "#fee2e2", color: d.is_active ? "#15803d" : "#b91c1c" }}>
                              {d.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td style={{ padding: "0.65rem 1rem" }}>
                            {isDefault ? (
                              <button
                                type="button"
                                onClick={() => handleSetDefaultDashboard(null)}
                                style={{
                                  background: "#f8fafc",
                                  border: "1px solid #cbd5e1",
                                  borderRadius: "5px",
                                  padding: "3px 8px",
                                  fontSize: "0.75rem",
                                  color: "#64748b",
                                  cursor: "pointer",
                                  fontWeight: 500,
                                }}
                                title="Remove default dashboard"
                              >
                                Clear Default
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetDefaultDashboard(d.resource_id)}
                                disabled={!d.is_active || !d.can_view}
                                style={{
                                  background: !d.is_active || !d.can_view ? "#f1f5f9" : "#eff6ff",
                                  border: !d.is_active || !d.can_view ? "1px solid #e2e8f0" : "1px solid #bfdbfe",
                                  borderRadius: "5px",
                                  padding: "3px 8px",
                                  fontSize: "0.75rem",
                                  color: !d.is_active || !d.can_view ? "#94a3b8" : "#1d4ed8",
                                  cursor: !d.is_active || !d.can_view ? "not-allowed" : "pointer",
                                  fontWeight: 600,
                                }}
                                title={!d.is_active || !d.can_view ? "Requires active view rights" : "Set as user's default dashboard"}
                              >
                                Set as Default
                              </button>
                            )}
                          </td>
                          <td style={{ padding: "0.65rem 1rem", textAlign: "right" }}>
                            <button type="button" onClick={() => handleToggleActive(d)} style={{ background: "none", border: "none", color: d.is_active ? "#ea580c" : "#16a34a", cursor: "pointer", fontWeight: 600, marginRight: "0.75rem" }}>
                              {d.is_active ? "Deactivate" : "Activate"}
                            </button>
                            <button type="button" onClick={() => handleRevoke(d)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontWeight: 600 }}>
                              Revoke
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.95rem" }}>
                Assigned Reports ({summary.reports.length})
              </div>
              {summary.reports.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>No reports assigned.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left", color: "#64748b" }}>
                      <th style={{ padding: "0.6rem 1rem" }}>Report</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Type</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Access Mode</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Restrictions</th>
                      <th style={{ padding: "0.6rem 1rem" }}>Status</th>
                      <th style={{ padding: "0.6rem 1rem", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.reports.map((r) => (
                      <tr key={r.permission_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "0.65rem 1rem", fontWeight: 600 }}>{r.resource_name}</td>
                        <td style={{ padding: "0.65rem 1rem" }}><ResourceTypeBadge resourceType={r.resource_type} /></td>
                        <td style={{ padding: "0.65rem 1rem" }}><AccessBadge accessType={r.access_type} /></td>
                        <td style={{ padding: "0.65rem 1rem", color: "#64748b" }}>{r.restriction_summary}</td>
                        <td style={{ padding: "0.65rem 1rem" }}>
                          <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600, background: r.is_active ? "#dcfce7" : "#fee2e2", color: r.is_active ? "#15803d" : "#b91c1c" }}>
                            {r.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td style={{ padding: "0.65rem 1rem", textAlign: "right" }}>
                          <button type="button" onClick={() => handleToggleActive(r)} style={{ background: "none", border: "none", color: r.is_active ? "#ea580c" : "#16a34a", cursor: "pointer", fontWeight: 600, marginRight: "0.75rem" }}>
                            {r.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button type="button" onClick={() => handleRevoke(r)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontWeight: 600 }}>
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div style={{ background: "#ffffff", padding: "3rem", textAlign: "center", borderRadius: "10px", color: "#64748b" }}>
            Select a user from the list to view their permissions.
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceCentricView({
  token,
  orgId,
  initialResourceType = "dashboard",
  initialResourceId,
  onNavigateToAssign,
  dataVersion,
  onMutationSuccess,
}: {
  token: string;
  orgId?: number | null;
  initialResourceType?: ResourceType | null;
  initialResourceId?: number | null;
  onNavigateToAssign?: (type: ResourceType, id: number) => void;
  dataVersion?: number;
  onMutationSuccess?: () => void;
}) {
  const [resourceType, setResourceType] = useState<ResourceType>(initialResourceType || "dashboard");
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<number | null>(null);
  const [summary, setSummary] = useState<ResourceRightsSummary | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);

  useEffect(() => {
    if (!token) return;
    let isCancelled = false;
    setLoadingList(true);
    setSummary(null);
    setSelectedResourceId(null);
    setResources([]);

    let promise: Promise<ResourceOption[]>;
    if (resourceType === "dashboard") promise = rightsService.fetchDashboards(token, orgId);
    else if (resourceType === "custom_report") promise = rightsService.fetchCustomReports(token, orgId);
    else promise = rightsService.fetchStandardReports(token, orgId);

    promise
      .then((items) => {
        if (isCancelled) return;
        setResources(items);
        if (items.length > 0) {
          const matched = initialResourceId && items.some((r) => r.id === initialResourceId);
          setSelectedResourceId(matched ? initialResourceId : items[0].id);
        } else {
          setSelectedResourceId(null);
          setSummary(null);
        }
      })
      .catch((e) => {
        if (!isCancelled) toast.error("Failed to load resources: " + (e instanceof Error ? e.message : ""));
      })
      .finally(() => {
        if (!isCancelled) setLoadingList(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [token, resourceType, orgId]);

  const loadResourceSummary = (type: string, id: number, silent = false) => {
    if (!silent) setLoadingSummary(true);
    rightsService
      .getResourceRights(token, type, id, orgId)
      .then((data) => setSummary(data))
      .catch((e) => {
        console.warn("Could not load resource rights:", e);
        if (!silent) setSummary(null);
      })
      .finally(() => {
        if (!silent) setLoadingSummary(false);
      });
  };

  useEffect(() => {
    if (!token || !selectedResourceId || loadingList || resources.length === 0) {
      if (!selectedResourceId || resources.length === 0) setSummary(null);
      return;
    }
    // Only load summary if selectedResourceId belongs to the current loaded resources list
    if (!resources.some((r) => r.id === selectedResourceId)) {
      setSummary(null);
      return;
    }
    loadResourceSummary(resourceType, selectedResourceId);
  }, [token, resourceType, selectedResourceId, orgId, resources, loadingList, dataVersion]);

  const handleToggleActive = async (user: ResourceAssignedUser) => {
    const newActive = !user.is_active;
    setSummary((prev) => {
      if (!prev) return prev;
      const updatedUsers = prev.assigned_users.map((u) =>
        u.permission_id === user.permission_id ? { ...u, is_active: newActive } : u
      );
      return {
        ...prev,
        assigned_users: updatedUsers,
      };
    });

    try {
      await rightsService.updateRight(token, resourceType, user.permission_id, { is_active: newActive }, orgId);
      toast.success(newActive ? "Activated" : "Deactivated");
      if (selectedResourceId) loadResourceSummary(resourceType, selectedResourceId, true);
      onMutationSuccess?.();
    } catch (e) {
      setSummary((prev) => {
        if (!prev) return prev;
        const updatedUsers = prev.assigned_users.map((u) =>
          u.permission_id === user.permission_id ? { ...u, is_active: !newActive } : u
        );
        return {
          ...prev,
          assigned_users: updatedUsers,
        };
      });
      toast.error("Failed to update status: " + (e instanceof Error ? e.message : ""));
    }
  };

  const handleRevoke = async (user: ResourceAssignedUser) => {
    if (!confirm(`Revoke access to this ${resourceType} for ${user.full_name || user.username}?`)) return;
    const oldSummary = summary;
    setSummary((prev) => {
      if (!prev) return prev;
      const updatedUsers = prev.assigned_users.filter((u) => u.permission_id !== user.permission_id);
      return {
        ...prev,
        assigned_users: updatedUsers,
      };
    });

    try {
      await rightsService.revokeRight(token, resourceType, user.permission_id, orgId);
      toast.success("Right revoked.");
      if (selectedResourceId) loadResourceSummary(resourceType, selectedResourceId, true);
      onMutationSuccess?.();
    } catch (e) {
      setSummary(oldSummary);
      toast.error("Failed to revoke right: " + (e instanceof Error ? e.message : ""));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ background: "#ffffff", padding: "1rem 1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
        <div style={{ display: "inline-flex", background: "#e2e8f0", padding: "2px", borderRadius: "8px" }}>
          {[
            { key: "dashboard" as const, label: "Dashboards" },
            { key: "custom_report" as const, label: "Custom Reports" },
            { key: "report" as const, label: "Standard Reports" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                if (resourceType !== tab.key) {
                  setResourceType(tab.key);
                  setSelectedResourceId(null);
                  setResources([]);
                  setSummary(null);
                }
              }}
              style={{ padding: "0.4rem 0.85rem", borderRadius: "6px", border: "none", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", background: resourceType === tab.key ? "#ffffff" : "transparent", color: resourceType === tab.key ? "#1e293b" : "#64748b" }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: "1 1 280px" }}>
          <select
            value={selectedResourceId || ""}
            onChange={(e) => setSelectedResourceId(Number(e.target.value))}
            disabled={loadingList || resources.length === 0}
            style={{ width: "100%", padding: "0.45rem 0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.875rem", background: "#ffffff" }}
          >
            {loadingList ? (
              <option>Loading resources...</option>
            ) : resources.length === 0 ? (
              <option>No resources found</option>
            ) : (
              resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))
            )}
          </select>
        </div>

        {selectedResourceId && onNavigateToAssign && (
          <button
            type="button"
            onClick={() => onNavigateToAssign(resourceType, selectedResourceId)}
            style={{ padding: "0.45rem 0.9rem", borderRadius: "6px", border: "none", background: "#2563eb", color: "#ffffff", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}
          >
            + Assign Users to this {resourceType === "dashboard" ? "Dashboard" : "Report"}
          </button>
        )}
      </div>

      {loadingSummary ? (
        <div style={{ background: "#ffffff", padding: "4rem", textAlign: "center", borderRadius: "10px", color: "#64748b" }}>Loading summary...</div>
      ) : summary ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div style={{ background: "#ffffff", padding: "1.25rem 1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>{summary.resource_name}</h2>
                <ResourceTypeBadge resourceType={summary.resource_type} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "4px" }}>{summary.resource_type === "dashboard" ? "Dashboard Access & Permissions" : "Report Access & Permissions"}</div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <div style={{ padding: "0.6rem 1rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", textAlign: "center" }}>
                <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "#2563eb" }}>{summary.assigned_users.length}</div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>Total Users</div>
              </div>
              <div style={{ padding: "0.6rem 1rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", textAlign: "center" }}>
                <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "#16a34a" }}>{summary.assigned_users.filter((u) => u.is_active).length}</div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>Active</div>
              </div>
            </div>
          </div>

          <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.95rem" }}>
              Authorized Users ({summary.assigned_users.length})
            </div>
            {summary.assigned_users.length === 0 ? (
              <div style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>No users assigned yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "0.65rem 1rem" }}>User</th>
                    <th style={{ padding: "0.65rem 1rem" }}>Type & Key</th>
                    <th style={{ padding: "0.65rem 1rem" }}>Access Mode</th>
                    <th style={{ padding: "0.65rem 1rem" }}>Restrictions</th>
                    <th style={{ padding: "0.65rem 1rem" }}>Status</th>
                    <th style={{ padding: "0.65rem 1rem", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.assigned_users.map((user) => (
                    <tr key={user.permission_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.65rem 1rem" }}>
                        <div style={{ fontWeight: 600 }}>{user.full_name || user.username}</div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>@{user.username}</div>
                      </td>
                      <td style={{ padding: "0.65rem 1rem" }}>
                        <UserTypeBadge userType={user.is_external ? "external" : "internal"} uniqueKey={user.unique_user_key} />
                      </td>
                      <td style={{ padding: "0.65rem 1rem" }}><AccessBadge accessType={user.access_type} /></td>
                      <td style={{ padding: "0.65rem 1rem", color: "#64748b" }}>{user.restriction_summary}</td>
                      <td style={{ padding: "0.65rem 1rem" }}>
                        <span style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600, background: user.is_active ? "#dcfce7" : "#fee2e2", color: user.is_active ? "#15803d" : "#b91c1c" }}>
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={{ padding: "0.65rem 1rem", textAlign: "right" }}>
                        <button type="button" onClick={() => handleToggleActive(user)} style={{ background: "none", border: "none", color: user.is_active ? "#ea580c" : "#16a34a", cursor: "pointer", fontWeight: 600, marginRight: "0.75rem" }}>
                          {user.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button type="button" onClick={() => handleRevoke(user)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontWeight: 600 }}>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
// SECTION 7: AUDIT HISTORY VIEW
// ===========================================================================

function AuditHistoryView({
  token,
  orgId,
}: {
  token: string;
  orgId?: number | null;
}) {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");

  useEffect(() => {
    if (!token) return;
    let isCancelled = false;
    setLoading(true);

    rightsService
      .getAuditLogs(token, {
        organization_id: orgId,
        page,
        page_size: pageSize,
        action: actionFilter !== "all" ? actionFilter : undefined,
        search: submittedSearch || undefined,
      })
      .then((res) => {
        if (isCancelled) return;
        setLogs(res.items || []);
        setPage(res.page || 1);
        setTotalPages(res.total_pages || 1);
        setTotal(res.total || 0);
      })
      .catch((e) => {
        if (isCancelled) return;
        toast.error("Failed to load audit logs: " + (e instanceof Error ? e.message : ""));
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [token, page, pageSize, actionFilter, submittedSearch, orgId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(search.trim());
    setPage(1);
  };

  const handleClearFilters = () => {
    setActionFilter("all");
    setSearch("");
    setSubmittedSearch("");
    setPage(1);
  };

  const hasActiveFilters = actionFilter !== "all" || Boolean(submittedSearch);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "#ffffff", padding: "0.85rem 1.25rem", borderRadius: "10px", border: "1px solid #e2e8f0", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", flex: 1, minWidth: "260px" }}>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            style={{ padding: "0.45rem 0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.85rem", minHeight: "36px", background: "#ffffff" }}
          >
            <option value="all">All Actions</option>
            <option value="DEACTIVATED">Deactivate / Deactivated</option>
            <option value="ACTIVATED">Activate / Activated</option>
            <option value="ASSIGNED">Assign / Assigned</option>
            <option value="UPDATED">Update / Updated</option>
            <option value="REVOKED">Revoke / Revoked</option>
          </select>

          <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Search audit trail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "200px", minWidth: "140px", padding: "0.45rem 0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.85rem", minHeight: "36px" }}
            />
            <button type="submit" style={{ padding: "0.45rem 0.85rem", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#f8fafc", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", minHeight: "36px", whiteSpace: "nowrap" }}>
              Search
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                style={{ padding: "0.45rem 0.75rem", borderRadius: "6px", border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: "0.85rem", cursor: "pointer", minHeight: "36px", whiteSpace: "nowrap" }}
              >
                Reset
              </button>
            )}
          </form>
        </div>

        <div style={{ fontSize: "0.85rem", color: "#64748b", whiteSpace: "nowrap" }}>
          Total Audit Events: <strong style={{ color: "#1e293b" }}>{total}</strong>
        </div>

        <div className="pagination-page-size" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>Show:</label>
          <select
            value={pageSize >= total && total > 25 ? "all" : pageSize}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "all") {
                setPageSize(Math.max(total, 500));
              } else {
                setPageSize(Number(v));
              }
              setPage(1);
            }}
            style={{ padding: "0.4rem 0.65rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
            <option value={250}>250 per page</option>
            <option value={500}>500 per page</option>
            {total > 25 && (
              <option value="all">All Audit Events ({total})</option>
            )}
          </select>
        </div>
      </div>

    <div style={{ background: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
      {loading ? (
        <div style={{ padding: "4rem", textAlign: "center", color: "#64748b" }}>Loading audit history...</div>
      ) : logs.length === 0 ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "#64748b" }}>No audit records found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "0.65rem 1rem" }}>Timestamp</th>
                <th style={{ padding: "0.65rem 1rem" }}>Action</th>
                <th style={{ padding: "0.65rem 1rem" }}>Resource</th>
                <th style={{ padding: "0.65rem 1rem" }}>User</th>
                <th style={{ padding: "0.65rem 1rem" }}>Change Summary</th>
                <th style={{ padding: "0.65rem 1rem" }}>Changed By</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const dateStr = new Date(log.created_at).toLocaleString();
                return (
                  <tr key={log.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.65rem 1rem", color: "#64748b", whiteSpace: "nowrap" }}>{dateStr}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{
                        padding: "3px 8px",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        background: log.action === "ACTIVATED" ? "#ecfdf5" :
                                    log.action === "DEACTIVATED" ? "#fff7ed" :
                                    log.action === "ASSIGNED" ? "#eff6ff" :
                                    log.action === "REVOKED" ? "#fef2f2" : "#f1f5f9",
                        color: log.action === "ACTIVATED" ? "#059669" :
                               log.action === "DEACTIVATED" ? "#c2410c" :
                               log.action === "ASSIGNED" ? "#2563eb" :
                               log.action === "REVOKED" ? "#dc2626" : "#334155",
                      }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ padding: "0.65rem 1rem", fontWeight: 600 }}>{log.resource_name || (log.resource_type === "dashboard" ? "Dashboard" : "Report")}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>{log.user_full_name || log.username}</td>
                    <td style={{ padding: "0.65rem 1rem", fontSize: "0.8rem", color: "#475569" }}>
                      {log.action === "ASSIGNED" && <span style={{ color: "#16a34a" }}>Access Granted</span>}
                      {log.action === "REVOKED" && <span style={{ color: "#dc2626" }}>Access Revoked</span>}
                      {log.action === "ACTIVATED" && <span style={{ color: "#16a34a" }}>Activated</span>}
                      {log.action === "DEACTIVATED" && <span style={{ color: "#ea580c" }}>Deactivated</span>}
                      {log.action === "UPDATED" && <span>Permissions Modified</span>}
                    </td>
                    <td style={{ padding: "0.65rem 1rem", color: "#64748b" }}>{log.changed_by_name || "Admin"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="pagination-bar" style={{ borderRadius: "0 0 10px 10px", borderTop: "1px solid #e2e8f0", justifyContent: "flex-end" }}>
          <div className="pagination-group">
            <button
              type="button"
              className="pagination-btn pagination-btn-prev"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="pagination-info">
              Page <strong style={{ color: "#1e293b" }}>{page}</strong> of <strong style={{ color: "#1e293b" }}>{totalPages}</strong>
              <span style={{ color: "#94a3b8" }}>({total} events)</span>
            </span>
            <button
              type="button"
              className="pagination-btn pagination-btn-next"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ===========================================================================
// SECTION 8: CENTRALIZED HUB ROOT PAGE
// ===========================================================================

type ActiveTab = "manage" | "assign" | "user" | "resource" | "audit";

interface MeInfo {
  id: number;
  username: string;
  role: string;
  organization_id?: number | null;
}

function RightsManagementContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = getAccessToken();

  const tabParam = (searchParams?.get("tab") as ActiveTab) || "manage";
  const resourceTypeParam = (searchParams?.get("resource_type") as ResourceType) || null;
  const resourceIdParam = searchParams?.get("resource_id") ? Number(searchParams.get("resource_id")) : null;
  const userIdParam = searchParams?.get("user_id") ? Number(searchParams.get("user_id")) : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>(tabParam);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);

  const triggerRefresh = () => setDataVersion((v) => v + 1);

  useEffect(() => {
    if (tabParam && ["manage", "assign", "user", "resource", "audit"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    if (!token) return;
    setLoadingMe(true);
    api<MeInfo>("/auth/me", { token })
      .then((data) => setMe(data))
      .catch(() => {})
      .finally(() => setLoadingMe(false));
  }, [token]);

  const setTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", tab);
    if (tab === "manage") {
      params.delete("resource_id");
      params.delete("user_id");
      params.delete("resource_type");
    }
    router.push(`/dashboard/access/rights?${params.toString()}`);
  };

  const handleNavigateToAssignWithResource = (type: ResourceType, id: number) => {
    const params = new URLSearchParams();
    params.set("tab", "assign");
    params.set("resource_type", type);
    params.set("resource_id", String(id));
    router.push(`/dashboard/access/rights?${params.toString()}`);
    setActiveTab("assign");
  };

  if (!token) {
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <p>Please log in to manage rights.</p>
        <Link href="/login" className="btn btn-primary">Log In</Link>
      </div>
    );
  }

  if (loadingMe) {
    return <WidgetSpinnerLoader size="large" text="Loading rights management..." minHeight={400} />;
  }

  const isOrgAdmin = me?.role === "ORG_ADMIN" || me?.role === "SUPER_ADMIN";
  if (!isOrgAdmin) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#ef4444" }}>
        <h3>Access Restricted</h3>
        <p>Only Organization Administrators can manage dashboard and report access rights.</p>
        <Link href="/dashboard" className="btn btn-secondary">Return to Dashboard</Link>
      </div>
    );
  }

  const orgIdParam = searchParams?.get("organization_id") ? Number(searchParams.get("organization_id")) : null;
  const orgId = orgIdParam || me?.organization_id || null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: "3rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.65rem", fontWeight: 800, color: "#0f172a" }}>
              Dashboard & Report Rights Management
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setTab("assign")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.55rem 1rem",
              borderRadius: "8px",
              border: "none",
              background: "#2563eb",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Assign Rights
          </button>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", marginBottom: "1.5rem", gap: "0.5rem", overflowX: "auto" }}>
        {[
          { key: "manage" as const, label: "Manage Rights", desc: "List, filter & bulk edit" },
          { key: "assign" as const, label: "Assign Rights", desc: "Bulk assignment wizard" },
          { key: "user" as const, label: "User Rights View", desc: "Inspect by user" },
          { key: "resource" as const, label: "Resource Rights View", desc: "Inspect by dashboard/report" },
          { key: "audit" as const, label: "Audit History", desc: "Change log trail" },
        ].map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "0.75rem 1.25rem",
                border: "none",
                background: "transparent",
                borderBottom: isActive ? "3px solid #2563eb" : "3px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "2px",
              }}
            >
              <span style={{ fontSize: "0.925rem", fontWeight: isActive ? 700 : 500, color: isActive ? "#1d4ed8" : "#475569" }}>
                {t.label}
              </span>
              <span style={{ fontSize: "0.725rem", color: "#94a3b8" }}>{t.desc}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "manage" && (
        <ManageRightsView
          token={token}
          orgId={orgId}
          initialResourceType={resourceTypeParam ? (resourceTypeParam as any) : "all"}
          initialResourceId={resourceIdParam}
          initialUserId={userIdParam}
          onNavigateToAssign={() => setTab("assign")}
          dataVersion={dataVersion}
          onMutationSuccess={triggerRefresh}
        />
      )}

      {activeTab === "assign" && (
        <AssignRightsWizard
          token={token}
          orgId={orgId}
          initialResourceType={resourceTypeParam}
          initialResourceId={resourceIdParam}
          onAssignmentComplete={() => {
            triggerRefresh();
            setTab("manage");
          }}
        />
      )}

      {activeTab === "user" && (
        <UserCentricView
          token={token}
          orgId={orgId}
          initialUserId={userIdParam}
          dataVersion={dataVersion}
          onMutationSuccess={triggerRefresh}
        />
      )}

      {activeTab === "resource" && (
        <ResourceCentricView
          token={token}
          orgId={orgId}
          initialResourceType={resourceTypeParam}
          initialResourceId={resourceIdParam}
          onNavigateToAssign={handleNavigateToAssignWithResource}
          dataVersion={dataVersion}
          onMutationSuccess={triggerRefresh}
        />
      )}

      {activeTab === "audit" && (
        <AuditHistoryView
          token={token}
          orgId={orgId}
        />
      )}
    </div>
  );
}

export default function RightsManagementPage() {
  return (
    <Suspense fallback={<WidgetSpinnerLoader size="large" text="Loading rights management..." minHeight={400} />}>
      <RightsManagementContent />
    </Suspense>
  );
}
