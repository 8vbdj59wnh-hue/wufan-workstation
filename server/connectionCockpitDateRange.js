import { resolveLinkSalesRankingRange } from "./linkSalesRankingService.js";

function dateShift(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function latestCompleteSalesDate(database) {
  const batchDate = database.prepare(`
    SELECT b.periodEnd
    FROM connection_import_batches b
    WHERE b.sourceType='erp_sales_daily_preview'
      AND b.status IN ('completed','completed_with_exceptions')
      AND b.periodEnd IS NOT NULL
      AND EXISTS (SELECT 1 FROM connection_sku_sales_daily_facts f WHERE f.sourceBatchId=b.id)
    ORDER BY COALESCE(b.completedAt,b.updatedAt,b.createdAt) DESC,b.id DESC
    LIMIT 1
  `).get()?.periodEnd;
  return batchDate || database.prepare("SELECT MAX(saleDate) periodEnd FROM connection_sku_sales_daily_facts").get()?.periodEnd || "";
}

export function resolveConnectionCockpitDateWindow(database, input = {}) {
  const anchorDate = latestCompleteSalesDate(database);
  if (!anchorDate && !input.startDate && !input.endDate) return null;
  const range = resolveLinkSalesRankingRange({ preset: input.preset || "30d", startDate: input.startDate, endDate: input.endDate }, anchorDate);
  const windowDays = Math.round((Date.parse(`${range.endDate}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) / 86400000) + 1;
  const previousEnd = dateShift(range.startDate, -1);
  const previousStart = dateShift(range.startDate, -windowDays);
  const currentDateCount = Number(database.prepare("SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?").get(range.startDate, range.endDate)?.count || 0);
  const previousDateCount = Number(database.prepare("SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?").get(previousStart, previousEnd)?.count || 0);
  return {
    preset: range.preset,
    periodStart: range.startDate,
    periodEnd: range.endDate,
    previousStart,
    previousEnd,
    windowDays,
    currentDateCount,
    previousDateCount,
    currentPeriodComplete: currentDateCount === windowDays,
    previousPeriodComplete: previousDateCount === windowDays,
  };
}
