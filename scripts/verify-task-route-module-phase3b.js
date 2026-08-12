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

const {
  beginRouteNavigation,
  getLoadedRouteModule,
  getRouteModuleStatus,
  isNavigationCurrent,
  loadRouteModule,
} = await import("../src/moduleLoader.js");

const mainSource = await fs.readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert(!/import\s+\{[^}]*renderTasksPage[^}]*\}\s+from\s+["'][^"']*tasksPage/.test(mainSource), "main.js仍静态导入任务中心。");
assert(mainSource.includes('["tasks", "connectionCenter", "products"].includes(moduleId)'), "任务路由未接入动态加载器。");
assert(mainSource.includes('invokeModuleAction("tasks", "selectTask", taskId)'), "通知点击未通过动态模块动作选择任务。");
assert(mainSource.includes("route-module-error"), "任务模块加载失败页面未接入。");

assert(getLoadedRouteModule("tasks") === null, "首次访问前任务模块不应已加载。");
assert(getRouteModuleStatus("tasks").status === "idle", "首次访问前任务模块状态应为idle。");

const firstRevision = beginRouteNavigation("tasks");
const firstAdapter = await loadRouteModule("tasks", { navigationRevision: firstRevision });
assert(typeof firstAdapter.render === "function", "任务模块缺少render适配器。");
assert(typeof firstAdapter.bind === "function", "任务模块缺少bind适配器。");
assert(typeof firstAdapter.actions?.selectTask === "function", "任务模块缺少selectTask动作。");
assert(getRouteModuleStatus("tasks").status === "loaded", "任务模块加载后状态不是loaded。");

const secondAdapter = await loadRouteModule("tasks");
assert(secondAdapter === firstAdapter, "重复进入任务中心没有复用适配器缓存。");

const staleRevision = beginRouteNavigation("tasks");
beginRouteNavigation("dashboard");
let staleCode = null;
try {
  await loadRouteModule("tasks", { navigationRevision: staleRevision });
} catch (error) {
  staleCode = error?.code;
}
assert(staleCode === "route_module_stale_navigation", "快速切换路由没有阻止过期任务页面渲染。");
assert(isNavigationCurrent(staleRevision, "tasks") === false, "过期导航仍被标记为当前导航。");

console.log(JSON.stringify({
  initialStatus: "idle",
  loadedStatus: getRouteModuleStatus("tasks").status,
  adapterContract: ["render", "bind", "actions.selectTask"],
  repeatedLoadUsesCache: secondAdapter === firstAdapter,
  staleNavigation: staleCode,
  staticTasksImportRemoved: true,
  errorPageConnected: true,
}, null, 2));
