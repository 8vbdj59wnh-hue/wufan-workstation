import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";
import { resolveLinkSkuErpRelations } from "./capabilities/resolveLinkSkuErpRelation.js";

export const productLifecycleStatuses = ["开发中", "上架", "成长期", "成熟期", "风险期", "淘汰"];
export const productBusinessZones = ["new", "hit", "active", "clearance"];
const newProductCycleDays = Math.max(1, Number(process.env.PRODUCT_NEW_CYCLE_DAYS) || 30);
const explicitNewStatuses = new Set(["新品", "开发中", "待上架", "上架"]);
const clearanceStatuses = new Set(["风险期", "淘汰", "清仓", "停售"]);

function text(value) { return String(value ?? "").trim(); }
function number(value) { return value === null || value === undefined ? null : Number(value); }
function parseJson(value, fallback) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function now() { return new Date().toISOString(); }
function ratio(current, previous) { return previous === null || previous === 0 || current === null ? null : (current - previous) / Math.abs(previous); }

export function classifyProductBusinessZones(items, options = {}) {
  const cycleDays = Math.max(1, Number(options.newCycleDays) || newProductCycleDays);
  const nowTime = Number(options.nowTime) || Date.now();
  const cycleStart = nowTime - cycleDays * 86400000;
  const isNew = (item) => {
    if (explicitNewStatuses.has(item.status)) return true;
    if (clearanceStatuses.has(item.status)) return false;
    const listedTime = Date.parse(item.listedAt || "");
    return Number.isFinite(listedTime) && listedTime >= cycleStart && listedTime <= nowTime;
  };
  const newIds = new Set(items.filter(isNew).map((item) => item.id));
  const sustained = items.filter((item) => !newIds.has(item.id) && !clearanceStatuses.has(item.status)
    && Number(item.analysis?.sales?.sales30d || 0) > 0
    && (Number(item.analysis?.sales?.previousSales30d || 0) > 0
      || Number(item.analysis?.sales?.sales90d || 0) > Number(item.analysis?.sales?.sales30d || 0)));
  const topCount = sustained.length ? Math.max(1, Math.ceil(sustained.length * 0.2)) : 0;
  const topBy = (read) => new Set([...sustained].filter((item) => read(item) > 0)
    .sort((left, right) => read(right) - read(left)).slice(0, topCount).map((item) => item.id));
  const topRevenueIds = topBy((item) => Number(item.analysis?.finance?.revenue || 0));
  const topSalesIds = topBy((item) => Number(item.analysis?.sales?.sales30d || 0));
  const hitIds = new Set([...topRevenueIds, ...topSalesIds]);
  const positiveSales = items.filter((item) => !newIds.has(item.id) && !hitIds.has(item.id))
    .map((item) => Number(item.analysis?.sales?.sales30d || 0)).filter((value) => value > 0).sort((left, right) => left - right);
  const lowSalesThreshold = positiveSales.length >= 5 ? positiveSales[Math.max(0, Math.ceil(positiveSales.length * 0.2) - 1)] : 0;
  const counts = Object.fromEntries(productBusinessZones.map((zone) => [zone, 0]));
  const classified = items.map((item) => {
    const sales30d = Number(item.analysis?.sales?.sales30d || 0);
    const stock = Number(item.analysis?.inventory?.actualStock || 0);
    let businessZone = null;
    if (newIds.has(item.id)) businessZone = "new";
    else if (hitIds.has(item.id)) businessZone = "hit";
    else if (stock > 0 && (clearanceStatuses.has(item.status) || sales30d <= 0 || (lowSalesThreshold > 0 && sales30d <= lowSalesThreshold))) businessZone = "clearance";
    else if (sales30d > 0) businessZone = "active";
    if (businessZone) counts[businessZone] += 1;
    return { ...item, businessZone };
  });
  return { items: classified, counts, rules: { newProductCycleDays: cycleDays, hitTopPercent: 20, lowSalesPercent: 20 } };
}

function latestProductSnapshots(database, productId) {
  const rows = database.prepare(`
    SELECT p.*,f.businessDate,f.id AS factSnapshotId
    FROM product_daily_snapshots p JOIN erp_fact_snapshots f ON f.id=p.snapshotId
    WHERE p.productId=? AND f.status='completed'
    ORDER BY f.businessDate DESC,f.createdAt DESC LIMIT 2
  `).all(productId);
  return { current: rows[0] ?? null, previous: rows[1] ?? null };
}

function financeMetrics(database, productId) {
  const rows = database.prepare(`SELECT entryType,amount FROM finance_entries WHERE productId=? AND status IN ('confirmed','approved')`).all(productId);
  if (!rows.length) return { revenue: null, refunds: null, cost: null, expense: null, grossProfit: null, netProfit: null, profitMargin: null };
  const sum = (type) => rows.filter((row) => row.entryType === type).reduce((total, row) => total + Number(row.amount || 0), 0);
  const grossIncome = sum("income"); const refunds = sum("refund"); const revenue = grossIncome - refunds;
  const cost = sum("cost"); const expense = sum("expense"); const grossProfit = revenue - cost; const netProfit = grossProfit - expense;
  return { revenue, refunds, cost, expense, grossProfit, netProfit, profitMargin: revenue ? netProfit / revenue : null };
}

function resolveProductSalesLinkIds(database, productId) {
  const erpSkuIds = database.prepare(`
    SELECT DISTINCT erpSkuId
    FROM product_erp_mappings
    WHERE productId=? AND currentState='active' AND erpSkuId IS NOT NULL
    ORDER BY erpSkuId
  `).all(productId).map((row) => row.erpSkuId);
  if (!erpSkuIds.length) return [];
  const erpSkuIdSet = new Set(erpSkuIds);
  const salesLinkSkuIds = database.prepare(`
    SELECT DISTINCT salesLinkSkuId
    FROM sales_link_sku_erp_mappings
    WHERE currentState='active' AND erpSkuId IN (${erpSkuIds.map(() => "?").join(",")})
    ORDER BY salesLinkSkuId
  `).all(...erpSkuIds).map((row) => row.salesLinkSkuId);
  const salesLinkIds = new Set();
  for (let offset = 0; offset < salesLinkSkuIds.length; offset += 500) {
    const relations = resolveLinkSkuErpRelations({ salesLinkSkuIds: salesLinkSkuIds.slice(offset, offset + 500) }, { database }).results;
    for (const relation of Object.values(relations)) {
      if (relation.isUsable && relation.mappings.some((mapping) => erpSkuIdSet.has(mapping.erpSkuId))) salesLinkIds.add(relation.salesLinkId);
    }
  }
  return [...salesLinkIds].sort();
}

function connectionMetrics(database, productId) {
  const salesLinkIds = resolveProductSalesLinkIds(database, productId);
  const periods = salesLinkIds.length ? database.prepare(`
    SELECT s.periodStart,s.periodEnd,SUM(s.payAmount) payAmount,SUM(s.visitorCount) visitorCount,
      CASE WHEN SUM(s.visitorCount)>0 THEN SUM(s.conversionRate*s.visitorCount)/SUM(s.visitorCount) ELSE NULL END conversionRate
    FROM connection_period_snapshots s
    WHERE s.salesLinkId IN (${salesLinkIds.map(() => "?").join(",")})
    GROUP BY s.periodStart,s.periodEnd ORDER BY s.periodEnd DESC,s.periodStart DESC LIMIT 2
  `).all(...salesLinkIds) : [];
  const current = periods[0] ?? null; const previous = periods[1] ?? null;
  return { current, previous, salesAmountGrowth: ratio(number(current?.payAmount), number(previous?.payAmount)),
    visitorGrowth: ratio(number(current?.visitorCount), number(previous?.visitorCount)),
    conversionChange: current?.conversionRate === null || previous?.conversionRate === null || !current || !previous
      ? null : Number(current.conversionRate) - Number(previous.conversionRate) };
}

export function getProductBusinessAnalysis(productId) {
  const database = getDatabase();
  const product = database.prepare("SELECT id,name,skuCode,status,mainImage,createdAt,updatedAt FROM products WHERE id=?").get(text(productId));
  if (!product) throw new Error("产品不存在。");
  const snapshots = latestProductSnapshots(database, product.id);
  const currentSales = number(snapshots.current?.sales30d); const previousSales = number(snapshots.previous?.sales30d);
  const actualStock = number(snapshots.current?.totalStock);
  const salesGrowth = ratio(currentSales, previousSales);
  const inventoryTurnover = actualStock !== null && currentSales !== null && actualStock + currentSales > 0 ? currentSales / (actualStock + currentSales) : null;
  return { product, snapshotKey: snapshots.current?.factSnapshotId ?? `live:${new Date().toISOString().slice(0, 10)}`,
    sales: { businessDate: snapshots.current?.businessDate ?? null, sales30d: currentSales, previousSales30d: previousSales, growth: salesGrowth },
    inventory: { actualStock, turnover: inventoryTurnover, risk: actualStock !== null && actualStock > 0 && (currentSales ?? 0) === 0 ? "积压" : actualStock === 0 ? "缺货" : "正常" },
    finance: financeMetrics(database, product.id), connections: connectionMetrics(database, product.id) };
}

function evaluate(analysis) {
  const problems = []; const suggestions = [];
  if (analysis.sales.growth !== null && analysis.sales.growth < -0.2) { problems.push({ type: "sales_decline", title: "销售下降", severity: analysis.sales.growth < -0.4 ? "high" : "medium", value: analysis.sales.growth }); suggestions.push({ title: "复盘产品销售下降原因", reason: "近两期销量下降" }); }
  if (analysis.inventory.risk === "积压") { problems.push({ type: "inventory_backlog", title: "库存积压", severity: "high", value: analysis.inventory.actualStock }); suggestions.push({ title: "制定库存去化方案", reason: "有库存但近30天无销量" }); }
  if (analysis.inventory.risk === "缺货" && (analysis.sales.sales30d ?? 0) > 0) { problems.push({ type: "stockout", title: "库存不足", severity: "medium", value: 0 }); suggestions.push({ title: "检查补货计划", reason: "有销量但当前库存为零" }); }
  if (analysis.finance.profitMargin !== null && analysis.finance.profitMargin < 0.1) { problems.push({ type: "profit_low", title: "利润偏低", severity: analysis.finance.profitMargin < 0 ? "high" : "medium", value: analysis.finance.profitMargin }); suggestions.push({ title: "复核成本与费用结构", reason: "产品利润率低于10%" }); }
  if (analysis.connections.conversionChange !== null && analysis.connections.conversionChange < -0.01) { problems.push({ type: "conversion_decline", title: "转化下降", severity: "medium", value: analysis.connections.conversionChange }); suggestions.push({ title: "检查关联连接主图、详情和价格", reason: "连接转化率下降超过1个百分点" }); }
  const scores = [];
  if (analysis.sales.sales30d !== null) scores.push(analysis.sales.sales30d > 0 ? 75 + Math.max(-25, Math.min(25, (analysis.sales.growth ?? 0) * 100)) : 25);
  if (analysis.finance.profitMargin !== null) scores.push(Math.max(0, Math.min(100, 50 + analysis.finance.profitMargin * 100)));
  if (analysis.inventory.actualStock !== null) scores.push(analysis.inventory.risk === "正常" ? 85 : analysis.inventory.risk === "缺货" ? 55 : 25);
  if (analysis.connections.conversionChange !== null) scores.push(Math.max(0, Math.min(100, 70 + analysis.connections.conversionChange * 1000)));
  const healthScore = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
  const healthStatus = healthScore === null ? "no_data" : healthScore >= 80 ? "growth" : healthScore >= 60 ? "stable" : healthScore >= 40 ? "attention" : "risk";
  return { healthScore, healthStatus, problems, suggestions };
}

function parseHealth(row) { return row ? { ...row, metrics: parseJson(row.metricsJson, {}), problems: parseJson(row.problemsJson, []), suggestions: parseJson(row.suggestionsJson, []) } : null; }

export function evaluateProductHealth(productId) {
  const database = getDatabase(); const analysis = getProductBusinessAnalysis(productId); const result = evaluate(analysis); const timestamp = now();
  const save = database.transaction(() => {
    const existing = database.prepare("SELECT id,createdAt FROM product_health_records WHERE productId=? AND snapshotKey=?").get(text(productId), analysis.snapshotKey);
    const id = existing?.id ?? `product-health-${crypto.randomUUID()}`;
    database.prepare(`INSERT INTO product_health_records (id,productId,snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(productId,snapshotKey) DO UPDATE SET healthScore=excluded.healthScore,healthStatus=excluded.healthStatus,
      metricsJson=excluded.metricsJson,problemsJson=excluded.problemsJson,suggestionsJson=excluded.suggestionsJson,updatedAt=excluded.updatedAt`)
      .run(id, text(productId), analysis.snapshotKey, result.healthScore, result.healthStatus, JSON.stringify(analysis), JSON.stringify(result.problems), JSON.stringify(result.suggestions), existing?.createdAt ?? timestamp, timestamp);
    const issue = database.prepare(`INSERT INTO product_issues (id,productId,healthRecordId,issueType,title,severity,detailJson,status,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,'open',?,?) ON CONFLICT(healthRecordId,issueType) DO UPDATE SET title=excluded.title,severity=excluded.severity,detailJson=excluded.detailJson,updatedAt=excluded.updatedAt`);
    for (const problem of result.problems) issue.run(`product-issue-${crypto.randomUUID()}`, text(productId), id, problem.type, problem.title, problem.severity, JSON.stringify(problem), timestamp, timestamp);
    return id;
  });
  const id = save(); return parseHealth(database.prepare("SELECT * FROM product_health_records WHERE id=?").get(id));
}

export function getProductV2Detail(productId) {
  const database = getDatabase(); const analysis = getProductBusinessAnalysis(productId);
  const lifecycle = database.prepare("SELECT * FROM product_lifecycle_events WHERE productId=? ORDER BY changedAt DESC").all(text(productId));
  const healthRecords = database.prepare("SELECT * FROM product_health_records WHERE productId=? ORDER BY updatedAt DESC LIMIT 20").all(text(productId)).map(parseHealth);
  const issues = database.prepare("SELECT * FROM product_issues WHERE productId=? ORDER BY updatedAt DESC").all(text(productId)).map((row) => ({ ...row, detail: parseJson(row.detailJson, {}) }));
  const improvements = database.prepare(`SELECT i.*,p.name actionName,p.status actionStatus FROM product_improvements i JOIN process_instances p ON p.id=i.actionId WHERE i.productId=? ORDER BY i.updatedAt DESC`).all(text(productId)).map((row) => ({ ...row, beforeMetrics: parseJson(row.beforeMetricsJson, {}), afterMetrics: parseJson(row.afterMetricsJson, {}) }));
  return { analysis, lifecycle, healthRecords, issues, improvements };
}

export function getProductV2Overview() {
  const database = getDatabase(); const products = database.prepare("SELECT id,name,skuCode,status,mainImage,createdAt,updatedAt FROM products WHERE status<>'已归档'").all();
  const listedRows = database.prepare(`SELECT productId,MIN(changedAt) listedAt FROM product_lifecycle_events
    WHERE toStatus IN ('新品','上架','在售') GROUP BY productId`).all();
  const listedByProduct = new Map(listedRows.map((row) => [row.productId, row.listedAt]));
  const snapshots = database.prepare(`SELECT * FROM (SELECT p.*,f.businessDate,f.id factSnapshotId,ROW_NUMBER() OVER (PARTITION BY p.productId ORDER BY f.businessDate DESC,f.createdAt DESC) position
    FROM product_daily_snapshots p JOIN erp_fact_snapshots f ON f.id=p.snapshotId WHERE f.status='completed') WHERE position<=2`).all();
  const snapshotsByProduct = new Map(); for (const row of snapshots) { const value=snapshotsByProduct.get(row.productId)||{}; value[row.position===1?"current":"previous"]=row; snapshotsByProduct.set(row.productId,value); }
  const liveRows = database.prepare(`SELECT productId,
    SUM(COALESCE(CAST(json_extract(latestStateJson,'$.sales30d') AS REAL),0)) sales30d,
    SUM(COALESCE(CAST(json_extract(latestStateJson,'$.sales90d') AS REAL),0)) sales90d,
    SUM(COALESCE(CAST(json_extract(latestStateJson,'$.actualStock') AS REAL),0)) actualStock
    FROM product_erp_mappings WHERE productId IS NOT NULL GROUP BY productId`).all();
  const liveByProduct = new Map(liveRows.map((row) => [row.productId, row]));
  const financeRows = database.prepare(`SELECT productId,
    SUM(CASE WHEN entryType='income' THEN amount ELSE 0 END) grossIncome,SUM(CASE WHEN entryType='refund' THEN amount ELSE 0 END) refunds,
    SUM(CASE WHEN entryType='cost' THEN amount ELSE 0 END) cost,SUM(CASE WHEN entryType='expense' THEN amount ELSE 0 END) expense
    FROM finance_entries WHERE productId IS NOT NULL AND status IN ('confirmed','approved') GROUP BY productId`).all();
  const financeByProduct = new Map(financeRows.map((row)=>{const revenue=Number(row.grossIncome||0)-Number(row.refunds||0);const grossProfit=revenue-Number(row.cost||0);const netProfit=grossProfit-Number(row.expense||0);return [row.productId,{revenue,refunds:Number(row.refunds||0),cost:Number(row.cost||0),expense:Number(row.expense||0),grossProfit,netProfit,profitMargin:revenue?netProfit/revenue:null}];}));
  const emptyFinance = { revenue:null,refunds:null,cost:null,expense:null,grossProfit:null,netProfit:null,profitMargin:null };
  const rawItems = products.map((product) => { const pair=snapshotsByProduct.get(product.id)||{};const live=liveByProduct.get(product.id)||{};const currentSales=number(pair.current?.sales30d)??number(live.sales30d);const previousSales=number(pair.previous?.sales30d);const sales90d=number(live.sales90d);const actualStock=number(pair.current?.totalStock)??number(live.actualStock);const listedAt=listedByProduct.get(product.id)??null;const analysis={ product,snapshotKey:pair.current?.factSnapshotId??null,
    sales:{businessDate:pair.current?.businessDate??null,sales30d:currentSales,sales90d,previousSales30d:previousSales,growth:ratio(currentSales,previousSales)},
    inventory:{actualStock,turnover:actualStock!==null&&currentSales!==null&&actualStock+currentSales>0?currentSales/(actualStock+currentSales):null,risk:actualStock!==null&&actualStock>0&&(currentSales??0)===0?"积压":actualStock===0?"缺货":"正常"},
    finance:financeByProduct.get(product.id)||emptyFinance,connections:{current:null,previous:null,salesAmountGrowth:null,visitorGrowth:null,conversionChange:null} }; const health=evaluate(analysis);return {...product,listedAt,analysis,...health}; });
  const zones = classifyProductBusinessZones(rawItems);
  const items = zones.items;
  const lifecycle = Object.fromEntries(productLifecycleStatuses.map((status) => [status, items.filter((item) => item.status === status).length]));
  lifecycle["待归类"] = items.filter((item) => !productLifecycleStatuses.includes(item.status)).length;
  return { total: items.length, lifecycle, businessZones: zones.counts, businessZoneRules: zones.rules,
    growth: items.filter((item) => item.healthStatus === "growth").sort((a,b) => (b.healthScore ?? -1)-(a.healthScore ?? -1)).slice(0,10),
    risks: items.filter((item) => ["attention","risk"].includes(item.healthStatus)).sort((a,b) => (a.healthScore ?? 101)-(b.healthScore ?? 101)).slice(0,10), items };
}

export function changeProductLifecycle(productId, input, userId) {
  const toStatus = text(input?.status); if (!productLifecycleStatuses.includes(toStatus)) throw new Error("产品生命周期状态无效。");
  const database = getDatabase(); const product = database.prepare("SELECT id,status FROM products WHERE id=?").get(text(productId)); if (!product) throw new Error("产品不存在。");
  if (product.status === toStatus) throw new Error("产品已经处于该生命周期状态。"); const timestamp = now();
  return database.transaction(() => { database.prepare("UPDATE products SET status=?,updatedAt=? WHERE id=?").run(toStatus,timestamp,product.id);
    const event = { id:`product-lifecycle-${crypto.randomUUID()}`,productId:product.id,fromStatus:product.status,toStatus,reason:text(input?.reason),changedBy:userId||null,changedAt:timestamp };
    database.prepare("INSERT INTO product_lifecycle_events (id,productId,fromStatus,toStatus,reason,changedBy,changedAt) VALUES (@id,@productId,@fromStatus,@toStatus,@reason,@changedBy,@changedAt)").run(event); return event; })();
}

export function createProductImprovementAction(issueId, input, userId) {
  const database = getDatabase(); const issue = database.prepare("SELECT i.*,p.name productName FROM product_issues i JOIN products p ON p.id=i.productId WHERE i.id=?").get(text(issueId)); if (!issue) throw new Error("产品经营问题不存在。");
  const goal = database.prepare("SELECT id,status FROM goals WHERE id=?").get(text(input?.goalId)); if (!goal || goal.status !== "active") throw new Error("请选择有效目标。");
  const template = database.prepare(`SELECT t.id,t.name,t.defaultProcessTemplateId,p.version FROM task_templates t JOIN process_templates p ON p.id=t.defaultProcessTemplateId WHERE t.id=? AND t.status='active'`).get(text(input?.taskTemplateId));
  if (!template) throw new Error("请选择已绑定标准流程的启用关键行动。"); const title = text(input?.title) || `改善${issue.productName}：${issue.title}`;
  return database.transaction(() => { const timestamp=now(); const instance=createResource("process-instances",{id:`process-instance-${crypto.randomUUID()}`,templateId:template.defaultProcessTemplateId,taskTemplateId:template.id,templateVersion:template.version,name:title,displayTitle:title,goalId:goal.id,initiatorId:text(userId),description:`来源：产品经营问题；产品：${issue.productName}；问题：${issue.title}`,status:"draft",customFields:{source:"product_health",productId:issue.productId,productIssueId:issue.id,healthRecordId:issue.healthRecordId},createdAt:timestamp,updatedAt:timestamp});
    const id=`product-improvement-${crypto.randomUUID()}`; const health=database.prepare("SELECT metricsJson FROM product_health_records WHERE id=?").get(issue.healthRecordId);
    database.prepare(`INSERT INTO product_improvements (id,productId,issueId,actionId,title,status,beforeMetricsJson,afterMetricsJson,createdAt,updatedAt) VALUES (?,?,?,?,?,'planned',?,'{}',?,?)`).run(id,issue.productId,issue.id,instance.id,title,health?.metricsJson||"{}",timestamp,timestamp);
    const actionProduct=createResource("action-products",{id:`action-product-${crypto.randomUUID()}`,actionId:instance.id,productId:issue.productId,createdAt:timestamp});
    database.prepare("UPDATE product_issues SET status='improving',updatedAt=? WHERE id=?").run(timestamp,issue.id); return { instance, actionProduct, improvement: database.prepare("SELECT * FROM product_improvements WHERE id=?").get(id) }; })();
}

export const productIssueTypeCatalog = Object.freeze([
  { code: "traffic_insufficient", category: "销售问题", label: "流量不足" },
  { code: "click_rate_low", category: "销售问题", label: "点击率低" },
  { code: "conversion_rate_low", category: "销售问题", label: "转化率低" },
  { code: "sales_decline", category: "销售问题", label: "销售下降" },
  { code: "sales_link_performance", category: "销售问题", label: "销售链接表现" },
  { code: "inventory_backlog", category: "库存问题", label: "库存积压" },
  { code: "stockout_risk", category: "库存问题", label: "缺货风险" },
  { code: "gross_margin_insufficient", category: "利润问题", label: "毛利不足" },
  { code: "cost_high", category: "利润问题", label: "成本过高" },
  { code: "customer_feedback", category: "产品问题", label: "用户反馈问题" },
  { code: "competitiveness_insufficient", category: "产品问题", label: "竞争力不足" },
  { code: "image_insufficient", category: "内容问题", label: "图片不足" },
  { code: "selling_point_insufficient", category: "内容问题", label: "卖点不足" },
  { code: "detail_page_issue", category: "内容问题", label: "详情页问题" },
]);

const productIssueTypeByCode = new Map(productIssueTypeCatalog.map((item) => [item.code, item]));
const productHealthRecommendations = Object.freeze({
  sales_decline: { title: "优化产品详情页转化", problemTitle: "销售趋势下降", issueType: "sales_decline", issue: "销售连续两个周期下降", improvementGoal: "恢复产品销售表现", suggestedDirection: "优化详情页与转化路径", dimension: "sales" },
  inventory_backlog: { title: "制定库存消化方案", problemTitle: "库存风险", issueType: "inventory_backlog", issue: "库存覆盖周期偏高或长期无动销", improvementGoal: "恢复库存健康周转", suggestedDirection: "制定库存消化方案", dimension: "inventory" },
  inventory_stockout: { title: "制定补货保障方案", problemTitle: "缺货风险", issueType: "stockout_risk", issue: "当前库存不足，存在缺货风险", improvementGoal: "保障产品持续供货", suggestedDirection: "制定补货与供应保障方案", dimension: "inventory" },
  profit_low: { title: "优化产品成本结构", problemTitle: "毛利不足", issueType: "gross_margin_insufficient", issue: "现有利润事实显示毛利率偏低", improvementGoal: "提升产品盈利能力", suggestedDirection: "优化成本与定价结构", dimension: "profit" },
  link_optimization: { title: "优化关联销售链接表现", problemTitle: "链接表现需优化", issueType: "sales_link_performance", issue: "关联销售链接贡献或转化表现需优化", improvementGoal: "提升销售链接转化表现", suggestedDirection: "优化图片、卖点与详情页", dimension: "links" },
});

function parseImprovement(row) {
  return row ? { ...row, detail: parseJson(row.detailJson, {}), beforeMetrics: parseJson(row.beforeMetricsJson, {}), afterMetrics: parseJson(row.afterMetricsJson, {}) } : null;
}

function healthIssueView(recommendation, analysis, persistedIssues = []) {
  const profile = productHealthRecommendations[recommendation.code];
  if (!profile) return null;
  const type = productIssueTypeByCode.get(profile.issueType);
  const persisted = persistedIssues.find((item) => item.issueType === profile.issueType && item.status !== "closed");
  const severity = analysis?.dimensions?.[profile.dimension]?.severity ?? "attention";
  return { id: persisted?.id ?? null, recommendationCode: recommendation.code, issueType: profile.issueType,
    issueTypeLabel: type?.label ?? profile.problemTitle, category: type?.category ?? "其他问题", title: profile.problemTitle,
    severity, status: persisted?.status ?? "identified", reason: recommendation.reason || profile.issue,
    problemDescription: recommendation.reason || profile.issue, improvementGoal: profile.improvementGoal, suggestedDirection: profile.suggestedDirection };
}

export function getProductImprovementCenter(productId, healthAnalysis) {
  const database = getDatabase();
  const product = database.prepare("SELECT id,name FROM products WHERE id=?").get(text(productId));
  if (!product) throw new Error("产品不存在。");
  const persistedIssues = database.prepare("SELECT * FROM product_issues WHERE productId=? ORDER BY updatedAt DESC").all(product.id).map((row) => ({ ...row, detail: parseJson(row.detailJson, {}) }));
  const rows = database.prepare(`SELECT i.*,q.issueType,q.title issueTitle,q.detailJson,p.name actionName,p.displayTitle,p.status actionStatus,
      p.startedAt,p.createdAt actionCreatedAt,p.completedAt actionCompletedAt,t.ownerId,owner.name ownerName,
      (SELECT COUNT(*) FROM tasks task WHERE task.processInstanceId=p.id) taskCount,
      (SELECT COUNT(*) FROM tasks task WHERE task.processInstanceId=p.id AND task.status IN ('done','completed')) doneTaskCount
    FROM product_improvements i JOIN product_issues q ON q.id=i.issueId JOIN process_instances p ON p.id=i.actionId
    LEFT JOIN task_templates t ON t.id=p.taskTemplateId LEFT JOIN persons owner ON owner.id=t.ownerId
    WHERE i.productId=? ORDER BY i.updatedAt DESC,i.createdAt DESC`).all(product.id);
  const improvements = rows.map((row) => {
    const item = parseImprovement(row); const type = productIssueTypeByCode.get(item.issueType);
    return { ...item, issueTypeLabel: type?.label ?? item.issueTitle, issueCategory: type?.category ?? "其他问题",
      actionName: item.displayTitle || item.actionName, ownerName: item.ownerName || "未设置", startAt: item.startedAt || item.actionCreatedAt,
      completedAt: item.completedAt || item.actionCompletedAt || null, canRecordResult: ["done", "completed"].includes(item.actionStatus) };
  });
  return { product: { id: product.id, name: product.name }, issueTypes: productIssueTypeCatalog,
    currentIssues: (healthAnalysis?.recommendations ?? []).map((item) => healthIssueView(item, healthAnalysis, persistedIssues)).filter(Boolean),
    improvements, readOnlyFacts: true };
}

export function createProductHealthAction(productId, input, userId, healthAnalysis = null) {
  const database = getDatabase();
  const product = database.prepare("SELECT id,name FROM products WHERE id=?").get(text(productId));
  if (!product) throw new Error("产品不存在。");
  const recommendationCode = text(input?.recommendationCode);
  const recommendation = productHealthRecommendations[recommendationCode];
  if (!recommendation) throw new Error("改善行动类型无效。");
  const goal = database.prepare("SELECT id,status FROM goals WHERE id=?").get(text(input?.goalId));
  if (!goal || goal.status !== "active") throw new Error("请选择有效目标。");
  const template = database.prepare(`SELECT t.id,t.name,t.defaultProcessTemplateId,p.version
    FROM task_templates t JOIN process_templates p ON p.id=t.defaultProcessTemplateId
    WHERE t.id=? AND t.status='active'`).get(text(input?.taskTemplateId));
  if (!template) throw new Error("请选择已绑定标准流程的启用关键行动。");
  const title = text(input?.title) || `${recommendation.title}：${product.name}`;
  return database.transaction(() => {
    const timestamp = now();
    let issue = database.prepare("SELECT * FROM product_issues WHERE productId=? AND issueType=? AND status<>'closed' ORDER BY updatedAt DESC LIMIT 1").get(product.id, recommendation.issueType);
    const matchedRecommendation = healthAnalysis?.recommendations?.find((item) => item.code === recommendationCode);
    const problemDescription = matchedRecommendation?.reason || recommendation.issue;
    const issueType = productIssueTypeByCode.get(recommendation.issueType);
    if (!issue) {
      const healthRecordId = `product-health-improvement-${crypto.randomUUID()}`;
      database.prepare(`INSERT INTO product_health_records (id,productId,snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt)
        VALUES (?,?,?,NULL,?,?,?,?,?,?)`).run(healthRecordId, product.id, `improvement:${crypto.randomUUID()}`, healthAnalysis?.overall?.code || "no_data",
        JSON.stringify(healthAnalysis || {}), JSON.stringify([{ issueType: recommendation.issueType, problemDescription }]), JSON.stringify([{ title: recommendation.title }]), timestamp, timestamp);
      const issueId = `product-issue-${crypto.randomUUID()}`;
      const detail = { standardIssueType: recommendation.issueType, category: issueType?.category, problemDescription,
        improvementGoal: recommendation.improvementGoal, suggestedDirection: recommendation.suggestedDirection,
        sourceRecommendationCode: recommendationCode, evidence: healthAnalysis?.dimensions?.[recommendation.dimension]?.evidence ?? {} };
      database.prepare(`INSERT INTO product_issues (id,productId,healthRecordId,issueType,title,severity,detailJson,status,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,'open',?,?)`).run(issueId, product.id, healthRecordId, recommendation.issueType, recommendation.problemTitle,
        healthAnalysis?.dimensions?.[recommendation.dimension]?.severity === "risk" ? "high" : "medium", JSON.stringify(detail), timestamp, timestamp);
      issue = database.prepare("SELECT * FROM product_issues WHERE id=?").get(issueId);
    }
    const instance = createResource("process-instances", {
      id: `process-instance-${crypto.randomUUID()}`, templateId: template.defaultProcessTemplateId, taskTemplateId: template.id,
      templateVersion: template.version, name: title, displayTitle: title, goalId: goal.id, initiatorId: text(userId),
      description: `来源：产品健康分析；产品：${product.name}；问题：${problemDescription}；改善目标：${recommendation.improvementGoal}；建议方向：${recommendation.suggestedDirection}。`, status: "draft",
      customFields: { source: "product_health_analysis", productId: product.id, productIssueId: issue.id, problemType: recommendation.issueType,
        problemTypeLabel: issueType?.label, problemDescription, improvementGoal: recommendation.improvementGoal,
        suggestedDirection: recommendation.suggestedDirection, recommendationCode }, createdAt: timestamp, updatedAt: timestamp,
    });
    const actionProduct = createResource("action-products", { id: `action-product-${crypto.randomUUID()}`, actionId: instance.id, productId: product.id, createdAt: timestamp });
    const improvementId = `product-improvement-${crypto.randomUUID()}`;
    const beforeMetrics = { summary: problemDescription, healthStatus: healthAnalysis?.overall ?? null,
      dimension: healthAnalysis?.dimensions?.[recommendation.dimension] ?? null, capturedAt: timestamp };
    database.prepare(`INSERT INTO product_improvements (id,productId,issueId,actionId,title,status,beforeMetricsJson,afterMetricsJson,createdAt,updatedAt)
      VALUES (?,?,?,?,?,'planned',?,'{}',?,?)`).run(improvementId, product.id, issue.id, instance.id, title, JSON.stringify(beforeMetrics), timestamp, timestamp);
    database.prepare("UPDATE product_issues SET status='improving',updatedAt=? WHERE id=?").run(timestamp, issue.id);
    const savedIssue = database.prepare("SELECT * FROM product_issues WHERE id=?").get(issue.id);
    return { instance, actionProduct, issue: { ...savedIssue, detail: parseJson(savedIssue.detailJson, {}) }, improvement: parseImprovement(database.prepare("SELECT * FROM product_improvements WHERE id=?").get(improvementId)) };
  })();
}

export function recordProductImprovementResult(improvementId, input, { visibleProductIds = null } = {}) {
  const database = getDatabase();
  const current = database.prepare(`SELECT i.*,p.status actionStatus,p.completedAt actionCompletedAt FROM product_improvements i
    JOIN process_instances p ON p.id=i.actionId WHERE i.id=?`).get(text(improvementId));
  if (!current) throw new Error("产品改善记录不存在。");
  if (visibleProductIds && !new Set(visibleProductIds).has(current.productId)) {
    const error = new Error("无权修改该产品的改善记录。"); error.statusCode = 403; throw error;
  }
  if (!["done", "completed"].includes(current.actionStatus)) throw new Error("关键行动完成后才能记录改善结果。");
  const improvementMeasures = text(input?.improvementMeasures);
  const resultSummary = text(input?.resultSummary);
  const completedAt = text(input?.completedAt) || current.actionCompletedAt;
  if (!improvementMeasures) throw new Error("请填写改善措施。");
  if (!resultSummary) throw new Error("请填写改善后结果。");
  if (!completedAt || Number.isNaN(Date.parse(completedAt.length === 10 ? `${completedAt}T00:00:00+08:00` : completedAt))) throw new Error("请填写有效完成时间。");
  const timestamp = now();
  const afterMetrics = { ...(input?.afterMetrics && typeof input.afterMetrics === "object" ? input.afterMetrics : {}), summary: resultSummary };
  database.prepare(`UPDATE product_improvements SET status='result_recorded',improvementMeasures=?,afterMetricsJson=?,resultSummary=?,completedAt=?,updatedAt=? WHERE id=?`)
    .run(improvementMeasures, JSON.stringify(afterMetrics), resultSummary, completedAt, timestamp, current.id);
  return parseImprovement(database.prepare("SELECT * FROM product_improvements WHERE id=?").get(current.id));
}
