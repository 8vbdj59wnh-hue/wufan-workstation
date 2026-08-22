import test from "node:test";
import assert from "node:assert/strict";
import {
  isImprovementActionTask,
  shouldShowTaskInTaskCenter,
} from "../shared/taskCenterVisibility.js";

const directTask = { id: "task-direct", name: "普通任务", source: "direct", processInstanceId: null };
const actionTask = { id: "task-action", name: "普通关键行动任务", source: "process", processInstanceId: "process-normal" };
const improvementTask = { id: "task-process", name: "任意名称", source: "process", processInstanceId: "process-improvement" };
const improvementProcessInstanceIds = new Set(["process-improvement"]);

test("改善行动任务使用正式改善工作关系识别，不依赖任务source或名称", () => {
  assert.equal(isImprovementActionTask(improvementTask, improvementProcessInstanceIds), true);
  assert.equal(isImprovementActionTask(actionTask, improvementProcessInstanceIds), false);
  assert.equal(isImprovementActionTask({ ...directTask, name: "改善行动：测试名称" }, improvementProcessInstanceIds), false);
  assert.equal(isImprovementActionTask({ ...improvementTask, source: "direct", name: "普通文字" }, improvementProcessInstanceIds), true);
});

test("任务中心默认隐藏改善行动任务，勾选后恢复", () => {
  const tasks = [directTask, actionTask, improvementTask];
  assert.deepEqual(
    tasks.filter((task) => shouldShowTaskInTaskCenter(task, {}, improvementProcessInstanceIds)),
    [directTask, actionTask],
  );
  assert.deepEqual(
    tasks.filter((task) => shouldShowTaskInTaskCenter(task, { showImprovementTasks: true }, improvementProcessInstanceIds)),
    tasks,
  );
});

test("今天、我的任务、逾期、全部视图共享同一可见性规则和数量口径", () => {
  const tasksByView = {
    today: [directTask, actionTask, improvementTask],
    mine: [directTask, actionTask, improvementTask],
    overdue: [directTask, actionTask, improvementTask],
    all: [directTask, actionTask, improvementTask],
  };
  for (const tasks of Object.values(tasksByView)) {
    const hidden = tasks.filter((task) => shouldShowTaskInTaskCenter(task, {}, improvementProcessInstanceIds));
    const shown = tasks.filter((task) => shouldShowTaskInTaskCenter(task, { showImprovementTasks: true }, improvementProcessInstanceIds));
    assert.equal(hidden.length, 2);
    assert.equal(shown.length, 3);
    assert.equal(shown.length - hidden.length, 1);
  }
});
