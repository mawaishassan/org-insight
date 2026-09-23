"use client";

import React from "react";
import { ActivitySummaryResponse } from "./types";

interface ActivitySummaryCardsProps {
  summary: ActivitySummaryResponse | null;
  loading: boolean;
  onNavigate?: (target: "all" | "logins_today" | "users" | "actions_today") => void;
}

export const ActivitySummaryCards: React.FC<ActivitySummaryCardsProps> = ({ summary, loading, onNavigate }) => {
  const totalActivities = summary?.activity_stats?.total_activities ?? summary?.total_activities ?? 0;
  const loginsToday = summary?.user_stats?.users_logged_in_today ?? summary?.logins_today ?? 0;
  const activeUsers7d = summary?.user_stats?.users_logged_in_week ?? summary?.active_users_7d ?? 0;
  const totalUsers = summary?.user_stats?.total_end_users ?? summary?.total_users ?? 0;
  const activitiesToday = summary?.activities_today ?? summary?.activity_stats?.kpi_data_saved ?? 0;

  const cards: Array<{
    title: string;
    value: string;
    subtext: string;
    topBar: string;
    bgLight: string;
    border: string;
    target: "all" | "logins_today" | "users" | "actions_today";
  }> = [
    {
      title: "TOTAL ACTIONS RECORDED",
      value: summary ? totalActivities.toLocaleString() : "—",
      subtext: summary ? `${activitiesToday.toLocaleString()} recorded today` : "Loading...",
      topBar: "bg-blue-600",
      bgLight: "bg-blue-50/50",
      border: "border-blue-200/60",
      target: "all",
    },
    {
      title: "LOGINS TODAY",
      value: summary ? loginsToday.toLocaleString() : "—",
      subtext: "Successful logins today",
      topBar: "bg-emerald-600",
      bgLight: "bg-emerald-50/50",
      border: "border-emerald-200/60",
      target: "logins_today",
    },
    {
      title: "ACTIVE USERS (7 DAYS)",
      value: summary ? activeUsers7d.toLocaleString() : "—",
      subtext: summary ? `Out of ${totalUsers.toLocaleString()} total users` : "Loading...",
      topBar: "bg-purple-600",
      bgLight: "bg-purple-50/50",
      border: "border-purple-200/60",
      target: "users",
    },
    {
      title: "ACTIONS TODAY",
      value: summary ? activitiesToday.toLocaleString() : "—",
      subtext: "Operations performed today",
      topBar: "bg-amber-600",
      bgLight: "bg-amber-50/50",
      border: "border-amber-200/60",
      target: "actions_today",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, idx) => {
        return (
          <div
            key={idx}
            onClick={() => onNavigate && onNavigate(card.target)}
            className={`relative overflow-hidden rounded-xl border p-5 transition-all duration-200 hover:shadow-md cursor-pointer group active:scale-[0.99] ${card.bgLight} ${card.border}`}
          >
            {/* Top Accent Line */}
            <div className={`absolute top-0 left-0 right-0 h-1 ${card.topBar}`} />

            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                {card.title}
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              {loading && !summary ? (
                <div className="h-8 w-20 bg-gray-200 animate-pulse rounded"></div>
              ) : (
                <div className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
                  {card.value}
                </div>
              )}
            </div>

            <div className="mt-2 text-xs text-gray-500">
              {card.subtext}
            </div>
          </div>
        );
      })}
    </div>
  );
};
