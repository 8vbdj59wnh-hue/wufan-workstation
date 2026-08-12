import fs from "node:fs/promises";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const storage = new Map();
globalThis.window = {
  location: { protocol: "http:", hostname: "127.0.0.1", hash: "#dashboard" },
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
};

const { getModuleAction, invokeModuleAction, registerModuleAction } = await import("../src/moduleActions.js");
const { getLoadedRouteModule, getRouteModuleStatus } = await import("../src/moduleLoader.js");

let probeValue = null;
registerModuleAction("probe", "setValue", (value) => { probeValue = value; });
await invokeModuleAction("probe", "setValue", "registered");
assert(probeValue === "registered", "已注册Action调用失败。");

assert(getLoadedRouteModule("tasks") === null, "Action调用前任务模块不应加载。");
assert(getModuleAction("tasks", "selectTask") === null, "任务模块加载前不应注册selectTask。");
await invokeModuleAction("tasks", "selectTask", "phase3f-task");
assert(getRouteModuleStatus("tasks").status === "loaded", "Action首次调用没有加载任务模块。");
assert(typeof getModuleAction("tasks", "selectTask") === "function", "任务模块加载后没有注册selectTask。");
const firstAdapter = getLoadedRouteModule("tasks");
await invokeModuleAction("tasks", "selectTask", "phase3f-task-second");
assert(getLoadedRouteModule("tasks") === firstAdapter, "Action重复调用没有复用已加载任务模块。");

const files = ["goalsPage.js", "scheduleBoardPage.js", "processesPage.js", "main.js"];
for (const file of files) {
  const source = await fs.readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert(!/from\s+["'][^"']*tasksPage/.test(source), `${file}仍静态导入tasksPage。`);
  assert(source.includes('invokeModuleAction("tasks", "selectTask"'), `${file}未使用任务Action。`);
}

console.log(JSON.stringify({
  lightweightRegistry: "passed",
  initialTaskStatus: "idle",
  actionTriggeredLoad: true,
  selectTaskRegisteredAfterLoad: true,
  repeatedActionUsesLoadedModule: true,
  callers: files,
  staticTaskImports: 0,
}, null, 2));
