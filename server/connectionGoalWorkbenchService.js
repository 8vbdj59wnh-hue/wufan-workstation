import { getDatabase } from "./db.js";
import { setConnectionBusinessPositioning } from "./connectionGoalFoundationService.js";
import { confirmConnectionGoalPlan, createConnectionGoalSuggestion } from "./connectionGoalPlanService.js";
import { buildLinkOperatingScope } from "./linkOperatingSetService.js";

const clean = (value) => String(value ?? "").trim();
const positioningTypes = new Set(["sales_growth", "balanced_sales", "long_tail", "profit_contribution"]);
const gradeTypes = new Set(["excellent", "good", "on_target", "underperforming"]);

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

function normalizeListOptions(raw = {}) {
  const pageSize = Math.min(100, Math.max(1, Number(raw.pageSize) || 50));
  const page = Math.max(1, Number(raw.page) || 1);
  return { ...raw, page, pageSize, offset: (page - 1) * pageSize };
}

function baseCtes(periodStart, periodEnd) {
  return `WITH active_positioning AS (
      SELECT id,connectionId,positioningType FROM connection_business_profiles WHERE status='active'
    ), active_goals AS (
      SELECT id,connectionId,targetMode,status FROM connection_goal_plans WHERE status='active'
    ), current_evaluations AS (
      SELECT e.goalPlanId,e.evaluationStatus,e.grade,e.periodStart,e.periodEnd,e.totalAchievement
      FROM connection_goal_evaluations e
    ), recent_facts AS (
      SELECT salesLinkId,SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount,COUNT(*) factRows
      FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN '${periodStart}' AND '${periodEnd}' GROUP BY salesLinkId
    )`;
}

function buildWhere(options, userId, isAdmin, operatingScope) {
  const where = [operatingScope.predicate];
  const params = { ...operatingScope.params };
  if (!isAdmin) { where.push("c.ownerId=@scopeOwnerId"); params.scopeOwnerId = clean(userId); }
  if (clean(options.keyword)) {
    where.push("(c.name LIKE @keyword OR l.title LIKE @keyword OR l.platformGoodsId LIKE @keyword)");
    params.keyword = `%${clean(options.keyword)}%`;
  }
  const positioning = clean(options.positioning);
  if (positioning === "unset") where.push("bp.id IS NULL");
  else if (positioningTypes.has(positioning)) { where.push("bp.positioningType=@positioning"); params.positioning = positioning; }
  const goalStatus = clean(options.goalStatus);
  if (goalStatus === "set") where.push("gp.id IS NOT NULL");
  if (goalStatus === "pending") where.push("gp.id IS NULL");
  const evaluationStatus = clean(options.evaluationStatus);
  if (evaluationStatus === "pending") where.push("(ge.evaluationStatus IS NULL OR ge.evaluationStatus<>'evaluated')");
  else if (gradeTypes.has(evaluationStatus)) { where.push("ge.evaluationStatus='evaluated' AND ge.grade=@grade"); params.grade = evaluationStatus; }
  if (clean(options.ownerId)) { where.push("c.ownerId=@ownerId"); params.ownerId = clean(options.ownerId); }
  return { whereSql: where.join(" AND "), params };
}

function sourcePeriod(database) {
  const periodEnd = database.prepare("SELECT MAX(saleDate) value FROM connection_sku_sales_daily_facts").get()?.value ?? null;
  return { periodStart: periodEnd ? addDays(periodEnd, -29) : "0000-01-01", periodEnd: periodEnd || "0000-01-01" };
}

export function readConnectionGoalWorkbench(rawOptions = {}, context = {}) {
  const database = context.database || getDatabase();
  const options = normalizeListOptions(rawOptions);
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "connectionGoalWorkbenchOperating" });
  const { periodStart, periodEnd } = sourcePeriod(database);
  const ctes = baseCtes(periodStart, periodEnd);
  const scope = buildWhere({}, context.userId, context.isAdmin, operatingScope);
  const filtered = buildWhere(options, context.userId, context.isAdmin, operatingScope);
  const joins = `FROM connection_profiles c
    JOIN sales_links l ON l.id=c.salesLinkId
    JOIN sales_shops sh ON sh.id=l.shopId
    LEFT JOIN persons p ON p.id=c.ownerId
    LEFT JOIN active_positioning bp ON bp.connectionId=c.id
    LEFT JOIN active_goals gp ON gp.connectionId=c.id
    LEFT JOIN current_evaluations ge ON ge.goalPlanId=gp.id
    LEFT JOIN recent_facts rf ON rf.salesLinkId=l.id`;
  const summary = database.prepare(`${ctes} SELECT COUNT(*) total,
      SUM(CASE WHEN bp.id IS NOT NULL THEN 1 ELSE 0 END) positioned,
      SUM(CASE WHEN bp.id IS NULL THEN 1 ELSE 0 END) unpositioned,
      SUM(CASE WHEN gp.id IS NOT NULL THEN 1 ELSE 0 END) goalSet,
      SUM(CASE WHEN gp.id IS NULL THEN 1 ELSE 0 END) goalPending,
      SUM(CASE WHEN ge.evaluationStatus='evaluated' THEN 1 ELSE 0 END) evaluated,
      SUM(CASE WHEN ge.evaluationStatus IS NULL OR ge.evaluationStatus<>'evaluated' THEN 1 ELSE 0 END) evaluationPending
    ${joins} WHERE ${scope.whereSql}`).get(scope.params);
  const total = Number(database.prepare(`${ctes} SELECT COUNT(*) count ${joins} WHERE ${filtered.whereSql}`).get(filtered.params)?.count || 0);
  const items = database.prepare(`${ctes} SELECT c.id,c.salesLinkId,c.name,l.title,l.platformGoodsId,sh.platform,sh.id shopId,
      sh.displayName shopDisplayName,sh.shopName,c.ownerId,p.name ownerName,bp.id positioningId,bp.positioningType,
      gp.id goalPlanId,gp.targetMode,CASE WHEN gp.id IS NULL THEN 'pending' ELSE 'set' END goalStatus,
      CASE WHEN ge.evaluationStatus='evaluated' THEN 'evaluated' ELSE 'pending' END evaluationStatus,
      ge.grade,ge.totalAchievement,rf.salesAmount,rf.profitAmount,rf.factRows
    ${joins} WHERE ${filtered.whereSql}
    ORDER BY c.updatedAt DESC,c.id DESC LIMIT @limit OFFSET @offset`).all({ ...filtered.params, limit: options.pageSize, offset: options.offset });
  const owners = database.prepare(`${ctes} SELECT DISTINCT c.ownerId id,p.name
    ${joins} WHERE ${scope.whereSql} AND c.ownerId IS NOT NULL AND c.ownerId<>'' ORDER BY p.name,c.ownerId`).all(scope.params);
  return {
    summary: Object.fromEntries(Object.entries(summary || {}).map(([key, value]) => [key, Number(value || 0)])),
    items: items.map((item) => ({ ...item, salesAmount: item.factRows ? Number(item.salesAmount) : null, profitAmount: item.factRows ? Number(item.profitAmount) : null,
      canManage: Boolean(context.isAdmin || (clean(context.userId) && clean(item.ownerId) === clean(context.userId))) })),
    pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / options.pageSize)) },
    filters: { owners },
    period: periodEnd === "0000-01-01" ? { startDate: null, endDate: null } : { startDate: periodStart, endDate: periodEnd },
  };
}

function normalizedIds(input = {}) {
  const ids = [...new Set((Array.isArray(input.connectionIds) ? input.connectionIds : []).map(clean).filter(Boolean))];
  if (!ids.length) fail("请至少选择一个链接。");
  if (ids.length > 100) fail("单次批量操作最多处理100个链接。");
  return ids;
}

function assertManageable(database, ids, context) {
  const rows = database.prepare(`SELECT id,ownerId FROM connection_profiles WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids);
  if (rows.length !== ids.length) fail("部分链接档案不存在。", 404);
  const unauthorized = rows.filter((row) => !context.isAdmin && clean(row.ownerId) !== clean(context.userId));
  if (unauthorized.length) fail("只能管理自己负责的链接。", 403);
  return rows;
}

export function batchSetConnectionPositioning(input = {}, context = {}) {
  const database = context.database || getDatabase();
  const ids = normalizedIds(input);
  assertManageable(database, ids, context);
  const positioningType = clean(input.positioningType);
  const decisionReason = clean(input.decisionReason);
  if (!positioningTypes.has(positioningType)) fail("经营定位类型无效。");
  if (!decisionReason) fail("批量设置定位必须填写原因。");
  const results = database.transaction(() => ids.map((id) => setConnectionBusinessPositioning(id, { positioningType, decisionReason }, { ...context, database })))();
  return { selectedCount: ids.length, changedCount: results.filter((item) => item.changed).length, skippedCount: results.filter((item) => !item.changed).length };
}

export function batchGenerateConnectionGoalSuggestions(input = {}, context = {}) {
  const database = context.database || getDatabase();
  const ids = normalizedIds(input);
  assertManageable(database, ids, context);
  const results = database.transaction(() => ids.map((connectionId) => {
    const positioned = database.prepare("SELECT 1 FROM connection_business_profiles WHERE connectionId=? AND status='active'").get(connectionId);
    if (!positioned) return { connectionId, status: "skipped", reason: "missing_positioning" };
    const activeGoal = database.prepare("SELECT 1 FROM connection_goal_plans WHERE connectionId=? AND status='active'").get(connectionId);
    if (activeGoal) return { connectionId, status: "skipped", reason: "active_goal_exists" };
    const result = createConnectionGoalSuggestion(connectionId, { ...context, database });
    return { connectionId, status: result.awaitingConfirmation?.status || "generated", changed: result.changed };
  }))();
  return { selectedCount: ids.length, generatedCount: results.filter((item) => item.status !== "skipped").length,
    skippedCount: results.filter((item) => item.status === "skipped").length, results };
}

export function batchConfirmConnectionGoals(input = {}, context = {}) {
  const database = context.database || getDatabase();
  const ids = normalizedIds(input);
  assertManageable(database, ids, context);
  const results = database.transaction(() => ids.map((connectionId) => {
    const plan = database.prepare(`SELECT * FROM connection_goal_plans WHERE connectionId=? AND status='pending_confirm'
      ORDER BY createdAt DESC,id DESC LIMIT 1`).get(connectionId);
    if (!plan) return { connectionId, status: "skipped", reason: "no_system_suggestion" };
    const metrics = database.prepare("SELECT metricCode,suggestedTargetValue FROM connection_goal_metrics WHERE goalPlanId=?").all(plan.id);
    const sales = metrics.find((metric) => metric.metricCode === "sales_amount")?.suggestedTargetValue;
    const profit = metrics.find((metric) => metric.metricCode === "profit_amount")?.suggestedTargetValue;
    if (sales === null || sales === undefined || profit === null || profit === undefined) return { connectionId, status: "skipped", reason: "manual_target_required" };
    confirmConnectionGoalPlan(connectionId, plan.id, { salesAmount: sales, profitAmount: profit,
      approvalReason: clean(input.approvalReason) || "批量按系统建议确认" }, { ...context, database });
    return { connectionId, status: "confirmed" };
  }))();
  return { selectedCount: ids.length, confirmedCount: results.filter((item) => item.status === "confirmed").length,
    skippedCount: results.filter((item) => item.status === "skipped").length, results };
}
