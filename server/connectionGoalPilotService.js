import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { CONNECTION_POSITIONING_TYPES, setConnectionBusinessPositioning } from "./connectionGoalFoundationService.js";
import { confirmConnectionGoalPlan, createConnectionGoalSuggestion } from "./connectionGoalPlanService.js";

const BATCH_STATUSES = ["draft", "positioning", "target_confirm", "evaluation", "completed"];
const LINK_STATUSES = new Set(["selected", "positioning_pending", "target_pending", "active", "excluded"]);
const clean = (value) => String(value ?? "").trim();
const timestamp = () => new Date().toISOString();
const clamp = (value, minimum, maximum, fallback) => Math.min(maximum, Math.max(minimum, Number(value) || fallback));

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function requireActor(database, context = {}) {
  const userId = clean(context.userId);
  if (!userId || !database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(userId)) fail("当前操作人不存在或已停用。", 403);
  return userId;
}

function requireAdmin(database, context = {}) {
  const userId = requireActor(database, context);
  if (!context.isAdmin) fail("仅管理员可以创建试点批次或调整试点范围。", 403);
  return userId;
}

function loadBatch(database, batchId) {
  const batch = database.prepare(`SELECT b.*,p.name createdByName FROM connection_goal_init_batches b
    LEFT JOIN persons p ON p.id=b.createdBy WHERE b.id=?`).get(clean(batchId));
  if (!batch) fail("经营试点批次不存在。", 404);
  return batch;
}

function loadMember(database, batchId, memberId) {
  const member = database.prepare(`SELECT bl.*,c.ownerId,c.salesLinkId,c.name connectionName
    FROM connection_goal_init_batch_links bl JOIN connection_profiles c ON c.id=bl.connectionId
    WHERE bl.batchId=? AND bl.id=?`).get(clean(batchId), clean(memberId));
  if (!member) fail("试点链接不存在或不属于当前批次。", 404);
  return member;
}

function requireMemberEditor(database, member, context = {}) {
  const userId = requireActor(database, context);
  if (!context.isAdmin && clean(member.ownerId) !== userId) fail("仅管理员或该链接负责人可以确认定位和目标。", 403);
  if (member.status === "excluded") fail("已排除链接不能继续确认定位或目标。", 409);
  return userId;
}

function scopeClause(context = {}, alias = "c") {
  if (context.isAdmin) return { sql: "1=1", params: {} };
  return { sql: `${alias}.ownerId=@scopeOwnerId`, params: { scopeOwnerId: clean(context.userId) } };
}

function recentFactsCte() {
  return `WITH period AS (
      SELECT MAX(saleDate) endDate,date(MAX(saleDate),'-29 days') startDate FROM connection_sku_sales_daily_facts
    ), recent AS (
      SELECT salesLinkId,COUNT(*) factRows,COUNT(DISTINCT saleDate) activeDays,
        SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount
      FROM connection_sku_sales_daily_facts,period
      WHERE saleDate BETWEEN period.startDate AND period.endDate GROUP BY salesLinkId
    )`;
}

function progressForBatch(database, batchId, context = {}) {
  const scope = scopeClause(context);
  const row = database.prepare(`SELECT
      COUNT(*) totalLinks,
      SUM(CASE WHEN bl.status='excluded' THEN 1 ELSE 0 END) excludedLinks,
      SUM(CASE WHEN bl.status<>'excluded' AND bp.id IS NOT NULL THEN 1 ELSE 0 END) positionedLinks,
      SUM(CASE WHEN bl.status<>'excluded' AND gp.id IS NOT NULL THEN 1 ELSE 0 END) generatedGoalLinks,
      SUM(CASE WHEN bl.status<>'excluded' AND gp.status='active' THEN 1 ELSE 0 END) confirmedGoalLinks,
      SUM(CASE WHEN bl.status<>'excluded' AND ge.id IS NOT NULL THEN 1 ELSE 0 END) evaluationLinks,
      SUM(CASE WHEN bl.status<>'excluded' AND ge.evaluationStatus='evaluated' THEN 1 ELSE 0 END) evaluatedLinks
    FROM connection_goal_init_batch_links bl
    JOIN connection_profiles c ON c.id=bl.connectionId
    LEFT JOIN connection_business_profiles bp ON bp.connectionId=c.id AND bp.status='active'
    LEFT JOIN connection_goal_plans gp ON gp.id=(SELECT id FROM connection_goal_plans x WHERE x.connectionId=c.id
      AND x.status IN ('draft','pending_confirm','active') ORDER BY CASE x.status WHEN 'active' THEN 0 ELSE 1 END,x.createdAt DESC LIMIT 1)
    LEFT JOIN connection_goal_evaluations ge ON ge.goalPlanId=gp.id
    WHERE bl.batchId=@batchId AND ${scope.sql}`).get({ batchId, ...scope.params });
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value || 0)]));
}

function decorateBatch(database, batch, context = {}) {
  return { ...batch, progress: progressForBatch(database, batch.id, context), canAdjustScope: Boolean(context.isAdmin) };
}

export function readConnectionGoalPilotBatches(options = {}, context = {}) {
  const database = context.database || getDatabase();
  const page = clamp(options.page, 1, 100000, 1);
  const pageSize = clamp(options.pageSize, 1, 50, 20);
  const where = [];
  const params = {};
  if (clean(options.status) && BATCH_STATUSES.includes(clean(options.status))) { where.push("b.status=@status"); params.status = clean(options.status); }
  if (!context.isAdmin) {
    where.push(`EXISTS (SELECT 1 FROM connection_goal_init_batch_links bl JOIN connection_profiles c ON c.id=bl.connectionId
      WHERE bl.batchId=b.id AND c.ownerId=@scopeOwnerId)`);
    params.scopeOwnerId = clean(context.userId);
  }
  const whereSql = where.length ? where.join(" AND ") : "1=1";
  const total = Number(database.prepare(`SELECT COUNT(*) count FROM connection_goal_init_batches b WHERE ${whereSql}`).get(params).count);
  const batches = database.prepare(`SELECT b.*,p.name createdByName FROM connection_goal_init_batches b
    LEFT JOIN persons p ON p.id=b.createdBy WHERE ${whereSql}
    ORDER BY b.createdAt DESC,b.id DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
  return {
    items: batches.map((batch) => decorateBatch(database, batch, context)),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    permissions: { canCreateBatch: Boolean(context.isAdmin), canAdjustScope: Boolean(context.isAdmin) },
    statuses: BATCH_STATUSES,
  };
}

export function createConnectionGoalPilotBatch(input = {}, context = {}) {
  const database = context.database || getDatabase();
  const createdBy = requireAdmin(database, context);
  const name = clean(input.name);
  const description = clean(input.description);
  if (!name) fail("试点批次名称不能为空。");
  if (name.length > 120) fail("试点批次名称不能超过120个字符。");
  if (description.length > 1000) fail("试点说明不能超过1000个字符。");
  const id = `connection-goal-init-batch-${crypto.randomUUID()}`;
  const now = timestamp();
  database.prepare(`INSERT INTO connection_goal_init_batches
    (id,name,description,status,createdBy,createdAt,updatedAt) VALUES (?,?,?,'draft',?,?,?)`)
    .run(id, name, description || null, createdBy, now, now);
  return { item: decorateBatch(database, loadBatch(database, id), context) };
}

export function updateConnectionGoalPilotBatch(batchId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  requireAdmin(database, context);
  const batch = loadBatch(database, batchId);
  const nextStatus = clean(input.status);
  if (!BATCH_STATUSES.includes(nextStatus)) fail("试点批次状态无效。");
  const currentIndex = BATCH_STATUSES.indexOf(batch.status);
  const nextIndex = BATCH_STATUSES.indexOf(nextStatus);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) fail("试点批次必须按定位确认、目标确认、进入评价的顺序推进。", 409);
  const progress = progressForBatch(database, batch.id, { ...context, isAdmin: true });
  const activeTotal = progress.totalLinks - progress.excludedLinks;
  if (batch.status === "draft" && nextStatus === "positioning" && activeTotal < 1) fail("请先添加试点链接，再进入定位确认。", 409);
  if (batch.status === "positioning" && nextStatus === "target_confirm" && progress.positionedLinks < activeTotal) fail("仍有链接未确认经营定位，不能进入目标确认。", 409);
  if (batch.status === "target_confirm" && nextStatus === "evaluation" && progress.confirmedGoalLinks < activeTotal) fail("仍有链接未确认目标，不能进入评价。", 409);
  if (batch.status === "evaluation" && nextStatus === "completed" && progress.evaluatedLinks < activeTotal) fail("仍有链接尚未完成评价，不能完成批次。", 409);
  database.transaction(() => {
    const now = timestamp();
    database.prepare("UPDATE connection_goal_init_batches SET status=?,updatedAt=? WHERE id=?").run(nextStatus, now, batch.id);
    if (batch.status === "draft" && nextStatus === "positioning") {
      database.prepare(`UPDATE connection_goal_init_batch_links SET status='positioning_pending',updatedAt=?
        WHERE batchId=? AND status='selected'`).run(now, batch.id);
    }
  })();
  return { item: decorateBatch(database, loadBatch(database, batch.id), context) };
}

export function readConnectionGoalPilotCandidates(options = {}, context = {}) {
  const database = context.database || getDatabase();
  if (!context.isAdmin) fail("仅管理员可以调整试点候选范围。", 403);
  const page = clamp(options.page, 1, 100000, 1);
  const pageSize = clamp(options.pageSize, 1, 100, 50);
  const where = ["c.ownerId IS NOT NULL", "TRIM(c.ownerId)<>''", "r.factRows>0"];
  const params = {};
  if (clean(options.keyword)) { where.push("(c.name LIKE @keyword OR sl.platformGoodsId LIKE @keyword OR sh.shopName LIKE @keyword)"); params.keyword = `%${clean(options.keyword)}%`; }
  if (clean(options.ownerId)) { where.push("c.ownerId=@ownerId"); params.ownerId = clean(options.ownerId); }
  if (String(options.stableOnly) === "true" || String(options.stableOnly) === "1") where.push("r.activeDays>=20");
  if (clean(options.batchId)) {
    where.push("NOT EXISTS (SELECT 1 FROM connection_goal_init_batch_links bl WHERE bl.batchId=@batchId AND bl.connectionId=c.id)");
    params.batchId = clean(options.batchId);
  }
  const sort = ({ profit: "r.profitAmount DESC", stability: "r.activeDays DESC,r.salesAmount DESC" })[clean(options.sort)] || "r.salesAmount DESC";
  const candidateCte = `${recentFactsCte()}, candidate_rank AS (
    SELECT salesLinkId,ROW_NUMBER() OVER (ORDER BY salesAmount DESC,salesLinkId) salesRank FROM recent WHERE factRows>0
  )`;
  const from = `FROM connection_profiles c JOIN recent r ON r.salesLinkId=c.salesLinkId
    JOIN candidate_rank cr ON cr.salesLinkId=c.salesLinkId
    JOIN sales_links sl ON sl.id=c.salesLinkId JOIN sales_shops sh ON sh.id=sl.shopId LEFT JOIN persons p ON p.id=c.ownerId`;
  const whereSql = where.join(" AND ");
  const total = Number(database.prepare(`${recentFactsCte()} SELECT COUNT(*) count FROM connection_profiles c JOIN recent r ON r.salesLinkId=c.salesLinkId
    JOIN sales_links sl ON sl.id=c.salesLinkId JOIN sales_shops sh ON sh.id=sl.shopId WHERE ${whereSql}`).get(params).count);
  const items = database.prepare(`${candidateCte} SELECT c.id,c.name,c.ownerId,p.name ownerName,sl.platformGoodsId,sh.platform,
      COALESCE(sh.displayName,sh.shopName) shopName,r.factRows,r.activeDays,r.salesAmount,r.profitAmount,cr.salesRank
    ${from} WHERE ${whereSql} ORDER BY ${sort},c.id LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }).map((row) => ({
      ...row,
      activeDays: Number(row.activeDays || 0), salesAmount: Number(row.salesAmount || 0), profitAmount: Number(row.profitAmount || 0), salesRank: Number(row.salesRank || 0),
      tags: [`销售排名 #${Number(row.salesRank || 0)}`, Number(row.activeDays) >= 20 ? "销售稳定" : "", Number(row.profitAmount) > 0 ? "利润贡献为正" : "利润需关注"].filter(Boolean),
    }));
  const period = database.prepare("SELECT date(MAX(saleDate),'-29 days') startDate,MAX(saleDate) endDate FROM connection_sku_sales_daily_facts").get();
  const owners = database.prepare(`SELECT DISTINCT p.id,p.name FROM connection_profiles c JOIN persons p ON p.id=c.ownerId
    JOIN connection_sku_sales_daily_facts f ON f.salesLinkId=c.salesLinkId ORDER BY p.name,p.id`).all();
  return { items, period, filters: { owners }, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export function addConnectionGoalPilotLinks(batchId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  requireAdmin(database, context);
  const batch = loadBatch(database, batchId);
  if (!['draft', 'positioning'].includes(batch.status)) fail("当前批次已进入目标确认，不能再调整试点范围。", 409);
  const ids = [...new Set((Array.isArray(input.connectionIds) ? input.connectionIds : []).map(clean).filter(Boolean))];
  if (!ids.length || ids.length > 500) fail("请选择1至500个候选链接。");
  const placeholders = ids.map(() => "?").join(",");
  const valid = database.prepare(`${recentFactsCte()} SELECT c.id FROM connection_profiles c JOIN recent r ON r.salesLinkId=c.salesLinkId
    WHERE c.id IN (${placeholders}) AND c.ownerId IS NOT NULL AND TRIM(c.ownerId)<>'' AND r.factRows>0`).all(...ids).map((row) => row.id);
  if (valid.length !== ids.length) fail("候选链接必须同时具备负责人和近30天销售数据。", 409);
  const insert = database.prepare(`INSERT OR IGNORE INTO connection_goal_init_batch_links
    (id,batchId,connectionId,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?)`);
  let addedCount = 0;
  database.transaction(() => {
    const now = timestamp();
    const status = batch.status === "draft" ? "selected" : "positioning_pending";
    for (const connectionId of ids) addedCount += insert.run(`connection-goal-init-link-${crypto.randomUUID()}`, batch.id, connectionId, status, now, now).changes;
    database.prepare("UPDATE connection_goal_init_batches SET updatedAt=? WHERE id=?").run(now, batch.id);
  })();
  return { addedCount, selectedCount: ids.length, item: decorateBatch(database, loadBatch(database, batch.id), context) };
}

export function readConnectionGoalPilotMembers(batchId, options = {}, context = {}) {
  const database = context.database || getDatabase();
  const batch = loadBatch(database, batchId);
  const page = clamp(options.page, 1, 100000, 1);
  const pageSize = clamp(options.pageSize, 1, 100, 50);
  const scope = scopeClause(context);
  const where = ["bl.batchId=@batchId", scope.sql];
  const params = { batchId: batch.id, ...scope.params };
  if (clean(options.status) && LINK_STATUSES.has(clean(options.status))) { where.push("bl.status=@status"); params.status = clean(options.status); }
  if (clean(options.keyword)) { where.push("(c.name LIKE @keyword OR sl.platformGoodsId LIKE @keyword)"); params.keyword = `%${clean(options.keyword)}%`; }
  const base = `FROM connection_goal_init_batch_links bl JOIN connection_profiles c ON c.id=bl.connectionId
    JOIN sales_links sl ON sl.id=c.salesLinkId JOIN sales_shops sh ON sh.id=sl.shopId LEFT JOIN persons p ON p.id=c.ownerId
    LEFT JOIN recent r ON r.salesLinkId=c.salesLinkId
    LEFT JOIN connection_business_profiles bp ON bp.connectionId=c.id AND bp.status='active'
    LEFT JOIN connection_goal_plans gp ON gp.id=(SELECT id FROM connection_goal_plans x WHERE x.connectionId=c.id
      AND x.status IN ('draft','pending_confirm','active') ORDER BY CASE x.status WHEN 'active' THEN 0 ELSE 1 END,x.createdAt DESC LIMIT 1)
    LEFT JOIN connection_goal_metrics salesMetric ON salesMetric.goalPlanId=gp.id AND salesMetric.metricCode='sales_amount'
    LEFT JOIN connection_goal_metrics profitMetric ON profitMetric.goalPlanId=gp.id AND profitMetric.metricCode='profit_amount'
    LEFT JOIN connection_goal_evaluations ge ON ge.goalPlanId=gp.id`;
  const whereSql = where.join(" AND ");
  const total = Number(database.prepare(`${recentFactsCte()} SELECT COUNT(*) count FROM connection_goal_init_batch_links bl
    JOIN connection_profiles c ON c.id=bl.connectionId JOIN sales_links sl ON sl.id=c.salesLinkId WHERE ${whereSql}`).get(params).count);
  const rows = database.prepare(`${recentFactsCte()} SELECT bl.id,bl.batchId,bl.connectionId,bl.status,bl.createdAt,bl.updatedAt,c.name,c.ownerId,p.name ownerName,
      sl.platformGoodsId,sh.platform,COALESCE(sh.displayName,sh.shopName) shopName,r.activeDays,r.salesAmount,r.profitAmount,
      bp.positioningType,gp.id goalPlanId,gp.status goalStatus,gp.baselineStart,gp.baselineEnd,gp.targetMode,
      salesMetric.suggestedTargetValue salesSuggested,salesMetric.finalTargetValue salesTarget,
      profitMetric.suggestedTargetValue profitSuggested,profitMetric.finalTargetValue profitTarget,
      ge.evaluationStatus,ge.grade
    ${base} WHERE ${whereSql} ORDER BY CASE bl.status WHEN 'positioning_pending' THEN 0 WHEN 'selected' THEN 1 WHEN 'target_pending' THEN 2 WHEN 'active' THEN 3 ELSE 4 END,
      r.salesAmount DESC,c.id LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
  const items = rows.map((row) => {
    const baselineDays = row.baselineStart && row.baselineEnd ? Math.round((new Date(`${row.baselineEnd}T00:00:00Z`) - new Date(`${row.baselineStart}T00:00:00Z`)) / 86400000) + 1 : 0;
    return { ...row, activeDays: Number(row.activeDays || 0), salesAmount: Number(row.salesAmount || 0), profitAmount: Number(row.profitAmount || 0),
      positioningName: CONNECTION_POSITIONING_TYPES[row.positioningType] || null,
      targetConfidence: baselineDays >= 90 ? "high" : baselineDays >= 30 ? "low" : "manual",
      targetBasis: baselineDays ? `最近${Math.max(1, Math.round(baselineDays / 30))}个完整30天窗口中位数` : "数据不足，需人工设置",
      canManage: Boolean(context.isAdmin || (clean(context.userId) && clean(row.ownerId) === clean(context.userId))),
      tags: [Number(row.activeDays) >= 20 ? "销售稳定" : "近30天有销售", Number(row.profitAmount) > 0 ? "利润贡献为正" : "利润需关注"],
    };
  });
  return { batch: decorateBatch(database, batch, context), items,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, permissions: { canAdjustScope: Boolean(context.isAdmin) } };
}

export function updateConnectionGoalPilotMember(batchId, memberId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  requireAdmin(database, context);
  const member = loadMember(database, batchId, memberId);
  const status = clean(input.status);
  if (status !== "excluded") fail("当前只支持将链接标记为排除。");
  database.prepare("UPDATE connection_goal_init_batch_links SET status='excluded',updatedAt=? WHERE id=?").run(timestamp(), member.id);
  return { changed: true };
}

export function confirmConnectionGoalPilotPositioning(batchId, memberId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const batch = loadBatch(database, batchId);
  if (batch.status !== "positioning") fail("当前批次不在定位确认阶段。", 409);
  const member = loadMember(database, batchId, memberId);
  requireMemberEditor(database, member, context);
  const result = setConnectionBusinessPositioning(member.connectionId, input, { ...context, database });
  database.prepare("UPDATE connection_goal_init_batch_links SET status='target_pending',updatedAt=? WHERE id=?").run(timestamp(), member.id);
  return { changed: result.changed, positioning: result.current, memberStatus: "target_pending" };
}

export function createConnectionGoalPilotSuggestion(batchId, memberId, context = {}) {
  const database = context.database || getDatabase();
  const batch = loadBatch(database, batchId);
  if (batch.status !== "target_confirm") fail("当前批次尚未进入目标确认阶段。", 409);
  const member = loadMember(database, batchId, memberId);
  requireMemberEditor(database, member, context);
  const result = createConnectionGoalSuggestion(member.connectionId, { ...context, database });
  database.prepare("UPDATE connection_goal_init_batch_links SET status='target_pending',updatedAt=? WHERE id=?").run(timestamp(), member.id);
  return { changed: result.changed, suggestion: result.suggestion, plan: result.awaitingConfirmation };
}

export function confirmConnectionGoalPilotTarget(batchId, memberId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const batch = loadBatch(database, batchId);
  if (batch.status !== "target_confirm") fail("当前批次不在目标确认阶段。", 409);
  const member = loadMember(database, batchId, memberId);
  requireMemberEditor(database, member, context);
  const planId = clean(input.planId) || database.prepare(`SELECT id FROM connection_goal_plans WHERE connectionId=?
    AND status IN ('draft','pending_confirm') ORDER BY createdAt DESC,id DESC LIMIT 1`).get(member.connectionId)?.id;
  if (!planId) fail("当前链接没有待确认目标。", 409);
  const result = confirmConnectionGoalPlan(member.connectionId, planId, input, { ...context, database });
  database.prepare("UPDATE connection_goal_init_batch_links SET status='active',updatedAt=? WHERE id=?").run(timestamp(), member.id);
  return { changed: result.changed, current: result.current, memberStatus: "active" };
}
