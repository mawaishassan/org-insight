"use client";

import React, { useState } from "react";
import { UserOverviewItem, UserOverviewListResponse } from "./types";
import { 
  ChevronLeft, 
  ChevronRight,
  Search,
} from "./Icons";

interface UserSessionsTableProps {
  data: UserOverviewListResponse | null;
  loading: boolean;
  page: number;
  onPageChange: (newPage: number) => void;
  onSearch: (term: string) => void;
  onViewUserLogs: (userId: number, userName: string) => void;
}

export const UserSessionsTable: React.FC<UserSessionsTableProps> = ({
  data,
  loading,
  page,
  onPageChange,
  onSearch,
  onViewUserLogs,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchTerm);
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    try {
      const normalized = (!iso.includes("+") && !iso.endsWith("Z") && !/-\d{2}:\d{2}$/.test(iso))
        ? `${iso}Z`
        : iso;
      const d = new Date(normalized);
      const datePart = d.toLocaleDateString("en-PK", {
        timeZone: "Asia/Karachi",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const timePart = d.toLocaleTimeString("en-PK", {
        timeZone: "Asia/Karachi",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      return `${datePart} at ${timePart}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* Search Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            User Login & Session Overview
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Track user login frequency, last session timestamps, and total interactions.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search user name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-semibold rounded-lg transition-all shadow-xs shrink-0 cursor-pointer"
          >
            Filter
          </button>
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm("");
                onSearch("");
              }}
              className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-all cursor-pointer shrink-0"
              title="Clear search"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="overflow-x-auto min-h-[300px]">
        <table className="activity-logs-table w-full text-left border-collapse text-xs table-fixed min-w-[860px]">
          <colgroup>
            <col style={{ width: "24%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-50/80 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4 text-left">User</th>
              <th className="py-3 px-4 text-left">User Name</th>
              <th className="py-3 px-4 text-left">Role</th>
              <th className="py-3 px-4 text-left">Last Login</th>
              <th className="py-3 px-4 text-center">Total Logins</th>
              <th className="py-3 px-4 text-left">Last Activity</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60 text-gray-700 dark:text-gray-200">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="py-3 px-4">
                    <div className="h-3.5 w-28 bg-gray-200 dark:bg-gray-700 rounded mb-1" />
                    <div className="h-2.5 w-36 bg-gray-100 dark:bg-gray-800 rounded" />
                  </td>
                  <td className="py-3 px-4">
                    <div className="h-3 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                  </td>
                  <td className="py-3 px-3">
                    <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
                  </td>
                  <td className="py-3 px-4">
                    <div className="h-3 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                  </td>
                  <td className="py-3 px-3 text-center">
                    <div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                  </td>
                  <td className="py-3 px-4">
                    <div className="h-3 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
                  </td>
                </tr>
              ))
            ) : !data || data.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-gray-500 dark:text-gray-400">
                  No users found matching your search.
                </td>
              </tr>
            ) : (
              data.items.map((u) => (
                <tr
                  key={u.user_id}
                  className="hover:bg-gray-50/80 dark:hover:bg-gray-750 transition-colors"
                >
                  {/* User Account / Username */}
                  <td className="py-3 px-4">
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {u.username || u.name || `User #${u.user_id}`}
                    </div>
                    {u.email && (
                      <div className="font-mono text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[200px]">
                        {u.email}
                      </div>
                    )}
                  </td>

                  {/* User Name (Full Name / Display Name) */}
                  <td className="py-3 px-4">
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {u.full_name || u.name || u.unique_user_key || "—"}
                    </span>
                  </td>

                  {/* Role */}
                  <td className="py-3 px-4">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                      {u.role}
                    </span>
                  </td>

                  {/* Last Login */}
                  <td className="py-3 px-4">
                    <span className="text-gray-700 dark:text-gray-300">{formatDate(u.last_login_at)}</span>
                  </td>

                  {/* Total Logins */}
                  <td className="py-3 px-4 text-center">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                      {u.login_count}
                    </span>
                  </td>

                  {/* Last Activity */}
                  <td className="py-3 px-4">
                    <span className="text-gray-700 dark:text-gray-300">{formatDate(u.last_activity_at)}</span>
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => onViewUserLogs(u.user_id, u.full_name || u.name || u.username || "User")}
                      className="inline-block px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md transition-all active:scale-95 cursor-pointer"
                    >
                      View Trail
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            Page {page} of {data.total_pages} ({data.total} total users)
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= data.total_pages || loading}
              className="p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
