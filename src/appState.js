import {
  categories as initialCategories,
  companies as initialCompanies,
  contentSchedules as initialContentSchedules,
  departments as initialDepartments,
  executionGroups as initialExecutionGroups,
  goals as initialGoals,
  people as initialPeople,
  publishingAccounts as initialPublishingAccounts,
  positions as initialPositions,
  processInstances as initialProcessInstances,
  processTemplateNodes as initialProcessTemplateNodes,
  processTemplates as initialProcessTemplates,
  stores as initialStores,
  taskTemplates as initialTaskTemplates,
  tasks as initialTasks,
  templates as initialTemplates,
  templateTagCategories as initialTemplateTagCategories,
  templateTags as initialTemplateTags,
  weeklyReportProblems as initialWeeklyReportProblems,
  weeklyReports as initialWeeklyReports,
  methodologies as initialMethodologies,
  notifications as initialNotifications,
  issuesRequirements as initialIssuesRequirements,
  standardWorkForms as initialStandardWorkForms,
  workPlans as initialWorkPlans,
} from "./data/mockData.js?v=20260705-state-singleton1";
import { formatBusinessDateTime } from "./businessTime.js?v=20260705-state-singleton1";
import { isTaskExecutionStarted } from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
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
  TaskSource,
  TaskStatus,
  TaskTemplateStatus,
  RectificationWorkTemplate,
  WorkType,
  WorkPlanStatus,
  getValueModuleName,
  inferValueModuleIdFromText,
} from "./data/modelOptions.js?v=20260705-state-singleton1";
import { getPrimaryImageUrl } from "./data/taskUtils.js?v=20260705-state-singleton1";

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
  publishingAccounts: initialPublishingAccounts.map((account) => ({ ...account })),
  goals: initialGoals.map((goal) => ({ ...goal })),
  tasks: initialTasks.map((task) => ({ ...task })),
  executionGroups: initialExecutionGroups.map((group) => ({ ...group })),
  taskTemplates: initialTaskTemplates.map((template) => ({ ...template })),
  contentSchedules: initialContentSchedules.map((schedule) => ({ ...schedule })),
  processTemplates: initialProcessTemplates.map((template) => ({ ...template })),
  processTemplateNodes: initialProcessTemplateNodes.map((node) => normalizeProcessTemplateNode(node)),
  processInstances: initialProcessInstances.map((instance) => ({ ...instance })),
  workPlans: initialWorkPlans.map((workPlan) => normalizeWorkPlan(workPlan)),
  weeklyReports: initialWeeklyReports.map((report) => ({ ...report })),
  weeklyReportProblems: initialWeeklyReportProblems.map((problem) => ({ ...problem })),
  methodologies: initialMethodologies.map((methodology) => ({ ...methodology })),
  notifications: initialNotifications.map((notification) => ({ ...notification })),
  templates: initialTemplates.map((template) => ({ ...template })),
  templateTagCategories: initialTemplateTagCategories.map((category) => ({ ...category })),
  templateTags: initialTemplateTags.map((tag) => ({ ...tag })),
  issuesRequirements: initialIssuesRequirements.map((item) => ({ ...item })),
  standardWorkForms: initialStandardWorkForms.map((form) => ({ ...form })),
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

function normalizeWorkPlan(workPlan) {
  return {
    ...workPlan,
    workType: workPlan.workType || WorkType.Normal,
  };
}

function getStandardWorkFormTime(form) {
  const timestamp = Date.parse(form?.updatedAt ?? form?.createdAt ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getLatestStandardWorkForm(standardWorkId) {
  if (standardWorkId === null || standardWorkId === undefined || standardWorkId === "") return null;
  return [...state.standardWorkForms]
    .filter((form) => form.standardWorkId === standardWorkId)
    .sort((left, right) =>
      getStandardWorkFormTime(right) - getStandardWorkFormTime(left) ||
      String(right.id ?? "").localeCompare(String(left.id ?? "")),
    )[0] ?? null;
}

export function getLatestStandardWorkFormFields(standardWorkId, fallbackFields = []) {
  const form = getLatestStandardWorkForm(standardWorkId);
  const schemaFields = form?.formSchema?.fields;
  return Array.isArray(schemaFields) && schemaFields.length > 0 ? schemaFields : fallbackFields;
}

export function getDataSnapshot() {
  return {
    companies: state.companies,
    departments: state.departments,
    positions: state.positions,
    people: state.people,
    categories: state.categories,
    stores: state.stores,
    publishingAccounts: state.publishingAccounts,
    goals: state.goals,
    taskTemplates: state.taskTemplates,
    tasks: state.tasks,
    executionGroups: state.executionGroups,
    processTemplates: state.processTemplates,
    processTemplateNodes: state.processTemplateNodes,
    processInstances: state.processInstances,
    contentSchedules: state.contentSchedules,
    workPlans: state.workPlans,
    weeklyReports: state.weeklyReports,
    weeklyReportProblems: state.weeklyReportProblems,
    methodologies: state.methodologies,
    notifications: state.notifications,
    templates: state.templates,
    templateTagCategories: state.templateTagCategories,
    templateTags: state.templateTags,
    issuesRequirements: state.issuesRequirements,
    standardWorkForms: state.standardWorkForms,
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
  replaceArray(state.publishingAccounts, data.publishingAccounts ?? initialPublishingAccounts);
  replaceArray(state.goals, data.goals);
  replaceArray(state.taskTemplates, data.taskTemplates);
  replaceArray(state.tasks, data.tasks);
  replaceArray(state.executionGroups, data.executionGroups ?? initialExecutionGroups);
  replaceArray(state.processTemplates, data.processTemplates);
  replaceArray(
    state.processTemplateNodes,
    (data.processTemplateNodes ?? []).map((node) => normalizeProcessTemplateNode(node)),
  );
  normalizeAllProcessStepOrders();
  normalizeTaskSubmitRequirements();
  replaceArray(state.processInstances, data.processInstances);
  replaceArray(state.contentSchedules, data.contentSchedules);
  replaceArray(state.workPlans, (data.workPlans ?? []).map((workPlan) => normalizeWorkPlan(workPlan)));
  replaceArray(state.weeklyReports, data.weeklyReports);
  replaceArray(state.weeklyReportProblems, data.weeklyReportProblems);
  replaceArray(state.methodologies, data.methodologies);
  replaceArray(state.notifications, data.notifications);
  replaceArray(state.templates, data.templates);
  replaceArray(state.templateTagCategories, data.templateTagCategories ?? initialTemplateTagCategories);
  replaceArray(state.templateTags, data.templateTags ?? initialTemplateTags);
  replaceArray(state.issuesRequirements, data.issuesRequirements ?? initialIssuesRequirements);
  replaceArray(state.standardWorkForms, data.standardWorkForms ?? initialStandardWorkForms);
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
  } catch (error) {
    persistenceAvailable = false;
    loadedFromDatabase = false;
    persistenceStatus = {
      kind: "error",
      message: "本地数据库服务异常，系统已停止进入业务页面，避免使用模拟数据造成误操作。",
    };
    throw new Error(`数据库数据加载失败：${error.message ?? "无法连接本地数据库服务"}`);
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

function getCurrentUserId() {
  return currentUser?.personId ?? currentUser?.id ?? null;
}

function normalizeOptionalId(id) {
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
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

export async function uploadStandardWorkAttachment(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await authFetch(`${apiBaseUrl}/api/uploads/standard-work-attachment`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "表格附件上传失败。");
  return data;
}

export async function loadTemplates() {
  const response = await authFetch(`${apiBaseUrl}/api/templates`);
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.message ?? data.error ?? "模板列表读取失败，请检查本地数据库服务。");
  replaceArray(state.templates, data);
  return state.templates;
}

export async function createTemplate(template) {
  const data = await createPersistentResource("templates", template);
  state.templates.unshift(cloneItem(data));
  return data;
}

export async function updateTemplate(templateId, template) {
  const data = await updatePersistentResource("templates", templateId, template);
  const index = state.templates.findIndex((item) => item.id === templateId);
  if (index >= 0) state.templates.splice(index, 1, cloneItem(data));
  return data;
}

export async function savePersistentData() {
  console.warn("全量数据保存已停用，请使用单条资源接口保存，避免局部前端状态覆盖数据库。");
  hasPendingPersistentChanges = false;
  persistenceAvailable = loadedFromDatabase;
  persistenceStatus = {
    kind: loadedFromDatabase ? "success" : "error",
    message: loadedFromDatabase ? "当前数据已连接本地数据库。" : "本地数据库服务异常，系统已停止进入业务页面。",
  };
  return false;
}

export async function cancelProcessInstance(instanceId, cancelReason = "") {
  const response = await authFetch(`${apiBaseUrl}/api/process-instances/${instanceId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancelReason }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "取消关键行动失败，请检查本地数据库服务。");
  if (data.data !== undefined) applyDataSnapshot(data.data);
  return data;
}

export async function startProcessInstanceExecution(instanceId, { dueDate } = {}) {
  const body = dueDate === undefined ? undefined : JSON.stringify({ dueDate });
  const response = await authFetch(`${apiBaseUrl}/api/process-instances/${instanceId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message ?? data.error ?? "开始执行关键行动失败，请检查本地数据库服务。");
  }
  if (data.data !== undefined) applyDataSnapshot(data.data);
  return data.data;
}

export async function moveTaskTemplateToValueChain(templateId, category) {
  const categoryName = typeof category === "string" ? category : category?.name ?? "";
  const categoryId = typeof category === "string" ? undefined : category?.id;
  const response = await authFetch(`${apiBaseUrl}/api/task-templates/${templateId}/value-chain`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoryName, categoryId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message ?? data.error ?? "关键行动分类保存失败，请检查本地数据库服务。");
  }
  if (data.data !== undefined) applyDataSnapshot(data.data);
  return data;
}

export async function updateProcessTemplateNodeStatus(nodeId, status) {
  const response = await authFetch(`${apiBaseUrl}/api/process-template-nodes/${nodeId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message ?? data.error ?? "标准节点状态保存失败，请检查本地数据库服务。");
  }
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

async function postExecutionGroupAction(path, payload = {}) {
  const response = await authFetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message ?? data.error ?? "执行组保存失败，请检查本地数据库服务。");
  }
  if (data.data !== undefined) applyDataSnapshot(data.data);
  return data.data;
}

export async function createExecutionGroup(payload) {
  return postExecutionGroupAction("/api/execution-groups/create", payload);
}

export async function startExecutionGroup(groupId) {
  return postExecutionGroupAction(`/api/execution-groups/${groupId}/start`);
}

export async function cancelExecutionGroup(groupId) {
  return postExecutionGroupAction(`/api/execution-groups/${groupId}/cancel`);
}

export async function completeExecutionGroup(groupId, payload) {
  return postExecutionGroupAction(`/api/execution-groups/${groupId}/complete`, payload);
}

export async function batchUpdateTaskStatus(taskIds, status) {
  const response = await authFetch(`${apiBaseUrl}/api/tasks/batch-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskIds, status }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message ?? data.error ?? "批量任务状态保存失败，请检查本地数据库服务。");
  }
  if (data.data !== undefined) applyDataSnapshot(data.data);
  return data.result ?? null;
}

export async function updateCurrentUserAvatar(avatarUrl) {
  const response = await authFetch(`${apiBaseUrl}/api/me/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ avatarUrl }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message ?? data.error ?? "头像保存失败，请检查本地数据库服务。");
  }
  currentUser = data.user ?? currentUser;
  return currentUser;
}

export async function deletePersistentResource(resource, id) {
  const response = await authFetch(`${apiBaseUrl}/api/${resource}/${id}`, {
    method: "DELETE",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? data.error ?? "删除失败，请检查本地数据库服务。");
  return data;
}

export function schedulePersistentSave() {
  hasPendingPersistentChanges = false;
}

export function flushPersistentSave() {
  window.clearTimeout(saveTimer);
  hasPendingPersistentChanges = false;
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getNow() {
  return new Date().toISOString();
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getReminderTask(taskId) {
  return state.tasks.find((task) => task.id === taskId) ?? null;
}

function isTaskReminderActive(task) {
  return [TaskStatus.Todo, TaskStatus.Doing, TaskStatus.PendingAcceptance].includes(task?.status) && isTaskExecutionStarted(task, state);
}

function getTaskReminderType(task) {
  if (task?.status === TaskStatus.PendingAcceptance) return "pending_acceptance";
  if (task?.dueDate && task.dueDate < getTodayDate()) return "overdue";
  if (task?.dueDate) {
    const dueTime = new Date(`${task.dueDate}T00:00:00`).getTime();
    const todayTime = new Date(`${getTodayDate()}T00:00:00`).getTime();
    const days = Math.round((dueTime - todayTime) / 86400000);
    if (days <= 1) return "due_soon";
  }
  return "assigned";
}

function getTaskReminderTitle(type) {
  if (type === "overdue") return "任务已逾期";
  if (type === "due_soon") return "任务即将到期";
  if (type === "pending_acceptance") return "任务待验收";
  return "你有待处理任务";
}

function getTaskReminderSeverity(type) {
  if (type === "overdue") return "high";
  if (type === "due_soon" || type === "pending_acceptance") return "medium";
  return "normal";
}

function getTaskReminderId(userId, taskId, type) {
  return `notification-${userId}-${taskId}-${type}`;
}

function buildTaskNotification(userId, task, type) {
  const now = getNow();
  return {
    id: getTaskReminderId(userId, task.id, type),
    userId,
    taskId: task.id,
    processInstanceId: task.processInstanceId ?? null,
    type,
    title: getTaskReminderTitle(type),
    message: task.dueDate ? `${task.name}｜截止时间 ${formatBusinessDateTime(task.dueDate)}` : task.name,
    status: "unread",
    severity: getTaskReminderSeverity(type),
    dueDate: task.dueDate ?? null,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function getCurrentUserNotifications() {
  const user = getCurrentUser();
  if (user === null) return [];
  return state.notifications
    .filter((notification) => notification.userId === user.id)
    .filter((notification) => {
      const task = getReminderTask(notification.taskId);
      return task === null || isTaskReminderActive(task);
    })
    .sort((left, right) => {
      const statusOrder = left.status === "unread" && right.status !== "unread" ? -1 : left.status !== "unread" && right.status === "unread" ? 1 : 0;
      if (statusOrder !== 0) return statusOrder;
      const severityOrder = { high: 0, medium: 1, normal: 2 };
      const leftSeverity = severityOrder[left.severity] ?? 3;
      const rightSeverity = severityOrder[right.severity] ?? 3;
      if (leftSeverity !== rightSeverity) return leftSeverity - rightSeverity;
      return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
    });
}

export function getUnreadNotificationCount() {
  return getCurrentUserNotifications().filter((notification) => notification.status === "unread").length;
}

export async function markNotificationRead(notificationId) {
  const notification = state.notifications.find((item) => item.id === notificationId);
  if (notification === undefined || notification.status === "read") return notification ?? null;
  const now = getNow();
  const updatedNotification = { ...notification, status: "read", readAt: now, updatedAt: now };
  await updatePersistentResource("notifications", notificationId, updatedNotification);
  state.notifications = state.notifications.map((item) => (item.id === notificationId ? updatedNotification : item));
  return updatedNotification;
}

export async function markAllNotificationsRead() {
  const unreadNotifications = getCurrentUserNotifications().filter((notification) => notification.status === "unread");
  for (const notification of unreadNotifications) {
    await markNotificationRead(notification.id);
  }
}

export async function syncTaskNotificationsForCurrentUser() {
  const user = getCurrentUser();
  if (user === null || !loadedFromDatabase) return;
  const reminders = state.tasks
    .filter((task) => task.ownerId === user.id)
    .filter((task) => isTaskReminderActive(task))
    .map((task) => buildTaskNotification(user.id, task, getTaskReminderType(task)));

  for (const reminder of reminders) {
    const existing = state.notifications.find((notification) => notification.id === reminder.id);
    if (existing !== undefined) continue;
    try {
      await createPersistentResource("notifications", reminder);
      state.notifications = [reminder, ...state.notifications];
    } catch (error) {
      console.error("任务提醒生成失败", error);
      return;
    }
  }
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
  const durationDays = Number(node.durationDays);
  const durationMinutes = Number(node.durationMinutes);
  const hasValidDurationDays = Number.isFinite(durationDays) && durationDays > 0;
  const hasValidDurationMinutes = Number.isFinite(durationMinutes) && durationMinutes > 0;
  const base = {
    reviewStandard: "按步骤完成标准和输出要求进行审核。",
    stepOrder: node.stepOrder ?? node.stageOrder ?? node.nodeOrder ?? 1,
    departmentId: node.departmentId ?? node.ownerDepartmentId ?? null,
    ownerId: node.ownerId ?? node.defaultOwnerId ?? null,
    executorId: node.executorId ?? null,
    ...node,
    durationDays: hasValidDurationDays ? durationDays : 1,
    durationMinutes: hasValidDurationMinutes ? Math.round(durationMinutes) : hasValidDurationDays ? Math.round(durationDays * 1440) : 120,
  };
  return {
    ...base,
    ...normalizeSubmitRequirement(base),
  };
}

export function getProcessNodeDurationMinutes(node) {
  const durationMinutes = Number(node?.durationMinutes);
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) return Math.round(durationMinutes);
  const durationDays = Number(node?.durationDays);
  if (Number.isFinite(durationDays) && durationDays > 0) return Math.round(durationDays * 1440);
  return 120;
}

function formatBusinessMinuteIsoFromDate(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 16)}:00+08:00`;
}

function parseBusinessDateTime(value) {
  if (value instanceof Date) return value;
  const rawValue = String(value ?? "").trim();
  if (rawValue === "") return new Date();
  const parsed = new Date(rawValue.length === 10 ? `${rawValue}T00:00:00+08:00` : rawValue);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function getBusinessMinuteNow() {
  return formatBusinessMinuteIsoFromDate(new Date());
}

export function addMinutesToBusinessDateTime(value, minutes) {
  const baseDate = parseBusinessDateTime(value);
  const durationMinutes = Number(minutes);
  const nextDate = new Date(baseDate.getTime() + (Number.isFinite(durationMinutes) ? durationMinutes : 0) * 60 * 1000);
  return formatBusinessMinuteIsoFromDate(nextDate);
}

const standardWorkAttachmentsKey = "standardWorkAttachments";

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

export function createOrReuseProcessTemplateForStandardWork({ name, ownerId, departmentId, now = getNow(), templateId = null }) {
  const processName = `${name}标准`;
  const legacyProcessNames = new Map([["新品上新标准", ["新品上架链接标准"]]]);
  const matchingLegacyNames = legacyProcessNames.get(processName) ?? [];
  const existingTemplate = state.processTemplates.find(
    (template) => template.id === templateId || template.name === processName || matchingLegacyNames.includes(template.name),
  );

  if (existingTemplate !== undefined) {
    existingTemplate.name = processName;
    existingTemplate.purpose = `规范【${name}】的任务推进过程。`;
    existingTemplate.applicableDepartmentIds = departmentId ? [departmentId] : [];
    existingTemplate.ownerId = ownerId;
    existingTemplate.startCondition = `由${departmentId ? state.departments.find((department) => department.id === departmentId)?.name ?? "负责部门" : "负责部门"}发起【${name}】时。`;
    existingTemplate.completionCondition = "该关键行动所有标准步骤完成。";
    existingTemplate.overallStandard = "按标准步骤要求完成，并符合各步骤完成标准和审核标准。";
    existingTemplate.status = existingTemplate.status ?? ProcessTemplateStatus.Active;
    existingTemplate.updatedAt = now;
    return existingTemplate.id;
  }

  const processTemplate = {
    id: templateId ?? createId("process-template"),
    name: processName,
    categoryId: null,
    purpose: `规范【${name}】的任务推进过程。`,
    applicableDepartmentIds: departmentId ? [departmentId] : [],
    ownerId,
    startCondition: `由${departmentId ? state.departments.find((department) => department.id === departmentId)?.name ?? "负责部门" : "负责部门"}发起【${name}】时。`,
    completionCondition: "该关键行动所有标准步骤完成。",
    overallStandard: "按标准步骤要求完成，并符合各步骤完成标准和审核标准。",
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
  "任务推进检查",
  "新品上架链接",
];

function field(id, label, key, type, required, placeholder = "", options = null, showInList = true, sortOrder = 1) {
  return { id, label, key, type, required: false, placeholder, options: options ?? [], showInList, sortOrder };
}

function baseStandardWorkFields(prefix) {
  return [
    field(`${prefix}-work-object`, "工作对象", "workObject", "text", true, "例如产品名、页面名、岗位名、事项名", null, true, 1),
    field(`${prefix}-cover`, "相关产品1:1图片", "coverImageUrl", "image", false, "", null, true, 2),
    field(`${prefix}-requirement`, "本次关键行动要求", "workRequirement", "textarea", false, "补充本次关键行动的特殊要求", null, false, 3),
  ];
}

const realStandardWorkDefinitions = [
  {
    id: RectificationWorkTemplate.TaskTemplateId,
    processTemplateId: RectificationWorkTemplate.ProcessTemplateId,
    departmentKey: "admin",
    name: "改善工作",
    description: "用于对超时、退回、返工、延期或人工指定问题进行闭环改善的关键行动。",
    completionStandard: "完成情况说明、原因分析、改善措施、标准优化判断、效果验证和持续应用确认。",
  },
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
    completionStandard: "明确清仓产品、库存数量、清仓策略、任务进度和结果反馈。",
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
    departmentKey: "supply",
    name: "新品上新",
    description: "由供应链部发起新品上新，协调运营、视觉营销等部门完成上架前后的关键节点。",
    completionStandard: "新品完成资料需求、图片制作、商品上架、库存成本交期确认，并进入新品孵化。",
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
      field("new-dev-date", "截止时间", "expectedDoneDate", "datetime_hour", false, "", null, true, 6),
    ],
  },
  {
    id: "task-template-recruitment",
    departmentKey: "admin",
    name: "人员招聘",
    description: "根据部门用人需求推进招聘标准。",
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
    description: "组织公司或部门进行目标拆解和目标对齐，确保目标、关键行动和任务方向一致。",
    completionStandard: "完成目标确认、部门对齐、责任人确认和后续工作安排。",
    extraFields: [
      field("goal-align-object", "对齐对象", "alignmentObject", "text", false, "请输入对齐对象", null, true, 4),
      field("goal-align-period", "对齐周期", "alignmentPeriod", "select", false, "", ["年度", "季度", "月度", "周度"], true, 5),
    ],
  },
  {
    id: "task-template-task-check",
    departmentKey: "admin",
    name: "任务检查",
    description: "检查公司各部门任务推进情况，发现阻碍和延期问题。",
    completionStandard: "完成任务推进检查、问题记录、责任确认和处理反馈。",
    extraFields: [
      field("task-check-dept", "检查部门", "checkDepartment", "select", false, "", [], true, 4),
      field("task-check-period", "检查周期", "checkPeriod", "select", false, "", ["每日", "每周", "每月"], true, 5),
    ],
  },
];

const standardWorkFormDefinitions = {
  改善工作: [
    ["rectificationSource", "改善来源", "select", true, "请选择改善来源", ["超时", "审核退回", "连续返工", "项目延期", "人工创建改善", "其他"], true],
    ["relatedTaskId", "关联任务ID", "text", false, "可填写关联任务 ID", [], true],
    ["relatedProcessInstanceId", "关联工作ID", "text", false, "可填写关联已发起关键行动 ID", [], true],
    ["rectificationObject", "改善对象", "text", true, "例如某个任务、标准、关键行动或具体事项", [], true],
    ["problemSummary", "问题摘要", "textarea", true, "简要说明需要改善的问题", [], false],
    ["dueDate", "截止时间", "datetime_hour", true, "", [], true],
  ],
  发布内容笔记: [
    ["coverImageUrl", "产品图", "image", false, "上传1:1产品图", [], true],
    ["publishDate", "发布日期", "datetime_hour", true, "", [], true],
    ["account", "发布账号", "select", true, "请选择发布账号", ["阿柚", "小茉", "小满", "其他"], true],
    ["contentType", "内容类型", "select", true, "请选择内容类型", ["图文笔记", "视频笔记"], true],
    ["purpose", "目的", "select", true, "请选择目的", ["种草引流", "场景教育", "审美表达", "信任建立", "品牌心智", "转化收割"], true],
    ["audience", "受众人群", "select", true, "请选择受众人群", ["路人", "兴趣人群", "新客", "老客", "流失顾客"], true],
    ["productName", "对应产品", "text", false, "请输入对应产品", [], true],
    ["title", "标题", "text", true, "请输入笔记标题", [], true],
    ["contentText", "内容文案", "textarea", true, "请输入内容文案", [], false],
    ["scene", "参考场景", "text", false, "请输入参考场景", [], true],
    ["hashtags", "话题", "text", false, "例如 #花瓶 #家居软装", [], true],
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
    ["dueDate", "截止时间", "datetime_hour", true, "", [], true],
    ["remark", "补充说明", "textarea", false, "其他特殊要求", [], false],
  ],
  新品上新: [
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
    ["dueDate", "截止时间", "datetime_hour", true, "", [], true],
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
    ["dueDate", "截止时间", "datetime_hour", true, "", [], true],
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
    ["dueDate", "截止时间", "datetime_hour", true, "", [], true],
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
    ["dueDate", "截止时间", "datetime_hour", false, "下次检查时间", [], true],
    ["remark", "补充说明", "textarea", false, "其他说明", [], false],
  ],
  任务检查: [
    ["checkPeriod", "检查周期", "select", true, "请选择检查周期", ["每日", "每周", "每月", "临时"], true],
    ["checkScope", "检查范围", "textarea", true, "检查哪些部门、哪些任务", [], false],
    ["departmentId", "被检查部门", "select", false, "请选择部门", [], true],
    ["checkFocus", "检查重点", "textarea", true, "进度、逾期、卡点、质量等", [], false],
    ["foundProblems", "发现问题", "textarea", false, "检查后填写发现的问题", [], false],
    ["impactLevel", "影响程度", "select", false, "请选择影响程度", ["轻微", "一般", "严重"], true],
    ["rectificationRequirement", "改善要求", "textarea", false, "发现问题后的改善要求", [], false],
    ["rectificationDueDate", "改善截止时间", "datetime_hour", false, "", [], true],
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
  if (!["新品上架链接", "新品上新"].includes(template.name) || !Array.isArray(template.formFields)) return template;
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

function syncNewProductLaunchProcessNodes(templateId, departmentsByKey, now) {
  const processTemplate = state.processTemplates.find((template) => template.id === templateId);
  if (processTemplate === undefined) return false;

  const departmentByKey = (key) => departmentsByKey.get(key)?.id ?? null;
  const nodeDefinitions = [
    {
      id: "node-new-product-launch-001",
      departmentId: departmentByKey("supply"),
      name: "发起新品上新",
      description: "供应链部确认新品基础信息，发起新品上新标准。",
      completionStandard: "新品名称、供应商、基础规格、初步成本和预计交期信息完整。",
      outputRequirement: "新品上新基础信息",
    },
    {
      id: "node-new-product-launch-002",
      departmentId: departmentByKey("operation"),
      name: "提交详情页和买家秀需求",
      description: "运营根据新品定位提交详情页、买家秀和上架素材需求。",
      completionStandard: "详情页表达重点、买家秀需求、上架店铺和预计上架时间清楚。",
      outputRequirement: "详情页和买家秀需求说明",
    },
    {
      id: "node-new-product-launch-003",
      departmentId: departmentByKey("visual"),
      name: "制作图片",
      description: "视觉营销部根据需求制作主图、详情页和买家秀相关图片。",
      completionStandard: "图片清晰、风格统一、产品表达准确，符合上架和内容使用要求。",
      outputRequirement: "新品上新图片素材",
    },
    {
      id: "node-new-product-launch-004",
      departmentId: departmentByKey("operation"),
      name: "上架产品",
      description: "运营完成商品链接创建、信息填写、图片上传和基础设置。",
      completionStandard: "商品链接完整上线，标题、价格、主图、详情、SKU 等信息准确无误。",
      outputRequirement: "商品上架链接",
    },
    {
      id: "node-new-product-launch-005",
      departmentId: departmentByKey("supply"),
      name: "确认库存、成本、交期",
      description: "供应链部确认新品库存、成本、交期和补货保障。",
      completionStandard: "库存数量、成本区间、交付时间和补货风险已确认。",
      outputRequirement: "库存、成本、交期确认结果",
    },
    {
      id: "node-new-product-launch-006",
      departmentId: departmentByKey("operation"),
      name: "进入新品孵化",
      description: "运营将新品纳入新品孵化节奏，开始跟踪内容、流量和转化表现。",
      completionStandard: "新品孵化计划已建立，核心观察指标和后续动作明确。",
      outputRequirement: "新品孵化计划",
    },
  ];

  let changed = false;
  const nodesForTemplate = state.processTemplateNodes.filter((node) => node.templateId === templateId);

  nodeDefinitions.forEach((definition, index) => {
    const existing = nodesForTemplate.find((node) => node.id === definition.id || node.name === definition.name);
    if (existing !== undefined) return;

    const nodeData = normalizeProcessTemplateNode({
      id: definition.id,
      templateId,
      stageName: "新品上新标准",
      stageOrder: index + 1,
      nodeOrder: 1,
      stepOrder: index + 1,
      name: definition.name,
      ownerRule: ProcessOwnerRule.DepartmentLeader,
      ownerDepartmentId: definition.departmentId,
      departmentId: definition.departmentId,
      ownerPositionId: null,
      defaultOwnerId: resolveDepartmentOwner(definition.departmentId),
      ownerId: resolveDepartmentOwner(definition.departmentId),
      executorId: null,
      durationDays: 1,
      durationMinutes: 1440,
      description: definition.description,
      completionStandard: definition.completionStandard,
      needAcceptance: false,
      accepterRule: ProcessAccepterRule.None,
      defaultAccepterId: null,
      outputRequirement: definition.outputRequirement,
      status: ProcessTemplateNodeStatus.Active,
      createdAt: now,
      updatedAt: now,
    });

    state.processTemplateNodes = [...state.processTemplateNodes, nodeData];
    changed = true;
  });

  return changed;
}

function rectificationSubmitField(key, label, type = "textarea", required = true, placeholder = "", options = [], sortOrder = 1) {
  return {
    id: `rectification-${key}`,
    key,
    label,
    type,
    required,
    placeholder,
    options,
    showInList: false,
    sortOrder,
  };
}

const rectificationNodeSubmitFields = {
  情况说明: [
    rectificationSubmitField("whatHappened", "发生了什么", "textarea", true, "描述问题经过、影响范围和当前状态", [], 1),
    rectificationSubmitField("whyHappened", "为什么发生", "textarea", true, "说明直接原因和背景因素", [], 2),
    rectificationSubmitField("whyNotAvoided", "为什么没有提前避免", "textarea", true, "说明预警、检查或协同中缺失的环节", [], 3),
  ],
  原因分析: [
    rectificationSubmitField("causeAttribution", "问题归因", "multi_select", true, "请选择问题归因", ["人员能力", "关键行动", "标准设计", "资源不足", "外部原因", "其它"], 1),
    rectificationSubmitField("causeAnalysis", "原因分析", "textarea", true, "从人员、标准、资源等角度分析根因", [], 2),
  ],
  改善措施: [
    rectificationSubmitField("improvementActions", "改善措施", "textarea", true, "列出具体改善动作、预期结果和检查方式", [], 1),
    rectificationSubmitField("improvementOwner", "措施负责人", "person", true, "请选择措施负责人", [], 2),
    rectificationSubmitField("improvementDueAt", "完成时间", "datetime_hour", true, "", [], 3),
  ],
  标准优化: [
    rectificationSubmitField("needStandardUpdate", "是否需要优化标准", "select", true, "请选择", ["需要", "不需要"], 1),
    rectificationSubmitField("standardUpdateScope", "优化范围", "multi_select", true, "请选择优化范围", ["关键行动", "标准", "表单", "完成标准", "无需优化"], 2),
    rectificationSubmitField("standardUpdateNote", "优化说明", "textarea", false, "说明需要优化的内容，或无需优化的理由", [], 3),
  ],
  效果验证: [
    rectificationSubmitField("verificationResult", "验证结果", "select", true, "请选择验证结果", ["已解决", "部分改善", "无改善"], 1),
    rectificationSubmitField("verificationNote", "验证说明", "textarea", true, "说明验证方式、效果和仍需关注的问题", [], 2),
  ],
  持续应用: [
    rectificationSubmitField("rectificationSummary", "改善总结", "textarea", true, "总结本次改善结论和关键经验", [], 1),
    rectificationSubmitField("continuousApplicationRequirement", "后续任务要求", "textarea", true, "说明后续如何持续落实、检查和复盘", [], 2),
  ],
};

export function getRectificationSubmitFields(nodeName) {
  return (rectificationNodeSubmitFields[nodeName] ?? []).map((field) => ({
    ...field,
    options: Array.isArray(field.options) ? [...field.options] : [],
  }));
}

function syncRectificationProcessNodes(templateId, ownerId, departmentId, now) {
  const processTemplate = state.processTemplates.find((template) => template.id === templateId);
  if (processTemplate === undefined) return false;

  const fixedNodes = [
    {
      id: "node-rectification-001",
      name: "情况说明",
      ownerRule: ProcessOwnerRule.Initiator,
      ownerId: null,
      defaultOwnerId: null,
      durationMinutes: 30,
      description: "执行人说明问题经过、发生原因，以及为什么没有提前避免。",
      completionStandard: "完整填写发生了什么、为什么发生、为什么没有提前避免。",
      outputRequirement: "改善情况说明",
      submitDescription: "请如实说明情况，作为后续原因分析和改善措施的依据。",
      submitFields: getRectificationSubmitFields("情况说明"),
    },
    {
      id: "node-rectification-002",
      name: "原因分析",
      durationMinutes: 60,
      description: "负责人分析问题根因，明确责任和改进方向。",
      completionStandard: "完成原因分析，区分直接原因、管理原因和标准缺口。",
      outputRequirement: "原因分析结论",
      submitDescription: "请完成负责人原因分析。",
      submitFields: getRectificationSubmitFields("原因分析"),
    },
    {
      id: "node-rectification-003",
      name: "改善措施",
      durationMinutes: 120,
      description: "负责人制定改善动作，明确后续落实方式。",
      completionStandard: "改善措施具体、可落地，并能对应前一步原因分析。",
      outputRequirement: "改善措施",
      submitDescription: "请填写准备采取的改善措施。",
      submitFields: getRectificationSubmitFields("改善措施"),
    },
    {
      id: "node-rectification-004",
      name: "标准优化",
      durationMinutes: 60,
      description: "负责人判断是否需要更新关键行动。本阶段只保留入口，不直接更新标准。",
      completionStandard: "已判断是否需要标准优化，并记录理由。",
      outputRequirement: "标准优化判断",
      submitDescription: "请判断是否需要更新关键行动。",
      submitFields: getRectificationSubmitFields("标准优化"),
    },
    {
      id: "node-rectification-005",
      name: "效果验证",
      durationMinutes: 1440,
      description: "负责人验证改善措施是否产生效果。",
      completionStandard: "完成效果验证，并记录验证结果。",
      outputRequirement: "效果验证结果",
      submitDescription: "请填写改善效果验证结果。",
      submitFields: getRectificationSubmitFields("效果验证"),
    },
    {
      id: "node-rectification-006",
      name: "持续应用",
      durationMinutes: 30,
      description: "负责人确认改善结果可以持续应用，改善工作完成。",
      completionStandard: "确认改善措施已进入日常落实或管理动作。",
      outputRequirement: "持续应用确认",
      submitDescription: "请确认改善结果如何持续应用。",
      submitFields: getRectificationSubmitFields("持续应用"),
    },
  ];

  let changed = false;
  const nodesForTemplate = state.processTemplateNodes.filter((node) => node.templateId === templateId);

  fixedNodes.forEach((definition, index) => {
    const existing = nodesForTemplate.find((node) => node.id === definition.id || node.name === definition.name);
    const nodeData = normalizeProcessTemplateNode({
      ...(existing ?? {}),
      id: existing?.id ?? definition.id,
      templateId,
      stageName: "改善工作标准",
      stageOrder: index + 1,
      nodeOrder: 1,
      stepOrder: index + 1,
      name: definition.name,
      ownerRule: definition.ownerRule ?? ProcessOwnerRule.FixedPerson,
      ownerDepartmentId: departmentId,
      departmentId,
      ownerPositionId: null,
      defaultOwnerId: definition.defaultOwnerId ?? ownerId,
      ownerId: definition.ownerId === undefined ? ownerId : definition.ownerId,
      executorId: null,
      durationDays: Math.max(1 / 1440, definition.durationMinutes / 1440),
      durationMinutes: definition.durationMinutes,
      description: definition.description,
      completionStandard: definition.completionStandard,
      needAcceptance: false,
      accepterRule: ProcessAccepterRule.None,
      defaultAccepterId: null,
      outputRequirement: definition.outputRequirement,
      submitType: SubmitType.Form,
      submitDescription: definition.submitDescription,
      submitFields: definition.submitFields,
      status: ProcessTemplateNodeStatus.Active,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (existing === undefined) {
      state.processTemplateNodes = [...state.processTemplateNodes, nodeData];
      changed = true;
      return;
    }

    const hasChanged = JSON.stringify(existing) !== JSON.stringify(nodeData);
    if (hasChanged) {
      state.processTemplateNodes = state.processTemplateNodes.map((node) => (node.id === existing.id ? nodeData : node));
      changed = true;
    }
  });

  return changed;
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
  return (
    state.categories
      .filter((category) => category.type === CategoryType.Task && category.status !== Status.Inactive)
      .sort((left, right) => (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999))[0]?.id ?? null
  );
}

function isValidTaskCategoryId(categoryId) {
  if (categoryId === null || categoryId === undefined || categoryId === "") return false;
  return state.categories.some(
    (category) => category.id === categoryId && category.type === CategoryType.Task && category.status !== Status.Inactive,
  );
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
    const isNewTemplate = existing === undefined;
    const defaultProcessTemplateId = createOrReuseProcessTemplateForStandardWork({
      name: definition.name,
      ownerId,
      departmentId,
      now,
      templateId: definition.processTemplateId ?? null,
    });
    if (isNewTemplate && definition.id === "task-template-new-product-link") {
      changed = syncNewProductLaunchProcessNodes(defaultProcessTemplateId, departmentsByKey, now) || changed;
    }
    if (definition.id === RectificationWorkTemplate.TaskTemplateId) {
      changed = syncRectificationProcessNodes(defaultProcessTemplateId, ownerId, departmentId, now) || changed;
    }
    const defaultFormFields = buildStandardWorkFormFields(definition);
    const defaultValueChainName = getValueModuleName(inferValueModuleIdFromText(definition.name), "");
    const defaultValueChainCategoryId =
      state.categories.find((category) => category.type === CategoryType.Task && category.status !== Status.Inactive && category.name === defaultValueChainName)?.id
      ?? defaultCategoryId;
    const categoryId = isNewTemplate
      ? defaultValueChainCategoryId
      : existing.categoryId ?? defaultValueChainCategoryId;
    const templateData = {
      name: existing?.name ?? definition.name,
      categoryId,
      departmentId: existing?.departmentId ?? departmentId,
      ownerId: existing?.ownerId ?? ownerId,
      description: existing?.description ?? definition.description,
      completionStandard: existing?.completionStandard ?? definition.completionStandard,
      needAcceptance: existing?.needAcceptance ?? false,
      accepterId: existing?.accepterId ?? null,
      defaultProcessTemplateId:
        definition.id === RectificationWorkTemplate.TaskTemplateId
          ? defaultProcessTemplateId
          : existing?.defaultProcessTemplateId ?? defaultProcessTemplateId,
      status: existing?.status ?? TaskTemplateStatus.Active,
      updatedAt: existing?.updatedAt ?? now,
    };

    if (isNewTemplate) {
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
      formFields: existing.formFields,
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

export function formatProcessStepLabel(stepOrder) {
  const number = Number(stepOrder);
  if (!Number.isInteger(number) || number <= 0) return "步骤";
  return `步骤${formatChineseNumber(number)}`;
}

function formatChineseNumber(number) {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (number <= 9) return digits[number];
  if (number <= 99) {
    const tens = Math.floor(number / 10);
    const ones = number % 10;
    const tensText = tens === 1 ? "十" : `${digits[tens]}十`;
    return ones === 0 ? tensText : `${tensText}${digits[ones]}`;
  }
  return String(number);
}

export function normalizeProcessStepOrders(templateId) {
  const sortedNodes = sortProcessNodes(
    state.processTemplateNodes.filter((node) => node.templateId === templateId && node.status !== ProcessTemplateNodeStatus.Deleted),
  );
  const orderById = new Map(sortedNodes.map((node, index) => [node.id, index + 1]));
  state.processTemplateNodes = state.processTemplateNodes.map((node) => {
    const stepOrder = orderById.get(node.id);
    if (stepOrder === undefined) return node;
    return {
      ...node,
      stepOrder,
      stageName: "默认标准",
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

function resolveExecutor(node, ownerId) {
  return node.executorId ?? ownerId;
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
  const resolvedInitiatorId = normalizeOptionalId(initiatorId) ?? getCurrentUserId();
  if (resolvedInitiatorId === null) {
    return { error: "无法确认当前发起人，请重新登录后再试。" };
  }
  const template = state.processTemplates.find((item) => item.id === templateId);
  if (template === undefined || template.status !== ProcessTemplateStatus.Active) {
    return { error: "只能发起启用状态的关键行动标准流程。" };
  }

  const nodes = state.processTemplateNodes
    .filter((node) => node.templateId === templateId && node.status === ProcessTemplateNodeStatus.Active)
    .sort((left, right) => getProcessNodeStepOrder(left) - getProcessNodeStepOrder(right));
  if (nodes.length === 0) {
    return { error: "该关键行动标准流程尚未配置标准步骤，请先到关键行动模块中编辑步骤。" };
  }

  for (const node of nodes) {
    const ownerId = resolveOwner(node, resolvedInitiatorId, launchAssignments);
    if (ownerId === null) return { error: `标准步骤“${node.name}”无法解析负责人。` };
  }

  const now = getNow();
  const primaryCoverImageUrl = coverImageUrl || getPrimaryImageUrl({ customFields });
  const instance = {
    id: createId("process-instance"),
    templateId,
    taskTemplateId,
    templateVersion: template.version,
    name,
    goalId,
    initiatorId: resolvedInitiatorId,
    description,
    status: ProcessInstanceStatus.Running,
    startedAt: null,
    dueDate: null,
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
    const ownerId = resolveOwner(node, resolvedInitiatorId, launchAssignments);
    return {
      id: createId("task"),
      name: node.name,
      goalId,
      source: TaskSource.Process,
      processInstanceId: instance.id,
      processNodeId: node.id,
      categoryId: null,
      departmentId: node.departmentId ?? node.ownerDepartmentId ?? template.applicableDepartmentIds[0],
      ownerId,
      executorId: resolveExecutor(node, ownerId),
      initiatorId: resolvedInitiatorId,
      description: node.description,
      completionStandard: node.completionStandard,
      reviewStandard: null,
      outputRequirement: null,
      startDate: null,
      dueDate: null,
      plannedWeek: null,
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

function enrichStandardWorkAttachments(customFields, { standardWorkId, workPlanId, processInstanceId, taskIds }) {
  const attachments = customFields?.[standardWorkAttachmentsKey];
  if (!Array.isArray(attachments) || attachments.length === 0) return customFields;
  return {
    ...customFields,
    [standardWorkAttachmentsKey]: attachments.map((attachment) => ({
      ...attachment,
      standardWorkId: attachment.standardWorkId ?? standardWorkId,
      workPlanId: attachment.workPlanId ?? workPlanId,
      processInstanceId: attachment.processInstanceId ?? processInstanceId,
      taskIds: Array.isArray(attachment.taskIds) && attachment.taskIds.length > 0 ? attachment.taskIds : taskIds,
    })),
  };
}

export async function launchWorkPlanAsProcess(workPlanId, { initiatorId = null, launchAssignments = null } = {}) {
  const workPlan = state.workPlans.find((item) => item.id === workPlanId);
  if (workPlan === undefined) throw new Error("未找到该待发起工作计划。");
  if (workPlan.processInstanceId || workPlan.status === WorkPlanStatus.Launched) {
    throw new Error("该工作已经发起，不能重复发起。");
  }

  const taskTemplate = state.taskTemplates.find((template) => template.id === workPlan.taskTemplateId);
  if (taskTemplate === undefined) throw new Error("该关键行动计划未关联关键行动。");
  if (!taskTemplate.defaultProcessTemplateId) throw new Error("该关键行动尚未绑定关键行动标准流程。");

  const previousProcessInstances = [...state.processInstances];
  const previousTasks = [...state.tasks];
  const previousWorkPlans = [...state.workPlans];
  const now = getNow();
  const title = workPlan.title || taskTemplate.name || "未命名工作";
  const resolvedInitiatorId = normalizeOptionalId(initiatorId) ?? getCurrentUserId();
  if (resolvedInitiatorId === null) throw new Error("无法确认当前发起人，请重新登录后再试。");
  const result = startProcess({
    templateId: taskTemplate.defaultProcessTemplateId,
    taskTemplateId: taskTemplate.id,
    customFields: workPlan.customFields ?? {},
    displayTitle: title,
    coverImageUrl: getPrimaryImageUrl(workPlan) || null,
    name: title,
    goalId: workPlan.goalId,
    initiatorId: resolvedInitiatorId,
    description: workPlan.description || `由待发起工作计划发起：${title}`,
    launchAssignments: launchAssignments ?? { owner: {}, accepter: {} },
  });

  if (result.error !== undefined) throw new Error(result.error);

  const launchedInstance = {
    ...result.instance,
    dueDate: null,
    updatedAt: now,
  };
  const generatedTasks = state.tasks.filter((task) => task.processInstanceId === result.instance.id);
  const taskIds = generatedTasks.map((task) => task.id);
  launchedInstance.customFields = enrichStandardWorkAttachments(launchedInstance.customFields ?? {}, {
    standardWorkId: taskTemplate.id,
    workPlanId: workPlan.id,
    processInstanceId: launchedInstance.id,
    taskIds,
  });
  const launchedWorkPlan = {
    ...workPlan,
    workType: workPlan.workType || WorkType.Normal,
    status: WorkPlanStatus.Launched,
    processInstanceId: launchedInstance.id,
    dueDate: null,
    customFields: launchedInstance.customFields,
    launchedAt: now,
    updatedAt: now,
  };

  state.processInstances = state.processInstances.map((instance) => (instance.id === launchedInstance.id ? launchedInstance : instance));

  try {
    const response = await authFetch(`${apiBaseUrl}/api/work-plans/${workPlanId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        processInstance: launchedInstance,
        tasks: generatedTasks,
        workPlan: launchedWorkPlan,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true) {
      throw new Error(data.message ?? data.error ?? "发起关键行动失败，请检查本地数据库服务。");
    }
    if (data.data !== undefined) applyDataSnapshot(data.data);
    return { instance: launchedInstance, workPlan: launchedWorkPlan, tasks: generatedTasks };
  } catch (error) {
    state.processInstances = previousProcessInstances;
    state.tasks = previousTasks;
    state.workPlans = previousWorkPlans;
    throw error;
  }
}

export async function launchWorkPlanDraftAsProcess(workPlan, options = {}) {
  const previousWorkPlans = [...state.workPlans];
  const existingIndex = state.workPlans.findIndex((item) => item.id === workPlan.id);
  if (existingIndex >= 0) {
    state.workPlans = state.workPlans.map((item) => (item.id === workPlan.id ? workPlan : item));
  } else {
    state.workPlans = [workPlan, ...state.workPlans];
  }

  try {
    return await launchWorkPlanAsProcess(workPlan.id, options);
  } catch (error) {
    state.workPlans = previousWorkPlans;
    throw error;
  }
}

function getRectificationTaskExecutorId(task) {
  return task?.executorId ?? task?.assigneeId ?? task?.ownerId ?? null;
}

function getRectificationSourceProcessInstance(task, processInstanceId = null) {
  const instanceId = processInstanceId ?? task?.processInstanceId ?? null;
  if (!instanceId) return null;
  return state.processInstances.find((instance) => instance.id === instanceId) ?? null;
}

function getRectificationSourceStandardWorkId(task, processInstance = null) {
  return processInstance?.taskTemplateId ?? processInstance?.standardWorkId ?? task?.taskTemplateId ?? null;
}

export function hasOpenRectificationWorkForSource({ sourceTaskId = null, sourceProcessInstanceId = null, sourceType = "" } = {}) {
  return state.workPlans.some((workPlan) => {
    if (workPlan.workType !== WorkType.Rectification) return false;
    if (workPlan.status === WorkPlanStatus.Canceled) return false;
    const customFields = workPlan.customFields ?? {};
    const taskMatched = sourceTaskId !== null && sourceTaskId !== "" && customFields.sourceTaskId === sourceTaskId;
    const processMatched =
      sourceProcessInstanceId !== null &&
      sourceProcessInstanceId !== "" &&
      customFields.sourceProcessInstanceId === sourceProcessInstanceId &&
      (sourceType === "" || customFields.sourceType === sourceType);
    if (!taskMatched && !processMatched) return false;
    const instance = state.processInstances.find((item) => item.id === workPlan.processInstanceId);
    return instance?.status !== ProcessInstanceStatus.Done && instance?.status !== ProcessInstanceStatus.Stopped && instance?.status !== "canceled";
  });
}

const rectificationSourceLabels = {
  overdue_task: "任务超时",
  acceptance_rejected: "审核退回",
  rework_twice: "连续返工",
  project_delayed: "项目延期",
  manual: "人工创建改善",
};

export async function launchRectificationWorkForSource({ sourceTaskId = null, sourceProcessInstanceId = null, sourceType = "manual", problemSummary = "" } = {}) {
  const sourceTask = sourceTaskId ? state.tasks.find((task) => task.id === sourceTaskId) ?? null : null;
  const sourceProcessInstance = getRectificationSourceProcessInstance(sourceTask, sourceProcessInstanceId);
  if (sourceTask === null && sourceProcessInstance === null) throw new Error("未找到改善来源。");
  if (hasOpenRectificationWorkForSource({ sourceTaskId, sourceProcessInstanceId: sourceProcessInstance?.id ?? sourceProcessInstanceId, sourceType })) {
    throw new Error("该异常来源已存在未完成的改善工作，不能重复发起。");
  }

  const rectificationTemplate = state.taskTemplates.find((template) => template.id === RectificationWorkTemplate.TaskTemplateId) ?? null;
  if (rectificationTemplate === null || !rectificationTemplate.defaultProcessTemplateId) {
    throw new Error("改善工作标准模板尚未初始化，请刷新系统后重试。");
  }

  const now = getNow();
  const sourceStandardWorkId = getRectificationSourceStandardWorkId(sourceTask, sourceProcessInstance);
  const sourceExecutorId = getRectificationTaskExecutorId(sourceTask);
  const sourceOwnerId = sourceTask?.ownerId ?? null;
  const rectificationObject = sourceTask?.name ?? sourceProcessInstance?.name ?? sourceProcessInstance?.displayTitle ?? "异常工作";
  const sourceLabel = rectificationSourceLabels[sourceType] ?? rectificationSourceLabels.manual;
  const workPlan = {
    id: createId("work-plan"),
    goalId: sourceTask?.goalId ?? sourceProcessInstance?.goalId ?? null,
    departmentId: sourceTask?.departmentId ?? rectificationTemplate.departmentId ?? null,
    taskTemplateId: RectificationWorkTemplate.TaskTemplateId,
    title: `改善：${rectificationObject}`,
    customFields: {
      rectificationSource: sourceLabel,
      sourceType,
      sourceTaskId,
      sourceProcessInstanceId: sourceProcessInstance?.id ?? sourceProcessInstanceId,
      sourceStandardWorkId,
      sourceExecutorId,
      sourceOwnerId,
      rectificationObject,
      problemSummary: problemSummary || `${sourceLabel}异常需要发起改善：${rectificationObject}`,
    },
    coverImageUrl: sourceTask?.coverImageUrl ?? sourceProcessInstance?.coverImageUrl ?? null,
    workType: WorkType.Rectification,
    status: WorkPlanStatus.ThisWeek,
    plannedWeek: "",
    dueDate: null,
    description: `由系统针对${sourceLabel}异常自动发起改善：${rectificationObject}`,
    processInstanceId: null,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    canceledAt: null,
  };

  await createPersistentResource("work-plans", workPlan);
  state.workPlans = [workPlan, ...state.workPlans];
  try {
    return await launchWorkPlanAsProcess(workPlan.id);
  } catch (error) {
    const canceledWorkPlan = {
      ...workPlan,
      status: WorkPlanStatus.Canceled,
      canceledAt: getNow(),
      updatedAt: getNow(),
      customFields: {
        ...(workPlan.customFields ?? {}),
        rectificationLaunchFailure: error?.message ?? String(error ?? "改善工作发起失败"),
      },
    };
    await updatePersistentResource("work-plans", workPlan.id, canceledWorkPlan).catch(() => {});
    state.workPlans = state.workPlans.map((item) => (item.id === workPlan.id ? canceledWorkPlan : item));
    throw error;
  }
}

export async function recordRectificationTriggerFailure(taskId, sourceType, error) {
  const task = state.tasks.find((item) => item.id === taskId) ?? null;
  if (task === null) return null;
  const now = getNow();
  const failure = {
    sourceType,
    failedAt: now,
    message: error?.message ?? String(error ?? "改善工作自动触发失败"),
  };
  const customFields = {
    ...(task.customFields ?? {}),
    rectificationTriggerFailures: [...(Array.isArray(task.customFields?.rectificationTriggerFailures) ? task.customFields.rectificationTriggerFailures : []), failure],
  };
  const updatedTask = { ...task, customFields, updatedAt: now };
  const savedTask = await updatePersistentResource("tasks", taskId, updatedTask);
  state.tasks = state.tasks.map((item) => (item.id === taskId ? savedTask : item));
  return savedTask;
}

function getOrderedProcessInstanceTasks(instanceId) {
  return state.tasks
    .filter((item) => item.processInstanceId === instanceId && item.status !== TaskStatus.Canceled)
    .sort((left, right) => {
      const leftNode = state.processTemplateNodes.find((node) => node.id === left.processNodeId);
      const rightNode = state.processTemplateNodes.find((node) => node.id === right.processNodeId);
      return getProcessNodeStepOrder(leftNode ?? {}) - getProcessNodeStepOrder(rightNode ?? {});
    });
}

function isRectificationProcessInstance(instance) {
  return instance?.taskTemplateId === RectificationWorkTemplate.TaskTemplateId;
}

function arePreviousProcessTasksDone(orderedTasks, taskIndex) {
  if (taskIndex < 0) return false;
  return orderedTasks.slice(0, taskIndex).every((item) => item.status === TaskStatus.Done);
}

async function activateWaitingProcessTask(task, startAt = getBusinessMinuteNow()) {
  const now = getNow();
  const startDate = String(startAt ?? "").slice(0, 10) || now.slice(0, 10);
  const node = state.processTemplateNodes.find((candidate) => candidate.id === task.processNodeId);
  const updatedTask = {
    ...task,
    status: TaskStatus.Todo,
    startDate: startAt,
    dueDate: addMinutesToBusinessDateTime(startAt, getProcessNodeDurationMinutes(node)),
    plannedWeek: task.plannedWeek ?? getCurrentWeek(new Date(`${startDate}T00:00:00+08:00`)),
    updatedAt: now,
  };
  await updatePersistentResource("tasks", updatedTask.id, updatedTask);
  state.tasks = state.tasks.map((item) => (item.id === updatedTask.id ? updatedTask : item));
  return updatedTask;
}

export async function refreshProcessTaskReadiness(processInstanceId) {
  const instance = state.processInstances.find((item) => item.id === processInstanceId);
  if (instance === undefined || instance.status !== ProcessInstanceStatus.Running) return null;

  const orderedTasks = getOrderedProcessInstanceTasks(instance.id);
  const nextTask = orderedTasks.find((item) => item.status !== TaskStatus.Done);

  if (nextTask !== undefined) {
    const nextIndex = orderedTasks.findIndex((item) => item.id === nextTask.id);
    if (nextTask.status === TaskStatus.Waiting && arePreviousProcessTasksDone(orderedTasks, nextIndex)) {
      const previousTask = orderedTasks[nextIndex - 1];
      return activateWaitingProcessTask(nextTask, previousTask?.completedAt ?? getBusinessMinuteNow());
    }
    return null;
  }

  if (orderedTasks.length > 0 && orderedTasks.every((item) => item.status === TaskStatus.Done)) {
    const now = getNow();
    const updatedInstance = { ...instance, status: ProcessInstanceStatus.Done, completedAt: now, updatedAt: now };
    await updatePersistentResource("process-instances", updatedInstance.id, updatedInstance);
    state.processInstances = state.processInstances.map((item) => (item.id === updatedInstance.id ? updatedInstance : item));
    if (isRectificationProcessInstance(updatedInstance)) {
      const workPlan = state.workPlans.find((item) => item.processInstanceId === updatedInstance.id);
      if (workPlan !== undefined) {
        const updatedWorkPlan = { ...workPlan, status: WorkPlanStatus.Done, updatedAt: now };
        await updatePersistentResource("work-plans", updatedWorkPlan.id, updatedWorkPlan);
        state.workPlans = state.workPlans.map((item) => (item.id === updatedWorkPlan.id ? updatedWorkPlan : item));
      }
    }
  }
  return null;
}

export async function ensureTaskReadyForExecution(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (task === undefined || task.source !== TaskSource.Process || task.status !== TaskStatus.Waiting) return task ?? null;

  const instance = state.processInstances.find((item) => item.id === task.processInstanceId);
  if (instance === undefined || instance.status !== ProcessInstanceStatus.Running) return task;

  const orderedTasks = getOrderedProcessInstanceTasks(instance.id);
  const taskIndex = orderedTasks.findIndex((item) => item.id === taskId);
  if (arePreviousProcessTasksDone(orderedTasks, taskIndex)) {
    const previousTask = orderedTasks[taskIndex - 1];
    return activateWaitingProcessTask(task, previousTask?.completedAt ?? getBusinessMinuteNow());
  }
  return task;
}

export async function advanceProcessAfterTaskDone(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (task === undefined || task.source !== TaskSource.Process || task.status !== TaskStatus.Done) return;
  await refreshProcessTaskReadiness(task.processInstanceId);
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
