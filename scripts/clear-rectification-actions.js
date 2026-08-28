import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = path.resolve(process.argv[2] || path.join(projectRoot, "data", "workstation.db"));
const confirmed = process.argv.includes("--confirm-delete-all-rectification-actions");

if (!confirmed) {
  throw new Error("清理操作已取消：缺少 --confirm-delete-all-rectification-actions 确认参数。");
}

const db = new Database(databasePath);
db.pragma("foreign_keys = ON");

function parseIdList(value) {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function hasTable(tableName) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) !== undefined;
}

try {
  db.exec(`
    CREATE TEMP TABLE target_rectification_processes (id TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO target_rectification_processes (id)
    SELECT id
    FROM process_instances
    WHERE taskTemplateId = 'task-template-rectification-work';
    INSERT OR IGNORE INTO target_rectification_processes (id)
    SELECT processInstanceId
    FROM work_plans
    WHERE workType = 'rectification' AND processInstanceId IS NOT NULL;

    CREATE TEMP TABLE target_rectification_work_plans (id TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO target_rectification_work_plans (id)
    SELECT id
    FROM work_plans
    WHERE workType = 'rectification'
       OR processInstanceId IN (SELECT id FROM target_rectification_processes);

    CREATE TEMP TABLE target_rectification_tasks (id TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO target_rectification_tasks (id)
    SELECT id
    FROM tasks
    WHERE processInstanceId IN (SELECT id FROM target_rectification_processes);

    CREATE TEMP TABLE target_rectification_waves (id TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO target_rectification_waves (id)
    SELECT DISTINCT waveId
    FROM task_wave_items
    WHERE taskId IN (SELECT id FROM target_rectification_tasks)
       OR processInstanceId IN (SELECT id FROM target_rectification_processes);
  `);

  const before = {
    workPlans: db.prepare("SELECT COUNT(*) AS count FROM target_rectification_work_plans").get().count,
    processInstances: db.prepare("SELECT COUNT(*) AS count FROM target_rectification_processes").get().count,
    tasks: db.prepare("SELECT COUNT(*) AS count FROM target_rectification_tasks").get().count,
    notifications: db.prepare(`
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE taskId IN (SELECT id FROM target_rectification_tasks)
         OR processInstanceId IN (SELECT id FROM target_rectification_processes)
    `).get().count,
  };

  const targetTaskIds = new Set(db.prepare("SELECT id FROM target_rectification_tasks").all().map((row) => row.id));
  const targetProcessIds = new Set(db.prepare("SELECT id FROM target_rectification_processes").all().map((row) => row.id));

  const clearRectificationData = db.transaction(() => {
    const groupUpdates = [];
    for (const group of db.prepare("SELECT id, taskIds, processInstanceIds FROM execution_groups").all()) {
      const taskIds = parseIdList(group.taskIds);
      const processInstanceIds = parseIdList(group.processInstanceIds);
      const remainingTaskIds = taskIds.filter((id) => !targetTaskIds.has(id));
      const remainingProcessIds = processInstanceIds.filter((id) => !targetProcessIds.has(id));
      if (remainingTaskIds.length !== taskIds.length || remainingProcessIds.length !== processInstanceIds.length) {
        groupUpdates.push({
          id: group.id,
          taskIds: JSON.stringify(remainingTaskIds),
          processInstanceIds: JSON.stringify(remainingProcessIds),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    const updateGroup = db.prepare(`
      UPDATE execution_groups
      SET taskIds = @taskIds, processInstanceIds = @processInstanceIds, updatedAt = @updatedAt
      WHERE id = @id
    `);
    for (const group of groupUpdates) updateGroup.run(group);

    if (hasTable("connection_improvements")) {
      db.exec(`
        DELETE FROM connection_improvements
        WHERE actionId IN (SELECT id FROM target_rectification_processes);
      `);
    }

    db.exec(`
      DELETE FROM notifications
      WHERE taskId IN (SELECT id FROM target_rectification_tasks)
         OR processInstanceId IN (SELECT id FROM target_rectification_processes);

      DELETE FROM data_sync_exceptions
      WHERE taskId IN (SELECT id FROM target_rectification_tasks);
      DELETE FROM data_sync_batches
      WHERE taskId IN (SELECT id FROM target_rectification_tasks);

      DELETE FROM task_wave_items
      WHERE taskId IN (SELECT id FROM target_rectification_tasks)
         OR processInstanceId IN (SELECT id FROM target_rectification_processes);

      DELETE FROM action_products
      WHERE actionId IN (SELECT id FROM target_rectification_processes);
      DELETE FROM product_strategy_action_links
      WHERE actionId IN (SELECT id FROM target_rectification_processes);

      UPDATE product_insights
      SET relatedActionId = NULL
      WHERE relatedActionId IN (SELECT id FROM target_rectification_processes);
      UPDATE product_insights
      SET relatedImprovementId = NULL
      WHERE relatedImprovementId IN (
        SELECT id FROM product_improvements
        WHERE actionId IN (SELECT id FROM target_rectification_processes)
      );
      DELETE FROM product_improvements
      WHERE actionId IN (SELECT id FROM target_rectification_processes);

      UPDATE content_schedules
      SET taskId = CASE WHEN taskId IN (SELECT id FROM target_rectification_tasks) THEN NULL ELSE taskId END,
          processInstanceId = CASE WHEN processInstanceId IN (SELECT id FROM target_rectification_processes) THEN NULL ELSE processInstanceId END,
          workPlanId = CASE WHEN workPlanId IN (SELECT id FROM target_rectification_work_plans) THEN NULL ELSE workPlanId END
      WHERE taskId IN (SELECT id FROM target_rectification_tasks)
         OR processInstanceId IN (SELECT id FROM target_rectification_processes)
         OR workPlanId IN (SELECT id FROM target_rectification_work_plans);

      DELETE FROM tasks
      WHERE id IN (SELECT id FROM target_rectification_tasks);
      DELETE FROM work_plans
      WHERE id IN (SELECT id FROM target_rectification_work_plans);
      DELETE FROM process_instances
      WHERE id IN (SELECT id FROM target_rectification_processes);

      DELETE FROM task_waves
      WHERE id IN (SELECT id FROM target_rectification_waves)
        AND NOT EXISTS (SELECT 1 FROM task_wave_items WHERE task_wave_items.waveId = task_waves.id);
    `);

    const after = {
      workPlans: db.prepare("SELECT COUNT(*) AS count FROM work_plans WHERE workType = 'rectification'").get().count,
      processInstances: db.prepare("SELECT COUNT(*) AS count FROM process_instances WHERE taskTemplateId = 'task-template-rectification-work'").get().count,
      targetTasksStillPresent: db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id IN (SELECT id FROM target_rectification_tasks)").get().count,
      targetWorkPlansStillPresent: db.prepare("SELECT COUNT(*) AS count FROM work_plans WHERE id IN (SELECT id FROM target_rectification_work_plans)").get().count,
      targetProcessesStillPresent: db.prepare("SELECT COUNT(*) AS count FROM process_instances WHERE id IN (SELECT id FROM target_rectification_processes)").get().count,
    };
    const foreignKeyErrors = db.pragma("foreign_key_check");

    if (Object.values(after).some((count) => count !== 0) || foreignKeyErrors.length > 0) {
      throw new Error(`改善行动清理后校验失败：${JSON.stringify({ after, foreignKeyErrors })}`);
    }

    return { after, foreignKeyErrors };
  });

  const { after, foreignKeyErrors } = clearRectificationData();

  db.pragma("wal_checkpoint(TRUNCATE)");
  console.log(JSON.stringify({ databasePath, deleted: before, remaining: after, foreignKeyErrors: foreignKeyErrors.length }, null, 2));
} finally {
  db.close();
}
