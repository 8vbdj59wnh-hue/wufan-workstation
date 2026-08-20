// Canonical permission definitions and guards shared by browser and server code.
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
      { key: "links", label: "可访问链接中心" },
      { key: "supplyChain", label: "可访问供应链中心" },
      { key: "operations", label: "可查看经营驾驶舱" },
      { key: "finance", label: "可访问财务中心" },
      { key: "customers", label: "可访问客户中心" },
      { key: "aiAssistant", label: "可访问AI经营助手" },
      { key: "templateCenter", label: "可访问模板中心" },
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
    key: "links",
    title: "链接中心权限",
    permissions: [
      { key: "view", label: "查看链接" },
      { key: "manage", label: "管理链接档案与经营配置" },
      { key: "import", label: "导入链接与经营数据" },
      { key: "health", label: "查看链接体检" },
      { key: "manageHealth", label: "创建和管理链接体检" },
      { key: "improve", label: "发起和管理链接改善" },
    ],
  },
  {
    key: "supplyChain",
    title: "供应链中心权限",
    permissions: [
      { key: "view", label: "查看供应链数据" },
      { key: "manage", label: "管理供应商与合作产品" },
      { key: "purchase", label: "管理采购记录" },
      { key: "quality", label: "管理品质问题" },
    ],
  },
  {
    key: "operations",
    title: "经营权限",
    permissions: [
      { key: "view", label: "查看经营驾驶舱" },
    ],
  },
  {
    key: "finance",
    title: "财务中心权限",
    permissions: [
      { key: "view", label: "查看财务数据" },
      { key: "manage", label: "导入和管理财务数据" },
      { key: "approve", label: "审核财务数据" },
    ],
  },
  {
    key: "customers",
    title: "客户中心权限",
    permissions: [
      { key: "view", label: "查看客户（隐私信息脱敏）" },
      { key: "manage", label: "管理客户档案与消费记录" },
      { key: "maintain", label: "维护客户标签与跟进" },
      { key: "analyze", label: "查看客户价值分析" },
    ],
  },
  {
    key: "aiAssistant",
    title: "AI经营助手权限",
    permissions: [
      { key: "view", label: "查看AI经营分析" },
      { key: "analyze", label: "生成可追溯经营分析" },
      { key: "confirm", label: "人工确认分析建议" },
      { key: "createAction", label: "将已确认建议转为关键行动" },
    ],
  },
  {
    key: "uploads",
    title: "上传权限",
    permissions: [
      { key: "image", label: "上传图片" },
      { key: "file", label: "上传通用文件" },
      { key: "standardWorkAttachment", label: "上传关键行动表格附件" },
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
      { key: "viewDataAssetMap", label: "查看数据资产地图" },
      { key: "manageAdminDataCenter", label: "管理管理员数据中心" },
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
  if (typeof source?.operations?.view !== "boolean") {
    if (typeof source?.dataCenter?.view === "boolean") normalized.operations.view = source.dataCenter.view;
    else if (typeof source?.modules?.dataCenter === "boolean") normalized.operations.view = source.modules.dataCenter;
  }
  if (typeof source?.modules?.operations !== "boolean" && typeof source?.modules?.dataCenter === "boolean") {
    normalized.modules.operations = source.modules.dataCenter;
  }
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

function applyLegacyUploadPermissionCompatibility(normalized, source) {
  const hasExplicitUploadBoundary = ["image", "file", "standardWorkAttachment"]
    .some((permissionKey) => typeof source?.uploads?.[permissionKey] === "boolean");
  if (hasExplicitUploadBoundary) return;
  Object.assign(normalized.uploads, {
    image: true,
    file: true,
    standardWorkAttachment: true,
  });
}

function normalizeProductCenterAccess(normalized) {
  const canViewProducts = normalized.modules.products === true || normalized.products.view === true;
  normalized.modules.products = canViewProducts;
  normalized.products.view = canViewProducts;
}

const legacyBusinessPermissionMappings = {
  links: {
    moduleKey: "links",
    permissions: {
      view: "view",
      manage: "edit",
      import: "edit",
      health: "view",
      manageHealth: "edit",
      improve: "edit",
    },
  },
  supplyChain: {
    moduleKey: "supplyChain",
    permissions: {
      view: "view",
      manage: "edit",
      purchase: "edit",
      quality: "edit",
    },
  },
};

function hasExplicitBusinessPermissionBoundary(source, groupKey, definition) {
  return typeof source?.modules?.[definition.moduleKey] === "boolean" ||
    typeof source?.[groupKey]?.view === "boolean";
}

function applyLegacyBusinessPermissionCompatibility(normalized, source) {
  for (const [groupKey, definition] of Object.entries(legacyBusinessPermissionMappings)) {
    if (hasExplicitBusinessPermissionBoundary(source, groupKey, definition)) continue;
    normalized.modules[definition.moduleKey] = normalized.modules.products;
    for (const [permissionKey, productPermissionKey] of Object.entries(definition.permissions)) {
      if (typeof source?.[groupKey]?.[permissionKey] === "boolean") continue;
      normalized[groupKey][permissionKey] = normalized.products[productPermissionKey] === true;
    }
  }
  if (typeof source?.links?.health === "boolean" && typeof source?.links?.manageHealth !== "boolean") {
    normalized.links.manageHealth = source.links.health;
  }
}

function normalizeBusinessModuleAccess(normalized) {
  for (const [groupKey, definition] of Object.entries(legacyBusinessPermissionMappings)) {
    const canView = normalized.modules[definition.moduleKey] === true || normalized[groupKey].view === true;
    normalized.modules[definition.moduleKey] = canView;
    normalized[groupKey].view = canView;
  }
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
  applyLegacyUploadPermissionCompatibility(normalized, source);
  normalizeProductCenterAccess(normalized);
  applyLegacyBusinessPermissionCompatibility(normalized, source);
  normalizeBusinessModuleAccess(normalized);
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
  if (hasPermission(userOrPermissions, "modules.templateCenter")) return true;
  if (hasPermission(userOrPermissions, "settings.viewStandardWorks")) return true;
  if (hasPermission(userOrPermissions, "processes.viewTemplates")) return true;
  return hasPermission(userOrPermissions, "methods.view");
}

export function canAccessModule(userOrPermissions, moduleId) {
  if (moduleId === "dashboard") {
    return hasPermission(userOrPermissions, "operations.view") || hasPermission(userOrPermissions, "assessment.view");
  }
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
    operationDashboard: "operations",
    adminDataCenter: "settings",
    financeCenter: "finance",
    connectionCenter: "links",
    supplyChainCenter: "supplyChain",
    customerCenter: "customers",
    aiOperationAssistant: "aiAssistant",
  };
  const permissionKey = modulePermissionMap[moduleId] ?? moduleId;
  if (moduleId === "products") {
    return hasPermission(userOrPermissions, "products.view");
  }
  if (moduleId === "operationDashboard") {
    return hasPermission(userOrPermissions, "operations.view");
  }
  if (moduleId === "adminDataCenter") {
    const role = userOrPermissions?.role ?? userOrPermissions?.authRole ?? "";
    return ["admin", "system_admin"].includes(role) && hasPermission(userOrPermissions, "settings.manageAdminDataCenter");
  }
  if (moduleId === "financeCenter") {
    return hasPermission(userOrPermissions, "finance.view");
  }
  if (moduleId === "connectionCenter") {
    return hasPermission(userOrPermissions, "links.view");
  }
  if (moduleId === "supplyChainCenter") {
    return hasPermission(userOrPermissions, "supplyChain.view");
  }
  if (moduleId === "customerCenter") {
    return hasPermission(userOrPermissions, "customers.view");
  }
  if (moduleId === "aiOperationAssistant") {
    return hasPermission(userOrPermissions, "aiAssistant.view");
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
