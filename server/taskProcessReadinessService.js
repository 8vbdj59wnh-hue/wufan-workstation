import {
  generateEligibleTaskWaves,
  getDatabase,
  readRouteResourceItem,
  syncProcessInstanceCanceledFromTasks,
  updateTaskFromWorkflow as updateTaskFromWorkflowBase,
} from "./db.js";

function readOrderedProcessTasks(database, processInstanceId) {
  return database.prepare(`
    SELECT t.*, COALESCE(n.stepOrder, n.stageOrder, n.nodeOrder, 9999) AS processOrder
    FROM tasks t
    LEFT JOIN process_template_nodes n ON n.id = t.processNodeId
    WHERE t.processInstanceId = @processInstanceId
      AND t.status <> 'canceled'
    ORDER BY processOrder, t.createdAt, t.rowid
  `).all({ processInstanceId });
}

function findReadyWaitingTask(instance, orderedTasks) {
  if (instance === undefined || instance.status !== "running") return null;
  let nextTask = orderedTasks.find((task) => task.status !== "done");
  if (nextTask?.status === "pending_acceptance") {
    const targetIndex = orderedTasks.findIndex((task) => task.id === nextTask.id);
    const reviewTask = orderedTasks[targetIndex + 1];
    if (
      reviewTask?.taskType === "review" &&
      reviewTask.reviewTargetTaskId === nextTask.id &&
      reviewTask.status !== "done"
    ) {
      nextTask = reviewTask;
    }
  }
  if (nextTask?.status !== "waiting") return null;
  const nextIndex = orderedTasks.findIndex((task) => task.id === nextTask.id);
  if (nextIndex <= 0) return null;
  const previousTasks = orderedTasks.slice(0, nextIndex);
  const previousTasksDone = previousTasks.every((task) => {
    if (
      nextTask.taskType === "review" &&
      task.id === nextTask.reviewTargetTaskId &&
      task.status === "pending_acceptance"
    ) {
      return true;
    }
    return task.status === "done";
  });
  return previousTasksDone ? { task: nextTask, previousTasks } : null;
}

function advanceProcessTaskReadinessInTransaction(database, processInstanceId, referenceAt = new Date().toISOString()) {
  const instance = database.prepare("SELECT * FROM process_instances WHERE id = @id LIMIT 1").get({ id: processInstanceId });
  if (instance === undefined || instance.status !== "running") return null;
  const orderedTasks = readOrderedProcessTasks(database, processInstanceId);
  const ready = findReadyWaitingTask(instance, orderedTasks);
  if (ready !== null) {
    const updated = database.prepare(`
      UPDATE tasks
      SET status = 'todo',
          readyAt = COALESCE(readyAt, @readyAt),
          updatedAt = @readyAt
      WHERE id = @taskId AND status = 'waiting'
    `).run({ taskId: ready.task.id, readyAt: referenceAt });
    return updated.changes === 1 ? ready.task.id : null;
  }
  if (orderedTasks.length > 0 && orderedTasks.every((task) => task.status === "done")) {
    database.prepare(`
      UPDATE process_instances
      SET status = 'done', completedAt = COALESCE(completedAt, @completedAt), updatedAt = @completedAt
      WHERE id = @id AND status = 'running'
    `).run({ id: processInstanceId, completedAt: referenceAt });
    database.prepare(`
      UPDATE work_plans
      SET status = 'done', updatedAt = @completedAt
      WHERE processInstanceId = @processInstanceId AND status <> 'canceled'
    `).run({ processInstanceId, completedAt: referenceAt });
  }
  return null;
}

function readProcessTasks(processInstanceId) {
  return getDatabase()
    .prepare("SELECT id FROM tasks WHERE processInstanceId = @processInstanceId ORDER BY createdAt, rowid")
    .all({ processInstanceId })
    .map((row) => readRouteResourceItem("tasks", row.id));
}

export function updateTaskFromWorkflow(taskId, action, patch = {}) {
  const database = getDatabase();
  const task = database.transaction(() => {
    const updatedTask = updateTaskFromWorkflowBase(taskId, action, patch);
    if (["done", "pending_acceptance"].includes(updatedTask.status) && updatedTask.processInstanceId) {
      advanceProcessTaskReadinessInTransaction(
        database,
        updatedTask.processInstanceId,
        updatedTask.completedAt ?? updatedTask.updatedAt ?? new Date().toISOString(),
      );
    }
    if (["canceled", "cancelled"].includes(updatedTask.status) && updatedTask.processInstanceId) {
      syncProcessInstanceCanceledFromTasks(updatedTask.processInstanceId, {
        updatedAt: updatedTask.updatedAt,
      });
    }
    return updatedTask;
  }).immediate();
  generateEligibleTaskWaves();
  return {
    task,
    processTasks: task.processInstanceId ? readProcessTasks(task.processInstanceId) : [],
    processInstance: task.processInstanceId ? readRouteResourceItem("process-instances", task.processInstanceId) : null,
  };
}

export function readStuckProcessTaskReadinessCandidates() {
  const database = getDatabase();
  const instances = database.prepare("SELECT * FROM process_instances WHERE status = 'running' ORDER BY createdAt, id").all();
  const candidates = [];
  for (const instance of instances) {
    const ready = findReadyWaitingTask(instance, readOrderedProcessTasks(database, instance.id));
    if (ready === null) continue;
    const node = database.prepare("SELECT waveEnabled FROM process_template_nodes WHERE id = @id LIMIT 1").get({ id: ready.task.processNodeId });
    candidates.push({
      taskId: ready.task.id,
      taskName: ready.task.name,
      processInstanceId: instance.id,
      processInstanceName: instance.name,
      previousTaskIds: ready.previousTasks.map((task) => task.id),
      previousCompletedAt: ready.previousTasks.at(-1)?.completedAt ?? null,
      waveEnabled: Number(node?.waveEnabled ?? 0) === 1,
    });
  }
  return candidates;
}

export function repairStuckProcessTaskReadiness() {
  const database = getDatabase();
  const repaired = database.transaction(() => {
    const candidates = readStuckProcessTaskReadinessCandidates();
    const repairedTaskIds = candidates
      .map((candidate) => advanceProcessTaskReadinessInTransaction(database, candidate.processInstanceId))
      .filter(Boolean);
    return { candidateCount: candidates.length, repairedCount: repairedTaskIds.length, repairedTaskIds };
  }).immediate();
  return { ...repaired, waveGeneration: generateEligibleTaskWaves() };
}
