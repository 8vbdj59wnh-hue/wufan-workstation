import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = {
  location: { protocol: "http:", hostname: "127.0.0.1", hash: "#goals" },
};

const { applyDataSnapshot, state } = await import("../src/appState.js");

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
