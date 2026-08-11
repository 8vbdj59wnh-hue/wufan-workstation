import { getDatabase } from "./db.js";
import { queryDailySalesSummary, queryDailySalesSummaryRanking, queryDailySalesTrend } from "./capabilities/queryDailySales.js";
import { querySalesDailyDataQuality } from "./salesDailyDataQualityService.js";

function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10);
}

export function getSalesBusinessDashboard(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const preset = input.preset === "7d" ? "7d" : "30d";
  const quality = querySalesDailyDataQuality({ database });
  if (!quality.hasData) return { capability: "SalesBusinessDashboard", contractVersion: "1.0", preset, hasData: false, quality };
  const endDate = quality.batch.dateEnd; const startDate = addDays(endDate, preset === "7d" ? -6 : -29);
  const queryOptions = { database };
  const summary = queryDailySalesSummary({ dimension: "company", targetId: "", startDate, endDate }, queryOptions);
  const trend = queryDailySalesTrend({ dimension: "company", targetId: "", startDate, endDate }, queryOptions);
  const products = queryDailySalesSummaryRanking({ dimension: "product", startDate, endDate, limit: 10 }, queryOptions);
  const links = queryDailySalesSummaryRanking({ dimension: "salesLink", startDate, endDate, limit: 10 }, queryOptions);
  return {
    capability: "SalesBusinessDashboard", contractVersion: "1.0", preset, startDate, endDate, hasData: summary.hasData,
    summary: { ...summary, profitMargin: summary.hasData && Number(summary.salesAmount) ? Number(summary.profitAmount) / Number(summary.salesAmount) : null },
    trend, products, links, quality,
    sources: ["QueryDailySalesSummary", "QueryDailySalesTrend", "QuerySalesDailyDataQuality"],
  };
}

export default getSalesBusinessDashboard;
