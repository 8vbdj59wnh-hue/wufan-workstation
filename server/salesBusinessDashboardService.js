import { getDatabase } from "./db.js";
import { queryDailySalesSummary, queryDailySalesSummaryRanking, queryDailySalesTrend } from "./capabilities/queryDailySales.js";
import { querySalesDailyDataQuality } from "./salesDailyDataQualityService.js";
import { queryProductContributions } from "./productContributionReadModel.js";

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
  const productContribution = queryProductContributions({ periodStart: startDate, periodEnd: endDate }, queryOptions);
  const productIds = productContribution.items.filter((item) => item.directSalesAmount !== null || item.totalPhysicalContribution !== null).map((item) => item.productId);
  const productMeta = productIds.length ? new Map(database.prepare(`SELECT id,name,skuCode FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`).all(...productIds).map((item) => [item.id, item])) : new Map();
  const productItems = productContribution.items.filter((item) => item.directSalesAmount !== null || item.totalPhysicalContribution !== null)
    .sort((left, right) => Number(right.directSalesAmount || 0) - Number(left.directSalesAmount || 0) || Number(right.totalPhysicalContribution || 0) - Number(left.totalPhysicalContribution || 0))
    .slice(0, 10).map((item, index) => ({ rank: index + 1, targetId: item.productId, targetName: productMeta.get(item.productId)?.name || "未命名产品",
      targetCode: productMeta.get(item.productId)?.skuCode || null, quantity: item.totalPhysicalContribution, directSalesQuantity: item.directSalesQuantity,
      bundleContributionQuantity: item.bundleContributionQuantity, salesAmount: item.directSalesAmount, costAmount: item.directCost, profitAmount: item.directProfit,
      profitMargin: Number(item.directSalesAmount || 0) ? Number(item.directProfit || 0) / Number(item.directSalesAmount) : null,
      metricContract: "product-contribution-v1", bundleAllocation: "none" }));
  const products = { capability: "QueryProductContribution", contractVersion: "1.0", mode: "ranking", items: productItems, hasData: productItems.length > 0,
    startDate, endDate, economics: "single_direct_only", quantity: "total_physical_contribution" };
  const links = queryDailySalesSummaryRanking({ dimension: "salesLink", startDate, endDate, limit: 10 }, queryOptions);
  return {
    capability: "SalesBusinessDashboard", contractVersion: "1.0", preset, startDate, endDate, hasData: summary.hasData,
    summary: { ...summary, profitMargin: summary.hasData && Number(summary.salesAmount) ? Number(summary.profitAmount) / Number(summary.salesAmount) : null },
    trend, products, links, quality,
    sources: ["QueryDailySalesSummary", "QueryDailySalesTrend", "QueryProductContribution", "QuerySalesDailyDataQuality"],
  };
}

export default getSalesBusinessDashboard;
