"use client";

import React from "react";
import { useDashboardCustomization } from "./DashboardCustomizationContext";

export function CustomLabel({
  value,
  widgetId,
  isSvg = false,
  svgProps = {},
  truncateLength,
  suffix = "",
  showUnderline = true,
}: {
  value: string;
  widgetId?: string;
  isSvg?: boolean;
  svgProps?: any;
  truncateLength?: number;
  suffix?: string;
  showUnderline?: boolean;
}) {
  const { getDisplayLabel, isOrgAdmin, openEditModal } = useDashboardCustomization();

  if (value == null) return null;
  const originalStr = String(value);
  if (!originalStr) return null;

  const displayLabel = getDisplayLabel(originalStr, widgetId);
  const truncated = truncateLength && displayLabel.length > truncateLength
    ? `${displayLabel.slice(0, truncateLength - 2)}…`
    : displayLabel;

  const displayText = truncated + suffix;

  const handleClick = (e: React.MouseEvent) => {
    if (!isOrgAdmin) return;
    e.stopPropagation();
    e.preventDefault();
    openEditModal(originalStr, widgetId);
  };

  if (isSvg) {
    return (
      <text
        {...svgProps}
        onClick={handleClick}
        style={{
          cursor: isOrgAdmin ? "pointer" : "default",
          textDecoration: showUnderline && isOrgAdmin ? "underline dashed rgba(255, 255, 255, 0.45)" : "none",
          paintOrder: "stroke",
          stroke: svgProps?.stroke || "none",
          strokeWidth: svgProps?.strokeWidth || 0,
          ...svgProps?.style,
        }}
      >
        {displayText}
        <title>{displayLabel}</title>
      </text>
    );
  }

  return (
    <span
      onClick={handleClick}
      style={{
        cursor: isOrgAdmin ? "pointer" : "default",
        textDecoration: showUnderline && isOrgAdmin ? "underline dashed var(--border)" : "none",
        display: "inline-block",
      }}
      title={isOrgAdmin ? `${displayLabel}\n(Click to customize label "${originalStr}")` : displayLabel}
    >
      {displayText}
    </span>
  );
}
