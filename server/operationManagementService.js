import { getDatabase } from "./db.js";
import { listConnectionGrowthRankings } from "./connectionGrowthService.js";
import { listAttentionConnectionHealthRecords } from "./connectionHealthService.js";
import { getConnectionImprovementSummary } from "./connectionImprovementService.js";
import { getProductBusinessReadModel } from "./productBusinessReadModel.js";

export const operationMetricDefinitions = Object.freeze({
  productSales: { key: "product.totalPhysicalContribution30d", label: "产品近30天实际出货贡献", source: "Daily Facts + Sales Object BOM", aggregation: "Single直接销量 + Bundle销售套数×BOM组件数量；Bundle金额不分摊" },
  stock: { key: "inventory.actualStock", label: "实际库存", source: "erp_sku_inventory_daily_summaries.stockNum", aggregation: "每个ERP SKU最新库存事实按产品汇总" },
  capital: { key: "inventory.capitalOccupation", label: "库存资金占用", source: "erp_sku_inventory_daily_summaries.inventoryCostAmount", aggregation: "每个ERP SKU最新库存金额按产品汇总；缺失字段不估算" },
  connectionSales: { key: "connection.payAmount", label: "连接周期销售额", source: "connection_period_snapshots.payAmount", aggregation: "最新经营周期按销售连接求和" },
  connectionGrowth: { key: "connection.salesGrowth", label: "连接销售增长率", source: "connection_period_snapshots.payAmount", aggregation: "(当前周期-上一周期)/上一周期" },
});

function number(value) {
  return value === null || value === undefined ? null : Number(value);
}

function readProductDashboard(database) {
  const latestSaleDate = database.prepare("SELECT MAX(saleDate) value FROM connection_sku_sales_daily_facts").get()?.value;
  const query = latestSaleDate ? { range: "custom", periodStart: new Date(`${latestSaleDate}T00:00:00Z`).toISOString().slice(0, 10), periodEnd: latestSaleDate } : { range: "30d" };
  if (latestSaleDate) { const start = new Date(`${latestSaleDate}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 29); query.periodStart = start.toISOString().slice(0, 10); }
  const model = getProductBusinessReadModel(query, { includeInventoryCost: true, unpaged: true });
  const items = model.items.map((item) => ({ productId: item.id, productName: item.name, skuCode: item.sku, mainImage: item.image,
    sales30d: item.sales.totalPhysicalContribution, directSales30d: item.sales.directQuantity, bundleContribution30d: item.sales.bundleContributionQuantity,
    totalStock: item.inventory.quantity, salesGrowth: item.sales.trend.rate }));
  const sum = (read) => { const values = model.items.map(read).filter((value) => value !== null && value !== undefined); return values.length ? values.reduce((total, value) => total + Number(value), 0) : null; };
  const costItems = model.items.filter((item) => item.inventory.amount !== null);
  const summary = { latestBusinessDate: model.period.periodEnd, productCount: model.summary.totalProducts,
    sales30d: model.summary.totalPhysicalContribution, previousSales30d: sum((item) => item.sales.previousQuantity),
    salesGrowth: null, totalStock: model.summary.inventoryQuantity, actualStock: model.summary.inventoryQuantity,
    capitalOccupation: sum((item) => item.inventory.amount), capitalCoverage: model.items.length ? costItems.length / model.items.length : 0 };
  summary.salesGrowth = summary.previousSales30d && summary.sales30d !== null ? (summary.sales30d - summary.previousSales30d) / Math.abs(summary.previousSales30d) : null;
  const rankings = { salesTop: [...items].sort((a, b) => (b.sales30d ?? -1) - (a.sales30d ?? -1)).slice(0, 10),
    growthTop: items.filter((item) => item.salesGrowth !== null).sort((a, b) => b.salesGrowth - a.salesGrowth).slice(0, 10),
    risks: items.filter((item) => item.salesGrowth !== null && item.salesGrowth < -0.1).sort((a, b) => a.salesGrowth - b.salesGrowth).slice(0, 10) };
  const daily = model.physicalTrend.slice(-14).map((item) => ({ date: item.date, sales30d: item.totalPhysicalContribution }));
  const latestStock = summary.actualStock;
  return { model, summary, rankings, trend: daily.map((row) => ({ date: row.date, sales30d: number(row.sales30d), stock: latestStock })) };
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
  const product = readProductDashboard(database);
  const productAnalysis = product.rankings;
  const connectionRankings = listConnectionGrowthRankings("overview", 10, "", true);
  const attention = listAttentionConnectionHealthRecords("", true);
  return {
    generatedAt: new Date().toISOString(),
    definitions: operationMetricDefinitions,
    company: {
      products: product.summary,
      connections: latestConnectionSummary(database),
      risks: { connectionRisk: attention.counts.risk, connectionAttention: attention.counts.attention, decliningProducts: productAnalysis.risks.length },
    },
    trend: product.trend,
    products: productAnalysis,
    connections: { topGrowth: connectionRankings.topGrowth, risks: connectionRankings.risks, salesTop: connectionRankings.salesTop },
    execution: executionSummary(database),
    improvements: getConnectionImprovementSummary("", true),
    finance: { available: false, message: "财务基础数据尚未接入；利润指标不作估算。" },
  };
}
