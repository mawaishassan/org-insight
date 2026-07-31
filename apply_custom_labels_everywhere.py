import re

filepath = r"d:\New folder\org-insight\frontend\src\app\dashboard\dashboards\[id]\widgets.tsx"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("\r\n", "\n")

# 1. Update KpiBarChartWidgetInner destructuring to include registerWidgetLabels
old_destruct_bar = "  const token = getAccessToken();\n  const { getDisplayLabel } = useDashboardCustomization();"
new_destruct_bar = "  const token = getAccessToken();\n  const { getDisplayLabel, registerWidgetLabels } = useDashboardCustomization();"
content = content.replace(old_destruct_bar, new_destruct_bar)

# 2. Add useEffect inside KpiBarChartWidgetInner (we can insert it right after the destruct statement or inside the component hooks area)
# Let's search for setRawMultiLineItems or setHoverPiePt and insert after it.
target_hook_bar = "  const [rawMultiLineItems, setRawMultiLineItems] = useState<any[]>([]);"
bar_effect = """  const [rawMultiLineItems, setRawMultiLineItems] = useState<any[]>([]);

  useEffect(() => {
    if (mode === "multi_line_items") {
      const labels = groups.map((g) => g.label);
      registerWidgetLabels(widget.id, labels);
    } else {
      const labels = bars.map((b) => b.key);
      registerWidgetLabels(widget.id, labels);
    }
  }, [mode, groups, bars, widget.id, registerWidgetLabels]);"""

content = content.replace(target_hook_bar, bar_effect)

# 3. Update KpiTrendWidgetInner destructuring to include useDashboardCustomization and registerWidgetLabels
old_destruct_trend = "function KpiTrendWidgetInner({\n  widget,\n  organizationId,\n  dashboardId,\n}: {\n  widget: Extract<Widget, { type: \"kpi_trend\" }>;\n  organizationId: number;\n  dashboardId?: number;\n}) {\n  const token = getAccessToken();"

new_destruct_trend = "function KpiTrendWidgetInner({\n  widget,\n  organizationId,\n  dashboardId,\n}: {\n  widget: Extract<Widget, { type: \"kpi_trend\" }>;\n  organizationId: number;\n  dashboardId?: number;\n}) {\n  const token = getAccessToken();\n  const { getDisplayLabel, registerWidgetLabels } = useDashboardCustomization();"

content = content.replace(old_destruct_trend, new_destruct_trend)

# 4. Add useEffect inside KpiTrendWidgetInner
target_hook_trend = "  const [filterEditing, setFilterEditing] = useState(false);\n  const filterInputRef = useRef<HTMLInputElement>(null);"
trend_effect = """  const [filterEditing, setFilterEditing] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "multi_line_items") {
      registerWidgetLabels(widget.id, categories);
    } else {
      registerWidgetLabels(widget.id, widget.field_keys || []);
    }
  }, [mode, categories, widget.field_keys, widget.id, registerWidgetLabels]);"""

content = content.replace(target_hook_trend, trend_effect)


# 5. Replace x-axis <text> with <CustomLabel> in Group-based bar chart
old_text_axis_0 = """                            <text x={x + barW / 2} y={H - 10} fontSize="9" fill="var(--muted)" textAnchor="middle">
                              {b.label.length > 12 ? `${b.label.slice(0, 10)}…` : b.label}
                            </text>"""

new_text_axis_0 = """                            <CustomLabel
                              value={b.label}
                              widgetId={widget.id}
                              isSvg={true}
                              truncateLength={12}
                              svgProps={{
                                x: x + barW / 2,
                                y: H - 10,
                                fontSize: "9",
                                fill: "var(--muted)",
                                textAnchor: "middle",
                              }}
                            />"""

content = content.replace(old_text_axis_0, new_text_axis_0)

# 6. Replace x-axis <text> with <CustomLabel> in Fields-based bar chart
old_text_axis_1 = """                          <text x={x + barW / 2} y={H - 8} fontSize="9" fill="var(--muted)" textAnchor="middle">
                            {b.key.length > 14 ? `${b.key.slice(0, 12)}…` : b.key}
                          </text>"""

new_text_axis_1 = """                          <CustomLabel
                            value={b.key}
                            widgetId={widget.id}
                            isSvg={true}
                            truncateLength={14}
                            svgProps={{
                              x: x + barW / 2,
                              y: H - 8,
                              fontSize: "9",
                              fill: "var(--muted)",
                              textAnchor: "middle",
                            }}
                          />"""

content = content.replace(old_text_axis_1, new_text_axis_1)

# 7. Replace x-axis <text> with <CustomLabel> in Trend group-based bar chart
old_text_axis_2 = """                            <text x={catX + catW / 2} y={H - 56} fontSize="9" fill="var(--muted)" textAnchor="middle">
                              {c.length > 14 ? `${c.slice(0, 12)}…` : c}
                            </text>"""

new_text_axis_2 = """                            <CustomLabel
                              value={c}
                              widgetId={widget.id}
                              isSvg={true}
                              truncateLength={14}
                              svgProps={{
                                x: catX + catW / 2,
                                y: H - 56,
                                fontSize: "9",
                                fill: "var(--muted)",
                                textAnchor: "middle",
                              }}
                            />"""

content = content.replace(old_text_axis_2, new_text_axis_2)

# 8. Replace x-axis <text> with <CustomLabel> in Trend fields-based bar chart
old_text_axis_3 = """                          <text x={catX + catW / 2} y={H - 56} fontSize="9" fill="var(--muted)" textAnchor="middle">
                            {k.length > 14 ? `${k.slice(0, 12)}…` : k}
                          </text>"""

new_text_axis_3 = """                          <CustomLabel
                            value={k}
                            widgetId={widget.id}
                            isSvg={true}
                            truncateLength={14}
                            svgProps={{
                              x: catX + catW / 2,
                              y: H - 56,
                              fontSize: "9",
                              fill: "var(--muted)",
                              textAnchor: "middle",
                            }}
                          />"""

content = content.replace(old_text_axis_3, new_text_axis_3)

# 9. Update tooltips to show customized display labels in Bar chart and Trend chart
# Tooltip label in group-based bar chart
old_tooltip_label_0 = "                            const label = `${hoverBarPt.label}: ${hoverBarPt.value.toLocaleString()}`;"
new_tooltip_label_0 = "                            const label = `${getDisplayLabel(hoverBarPt.label, widget.id)}: ${hoverBarPt.value.toLocaleString()}`;"
content = content.replace(old_tooltip_label_0, new_tooltip_label_0)

# Tooltip label in fields-based bar chart
old_tooltip_label_1 = "                          const label = `${hoverBarPt.label}: ${hoverBarPt.value.toLocaleString()}`;"
new_tooltip_label_1 = "                          const label = `${getDisplayLabel(hoverBarPt.label, widget.id)}: ${hoverBarPt.value.toLocaleString()}`;"
content = content.replace(old_tooltip_label_1, new_tooltip_label_1)

# Tooltip label in Trend chart
old_tooltip_label_2 = "                            const label = `${hoverTrendPt.series} · ${hoverTrendPt.label}: ${hoverTrendPt.value.toLocaleString()}`;"
new_tooltip_label_2 = "                            const label = `${hoverTrendPt.series} · ${getDisplayLabel(hoverTrendPt.label, widget.id)}: ${hoverTrendPt.value.toLocaleString()}`;"
content = content.replace(old_tooltip_label_2, new_tooltip_label_2)

# Save changes
with open(filepath, "w", encoding="utf-8", newline="\n") as f:
    f.write(content)

print("Label customization updates applied successfully!")
