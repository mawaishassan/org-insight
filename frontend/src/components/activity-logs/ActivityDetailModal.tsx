"use client";

import React from "react";
import { createPortal } from "react-dom";
import { ActivityLogItem } from "./types";

interface ActivityDetailModalProps {
  item: ActivityLogItem | null;
  onClose: () => void;
}

export const ActivityDetailModal: React.FC<ActivityDetailModalProps> = ({ item, onClose }) => {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!item) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [item, onClose]);

  if (!item || !mounted) return null;

  const formatDate = (iso: string) => {
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
        second: "2-digit",
        hour12: true,
      });
      return `${datePart} at ${timePart}`;
    } catch {
      return iso;
    }
  };

  const formatResourceType = (type?: string | null) => {
    if (!type) return "—";
    return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const extractReportingPeriod = (it: ActivityLogItem): string => {
    if (it.reporting_period && it.reporting_period.trim()) return it.reporting_period.trim();
    if (it.period && it.period.trim()) return it.period.trim();
    const metaPeriod = (it.metadata?.period as string) || (it.meta_data?.period as string);
    if (metaPeriod && metaPeriod.trim()) return metaPeriod.trim();
    // Fallback regex matching period patterns like (2025/26) or (2025) or (Fiscal Year 2026) in details
    const text = it.action_details || it.details || "";
    const match = text.match(/\((20\d\d(?:\/\d\d)?|[A-Za-z]+ \d{4}(?:\/\d\d)?)\)/);
    if (match) return match[1];
    return "—";
  };

  const statusBadge = (status: string) => {
    if (status === "SUCCESS") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
          Success
        </span>
      );
    }
    if (status === "WARNING") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
          Warning
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
        Failed
      </span>
    );
  };

  return createPortal(
    <div 
      className="activity-modal-overlay"
      onClick={onClose}
    >
      <div 
        className="activity-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="activity-modal-header">
          <div>
            <h3 id="activity-detail-title" className="activity-modal-title">
              Activity Details
            </h3>
            <p className="activity-modal-subtitle">
              Log Reference #{item.id}
            </p>
          </div>
          <div className="flex items-center">
            {statusBadge(item.status)}
          </div>
        </div>

        {/* Modal Body */}
        <div className="activity-modal-body">
          {/* Action Overview Box */}
          <div className="activity-modal-action-box">
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-600 text-white shadow-xs">
                {item.action_type}
              </span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Module: <span className="text-blue-700 dark:text-blue-400 font-bold">{item.module}</span>
              </span>
            </div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">
              {item.action_details || item.details || `${item.action_type} on ${item.resource_name || item.module}`}
            </p>
          </div>

          {/* User Details */}
          <div>
            <div className="activity-modal-section-title">
              User Information
            </div>
            <div className="activity-modal-grid">
              <div>
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">User Name</span>
                <p className="font-semibold text-xs text-gray-900 dark:text-white truncate" title={item.user_name}>
                  {item.user_name || "System"}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Email</span>
                <p className="text-xs text-gray-800 dark:text-gray-200 truncate" title={item.user_email}>
                  {item.user_email || "N/A"}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Role</span>
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                  {item.user_role || "—"}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Unique Key</span>
                <p className="text-xs font-semibold text-gray-900 dark:text-white truncate" title={item.unique_user_key || item.unique_key || undefined}>
                  {item.unique_user_key || item.unique_key || item.user_department || "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Resource & Scope */}
          <div>
            <div className="activity-modal-section-title">
              Resource & Scope
            </div>
            <div className="activity-modal-grid">
              <div className="col-span-full">
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Resource Name</span>
                <p className="font-semibold text-xs text-gray-900 dark:text-white" title={item.resource_name || undefined}>
                  {item.resource_name || "—"}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Resource Type</span>
                <p className="text-xs text-gray-800 dark:text-gray-200">
                  {formatResourceType(item.resource_type)}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Reporting Period</span>
                <p className="text-xs font-semibold text-gray-900 dark:text-white">
                  {extractReportingPeriod(item)}
                </p>
              </div>
              <div className="col-span-full">
                <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Recorded At</span>
                <p className="text-xs text-gray-800 dark:text-gray-200">{formatDate(item.created_at)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="activity-modal-footer modal-footer-responsive">
          <button
            type="button"
            onClick={onClose}
            className="modal-btn-cancel"
            style={{
              fontSize: "0.85rem",
              padding: "0.5rem 1.4rem",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
