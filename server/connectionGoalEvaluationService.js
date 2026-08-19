import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { CONNECTION_GOAL_METRICS, CONNECTION_POSITIONING_TYPES } from "./connectionGoalFoundationService.js";

const clean = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const roundRate = (value) => Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;

const pendingReasons = Object.freeze({
  missing_positioning: "尚未设置经营定位。",
  missing_goal_plan: "尚未确认生效目标。",
  no_sales_data: "当前没有可用于评价的销售日报事实。",
  insufficient_data: "最近评价周期数据不足30个完整自然日。",
  data_delayed: "销售事实尚未更新到最新应到日期。",
  link_data_missing: "完整评价周期内未发现该链接的销售事实，未按0销售处理。",
  invalid_goal: "当前目标值或指标权重无法用于完成率计算。",
});

function addDays(dateText, days) {
  const value = new Date(`${dateText}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shanghaiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function loadProfile(database, connectionId) {
  return database.prepare("SELECT id,salesLinkId,name,ownerId,status FROM connection_profiles WHERE id=?").get(clean(connectionId)) || null;
}

function pending(reasonCode, extra = {}) {
  return {
    evaluationStatus: "pending",
    reasonCode,
    reason: pendingReasons[reasonCode] || "暂不满足评价条件。",
    grade: null,
    ...extra,
  };
}

function loadPlan(database, connectionId) {
  const plan = database.prepare(`SELECT gp.*,bp.positioningType,t.name templateName
    FROM connection_goal_plans gp
    JOIN connection_business_profiles bp ON bp.id=gp.positioningId
    JOIN connection_goal_templates t ON t.id=gp.templateId
    WHERE gp.connectionId=? AND gp.status='active' ORDER BY gp.effectiveFrom DESC,gp.id DESC LIMIT 1`).get(connectionId);
  if (!plan) return null;
  plan.metrics = database.prepare("SELECT * FROM connection_goal_metrics WHERE goalPlanId=? ORDER BY metricCode DESC").all(plan.id)
    .map((metric) => ({ ...metric, metricName: CONNECTION_GOAL_METRICS[metric.metricCode] || metric.metricCode }));
  plan.positioningName = CONNECTION_POSITIONING_TYPES[plan.positioningType] || plan.positioningType;
  return plan;
}

function saveEvaluation(database, profile, plan, result) {
  const timestamp = now();
  const existing = database.prepare("SELECT id,createdAt FROM connection_goal_evaluations WHERE goalPlanId=?").get(plan.id);
  const id = existing?.id || `connection-goal-evaluation-${crypto.randomUUID()}`;
  database.prepare(`INSERT INTO connection_goal_evaluations
    (id,connectionId,goalPlanId,periodStart,periodEnd,salesActual,profitActual,salesAchievement,profitAchievement,totalAchievement,grade,evaluationStatus,statusReason,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(goalPlanId) DO UPDATE SET
      periodStart=excluded.periodStart,periodEnd=excluded.periodEnd,salesActual=excluded.salesActual,profitActual=excluded.profitActual,
      salesAchievement=excluded.salesAchievement,profitAchievement=excluded.profitAchievement,totalAchievement=excluded.totalAchievement,
      grade=excluded.grade,evaluationStatus=excluded.evaluationStatus,statusReason=excluded.statusReason,updatedAt=excluded.updatedAt`).run(
    id, profile.id, plan.id, result.periodStart ?? null, result.periodEnd ?? null,
    result.salesActual ?? null, result.profitActual ?? null, result.salesAchievement ?? null,
    result.profitAchievement ?? null, result.totalAchievement ?? null, result.grade ?? null,
    result.evaluationStatus, result.reason ?? null, existing?.createdAt || timestamp, timestamp,
  );
  return { ...result, id, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
}

export function calculateConnectionGoalGrade(salesAchievement, profitAchievement, totalAchievement) {
  if (salesAchievement < 0.6 || profitAchievement < 0.6) return "underperforming";
  if (totalAchievement >= 1.2) return "excellent";
  if (totalAchievement >= 1) return "good";
  if (totalAchievement >= 0.8) return "on_target";
  return "underperforming";
}

export function evaluateConnectionGoal(connectionId, context = {}) {
  const database = context.database || getDatabase();
  const profile = loadProfile(database, connectionId);
  if (!profile) {
    const error = new Error("Link资产不存在。");
    error.statusCode = 404;
    throw error;
  }
  const positioning = database.prepare("SELECT id,positioningType FROM connection_business_profiles WHERE connectionId=? AND status='active'").get(profile.id);
  if (!positioning) return { connection: profile, currentGoal: null, ...pending("missing_positioning") };
  const plan = loadPlan(database, profile.id);
  if (!plan) return { connection: profile, currentGoal: null, positioningName: CONNECTION_POSITIONING_TYPES[positioning.positioningType], ...pending("missing_goal_plan") };

  const today = clean(context.today) || shanghaiDate();
  const expectedThrough = addDays(today, -1);
  const periodEnd = database.prepare("SELECT MAX(saleDate) value FROM connection_sku_sales_daily_facts WHERE saleDate<=?").get(expectedThrough)?.value ?? null;
  if (!periodEnd) return { connection: profile, currentGoal: plan, ...saveEvaluation(database, profile, plan, pending("no_sales_data", { periodStart: null, periodEnd: null, expectedThrough })) };
  const periodStart = addDays(periodEnd, -29);
  const coverageDays = Number(database.prepare(`SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts
    WHERE saleDate BETWEEN ? AND ?`).get(periodStart, periodEnd).count);
  if (coverageDays < 30) return { connection: profile, currentGoal: plan, ...saveEvaluation(database, profile, plan, pending("insufficient_data", { periodStart, periodEnd, expectedThrough, coverageDays })) };
  if (periodEnd < expectedThrough) return { connection: profile, currentGoal: plan, ...saveEvaluation(database, profile, plan, pending("data_delayed", { periodStart, periodEnd, expectedThrough, coverageDays })) };

  const actual = database.prepare(`SELECT COUNT(*) factRows,SUM(salesAmount) salesActual,SUM(profitAmount) profitActual
    FROM connection_sku_sales_daily_facts WHERE salesLinkId=? AND saleDate BETWEEN ? AND ?`).get(profile.salesLinkId, periodStart, periodEnd);
  if (!actual.factRows || actual.salesActual === null || actual.profitActual === null) {
    return { connection: profile, currentGoal: plan, ...saveEvaluation(database, profile, plan, pending("link_data_missing", { periodStart, periodEnd, expectedThrough, coverageDays })) };
  }
  const salesMetric = plan.metrics.find((metric) => metric.metricCode === "sales_amount");
  const profitMetric = plan.metrics.find((metric) => metric.metricCode === "profit_amount");
  const salesTarget = Number(salesMetric?.finalTargetValue);
  const profitTarget = Number(profitMetric?.finalTargetValue);
  const salesWeight = Number(salesMetric?.weight);
  const profitWeight = Number(profitMetric?.weight);
  if (!salesMetric || !profitMetric || !Number.isFinite(salesTarget) || salesTarget <= 0 || !Number.isFinite(profitTarget) || profitTarget <= 0
    || !Number.isFinite(salesWeight) || !Number.isFinite(profitWeight) || Math.abs(salesWeight + profitWeight - 1) > 1e-9) {
    return { connection: profile, currentGoal: plan, ...saveEvaluation(database, profile, plan, pending("invalid_goal", { periodStart, periodEnd, expectedThrough, coverageDays })) };
  }

  const salesActual = roundMoney(actual.salesActual);
  const profitActual = roundMoney(actual.profitActual);
  const salesAchievement = roundRate(salesActual / salesTarget);
  const profitAchievement = roundRate(profitActual / profitTarget);
  const totalAchievement = roundRate(Math.min(salesAchievement, 1.5) * salesWeight + Math.min(profitAchievement, 1.5) * profitWeight);
  const result = {
    evaluationStatus: "evaluated",
    reasonCode: null,
    reason: null,
    periodStart,
    periodEnd,
    expectedThrough,
    coverageDays,
    salesActual,
    profitActual,
    salesTarget,
    profitTarget,
    salesWeight,
    profitWeight,
    salesAchievement,
    profitAchievement,
    totalAchievement,
    grade: calculateConnectionGoalGrade(salesAchievement, profitAchievement, totalAchievement),
  };
  return { connection: profile, currentGoal: plan, ...saveEvaluation(database, profile, plan, result) };
}
