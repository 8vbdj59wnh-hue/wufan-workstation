import {
  RouteModuleErrorCode,
  createRouteModuleLoader,
} from "../src/moduleLoader.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

let successfulLoads = 0;
let failingLoads = 0;

const loader = createRouteModuleLoader({
  success: {
    loader: async () => {
      successfulLoads += 1;
      return { render: () => "ok", bind: () => true };
    },
    requiredExports: ["render", "bind"],
  },
  failure: {
    loader: async () => {
      failingLoads += 1;
      throw new Error("simulated network failure");
    },
    requiredExports: ["render", "bind"],
  },
  invalid: {
    loader: async () => ({ render: () => "missing bind" }),
    requiredExports: ["render", "bind"],
  },
});

const concurrentResults = await Promise.all([
  loader.loadRouteModule("success"),
  loader.loadRouteModule("success"),
]);
assert(successfulLoads === 1, "并发重复加载没有复用Promise缓存。");
assert(concurrentResults[0] === concurrentResults[1], "并发加载没有返回同一个适配器。");
assert(loader.getLoadedRouteModule("success") === concurrentResults[0], "适配器缓存读取失败。");
assert(loader.getRouteModuleStatus("success").status === "loaded", "成功模块状态错误。");

let importError;
try {
  await loader.loadRouteModule("failure");
} catch (error) {
  importError = error;
}
assert(importError?.code === RouteModuleErrorCode.ImportFailed, "加载失败没有转换为import错误。");
assert(loader.getRouteModuleStatus("failure").status === "error", "失败状态没有保存。");
assert(await loader.preloadRouteModule("failure") === null, "预加载失败不应向调用方抛错。");
assert(failingLoads === 1, "普通重复调用不应隐式重试失败模块。");
try { await loader.retryRouteModule("failure"); } catch {}
assert(failingLoads === 2, "retryRouteModule没有重新发起加载。");

let contractError;
try {
  await loader.loadRouteModule("invalid");
} catch (error) {
  contractError = error;
}
assert(contractError?.code === RouteModuleErrorCode.ContractInvalid, "契约错误未被识别。");
assert(contractError?.exportName === "bind", "契约错误未指出缺失导出。");

let notRegisteredError;
try {
  await loader.loadRouteModule("missing");
} catch (error) {
  notRegisteredError = error;
}
assert(notRegisteredError?.code === RouteModuleErrorCode.NotRegistered, "未注册模块错误未被识别。");

const firstRevision = loader.beginRouteNavigation("success");
loader.beginRouteNavigation("other");
let staleError;
try {
  await loader.loadRouteModule("success", { navigationRevision: firstRevision });
} catch (error) {
  staleError = error;
}
assert(staleError?.code === RouteModuleErrorCode.StaleNavigation, "过期导航没有被阻断。");
assert(loader.getLoadedRouteModule("success") !== null, "过期导航不应清除已加载模块缓存。");

console.log(JSON.stringify({
  successLoadCount: successfulLoads,
  promiseCache: "passed",
  adapterCache: "passed",
  importFailure: importError.code,
  contractFailure: contractError.code,
  missingExport: contractError.exportName,
  notRegistered: notRegisteredError.code,
  staleNavigation: staleError.code,
  productionRoutesMigrated: 0,
}, null, 2));
