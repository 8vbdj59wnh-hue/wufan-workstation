import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";
import { createConnectionAction } from "./connectionService.js";

const TEMPLATE_ID = "connection-inspection-template-basic-health";
const TEMPLATE_VERSION_ID = "connection-inspection-template-basic-health-v1";
const TEMPLATE_CODE = "link_basic_health";
const gradeValues = new Set(["A", "B", "C", "D"]);
const cadenceDays = Object.freeze({ days_30: 30, days_60: 60, days_90: 90 });

export const CONNECTION_INSPECTION_TEMPLATE_V1 = Object.freeze({
  id: TEMPLATE_ID,
  code: TEMPLATE_CODE,
  name: "链接基础健康度评估表",
  version: "V1.0",
  items: [
    ["market_positioning", "市场定位", "判断链接是否明确卖给谁、满足什么需求、在什么赛道竞争。", ["目标人群明确", "核心需求明确", "竞争定位明确"]],
    ["main_image", "主图", "判断第一眼是否能让目标顾客快速识别产品并产生兴趣。", ["主体清晰", "吸引目标人群", "核心差异突出"]],
    ["title", "标题", "判断标题能否准确描述商品，并覆盖目标顾客的核心搜索需求，让平台正确识别、顾客快速理解。", ["商品表达准确", "核心需求词覆盖", "关键词结构合理"]],
    ["media_details", "主图视频+5张主图微详情", "判断顾客快速浏览时，是否能建立完整的产品认知和购买兴趣。", ["信息完整", "卖点清晰", "展示有层次"]],
    ["detail_page", "详情页", "判断是否把产品、价值以及顾客购买所需的信息讲清楚。", ["产品讲清楚", "价值讲透彻", "决策信息完整"]],
    ["buyer_reviews", "评价买家秀", "判断消费者真实反馈是否能够证明产品价值、增强购买信心。", ["真实可信", "核心卖点得到验证", "买家秀有参考价值"]],
    ["sku_structure", "SKU结构", "判断SKU是否围绕顾客选择和经营目的进行合理规划。", ["选择清晰", "结构合理", "主推明确"]],
    ["price_value", "价格与价值呈现", "判断价格是否符合定位，以及顾客能否理解为什么值这个价格。", ["价格符合定位", "价值支撑充分", "价格体系合理"]],
    ["cross_sell", "关联销售设计", "判断是否能够继续承接顾客的搭配、替代和升级需求。", ["关联有需求逻辑", "搭配/替代/升级合理", "推荐路径清晰"]],
    ["service_risk", "服务说明与风险消除", "判断购买前的主要疑虑和风险是否被提前说明和解决。", ["服务说明清晰", "关键风险说明充分", "购买顾虑得到解决"]],
  ].map(([code, name, description, criteria], itemIndex) => ({
    code, name, description, sortOrder: itemIndex + 1,
    criteria: criteria.map((criterionName, criterionIndex) => ({
      code: `${code}_${criterionIndex + 1}`,
      name: criterionName,
      description: "",
      sortOrder: criterionIndex + 1,
    })),
  })),
});

const clean = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value ?? ""); } catch { return fallback; } };

function dateOnly(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function addDays(dateText, days) {
  const value = new Date(`${dateText}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + Number(days));
  return value.toISOString().slice(0, 10);
}

function assertLink(database, salesLinkId) {
  const link = database.prepare(`SELECT l.id,l.title,l.displayName,l.ownerId,l.currentState,s.platform,s.displayName shopDisplayName,s.shopName
    FROM sales_links l JOIN sales_shops s ON s.id=l.shopId WHERE l.id=?`).get(clean(salesLinkId));
  if (!link) { const error = new Error("Link资产不存在。"); error.statusCode = 404; throw error; }
  return link;
}

function assertActiveLink(database, salesLinkId) {
  const link = assertLink(database, salesLinkId);
  if (link.currentState !== "active") throw new Error("当前Link已失效，不能新建或修改体检业务。");
  return link;
}

function assertPerson(database, personId) {
  const person = database.prepare("SELECT id,name,departmentId,status FROM persons WHERE id=?").get(clean(personId));
  if (!person || person.status !== "active") throw new Error("体检负责人不存在或已停用。");
  if (!person.departmentId) throw new Error("体检负责人尚未设置部门，无法创建正式任务。");
  return person;
}

export function ensureConnectionInspectionTemplate(database = getDatabase(), createdBy = "system") {
  const timestamp = now();
  const templateContent = JSON.stringify(CONNECTION_INSPECTION_TEMPLATE_V1);
  database.transaction(() => {
    database.prepare(`INSERT OR IGNORE INTO connection_inspection_templates
      (id,code,name,status,currentVersionId,createdBy,createdAt,updatedAt) VALUES (?,?,?,'active',?,?,?,?)`)
      .run(TEMPLATE_ID, TEMPLATE_CODE, CONNECTION_INSPECTION_TEMPLATE_V1.name, TEMPLATE_VERSION_ID, clean(createdBy) || null, timestamp, timestamp);
    database.prepare(`INSERT OR IGNORE INTO template_asset_versions
      (id,assetType,assetId,versionNumber,majorVersion,minorVersion,status,contentJson,changeSummary,createdBy,createdAt,activatedAt)
      VALUES (?,'inspection',?,'V1.0',1,0,'active',?,'初始化链接基础健康度评估表',?,?,?)`)
      .run(TEMPLATE_VERSION_ID, TEMPLATE_ID, templateContent, clean(createdBy) || null, timestamp, timestamp);
    database.prepare("UPDATE connection_inspection_templates SET currentVersionId=?,updatedAt=? WHERE id=?")
      .run(TEMPLATE_VERSION_ID, timestamp, TEMPLATE_ID);
  })();
  return readInspectionTemplateVersion(TEMPLATE_VERSION_ID, database);
}

export function readInspectionTemplateVersion(versionId, database = getDatabase()) {
  const row = database.prepare("SELECT * FROM template_asset_versions WHERE id=? AND assetType='inspection'").get(clean(versionId));
  if (!row) throw new Error("链接体检模板版本不存在。");
  return { ...row, content: parseJson(row.contentJson, {}) };
}

function readInspectionRow(database, inspectionId) {
  const inspection = database.prepare(`SELECT i.*,p.name inspectorName,v.versionNumber templateVersion
    FROM connection_inspections i JOIN persons p ON p.id=i.inspectorId
    JOIN template_asset_versions v ON v.id=i.templateVersionId WHERE i.id=?`).get(clean(inspectionId));
  if (!inspection) { const error = new Error("体检记录不存在。"); error.statusCode = 404; throw error; }
  inspection.results = database.prepare(`SELECT * FROM connection_inspection_results WHERE inspectionId=?
    ORDER BY itemSortOrder,criterionSortOrder,id`).all(inspection.id);
  inspection.issues = database.prepare(`SELECT x.*,
      (SELECT COUNT(*) FROM connection_inspection_issue_actions a WHERE a.inspectionIssueId=x.id) actionCount
    FROM connection_inspection_issues x WHERE x.inspectionId=? ORDER BY createdAt,id`).all(inspection.id);
  return inspection;
}

export function readConnectionInspectionOverview(salesLinkId, context = {}) {
  const database = context.database || getDatabase();
  const link = assertLink(database, salesLinkId);
  ensureConnectionInspectionTemplate(database, context.userId);
  const latestId = database.prepare(`SELECT id FROM connection_inspections WHERE salesLinkId=? AND status='completed'
    ORDER BY completedAt DESC,createdAt DESC,id DESC LIMIT 1`).get(link.id)?.id;
  const draftId = database.prepare(`SELECT id FROM connection_inspections WHERE salesLinkId=? AND status='draft'
    ORDER BY updatedAt DESC,id DESC LIMIT 1`).get(link.id)?.id;
  const history = database.prepare(`SELECT i.*,p.name inspectorName,v.versionNumber templateVersion,
      (SELECT COUNT(*) FROM connection_inspection_issues x WHERE x.inspectionId=i.id) issueCount,
      (SELECT COUNT(DISTINCT a.actionId) FROM connection_inspection_issues x JOIN connection_inspection_issue_actions a ON a.inspectionIssueId=x.id WHERE x.inspectionId=i.id) actionCount
    FROM connection_inspections i JOIN persons p ON p.id=i.inspectorId JOIN template_asset_versions v ON v.id=i.templateVersionId
    WHERE i.salesLinkId=? AND i.status='completed' ORDER BY i.completedAt DESC,i.id DESC`).all(link.id);
  const schedule = database.prepare(`SELECT s.*,p.name assigneeName FROM connection_inspection_schedules s
    JOIN persons p ON p.id=s.assigneeId WHERE s.salesLinkId=?`).get(link.id) || null;
  const pendingIssueCount = Number(database.prepare(`SELECT COUNT(*) count FROM connection_inspection_issues
    WHERE salesLinkId=? AND status<>'closed'`).get(link.id)?.count || 0);
  return {
    link,
    latest: latestId ? readInspectionRow(database, latestId) : null,
    draft: draftId ? readInspectionRow(database, draftId) : null,
    history,
    schedule,
    pendingIssueCount,
  };
}

export function startConnectionInspection(salesLinkId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const link = assertActiveLink(database, salesLinkId);
  const inspectorId = clean(input.inspectorId) || clean(context.userId);
  assertPerson(database, inspectorId);
  const template = ensureConnectionInspectionTemplate(database, context.userId);
  const taskId = clean(input.taskId);
  const bindTask = (inspectionId) => {
    if (!taskId) return;
    const linkTask = database.prepare(`SELECT st.id,st.inspectionId FROM connection_inspection_schedule_tasks st
      JOIN connection_inspection_schedules s ON s.id=st.scheduleId WHERE st.taskId=? AND s.salesLinkId=?`).get(taskId, link.id);
    if (!linkTask) throw new Error("该任务不属于当前Link体检计划。");
    if (linkTask.inspectionId && linkTask.inspectionId !== inspectionId) throw new Error("该体检任务已关联其他体检记录。");
    database.prepare("UPDATE connection_inspection_schedule_tasks SET inspectionId=? WHERE id=? AND inspectionId IS NULL").run(inspectionId, linkTask.id);
  };
  const existing = database.prepare("SELECT id FROM connection_inspections WHERE salesLinkId=? AND status='draft'").get(link.id);
  if (existing) {
    bindTask(existing.id);
    return readInspectionRow(database, existing.id);
  }
  const timestamp = now();
  const inspectionId = uid("connection-inspection");
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_inspections
      (id,salesLinkId,inspectorId,templateVersionId,status,startedAt,createdAt,updatedAt)
      VALUES (?,?,?,?,'draft',?,?,?)`).run(inspectionId, link.id, inspectorId, template.id, timestamp, timestamp, timestamp);
    const insert = database.prepare(`INSERT INTO connection_inspection_results
      (id,inspectionId,itemCode,itemNameSnapshot,itemDescriptionSnapshot,itemSortOrder,criterionCode,criterionNameSnapshot,criterionDescriptionSnapshot,criterionSortOrder,grade,note,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL,'',?,?)`);
    for (const item of template.content.items || []) for (const criterion of item.criteria || []) {
      insert.run(uid("connection-inspection-result"), inspectionId, item.code, item.name, item.description || "", item.sortOrder,
        criterion.code, criterion.name, criterion.description || "", criterion.sortOrder, timestamp, timestamp);
    }
    bindTask(inspectionId);
  })();
  return readInspectionRow(database, inspectionId);
}

function applyInspectionAnswers(database, inspection, answers) {
  if (inspection.status !== "draft") throw new Error("已完成体检不可修改。");
  const rows = new Map(database.prepare("SELECT id FROM connection_inspection_results WHERE inspectionId=?").all(inspection.id).map((row) => [row.id, row]));
  const update = database.prepare("UPDATE connection_inspection_results SET grade=?,note=?,updatedAt=? WHERE id=? AND inspectionId=?");
  const timestamp = now();
  for (const answer of Array.isArray(answers) ? answers : []) {
    const resultId = clean(answer?.id);
    if (!rows.has(resultId)) throw new Error("体检评分项不属于当前体检。");
    const grade = clean(answer?.grade).toUpperCase() || null;
    if (grade !== null && !gradeValues.has(grade)) throw new Error("体检评分只能选择A、B、C或D。");
    update.run(grade, clean(answer?.note), timestamp, resultId, inspection.id);
  }
  database.prepare("UPDATE connection_inspections SET updatedAt=? WHERE id=?").run(timestamp, inspection.id);
}

export function saveConnectionInspectionDraft(inspectionId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const inspection = readInspectionRow(database, inspectionId);
  assertActiveLink(database, inspection.salesLinkId);
  applyInspectionAnswers(database, inspection, input.results);
  return readInspectionRow(database, inspection.id);
}

export function completeConnectionInspection(inspectionId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const inspection = readInspectionRow(database, inspectionId);
  assertActiveLink(database, inspection.salesLinkId);
  return database.transaction(() => {
    applyInspectionAnswers(database, inspection, input.results);
    const results = database.prepare("SELECT * FROM connection_inspection_results WHERE inspectionId=? ORDER BY itemSortOrder,criterionSortOrder").all(inspection.id);
    if (results.length !== 30 || results.some((row) => !gradeValues.has(row.grade))) throw new Error("完成体检前必须为30个核心标准全部评分。");
    const counts = Object.fromEntries([...gradeValues].map((grade) => [grade, results.filter((row) => row.grade === grade).length]));
    const timestamp = now();
    database.prepare(`UPDATE connection_inspections SET status='completed',completedAt=?,gradeACount=?,gradeBCount=?,gradeCCount=?,gradeDCount=?,updatedAt=? WHERE id=?`)
      .run(timestamp, counts.A, counts.B, counts.C, counts.D, timestamp, inspection.id);
    const insertIssue = database.prepare(`INSERT OR IGNORE INTO connection_inspection_issues
      (id,inspectionId,inspectionResultId,salesLinkId,status,itemNameSnapshot,criterionNameSnapshot,gradeSnapshot,noteSnapshot,createdAt,updatedAt)
      VALUES (?,?,?,?, 'candidate',?,?,?,?,?,?)`);
    for (const row of results.filter((item) => item.grade !== "A")) {
      insertIssue.run(uid("connection-inspection-issue"), inspection.id, row.id, inspection.salesLinkId,
        row.itemNameSnapshot, row.criterionNameSnapshot, row.grade, row.note || "", timestamp, timestamp);
    }
    const schedule = database.prepare("SELECT * FROM connection_inspection_schedules WHERE salesLinkId=?").get(inspection.salesLinkId);
    if (schedule) {
      const next = schedule.enabled ? addDays(timestamp.slice(0, 10), schedule.intervalDays) : null;
      database.prepare("UPDATE connection_inspection_schedules SET lastInspectionAt=?,nextInspectionAt=?,updatedAt=? WHERE id=?")
        .run(timestamp, next, timestamp, schedule.id);
    }
    return readInspectionRow(database, inspection.id);
  })();
}

export function readConnectionInspection(inspectionId, context = {}) {
  return readInspectionRow(context.database || getDatabase(), inspectionId);
}

export function createInspectionAction(salesLinkId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const link = assertActiveLink(database, salesLinkId);
  const issueIds = [...new Set((Array.isArray(input.issueIds) ? input.issueIds : []).map(clean).filter(Boolean))];
  if (!issueIds.length) throw new Error("请至少选择一个体检问题。");
  const placeholders = issueIds.map(() => "?").join(",");
  const issues = database.prepare(`SELECT * FROM connection_inspection_issues WHERE salesLinkId=? AND id IN (${placeholders})`).all(link.id, ...issueIds);
  if (issues.length !== issueIds.length) throw new Error("部分体检问题不存在或不属于当前Link。");
  if (issues.some((issue) => issue.status !== "candidate")) throw new Error("所选体检问题已发起行动或已关闭，请勿重复提交。");
  const defaultTitle = issues.length === 1 ? `优化${issues[0].criterionNameSnapshot}` : `处理${issues.length}项链接体检问题`;
  return database.transaction(() => {
    const action = createConnectionAction(link.id, {
      title: clean(input.title) || defaultTitle,
      description: clean(input.description) || issues.map((issue) => `${issue.itemNameSnapshot}｜${issue.criterionNameSnapshot}｜${issue.gradeSnapshot}${issue.noteSnapshot ? `｜${issue.noteSnapshot}` : ""}`).join("\n"),
      ownerId: clean(input.ownerId) || link.ownerId || null,
      dueDate: clean(input.dueDate) || null,
      status: "pending",
    }, context.userId);
    const timestamp = now();
    const insert = database.prepare(`INSERT INTO connection_inspection_issue_actions
      (id,inspectionIssueId,actionId,sourceGrade,sourceNote,createdAt) VALUES (?,?,?,?,?,?)`);
    for (const issue of issues) {
      insert.run(uid("connection-inspection-issue-action"), issue.id, action.id, issue.gradeSnapshot, issue.noteSnapshot || "", timestamp);
      database.prepare("UPDATE connection_inspection_issues SET status='action_created',updatedAt=? WHERE id=?").run(timestamp, issue.id);
    }
    const task = input.createTask === true ? createTaskForAction(action.id, { dueDate: input.dueDate }, { database, userId: context.userId }) : null;
    return { action, task, issues };
  })();
}

function resolveTaskFoundation(database, assigneeId, initiatorId) {
  const assignee = assertPerson(database, assigneeId);
  const initiator = database.prepare("SELECT id FROM persons WHERE id=? AND status='active'").get(clean(initiatorId))?.id || assignee.id;
  const goal = database.prepare(`SELECT id FROM goals WHERE status='active' AND (departmentId=? OR departmentId IS NULL)
    ORDER BY CASE WHEN departmentId=? THEN 0 ELSE 1 END,CASE WHEN type='period' THEN 0 ELSE 1 END,createdAt DESC,id LIMIT 1`)
    .get(assignee.departmentId, assignee.departmentId);
  if (!goal) throw new Error("系统中没有可用于正式体检任务的生效目标。");
  return { assignee, initiator, goalId: goal.id };
}

function createFormalTask(database, input) {
  const timestamp = now();
  const foundation = resolveTaskFoundation(database, input.assigneeId, input.initiatorId);
  return createResource("tasks", {
    id: uid("task"), businessCode: null, taskType: "execution", name: input.name, goalId: foundation.goalId,
    taskTemplateId: null, templateId: null, source: "direct", processInstanceId: null, processNodeId: null,
    categoryId: null, departmentId: foundation.assignee.departmentId, ownerId: foundation.assignee.id,
    executorId: foundation.assignee.id, initiatorId: foundation.initiator, description: input.description || "",
    completionStandard: "完成对应Link的30项基础体检并保存结果。", reviewStandard: "30项均已评分，体检历史可追溯。",
    outputRequirement: "完成链接体检", startDate: input.dueDate, readyAt: timestamp, dueDate: input.dueDate,
    plannedWeek: null, needAcceptance: false, accepterId: null, status: "todo", resultText: null,
    resultAttachments: [], customFields: {}, displayTitle: input.name, coverImageUrl: null, submitType: "none",
    submitDescription: null, submitFields: [], submitFormData: {}, submitFiles: [], submitLinks: [], submittedAt: null,
    submittedBy: null, cancelReason: null, reviewTargetTaskId: null, reviewTargetSnapshot: null, returnToNodeId: null,
    reviewStatus: null, reviewComment: null, reviewedAt: null, reviewerId: null, requireRejectionReason: false,
    createdAt: timestamp, updatedAt: timestamp, completedAt: null,
  });
}

export function createTaskForAction(actionId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const action = database.prepare("SELECT * FROM connection_actions WHERE id=?").get(clean(actionId));
  if (!action) throw new Error("链接优化行动不存在。");
  if (clean(context.salesLinkId) && action.connectionProfileId !== clean(context.salesLinkId)) {
    throw new Error("链接优化行动不属于当前Link。");
  }
  const existing = database.prepare(`SELECT t.* FROM connection_action_tasks x JOIN tasks t ON t.id=x.taskId
    WHERE x.actionId=? ORDER BY x.createdAt DESC LIMIT 1`).get(action.id);
  if (existing) return existing;
  const assigneeId = clean(input.assigneeId) || action.ownerId;
  if (!assigneeId) throw new Error("请先为链接优化行动设置负责人。");
  const task = createFormalTask(database, {
    name: `链接优化行动｜${action.title}`,
    description: action.description || "",
    assigneeId,
    initiatorId: context.userId,
    dueDate: clean(input.dueDate) || action.dueDate || dateOnly(),
  });
  database.prepare("INSERT INTO connection_action_tasks(id,actionId,taskId,createdAt) VALUES (?,?,?,?)")
    .run(uid("connection-action-task"), action.id, task.id, now());
  return task;
}

export function syncInspectionIssuesForActionStatus(actionId, status, context = {}) {
  const database = context.database || getDatabase();
  const nextStatus = status === "completed" ? "awaiting_reinspection" : status === "canceled" ? "candidate" : "action_created";
  database.prepare(`UPDATE connection_inspection_issues SET status=?,updatedAt=? WHERE id IN
    (SELECT inspectionIssueId FROM connection_inspection_issue_actions WHERE actionId=?)`).run(nextStatus, now(), clean(actionId));
}

export function saveConnectionInspectionSchedule(salesLinkId, input = {}, context = {}) {
  const database = context.database || getDatabase();
  const link = assertActiveLink(database, salesLinkId);
  const cadenceType = clean(input.cadenceType) || "manual";
  if (!["manual", "days_30", "days_60", "days_90", "custom"].includes(cadenceType)) throw new Error("体检周期无效。");
  const assigneeId = clean(input.assigneeId) || link.ownerId || clean(context.userId);
  assertPerson(database, assigneeId);
  const intervalDays = cadenceType === "manual" ? null : cadenceType === "custom" ? Number(input.intervalDays) : cadenceDays[cadenceType];
  if (cadenceType === "custom" && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650)) throw new Error("自定义体检周期必须为1至3650天。");
  const enabled = cadenceType === "manual" ? 0 : input.enabled === false ? 0 : 1;
  const existing = database.prepare("SELECT * FROM connection_inspection_schedules WHERE salesLinkId=?").get(link.id);
  const timestamp = now();
  const lastInspectionAt = existing?.lastInspectionAt || database.prepare(`SELECT completedAt FROM connection_inspections
    WHERE salesLinkId=? AND status='completed' ORDER BY completedAt DESC LIMIT 1`).get(link.id)?.completedAt || null;
  const baseDate = lastInspectionAt?.slice(0, 10) || dateOnly();
  const nextInspectionAt = enabled ? addDays(baseDate, intervalDays) : null;
  const scheduleId = existing?.id || uid("connection-inspection-schedule");
  database.prepare(`INSERT INTO connection_inspection_schedules
    (id,salesLinkId,assigneeId,cadenceType,intervalDays,enabled,lastInspectionAt,nextInspectionAt,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(salesLinkId) DO UPDATE SET
      assigneeId=excluded.assigneeId,cadenceType=excluded.cadenceType,intervalDays=excluded.intervalDays,
      enabled=excluded.enabled,lastInspectionAt=excluded.lastInspectionAt,nextInspectionAt=excluded.nextInspectionAt,updatedAt=excluded.updatedAt`)
    .run(scheduleId, link.id, assigneeId, cadenceType, intervalDays, enabled, lastInspectionAt, nextInspectionAt,
      clean(context.userId) || assigneeId, existing?.createdAt || timestamp, timestamp);
  return database.prepare(`SELECT s.*,p.name assigneeName FROM connection_inspection_schedules s JOIN persons p ON p.id=s.assigneeId WHERE s.id=?`).get(scheduleId);
}

export function runDueConnectionInspectionSchedules(context = {}) {
  const database = context.database || getDatabase();
  const referenceDate = clean(context.referenceDate) || dateOnly();
  const schedules = database.prepare(`SELECT * FROM connection_inspection_schedules
    WHERE enabled=1 AND nextInspectionAt IS NOT NULL AND nextInspectionAt<=? ORDER BY nextInspectionAt,id`).all(referenceDate);
  const results = [];
  for (const schedule of schedules) {
    try {
      const result = database.transaction(() => {
        const dueDate = schedule.nextInspectionAt;
        const existing = database.prepare("SELECT taskId FROM connection_inspection_schedule_tasks WHERE scheduleId=? AND dueDate=?").get(schedule.id, dueDate);
        if (existing) return { scheduleId: schedule.id, dueDate, taskId: existing.taskId, created: false };
        const link = assertActiveLink(database, schedule.salesLinkId);
        const shop = link.shopDisplayName || link.shopName || "未命名店铺";
        const product = link.displayName || link.title || link.id;
        const task = createFormalTask(database, {
          name: `链接体检｜${link.platform} · ${shop}｜${product}`,
          description: "请进入对应Link详情完成本期链接体检。",
          assigneeId: schedule.assigneeId,
          initiatorId: schedule.createdBy,
          dueDate,
        });
        database.prepare(`INSERT INTO connection_inspection_schedule_tasks(id,scheduleId,dueDate,taskId,createdAt)
          VALUES (?,?,?,?,?)`).run(uid("connection-inspection-schedule-task"), schedule.id, dueDate, task.id, now());
        database.prepare(`INSERT INTO notifications(id,userId,taskId,processInstanceId,type,title,message,status,severity,dueDate,readAt,createdAt,updatedAt)
          VALUES (?,?,?,NULL,'task_assigned',?,?,'unread','normal',?,NULL,?,?)`)
          .run(uid("notification"), schedule.assigneeId, task.id, task.name, "定期链接体检已到期，请进入任务完成体检。", dueDate, now(), now());
        database.prepare("UPDATE connection_inspection_schedules SET nextInspectionAt=?,updatedAt=? WHERE id=?")
          .run(addDays(dueDate, schedule.intervalDays), now(), schedule.id);
        return { scheduleId: schedule.id, dueDate, taskId: task.id, created: true };
      })();
      results.push(result);
    } catch (error) {
      results.push({ scheduleId: schedule.id, dueDate: schedule.nextInspectionAt, created: false, error: error.message });
    }
  }
  return results;
}

export function readConnectionInspectionTaskContext(taskId, context = {}) {
  const database = context.database || getDatabase();
  const schedule = database.prepare(`SELECT st.taskId,st.dueDate,st.inspectionId,s.id inspectionScheduleId,s.salesLinkId
    FROM connection_inspection_schedule_tasks st JOIN connection_inspection_schedules s ON s.id=st.scheduleId WHERE st.taskId=?`).get(clean(taskId));
  if (schedule) return { type: "inspection_schedule", ...schedule };
  const action = database.prepare(`SELECT at.taskId,a.id actionId,a.connectionProfileId salesLinkId
    FROM connection_action_tasks at JOIN connection_actions a ON a.id=at.actionId WHERE at.taskId=?`).get(clean(taskId));
  return action ? { type: "connection_action", ...action } : null;
}
