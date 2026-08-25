import { getDatabase } from "./db.js";
import { buildLinkOperatingScope } from "./linkOperatingSetService.js";
import { LINK_ASSET_SELECT_SQL } from "./linkAssetSql.js";

function text(value) {
  return String(value ?? "").trim();
}

function ratio(current, previous) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

function periodValue(rows) {
  const visitorCount = rows.reduce((sum, row) => sum + Number(row.visitorCount || 0), 0);
  const viewCount = rows.reduce((sum, row) => sum + Number(row.viewCount || 0), 0);
  const cartCount = rows.reduce((sum, row) => sum + Number(row.cartCount || 0), 0);
  const orderBuyerCount = rows.reduce((sum, row) => sum + Number(row.orderBuyerCount || 0), 0);
  const payBuyerCount = rows.reduce((sum, row) => sum + Number(row.payBuyerCount || 0), 0);
  const weightedConversion = rows.reduce((sum, row) => sum + Number(row.conversionRate || 0) * Number(row.visitorCount || 0), 0);
  return {
    snapshotId: rows[0].id,
    periodStart: rows[0].periodStart,
    periodEnd: rows[0].periodEnd,
    periodType: rows[0].periodType,
    payAmount: 0,
    visitorCount,
    viewCount,
    cartCount,
    orderBuyerCount,
    payBuyerCount,
    payQuantity: 0,
    conversionRate: visitorCount > 0 ? weightedConversion / visitorCount : null,
    customerValue: null,
  };
}

function formalFactsForPeriod(rows, period) {
  const selected = rows.filter((row) => row.saleDate >= period.periodStart && row.saleDate <= period.periodEnd);
  const salesAmount = selected.reduce((sum, row) => sum + Number(row.salesAmount || 0), 0);
  const payQuantity = selected.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const cost = selected.reduce((sum, row) => sum + Number(row.costAmount || 0), 0);
  const netProfit = selected.reduce((sum, row) => sum + Number(row.profitAmount || 0), 0);
  period.payAmount = salesAmount;
  period.payQuantity = payQuantity;
  period.customerValue = payQuantity > 0 ? salesAmount / payQuantity : null;
  return { revenue: salesAmount, cost, expense: 0, grossProfit: netProfit, netProfit,
    profitMargin: salesAmount ? netProfit / salesAmount : null };
}

function analyze(profile, snapshotRows, dailyRows = []) {
  const byPeriod = new Map();
  for (const row of snapshotRows) {
    const key = `${row.periodStart}|${row.periodEnd}`;
    const periodRows = byPeriod.get(key) ?? [];
    periodRows.push(row);
    byPeriod.set(key, periodRows);
  }
  const periods = [...byPeriod.values()].map(periodValue)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.periodStart.localeCompare(a.periodStart));
  const currentPeriod = periods[0] ?? null;
  const previousPeriod = periods[1] ?? null;
  if (!currentPeriod) return { ...profile, currentPeriod: null, previousPeriod: null, currentFinance: null, previousFinance: null, profitGrowth: null, comparable: false,
    salesGrowth: null, visitorGrowth: null, conversionChange: null, customerValueChange: null };
  const currentFinance = formalFactsForPeriod(dailyRows, currentPeriod);
  if (!previousPeriod) return { ...profile, currentPeriod, previousPeriod: null, currentFinance, previousFinance: null, profitGrowth: null, comparable: false,
    salesGrowth: null, visitorGrowth: null, conversionChange: null, customerValueChange: null };
  const salesGrowth = ratio(currentPeriod.payAmount, previousPeriod.payAmount);
  const visitorGrowth = ratio(currentPeriod.visitorCount, previousPeriod.visitorCount);
  const conversionChange = currentPeriod.conversionRate === null || previousPeriod.conversionRate === null
    ? null : currentPeriod.conversionRate - previousPeriod.conversionRate;
  const customerValueChange = ratio(currentPeriod.customerValue, previousPeriod.customerValue);
  const previousFinance = formalFactsForPeriod(dailyRows, previousPeriod);
  const profitGrowth = ratio(currentFinance?.netProfit ?? null, previousFinance?.netProfit ?? null);
  return { ...profile, currentPeriod, previousPeriod, currentFinance, previousFinance, profitGrowth, comparable: true, salesGrowth, visitorGrowth,
    conversionChange, customerValueChange };
}

function listConnectionGrowthAnalysesForIds(connectionIds = null, { includeHistorical = false } = {}) {
  const database = getDatabase();
  const ids = connectionIds === null ? null : [...new Set(connectionIds.map(text).filter(Boolean))];
  if (ids !== null && !ids.length) return [];
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "connectionGrowthOperating" });
  const where = [];
  const params = {};
  if (!includeHistorical) { where.push(operatingScope.predicate); Object.assign(params, operatingScope.params); }
  if (ids !== null) {
    const keys = ids.map((id, index) => { params[`connectionGrowthId${index}`] = id; return `@connectionGrowthId${index}`; });
    where.push(`c.id IN (${keys.join(",")})`);
  }
  const profileWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const profiles = database.prepare(`
    SELECT c.id AS connectionId,c.salesLinkId,c.name,c.ownerId,c.status,s.platform,s.displayName AS shopDisplayName,s.shopName,
           COALESCE(p.name,'未分配') AS ownerName
    FROM ${LINK_ASSET_SELECT_SQL} c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN persons p ON p.id=c.ownerId ${profileWhere}
  `).all(params);
  if (!profiles.length) return [];
  const salesLinkIds = profiles.map((item) => item.salesLinkId);
  const salesLinkMarks = salesLinkIds.map(() => "?").join(",");
  const snapshots = database.prepare(`
    SELECT id,salesLinkId,periodStart,periodEnd,periodType,visitorCount,viewCount,cartCount,orderBuyerCount,payBuyerCount,conversionRate
    FROM connection_period_snapshots WHERE salesLinkId IN (${salesLinkMarks}) ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC
  `).all(...salesLinkIds);
  const bySalesLink = new Map();
  for (const row of snapshots) {
    const rows = bySalesLink.get(row.salesLinkId) ?? [];
    rows.push(row);
    bySalesLink.set(row.salesLinkId, rows);
  }
  const dailyRows = database.prepare(`SELECT salesLinkId,saleDate,salesAmount,quantity,costAmount,profitAmount
    FROM connection_sku_sales_daily_facts WHERE salesLinkId IN (${salesLinkMarks})`).all(...salesLinkIds);
  const dailyBySalesLink = new Map();
  for (const row of dailyRows) {
    const rows = dailyBySalesLink.get(row.salesLinkId) ?? [];
    rows.push(row);
    dailyBySalesLink.set(row.salesLinkId, rows);
  }
  return profiles.map((profile) => analyze(profile, bySalesLink.get(profile.salesLinkId) ?? [], dailyBySalesLink.get(profile.salesLinkId) ?? []));
}

export function listConnectionGrowthAnalyses() {
  return listConnectionGrowthAnalysesForIds(null);
}

export function listConnectionGrowthAnalysesByConnectionIds(connectionIds = []) {
  return listConnectionGrowthAnalysesForIds(connectionIds, { includeHistorical: true });
}

export function getConnectionGrowthAnalysis(connectionId) {
  const analysis = listConnectionGrowthAnalysesForIds([connectionId], { includeHistorical: true })[0];
  if (!analysis) throw new Error("未找到连接档案。");
  return analysis;
}

export function listConnectionGrowthRankings(sort = "overview", limit = 10, userId = "", isAdmin = false) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const analyses = listConnectionGrowthAnalyses().filter((item) => isAdmin || item.ownerId === text(userId));
  const comparable = analyses.filter((item) => item.comparable);
  const topGrowth = [...comparable].sort((a, b) => b.salesGrowth - a.salesGrowth).slice(0, safeLimit);
  const declining = [...comparable].sort((a, b) => a.salesGrowth - b.salesGrowth).slice(0, safeLimit);
  const salesTop = analyses.filter((item) => item.currentPeriod)
    .sort((a, b) => b.currentPeriod.payAmount - a.currentPeriod.payAmount).slice(0, safeLimit);
  const risks = [];
  if (sort === "growth") return { items: topGrowth };
  if (sort === "decline") return { items: declining };
  if (sort === "sales") return { items: salesTop };
  const listMetrics = analyses.map((item) => ({
    connectionId: item.connectionId,
    salesGrowth: item.salesGrowth,
    visitorGrowth: item.visitorGrowth,
    conversionChange: item.conversionChange,
    currentFinance: item.currentFinance,
    profitGrowth: item.profitGrowth,
  }));
  return { topGrowth, declining, salesTop, risks, listMetrics };
}

export function getConnectionManagementOverview(userId = "", isAdmin = false) {
  const database = getDatabase();
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "connectionManagementOperating" });
  const analyses = listConnectionGrowthAnalyses().filter((item) => isAdmin || item.ownerId === text(userId));
  const comparable = analyses.filter((item) => item.comparable);
  const effectiveByOwner = new Map();
  const ownerMap = new Map();
  for (const item of analyses) {
    const ownerId = item.ownerId || "unassigned";
    const current = ownerMap.get(ownerId) ?? { ownerId, ownerName: item.ownerName || "未分配", connectionCount: 0,
      salesAmount: 0, netProfit: 0, comparableCount: 0, growthTotal: 0, riskCount: 0, effectiveImprovements: effectiveByOwner.get(ownerId) || 0 };
    current.connectionCount += 1;
    current.salesAmount += Number(item.currentPeriod?.payAmount || 0);
    current.netProfit += Number(item.currentFinance?.netProfit || 0);
    if (item.salesGrowth !== null) { current.comparableCount += 1; current.growthTotal += Number(item.salesGrowth); }
    if (Number(item.salesGrowth) < -0.2 || Number(item.profitGrowth) < -0.2) current.riskCount += 1;
    ownerMap.set(ownerId, current);
  }
  const owners = [...ownerMap.values()].map((item) => ({ ...item,
    averageGrowth: item.comparableCount ? item.growthTotal / item.comparableCount : null }))
    .sort((a, b) => b.salesAmount - a.salesAmount || b.netProfit - a.netProfit);
  return {
    summary: {
      connectionCount: analyses.length,
      activeCount: analyses.filter((item) => item.status === "active").length,
      salesAmount: analyses.reduce((sum, item) => sum + Number(item.currentPeriod?.payAmount || 0), 0),
      netProfit: analyses.reduce((sum, item) => sum + Number(item.currentFinance?.netProfit || 0), 0),
      averageGrowth: comparable.length ? comparable.reduce((sum, item) => sum + Number(item.salesGrowth || 0), 0) / comparable.length : null,
      riskCount: analyses.filter((item) => Number(item.salesGrowth) < -0.2 || Number(item.profitGrowth) < -0.2).length,
    },
    owners,
  };
}
