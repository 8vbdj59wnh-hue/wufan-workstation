import { getDatabase } from "./db.js";
import { queryDailySalesSummaryComparison, queryDailySalesTrend } from "./capabilities/queryDailySales.js";
import { querySalesDailyDataQuality } from "./salesDailyDataQualityService.js";

const DASHBOARD_CONTRACT_VERSION = "2.0";
const PRESET_DAYS = Object.freeze({ yesterday: 1, "7d": 7, "15d": 15, "30d": 30, "45d": 45, "60d": 60 });

function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function validDate(value) {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? "" : date;
}

function daysBetween(startDate, endDate) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
}

function growth(current, previous) {
  const currentValue = Number(current || 0); const previousValue = Number(previous || 0);
  if (previousValue === 0) return currentValue > 0 ? null : 0;
  return (currentValue - previousValue) / Math.abs(previousValue);
}

function comparisonStatus(current, previous) {
  if (Number(previous || 0) === 0 && Number(current || 0) > 0) return "new";
  if (Number(previous || 0) === 0 && Number(current || 0) === 0) return "flat";
  return "comparable";
}

function resolveRange(input, latestDate) {
  const requestedPreset = String(input.preset ?? "7d").trim();
  const preset = requestedPreset === "custom" || PRESET_DAYS[requestedPreset] ? requestedPreset : "7d";
  let endDate = latestDate; let startDate;
  if (preset === "custom") {
    startDate = validDate(input.startDate); endDate = validDate(input.endDate);
    if (!startDate || !endDate || startDate > endDate) throw new Error("自定义日期范围无效。");
    if (endDate > latestDate) endDate = latestDate;
    if (startDate > endDate) throw new Error(`销售日报数据仅更新至 ${latestDate}。`);
  } else {
    startDate = addDays(endDate, -(PRESET_DAYS[preset] - 1));
  }
  const windowDays = daysBetween(startDate, endDate);
  if (windowDays > 366) throw new Error("自定义周期最多支持366天。");
  const previousEndDate = addDays(startDate, -1);
  const previousStartDate = addDays(previousEndDate, -(windowDays - 1));
  return { preset, startDate, endDate, windowDays, previousStartDate, previousEndDate };
}

function readExtendedSummary(database, startDate, endDate) {
  const row = database.prepare(`SELECT COUNT(*) dataCount,COUNT(DISTINCT saleDate) dataDays,
    SUM(COALESCE(quantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,
    SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount,
    SUM(COALESCE(refundAmount,0)) refundAmount,SUM(COALESCE(feeAmount,0)) feeAmount,
    SUM(COALESCE(receivedAmount,0)) receivedAmount,SUM(COALESCE(incomeAmount,0)) incomeAmount
    FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?`).get(startDate, endDate);
  const salesAmount = Number(row.salesAmount || 0); const profitAmount = Number(row.profitAmount || 0);
  return { dataCount: Number(row.dataCount || 0), dataDays: Number(row.dataDays || 0), quantity: Number(row.quantity || 0), salesAmount,
    costAmount: Number(row.costAmount || 0), profitAmount, profitMargin: salesAmount ? profitAmount / salesAmount : null,
    refundAmount: Number(row.refundAmount || 0), feeAmount: Number(row.feeAmount || 0), receivedAmount: Number(row.receivedAmount || 0),
    incomeAmount: Number(row.incomeAmount || 0), paidPromotionAmount: null, paidPromotionRatio: null };
}

function decorateComparison(item) {
  const currentSalesAmount = Number(item.currentSalesAmount || 0); const compareSalesAmount = Number(item.compareSalesAmount || 0);
  const currentProfitAmount = Number(item.currentProfitAmount || 0); const compareProfitAmount = Number(item.compareProfitAmount || 0);
  return { ...item, currentSalesAmount, compareSalesAmount, currentProfitAmount, compareProfitAmount,
    currentProfitMargin: currentSalesAmount ? currentProfitAmount / currentSalesAmount : null,
    salesGrowth: growth(currentSalesAmount, compareSalesAmount), profitGrowth: growth(currentProfitAmount, compareProfitAmount),
    salesComparisonStatus: comparisonStatus(currentSalesAmount, compareSalesAmount), profitComparisonStatus: comparisonStatus(currentProfitAmount, compareProfitAmount) };
}

function readShopComparison(database, range) {
  return database.prepare(`SELECT s.id targetId,COALESCE(NULLIF(s.displayName,''),s.shopName,'未命名店铺') targetName,s.platform targetCode,
    SUM(CASE WHEN f.saleDate BETWEEN @startDate AND @endDate THEN f.salesAmount ELSE 0 END) currentSalesAmount,
    SUM(CASE WHEN f.saleDate BETWEEN @previousStartDate AND @previousEndDate THEN f.salesAmount ELSE 0 END) compareSalesAmount,
    SUM(CASE WHEN f.saleDate BETWEEN @startDate AND @endDate THEN f.profitAmount ELSE 0 END) currentProfitAmount,
    SUM(CASE WHEN f.saleDate BETWEEN @previousStartDate AND @previousEndDate THEN f.profitAmount ELSE 0 END) compareProfitAmount,
    COUNT(DISTINCT CASE WHEN f.saleDate BETWEEN @startDate AND @endDate THEN f.saleDate END) currentDataDays
    FROM connection_sku_sales_daily_facts f JOIN sales_links l ON l.id=f.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    WHERE f.saleDate BETWEEN @previousStartDate AND @endDate
    GROUP BY s.id,COALESCE(NULLIF(s.displayName,''),s.shopName,'未命名店铺'),s.platform`).all(range).map(decorateComparison);
}

function readComparison(dimension, range, database) {
  const result = queryDailySalesSummaryComparison({ dimension, currentStart: range.startDate, currentEnd: range.endDate,
    compareStart: range.previousStartDate, compareEnd: range.previousEndDate }, { database });
  const items = result.items.map(decorateComparison);
  const table = dimension === "salesLink" ? "sales_links" : dimension === "product" ? "products" : "";
  const ids = [...new Set(items.map((item) => item.targetId).filter(Boolean))];
  if (!table || !ids.length) return items;
  const images = new Map(database.prepare(`SELECT id,mainImage FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids).map((item) => [item.id, item.mainImage || null]));
  return items.map((item) => ({ ...item, mainImage: images.get(item.targetId) || null }));
}

function sorted(items, metric, direction = "desc") {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...items].sort((left, right) => multiplier * (Number(left[metric] || 0) - Number(right[metric] || 0)) || String(left.targetName || "").localeCompare(String(right.targetName || ""), "zh-CN"));
}

export function getSalesBusinessDashboard(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const quality = querySalesDailyDataQuality({ database });
  if (!quality.hasData) return { capability: "SalesBusinessDashboard", contractVersion: DASHBOARD_CONTRACT_VERSION, preset: "7d", hasData: false, quality };
  const range = resolveRange(input, quality.batch.dateEnd); const queryOptions = { database };
  const summary = readExtendedSummary(database, range.startDate, range.endDate);
  const previousSummary = readExtendedSummary(database, range.previousStartDate, range.previousEndDate);
  const trend = queryDailySalesTrend({ dimension: "company", targetId: "", startDate: range.startDate, endDate: range.endDate }, queryOptions);
  const shops = readShopComparison(database, range);
  const links = readComparison("salesLink", range, database);
  const products = readComparison("product", range, database);
  const dataCoverage = range.windowDays ? summary.dataDays / range.windowDays : null;
  const summaryComparison = { salesGrowth: growth(summary.salesAmount, previousSummary.salesAmount), profitGrowth: growth(summary.profitAmount, previousSummary.profitAmount),
    salesComparisonStatus: comparisonStatus(summary.salesAmount, previousSummary.salesAmount), profitComparisonStatus: comparisonStatus(summary.profitAmount, previousSummary.profitAmount) };
  return {
    capability: "SalesBusinessDashboard", contractVersion: DASHBOARD_CONTRACT_VERSION, ...range, hasData: summary.dataCount > 0,
    comparisonLabel: `对比 ${range.previousStartDate} 至 ${range.previousEndDate}`,
    summary: { ...summary, dataCoverage }, previousSummary, summaryComparison, trend,
    shops: { items: sorted(shops, "currentSalesAmount").slice(0, 50), hasData: shops.length > 0 },
    rankings: {
      shop: { items: shops }, link: { items: links }, product: { items: products },
    },
    quality,
    metricAvailability: { paidPromotionAmount: { available: false, reason: "当前销售日报未提供独立付费推广费用字段" } },
    sources: ["connection_sku_sales_daily_facts", "QueryDailySalesTrend", "QueryDailySalesSummaryComparison", "QuerySalesDailyDataQuality"],
  };
}

export default getSalesBusinessDashboard;
