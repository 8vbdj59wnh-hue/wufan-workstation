import {
  categories as initialCategories,
  companies as initialCompanies,
  contentSchedules as initialContentSchedules,
  departments as initialDepartments,
  goals as initialGoals,
  people as initialPeople,
  positions as initialPositions,
  processInstances as initialProcessInstances,
  processTemplateNodes as initialProcessTemplateNodes,
  processTemplates as initialProcessTemplates,
  stores as initialStores,
  taskTemplates as initialTaskTemplates,
  tasks as initialTasks,
  weeklyReportProblems as initialWeeklyReportProblems,
  weeklyReports as initialWeeklyReports,
  methodologies as initialMethodologies,
  workPlans as initialWorkPlans,
} from "./data/mockData.js?v=20260627-methods1";
import {
  CategoryType,
  PersonRole,
  ProcessAccepterRule,
  ProcessInstanceStatus,
  ProcessOwnerRule,
  ProcessTemplateNodeStatus,
  ProcessTemplateStatus,
  Status,
  SubmitType,
  TaskImportance,
  TaskSource,
  TaskStatus,
  TaskTemplateStatus,
  TaskUrgency,
} from "./data/modelOptions.js";
import { getPrimaryImageUrl } from "./data/taskUtils.js?v=20260627-methods1";

const apiPort = "3001";
const apiBaseUrl = `${window.location.protocol}//${window.location.hostname}:${apiPort}`;
const authTokenKey = "wufanAuthToken";
let persistenceAvailable = false;
let loadedFromDatabase = false;
let currentUser = null;
let persistenceStatus = {
  kind: "warning",
  message: "",
};
let saveTimer = null;
let isApplyingRemoteData = false;
let hasPendingPersistentChanges = false;

export const state = {
  companies: initialCompanies.map((company) => ({ ...company })),
  departments: initialDepartments.map((department) => normalizeDepartment(department)),
  positions: initialPositions.map((position) => ({ ...position })),
  people: initialPeople.map((person) => ({ ...person })),
  categories: initialCategories.map((category) => ({ ...category })),
  stores: initialStores.map((store) => ({ ...store })),
  goals: initialGoals.map((goal) => ({ ...goal })),
  tasks: initialTasks.map((task) => ({ ...task })),
  taskTemplates: initialTaskTemplates.map((template) => ({ ...template })),
  contentSchedules: initialContentSchedules.map((schedule) => ({ ...schedule })),
  processTemplates: initialProcessTemplates.map((template) => ({ ...template })),
  processTemplateNodes: initialProcessTemplateNodes.map((node) => normalizeProcessTemplateNode(node)),
  processInstances: initialProcessInstances.map((instance) => ({ ...instance })),
  workPlans: initialWorkPlans.map((workPlan) => ({ ...workPlan })),
  weeklyReports: initialWeeklyReports.map((report) => ({ ...report })),
  weeklyReportProblems: initialWeeklyReportProblems.map((problem) => ({ ...problem })),
  methodologies: initialMethodologies.map((methodology) => ({ ...methodology })),
};

normalizeTaskSubmitRequirements();

function getAuthToken() {
  return window.localStorage.getItem(authTokenKey) ?? "";
}

function setAuthToken(token) {
  if (token === "") {
    window.localStorage.removeItem(authTokenKey);
    return;
  }
  window.localStorage.setItem(authTokenKey, token);
}

async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const token = getAuthToken();
  if (token !== "") headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

function cloneItem(item) {
  return JSON.parse(JSON.stringify(item));
}

function replaceArray(target, items) {
  target.splice(0, target.length, ...(items ?? []).map(cloneItem));
}

function normalizeDepartment(department) {
  return {
    ...department,
    parentDepartmentId: department.parentDepartmentId ?? null,
  };
}

export function getDataSnapshot() {
  return {
    companies: state.companies,
    departments: state.departments,
    positions: state.positions,
    people: state.people,
    categories: state.categories,
    stores: state.stores,
    goals: state.goals,
    taskTemplates: state.taskTemplates,
    tasks: state.tasks,
    processTemplates: state.processTemplates,
    processTemplateNodes: state.processTemplateNodes,
    processInstances: state.processInstances,
    contentSchedules: state.contentSchedules,
    workPlans: state.workPlans,
    weeklyReports: state.weeklyReports,
    weeklyReportProblems: state.weeklyReportProblems,
    methodologies: state.methodologies,
  };
}

export function applyDataSnapshot(data) {
  isApplyingRemoteData = true;
  replaceArray(state.companies, data.companies);
  replaceArray(state.departments, (data.departments ?? []).map((department) => normalizeDepartment(department)));
  replaceArray(state.positions, data.positions);
  replaceArray(state.people, data.people ?? data.persons);
  replaceArray(state.categories, data.categories);
  replaceArray(state.stores, data.stores);
  replaceArray(state.goals, data.goals);
  replaceArray(state.taskTemplates, data.taskTemplates);
  replaceArray(state.tasks, data.tasks);
  replaceArray(state.processTemplates, data.processTemplates);
  replaceArray(
    state.processTemplateNodes,
    (data.processTemplateNodes ?? []).map((node) => normalizeProcessTemplateNode(node)),
  );
  normalizeAllProcessStepOrders();
  normalizeTaskSubmitRequirements();
  replaceArray(state.processInstances, data.processInstances);
  replaceArray(state.contentSchedules, data.contentSchedules);
  replaceArray(state.workPlans, data.workPlans);
  replaceArray(state.weeklyReports, data.weeklyReports);
  replaceArray(state.weeklyReportProblems, data.weeklyReportProblems);
  replaceArray(state.methodologies, data.methodologies);
  isApplyingRemoteData = false;
  ensureTaskTemplatesHaveProcessTemplates();
  ensureDefaultStandardWorkLibrary();
}

export async function loadPersistentData() {
  try {
    const response = await authFetch(`${apiBaseUrl}/api/data`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applyDataSnapshot(await response.json());
    persistenceAvailable = true;
    loadedFromDatabase = true;
    persistenceStatus = {
      kind: "success",
      message: "当前数据已连接本地数据库。",
    };
  } catch {
    persistenceAvailable = false;
    loadedFromDatabase = false;
    persistenceStatus = {
      kind: "warning",
      message: "本地数据库服务未启动，当前使用模拟数据，刷新后数据会丢失。",
    };
  }
}

export function getPersistenceWarning() {
  return persistenceStatus.message;
}

export function getPersistenceStatus() {
  return persistenceStatus;
}

export function getCurrentUser() {
  return currentUser;
}

export async function validateCurrentSession() {
  const token = getAuthToken();
  if (token === "") return null;

  try {
    const response = await authFetch(`${apiBaseUrl}/api/auth/me`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    currentUser = data.user ?? null;
    return currentUser;
  } catch {
    setAuthToken("");
    currentUser = null;
    return null;
  }
}

export async function login(username, password) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true) {
      return { success: false, message: data.message ?? "账号或密码错误" };
    }
    setAuthToken(data.token ?? "");
    currentUser = data.user ?? null;
    return { success: true, user: currentUser };
  } catch {
    return { success: false, message: "本地数据库服务未启动，请联系管理员" };
  }
}

export function logout() {
  setAuthToken("");
  currentUser = null;
  loadedFromDatabase = false;
  persistenceAvailable = false;
  persistenceStatus = { kind: "warning", message: "" };
}

function notifyPersistenceStatusChange() {
  window.dispatchEvent(new CustomEvent("persistence-status-change"));
}

export function resolveAssetUrl(url) {
  if (url === null || url === undefined || url === "") return "";
  if (url.startsWith("http://") || url.startsWith("https:") || url.startsWith("data:")) return url;
  if (url.startsWith("/")) return `${apiBaseUrl}${url}`;
  return url;
}

export async function uploadImageFile(file) {
  const formData = new FormData();
  formData.append("image", file);
  const response = await authFetch(`${apiBaseUrl}/api/uploads/image`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "图片上传失败。");
  return data;
}

export async function uploadGenericFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await authFetch(`${apiBaseUrl}/api/uploads/file`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "文件上传失败。");
  return data;
}

export async function savePersistentData() {
  if (!loadedFromDatabase || isApplyingRemoteData) return false;
  const payload = JSON.stringify(getDataSnapshot());

  try {
    const response = await authFetch(`${apiBaseUrl}/api/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    hasPendingPersistentChanges = false;
    persistenceAvailable = true;
    persistenceStatus = {
      kind: "success",
      message: "当前数据已连接本地数据库。",
    };
    return true;
  } catch (error) {
    console.error("数据保存失败", error);
    hasPendingPersistentChanges = true;
    persistenceAvailable = false;
    persistenceStatus = {
      kind: "error",
      message: "数据保存失败，请检查本地数据库服务是否启动。",
    };
    notifyPersistenceStatusChange();
    return false;
  }
}

export async function cancelProcessInstance(instanceId, cancelReason = "") {
  const response = await authFetch(`${apiBaseUrl}/api/process-instances/${instanceId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancelReason }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "取消流程失败，请检查本地数据库服务。");
  if (data.data !== undefined) applyDataSnapshot(data.data);
  return data;
}

export async function createPersistentResource(resource, item) {
  const response = await authFetch(`${apiBaseUrl}/api/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? data.error ?? "保存失败，请检查本地数据库服务。");
  return data;
}

export async function updatePersistentResource(resource, id, item) {
  const response = await authFetch(`${apiBaseUrl}/api/${resource}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? data.error ?? "保存失败，请检查本地数据库服务。");
  return data;
}

export function schedulePersistentSave() {
  if (!loadedFromDatabase || isApplyingRemoteData) return;
  hasPendingPersistentChanges = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    savePersistentData();
  }, 0);
}

export function flushPersistentSave() {
  if (!loadedFromDatabase || isApplyingRemoteData || !hasPendingPersistentChanges) return;
  window.clearTimeout(saveTimer);
  const payload = JSON.stringify(getDataSnapshot());
  const url = `${apiBaseUrl}/api/data`;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
    body: payload,
    keepalive: true,
  }).catch(() => {
    hasPendingPersistentChanges = true;
    persistenceAvailable = false;
    persistenceStatus = {
      kind: "error",
      message: "保存失败，请检查本地数据库服务。",
    };
  });
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getNow() {
  return new Date().toISOString();
}

function createSubmitField(key, label, type, required = false, options = null, placeholder = "") {
  return { id: `submit-${key}`, key, label, type, required: false, placeholder, options, sortOrder: 1 };
}

export function inferSubmitRequirement(name = "") {
  const text = String(name ?? "");
  const base = {
    submitType: SubmitType.Form,
    submitDescription: "请填写本步骤完成说明。",
    submitFields: [createSubmitField("completionNote", "完成说明", "textarea")],
    requireFile: false,
    requireLink: false,
  };

  if (text.includes("提交")) {
    return {
      submitType: SubmitType.FormFile,
      submitDescription: "请填写本步骤所需信息表单，并按需上传参考资料。",
      submitFields: [
        createSubmitField("submitContent", "提交内容说明", "textarea"),
        createSubmitField("relatedLink", "相关链接", "url", false),
      ],
      requireFile: false,
      requireLink: false,
    };
  }
  if (text.includes("审核")) {
    return {
      submitType: SubmitType.Form,
      submitDescription: "请填写审核结果和审核意见。",
      submitFields: [
        createSubmitField("auditResult", "审核结果", "select", true, ["通过", "退回修改"]),
        createSubmitField("auditOpinion", "审核意见", "textarea", false),
      ],
      requireFile: false,
      requireLink: false,
    };
  }
  if (["制作", "生成", "设计", "修改"].some((keyword) => text.includes(keyword))) {
    return {
      submitType: SubmitType.FileLink,
      submitDescription: "请上传制作完成的文件，或填写文件包 / 私有云链接。",
      submitFields: [createSubmitField("completionNote", "完成说明", "textarea")],
      requireFile: true,
      requireLink: false,
    };
  }
  if (text.includes("上传")) {
    return {
      submitType: SubmitType.Link,
      submitDescription: "请填写私有云或文件存放链接。",
      submitFields: [],
      requireFile: false,
      requireLink: true,
    };
  }
  if (text.includes("发布") || text.includes("上架")) {
    return {
      submitType: SubmitType.FormLink,
      submitDescription: "请填写发布信息和发布链接。",
      submitFields: [
        createSubmitField("platform", "发布平台", "text"),
        createSubmitField("publishTime", "发布时间", "date"),
        createSubmitField("publishNote", "发布说明", "textarea", false),
      ],
      requireFile: false,
      requireLink: true,
    };
  }
  if (text.includes("回填")) {
    return {
      submitType: SubmitType.Form,
      submitDescription: "请填写结果回填信息。",
      submitFields: [
        createSubmitField("resultNote", "结果说明", "textarea"),
        createSubmitField("relatedData", "相关数据", "textarea", false),
        createSubmitField("relatedLink", "相关链接", "url", false),
      ],
      requireFile: false,
      requireLink: false,
    };
  }
  if (["复盘", "报告", "归档", "跟进", "跟踪"].some((keyword) => text.includes(keyword))) {
    return {
      submitType: SubmitType.FormFile,
      submitDescription: "请填写结果说明，必要时上传报告或相关文件。",
      submitFields: [
        createSubmitField("resultNote", "结果说明", "textarea"),
        createSubmitField("issueSuggestion", "问题与建议", "textarea", false),
      ],
      requireFile: false,
      requireLink: false,
    };
  }
  if (["确认", "下单", "入库", "清单", "分配", "协调", "询问"].some((keyword) => text.includes(keyword))) {
    return base;
  }

  return base;
}

export function normalizeSubmitRequirement(item) {
  const inferred = inferSubmitRequirement(item?.name ?? "");
  return {
    ...inferred,
    submitType: item?.submitType || inferred.submitType,
    submitDescription: item?.submitDescription || inferred.submitDescription,
    submitFields: Array.isArray(item?.submitFields) ? item.submitFields : inferred.submitFields,
    requireFile: item?.requireFile ?? inferred.requireFile,
    requireLink: item?.requireLink ?? inferred.requireLink,
  };
}

function normalizeProcessTemplateNode(node) {
  const base = {
    reviewStandard: "按步骤完成标准和输出要求进行审核。",
    stepOrder: node.stepOrder ?? node.stageOrder ?? node.nodeOrder ?? 1,
    departmentId: node.departmentId ?? node.ownerDepartmentId ?? null,
    ownerId: node.ownerId ?? node.defaultOwnerId ?? null,
    executorId: node.executorId ?? null,
    ...node,
  };
  return {
    ...base,
    ...normalizeSubmitRequirement(base),
  };
}

function normalizeTaskSubmitRequirements() {
  state.tasks = state.tasks.map((task) => {
    const node = state.processTemplateNodes.find((item) => item.id === task.processNodeId);
    const source = normalizeSubmitRequirement(node ?? task);
    return {
      ...task,
      submitType: task.submitType || source.submitType,
      submitDescription: task.submitDescription || source.submitDescription,
      submitFields: Array.isArray(task.submitFields) ? task.submitFields : source.submitFields,
      submitFormData: task.submitFormData && typeof task.submitFormData === "object" ? task.submitFormData : {},
      submitFiles: Array.isArray(task.submitFiles) ? task.submitFiles : [],
      submitLinks: Array.isArray(task.submitLinks) ? task.submitLinks : [],
      submittedAt: task.submittedAt ?? null,
      submittedBy: task.submittedBy ?? null,
    };
  });
}

export function createOrReuseProcessTemplateForStandardWork({ name, ownerId, departmentId, now = getNow() }) {
  const processName = `${name}流程`;
  const existingTemplate = state.processTemplates.find((template) => template.name === processName);

  if (existingTemplate !== undefined) {
    if (existingTemplate.status !== ProcessTemplateStatus.Active) {
      existingTemplate.status = ProcessTemplateStatus.Active;
      existingTemplate.updatedAt = now;
    }
    return existingTemplate.id;
  }

  const processTemplate = {
    id: createId("process-template"),
    name: processName,
    categoryId: null,
    purpose: `规范【${name}】的执行过程。`,
    applicableDepartmentIds: departmentId ? [departmentId] : [],
    ownerId,
    startCondition: `当目标下需要发起【${name}】时。`,
    completionCondition: "该标准工作所有流程步骤完成。",
    overallStandard: "按流程步骤要求完成，并符合各步骤完成标准和审核标准。",
    status: ProcessTemplateStatus.Active,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  state.processTemplates = [processTemplate, ...state.processTemplates];
  return processTemplate.id;
}

const defaultDepartmentConfigs = [
  { key: "visual", label: "视觉部", names: ["视觉部", "视觉营销部"], fallbackName: "视觉部" },
  { key: "supply", label: "供应链", names: ["供应链", "供应链部"], fallbackName: "供应链部" },
  { key: "operation", label: "运营部", names: ["运营部"], fallbackName: "运营部" },
  { key: "product", label: "产品部", names: ["产品部"], fallbackName: "产品部" },
  { key: "admin", label: "综合部", names: ["综合部"], fallbackName: "综合部" },
];

const legacyStandardWorkNames = [
  "小红书笔记发布",
  "买家秀图片制作",
  "内容主题策划",
  "爆款笔记复盘",
  "产品拍摄方案确认",
  "供应商交期跟进",
  "重点产品补货计划跟进",
  "新品资料整理",
  "内容质量检查",
  "任务执行检查",
];

function field(id, label, key, type, required, placeholder = "", options = null, showInList = true, sortOrder = 1) {
  return { id, label, key, type, required: false, placeholder, options: options ?? [], showInList, sortOrder };
}

function baseStandardWorkFields(prefix) {
  return [
    field(`${prefix}-work-object`, "工作对象", "workObject", "text", true, "例如产品名、页面名、岗位名、事项名", null, true, 1),
    field(`${prefix}-cover`, "相关产品1:1图片", "coverImageUrl", "image", false, "", null, true, 2),
    field(`${prefix}-requirement`, "本次工作要求", "workRequirement", "textarea", false, "补充本次工作的特殊要求", null, false, 3),
  ];
}

const realStandardWorkDefinitions = [
  {
    id: "task-template-store-decoration",
    departmentKey: "visual",
    name: "店铺装修升级",
    description: "根据店铺经营目标和视觉标准，对店铺首页、详情页、活动页等视觉内容进行优化升级。",
    completionStandard: "完成指定页面设计、审核通过并交付上线所需素材。",
  },
  {
    id: "task-template-package-design",
    departmentKey: "visual",
    name: "产品包装设计",
    description: "根据产品定位和品牌风格，完成产品包装视觉设计。",
    completionStandard: "输出包装设计稿、尺寸文件和可交付生产的设计文件。",
  },
  {
    id: "task-template-stock-clearance",
    departmentKey: "supply",
    name: "库存清仓",
    description: "针对滞销、积压或阶段性清仓产品制定并推进清仓方案。",
    completionStandard: "明确清仓产品、库存数量、清仓策略、执行进度和结果反馈。",
  },
  {
    id: "task-template-publish-buyer-show",
    departmentKey: "operation",
    name: "发布买家秀",
    description: "根据产品和内容排期发布买家秀内容，提升产品信任和转化。",
    completionStandard: "买家秀内容按要求完成制作、审核、发布，并回填发布结果。",
    extraFields: [
      field("buyer-show-platform", "发布平台", "platform", "select", false, "", ["小红书", "淘宝", "天猫", "抖音"], true, 4),
      field("buyer-show-date", "发布日期", "publishDate", "date", false, "", null, true, 5),
    ],
  },
  {
    id: "task-template-publish-content-note",
    departmentKey: "operation",
    name: "发布内容笔记",
    description: "根据内容排期完成小红书或其他平台内容笔记发布。",
    completionStandard: "内容笔记完成素材准备、审核、发布，并回填链接和数据。",
    extraFields: [
      field("content-note-account", "发布账号", "account", "select", false, "", ["阿柚", "小茉", "小满"], true, 4),
      field("content-note-date", "发布日期", "publishDate", "date", false, "", null, true, 5),
      field("content-note-type", "内容类型", "contentType", "select", false, "", ["图文笔记", "视频笔记", "买家秀", "电商视觉"], true, 6),
    ],
  },
  {
    id: "task-template-new-product-link",
    departmentKey: "operation",
    name: "新品上架链接",
    description: "根据新品资料完成商品链接创建、信息填写、图片上传和基础设置。",
    completionStandard: "商品链接完整上线，标题、价格、主图、详情、SKU 等信息准确无误。",
    extraFields: [
      field("new-link-product", "产品名称", "productName", "text", false, "请输入产品名称", null, true, 4),
      field("new-link-store", "上架店铺", "storeId", "select", false, "请选择上架店铺", [], true, 5),
      field("new-link-date", "预计上架日期", "expectedLaunchDate", "date", false, "", null, true, 6),
    ],
  },
  {
    id: "task-template-new-product-development",
    departmentKey: "product",
    name: "新品开发",
    description: "根据产品方向和市场需求推进新品从构思到打样、确认的开发工作。",
    completionStandard: "完成新品方案、供应商确认、样品确认、成本信息和上架所需基础资料。",
    extraFields: [
      field("new-dev-product", "产品名称", "productName", "text", false, "请输入产品名称", null, true, 4),
      field("new-dev-direction", "产品方向", "productDirection", "text", false, "请输入产品方向", null, true, 5),
      field("new-dev-date", "预计完成日期", "expectedDoneDate", "date", false, "", null, true, 6),
    ],
  },
  {
    id: "task-template-recruitment",
    departmentKey: "admin",
    name: "人员招聘",
    description: "根据部门用人需求推进招聘流程。",
    completionStandard: "完成招聘需求确认、人才画像、招聘发布、面试、试用判断和档案建立。",
    extraFields: [
      field("recruitment-position", "招聘岗位", "recruitPosition", "text", false, "请输入招聘岗位", null, true, 4),
      field("recruitment-dept", "需求部门", "requiredDepartment", "select", false, "", [], true, 5),
      field("recruitment-date", "到岗时间", "arrivalDate", "date", false, "", null, true, 6),
    ],
  },
  {
    id: "task-template-goal-alignment",
    departmentKey: "admin",
    name: "目标对齐",
    description: "组织公司或部门进行目标拆解和目标对齐，确保目标、标准工作和执行方向一致。",
    completionStandard: "完成目标确认、部门对齐、责任人确认和后续工作安排。",
    extraFields: [
      field("goal-align-object", "对齐对象", "alignmentObject", "text", false, "请输入对齐对象", null, true, 4),
      field("goal-align-period", "对齐周期", "alignmentPeriod", "select", false, "", ["年度", "季度", "月度", "周度"], true, 5),
    ],
  },
  {
    id: "task-template-task-check",
    departmentKey: "admin",
    name: "执行任务检查",
    description: "检查公司各部门执行任务推进情况，发现阻碍和延期问题。",
    completionStandard: "完成任务执行检查、问题记录、责任确认和处理反馈。",
    extraFields: [
      field("task-check-dept", "检查部门", "checkDepartment", "select", false, "", [], true, 4),
      field("task-check-period", "检查周期", "checkPeriod", "select", false, "", ["每日", "每周", "每月"], true, 5),
    ],
  },
];

const standardWorkFormDefinitions = {
  发布内容笔记: [
    ["coverImageUrl", "产品图", "image", false, "上传1:1产品图", [], true],
    ["publishDate", "发布日期", "date", true, "", [], true],
    ["account", "发布账号", "select", true, "请选择发布账号", ["阿柚", "小茉", "小满", "其他"], true],
    ["contentType", "内容类型", "select", true, "请选择内容类型", ["图文笔记", "视频笔记"], true],
    ["purpose", "目的", "select", true, "请选择目的", ["种草引流", "场景教育", "审美表达", "信任建立", "品牌心智", "转化收割"], true],
    ["audience", "受众人群", "select", true, "请选择受众人群", ["路人", "兴趣人群", "新客", "老客", "流失顾客"], true],
    ["title", "标题", "text", true, "请输入笔记标题", [], true],
    ["contentText", "内容文案", "textarea", true, "请输入内容文案", [], false],
  ],
  发布买家秀: [
    ["coverImageUrl", "产品图", "image", false, "上传1:1产品图", [], true],
    ["productName", "对应产品", "text", true, "请输入产品名称", [], true],
    ["buyerShowType", "买家秀类型", "select", true, "请选择买家秀类型", ["场景图", "细节图", "开箱图", "使用图", "组合图"], true],
    ["imageCount", "图片数量", "number", true, "请输入图片数量", [], true],
    ["sceneRequirement", "使用场景", "textarea", false, "例如玄关、餐桌、茶几、边柜、窗台等", [], false],
    ["imageRequirement", "图片要求", "textarea", true, "填写构图、光线、产品比例、是否插花等要求", [], false],
    ["needPublish", "是否需要发布", "select", false, "请选择", ["是", "否"], true],
    ["publishPlatform", "发布平台", "select", false, "请选择发布平台", ["淘宝", "天猫", "小红书", "私域"], true],
    ["dueDate", "期望完成日期", "date", true, "", [], true],
    ["remark", "补充说明", "textarea", false, "其他特殊要求", [], false],
  ],
  新品上架链接: [
    ["coverImageUrl", "产品图", "image", true, "上传1:1产品图", [], true],
    ["productName", "产品名称", "text", true, "请输入产品名称", [], true],
    ["productCategory", "产品分类", "select", false, "请选择产品分类", ["花瓶", "杯具", "家居摆件", "其他"], true],
    ["productSpec", "产品规格", "textarea", true, "填写尺寸、材质、颜色、包装等", [], false],
    ["sellingPoints", "产品卖点", "textarea", true, "填写核心卖点", [], false],
    ["targetStyle", "目标风格", "select", false, "请选择目标风格", ["日式", "北欧", "法式", "侘寂", "新中式", "复古美式", "其他"], true],
    ["priceRange", "目标价格带", "text", false, "例如100-299、200-599、1000+", [], true],
    ["storeId", "上架店铺", "select", true, "请选择上架店铺", [], true],
    ["mainImageRequirement", "主图需求", "textarea", true, "主图要突出什么", [], false],
    ["detailPageRequirement", "详情页需求", "textarea", true, "详情页要表达什么", [], false],
    ["buyerShowRequirement", "买家秀需求", "textarea", false, "是否需要买家秀及要求", [], false],
    ["launchDate", "期望上架日期", "date", true, "", [], true],
    ["remark", "补充说明", "textarea", false, "其他要求", [], false],
  ],
  库存清仓: [
    ["coverImageUrl", "产品图", "image", false, "上传产品图", [], true],
    ["productName", "清仓产品", "text", true, "请输入清仓产品名称", [], true],
    ["sku", "SKU / 规格", "text", false, "填写规格、颜色等", [], true],
    ["stockQuantity", "当前库存", "number", true, "请输入库存数量", [], true],
    ["warehouse", "库存位置", "select", false, "请选择库存位置", ["义乌仓", "山西仓", "其他"], true],
    ["clearanceReason", "清仓原因", "textarea", true, "填写清仓原因", [], false],
    ["suggestedPrice", "建议清仓价", "number", false, "请输入建议清仓价", [], true],
    ["originalPrice", "原售价", "number", false, "请输入原售价", [], true],
    ["clearanceChannel", "清仓渠道", "select", true, "请选择清仓渠道", ["店铺清仓位", "直播间", "私域", "老客群", "其他"], true],
    ["dueDate", "期望完成日期", "date", true, "", [], true],
    ["notice", "注意事项", "textarea", false, "填写售后、品牌影响等注意事项", [], false],
  ],
  "新品开发": [
    ["productDirection", "产品方向", "text", true, "例如赛里木湖蓝花瓶、粉色马克杯", [], true],
    ["referenceImageUrl", "参考图片", "image", false, "上传参考图片", [], true],
    ["productCategory", "目标品类", "select", true, "请选择目标品类", ["花瓶", "杯具", "摆件", "其他"], true],
    ["targetStyle", "目标风格", "select", false, "请选择目标风格", ["日式", "北欧", "法式", "侘寂", "新中式", "复古美式", "其他"], true],
    ["priceRange", "目标价格带", "text", false, "预计售价区间", [], true],
    ["materialRequirement", "材质要求", "textarea", false, "玻璃、琉璃、陶瓷等", [], false],
    ["sizeRequirement", "尺寸要求", "textarea", false, "大小、高度、口径等", [], false],
    ["targetAudience", "目标人群", "textarea", false, "例如25-40女性、新中式人群", [], false],
    ["developmentReason", "开发理由", "textarea", true, "为什么开发这个产品", [], false],
    ["competitorReference", "竞品参考", "textarea", false, "竞品链接、价格、卖点等", [], false],
    ["sampleDate", "期望打样日期", "date", false, "", [], true],
    ["remark", "补充说明", "textarea", false, "其他要求", [], false],
  ],
  店铺装修升级: [
    ["storeName", "店铺 / 账号", "text", true, "请输入店铺或账号名称", [], true],
    ["decorationArea", "装修位置", "select", true, "请选择装修位置", ["首页", "分类页", "详情页模块", "活动页", "账号主页"], true],
    ["decorationPurpose", "装修目的", "select", true, "请选择装修目的", ["提升高级感", "提升转化", "活动承接", "风格统一", "新品推广"], true],
    ["currentProblem", "当前问题", "textarea", true, "现在哪里不好", [], false],
    ["referenceStyle", "参考风格", "textarea", false, "填写参考链接或风格说明", [], false],
    ["highlightProducts", "需要突出产品", "textarea", false, "哪些产品要重点展示", [], false],
    ["dueDate", "期望完成日期", "date", true, "", [], true],
    ["remark", "补充要求", "textarea", false, "其他要求", [], false],
  ],
  产品包装设计: [
    ["coverImageUrl", "产品图", "image", false, "上传产品图片", [], true],
    ["productName", "产品名称", "text", true, "需要包装设计的产品", [], true],
    ["packageType", "包装类型", "select", true, "请选择包装类型", ["外箱", "彩盒", "礼盒", "标签", "说明卡", "组合包装"], true],
    ["designPurpose", "设计目的", "select", true, "请选择设计目的", ["提升品牌感", "降低破损", "礼品化", "降低成本", "统一风格"], true],
    ["brandSeries", "品牌 / 系列", "select", false, "请选择品牌或系列", ["点意", "半然", "无用美学", "其他"], true],
    ["sizeRequirement", "尺寸要求", "textarea", false, "包装尺寸、产品尺寸", [], false],
    ["materialRequirement", "材质要求", "textarea", false, "纸盒、泡沫、珍珠棉等", [], false],
    ["styleRequirement", "风格要求", "textarea", true, "极简、高级、自然、复古等", [], false],
    ["costRequirement", "成本要求", "text", false, "单个包装成本限制", [], true],
    ["dueDate", "期望完成日期", "date", true, "", [], true],
    ["remark", "补充说明", "textarea", false, "其他要求", [], false],
  ],
  人员招聘: [
    ["departmentId", "需求部门", "select", true, "请选择需求部门", [], true],
    ["positionName", "招聘岗位", "text", true, "请输入岗位名称", [], true],
    ["headcount", "招聘人数", "number", true, "请输入招聘人数", [], true],
    ["recruitReason", "招聘原因", "select", true, "请选择招聘原因", ["新增岗位", "替补离职", "业务增长", "人员储备"], true],
    ["talentProfile", "人才画像", "textarea", true, "填写性格、能力、经验、配合度要求", [], false],
    ["coreResponsibilities", "核心职责", "textarea", true, "入职后主要做什么", [], false],
    ["salaryRange", "薪资范围", "text", true, "例如5000-7000", [], true],
    ["arrivalDate", "到岗时间", "date", false, "", [], true],
    ["probationAssessment", "试用期考核重点", "textarea", true, "配合度、自主性、学习力等", [], false],
    ["interviewerId", "面试负责人", "select", false, "请选择面试负责人", [], true],
    ["remark", "补充说明", "textarea", false, "其他要求", [], false],
  ],
  目标对齐: [
    ["alignmentPeriod", "对齐周期", "select", true, "请选择对齐周期", ["月度", "季度", "年度", "临时"], true],
    ["departmentId", "对齐部门", "select", true, "请选择对齐部门", [], true],
    ["goalName", "对齐目标", "text", true, "填写本次要对齐的目标", [], true],
    ["currentProgress", "当前进度", "textarea", true, "填写目标当前完成情况", [], false],
    ["problems", "存在问题", "textarea", true, "填写阻碍、偏差、风险", [], false],
    ["coordinationNeeded", "需要协调事项", "textarea", false, "需要其他部门或总经办支持什么", [], false],
    ["nextActions", "下一步动作", "textarea", true, "下一阶段要做什么", [], false],
    ["dueDate", "截止日期", "date", false, "下次检查时间", [], true],
    ["remark", "补充说明", "textarea", false, "其他说明", [], false],
  ],
  执行任务检查: [
    ["checkPeriod", "检查周期", "select", true, "请选择检查周期", ["每日", "每周", "每月", "临时"], true],
    ["checkScope", "检查范围", "textarea", true, "检查哪些部门、哪些任务", [], false],
    ["departmentId", "被检查部门", "select", false, "请选择部门", [], true],
    ["checkFocus", "检查重点", "textarea", true, "进度、逾期、卡点、质量等", [], false],
    ["foundProblems", "发现问题", "textarea", false, "检查后填写发现的问题", [], false],
    ["impactLevel", "影响程度", "select", false, "请选择影响程度", ["轻微", "一般", "严重"], true],
    ["rectificationRequirement", "整改要求", "textarea", false, "发现问题后的整改要求", [], false],
    ["rectificationDueDate", "整改截止日期", "date", false, "", [], true],
    ["remark", "补充说明", "textarea", false, "其他说明", [], false],
  ],
};

function buildConfiguredStandardWorkFields(name) {
  const normalizedName = String(name ?? "").trim();
  if (normalizedName === "新品开发") {
    return [
      field("新品开发-productDirection", "产品方向", "productDirection", "text", true, "例如赛里木湖蓝花瓶、粉色马克杯", [], true, 1),
      field("新品开发-referenceImageUrl", "参考图片", "referenceImageUrl", "image", false, "上传参考图片", [], true, 2),
      field("新品开发-productCategory", "目标品类", "productCategory", "select", true, "请选择目标品类", ["花瓶", "杯具", "摆件", "其他"], true, 3),
      field("新品开发-targetStyle", "目标风格", "targetStyle", "select", false, "请选择目标风格", ["日式", "北欧", "法式", "侘寂", "新中式", "复古美式", "其他"], true, 4),
      field("新品开发-priceRange", "目标价格带", "priceRange", "text", false, "预计售价区间", [], true, 5),
      field("新品开发-materialRequirement", "材质要求", "materialRequirement", "textarea", false, "玻璃、琉璃、陶瓷等", [], false, 6),
      field("新品开发-sizeRequirement", "尺寸要求", "sizeRequirement", "textarea", false, "大小、高度、口径等", [], false, 7),
      field("新品开发-targetAudience", "目标人群", "targetAudience", "textarea", false, "例如25-40女性、新中式人群", [], false, 8),
      field("新品开发-developmentReason", "开发理由", "developmentReason", "textarea", true, "为什么开发这个产品", [], false, 9),
      field("新品开发-competitorReference", "竞品参考", "competitorReference", "textarea", false, "竞品链接、价格、卖点等", [], false, 10),
      field("新品开发-sampleDate", "期望打样日期", "sampleDate", "date", false, "", [], true, 11),
      field("新品开发-remark", "补充说明", "remark", "textarea", false, "其他要求", [], false, 12),
    ];
  }
  const definition =
    standardWorkFormDefinitions[normalizedName] ??
    (normalizedName.includes("新品开发") ? standardWorkFormDefinitions["新品开发"] : undefined);
  if (definition === undefined) return null;
  return definition.map(([key, label, type, required, placeholder, options, showInList], index) =>
    field(`${normalizedName}-${key}`, label, key, type, required, placeholder, options, showInList, index + 1),
  );
}

function shouldApplyDefaultFormFields(template, defaultFields) {
  const currentFields = template.formFields;
  if (!Array.isArray(currentFields) || currentFields.length === 0) return true;
  const currentKeys = currentFields.map((item) => item.key).filter(Boolean);
  const defaultKeys = defaultFields.map((item) => item.key);
  const alreadyUsesDefault = defaultKeys.every((key) => currentKeys.includes(key));
  if (alreadyUsesDefault) return false;

  const legacyKeys = new Set([
    "workObject",
    "coverImageUrl",
    "workRequirement",
    "platform",
    "publishDate",
    "account",
    "contentType",
    "productName",
    "productDirection",
    "expectedLaunchDate",
    "expectedDoneDate",
    "recruitPosition",
    "requiredDepartment",
    "arrivalDate",
    "alignmentObject",
    "alignmentPeriod",
    "checkDepartment",
    "checkPeriod",
  ]);
  return currentKeys.every((key) => legacyKeys.has(key));
}

function migrateStoreFieldForStandardWork(template) {
  if (template.name !== "新品上架链接" || !Array.isArray(template.formFields)) return template;
  let changed = false;
  const formFields = template.formFields.map((field) => {
    if (field.key !== "platform") return field;
    changed = true;
    return {
      ...field,
      id: `${template.name}-storeId`,
      key: "storeId",
      label: "上架店铺",
      placeholder: "请选择上架店铺",
      options: [],
    };
  });
  return changed ? { ...template, formFields } : template;
}

function findDepartmentByNames(names) {
  return state.departments.find((department) => names.includes(department.name)) ?? null;
}

function ensureDepartment(config, now) {
  const existing = findDepartmentByNames(config.names);
  if (existing !== null) return existing;
  const companyId = state.companies[0]?.id ?? "company-001";
  const department = {
    id: `dept-${config.key}`,
    companyId,
    name: config.fallbackName,
    leaderId: null,
    sortOrder: state.departments.length + 1,
    status: Status.Active,
    createdAt: now,
    updatedAt: now,
  };
  state.departments = [...state.departments, department];
  return department;
}

function resolveDepartmentOwner(departmentId) {
  const department = state.departments.find((item) => item.id === departmentId);
  if (department?.leaderId) return department.leaderId;
  return (
    state.people.find((person) => person.departmentId === departmentId && person.status === Status.Active)?.id ??
    state.people.find((person) => [PersonRole.CompanyManager, PersonRole.SystemAdmin].includes(person.role) && person.status === Status.Active)?.id ??
    state.people.find((person) => person.status === Status.Active)?.id ??
    null
  );
}

function getDefaultTaskCategoryId() {
  return state.categories.find((category) => category.type === CategoryType.Task)?.id ?? null;
}

function buildStandardWorkFormFields(definition) {
  return buildConfiguredStandardWorkFields(definition.name) ?? [...baseStandardWorkFields(definition.id), ...(definition.extraFields ?? [])];
}

export function ensureDefaultStandardWorkLibrary() {
  const now = getNow();
  const departmentsByKey = new Map(defaultDepartmentConfigs.map((config) => [config.key, ensureDepartment(config, now)]));
  const defaultCategoryId = getDefaultTaskCategoryId();
  const realNames = new Set(realStandardWorkDefinitions.map((definition) => definition.name));
  let changed = false;

  state.taskTemplates = state.taskTemplates.map((template) => {
    if (legacyStandardWorkNames.includes(template.name) && !realNames.has(template.name) && template.status !== TaskTemplateStatus.Inactive) {
      changed = true;
      return { ...template, status: TaskTemplateStatus.Inactive, updatedAt: now };
    }
    return template;
  });

  realStandardWorkDefinitions.forEach((definition) => {
    const department = departmentsByKey.get(definition.departmentKey);
    const departmentId = department?.id ?? null;
    const ownerId = resolveDepartmentOwner(departmentId);
    const existingRaw = state.taskTemplates.find((template) => template.name === definition.name || template.id === definition.id);
    const existing = existingRaw === undefined ? undefined : migrateStoreFieldForStandardWork(existingRaw);
    const defaultProcessTemplateId = createOrReuseProcessTemplateForStandardWork({
      name: definition.name,
      ownerId,
      departmentId,
      now,
    });
    const defaultFormFields = buildStandardWorkFormFields(definition);
    const templateData = {
      name: definition.name,
      categoryId: defaultCategoryId,
      departmentId,
      ownerId,
      description: definition.description,
      completionStandard: definition.completionStandard,
      importance: TaskImportance.Important,
      urgency: TaskUrgency.NotUrgent,
      needAcceptance: false,
      accepterId: null,
      defaultProcessTemplateId,
      status: TaskTemplateStatus.Active,
      updatedAt: now,
    };

    if (existing === undefined) {
      state.taskTemplates = [
        ...state.taskTemplates,
        {
          id: definition.id,
          ...templateData,
          formFields: defaultFormFields,
          createdAt: now,
        },
      ];
      changed = true;
      return;
    }

    const updated = migrateStoreFieldForStandardWork({
      ...existing,
      ...templateData,
      id: existing.id,
      formFields: shouldApplyDefaultFormFields(existing, defaultFormFields) ? defaultFormFields : existing.formFields,
      createdAt: existing.createdAt ?? now,
    });
    const hasChanged = JSON.stringify(existing) !== JSON.stringify(updated);
    if (hasChanged) changed = true;
    state.taskTemplates = state.taskTemplates.map((template) => (template.id === existing.id ? updated : template));
  });

  return changed;
}

export function ensureTaskTemplatesHaveProcessTemplates() {
  const now = getNow();
  state.taskTemplates = state.taskTemplates.map((template) => {
    if (template.status !== "active" || template.defaultProcessTemplateId) return template;

    return {
      ...template,
      defaultProcessTemplateId: createOrReuseProcessTemplateForStandardWork({
        name: template.name,
        ownerId: template.ownerId,
        departmentId: template.departmentId,
        now,
      }),
      updatedAt: now,
    };
  });
}

ensureTaskTemplatesHaveProcessTemplates();
ensureDefaultStandardWorkLibrary();

export function getProcessNodeStepOrder(node) {
  return Number(node.stepOrder ?? node.stageOrder ?? node.nodeOrder ?? 1);
}

export function sortProcessNodes(nodes) {
  return [...nodes].sort((left, right) => getProcessNodeStepOrder(left) - getProcessNodeStepOrder(right));
}

export function normalizeProcessStepOrders(templateId) {
  const sortedNodes = sortProcessNodes(state.processTemplateNodes.filter((node) => node.templateId === templateId));
  const orderById = new Map(sortedNodes.map((node, index) => [node.id, index + 1]));
  state.processTemplateNodes = state.processTemplateNodes.map((node) => {
    const stepOrder = orderById.get(node.id);
    if (stepOrder === undefined) return node;
    return {
      ...node,
      stepOrder,
      stageName: "默认流程",
      stageOrder: stepOrder,
      nodeOrder: stepOrder,
      departmentId: node.departmentId ?? node.ownerDepartmentId ?? null,
      ownerId: node.ownerId ?? node.defaultOwnerId ?? null,
      executorId: node.executorId ?? null,
    };
  });
}

export function normalizeAllProcessStepOrders() {
  const templateIds = [...new Set(state.processTemplateNodes.map((node) => node.templateId))];
  templateIds.forEach((templateId) => normalizeProcessStepOrders(templateId));
}

export function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getCurrentWeek(date = new Date("2026-06-24T00:00:00+08:00")) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function resolveOwner(node, initiatorId, launchAssignments) {
  if (node.executorId) return node.executorId;
  if (node.ownerId) return node.ownerId;
  if (node.ownerRule === ProcessOwnerRule.FixedPerson) return node.defaultOwnerId;
  if (node.ownerRule === ProcessOwnerRule.Initiator) return initiatorId;
  if (node.ownerRule === ProcessOwnerRule.LaunchAssign) return launchAssignments.owner[node.id] ?? null;
  if (node.ownerRule === ProcessOwnerRule.DepartmentLeader) {
    return state.departments.find((department) => department.id === node.ownerDepartmentId)?.leaderId ?? null;
  }
  if (node.ownerRule === ProcessOwnerRule.FixedPosition) {
    return (
      state.people.find(
        (person) =>
          person.departmentId === node.ownerDepartmentId &&
          person.positionId === node.ownerPositionId &&
          person.status === "active",
      )?.id ?? null
    );
  }
  return null;
}

function resolveAccepter(node, initiatorId, launchAssignments) {
  if (node.accepterRule === ProcessAccepterRule.None) return null;
  if (node.accepterRule === ProcessAccepterRule.FixedPerson) return node.defaultAccepterId;
  if (node.accepterRule === ProcessAccepterRule.Initiator) return initiatorId;
  if (node.accepterRule === ProcessAccepterRule.LaunchAssign) return launchAssignments.accepter[node.id] ?? null;
  if (node.accepterRule === ProcessAccepterRule.DepartmentLeader) {
    return state.departments.find((department) => department.id === node.ownerDepartmentId)?.leaderId ?? null;
  }
  return null;
}

export function startProcess({
  templateId,
  taskTemplateId = null,
  customFields = {},
  displayTitle = null,
  coverImageUrl = null,
  name,
  goalId,
  initiatorId,
  description,
  launchAssignments,
}) {
  const template = state.processTemplates.find((item) => item.id === templateId);
  if (template === undefined || template.status !== ProcessTemplateStatus.Active) {
    return { error: "只能发起启用状态的标准流程。" };
  }

  const nodes = state.processTemplateNodes
    .filter((node) => node.templateId === templateId && node.status === ProcessTemplateNodeStatus.Active)
    .sort((left, right) => getProcessNodeStepOrder(left) - getProcessNodeStepOrder(right));
  if (nodes.length === 0) {
    return { error: "该标准流程尚未配置流程步骤，请先到流程模块中编辑步骤。" };
  }

  for (const node of nodes) {
    const ownerId = resolveOwner(node, initiatorId, launchAssignments);
    if (ownerId === null) return { error: `流程步骤“${node.name}”无法解析负责人。` };
  }

  const now = getNow();
  const today = now.slice(0, 10);
  const primaryCoverImageUrl = coverImageUrl || getPrimaryImageUrl({ customFields });
  const instance = {
    id: createId("process-instance"),
    templateId,
    taskTemplateId,
    templateVersion: template.version,
    name,
    goalId,
    initiatorId,
    description,
    status: ProcessInstanceStatus.Running,
    startedAt: now,
    completedAt: null,
    stoppedAt: null,
    createdAt: now,
    updatedAt: now,
    customFields,
    displayTitle,
    coverImageUrl: primaryCoverImageUrl,
  };
  const generatedTasks = nodes.map((node, index) => {
    const activeNow = index === 0;
    const submitRequirement = normalizeSubmitRequirement(node);
    return {
      id: createId("task"),
      name: node.name,
      goalId,
      source: TaskSource.Process,
      processInstanceId: instance.id,
      processNodeId: node.id,
      categoryId: null,
      departmentId: node.departmentId ?? node.ownerDepartmentId ?? template.applicableDepartmentIds[0],
      ownerId: resolveOwner(node, initiatorId, launchAssignments),
      initiatorId,
      description: node.description,
      completionStandard: node.completionStandard,
      reviewStandard: null,
      outputRequirement: null,
      importance: node.defaultImportance ?? "important",
      urgency: node.defaultUrgency ?? "not_urgent",
      startDate: activeNow ? today : null,
      dueDate: activeNow ? addDays(today, node.durationDays) : null,
      plannedWeek: activeNow ? getCurrentWeek(new Date(`${today}T00:00:00+08:00`)) : null,
      needAcceptance: false,
      accepterId: null,
      status: activeNow ? TaskStatus.Todo : TaskStatus.Waiting,
      resultText: null,
      resultAttachments: [],
      submitType: submitRequirement.submitType,
      submitDescription: submitRequirement.submitDescription,
      submitFields: submitRequirement.submitFields,
      submitFormData: {},
      submitFiles: [],
      submitLinks: [],
      submittedAt: null,
      submittedBy: null,
      taskTemplateId: null,
      customFields: {},
      displayTitle: null,
      coverImageUrl: primaryCoverImageUrl,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
  });

  state.processInstances = [instance, ...state.processInstances];
  state.tasks = [...generatedTasks, ...state.tasks];
  return { instance };
}

export function advanceProcessAfterTaskDone(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (task === undefined || task.source !== TaskSource.Process || task.status !== TaskStatus.Done) return;

  const instance = state.processInstances.find((item) => item.id === task.processInstanceId);
  if (instance === undefined || instance.status !== ProcessInstanceStatus.Running) return;

  const instanceTasks = state.tasks.filter((item) => item.processInstanceId === instance.id);
  const taskNode = state.processTemplateNodes.find((node) => node.id === task.processNodeId);
  if (taskNode === undefined) return;

  const orderedTasks = instanceTasks
    .filter((item) => item.status !== TaskStatus.Canceled)
    .sort((left, right) => {
      const leftNode = state.processTemplateNodes.find((node) => node.id === left.processNodeId);
      const rightNode = state.processTemplateNodes.find((node) => node.id === right.processNodeId);
      return getProcessNodeStepOrder(leftNode ?? {}) - getProcessNodeStepOrder(rightNode ?? {});
    });
  const currentIndex = orderedTasks.findIndex((item) => item.id === taskId);
  const nextTask = orderedTasks[currentIndex + 1];
  const now = getNow();
  const today = now.slice(0, 10);

  if (nextTask !== undefined && nextTask.status === TaskStatus.Waiting) {
    state.tasks = state.tasks.map((item) => {
      const node = state.processTemplateNodes.find((candidate) => candidate.id === nextTask.processNodeId);
      if (item.id === nextTask.id) {
        return {
          ...item,
          status: TaskStatus.Todo,
          startDate: today,
          dueDate: addDays(today, node.durationDays),
          updatedAt: now,
        };
      }
      return item;
    });
    return;
  }

  if (instanceTasks.every((item) => item.status === TaskStatus.Done)) {
    state.processInstances = state.processInstances.map((item) =>
      item.id === instance.id
        ? { ...item, status: ProcessInstanceStatus.Done, completedAt: now, updatedAt: now }
        : item,
    );
  }
}

export function stopProcess(instanceId) {
  const now = getNow();
  state.processInstances = state.processInstances.map((instance) =>
    instance.id === instanceId
      ? { ...instance, status: ProcessInstanceStatus.Stopped, stoppedAt: now, updatedAt: now }
      : instance,
  );
  state.tasks = state.tasks.map((task) =>
    task.processInstanceId === instanceId && task.status !== TaskStatus.Done
      ? { ...task, status: TaskStatus.Canceled, updatedAt: now }
      : task,
  );
}
