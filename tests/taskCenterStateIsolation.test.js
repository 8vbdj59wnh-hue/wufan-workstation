import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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
      processInstances: [{
        id: "action-with-image",
        businessCode: "KA-TEST-0001",
        name: "带商品图片的关键行动",
        status: "running",
      }],
      workPlans: [{ id: "plan-with-template", processInstanceId: "action-with-image" }],
      templates: [{ id: "template-with-image", name: "关联视觉模板" }],
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
  assert.equal(state.processInstances.find((item) => item.id === "action-with-image")?.businessCode, "KA-TEST-0001");
  assert.equal(state.workPlans.find((item) => item.id === "plan-with-template")?.processInstanceId, "action-with-image");
  assert.equal(state.templates.find((item) => item.id === "template-with-image")?.name, "关联视觉模板");
  assert.equal(state.taskProductContexts.length, 1);
  assert.equal(state.taskProductContexts[0].erpSkuImage, "/uploads/product-v2-imports/batch/product.webp");
});

test("直接刷新任务波次会同时保留关键行动关联和图片上下文", async () => {
  const originalHash = globalThis.window.location.hash;
  globalThis.window.location.hash = "#task-waves";
  const { state, loadPersistentData } = await import(`../src/appState.js?task-wave-refresh=${Date.now()}`);
  state.tasks.splice(0, state.tasks.length);
  state.processInstances.splice(0, state.processInstances.length);
  state.taskProductContexts.splice(0, state.taskProductContexts.length);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const headers = { "content-type": "application/json" };
    if (url.includes("/api/task-waves")) {
      return new Response(JSON.stringify({
        success: true,
        items: [{
          id: "wave-refresh",
          taskIds: ["task-refresh"],
          tasks: [{
            id: "task-refresh",
            source: "process",
            processInstanceId: "action-refresh",
          }],
        }],
        context: {
          processInstances: [{
            id: "action-refresh",
            businessCode: "KA-REFRESH-0001",
            name: "刷新后仍可见的关键行动",
            status: "running",
          }],
          workPlans: [{ id: "plan-refresh", processInstanceId: "action-refresh" }],
          templates: [{ id: "template-refresh", name: "刷新后仍可见的模板" }],
          taskProductContexts: [{
            contextId: "action-refresh",
            erpSkuImage: "/uploads/product-v2-imports/batch/refresh.webp",
          }],
        },
      }), { status: 200, headers });
    }
    if (url.includes("/api/notifications/summary")) {
      return new Response(JSON.stringify({ success: true, items: [], unreadCount: 0 }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ goals: [] }), { status: 200, headers });
  };

  try {
    await loadPersistentData();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window.location.hash = originalHash;
  }

  assert.equal(state.tasks.find((item) => item.id === "task-refresh")?.processInstanceId, "action-refresh");
  assert.equal(state.processInstances.find((item) => item.id === "action-refresh")?.businessCode, "KA-REFRESH-0001");
  assert.equal(state.workPlans.find((item) => item.id === "plan-refresh")?.processInstanceId, "action-refresh");
  assert.equal(state.templates.find((item) => item.id === "template-refresh")?.name, "刷新后仍可见的模板");
  assert.equal(state.taskProductContexts.find((item) => item.contextId === "action-refresh")?.erpSkuImage, "/uploads/product-v2-imports/batch/refresh.webp");
});

test("任务波次中的待执行任务允许打开详情", () => {
  const source = fs.readFileSync(new URL("../src/tasksPage.js", import.meta.url), "utf8");
  const renderTaskDetailSource = source.match(/function renderTaskDetail\(\) \{[\s\S]*?\n\}/u)?.[0] ?? "";

  assert.match(renderTaskDetailSource, /const selectedTask = getTask\(selectedTaskId\);/u);
  assert.doesNotMatch(renderTaskDetailSource, /isTaskVisibleInExecutionStage|allowPreExecution|getFilteredTasks/u);
});

test("任务波次接口返回关键行动、工作计划和关联模板上下文", () => {
  const source = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const route = source.match(/app\.get\("\/api\/task-waves",[\s\S]*?\n\}\);/u)?.[0] ?? "";

  assert.match(route, /processInstances,/u);
  assert.match(route, /workPlans,/u);
  assert.match(route, /templates,/u);
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
