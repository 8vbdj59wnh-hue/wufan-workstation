import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { readScheduleBoardPage } from "../server/workManagementPageService.js";

function createDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE work_plans (
      id TEXT PRIMARY KEY, goalId TEXT, departmentId TEXT, taskTemplateId TEXT, title TEXT,
      workType TEXT, status TEXT, plannedWeek TEXT, dueDate TEXT, processInstanceId TEXT,
      createdAt TEXT, updatedAt TEXT, launchedAt TEXT, canceledAt TEXT, customFields TEXT, coverImageUrl TEXT
    );
    CREATE TABLE process_instances (
      id TEXT PRIMARY KEY, businessCode TEXT, templateId TEXT, taskTemplateId TEXT, templateVersion TEXT,
      name TEXT, goalId TEXT, initiatorId TEXT, status TEXT, startedAt TEXT, completedAt TEXT,
      stoppedAt TEXT, canceledAt TEXT, dueDate TEXT, displayTitle TEXT, coverImageUrl TEXT,
      createdAt TEXT, updatedAt TEXT, customFields TEXT
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, businessCode TEXT, taskType TEXT, name TEXT, goalId TEXT, taskTemplateId TEXT,
      templateId TEXT, source TEXT, processInstanceId TEXT, processNodeId TEXT, categoryId TEXT,
      departmentId TEXT, ownerId TEXT, executorId TEXT, initiatorId TEXT, startDate TEXT, readyAt TEXT,
      dueDate TEXT, accepterId TEXT, status TEXT, submittedAt TEXT, submittedBy TEXT, reviewTargetTaskId TEXT,
      reviewStatus TEXT, reviewerId TEXT, createdAt TEXT, updatedAt TEXT, completedAt TEXT,
      customFields TEXT, submitFormData TEXT
    );
    CREATE TABLE action_products (id TEXT PRIMARY KEY, actionId TEXT);
    CREATE TABLE content_schedules (id TEXT PRIMARY KEY, processInstanceId TEXT);
  `);
  return database;
}

test("关键行动分页首屏始终携带全部未结束行动供时间格子渲染", () => {
  const database = createDatabase();
  const insertInstance = database.prepare(`INSERT INTO process_instances
    (id,name,status,dueDate,createdAt,updatedAt,customFields) VALUES (?,?,?,?,?,?,?)`);
  const insertPlan = database.prepare(`INSERT INTO work_plans
    (id,title,status,dueDate,processInstanceId,createdAt,updatedAt,customFields) VALUES (?,?,?,?,?,?,?,?)`);

  for (let index = 0; index < 25; index += 1) {
    const id = `done-${String(index).padStart(2, "0")}`;
    const dueDate = `2026-07-${String(index + 1).padStart(2, "0")}`;
    insertInstance.run(id, id, "done", dueDate, dueDate, dueDate, "{}");
    insertPlan.run(`plan-${id}`, id, "done", dueDate, id, dueDate, dueDate, "{}");
  }
  for (const [id, dueDate] of [["running-a", "2026-08-27"], ["running-b", "2026-08-28"]]) {
    insertInstance.run(id, id, "running", dueDate, dueDate, dueDate, "{}");
    insertPlan.run(`plan-${id}`, id, "running", dueDate, id, dueDate, dueDate, "{}");
  }

  const result = readScheduleBoardPage({ database, page: 1, pageSize: 20, scope: "all" });

  assert.equal(result.total, 27);
  assert.equal(result.totalPages, 2);
  assert.deepEqual(
    result.data.processInstances.filter((item) => item.status === "running").map((item) => item.id).sort(),
    ["running-a", "running-b"],
  );
  database.close();
});
