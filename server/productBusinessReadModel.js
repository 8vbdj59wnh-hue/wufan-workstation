import { getDatabase } from "./db.js";
import { readProductInventorySupplyMap } from "./inventorySupplyQueryService.js";
import { classifyProductBusinessZones } from "./productManagementV2Service.js";

export const productBusinessLifecycleStatuses = Object.freeze(["新品", "成长", "爆款", "稳定销售", "衰退", "清仓", "归档"]);
export const productBusinessHealthStatuses = Object.freeze(["healthy", "attention", "risk", "no_data"]);
export const productBusinessInventoryStatuses = Object.freeze(["healthy", "attention", "backlog", "stockout", "no_data"]);

const terminalActionStatuses = new Set(["done", "completed", "canceled", "cancelled", "stopped", "terminated"]);
const completedTaskStatuses = new Set(["done", "completed", "canceled", "cancelled"]);

function text(value) { return String(value ?? "").trim(); }
function numeric(value) { return value === null || value === undefined ? null : Number(value); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)); }
function shanghaiDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function addDays(value, days) { const date = new Date(`${value}T00:00:00+08:00`); date.setUTCDate(date.getUTCDate() + days); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function daysBetween(start, end) { return Math.round((Date.parse(`${end}T00:00:00+08:00`) - Date.parse(`${start}T00:00:00+08:00`)) / 86400000) + 1; }

export function resolveProductBusinessPeriod(query = {}) {
  const range = ["yesterday", "7d", "30d", "custom"].includes(text(query.range)) ? text(query.range) : "30d";
  const today = shanghaiDate();
  const periodEnd = range === "custom" ? text(query.periodEnd) : range === "yesterday" ? addDays(today, -1) : today;
  const periodStart = range === "custom" ? text(query.periodStart) : range === "7d" ? addDays(periodEnd, -6) : range === "30d" ? addDays(periodEnd, -29) : periodEnd;
  if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd || daysBetween(periodStart, periodEnd) > 366) {
    const error = new Error("时间范围无效，请选择不超过366天的正确日期范围。");
    error.statusCode = 400;
    throw error;
  }
  const periodDays = daysBetween(periodStart, periodEnd);
  const previousPeriodStart = addDays(periodStart, -periodDays);
  const previousPeriodEnd = addDays(periodStart, -1);
  return { range, periodStart, periodEnd, previousPeriodStart, previousPeriodEnd,
    earlierPeriodStart: addDays(previousPeriodStart, -periodDays), earlierPeriodEnd: addDays(previousPeriodStart, -1), periodDays };
}

function salesMetrics(database, periodStart, periodEnd) {
  const rows = database.prepare(`
    SELECT s.productId,
      COUNT(DISTINCT f.id) factCount,
      SUM(f.salesAmount) salesAmount,
      SUM(f.shippedQuantity) salesQuantity,
      SUM(f.profitAmount) grossProfit,
      SUM(CASE WHEN f.salesAmount IS NOT NULL THEN 1 ELSE 0 END) salesAmountFactCount,
      SUM(CASE WHEN f.shippedQuantity IS NOT NULL THEN 1 ELSE 0 END) salesQuantityFactCount,
      SUM(CASE WHEN f.profitAmount IS NOT NULL THEN 1 ELSE 0 END) profitFactCount
    FROM connection_sku_sales_facts f
    JOIN sales_link_skus s ON s.id=f.salesLinkSkuId
    WHERE s.productId IS NOT NULL
      AND f.periodStart>=? AND f.periodEnd<=?
      AND COALESCE(s.matchStatus,'matched') IN ('matched','matched_auto','matched_manual')
    GROUP BY s.productId
  `).all(periodStart, periodEnd);
  return new Map(rows.map((row) => [row.productId, row]));
}

function structureMetrics(database) {
  const skuRows = database.prepare(`
    SELECT productId,
      COUNT(DISTINCT CASE WHEN trim(m.merchantSkuCode)<>'' THEN lower(trim(m.merchantSkuCode)) ELSE m.id END) skuCount,
      GROUP_CONCAT(DISTINCT g.goodsCode) productCodes
    FROM product_erp_mappings m
    LEFT JOIN erp_goods g ON g.id=m.erpGoodsId
    WHERE productId IS NOT NULL AND COALESCE(m.currentState,'active')='active'
    GROUP BY productId
  `).all();
  const linkRows = database.prepare(`
    SELECT s.productId,COUNT(DISTINCT s.salesLinkId) salesLinkCount
    FROM sales_link_skus s JOIN sales_links l ON l.id=s.salesLinkId
    WHERE s.productId IS NOT NULL
      AND COALESCE(s.currentState,'active')='active'
      AND COALESCE(l.currentState,'active')='active'
      AND COALESCE(s.matchStatus,'matched') IN ('matched','matched_auto','matched_manual')
    GROUP BY s.productId
  `).all();
  return {
    skus: new Map(skuRows.map((row) => [row.productId, { skuCount: Number(row.skuCount || 0), productCodes: text(row.productCodes).split(",").filter(Boolean) }])),
    links: new Map(linkRows.map((row) => [row.productId, Number(row.salesLinkCount || 0)])),
  };
}

function linkPerformanceMetrics(database, periodStart, periodEnd) {
  const rows = database.prepare(`
    WITH product_links AS (
      SELECT DISTINCT s.productId,s.salesLinkId
      FROM sales_link_skus s JOIN sales_links l ON l.id=s.salesLinkId
      WHERE s.productId IS NOT NULL
        AND COALESCE(s.currentState,'active')='active'
        AND COALESCE(l.currentState,'active')='active'
        AND COALESCE(s.matchStatus,'matched') IN ('matched','matched_auto','matched_manual')
    ), link_period AS (
      SELECT salesLinkId,SUM(payAmount) payAmount,SUM(visitorCount) visitorCount,
        CASE WHEN SUM(visitorCount)>0 THEN SUM(conversionRate*visitorCount)/SUM(visitorCount) ELSE NULL END conversionRate
      FROM connection_period_snapshots
      WHERE periodStart>=? AND periodEnd<=?
      GROUP BY salesLinkId
    )
    SELECT p.productId,COUNT(DISTINCT p.salesLinkId) linkCount,
      SUM(l.payAmount) payAmount,SUM(l.visitorCount) visitorCount,
      CASE WHEN SUM(l.visitorCount)>0 THEN SUM(l.conversionRate*l.visitorCount)/SUM(l.visitorCount) ELSE NULL END conversionRate,
      SUM(CASE WHEN l.salesLinkId IS NOT NULL THEN 1 ELSE 0 END) measuredLinkCount
    FROM product_links p LEFT JOIN link_period l ON l.salesLinkId=p.salesLinkId
    GROUP BY p.productId
  `).all(periodStart, periodEnd);
  return new Map(rows.map((row) => [row.productId, {
    linkCount: Number(row.linkCount || 0), payAmount: numeric(row.payAmount), visitorCount: numeric(row.visitorCount),
    conversionRate: numeric(row.conversionRate), measuredLinkCount: Number(row.measuredLinkCount || 0),
  }]));
}

function latestHealth(database) {
  const rows = database.prepare(`
    SELECT productId,healthScore,healthStatus,updatedAt
    FROM (
      SELECT productId,healthScore,healthStatus,updatedAt,id,
        ROW_NUMBER() OVER (PARTITION BY productId ORDER BY updatedAt DESC,id DESC) position
      FROM product_health_records
    ) WHERE position=1
  `).all();
  return new Map(rows.map((row) => [row.productId, row]));
}

function actionMetrics(database) {
  const actions = database.prepare(`
    WITH product_actions AS (
      SELECT productId,actionId FROM action_products
      UNION SELECT productId,actionId FROM product_improvements
    )
    SELECT a.productId,a.actionId,p.status
    FROM product_actions a LEFT JOIN process_instances p ON p.id=a.actionId
  `).all();
  const tasks = database.prepare(`
    WITH product_actions AS (
      SELECT productId,actionId FROM action_products
      UNION SELECT productId,actionId FROM product_improvements
    )
    SELECT a.productId,t.id,t.status
    FROM product_actions a JOIN tasks t ON t.processInstanceId=a.actionId
  `).all();
  const improvements = database.prepare("SELECT productId,id,status FROM product_improvements").all();
  const result = new Map();
  const entry = (productId) => { if (!result.has(productId)) result.set(productId, { improvementCount: 0, actionCount: 0, taskCount: 0 }); return result.get(productId); };
  for (const item of improvements) if (!terminalActionStatuses.has(text(item.status))) entry(item.productId).improvementCount += 1;
  for (const item of actions) if (!terminalActionStatuses.has(text(item.status))) entry(item.productId).actionCount += 1;
  for (const item of tasks) if (!completedTaskStatuses.has(text(item.status))) entry(item.productId).taskCount += 1;
  return result;
}

function inventoryStatus(summary) {
  if (!summary || summary.stockRisk === "no_data") return { code: "no_data", label: "暂无数据" };
  if (summary.stockRisk === "out") return { code: "stockout", label: "缺货风险" };
  if (["high", "no_sales"].includes(summary.stockRisk)) return { code: "backlog", label: "积压风险" };
  if (summary.stockRisk === "low") return { code: "attention", label: "关注" };
  return { code: "healthy", label: "健康" };
}

function salesTrend(current, previous, earlier) {
  const currentValue = current?.salesAmountFactCount ? numeric(current.salesAmount) : null;
  const previousValue = previous?.salesAmountFactCount ? numeric(previous.salesAmount) : null;
  const earlierValue = earlier?.salesAmountFactCount ? numeric(earlier.salesAmount) : null;
  if (currentValue === null || previousValue === null || previousValue === 0) return { rate: null, code: "no_data", label: "暂无对比" };
  const rate = (currentValue - previousValue) / Math.abs(previousValue);
  if (rate > 0.1) return { rate, code: "up", label: "上升" };
  if (rate < -0.1 && earlierValue !== null && previousValue < earlierValue) return { rate, code: "down", label: "下降", sustained: true };
  if (rate < -0.1) return { rate, code: "stable", label: "稳定", observation: earlierValue === null
    ? "本期销售下滑，但缺少更早同周期数据，暂不判定为持续下降。"
    : "本期销售下滑，但未形成连续两个周期下降，暂按稳定观察。" };
  return { rate, code: "stable", label: "稳定" };
}

function healthDimension(code, label, severity, explanation, evidence = {}) {
  return { code, label, severity, explanation, evidence };
}

function lifecycleDimension(lifecycle) {
  const label = lifecycle === "新品" ? "新品" : ["成长", "爆款"].includes(lifecycle) ? "成长"
    : lifecycle === "稳定销售" ? "成熟" : "衰退";
  return healthDimension(label === "衰退" ? "decline" : label === "成熟" ? "mature" : label === "成长" ? "growth" : "new",
    label, label === "衰退" ? "attention" : "healthy", `当前产品阶段判断为“${label}”；仅用于分析展示，不修改人工维护的生命周期。`, { sourceLifecycle: lifecycle });
}

function buildProductHealthAnalysis(item, context) {
  const trend = item.sales.trend;
  const sales = trend.code === "no_data"
    ? healthDimension("no_data", "暂无数据", "no_data", "现有销售事实不足以完成近30天同期对比。")
    : healthDimension(trend.code === "up" ? "growth" : trend.code, trend.code === "up" ? "↑增长" : trend.code === "down" ? "↓下降" : "→稳定",
      trend.code === "down" ? "attention" : "healthy", trend.observation || `当前${context.period.periodDays}天销售额较上一个同长周期${trend.code === "up" ? "上涨" : trend.code === "down" ? "下降" : "变化在±10%内"}${trend.rate === null ? "" : ` ${Math.abs(trend.rate * 100).toFixed(1)}%`}。`,
      { currentAmount: item.sales.amount, previousAmount: item.sales.previousAmount, earlierAmount: item.sales.earlierAmount, changeRate: trend.rate, sustained: Boolean(trend.sustained) });

  const inventoryCode = item.inventory.status.code;
  const inventory = inventoryCode === "no_data"
    ? healthDimension("no_data", "暂无数据", "no_data", "当前没有可用的库存覆盖周期数据。")
    : healthDimension(inventoryCode === "stockout" ? "stockout" : inventoryCode === "backlog" ? "backlog" : inventoryCode === "attention" ? "attention" : "healthy",
      inventoryCode === "stockout" ? "缺货" : inventoryCode === "backlog" ? "积压" : inventoryCode === "attention" ? "关注" : "健康",
      ["stockout", "backlog"].includes(inventoryCode) ? "risk" : inventoryCode === "attention" ? "attention" : "healthy",
      item.inventory.coverageDays === null
        ? (inventoryCode === "backlog" ? "当前有库存但近30天无动销，无法计算库存覆盖天数。" : "库存覆盖周期暂无数据。")
        : `按现有库存与近30天销量计算，预计可覆盖 ${item.inventory.coverageDays.toFixed(1)} 天。`,
      { quantity: item.inventory.quantity, availableQuantity: item.inventory.availableQuantity, coverageDays: item.inventory.coverageDays, stockRisk: item.inventory.stockRisk });

  const margin = item.profit.grossMargin;
  const profit = margin === null
    ? healthDimension("no_data", "暂无数据", "no_data", "现有销售事实中没有可用利润数据，未做推算。")
    : healthDimension(margin >= 0.3 ? "excellent" : margin >= 0.1 ? "normal" : "low", margin >= 0.3 ? "优秀" : margin >= 0.1 ? "正常" : "偏低",
      margin < 0.1 ? "attention" : "healthy", `现有事实数据显示毛利率 ${(margin * 100).toFixed(1)}%，毛利润 ${Number(item.profit.grossProfit || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元。`,
      { grossMargin: margin, grossProfit: item.profit.grossProfit });

  const link = item.linkPerformance;
  let links;
  if (!link.linkCount) links = healthDimension("needs_optimization", "需优化", "attention", "当前未关联有效销售链接，无法观察销售贡献与转化表现。", { linkCount: 0 });
  else if (!link.measuredLinkCount && item.sales.amount === null) links = healthDimension("no_data", "暂无数据", "no_data", `已关联 ${link.linkCount} 个销售链接，但当前周期没有销售或转化事实。`, { ...link });
  else {
    const conversionWeak = link.conversionRate !== null && context.averageConversionRate !== null && link.conversionRate < context.averageConversionRate * 0.8;
    const noContribution = item.sales.amount !== null && item.sales.amount <= 0;
    const excellent = link.linkCount >= 2 && item.sales.contribution !== null && context.averageSalesContribution !== null && item.sales.contribution >= context.averageSalesContribution
      && link.conversionRate !== null && context.averageConversionRate !== null && link.conversionRate >= context.averageConversionRate;
    const code = noContribution || conversionWeak ? "needs_optimization" : excellent ? "excellent" : "normal";
    links = healthDimension(code, code === "excellent" ? "优秀" : code === "normal" ? "正常" : "需优化", code === "needs_optimization" ? "attention" : "healthy",
      `关联 ${link.linkCount} 个销售链接；销售贡献${item.sales.contribution === null ? "暂无数据" : `${(item.sales.contribution * 100).toFixed(1)}%`}；转化率${link.conversionRate === null ? "暂无数据" : `${(link.conversionRate * 100).toFixed(2)}%`}。`, { ...link, salesContribution: item.sales.contribution });
  }

  const lifecycle = lifecycleDimension(item.lifecycle);
  const dimensions = { sales, inventory, profit, links, lifecycle };
  const businessDimensions = [sales, inventory, profit, ...(link.linkCount ? [links] : [])];
  const availableCount = businessDimensions.filter((dimension) => dimension.severity !== "no_data").length;
  const overallCode = availableCount === 0 ? "no_data" : businessDimensions.some((dimension) => dimension.severity === "risk") ? "risk"
    : [...businessDimensions, lifecycle].some((dimension) => dimension.severity === "attention") ? "attention" : "healthy";
  const overall = { code: overallCode, label: { healthy: "健康", attention: "关注", risk: "风险", no_data: "暂无数据" }[overallCode],
    emoji: { healthy: "🟢", attention: "🟡", risk: "🔴", no_data: "⚪" }[overallCode] };
  const recommendations = [];
  if (sales.code === "down") recommendations.push({ code: "sales_decline", title: "优化产品详情页转化", reason: sales.explanation });
  if (inventory.code === "backlog") recommendations.push({ code: "inventory_backlog", title: "制定库存消化方案", reason: inventory.explanation });
  if (inventory.code === "stockout") recommendations.push({ code: "inventory_stockout", title: "制定补货保障方案", reason: inventory.explanation });
  if (profit.code === "low") recommendations.push({ code: "profit_low", title: "优化产品成本结构", reason: profit.explanation });
  if (overallCode !== "no_data" && links.code === "needs_optimization") recommendations.push({ code: "link_optimization", title: "优化关联销售链接表现", reason: links.explanation });
  return { overall, dimensions, availableDimensionCount: availableCount, recommendations, evaluatedPeriod: context.period, readOnly: true, ruleVersion: "product-health-phase2-v1" };
}

export function mapProductBusinessLifecycle(productStatus, zone, trendCode) {
  const status = text(productStatus);
  if (["已归档", "归档"].includes(status)) return "归档";
  if (["淘汰", "清仓", "停售"].includes(status)) return "清仓";
  if (zone === "hit") return "爆款";
  if (["开发中", "待上架", "上架", "新品"].includes(status) || zone === "new") return "新品";
  if (status === "成长期") return "成长";
  if (status === "风险期" || trendCode === "down") return "衰退";
  if (trendCode === "up") return "成长";
  return "稳定销售";
}

function businessZone(product, sales, inventory) {
  const status = text(product.status);
  if (["开发中", "待上架", "上架", "新品"].includes(status)) return "new";
  if (["淘汰", "清仓", "停售"].includes(status)) return "clearance";
  if ((sales?.salesAmount ?? 0) > 0 && (sales?.salesQuantity ?? 0) > 0 && inventory?.stockRisk !== "no_sales") return "active";
  return null;
}

function profitStatus(grossProfit) {
  if (grossProfit === null) return { code: "no_data", label: "暂无数据" };
  if (grossProfit > 0) return { code: "profitable", label: "盈利" };
  if (grossProfit < 0) return { code: "loss", label: "亏损" };
  return { code: "break_even", label: "持平" };
}

function normalizePage(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function compareNullable(left, right, direction, collator) {
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  if (leftEmpty) return 0;
  const comparison = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
  return direction === "asc" ? comparison : -comparison;
}

export function getProductBusinessReadModel(query = {}, { includeInventoryCost = false, visibleProductIds = null } = {}) {
  const database = getDatabase();
  const period = resolveProductBusinessPeriod(query);
  const products = database.prepare(`SELECT p.*,owner.name ownerName FROM products p LEFT JOIN persons owner ON owner.id=p.ownerId ORDER BY p.updatedAt DESC,p.id`).all();
  const visible = visibleProductIds ? new Set(visibleProductIds) : null;
  const scopedProducts = visible ? products.filter((product) => visible.has(product.id)) : products;
  const productIds = scopedProducts.map((product) => product.id);
  const currentSales = salesMetrics(database, period.periodStart, period.periodEnd);
  const previousSales = salesMetrics(database, period.previousPeriodStart, period.previousPeriodEnd);
  const earlierSales = salesMetrics(database, period.earlierPeriodStart, period.earlierPeriodEnd);
  const structures = structureMetrics(database);
  const linkPerformance = linkPerformanceMetrics(database, period.periodStart, period.periodEnd);
  const health = latestHealth(database);
  const actions = actionMetrics(database);
  const inventory = readProductInventorySupplyMap(productIds, { includeCost: includeInventoryCost });
  let items = scopedProducts.map((product) => {
    const current = currentSales.get(product.id);
    const prior = previousSales.get(product.id);
    const earlier = earlierSales.get(product.id);
    const trend = salesTrend(current, prior, earlier);
    const inventorySummary = inventory.get(product.id)?.summary;
    const stockStatus = inventoryStatus(inventorySummary);
    const healthRecord = health.get(product.id);
    const structure = structures.skus.get(product.id) ?? { skuCount: 0, productCodes: [] };
    const action = actions.get(product.id) ?? { improvementCount: 0, actionCount: 0, taskCount: 0 };
    const salesAmount = current?.salesAmountFactCount ? numeric(current.salesAmount) : null;
    const salesQuantity = current?.salesQuantityFactCount ? numeric(current.salesQuantity) : null;
    const grossProfit = current?.profitFactCount ? numeric(current.grossProfit) : null;
    const grossMargin = grossProfit !== null && salesAmount !== null && salesAmount !== 0 ? grossProfit / salesAmount : null;
    return {
      id: product.id, name: product.name, sku: product.skuCode, productCode: structure.productCodes.join(" / ") || null,
      image: product.mainImage, brand: product.brand || null, category: product.category || null, ownerId: product.ownerId || null,
      ownerName: product.ownerName || "未分配", status: product.status, lifecycle: null,
      sales: { amount: salesAmount, quantity: salesQuantity, previousAmount: prior?.salesAmountFactCount ? numeric(prior.salesAmount) : null,
        earlierAmount: earlier?.salesAmountFactCount ? numeric(earlier.salesAmount) : null, contribution: null, trend, factCount: Number(current?.factCount || 0) },
      structure: { skuCount: structure.skuCount, salesLinkCount: structures.links.get(product.id) ?? 0 },
      inventory: { quantity: numeric(inventorySummary?.stockNum), availableQuantity: numeric(inventorySummary?.availableSendStock), amount: includeInventoryCost ? numeric(inventorySummary?.inventoryCostAmount) : null,
        coverageDays: numeric(inventorySummary?.stockDays), stockRisk: inventorySummary?.stockRisk ?? "no_data", status: stockStatus, businessDate: inventorySummary?.businessDate ?? null },
      profit: { grossMargin, grossProfit, status: profitStatus(grossProfit) },
      linkPerformance: linkPerformance.get(product.id) ?? { linkCount: structures.links.get(product.id) ?? 0, payAmount: null, visitorCount: null, conversionRate: null, measuredLinkCount: 0 },
      health: { score: healthRecord?.healthScore === null || healthRecord?.healthScore === undefined ? null : Number(healthRecord.healthScore),
        status: { code: healthRecord?.healthStatus ?? "no_data", label: ({ growth: "成长", stable: "稳定", attention: "关注", risk: "风险", no_data: "暂无数据" })[healthRecord?.healthStatus] ?? "暂无数据" }, evaluatedAt: healthRecord?.updatedAt ?? null },
      legacyHealth: { score: healthRecord?.healthScore === null || healthRecord?.healthScore === undefined ? null : Number(healthRecord.healthScore), evaluatedAt: healthRecord?.updatedAt ?? null },
      actions: { ...action, pendingCount: action.improvementCount + action.actionCount + action.taskCount },
      updatedAt: product.updatedAt,
      _zone: businessZone(product, current, inventorySummary),
      _previousSalesQuantity: prior?.salesQuantityFactCount ? numeric(prior.salesQuantity) : null,
    };
  });
  const classifiedZones = classifyProductBusinessZones(items.map((item) => ({
    id: item.id,
    status: item.status,
    listedAt: null,
    analysis: {
      sales: { sales30d: item.sales.quantity, previousSales30d: item._previousSalesQuantity, sales90d: null },
      inventory: { actualStock: item.inventory.quantity },
      finance: { revenue: item.sales.amount },
    },
  })));
  const zoneByProduct = new Map(classifiedZones.items.map((item) => [item.id, item.businessZone]));
  items = items.map((item) => {
    const lifecycle = mapProductBusinessLifecycle(item.status, zoneByProduct.get(item.id) ?? item._zone, item.sales.trend.code);
    const { _zone, _previousSalesQuantity, ...publicItem } = item;
    return { ...publicItem, lifecycle };
  });

  const totalSalesAmount = items.map((item) => item.sales.amount).filter((value) => value !== null).reduce((sum, value) => sum + Math.max(0, value), 0);
  const salesProductCount = items.filter((item) => item.sales.amount !== null && item.sales.amount > 0).length;
  const measuredLinks = items.map((item) => item.linkPerformance).filter((item) => item.conversionRate !== null && item.visitorCount > 0);
  const totalVisitors = measuredLinks.reduce((sum, item) => sum + item.visitorCount, 0);
  const averageConversionRate = totalVisitors > 0 ? measuredLinks.reduce((sum, item) => sum + item.conversionRate * item.visitorCount, 0) / totalVisitors : null;
  const healthContext = { period, averageSalesContribution: salesProductCount ? 1 / salesProductCount : null, averageConversionRate };
  items = items.map((item) => {
    const sales = { ...item.sales, contribution: item.sales.amount !== null && totalSalesAmount > 0 ? Math.max(0, item.sales.amount) / totalSalesAmount : null };
    const withContribution = { ...item, sales };
    return { ...withContribution, healthAnalysis: buildProductHealthAnalysis(withContribution, healthContext) };
  });

  const queryText = text(query.query).toLowerCase();
  const matches = (value, selected) => !text(selected) || text(value) === text(selected);
  items = items.filter((item) => matches(item.id, query.productId) && (!queryText || `${item.name} ${item.sku} ${item.productCode || ""}`.toLowerCase().includes(queryText))
    && matches(item.brand, query.brand) && matches(item.category, query.category) && matches(item.lifecycle, query.lifecycle)
    && matches(item.status, query.status) && matches(item.healthAnalysis.overall.code, query.healthStatus)
    && matches(item.ownerId, query.ownerId) && matches(item.inventory.status.code, query.inventoryStatus));

  const sortFields = { name: (item) => item.name, salesAmount: (item) => item.sales.amount, salesQuantity: (item) => item.sales.quantity,
    salesTrend: (item) => item.sales.trend.rate, skuCount: (item) => item.structure.skuCount, salesLinkCount: (item) => item.structure.salesLinkCount,
    inventoryQuantity: (item) => item.inventory.quantity, inventoryAmount: (item) => item.inventory.amount, grossMargin: (item) => item.profit.grossMargin,
    grossProfit: (item) => item.profit.grossProfit, healthStatus: (item) => ({ risk: 3, attention: 2, healthy: 1, no_data: 0 }[item.healthAnalysis.overall.code]),
    healthScore: (item) => item.legacyHealth.score, pendingCount: (item) => item.actions.pendingCount, updatedAt: (item) => item.updatedAt };
  const sortBy = sortFields[text(query.sortBy)] ? text(query.sortBy) : "updatedAt";
  const sortDirection = text(query.sortDirection) === "asc" ? "asc" : "desc";
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  items.sort((left, right) => compareNullable(sortFields[sortBy](left), sortFields[sortBy](right), sortDirection, collator) || collator.compare(left.sku, right.sku));

  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(100, normalizePage(query.pageSize, 30));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);
  const pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allItems = scopedProducts.length;
  const sum = (read) => { const values = items.map(read).filter((value) => value !== null && value !== undefined); return values.length ? values.reduce((totalValue, value) => totalValue + Number(value), 0) : null; };
  const options = (key) => [...new Set(scopedProducts.map((item) => text(item[key])).filter(Boolean))].sort(collator.compare);
  return {
    generatedAt: new Date().toISOString(), period,
    summary: { totalProducts: allItems, filteredProducts: total, salesAmount: sum((item) => item.sales.amount), salesQuantity: sum((item) => item.sales.quantity), inventoryQuantity: sum((item) => item.inventory.quantity), riskProducts: items.filter((item) => ["attention", "risk"].includes(item.healthAnalysis.overall.code)).length },
    items: pageItems, pagination: { page: currentPage, pageSize, total, pages },
    options: { brands: options("brand"), categories: options("category"), statuses: options("status"), lifecycleStatuses: productBusinessLifecycleStatuses,
      healthStatuses: productBusinessHealthStatuses, inventoryStatuses: productBusinessInventoryStatuses,
      owners: [...new Map(scopedProducts.filter((item) => item.ownerId).map((item) => [item.ownerId, { id: item.ownerId, name: item.ownerName || "未分配" }])).values()].sort((left, right) => collator.compare(left.name, right.name)) },
    sort: { sortBy, sortDirection },
    definitions: { sales: "connection_sku_sales_facts", inventory: "现有库存供应查询", health: "ProductBusinessReadModel 规则分析", actions: "product_improvements + action_products + tasks", readOnly: true },
  };
}

export function getProductHealthAnalysis(productId, options = {}) {
  const result = getProductBusinessReadModel({ range: "30d", productId: text(productId), page: 1, pageSize: 1 }, options);
  const item = result.items[0];
  if (!item || item.id !== text(productId)) {
    const error = new Error("产品不存在或无权查看。");
    error.statusCode = 404;
    throw error;
  }
  return { productId: item.id, productName: item.name, ...item.healthAnalysis };
}
