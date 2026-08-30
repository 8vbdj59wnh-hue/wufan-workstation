import assert from "node:assert/strict";
import test from "node:test";

import { getProcessInstanceBusinessStatus } from "../src/data/processInstanceSelectors.js";

test("全部步骤任务取消时业务状态为已取消", () => {
  const state = {
    processInstances: [{ id: "action-1", status: "running" }],
    tasks: [
      { id: "task-1", processInstanceId: "action-1", status: "canceled" },
      { id: "task-2", processInstanceId: "action-1", status: "cancelled" },
    ],
    processTemplateNodes: [],
    workPlans: [],
    taskTemplates: [],
  };

  assert.deepEqual(getProcessInstanceBusinessStatus("action-1", state), {
    status: "canceled",
    label: "已取消",
  });
});

test("仍有未取消步骤时不会误判为已取消", () => {
  const state = {
    processInstances: [{ id: "action-1", status: "running" }],
    tasks: [
      { id: "task-1", processInstanceId: "action-1", status: "canceled" },
      { id: "task-2", processInstanceId: "action-1", status: "todo" },
    ],
    processTemplateNodes: [],
    workPlans: [],
    taskTemplates: [],
  };

  assert.notEqual(getProcessInstanceBusinessStatus("action-1", state).status, "canceled");
});

test("已完成与已取消步骤混合且无活动步骤时业务状态为已取消", () => {
  const state = {
    processInstances: [{ id: "action-1", status: "running" }],
    tasks: [
      { id: "task-1", processInstanceId: "action-1", status: "done" },
      { id: "task-2", processInstanceId: "action-1", status: "canceled" },
    ],
    processTemplateNodes: [],
    workPlans: [],
    taskTemplates: [],
  };

  assert.equal(getProcessInstanceBusinessStatus("action-1", state).status, "canceled");
});
