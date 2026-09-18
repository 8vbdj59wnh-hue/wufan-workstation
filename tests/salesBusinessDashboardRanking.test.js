import assert from "node:assert/strict";
import test from "node:test";
import { compactDashboardRankingItems } from "../server/salesBusinessDashboardService.js";

const views = [
  { current: "currentSalesAmount", growth: "salesGrowth", status: "salesComparisonStatus", mode: "ranking" },
  { current: "currentSalesAmount", growth: "salesGrowth", status: "salesComparisonStatus", mode: "surge" },
  { current: "currentProfitAmount", growth: "profitGrowth", status: "profitComparisonStatus", mode: "ranking" },
  { current: "currentProfitAmount", growth: "profitGrowth", status: "profitComparisonStatus", mode: "surge" },
];

function topIds(items, view) {
  const candidates = view.mode === "surge"
    ? items.filter((item) => item[view.status] === "comparable" && Number.isFinite(Number(item[view.growth])))
      .sort((left, right) => Number(right[view.growth]) - Number(left[view.growth]) || Number(right[view.current]) - Number(left[view.current]))
    : [...items].sort((left, right) => Number(right[view.current] || 0) - Number(left[view.current] || 0));
  return candidates.slice(0, 30).map((item) => item.targetId);
}

test("compacted dashboard rankings preserve every visible top-30 view", () => {
  const items = Array.from({ length: 400 }, (_, index) => ({
    targetId: `target-${index}`,
    currentSalesAmount: (index * 47) % 401,
    currentProfitAmount: (index * 83) % 397,
    salesGrowth: ((index * 29) % 211) / 100 - 1,
    profitGrowth: ((index * 61) % 223) / 100 - 1,
    salesComparisonStatus: index % 13 === 0 ? "new" : "comparable",
    profitComparisonStatus: index % 17 === 0 ? "new" : "comparable",
  }));

  const compacted = compactDashboardRankingItems(items);

  assert.ok(compacted.length <= 120);
  for (const view of views) assert.deepEqual(topIds(compacted, view), topIds(items, view));
});
