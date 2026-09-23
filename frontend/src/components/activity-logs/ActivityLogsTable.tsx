"use client";

import React, { useState } from "react";
import { ActivityLogItem, ActivityLogListResponse } from "./types";
import { ActivityDetailModal } from "./ActivityDetailModal";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "./Icons";

interface ActivityLogsTableProps {
  data: ActivityLogListResponse | null;
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newSize: number) => void;
  onUserSelect?: (userId: number, userName?: string) => void;
}

export const ActivityLogsTable: React.FC<ActivityLogsTableProps> = ({
  data,
  loading,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onUserSelect,
}) => {
  const [selectedItem, setSelectedItem] = useState<ActivityLogItem | null>(null);

  const getActionBadge = (action: string) => {
    switch (action) {
      case "VIEW":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            View
          </span>
        );
      case "DRILL_DOWN":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            Drill Down
          </span>
        );
      case "DOWNLOAD_PDF":
      case "DRILLDOWN_DOWNLOAD_PDF":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
            PDF Export
          </span>
        );
      case "DOWNLOAD_EXCEL":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Excel Export
          </span>
        );
      case "DOWNLOAD_CSV":
      case "DOWNLOAD_WORD":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
            {action.replace("DOWNLOAD_", "")}
          </span>
        );
      case "DATA_SAVED":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            Data Saved
          </span>
        );
      case "DATA_SUBMITTED":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            Submitted
          </span>
        );
      case "DATA_DELETED":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
            Deleted
          </span>
        );
      case "LOGIN":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Login
          </span>
        );
      case "LOGOUT":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
            Logout
          </span>
        );
      default:
        return (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
            {action}
          </span>
        );
    }
  };

  const parseDateSafely = (iso: string): Date => {
    if (!iso) return new Date();
    const normalized = (!iso.includes("+") && !iso.endsWith("Z") && !/-\d{2}:\d{2}$/.test(iso))
      ? `${iso}Z`
      : iso;
    return new Date(normalized);
  };

  const formatRelativeTime = (iso: string) => {
    try {
      const now = new Date();
      const past = parseDateSafely(iso);
      const diffSec = Math.floor((now.getTime() - past.getTime()) / 1000);

      if (diffSec < 45) return "just now";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDays = Math.floor(diffHr / 24);
      if (diffDays < 7) return `${diffDays}d ago`;

      return past.toLocaleDateString("en-PK", {
        timeZone: "Asia/Karachi",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = parseDateSafely(iso);
      return d.toLocaleTimeString("en-PK", {
        timeZone: "Asia/Karachi",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "";
    }
  };

  const formatFullDate = (iso: string) => {
    try {
      const d = parseDateSafely(iso);
      const datePart = d.toLocaleDateString("en-PK", {
        timeZone: "Asia/Karachi",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const timePart = d.toLocaleTimeString("en-PK", {
        timeZone: "Asia/Karachi",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      return `${datePart}, ${timePart}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* Table Container */}
      <div className="overflow-x-auto min-h-[350px]">
        <table className="activity-logs-table w-full text-left border-collapse text-xs table-fixed min-w-[860px]">
          <colgroup>
            <col style={{ width: "21%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 text-left">User</th>
              <th className="py-3 px-4 text-left">Module</th>
              <th className="py-3 px-4 text-left">Action</th>
              <th className="py-3 px-4 text-left">Resource / Details</th>
              <th className="py-3 px-4 text-left">Status</th>
              <th className="py-3 px-4 text-left">Time</th>
              <th className="py-3 px-4 text-center">Inspect</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-gray-700 dark:text-gray-200">
            {loading ? (
              // Loading Skeleton
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="py-3.5 px-4">
                    <div className="h-3.5 w-28 bg-gray-200 dark:bg-gray-700 rounded mb-1.5" />
                    <div className="h-2.5 w-36 bg-gray-100 dark:bg-gray-800 rounded" />
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="h-3.5 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-1" />
                    <div className="h-2.5 w-32 bg-gray-100 dark:bg-gray-800 rounded" />
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="h-4 w-14 bg-gray-200 dark:bg-gray-700 rounded" />
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="h-3.5 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-1" />
                    <div className="h-2.5 w-16 bg-gray-100 dark:bg-gray-800 rounded" />
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="h-7 w-7 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                  </td>
                </tr>
              ))
            ) : !data || data.items.length === 0 ? (
              // Empty State
              <tr>
                <td colSpan={7} className="py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="max-w-sm mx-auto flex flex-col items-center">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">No activity records found</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Try adjusting your date range, module, or search filters to find what you're looking for.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              // Table Rows
              data.items.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors group cursor-pointer"
                  onClick={() => setSelectedItem(item)}
                >
                  {/* User Column */}
                  <td className="py-3.5 px-4 align-middle text-left">
                    <div className="flex flex-col">
                      <span
                        className="font-semibold text-xs text-gray-900 dark:text-white truncate max-w-[180px]"
                        title={item.user_name || "Guest"}
                      >
                        {item.user_name || "Guest / Anonymous"}
                      </span>
                      <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500 truncate max-w-[180px]" title={item.user_email}>
                        {item.user_email || "no-email"}
                      </span>
                    </div>
                  </td>

                  {/* Module Column */}
                  <td className="py-3.5 px-4 align-middle text-left font-medium capitalize text-gray-700 dark:text-gray-300">
                    {item.module}
                  </td>

                  {/* Action Badge */}
                  <td className="py-3.5 px-4 align-middle text-left">
                    {getActionBadge(item.action_type)}
                  </td>

                  {/* Resource / Details */}
                  <td className="py-3.5 px-4 align-middle text-left">
                    <div className="flex flex-col max-w-md">
                      <span className="font-semibold text-gray-900 dark:text-white truncate text-xs">
                        {item.resource_name || item.action_details || item.details || "—"}
                      </span>
                      {(item.reporting_period || item.period) && (
                        <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">
                          Period: {item.reporting_period || item.period}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status Column */}
                  <td className="py-3.5 px-4 align-middle text-left">
                    {item.status === "SUCCESS" ? (
                      <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Success
                      </span>
                    ) : item.status === "WARNING" ? (
                      <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        Warning
                      </span>
                    ) : (
                      <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                        Failed
                      </span>
                    )}
                  </td>

                  {/* Timestamp Column */}
                  <td className="py-3.5 px-4 align-middle text-left whitespace-nowrap">
                    <div className="flex flex-col text-left cursor-help" title={formatFullDate(item.created_at)}>
                      <span className="text-xs text-gray-800 dark:text-gray-200 font-medium">
                        {formatRelativeTime(item.created_at)}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">
                        {formatTime(item.created_at)}
                      </span>
                    </div>
                  </td>

                  {/* Inspect Button: MLI Table Eye Icon Button */}
                  <td className="py-3.5 px-4 align-middle text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedItem(item);
                      }}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all cursor-pointer shadow-2xs"
                      title="View activity details"
                      aria-label="View activity details"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {data && data.total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 gap-3 text-xs">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <span>
              Showing <span className="font-semibold text-gray-900 dark:text-white">{(page - 1) * pageSize + 1}</span> to{" "}
              <span className="font-semibold text-gray-900 dark:text-white">
                {Math.min(page * pageSize, data.total)}
              </span>{" "}
              of <span className="font-semibold text-gray-900 dark:text-white">{data.total}</span> records
            </span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <div className="flex items-center gap-1">
              <span>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="py-1 px-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs font-medium focus:outline-none"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          {/* Page Controls with Next & Previous Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              className="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 text-xs font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
            >
              Previous
            </button>

            <span className="px-2 py-1 font-medium text-gray-700 dark:text-gray-300 text-xs">
              Page <strong className="text-gray-900 dark:text-white">{page}</strong> of <strong className="text-gray-900 dark:text-white">{data.total_pages || 1}</strong>
            </span>

            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= data.total_pages || loading}
              className="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 text-xs font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Forensic Inspection Modal */}
      <ActivityDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
};
