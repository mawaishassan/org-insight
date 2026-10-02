"use client";

import React from "react";

interface ContentLoaderProps {
  /** Controls visibility — keeps the DOM present for smooth fade transitions */
  show?: boolean;
  text?: string;
  size?: "small" | "medium" | "large";
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Overlay loading state for content that already has data and is being refreshed.
 * Place inside a `position: relative` parent. Displays a frosted-glass blurred backdrop with the effective spinner.
 */
export function ContentLoader({
  show = true,
  text,
  size = "medium",
  style = {},
  className = "",
}: ContentLoaderProps) {
  if (!show) return null;

  const isSmall = size === "small";
  const isLarge = size === "large";
  const spinnerSize = isSmall ? 24 : isLarge ? 48 : 34;
  const borderWidth = isSmall ? 2.5 : isLarge ? 4 : 3.5;

  return (
    <div className={`content-loader-overlay ${className}`} style={style}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: isSmall ? "0.45rem" : "0.65rem",
          background: "var(--surface, #ffffff)",
          padding: isSmall ? "0.6rem 1.1rem" : isLarge ? "1.4rem 2.2rem" : "0.95rem 1.65rem",
          borderRadius: isSmall ? "0.65rem" : "0.95rem",
          boxShadow: "0 10px 25px rgba(0,0,0,0.12)",
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
              fontSize: isSmall ? "0.8rem" : isLarge ? "1.05rem" : "0.88rem",
              fontWeight: 600,
              color: "var(--text, #1e293b)",
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

export default ContentLoader;

