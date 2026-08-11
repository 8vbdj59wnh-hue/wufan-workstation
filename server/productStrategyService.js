import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";

export const productStrategyRoles = Object.freeze(["引流产品", "利润产品", "核心产品", "形象产品", "补充产品", "测试产品"]);
export const productStrategyPriorities = Object.freeze(["高", "中", "低"]);
export const productStrategyStepStatuses = Object.freeze(["待处理", "推进中", "已完成", "已取消"]);
export const productStrategyPeriodTypes = Object.freeze(["季度", "半年度", "年度", "自定义"]);

function text(value) { return String(value ?? "").trim(); }
function now() { return new Date().toISOString(); }
function parseJson(value, fallback) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function optionalNumber(value, label, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new Error(`${label}格式无效。`);
  return result;
}

function emptyContent() {
  return {
    positioning: { targetUsers: "", coreScenarios: "", positioning: "", pricePositioning: "", productRole: "" },
    competition: { mainCompetitors: "", strengths: "", weaknesses: "", priceStrategy: "", differentiation: "", description: "" },
    goals: { targetSalesAmount: null, targetSalesQuantity: null, targetGrossMargin: null, targetInventoryStatus: "", targetLifecycleStatus: "" },
    management: { ownerId: "", periodType: "", periodLabel: "", periodStart: "", periodEnd: "", currentStrategy: "", notes: "" },
    nextStrategies: [],
  };
}

function normalizeContent(content = {}) {
  const empty = emptyContent();
  const positioning = { ...empty.positioning, ...(content.positioning ?? {}) };
  if (positioning.productRole && !productStrategyRoles.includes(positioning.productRole)) throw new Error("产品角色无效。");
  const management = { ...empty.management, ...(content.management ?? {}) };
  if (management.periodType && !productStrategyPeriodTypes.includes(management.periodType)) throw new Error("策略周期类型无效。");
  if (management.periodStart && management.periodEnd && management.periodStart > management.periodEnd) throw new Error("策略周期开始时间不能晚于结束时间。");
  const goals = { ...empty.goals, ...(content.goals ?? {}) };
  goals.targetSalesAmount = optionalNumber(goals.targetSalesAmount, "目标销售额");
  goals.targetSalesQuantity = optionalNumber(goals.targetSalesQuantity, "目标销量");
  goals.targetGrossMargin = optionalNumber(goals.targetGrossMargin, "目标毛利率", { min: 0, max: 100 });
  const nextStrategies = (content.nextStrategies ?? []).map((item) => {
    const priority = text(item.priority) || "中"; const status = text(item.status) || "待处理";
    if (!productStrategyPriorities.includes(priority)) throw new Error("策略优先级无效。");
    if (!productStrategyStepStatuses.includes(status)) throw new Error("策略状态无效。");
    return { id: text(item.id) || `product-strategy-item-${crypto.randomUUID()}`, content: text(item.content), priority, status,
      ownerId: text(item.ownerId), plannedAt: text(item.plannedAt), actionId: text(item.actionId) || null };
  });
  return { positioning, competition: { ...empty.competition, ...(content.competition ?? {}) }, goals, management, nextStrategies };
}

function parseVersion(row) {
  return row ? { ...row, content: normalizeContent(parseJson(row.contentJson, {})) } : null;
}

function readCurrent(database, productId) {
  return parseVersion(database.prepare(`SELECT s.*,person.name changedByName FROM product_strategy_versions s
    LEFT JOIN persons person ON person.id=s.changedBy WHERE s.productId=? AND s.status='current' ORDER BY s.version DESC LIMIT 1`).get(productId));
}

function createVersion(database, productId, content, userId, { effectiveAt = "" } = {}) {
  const current = readCurrent(database, productId); const timestamp = now();
  const version = Number(current?.version || 0) + 1; const id = `product-strategy-${crypto.randomUUID()}`;
  if (current) database.prepare("UPDATE product_strategy_versions SET status='historical',endedAt=?,updatedAt=? WHERE id=?").run(timestamp, timestamp, current.id);
  database.prepare(`INSERT INTO product_strategy_versions (id,productId,version,status,effectiveAt,endedAt,changedBy,contentJson,createdAt,updatedAt)
    VALUES (?,?,?,'current',?,NULL,?,?,?,?)`).run(id, productId, version, text(effectiveAt) || timestamp, text(userId) || null, JSON.stringify(normalizeContent(content)), timestamp, timestamp);
  if (current) {
    database.prepare(`INSERT INTO product_strategy_action_links (id,strategyVersionId,strategyItemId,actionId,createdAt)
      SELECT 'product-strategy-action-' || lower(hex(randomblob(16))),?,strategyItemId,actionId,? FROM product_strategy_action_links WHERE strategyVersionId=?`)
      .run(id, timestamp, current.id);
  }
  return readCurrent(database, productId);
}

function ensureProduct(database, productId) {
  const product = database.prepare("SELECT id,name,status FROM products WHERE id=?").get(text(productId));
  if (!product) throw new Error("产品不存在。");
  return product;
}

export function getProductStrategy(productId, { visibleProductIds = null } = {}) {
  const database = getDatabase(); const product = ensureProduct(database, productId);
  if (visibleProductIds && !new Set(visibleProductIds).has(product.id)) { const error = new Error("无权查看该产品战略。"); error.statusCode = 403; throw error; }
  const versions = database.prepare(`SELECT s.*,person.name changedByName FROM product_strategy_versions s LEFT JOIN persons person ON person.id=s.changedBy
    WHERE s.productId=? ORDER BY s.version DESC`).all(product.id).map(parseVersion);
  const actionRows = database.prepare(`SELECT link.strategyVersionId,link.strategyItemId,link.actionId,instance.displayTitle,instance.name actionName,instance.status actionStatus
    FROM product_strategy_action_links link JOIN process_instances instance ON instance.id=link.actionId
    WHERE link.strategyVersionId IN (SELECT id FROM product_strategy_versions WHERE productId=?)`).all(product.id);
  const actionsByVersion = new Map();
  for (const row of actionRows) { const values = actionsByVersion.get(row.strategyVersionId) ?? []; values.push(row); actionsByVersion.set(row.strategyVersionId, values); }
  const decorate = (version) => version ? { ...version, actions: actionsByVersion.get(version.id) ?? [], content: { ...version.content,
    nextStrategies: version.content.nextStrategies.map((item) => ({ ...item, action: (actionsByVersion.get(version.id) ?? []).find((link) => link.strategyItemId === item.id) ?? null })) } } : null;
  return { product, current: decorate(versions.find((item) => item.status === "current") ?? null), history: versions.filter((item) => item.status !== "current").map(decorate),
    options: { roles: productStrategyRoles, priorities: productStrategyPriorities, statuses: productStrategyStepStatuses, periodTypes: productStrategyPeriodTypes },
    boundaries: { strategy: "接下来准备怎么经营这个产品", improvement: "当前发现了什么问题，准备怎么解决", humanDecisionOnly: true } };
}

export function saveProductStrategySection(productId, section, input, userId) {
  const database = getDatabase(); const product = ensureProduct(database, productId);
  if (!["positioning", "competition", "goals", "management"].includes(section)) throw new Error("产品战略分区无效。");
  return database.transaction(() => {
    const current = readCurrent(database, product.id); const content = current?.content ?? emptyContent();
    const next = { ...content, [section]: { ...content[section], ...(input ?? {}) } };
    return createVersion(database, product.id, next, userId, { effectiveAt: input?.effectiveAt });
  })();
}

export function addProductStrategyStep(productId, input, userId) {
  const database = getDatabase(); const product = ensureProduct(database, productId); const strategyContent = text(input?.content);
  if (!strategyContent) throw new Error("请填写下一步策略内容。");
  return database.transaction(() => {
    const current = readCurrent(database, product.id); const content = current?.content ?? emptyContent();
    content.nextStrategies = [...content.nextStrategies, { id: `product-strategy-item-${crypto.randomUUID()}`, content: strategyContent,
      priority: text(input?.priority) || "中", status: text(input?.status) || "待处理", ownerId: text(input?.ownerId), plannedAt: text(input?.plannedAt), actionId: null }];
    return createVersion(database, product.id, content, userId);
  })();
}

export function updateProductStrategyStep(productId, itemId, input, userId) {
  const database = getDatabase(); const product = ensureProduct(database, productId);
  return database.transaction(() => {
    const current = readCurrent(database, product.id); if (!current) throw new Error("当前产品还没有战略。");
    const index = current.content.nextStrategies.findIndex((item) => item.id === text(itemId)); if (index < 0) throw new Error("下一步策略不存在。");
    const items = [...current.content.nextStrategies]; items[index] = { ...items[index], ...input, id: items[index].id, actionId: items[index].actionId };
    return createVersion(database, product.id, { ...current.content, nextStrategies: items }, userId);
  })();
}

export function createProductStrategyAction(productId, itemId, input, userId) {
  const database = getDatabase(); const product = ensureProduct(database, productId);
  const goal = database.prepare("SELECT id,status FROM goals WHERE id=?").get(text(input?.goalId)); if (!goal || goal.status !== "active") throw new Error("请选择有效目标。");
  const template = database.prepare(`SELECT t.id,t.name,t.defaultProcessTemplateId,p.version FROM task_templates t JOIN process_templates p ON p.id=t.defaultProcessTemplateId
    WHERE t.id=? AND t.status='active'`).get(text(input?.taskTemplateId));
  if (!template) throw new Error("请选择已绑定标准流程的启用关键行动。");
  return database.transaction(() => {
    const current = readCurrent(database, product.id); if (!current) throw new Error("当前产品还没有战略。");
    const item = current.content.nextStrategies.find((entry) => entry.id === text(itemId)); if (!item) throw new Error("下一步策略不存在。");
    if (item.actionId) throw new Error("该策略已关联关键行动。");
    const timestamp = now(); const management = current.content.management; const title = text(input?.title) || `${item.content}：${product.name}`;
    const instance = createResource("process-instances", { id: `process-instance-${crypto.randomUUID()}`, templateId: template.defaultProcessTemplateId,
      taskTemplateId: template.id, templateVersion: template.version, name: title, displayTitle: title, goalId: goal.id, initiatorId: text(userId), status: "draft",
      description: `来源：产品战略；产品：${product.name}；策略：${item.content}；策略周期：${management.periodLabel || management.periodType || "未设置"}。`,
      customFields: { source: "product_strategy", productId: product.id, productStrategyVersionId: current.id, productStrategyItemId: item.id,
        strategyContent: item.content, strategyPeriod: management.periodLabel || management.periodType, strategyPeriodStart: management.periodStart,
        strategyPeriodEnd: management.periodEnd, strategyOwnerId: item.ownerId || management.ownerId, suggestedActionName: title }, createdAt: timestamp, updatedAt: timestamp });
    const actionProduct = createResource("action-products", { id: `action-product-${crypto.randomUUID()}`, actionId: instance.id, productId: product.id, createdAt: timestamp });
    const nextItems = current.content.nextStrategies.map((entry) => entry.id === item.id ? { ...entry, actionId: instance.id } : entry);
    const strategy = createVersion(database, product.id, { ...current.content, nextStrategies: nextItems }, userId);
    database.prepare("INSERT INTO product_strategy_action_links (id,strategyVersionId,strategyItemId,actionId,createdAt) VALUES (?,?,?,?,?)")
      .run(`product-strategy-action-${crypto.randomUUID()}`, strategy.id, item.id, instance.id, timestamp);
    return { strategy: readCurrent(database, product.id), instance, actionProduct };
  })();
}
