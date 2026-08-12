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
const productSource = await fs.readFile(new URL("../src/productCenterPage.js", import.meta.url), "utf8");
assert(!/import\s+\{[^}]*renderProductCenterPage[^}]*\}\s+from\s+["'][^"']*productCenterPage/.test(mainSource), "main.js仍静态导入产品中心。");
assert(mainSource.includes('getLoadedRouteModule("products")'), "产品中心渲染未接入模块缓存。");
assert(mainSource.includes("产品中心加载失败"), "产品中心独立错误页未接入。");
assert(productSource.includes("renderProductSkuV2List"), "产品列表实现未保留。");
assert(productSource.includes("renderProductSkuV2Detail"), "产品详情实现未保留。");
assert(productSource.includes('renderUiModule("product_daily_sales"'), "产品销售表现模块未保留。");
assert(productSource.includes('activeTab === "inventory"'), "产品库存模块未保留。");
assert(productSource.includes("loadProductSalesLinks"), "产品销售链接关系能力未保留。");

const {
  RouteModuleErrorCode,
  beginRouteNavigation,
  createRouteModuleLoader,
  getLoadedRouteModule,
  getRouteModuleStatus,
  loadRouteModule,
} = await import("../src/moduleLoader.js");

assert(getLoadedRouteModule("products") === null, "首次访问前产品中心不应已加载。");
assert(getRouteModuleStatus("products").status === "idle", "首次访问前产品中心状态应为idle。");

const revision = beginRouteNavigation("products");
const firstAdapter = await loadRouteModule("products", { navigationRevision: revision });
assert(typeof firstAdapter.render === "function", "产品中心缺少render适配器。");
assert(typeof firstAdapter.bind === "function", "产品中心缺少bind适配器。");
const rendered = firstAdapter.render();
assert(typeof rendered === "string" && rendered.includes("产品中心"), "产品中心真实模块未正常渲染。");

const secondAdapter = await loadRouteModule("products");
assert(firstAdapter === secondAdapter, "重复进入产品中心没有复用adapter缓存。");

const staleRevision = beginRouteNavigation("products");
beginRouteNavigation("dashboard");
let staleCode = null;
try {
  await loadRouteModule("products", { navigationRevision: staleRevision });
} catch (error) {
  staleCode = error?.code;
}
assert(staleCode === RouteModuleErrorCode.StaleNavigation, "快速切换没有阻止产品中心旧导航。");

const isolatedLoader = createRouteModuleLoader({
  products: {
    loader: async () => ({ renderProductCenterPage: () => "broken" }),
    adapt: (module) => ({ render: module.renderProductCenterPage, bind: module.bindProductCenterPageEvents }),
    requiredExports: ["render", "bind"],
  },
  dashboard: {
    loader: async () => ({ render: () => "dashboard", bind: () => {} }),
    requiredExports: ["render", "bind"],
  },
});
let contractCode = null;
try {
  await isolatedLoader.loadRouteModule("products");
} catch (error) {
  contractCode = error?.code;
}
assert(contractCode === RouteModuleErrorCode.ContractInvalid, "产品模块导出错误未被隔离为契约错误。");
assert((await isolatedLoader.loadRouteModule("dashboard")).render() === "dashboard", "产品模块错误影响了其他模块。");

console.log(JSON.stringify({
  initialStatus: "idle",
  loadedStatus: getRouteModuleStatus("products").status,
  adapterContract: ["render", "bind"],
  realModuleRendered: true,
  repeatedLoadUsesCache: firstAdapter === secondAdapter,
  staleNavigation: staleCode,
  isolatedContractFailure: contractCode,
  otherModuleStillUsable: true,
  productCapabilitiesPreserved: ["list", "detail", "daily_sales", "inventory", "sales_links"],
}, null, 2));
