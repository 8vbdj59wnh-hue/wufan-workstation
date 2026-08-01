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
  const payBuyerCount = rows.reduce((sum, row) => sum + Number(row.payBuyerCount || 0), 0);
  const weightedConversion = rows.reduce((sum, row) => sum + Number(row.conversionRate || 0) * Number(row.visitorCount || 0), 0);
  const payAmount = rows.reduce((sum, row) => sum + Number(row.payAmount || 0), 0);
  const payQuantity = rows.reduce((sum, row) => sum + Number(row.payQuantity || 0), 0);
  return {
    periodStart: rows[0].periodStart,
    periodEnd: rows[0].periodEnd,
    periodType: rows[0].periodType,
    payAmount,
    visitorCount,
    payBuyerCount,
    payQuantity,
    conversionRate: visitorCount > 0 ? weightedConversion / visitorCount : null,
    customerValue: payQuantity > 0 ? payAmount / payQuantity : null,
  };
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

function analyze(profile, snapshotRows) {
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
  if (!currentPeriod) return { ...profile, currentPeriod: null, previousPeriod: null, comparable: false,
    salesGrowth: null, visitorGrowth: null, conversionChange: null, customerValueChange: null,
    healthScore: null, healthStatus: "no_data" };
  if (!previousPeriod) return { ...profile, currentPeriod, previousPeriod: null, comparable: false,
    salesGrowth: null, visitorGrowth: null, conversionChange: null, customerValueChange: null,
    healthScore: null, healthStatus: "insufficient_data" };
  const salesGrowth = ratio(currentPeriod.payAmount, previousPeriod.payAmount);
  const visitorGrowth = ratio(currentPeriod.visitorCount, previousPeriod.visitorCount);
  const conversionChange = currentPeriod.conversionRate === null || previousPeriod.conversionRate === null
    ? null : currentPeriod.conversionRate - previousPeriod.conversionRate;
  const customerValueChange = ratio(currentPeriod.customerValue, previousPeriod.customerValue);
  const healthScore = Math.round(scoreGrowth(salesGrowth, 40) + scoreGrowth(visitorGrowth, 30) + scoreConversion(conversionChange));
  return { ...profile, currentPeriod, previousPeriod, comparable: true, salesGrowth, visitorGrowth,
    conversionChange, customerValueChange, healthScore, healthStatus: healthStatus(healthScore) };
}

function allAnalyses() {
  const database = getDatabase();
  const profiles = database.prepare(`
    SELECT c.id AS connectionId,c.salesLinkId,c.name,c.status,s.platform,s.displayName AS shopDisplayName,s.shopName
    FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops s ON s.id=l.shopId
  `).all();
  if (!profiles.length) return [];
  const snapshots = database.prepare(`
    SELECT salesLinkId,periodStart,periodEnd,periodType,visitorCount,payBuyerCount,conversionRate,payAmount,payQuantity
    FROM connection_period_snapshots ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC
  `).all();
  const bySalesLink = new Map();
  for (const row of snapshots) {
    const rows = bySalesLink.get(row.salesLinkId) ?? [];
    rows.push(row);
    bySalesLink.set(row.salesLinkId, rows);
  }
  return profiles.map((profile) => analyze(profile, bySalesLink.get(profile.salesLinkId) ?? []));
}

export function getConnectionGrowthAnalysis(connectionId) {
  const analysis = allAnalyses().find((item) => item.connectionId === text(connectionId));
  if (!analysis) throw new Error("未找到连接档案。");
  return analysis;
}

export function listConnectionGrowthRankings(sort = "overview", limit = 10) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const analyses = allAnalyses();
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
  return { topGrowth, declining, salesTop, risks };
}
