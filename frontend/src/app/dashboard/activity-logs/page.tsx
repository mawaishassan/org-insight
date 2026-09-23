"use client";

import React, { useState, useEffect, useCallback } from "react";
import { api, getApiUrl } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import {
  ActivityLogListResponse,
  UserOverviewListResponse,
  ActivitySummaryResponse,
  ActivityFilterState,
} from "@/components/activity-logs/types";
import { ActivitySummaryCards } from "@/components/activity-logs/ActivitySummaryCards";
import { ActivityFiltersBar } from "@/components/activity-logs/ActivityFiltersBar";
import { ActivityLogsTable } from "@/components/activity-logs/ActivityLogsTable";
import { UserSessionsTable } from "@/components/activity-logs/UserSessionsTable";
import { ActivityAnalyticsCharts } from "@/components/activity-logs/ActivityAnalyticsCharts";
import { AlertCircle } from "@/components/activity-logs/Icons";
import "@/components/activity-logs/activity-logs.css";


export default function ActivityLogsPage() {
  const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Tab State: "audit" | "users" | "analytics"
  const [activeTab, setActiveTab] = useState<"audit" | "users" | "analytics">("audit");

  // Fetch current user
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api<{ role: string }>("/auth/me", { token })
      .then((u) => setCurrentUser(u))
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  // Summary State
  const [summary, setSummary] = useState<ActivitySummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Audit Logs State
  const [logsData, setLogsData] = useState<ActivityLogListResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [filters, setFilters] = useState<ActivityFilterState>({
    search: "",
    userId: null,
    module: "",
    actionType: "",
    status: "",
    startDate: "",
    endDate: "",
    page: 1,
    pageSize: 25,
  });
  const [selectedUserName, setSelectedUserName] = useState<string | null>(null);

  // User Sessions State
  const [usersData, setUsersData] = useState<UserOverviewListResponse | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userPage, setUserPage] = useState(1);
  const [userSearch, setUserSearch] = useState("");

  // Export State
  const [exportingFormat, setExportingFormat] = useState<"csv" | "excel" | null>(null);

  // Authorization Check
  const isOrgAdminOrSuper = currentUser?.role === "ORG_ADMIN" || currentUser?.role === "SUPER_ADMIN";

  // Fetch Summary
  const fetchSummary = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      setSummaryLoading(true);
      const res = await api<ActivitySummaryResponse>("/activity-logs/summary", { token });
      setSummary(res);
    } catch (err) {
      console.error("Failed to load activity summary:", err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Fetch Activity Logs
  const fetchLogs = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      setLogsLoading(true);
      const params = new URLSearchParams();
      params.set("page", String(filters.page));
      params.set("page_size", String(filters.pageSize));
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.userId) params.set("user_id", String(filters.userId));
      if (filters.module) params.set("module", filters.module);
      if (filters.actionType) params.set("action_type", filters.actionType);
      if (filters.status) params.set("status", filters.status);
      if (filters.startDate) params.set("start_date", filters.startDate);
      if (filters.endDate) params.set("end_date", filters.endDate);

      const res = await api<ActivityLogListResponse>(`/activity-logs?${params.toString()}`, { token });
      setLogsData(res);
    } catch (err) {
      console.error("Failed to load activity logs:", err);
      setLogsData({
        items: [],
        total: 0,
        page: filters.page,
        page_size: filters.pageSize,
        total_pages: 1,
      });
    } finally {
      setLogsLoading(false);
    }
  }, [filters]);

  // Fetch Users Overview
  const fetchUsersOverview = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      setUsersLoading(true);
      const params = new URLSearchParams();
      params.set("page", String(userPage));
      params.set("page_size", "20");
      if (userSearch.trim()) params.set("search", userSearch.trim());

      const res = await api<UserOverviewListResponse>(`/activity-logs/users-overview?${params.toString()}`, { token });
      setUsersData(res);
    } catch (err) {
      console.error("Failed to load users overview:", err);
    } finally {
      setUsersLoading(false);
    }
  }, [userPage, userSearch]);


  // Initial Load
  useEffect(() => {
    if (isOrgAdminOrSuper) {
      fetchSummary();
    }
  }, [isOrgAdminOrSuper, fetchSummary]);

  useEffect(() => {
    if (isOrgAdminOrSuper && activeTab === "audit") {
      fetchLogs();
    }
  }, [isOrgAdminOrSuper, activeTab, fetchLogs]);

  useEffect(() => {
    if (isOrgAdminOrSuper && activeTab === "users") {
      fetchUsersOverview();
    }
  }, [isOrgAdminOrSuper, activeTab, fetchUsersOverview]);

  // Export Action
  const handleExport = async (format: "csv" | "excel") => {
    try {
      setExportingFormat(format);
      const params = new URLSearchParams();
      params.set("format", format);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.userId) params.set("user_id", String(filters.userId));
      if (filters.module) params.set("module", filters.module);
      if (filters.actionType) params.set("action_type", filters.actionType);
      if (filters.startDate) params.set("start_date", filters.startDate);
      if (filters.endDate) params.set("end_date", filters.endDate);

      const token = getAccessToken();
      const exportUrl = getApiUrl(`activity-logs/export?${params.toString()}`);

      const response = await fetch(exportUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Export request failed");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.${format === "csv" ? "csv" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export activity logs. Please try again.");
    } finally {
      setExportingFormat(null);
    }
  };

  const handleFilterUpdate = (updates: Partial<ActivityFilterState>) => {
    if (updates.userId === null) {
      setSelectedUserName(null);
    }
    setFilters((prev) => ({ ...prev, ...updates }));
  };

  const handleResetFilters = () => {
    setSelectedUserName(null);
    setFilters({
      search: "",
      userId: null,
      module: "",
      actionType: "",
      status: "",
      startDate: "",
      endDate: "",
      page: 1,
      pageSize: 25,
    });
  };

  const handleViewUserAudit = (userId: number, userName: string) => {
    setActiveTab("audit");
    setSelectedUserName(userName || `User #${userId}`);
    setFilters({
      search: "",
      userId,
      module: "",
      actionType: "",
      status: "",
      startDate: "",
      endDate: "",
      page: 1,
      pageSize: 25,
    });
  };

  const handleViewModuleAudit = (module: string) => {
    setActiveTab("audit");
    setSelectedUserName(null);
    setFilters({
      search: "",
      userId: null,
      module,
      actionType: "",
      status: "",
      startDate: "",
      endDate: "",
      page: 1,
      pageSize: 25,
    });
  };

  const handleViewDateAudit = (date: string) => {
    setActiveTab("audit");
    setSelectedUserName(null);
    setFilters({
      search: "",
      userId: null,
      module: "",
      actionType: "",
      status: "",
      startDate: date,
      endDate: date,
      page: 1,
      pageSize: 25,
    });
  };

  const handleSummaryCardClick = (target: "all" | "logins_today" | "users" | "actions_today") => {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (target === "all") {
      setActiveTab("audit");
      handleResetFilters();
    } else if (target === "logins_today") {
      setActiveTab("audit");
      setSelectedUserName(null);
      setFilters({
        search: "",
        userId: null,
        module: "AUTH",
        actionType: "LOGIN",
        status: "",
        startDate: todayStr,
        endDate: todayStr,
        page: 1,
        pageSize: 25,
      });
    } else if (target === "users") {
      setActiveTab("users");
    } else if (target === "actions_today") {
      setActiveTab("audit");
      setSelectedUserName(null);
      setFilters({
        search: "",
        userId: null,
        module: "",
        actionType: "",
        status: "",
        startDate: todayStr,
        endDate: todayStr,
        page: 1,
        pageSize: 25,
      });
    }
  };

  if (!authChecked) {
    return (
      <div className="p-12 text-center text-sm text-gray-500">
        Loading activity monitor...
      </div>
    );
  }

  if (!isOrgAdminOrSuper) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center">
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-600" />
          <h2 className="text-base font-bold">Access Restricted</h2>
          <p className="text-sm mt-1">
            Activity monitoring and audit logs are accessible only to Organization Admins and Super Admins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-module p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            User Activity & Audit Logs
          </h1>
        </div>

        {/* Refresh button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchSummary();
              if (activeTab === "audit") fetchLogs();
              if (activeTab === "users") fetchUsersOverview();
            }}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 active:scale-95 transition-all shadow-xs cursor-pointer"
          >
            {logsLoading || summaryLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Top Metric Cards */}
      <ActivitySummaryCards summary={summary} loading={summaryLoading} onNavigate={handleSummaryCardClick} />

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("audit")}
            className={`pb-3 px-1 text-sm font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === "audit"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span>Audit Trail & Activity Log</span>
            {logsData && (
              <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600 rounded-full">
                {logsData.total}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("users")}
            className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "users"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span>User Login Monitoring</span>
          </button>

          <button
            onClick={() => setActiveTab("analytics")}
            className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "analytics"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span>Activity Analytics & Trends</span>
          </button>
        </nav>
      </div>


      {/* Tab 1: Audit Trail */}
      {activeTab === "audit" && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <ActivityFiltersBar
            filters={filters}
            selectedUserName={selectedUserName}
            onFilterChange={handleFilterUpdate}
            onReset={handleResetFilters}
            onExport={handleExport}
            exportingFormat={exportingFormat}
          />

          <ActivityLogsTable
            data={logsData}
            loading={logsLoading}
            page={filters.page}
            pageSize={filters.pageSize}
            onPageChange={(newPage) => handleFilterUpdate({ page: newPage })}
            onPageSizeChange={(newSize) => handleFilterUpdate({ pageSize: newSize, page: 1 })}
            onUserSelect={(uId, name) => {
              setSelectedUserName(name || null);
              handleFilterUpdate({ userId: uId, page: 1 });
            }}
          />
        </div>
      )}

      {/* Tab 2: User Login Monitoring */}
      {activeTab === "users" && (
        <div className="animate-in fade-in duration-200">
          <UserSessionsTable
            data={usersData}
            loading={usersLoading}
            page={userPage}
            onPageChange={setUserPage}
            onSearch={(term) => {
              setUserSearch(term);
              setUserPage(1);
            }}
            onViewUserLogs={handleViewUserAudit}
          />
        </div>
      )}

      {/* Tab 3: Analytics & Trends */}
      {activeTab === "analytics" && (
        <div className="animate-in fade-in duration-200">
          <ActivityAnalyticsCharts
            summary={summary}
            loading={summaryLoading}
            onUserSelect={(uId, name) => handleViewUserAudit(uId, name || "User")}
            onModuleSelect={handleViewModuleAudit}
            onDateSelect={handleViewDateAudit}
            onSwitchTab={(tab) => setActiveTab(tab)}
          />
        </div>
      )}
    </div>
  );
}
