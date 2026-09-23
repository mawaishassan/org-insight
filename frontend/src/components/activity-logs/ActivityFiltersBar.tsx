import React, { useState, useEffect } from "react";
import { CustomDatePicker } from "@/components/CustomDatePicker";
import { ActivityFilterState } from "./types";

interface ActivityFiltersBarProps {
  filters: ActivityFilterState;
  selectedUserName?: string | null;
  onFilterChange: (updates: Partial<ActivityFilterState>) => void;
  onReset: () => void;
  onExport: (format: "csv" | "excel") => Promise<void>;
  exportingFormat: "csv" | "excel" | null;
}

export const ActivityFiltersBar: React.FC<ActivityFiltersBarProps> = ({
  filters,
  selectedUserName,
  onFilterChange,
  onReset,
  onExport,
  exportingFormat,
}) => {
  const [searchInput, setSearchInput] = useState(filters.search || "");

  // Sync internal search input if filters.search changes externally (e.g. onReset)
  useEffect(() => {
    setSearchInput(filters.search || "");
  }, [filters.search]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onFilterChange({ search: searchInput.trim(), page: 1 });
  };

  const toLocalDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const handleDatePreset = (preset: "today" | "7d" | "30d" | "all") => {
    const today = new Date();
    const todayStr = toLocalDateStr(today);

    if (preset === "today") {
      onFilterChange({ startDate: todayStr, endDate: todayStr, page: 1 });
    } else if (preset === "7d") {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      onFilterChange({ startDate: toLocalDateStr(past), endDate: todayStr, page: 1 });
    } else if (preset === "30d") {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      onFilterChange({ startDate: toLocalDateStr(past), endDate: todayStr, page: 1 });
    } else {
      onFilterChange({ startDate: "", endDate: "", page: 1 });
    }
  };

  const isTodayActive = Boolean(filters.startDate && filters.startDate === filters.endDate);
  const isAllActive = Boolean(!filters.startDate && !filters.endDate);

  const hasActiveFilters = Boolean(
    filters.search ||
    filters.module ||
    filters.actionType ||
    filters.status ||
    filters.startDate ||
    filters.endDate ||
    filters.userId
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 shadow-sm">
      {/* Top row: Search & Exports */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-700/60">
        <form onSubmit={handleSearchSubmit} className="flex-1 relative min-w-[280px]">
          <input
            type="text"
            placeholder="Search by user name, unique key, resource, details, module..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full px-3.5 pr-24 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-900 transition-all"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-medium rounded-md transition-all shadow-sm cursor-pointer"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Export CSV */}
          <button
            onClick={() => onExport("csv")}
            disabled={exportingFormat !== null}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 active:scale-95 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            title="Download audit logs as CSV"
          >
            <span>{exportingFormat === "csv" ? "Exporting CSV..." : "Export CSV"}</span>
          </button>

          {/* Export Excel */}
          <button
            onClick={() => onExport("excel")}
            disabled={exportingFormat !== null}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 active:scale-95 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            title="Download audit logs as Excel"
          >
            <span>{exportingFormat === "excel" ? "Exporting Excel..." : "Export Excel"}</span>
          </button>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearchInput("");
                onReset();
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 active:scale-95 transition-all shadow-xs cursor-pointer"
              title="Reset all filters"
            >
              <span>Clear Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Active User Filter Badge */}
      {filters.userId && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 my-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200">
          <span className="font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            Active Filter: <strong className="text-blue-900 dark:text-blue-100">Showing logs only for {selectedUserName || `User #${filters.userId}`}</strong>
          </span>
          <button
            type="button"
            onClick={() => onFilterChange({ userId: null, page: 1 })}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-900 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded hover:bg-blue-200 transition-colors cursor-pointer"
          >
            ✕ Show All Users
          </button>
        </div>
      )}

      {/* Bottom row: Filter selectors */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3">
        {/* Module Filter */}
        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
            Module
          </label>
          <select
            value={filters.module}
            onChange={(e) => onFilterChange({ module: e.target.value, page: 1 })}
            className="w-full py-1.5 px-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">All Modules</option>
            <option value="REPORTS">Reports</option>
            <option value="DRILLDOWN">Drill-Downs</option>
            <option value="KPIS">Data Entry / KPIs</option>
            <option value="AUTH">Authentication</option>
            <option value="DASHBOARDS">Dashboards</option>
          </select>
        </div>

        {/* Action Type Filter */}
        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
            Action Type
          </label>
          <select
            value={filters.actionType}
            onChange={(e) => onFilterChange({ actionType: e.target.value, page: 1 })}
            className="w-full py-1.5 px-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">All Actions</option>
            <option value="DRILL_DOWN">Drill Down</option>
            <option value="DOWNLOAD_PDF">Download PDF</option>
            <option value="DATA_SAVED">Data Saved</option>
            <option value="DATA_SUBMITTED">Data Submitted</option>
            <option value="DATA_DELETED">Data Deleted</option>
            <option value="LOGIN">Login</option>
            <option value="VIEW">View</option>
            <option value="LOGOUT">Logout</option>
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
            Status
          </label>
          <select
            value={filters.status}
            onChange={(e) => onFilterChange({ status: e.target.value, page: 1 })}
            className="w-full py-1.5 px-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="WARNING">Warning</option>
          </select>
        </div>

        {/* Start Date */}
        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
            From Date
          </label>
          <CustomDatePicker
            id="activity_start_date"
            value={filters.startDate || ""}
            onChange={(val) => onFilterChange({ startDate: val || "", page: 1 })}
          />
        </div>

        {/* End Date */}
        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
            To Date
          </label>
          <CustomDatePicker
            id="activity_end_date"
            value={filters.endDate || ""}
            onChange={(val) => onFilterChange({ endDate: val || "", page: 1 })}
          />
        </div>

        {/* Quick Date Presets */}
        <div className="flex flex-col justify-end">
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
            Presets
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleDatePreset("today")}
              className={`px-2 py-1 text-[11px] rounded border font-medium active:scale-95 transition-all cursor-pointer ${
                isTodayActive
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100"
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset("7d")}
              className="px-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 font-medium active:scale-95 transition-all cursor-pointer"
            >
              7D
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset("30d")}
              className="px-2 py-1 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 font-medium active:scale-95 transition-all cursor-pointer"
            >
              30D
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset("all")}
              className={`px-2 py-1 text-[11px] rounded border font-medium active:scale-95 transition-all cursor-pointer ${
                isAllActive
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100"
              }`}
            >
              All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
