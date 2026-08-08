const moduleRegistry = new Map();

export function registerUiModule(definition) {
  if (!definition?.moduleKey || typeof definition.render !== "function") {
    throw new Error("UI 模块必须提供 moduleKey 和 render。");
  }
  moduleRegistry.set(definition.moduleKey, Object.freeze({ ...definition }));
  return moduleRegistry.get(definition.moduleKey);
}

export function getUiModule(moduleKey) {
  return moduleRegistry.get(moduleKey) ?? null;
}

export function renderUiModule(moduleKey, context = {}, config = {}) {
  const module = getUiModule(moduleKey);
  if (!module) return "";
  return module.render(context, config);
}

export function listUiModules(domain = "") {
  return [...moduleRegistry.values()].filter((module) => !domain || module.domain === domain);
}
