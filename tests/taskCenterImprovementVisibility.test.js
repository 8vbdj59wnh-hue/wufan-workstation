import test from "node:test";
import assert from "node:assert/strict";
import {
  isImprovementActionTask,
  shouldShowTaskInTaskCenter,
} from "../shared/taskCenterVisibility.js";

const directTask = { id: "task-direct", name: "普通任务", source: "direct", processInstanceId: null };
const improvementTask = { id: "task-process", name: "任意名称", source: "process", processInstanceId: "process-1" };

test("改善行动任务使用正式source字段识别，不依赖任务名称", () => {
  assert.equal(isImprovementActionTask(improvementTask), true);
  assert.equal(isImprovementActionTask({ ...directTask, name: "改善行动：测试名称" }), false);
  assert.equal(isImprovementActionTask({ ...improvementTask, name: "普通文字" }), true);
});

test("任务中心默认隐藏改善行动任务，勾选后恢复", () => {
  const tasks = [directTask, improvementTask];
  assert.deepEqual(tasks.filter((task) => shouldShowTaskInTaskCenter(task)), [directTask]);
  assert.deepEqual(
    tasks.filter((task) => shouldShowTaskInTaskCenter(task, { showImprovementTasks: true })),
    tasks,
  );
});

test("今天、我的任务、逾期、全部视图共享同一可见性规则和数量口径", () => {
  const tasksByView = {
    today: [directTask, improvementTask],
    mine: [directTask, improvementTask],
    overdue: [directTask, improvementTask],
    all: [directTask, improvementTask],
  };
  for (const tasks of Object.values(tasksByView)) {
    const hidden = tasks.filter((task) => shouldShowTaskInTaskCenter(task));
    const shown = tasks.filter((task) => shouldShowTaskInTaskCenter(task, { showImprovementTasks: true }));
    assert.equal(hidden.length, 1);
    assert.equal(shown.length, 2);
    assert.equal(shown.length - hidden.length, 1);
  }
});
