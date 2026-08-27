import assert from "node:assert/strict";
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
  globalThis.fetch = async (url) => {
    requestCount += 1;
    assert.match(String(url), /\/api\/stores$/);
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
