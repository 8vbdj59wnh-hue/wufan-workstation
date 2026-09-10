// Canonical V2 permission definitions and guards shared by browser and server code.
export const PERMISSION_SCHEMA_VERSION = 2;

export const dataScopeOptions = [
  { value: "self", label: "只看自己的数据" },
  { value: "department", label: "只看本部门数据" },
  { value: "all", label: "看全部数据" },
];

export const actionLaunchScopeOptions = [
  { value: "all", label: "可发起全部关键行动" },
  { value: "selected", label: "只可发起指定关键行动" },
];

export const permissionGroups = [
  { key: "cockpit", title: "经营驾驶舱", permissions: [{ key: "view", label: "查看经营驾驶舱" }] },
  { key: "goals", title: "目标", permissions: [
    { key: "view", label: "查看目标" },
    { key: "manage", label: "管理目标" },
    { key: "close", label: "停用或重新启用目标" },
  ] },
  { key: "keyActions", title: "关键行动", permissions: [
    { key: "view", label: "查看关键行动" },
    { key: "launch", label: "发起关键行动" },
    { key: "manage", label: "管理关键行动" },
  ] },
  { key: "tasks", title: "任务", permissions: [
    { key: "view", label: "查看任务" },
    { key: "execute", label: "执行任务" },
    { key: "manage", label: "管理任务" },
    { key: "accept", label: "验收任务" },
    { key: "cancel", label: "取消任务" },
  ] },
  { key: "workResults", title: "工作结果", permissions: [
    { key: "view", label: "查看工作结果" },
    { key: "submit", label: "提交工作结果" },
    { key: "manage", label: "管理工作结果" },
  ] },
  { key: "actionStandards", title: "行动标准", permissions: [
    { key: "view", label: "查看行动标准" },
    { key: "manage", label: "管理行动标准" },
    { key: "publish", label: "发布或停用行动标准" },
  ] },
  { key: "templates", title: "模板中心", permissions: [
    { key: "view", label: "查看模板" },
    { key: "manage", label: "管理模板" },
    { key: "publish", label: "发布或停用模板" },
  ] },
  { key: "contentNotes", title: "发布内容笔记", permissions: [
    { key: "view", label: "查看发布内容笔记" },
    { key: "manage", label: "管理发布内容笔记" },
    { key: "export", label: "导出发布内容笔记" },
  ] },
  { key: "products", title: "产品", permissions: [
    { key: "view", label: "查看产品" },
    { key: "manage", label: "管理产品" },
    { key: "archive", label: "归档或恢复产品" },
    { key: "import", label: "导入产品数据" },
  ] },
  { key: "skus", title: "SKU", permissions: [
    { key: "view", label: "查看 SKU" },
    { key: "manage", label: "管理 SKU 及关系" },
  ] },
  { key: "combos", title: "组合装", permissions: [{ key: "view", label: "查看组合装" }] },
  { key: "links", title: "经营链接", permissions: [
    { key: "view", label: "查看经营链接" },
    { key: "manage", label: "管理链接档案与经营目标" },
    { key: "rating", label: "刷新链接评级" },
    { key: "diagnosis", label: "管理链接诊断" },
    { key: "improve", label: "管理链接改善" },
    { key: "import", label: "导入链接经营数据" },
    { key: "manageRelations", label: "管理链接数据关系" },
  ] },
  { key: "finance", title: "财务中心", permissions: [
    { key: "view", label: "查看财务数据" },
    { key: "maintain", label: "维护财务数据" },
    { key: "configureRules", label: "配置财务规则" },
    { key: "approve", label: "审批财务数据" },
  ] },
  { key: "contentCenter", title: "内容中心（公司共享）", permissions: [
    { key: "view", label: "查看公司品牌内容、候选及图片" },
    { key: "manage", label: "管理公司内容、排期和账号栏目" },
    { key: "export", label: "导出公司内容备份" },
  ] },
  { key: "dataCenter", title: "数据中心", permissions: [
    { key: "view", label: "查看数据同步状态" },
    { key: "run", label: "执行数据同步或导入" },
    { key: "manage", label: "管理数据同步配置" },
  ] },
  { key: "organization", title: "组织", permissions: [
    { key: "view", label: "查看组织架构" },
    { key: "manage", label: "管理组织架构" },
  ] },
  { key: "people", title: "人员", permissions: [
    { key: "view", label: "查看人员" },
    { key: "manage", label: "管理人员" },
    { key: "manageAccounts", label: "管理登录账号" },
  ] },
  { key: "permissions", title: "权限", permissions: [{ key: "manage", label: "管理权限" }] },
  { key: "dataAssets", title: "数据资产", permissions: [{ key: "view", label: "查看数据资产地图" }] },
  { key: "systemSettings", title: "系统配置", permissions: [{ key: "manage", label: "管理系统业务配置" }] },
  { key: "uploads", title: "上传", permissions: [
    { key: "image", label: "上传图片" },
    { key: "file", label: "上传通用文件" },
    { key: "standardWorkAttachment", label: "上传行动标准附件" },
  ] },
];

export const permissionCount = permissionGroups.reduce((total, group) => total + group.permissions.length, 0);

export const permissionDependencies = {
  "goals.manage": ["goals.view"],
  "goals.close": ["goals.view"],
  "keyActions.launch": ["keyActions.view", "actionStandards.view"],
  "keyActions.manage": ["keyActions.view"],
  "tasks.execute": ["tasks.view"],
  "tasks.manage": ["tasks.view"],
  "tasks.accept": ["tasks.view"],
  "tasks.cancel": ["tasks.view"],
  "workResults.submit": ["workResults.view"],
  "workResults.manage": ["workResults.view"],
  "actionStandards.manage": ["actionStandards.view"],
  "actionStandards.publish": ["actionStandards.view"],
  "templates.manage": ["templates.view"],
  "templates.publish": ["templates.view"],
  "contentNotes.manage": ["contentNotes.view"],
  "contentNotes.export": ["contentNotes.view"],
  "products.manage": ["products.view"],
  "products.archive": ["products.view"],
  "products.import": ["products.view"],
  "skus.manage": ["skus.view"],
  "links.manage": ["links.view"],
  "links.rating": ["links.view"],
  "links.diagnosis": ["links.view"],
  "links.improve": ["links.view"],
  "links.import": ["links.view"],
  "links.manageRelations": ["links.view"],
  "finance.maintain": ["finance.view"],
  "finance.configureRules": ["finance.view"],
  "finance.approve": ["finance.view"],
  "contentCenter.manage": ["contentCenter.view"],
  "contentCenter.export": ["contentCenter.view"],
  "dataCenter.run": ["dataCenter.view"],
  "dataCenter.manage": ["dataCenter.view"],
  "organization.manage": ["organization.view"],
  "people.manage": ["people.view"],
  "people.manageAccounts": ["people.view"],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parsePermissions(rawPermissions) {
  if (typeof rawPermissions !== "string") return rawPermissions;
  if (rawPermissions.trim() === "") return null;
  try { return JSON.parse(rawPermissions); } catch { return null; }
}

function createPermissionSkeleton(value = false, dataScope = "self") {
  const permissions = { permissionVersion: PERMISSION_SCHEMA_VERSION, dataScope };
  for (const group of permissionGroups) {
    permissions[group.key] = Object.fromEntries(group.permissions.map((item) => [item.key, value]));
  }
  permissions.keyActions.launchTemplateScope = value ? "all" : "selected";
  permissions.keyActions.launchTemplateIds = [];
  return permissions;
}

const superAdminPermissions = createPermissionSkeleton(true, "all");

export function createEmptyPermissions(dataScope = "self") {
  return createPermissionSkeleton(false, dataScope);
}

function isAdminRole(role) {
  return ["admin", "system_admin"].includes(role);
}

function readBoolean(source, path) {
  const [group, key] = path.split(".");
  return typeof source?.[group]?.[key] === "boolean" ? source[group][key] : undefined;
}

function anyLegacy(source, ...paths) {
  return paths.some((path) => readBoolean(source, path) === true);
}

function allLegacy(source, ...paths) {
  return paths.every((path) => readBoolean(source, path) === true);
}

function copyLaunchScope(target, source) {
  const v2 = source?.keyActions;
  const legacy = source?.workPlans;
  const scope = [v2?.launchTemplateScope, legacy?.launchTemplateScope]
    .find((value) => ["all", "selected"].includes(value));
  target.keyActions.launchTemplateScope = scope ?? (target.keyActions.launch ? "all" : "selected");
  const ids = Array.isArray(v2?.launchTemplateIds)
    ? v2.launchTemplateIds
    : Array.isArray(legacy?.launchTemplateIds)
      ? legacy.launchTemplateIds
      : [];
  target.keyActions.launchTemplateIds = [...new Set(ids.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function pruneUnsatisfiedDependencies(target) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [permissionKey, dependencies] of Object.entries(permissionDependencies)) {
      const [group, key] = permissionKey.split(".");
      if (target[group]?.[key] !== true) continue;
      const dependenciesSatisfied = dependencies.every((dependencyKey) => {
        const [dependencyGroup, dependency] = dependencyKey.split(".");
        return target[dependencyGroup]?.[dependency] === true;
      });
      if (dependenciesSatisfied) continue;
      target[group][key] = false;
      changed = true;
    }
  }
  return target;
}

function convertLegacyPermissions(source, role) {
  if (isAdminRole(role)) return clone(superAdminPermissions);
  const target = createEmptyPermissions(
    ["self", "department", "all"].includes(source?.dataScope) ? source.dataScope : "self",
  );
  if (source === null || typeof source !== "object") return target;

  const productView = anyLegacy(source, "products.view", "modules.products");
  const explicitLinkBoundary = readBoolean(source, "links.view") !== undefined || readBoolean(source, "modules.links") !== undefined;
  const linkView = explicitLinkBoundary ? anyLegacy(source, "links.view", "modules.links") : productView;
  const standardsManager = allLegacy(
    source,
    "processes.editTemplates",
    "processes.editSteps",
    "processes.sortSteps",
    "settings.editStandardWorks",
    "settings.editStandardWorkForms",
    "methods.create",
    "methods.edit",
  );

  target.cockpit.view = anyLegacy(source, "operations.view", "modules.operations", "dataCenter.view", "modules.dataCenter");
  target.goals.view = anyLegacy(source, "goals.view", "goals.viewDetail", "goals.viewRelatedData", "modules.goals");
  target.goals.manage = allLegacy(source, "goals.create", "goals.edit", "goals.dragAlign");
  target.goals.close = anyLegacy(source, "goals.delete");
  target.keyActions.view = anyLegacy(source, "processes.viewInstances");
  target.keyActions.launch = anyLegacy(source, "workPlans.launch");
  target.keyActions.manage = anyLegacy(source, "processes.editInstances");
  target.tasks.view = anyLegacy(source, "tasks.view", "tasks.viewDetail", "tasks.viewForm");
  target.tasks.execute = allLegacy(source, "tasks.submitResult", "tasks.changeStatus");
  target.tasks.manage = allLegacy(source, "tasks.changeStatus", "tasks.batchComplete");
  target.tasks.accept = anyLegacy(source, "tasks.changeStatus");
  target.tasks.cancel = anyLegacy(source, "tasks.batchCancel");
  target.workResults.view = anyLegacy(source, "assessment.view", "modules.assessment", "assessment.viewProblems");
  target.workResults.submit = anyLegacy(source, "assessment.fillWeeklyReport");
  target.workResults.manage = allLegacy(source, "assessment.editWeeklyReport", "assessment.updateProblems");
  target.actionStandards.view = anyLegacy(source, "processes.viewTemplates", "settings.viewStandardWorks", "methods.view", "modules.methods");
  target.actionStandards.manage = standardsManager;
  target.actionStandards.publish = standardsManager;
  target.templates.view = anyLegacy(source, "modules.templateCenter", "settings.viewStandardWorks", "processes.viewTemplates", "methods.view");
  target.templates.manage = standardsManager;
  target.templates.publish = standardsManager;
  target.contentNotes.view = anyLegacy(source, "contentSchedules.view");
  target.contentNotes.manage = allLegacy(source, "contentSchedules.create", "contentSchedules.edit", "contentSchedules.addToFuture", "contentSchedules.addToThisWeek", "contentSchedules.batchCancel");
  target.contentNotes.export = anyLegacy(source, "contentSchedules.export");
  target.products.view = productView;
  target.products.manage = allLegacy(source, "products.create", "products.edit");
  target.products.archive = anyLegacy(source, "products.archive");
  target.products.import = anyLegacy(source, "products.create");
  target.skus.view = productView;
  target.skus.manage = allLegacy(source, "products.create", "products.edit", "products.archive");
  target.combos.view = productView;
  target.links.view = linkView;
  target.links.manage = anyLegacy(source, "links.manage");
  target.links.rating = false;
  target.links.diagnosis = anyLegacy(source, "links.improve");
  target.links.improve = anyLegacy(source, "links.improve");
  target.links.import = anyLegacy(source, "links.import");
  target.links.manageRelations = allLegacy(source, "links.manage", "links.import");
  target.finance.view = anyLegacy(source, "finance.view", "modules.finance");
  target.finance.maintain = anyLegacy(source, "finance.manage");
  target.finance.configureRules = anyLegacy(source, "finance.manage");
  target.finance.approve = anyLegacy(source, "finance.approve");
  const dataCenterManager = anyLegacy(source, "settings.manageAdminDataCenter");
  target.dataCenter.view = dataCenterManager;
  target.dataCenter.run = dataCenterManager;
  target.dataCenter.manage = dataCenterManager;
  target.organization.view = anyLegacy(source, "settings.viewOrg", "settings.editOrg");
  target.organization.manage = anyLegacy(source, "settings.editOrg");
  target.people.view = anyLegacy(source, "settings.viewPeople", "settings.editPeople", "settings.managePermissions");
  target.people.manage = allLegacy(source, "settings.createPeople", "settings.editPeople", "settings.disablePeople");
  target.people.manageAccounts = anyLegacy(source, "settings.manageAccounts");
  target.permissions.manage = anyLegacy(source, "settings.managePermissions");
  target.dataAssets.view = anyLegacy(source, "settings.viewDataAssetMap");
  target.systemSettings.manage = allLegacy(source, "settings.editStores", "settings.editCategories", "settings.editStandardWorkForms");
  const explicitUploads = ["image", "file", "standardWorkAttachment"].some((key) => readBoolean(source, `uploads.${key}`) !== undefined);
  for (const key of ["image", "file", "standardWorkAttachment"]) {
    target.uploads[key] = explicitUploads ? readBoolean(source, `uploads.${key}`) === true : true;
  }
  copyLaunchScope(target, source);
  return pruneUnsatisfiedDependencies(target);
}

export function isV2Permissions(rawPermissions) {
  return parsePermissions(rawPermissions)?.permissionVersion === PERMISSION_SCHEMA_VERSION;
}

export function normalizePermissions(rawPermissions, role = "user") {
  if (isAdminRole(role)) return clone(superAdminPermissions);
  const source = parsePermissions(rawPermissions);
  if (!isV2Permissions(source)) return convertLegacyPermissions(source, role);
  const normalized = createEmptyPermissions(["self", "department", "all"].includes(source.dataScope) ? source.dataScope : "self");
  for (const group of permissionGroups) {
    for (const item of group.permissions) {
      if (typeof source[group.key]?.[item.key] === "boolean") normalized[group.key][item.key] = source[group.key][item.key];
    }
  }
  copyLaunchScope(normalized, source);
  return normalized;
}

function deepMergePermissionSource(base, overrides) {
  const merged = clone(base !== null && typeof base === "object" ? base : {});
  if (overrides === null || typeof overrides !== "object") return merged;
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = deepMergePermissionSource(merged[key], value);
    } else {
      merged[key] = clone(value);
    }
  }
  return merged;
}

function applyV2Overrides(basePermissions, overrides) {
  const merged = clone(basePermissions);
  if (overrides === null || typeof overrides !== "object") return merged;
  if (["self", "department", "all"].includes(overrides.dataScope)) merged.dataScope = overrides.dataScope;
  for (const group of permissionGroups) {
    for (const item of group.permissions) {
      if (typeof overrides[group.key]?.[item.key] === "boolean") merged[group.key][item.key] = overrides[group.key][item.key];
    }
  }
  copyLaunchScope(merged, { keyActions: { ...merged.keyActions, ...overrides.keyActions } });
  return merged;
}

export function mergePermissionSources(templatePermissions, personalOverrides, role = "user") {
  const template = parsePermissions(templatePermissions);
  const overrides = parsePermissions(personalOverrides);
  if (!isV2Permissions(template)) return normalizePermissions(deepMergePermissionSource(template, overrides), role);
  return applyV2Overrides(normalizePermissions(template, role), overrides);
}

export function createPermissionOverrides(templatePermissions, effectivePermissions, role = "user") {
  const base = normalizePermissions(templatePermissions, role);
  const effective = normalizePermissions(effectivePermissions, role);
  const overrides = { permissionVersion: PERMISSION_SCHEMA_VERSION };
  if (base.dataScope !== effective.dataScope) overrides.dataScope = effective.dataScope;
  for (const group of permissionGroups) {
    for (const item of group.permissions) {
      if (base[group.key][item.key] === effective[group.key][item.key]) continue;
      overrides[group.key] ??= {};
      overrides[group.key][item.key] = effective[group.key][item.key];
    }
  }
  const baseScope = base.keyActions.launchTemplateScope;
  const effectiveScope = effective.keyActions.launchTemplateScope;
  const baseIds = [...base.keyActions.launchTemplateIds].sort();
  const effectiveIds = [...effective.keyActions.launchTemplateIds].sort();
  if (baseScope !== effectiveScope || JSON.stringify(baseIds) !== JSON.stringify(effectiveIds)) {
    overrides.keyActions ??= {};
    overrides.keyActions.launchTemplateScope = effectiveScope;
    overrides.keyActions.launchTemplateIds = effectiveIds;
  }
  return overrides;
}

export function serializePermissions(permissions, role = "user") {
  return JSON.stringify(normalizePermissions(permissions, role));
}

function permissionPayloadOf(userOrPermissions) {
  if (isV2Permissions(userOrPermissions)) return userOrPermissions;
  if (userOrPermissions?.permissions !== undefined && (userOrPermissions?.role !== undefined || userOrPermissions?.authRole !== undefined)) {
    return userOrPermissions.permissions;
  }
  return userOrPermissions;
}

export function hasPermission(userOrPermissions, permissionPath) {
  const permissions = permissionPayloadOf(userOrPermissions);
  const normalized = normalizePermissions(permissions, userOrPermissions?.role ?? userOrPermissions?.authRole ?? "user");
  const [group, key] = permissionPath.split(".");
  return normalized[group]?.[key] === true;
}

export function validatePermissionDependencies(rawPermissions, role = "user") {
  const permissions = normalizePermissions(rawPermissions, role);
  const errors = [];
  for (const [permission, dependencies] of Object.entries(permissionDependencies)) {
    if (!hasPermission(permissions, permission)) continue;
    const missing = dependencies.filter((dependency) => !hasPermission(permissions, dependency));
    if (missing.length > 0) errors.push({ permission, missing });
  }
  return errors;
}

export function canLaunchActionTemplate(userOrPermissions, templateId) {
  const role = userOrPermissions?.role ?? userOrPermissions?.authRole ?? "";
  if (isAdminRole(role)) return true;
  if (!hasPermission(userOrPermissions, "keyActions.launch")) return false;
  const permissions = normalizePermissions(permissionPayloadOf(userOrPermissions), role || "user");
  if (permissions.keyActions.launchTemplateScope === "all") return true;
  return permissions.keyActions.launchTemplateIds.includes(String(templateId ?? ""));
}

export function canLaunchAnyActionTemplate(userOrPermissions, templates = []) {
  return templates.some((template) => canLaunchActionTemplate(userOrPermissions, template?.id));
}

export function canAccessTemplateCenter(userOrPermissions) {
  return hasPermission(userOrPermissions, "templates.view") || hasPermission(userOrPermissions, "actionStandards.view");
}

export function canAccessModule(userOrPermissions, moduleId) {
  const modulePermissions = {
    dashboard: ["cockpit.view", "workResults.view"],
    goals: ["goals.view"],
    scheduleBoard: ["keyActions.view", "contentNotes.view"],
    tasks: ["tasks.view"],
    connectionCenter: ["links.view"],
    products: ["products.view", "skus.view", "combos.view"],
    financeCenter: ["finance.view"],
    contentCenter: ["contentCenter.view"],
    adminDataCenter: ["dataCenter.view"],
    templateCenter: ["templates.view", "actionStandards.view"],
    processes: ["actionStandards.view"],
    settings: ["organization.view", "people.view", "permissions.manage", "dataAssets.view", "systemSettings.manage"],
  };
  return (modulePermissions[moduleId] ?? []).some((permission) => hasPermission(userOrPermissions, permission));
}

export function getDataScope(userOrPermissions) {
  const permissions = permissionPayloadOf(userOrPermissions);
  return normalizePermissions(permissions, userOrPermissions?.role ?? userOrPermissions?.authRole ?? "user").dataScope;
}

export function getFirstAccessibleModule(userOrPermissions, modules = []) {
  return modules.find((module) => canAccessModule(userOrPermissions, module.id)) ?? null;
}
