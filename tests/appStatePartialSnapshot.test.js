import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

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
  getStoreOptionsLoadState,
  state,
} = await import("../src/appState.js");
const { renderPublicFormFieldInput } = await import("../src/workFormEditor.js");
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

test("empty store options are reloaded once and shared by concurrent callers", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (url, options) => {
    requestCount += 1;
    assert.match(String(url), /\/api\/stores$/);
    assert.equal(options.cache, "no-store");
    return new Response(JSON.stringify([
      { id: "store-active", name: "测试店铺", platform: "天猫", status: "active" },
    ]), {
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
    assert.equal(first, state.stores);
    assert.equal(second, state.stores);
    assert.deepEqual(state.stores, [
      { id: "store-active", name: "测试店铺", platform: "天猫", status: "active" },
    ]);
    assert.deepEqual(getStoreOptionsLoadState(), { status: "ready", message: "" });
  } finally {
    globalThis.fetch = originalFetch;
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
  assert.match(declaration, /"publishingAccounts"/);
  assert.match(declaration, /"processTemplateNodes"/);
  assert.match(declaration, /"standardWorkForms"/);
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
