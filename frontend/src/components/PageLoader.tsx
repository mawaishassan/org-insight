"use client";

import React from "react";

interface PageLoaderProps {
  text?: string;
  size?: "small" | "medium" | "large";
  minHeight?: number | string;
  blur?: boolean;
  overlay?: boolean;
  style?: React.CSSProperties;
}

/**
 * Consistent full-page / section loading state.
 * Replaces all `<p>Loading...</p>` and skeleton patterns across the application.
 */
export function PageLoader({
  text = "Loading\u2026",
  size = "medium",
  minHeight,
  blur = true,
  overlay = false,
  style = {},
}: PageLoaderProps) {
  const isSmall = size === "small";
  const isLarge = size === "large";
  const spinnerSize = isSmall ? 28 : isLarge ? 52 : 40;
  const borderWidth = isSmall ? 2.5 : isLarge ? 4.5 : 3.5;

  const containerStyle: React.CSSProperties = overlay
    ? {
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "rgba(255, 255, 255, 0.78)",
        borderRadius: "inherit",
        ...style,
      }
    : {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: minHeight ?? (isSmall ? 100 : isLarge ? 300 : 200),
        width: "100%",
        padding: isSmall ? "0.75rem" : "2rem",
        ...style,
      };

  return (
    <div className="page-loader-enter" style={containerStyle}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: isSmall ? "0.5rem" : "0.85rem",
          background: "var(--surface, #ffffff)",
          padding: isSmall ? "0.75rem 1.25rem" : isLarge ? "1.75rem 2.75rem" : "1.25rem 2rem",
          borderRadius: isSmall ? "0.65rem" : "1rem",
          boxShadow: isSmall
            ? "0 4px 14px rgba(0,0,0,0.08)"
            : "0 10px 30px rgba(0,0,0,0.12)",
          border: "1px solid var(--border, #e2e8f0)",
          pointerEvents: "none",
        }}
      >
        <div
          className="effective-spinner"
          style={{ width: spinnerSize, height: spinnerSize, borderWidth }}
        />
        {text && (
          <span
            className="effective-spinner-text"
            style={{
              margin: 0,
              fontSize: isSmall ? "0.82rem" : isLarge ? "1.05rem" : "0.92rem",
              fontWeight: 600,
              color: "var(--text, #1e293b)",
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

export default PageLoader;

