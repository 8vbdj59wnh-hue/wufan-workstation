import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { CONNECTION_GOAL_METRICS, CONNECTION_POSITIONING_TYPES } from "./connectionGoalFoundationService.js";

const clean = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function addDays(dateText, days) {
  const value = new Date(`${dateText}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadProfile(database, connectionId) {
  const profile = database.prepare("SELECT id,salesLinkId,name,ownerId,status FROM connection_profiles WHERE id=?").get(clean(connectionId));
  if (!profile) fail("链接经营档案不存在。", 404);
  return profile;
}

function canEdit(profile, context = {}) {
  return Boolean(context.isAdmin || (clean(context.userId) && clean(profile.ownerId) === clean(context.userId)));
}

function requireEditor(database, profile, context) {
  if (!canEdit(profile, context)) fail("仅管理员或该链接负责人可以管理经营目标。", 403);
  const userId = clean(context.userId);
  if (!userId || !database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(userId)) fail("操作人不存在或已停用。");
  return userId;
}

function loadPositioningAndTemplate(database, connectionId) {
  const positioning = database.prepare(`SELECT * FROM connection_business_profiles
    WHERE connectionId=? AND status='active' ORDER BY effectiveFrom DESC,id DESC LIMIT 1`).get(connectionId);
  if (!positioning) fail("请先人工设置链接经营定位，再生成经营目标。", 409);
  const template = database.prepare(`SELECT * FROM connection_goal_templates
    WHERE positioningType=? AND status='active' ORDER BY version DESC LIMIT 1`).get(positioning.positioningType);
  if (!template) fail("当前经营定位没有生效中的目标模板。", 409);
  const metrics = database.prepare(`SELECT * FROM connection_goal_template_metrics
    WHERE templateId=? ORDER BY sortOrder,id`).all(template.id);
  if (metrics.length !== 2 || Math.abs(metrics.reduce((sum, item) => sum + Number(item.weight), 0) - 1) > 1e-9) {
    fail("目标模板指标权重配置不完整。", 409);
  }
  return { positioning, template, metrics };
}

function buildSuggestion(database, salesLinkId) {
  const latestDate = database.prepare("SELECT MAX(saleDate) value FROM connection_sku_sales_daily_facts").get()?.value ?? null;
  if (!latestDate) return { available: false, reason: "当前没有销售日报事实。", windows: [], baselineStart: null, baselineEnd: null };
  const windows = [0, 1, 2].map((index) => {
    const end = addDays(latestDate, index * -30);
    const start = addDays(end, -29);
    const coverageDays = Number(database.prepare(`SELECT COUNT(DISTINCT saleDate) count
      FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?`).get(start, end).count);
    const totals = database.prepare(`SELECT COALESCE(SUM(salesAmount),0) salesAmount,COALESCE(SUM(profitAmount),0) profitAmount
      FROM connection_sku_sales_daily_facts WHERE salesLinkId=? AND saleDate BETWEEN ? AND ?`).get(salesLinkId, start, end);
    return { start, end, coverageDays, complete: coverageDays === 30, salesAmount: roundMoney(totals.salesAmount), profitAmount: roundMoney(totals.profitAmount) };
  });
  const completeWindows = windows.filter((item) => item.complete);
  if (!completeWindows.length) {
    const coverageDays = Number(database.prepare(`SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts
      WHERE saleDate BETWEEN ? AND ?`).get(addDays(latestDate, -89), latestDate).count);
    return { available: false, reason: coverageDays < 30 ? `最近数据仅覆盖${coverageDays}天，少于30天。` : "最近没有完整的30天数据窗口。", windows, baselineStart: null, baselineEnd: null };
  }
  return {
    available: true,
    reason: `采用最近${completeWindows.length}个完整30天窗口的中位数。`,
    windows,
    baselineStart: completeWindows.at(-1).start,
    baselineEnd: completeWindows[0].end,
    values: {
      sales_amount: roundMoney(median(completeWindows.map((item) => item.salesAmount))),
      profit_amount: roundMoney(median(completeWindows.map((item) => item.profitAmount))),
    },
  };
}

function decoratePlan(database, plan) {
  if (!plan) return null;
  const metrics = database.prepare("SELECT * FROM connection_goal_metrics WHERE goalPlanId=? ORDER BY metricCode DESC").all(plan.id)
    .map((metric) => ({ ...metric, metricName: CONNECTION_GOAL_METRICS[metric.metricCode] || metric.metricCode }));
  return {
    ...plan,
    positioningName: CONNECTION_POSITIONING_TYPES[plan.positioningType] || plan.positioningType,
    metrics,
  };
}

function loadPlans(database, connectionId) {
  return database.prepare(`SELECT gp.*,bp.positioningType,t.name templateName,p1.name createdByName,p2.name approvedByName
    FROM connection_goal_plans gp
    JOIN connection_business_profiles bp ON bp.id=gp.positioningId
    JOIN connection_goal_templates t ON t.id=gp.templateId
    LEFT JOIN persons p1 ON p1.id=gp.createdBy
    LEFT JOIN persons p2 ON p2.id=gp.approvedBy
    WHERE gp.connectionId=? ORDER BY gp.createdAt DESC,gp.id DESC`).all(connectionId).map((plan) => decoratePlan(database, plan));
}

export function readConnectionGoalPlans(connectionId, context = {}) {
  const database = context.database || getDatabase();
  const profile = loadProfile(database, connectionId);
  const plans = loadPlans(database, profile.id);
  return {
    connection: profile,
    current: plans.find((plan) => plan.status === "active") || null,
    awaitingConfirmation: plans.find((plan) => ["draft", "pending_confirm"].includes(plan.status)) || null,
    history: plans.filter((plan) => ["expired", "cancelled"].includes(plan.status)),
    permissions: { canEdit: canEdit(profile, context) },
  };
}

export function createConnectionGoalSuggestion(connectionId, context = {}) {
  const database = context.database || getDatabase();
  const profile = loadProfile(database, connectionId);
  const userId = requireEditor(database, profile, context);
  const { positioning, template, metrics } = loadPositioningAndTemplate(database, profile.id);
  const suggestion = buildSuggestion(database, profile.salesLinkId);
  const existing = database.prepare(`SELECT * FROM connection_goal_plans
    WHERE connectionId=? AND status IN ('draft','pending_confirm') ORDER BY createdAt DESC,id DESC LIMIT 1`).get(profile.id);
  if (existing && existing.positioningId === positioning.id && existing.templateId === template.id && clean(existing.baselineEnd) === clean(suggestion.baselineEnd)) {
    return { ...readConnectionGoalPlans(profile.id, { ...context, database }), suggestion, changed: false, idempotent: true };
  }
  database.transaction(() => {
    const timestamp = now();
    database.prepare(`UPDATE connection_goal_plans SET status='cancelled',updatedAt=?
      WHERE connectionId=? AND status IN ('draft','pending_confirm')`).run(timestamp, profile.id);
    const planId = `connection-goal-plan-${crypto.randomUUID()}`;
    database.prepare(`INSERT INTO connection_goal_plans
      (id,connectionId,positioningId,templateId,templateVersion,targetMode,status,baselineStart,baselineEnd,effectiveFrom,effectiveTo,createdBy,approvedBy,approvalReason,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?, ?,?,NULL,NULL,?,NULL,NULL,?,?)`).run(
      planId, profile.id, positioning.id, template.id, template.version,
      suggestion.available ? "system_suggested" : "manual", suggestion.available ? "pending_confirm" : "draft",
      suggestion.baselineStart, suggestion.baselineEnd, userId, timestamp, timestamp,
    );
    const insertMetric = database.prepare(`INSERT INTO connection_goal_metrics
      (id,goalPlanId,metricCode,baselineValue,suggestedTargetValue,finalTargetValue,weight,createdAt)
      VALUES (?,?,?,?,?,NULL,?,?)`);
    for (const metric of metrics) {
      const value = suggestion.available ? suggestion.values[metric.metricCode] : null;
      insertMetric.run(`connection-goal-metric-${crypto.randomUUID()}`, planId, metric.metricCode, value, value, metric.weight, timestamp);
    }
  })();
  return { ...readConnectionGoalPlans(profile.id, { ...context, database }), suggestion, changed: true, idempotent: false };
}

export function confirmConnectionGoalPlan(connectionId, planId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const profile = loadProfile(database, connectionId);
  const userId = requireEditor(database, profile, context);
  const plan = database.prepare(`SELECT * FROM connection_goal_plans
    WHERE id=? AND connectionId=? AND status IN ('draft','pending_confirm')`).get(clean(planId), profile.id);
  if (!plan) fail("待确认目标计划不存在或状态已变化。", 409);
  const metrics = database.prepare("SELECT * FROM connection_goal_metrics WHERE goalPlanId=?").all(plan.id);
  const salesAmount = clean(input.salesAmount);
  const profitAmount = clean(input.profitAmount);
  const values = {
    sales_amount: salesAmount === "" ? Number.NaN : Number(salesAmount),
    profit_amount: profitAmount === "" ? Number.NaN : Number(profitAmount),
  };
  if (!Number.isFinite(values.sales_amount) || values.sales_amount < 0) fail("销售目标必须是大于或等于0的数字。");
  if (!Number.isFinite(values.profit_amount)) fail("利润目标必须是有效数字。");
  const adjusted = metrics.some((metric) => metric.suggestedTargetValue === null
    || Math.abs(Number(metric.suggestedTargetValue) - values[metric.metricCode]) > 0.005);
  const approvalReason = clean(input.approvalReason);
  if (adjusted && !approvalReason) fail("调整系统建议或人工设置目标时必须填写原因。");
  if (approvalReason.length > 500) fail("确认原因不能超过500个字符。");

  database.transaction(() => {
    const timestamp = now();
    const effectiveFrom = timestamp.slice(0, 10);
    const effectiveTo = addDays(effectiveFrom, 29);
    database.prepare(`UPDATE connection_goal_plans SET status='expired',effectiveTo=?,updatedAt=?
      WHERE connectionId=? AND status='active'`).run(effectiveFrom, timestamp, profile.id);
    const updateMetric = database.prepare("UPDATE connection_goal_metrics SET finalTargetValue=? WHERE goalPlanId=? AND metricCode=?");
    for (const metric of metrics) updateMetric.run(values[metric.metricCode], plan.id, metric.metricCode);
    database.prepare(`UPDATE connection_goal_plans SET targetMode=?,status='active',effectiveFrom=?,effectiveTo=?,approvedBy=?,approvalReason=?,updatedAt=? WHERE id=?`).run(
      adjusted ? (metrics.every((metric) => metric.suggestedTargetValue === null) ? "manual" : "hybrid") : "system_suggested",
      effectiveFrom, effectiveTo, userId, approvalReason || "按系统建议确认", timestamp, plan.id,
    );
  })();
  return { ...readConnectionGoalPlans(profile.id, { ...context, database }), changed: true };
}
