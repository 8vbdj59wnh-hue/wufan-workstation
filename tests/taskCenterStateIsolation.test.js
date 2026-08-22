import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  location: { protocol: "http:", hostname: "127.0.0.1" },
  localStorage: { getItem: () => "", setItem: () => {}, removeItem: () => {} },
};

test("任务中心分页只合并局部结果，不清空关键行动和其他任务", async () => {
  const { state, loadTaskCenterTasks } = await import(`../src/appState.js?task-center-isolation=${Date.now()}`);
  state.tasks.splice(0, state.tasks.length, {
    id: "existing-task",
    name: "原任务",
    processInstanceId: "existing-action",
    status: "doing",
  });
  state.processInstances.splice(0, state.processInstances.length, { id: "existing-action", name: "原关键行动", status: "running" });
  state.workPlans.splice(0, state.workPlans.length, { id: "existing-plan", processInstanceId: "existing-action", workType: "normal" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    page: 1,
    pageSize: 50,
    total: 1,
    totalPages: 1,
    items: [{ id: "page-task", name: "本页任务", processInstanceId: "page-action" }],
    context: {
      processInstances: [{ id: "page-action", name: "本页关键行动", status: "running" }],
      workPlans: [{ id: "page-plan", processInstanceId: "page-action", workType: "normal" }],
      taskProductContexts: [],
      taskWaves: [],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    await loadTaskCenterTasks({ view: "all" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(state.tasks.map((item) => item.id), ["existing-task", "page-task"]);
  assert.deepEqual(state.processInstances.map((item) => item.id), ["existing-action", "page-action"]);
  assert.deepEqual(state.workPlans.map((item) => item.id), ["existing-plan", "page-plan"]);
  assert.equal(state.processInstances.find((item) => item.id === "existing-action")?.status, "running");
  assert.equal(state.tasks.find((item) => item.id === "existing-task")?.processInstanceId, "existing-action");
  assert.equal(state.tasks.find((item) => item.id === "existing-task")?.status, "doing");
});
