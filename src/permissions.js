export const dataScopeOptions = [
  { value: "self", label: "只看自己的数据" },
  { value: "department", label: "只看本部门数据" },
  { value: "all", label: "看全部数据" },
];

export const permissionGroups = [
  {
    key: "modules",
    title: "模块访问权限",
    permissions: [
      { key: "goals", label: "可访问目标模块" },
      { key: "execution", label: "可访问执行模块" },
      { key: "processes", label: "可访问流程模块" },
      { key: "priority", label: "可访问优先级模块" },
      { key: "assessment", label: "可访问考核模块" },
      { key: "methods", label: "可访问方法论模块" },
      { key: "settings", label: "可访问设置模块" },
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
      { key: "addWork", label: "在目标卡片添加工作" },
      { key: "viewRelatedData", label: "查看目标关联数据" },
    ],
  },
  {
    key: "workPlans",
    title: "工作 / 优先级权限",
    permissions: [
      { key: "viewFuture", label: "查看未来工作" },
      { key: "createFuture", label: "新增未来工作" },
      { key: "editFuture", label: "编辑未来工作" },
      { key: "cancelFuture", label: "取消未来工作" },
      { key: "joinThisWeek", label: "加入本周工作" },
      { key: "viewThisWeek", label: "查看本周工作" },
      { key: "returnToFuture", label: "退回未来工作" },
      { key: "launch", label: "发起工作" },
      { key: "batchOperate", label: "批量操作工作" },
    ],
  },
  {
    key: "tasks",
    title: "执行任务权限",
    permissions: [
      { key: "view", label: "查看执行任务" },
      { key: "viewDetail", label: "查看任务详情" },
      { key: "viewForm", label: "查看任务表单" },
      { key: "submitResult", label: "提交任务结果" },
      { key: "changeStatus", label: "修改任务状态" },
      { key: "batchComplete", label: "批量完成任务" },
      { key: "batchCancel", label: "批量取消任务" },
      { key: "viewProcessProgress", label: "查看标准工作流程进度" },
    ],
  },
  {
    key: "processes",
    title: "流程权限",
    permissions: [
      { key: "viewTemplates", label: "查看标准流程" },
      { key: "editTemplates", label: "编辑标准流程" },
      { key: "editSteps", label: "新增 / 编辑流程步骤" },
      { key: "sortSteps", label: "调整流程步骤顺序" },
      { key: "viewInstances", label: "查看已发起流程" },
      { key: "editInstances", label: "编辑已发起流程" },
      { key: "viewForm", label: "查看流程表单" },
    ],
  },
  {
    key: "contentSchedules",
    title: "内容排期权限",
    permissions: [
      { key: "view", label: "查看内容排期" },
      { key: "create", label: "新增内容排期" },
      { key: "edit", label: "编辑内容排期" },
      { key: "import", label: "导入内容排期" },
      { key: "export", label: "导出内容排期" },
      { key: "addToFuture", label: "加入未来工作" },
      { key: "addToThisWeek", label: "加入本周工作" },
      { key: "batchCancel", label: "批量取消内容" },
    ],
  },
  {
    key: "assessment",
    title: "考核权限",
    permissions: [
      { key: "view", label: "访问考核模块" },
      { key: "viewAll", label: "查看全部考核数据" },
      { key: "viewDepartment", label: "查看本部门考核数据" },
      { key: "viewSelf", label: "查看自己的考核数据" },
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
      { key: "viewStandardWorks", label: "查看标准工作库" },
      { key: "editStandardWorks", label: "编辑标准工作库" },
      { key: "editStandardWorkForms", label: "配置标准工作表单" },
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
  return permissions;
}

const superAdminPermissions = createPermissionSkeleton(true, "all");

const bossPermissions = createPermissionSkeleton(false, "all");
Object.assign(bossPermissions.modules, { goals: true, execution: true, processes: true, priority: true, assessment: true, methods: true, settings: true });
Object.assign(bossPermissions.goals, { view: true, create: true, edit: true, viewDetail: true, addWork: true, viewRelatedData: true });
Object.assign(bossPermissions.workPlans, { viewFuture: true, joinThisWeek: true, viewThisWeek: true, launch: true });
Object.assign(bossPermissions.tasks, { view: true, viewDetail: true, viewForm: true, viewProcessProgress: true });
Object.assign(bossPermissions.processes, { viewInstances: true, viewForm: true });
Object.assign(bossPermissions.contentSchedules, { view: true });
Object.assign(bossPermissions.assessment, { view: true, viewAll: true, viewProblems: true, updateProblems: true });
Object.assign(bossPermissions.methods, { view: true });
Object.assign(bossPermissions.settings, { viewOrg: true, viewPeople: true, viewStandardWorks: true, viewStores: true });

const departmentLeaderPermissions = createPermissionSkeleton(false, "department");
Object.assign(departmentLeaderPermissions.modules, { goals: true, execution: true, processes: true, priority: true, assessment: true, methods: true });
Object.assign(departmentLeaderPermissions.goals, { view: true, viewDetail: true, addWork: true });
Object.assign(departmentLeaderPermissions.workPlans, { viewFuture: true, createFuture: true, joinThisWeek: true, viewThisWeek: true, launch: true });
Object.assign(departmentLeaderPermissions.tasks, { view: true, viewDetail: true, viewForm: true, submitResult: true, changeStatus: true, viewProcessProgress: true });
Object.assign(departmentLeaderPermissions.processes, { viewInstances: true, viewForm: true });
Object.assign(departmentLeaderPermissions.assessment, { view: true, viewDepartment: true, fillWeeklyReport: true, editWeeklyReport: true, viewProblems: true });
Object.assign(departmentLeaderPermissions.methods, { view: true });

const employeePermissions = createPermissionSkeleton(false, "self");
Object.assign(employeePermissions.modules, { execution: true, methods: true });
Object.assign(employeePermissions.tasks, { view: true, viewDetail: true, viewForm: true, submitResult: true, changeStatus: true });
Object.assign(employeePermissions.assessment, { viewSelf: true });
Object.assign(employeePermissions.methods, { view: true });

export const permissionTemplates = {
  superAdmin: { label: "套用超级管理员权限", permissions: superAdminPermissions },
  boss: { label: "套用老板权限", permissions: bossPermissions },
  departmentLeader: { label: "套用部门负责人权限", permissions: departmentLeaderPermissions },
  employee: { label: "套用普通员工权限", permissions: employeePermissions },
};

function clonePermissions(permissions) {
  return JSON.parse(JSON.stringify(permissions));
}

function getDefaultPermissions(role = "user") {
  return clonePermissions(role === "admin" ? superAdminPermissions : employeePermissions);
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
  }

  return normalized;
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

export function canAccessModule(userOrPermissions, moduleId) {
  const modulePermissionMap = {
    goals: "goals",
    tasks: "execution",
    processes: "processes",
    time: "priority",
    assessment: "assessment",
    methods: "methods",
    settings: "settings",
  };
  const permissionKey = modulePermissionMap[moduleId] ?? moduleId;
  return hasPermission(userOrPermissions, `modules.${permissionKey}`);
}

export function getDataScope(userOrPermissions) {
  const permissions = userOrPermissions?.permissions ?? userOrPermissions;
  return normalizePermissions(permissions, userOrPermissions?.role ?? userOrPermissions?.authRole ?? "user").dataScope;
}

export function getFirstAccessibleModule(userOrPermissions, modules = []) {
  return modules.find((module) => canAccessModule(userOrPermissions, module.id)) ?? null;
}

export function applyPermissionTemplate(templateKey) {
  return clonePermissions(permissionTemplates[templateKey]?.permissions ?? employeePermissions);
}
