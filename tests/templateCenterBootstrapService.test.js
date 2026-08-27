import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { readTemplateCenterUsageSummary } from "../server/templateCenterBootstrapService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("模板中心使用次数由聚合查询生成且不会重复计算同一记录", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE task_templates(id TEXT PRIMARY KEY,defaultProcessTemplateId TEXT);
    CREATE TABLE process_instances(id TEXT PRIMARY KEY,taskTemplateId TEXT,templateId TEXT,startedAt TEXT,createdAt TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,taskTemplateId TEXT,processNodeId TEXT,completedAt TEXT,updatedAt TEXT,createdAt TEXT);
    CREATE TABLE methodologies(id TEXT PRIMARY KEY,processNodeId TEXT,taskTemplateId TEXT);
    INSERT INTO task_templates VALUES('action-1','process-1');
    INSERT INTO process_instances VALUES('instance-1','action-1','process-1','2026-08-20T10:00:00Z','2026-08-20T09:00:00Z');
    INSERT INTO process_instances VALUES('instance-2',NULL,'process-1',NULL,'2026-08-21T09:00:00Z');
    INSERT INTO tasks VALUES('task-1','action-1','node-1','2026-08-22T09:00:00Z','2026-08-22T08:00:00Z','2026-08-20T09:00:00Z');
    INSERT INTO tasks VALUES('task-2','action-1','node-1',NULL,'2026-08-23T09:00:00Z','2026-08-21T09:00:00Z');
    INSERT INTO methodologies VALUES('method-1','node-1','action-1');
  `);
  const summary = readTemplateCenterUsageSummary({ database });
  assert.deepEqual(summary.actionByTaskTemplateId["action-1"], { useCount: 2, lastUsedAt: "2026-08-21T09:00:00Z" });
  assert.deepEqual(summary.formByStandardWorkId["action-1"], { useCount: 2, lastUsedAt: "2026-08-23T09:00:00Z" });
  assert.deepEqual(summary.taskByTaskTemplateId["action-1"], { useCount: 2, lastUsedAt: "2026-08-23T09:00:00Z" });
  assert.deepEqual(summary.taskByProcessNodeId["node-1"], { useCount: 2, lastUsedAt: "2026-08-23T09:00:00Z" });
  assert.deepEqual(summary.methodologyById["method-1"], { useCount: 2, lastUsedAt: "2026-08-23T09:00:00Z" });
  database.close();
});

test("模板中心页面不再读取任务和行动实例全集", () => {
  const source = fs.readFileSync(path.join(root, "src/templateCenterPage.js"), "utf8");
  assert.doesNotMatch(source, /state\.(?:tasks|processInstances)/u);
  assert.match(source, /templateCenterUsageSummary/u);
});
