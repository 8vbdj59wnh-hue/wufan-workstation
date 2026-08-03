import { getDatabase } from "./db.js";
import { listConnectionGrowthRankings } from "./connectionGrowthService.js";
import { listAttentionConnectionHealthRecords } from "./connectionHealthService.js";
import { getConnectionImprovementSummary } from "./connectionImprovementService.js";

export const operationMetricDefinitions = Object.freeze({
  productSales: { key: "product.sales30d", label: "产品近30天销量", source: "product_daily_snapshots.sales30d", aggregation: "最新正式快照按产品求和" },
  stock: { key: "inventory.actualStock", label: "实际库存", source: "product_erp_daily_snapshots.actualStock", aggregation: "最新正式快照按ERP规格求和" },
  capital: { key: "inventory.capitalOccupation", label: "库存资金占用", source: "actualStock × unitCost", aggregation: "最新正式快照逐规格计算后求和；缺失字段不估算" },
  connectionSales: { key: "connection.payAmount", label: "连接周期销售额", source: "connection_period_snapshots.payAmount", aggregation: "最新经营周期按销售连接求和" },
  connectionGrowth: { key: "connection.salesGrowth", label: "连接销售增长率", source: "connection_period_snapshots.payAmount", aggregation: "(当前周期-上一周期)/上一周期" },
});

function number(value) {
  return value === null || value === undefined ? null : Number(value);
}

function officialSnapshots(database) {
  return database.prepare(`SELECT id,businessDate FROM erp_fact_snapshots WHERE status='completed' AND isCurrent=1 ORDER BY businessDate`).all();
}

function productSummary(database, snapshots) {
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);
  if (!latest) return { latestBusinessDate: null, sales30d: null, previousSales30d: null, salesGrowth: null, actualStock: null, capitalOccupation: null, capitalCoverage: 0, productCount: 0 };
  const aggregate = (snapshotId) => database.prepare(`
    SELECT COUNT(*) AS productCount,SUM(sales30d) AS sales30d,SUM(totalStock) AS totalStock
    FROM product_daily_snapshots WHERE snapshotId=?
  `).get(snapshotId);
  const current = aggregate(latest.id);
  const prior = previous ? aggregate(previous.id) : null;
  const capital = database.prepare(`
    SELECT COUNT(*) AS specificationCount,
      SUM(CASE WHEN actualStock IS NOT NULL AND unitCost IS NOT NULL THEN 1 ELSE 0 END) AS completeCount,
      SUM(CASE WHEN actualStock IS NOT NULL AND unitCost IS NOT NULL THEN actualStock * unitCost ELSE 0 END) AS amount,
      SUM(actualStock) AS actualStock
    FROM product_erp_daily_snapshots WHERE snapshotId=?
  `).get(latest.id);
  const currentSales = number(current.sales30d);
  const previousSales = number(prior?.sales30d);
  return {
    latestBusinessDate: latest.businessDate,
    productCount: Number(current.productCount || 0),
    sales30d: currentSales,
    previousSales30d: previousSales,
    salesGrowth: previousSales && currentSales !== null ? (currentSales - previousSales) / Math.abs(previousSales) : null,
    totalStock: number(current.totalStock),
    actualStock: number(capital.actualStock),
    capitalOccupation: Number(capital.amount || 0),
    capitalCoverage: capital.specificationCount ? Number(capital.completeCount || 0) / Number(capital.specificationCount) : 0,
  };
}

function productRankings(database, snapshots, limit = 10) {
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);
  if (!latest) return { salesTop: [], growthTop: [], risks: [] };
  const rows = database.prepare(`
    SELECT p.productId,p.productName,p.skuCode,p.sales30d,p.totalStock,products.mainImage
    FROM product_daily_snapshots p LEFT JOIN products ON products.id=p.productId
    WHERE p.snapshotId=?
  `).all(latest.id);
  const prior = previous ? new Map(database.prepare(`SELECT productId,sales30d FROM product_daily_snapshots WHERE snapshotId=?`).all(previous.id).map((row) => [row.productId, number(row.sales30d)])) : new Map();
  const normalized = rows.map((row) => {
    const previousSales = prior.get(row.productId);
    const currentSales = number(row.sales30d);
    return { ...row, sales30d: currentSales, totalStock: number(row.totalStock), salesGrowth: previousSales && currentSales !== null ? (currentSales - previousSales) / Math.abs(previousSales) : null };
  });
  return {
    salesTop: [...normalized].sort((a, b) => (b.sales30d ?? -1) - (a.sales30d ?? -1)).slice(0, limit),
    growthTop: normalized.filter((item) => item.salesGrowth !== null).sort((a, b) => b.salesGrowth - a.salesGrowth).slice(0, limit),
    risks: normalized.filter((item) => item.salesGrowth !== null && item.salesGrowth < -0.1).sort((a, b) => a.salesGrowth - b.salesGrowth).slice(0, limit),
  };
}

function productTrend(database, snapshots) {
  if (!snapshots.length) return [];
  return snapshots.slice(-14).map((snapshot) => {
    const row = database.prepare(`SELECT SUM(sales30d) AS sales30d,SUM(totalStock) AS totalStock FROM product_daily_snapshots WHERE snapshotId=?`).get(snapshot.id);
    return { date: snapshot.businessDate, sales30d: number(row.sales30d), stock: number(row.totalStock) };
  });
}

function executionSummary(database) {
  const count = (table, condition = "1=1") => Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`).get().count || 0);
  return {
    activeGoals: count("goals", "status='active'"),
    runningActions: count("process_instances", "status='running'"),
    importantTasks: count("tasks", "status IN ('todo','doing') AND importance IN ('high','important')"),
    doingTasks: count("tasks", "status='doing'"),
    overdueTasks: count("tasks", "status NOT IN ('done','canceled') AND dueDate IS NOT NULL AND dueDate < date('now','localtime')"),
  };
}

function latestConnectionSummary(database) {
  const latestPeriod = database.prepare(`SELECT periodStart,periodEnd FROM connection_period_snapshots ORDER BY periodEnd DESC,periodStart DESC LIMIT 1`).get();
  if (!latestPeriod) return { periodStart: null, periodEnd: null, payAmount: null, visitorCount: null, conversionRate: null, connectionCount: 0 };
  const row = database.prepare(`
    SELECT COUNT(DISTINCT salesLinkId) AS connectionCount,SUM(payAmount) AS payAmount,SUM(visitorCount) AS visitorCount,
      CASE WHEN SUM(visitorCount)>0 THEN SUM(conversionRate * visitorCount)/SUM(visitorCount) ELSE NULL END AS conversionRate
    FROM connection_period_snapshots WHERE periodStart=? AND periodEnd=?
  `).get(latestPeriod.periodStart, latestPeriod.periodEnd);
  return { ...latestPeriod, connectionCount: Number(row.connectionCount || 0), payAmount: number(row.payAmount), visitorCount: number(row.visitorCount), conversionRate: number(row.conversionRate) };
}

export function getOperationDashboard() {
  const database = getDatabase();
  const snapshots = officialSnapshots(database);
  const productAnalysis = productRankings(database, snapshots);
  const connectionRankings = listConnectionGrowthRankings("overview", 10, "", true);
  const attention = listAttentionConnectionHealthRecords("", true);
  return {
    generatedAt: new Date().toISOString(),
    definitions: operationMetricDefinitions,
    company: {
      products: productSummary(database, snapshots),
      connections: latestConnectionSummary(database),
      risks: { connectionRisk: attention.counts.risk, connectionAttention: attention.counts.attention, decliningProducts: productAnalysis.risks.length },
    },
    trend: productTrend(database, snapshots),
    products: productAnalysis,
    connections: { topGrowth: connectionRankings.topGrowth, risks: connectionRankings.risks, salesTop: connectionRankings.salesTop },
    execution: executionSummary(database),
    improvements: getConnectionImprovementSummary("", true),
    finance: { available: false, message: "财务基础数据尚未接入；利润指标不作估算。" },
  };
}
