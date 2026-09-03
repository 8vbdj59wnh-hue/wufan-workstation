import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";
import { getProductBusinessReadModel } from "./productBusinessReadModel.js";
import { productBusinessIdentityParams, productBusinessIdentityPredicate, resolveProductBusinessIdentity, upsertProductBusinessProfile } from "./productBusinessProfileService.js";
export { classifyProductBusinessZones } from "./productBusinessClassification.js";

export const productLifecycleStatuses = ["开发中", "上架", "成长期", "成熟期", "风险期", "淘汰"];

function text(value) { return String(value ?? "").trim(); }
function parseJson(value, fallback) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function now() { return new Date().toISOString(); }

function analysisFromReadModelItem(item, period) {
  const salesQuantity = item.sales.totalPhysicalContribution;
  const stock = item.inventory.quantity;
  const grossProfit = item.profit.grossProfit;
  const revenue = item.sales.directAmount;
  return {
    product: { id: item.legacyProductId || item.erpSkuId, erpSkuId: item.erpSkuId, legacyProductId: item.legacyProductId,
      name: item.name, skuCode: item.sku, status: item.status, mainImage: item.image, updatedAt: item.updatedAt },
    snapshotKey: `product-contribution:${period.periodStart}:${period.periodEnd}:${item.healthAnalysis.ruleVersion}`,
    sales: { businessDate: period.periodEnd, periodStart: period.periodStart, periodEnd: period.periodEnd,
      sales30d: salesQuantity, directSalesQuantity: item.sales.directQuantity, bundleContributionQuantity: item.sales.bundleContributionQuantity,
      totalPhysicalContribution: salesQuantity, salesAmount: revenue, directSalesAmount: item.sales.directAmount,
      previousSales30d: item.sales.previousQuantity, previousSalesAmount: item.sales.previousAmount,
      growth: item.sales.trend.rate, trend: item.sales.trend, factCount: item.sales.factCount,
      bundleParticipationCount: item.sales.bundleParticipationCount, contributingBundleCount: item.sales.contributingBundleCount,
      bomEvidenceLevel: item.sales.bomEvidenceLevel, bomEvidence: item.sales.bomEvidence,
      legacy: item.sales.legacy, metricContract: "product-contribution-v1" },
    inventory: { actualStock: stock, availableStock: item.inventory.availableQuantity, amount: item.inventory.amount,
      businessDate: item.inventory.businessDate, turnover: stock !== null && salesQuantity !== null && stock + salesQuantity > 0 ? salesQuantity / (stock + salesQuantity) : null,
      risk: ({ backlog: "积压", stockout: "缺货", attention: "关注", healthy: "正常", no_data: "暂无数据" })[item.inventory.status.code] ?? "暂无数据",
      status: item.inventory.status, coverageDays: item.inventory.coverageDays },
    finance: { revenue, refunds: null, cost: item.sales.directCost, expense: null,
      grossProfit, netProfit: null, profitMargin: item.profit.grossMargin, metric: "single_direct_sales_gross_profit", bundleAllocation: "none" },
    connections: { current: item.linkPerformance, previous: null, salesAmountGrowth: null, visitorGrowth: null, conversionChange: null },
    healthAnalysis: item.healthAnalysis,
    lifecycle: item.lifecycle,
    structure: item.structure,
    dataSource: { sales: "connection_sku_sales_daily_facts", relation: "sales_object", bundleStructure: "sales_object_structure_version", productMapping: "product_erp_mappings", inventory: "erp_sku_inventory_daily_summaries" },
  };
}

export function getProductBusinessAnalysis(productId, options = {}) {
  const database = options.database || getDatabase();
  const product = resolveProductBusinessIdentity(productId, { database });
  if (Array.isArray(options.visibleProductIds) && product.legacyProductId && !options.visibleProductIds.includes(product.legacyProductId)) throw new Error("产品不存在或无权查看。");
  const readModel = getProductBusinessReadModel({ range: "30d", erpSkuId: product.erpSkuId, page: 1, pageSize: 1 }, { ...options, database });
  const item = readModel.items[0];
  if (!item || item.erpSkuId !== product.erpSkuId) throw new Error("产品不存在或无权查看。");
  return analysisFromReadModelItem(item, readModel.period);
}

function parseHealth(row) { return row ? { ...row, metrics: parseJson(row.metricsJson, {}), problems: parseJson(row.problemsJson, []), suggestions: parseJson(row.suggestionsJson, []) } : null; }

function parseProductProfile(row) {
  if (!row) return null;
  return {
    ...row,
    galleryImages: parseJson(row.galleryImages, []),
    warehouseInfo: parseJson(row.warehouseInfo, {}),
    tags: parseJson(row.tags, []),
    priceInfo: parseJson(row.priceInfo, {}),
    pointsInfo: parseJson(row.pointsInfo, {}),
    unitInfo: parseJson(row.unitInfo, {}),
    supplierInfo: parseJson(row.supplierInfo, {}),
    preSaleInfo: parseJson(row.preSaleInfo, {}),
    erpAttributes: parseJson(row.erpAttributes, {}),
    identifiers: parseJson(row.identifiers, {}),
    rawSourceData: parseJson(row.rawSourceData, {}),
  };
}

export function evaluateProductHealth(productId, options = {}) {
  const database = getDatabase(); const product = resolveProductBusinessIdentity(productId, { database }); const analysis = getProductBusinessAnalysis(product.erpSkuId, options); const health = analysis.healthAnalysis; const timestamp = now();
  const issueProfiles = {
    sales_decline: { type: "sales_decline", title: "销售下降" },
    inventory_backlog: { type: "inventory_backlog", title: "库存积压" },
    inventory_stockout: { type: "stockout_risk", title: "库存不足" },
    profit_low: { type: "gross_margin_insufficient", title: "毛利不足" },
    link_optimization: { type: "sales_link_performance", title: "销售链接表现需优化" },
  };
  const problems = (health.recommendations ?? []).map((recommendation) => {
    const profile = issueProfiles[recommendation.code] ?? { type: recommendation.code, title: recommendation.title };
    const dimension = ({ sales_decline: "sales", inventory_backlog: "inventory", inventory_stockout: "inventory", profit_low: "profit", link_optimization: "links" })[recommendation.code];
    const severity = health.dimensions?.[dimension]?.severity === "risk" ? "high" : "medium";
    return { type: profile.type, title: profile.title, severity, reason: recommendation.reason, sourceRecommendationCode: recommendation.code };
  });
  const suggestions = (health.recommendations ?? []).map((item) => ({ title: item.title, reason: item.reason, code: item.code }));
  const save = database.transaction(() => {
    const existing = database.prepare(`SELECT id,createdAt FROM product_health_records record WHERE ${productBusinessIdentityPredicate("record")} AND snapshotKey=@snapshotKey`).get({ ...productBusinessIdentityParams(product), snapshotKey: analysis.snapshotKey });
    const id = existing?.id ?? `product-health-${crypto.randomUUID()}`;
    database.prepare(`INSERT INTO product_health_records (id,productId,erpSkuId,snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(erpSkuId,snapshotKey) WHERE erpSkuId IS NOT NULL DO UPDATE SET healthScore=excluded.healthScore,healthStatus=excluded.healthStatus,
      metricsJson=excluded.metricsJson,problemsJson=excluded.problemsJson,suggestionsJson=excluded.suggestionsJson,updatedAt=excluded.updatedAt`)
      .run(id, product.legacyProductId, product.erpSkuId, analysis.snapshotKey, null, health.overall.code, JSON.stringify(analysis), JSON.stringify(problems), JSON.stringify(suggestions), existing?.createdAt ?? timestamp, timestamp);
    const issue = database.prepare(`INSERT INTO product_issues (id,productId,erpSkuId,healthRecordId,issueType,title,severity,detailJson,status,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,'open',?,?) ON CONFLICT(healthRecordId,issueType) DO UPDATE SET title=excluded.title,severity=excluded.severity,detailJson=excluded.detailJson,updatedAt=excluded.updatedAt`);
    for (const problem of problems) issue.run(`product-issue-${crypto.randomUUID()}`, product.legacyProductId, product.erpSkuId, id, problem.type, problem.title, problem.severity, JSON.stringify(problem), timestamp, timestamp);
    return id;
  });
  const id = save(); return parseHealth(database.prepare("SELECT * FROM product_health_records WHERE id=?").get(id));
}

export function getProductV2Detail(productId, options = {}) {
  const database = getDatabase(); const identity = resolveProductBusinessIdentity(productId, { database }); const analysis = getProductBusinessAnalysis(identity.erpSkuId, options);
  const legacy = identity.legacyProductId ? parseProductProfile(database.prepare("SELECT * FROM products WHERE id=?").get(identity.legacyProductId)) : null;
  const product = { ...(legacy || {}), ...identity, id: identity.erpSkuId, legacyProductId: identity.legacyProductId, skuCode: identity.skuCode,
    name: identity.name, mainImage: identity.mainImage, brand: identity.brand, category: identity.category, status: identity.lifecycle || identity.status };
  const params = productBusinessIdentityParams(identity);
  const lifecycle = database.prepare(`SELECT * FROM product_lifecycle_events record WHERE ${productBusinessIdentityPredicate("record")} ORDER BY changedAt DESC`).all(params);
  const healthRecords = database.prepare(`SELECT * FROM product_health_records record WHERE ${productBusinessIdentityPredicate("record")} ORDER BY updatedAt DESC LIMIT 20`).all(params).map(parseHealth);
  const issues = database.prepare(`SELECT * FROM product_issues record WHERE ${productBusinessIdentityPredicate("record")} ORDER BY updatedAt DESC`).all(params).map((row) => ({ ...row, detail: parseJson(row.detailJson, {}) }));
  const improvements = database.prepare(`SELECT i.*,p.name actionName,p.status actionStatus FROM product_improvements i JOIN process_instances p ON p.id=i.actionId WHERE ${productBusinessIdentityPredicate("i")} ORDER BY i.updatedAt DESC`).all(params).map((row) => ({ ...row, beforeMetrics: parseJson(row.beforeMetricsJson, {}), afterMetrics: parseJson(row.afterMetricsJson, {}) }));
  return { product, analysis, lifecycle, healthRecords, issues, improvements };
}

export function getProductV2Overview({ page = 1, pageSize = 30 } = {}) {
  const readModel = getProductBusinessReadModel({ range: "30d", page, pageSize }, { includeInventoryCost: false });
  const items = readModel.items.map((item) => ({ ...item, skuCode: item.sku, mainImage: item.image,
    analysis: analysisFromReadModelItem(item, readModel.period), healthScore: item.health.score, healthStatus: item.healthAnalysis.overall.code }));
  const lifecycle = Object.fromEntries(productLifecycleStatuses.map((status) => [status, items.filter((item) => item.status === status).length]));
  lifecycle["待归类"] = items.filter((item) => !productLifecycleStatuses.includes(item.status)).length;
  return { total: readModel.pagination.total, lifecycle, businessZones: {}, businessZoneRules: null,
    growth: items.filter((item) => item.healthStatus === "growth").sort((a,b) => (b.healthScore ?? -1)-(a.healthScore ?? -1)).slice(0,10),
    risks: items.filter((item) => ["attention","risk"].includes(item.healthStatus)).sort((a,b) => (a.healthScore ?? 101)-(b.healthScore ?? 101)).slice(0,10), items,
    pagination: readModel.pagination, migratedTo: "product-business-dashboard", definitions: readModel.definitions };
}

export function changeProductLifecycle(productId, input, userId) {
  const toStatus = text(input?.status); if (!productLifecycleStatuses.includes(toStatus)) throw new Error("产品生命周期状态无效。");
  const database = getDatabase(); const product = resolveProductBusinessIdentity(productId, { database });
  if (product.lifecycle === toStatus) throw new Error("产品已经处于该生命周期状态。"); const timestamp = now();
  return database.transaction(() => {
    upsertProductBusinessProfile(product.erpSkuId, { lifecycle: toStatus }, userId, { database });
    const event = { id:`product-lifecycle-${crypto.randomUUID()}`,productId:product.legacyProductId,erpSkuId:product.erpSkuId,fromStatus:product.lifecycle,toStatus,reason:text(input?.reason),changedBy:userId||null,changedAt:timestamp };
    database.prepare("INSERT INTO product_lifecycle_events (id,productId,erpSkuId,fromStatus,toStatus,reason,changedBy,changedAt) VALUES (@id,@productId,@erpSkuId,@fromStatus,@toStatus,@reason,@changedBy,@changedAt)").run(event); return event; })();
}

export function createProductImprovementAction(issueId, input, userId) {
  const database = getDatabase(); const issue = database.prepare(`SELECT i.*,COALESCE(profile.displayNameOverride,p.name,g.goodsName,s.specificationName,s.merchantSkuCode) productName
    FROM product_issues i JOIN erp_skus s ON s.id=i.erpSkuId LEFT JOIN erp_goods g ON g.id=s.erpGoodsId LEFT JOIN products p ON p.id=i.productId
    LEFT JOIN product_business_profiles profile ON profile.erpSkuId=i.erpSkuId WHERE i.id=?`).get(text(issueId)); if (!issue) throw new Error("产品经营问题不存在。");
  const goal = database.prepare("SELECT id,status FROM goals WHERE id=?").get(text(input?.goalId)); if (!goal || goal.status !== "active") throw new Error("请选择有效目标。");
  const template = database.prepare(`SELECT t.id,t.name,t.defaultProcessTemplateId,p.version FROM task_templates t JOIN process_templates p ON p.id=t.defaultProcessTemplateId WHERE t.id=? AND t.status='active'`).get(text(input?.taskTemplateId));
  if (!template) throw new Error("请选择已绑定标准流程的启用关键行动。"); const title = text(input?.title) || `改善${issue.productName}：${issue.title}`;
  return database.transaction(() => { const timestamp=now(); const instance=createResource("process-instances",{id:`process-instance-${crypto.randomUUID()}`,templateId:template.defaultProcessTemplateId,taskTemplateId:template.id,templateVersion:template.version,name:title,displayTitle:title,goalId:goal.id,initiatorId:text(userId),description:`来源：产品经营问题；产品：${issue.productName}；问题：${issue.title}`,status:"draft",customFields:{source:"product_health",productId:issue.productId,erpSkuId:issue.erpSkuId,productIssueId:issue.id,healthRecordId:issue.healthRecordId},createdAt:timestamp,updatedAt:timestamp});
    const id=`product-improvement-${crypto.randomUUID()}`; const health=database.prepare("SELECT metricsJson FROM product_health_records WHERE id=?").get(issue.healthRecordId);
    database.prepare(`INSERT INTO product_improvements (id,productId,erpSkuId,issueId,actionId,title,status,beforeMetricsJson,afterMetricsJson,createdAt,updatedAt) VALUES (?,?,?,?,?,?,'planned',?,'{}',?,?)`).run(id,issue.productId,issue.erpSkuId,issue.id,instance.id,title,health?.metricsJson||"{}",timestamp,timestamp);
    const actionProduct=createResource("action-products",{id:`action-product-${crypto.randomUUID()}`,actionId:instance.id,productId:issue.productId,erpSkuId:issue.erpSkuId,createdAt:timestamp});
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
  const product = resolveProductBusinessIdentity(productId, { database });
  const params = productBusinessIdentityParams(product);
  const persistedIssues = database.prepare(`SELECT * FROM product_issues record WHERE ${productBusinessIdentityPredicate("record")} ORDER BY updatedAt DESC`).all(params).map((row) => ({ ...row, detail: parseJson(row.detailJson, {}) }));
  const rows = database.prepare(`SELECT i.*,q.issueType,q.title issueTitle,q.detailJson,p.name actionName,p.displayTitle,p.status actionStatus,
      p.startedAt,p.createdAt actionCreatedAt,p.completedAt actionCompletedAt,t.ownerId,owner.name ownerName,
      (SELECT COUNT(*) FROM tasks task WHERE task.processInstanceId=p.id) taskCount,
      (SELECT COUNT(*) FROM tasks task WHERE task.processInstanceId=p.id AND task.status IN ('done','completed')) doneTaskCount
    FROM product_improvements i JOIN product_issues q ON q.id=i.issueId JOIN process_instances p ON p.id=i.actionId
    LEFT JOIN task_templates t ON t.id=p.taskTemplateId LEFT JOIN persons owner ON owner.id=t.ownerId
    WHERE ${productBusinessIdentityPredicate("i")} ORDER BY i.updatedAt DESC,i.createdAt DESC`).all(params);
  const improvements = rows.map((row) => {
    const item = parseImprovement(row); const type = productIssueTypeByCode.get(item.issueType);
    return { ...item, issueTypeLabel: type?.label ?? item.issueTitle, issueCategory: type?.category ?? "其他问题",
      actionName: item.displayTitle || item.actionName, ownerName: item.ownerName || "未设置", startAt: item.startedAt || item.actionCreatedAt,
      completedAt: item.completedAt || item.actionCompletedAt || null, canRecordResult: ["done", "completed"].includes(item.actionStatus) };
  });
  return { product: { id: product.erpSkuId, erpSkuId: product.erpSkuId, legacyProductId: product.legacyProductId, name: product.name }, issueTypes: productIssueTypeCatalog,
    currentIssues: (healthAnalysis?.recommendations ?? []).map((item) => healthIssueView(item, healthAnalysis, persistedIssues)).filter(Boolean),
    improvements, readOnlyFacts: true };
}

export function createProductHealthAction(productId, input, userId, healthAnalysis = null) {
  const database = getDatabase();
  const product = resolveProductBusinessIdentity(productId, { database });
  upsertProductBusinessProfile(product.erpSkuId, {}, userId, { database });
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
    let issue = database.prepare(`SELECT * FROM product_issues record WHERE ${productBusinessIdentityPredicate("record")} AND issueType=@issueType AND status<>'closed' ORDER BY updatedAt DESC LIMIT 1`).get({ ...productBusinessIdentityParams(product), issueType: recommendation.issueType });
    const matchedRecommendation = healthAnalysis?.recommendations?.find((item) => item.code === recommendationCode);
    const problemDescription = matchedRecommendation?.reason || recommendation.issue;
    const issueType = productIssueTypeByCode.get(recommendation.issueType);
    if (!issue) {
      const healthRecordId = `product-health-improvement-${crypto.randomUUID()}`;
      database.prepare(`INSERT INTO product_health_records (id,productId,erpSkuId,snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt)
        VALUES (?,?,?,?,NULL,?,?,?,?,?,?)`).run(healthRecordId, product.legacyProductId, product.erpSkuId, `improvement:${crypto.randomUUID()}`, healthAnalysis?.overall?.code || "no_data",
        JSON.stringify(healthAnalysis || {}), JSON.stringify([{ issueType: recommendation.issueType, problemDescription }]), JSON.stringify([{ title: recommendation.title }]), timestamp, timestamp);
      const issueId = `product-issue-${crypto.randomUUID()}`;
      const detail = { standardIssueType: recommendation.issueType, category: issueType?.category, problemDescription,
        improvementGoal: recommendation.improvementGoal, suggestedDirection: recommendation.suggestedDirection,
        sourceRecommendationCode: recommendationCode, evidence: healthAnalysis?.dimensions?.[recommendation.dimension]?.evidence ?? {} };
      database.prepare(`INSERT INTO product_issues (id,productId,erpSkuId,healthRecordId,issueType,title,severity,detailJson,status,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,'open',?,?)`).run(issueId, product.legacyProductId, product.erpSkuId, healthRecordId, recommendation.issueType, recommendation.problemTitle,
        healthAnalysis?.dimensions?.[recommendation.dimension]?.severity === "risk" ? "high" : "medium", JSON.stringify(detail), timestamp, timestamp);
      issue = database.prepare("SELECT * FROM product_issues WHERE id=?").get(issueId);
    }
    const instance = createResource("process-instances", {
      id: `process-instance-${crypto.randomUUID()}`, templateId: template.defaultProcessTemplateId, taskTemplateId: template.id,
      templateVersion: template.version, name: title, displayTitle: title, goalId: goal.id, initiatorId: text(userId),
      description: `来源：产品健康分析；产品：${product.name}；问题：${problemDescription}；改善目标：${recommendation.improvementGoal}；建议方向：${recommendation.suggestedDirection}。`, status: "draft",
      customFields: { source: "product_health_analysis", productId: product.legacyProductId, erpSkuId: product.erpSkuId, productIssueId: issue.id, problemType: recommendation.issueType,
        problemTypeLabel: issueType?.label, problemDescription, improvementGoal: recommendation.improvementGoal,
        suggestedDirection: recommendation.suggestedDirection, recommendationCode }, createdAt: timestamp, updatedAt: timestamp,
    });
    const actionProduct = createResource("action-products", { id: `action-product-${crypto.randomUUID()}`, actionId: instance.id, productId: product.legacyProductId, erpSkuId: product.erpSkuId, createdAt: timestamp });
    const improvementId = `product-improvement-${crypto.randomUUID()}`;
    const beforeMetrics = { summary: problemDescription, healthStatus: healthAnalysis?.overall ?? null,
      dimension: healthAnalysis?.dimensions?.[recommendation.dimension] ?? null, capturedAt: timestamp };
    database.prepare(`INSERT INTO product_improvements (id,productId,erpSkuId,issueId,actionId,title,status,beforeMetricsJson,afterMetricsJson,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,'planned',?,'{}',?,?)`).run(improvementId, product.legacyProductId, product.erpSkuId, issue.id, instance.id, title, JSON.stringify(beforeMetrics), timestamp, timestamp);
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
  if (visibleProductIds && current.productId && !new Set(visibleProductIds).has(current.productId)) {
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
