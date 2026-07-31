import re

filepath = r"d:\New folder\org-insight\frontend\src\app\dashboard\dashboards\[id]\widgets.tsx"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("\r\n", "\n")

# 1. Group-based bar chart
# First, let's verify if the group-based bar chart needs full-height hover overlay.
# It starts at:
#                          <g key={b.label}>
#                            <rect
#                              x={x}
#                              y={y}
#                              width={barW}
#                              height={h}
#                              fill={fill}
#                              opacity={0.85}
#                              rx={2}
# ...
pattern_0 = r'(\s*)<rect\s+x=\{x\}\s+y=\{y\}\s+width=\{barW\}\s+height=\{h\}\s+fill=\{fill\}\s+opacity=\{0.85\}\s+rx=\{2\}\s+onMouseEnter=\{\(\)\s*=>\s*\{\s*setHoverBarKey\(b\.label\);[\s\S]+?\}\}\s*/>'
match_0 = re.search(pattern_0, content)
if match_0:
    indent = match_0.group(1)
    replacement_0 = """{indent}<rect
{indent}  x={x}
{indent}  y={y}
{indent}  width={barW}
{indent}  height={h}
{indent}  fill={fill}
{indent}  opacity={hoverBarKey === b.label ? 1.0 : 0.85}
{indent}  style={{ transition: "opacity 0.15s ease" }}
{indent}  rx={2}
{indent}/>
{indent}<rect
{indent}  x={x}
{indent}  y={top}
{indent}  width={barW}
{indent}  height={innerH}
{indent}  fill="transparent"
{indent}  style={{ cursor: "pointer" }}
{indent}  onMouseEnter={() => {
{indent}    setHoverBarKey(b.label);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
{indent}  }}
{indent}  onMouseMove={() => {
{indent}    setHoverBarKey(b.label);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
{indent}  }}
{indent}  onTouchStart={() => {
{indent}    setHoverBarKey(b.label);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
{indent}  }}
{indent}  onTouchMove={() => {
{indent}    setHoverBarKey(b.label);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.label, value: b.value });
{indent}  }}
{indent}/>""".replace("{indent}", indent)
    content = content.replace(match_0.group(0), replacement_0)
    print("Pattern 0 (group-based bar chart) replaced successfully!")
else:
    print("Pattern 0 NOT found!")

# 2. Fields-based bar chart
pattern_1 = r'(\s*)<rect\s+x=\{x\}\s+y=\{y\}\s+width=\{barW\}\s+height=\{h\}\s+fill=\{fill\}\s+opacity=\{0.85\}\s+rx=\{2\}\s+onMouseEnter=\{\(\)\s*=>\s*\{\s*setHoverBarKey\(b\.key\);[\s\S]+?\}\}\s*/>'
match_1 = re.search(pattern_1, content)
if match_1:
    indent = match_1.group(1)
    replacement_1 = """{indent}<rect
{indent}  x={x}
{indent}  y={y}
{indent}  width={barW}
{indent}  height={h}
{indent}  fill={fill}
{indent}  opacity={hoverBarKey === b.key ? 1.0 : 0.85}
{indent}  style={{ transition: "opacity 0.15s ease" }}
{indent}  rx={2}
{indent}/>
{indent}<rect
{indent}  x={x}
{indent}  y={top}
{indent}  width={barW}
{indent}  height={innerH}
{indent}  fill="transparent"
{indent}  style={{ cursor: "pointer" }}
{indent}  onMouseEnter={() => {
{indent}    setHoverBarKey(b.key);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
{indent}  }}
{indent}  onMouseMove={() => {
{indent}    setHoverBarKey(b.key);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
{indent}  }}
{indent}  onTouchStart={() => {
{indent}    setHoverBarKey(b.key);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
{indent}  }}
{indent}  onTouchMove={() => {
{indent}    setHoverBarKey(b.key);
{indent}    setHoverBarPt({ x: x + barW / 2, y: Math.max(top, y), label: b.key, value: b.value });
{indent}  }}
{indent}/>""".replace("{indent}", indent)
    content = content.replace(match_1.group(0), replacement_1)
    print("Pattern 1 replaced successfully!")
else:
    print("Pattern 1 NOT found!")

# 3. Trend group-based bars
pattern_2 = r'(\s*)<rect\s+key=\{\`\$\{c\}:\$\{y\}\`\}[\s\S]+?/>'
match_2 = re.search(pattern_2, content)
if match_2:
    indent = match_2.group(1)
    replacement_2 = """{indent}<rect
{indent}  key={`${c}:${y}`}
{indent}  x={x}
{indent}  y={yy}
{indent}  width={barW}
{indent}  height={h}
{indent}  fill={yearColors[y]}
{indent}  opacity={hoverTrendPt && hoverTrendPt.label === c && hoverTrendPt.series === String(y) ? 1.0 : 0.9}
{indent}  style={{ transition: "opacity 0.15s ease" }}
{indent}  rx={2}
{indent}/>
{indent}<rect
{indent}  key={`${c}:${y}:hover`}
{indent}  x={x}
{indent}  y={top}
{indent}  width={barW}
{indent}  height={innerH}
{indent}  fill="transparent"
{indent}  style={{ cursor: "pointer" }}
{indent}  onMouseEnter={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
{indent}  onMouseMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
{indent}  onTouchStart={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
{indent}  onTouchMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: c, value: v, series: String(y) })}
{indent}/>""".replace("{indent}", indent)
    content = content.replace(match_2.group(0), replacement_2)
    print("Pattern 2 replaced successfully!")
else:
    print("Pattern 2 NOT found!")

# 4. Trend fields-based bars
pattern_3 = r'(\s*)<rect\s+key=\{\`\$\{k\}:\$\{y\}\`\}[\s\S]+?/>'
match_3 = re.search(pattern_3, content)
if match_3:
    indent = match_3.group(1)
    replacement_3 = """{indent}<rect
{indent}  key={`${k}:${y}`}
{indent}  x={x}
{indent}  y={yy}
{indent}  width={barW}
{indent}  height={h}
{indent}  fill={yearColors[y]}
{indent}  opacity={hoverTrendPt && hoverTrendPt.label === k && hoverTrendPt.series === String(y) ? 1.0 : 0.9}
{indent}  style={{ transition: "opacity 0.15s ease" }}
{indent}  rx={2}
{indent}/>
{indent}<rect
{indent}  key={`${k}:${y}:hover`}
{indent}  x={x}
{indent}  y={top}
{indent}  width={barW}
{indent}  height={innerH}
{indent}  fill="transparent"
{indent}  style={{ cursor: "pointer" }}
{indent}  onMouseEnter={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
{indent}  onMouseMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
{indent}  onTouchStart={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
{indent}  onTouchMove={() => setHoverTrendPt({ x: x + barW / 2, y: Math.max(top, yy), label: k, value: v, series: String(y) })}
{indent}/>""".replace("{indent}", indent)
    content = content.replace(match_3.group(0), replacement_3)
    print("Pattern 3 replaced successfully!")
else:
    print("Pattern 3 NOT found!")

with open(filepath, "w", encoding="utf-8", newline="\n") as f:
    f.write(content)

print("Done!")
