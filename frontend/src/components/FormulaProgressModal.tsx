"use client";

import React, { useEffect, useState } from "react";
import { getApiUrl } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

interface FormulaProgressModalProps {
  taskId: string | null;
  isOpen: boolean;
  onComplete?: () => void;
  onClose?: () => void;
}

interface ProgressData {
  task_id: string;
  status: "processing" | "completed" | "failed";
  progress_percent: number;
  processed_rows: number;
  total_rows: number;
  message: string;
}

export default function FormulaProgressModal({
  taskId,
  isOpen,
  onComplete,
  onClose,
}: FormulaProgressModalProps) {
  const [progress, setProgress] = useState<ProgressData>({
    task_id: taskId || "",
    status: "processing",
    progress_percent: 0,
    processed_rows: 0,
    total_rows: 0,
    message: "Initializing formula evaluation...",
  });

  const onCompleteRef = React.useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const hasTriggeredComplete = React.useRef(false);

  useEffect(() => {
    if (!isOpen || !taskId) {
      hasTriggeredComplete.current = false;
      return;
    }

    let isMounted = true;
    const pollInterval = setInterval(async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(getApiUrl(`/kpis/formula-progress/${taskId}`), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as ProgressData;
        if (!isMounted) return;

        setProgress(data);

        if (data.status === "completed" || data.progress_percent >= 100) {
          clearInterval(pollInterval);
          if (!hasTriggeredComplete.current) {
            hasTriggeredComplete.current = true;
            setTimeout(() => {
              if (onCompleteRef.current) onCompleteRef.current();
            }, 600);
          }
        } else if (data.status === "failed") {
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error("Failed to poll formula progress:", err);
      }
    }, 400);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [isOpen, taskId]);

  if (!isOpen) return null;

  const pct = Math.min(100, Math.max(0, Math.round(progress.progress_percent || 0)));

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: "16px",
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          padding: "28px 32px",
          width: "100%",
          maxWidth: "460px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "rgba(37, 99, 235, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#2563eb",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 600, color: "#0f172a" }}>
              Recalculating Formulas
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#64748b" }}>
              Evaluating formula fields across table rows...
            </p>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px", fontWeight: 500 }}>
            <span style={{ color: "#475569" }}>{progress.message || "Processing..."}</span>
            <span style={{ color: "#2563eb", fontWeight: 600 }}>{pct}%</span>
          </div>
          <div
            style={{
              height: "10px",
              backgroundColor: "#f1f5f9",
              borderRadius: "999px",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                backgroundColor: pct >= 100 ? "#16a34a" : "#2563eb",
                borderRadius: "999px",
                transition: "width 0.3s ease-in-out",
              }}
            />
          </div>
        </div>

        {/* Rows Counter & Status */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "8px",
            borderTop: "1px solid #f1f5f9",
            fontSize: "12px",
            color: "#64748b",
          }}
        >
          <span>
            {progress.total_rows > 0
              ? `Processed ${progress.processed_rows} of ${progress.total_rows} rows`
              : "Optimizing indexing..."}
          </span>
          {pct >= 100 && (
            <button
              onClick={onClose}
              style={{
                backgroundColor: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
