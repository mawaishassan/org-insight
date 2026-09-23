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
  const { getDisplayLabel, canEditLabels, openEditModal } = useDashboardCustomization();

  if (value == null) return null;
  const originalStr = String(value);
  if (!originalStr) return null;

  const displayLabel = getDisplayLabel(originalStr, widgetId);
  const truncated =
    truncateLength && displayLabel.length > truncateLength
      ? truncateLength <= 4
        ? `${displayLabel.slice(0, Math.max(1, truncateLength - 1))}...`
        : `${displayLabel.slice(0, Math.max(1, truncateLength - 3))}...`
      : displayLabel;

  const displayText = truncated + suffix;

  const handleClick = (e: React.MouseEvent) => {
    if (!canEditLabels) return;
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
          cursor: canEditLabels ? "pointer" : "default",
          textDecoration: showUnderline && canEditLabels ? "underline dashed rgba(255, 255, 255, 0.45)" : "none",
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
        cursor: canEditLabels ? "pointer" : "default",
        textDecoration: showUnderline && canEditLabels ? "underline dashed var(--border)" : "none",
        display: "inline-block",
      }}
      title={canEditLabels ? `${displayLabel}\n(Click to customize label "${originalStr}")` : displayLabel}
    >
      {displayText}
    </span>
  );
}
