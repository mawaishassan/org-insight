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
  text = "Loading data...",
  minHeight,
  overlay = false,
  style = {},
  className = "",
}: WidgetSpinnerLoaderProps) {
  const spinnerSize = size === "small" ? 24 : size === "large" ? 44 : 32;
  const borderWidth = size === "small" ? 2.5 : size === "large" ? 3.5 : 3;

  return (
    <div
      className={`effective-spinner-container ${overlay ? "effective-spinner-container--overlay" : ""} ${className}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        minHeight: minHeight ?? (size === "small" ? 90 : size === "large" ? 220 : 140),
        width: "100%",
        borderRadius: 12,
        background: "transparent",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        ...style,
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
          style={{ fontSize: size === "small" ? "0.78rem" : "0.85rem" }}
        >
          {text}
        </span>
      )}
    </div>
  );
}

export default WidgetSpinnerLoader;
