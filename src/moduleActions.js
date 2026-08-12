const moduleActions = new Map();

function actionKey(moduleId, actionName) {
  return `${String(moduleId ?? "").trim()}:${String(actionName ?? "").trim()}`;
}

export function registerModuleAction(moduleId, actionName, handler) {
  if (typeof handler !== "function") throw new TypeError(`模块动作“${moduleId}.${actionName}”必须是函数。`);
  moduleActions.set(actionKey(moduleId, actionName), handler);
  return handler;
}

export function getModuleAction(moduleId, actionName) {
  return moduleActions.get(actionKey(moduleId, actionName)) ?? null;
}

export async function invokeModuleAction(moduleId, actionName, ...args) {
  let handler = getModuleAction(moduleId, actionName);
  if (handler === null) {
    const { loadRouteModule } = await import("./moduleLoader.js");
    await loadRouteModule(moduleId);
    handler = getModuleAction(moduleId, actionName);
  }
  if (handler === null) throw new Error(`模块动作“${moduleId}.${actionName}”尚未注册。`);
  return handler(...args);
}
