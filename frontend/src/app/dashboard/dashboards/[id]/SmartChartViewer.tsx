"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { CustomLabel } from "./CustomLabel";
import { useDashboardCustomization } from "./DashboardCustomizationContext";
import { useWidgetFullScreen } from "./WidgetFullScreenContext";

export interface RawChartItem {
  key: string;
  label: string;
  value: number;
}

export interface ProcessedChartItem {
  key: string;
  label: string;
  value: number;
  isOther?: boolean;
  otherCount?: number;
  otherPercent?: string;
  otherItems?: RawChartItem[];
}

export function processChartCategories(
  rawItems: RawChartItem[],
  options: { maxOthersRatio?: number; minItemsForOthers?: number; sortByValue?: boolean } = {}
): {
  processedItems: ProcessedChartItem[];
  otherInfo: { count: number; value: number; percent: string } | null;
  totalValue: number;
} {
  const maxOthersRatio = options.maxOthersRatio ?? 0.04; // 4% maximum rule
  const minItemsForOthers = options.minItemsForOthers ?? 12;

  const items: RawChartItem[] = rawItems.map((it) => ({
    key: it.key || it.label,
    label: it.label || it.key,
    value: Math.max(0, Number(it.value) || 0),
  }));

  if (options.sortByValue !== false) {
    items.sort((a, b) => b.value - a.value);
  }

  const totalValue = items.reduce((sum, it) => sum + it.value, 0);

  if (totalValue <= 0 || items.length <= minItemsForOthers) {
    return { processedItems: items, otherInfo: null, totalValue };
  }

  let cutoffIndex = items.length;
  for (let k = 1; k < items.length; k++) {
    const tailSum = items.slice(k).reduce((sum, it) => sum + it.value, 0);
    const ratio = tailSum / totalValue;
    if (ratio <= maxOthersRatio) {
      cutoffIndex = k;
      break;
    }
  }

  if (cutoffIndex >= items.length - 1) {
    return { processedItems: items, otherInfo: null, totalValue };
  }

  const topItems = items.slice(0, cutoffIndex);
  const tailItems = items.slice(cutoffIndex);

  // Only group categories into "Others" if there are more than 7 categories in the tail.
  // Otherwise, render them as individual separate slices.
  if (tailItems.length <= 7) {
    return { processedItems: items, otherInfo: null, totalValue };
  }

  const tailSum = tailItems.reduce((sum, it) => sum + it.value, 0);
  const percentStr = ((tailSum / totalValue) * 100).toFixed(1);

  const otherItem: ProcessedChartItem = {
    key: "Others",
    label: "Others",
    value: tailSum,
    isOther: true,
    otherCount: tailItems.length,
    otherPercent: percentStr,
    otherItems: tailItems,
  };

  return {
    processedItems: [...topItems, otherItem],
    otherInfo: {
      count: tailItems.length,
      value: tailSum,
      percent: percentStr,
    },
    totalValue,
  };
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInRadians: number) {
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function pieArcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  if (endAngle - startAngle >= 2 * Math.PI - 0.001) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";
  return ["M", cx, cy, "L", start.x, start.y, "A", r, r, 0, largeArcFlag, 1, end.x, end.y, "Z"].join(" ");
}

/**
 * Wraps any long text string (e.g. long category titles) into multiple lines of maxCharsPerLine.
 */
function wrapTextToLines(text: string, maxCharsPerLine: number = 34): string[] {
  if (!text || text.length <= maxCharsPerLine) {
    return [text || ""];
  }

  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if ((currentLine + (currentLine ? " " : "") + word).length > maxCharsPerLine) {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    } else {
      currentLine += (currentLine ? " " : "") + word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Wraps long category item names in bulleted lists so SVG tooltip text never overflows out of boundaries.
 */
function wrapLabelToLines(label: string, value: number, maxCharsPerLine: number = 34): string[] {
  const fullText = `${label}: ${value.toLocaleString()}`;
  if (fullText.length <= maxCharsPerLine) {
    return [`• ${fullText}`];
  }

  const words = label.split(" ");
  const lines: string[] = [];
  let currentLine = "• ";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if ((currentLine + word).length > maxCharsPerLine) {
      if (currentLine.trim() !== "•") {
        lines.push(currentLine.trimEnd());
      }
      currentLine = `  ${word} `;
    } else {
      currentLine += `${word} `;
    }
  }

  const valStr = `: ${value.toLocaleString()}`;
  if ((currentLine + valStr).length > maxCharsPerLine) {
    lines.push(currentLine.trimEnd());
    lines.push(`  ${valStr.trim()}`);
  } else {
    currentLine += valStr;
    lines.push(currentLine.trimEnd());
  }

  return lines;
}

export function SmartChartViewer({
  rawItems,
  widgetId,
  chartType = "bar",
  fullWidth = false,
  colorForIndex,
  onChartTypeChange,
}: {
  rawItems: RawChartItem[];
  widgetId: string;
  chartType: "bar" | "pie";
  fullWidth?: boolean;
  colorForIndex: (idx: number, total: number) => string;
  onChartTypeChange?: (type: "bar" | "pie") => void;
}) {
  const { getDisplayLabel, consistentColors, getColorForValue } = useDashboardCustomization();
  const isFullScreen = useWidgetFullScreen();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverPt, setHoverPt] = useState<{
    x: number;
    y: number;
    title: string;
    value: number;
    percent?: string;
    otherCount?: number;
    isOther?: boolean;
    otherItems?: RawChartItem[];
  } | null>(null);

  // Measure card container width dynamically for responsive sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(640);
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 800
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        if (w > 100) setContainerWidth(w);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleChartTypeChange = (nextType: "bar" | "pie") => {
    onChartTypeChange?.(nextType);
  };

  // STEP 1: Pre-process raw items by resolving display labels and MERGING items that share identical display labels.
  // E.g. When "NON HEC" is customized to display as "HEC", both "HEC" (36) and "NON HEC" (31) merge into ONE "HEC" bar (67).
  // This aggregation is case-insensitive (e.g. merging "uet" and "UET"), preferring the label variant with the most uppercase characters.
  const mergedRawItems = useMemo(() => {
    const map = new Map<string, { key: string; label: string; value: number }>();

    for (const it of rawItems) {
      const displayLabel = (getDisplayLabel(it.label, widgetId) || it.label || it.key || "").trim();
      const val = Math.max(0, Number(it.value) || 0);
      if (!displayLabel) continue;

      const key = displayLabel.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.value += val;
        const existingUpper = (existing.label.match(/[A-Z]/g) || []).length;
        const currentUpper = (displayLabel.match(/[A-Z]/g) || []).length;
        if (currentUpper > existingUpper) {
          existing.label = displayLabel;
          existing.key = displayLabel;
        }
      } else {
        map.set(key, {
          key: displayLabel,
          label: displayLabel,
          value: val,
        });
      }
    }

    const items = Array.from(map.values());
    items.sort((a, b) => b.value - a.value);
    return items;
  }, [rawItems, widgetId, getDisplayLabel]);

  // STEP 2: Process categories for Pie SVG arc calculation (max 4% rule for pie circle, only if total categories > 7)
  const { processedItems, otherInfo, totalValue } = useMemo(
    () => processChartCategories(mergedRawItems, { maxOthersRatio: 0.04, minItemsForOthers: 7, sortByValue: true }),
    [mergedRawItems]
  );

  const rawCount = mergedRawItems.length;

  if (mergedRawItems.length === 0) {
    return <p style={{ color: "var(--muted)", margin: 0 }}>No data available for chart.</p>;
  }

  // --- PIE CHART RENDERER ---
  if (chartType === "pie") {
    const isHighCategory = rawCount > 20;

    return (
      <div ref={containerRef} style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        {isHighCategory && (
          <div
            style={{
              padding: "0.5rem 0.75rem",
              marginBottom: "0.75rem",
              borderRadius: "6px",
              background: "rgba(79, 70, 229, 0.08)",
              border: "1px solid rgba(79, 70, 229, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
              fontSize: "0.82rem",
            }}
          >
            <span>
              💡 Dataset contains <strong>{rawCount} categories</strong>. A Bar Chart provides significantly better readability.
            </span>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  handleChartTypeChange("bar");
                }}
                style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
              >
                Switch to Bar Chart
              </button>
            </div>
          </div>
        )}

        {(() => {
          const containerHeight = 0.92 * viewportHeight - 110;
          const pieSize = isFullScreen ? Math.max(300, Math.min(650, containerHeight - 40)) : 290;
          return (
            <div style={{ display: "flex", gap: isFullScreen ? "3.5rem" : "1.5rem", alignItems: "center", justifyContent: isFullScreen ? "center" : "space-between", flexWrap: "wrap", width: "100%", maxWidth: isFullScreen ? "1400px" : "100%", margin: "0 auto", padding: isFullScreen ? "1.5rem 0.5rem" : "0.25rem" }}>
              <div style={{ width: pieSize, height: pieSize, flexShrink: 0, margin: isFullScreen ? "0" : "0 auto", position: "relative" }}>
            <svg
              viewBox="0 0 300 300"
              role="img"
              aria-label="Pie chart"
              style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
              onMouseLeave={() => {
                setHoverKey(null);
                setHoverPt(null);
              }}
              onTouchEnd={() => {
                setHoverKey(null);
                setHoverPt(null);
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clientX = e.clientX - rect.left;
                const clientY = e.clientY - rect.top;
                const localX = (clientX / rect.width) * 300;
                const localY = (clientY / rect.height) * 300;
                const cx = 150;
                const cy = 150;
                const r = 120;
                const dx = localX - cx;
                const dy = localY - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist <= r && dist > 5) {
                  let angle = Math.atan2(dy, dx);
                  let normalizedAngle = angle - -Math.PI / 2;
                  if (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
                  let currentAngleSum = 0;

                  for (let i = 0; i < processedItems.length; i++) {
                    const item = processedItems[i];
                    const frac = totalValue > 0 ? item.value / totalValue : 0;
                    const sweep = frac * Math.PI * 2;

                    if (normalizedAngle >= currentAngleSum && normalizedAngle < currentAngleSum + sweep) {
                      setHoverKey(item.key);
                      const mid = -Math.PI / 2 + currentAngleSum + sweep / 2;
                      const p = polarToCartesian(cx, cy, r * 0.72, mid);
                      setHoverPt({
                        x: p.x,
                        y: p.y,
                        title: item.isOther ? `Others (${item.otherCount} categories)` : getDisplayLabel(item.label, widgetId),
                        value: item.value,
                        percent: ((item.value / (totalValue || 1)) * 100).toFixed(1),
                        otherCount: item.otherCount,
                        isOther: item.isOther,
                        otherItems: item.otherItems,
                      });
                      break;
                    }
                    currentAngleSum += sweep;
                  }
                } else {
                  setHoverKey(null);
                  setHoverPt(null);
                }
              }}
            >
              <rect x="0" y="0" width="300" height="300" fill="var(--bg)" rx="6" />
              {(() => {
                const cx = 150;
                const cy = 150;
                const r = 120;
                let a = -Math.PI / 2;

                return (
                  <>
                    {processedItems.map((item, i) => {
                      const frac = totalValue > 0 ? item.value / totalValue : 0;
                      const next = a + frac * Math.PI * 2;
                      const d = pieArcPath(cx, cy, r, a, next);
                      a = next;
                      const displayLabel = item.isOther ? "Others" : getDisplayLabel(item.label, widgetId);
                      const defaultColor = item.isOther ? "#9ca3af" : colorForIndex(i, processedItems.length);
                      const fill = getColorForValue(displayLabel, i, processedItems.length, defaultColor);

                      return (
                        <path
                          key={item.key}
                          d={d}
                          fill={fill}
                          stroke="var(--surface)"
                          strokeWidth="1"
                          style={{ transition: "opacity 0.15s ease" }}
                          opacity={hoverKey === null || hoverKey === item.key ? 1.0 : 0.65}
                        />
                      );
                    })}

                    {hoverPt && hoverKey ? (
                      <g style={{ pointerEvents: "none" }}>
                        <circle cx={hoverPt.x} cy={hoverPt.y} r={4} fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
                        {(() => {
                          const isOther = hoverPt.isOther;
                          const titleLines = wrapTextToLines(hoverPt.title, 32);
                          const line2 = `Value: ${hoverPt.value.toLocaleString()} (${hoverPt.percent}%)`;
                          
                          const formattedItems: string[] = [];
                          if (isOther && hoverPt.otherItems) {
                            const topItems = hoverPt.otherItems.slice(0, 6);
                            for (const it of topItems) {
                              const lbl = getDisplayLabel(it.label, widgetId) || it.label;
                              formattedItems.push(...wrapLabelToLines(lbl, it.value, 30));
                            }
                            if (hoverPt.otherItems.length > 6) {
                              formattedItems.push(`...and ${hoverPt.otherItems.length - 6} more categories`);
                            }
                          }

                          const padX = isFullScreen ? 18 : 12;
                          const padY = isFullScreen ? 14 : 10;
                          const titleLineH = isFullScreen ? 22 : 15;
                          const itemLineH = isFullScreen ? 18 : 14;

                          const maxChars = Math.max(
                            ...titleLines.map((s) => s.length),
                            line2.length,
                            ...formattedItems.map((s) => s.length)
                          );

                          const boxW = Math.min(isFullScreen ? 380 : 270, Math.max(isFullScreen ? 200 : 140, maxChars * (isFullScreen ? 9.2 : 6.2) + padX * 2));
                          const titleBlockH = titleLines.length * titleLineH;
                          const subTitleH = isFullScreen ? 22 : 16;
                          const listBlockH = formattedItems.length > 0 ? 10 + formattedItems.length * itemLineH : 0;
                          const boxH = padY * 2 + titleBlockH + subTitleH + listBlockH;

                          const x = Math.min(300 - boxW - 8, Math.max(8, hoverPt.x + 12));
                          const y = Math.min(300 - boxH - 8, Math.max(8, hoverPt.y - boxH - 10));

                          return (
                            <g>
                              <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" filter="drop-shadow(0 6px 12px rgba(0,0,0,0.18))" />
                              {titleLines.map((tLine, idx) => (
                                <text key={idx} x={x + padX} y={y + padY + (isFullScreen ? 18 : 14) + idx * titleLineH} fontSize={isFullScreen ? "18" : "14"} fontWeight="800" fill="var(--text)">
                                  {tLine}
                                </text>
                              ))}
                              <text x={x + padX} y={y + padY + (isFullScreen ? 18 : 14) + titleBlockH + 4} fontSize={isFullScreen ? "15" : "13"} fontWeight="700" fill="var(--text-secondary, #475569)">
                                {line2}
                              </text>

                              {formattedItems.length > 0 && (
                                <>
                                  <line x1={x + padX} y1={y + padY + titleBlockH + subTitleH + 2} x2={x + boxW - padX} y2={y + padY + titleBlockH + subTitleH + 2} stroke="var(--border)" opacity="0.6" />
                                  {formattedItems.map((itemLine, idx) => {
                                    const isBullet = itemLine.startsWith("• ");
                                    const isMore = itemLine.startsWith("...and ");
                                    return (
                                      <text
                                        key={idx}
                                        x={x + padX}
                                        y={y + padY + titleBlockH + subTitleH + 16 + idx * itemLineH}
                                        fontSize={isFullScreen ? "13" : "9.5"}
                                        fontWeight={isBullet ? "600" : "400"}
                                        fill={isMore ? "var(--accent)" : "var(--text)"}
                                        fontStyle={isMore ? "italic" : "normal"}
                                      >
                                        {itemLine}
                                      </text>
                                    );
                                  })}
                                </>
                              )}
                            </g>
                          );
                        })()}
                      </g>
                    ) : null}
                  </>
                );
              })()}
            </svg>
          </div>

          {/* Alongside Details Column: Lists ALL original individual categories with their descriptions */}
          <div style={{ flex: 1, minWidth: isFullScreen ? 340 : 220, maxHeight: isFullScreen ? Math.max(300, containerHeight - 40) : 290, overflowY: "auto", scrollbarWidth: "thin", paddingRight: "0.5rem" }}>
            <div
              style={{
                fontSize: isFullScreen ? "1.6rem" : "0.78rem",
                fontWeight: isFullScreen ? 800 : 600,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: isFullScreen ? "1.2rem" : "0.5rem",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Categories ({mergedRawItems.length})</span>
            </div>
            <div style={{ display: "grid", gap: isFullScreen ? "1.1rem" : "0.45rem" }}>
              {mergedRawItems.map((item, i) => {
                const topIdx = processedItems.findIndex((p) => !p.isOther && p.key === item.key);
                const displayLabel = topIdx >= 0 ? getDisplayLabel(item.label, widgetId) : "Others";
                const defaultColor = topIdx >= 0 ? colorForIndex(topIdx, processedItems.length) : "#9ca3af";
                const fill = getColorForValue(displayLabel, topIdx >= 0 ? topIdx : i, processedItems.length, defaultColor);
                const percentStr = totalValue > 0 ? ((item.value / totalValue) * 100).toFixed(1) : "0";

                return (
                  <div key={item.key} style={{ display: "flex", alignItems: "center", gap: isFullScreen ? "1.1rem" : "0.5rem" }}>
                    <div style={{ width: isFullScreen ? 20 : 10, height: isFullScreen ? 20 : 10, borderRadius: isFullScreen ? "5px" : "3px", background: fill, flexShrink: 0 }} />
                    <div
                      style={{
                        fontSize: isFullScreen ? "1.7rem" : "0.92rem",
                        fontWeight: 700,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                      title={`${getDisplayLabel(item.label, widgetId)}: ${item.value.toLocaleString()} (${percentStr}%)`}
                    >
                      <CustomLabel value={item.label} widgetId={widgetId} showUnderline={false} />
                      <span style={{ color: "var(--text-secondary, #334155)", marginLeft: isFullScreen ? "0.8rem" : "0.4rem", fontWeight: 700 }}>
                        ({item.value.toLocaleString()} — {percentStr}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    })()}
  </div>
);
}

  // --- HORIZONTAL & VERTICAL BAR CHART RENDERERS ---
  // Completely remove "Others" concept from Bar Charts: render ALL original individual categories directly!
  const data = mergedRawItems;
  const n = data.length;



  // --- VERTICAL BAR CHART RENDERER (Column Chart) ---
  const maxLabelLen = Math.max(
    ...data.map((d) => (getDisplayLabel(d.label, widgetId) || d.label).length)
  );

  let rotationAngle = 0;
  if (isFullScreen) {
    rotationAngle = n <= 5 ? 0 : -35;
  } else {
    rotationAngle = n <= 4 ? 0 : -45;
  }

  const cardW = Math.max(300, containerWidth);
  const left = rotationAngle !== 0 ? 55 : 45;
  const right = 20;

  const innerW = Math.max(50, cardW - left - right);
  const gap = n > 50 ? 1 : n > 25 ? 2 : n > 12 ? 4 : 6;
  const barW = Math.max(2, (innerW - gap * Math.max(0, n - 1)) / Math.max(1, n));

  const startX = left;
  const barSpace = barW + gap;

  const charPx = isFullScreen ? 10.5 : 8.5;
  const maxLabelChars = Math.max(3, Math.floor((barW + gap * 0.4) / charPx));

  let bottomPadding = 45;
  if (rotationAngle === 0) {
    bottomPadding = isFullScreen ? 60 : 50;
  } else {
    bottomPadding = isFullScreen 
      ? Math.max(75, Math.round(Math.min(22, maxLabelLen) * 7.5 + 20)) 
      : Math.min(150, Math.max(85, Math.round(Math.min(25, maxLabelLen) * 6.5)));
  }
  const containerHeight = 0.92 * viewportHeight - 110;
  const H = isFullScreen ? Math.max(300, containerHeight - 30) : (290 + bottomPadding);
  const top = 32;
  const innerH = Math.max(60, H - top - bottomPadding);
  const maxV = Math.max(...data.map((d) => d.value), 1);

  const minIdx = data.reduce((best, b, i) => (b.value < data[best].value ? i : best), 0);
  const maxIdx = data.reduce((best, b, i) => (b.value > data[best].value ? i : best), 0);

  return (
    <div ref={containerRef} style={{ width: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <div
        style={{
          width: "100%",
          overflow: "hidden",
          boxSizing: "border-box",
          paddingBottom: isFullScreen ? "0px" : "0.5rem",
        }}
      >
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${cardW} ${H}`}
          preserveAspectRatio="xMidYMin meet"
          role="img"
          aria-label="Vertical Bar chart"
          style={{ display: "block", width: "100%", height: isFullScreen ? H : "auto", touchAction: "none" }}
          onMouseLeave={() => {
            setHoverKey(null);
            setHoverPt(null);
          }}
          onTouchEnd={() => {
            setHoverKey(null);
            setHoverPt(null);
          }}
        >
          <rect x="0" y="0" width={cardW} height={H} fill="var(--bg)" rx="6" />


          {data.map((b, i) => {
            const x = startX + i * (barW + gap);
            const h = maxV > 0 ? (b.value / maxV) * innerH : 0;
            const y = top + innerH - h;
            const displayLabel = getDisplayLabel(b.label, widgetId);
            const fill = getColorForValue(displayLabel, i, data.length, colorForIndex(i, data.length));

            const angleRad = Math.abs(rotationAngle) * Math.PI / 180;
            const cosA = Math.cos(angleRad) || 0.8;
            const leftBoundaryLimit = Math.max(5, Math.floor(x / (charPx * cosA)));

            let sliceTruncateLength = isFullScreen
              ? (rotationAngle === 0 ? 40 : Math.min(22, leftBoundaryLimit))
              : (rotationAngle === 0 ? maxLabelChars : Math.min(16, leftBoundaryLimit));

            if (rotationAngle !== 0 && i === 0 && isFullScreen && displayLabel) {
              const words = displayLabel.split(" ");
              if (words.length > 1) {
                sliceTruncateLength = words[0].length + 2;
              }
            }

            return (
              <g key={b.key}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  fill={fill}
                  rx={n > 40 ? 0 : 2}
                  opacity={hoverKey === null || hoverKey === b.key ? 0.9 : 0.5}
                  style={{ transition: "opacity 0.15s ease" }}
                />

                <rect
                  x={x - gap / 2}
                  y={top}
                  width={Math.max(barW + gap, 6)}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => {
                    setHoverKey(b.key);
                    setHoverPt({
                      x: x + barW / 2,
                      y: Math.max(top, y),
                      title: displayLabel,
                      value: b.value,
                      percent: totalValue > 0 ? ((b.value / totalValue) * 100).toFixed(1) : undefined,
                    });
                  }}
                  onMouseMove={() => {
                    setHoverKey(b.key);
                    setHoverPt({
                      x: x + barW / 2,
                      y: Math.max(top, y),
                      title: displayLabel,
                      value: b.value,
                      percent: totalValue > 0 ? ((b.value / totalValue) * 100).toFixed(1) : undefined,
                    });
                  }}
                />

                {h > 0 && n <= 35 ? (
                  <text
                    x={x + barW / 2}
                    y={Math.max(isFullScreen ? 18 : 14, y - (isFullScreen ? 10 : 8))}
                    fontSize={isFullScreen ? "16" : "13"}
                    fontWeight="800"
                    fill="var(--text)"
                    textAnchor="middle"
                    style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 4 }}
                  >
                    {b.value.toLocaleString()}
                  </text>
                ) : null}

                <g transform={`translate(${x + barW / 2}, ${top + innerH + (rotationAngle === 0 ? (isFullScreen ? 16 : 8) : (isFullScreen ? 12 : 14))}) rotate(${rotationAngle})`}>
                  <CustomLabel
                    value={b.label}
                    widgetId={widgetId}
                    isSvg={true}
                    showUnderline={false}
                    truncateLength={sliceTruncateLength}
                    svgProps={{
                      x: 0,
                      y: rotationAngle === 0 ? (isFullScreen ? 12 : 6) : 0,
                      fontSize: isFullScreen ? (rotationAngle === 0 ? "26" : "22") : n > 40 ? "10" : n > 20 ? "12" : "13",
                      fontWeight: "800",
                      fill: "var(--text)",
                      textAnchor: rotationAngle === 0 ? "middle" : "end",
                      dominantBaseline: rotationAngle === 0 ? "hanging" : "auto",
                    }}
                  />
                </g>
              </g>
            );
          })}

          {hoverPt && hoverKey ? (
            <g style={{ pointerEvents: "none" }}>
              <line x1={hoverPt.x} y1={top} x2={hoverPt.x} y2={top + innerH} stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" strokeDasharray="3 3" />
              {(() => {
                const titleLines = wrapTextToLines(hoverPt.title, 34);
                const line2 = `Value: ${hoverPt.value.toLocaleString()}${hoverPt.percent ? ` (${hoverPt.percent}%)` : ""}`;
                
                const padX = isFullScreen ? 28 : 14;
                const padY = isFullScreen ? 24 : 12;
                const titleLineH = isFullScreen ? 32 : 18;
                const maxChars = Math.max(...titleLines.map((s) => s.length), line2.length);
                const boxW = Math.min(isFullScreen ? 600 : 380, Math.max(isFullScreen ? 320 : 180, maxChars * (isFullScreen ? 14.5 : 8.0) + padX * 2));
                const titleBlockH = titleLines.length * titleLineH;
                const subTitleH = isFullScreen ? 30 : 20;
                const boxH = padY * 2 + titleBlockH + subTitleH;

                const preferLeft = hoverPt.x > cardW * 0.55;
                const x = preferLeft ? Math.max(8, hoverPt.x - boxW - 10) : Math.min(cardW - boxW - 8, hoverPt.x + 10);
                const y = Math.max(top, Math.min(H - boxH - 10, hoverPt.y - boxH - 6));

                return (
                  <g>
                    <rect x={x} y={y} width={boxW} height={boxH} rx={8} fill="var(--surface)" stroke="var(--border)" filter="drop-shadow(0 6px 12px rgba(0,0,0,0.18))" />
                    {titleLines.map((tLine, idx) => (
                      <text key={idx} x={x + padX} y={y + padY + (isFullScreen ? 26 : 14) + idx * titleLineH} fontSize={isFullScreen ? "26" : "14"} fontWeight="800" fill="var(--text)">
                        {tLine}
                      </text>
                    ))}
                    <text x={x + padX} y={y + padY + (isFullScreen ? 26 : 14) + titleBlockH + (isFullScreen ? 10 : 4)} fontSize={isFullScreen ? "22" : "13"} fontWeight="700" fill="var(--text-secondary, #475569)">
                      {line2}
                    </text>
                  </g>
                );
              })()}
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
