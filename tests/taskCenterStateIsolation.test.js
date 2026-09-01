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

test("任务波次读取会合并商品图片上下文并兼容新版响应", async () => {
  const { state, loadTaskWaves } = await import(`../src/appState.js?task-wave-images=${Date.now()}`);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    items: [{ id: "wave-with-image", taskIds: ["task-with-image"] }],
    context: {
      taskProductContexts: [{
        contextId: "action-with-image",
        erpSkuId: "erp-sku-with-image",
        erpSkuImage: "/uploads/product-v2-imports/batch/product.webp",
      }],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    await loadTaskWaves();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(state.taskWaves.map((item) => item.id), ["wave-with-image"]);
  assert.equal(state.taskProductContexts.length, 1);
  assert.equal(state.taskProductContexts[0].erpSkuImage, "/uploads/product-v2-imports/batch/product.webp");
});

test("任务波次列表会同步合并成员任务内容", async () => {
  const { state, loadTaskWaves } = await import(`../src/appState.js?task-wave-members=${Date.now()}`);
  state.tasks.splice(0, state.tasks.length);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: "wave-1",
    businessCode: "WAVE-TEST-0001",
    status: "doing",
    taskCount: 2,
    taskIds: ["wave-task-1", "wave-task-2"],
    tasks: [
      { id: "wave-task-1", businessCode: "TASK-TEST-0001", name: "成员任务一", status: "doing" },
      { id: "wave-task-2", businessCode: "TASK-TEST-0002", name: "成员任务二", status: "todo" },
    ],
  }]), { status: 200, headers: { "content-type": "application/json" } });

  try {
    await loadTaskWaves();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(state.taskWaves.map((item) => item.id), ["wave-1"]);
  assert.deepEqual(state.tasks.map((item) => item.id), ["wave-task-1", "wave-task-2"]);
  assert.equal(state.tasks.find((item) => item.id === "wave-task-1")?.name, "成员任务一");
});

test("任务图片识别支持所有正式上传目录", async () => {
  const { getActionImageUrls } = await import("../src/data/taskUtils.js");
  assert.deepEqual(getActionImageUrls({
    productImage: "/uploads/product-v2-imports/batch/product.webp",
  }), ["/uploads/product-v2-imports/batch/product.webp"]);
});
