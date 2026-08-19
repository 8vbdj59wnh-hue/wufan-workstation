import crypto from "node:crypto";
import { getDatabase } from "./db.js";

export const CONNECTION_POSITIONING_TYPES = Object.freeze({
  sales_growth: "引流爆款",
  balanced_sales: "优质动销款",
  long_tail: "长尾动销款",
  profit_contribution: "高毛利款",
});

export const CONNECTION_GOAL_METRICS = Object.freeze({
  sales_amount: "销售额",
  profit_amount: "利润额",
});

const positioningTypes = new Set(Object.keys(CONNECTION_POSITIONING_TYPES));
const clean = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();

function loadTemplates(database) {
  const rows = database.prepare(`SELECT t.*,m.id metricId,m.metricCode,m.weight,m.sortOrder
    FROM connection_goal_templates t
    LEFT JOIN connection_goal_template_metrics m ON m.templateId=t.id
    WHERE t.status='active'
    ORDER BY t.positioningType,t.version DESC,m.sortOrder,m.id`).all();
  const templates = new Map();
  for (const row of rows) {
    const template = templates.get(row.id) || {
      id: row.id,
      code: row.code,
      name: row.name,
      positioningType: row.positioningType,
      positioningName: CONNECTION_POSITIONING_TYPES[row.positioningType],
      version: Number(row.version),
      windowDays: Number(row.windowDays),
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metrics: [],
    };
    if (row.metricId) template.metrics.push({
      id: row.metricId,
      metricCode: row.metricCode,
      metricName: CONNECTION_GOAL_METRICS[row.metricCode],
      weight: Number(row.weight),
      sortOrder: Number(row.sortOrder),
    });
    templates.set(row.id, template);
  }
  return [...templates.values()].map((template) => {
    const totalWeight = template.metrics.reduce((sum, metric) => sum + metric.weight, 0);
    return { ...template, totalWeight, weightValid: Math.abs(totalWeight - 1) < 1e-9 };
  });
}

function loadProfile(database, connectionId) {
  const profile = database.prepare("SELECT id,salesLinkId,name,ownerId,status FROM connection_profiles WHERE id=?").get(connectionId);
  if (!profile) {
    const error = new Error("Link资产不存在。");
    error.statusCode = 404;
    throw error;
  }
  return profile;
}

function decoratePositioning(row) {
  return row ? {
    ...row,
    positioningName: CONNECTION_POSITIONING_TYPES[row.positioningType] || row.positioningType,
  } : null;
}

function canEditPositioning(profile, { userId = "", isAdmin = false } = {}) {
  return Boolean(isAdmin || (clean(userId) && clean(profile.ownerId) === clean(userId)));
}

export function readConnectionGoalFoundation(connectionId, context = {}) {
  const database = context.database || getDatabase();
  const id = clean(connectionId);
  const profile = loadProfile(database, id);
  const templates = loadTemplates(database);
  const history = database.prepare(`SELECT b.*,p.name decidedByName
    FROM connection_business_profiles b
    LEFT JOIN persons p ON p.id=b.decidedBy
    WHERE b.connectionId=?
    ORDER BY b.effectiveFrom DESC,b.createdAt DESC,b.id DESC`).all(id).map(decoratePositioning);
  const current = history.find((row) => row.status === "active") || null;
  const currentTemplate = current ? templates.find((template) => template.positioningType === current.positioningType) || null : null;
  return {
    connection: profile,
    current,
    currentTemplate,
    history,
    templates,
    options: Object.entries(CONNECTION_POSITIONING_TYPES).map(([value, label]) => ({ value, label })),
    permissions: { canEdit: canEditPositioning(profile, context) },
  };
}

export function setConnectionBusinessPositioning(connectionId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const id = clean(connectionId);
  const profile = loadProfile(database, id);
  if (!canEditPositioning(profile, context)) {
    const error = new Error("仅管理员或该链接负责人可以修改经营定位。");
    error.statusCode = 403;
    throw error;
  }
  const positioningType = clean(input.positioningType);
  const decisionReason = clean(input.decisionReason);
  const decidedBy = clean(context.userId);
  if (!positioningTypes.has(positioningType)) throw new Error("经营定位类型无效。");
  if (!decisionReason) throw new Error("修改经营定位必须填写原因。");
  if (decisionReason.length > 500) throw new Error("修改原因不能超过500个字符。");
  if (!decidedBy || !database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(decidedBy)) throw new Error("操作人不存在或已停用。");

  const template = loadTemplates(database).find((item) => item.positioningType === positioningType);
  if (!template) throw new Error("当前经营定位没有生效中的目标模板。");
  if (!template.weightValid || template.metrics.length !== 2) throw new Error("目标模板指标权重配置不完整。");

  const result = database.transaction(() => {
    const current = database.prepare("SELECT * FROM connection_business_profiles WHERE connectionId=? AND status='active'").get(id);
    if (current?.positioningType === positioningType) return { changed: false, idempotent: true };
    const timestamp = now();
    if (current) database.prepare(`UPDATE connection_business_profiles
      SET status='historical',effectiveTo=?,updatedAt=? WHERE id=?`).run(timestamp, timestamp, current.id);
    database.prepare(`INSERT INTO connection_business_profiles
      (id,connectionId,positioningType,status,effectiveFrom,effectiveTo,decisionReason,decidedBy,createdAt,updatedAt)
      VALUES (?,?,?,'active',?,NULL,?,?,?,?)`).run(
      `connection-business-profile-${crypto.randomUUID()}`, id, positioningType, timestamp, decisionReason, decidedBy, timestamp, timestamp,
    );
    return { changed: true, idempotent: false };
  })();
  return { ...readConnectionGoalFoundation(id, { ...context, database }), ...result };
}
