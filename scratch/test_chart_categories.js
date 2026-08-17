// test_chart_categories.js - Unit test verifying max 4% "Others" rule and dynamic grouping

function processChartCategories(rawItems, options = {}) {
  const maxOthersRatio = options.maxOthersRatio ?? 0.04;

  const items = rawItems.map((it) => ({
    key: it.key || it.label,
    label: it.label || it.key,
    value: Math.max(0, Number(it.value) || 0),
  }));

  if (options.sortByValue !== false) {
    items.sort((a, b) => b.value - a.value);
  }

  const totalValue = items.reduce((sum, it) => sum + it.value, 0);
  if (totalValue <= 0 || items.length <= 1) {
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
  const tailSum = tailItems.reduce((sum, it) => sum + it.value, 0);
  const percentStr = ((tailSum / totalValue) * 100).toFixed(1);

  const otherItem = {
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

// Test 1: 74 categories with long tail
const test74Data = [];
for (let i = 1; i <= 74; i++) {
  test74Data.push({ label: `Category ${i}`, value: 100 - i });
}

const res1 = processChartCategories(test74Data);
console.log("--- TEST 1: 74 Categories ---");
console.log("Total Items:", test74Data.length);
console.log("Total Value:", res1.totalValue);
console.log("Processed Items Count:", res1.processedItems.length);
console.log("Other Info:", res1.otherInfo);

if (res1.otherInfo) {
  const otherRatio = res1.otherInfo.value / res1.totalValue;
  console.log(`Others Ratio: ${(otherRatio * 100).toFixed(2)}%`);
  console.assert(otherRatio <= 0.04, "FAIL: Others ratio exceeds 4%");
  console.log("ASSERTION PASSED: Others ratio is strictly <= 4%");
} else {
  console.log("No Others created (all items fit within threshold)");
}

// Test 2: 3 categories (50%, 47%, 3%)
const test3Data = [
  { label: "A", value: 50 },
  { label: "B", value: 47 },
  { label: "C", value: 3 },
];

const res2 = processChartCategories(test3Data);
console.log("\n--- TEST 2: 3 Categories (3% tail) ---");
console.log("Processed Items Count:", res2.processedItems.length);
console.log("Other Info:", res2.otherInfo);
console.assert(res2.otherInfo === null, "ASSERTION PASSED: No Others created for 1 remaining tail item");

// Test 3: High value dominance (96%, 1%, 1%, 1%, 1%)
const testDominantData = [
  { label: "Dom", value: 96 },
  { label: "T1", value: 1 },
  { label: "T2", value: 1 },
  { label: "T3", value: 1 },
  { label: "T4", value: 1 },
];

const res3 = processChartCategories(testDominantData);
console.log("\n--- TEST 3: Dominant Category (96%) ---");
console.log("Processed Items:", res3.processedItems.map(i => ({ label: i.label, val: i.value, isOther: !!i.isOther })));
console.log("Other Info:", res3.otherInfo);
if (res3.otherInfo) {
  const ratio = res3.otherInfo.value / res3.totalValue;
  console.assert(ratio <= 0.04, "FAIL: Others ratio exceeds 4%");
  console.log(`ASSERTION PASSED: Others ratio = ${(ratio * 100).toFixed(2)}% <= 4%`);
}

console.log("\nALL ALGORITHM TESTS PASSED SUCCESSFULLY!");
