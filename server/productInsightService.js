import crypto from "node:crypto";
import { getDatabase } from "./db.js";

export const productInsightTypes = Object.freeze(["attention", "satisfaction", "dissatisfaction", "opportunity"]);
export const productInsightImportanceLevels = Object.freeze([1, 2, 3, 4, 5]);
export const productInsightImpactLevels = Object.freeze(["高", "中", "低"]);
export const productInsightHandlingStatuses = Object.freeze(["待处理", "改善中", "已解决", "已忽略"]);
export const productOpportunityTypes = Object.freeze(["规格", "颜色", "包装", "内容", "功能", "渠道", "新品", "其他"]);
export const productOpportunityPriorities = Object.freeze(["高", "中", "低"]);
export const productOpportunityStatuses = Object.freeze(["待评估", "评估中", "已采纳", "推进中", "已完成", "已取消"]);

function text(value) { return String(value ?? "").trim(); }
function now() { return new Date().toISOString(); }
function oneOf(value, values, fallback, label) { const result = text(value) || fallback; if (result && !values.includes(result)) throw new Error(`${label}无效。`); return result || null; }

export class ProductInsightProvider {
  normalize() { throw new Error("用户洞察提供者尚未实现。"); }
}

export class ManualProductInsightProvider extends ProductInsightProvider {
  constructor() { super(); this.id = "manual"; this.version = "product-insight-phase6-v1"; }
  normalize(input = {}) {
    const insightType = text(input.insightType); if (!productInsightTypes.includes(insightType)) throw new Error("用户洞察类型无效。");
    const content = text(input.content); const source = text(input.source);
    if (!content) throw new Error("请填写洞察内容。");
    if (!source) throw new Error("请填写洞察来源。");
    const importance = insightType === "attention" ? Number(input.importance) : null;
    if (insightType === "attention" && !productInsightImportanceLevels.includes(importance)) throw new Error("关注点重要程度无效。");
    return { insightType, content, source, importance, description: text(input.description) || null,
      frequencyText: insightType === "satisfaction" ? text(input.frequencyText) || null : null, note: text(input.note) || null,
      impactLevel: insightType === "dissatisfaction" ? oneOf(input.impactLevel, productInsightImpactLevels, "中", "影响程度") : null,
      handlingStatus: insightType === "dissatisfaction" ? oneOf(input.handlingStatus, productInsightHandlingStatuses, "待处理", "处理状态") : null,
      opportunityType: insightType === "opportunity" ? oneOf(input.opportunityType, productOpportunityTypes, "其他", "机会类型") : null,
      priority: insightType === "opportunity" ? oneOf(input.priority, productOpportunityPriorities, "中", "机会优先级") : null,
      status: insightType === "opportunity" ? oneOf(input.status, productOpportunityStatuses, "待评估", "机会状态") : null,
      relatedStrategyVersionId: insightType === "opportunity" ? text(input.relatedStrategyVersionId) || null : null,
      relatedImprovementId: insightType === "dissatisfaction" ? text(input.relatedImprovementId) || null : null,
      relatedActionId: insightType === "opportunity" ? text(input.relatedActionId) || null : null };
  }
}

export const manualProductInsightProvider = new ManualProductInsightProvider();

function ensureProduct(database, productId) {
  const product = database.prepare("SELECT id,name FROM products WHERE id=?").get(text(productId)); if (!product) throw new Error("产品不存在。"); return product;
}

function ensureRelations(database, productId, value) {
  if (value.relatedStrategyVersionId && !database.prepare("SELECT id FROM product_strategy_versions WHERE id=? AND productId=?").get(value.relatedStrategyVersionId, productId)) throw new Error("关联战略不属于当前产品。");
  if (value.relatedImprovementId && !database.prepare("SELECT id FROM product_improvements WHERE id=? AND productId=?").get(value.relatedImprovementId, productId)) throw new Error("关联改善行动不属于当前产品。");
  if (value.relatedActionId && !database.prepare(`SELECT actionId FROM (
    SELECT actionId FROM action_products WHERE productId=? UNION SELECT actionId FROM product_improvements WHERE productId=?
  ) WHERE actionId=?`).get(productId, productId, value.relatedActionId)) throw new Error("关联关键行动不属于当前产品。");
}

function readInsight(database, insightId) {
  return database.prepare(`SELECT insight.*,creator.name createdByName,strategy.version strategyVersion,improvement.title improvementTitle,
      improvement.actionId improvementActionId,COALESCE(action.displayTitle,action.name) actionName,action.status actionStatus
    FROM product_insights insight LEFT JOIN persons creator ON creator.id=insight.createdBy
    LEFT JOIN product_strategy_versions strategy ON strategy.id=insight.relatedStrategyVersionId
    LEFT JOIN product_improvements improvement ON improvement.id=insight.relatedImprovementId
    LEFT JOIN process_instances action ON action.id=COALESCE(insight.relatedActionId,improvement.actionId)
    WHERE insight.id=?`).get(insightId);
}

function saveNormalized(database, productId, normalized, userId, existing = null, provider = manualProductInsightProvider) {
  ensureRelations(database, productId, normalized); const timestamp = now(); const id = existing?.id ?? `product-insight-${crypto.randomUUID()}`;
  database.prepare(`INSERT INTO product_insights (id,productId,insightType,content,source,importance,description,frequencyText,note,impactLevel,handlingStatus,
    opportunityType,priority,status,relatedStrategyVersionId,relatedImprovementId,relatedActionId,providerId,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,source=excluded.source,importance=excluded.importance,
    description=excluded.description,frequencyText=excluded.frequencyText,note=excluded.note,impactLevel=excluded.impactLevel,handlingStatus=excluded.handlingStatus,
    opportunityType=excluded.opportunityType,priority=excluded.priority,status=excluded.status,relatedStrategyVersionId=excluded.relatedStrategyVersionId,
    relatedImprovementId=excluded.relatedImprovementId,relatedActionId=excluded.relatedActionId,providerId=excluded.providerId,updatedAt=excluded.updatedAt`)
    .run(id, productId, normalized.insightType, normalized.content, normalized.source, normalized.importance, normalized.description, normalized.frequencyText,
      normalized.note, normalized.impactLevel, normalized.handlingStatus, normalized.opportunityType, normalized.priority, normalized.status,
      normalized.relatedStrategyVersionId, normalized.relatedImprovementId, normalized.relatedActionId, provider.id, text(userId) || null, existing?.createdAt ?? timestamp, timestamp);
  return readInsight(database, id);
}

export function importProductInsights(productId, inputs, userId, provider = manualProductInsightProvider) {
  const database = getDatabase(); const product = ensureProduct(database, productId); const records = Array.isArray(inputs) ? inputs : [inputs];
  if (!records.length) throw new Error("请提供至少一条用户洞察。");
  return database.transaction(() => records.map((input) => saveNormalized(database, product.id, provider.normalize(input), userId, null, provider)))();
}

export function updateProductInsight(productId, insightId, input, userId, provider = manualProductInsightProvider) {
  const database = getDatabase(); const product = ensureProduct(database, productId);
  const existing = database.prepare("SELECT * FROM product_insights WHERE id=? AND productId=?").get(text(insightId), product.id); if (!existing) throw new Error("用户洞察不存在。");
  const merged = { ...existing, ...(input ?? {}), insightType: existing.insightType };
  return database.transaction(() => saveNormalized(database, product.id, provider.normalize(merged), userId, existing, provider))();
}

export function getProductInsightCenter(productId, { visibleProductIds = null } = {}) {
  const database = getDatabase(); const product = ensureProduct(database, productId);
  if (visibleProductIds && !new Set(visibleProductIds).has(product.id)) { const error = new Error("无权查看该产品的用户洞察。"); error.statusCode = 403; throw error; }
  const items = database.prepare("SELECT id FROM product_insights WHERE productId=? ORDER BY updatedAt DESC,createdAt DESC").all(product.id).map((row) => readInsight(database, row.id));
  const strategies = database.prepare("SELECT id,version,status,effectiveAt,endedAt FROM product_strategy_versions WHERE productId=? ORDER BY version DESC").all(product.id);
  const improvements = database.prepare(`SELECT improvement.id,improvement.title,improvement.status,improvement.actionId,COALESCE(action.displayTitle,action.name) actionName,action.status actionStatus
    FROM product_improvements improvement JOIN process_instances action ON action.id=improvement.actionId WHERE improvement.productId=? ORDER BY improvement.updatedAt DESC`).all(product.id);
  const actions = database.prepare(`SELECT DISTINCT action.id,COALESCE(action.displayTitle,action.name) name,action.status FROM process_instances action JOIN (
    SELECT actionId FROM action_products WHERE productId=? UNION SELECT actionId FROM product_improvements WHERE productId=?
  ) relation ON relation.actionId=action.id ORDER BY action.updatedAt DESC`).all(product.id, product.id);
  return { product, items, groups: Object.fromEntries(productInsightTypes.map((type) => [type, items.filter((item) => item.insightType === type)])),
    relations: { strategies, improvements, actions }, options: { importanceLevels: productInsightImportanceLevels, impactLevels: productInsightImpactLevels,
      handlingStatuses: productInsightHandlingStatuses, opportunityTypes: productOpportunityTypes, opportunityPriorities: productOpportunityPriorities,
      opportunityStatuses: productOpportunityStatuses }, provider: { id: manualProductInsightProvider.id, version: manualProductInsightProvider.version,
      futureSources: ["淘宝评价", "天猫评价", "小红书评论", "客服记录"], aiReady: true } };
}
