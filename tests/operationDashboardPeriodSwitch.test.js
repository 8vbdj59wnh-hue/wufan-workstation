import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { renderSalesBusinessDashboard } from "../src/uiModules/salesBusinessDashboard.js";

const operationPageSource = fs.readFileSync(new URL("../src/operationDashboardPage.js", import.meta.url), "utf8");
const dashboardServiceSource = fs.readFileSync(new URL("../server/salesBusinessDashboardService.js", import.meta.url), "utf8");
const qualityServiceSource = fs.readFileSync(new URL("../server/salesDailyDataQualityService.js", import.meta.url), "utf8");

function dashboardData() {
  return {
    hasData: true,
    preset: "7d",
    startDate: "2026-08-20",
    endDate: "2026-08-26",
    previousStartDate: "2026-08-13",
    previousEndDate: "2026-08-19",
    windowDays: 7,
    summary: { salesAmount: 100, profitAmount: 50, profitMargin: 0.5, paidPromotionRatio: null, dataCoverage: 1, dataDays: 7, dataCount: 1 },
    previousSummary: { salesAmount: 80, profitAmount: 40, profitMargin: 0.5 },
    summaryComparison: { salesGrowth: 0.25, profitGrowth: 0.25, salesComparisonStatus: "comparable", profitComparisonStatus: "comparable" },
    shops: { items: [] },
    rankings: { shop: { items: [] }, link: { items: [] }, product: { items: [] } },
    metricAvailability: { paidPromotionAmount: { reason: "暂无数据" } },
  };
}

test("period switching keeps current data visible and immediately announces loading", () => {
  const html = renderSalesBusinessDashboard({
    state: {
      loading: true,
      data: dashboardData(),
      range: { preset: "15d" },
      visibleMetricKeys: new Set(["salesAmount"]),
    },
  });
  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /正在切换至近15天/u);
  assert.match(html, /经营数据汇总中，请稍候/u);
  assert.match(html, /data-sales-range="15d" class="is-active is-loading"/u);
  assert.match(html, /¥100/u);
});

test("period switching caches completed ranges and ignores stale responses", () => {
  assert.match(operationPageSource, /const salesDashboardCache = new Map\(\)/u);
  assert.match(operationPageSource, /requestVersion !== salesDashboardRequestVersion/u);
  assert.match(operationPageSource, /salesDashboardCache\.get\(cacheKey\)/u);
  assert.match(operationPageSource, /salesDashboardCache\.set\(cacheKey, nextDashboard\)/u);
});

test("dashboard reuses the expensive data quality result briefly while switching periods", () => {
  assert.match(dashboardServiceSource, /cacheTtlMs:\s*30_000/u);
  assert.match(qualityServiceSource, /qualityCacheByDatabase/u);
  assert.match(qualityServiceSource, /Date\.now\(\) - cached\.createdAt < cacheTtlMs/u);
});

test("leaving the dashboard does not start hidden legacy reads that block the next module", () => {
  assert.match(operationPageSource, /function startInitialSalesDashboard\(rerender\)/u);
  assert.match(operationPageSource, /if \(!\["", "dashboard", "operationDashboard", "operation-dashboard"\]\.includes\(route\)\) return/u);
  assert.match(operationPageSource, /export function bindOperationDashboardPageEvents\(rerender\) \{\s*[\s\S]*?startInitialSalesDashboard\(rerender\);/u);
  assert.doesNotMatch(operationPageSource, /if \(!dashboard && !loading\) refresh\(rerender\)/u);
  assert.doesNotMatch(operationPageSource, /if \(!anomalies && !anomaliesLoading\) refreshAnomalies\(rerender\)/u);
});

test("initial sales dashboard loading has no fixed delay", () => {
  assert.doesNotMatch(operationPageSource, /initialSalesDashboardTimer/u);
  assert.doesNotMatch(operationPageSource, /setTimeout\([\s\S]{0,300}?2_500/u);
});
