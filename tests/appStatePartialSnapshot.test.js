import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildActiveStoreOptions } from "../server/storeOptionsService.js";

globalThis.window = {
  location: { protocol: "http:", hostname: "127.0.0.1", hash: "#goals" },
  localStorage: {
    getItem: () => "",
    setItem: () => {},
    removeItem: () => {},
  },
};

const {
  applyDataSnapshot,
  ensureStoreOptionsLoaded,
  getStoreOptions,
  getStoreOptionsLoadState,
  loadPersistentData,
  login,
  logout,
  resolveAssetUrl,
  state,
} = await import("../src/appState.js");
const { renderPublicFormFieldInput } = await import("../src/workFormEditor.js");
const { ensureStoreOptionsForLaunchedProcessDetail } = await import("../src/processInstanceDetail.js");
const { buildContentNoteImportPreview } = await import("../src/contentSchedulePage.js");

test("partial module snapshots preserve undeclared state resources", () => {
  state.methodologies.splice(0, state.methodologies.length, { id: "method-existing", name: "其他模块数据" });
  const existingMethodologies = state.methodologies.map((item) => ({ ...item }));

  applyDataSnapshot(
    { goals: [{ id: "goal-partial", name: "独立目标模块数据" }] },
    { preserveMissingResources: true },
  );

  assert.deepEqual(state.goals, [{ id: "goal-partial", name: "独立目标模块数据" }]);
  assert.deepEqual(state.methodologies, existingMethodologies);
});

test("action store options contain only valid active stores", () => {
  assert.deepEqual(buildActiveStoreOptions([
    { id: "active-1", name: "启用店铺", platform: "天猫", status: "active", remark: "不应暴露" },
    { id: "inactive-1", name: "停用店铺", platform: "淘宝", status: "inactive" },
    { id: "", name: "无编号店铺", platform: "京东", status: "active" },
  ]), [
    { id: "active-1", name: "启用店铺", platform: "天猫", status: "active" },
  ]);
});

test("empty store options are reloaded once and shared by concurrent callers", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (url, options) => {
    requestCount += 1;
    assert.match(String(url), /\/api\/store-options$/);
    assert.equal(options.cache, "no-store");
    return new Response(JSON.stringify({ success: true, items: [
      { id: "store-active", name: "测试店铺", platform: "天猫", status: "active" },
    ] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  state.stores.splice(0, state.stores.length);

  try {
    const [first, second] = await Promise.all([
      ensureStoreOptionsLoaded(),
      ensureStoreOptionsLoaded(),
    ]);
    assert.equal(requestCount, 1);
    assert.deepEqual(first, getStoreOptions());
    assert.deepEqual(second, getStoreOptions());
    assert.deepEqual(getStoreOptions(), [
      { id: "store-active", name: "测试店铺", platform: "天猫", status: "active" },
    ]);
    assert.deepEqual(getStoreOptionsLoadState(), { status: "ready", message: "" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forced store refresh replaces a stale active directory", async () => {
  const originalFetch = globalThis.fetch;
  const originalStores = state.stores.map((item) => ({ ...item }));
  state.stores.splice(0, state.stores.length, {
    id: "store-stale",
    name: "旧店铺快照",
    platform: "淘宝",
    status: "active",
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, items: [
    { id: "store-current", name: "最新启用店铺", platform: "天猫", status: "active" },
  ] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    await ensureStoreOptionsLoaded({ force: true });
    assert.deepEqual(getStoreOptions(), [
      { id: "store-current", name: "最新启用店铺", platform: "天猫", status: "active" },
    ]);
    assert.deepEqual(state.stores, [
      { id: "store-stale", name: "旧店铺快照", platform: "淘宝", status: "active" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    state.stores.splice(0, state.stores.length, ...originalStores);
  }
});

test("slash-prefixed module bootstrap preserves stores outside its partial contract", async () => {
  const originalFetch = globalThis.fetch;
  const originalHash = window.location.hash;
  const originalGoals = state.goals.map((item) => ({ ...item }));
  const originalStores = state.stores.map((item) => ({ ...item }));
  const requestedUrls = [];
  state.stores.splice(0, state.stores.length, {
    id: "store-kept",
    name: "必须保留的店铺",
    platform: "淘宝",
    status: "active",
  });
  window.location.hash = "#/scheduleBoard";
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes("/api/notifications/summary")) {
      return new Response(JSON.stringify({ success: true, items: [], unreadCount: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ goals: [{ id: "goal-from-schedule-board" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    assert.equal(await loadPersistentData(), true);
    assert.equal(requestedUrls.some((url) => url.includes("module=scheduleBoard")), true);
    assert.equal(requestedUrls.some((url) => url.includes("module=dashboard")), false);
    assert.deepEqual(state.stores, [{
      id: "store-kept",
      name: "必须保留的店铺",
      platform: "淘宝",
      status: "active",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    window.location.hash = originalHash;
    state.goals.splice(0, state.goals.length, ...originalGoals);
    state.stores.splice(0, state.stores.length, ...originalStores);
  }
});

test("a slower previous route cannot erase the current route store directory", async () => {
  const originalFetch = globalThis.fetch;
  const originalHash = window.location.hash;
  const originalStores = state.stores.map((item) => ({ ...item }));
  let resolveStaleBootstrap;
  const staleBootstrap = new Promise((resolve) => { resolveStaleBootstrap = resolve; });
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes("/api/notifications/summary")) {
      return new Response(JSON.stringify({ success: true, items: [], unreadCount: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (requestUrl.includes("module=scheduleBoard")) return staleBootstrap;
    if (requestUrl.includes("/api/goal-center/bootstrap")) {
      return new Response(JSON.stringify({
        stores: [{ id: "store-current-route", name: "当前页面店铺", platform: "天猫", status: "active" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    window.location.hash = "#/scheduleBoard";
    const staleLoad = loadPersistentData();
    window.location.hash = "#/goals";
    assert.equal(await loadPersistentData(), true);
    resolveStaleBootstrap(new Response(JSON.stringify({ stores: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    assert.equal(await staleLoad, false);
    assert.deepEqual(state.stores, [
      { id: "store-current-route", name: "当前页面店铺", platform: "天猫", status: "active" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    window.location.hash = originalHash;
    state.stores.splice(0, state.stores.length, ...originalStores);
  }
});

test("store option permission failures expose an actionable message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ success: false, message: "你没有权限查看该数据" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(
      ensureStoreOptionsLoaded({ force: true }),
      /检查“发起关键行动”权限/,
    );
    assert.deepEqual(getStoreOptionsLoadState(), {
      status: "error",
      message: "当前账号没有读取店铺的权限，请联系管理员检查“发起关键行动”权限。",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("module snapshots cannot erase the dedicated action store directory", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, items: [
    { id: "store-isolated", name: "独立店铺选项", platform: "天猫", status: "active" },
  ] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    await ensureStoreOptionsLoaded({ force: true });
    applyDataSnapshot({ stores: [] }, { preserveMissingResources: true });
    assert.deepEqual(state.stores, []);
    assert.deepEqual(getStoreOptions(), [
      { id: "store-isolated", name: "独立店铺选项", platform: "天猫", status: "active" },
    ]);
    assert.match(renderPublicFormFieldInput({
      key: "storeId",
      label: "上架店铺",
      type: "select",
      options: [],
    }), /独立店铺选项（天猫）/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("asset URLs use the scoped token returned by login", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    token: "api-token",
    assetToken: "asset-token",
    user: { id: "person-1", personId: "person-1" },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    assert.equal((await login("user", "password")).success, true);
    assert.equal(
      resolveAssetUrl("/uploads/images/example.png"),
      "http://127.0.0.1:3001/uploads/images/example.png?access_token=asset-token",
    );
    assert.equal(
      resolveAssetUrl("/uploads/images/example.png?size=small#preview"),
      "http://127.0.0.1:3001/uploads/images/example.png?size=small&access_token=asset-token#preview",
    );
    assert.equal(resolveAssetUrl("https://example.com/image.png"), "https://example.com/image.png");
  } finally {
    logout();
    globalThis.fetch = originalFetch;
  }
});

test("content-note account fields keep managed choices and the imported selected value", () => {
  state.publishingAccounts.splice(0, state.publishingAccounts.length);
  const html = renderPublicFormFieldInput({
    key: "account",
    label: "发布账号",
    type: "select",
    options: ["阿柚", "小茉"],
  }, { account: "南屿" });

  assert.match(html, /<option value="阿柚"/);
  assert.match(html, /<option value="南屿" selected>南屿<\/option>/);
});

test("content-note titles render values saved under the latest form field id", () => {
  const fieldKey = "form-field-1784949354980-8r2oar";
  const html = renderPublicFormFieldInput({
    fieldId: fieldKey,
    key: fieldKey,
    label: "标题",
    type: "text",
    placeholder: "请输入笔记标题",
  }, { [fieldKey]: "南屿｜阳光、花和一个喜欢的角落" });

  assert.match(html, /value="南屿｜阳光、花和一个喜欢的角落"/);
});

test("schedule board bootstrap includes all resources required by content-note import", () => {
  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const declaration = serverSource.match(/const scheduleBoardCommon = \[[\s\S]*?\];/)?.[0] ?? "";
  assert.match(declaration, /"stores"/);
  assert.match(declaration, /"publishingAccounts"/);
  assert.match(declaration, /"processTemplateNodes"/);
  assert.match(declaration, /"standardWorkForms"/);
});

test("goal action launch always refreshes store options", () => {
  const goalsPageSource = fs.readFileSync(new URL("../src/goalsPage.js", import.meta.url), "utf8");
  assert.match(goalsPageSource, /ensureStoreOptionsLoaded\(\{ force: true \}\)/);
});

test("shared launched-action detail loads store options for editable store fields", async () => {
  const originalFetch = globalThis.fetch;
  let rerenderCount = 0;
  logout();
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, items: [
    { id: "store-detail", name: "新品上架店铺", platform: "天猫", status: "active" },
  ] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const detail = {
    querySelector: (selector) => selector === 'select[name="custom__storeId"]' ? {} : null,
  };

  try {
    assert.equal(await ensureStoreOptionsForLaunchedProcessDetail(detail, () => { rerenderCount += 1; }), true);
    assert.deepEqual(getStoreOptions(), [
      { id: "store-detail", name: "新品上架店铺", platform: "天猫", status: "active" },
    ]);
    assert.equal(rerenderCount, 1);
    assert.equal(await ensureStoreOptionsForLaunchedProcessDetail(detail, () => { rerenderCount += 1; }), false);
    assert.equal(rerenderCount, 1);
  } finally {
    logout();
    globalThis.fetch = originalFetch;
  }
});

test("logout clears account-scoped store options", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, items: [
    { id: "store-private", name: "当前账号店铺", platform: "天猫", status: "active" },
  ] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    await ensureStoreOptionsLoaded({ force: true });
    assert.equal(getStoreOptions().length, 1);
    logout();
    assert.deepEqual(getStoreOptions(), []);
    assert.deepEqual(getStoreOptionsLoadState(), { status: "idle", message: "" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an in-flight store response cannot repopulate options after logout", async () => {
  const originalFetch = globalThis.fetch;
  let resolveResponse;
  globalThis.fetch = () => new Promise((resolve) => { resolveResponse = resolve; });

  try {
    const pendingLoad = ensureStoreOptionsLoaded({ force: true });
    logout();
    resolveResponse(new Response(JSON.stringify({ success: true, items: [
      { id: "store-old-session", name: "旧会话店铺", platform: "天猫", status: "active" },
    ] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await pendingLoad;
    assert.deepEqual(getStoreOptions(), []);
    assert.deepEqual(getStoreOptionsLoadState(), { status: "idle", message: "" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("management dashboard uses its lightweight bootstrap instead of the global snapshot", () => {
  const stateSource = fs.readFileSync(new URL("../src/appState.js", import.meta.url), "utf8");
  const lightweightModules = stateSource.match(/const lightweightModules = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  assert.match(lightweightModules, /"dashboardManagement"/);
});

test("reading task waves does not generate or mutate waves", () => {
  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const route = serverSource.match(/app\.get\("\/api\/task-waves",[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.match(route, /readTaskWavesForTaskIds/);
  assert.doesNotMatch(route, /generateEligibleTaskWaves\(/);
});

test("content-note import accepts blank row goals after a batch goal is selected", () => {
  const template = state.taskTemplates.find((item) => item.id === "task-template-publish-content-note");
  assert.ok(template);
  const originalNodes = state.processTemplateNodes.map((item) => ({ ...item }));
  state.processTemplateNodes.splice(0, state.processTemplateNodes.length, {
    id: "content-note-import-node",
    templateId: template.defaultProcessTemplateId,
    name: "制作并发布内容笔记",
    stepType: "execution",
    ownerRule: "initiator",
    ownerId: "",
    status: "active",
  });

  try {
    const [row] = buildContentNoteImportPreview([{
      对齐目标: "",
      关键行动名称: "测试批量发布内容笔记",
      产品编码: "",
      模板编码: "",
      完成日期: "",
      完成时间: "",
    }], "goal-partial");
    assert.deepEqual(row.errors, []);
    assert.equal(row.goal.id, "goal-partial");
    assert.equal(row.selected, true);
  } finally {
    state.processTemplateNodes.splice(0, state.processTemplateNodes.length, ...originalNodes);
  }
});

test("task executors can read publishing-account choices used by their forms", () => {
  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const authorization = serverSource.match(/function canUsePublishingAccountOptions\(user\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(authorization, /hasPermission\(user, "tasks\.execute"\)/);
});
