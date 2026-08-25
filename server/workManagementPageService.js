import { getDatabase, readResourceItems } from "./db.js";

const parseJson = (value, fallback) => {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
};

function compactTask(row) {
  return {
    ...row,
    customFields: parseJson(row.customFields, {}),
    submitFormData: parseJson(row.submitFormData, {}),
    submitFiles: [],
    submitLinks: [],
    resultAttachments: [],
  };
}

function compactInstance(row) {
  return { ...row, customFields: parseJson(row.customFields, {}) };
}

function compactWorkPlan(row) {
  return { ...row, customFields: parseJson(row.customFields, {}) };
}

const taskColumns = `id,businessCode,taskType,name,goalId,taskTemplateId,templateId,source,processInstanceId,processNodeId,
  categoryId,departmentId,ownerId,executorId,initiatorId,startDate,readyAt,dueDate,accepterId,status,submittedAt,submittedBy,
  reviewTargetTaskId,reviewStatus,reviewerId,createdAt,updatedAt,completedAt,customFields,submitFormData`;
const instanceColumns = `id,businessCode,templateId,taskTemplateId,templateVersion,name,goalId,initiatorId,status,startedAt,completedAt,
  stoppedAt,canceledAt,dueDate,displayTitle,coverImageUrl,createdAt,updatedAt,customFields`;
const planColumns = `id,goalId,departmentId,taskTemplateId,title,workType,status,plannedWeek,dueDate,processInstanceId,createdAt,updatedAt,
  launchedAt,canceledAt,customFields,coverImageUrl`;
const qualifiedPlanColumns = planColumns.split(",").map((column) => `wp.${column.trim()}`).join(",");

function rowsForIds(database, table, columns, ids, mapper) {
  if (ids.length === 0) return [];
  return database.prepare(`SELECT ${columns} FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids).map(mapper);
}

function taskRowsForProcessIds(database, processIds) {
  if (processIds.length === 0) return [];
  return database.prepare(`SELECT ${taskColumns} FROM tasks WHERE processInstanceId IN (${processIds.map(() => "?").join(",")})`)
    .all(...processIds).map(compactTask);
}

export function readScheduleBoardPage(options = {}) {
  const database = options.database || getDatabase();
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(20, Number.parseInt(options.pageSize, 10) || 50));
  const where = [];
  const params = { pageSize, offset: (page - 1) * pageSize };
  if (options.actorId && options.scope !== "all") {
    where.push(`(wp.departmentId=@departmentId OR pi.initiatorId=@actorId OR EXISTS (
      SELECT 1 FROM tasks st WHERE st.processInstanceId=wp.processInstanceId AND @actorId IN (st.ownerId,st.executorId,st.accepterId,st.reviewerId,st.initiatorId)
    ))`);
    params.actorId = options.actorId;
    params.departmentId = options.departmentId || "";
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM work_plans wp LEFT JOIN process_instances pi ON pi.id=wp.processInstanceId`;
  const total = Number(database.prepare(`SELECT COUNT(*) count ${from} ${whereSql}`).get(params)?.count || 0);
  const plans = database.prepare(`SELECT ${qualifiedPlanColumns} ${from} ${whereSql}
    ORDER BY CASE WHEN wp.dueDate IS NULL OR wp.dueDate='' THEN 1 ELSE 0 END,wp.dueDate,wp.createdAt DESC LIMIT @pageSize OFFSET @offset`)
    .all(params).map(compactWorkPlan);
  const processIds = [...new Set(plans.map((item) => item.processInstanceId).filter(Boolean))];
  const processInstances = rowsForIds(database, "process_instances", instanceColumns, processIds, compactInstance);
  const tasks = taskRowsForProcessIds(database, processIds);
  const actionProducts = processIds.length === 0 ? [] : database.prepare(`SELECT * FROM action_products WHERE actionId IN (${processIds.map(() => "?").join(",")})`).all(...processIds);
  const contentSchedules = processIds.length === 0 ? [] : database.prepare(`SELECT * FROM content_schedules WHERE processInstanceId IN (${processIds.map(() => "?").join(",")})`).all(...processIds);
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), data: { tasks, processInstances, workPlans: plans, actionProducts, contentSchedules } };
}

function periodSummary(database, days, offsetDays = 0) {
  const range = database.prepare(`SELECT date('now','localtime',@endOffset) endDate,date('now','localtime',@startOffset) startDate`).get({
    endOffset: `-${offsetDays} days`, startOffset: `-${offsetDays + days - 1} days`,
  });
  const taskDate = "date(COALESCE(completedAt,updatedAt,createdAt,dueDate),'+8 hours')";
  const workDate = "date(COALESCE(launchedAt,createdAt,updatedAt,dueDate),'+8 hours')";
  const task = database.prepare(`SELECT
      SUM(status IN ('done','completed')) completedTaskCount,
      SUM(status IN ('done','completed') AND completedAt IS NOT NULL AND dueDate IS NOT NULL) completedWithDue,
      SUM(status IN ('done','completed') AND completedAt IS NOT NULL AND dueDate IS NOT NULL AND datetime(completedAt)<=datetime(dueDate)) completedOnTime,
      SUM(dueDate IS NOT NULL AND date(dueDate,'+8 hours')<@endDate AND status NOT IN ('done','completed','canceled','cancelled')) overdueCount,
      SUM(COALESCE(json_array_length(json_extract(customFields,'$.returnRecords')),0)) returnCount,
      SUM(COALESCE(json_array_length(json_extract(customFields,'$.reviewRejectRecords')),0)) rejectCount
    FROM tasks WHERE ${taskDate} BETWEEN @startDate AND @endDate`).get(range);
  const work = database.prepare(`SELECT
      SUM(workType<>'rectification') normalWorkCount,SUM(workType='rectification') rectificationCount,
      SUM(workType='rectification' AND (status='done' OR EXISTS (SELECT 1 FROM process_instances pi WHERE pi.id=work_plans.processInstanceId AND pi.status IN ('done','completed')))) rectificationDoneCount,
      SUM(workType='rectification' AND status NOT IN ('done','canceled','cancelled') AND NOT EXISTS (SELECT 1 FROM process_instances pi WHERE pi.id=work_plans.processInstanceId AND pi.status IN ('done','completed','stopped','canceled','cancelled'))) rectificationActiveCount
    FROM work_plans WHERE ${workDate} BETWEEN @startDate AND @endDate`).get(range);
  const completedWithDue = Number(task.completedWithDue || 0);
  const normal = Number(work.normalWorkCount || 0);
  return {
    normalWorkCount: normal,
    rectificationCount: Number(work.rectificationCount || 0),
    rectificationRate: normal === 0 ? 0 : (Number(work.rectificationCount || 0) / normal) * 100,
    completedTaskCount: Number(task.completedTaskCount || 0),
    onTimeRate: completedWithDue === 0 ? null : (Number(task.completedOnTime || 0) / completedWithDue) * 100,
    overdueCount: Number(task.overdueCount || 0), returnCount: Number(task.returnCount || 0), rejectCount: Number(task.rejectCount || 0),
    rectificationActiveCount: Number(work.rectificationActiveCount || 0), rectificationDoneCount: Number(work.rectificationDoneCount || 0),
  };
}

export function readWorkResultsInitial(options = {}) {
  const database = options.database || getDatabase();
  const days = [7, 30, 90].includes(Number(options.days)) ? Number(options.days) : 30;
  const rectificationPlans = database.prepare(`SELECT ${planColumns} FROM work_plans WHERE workType='rectification' ORDER BY createdAt DESC LIMIT 100`).all().map(compactWorkPlan);
  const processIds = [...new Set(rectificationPlans.map((item) => item.processInstanceId).filter(Boolean))];
  const todayProcessIds = database.prepare("SELECT id FROM process_instances WHERE date(COALESCE(updatedAt,createdAt),'+8 hours')=date('now','localtime') ORDER BY createdAt DESC LIMIT 100").all().map((row) => row.id);
  const allProcessIds = [...new Set([...processIds, ...todayProcessIds])];
  const processInstances = rowsForIds(database, "process_instances", instanceColumns, allProcessIds, compactInstance);
  const relatedTasks = taskRowsForProcessIds(database, processIds);
  const todayTasks = database.prepare(`SELECT ${taskColumns} FROM tasks WHERE date(COALESCE(updatedAt,completedAt,createdAt),'+8 hours')=date('now','localtime') ORDER BY updatedAt DESC LIMIT 200`).all().map(compactTask);
  const taskById = new Map([...relatedTasks, ...todayTasks].map((item) => [item.id, item]));
  const processNodeIds = [...new Set([...taskById.values()].map((item) => item.processNodeId).filter(Boolean))];
  return {
    data: { tasks: [...taskById.values()], processInstances, workPlans: rectificationPlans, processTemplateNodes: readResourceItems("processTemplateNodes", processNodeIds) },
    dashboard: { days, current: periodSummary(database, days), previous: periodSummary(database, days, days) },
  };
}
