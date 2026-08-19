import { getDatabase } from "./db.js";
import { CONNECTION_POSITIONING_TYPES } from "./connectionGoalFoundationService.js";

const clean = (value) => String(value ?? "").trim();
const gradeCodes = ["excellent", "good", "on_target", "underperforming"];

function numeric(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
}

export function readConnectionGoalCockpitSummary(context = {}) {
  const database = context.database || getDatabase();
  const params = {};
  const scopeWhere = context.isAdmin ? "COALESCE(l.currentState,'active')='active'" : "COALESCE(l.currentState,'active')='active' AND c.ownerId=@ownerId";
  if (!context.isAdmin) params.ownerId = clean(context.userId);
  const ctes = `WITH active_positioning AS (
      SELECT id,connectionId,positioningType FROM connection_business_profiles WHERE status='active'
    ), active_goals AS (
      SELECT id,connectionId FROM connection_goal_plans WHERE status='active'
    ), current_evaluations AS (
      SELECT goalPlanId,evaluationStatus,grade,periodStart,periodEnd FROM connection_goal_evaluations
    ), scoped AS (
      SELECT c.id,bp.positioningType,gp.id goalPlanId,ge.evaluationStatus,ge.grade,ge.periodStart,ge.periodEnd
      FROM connection_profiles c
      JOIN sales_links l ON l.id=c.salesLinkId
      LEFT JOIN active_positioning bp ON bp.connectionId=c.id
      LEFT JOIN active_goals gp ON gp.connectionId=c.id
      LEFT JOIN current_evaluations ge ON ge.goalPlanId=gp.id
      WHERE ${scopeWhere}
    )`;
  const coverage = numeric(database.prepare(`${ctes} SELECT COUNT(*) totalLinks,
      SUM(CASE WHEN positioningType IS NOT NULL THEN 1 ELSE 0 END) positionedLinks,
      SUM(CASE WHEN positioningType IS NULL THEN 1 ELSE 0 END) unpositionedLinks,
      SUM(CASE WHEN goalPlanId IS NOT NULL THEN 1 ELSE 0 END) activeGoalLinks,
      SUM(CASE WHEN goalPlanId IS NULL THEN 1 ELSE 0 END) pendingGoalLinks,
      SUM(CASE WHEN evaluationStatus='evaluated' THEN 1 ELSE 0 END) evaluatedLinks,
      SUM(CASE WHEN evaluationStatus IS NULL OR evaluationStatus<>'evaluated' THEN 1 ELSE 0 END) pendingEvaluationLinks
    FROM scoped`).get(params));
  const gradeRows = database.prepare(`${ctes} SELECT grade,COUNT(*) count FROM scoped
    WHERE evaluationStatus='evaluated' AND grade IS NOT NULL GROUP BY grade`).all(params);
  const gradeSummary = Object.fromEntries(gradeCodes.map((code) => [code, 0]));
  for (const row of gradeRows) if (gradeCodes.includes(row.grade)) gradeSummary[row.grade] = Number(row.count || 0);
  const positioningRows = database.prepare(`${ctes} SELECT positioningType,
      COUNT(*) totalLinks,
      SUM(CASE WHEN evaluationStatus='evaluated' THEN 1 ELSE 0 END) evaluatedLinks,
      SUM(CASE WHEN evaluationStatus IS NULL OR evaluationStatus<>'evaluated' THEN 1 ELSE 0 END) pendingEvaluationLinks,
      SUM(CASE WHEN evaluationStatus='evaluated' AND grade='excellent' THEN 1 ELSE 0 END) excellent,
      SUM(CASE WHEN evaluationStatus='evaluated' AND grade='good' THEN 1 ELSE 0 END) good,
      SUM(CASE WHEN evaluationStatus='evaluated' AND grade='on_target' THEN 1 ELSE 0 END) on_target,
      SUM(CASE WHEN evaluationStatus='evaluated' AND grade='underperforming' THEN 1 ELSE 0 END) underperforming
    FROM scoped WHERE positioningType IS NOT NULL GROUP BY positioningType`).all(params);
  const positioningByCode = new Map(positioningRows.map((row) => [row.positioningType, numeric(row)]));
  const positioningSummary = Object.entries(CONNECTION_POSITIONING_TYPES).map(([positioningType, positioningName]) => ({
    positioningType,
    positioningName,
    totalLinks: positioningByCode.get(positioningType)?.totalLinks || 0,
    evaluatedLinks: positioningByCode.get(positioningType)?.evaluatedLinks || 0,
    pendingEvaluationLinks: positioningByCode.get(positioningType)?.pendingEvaluationLinks || 0,
    excellent: positioningByCode.get(positioningType)?.excellent || 0,
    good: positioningByCode.get(positioningType)?.good || 0,
    on_target: positioningByCode.get(positioningType)?.on_target || 0,
    underperforming: positioningByCode.get(positioningType)?.underperforming || 0,
  }));
  const period = database.prepare(`${ctes} SELECT MIN(periodStart) periodStart,MAX(periodEnd) periodEnd,
      COUNT(DISTINCT COALESCE(periodStart,'')||'|'||COALESCE(periodEnd,'')) periodCount
    FROM scoped WHERE evaluationStatus='evaluated'`).get(params);
  return {
    ...coverage,
    gradeSummary,
    positioningSummary,
    evaluationPeriod: {
      periodStart: period?.periodStart || null,
      periodEnd: period?.periodEnd || null,
      periodCount: Number(period?.periodCount || 0),
      windowDays: 30,
    },
    scope: { isAdmin: Boolean(context.isAdmin), ownerId: context.isAdmin ? null : clean(context.userId) },
  };
}
