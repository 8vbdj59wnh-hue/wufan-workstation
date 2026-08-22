import assert from "node:assert/strict";
import test from "node:test";

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  readRouteResource,
} from "../server/db.js";
import {
  readStuckProcessTaskReadinessCandidates,
  repairStuckProcessTaskReadiness,
  updateTaskFromWorkflow,
} from "../server/taskProcessReadinessService.js";

function resetFixture() {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  database.exec(`
    DELETE FROM task_wave_items;
    DELETE FROM task_waves;
    DELETE FROM tasks;
    DELETE FROM work_plans;
    DELETE FROM process_instances;
    DELETE FROM process_template_nodes;
    DELETE FROM process_templates;
    DELETE FROM task_templates;
  `);
  database.prepare(`
    INSERT INTO task_templates (id, name, departmentId, ownerId, needAcceptance, status, createdAt, updatedAt)
    VALUES ('task-template', '行动标准', 'department', 'owner', 0, 'active', @now, @now)
  `).run({ now: "2026-08-22T00:00:00.000Z" });
  database.prepare(`
    INSERT INTO process_templates (id, name, ownerId, status, version, createdAt, updatedAt)
    VALUES ('process-template', '流程模板', 'owner', 'active', 1, @now, @now)
  `).run({ now: "2026-08-22T00:00:00.000Z" });
  for (const node of [
    { id: "node-1", name: "前置A", stepOrder: 1, waveEnabled: 0 },
    { id: "node-2", name: "前置B", stepOrder: 2, waveEnabled: 0 },
    { id: "node-3", name: "组合执行", stepOrder: 3, waveEnabled: 1 },
  ]) {
    database.prepare(`
      INSERT INTO process_template_nodes (
        id, templateId, stepType, stepOrder, stageName, stageOrder, nodeOrder, name,
        ownerRule, durationDays, defaultImportance, defaultUrgency, needAcceptance,
        accepterRule, status, waveEnabled, waveSize, waveUnlimited, createdAt, updatedAt
      ) VALUES (
        @id, 'process-template', 'execution', @stepOrder, '阶段', @stepOrder, @stepOrder, @name,
        'fixed', 1, 'medium', 'medium', 0, 'none', 'active', @waveEnabled, 2, 0, @now, @now
      )
    `).run({ ...node, now: "2026-08-22T00:00:00.000Z" });
  }
  return database;
}

function insertProcess(database, id, taskStatuses) {
  const now = "2026-08-22T00:00:00.000Z";
  database.prepare(`
    INSERT INTO process_instances (
      id, templateId, taskTemplateId, templateVersion, name, goalId, initiatorId,
      status, customFields, createdAt, updatedAt
    ) VALUES (@id, 'process-template', 'task-template', 1, @name, 'goal', 'owner', 'running', '{}', @now, @now)
  `).run({ id, name: `流程-${id}`, now });
  taskStatuses.forEach((status, index) => {
    const step = index + 1;
    database.prepare(`
      INSERT INTO tasks (
        id, taskType, name, goalId, taskTemplateId, source, processInstanceId, processNodeId,
        departmentId, ownerId, executorId, initiatorId, needAcceptance,
        status, resultAttachments, customFields, submitType, submitFields, submitFormData,
        submitFiles, submitLinks, createdAt, updatedAt, completedAt, dueDate
      ) VALUES (
        @taskId, 'execution', @name, 'goal', 'task-template', 'process', @processInstanceId, @nodeId,
        'department', 'owner', 'executor', 'owner', 0,
        @status, '[]', '{}', 'none', '[]', '{}', '[]', '[]', @createdAt, @createdAt, @completedAt, @dueDate
      )
    `).run({
      taskId: `${id}-task-${step}`,
      name: `任务${step}`,
      processInstanceId: id,
      nodeId: `node-${step}`,
      status,
      createdAt: `2026-08-22T00:0${step}:00.000Z`,
      completedAt: status === "done" ? `2026-08-22T00:0${step}:30.000Z` : null,
      dueDate: `2026-08-${22 + step}`,
    });
  });
}

test("单前置任务完成后，后继任务在同一服务端操作中进入 todo", () => {
  const database = resetFixture();
  insertProcess(database, "single", ["doing", "waiting"]);

  updateTaskFromWorkflow("single-task-1", "submit", {
    status: "done",
    completedAt: "2026-08-22T01:00:00.000Z",
    updatedAt: "2026-08-22T01:00:00.000Z",
  });

  const tasks = readRouteResource("tasks").filter((task) => task.processInstanceId === "single");
  assert.equal(tasks.find((task) => task.id === "single-task-1").status, "done");
  assert.equal(tasks.find((task) => task.id === "single-task-2").status, "todo");
});

test("多前置任务必须全部完成才释放后继任务", () => {
  const database = resetFixture();
  insertProcess(database, "multiple", ["done", "doing", "waiting"]);

  assert.equal(readStuckProcessTaskReadinessCandidates().length, 0);
  assert.equal(readRouteResource("tasks").find((task) => task.id === "multiple-task-3").status, "waiting");

  updateTaskFromWorkflow("multiple-task-2", "submit", {
    status: "done",
    completedAt: "2026-08-22T01:00:00.000Z",
    updatedAt: "2026-08-22T01:00:00.000Z",
  });
  assert.equal(readRouteResource("tasks").find((task) => task.id === "multiple-task-3").status, "todo");
});

test("历史卡住任务只修正满足条件的 waiting，并保持负责人、截止时间和已完成结果", () => {
  const database = resetFixture();
  insertProcess(database, "stuck", ["done", "done", "waiting"]);
  insertProcess(database, "blocked", ["done", "doing", "waiting"]);
  database.prepare("UPDATE tasks SET resultText = '已完成结果' WHERE id = 'stuck-task-2'").run();

  const preview = readStuckProcessTaskReadinessCandidates();
  assert.deepEqual(preview.map((item) => item.taskId), ["stuck-task-3"]);
  const repaired = repairStuckProcessTaskReadiness();
  assert.equal(repaired.candidateCount, 1);
  assert.equal(repaired.repairedCount, 1);

  const tasks = readRouteResource("tasks");
  const repairedTask = tasks.find((task) => task.id === "stuck-task-3");
  assert.equal(repairedTask.status, "todo");
  assert.equal(repairedTask.ownerId, "owner");
  assert.equal(repairedTask.dueDate, "2026-08-25");
  assert.equal(tasks.find((task) => task.id === "stuck-task-2").resultText, "已完成结果");
  assert.equal(tasks.find((task) => task.id === "blocked-task-3").status, "waiting");
  assert.equal(repairStuckProcessTaskReadiness().repairedCount, 0);
});

test("释放后的组合执行任务可以生成波次且重复推进幂等", () => {
  const database = resetFixture();
  insertProcess(database, "wave-a", ["done", "done", "waiting"]);
  insertProcess(database, "wave-b", ["done", "done", "waiting"]);

  const repaired = repairStuckProcessTaskReadiness();
  assert.equal(repaired.repairedCount, 2);
  const waves = database.prepare("SELECT * FROM task_waves WHERE status = 'waiting'").all();
  assert.equal(waves.length, 1);
  assert.equal(waves[0].taskCount, 2);
  const waveTasks = database.prepare("SELECT taskId FROM task_wave_items WHERE waveId = ? AND isActive = 1").all(waves[0].id);
  assert.deepEqual(new Set(waveTasks.map((item) => item.taskId)), new Set(["wave-a-task-3", "wave-b-task-3"]));
  assert.equal(repairStuckProcessTaskReadiness().repairedCount, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM task_waves WHERE status = 'waiting'").get().count, 1);
});

test("真实完成链会立即释放后继任务并生成波次", () => {
  const database = resetFixture();
  insertProcess(database, "live-a", ["done", "doing", "waiting"]);
  insertProcess(database, "live-b", ["done", "doing", "waiting"]);

  for (const processId of ["live-a", "live-b"]) {
    updateTaskFromWorkflow(`${processId}-task-2`, "submit", {
      status: "done",
      completedAt: "2026-08-22T02:00:00.000Z",
      updatedAt: "2026-08-22T02:00:00.000Z",
    });
  }

  const tasks = readRouteResource("tasks");
  assert.equal(tasks.find((task) => task.id === "live-a-task-3").status, "todo");
  assert.equal(tasks.find((task) => task.id === "live-b-task-3").status, "todo");
  const wave = database.prepare("SELECT * FROM task_waves WHERE status = 'waiting'").get();
  assert.equal(wave.taskCount, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM task_wave_items WHERE waveId = ? AND isActive = 1").get(wave.id).count, 2);
});

test.after(() => closeDatabase());
