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
  {
    key: "modules",
    title: "模块访问权限",
    permissions: [
      { key: "goals", label: "可访问目标模块" },
      { key: "execution", label: "可访问任务模块" },
      { key: "processes", label: "可访问关键行动模块" },
      { key: "assessment", label: "可访问工作结果模块" },
      { key: "methods", label: "可访问关键行动方法论" },
      { key: "settings", label: "可访问设置模块" },
      { key: "products", label: "可访问产品中心" },
      { key: "dataCenter", label: "可访问数据中心" },
    ],
  },
  {
    key: "goals",
    title: "目标权限",
    permissions: [
      { key: "view", label: "查看目标" },
      { key: "create", label: "新增目标" },
      { key: "edit", label: "编辑目标" },
      { key: "delete", label: "停用 / 删除目标" },
      { key: "viewDetail", label: "查看目标详情" },
      { key: "dragAlign", label: "拖拽调整目标对齐" },
      { key: "addWork", label: "在目标卡片发起关键行动" },
      { key: "viewRelatedData", label: "查看目标关联数据" },
    ],
  },
  {
    key: "workPlans",
    title: "关键行动发起权限",
    permissions: [
      { key: "launch", label: "发起关键行动" },
      { key: "batchOperate", label: "批量操作关键行动" },
    ],
  },
  {
    key: "products",
    title: "产品中心权限",
    permissions: [
      { key: "view", label: "查看产品" },
      { key: "create", label: "新增产品" },
      { key: "edit", label: "编辑产品" },
      { key: "archive", label: "归档产品" },
    ],
  },
  {
    key: "dataCenter",
    title: "数据中心权限",
    permissions: [
      { key: "view", label: "查看数据中心" },
    ],
  },
  {
    key: "tasks",
    title: "任务权限",
    permissions: [
      { key: "view", label: "查看任务" },
      { key: "viewDetail", label: "查看任务详情" },
      { key: "viewForm", label: "查看任务表单" },
      { key: "submitResult", label: "提交任务结果" },
      { key: "changeStatus", label: "修改任务状态" },
      { key: "batchComplete", label: "批量完成任务" },
      { key: "batchCancel", label: "批量取消任务" },
      { key: "viewProcessProgress", label: "查看关键行动进度" },
    ],
  },
  {
    key: "processes",
    title: "关键行动权限",
    permissions: [
      { key: "viewTemplates", label: "查看关键行动标准流程" },
      { key: "editTemplates", label: "编辑关键行动标准流程" },
      { key: "editSteps", label: "新增 / 编辑标准步骤" },
      { key: "sortSteps", label: "调整标准步骤顺序" },
      { key: "viewInstances", label: "查看已发起关键行动" },
      { key: "editInstances", label: "编辑已发起关键行动" },
      { key: "viewForm", label: "查看标准表单" },
    ],
  },
  {
    key: "contentSchedules",
    title: "发布内容笔记权限",
    permissions: [
      { key: "view", label: "查看发布内容笔记" },
      { key: "create", label: "单条发起发布内容笔记" },
      { key: "edit", label: "编辑历史内容排期" },
      { key: "import", label: "批量发起发布内容笔记" },
      { key: "export", label: "导出发布内容笔记" },
      { key: "addToFuture", label: "历史排期转待发起工作计划" },
      { key: "addToThisWeek", label: "历史排期直接发起关键行动" },
      { key: "batchCancel", label: "批量取消内容" },
    ],
  },
  {
    key: "assessment",
    title: "工作结果权限",
    permissions: [
      { key: "view", label: "访问工作结果模块" },
      { key: "viewAll", label: "查看全部工作结果数据" },
      { key: "viewDepartment", label: "查看本部门工作结果数据" },
      { key: "viewSelf", label: "查看自己的工作结果数据" },
      { key: "fillWeeklyReport", label: "填写目标推进周报" },
      { key: "editWeeklyReport", label: "编辑目标推进周报" },
      { key: "viewProblems", label: "查看问题汇总" },
      { key: "updateProblems", label: "更新问题状态" },
    ],
  },
  {
    key: "methods",
    title: "方法论权限",
    permissions: [
      { key: "view", label: "查看方法论" },
      { key: "create", label: "新增方法论" },
      { key: "edit", label: "编辑方法论" },
    ],
  },
  {
    key: "settings",
    title: "设置权限",
    permissions: [
      { key: "viewOrg", label: "查看组织架构" },
      { key: "editOrg", label: "编辑组织架构" },
      { key: "viewPeople", label: "查看人员管理" },
      { key: "createPeople", label: "新增人员" },
      { key: "editPeople", label: "编辑人员" },
      { key: "disablePeople", label: "停用人员" },
      { key: "manageAccounts", label: "管理账号" },
      { key: "managePermissions", label: "管理权限" },
      { key: "viewStandardWorks", label: "查看关键行动库" },
      { key: "editStandardWorks", label: "编辑关键行动库" },
      { key: "editStandardWorkForms", label: "配置关键行动表单" },
      { key: "viewStores", label: "查看店铺管理" },
      { key: "editStores", label: "编辑店铺管理" },
      { key: "editCategories", label: "编辑分类设置" },
    ],
  },
];

export const permissionCount = permissionGroups.reduce((total, group) => total + group.permissions.length, 0);

function createPermissionSkeleton(value = false, dataScope = "department") {
  const permissions = { dataScope };
  for (const group of permissionGroups) {
    permissions[group.key] = Object.fromEntries(group.permissions.map((item) => [item.key, value]));
  }
  permissions.workPlans.launchTemplateScope = value ? "all" : "selected";
  permissions.workPlans.launchTemplateIds = [];
  return permissions;
}

const superAdminPermissions = createPermissionSkeleton(true, "all");

const employeePermissions = createPermissionSkeleton(false, "self");
Object.assign(employeePermissions.modules, { execution: true, methods: true });
Object.assign(employeePermissions.tasks, { view: true, viewDetail: true, viewForm: true, submitResult: true, changeStatus: true });
Object.assign(employeePermissions.assessment, { viewSelf: true });
Object.assign(employeePermissions.methods, { view: true });

function clonePermissions(permissions) {
  return JSON.parse(JSON.stringify(permissions));
}

export function createEmptyPermissions(dataScope = "self") {
  return createPermissionSkeleton(false, dataScope);
}

function getDefaultPermissions(role = "user") {
  return clonePermissions(role === "admin" ? superAdminPermissions : employeePermissions);
}

function applyLegacyPermissionCompatibility(normalized, source) {
  const isPermissionManager = source?.modules?.settings === true && source?.settings?.managePermissions === true;
  if (!isPermissionManager) return;

  if (typeof source.modules?.assessment !== "boolean") normalized.modules.assessment = true;
  if (typeof source.modules?.methods !== "boolean") normalized.modules.methods = true;
  if (typeof source.assessment !== "object" || source.assessment === null) {
    Object.assign(normalized.assessment, {
      view: true,
      viewAll: true,
      fillWeeklyReport: true,
      editWeeklyReport: true,
      viewProblems: true,
      updateProblems: true,
    });
  }
  if (typeof source.methods !== "object" || source.methods === null) {
    Object.assign(normalized.methods, { view: true, create: true, edit: true });
  }
  if (typeof source.settings?.viewStores !== "boolean") normalized.settings.viewStores = true;
  if (typeof source.settings?.editStores !== "boolean") normalized.settings.editStores = true;
}

function canAutoGrantContentScheduleOperations(role) {
  return ["admin", "system_admin", "company_manager"].includes(role);
}

function applyContentSchedulePermissionCompatibility(normalized, source, role) {
  if (source.contentSchedules?.view === true && canAutoGrantContentScheduleOperations(role)) {
    Object.assign(normalized.contentSchedules, {
      create: true,
      edit: true,
      import: true,
      export: true,
      addToFuture: true,
      addToThisWeek: true,
      batchCancel: true,
    });
  }
}

function normalizeProductCenterAccess(normalized) {
  const canViewProducts = normalized.modules.products === true || normalized.products.view === true;
  normalized.modules.products = canViewProducts;
  normalized.products.view = canViewProducts;
}

function normalizeActionLaunchPermissions(normalized, source) {
  const sourceWorkPlans = source?.workPlans;
  const hasExplicitScope = ["all", "selected"].includes(sourceWorkPlans?.launchTemplateScope);
  normalized.workPlans.launchTemplateScope = hasExplicitScope
    ? sourceWorkPlans.launchTemplateScope
    : normalized.workPlans.launch
      ? "all"
      : "selected";
  normalized.workPlans.launchTemplateIds = Array.isArray(sourceWorkPlans?.launchTemplateIds)
    ? [...new Set(sourceWorkPlans.launchTemplateIds.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];
}

export function normalizePermissions(rawPermissions, role = "user") {
  let source = rawPermissions;
  if (typeof rawPermissions === "string" && rawPermissions.trim() !== "") {
    try {
      source = JSON.parse(rawPermissions);
    } catch {
      source = null;
    }
  }

  const normalized = getDefaultPermissions(role);
  if (source !== null && typeof source === "object") {
    for (const group of permissionGroups) {
      for (const item of group.permissions) {
        if (typeof source[group.key]?.[item.key] === "boolean") {
          normalized[group.key][item.key] = source[group.key][item.key];
        }
      }
    }
    if (["self", "department", "all"].includes(source.dataScope)) normalized.dataScope = source.dataScope;
    applyLegacyPermissionCompatibility(normalized, source);
    applyContentSchedulePermissionCompatibility(normalized, source, role);
  }
  normalizeProductCenterAccess(normalized);
  normalizeActionLaunchPermissions(normalized, source);

  return normalized;
}

function applyPermissionOverrides(basePermissions, overrides) {
  const merged = clonePermissions(basePermissions);
  if (overrides === null || typeof overrides !== "object") return merged;
  if (["self", "department", "all"].includes(overrides.dataScope)) merged.dataScope = overrides.dataScope;
  for (const group of permissionGroups) {
    for (const item of group.permissions) {
      if (typeof overrides[group.key]?.[item.key] === "boolean") {
        merged[group.key][item.key] = overrides[group.key][item.key];
      }
    }
  }
  const overrideWorkPlans = overrides.workPlans;
  if (["all", "selected"].includes(overrideWorkPlans?.launchTemplateScope)) {
    merged.workPlans.launchTemplateScope = overrideWorkPlans.launchTemplateScope;
  }
  if (Array.isArray(overrideWorkPlans?.launchTemplateIds)) {
    merged.workPlans.launchTemplateIds = [...new Set(overrideWorkPlans.launchTemplateIds.map(String).filter(Boolean))];
  }
  return merged;
}

export function mergePermissionSources(templatePermissions, personalOverrides, role = "user") {
  const basePermissions = normalizePermissions(templatePermissions, role);
  return applyPermissionOverrides(basePermissions, personalOverrides);
}

export function createPermissionOverrides(templatePermissions, effectivePermissions, role = "user") {
  const base = normalizePermissions(templatePermissions, role);
  const effective = normalizePermissions(effectivePermissions, role);
  const overrides = {};
  if (base.dataScope !== effective.dataScope) overrides.dataScope = effective.dataScope;
  for (const group of permissionGroups) {
    for (const item of group.permissions) {
      if (base[group.key][item.key] === effective[group.key][item.key]) continue;
      overrides[group.key] ??= {};
      overrides[group.key][item.key] = effective[group.key][item.key];
    }
  }
  const baseScope = base.workPlans.launchTemplateScope;
  const effectiveScope = effective.workPlans.launchTemplateScope;
  const baseIds = [...base.workPlans.launchTemplateIds].sort();
  const effectiveIds = [...effective.workPlans.launchTemplateIds].sort();
  if (baseScope !== effectiveScope || JSON.stringify(baseIds) !== JSON.stringify(effectiveIds)) {
    overrides.workPlans ??= {};
    overrides.workPlans.launchTemplateScope = effectiveScope;
    overrides.workPlans.launchTemplateIds = effectiveIds;
  }
  return overrides;
}

export function serializePermissions(permissions) {
  return JSON.stringify(normalizePermissions(permissions));
}

export function hasPermission(userOrPermissions, permissionPath) {
  const permissions = userOrPermissions?.permissions ?? userOrPermissions;
  const normalized = normalizePermissions(permissions, userOrPermissions?.role ?? userOrPermissions?.authRole ?? "user");
  const [group, key] = permissionPath.split(".");
  return normalized[group]?.[key] === true;
}

function isAdminUser(userOrPermissions) {
  const role = userOrPermissions?.role ?? userOrPermissions?.authRole ?? "";
  return ["admin", "system_admin"].includes(role);
}

export function canLaunchActionTemplate(userOrPermissions, templateId) {
  if (isAdminUser(userOrPermissions)) return true;
  if (!hasPermission(userOrPermissions, "workPlans.launch")) return false;
  const permissions = normalizePermissions(
    userOrPermissions?.permissions ?? userOrPermissions,
    userOrPermissions?.role ?? userOrPermissions?.authRole ?? "user",
  );
  if (permissions.workPlans.launchTemplateScope === "all") return true;
  return permissions.workPlans.launchTemplateIds.includes(String(templateId ?? ""));
}

export function canLaunchAnyActionTemplate(userOrPermissions, templates = []) {
  return templates.some((template) => canLaunchActionTemplate(userOrPermissions, template?.id));
}

export function canAccessTemplateCenter(userOrPermissions) {
  if (userOrPermissions === null || userOrPermissions === undefined) return false;
  const role = userOrPermissions.role ?? userOrPermissions.authRole ?? "user";
  if (["admin", "system_admin", "company_manager"].includes(role)) return true;
  if (hasPermission(userOrPermissions, "settings.viewStandardWorks")) return true;

  // 临时兼容：模板中心还没有独立权限项，先按视觉/营销/运营/渠道相关部门开放。
  const departmentId = String(userOrPermissions.departmentId ?? "").toLowerCase();
  const departmentName = String(userOrPermissions.departmentName ?? userOrPermissions.department ?? "").toLowerCase();
  const allowedDepartmentIds = new Set(["dept-marketing", "dept-channel", "dept-operation", "dept-visual", "dept-visual-marketing"]);
  if (allowedDepartmentIds.has(departmentId)) return true;
  return /视觉|营销|运营|渠道|内容/.test(departmentName);
}

export function canAccessModule(userOrPermissions, moduleId) {
  if (moduleId === "templateCenter") return canAccessTemplateCenter(userOrPermissions);
  if (moduleId === "processes") {
    return hasPermission(userOrPermissions, "modules.processes") ||
      hasPermission(userOrPermissions, "modules.methods") ||
      hasPermission(userOrPermissions, "settings.viewStandardWorks");
  }
  const modulePermissionMap = {
    goals: "goals",
    tasks: "execution",
    scheduleBoard: "execution",
    processes: "processes",
    assessment: "assessment",
    methods: "methods",
    settings: "settings",
    products: "products",
    dataCenter: "dataCenter",
  };
  const permissionKey = modulePermissionMap[moduleId] ?? moduleId;
  if (moduleId === "products") {
    return hasPermission(userOrPermissions, "products.view");
  }
  if (moduleId === "dataCenter") {
    return hasPermission(userOrPermissions, "dataCenter.view");
  }
  return hasPermission(userOrPermissions, `modules.${permissionKey}`);
}

export function getDataScope(userOrPermissions) {
  const permissions = userOrPermissions?.permissions ?? userOrPermissions;
  return normalizePermissions(permissions, userOrPermissions?.role ?? userOrPermissions?.authRole ?? "user").dataScope;
}

export function getFirstAccessibleModule(userOrPermissions, modules = []) {
  return modules.find((module) => canAccessModule(userOrPermissions, module.id)) ?? null;
}
