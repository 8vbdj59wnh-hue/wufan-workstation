import { getDatabase } from "./db.js";

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
  const payAmount = rows.reduce((sum, row) => sum + Number(row.payAmount || 0), 0);
  const payQuantity = rows.reduce((sum, row) => sum + Number(row.payQuantity || 0), 0);
  return {
    snapshotId: rows[0].id,
    periodStart: rows[0].periodStart,
    periodEnd: rows[0].periodEnd,
    periodType: rows[0].periodType,
    payAmount,
    visitorCount,
    viewCount,
    cartCount,
    orderBuyerCount,
    payBuyerCount,
    payQuantity,
    conversionRate: visitorCount > 0 ? weightedConversion / visitorCount : null,
    customerValue: payQuantity > 0 ? payAmount / payQuantity : null,
  };
}

function financeValue(rows) {
  if (!rows.length) return null;
  const sum = (type) => rows.filter((row) => row.entryType === type).reduce((total, row) => total + Number(row.amount || 0), 0);
  const revenue = sum("income") - sum("refund");
  const cost = sum("cost");
  const expense = sum("expense");
  const grossProfit = revenue - cost;
  const netProfit = grossProfit - expense;
  return { revenue, cost, expense, grossProfit, netProfit, profitMargin: revenue ? netProfit / revenue : null };
}

function financeForPeriod(rows, period) {
  if (!period) return null;
  return financeValue(rows.filter((row) => row.businessDate >= period.periodStart && row.businessDate <= period.periodEnd));
}

function scoreGrowth(value, weight) {
  if (value === null) return weight * 0.5;
  if (value > 0.1) return weight;
  if (value >= 0) return weight * 0.8;
  if (value > -0.2) return weight * 0.6;
  return weight * 0.2;
}

function scoreConversion(change) {
  if (change === null) return 15;
  if (change >= 0.01) return 30;
  if (change >= 0) return 24;
  if (change > -0.01) return 18;
  return 6;
}

function healthStatus(score) {
  if (score >= 80) return "growing";
  if (score >= 60) return "stable";
  if (score >= 40) return "attention";
  return "risk";
}

function analyze(profile, snapshotRows, financeRows = []) {
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
    salesGrowth: null, visitorGrowth: null, conversionChange: null, customerValueChange: null,
    healthScore: null, healthStatus: "no_data" };
  const currentFinance = financeForPeriod(financeRows, currentPeriod);
  if (!previousPeriod) return { ...profile, currentPeriod, previousPeriod: null, currentFinance, previousFinance: null, profitGrowth: null, comparable: false,
    salesGrowth: null, visitorGrowth: null, conversionChange: null, customerValueChange: null,
    healthScore: null, healthStatus: "insufficient_data" };
  const salesGrowth = ratio(currentPeriod.payAmount, previousPeriod.payAmount);
  const visitorGrowth = ratio(currentPeriod.visitorCount, previousPeriod.visitorCount);
  const conversionChange = currentPeriod.conversionRate === null || previousPeriod.conversionRate === null
    ? null : currentPeriod.conversionRate - previousPeriod.conversionRate;
  const customerValueChange = ratio(currentPeriod.customerValue, previousPeriod.customerValue);
  const previousFinance = financeForPeriod(financeRows, previousPeriod);
  const profitGrowth = ratio(currentFinance?.netProfit ?? null, previousFinance?.netProfit ?? null);
  const healthScore = Math.round(scoreGrowth(salesGrowth, 40) + scoreGrowth(visitorGrowth, 30) + scoreConversion(conversionChange));
  return { ...profile, currentPeriod, previousPeriod, currentFinance, previousFinance, profitGrowth, comparable: true, salesGrowth, visitorGrowth,
    conversionChange, customerValueChange, healthScore, healthStatus: healthStatus(healthScore) };
}

export function listConnectionGrowthAnalyses() {
  const database = getDatabase();
  const profiles = database.prepare(`
    SELECT c.id AS connectionId,c.salesLinkId,c.name,c.ownerId,c.status,s.platform,s.displayName AS shopDisplayName,s.shopName,
           COALESCE(p.name,'未分配') AS ownerName
    FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN persons p ON p.id=c.ownerId
  `).all();
  if (!profiles.length) return [];
  const snapshots = database.prepare(`
    SELECT id,salesLinkId,periodStart,periodEnd,periodType,visitorCount,viewCount,cartCount,orderBuyerCount,payBuyerCount,conversionRate,payAmount,payQuantity
    FROM connection_period_snapshots ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC
  `).all();
  const bySalesLink = new Map();
  for (const row of snapshots) {
    const rows = bySalesLink.get(row.salesLinkId) ?? [];
    rows.push(row);
    bySalesLink.set(row.salesLinkId, rows);
  }
  const financeRows = database.prepare(`SELECT salesLinkId,businessDate,entryType,amount FROM finance_entries
    WHERE salesLinkId IS NOT NULL AND status IN ('confirmed','approved')`).all();
  const financeBySalesLink = new Map();
  for (const row of financeRows) {
    const rows = financeBySalesLink.get(row.salesLinkId) ?? [];
    rows.push(row);
    financeBySalesLink.set(row.salesLinkId, rows);
  }
  return profiles.map((profile) => analyze(profile, bySalesLink.get(profile.salesLinkId) ?? [], financeBySalesLink.get(profile.salesLinkId) ?? []));
}

export function getConnectionGrowthAnalysis(connectionId) {
  const analysis = listConnectionGrowthAnalyses().find((item) => item.connectionId === text(connectionId));
  if (!analysis) throw new Error("未找到连接档案。");
  return analysis;
}

export function listConnectionGrowthRankings(sort = "overview", limit = 10) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const analyses = listConnectionGrowthAnalyses();
  const comparable = analyses.filter((item) => item.comparable);
  const topGrowth = [...comparable].sort((a, b) => b.salesGrowth - a.salesGrowth).slice(0, safeLimit);
  const declining = [...comparable].sort((a, b) => a.salesGrowth - b.salesGrowth).slice(0, safeLimit);
  const salesTop = analyses.filter((item) => item.currentPeriod)
    .sort((a, b) => b.currentPeriod.payAmount - a.currentPeriod.payAmount).slice(0, safeLimit);
  const risks = comparable.filter((item) => item.healthScore < 60)
    .sort((a, b) => a.healthScore - b.healthScore).slice(0, safeLimit);
  if (sort === "growth") return { items: topGrowth };
  if (sort === "decline") return { items: declining };
  if (sort === "sales") return { items: salesTop };
  const listMetrics = analyses.map((item) => ({
    connectionId: item.connectionId,
    salesGrowth: item.salesGrowth,
    visitorGrowth: item.visitorGrowth,
    conversionChange: item.conversionChange,
    healthScore: item.healthScore,
    healthStatus: item.healthStatus,
    currentFinance: item.currentFinance,
    profitGrowth: item.profitGrowth,
  }));
  return { topGrowth, declining, salesTop, risks, listMetrics };
}

export function getConnectionManagementOverview() {
  const database = getDatabase();
  const analyses = listConnectionGrowthAnalyses();
  const comparable = analyses.filter((item) => item.comparable);
  const effectiveByOwner = new Map(database.prepare(`
    SELECT COALESCE(c.ownerId,'unassigned') ownerId,COUNT(*) count
    FROM connection_improvements i JOIN connection_profiles c ON c.id=i.connectionId
    WHERE i.status='effective' GROUP BY COALESCE(c.ownerId,'unassigned')
  `).all().map((row) => [row.ownerId, Number(row.count || 0)]));
  const ownerMap = new Map();
  for (const item of analyses) {
    const ownerId = item.ownerId || "unassigned";
    const current = ownerMap.get(ownerId) ?? { ownerId, ownerName: item.ownerName || "未分配", connectionCount: 0,
      salesAmount: 0, netProfit: 0, comparableCount: 0, growthTotal: 0, riskCount: 0, effectiveImprovements: effectiveByOwner.get(ownerId) || 0 };
    current.connectionCount += 1;
    current.salesAmount += Number(item.currentPeriod?.payAmount || 0);
    current.netProfit += Number(item.currentFinance?.netProfit || 0);
    if (item.salesGrowth !== null) { current.comparableCount += 1; current.growthTotal += Number(item.salesGrowth); }
    if (item.healthScore !== null && item.healthScore < 60) current.riskCount += 1;
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
      riskCount: analyses.filter((item) => item.healthScore !== null && item.healthScore < 60).length,
    },
    owners,
  };
}
