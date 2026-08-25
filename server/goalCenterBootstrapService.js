export const goalCenterBootstrapResources = Object.freeze([
  "companies",
  "departments",
  "positions",
  "people",
  "permissionTemplates",
  "categories",
  "stores",
  "publishingAccounts",
  "goals",
  "tasks",
  "taskTemplates",
  "processTemplates",
  "processTemplateNodes",
  "processInstances",
  "workPlans",
  "templates",
  "templateTagCategories",
  "templateTags",
  "issuesRequirements",
  "standardWorkForms",
  "products",
  "actionProducts",
  "productErpMappings",
]);

export const goalCenterInitialResources = Object.freeze([
  "companies", "departments", "positions", "people", "permissionTemplates", "categories", "stores",
  "publishingAccounts", "goals", "taskTemplates", "processTemplates", "processTemplateNodes", "templates",
  "templateTagCategories", "templateTags", "issuesRequirements", "standardWorkForms",
]);

export function readGoalCenterBootstrap(readResource) {
  if (typeof readResource !== "function") throw new TypeError("readResource must be a function");
  const initialResources = new Set(goalCenterInitialResources);
  return Object.fromEntries(goalCenterBootstrapResources.map((resource) => [
    resource,
    initialResources.has(resource) ? readResource(resource) : [],
  ]));
}

export function pickGoalCenterBootstrapResources(snapshot) {
  return Object.fromEntries(
    goalCenterBootstrapResources.map((resource) => [resource, snapshot?.[resource] ?? []]),
  );
}
