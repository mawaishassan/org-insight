"use client";

import React from "react";

interface WidgetSpinnerLoaderProps {
  size?: "small" | "medium" | "large";
  text?: string;
  minHeight?: number | string;
  overlay?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function WidgetSpinnerLoader({
  size = "medium",
  text = "Loading data…",
  minHeight,
  overlay = false,
  style = {},
  className = "",
}: WidgetSpinnerLoaderProps) {
  const isSmall = size === "small";
  const spinnerSize = isSmall ? 26 : size === "large" ? 48 : 36;
  const borderWidth = isSmall ? 2.5 : size === "large" ? 4 : 3.5;

  return (
    <div
      className={`effective-spinner-container ${overlay ? "effective-spinner-container--overlay" : ""} ${className}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: isSmall ? "0.5rem" : "1.25rem",
        minHeight: minHeight ?? (isSmall ? 80 : size === "large" ? 220 : 130),
        width: "100%",
        borderRadius: 12,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface, #ffffff)",
          padding: isSmall ? "0.6rem 1rem" : "1.1rem 1.8rem",
          borderRadius: isSmall ? "0.65rem" : "0.95rem",
          boxShadow: isSmall ? "0 4px 12px rgba(0,0,0,0.08)" : "0 10px 25px rgba(0,0,0,0.12)",
          border: "1px solid var(--border, #e2e8f0)",
          pointerEvents: "none",
        }}
      >
        <div
          className="effective-spinner"
          style={{
            width: spinnerSize,
            height: spinnerSize,
            borderWidth,
          }}
        />
        {text && (
          <span
            className="effective-spinner-text"
            style={{
              marginTop: isSmall ? "0.45rem" : "0.75rem",
              fontSize: isSmall ? "0.82rem" : "1rem",
              fontWeight: 600,
              color: "var(--text, #0f172a)",
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </span>
        )}
      </div>
    </div>
  );
}

export default WidgetSpinnerLoader;

