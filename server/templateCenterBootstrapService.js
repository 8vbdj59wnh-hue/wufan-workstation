import { getDatabase } from "./db.js";

function groupUsage(database, table, keyColumn, dateExpression) {
  return Object.fromEntries(database.prepare(`SELECT ${keyColumn} id,COUNT(*) useCount,MAX(${dateExpression}) lastUsedAt
    FROM ${table}
    WHERE ${keyColumn} IS NOT NULL AND trim(${keyColumn})<>''
    GROUP BY ${keyColumn}`).all().map((row) => [row.id, {
    useCount: Number(row.useCount || 0),
    lastUsedAt: row.lastUsedAt || "",
  }]));
}

function mappedUsage(database, sql) {
  return Object.fromEntries(database.prepare(sql).all().map((row) => [row.id, {
    useCount: Number(row.useCount || 0),
    lastUsedAt: row.lastUsedAt || "",
  }]));
}

export function readTemplateCenterUsageSummary(options = {}) {
  const database = options.database || getDatabase();
  return {
    actionByTaskTemplateId: mappedUsage(database, `WITH usage_links AS (
        SELECT taskTemplateId id,id instanceId,COALESCE(startedAt,createdAt) usedAt
        FROM process_instances WHERE taskTemplateId IS NOT NULL AND trim(taskTemplateId)<>''
        UNION
        SELECT t.id,i.id,COALESCE(i.startedAt,i.createdAt)
        FROM task_templates t JOIN process_instances i ON i.templateId=t.defaultProcessTemplateId
        WHERE t.defaultProcessTemplateId IS NOT NULL AND trim(t.defaultProcessTemplateId)<>''
      )
      SELECT t.id,COUNT(DISTINCT u.instanceId) useCount,MAX(u.usedAt) lastUsedAt
      FROM task_templates t LEFT JOIN usage_links u ON u.id=t.id GROUP BY t.id`),
    formByStandardWorkId: mappedUsage(database, `SELECT t.id,COUNT(DISTINCT x.id) useCount,MAX(COALESCE(x.completedAt,x.updatedAt,x.createdAt)) lastUsedAt
      FROM task_templates t LEFT JOIN tasks x ON x.taskTemplateId=t.id
      GROUP BY t.id`),
    taskByTaskTemplateId: groupUsage(database, "tasks", "taskTemplateId", "COALESCE(completedAt,updatedAt,createdAt)"),
    taskByProcessNodeId: groupUsage(database, "tasks", "processNodeId", "COALESCE(completedAt,updatedAt,createdAt)"),
    rectificationByTaskTemplateId: mappedUsage(database, `SELECT t.id,COUNT(w.id) useCount,MAX(COALESCE(w.launchedAt,w.createdAt)) lastUsedAt
      FROM task_templates t LEFT JOIN work_plans w ON w.taskTemplateId=t.id AND w.workType='rectification' GROUP BY t.id`),
    methodologyById: mappedUsage(database, `WITH usage_links AS (
        SELECT m.id,x.id taskId,COALESCE(x.completedAt,x.updatedAt,x.createdAt) usedAt
        FROM methodologies m JOIN tasks x ON x.processNodeId=m.processNodeId
        WHERE m.processNodeId IS NOT NULL AND trim(m.processNodeId)<>''
        UNION
        SELECT m.id,x.id,COALESCE(x.completedAt,x.updatedAt,x.createdAt)
        FROM methodologies m JOIN tasks x ON x.taskTemplateId=m.taskTemplateId
        WHERE m.taskTemplateId IS NOT NULL AND trim(m.taskTemplateId)<>''
      )
      SELECT m.id,COUNT(DISTINCT u.taskId) useCount,MAX(u.usedAt) lastUsedAt
      FROM methodologies m LEFT JOIN usage_links u ON u.id=m.id GROUP BY m.id`),
  };
}
