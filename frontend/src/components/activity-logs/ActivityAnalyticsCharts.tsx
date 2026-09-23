"use client";

import React, { useState, useMemo } from "react";
import { ActivitySummaryResponse, DailyTrendPoint } from "./types";
import {
  Activity,
  TrendingUp,
  Sparkles,
  ArrowRight,
} from "./Icons";

interface ActivityAnalyticsChartsProps {
  summary: ActivitySummaryResponse | null;
  loading: boolean;
  onUserSelect?: (userId: number, userName?: string) => void;
  onModuleSelect?: (module: string) => void;
  onDateSelect?: (date: string) => void;
  onSwitchTab?: (tab: "audit" | "users" | "analytics") => void;
}

// Generates smooth cubic Bezier curve path through points
function getSmoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const mx = (current[0] + next[0]) / 2;
    path += ` C ${mx},${current[1]} ${mx},${next[1]} ${next[0]},${next[1]}`;
  }
  return path;
}

function getSmoothArea(points: Array<[number, number]>, baseY: number): string {
  if (points.length < 2) return "";
  const linePart = getSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePart} L ${last[0]},${baseY} L ${first[0]},${baseY} Z`;
}

export const ActivityAnalyticsCharts: React.FC<ActivityAnalyticsChartsProps> = ({
  summary,
  loading,
  onUserSelect,
  onModuleSelect,
  onDateSelect,
  onSwitchTab,
}) => {
  // Interactive Controls
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(14);
  const [activeSeries, setActiveSeries] = useState<"all" | "actions" | "logins">("all");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Loading Skeleton
  if (loading && !summary) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-80 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" />
          <div className="h-80 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700" />
        </div>
      </div>
    );
  }

  if (!summary) return null;

  // 1. Process Trend Data according to selected time range
  const allTrends = summary.daily_trends || summary.daily_trend || [];
  const filteredTrends = useMemo(() => {
    if (allTrends.length <= rangeDays) return allTrends;
    return allTrends.slice(allTrends.length - rangeDays);
  }, [allTrends, rangeDays]);

  const trends = filteredTrends.map((t) => ({
    date: t.date,
    count: t.count ?? 0,
    logins: t.logins ?? 0,
    active_users: t.active_users ?? 0,
  }));

  const maxVal = Math.max(...trends.map((t) => Math.max(t.count, t.logins)), 8);
  const peakPoint = trends.reduce((max, curr) => (curr.count > max.count ? curr : max), trends[0] || { date: "", count: 0 });

  // 2. Metrics Breakdown
  const stats = summary.activity_stats;
  const userStats = summary.user_stats;
  const totalActs = summary.total_activities || stats?.total_activities || 0;

  const reportsTotal = (stats?.reports_viewed ?? 0) + (stats?.reports_downloaded ?? 0);
  const dashboardsTotal = (stats?.dashboards_viewed ?? 0) + (stats?.dashboard_drilldowns ?? 0) + (stats?.drilldown_downloads ?? 0);
  const kpiTotal = (stats?.kpi_data_saved ?? 0) + (stats?.kpi_data_submitted ?? 0) + (stats?.kpi_data_updated ?? 0);
  const activeEndUsers = userStats?.users_logged_in_week ?? summary.active_users_7d ?? 0;
  const totalEndUsers = userStats?.total_end_users ?? summary.total_users ?? 0;
  const adoptionRate = totalEndUsers > 0 ? Math.round((activeEndUsers / totalEndUsers) * 100) : 0;

  // 3. Modules Breakdown
  const moduleBreakdown = summary.module_breakdown || [];
  const totalModuleActions = moduleBreakdown.reduce((acc, m) => acc + (m.count || 0), 0) || 1;

  // Color palette for modules
  const getModuleTheme = (mod: string) => {
    const m = (mod || "").toUpperCase();
    if (m.includes("REPORT")) {
      return {
        color: "#6366f1",
        gradient: "linear-gradient(90deg, #6366f1 0%, #818cf8 100%)",
        text: "text-indigo-600 dark:text-indigo-400",
      };
    }
    if (m.includes("DRILL")) {
      return {
        color: "#0284c7",
        gradient: "linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)",
        text: "text-sky-600 dark:text-sky-400",
      };
    }
    if (m.includes("KPI") || m.includes("DATA")) {
      return {
        color: "#059669",
        gradient: "linear-gradient(90deg, #059669 0%, #34d399 100%)",
        text: "text-emerald-600 dark:text-emerald-400",
      };
    }
    if (m.includes("AUTH")) {
      return {
        color: "#d97706",
        gradient: "linear-gradient(90deg, #d97706 0%, #fbbf24 100%)",
        text: "text-amber-600 dark:text-amber-400",
      };
    }
    return {
      color: "#2563eb",
      gradient: "linear-gradient(90deg, #2563eb 0%, #60a5fa 100%)",
      text: "text-blue-600 dark:text-blue-400",
    };
  };

  // 4. Top Active Users Leaderboard (aggregated strictly by user_id)
  const rawTopUsers = summary.top_users || summary.top_active_users || [];
  const topUsersMap = new Map<number, { user_id: number; name: string; unique_key: string | null; count: number }>();
  for (const u of rawTopUsers) {
    const uid = u.user_id;
    if (uid == null) continue;
    const count = u.count ?? u.activity_count ?? 0;
    const existing = topUsersMap.get(uid);
    if (existing) {
      existing.count += count;
      const newName = u.name || u.user_name;
      if (newName) existing.name = newName;
      if (u.unique_user_key) existing.unique_key = u.unique_user_key;
    } else {
      topUsersMap.set(uid, {
        user_id: uid,
        name: u.name || u.user_name || "User",
        unique_key: u.unique_user_key || null,
        count,
      });
    }
  }
  const topUsers = Array.from(topUsersMap.values()).sort((a, b) => b.count - a.count).slice(0, 5);

  // 5. SVG Chart Geometry
  const chartHeight = 220;
  const chartWidth = 650;
  const paddingX = 45;
  const paddingTop = 25;
  const paddingBottom = 25;
  const usableWidth = chartWidth - paddingX * 2;
  const usableHeight = chartHeight - paddingTop - paddingBottom;
  const baseY = chartHeight - paddingBottom;

  const getX = (idx: number) => {
    if (trends.length <= 1) return paddingX + usableWidth / 2;
    return paddingX + (idx / (trends.length - 1)) * usableWidth;
  };

  const getY = (val: number) => {
    return baseY - (val / maxVal) * usableHeight;
  };

  // Smart date label spacing: ensures ample distance and zero collision/overlapping
  const visibleLabelIndices = useMemo(() => {
    const total = trends.length;
    if (total <= 7) {
      return new Set(Array.from({ length: total }, (_, i) => i));
    }
    const targetCount = rangeDays === 30 ? 6 : 5;
    const interval = (total - 1) / (targetCount - 1);
    const indices = new Set<number>();
    for (let i = 0; i < targetCount; i++) {
      indices.add(Math.round(i * interval));
    }
    return indices;
  }, [trends.length, rangeDays]);

  const actionPoints: Array<[number, number]> = trends.map((t, idx) => [getX(idx), getY(t.count)]);
  const loginPoints: Array<[number, number]> = trends.map((t, idx) => [getX(idx), getY(t.logins)]);

  const actionPath = getSmoothPath(actionPoints);
  const actionArea = getSmoothArea(actionPoints, baseY);
  const loginPath = getSmoothPath(loginPoints);

  // Format date helper for tooltip
  const formatFriendlyDate = (dateStr: string) => {
    try {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  const activePoint = hoveredIdx !== null && trends[hoveredIdx] ? trends[hoveredIdx] : null;

  return (
    <div className="space-y-6">
      {/* ── 1. Executive Operations Matrix Cards (4 Interactive Stat Cards) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Reports & Exports */}
        <div
          onClick={() => onModuleSelect && onModuleSelect("REPORTS")}
          className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-xs hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-500 transition-all cursor-pointer"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Reports & Exports
          </p>
          <div className="mt-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              {reportsTotal.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Card 2: Dashboards & Drill-downs */}
        <div
          onClick={() => onModuleSelect && onModuleSelect("DRILLDOWN")}
          className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-xs hover:shadow-md hover:border-cyan-400 dark:hover:border-cyan-500 transition-all cursor-pointer"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Dashboards & Drill-Downs
          </p>
          <div className="mt-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              {dashboardsTotal.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Card 3: KPI Data Entry Operations */}
        <div
          onClick={() => onModuleSelect && onModuleSelect("KPIS")}
          className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-xs hover:shadow-md hover:border-emerald-400 dark:hover:border-emerald-500 transition-all cursor-pointer"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            KPI Data Entry & Updates
          </p>
          <div className="mt-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              {kpiTotal.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Card 4: Active End Users */}
        <div
          onClick={() => onSwitchTab && onSwitchTab("users")}
          className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-xs hover:shadow-md hover:border-amber-400 dark:hover:border-amber-500 transition-all cursor-pointer"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Active End Users (7 Days)
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              {activeEndUsers}
            </span>
            <span className="text-sm font-normal text-gray-400">
              / {totalEndUsers}
            </span>
          </div>
        </div>
      </div>

      {/* ── 2. Main Interactive Chart + Module Distribution ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Interactive Trajectory Chart (2 Columns) */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm flex flex-col justify-between">
          <div>
            {/* Chart Header & Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-700/60 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    Interaction & Login Trajectory
                  </h3>
                  {peakPoint.count > 0 && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      Peak: {peakPoint.count} on {formatFriendlyDate(peakPoint.date)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Hover over points for metrics. Click any date to jump to its detailed audit trail.
                </p>
              </div>

              {/* Time Range and Series Filter Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Range Pills */}
                <div className="inline-flex bg-gray-100 dark:bg-gray-700/60 p-0.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300">
                  <button
                    onClick={() => setRangeDays(7)}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      rangeDays === 7 ? "bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs" : "hover:text-gray-900"
                    }`}
                  >
                    7D
                  </button>
                  <button
                    onClick={() => setRangeDays(14)}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      rangeDays === 14 ? "bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs" : "hover:text-gray-900"
                    }`}
                  >
                    14D
                  </button>
                  <button
                    onClick={() => setRangeDays(30)}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      rangeDays === 30 ? "bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs" : "hover:text-gray-900"
                    }`}
                  >
                    30D
                  </button>
                </div>

                {/* Series Toggles */}
                <div className="inline-flex items-center gap-1.5 ml-1">
                  <button
                    onClick={() => setActiveSeries(activeSeries === "actions" ? "all" : "actions")}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer ${
                      activeSeries === "all" || activeSeries === "actions"
                        ? "bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                        : "opacity-40 border-transparent text-gray-400"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    Actions
                  </button>
                  <button
                    onClick={() => setActiveSeries(activeSeries === "logins" ? "all" : "logins")}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer ${
                      activeSeries === "all" || activeSeries === "logins"
                        ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                        : "opacity-40 border-transparent text-gray-400"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Logins
                  </button>
                </div>
              </div>
            </div>

            {/* SVG Canvas with Interactive Guide & Curve */}
            <div className="relative w-full overflow-hidden select-none py-2">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-56 overflow-visible cursor-crosshair"
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <defs>
                  {/* Glowing Area Fill Gradient */}
                  <linearGradient id="actionCurveGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.32" />
                    <stop offset="65%" stopColor="#6366f1" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                  {/* Filter for glowing cursor point */}
                  <filter id="pointGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#2563eb" floodOpacity="0.4" />
                  </filter>
                </defs>

                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                  const yPos = baseY - pct * usableHeight;
                  return (
                    <g key={i}>
                      <line
                        x1={paddingX}
                        y1={yPos}
                        x2={chartWidth - paddingX}
                        y2={yPos}
                        stroke="currentColor"
                        strokeDasharray={pct === 0 ? undefined : "3 3"}
                        className="text-gray-200 dark:text-gray-700/70"
                        strokeWidth={pct === 0 ? "1.5" : "1"}
                      />
                      <text
                        x={paddingX - 10}
                        y={yPos + 3.5}
                        textAnchor="end"
                        className="text-[10px] font-mono fill-gray-400 dark:fill-gray-500"
                      >
                        {Math.round(pct * maxVal)}
                      </text>
                    </g>
                  );
                })}

                {/* Shaded Area for Total Actions */}
                {(activeSeries === "all" || activeSeries === "actions") && actionArea && (
                  <path d={actionArea} fill="url(#actionCurveGradient)" />
                )}

                {/* Smooth Curve: Total Actions */}
                {(activeSeries === "all" || activeSeries === "actions") && actionPath && (
                  <path
                    d={actionPath}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Smooth Curve: Logins */}
                {(activeSeries === "all" || activeSeries === "logins") && loginPath && (
                  <path
                    d={loginPath}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                    strokeDasharray="4 3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Vertical Cursor Guide on Hover */}
                {hoveredIdx !== null && (
                  <line
                    x1={getX(hoveredIdx)}
                    y1={paddingTop - 5}
                    x2={getX(hoveredIdx)}
                    y2={baseY}
                    stroke="#3b82f6"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                    className="opacity-75"
                  />
                )}

                {/* Data Points & Mouse Target Rectangles */}
                {trends.map((t, idx) => {
                  const cx = getX(idx);
                  const cyCount = getY(t.count);
                  const cyLogin = getY(t.logins);
                  const isHovered = hoveredIdx === idx;
                  const showLabel = visibleLabelIndices.has(idx);

                  return (
                    <g key={t.date}>
                      {/* Invisible wide mouse hit target */}
                      <rect
                        x={cx - (usableWidth / trends.length) / 2}
                        y={paddingTop}
                        width={usableWidth / trends.length}
                        height={usableHeight + paddingBottom}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onClick={() => onDateSelect && onDateSelect(t.date)}
                      />

                      {/* Action Point */}
                      {(activeSeries === "all" || activeSeries === "actions") && (
                        <circle
                          cx={cx}
                          cy={cyCount}
                          r={isHovered ? 5.5 : t.count > 0 ? 3.5 : 2}
                          fill={isHovered ? "#1d4ed8" : "#2563eb"}
                          stroke="#ffffff"
                          strokeWidth={isHovered ? 2.5 : 1.5}
                          filter={isHovered ? "url(#pointGlow)" : undefined}
                          className="transition-all pointer-events-none"
                        />
                      )}

                      {/* Login Point */}
                      {(activeSeries === "all" || activeSeries === "logins") && t.logins > 0 && (
                        <circle
                          cx={cx}
                          cy={cyLogin}
                          r={isHovered ? 4.5 : 2.5}
                          fill="#10b981"
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          className="transition-all pointer-events-none"
                        />
                      )}

                      {/* X-axis Date Labels: Clearly separated with zero overlap */}
                      {showLabel && (
                        <text
                          x={cx}
                          y={chartHeight - 6}
                          textAnchor="middle"
                          className={`text-[11px] font-semibold transition-colors ${
                            isHovered ? "fill-blue-600 font-bold" : "fill-gray-500 dark:fill-gray-400"
                          }`}
                        >
                          {t.date.slice(5)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Floating Interactive Tooltip */}
              {activePoint && hoveredIdx !== null && (
                <div
                  style={{
                    left: `${Math.min(Math.max(getX(hoveredIdx) - 105, 12), chartWidth - 255)}px`,
                    top: "8px",
                    backgroundColor: "#ffffff",
                    borderColor: "#e2e8f0",
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)",
                  }}
                  className="absolute pointer-events-none z-30 px-4 py-3.5 rounded-xl border w-60 shadow-lg animate-in fade-in duration-100"
                >
                  {/* Date, Day, Month: Bold Black Header */}
                  <div
                    style={{ borderBottomColor: "#f1f5f9" }}
                    className="border-b pb-2 mb-3"
                  >
                    <span style={{ color: "#0f172a" }} className="font-bold text-sm tracking-tight block">
                      {formatFriendlyDate(activePoint.date)}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {/* Total Actions */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-blue-600 font-semibold text-[13px]">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                        Total Actions:
                      </span>
                      <span style={{ color: "#0f172a" }} className="font-extrabold text-base">
                        {activePoint.count}
                      </span>
                    </div>

                    {/* User Logins */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-emerald-600 font-semibold text-[13px]">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0" />
                        User Logins:
                      </span>
                      <span style={{ color: "#0f172a" }} className="font-extrabold text-base">
                        {activePoint.logins}
                      </span>
                    </div>

                    {/* Active Users */}
                    {Boolean(activePoint.active_users) && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-purple-600 font-semibold text-[13px]">
                          <span className="w-2.5 h-2.5 rounded-full bg-purple-600 shrink-0" />
                          Active Users:
                        </span>
                        <span style={{ color: "#0f172a" }} className="font-extrabold text-base">
                          {activePoint.active_users}
                        </span>
                      </div>
                    )}

                    {activePoint.count > 0 && activePoint.logins === 0 && (
                      <div className="text-xs text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded-md border border-amber-200 mt-2 font-medium leading-normal">
                        Active via ongoing saved sessions
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Activity Bar Footer */}
          <div className="mt-2 pt-3 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 flex-wrap gap-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-600" />
              Blue area indicates overall workload operations
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Dashed line represents authentications
            </span>
          </div>
        </div>

        {/* Interactive Module Distribution (1 Column) */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-indigo-600" />
                Module Distribution
              </h3>
              <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 rounded-full">
                {totalModuleActions} events
              </span>
            </div>

            <div className="space-y-3.5">
              {moduleBreakdown.map((m) => {
                const count = m.count || 0;
                const pct = m.percentage ?? Math.round((count / totalModuleActions) * 100);
                const theme = getModuleTheme(m.module);

                return (
                  <div
                    key={m.module}
                    onClick={() => onModuleSelect && onModuleSelect(m.module)}
                    className="p-3 rounded-lg border border-gray-100 dark:border-gray-700/70 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50/70 dark:hover:bg-gray-750 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          style={{ backgroundColor: theme.color }}
                          className="w-2.5 h-2.5 rounded-full shadow-xs shrink-0"
                        />
                        <span className="capitalize text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {m.module}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-white">{count.toLocaleString()}</span>
                        <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                          ({pct}%)
                        </span>
                        <ArrowRight className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    {/* Progress Track & Line reflecting percentage */}
                    <div className="w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative shadow-inner">
                      <div
                        style={{
                          width: `${Math.min(Math.max(pct, 3), 100)}%`,
                          background: theme.gradient,
                        }}
                        className="h-full rounded-full transition-all duration-500 shadow-xs"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-end">
            <button
              type="button"
              onClick={() => onSwitchTab && onSwitchTab("audit")}
              className="audit-trail-link-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#2563eb",
                backgroundColor: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span>Full Audit Trail</span>
              <svg
                style={{ width: "13px", height: "13px" }}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── 3. Most Active Users ── */}
      {topUsers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              Most Active Users
            </h3>

            <button
              type="button"
              onClick={() => onSwitchTab && onSwitchTab("users")}
              className="view-all-users-action-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#475569",
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span>View all users</span>
              <svg
                style={{ width: "12px", height: "12px" }}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div
            className="most-active-users-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            {topUsers.map((u) => (
              <div
                key={u.user_id}
                onClick={() => onUserSelect && onUserSelect(u.user_id, u.name)}
                className="most-active-user-card rounded-xl border border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 transition-all cursor-pointer shadow-xs group"
                style={{
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "12px",
                  padding: "16px 20px",
                  minHeight: "74px",
                  backgroundColor: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.04)",
                  boxSizing: "border-box",
                }}
              >
                <p
                  className="most-active-user-name font-bold text-gray-900 group-hover:text-blue-600 transition-colors truncate"
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#0f172a",
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                  title={u.name}
                >
                  {u.name}
                </p>
                <p
                  className="most-active-user-actions font-medium text-gray-500"
                  style={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#64748b",
                    margin: "6px 0 0 0",
                    lineHeight: 1,
                  }}
                >
                  {u.count.toLocaleString()} {u.count === 1 ? "action" : "actions"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
