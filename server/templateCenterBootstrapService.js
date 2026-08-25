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
    actionByTaskTemplateId: mappedUsage(database, `SELECT t.id,COUNT(DISTINCT i.id) useCount,MAX(COALESCE(i.startedAt,i.createdAt)) lastUsedAt
      FROM task_templates t LEFT JOIN process_instances i
        ON i.taskTemplateId=t.id OR (t.defaultProcessTemplateId IS NOT NULL AND i.templateId=t.defaultProcessTemplateId)
      GROUP BY t.id`),
    formByStandardWorkId: mappedUsage(database, `SELECT t.id,COUNT(DISTINCT x.id) useCount,MAX(COALESCE(x.completedAt,x.updatedAt,x.createdAt)) lastUsedAt
      FROM task_templates t LEFT JOIN tasks x ON x.taskTemplateId=t.id
      GROUP BY t.id`),
    taskByTaskTemplateId: groupUsage(database, "tasks", "taskTemplateId", "COALESCE(completedAt,updatedAt,createdAt)"),
    taskByProcessNodeId: groupUsage(database, "tasks", "processNodeId", "COALESCE(completedAt,updatedAt,createdAt)"),
    methodologyById: mappedUsage(database, `SELECT m.id,COUNT(DISTINCT x.id) useCount,MAX(COALESCE(x.completedAt,x.updatedAt,x.createdAt)) lastUsedAt
      FROM methodologies m LEFT JOIN tasks x
        ON (m.processNodeId IS NOT NULL AND x.processNodeId=m.processNodeId)
        OR (m.taskTemplateId IS NOT NULL AND x.taskTemplateId=m.taskTemplateId)
      GROUP BY m.id`),
  };
}
