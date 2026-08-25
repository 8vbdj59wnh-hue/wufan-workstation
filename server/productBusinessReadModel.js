import { getDatabase } from "./db.js";
import { readProductInventorySupplyMap } from "./inventorySupplyQueryService.js";
import { classifyProductBusinessZones } from "./productBusinessClassification.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";
import { queryProductContributions } from "./productContributionReadModel.js";
import { latestCompleteSalesDate, resolveProductSalesDistributionRange } from "./productSalesDistributionService.js";

export const productBusinessLifecycleStatuses = Object.freeze(["新品", "成长", "爆款", "稳定销售", "衰退", "清仓", "归档"]);
export const productBusinessHealthStatuses = Object.freeze(["healthy", "attention", "risk", "no_data"]);
export const productBusinessInventoryStatuses = Object.freeze(["healthy", "attention", "backlog", "stockout", "no_data"]);

const terminalActionStatuses = new Set(["done", "completed", "canceled", "cancelled", "stopped", "terminated"]);
const completedTaskStatuses = new Set(["done", "completed", "canceled", "cancelled"]);

function text(value) { return String(value ?? "").trim(); }
function numeric(value) { return value === null || value === undefined ? null : Number(value); }
function addDays(value, days) { const date = new Date(`${value}T00:00:00+08:00`); date.setUTCDate(date.getUTCDate() + days); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function daysBetween(start, end) { return Math.round((Date.parse(`${end}T00:00:00+08:00`) - Date.parse(`${start}T00:00:00+08:00`)) / 86400000) + 1; }

export function resolveProductBusinessPeriod(query = {}, database = getDatabase()) {
  const requestedRange = text(query.range) || "30d";
  const resolved = resolveProductSalesDistributionRange({ preset: requestedRange, startDate: query.periodStart, endDate: query.periodEnd }, requestedRange === "custom" ? "" : latestCompleteSalesDate(database));
  const range = resolved.preset;
  const periodStart = resolved.startDate;
  const periodEnd = resolved.endDate;
  const periodDays = daysBetween(periodStart, periodEnd);
  const previousPeriodStart = addDays(periodStart, -periodDays);
  const previousPeriodEnd = addDays(periodStart, -1);
  return { range, periodStart, periodEnd, previousPeriodStart, previousPeriodEnd,
    earlierPeriodStart: addDays(previousPeriodStart, -periodDays), earlierPeriodEnd: addDays(previousPeriodStart, -1), periodDays };
}

export function readProductBusinessRelationContext(database) {
  const linkSkus = database.prepare(`
    SELECT s.id salesLinkSkuId,s.salesLinkId
    FROM sales_link_skus s JOIN sales_links l ON l.id=s.salesLinkId
    WHERE COALESCE(s.currentState,'active')='active'
      AND COALESCE(l.currentState,'active')='active'
      AND COALESCE(s.matchStatus,'matched') IN ('matched','matched_auto','matched_manual','erp_linked')
    ORDER BY s.id
  `).all();
  const relations = {};
  for (let offset = 0; offset < linkSkus.length; offset += 500) {
    const ids = linkSkus.slice(offset, offset + 500).map((row) => row.salesLinkSkuId);
    Object.assign(relations, resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, {
      database, scope: "productWorkspace", salesObjectResolverEnabled: true,
      enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES, logDifference: () => {},
    }).results);
  }
  const productByErpSku = new Map(database.prepare(`
    SELECT m.erpSkuId,m.productId
    FROM product_erp_mappings m
    WHERE m.currentState='active' AND m.erpSkuId IS NOT NULL AND m.productId IS NOT NULL
    ORDER BY m.updatedAt,m.id
  `).all().map((row) => [row.erpSkuId, row.productId]));
  const attributionsBySku = new Map();
  const linksByProduct = new Map();
  for (const sku of linkSkus) {
    const relation = relations[sku.salesLinkSkuId];
    if (!relation?.isUsable) continue;
    const quantityByProduct = new Map();
    for (const mapping of relation.mappings) {
      const productId = productByErpSku.get(mapping.erpSkuId);
      if (!productId) continue;
      quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + Number(mapping.quantity || 0));
    }
    const attributions = [...quantityByProduct].map(([productId, quantity]) => ({ productId, quantity }));
    if (!attributions.length) continue;
    attributionsBySku.set(sku.salesLinkSkuId, attributions);
    for (const attribution of attributions) {
      const links = linksByProduct.get(attribution.productId) ?? new Set();
      links.add(sku.salesLinkId); linksByProduct.set(attribution.productId, links);
    }
  }
  return { attributionsBySku, linksByProduct, resolvedLinkSkuCount: attributionsBySku.size };
}

export function salesMetrics(database, periodStart, periodEnd) {
  const rows = database.prepare(`
    SELECT f.id,m.productId,f.salesAmount,f.quantity,f.profitAmount
    FROM connection_sku_sales_daily_facts f
    JOIN product_erp_mappings m ON m.erpSkuId=f.erpSkuId AND m.currentState='active'
    WHERE f.saleDate>=? AND f.saleDate<=?
  `).all(periodStart, periodEnd);
  const result = new Map();
  for (const fact of rows) {
    const metric = result.get(fact.productId) ?? { productId: fact.productId, factCount: 0, salesAmount: 0, salesQuantity: 0, grossProfit: 0, salesAmountFactCount: 0, salesQuantityFactCount: 0, profitFactCount: 0 };
    metric.factCount += 1;
    if (fact.salesAmount !== null) { metric.salesAmount += Number(fact.salesAmount); metric.salesAmountFactCount += 1; }
    if (fact.quantity !== null) { metric.salesQuantity += Number(fact.quantity); metric.salesQuantityFactCount += 1; }
    if (fact.profitAmount !== null) { metric.grossProfit += Number(fact.profitAmount); metric.profitFactCount += 1; }
    result.set(fact.productId, metric);
  }
  return result;
}

export function structureMetrics(database, relationContext) {
  const skuRows = database.prepare(`
    SELECT productId,
      COUNT(DISTINCT CASE WHEN trim(m.merchantSkuCode)<>'' THEN lower(trim(m.merchantSkuCode)) ELSE m.id END) skuCount,
      GROUP_CONCAT(DISTINCT g.goodsCode) productCodes
    FROM product_erp_mappings m
    LEFT JOIN erp_goods g ON g.id=m.erpGoodsId
    WHERE productId IS NOT NULL AND COALESCE(m.currentState,'active')='active'
    GROUP BY productId
  `).all();
  return {
    skus: new Map(skuRows.map((row) => [row.productId, { skuCount: Number(row.skuCount || 0), productCodes: text(row.productCodes).split(",").filter(Boolean) }])),
    links: new Map([...relationContext.linksByProduct].map(([productId, links]) => [productId, links.size])),
  };
}

export function linkPerformanceMetrics(database, periodStart, periodEnd, relationContext) {
  const rows = database.prepare(`
    SELECT ps.salesLinkId,
      (SELECT SUM(f.salesAmount) FROM connection_sku_sales_daily_facts f
       WHERE f.salesLinkId=ps.salesLinkId AND f.saleDate BETWEEN ? AND ?) payAmount,
      SUM(ps.visitorCount) visitorCount,
      CASE WHEN SUM(visitorCount)>0 THEN SUM(conversionRate*visitorCount)/SUM(visitorCount) ELSE NULL END conversionRate
    FROM connection_period_snapshots ps
    WHERE ps.periodStart>=? AND ps.periodEnd<=?
    GROUP BY ps.salesLinkId
  `).all(periodStart, periodEnd, periodStart, periodEnd);
  const snapshotsByLink = new Map(rows.map((row) => [row.salesLinkId, row]));
  const result = new Map();
  for (const [productId, links] of relationContext.linksByProduct) {
    let payAmount = 0; let payAmountCount = 0; let visitorCount = 0; let visitorCountCount = 0;
    let weightedConversion = 0; let conversionVisitors = 0; let measuredLinkCount = 0;
    for (const salesLinkId of links) {
      const snapshot = snapshotsByLink.get(salesLinkId); if (!snapshot) continue;
      measuredLinkCount += 1;
      if (snapshot.payAmount !== null) { payAmount += Number(snapshot.payAmount); payAmountCount += 1; }
      if (snapshot.visitorCount !== null) { visitorCount += Number(snapshot.visitorCount); visitorCountCount += 1; }
      if (snapshot.conversionRate !== null && Number(snapshot.visitorCount) > 0) {
        weightedConversion += Number(snapshot.conversionRate) * Number(snapshot.visitorCount);
        conversionVisitors += Number(snapshot.visitorCount);
      }
    }
    result.set(productId, { linkCount: links.size, payAmount: payAmountCount ? payAmount : null,
      visitorCount: visitorCountCount ? visitorCount : null, conversionRate: conversionVisitors ? weightedConversion / conversionVisitors : null, measuredLinkCount });
  }
  return result;
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

function physicalContributionTrend(current, previous, earlier) {
  const currentValue = numeric(current?.totalPhysicalContribution);
  const previousValue = numeric(previous?.totalPhysicalContribution);
  const earlierValue = numeric(earlier?.totalPhysicalContribution);
  if (currentValue === null || previousValue === null || previousValue === 0) return { rate: null, code: "no_data", label: "暂无对比", metric: "total_physical_contribution" };
  const rate = (currentValue - previousValue) / Math.abs(previousValue);
  if (rate > 0.1) return { rate, code: "up", label: "上升", metric: "total_physical_contribution" };
  if (rate < -0.1 && earlierValue !== null && previousValue < earlierValue) return { rate, code: "down", label: "下降", sustained: true, metric: "total_physical_contribution" };
  if (rate < -0.1) return { rate, code: "stable", label: "稳定", metric: "total_physical_contribution", observation: earlierValue === null
    ? "本期实际出货贡献下降，但缺少更早同周期数据，暂不判定为持续下降。"
    : "本期实际出货贡献下降，但未形成连续两个周期下降，暂按稳定观察。" };
  return { rate, code: "stable", label: "稳定", metric: "total_physical_contribution" };
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
      trend.code === "down" ? "attention" : "healthy", trend.observation || `当前${context.period.periodDays}天实际出货贡献较上一个同长周期${trend.code === "up" ? "上涨" : trend.code === "down" ? "下降" : "变化在±10%内"}${trend.rate === null ? "" : ` ${Math.abs(trend.rate * 100).toFixed(1)}%`}。`,
      { currentQuantity: item.sales.totalPhysicalContribution, previousQuantity: item.sales.previousQuantity, earlierQuantity: item.sales.earlierQuantity, directQuantity: item.sales.directQuantity, bundleContributionQuantity: item.sales.bundleContributionQuantity, changeRate: trend.rate, sustained: Boolean(trend.sustained) });

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
  else if (!link.measuredLinkCount && item.sales.directAmount === null) links = healthDimension("no_data", "暂无数据", "no_data", `已关联 ${link.linkCount} 个销售链接，但当前周期没有Single直接销售或转化事实。`, { ...link });
  else {
    const conversionWeak = link.conversionRate !== null && context.averageConversionRate !== null && link.conversionRate < context.averageConversionRate * 0.8;
    const noContribution = item.sales.directAmount !== null && item.sales.directAmount <= 0;
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
  return { overall, dimensions, availableDimensionCount: availableCount, recommendations, evaluatedPeriod: context.period, readOnly: true, ruleVersion: "product-health-phase8-contribution-v1" };
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

// ERP经营生命周期只控制默认展示，Product战略生命周期保持独立。
function operatingProductLifecycleMap(database) {
  const rows = database.prepare(`SELECT pm.productId,m.lifecycleStatus
    FROM operating_erp_set_members m JOIN product_erp_mappings pm ON pm.erpSkuId=m.erpSkuId AND pm.currentState='active'
    WHERE m.erpSkuId IS NOT NULL`).all();
  const priority = { active: 0, active_dependency: 1, sales_active: 2, archived: 3, external_unused: 4, unresolved: 5 };
  const result = new Map();
  for (const row of rows) {
    const current = result.get(row.productId) || { statuses: new Set(), primaryStatus: row.lifecycleStatus };
    current.statuses.add(row.lifecycleStatus);
    if ((priority[row.lifecycleStatus] ?? 99) < (priority[current.primaryStatus] ?? 99)) current.primaryStatus = row.lifecycleStatus;
    result.set(row.productId, current);
  }
  return result;
}

export function getProductBusinessReadModel(query = {}, { includeInventoryCost = false, visibleProductIds = null, unpaged = false } = {}) {
  const database = getDatabase();
  const period = resolveProductBusinessPeriod(query, database);
  const products = database.prepare(`SELECT p.*,owner.name ownerName FROM products p LEFT JOIN persons owner ON owner.id=p.ownerId ORDER BY p.updatedAt DESC,p.id`).all();
  const visible = visibleProductIds ? new Set(visibleProductIds) : null;
  const allScopedProducts = visible ? products.filter((product) => visible.has(product.id)) : products;
  const productLifecycle = operatingProductLifecycleMap(database);
  const lifecycleReady = productLifecycle.size > 0;
  const showHistorical = query.includeHistorical === true || text(query.includeHistorical).toLowerCase() === "true" || text(query.includeHistorical) === "1";
  const defaultOperatingView = lifecycleReady && !showHistorical && !text(query.productId);
  const scopedProducts = defaultOperatingView
    ? allScopedProducts.filter((product) => [...(productLifecycle.get(product.id)?.statuses || [])].some((status) => ["active", "active_dependency", "sales_active"].includes(status)))
    : allScopedProducts;
  const productIds = scopedProducts.map((product) => product.id);
  const relationContext = readProductBusinessRelationContext(database);
  const currentSales = salesMetrics(database, period.periodStart, period.periodEnd);
  const previousSales = salesMetrics(database, period.previousPeriodStart, period.previousPeriodEnd);
  const earlierSales = salesMetrics(database, period.earlierPeriodStart, period.earlierPeriodEnd);
  const contributionOptions = { database };
  const currentContributionResult = queryProductContributions({ periodStart: period.periodStart, periodEnd: period.periodEnd, productIds }, contributionOptions);
  const currentContribution = new Map(currentContributionResult.items.map((item) => [item.productId, item]));
  const previousContribution = new Map(queryProductContributions({ periodStart: period.previousPeriodStart, periodEnd: period.previousPeriodEnd, productIds }, contributionOptions).items.map((item) => [item.productId, item]));
  const earlierContribution = new Map(queryProductContributions({ periodStart: period.earlierPeriodStart, periodEnd: period.earlierPeriodEnd, productIds }, contributionOptions).items.map((item) => [item.productId, item]));
  const structures = structureMetrics(database, relationContext);
  const linkPerformance = linkPerformanceMetrics(database, period.periodStart, period.periodEnd, relationContext);
  const health = latestHealth(database);
  const actions = actionMetrics(database);
  const inventory = readProductInventorySupplyMap(productIds, { includeCost: includeInventoryCost });
  let items = scopedProducts.map((product) => {
    const current = currentSales.get(product.id);
    const prior = previousSales.get(product.id);
    const earlier = earlierSales.get(product.id);
    const contribution = currentContribution.get(product.id);
    const priorContribution = previousContribution.get(product.id);
    const earlierContributionItem = earlierContribution.get(product.id);
    const legacyTrend = salesTrend(current, prior, earlier);
    const trend = physicalContributionTrend(contribution, priorContribution, earlierContributionItem);
    const inventorySummary = inventory.get(product.id)?.summary;
    const stockStatus = inventoryStatus(inventorySummary);
    const healthRecord = health.get(product.id);
    const structure = structures.skus.get(product.id) ?? { skuCount: 0, productCodes: [] };
    const action = actions.get(product.id) ?? { improvementCount: 0, actionCount: 0, taskCount: 0 };
    const salesAmount = numeric(contribution?.directSalesAmount);
    const salesQuantity = numeric(contribution?.totalPhysicalContribution);
    const legacySalesAmount = current?.salesAmountFactCount ? numeric(current.salesAmount) : null;
    const legacySalesQuantity = current?.salesQuantityFactCount ? numeric(current.salesQuantity) : null;
    const grossProfit = numeric(contribution?.directProfit);
    const grossMargin = grossProfit !== null && salesAmount !== null && salesAmount !== 0 ? grossProfit / salesAmount : null;
    return {
      id: product.id, name: product.name, sku: product.skuCode, productCode: structure.productCodes.join(" / ") || null,
      image: product.mainImage, brand: product.brand || null, category: product.category || null, ownerId: product.ownerId || null,
      ownerName: product.ownerName || "未分配", status: product.status, lifecycle: null,
      operatingLifecycle: { primaryStatus: productLifecycle.get(product.id)?.primaryStatus || null,
        statuses: [...(productLifecycle.get(product.id)?.statuses || [])].sort(), current: [...(productLifecycle.get(product.id)?.statuses || [])].some((status) => ["active", "active_dependency", "sales_active"].includes(status)) },
      sales: { amount: legacySalesAmount, quantity: legacySalesQuantity, directAmount: salesAmount, directCost: numeric(contribution?.directCost), directProfit: grossProfit,
        directQuantity: numeric(contribution?.directSalesQuantity), bundleContributionQuantity: numeric(contribution?.bundleContributionQuantity), totalPhysicalContribution: salesQuantity,
        previousAmount: numeric(priorContribution?.directSalesAmount), earlierAmount: numeric(earlierContributionItem?.directSalesAmount),
        previousQuantity: numeric(priorContribution?.totalPhysicalContribution), earlierQuantity: numeric(earlierContributionItem?.totalPhysicalContribution),
        bundleParticipationCount: Number(contribution?.bundleParticipationCount || 0), contributingBundleCount: Number(contribution?.contributingBundleCount || 0),
        bomEvidenceLevel: contribution?.bomEvidenceLevel ?? null, bomEvidence: contribution?.bomEvidence ?? { exact: 0, legacy_evidence: 0, inferred: 0, unknown: 0 },
        contribution: null, trend, factCount: Number(contribution?.directFactCount || 0) + Number(contribution?.bundleParticipationCount || 0),
        legacy: { amount: legacySalesAmount, quantity: legacySalesQuantity,
          profit: current?.profitFactCount ? numeric(current.grossProfit) : null, previousAmount: prior?.salesAmountFactCount ? numeric(prior.salesAmount) : null,
          previousQuantity: prior?.salesQuantityFactCount ? numeric(prior.salesQuantity) : null, trend: legacyTrend } },
      structure: { skuCount: structure.skuCount, salesLinkCount: structures.links.get(product.id) ?? 0 },
      inventory: { quantity: numeric(inventorySummary?.stockNum), availableQuantity: numeric(inventorySummary?.availableSendStock), amount: includeInventoryCost ? numeric(inventorySummary?.inventoryCostAmount) : null,
        coverageDays: numeric(inventorySummary?.stockDays), stockRisk: inventorySummary?.stockRisk ?? "no_data", status: stockStatus, businessDate: inventorySummary?.businessDate ?? null },
      profit: { grossMargin, grossProfit, status: profitStatus(grossProfit) },
      linkPerformance: linkPerformance.get(product.id) ?? { linkCount: structures.links.get(product.id) ?? 0, payAmount: null, visitorCount: null, conversionRate: null, measuredLinkCount: 0 },
      health: { score: healthRecord?.healthScore === null || healthRecord?.healthScore === undefined ? null : Number(healthRecord.healthScore),
        status: { code: healthRecord?.healthStatus ?? "no_data", label: ({ growth: "成长", stable: "稳定", attention: "关注", risk: "风险", no_data: "暂无数据" })[healthRecord?.healthStatus] ?? "暂无数据" }, evaluatedAt: healthRecord?.updatedAt ?? null },
      legacyHealth: { score: healthRecord?.healthScore === null || healthRecord?.healthScore === undefined ? null : Number(healthRecord.healthScore), evaluatedAt: healthRecord?.updatedAt ?? null },
      actions: { ...action, pendingCount: action.improvementCount + action.actionCount + action.taskCount },
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      _zone: businessZone(product, { salesAmount, salesQuantity }, inventorySummary),
      _previousSalesQuantity: numeric(priorContribution?.totalPhysicalContribution),
    };
  });
  const classifiedZones = classifyProductBusinessZones(items.map((item) => ({
    id: item.id,
    status: item.status,
    listedAt: null,
    analysis: {
      sales: { sales30d: item.sales.totalPhysicalContribution, previousSales30d: item._previousSalesQuantity, sales90d: null },
      inventory: { actualStock: item.inventory.quantity },
      finance: { revenue: item.sales.directAmount },
    },
  })));
  const zoneByProduct = new Map(classifiedZones.items.map((item) => [item.id, item.businessZone]));
  items = items.map((item) => {
    const lifecycle = mapProductBusinessLifecycle(item.status, zoneByProduct.get(item.id) ?? item._zone, item.sales.trend.code);
    const { _zone, _previousSalesQuantity, ...publicItem } = item;
    return { ...publicItem, lifecycle };
  });

  const totalSalesAmount = items.map((item) => item.sales.directAmount).filter((value) => value !== null).reduce((sum, value) => sum + Math.max(0, value), 0);
  const salesProductCount = items.filter((item) => item.sales.directAmount !== null && item.sales.directAmount > 0).length;
  const measuredLinks = items.map((item) => item.linkPerformance).filter((item) => item.conversionRate !== null && item.visitorCount > 0);
  const totalVisitors = measuredLinks.reduce((sum, item) => sum + item.visitorCount, 0);
  const averageConversionRate = totalVisitors > 0 ? measuredLinks.reduce((sum, item) => sum + item.conversionRate * item.visitorCount, 0) / totalVisitors : null;
  const healthContext = { period, averageSalesContribution: salesProductCount ? 1 / salesProductCount : null, averageConversionRate };
  items = items.map((item) => {
    const sales = { ...item.sales, contribution: item.sales.directAmount !== null && totalSalesAmount > 0 ? Math.max(0, item.sales.directAmount) / totalSalesAmount : null };
    const withContribution = { ...item, sales };
    return { ...withContribution, healthAnalysis: buildProductHealthAnalysis(withContribution, healthContext) };
  });

  const queryText = text(query.query).toLowerCase();
  const matches = (value, selected) => !text(selected) || text(value) === text(selected);
  items = items.filter((item) => matches(item.id, query.productId) && (!queryText || `${item.name} ${item.sku} ${item.productCode || ""}`.toLowerCase().includes(queryText))
    && matches(item.brand, query.brand) && matches(item.category, query.category) && matches(item.lifecycle, query.lifecycle)
    && matches(item.status, query.status) && matches(item.healthAnalysis.overall.code, query.healthStatus)
    && matches(item.ownerId, query.ownerId) && matches(item.inventory.status.code, query.inventoryStatus));

  const sortFields = { name: (item) => item.name, salesAmount: (item) => item.sales.directAmount, salesQuantity: (item) => item.sales.totalPhysicalContribution,
    salesTrend: (item) => item.sales.trend.rate, skuCount: (item) => item.structure.skuCount, salesLinkCount: (item) => item.structure.salesLinkCount,
    inventoryQuantity: (item) => item.inventory.quantity, inventoryAmount: (item) => item.inventory.amount, grossMargin: (item) => item.profit.grossMargin,
    grossProfit: (item) => item.profit.grossProfit, healthStatus: (item) => ({ risk: 3, attention: 2, healthy: 1, no_data: 0 }[item.healthAnalysis.overall.code]),
    healthScore: (item) => item.legacyHealth.score, pendingCount: (item) => item.actions.pendingCount,
    createdAt: (item) => item.createdAt, updatedAt: (item) => item.updatedAt };
  const sortBy = sortFields[text(query.sortBy)] ? text(query.sortBy) : "updatedAt";
  const sortDirection = text(query.sortDirection) === "asc" ? "asc" : "desc";
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  items.sort((left, right) => compareNullable(sortFields[sortBy](left), sortFields[sortBy](right), sortDirection, collator) || collator.compare(left.sku, right.sku));

  const page = normalizePage(query.page, 1);
  const total = items.length;
  const pageSize = unpaged ? Math.max(1, total) : Math.min(100, normalizePage(query.pageSize, 30));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);
  const pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allItems = scopedProducts.length;
  const sum = (read) => { const values = items.map(read).filter((value) => value !== null && value !== undefined); return values.length ? values.reduce((totalValue, value) => totalValue + Number(value), 0) : null; };
  const options = (key) => [...new Set(scopedProducts.map((item) => text(item[key])).filter(Boolean))].sort(collator.compare);
  const physicalTrendByDate = new Map();
  for (const item of currentContributionResult.dailyItems) {
    if (visible && !visible.has(item.productId)) continue;
    physicalTrendByDate.set(item.date, (physicalTrendByDate.get(item.date) || 0) + Number(item.totalPhysicalContribution || 0));
  }
  return {
    generatedAt: new Date().toISOString(), period,
    summary: { totalProducts: allItems, currentProductAssets: allScopedProducts.length, historicalProducts: Math.max(0, allScopedProducts.length - allItems), lifecycleReady,
      filteredProducts: total, directSalesAmount: sum((item) => item.sales.directAmount), directSalesQuantity: sum((item) => item.sales.directQuantity),
      bundleContributionQuantity: sum((item) => item.sales.bundleContributionQuantity), totalPhysicalContribution: sum((item) => item.sales.totalPhysicalContribution),
      salesAmount: sum((item) => item.sales.legacy.amount), salesQuantity: sum((item) => item.sales.legacy.quantity), inventoryQuantity: sum((item) => item.inventory.quantity), riskProducts: items.filter((item) => ["attention", "risk"].includes(item.healthAnalysis.overall.code)).length },
    items: pageItems, physicalTrend: [...physicalTrendByDate].map(([dateValue, totalPhysicalContribution]) => ({ date: dateValue, totalPhysicalContribution })).sort((left, right) => left.date.localeCompare(right.date)),
    unallocatedContribution: currentContributionResult.unallocatedContribution,
    pagination: { page: currentPage, pageSize, total, pages },
    options: { brands: options("brand"), categories: options("category"), statuses: options("status"), lifecycleStatuses: productBusinessLifecycleStatuses,
      healthStatuses: productBusinessHealthStatuses, inventoryStatuses: productBusinessInventoryStatuses,
      owners: [...new Map(scopedProducts.filter((item) => item.ownerId).map((item) => [item.ownerId, { id: item.ownerId, name: item.ownerName || "未分配" }])).values()].sort((left, right) => collator.compare(left.name, right.name)) },
    sort: { sortBy, sortDirection },
    definitions: { sales: "connection_sku_sales_daily_facts + Sales Object + BOM + Product Mapping", salesContractVersion: "product-contribution-v1",
      productEconomics: "Single直接事实；Bundle金额/利润不分摊", physicalQuantity: "Direct Sales Quantity + Bundle Contribution Quantity",
      legacyFields: "summary.salesAmount/summary.salesQuantity与item.sales.legacy仅用于兼容旧调用方", operatingView: "Active + Active Dependency + Sales Active；Product战略生命周期保持独立",
      inventory: "现有库存供应查询", health: "ProductBusinessReadModel 规则分析", actions: "product_improvements + action_products + tasks", readOnly: true },
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
