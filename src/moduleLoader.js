import { registerModuleAction } from "./moduleActions.js";

export const RouteModuleErrorCode = Object.freeze({
  NotRegistered: "route_module_not_registered",
  ImportFailed: "route_module_import_failed",
  ContractInvalid: "route_module_contract_invalid",
  StaleNavigation: "route_module_stale_navigation",
});

export class RouteModuleError extends Error {
  constructor(code, moduleId, message, options = {}) {
    super(message, options);
    this.name = "RouteModuleError";
    this.code = code;
    this.moduleId = moduleId;
    this.exportName = options.exportName ?? null;
  }
}

function normalizeDefinition(moduleId, definition) {
  if (typeof definition?.loader !== "function") {
    throw new RouteModuleError(
      RouteModuleErrorCode.ContractInvalid,
      moduleId,
      `路由模块“${moduleId}”缺少有效的动态加载函数。`,
      { exportName: "loader" },
    );
  }
  return {
    loader: definition.loader,
    adapt: typeof definition.adapt === "function" ? definition.adapt : (namespace) => namespace,
    requiredExports: Array.isArray(definition.requiredExports) ? [...definition.requiredExports] : [],
  };
}

function validateAdapter(moduleId, adapter, requiredExports) {
  if (adapter === null || typeof adapter !== "object") {
    throw new RouteModuleError(
      RouteModuleErrorCode.ContractInvalid,
      moduleId,
      `路由模块“${moduleId}”没有返回有效的模块适配器。`,
    );
  }
  for (const exportName of requiredExports) {
    if (typeof adapter[exportName] !== "function") {
      throw new RouteModuleError(
        RouteModuleErrorCode.ContractInvalid,
        moduleId,
        `路由模块“${moduleId}”缺少函数导出“${exportName}”。`,
        { exportName },
      );
    }
  }
  return adapter;
}

function normalizeImportError(moduleId, error) {
  if (error instanceof RouteModuleError) return error;
  return new RouteModuleError(
    RouteModuleErrorCode.ImportFailed,
    moduleId,
    `路由模块“${moduleId}”加载失败。`,
    { cause: error },
  );
}

export function createRouteModuleLoader(initialDefinitions = {}) {
  const definitions = new Map();
  const promises = new Map();
  const adapters = new Map();
  const errors = new Map();
  const loadedAt = new Map();
  let navigationRevision = 0;
  let navigationModuleId = null;

  function registerRouteModule(moduleId, definition) {
    const normalizedModuleId = String(moduleId ?? "").trim();
    if (normalizedModuleId === "") {
      throw new RouteModuleError(RouteModuleErrorCode.ContractInvalid, "", "路由模块ID不能为空。");
    }
    definitions.set(normalizedModuleId, normalizeDefinition(normalizedModuleId, definition));
  }

  for (const [moduleId, definition] of Object.entries(initialDefinitions)) registerRouteModule(moduleId, definition);

  function beginRouteNavigation(moduleId) {
    navigationRevision += 1;
    navigationModuleId = String(moduleId ?? "").trim() || null;
    return navigationRevision;
  }

  function isNavigationCurrent(revision, moduleId = navigationModuleId) {
    return revision === navigationRevision && (moduleId === null || moduleId === navigationModuleId);
  }

  function assertNavigationCurrent(revision, moduleId) {
    if (isNavigationCurrent(revision, moduleId)) return true;
    throw new RouteModuleError(
      RouteModuleErrorCode.StaleNavigation,
      moduleId,
      `路由模块“${moduleId}”加载完成时，用户已经切换到其他页面。`,
    );
  }

  async function loadRouteModule(moduleId, options = {}) {
    const normalizedModuleId = String(moduleId ?? "").trim();
    const definition = definitions.get(normalizedModuleId);
    if (definition === undefined) {
      throw new RouteModuleError(
        RouteModuleErrorCode.NotRegistered,
        normalizedModuleId,
        `路由模块“${normalizedModuleId}”尚未注册。`,
      );
    }
    if (errors.has(normalizedModuleId)) throw errors.get(normalizedModuleId);
    if (adapters.has(normalizedModuleId)) {
      const adapter = adapters.get(normalizedModuleId);
      if (options.navigationRevision !== undefined) {
        assertNavigationCurrent(options.navigationRevision, normalizedModuleId);
      }
      return adapter;
    }

    let promise = promises.get(normalizedModuleId);
    if (promise === undefined) {
      promise = Promise.resolve()
        .then(() => definition.loader())
        .then((namespace) => definition.adapt(namespace))
        .then((adapter) => validateAdapter(normalizedModuleId, adapter, definition.requiredExports))
        .then((adapter) => {
          adapters.set(normalizedModuleId, adapter);
          for (const [actionName, handler] of Object.entries(adapter.actions ?? {})) {
            registerModuleAction(normalizedModuleId, actionName, handler);
          }
          loadedAt.set(normalizedModuleId, new Date().toISOString());
          errors.delete(normalizedModuleId);
          return adapter;
        })
        .catch((error) => {
          const normalizedError = normalizeImportError(normalizedModuleId, error);
          errors.set(normalizedModuleId, normalizedError);
          throw normalizedError;
        })
        .finally(() => promises.delete(normalizedModuleId));
      promises.set(normalizedModuleId, promise);
    }

    const adapter = await promise;
    if (options.navigationRevision !== undefined) {
      assertNavigationCurrent(options.navigationRevision, normalizedModuleId);
    }
    return adapter;
  }

  function getLoadedRouteModule(moduleId) {
    return adapters.get(String(moduleId ?? "").trim()) ?? null;
  }

  function getRouteModuleStatus(moduleId) {
    const normalizedModuleId = String(moduleId ?? "").trim();
    if (adapters.has(normalizedModuleId)) {
      return { status: "loaded", error: null, loadedAt: loadedAt.get(normalizedModuleId) ?? null };
    }
    if (errors.has(normalizedModuleId)) return { status: "error", error: errors.get(normalizedModuleId), loadedAt: null };
    if (promises.has(normalizedModuleId)) return { status: "loading", error: null, loadedAt: null };
    return { status: "idle", error: null, loadedAt: null };
  }

  function retryRouteModule(moduleId, options = {}) {
    const normalizedModuleId = String(moduleId ?? "").trim();
    promises.delete(normalizedModuleId);
    adapters.delete(normalizedModuleId);
    errors.delete(normalizedModuleId);
    loadedAt.delete(normalizedModuleId);
    return loadRouteModule(normalizedModuleId, options);
  }

  function preloadRouteModule(moduleId) {
    return loadRouteModule(moduleId).catch(() => null);
  }

  return {
    registerRouteModule,
    loadRouteModule,
    getLoadedRouteModule,
    getRouteModuleStatus,
    retryRouteModule,
    preloadRouteModule,
    beginRouteNavigation,
    isNavigationCurrent,
    assertNavigationCurrent,
    getNavigationRevision: () => navigationRevision,
  };
}

const defaultLoader = createRouteModuleLoader({
  tasks: {
    loader: () => import("./pages/tasksPage.js"),
    adapt: (module) => ({
      moduleId: "tasks",
      render: module.renderTasksPage,
      bind: module.bindTasksPageEvents,
      selectTask: module.selectTask,
      actions: { selectTask: module.selectTask },
    }),
    requiredExports: ["render", "bind", "selectTask"],
  },
  connectionCenter: {
    loader: () => import("./pages/connectionCenterPage.js"),
    adapt: (module) => ({
      moduleId: "connectionCenter",
      render: module.renderConnectionCenterPage,
      bind: module.bindConnectionCenterPageEvents,
    }),
    requiredExports: ["render", "bind"],
  },
  products: {
    loader: () => import("./pages/productCenterPage.js"),
    adapt: (module) => ({
      moduleId: "products",
      render: module.renderProductCenterPage,
      bind: module.bindProductCenterPageEvents,
    }),
    requiredExports: ["render", "bind"],
  },
  adminDataCenter: {
    loader: () => import("./dataCenterPage.js"),
    adapt: (module) => ({
      moduleId: "adminDataCenter",
      render: module.renderAdminDataCenterPage,
      bind: module.bindAdminDataCenterPageEvents,
    }),
    requiredExports: ["render", "bind"],
  },
});

export const registerRouteModule = defaultLoader.registerRouteModule;
export const loadRouteModule = defaultLoader.loadRouteModule;
export const getLoadedRouteModule = defaultLoader.getLoadedRouteModule;
export const getRouteModuleStatus = defaultLoader.getRouteModuleStatus;
export const retryRouteModule = defaultLoader.retryRouteModule;
export const preloadRouteModule = defaultLoader.preloadRouteModule;
export const beginRouteNavigation = defaultLoader.beginRouteNavigation;
export const isNavigationCurrent = defaultLoader.isNavigationCurrent;
export const assertNavigationCurrent = defaultLoader.assertNavigationCurrent;
export const getNavigationRevision = defaultLoader.getNavigationRevision;
