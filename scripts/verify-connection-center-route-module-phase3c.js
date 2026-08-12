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

const mainSource = await fs.readFile(new URL("../src/main.js", import.meta.url), "utf8");
const connectionSource = await fs.readFile(new URL("../src/connectionCenterPage.js", import.meta.url), "utf8");
assert(!/import\s+\{[^}]*renderConnectionCenterPage[^}]*\}\s+from\s+["'][^"']*connectionCenterPage/.test(mainSource), "main.js仍静态导入链接中心。");
assert(mainSource.includes('getLoadedRouteModule("connectionCenter")'), "链接中心渲染未接入模块缓存。");
assert(mainSource.includes("链接中心加载失败"), "链接中心独立错误页未接入。");
assert(connectionSource.includes("sales_daily_data_quality"), "销售数据质量模块不在链接中心原页面中。");
assert(connectionSource.includes("sales-data-quality-governance"), "销售异常治理入口不在链接中心原页面中。");
assert(connectionSource.includes("link_daily_sales"), "Business-001销售日报分析模块不在链接中心原页面中。");

const {
  RouteModuleErrorCode,
  beginRouteNavigation,
  createRouteModuleLoader,
  getLoadedRouteModule,
  getRouteModuleStatus,
  loadRouteModule,
} = await import("../src/moduleLoader.js");

assert(getLoadedRouteModule("connectionCenter") === null, "首次访问前链接中心不应已加载。");
assert(getRouteModuleStatus("connectionCenter").status === "idle", "首次访问前链接中心状态应为idle。");

const revision = beginRouteNavigation("connectionCenter");
const firstAdapter = await loadRouteModule("connectionCenter", { navigationRevision: revision });
assert(typeof firstAdapter.render === "function", "链接中心缺少render适配器。");
assert(typeof firstAdapter.bind === "function", "链接中心缺少bind适配器。");
const secondAdapter = await loadRouteModule("connectionCenter");
assert(firstAdapter === secondAdapter, "重复进入链接中心没有复用adapter缓存。");

const staleRevision = beginRouteNavigation("connectionCenter");
beginRouteNavigation("dashboard");
let staleCode = null;
try {
  await loadRouteModule("connectionCenter", { navigationRevision: staleRevision });
} catch (error) {
  staleCode = error?.code;
}
assert(staleCode === RouteModuleErrorCode.StaleNavigation, "快速切换没有阻止链接中心旧导航。");

const isolatedLoader = createRouteModuleLoader({
  connectionCenter: {
    loader: async () => ({ renderConnectionCenterPage: () => "broken" }),
    adapt: (module) => ({ render: module.renderConnectionCenterPage, bind: module.bindConnectionCenterPageEvents }),
    requiredExports: ["render", "bind"],
  },
  dashboard: {
    loader: async () => ({ render: () => "dashboard", bind: () => {} }),
    requiredExports: ["render", "bind"],
  },
});
let contractCode = null;
try {
  await isolatedLoader.loadRouteModule("connectionCenter");
} catch (error) {
  contractCode = error?.code;
}
assert(contractCode === RouteModuleErrorCode.ContractInvalid, "缺少export没有形成链接中心契约错误。");
assert((await isolatedLoader.loadRouteModule("dashboard")).render() === "dashboard", "链接中心加载失败影响了其他模块。");

console.log(JSON.stringify({
  initialStatus: "idle",
  loadedStatus: getRouteModuleStatus("connectionCenter").status,
  adapterContract: ["render", "bind"],
  repeatedLoadUsesCache: firstAdapter === secondAdapter,
  staleNavigation: staleCode,
  isolatedContractFailure: contractCode,
  otherModuleStillUsable: true,
  businessModulesPreserved: ["link_daily_sales", "sales_daily_data_quality", "sales-data-quality-governance"],
}, null, 2));
