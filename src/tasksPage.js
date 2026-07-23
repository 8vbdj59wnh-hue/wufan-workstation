import {
  advanceProcessAfterTaskDone,
  batchUpdateTaskStatus as batchUpdateTaskStatusResource,
  cancelProcessInstance,
  cancelExecutionGroup as cancelExecutionGroupResource,
  completeExecutionGroup as completeExecutionGroupResource,
  createExecutionGroup as createExecutionGroupResource,
  createPersistentResource,
  createId,
  ensureTaskReadyForExecution,
  formatProcessStepLabel,
  getCurrentWeek,
  getProcessNodeStepOrder,
  getProcessNodeDurationMinutes,
  getCurrentUser,
  getNow,
  getLatestStandardWorkFormFields,
  hasOpenRectificationWorkForSource,
  getRectificationSubmitFields,
  launchWorkPlanDraftAsProcess,
  launchRectificationWorkForSource,
  loadTemplates,
  normalizeSubmitRequirement,
  recordRectificationTriggerFailure,
  resolveAssetUrl,
  sortProcessNodes,
  startExecutionGroup as startExecutionGroupResource,
  state,
  updatePersistentResource,
  uploadGenericFile,
  uploadImageFile,
  uploadStandardWorkAttachment,
} from "./appState.js?v=20260705-state-singleton1";
import { bindContentScheduleEvents, renderContentSchedulePage } from "./contentSchedulePage.js?v=20260705-state-singleton1";
import { hasPermission } from "./permissions.js?v=20260705-state-singleton1";
import {
  CategoryType,
  GoalStatus,
  ProcessInstanceStatus,
  ProcessAccepterRule,
  ProcessOwnerRule,
  ProcessTemplateNodeStatus,
  ProcessTemplateStatus,
  SubmitType,
  TaskSource,
  TaskStatus,
  TaskTemplateStatus,
  WorkPlanStatus,
  RectificationWorkTemplate,
  taskSourceNames,
  submitTypeNames,
  getValueModuleName,
  inferValueModuleIdFromText,
  isValueModuleId,
  ValueModule,
} from "./data/modelOptions.js";
import { getPrimaryImageUrl, hasTaskOverdueRecord, isCanceledStatus, isDoneStatus, isHiddenByDefaultStatus, isTaskOverdue } from "./data/taskUtils.js?v=20260705-state-singleton1";
import {
  getCurrentExecutor as selectCurrentExecutor,
  getCurrentProcessTask as selectCurrentProcessTask,
  getProcessInstanceBusinessStatus as selectProcessInstanceBusinessStatus,
  getProcessProgress as selectProcessProgress,
  isTaskExecutionStarted,
  isProcessInstanceOverdue as selectProcessInstanceOverdue,
  sortProcessInstanceTasks,
} from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
import { getTaskBusinessStatus } from "./data/taskSelectors.js?v=20260723-task-business-status1";
import { bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js?v=20260705-state-singleton1";
import { getMethodologyLinkByNodeId } from "./methodologiesPage.js?v=20260705-state-singleton1";
import { renderWorkFormViewer } from "./workFormViewer.js?v=20260705-state-singleton1";
import { normalizePublicFormFields } from "./publicFormFields.js?v=20260722-public-form-key-normalize1";
import {
  collectBusinessDateTime,
  collectBusinessMinuteDateTime,
  formatBusinessDateTime,
  formatBusinessMinuteDateTime,
  getBusinessDatePart,
  getBusinessHourPart,
  getBusinessMinutePart,
  isBusinessDueDateField,
  renderBusinessHourOptions,
  renderBusinessMinuteOptions,
} from "./businessTime.js?v=20260705-state-singleton1";

function getTodayDateInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const today = getTodayDateInShanghai();
const plannedWeekPattern = /^\d{4}-W\d{2}$/;
const categories = state.categories;
const departments = state.departments;
const goals = state.goals;
const people = state.people;
const stores = state.stores;
const standardWorkAttachmentsKey = "standardWorkAttachments";
const returnRecordsKey = "returnRecords";
const latestReturnReasonKey = "latestReturnReason";
const spreadsheetAttachmentExts = new Set([".xlsx", ".xls", ".csv"]);
const maxStandardWorkAttachmentSize = 20 * 1024 * 1024;

let filters = {
  keyword: "",
  status: "",
  source: "",
  departmentId: "",
  ownerId: "",
  executorId: "",
  goalId: "",
  categoryId: "",
  overdue: "",
  showDone: false,
  showCanceled: false,
};
let processProgressFilters = {
  keyword: "",
  goalId: "",
  templateId: "",
  status: "",
  ownerId: "",
  overdue: "",
  initiatorId: "",
  showDone: false,
  showCanceled: false,
  showStockClearance: false,
};
let clearanceFilters = {
  keyword: "",
  status: "",
  ownerId: "",
  channel: "",
  warehouse: "",
  showDone: false,
  showCanceled: false,
};
let selectedTaskId = state.tasks[0]?.id ?? null;
let selectedProcessInstanceId = state.processInstances[0]?.id ?? null;
let selectedTaskIds = new Set();
let taskDueDateSort = "";
let expandedClearanceGroups = new Set();
let modalState = null;
let activeTaskTab = "task-list";
let taskListView = "today";
let taskDisplayView = "card";
let visualTemplatesLoaded = state.templates.length > 0;
let visualTemplatesLoading = false;

const templateTagCategories = [
  { id: "brand", label: "品牌" },
  { id: "platform", label: "平台" },
  { id: "tone", label: "调性" },
  { id: "format", label: "形式" },
  { id: "usage", label: "用途" },
];

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

function getActiveGoals() {
  return goals.filter((goal) => goal.status !== GoalStatus.Inactive);
}

const taskStatusSelectOptions = [
  TaskStatus.Todo,
  TaskStatus.Doing,
  TaskStatus.PendingAcceptance,
  TaskStatus.Done,
  TaskStatus.Canceled,
].map((status) => ({
  value: status,
  label: getTaskBusinessStatus({ status }).label,
}));

const taskListViewOptions = [
  { value: "today", label: "今天" },
  { value: "mine", label: "我的" },
  { value: "overdue", label: "逾期" },
  { value: "all", label: "全部" },
];

const taskTabHashMap = {
  tasks: "task-list",
  "task-list": "task-list",
  clearance: "clearance",
  "process-progress": "process-progress",
  "content-schedule": "content-schedule",
  contentSchedule: "content-schedule",
  contentSchedules: "content-schedule",
};

const clearanceWorkName = "库存清仓";
const clearanceChannelOptions = ["店铺清仓位", "直播间", "私域", "老客群", "其他"];
const clearanceWarehouseOptions = ["义乌仓", "山西仓", "其他"];
const clearanceImportHeaders = [
  "清仓产品",
  "SKU / 规格",
  "当前库存",
  "仓库",
  "清仓原因",
  "建议清仓价",
  "原售价",
  "清仓渠道",
  "截止时间",
  "注意事项",
  "产品图",
  "关联目标",
  "发起人",
];
const clearanceRequiredImportHeaders = ["清仓产品", "当前库存", "清仓原因", "清仓渠道", "截止时间"];

function getTaskTabFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  return taskTabHashMap[hash] ?? activeTaskTab;
}

function syncTaskTabFromHash() {
  activeTaskTab = getTaskTabFromHash();
}

export function selectTask(taskId) {
  selectedTaskId = taskId;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function findName(items, id, fallback) {
  if (id === null) return fallback;

  return items.find((item) => item.id === id)?.name ?? fallback;
}

function resolvePersonId(value) {
  const normalizedValue = String(value ?? "").trim();
  if (normalizedValue === "") return "";
  return people.find((person) => [person.id, person.name, person.account, person.username].includes(normalizedValue))?.id ?? "";
}

function getTaskExecutorId(task) {
  const customFields = task.customFields && typeof task.customFields === "object" ? task.customFields : {};
  const node = task.processNodeId === undefined || task.processNodeId === null ? null : state.processTemplateNodes.find((item) => item.id === task.processNodeId) ?? null;
  const candidates = [
    task.executorId,
    task.assigneeId,
    task.executor,
    task.assignee,
    customFields.executorId,
    customFields.assigneeId,
    customFields.executorName,
    customFields.assigneeName,
    node?.executorId,
  ];

  for (const candidate of candidates) {
    const personId = resolvePersonId(candidate);
    if (personId !== "") return personId;
  }
  return "";
}

function createEmptyTemplateTags() {
  return Object.fromEntries(templateTagCategories.map((category) => [category.id, []]));
}

function addUniqueTemplateTag(list, tag) {
  const normalizedTag = String(tag ?? "").trim();
  if (normalizedTag === "") return list;
  return list.includes(normalizedTag) ? list : [...list, normalizedTag];
}

function normalizeVisualTemplateTags(tags) {
  const normalizedTags = createEmptyTemplateTags();
  if (Array.isArray(tags)) {
    tags.forEach((tag) => {
      normalizedTags.usage = addUniqueTemplateTag(normalizedTags.usage, tag);
    });
    return normalizedTags;
  }
  if (tags && typeof tags === "object") {
    templateTagCategories.forEach((category) => {
      if (Array.isArray(tags[category.id])) {
        tags[category.id].forEach((tag) => {
          normalizedTags[category.id] = addUniqueTemplateTag(normalizedTags[category.id], tag);
        });
      }
    });
  }
  return normalizedTags;
}

function getFlatVisualTemplateTags(tags) {
  return templateTagCategories.flatMap((category) => normalizeVisualTemplateTags(tags)[category.id] ?? []);
}

function getVisualTemplateName(template) {
  const nameFromTags = getFlatVisualTemplateTags(template?.tags).filter(Boolean).join(" ");
  return nameFromTags || template?.name || "未命名模板";
}

function getVisualTemplateById(templateId) {
  if (!templateId) return null;
  return state.templates.find((template) => template.id === templateId) ?? null;
}

function getVisualTemplatePreviewImage(template) {
  if (template?.previewImage && typeof template.previewImage === "object") return template.previewImage;
  return { fileName: "", fileUrl: "" };
}

function getVisualTemplateSourceFile(template) {
  if (template?.sourceFile && typeof template.sourceFile === "object") return template.sourceFile;
  return { fileName: "", fileUrl: "" };
}

function getVisualTemplateFilterTags() {
  const groupedTags = createEmptyTemplateTags();
  state.templates.forEach((template) => {
    const tags = normalizeVisualTemplateTags(template.tags);
    templateTagCategories.forEach((category) => {
      tags[category.id].forEach((tag) => {
        groupedTags[category.id] = addUniqueTemplateTag(groupedTags[category.id], tag);
      });
    });
  });
  return groupedTags;
}

function getFilteredVisualTemplates() {
  const query = (modalState?.templateQuery ?? "").trim().toLowerCase();
  const selectedTags = normalizeVisualTemplateTags(modalState?.templateTagFilters ?? {});
  return state.templates.filter((template) => {
    const tags = normalizeVisualTemplateTags(template.tags);
    const flatTags = getFlatVisualTemplateTags(tags);
    const searchableText = `${getVisualTemplateName(template)} ${flatTags.join(" ")}`.toLowerCase();
    if (query !== "" && !searchableText.includes(query)) return false;
    return templateTagCategories.every((category) => {
      const requiredTags = selectedTags[category.id] ?? [];
      if (requiredTags.length === 0) return true;
      const templateTags = tags[category.id] ?? [];
      return requiredTags.every((tag) => templateTags.includes(tag));
    });
  });
}

function getTask(taskId) {
  return state.tasks.find((task) => task.id === taskId) ?? null;
}

function getTaskCategories() {
  return categories
    .filter((category) => category.type === CategoryType.Task && category.status !== "inactive")
    .sort((left, right) => (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999) || left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function getActiveTaskTemplates() {
  return state.taskTemplates.filter((template) => template.status === TaskTemplateStatus.Active);
}

function getTaskTemplate(templateId) {
  return state.taskTemplates.find((template) => template.id === templateId) ?? null;
}

function getProcessTemplateName(templateId) {
  return state.processTemplates.find((template) => template.id === templateId)?.name ?? "未绑定关键行动标准流程";
}

function getStandardWorkValueChain(template) {
  return getTaskCategories().find((category) => category.id === template?.categoryId)?.name ?? getValueModuleName(inferValueModuleIdForTemplate(template));
}

function inferValueModuleIdForTemplate(template) {
  if (template === null || template === undefined) return ValueModule.InfrastructureMaintenance;
  const category = categories.find((item) => item.id === template.categoryId && item.type === CategoryType.Task);
  if (category !== undefined) return inferValueModuleIdFromText(category.name);
  const processName = getProcessTemplateName(template.defaultProcessTemplateId ?? "");
  const searchText = [
    template.name,
    processName === "未绑定关键行动标准流程" ? "" : processName,
  ].join(" ");
  return inferValueModuleIdFromText(searchText);
}

function getActiveTaskTemplatesByCategory(categoryId) {
  if (!getTaskCategories().some((category) => category.id === categoryId)) return [];
  return getActiveTaskTemplates().filter((template) => template.categoryId === categoryId);
}

function withValueModuleCustomFields(customFields, valueModuleId) {
  const normalizedValueModuleId = isValueModuleId(valueModuleId) ? valueModuleId : ValueModule.InfrastructureMaintenance;
  return {
    ...customFields,
    valueModuleId: normalizedValueModuleId,
    valueModuleName: getValueModuleName(normalizedValueModuleId),
  };
}

function getTaskTemplateForTask(task) {
  const directTemplate = getTaskTemplate(task.taskTemplateId ?? "");
  if (directTemplate !== null) return directTemplate;
  const instance = getTaskProcessInstance(task);
  return getTaskTemplate(instance?.taskTemplateId ?? "") ?? null;
}

function getTaskCustomFields(task) {
  const instance = getTaskProcessInstance(task);
  const instanceFields = instance?.customFields && typeof instance.customFields === "object" ? instance.customFields : null;
  if (instanceFields !== null && Object.keys(instanceFields).length > 0) return instanceFields;
  return task?.customFields && typeof task.customFields === "object" ? task.customFields : {};
}

function getTaskCoverImage(task) {
  const instance = getTaskProcessInstance(task);
  return getPrimaryImageUrl(task, instance);
}

function getSortedFormFields(template) {
  const sourceFields = normalizePublicFormFields(getLatestStandardWorkFormFields(template?.id, template?.formFields ?? []));
  if (template?.id === "task-template-publish-content-note" || template?.taskTemplateId === "task-template-publish-content-note" || template?.name === "发布内容笔记") {
    sourceFields.forEach((field) => {
      if (field.key === "publishDate") field.type = "datetime_hour";
    });
    [
      { id: "content-note-product-name", label: "对应产品", key: "productName", type: "text", required: false, placeholder: "请输入对应产品", options: [], showInList: true, sortOrder: 7 },
      { id: "content-note-scene", label: "参考场景", key: "scene", type: "text", required: false, placeholder: "请输入参考场景", options: [], showInList: true, sortOrder: 10 },
      { id: "content-note-hashtags", label: "话题", key: "hashtags", type: "text", required: false, placeholder: "例如 #花瓶 #家居软装", options: [], showInList: true, sortOrder: 11 },
    ].forEach((field) => {
      if (!sourceFields.some((item) => item.key === field.key)) sourceFields.push(field);
    });
  }
  return sourceFields.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}

function getCustomFieldValue(customFields, field) {
  const value = customFields[field.key];
  if (Array.isArray(value)) return value.join("、");
  if (field.key === "departmentId") return findName(departments, value, "");
  if (field.key === "interviewerId") return findName(people, value, "");
  if (field.type === "department") return findName(departments, value, "");
  if (field.type === "person") return findName(people, value, "");
  if (field.key === "storeId") return customFields.storeName || findName(stores, value, customFields.platform ?? "");
  return value ?? "";
}

function getStoreOptionLabel(store) {
  return store.platform ? `${store.name}（${store.platform}）` : store.name;
}

function getDynamicFieldOptions(field) {
  if ((field.options ?? []).length > 0) return field.options.map((option) => ({ value: option, label: option }));
  if (field.key === "departmentId") {
    return departments.filter((department) => department.status === "active").map((department) => ({ value: department.id, label: department.name }));
  }
  if (field.type === "department") {
    return departments.filter((department) => department.status === "active").map((department) => ({ value: department.id, label: department.name }));
  }
  if (field.key === "interviewerId") {
    return people.filter((person) => person.status === "active").map((person) => ({ value: person.id, label: person.name }));
  }
  if (field.type === "person") {
    return people.filter((person) => person.status === "active").map((person) => ({ value: person.id, label: person.name }));
  }
  if (field.key === "storeId") {
    return stores.filter((store) => store.status === "active").map((store) => ({ value: store.id, label: getStoreOptionLabel(store) }));
  }
  return [];
}

function isValidUrl(value) {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidImagePath(value) {
  return value === "" || value.startsWith("/uploads/images/") || isValidUrl(value);
}

function includesSubmitPart(submitType, part) {
  if (submitType === SubmitType.None) return false;
  return String(submitType ?? "").split("_").includes(part);
}

function getTaskSubmitRequirement(task) {
  const node = state.processTemplateNodes.find((item) => item.id === task.processNodeId);
  const normalized = normalizeSubmitRequirement(task.submitType ? task : (node ?? task));
  const rectificationFields = getRectificationTaskSubmitFields(task);
  return {
    ...normalized,
    submitFields: rectificationFields.length > 0 ? rectificationFields : normalized.submitFields,
    submitFormData: task.submitFormData && typeof task.submitFormData === "object" ? task.submitFormData : {},
    submitFiles: Array.isArray(task.submitFiles) ? task.submitFiles : [],
    submitLinks: Array.isArray(task.submitLinks) ? task.submitLinks : [],
  };
}

function isRectificationExecutionTask(task) {
  const instance = getTaskProcessInstance(task);
  return instance?.taskTemplateId === RectificationWorkTemplate.TaskTemplateId;
}

function isRectificationStandardOptimizationTask(task) {
  if (!isRectificationExecutionTask(task)) return false;
  const node = state.processTemplateNodes.find((item) => item.id === task.processNodeId);
  return (node?.name ?? task.name) === "标准优化";
}

function isRectificationEffectVerificationTask(task) {
  if (!isRectificationExecutionTask(task)) return false;
  const node = state.processTemplateNodes.find((item) => item.id === task.processNodeId);
  return (node?.name ?? task.name) === "效果验证";
}

function getRectificationTaskSubmitFields(task) {
  if (!isRectificationExecutionTask(task)) return [];
  const node = state.processTemplateNodes.find((item) => item.id === task.processNodeId);
  return getRectificationSubmitFields(node?.name ?? task.name);
}

function getSubmitFields(task) {
  return [...(getTaskSubmitRequirement(task).submitFields ?? [])].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}

function getSubmitFieldValue(formData, field) {
  const value = formData?.[field.key];
  if (Array.isArray(value)) return value.join("、");
  if (field.type === "person") return findName(people, value, value ?? "");
  if (field.type === "datetime_hour") return formatBusinessDateTime(value, "");
  return value ?? "";
}

function validateSubmittedResult(task, nextData = {}, options = {}) {
  if (!isRectificationExecutionTask(task)) return "";
  const formData = nextData.submitFormData ?? task.submitFormData ?? {};
  for (const field of getSubmitFields(task)) {
    if (field.required !== true) continue;
    const value = formData[field.key];
    const isEmpty = Array.isArray(value) ? value.length === 0 : String(value ?? "").trim() === "";
    if (isEmpty) return `请填写${field.label}。`;
  }
  if (isRectificationStandardOptimizationTask(task)) {
    const needStandardUpdate = String(formData.needStandardUpdate ?? "").trim();
    const scope = Array.isArray(formData.standardUpdateScope) ? formData.standardUpdateScope : [];
    if (needStandardUpdate === "") return "请选择是否需要优化标准。";
    if (needStandardUpdate === "需要" && (scope.length === 0 || scope.includes("无需优化"))) {
      return "请选择需要优化的具体范围。";
    }
    if (needStandardUpdate === "不需要" && !scope.includes("无需优化")) {
      return "不需要优化时，请在优化范围中选择“无需优化”。";
    }
  }
  if (isRectificationEffectVerificationTask(task) && options.allowBlockedVerification !== true) {
    const verificationResult = String(formData.verificationResult ?? "").trim();
    if (verificationResult === "部分改善") return "验证结果为“部分改善”，请退回到改善措施节点继续补充改善措施。";
    if (verificationResult === "无改善") return "验证结果为“无改善”，请退回到改善措施节点重新制定改善措施。";
  }
  return "";
}

function hasValidSubmittedResult(task) {
  return validateSubmittedResult(task) === "";
}

function renderSubmitFieldInput(field, value = "") {
  const name = `submit__${field.key}`;
  const common = `name="${escapeHtml(name)}" data-submit-field-key="${escapeHtml(field.key)}"`;
  const options = field.options ?? [];
  if (field.type === "textarea") {
    return `<textarea ${common} rows="3" placeholder="${escapeHtml(field.placeholder ?? "")}">${escapeHtml(value)}</textarea>`;
  }
  if (field.type === "select") {
    return `<select ${common}>${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  }
  if (field.type === "multi_select") {
    const values = Array.isArray(value) ? value : String(value).split("、").filter(Boolean);
    return `<select ${common} multiple>${options.map((option) => `<option value="${escapeHtml(option)}" ${values.includes(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  }
  if (field.type === "person") {
    return `<select ${common}><option value="">请选择</option>${people.map((person) => `<option value="${escapeHtml(person.id)}" ${person.id === value ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select>`;
  }
  if (field.type === "datetime_hour") {
    return `
      <div class="business-time-input">
        <input type="date" name="${escapeHtml(name)}Date" value="${escapeHtml(getBusinessDatePart(value))}" />
        <select name="${escapeHtml(name)}Hour">${renderBusinessHourOptions(getBusinessHourPart(value), "请选择小时")}</select>
      </div>
    `;
  }
  return `<input ${common} type="${field.type === "url" ? "url" : field.type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder ?? "")}" />`;
}

function getRectificationSourceTask(task) {
  const instance = getTaskProcessInstance(task);
  const workPlan = state.workPlans.find((item) => item.processInstanceId === instance?.id) ?? null;
  const sourceTaskId = workPlan?.customFields?.sourceTaskId ?? instance?.customFields?.sourceTaskId ?? task.customFields?.sourceTaskId ?? "";
  return state.tasks.find((item) => item.id === sourceTaskId) ?? null;
}

function getRectificationSourceStandardWork(task) {
  const instance = getTaskProcessInstance(task);
  const workPlan = state.workPlans.find((item) => item.processInstanceId === instance?.id) ?? null;
  const sourceTask = getRectificationSourceTask(task);
  const sourceProcessInstance = state.processInstances.find(
    (item) => item.id === (workPlan?.customFields?.sourceProcessInstanceId ?? instance?.customFields?.sourceProcessInstanceId ?? ""),
  ) ?? null;
  const sourceStandardWorkId =
    workPlan?.customFields?.sourceStandardWorkId ??
    instance?.customFields?.sourceStandardWorkId ??
    sourceTask?.taskTemplateId ??
    sourceProcessInstance?.taskTemplateId ??
    "";
  return getTaskTemplate(sourceStandardWorkId) ?? null;
}

function renderStandardOptimizationActions(task) {
  if (!isRectificationStandardOptimizationTask(task)) return "";
  const sourceStandardWork = getRectificationSourceStandardWork(task);
  return `
    <div class="submit-result-form standard-optimization-actions">
      <strong>立即优化标准</strong>
      <p class="form-note">来源关键行动：${escapeHtml(sourceStandardWork?.name ?? "未定位到来源关键行动")}</p>
      <div class="button-row">
        <button class="secondary-button" type="button" data-action="open-standard-optimization-target" data-task-id="${escapeHtml(task.id)}" data-target="standard-work" ${sourceStandardWork === null ? "disabled" : ""}>修改关键行动</button>
        <button class="secondary-button" type="button" data-action="open-standard-optimization-target" data-task-id="${escapeHtml(task.id)}" data-target="process" ${sourceStandardWork?.defaultProcessTemplateId ? "" : "disabled"}>修改标准</button>
        <button class="secondary-button" type="button" data-action="open-standard-optimization-target" data-task-id="${escapeHtml(task.id)}" data-target="form" ${sourceStandardWork === null ? "disabled" : ""}>修改表单</button>
        <button class="secondary-button" type="button" data-action="open-standard-optimization-target" data-task-id="${escapeHtml(task.id)}" data-target="completion-standard" ${sourceStandardWork?.defaultProcessTemplateId ? "" : "disabled"}>修改完成标准</button>
      </div>
    </div>
  `;
}

function getSubmitFileKey(file) {
  if (typeof file === "string") return file;
  return file?.url ?? file?.filePath ?? file?.filename ?? file?.originalName ?? "";
}

function getVisibleSubmitFiles(files = []) {
  const removedKeys = new Set(modalState?.removedSubmitFileKeys ?? []);
  return files.filter((file) => !removedKeys.has(getSubmitFileKey(file)));
}

function renderSubmitResultForm(task) {
  const requirement = getTaskSubmitRequirement(task);
  if (requirement.submitType === SubmitType.None) {
    return `<p class="form-note">本步骤无需提交结果。</p>`;
  }

  const fields = includesSubmitPart(requirement.submitType, "form")
    ? getSubmitFields(task).map((field) => `
      <label>
        <span>${escapeHtml(field.label)}</span>
        ${renderSubmitFieldInput(field, requirement.submitFormData[field.key] ?? "")}
      </label>
    `).join("")
    : "";
  const fileArea = includesSubmitPart(requirement.submitType, "file")
    ? `
      <label>
        <span>上传文件</span>
        <input type="file" name="submitFiles" data-submit-files multiple />
      </label>
      <div data-selected-submit-files>
        <p class="form-note">暂无新选择附件</p>
      </div>
      <div class="submitted-file-list">
        ${
          getVisibleSubmitFiles(requirement.submitFiles).length === 0
            ? "<p class=\"form-note\">暂无已上传文件</p>"
            : `
              <ul class="attachment-list editable-attachment-list">
                ${getVisibleSubmitFiles(requirement.submitFiles).map((file) => `
                  <li>
                    <a href="${escapeHtml(resolveAssetUrl(file.url ?? file.filePath ?? file))}" target="_blank" rel="noreferrer">${escapeHtml(normalizeDisplayFileName(file.originalName ?? file.filename ?? file.url ?? file))}</a>
                    <button class="text-button" type="button" data-action="remove-existing-submit-file" data-file-key="${escapeHtml(encodeURIComponent(getSubmitFileKey(file)))}">删除</button>
                  </li>
                `).join("")}
              </ul>
            `
        }
      </div>
    `
    : "";
  const linkArea = includesSubmitPart(requirement.submitType, "link")
    ? `
      <label>
        <span>提交链接</span>
        <textarea name="submitLinks" rows="3" placeholder="每行一个链接">${escapeHtml(requirement.submitLinks.join("\n"))}</textarea>
      </label>
    `
    : "";

  return `
    <div class="submit-result-form">
      <p class="form-note">${escapeHtml(requirement.submitDescription ?? "")}</p>
      ${fields}
      ${renderStandardOptimizationActions(task)}
      ${fileArea}
      ${linkArea}
    </div>
  `;
}

function renderCoverImage(task) {
  const imageUrl = getTaskCoverImage(task);
  if (imageUrl === "") return `<span class="task-cover-placeholder">无图</span>`;

  return `
    <img
      class="task-cover-thumb"
      src="${escapeHtml(resolveAssetUrl(imageUrl))}"
      alt="相关产品图片"
      onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'task-cover-placeholder', textContent: '无图' }))"
    />
  `;
}

function renderProcessCoverImage(instance) {
  const imageUrl = getPrimaryImageUrl(instance);
  if (imageUrl === "") return `<span class="task-cover-placeholder">无图</span>`;

  return `
    <img
      class="task-cover-thumb"
      src="${escapeHtml(resolveAssetUrl(imageUrl))}"
      alt="相关产品图片"
      onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'task-cover-placeholder', textContent: '无图' }))"
    />
  `;
}

function buildDisplayTitle(template, customFields) {
  const values = getSortedFormFields(template)
    .filter((field) => field.showInList && field.key !== "coverImageUrl")
    .map((field) => getCustomFieldValue(customFields, field))
    .filter(Boolean)
    .slice(0, 3);

  return values.length === 0 ? template.name : `${template.name}｜${values.join("｜")}`;
}

function renderTaskKeyInfo(task) {
  const template = getTaskTemplateForTask(task);
  if (template === null) return "无";

  const customFields = getTaskCustomFields(task);
  const lines = getSortedFormFields(template)
    .filter((field) => field.showInList && field.key !== "coverImageUrl")
    .map((field) => {
      const value = getCustomFieldValue(customFields, field);
      return value === "" ? "" : `${field.label}：${escapeHtml(value)}`;
    })
    .filter(Boolean);

  return lines.length === 0 ? "无" : lines.join("；");
}

function getTaskProcessInstance(task) {
  if (task.source !== TaskSource.Process || task.processInstanceId === null) return null;
  return state.processInstances.find((instance) => instance.id === task.processInstanceId) ?? null;
}

function getObjectFromFields(customFields = {}) {
  const keys = ["productName", "product", "productTitle", "objectName", "itemName"];
  for (const key of keys) {
    const value = customFields[key];
    if (Array.isArray(value)) {
      const firstValue = value.find((item) => String(item).trim() !== "");
      if (firstValue !== undefined) return String(firstValue).trim();
    }
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function parseObjectFromTitle(title, standardWorkName) {
  if (title === null || title === undefined || title === "") return "";
  const segments = String(title)
    .split("｜")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== standardWorkName);
  if (segments.length === 0) return "";

  const productLikeSegment = segments.find((segment) => /产品|花瓶|杯|托盘|柜|桌|椅|灯|瓶|图|款|新品/u.test(segment));
  return productLikeSegment ?? segments[0];
}

function getStandardWorkNameFromTitle(title) {
  return String(title ?? "")
    .split("｜")
    .map((segment) => segment.trim())
    .filter(Boolean)[0] ?? "";
}

function getTaskBelonging(task) {
  const instance = getTaskProcessInstance(task);
  const taskFields = getTaskCustomFields(task);

  if (instance !== null) {
    const taskTemplateId = instance.taskTemplateId ?? instance.standardWorkId ?? null;
    const taskTemplate = getTaskTemplate(taskTemplateId ?? "");
    const title = instance.displayTitle ?? instance.name;
    const standardWorkName =
      taskTemplate?.name ??
      (getStandardWorkNameFromTitle(task.displayTitle) ||
        getStandardWorkNameFromTitle(title) ||
        "未关联关键行动");
    const objectName =
      getObjectFromFields(taskFields) ||
      getObjectFromFields(instance.customFields) ||
      parseObjectFromTitle(task.displayTitle, standardWorkName) ||
      parseObjectFromTitle(title, standardWorkName) ||
      "未填写对象";

    return {
      objectName,
      standardWorkName,
      title,
      instance,
      taskTemplate,
    };
  }

  const taskTemplate = getTaskTemplateForTask(task);
  const title = task.displayTitle ?? task.name;
  if (taskTemplate !== null) {
    return {
      objectName:
        getObjectFromFields(taskFields) ||
        parseObjectFromTitle(title, taskTemplate.name) ||
        "未填写对象",
      standardWorkName: taskTemplate.name,
      title,
      instance: null,
      taskTemplate,
    };
  }

  const standardWorkName = getStandardWorkNameFromTitle(task.displayTitle) || "未关联关键行动";
  return {
    objectName:
      getObjectFromFields(taskFields) ||
      parseObjectFromTitle(task.displayTitle, standardWorkName) ||
      "未填写对象",
    standardWorkName,
    title: task.displayTitle ?? "",
    instance: null,
    taskTemplate: null,
  };
}

function renderTaskBelonging(task) {
  const belonging = getTaskBelonging(task);
  const secondLine =
    belonging.objectName === belonging.standardWorkName
      ? ""
      : `<span>${escapeHtml(belonging.standardWorkName)}</span>`;
  const mutedClass = belonging.standardWorkName === "未关联关键行动" ? " is-muted" : "";

  return `
    <div class="task-belonging${mutedClass}">
      <strong>${escapeHtml(belonging.objectName)}</strong>
      ${secondLine}
    </div>
  `;
}

function isClearanceTemplate(template) {
  return template?.name === clearanceWorkName;
}

function isClearanceProcessInstance(instance) {
  if (instance === null || instance === undefined) return false;
  const taskTemplate = getTaskTemplate(instance.taskTemplateId ?? instance.standardWorkId ?? "");
  if (isClearanceTemplate(taskTemplate)) return true;
  const names = [instance.standardWorkName, instance.taskTemplateName, instance.displayTitle, instance.name]
    .filter(Boolean)
    .join(" ");
  return names.includes(clearanceWorkName);
}

function isClearanceTask(task) {
  const directTemplate = getTaskTemplate(task.taskTemplateId ?? task.standardWorkId ?? "");
  if (isClearanceTemplate(directTemplate)) return true;
  const instance = getTaskProcessInstance(task);
  if (isClearanceProcessInstance(instance)) return true;
  return getTaskBelonging(task).standardWorkName === clearanceWorkName;
}

function getClearanceCustomFields(instance, tasks = []) {
  if (instance?.customFields !== undefined && instance.customFields !== null) return instance.customFields;
  const firstTask = tasks[0] ?? null;
  return firstTask === null ? {} : getTaskCustomFields(firstTask);
}

function getClearanceField(customFields, keys) {
  for (const key of keys) {
    const value = customFields?.[key];
    if (Array.isArray(value) && value.length > 0) return value.join("、");
    if (value !== null && value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function renderClearanceValue(value) {
  return escapeHtml(value === "" ? "未填写" : value);
}

function getClearanceDisplayInfo(instance, tasks = []) {
  const customFields = getClearanceCustomFields(instance, tasks);
  const fallbackTask = tasks[0] ?? {};
  const fallbackBelonging = tasks[0] ? getTaskBelonging(tasks[0]) : null;

  return {
    title: instance === null ? fallbackBelonging?.title ?? fallbackTask.displayTitle ?? fallbackTask.name ?? "未命名清仓关键行动" : getProcessDisplayTitle(instance),
    productName: getClearanceField(customFields, ["productName", "product", "productTitle", "objectName", "itemName"]) || fallbackBelonging?.objectName || "",
    sku: getClearanceField(customFields, ["sku", "SKU", "spec", "规格"]),
    stockQuantity: getClearanceField(customFields, ["stockQuantity", "stock", "inventory", "库存数量", "当前库存"]),
    warehouse: getClearanceField(customFields, ["warehouse", "仓库"]),
    clearanceReason: getClearanceField(customFields, ["clearanceReason", "reason", "清仓原因"]),
    suggestedPrice: getClearanceField(customFields, ["suggestedPrice", "clearancePrice", "建议清仓价"]),
    originalPrice: getClearanceField(customFields, ["originalPrice", "price", "原售价"]),
    clearanceChannel: getClearanceField(customFields, ["clearanceChannel", "channel", "清仓渠道"]),
    dueDate: getClearanceField(customFields, ["dueDate", "expectedDate", "截止时间", "期望完成日期"]) || instance?.dueDate || fallbackTask.dueDate || "",
    notice: getClearanceField(customFields, ["notice", "remark", "备注", "说明"]),
  };
}

function getTaskProcessTemplateName(task) {
  const instance = getTaskProcessInstance(task);
  if (instance !== null) return getProcessTemplate(instance)?.name ?? "未设置";
  const taskTemplate = getTaskTemplateForTask(task);
  if (taskTemplate?.defaultProcessTemplateId) return getProcessTemplateName(taskTemplate.defaultProcessTemplateId);
  return "无";
}

function getStandardWorkAttachments(customFields = {}) {
  const attachments = customFields?.[standardWorkAttachmentsKey];
  return Array.isArray(attachments) ? attachments : [];
}

function getFileExt(filename = "") {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function normalizeDisplayFileName(name = "") {
  if (typeof name !== "string" || name === "") return name;
  const hasCjk = /[\u3400-\u9fff]/.test(name);
  if (hasCjk) return name;
  const looksLikeMojibake = /[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßæäåçèéêëìíîïðñòóôõöøùúûüýþÿ�]/.test(name);
  if (!looksLikeMojibake) return name;

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(name, (char) => char.charCodeAt(0) & 0xff));
  return /[\u3400-\u9fff]/.test(decoded) ? decoded : name;
}

function normalizeAttachmentFile(file) {
  if (typeof file === "string") {
    const name = normalizeDisplayFileName(file.split("/").pop() || file);
    return {
      href: resolveAssetUrl(file),
      name,
      ext: getFileExt(file),
      mimeType: "",
    };
  }

  const filePath = file.filePath ?? file.url ?? "";
  const name = normalizeDisplayFileName(file.originalName ?? file.filename ?? filePath ?? "未命名附件");
  return {
    href: resolveAssetUrl(filePath),
    name,
    ext: file.ext ?? getFileExt(name || filePath),
    mimeType: file.mimeType ?? "",
  };
}

function isPreviewableImageAttachment(file) {
  const attachment = normalizeAttachmentFile(file);
  return attachment.mimeType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"].includes(attachment.ext);
}

function renderAttachmentPreviewList(files, emptyText = "暂无附件") {
  if (!Array.isArray(files) || files.length === 0) return `<p class="form-note">${emptyText}</p>`;

  return `
    <div class="attachment-preview-grid">
      ${files
        .map((file) => {
          const attachment = normalizeAttachmentFile(file);
          const isImage = isPreviewableImageAttachment(file);
          const extText = attachment.ext === "" ? "附件" : attachment.ext.replace(".", "").toUpperCase();
          return `
            <a class="attachment-preview-card ${isImage ? "is-image" : ""}" href="${escapeHtml(attachment.href)}" target="_blank" rel="noreferrer">
              ${
                isImage
                  ? `<img src="${escapeHtml(attachment.href)}" alt="${escapeHtml(attachment.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'attachment-file-icon', textContent: '${escapeHtml(extText)}' }))" />`
                  : `<span class="attachment-file-icon">${escapeHtml(extText)}</span>`
              }
              <span class="attachment-preview-name">${escapeHtml(attachment.name)}</span>
            </a>
          `;
        })
        .join("")}
    </div>
  `;
}

function validateStandardWorkAttachmentFiles(files) {
  for (const file of files) {
    const ext = getFileExt(file.name);
    if (!spreadsheetAttachmentExts.has(ext)) return "表格附件只支持 .xlsx、.xls、.csv。";
    if (file.size > maxStandardWorkAttachmentSize) return "单个表格附件不能超过 20MB。";
  }
  return "";
}

function renderStandardWorkAttachmentList(attachments) {
  return renderAttachmentPreviewList(attachments);
}

function renderStandardWorkAttachmentsField() {
  return `
    <div class="standard-work-attachments-field">
      <label>
        <span>表格附件</span>
        <input name="standardWorkAttachments" type="file" accept=".xlsx,.xls,.csv" multiple data-standard-work-attachments />
      </label>
      <p class="form-note">支持 .xlsx、.xls、.csv，单个文件不超过 20MB。未上传也可以发起关键行动。</p>
      <div class="selected-attachment-list" data-selected-standard-work-attachments>
        <p class="form-note">暂无已选择附件</p>
      </div>
    </div>
  `;
}

function renderStandardWorkAttachmentsBlock(customFields = {}) {
  const attachments = getStandardWorkAttachments(customFields);
  return `
    <div class="detail-block">
      <h3>表格附件</h3>
      ${renderStandardWorkAttachmentList(attachments)}
    </div>
  `;
}

function getTaskProcessStepName(task) {
  if (task.source !== TaskSource.Process) return "无";
  return getProcessNode(task)?.name ?? task.name;
}

function renderCustomFieldInput(field, customFields = {}) {
  const value = customFields[field.key] ?? (field.type === "multi_select" ? [] : "");
  const requiredMark = "";

  if (field.type === "textarea") {
    return `
      <label>
        <span>${field.label}${requiredMark}</span>
        <textarea name="custom__${field.key}" rows="3" placeholder="${escapeHtml(field.placeholder ?? "")}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  if (field.type === "select" || field.type === "person" || field.type === "department") {
    const options = getDynamicFieldOptions(field);
    return `
      <label>
        <span>${field.label}${requiredMark}</span>
        <select name="custom__${field.key}">
          <option value="">${field.key === "storeId" && options.length === 0 ? "暂无可选店铺，请确认账号有店铺选择权限，或先到设置 → 店铺管理中新增店铺。" : "请选择"}</option>
          ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  if (field.type === "multi_select") {
    const options = getDynamicFieldOptions(field);
    return `
      <label>
        <span>${field.label}${requiredMark}</span>
        <select name="custom__${field.key}" multiple size="${Math.min(options.length, 5)}">
          ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${Array.isArray(value) && value.includes(option.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  if (field.type === "image") {
    const imageUrl = typeof value === "string" ? value : "";
    return `
      <label class="image-url-field">
        <span>${field.label}${requiredMark}</span>
        <input name="custom__${field.key}" type="hidden" value="${escapeHtml(imageUrl)}" />
        <input name="upload__${field.key}" type="file" accept="image/jpeg,image/png,image/webp" data-image-upload-key="${escapeHtml(field.key)}" />
        <span class="form-note">上传1:1产品图，支持 JPG、PNG、WebP，单张不超过 5MB。</span>
        <span class="image-preview-box">
          ${imageUrl === "" ? "暂无图片" : `<img src="${escapeHtml(resolveAssetUrl(imageUrl))}" alt="${escapeHtml(field.label)}预览" onerror="this.replaceWith('图片无法预览')" />`}
        </span>
      </label>
    `;
  }

  if (isBusinessDueDateField(field)) {
    return `
      <label>
        <span>${field.label}${requiredMark}</span>
        <input name="custom__${field.key}Date" type="date" value="${escapeHtml(getBusinessDatePart(value))}" />
        <select name="custom__${field.key}Hour">${renderBusinessHourOptions(getBusinessHourPart(value), "请选择小时")}</select>
      </label>
    `;
  }

  const inputType = field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text";
  return `
    <label>
      <span>${field.label}${requiredMark}</span>
      <input name="custom__${field.key}" type="${inputType}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder ?? "")}" />
    </label>
  `;
}

function renderCustomFieldsForm(template, customFields = {}) {
  const fields = getSortedFormFields(template);
  if (fields.length === 0) return "";

  return `
    <div class="template-custom-fields">
      <h3>本次关键行动信息</h3>
      <div class="form-grid">
        ${fields.map((field) => renderCustomFieldInput(field, customFields)).join("")}
      </div>
    </div>
  `;
}

function collectCustomFields(form, template) {
  const formData = new FormData(form);
  return getSortedFormFields(template).reduce((result, field) => {
    if (isBusinessDueDateField(field)) {
      const dateTime = collectBusinessDateTime(form, `custom__${field.key}`, field.label);
      result[field.key] = dateTime.error === "" ? dateTime.value ?? "" : `__INVALID_BUSINESS_TIME__:${dateTime.error}`;
    } else if (field.type === "multi_select") {
      result[field.key] = formData.getAll(`custom__${field.key}`).map((item) => item.toString());
    } else {
      result[field.key] = getFormValue(form, `custom__${field.key}`);
    }
    if (field.key === "storeId") {
      const store = stores.find((item) => item.id === result.storeId);
      result.storeName = store?.name ?? "";
    }
    return result;
  }, {});
}

function validateCustomFields(customFields, template) {
  for (const field of getSortedFormFields(template)) {
    const value = customFields[field.key];
    const isEmpty = Array.isArray(value) ? value.length === 0 : value === "";
    if (isEmpty) continue;
    if (typeof value === "string" && value.startsWith("__INVALID_BUSINESS_TIME__:")) return value.replace("__INVALID_BUSINESS_TIME__:", "");
    if (field.type === "number" && Number.isNaN(Number(value))) return `${field.label}必须是数字。`;
    if (isBusinessDueDateField(field) && !String(value).includes("T")) return `${field.label}必须选择日期和整点小时。`;
    if (field.type === "date" && !isBusinessDueDateField(field) && Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) return `${field.label}必须是合法日期。`;
    if (field.type === "url" && !isValidUrl(value)) return `${field.label}必须是有效链接。`;
    if (field.type === "image" && !isValidImagePath(value)) return `${field.label}必须是上传后的图片路径。`;
    if (field.type === "select" && !getDynamicFieldOptions(field).some((option) => option.value === value)) return `${field.label}必须选择有效选项。`;
    if (field.type === "multi_select" && value.some((item) => !getDynamicFieldOptions(field).some((option) => option.value === item))) return `${field.label}包含无效选项。`;
  }
  return "";
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function renderOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items
      .map(
        (item) => `
          <option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>
            ${escapeHtml(item.name)}
          </option>
        `,
      )
      .join("")}
  `;
}

function renderValueOptions(values, selectedValue, names, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${Object.values(values)
      .map(
        (value) => `
          <option value="${value}" ${value === selectedValue ? "selected" : ""}>
            ${names[value]}
          </option>
        `,
      )
      .join("")}
  `;
}

function matchesTaskStatusFilter(task, selectedStatus) {
  if (selectedStatus === "") return true;
  return getTaskBusinessStatus(task).status === getTaskBusinessStatus({ status: selectedStatus }).status;
}

function matchesFilters(task) {
  const overdue = isTaskOverdue(task, today) || hasTaskOverdueRecord(task);
  const shouldShowDone = filters.showDone || filters.status === TaskStatus.Done;
  const shouldShowCanceled = filters.showCanceled || filters.status === TaskStatus.Canceled;
  const belonging = getTaskBelonging(task);
  const searchableText = [
    task.name,
    belonging.objectName,
    belonging.standardWorkName,
    belonging.title,
    findName(goals, task.goalId, ""),
    findName(departments, task.departmentId, ""),
    findName(people, task.ownerId, ""),
  ].join(" ");

  if (!matchesTaskStatusFilter(task, filters.status)) return false;
  if (!shouldShowDone && isDoneStatus(task.status)) return false;
  if (!shouldShowCanceled && isCanceledStatus(task.status)) return false;
  if (filters.keyword !== "" && !searchableText.includes(filters.keyword)) return false;
  if (filters.source !== "" && task.source !== filters.source) return false;
  if (filters.departmentId !== "" && task.departmentId !== filters.departmentId) return false;
  if (filters.ownerId !== "" && task.ownerId !== filters.ownerId) return false;
  if (filters.executorId !== "" && getTaskExecutorId(task) !== filters.executorId) return false;
  if (filters.goalId !== "" && task.goalId !== filters.goalId) return false;
  if (filters.categoryId !== "" && task.categoryId !== filters.categoryId) return false;
  if (filters.overdue === "yes" && !overdue) return false;
  if (filters.overdue === "no" && overdue) return false;

  return true;
}

function isUnfinishedTask(task) {
  return !isDoneStatus(task.status) && !isCanceledStatus(task.status);
}

function isTaskDueToday(task) {
  return getBusinessDatePart(task.dueDate) === today;
}

function isTaskInProgressToday(task) {
  return task.status === TaskStatus.Doing;
}

function isTaskOverdueForView(task) {
  return isTaskOverdue(task, today) || hasTaskOverdueRecord(task);
}

function matchesTaskListView(task) {
  if (taskListView === "all") return true;

  if (taskListView === "today") {
    return isUnfinishedTask(task) && (isTaskDueToday(task) || isTaskInProgressToday(task));
  }

  if (taskListView === "mine") {
    const currentUser = getCurrentUser();
    const currentPersonId = currentUser?.personId ?? currentUser?.id ?? "";
    return currentPersonId !== "" && isUnfinishedTask(task) && getTaskExecutorId(task) === currentPersonId;
  }

  if (taskListView === "overdue") {
    return isUnfinishedTask(task) && isTaskOverdueForView(task);
  }

  return true;
}

function isTaskVisibleInExecutionStage(task) {
  return isTaskExecutionStarted(task, state);
}

function getFilteredTasks() {
  return state.tasks
    .filter((task) => !isClearanceTask(task))
    .filter(isTaskVisibleInExecutionStage)
    .filter(matchesTaskListView)
    .filter(matchesFilters);
}

function renderOverdue(task) {
  return isTaskOverdue(task, today) || hasTaskOverdueRecord(task)
    ? `<span class="status-pill is-danger">已逾期</span>`
    : `<span class="status-pill">未逾期</span>`;
}

function parseTaskComparableTime(value, dateMode = "start") {
  const rawValue = String(value ?? "").trim();
  if (rawValue === "") return null;
  const fallbackTime = dateMode === "end" ? "T23:59:59+08:00" : "T00:00:00+08:00";
  const parsed = new Date(rawValue.length === 10 ? `${rawValue}${fallbackTime}` : rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function markTaskOverdueRecordIfNeeded(task, referenceTime = getNow()) {
  if (task.dueDate === null || task.status === TaskStatus.Canceled || hasTaskOverdueRecord(task)) return task;
  const dueTime = parseTaskComparableTime(task.dueDate, "end");
  const currentTime = parseTaskComparableTime(referenceTime);
  if (dueTime === null || currentTime === null || currentTime <= dueTime) return task;
  return {
    ...task,
    customFields: {
      ...(task.customFields ?? {}),
      assessmentOverdueRecordedAt: referenceTime,
      assessmentOverdueDueDate: task.dueDate,
    },
  };
}

function didRecordTaskOverdue(previousTask, nextTask) {
  return !hasTaskOverdueRecord(previousTask) && hasTaskOverdueRecord(nextTask);
}

async function triggerRectificationForTaskException(task, sourceType, problemSummary) {
  if (task === null || task === undefined) return null;
  if (hasOpenRectificationWorkForSource({ sourceTaskId: task.id, sourceProcessInstanceId: task.processInstanceId ?? null, sourceType })) return null;
  try {
    return await launchRectificationWorkForSource({
      sourceTaskId: task.id,
      sourceProcessInstanceId: task.processInstanceId ?? null,
      sourceType,
      problemSummary,
    });
  } catch (error) {
    console.error("自动发起改善工作失败", error);
    try {
      await recordRectificationTriggerFailure(task.id, sourceType, error);
    } catch (recordError) {
      console.error("改善触发失败记录保存失败", recordError);
    }
    return null;
  }
}

async function triggerOverdueRectificationIfNeeded(previousTask, nextTask) {
  if (!didRecordTaskOverdue(previousTask, nextTask)) return null;
  return triggerRectificationForTaskException(
    nextTask,
    "overdue_task",
    `任务“${nextTask.name}”首次确认超时，需要发起改善。`,
  );
}

function getTaskStatusClass(status) {
  if (status === TaskStatus.Doing) return "is-doing";
  if (status === TaskStatus.PendingAcceptance) return "is-review";
  if (isDoneStatus(status)) return "is-done";
  if (isCanceledStatus(status)) return "is-canceled";
  return "is-todo";
}

function renderTaskStatusSelect(task) {
  const disabled = !canCurrentUser("tasks.changeStatus");
  const value = task.status === TaskStatus.Waiting ? TaskStatus.Todo : task.status;
  const title =
    disabled
      ? "没有修改任务状态的权限。"
      :
    task.source === TaskSource.Process && task.status === TaskStatus.Waiting
      ? "前置步骤未完成，当前步骤暂不能处理。"
      : "";

  return `
    <select
      class="task-status-select ${getTaskStatusClass(task.status)}"
      data-task-status-select
      data-task-id="${task.id}"
      title="${escapeHtml(title)}"
      ${disabled ? "disabled" : ""}
    >
      ${taskStatusSelectOptions
        .map(
          (option) => `
            <option value="${option.value}" ${option.value === value ? "selected" : ""}>
              ${option.value === TaskStatus.Done && option.value === value && hasTaskOverdueRecord(task) ? "已完成（超时）" : option.label}
            </option>
          `,
        )
        .join("")}
    </select>
  `;
}

function getTaskProjectDueDateText(task) {
  const instanceId = task.processInstanceId ?? "";
  if (instanceId === "") return "-";
  const instance = state.processInstances.find((item) => item.id === instanceId) ?? null;
  if (instance?.dueDate === undefined || instance.dueDate === null || instance.dueDate === "") return "-";
  return formatBusinessDateTime(instance.dueDate, "-");
}

function getTaskStandardWorkId(task) {
  const instance = getTaskProcessInstance(task);
  return instance?.taskTemplateId ?? instance?.standardWorkId ?? task.taskTemplateId ?? task.standardWorkId ?? "";
}

function getTaskStandardDurationMinutes(task) {
  const node = getProcessNode(task);
  const durationMinutes = Number(node?.durationMinutes);
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) return Math.round(durationMinutes);
  const durationDays = Number(node?.durationDays);
  if (Number.isFinite(durationDays) && durationDays > 0) return Math.round(durationDays * 1440);
  return 0;
}

function parseExecutionGroupTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).includes("T") ? String(value) : `${String(value).slice(0, 10)}T00:00:00+08:00`;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getExecutionGroupById(groupId) {
  if (groupId === null || groupId === undefined || groupId === "") return null;
  return state.executionGroups.find((group) => group.id === groupId) ?? null;
}

function getTaskExecutionGroup(task) {
  return getExecutionGroupById(task.executionGroupId);
}

function getExecutionGroupTasks(group) {
  const taskIds = Array.isArray(group?.taskIds) ? group.taskIds : [];
  return taskIds.map(getTask).filter(Boolean);
}

function getExecutionGroupActualMinutes(group, endedAt = getNow()) {
  const startTime = parseExecutionGroupTime(group?.startedAt);
  const endTime = parseExecutionGroupTime(endedAt);
  if (startTime === null || endTime === null || endTime < startTime) return 0;
  return Math.max(0, Math.round((endTime - startTime) / 60000));
}

function validateExecutionGroupTasks(tasks) {
  if (tasks.length < 2) return "请至少勾选 2 个任务创建执行组。";
  const invalidStatusTasks = tasks.filter((task) => isDoneStatus(task.status) || isCanceledStatus(task.status));
  if (invalidStatusTasks.length > 0) return `已完成或已取消的任务不能加入执行组：${invalidStatusTasks.map((task) => task.name).join("、")}`;

  const standardWorkIds = new Set(tasks.map(getTaskStandardWorkId).filter(Boolean));
  if (standardWorkIds.size !== 1) return "只有同一关键行动下的任务才能创建执行组。";

  const ownerIds = new Set(tasks.map((task) => task.ownerId).filter(Boolean));
  if (ownerIds.size !== 1) return "只有同一负责人的任务才能创建执行组。";

  const executorIds = new Set(tasks.map(getTaskExecutorId).filter(Boolean));
  if (executorIds.size !== 1) return "只有同一执行人的任务才能创建执行组。";

  const groupedTasks = tasks.filter((task) => String(task.executionGroupId ?? "").trim() !== "");
  if (groupedTasks.length > 0) return `任务已加入执行组，不能重复加入：${groupedTasks.map((task) => task.name).join("、")}`;

  const missingDurationTasks = tasks.filter((task) => getTaskStandardDurationMinutes(task) <= 0);
  if (missingDurationTasks.length > 0) return `以下任务缺少有效规定时长：${missingDurationTasks.map((task) => task.name).join("、")}`;

  return "";
}

function sortExecutionGroupTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftInstance = left.processInstanceId ?? "";
    const rightInstance = right.processInstanceId ?? "";
    if (leftInstance !== rightInstance) return leftInstance.localeCompare(rightInstance);
    const stepDifference = getProcessNodeStepOrder(getProcessNode(left) ?? left) - getProcessNodeStepOrder(getProcessNode(right) ?? right);
    if (stepDifference !== 0) return stepDifference;
    return String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
  });
}

function buildExecutionGroupName(tasks) {
  const firstTask = tasks[0];
  const standardWorkName = getTaskBelonging(firstTask).standardWorkName;
  const executorName = findName(people, getTaskExecutorId(firstTask), "未设置执行人");
  return `执行组：${standardWorkName} - ${executorName} - ${getTodayDateInShanghai()}`;
}

function renderExecutionGroupBadge(task) {
  const group = getTaskExecutionGroup(task);
  if (group === null) return "";
  return `
    <button class="text-button task-execution-group-badge" type="button" data-action="view-execution-group" data-execution-group-id="${escapeHtml(group.id)}">
      ${escapeHtml(group.name)}
    </button>
  `;
}

function renderTaskRow(task, index) {
  return `
    <tr class="${task.id === selectedTaskId ? "is-selected" : ""}" data-row-task-id="${task.id}">
      <td class="task-select-column">
        <label class="task-row-select">
          <input type="checkbox" data-task-row-select data-task-id="${task.id}" ${selectedTaskIds.has(task.id) ? "checked" : ""} />
          <span>${index + 1}</span>
        </label>
      </td>
      <td class="task-cover-column">${renderCoverImage(task)}</td>
      <td class="task-belonging-column">${renderTaskBelonging(task)}</td>
      <td class="task-name-column">
        <span class="task-line-clamp task-name-text">${escapeHtml(task.name)}</span>
        ${renderExecutionGroupBadge(task)}
      </td>
      <td class="task-executor-column">${findName(people, getTaskExecutorId(task), "未设置")}</td>
      <td class="task-date-column">${formatBusinessMinuteDateTime(task.dueDate)}</td>
      <td class="task-date-column">${getTaskProjectDueDateText(task)}</td>
      <td class="task-status-column">${renderTaskStatusSelect(task)}</td>
      <td class="task-overdue-column">${renderOverdue(task)}</td>
      <td class="task-department-column">${findName(departments, task.departmentId, "未设置")}</td>
      <td class="task-owner-column">${findName(people, task.ownerId, "未设置")}</td>
      <td class="task-actions-column">
        <span class="row-actions">
          ${renderActionButton("查看任务详情", "view-task", task.id)}
          ${canReturnTask(task) ? renderActionButton("退回重做", "return-task", task.id) : ""}
          ${canEditTask(task) ? renderActionButton("编辑", "edit-task", task.id) : ""}
          ${canCancelTask(task) ? renderActionButton("取消", "cancel-task", task.id, "danger-button") : ""}
          ${canRestoreTask(task) ? renderActionButton("恢复为待处理", "restore-task", task.id) : ""}
        </span>
      </td>
    </tr>
  `;
}

function getProcessTasks(processInstanceId) {
  return state.tasks.filter((task) => task.source === TaskSource.Process && task.processInstanceId === processInstanceId);
}

function getProcessNode(task) {
  return state.processTemplateNodes.find((node) => node.id === task.processNodeId) ?? null;
}

function sortProcessTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftNode = getProcessNode(left);
    const rightNode = getProcessNode(right);
    const stepDifference = getProcessNodeStepOrder(leftNode ?? left) - getProcessNodeStepOrder(rightNode ?? right);
    if (stepDifference !== 0) return stepDifference;
    return String(left.createdAt ?? left.dueDate ?? "").localeCompare(String(right.createdAt ?? right.dueDate ?? ""));
  });
}

function getOrderedActiveProcessTasks(task) {
  if (task.source !== TaskSource.Process || task.processInstanceId === null) return null;
  return sortProcessTasks(getProcessTasks(task.processInstanceId)).filter((item) => item.status !== TaskStatus.Canceled);
}

function canActivateWaitingProcessTask(task) {
  if (task.status !== TaskStatus.Waiting) return false;
  const instance = getTaskProcessInstance(task);
  if (instance === null || instance.status !== ProcessInstanceStatus.Running) return false;
  const processTasks = getOrderedActiveProcessTasks(task);
  if (processTasks === null) return false;
  const currentIndex = processTasks.findIndex((item) => item.id === task.id);
  if (currentIndex < 0) return false;
  return processTasks.slice(0, currentIndex).every((item) => isDoneStatus(item.status));
}

function getReturnableProcessTasks(task) {
  const processTasks = getOrderedActiveProcessTasks(task);
  if (processTasks === null) return [];
  const currentIndex = processTasks.findIndex((item) => item.id === task.id);
  if (currentIndex <= 0) return [];
  return processTasks.slice(0, currentIndex);
}

function canReturnTask(task) {
  if (!canCurrentUser("tasks.changeStatus")) return false;
  if (task.source !== TaskSource.Process || task.processInstanceId === null) return false;
  if (isCanceledStatus(task.status)) return false;
  const instance = getTaskProcessInstance(task);
  if (instance === null || instance.status !== ProcessInstanceStatus.Running) return false;
  return getReturnableProcessTasks(task).length > 0;
}

function getReturnRecords(task) {
  const records = task.customFields?.[returnRecordsKey];
  return Array.isArray(records) ? records : [];
}

function appendReturnRecord(task, record, extraFields = {}) {
  return {
    ...task,
    customFields: {
      ...(task.customFields ?? {}),
      ...extraFields,
      [returnRecordsKey]: [...getReturnRecords(task), record],
    },
  };
}

function getCurrentTaskOfProcess(processTasks) {
  const processInstanceId = processTasks.find((task) => task.processInstanceId)?.processInstanceId ?? "";
  return selectCurrentProcessTask(processInstanceId, state);
}

function getTaskTableRows() {
  return sortTaskTableRows(getFilteredTasks().map((task, index) => ({ task, order: index })));
}

function getRowDueDate(row) {
  return row.task?.dueDate ?? "";
}

function sortTaskTableRows(rows) {
  const orderedRows = [...rows];
  if (taskDueDateSort !== "asc") {
    return orderedRows.sort((left, right) => left.order - right.order);
  }

  return orderedRows.sort((left, right) => {
    const leftDueDate = getRowDueDate(left);
    const rightDueDate = getRowDueDate(right);
    const leftMissing = leftDueDate === null || leftDueDate === undefined || leftDueDate === "";
    const rightMissing = rightDueDate === null || rightDueDate === undefined || rightDueDate === "";
    if (leftMissing && rightMissing) return left.order - right.order;
    if (leftMissing) return 1;
    if (rightMissing) return -1;
    const dueDateCompare = String(leftDueDate).localeCompare(String(rightDueDate));
    if (dueDateCompare !== 0) return dueDateCompare;
    return left.order - right.order;
  });
}

function getClearanceStatus(instance, tasks) {
  if (instance !== null && instance !== undefined) return instance.status;
  if (tasks.length > 0 && tasks.every((task) => isDoneStatus(task.status))) return TaskStatus.Done;
  if (tasks.length > 0 && tasks.every((task) => isCanceledStatus(task.status))) return TaskStatus.Canceled;
  return ProcessInstanceStatus.Running;
}

function matchesClearanceStatus(status, selectedStatus, overdue) {
  if (selectedStatus === "") return true;
  if (selectedStatus === "running") return !isDoneStatus(status) && !isCanceledStatus(status) && status !== ProcessInstanceStatus.Stopped;
  if (selectedStatus === TaskStatus.Done) return isDoneStatus(status);
  if (selectedStatus === TaskStatus.Canceled) return isCanceledStatus(status);
  if (selectedStatus === "overdue") return overdue;
  return status === selectedStatus;
}

function matchesClearanceFilters(group) {
  const info = getClearanceDisplayInfo(group.instance, group.tasks);
  const status = getClearanceStatus(group.instance, group.tasks);
  const overdue = group.tasks.some((task) => isTaskOverdue(task, today) || hasTaskOverdueRecord(task));
  const shouldShowDone = clearanceFilters.showDone || clearanceFilters.status === TaskStatus.Done;
  const shouldShowCanceled = clearanceFilters.showCanceled || clearanceFilters.status === TaskStatus.Canceled;
  const currentOwnerIds = group.currentTask === null ? group.tasks.map((task) => task.ownerId) : [group.currentTask.ownerId];
  const searchableText = [
    info.title,
    info.productName,
    info.sku,
    info.clearanceReason,
    info.clearanceChannel,
    info.warehouse,
    ...group.tasks.map((task) => task.name),
  ].join(" ");

  if (!matchesClearanceStatus(status, clearanceFilters.status, overdue)) return false;
  if (!shouldShowDone && isDoneStatus(status)) return false;
  if (!shouldShowCanceled && (isCanceledStatus(status) || status === ProcessInstanceStatus.Stopped)) return false;
  if (clearanceFilters.keyword !== "" && !searchableText.includes(clearanceFilters.keyword)) return false;
  if (clearanceFilters.ownerId !== "" && !currentOwnerIds.includes(clearanceFilters.ownerId)) return false;
  if (clearanceFilters.channel !== "" && info.clearanceChannel !== clearanceFilters.channel) return false;
  if (clearanceFilters.warehouse !== "" && info.warehouse !== clearanceFilters.warehouse) return false;
  return true;
}

function getClearanceGroups() {
  const groups = new Map();
  state.tasks.filter(isClearanceTask).forEach((task, index) => {
    const groupId = task.processInstanceId || `task-${task.id}`;
    const group = groups.get(groupId) ?? {
      id: groupId,
      processInstanceId: task.processInstanceId || null,
      instance: task.processInstanceId ? state.processInstances.find((item) => item.id === task.processInstanceId) ?? null : null,
      tasks: [],
      order: index,
    };
    group.tasks.push(task);
    group.order = Math.min(group.order, index);
    groups.set(groupId, group);
  });

  state.processInstances.filter(isClearanceProcessInstance).forEach((instance, index) => {
    if (groups.has(instance.id)) return;
    groups.set(instance.id, {
      id: instance.id,
      processInstanceId: instance.id,
      instance,
      tasks: [],
      order: state.tasks.length + index,
    });
  });

  return [...groups.values()]
    .map((group) => {
      const tasks = sortProcessTasks(group.tasks);
      const currentTask = getCurrentTaskOfProcess(tasks) ?? tasks[tasks.length - 1] ?? tasks[0] ?? null;
      return {
        ...group,
        tasks,
        currentTask,
        expanded: expandedClearanceGroups.has(group.id),
      };
    })
    .filter(matchesClearanceFilters)
    .sort((left, right) => left.order - right.order);
}

function getClearanceStats(groups) {
  return groups.reduce(
    (result, group) => {
      const status = getClearanceStatus(group.instance, group.tasks);
      if (isDoneStatus(status)) result.done += 1;
      else if (isCanceledStatus(status) || status === ProcessInstanceStatus.Stopped) result.canceled += 1;
      else result.running += 1;
      if (group.tasks.some((task) => isTaskOverdue(task, today) || hasTaskOverdueRecord(task))) result.overdue += 1;
      result.total += 1;
      return result;
    },
    { running: 0, overdue: 0, done: 0, canceled: 0, total: 0 },
  );
}

function renderClearanceFilters() {
  return `
    <form class="clearance-filters task-filters" aria-label="库存清仓筛选">
      <label>
        <span>关键词</span>
        <input name="keyword" value="${escapeHtml(clearanceFilters.keyword)}" placeholder="搜索清仓产品、SKU、原因、渠道" />
      </label>
      <label>
        <span>清仓状态</span>
        <select name="status">
          <option value="">全部状态</option>
          <option value="running" ${clearanceFilters.status === "running" ? "selected" : ""}>进行中</option>
          <option value="${TaskStatus.Done}" ${clearanceFilters.status === TaskStatus.Done ? "selected" : ""}>已完成</option>
          <option value="${TaskStatus.Canceled}" ${clearanceFilters.status === TaskStatus.Canceled ? "selected" : ""}>已取消</option>
          <option value="overdue" ${clearanceFilters.status === "overdue" ? "selected" : ""}>逾期</option>
        </select>
      </label>
      <label>
        <span>负责人</span>
        <select name="ownerId">${renderOptions(people, clearanceFilters.ownerId, "全部负责人")}</select>
      </label>
      <label>
        <span>清仓渠道</span>
        <select name="channel">
          <option value="">全部渠道</option>
          ${clearanceChannelOptions.map((option) => `<option value="${option}" ${clearanceFilters.channel === option ? "selected" : ""}>${option}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>仓库</span>
        <select name="warehouse">
          <option value="">全部仓库</option>
          ${clearanceWarehouseOptions.map((option) => `<option value="${option}" ${clearanceFilters.warehouse === option ? "selected" : ""}>${option}</option>`).join("")}
        </select>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showDone" type="checkbox" ${clearanceFilters.showDone ? "checked" : ""} />
        <span>显示已完成</span>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showCanceled" type="checkbox" ${clearanceFilters.showCanceled ? "checked" : ""} />
        <span>显示已取消</span>
      </label>
      <p class="form-note">已完成、已取消的库存清仓默认隐藏，可勾选查看历史记录。</p>
    </form>
  `;
}

function renderClearanceStats(groups) {
  const stats = getClearanceStats(groups);
  return `
    <div class="clearance-stats">
      <div><span>进行中</span><strong>${stats.running}</strong></div>
      <div><span>逾期</span><strong>${stats.overdue}</strong></div>
      <div><span>已完成</span><strong>${stats.done}</strong></div>
      <div><span>已取消</span><strong>${stats.canceled}</strong></div>
      <div><span>筛选结果</span><strong>${stats.total}</strong></div>
    </div>
  `;
}

function createClearanceXmlWorkbook(rows) {
  const xmlRows = rows
    .map(
      (row) => `
        <Row>
          ${clearanceImportHeaders
            .map((header) => `<Cell><Data ss:Type="String">${escapeHtml(row[header] ?? "")}</Data></Cell>`)
            .join("")}
        </Row>
      `,
    )
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="库存清仓导入">
    <Table>
      <Row>${clearanceImportHeaders.map((header) => `<Cell><Data ss:Type="String">${header}</Data></Cell>`).join("")}</Row>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getColumnName(index) {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function createSheetCell(value, rowIndex, columnIndex) {
  const cellRef = `${getColumnName(columnIndex)}${rowIndex}`;
  return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function createClearanceXlsxSheet(rows) {
  const allRows = [
    clearanceImportHeaders,
    ...rows.map((row) => clearanceImportHeaders.map((header) => row[header] ?? "")),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${allRows
      .map((row, rowIndex) => {
        const excelRowIndex = rowIndex + 1;
        return `<row r="${excelRowIndex}">${row.map((value, columnIndex) => createSheetCell(value, excelRowIndex, columnIndex)).join("")}</row>`;
      })
      .join("")}
  </sheetData>
</worksheet>`;
}

function createCrc32Table() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

const crc32Table = createCrc32Table();

function getCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendBytes(target, bytes) {
  for (const byte of bytes) target.push(byte);
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const output = [];
  const centralDirectory = [];
  const entries = files.map((file) => ({
    nameBytes: encoder.encode(file.name),
    dataBytes: encoder.encode(file.content),
  }));

  for (const entry of entries) {
    const localHeaderOffset = output.length;
    const crc = getCrc32(entry.dataBytes);
    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, crc);
    writeUint32(output, entry.dataBytes.length);
    writeUint32(output, entry.dataBytes.length);
    writeUint16(output, entry.nameBytes.length);
    writeUint16(output, 0);
    appendBytes(output, entry.nameBytes);
    appendBytes(output, entry.dataBytes);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, crc);
    writeUint32(centralDirectory, entry.dataBytes.length);
    writeUint32(centralDirectory, entry.dataBytes.length);
    writeUint16(centralDirectory, entry.nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, localHeaderOffset);
    appendBytes(centralDirectory, entry.nameBytes);
  }

  const centralDirectoryOffset = output.length;
  appendBytes(output, centralDirectory);
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, entries.length);
  writeUint16(output, entries.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralDirectoryOffset);
  writeUint16(output, 0);

  return new Blob([new Uint8Array(output)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function createClearanceXlsxWorkbook(rows) {
  return createZipBlob([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="库存清仓导入" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", content: createClearanceXlsxSheet(rows) },
  ]);
}

function createSimpleXlsxSheet(headers, rows, leadingRows = []) {
  const allRows = [
    ...leadingRows,
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${allRows
      .map((row, rowIndex) => {
        const excelRowIndex = rowIndex + 1;
        return `<row r="${excelRowIndex}">${row.map((value, columnIndex) => createSheetCell(value, excelRowIndex, columnIndex)).join("")}</row>`;
      })
      .join("")}
  </sheetData>
</worksheet>`;
}

function createSimpleXlsxWorkbook(sheetName, headers, rows, leadingRows = []) {
  return createZipBlob([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", content: createSimpleXlsxSheet(headers, rows, leadingRows) },
  ]);
}

function downloadFile(content, fileName, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadClearanceImportTemplate() {
  const rows = [
    {
      清仓产品: "赛里木湖蓝花瓶",
      "SKU / 规格": "蓝色 / 大号",
      当前库存: "120",
      仓库: "义乌仓",
      清仓原因: "库存周转慢，需要释放仓储空间",
      建议清仓价: "39",
      原售价: "69",
      清仓渠道: "店铺清仓位",
      截止时间: "2026-07-15 16:30",
      注意事项: "注意不要影响主推新品价格心智",
      产品图: "",
      关联目标: getActiveGoals()[0]?.name ?? "",
      发起人: people[0]?.name ?? "",
    },
  ];
  downloadFile(createClearanceXlsxWorkbook(rows), "库存清仓导入模板.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function parseClearanceDelimitedRows(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function parseClearanceXmlWorkbook(text) {
  const document = new DOMParser().parseFromString(text, "text/xml");
  if (document.querySelector("parsererror") !== null) return [];
  return [...document.querySelectorAll("Row")].map((row) =>
    [...row.querySelectorAll("Cell")].map((cell) => cell.textContent?.trim() ?? ""),
  );
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function inflateZipEntry(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持解析压缩 xlsx，请使用系统下载的新模板重试。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsxEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder();
  const endOffset = findEndOfCentralDirectory(view);
  if (endOffset < 0) throw new Error("不是有效的 xlsx 文件。");

  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("xlsx 文件结构异常。");
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(new Uint8Array(arrayBuffer, centralOffset + 46, fileNameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedBytes = new Uint8Array(arrayBuffer, dataStart, compressedSize);
    let bytes;
    if (method === 0) {
      bytes = compressedBytes;
    } else if (method === 8) {
      bytes = await inflateZipEntry(compressedBytes);
    } else {
      throw new Error("xlsx 文件包含暂不支持的压缩格式。");
    }
    entries.set(name, { bytes, text: decoder.decode(bytes) });
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function getXmlTextContent(element) {
  return [...element.getElementsByTagName("t")].map((node) => node.textContent ?? "").join("");
}

function getCellColumnIndex(cellRef) {
  const letters = String(cellRef ?? "").match(/^[A-Z]+/i)?.[0] ?? "";
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function getXlsxSharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml")?.text;
  if (xml === undefined) return [];
  const document = new DOMParser().parseFromString(xml, "text/xml");
  return [...document.getElementsByTagName("si")].map(getXmlTextContent);
}

async function parseClearanceXlsxWorkbook(file) {
  const entries = await unzipXlsxEntries(await file.arrayBuffer());
  const sheetXml = entries.get("xl/worksheets/sheet1.xml")?.text ?? [...entries.entries()].find(([name]) => name.startsWith("xl/worksheets/"))?.[1]?.text;
  if (!sheetXml) return [];
  const sharedStrings = getXlsxSharedStrings(entries);
  const document = new DOMParser().parseFromString(sheetXml, "text/xml");
  if (document.querySelector("parsererror") !== null) return [];

  return [...document.getElementsByTagName("row")].map((row) => {
    const values = [];
    for (const cell of row.getElementsByTagName("c")) {
      const columnIndex = getCellColumnIndex(cell.getAttribute("r"));
      if (columnIndex < 0) continue;
      const type = cell.getAttribute("t");
      const rawValue = cell.getElementsByTagName("v")[0]?.textContent?.trim() ?? "";
      let value = rawValue;
      if (type === "s") value = sharedStrings[Number.parseInt(rawValue, 10)] ?? "";
      if (type === "inlineStr") value = getXmlTextContent(cell);
      if (type === "str") value = rawValue;
      values[columnIndex] = value.trim();
    }
    return values.map((value) => value ?? "");
  });
}

function normalizeZipPath(basePath, targetPath) {
  if (!targetPath) return "";
  if (targetPath.startsWith("/")) return targetPath.replace(/^\/+/, "");
  const parts = basePath.split("/");
  parts.pop();
  for (const part of targetPath.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function parseXlsxRelationships(xml) {
  if (!xml) return new Map();
  const document = new DOMParser().parseFromString(xml, "text/xml");
  return new Map(
    [...document.getElementsByTagName("Relationship")].map((relationship) => [
      relationship.getAttribute("Id"),
      relationship.getAttribute("Target") ?? "",
    ]),
  );
}

function getFirstLocalText(element, localName) {
  const node = element.getElementsByTagNameNS("*", localName)[0] ?? element.getElementsByTagName(localName)[0];
  return node?.textContent?.trim() ?? "";
}

function getImageMimeType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function uploadClearanceEmbeddedImages(file) {
  const entries = await unzipXlsxEntries(await file.arrayBuffer());
  const sheetPath = entries.has("xl/worksheets/sheet1.xml")
    ? "xl/worksheets/sheet1.xml"
    : [...entries.keys()].find((name) => name.startsWith("xl/worksheets/"));
  const sheetXml = sheetPath ? entries.get(sheetPath)?.text : "";
  if (!sheetPath || !sheetXml) return new Map();

  const sheetDocument = new DOMParser().parseFromString(sheetXml, "text/xml");
  const drawingId = sheetDocument.getElementsByTagNameNS("*", "drawing")[0]?.getAttribute("r:id") ?? "";
  if (drawingId === "") return new Map();

  const sheetRelsPath = normalizeZipPath(sheetPath, `_rels/${sheetPath.split("/").pop()}.rels`);
  const sheetRelationships = parseXlsxRelationships(entries.get(sheetRelsPath)?.text);
  const drawingPath = normalizeZipPath(sheetPath, sheetRelationships.get(drawingId));
  const drawingXml = entries.get(drawingPath)?.text;
  if (!drawingXml) return new Map();

  const drawingRelsPath = normalizeZipPath(drawingPath, `_rels/${drawingPath.split("/").pop()}.rels`);
  const drawingRelationships = parseXlsxRelationships(entries.get(drawingRelsPath)?.text);
  const drawingDocument = new DOMParser().parseFromString(drawingXml, "text/xml");
  const uploadedByRecordIndex = new Map();
  const anchors = [
    ...drawingDocument.getElementsByTagNameNS("*", "twoCellAnchor"),
    ...drawingDocument.getElementsByTagNameNS("*", "oneCellAnchor"),
  ];

  for (const anchor of anchors) {
    const from = anchor.getElementsByTagNameNS("*", "from")[0];
    const rowIndex = Number.parseInt(getFirstLocalText(from, "row"), 10);
    if (!Number.isFinite(rowIndex) || rowIndex <= 0) continue;
    const blip = anchor.getElementsByTagNameNS("*", "blip")[0];
    const embedId = blip?.getAttribute("r:embed") ?? blip?.getAttribute("embed") ?? "";
    const mediaPath = normalizeZipPath(drawingPath, drawingRelationships.get(embedId));
    const media = entries.get(mediaPath);
    if (!media?.bytes) continue;

    const extension = mediaPath.split(".").pop() || "jpg";
    const fileName = `clearance-row-${rowIndex + 1}.${extension}`;
    const imageFile = new File([media.bytes], fileName, { type: getImageMimeType(fileName) });
    const uploaded = await uploadImageFile(imageFile);
    uploadedByRecordIndex.set(rowIndex - 1, uploaded.url);
  }

  return uploadedByRecordIndex;
}

function clearanceRowsToRecords(rows) {
  const headers = rows[0] ?? [];
  return rows.slice(1).map((row) =>
    clearanceImportHeaders.reduce((record, header) => {
      const index = headers.indexOf(header);
      record[header] = index >= 0 ? row[index] ?? "" : "";
      return record;
    }, {}),
  );
}

function normalizeClearanceImportDate(value) {
  const text = String(value ?? "").trim();
  if (text === "") return "";
  const dateTimeMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T]([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?$/);
  if (dateTimeMatch !== null) {
    const [, year, month, day, hour, minute] = dateTimeMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const isoLikeMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (isoLikeMatch !== null) {
    const [, year, month, day] = isoLikeMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const slashMatch = text.match(/^(\d{4})[/.年](\d{1,2})[/.月](\d{1,2})(?:日)?(?:\s.*)?$/);
  if (slashMatch !== null) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number.parseFloat(text);
    if (serial > 20000 && serial < 80000) {
      const milliseconds = Math.round((serial - 25569) * 86400 * 1000);
      const date = new Date(milliseconds);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }
  return "";
}

function getClearanceGoalByName(name) {
  const text = String(name ?? "").trim();
  return getActiveGoals().find((goal) => goal.name === text) ?? getActiveGoals()[0] ?? null;
}

function getClearanceInitiatorByName(name) {
  const text = String(name ?? "").trim();
  return people.find((person) => person.name === text || person.account === text || person.username === text) ?? getCurrentUser() ?? people[0] ?? null;
}

function getClearanceTemplate() {
  return getActiveTaskTemplates().find((template) => template.name === clearanceWorkName) ?? null;
}

function buildClearanceImportPreviewRows(records) {
  const template = getClearanceTemplate();
  return records.map((record, index) => {
    const data = { ...record };
    const rowNumber = index + 2;
    const errors = [];
    const dueDateFieldValue = data.截止时间 ?? data.期望完成日期;
    const dueDate = normalizeClearanceImportDate(dueDateFieldValue);
    const goal = getClearanceGoalByName(data.关联目标);
    const initiator = getClearanceInitiatorByName(data.发起人);

    if (template === null) errors.push("未找到已启用的【库存清仓】关键行动");
    for (const header of clearanceRequiredImportHeaders) {
      if (header === "截止时间") {
        if (String(data.截止时间 ?? data.期望完成日期 ?? "").trim() === "") errors.push(`第 ${rowNumber} 行：【截止时间】不能为空`);
        continue;
      }
      if (String(data[header] ?? "").trim() === "") errors.push(`第 ${rowNumber} 行：【${header}】不能为空`);
    }
    if (dueDate === "") errors.push(`第 ${rowNumber} 行：【截止时间】必须是 YYYY-MM-DD 或 YYYY-MM-DD HH:mm`);
    if (data.仓库 !== "" && !clearanceWarehouseOptions.includes(data.仓库)) errors.push(`第 ${rowNumber} 行：【仓库】不在固定选项中`);
    if (data.清仓渠道 !== "" && !clearanceChannelOptions.includes(data.清仓渠道)) errors.push(`第 ${rowNumber} 行：【清仓渠道】不在固定选项中`);
    if (goal === null) errors.push(`第 ${rowNumber} 行：系统中没有可用目标`);
    if (initiator === null) errors.push(`第 ${rowNumber} 行：系统中没有可用发起人`);
    if (data.关联目标 !== "" && goal !== null && goal.name !== data.关联目标) errors.push(`第 ${rowNumber} 行：【关联目标】不存在`);
    if (data.发起人 !== "" && initiator !== null && ![initiator.name, initiator.account, initiator.username].includes(data.发起人)) {
      errors.push(`第 ${rowNumber} 行：【发起人】不存在`);
    }

    data.截止时间 = dueDate;
    return { rowNumber, data, errors };
  });
}

async function handleClearanceImportFile(file, rerender) {
  try {
    const fileName = file.name.toLowerCase();
    let rows;
    let embeddedImageUrls = new Map();
    if (fileName.endsWith(".xlsx")) {
      rows = await parseClearanceXlsxWorkbook(file);
      embeddedImageUrls = await uploadClearanceEmbeddedImages(file);
    } else {
      const text = await file.text();
      rows = text.trimStart().startsWith("<?xml") || text.includes("<Workbook")
        ? parseClearanceXmlWorkbook(text)
        : parseClearanceDelimitedRows(text);
    }
    const headers = rows[0] ?? [];
    const missingHeaders = clearanceRequiredImportHeaders.filter((header) => !headers.includes(header));
    if (missingHeaders.length > 0) {
      modalState = { kind: "clearanceImport", fileName: file.name, rows: [], error: `缺少必要表头：${missingHeaders.join("、")}` };
      rerender();
      return;
    }

    modalState = {
      kind: "clearanceImport",
      fileName: file.name,
      rows: buildClearanceImportPreviewRows(
        clearanceRowsToRecords(rows).map((record, index) => ({
          ...record,
          产品图: record.产品图 || embeddedImageUrls.get(index) || "",
        })),
      ),
      error: "",
    };
    rerender();
  } catch {
    modalState = { kind: "clearanceImport", fileName: file.name, rows: [], error: "文件解析失败，请使用系统导出的 xlsx 模板，或 CSV/TSV 文件。" };
    rerender();
  }
}

function getClearanceImportCustomFields(data) {
  return {
    coverImageUrl: data.产品图 || "",
    productName: data.清仓产品,
    sku: data["SKU / 规格"] || "",
    stockQuantity: data.当前库存,
    warehouse: data.仓库 || "",
    clearanceReason: data.清仓原因,
    suggestedPrice: data.建议清仓价 || "",
    originalPrice: data.原售价 || "",
    clearanceChannel: data.清仓渠道,
    dueDate: data.截止时间,
    notice: data.注意事项 || "",
  };
}

async function confirmClearanceImport(rerender) {
  if (modalState === null || modalState.kind !== "clearanceImport") return;
  const validRows = modalState.rows.filter((row) => row.errors.length === 0);
  const failedCount = modalState.rows.length - validRows.length;
  if (validRows.length === 0) {
    modalState = { ...modalState, error: "没有可导入的有效行。" };
    rerender();
    return;
  }

  const template = getClearanceTemplate();
  if (template === null) {
    modalState = { ...modalState, error: "未找到已启用的【库存清仓】关键行动。" };
    rerender();
    return;
  }
  if (!template.defaultProcessTemplateId) {
    modalState = { ...modalState, error: "【库存清仓】关键行动尚未绑定关键行动标准流程。" };
    rerender();
    return;
  }

  const importedInstances = [];

  try {
    for (const row of validRows) {
      const customFields = getClearanceImportCustomFields(row.data);
      const goal = getClearanceGoalByName(row.data.关联目标);
      const currentUser = getCurrentUser();
      const currentUserId = currentUser?.personId ?? currentUser?.id ?? "";
      const displayTitle = buildDisplayTitle(template, customFields);
      const workPlan = {
        id: createId("work-plan"),
        goalId: goal?.id ?? "",
        departmentId: template.departmentId ?? null,
        taskTemplateId: template.id,
        title: displayTitle,
        customFields,
        coverImageUrl: getPrimaryImageUrl({ customFields }) || null,
        status: WorkPlanStatus.ThisWeek,
        plannedWeek: getCurrentWeek(),
        dueDate: customFields.dueDate || null,
        description: template.description || `库存清仓：${row.data.清仓产品}`,
        processInstanceId: null,
        createdAt: getNow(),
        updatedAt: getNow(),
        launchedAt: null,
        canceledAt: null,
      };
      const result = await launchWorkPlanDraftAsProcess(workPlan, {
        dueDate: workPlan.dueDate,
        initiatorId: currentUserId,
        launchAssignments: buildLaunchAssignments(template.defaultProcessTemplateId, template, currentUserId),
      });
      importedInstances.push(result.instance);
    }
  } catch (error) {
    modalState = { ...modalState, error: error.message || "库存清仓导入失败，请检查本地数据库服务。" };
    rerender();
    return;
  }

  selectedProcessInstanceId = importedInstances[0]?.id ?? selectedProcessInstanceId;
  expandedClearanceGroups = new Set(importedInstances.map((instance) => instance.id));
  modalState = null;
  window.alert(`导入完成：成功 ${importedInstances.length} 行，跳过 ${failedCount} 行。`);
  rerender();
}

function renderClearanceCover(instance, tasks) {
  const imageUrl = getPrimaryImageUrl(instance, ...tasks);
  if (imageUrl === "") return `<span class="task-cover-placeholder">无图</span>`;
  return `
    <img
      class="task-cover-thumb"
      src="${escapeHtml(resolveAssetUrl(imageUrl))}"
      alt="库存清仓产品图"
      onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'task-cover-placeholder', textContent: '无图' }))"
    />
  `;
}

function renderClearanceTaskRows(group) {
  if (!group.expanded) return "";
  if (group.tasks.length === 0) {
    return `<div class="empty-detail compact-empty">暂无标准步骤任务</div>`;
  }
  return `
    <div class="table-wrap clearance-task-table-wrap">
      <table class="data-table clearance-task-table">
        <thead>
          <tr>
            <th>步骤</th>
            <th>任务名</th>
            <th>负责部门</th>
            <th>负责人</th>
            <th>截止时间</th>
            <th>状态</th>
            <th>是否逾期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${group.tasks
            .map((task, index) => `
              <tr data-row-task-id="${task.id}">
                <td>${index + 1}</td>
                <td>${escapeHtml(task.name)}</td>
                <td>${findName(departments, task.departmentId, "未设置")}</td>
                <td>${findName(people, task.ownerId, "未设置")}</td>
                <td>${formatBusinessMinuteDateTime(task.dueDate)}</td>
                <td>${renderTaskStatusSelect(task)}</td>
                <td>${renderOverdue(task)}</td>
                <td>
                  <span class="row-actions">
                    ${renderActionButton("查看", "view-task", task.id)}
                    ${renderActionButton("表单", "show-task-work-form", task.id)}
                    ${canReturnTask(task) ? renderActionButton("退回重做", "return-task", task.id) : ""}
                    ${canEditTask(task) ? renderActionButton("编辑", "edit-task", task.id) : ""}
                    ${canCancelTask(task) ? renderActionButton("取消", "cancel-task", task.id, "danger-button") : ""}
                    ${canRestoreTask(task) ? renderActionButton("恢复为待处理", "restore-task", task.id) : ""}
                  </span>
                </td>
              </tr>
            `)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderClearanceCard(group, index) {
  const info = getClearanceDisplayInfo(group.instance, group.tasks);
  const currentTask = group.currentTask;
  const status = getClearanceStatus(group.instance, group.tasks);
  const businessStatus = group.instance === null ? null : selectProcessInstanceBusinessStatus(group.instance.id, state);
  const expandedIcon = group.expanded ? "▾" : "▸";
  const currentTaskName = currentTask === null ? getProcessCurrentStepText(group.instance ?? {}) : currentTask.name;
  const currentOwner = currentTask === null ? "未设置" : findName(people, currentTask.ownerId, "未设置");
  const currentDueDate = formatBusinessMinuteDateTime(currentTask?.dueDate ?? info.dueDate, "未填写");
  const currentStatus = currentTask === null ? businessStatus?.label ?? status : getTaskBusinessStatus(currentTask).label;

  return `
    <article class="clearance-card" data-clearance-group-id="${escapeHtml(group.id)}">
      <div class="clearance-card-main">
        <div class="clearance-card-toggle">
          <button class="icon-button task-group-toggle" type="button" data-action="toggle-clearance-group" data-clearance-group-id="${escapeHtml(group.id)}" aria-label="${group.expanded ? "折叠库存清仓任务" : "展开库存清仓任务"}">${expandedIcon}</button>
          <span>${index + 1}</span>
        </div>
        <div class="task-cover-column">${renderClearanceCover(group.instance, group.tasks)}</div>
        <div class="clearance-card-info">
          <div class="clearance-card-title">
            <h3>${renderClearanceValue(info.productName || info.title)}</h3>
            <span class="status-pill ${getTaskStatusClass(businessStatus?.status ?? status)}">${businessStatus?.label ?? currentStatus}</span>
          </div>
          <div class="clearance-meta-grid">
            <span><b>SKU / 规格</b>${renderClearanceValue(info.sku)}</span>
            <span><b>当前库存</b>${renderClearanceValue(info.stockQuantity)}</span>
            <span><b>仓库</b>${renderClearanceValue(info.warehouse)}</span>
            <span><b>清仓原因</b>${renderClearanceValue(info.clearanceReason)}</span>
            <span><b>建议清仓价</b>${renderClearanceValue(info.suggestedPrice)}</span>
            <span><b>原售价</b>${renderClearanceValue(info.originalPrice)}</span>
            <span><b>清仓渠道</b>${renderClearanceValue(info.clearanceChannel)}</span>
            <span><b>截止时间</b>${renderClearanceValue(formatBusinessMinuteDateTime(info.dueDate, ""))}</span>
          </div>
          ${info.notice === "" ? "" : `<p class="form-note">备注：${escapeHtml(info.notice)}</p>`}
        </div>
      </div>
      <div class="clearance-current-row">
        <span><b>当前任务节点</b>${escapeHtml(currentTaskName ?? "暂无任务")}</span>
        <span><b>当前负责人</b>${escapeHtml(currentOwner)}</span>
        <span><b>截止时间</b>${escapeHtml(currentDueDate)}</span>
        <span><b>任务状态</b>${escapeHtml(currentStatus)}</span>
        <span>${currentTask === null ? `<span class="status-pill">无任务</span>` : renderOverdue(currentTask)}</span>
        <span class="row-actions">
          ${currentTask === null ? "" : renderActionButton("查看", "view-task", currentTask.id)}
          ${currentTask === null ? "" : renderActionButton("表单", "show-task-work-form", currentTask.id)}
          ${currentTask !== null && canReturnTask(currentTask) ? renderActionButton("退回重做", "return-task", currentTask.id) : ""}
          ${group.instance !== null && canRelaunchProcessInstance(group.instance) ? renderProcessActionButton("重新发起", "relaunch-process", group.instance.id) : ""}
        </span>
      </div>
      ${renderClearanceTaskRows(group)}
    </article>
  `;
}

function renderClearancePage() {
  const groups = getClearanceGroups();
  return `
    ${renderClearanceFilters()}
    <section class="settings-section clearance-section">
      <div class="section-heading">
        <div>
          <h2>库存清仓</h2>
          <p class="form-note">集中查看库存清仓关键行动产生的标准步骤和任务；批量导入可在“产品图”列填写图片地址，或在对应行插入图片。</p>
        </div>
        <div class="toolbar-actions">
          ${canCurrentUser("workPlans.launch") ? `<button class="secondary-button" type="button" data-action="download-clearance-template">下载导入模板</button>` : ""}
          ${
            canCurrentUser("workPlans.launch")
              ? `
                <label class="secondary-button file-button">
                  批量导入
                  <input type="file" data-clearance-file="import" accept=".xlsx,.xls,.xml,.csv,.tsv,.txt" />
                </label>
              `
              : ""
          }
        </div>
      </div>
      ${renderClearanceStats(groups)}
      <div class="clearance-card-list">
        ${groups.length === 0 ? `<div class="empty-detail">暂无匹配的库存清仓任务</div>` : groups.map((group, index) => renderClearanceCard(group, index)).join("")}
      </div>
    </section>
    ${renderTaskDetailModal()}
    ${renderTaskModal()}
    ${renderResultModal()}
    ${renderReturnTaskModal()}
    ${renderWorkFormModal()}
    ${renderClearanceImportModal()}
  `;
}

function renderClearanceImportModal() {
  if (modalState === null || modalState.kind !== "clearanceImport") return "";
  const rows = modalState.rows ?? [];
  const validCount = rows.filter((row) => row.errors.length === 0).length;
  const failedCount = rows.length - validCount;
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="库存清仓批量导入">
        <div class="modal-header">
          <div>
            <h2>库存清仓批量导入</h2>
            <p class="form-note">${escapeHtml(modalState.fileName ?? "")}｜有效 ${validCount} 行｜错误 ${failedCount} 行</p>
          </div>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error)}</div>
        <div class="table-wrap import-preview-wrap">
          <table class="data-table compact-import-table">
            <thead>
              <tr>
                <th>行号</th>
                <th>清仓产品</th>
                <th>SKU / 规格</th>
                <th>库存</th>
                <th>仓库</th>
                <th>清仓渠道</th>
                <th>截止时间</th>
                <th>关联目标</th>
                <th>校验结果</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length === 0
                  ? `<tr><td colspan="9">暂无可预览数据</td></tr>`
                  : rows
                      .map((row) => `
                        <tr class="${row.errors.length > 0 ? "import-row-error" : ""}">
                          <td>${row.rowNumber}</td>
                          <td>${escapeHtml(row.data.清仓产品)}</td>
                          <td>${escapeHtml(row.data["SKU / 规格"])}</td>
                          <td>${escapeHtml(row.data.当前库存)}</td>
                          <td>${escapeHtml(row.data.仓库)}</td>
                          <td>${escapeHtml(row.data.清仓渠道)}</td>
                          <td>${escapeHtml(row.data.截止时间)}</td>
                          <td>${escapeHtml(row.data.关联目标)}</td>
                          <td>${row.errors.length === 0 ? "可导入" : escapeHtml(row.errors.join("；"))}</td>
                        </tr>
                      `)
                      .join("")
              }
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
          <button class="primary-button" type="button" data-action="confirm-clearance-import" ${validCount === 0 ? "disabled" : ""}>确认导入有效行</button>
        </div>
      </div>
    </div>
  `;
}

function getVisibleTaskIdsFromRows(rows) {
  return rows.map((row) => row.task.id);
}

function getProcessProgress(processInstanceId) {
  const progress = selectProcessProgress(processInstanceId, state);
  return { done: progress.completed, total: progress.total, text: `${progress.completed}/${progress.total}` };
}

function getCurrentSteps(processInstanceId) {
  const currentTask = selectCurrentProcessTask(processInstanceId, state);
  return currentTask === null ? [] : [currentTask];
}

function getWaitingProcessTasks(processInstanceId) {
  return sortProcessTasks(getProcessTasks(processInstanceId)).filter((task) => task.status === TaskStatus.Waiting);
}

function isProcessOverdue(processInstanceId) {
  return selectProcessInstanceOverdue(processInstanceId, state, today);
}

function getProcessCurrentStepText(instance) {
  if (instance.status === ProcessInstanceStatus.Done) return "已完成";
  if (instance.status === ProcessInstanceStatus.Canceled) return "已取消";
  if (instance.status === ProcessInstanceStatus.Stopped) return "已终止";

  const currentSteps = getCurrentSteps(instance.id);
  if (currentSteps.length > 0) {
    return currentSteps.map((task) => task.name).join("、");
  }

  if (getWaitingProcessTasks(instance.id).length > 0) return "等待前置";

  return "暂无任务";
}

function getProcessCurrentOwners(instance) {
  const currentExecutor = selectCurrentExecutor(instance.id, state);
  if (currentExecutor.personId !== "") return findName(people, currentExecutor.personId, "未设置");
  if (instance.status === ProcessInstanceStatus.Done) return "已完成";
  if (instance.status === ProcessInstanceStatus.Canceled) return "已取消";
  if (instance.status === ProcessInstanceStatus.Stopped) return "已终止";
  return "未设置";
}

function getProcessCurrentDueDate(instance) {
  const dueDates = getCurrentSteps(instance.id)
    .map((task) => task.dueDate)
    .filter((date) => date !== null)
    .sort();

  return formatBusinessMinuteDateTime(dueDates[0]);
}

function getProcessTemplate(instance) {
  return state.processTemplates.find((template) => template.id === instance.templateId) ?? null;
}

function getProcessTemplateById(templateId) {
  return state.processTemplates.find((template) => template.id === templateId) ?? null;
}

function getStandardWorkName(instance) {
  const taskTemplateId = instance.taskTemplateId ?? instance.standardWorkId ?? null;
  if (taskTemplateId === null) return "未关联关键行动";
  return getTaskTemplate(taskTemplateId)?.name ?? "未关联关键行动";
}

function isStockClearanceProcessInstance(instance) {
  return getStandardWorkName(instance) === "库存清仓";
}

function getProcessDisplayTitle(instance) {
  return instance.displayTitle ?? instance.name;
}

function buildLaunchAssignments(templateId, taskTemplate, initiatorId) {
  const launchAssignments = { owner: {}, accepter: {} };
  state.processTemplateNodes
    .filter((node) => node.templateId === templateId)
    .forEach((node) => {
      if (node.ownerRule === ProcessOwnerRule.LaunchAssign) {
        launchAssignments.owner[node.id] = taskTemplate.ownerId ?? initiatorId;
      }
      if (node.accepterRule === ProcessAccepterRule.LaunchAssign) {
        launchAssignments.accepter[node.id] = taskTemplate.accepterId ?? initiatorId;
      }
    });

  return launchAssignments;
}

function matchesProcessProgressFilters(instance) {
  const title = getProcessDisplayTitle(instance);
  const templateName = getProcessTemplate(instance)?.name ?? "";
  const goalName = findName(goals, instance.goalId, "");
  const currentOwnerIds = getCurrentSteps(instance.id).map((task) => task.ownerId);
  const overdue = isProcessOverdue(instance.id);
  const keyword = processProgressFilters.keyword;
  const isStockClearance = isStockClearanceProcessInstance(instance);

  if (processProgressFilters.showStockClearance && !isStockClearance) return false;
  if (!processProgressFilters.showStockClearance && isStockClearance) return false;
  if (keyword !== "" && !`${title} ${templateName} ${goalName}`.includes(keyword)) return false;
  if (processProgressFilters.goalId !== "" && instance.goalId !== processProgressFilters.goalId) return false;
  if (processProgressFilters.templateId !== "" && instance.templateId !== processProgressFilters.templateId) return false;
  if (processProgressFilters.status !== "" && selectProcessInstanceBusinessStatus(instance.id, state).status !== processProgressFilters.status) return false;
  if (processProgressFilters.status === "" && isDoneStatus(instance.status) && !processProgressFilters.showDone) return false;
  if (processProgressFilters.status === "" && isHiddenByDefaultStatus(instance.status) && !isDoneStatus(instance.status) && !processProgressFilters.showCanceled) return false;
  if (processProgressFilters.ownerId !== "" && !currentOwnerIds.includes(processProgressFilters.ownerId)) return false;
  if (processProgressFilters.overdue === "yes" && !overdue) return false;
  if (processProgressFilters.overdue === "no" && overdue) return false;
  if (processProgressFilters.initiatorId !== "" && instance.initiatorId !== processProgressFilters.initiatorId) return false;

  return true;
}

function getFilteredProcessInstances() {
  return state.processInstances.filter(matchesProcessProgressFilters);
}

function canEditTask(task) {
  return !isDoneStatus(task.status) && !isCanceledStatus(task.status);
}

function canCancelTask(task) {
  return task.source === TaskSource.Direct && !isDoneStatus(task.status) && !isCanceledStatus(task.status);
}

function canRestoreTask(task) {
  return isCanceledStatus(task.status) && canCurrentUser("tasks.changeStatus");
}

function renderFilters() {
  filters = { ...filters, source: "", goalId: "", categoryId: "" };
  if (taskListView === "overdue" && filters.overdue !== "") filters = { ...filters, overdue: "" };
  const isFullView = taskListView === "all";
  const peopleFilters = `
    <label>
      <span>负责部门</span>
      <select name="departmentId">
        ${renderOptions(departments, filters.departmentId, "全部部门")}
      </select>
    </label>
    <label>
      <span>负责人</span>
      <select name="ownerId">
        ${renderOptions(people, filters.ownerId, "全部负责人")}
      </select>
    </label>
    <label>
      <span>执行人</span>
      <select name="executorId">
        ${renderOptions(people, filters.executorId, "全部执行人")}
      </select>
    </label>
  `;
  const overdueFilter = `
    <label>
      <span>是否逾期</span>
      <select name="overdue">
        <option value="">全部</option>
        <option value="yes" ${filters.overdue === "yes" ? "selected" : ""}>已逾期</option>
        <option value="no" ${filters.overdue === "no" ? "selected" : ""}>未逾期</option>
      </select>
    </label>
  `;
  const filterOptions = `
    <div class="task-filter-options">
      <label class="checkbox-field task-filter-checkbox">
        <input name="showDone" type="checkbox" ${filters.showDone ? "checked" : ""} />
        <span>显示已完成</span>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showCanceled" type="checkbox" ${filters.showCanceled ? "checked" : ""} />
        <span>显示已取消</span>
      </label>
    </div>
  `;

  return `
    <form class="task-filters task-list-filters ${isFullView ? "" : "is-compact"}" aria-label="任务筛选">
      <label>
        <span>关键词</span>
        <input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="搜索任务名称" />
      </label>
      <label>
        <span>任务状态</span>
        <select name="status">
          <option value="">全部状态</option>
          ${taskStatusSelectOptions
            .map(
              (option) => `
                <option value="${option.value}" ${filters.status === option.value ? "selected" : ""}>
                  ${option.label}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
      ${taskListView === "overdue" ? "" : overdueFilter}
      ${
        isFullView
          ? `${peopleFilters}${filterOptions}`
          : `
            <details class="task-more-filters">
              <summary>更多筛选</summary>
              <div class="task-more-filter-grid">
                ${peopleFilters}
                ${filterOptions}
              </div>
            </details>
          `
      }
    </form>
  `;
}

function renderTaskListViewSwitch() {
  return `
    <div class="task-list-toolbar">
      <div class="task-list-view-switch" aria-label="任务范围">
        ${taskListViewOptions
          .map(
            (option) => `
              <button
                class="${taskListView === option.value ? "is-active" : ""}"
                type="button"
                data-task-list-view="${option.value}"
              >
                ${option.label}
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="task-display-view-switch" aria-label="任务展示方式">
        <button class="${taskDisplayView === "list" ? "is-active" : ""}" type="button" data-task-display-view="list">列表</button>
        <button class="${taskDisplayView === "card" ? "is-active" : ""}" type="button" data-task-display-view="card">卡片</button>
      </div>
    </div>
  `;
}

function renderActionButton(label, action, taskId, variant = "") {
  return `
    <button class="text-button ${variant}" type="button" data-action="${action}" data-task-id="${taskId}">
      ${label}
    </button>
  `;
}

function renderProcessActionButton(label, action, instanceId, variant = "") {
  return `
    <button class="text-button ${variant}" type="button" data-action="${action}" data-process-instance-id="${instanceId}">
      ${label}
    </button>
  `;
}

function canCancelProcessInstance(instance) {
  return (
    instance !== null &&
    canCurrentUser("processes.editInstances") &&
    [ProcessInstanceStatus.Running, "active", "pending", "doing"].includes(instance.status)
  );
}

function canRelaunchProcessInstance(instance) {
  return instance !== null && isCanceledStatus(instance.status) && canCurrentUser("workPlans.launch");
}

function renderTemplateActionButton(label, action, templateId, variant = "") {
  return `
    <button class="text-button ${variant}" type="button" data-action="${action}" data-template-id="${templateId}">
      ${label}
    </button>
  `;
}

function renderTaskTable() {
  const tableRows = getTaskTableRows();
  const visibleTaskIds = getVisibleTaskIdsFromRows(tableRows);
  const selectedVisibleCount = visibleTaskIds.filter((taskId) => selectedTaskIds.has(taskId)).length;
  const allVisibleSelected = visibleTaskIds.length > 0 && selectedVisibleCount === visibleTaskIds.length;
  const hasPartialSelection = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectedCount = selectedTaskIds.size;
  const dueDateSortLabel = taskDueDateSort === "asc" ? "取消" : "↑";
  const dueDateSortTitle = taskDueDateSort === "asc" ? "取消任务截止时间排序，恢复默认顺序" : "按任务截止时间从早到晚排序";

  return `
    <section class="settings-section">
      <div class="bulk-task-bar">
        <strong>已选择 ${selectedCount} 条任务</strong>
        <span class="row-actions">
          <button class="text-button" type="button" data-action="create-execution-group" ${selectedCount < 2 ? "disabled" : ""}>创建执行组</button>
          <button class="text-button" type="button" data-action="bulk-complete" ${selectedCount === 0 ? "disabled" : ""}>批量完成</button>
          <button class="text-button danger-button" type="button" data-action="bulk-cancel" ${selectedCount === 0 ? "disabled" : ""}>批量取消</button>
        </span>
      </div>
      <div class="table-wrap">
        <table class="data-table task-table">
          <thead>
            <tr>
              <th class="task-select-column">
                <label class="task-select-all">
                  <input type="checkbox" data-task-select-all ${visibleTaskIds.length === 0 ? "disabled" : ""} ${allVisibleSelected ? "checked" : ""} data-indeterminate="${hasPartialSelection ? "true" : "false"}" />
                  <span>序号</span>
                </label>
              </th>
              <th class="task-cover-column">产品图</th>
              <th class="task-belonging-column">归属事项</th>
              <th class="task-name-column">任务名</th>
              <th class="task-executor-column">执行人</th>
              <th class="task-date-column">
                <span class="sortable-table-header">
                  <span>任务截止时间</span>
                  <button class="table-sort-button ${taskDueDateSort === "" ? "" : "is-active"}" type="button" data-action="toggle-due-date-sort" title="${dueDateSortTitle}" aria-label="${dueDateSortTitle}">${dueDateSortLabel}</button>
                </span>
              </th>
              <th class="task-date-column">项目截止时间</th>
              <th class="task-status-column">状态</th>
              <th class="task-overdue-column">是否逾期</th>
              <th class="task-department-column">负责部门</th>
              <th class="task-owner-column">负责人</th>
              <th class="task-actions-column">操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              tableRows.length === 0
                ? `<tr><td colspan="12">暂无匹配的任务</td></tr>`
                : tableRows.map((row, index) => renderTaskRow(row.task, index)).join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function getTaskRemainingText(task) {
  if (isDoneStatus(task.status)) return { label: "已完成", overdue: false };
  if (isCanceledStatus(task.status)) return { label: "已取消", overdue: false };

  const dueTime = parseTaskComparableTime(task.dueDate, "end");
  if (dueTime === null) return { label: "未设置截止时间", overdue: false };

  const nowTime = parseTaskComparableTime(getNow());
  if (nowTime === null) return { label: "未设置截止时间", overdue: false };

  const overdue = nowTime > dueTime || hasTaskOverdueRecord(task);
  const diffMinutes = Math.max(1, Math.ceil(Math.abs(nowTime - dueTime) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  const durationText = `${hours}小时${minutes}分钟`;
  return { label: overdue ? `已超时 ${durationText}` : `剩余 ${durationText}`, overdue };
}

function renderTaskCard(task) {
  const selected = task.id === selectedTaskId ? "is-selected" : "";
  const remaining = getTaskRemainingText(task);
  const belonging = getTaskBelonging(task);
  const actionName = belonging.title || belonging.standardWorkName || "未关联关键行动";

  return `
    <article class="task-card ${selected}" data-task-card data-row-task-id="${escapeHtml(task.id)}">
      <div class="task-card-cover">${renderCoverImage(task)}</div>
      <div class="task-card-body">
        <div class="task-card-title-row">
          <h3>${escapeHtml(task.name)}</h3>
        </div>
        <p class="task-card-action-title">${escapeHtml(actionName)}</p>
        <p class="task-card-executor">执行人：${escapeHtml(findName(people, getTaskExecutorId(task), "未设置执行人"))}</p>
        <div class="task-card-status-row">
          ${renderTaskStatusSelect(task)}
          <span class="task-card-remaining ${remaining.overdue ? "is-overdue" : ""}">${escapeHtml(remaining.label)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderTaskCardGrid() {
  const cards = getTaskTableRows().map((row) => renderTaskCard(row.task));

  return `
    <section class="settings-section task-card-section">
      ${cards.length === 0 ? `<div class="empty-detail">暂无匹配的任务</div>` : `<div class="task-card-grid">${cards.join("")}</div>`}
    </section>
  `;
}

function renderProcessProgressFilters() {
  return `
    <form class="process-progress-filters task-filters" aria-label="关键行动进度筛选">
      <label>
        <span>关键词</span>
        <input name="keyword" value="${escapeHtml(processProgressFilters.keyword)}" placeholder="搜索本次关键行动、关键行动标准流程、目标" />
      </label>
      <label>
        <span>关联目标</span>
        <select name="goalId">${renderOptions(getActiveGoals(), processProgressFilters.goalId, "全部目标")}</select>
      </label>
      <label>
        <span>关键行动标准流程</span>
        <select name="templateId">${renderOptions(state.processTemplates, processProgressFilters.templateId, "全部关键行动标准流程")}</select>
      </label>
      <label>
        <span>状态</span>
        <select name="status">
          <option value="">全部状态</option>
          <option value="pending" ${processProgressFilters.status === "pending" ? "selected" : ""}>待执行</option>
          <option value="running" ${processProgressFilters.status === "running" ? "selected" : ""}>执行中</option>
          <option value="done" ${processProgressFilters.status === "done" ? "selected" : ""}>已完成</option>
        </select>
      </label>
      <label>
        <span>当前负责人</span>
        <select name="ownerId">${renderOptions(people, processProgressFilters.ownerId, "全部负责人")}</select>
      </label>
      <label>
        <span>是否逾期</span>
        <select name="overdue">
          <option value="">全部</option>
          <option value="yes" ${processProgressFilters.overdue === "yes" ? "selected" : ""}>已逾期</option>
          <option value="no" ${processProgressFilters.overdue === "no" ? "selected" : ""}>正常</option>
        </select>
      </label>
      <label>
        <span>发起人</span>
        <select name="initiatorId">${renderOptions(people, processProgressFilters.initiatorId, "全部发起人")}</select>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showDone" type="checkbox" ${processProgressFilters.showDone ? "checked" : ""} />
        <span>显示已完成</span>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showCanceled" type="checkbox" ${processProgressFilters.showCanceled ? "checked" : ""} />
        <span>显示已取消</span>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showStockClearance" type="checkbox" ${processProgressFilters.showStockClearance ? "checked" : ""} />
        <span>显示库存清仓</span>
      </label>
      <p class="form-note">已取消的数据默认隐藏，可勾选显示已取消查看。</p>
    </form>
  `;
}

function renderProcessOverdue(instance) {
  return isProcessOverdue(instance.id)
    ? `<span class="status-pill is-danger">已逾期</span>`
    : `<span class="status-pill">正常</span>`;
}

function renderProcessProgressTable() {
  const instances = getFilteredProcessInstances();

  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>关键行动进度</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table process-progress-table">
          <thead>
            <tr>
              <th class="task-cover-column">产品图</th>
              <th>本次关键行动标题</th>
              <th>关键行动</th>
              <th>关联目标</th>
              <th>关键行动标准流程</th>
              <th>当前步骤</th>
              <th>步骤进度</th>
              <th>当前负责人</th>
              <th>截止时间</th>
              <th>状态</th>
              <th>是否逾期</th>
              <th>发起人</th>
              <th>发起时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              instances.length === 0
                ? `<tr><td colspan="14">暂无匹配的已发起关键行动</td></tr>`
                : instances
                    .map((instance) => {
                      const progress = getProcessProgress(instance.id);
                      return `
                        <tr class="${instance.id === selectedProcessInstanceId ? "is-selected" : ""}" data-process-progress-id="${instance.id}">
                          <td class="task-cover-column">${renderProcessCoverImage(instance)}</td>
                          <td>${escapeHtml(getProcessDisplayTitle(instance))}</td>
                          <td>${escapeHtml(getStandardWorkName(instance))}</td>
                          <td>${findName(goals, instance.goalId, "未设置")}</td>
                          <td>${getProcessTemplate(instance)?.name ?? "未设置"}</td>
                          <td>${escapeHtml(getProcessCurrentStepText(instance))}</td>
                          <td>${progress.text}</td>
                          <td>${escapeHtml(getProcessCurrentOwners(instance))}</td>
                          <td>${getProcessCurrentDueDate(instance)}</td>
                          <td><span class="status-pill">${selectProcessInstanceBusinessStatus(instance.id, state).label}</span></td>
                          <td>${renderProcessOverdue(instance)}</td>
                          <td>${findName(people, instance.initiatorId, "未设置")}</td>
                          <td>${instance.startedAt}</td>
                          <td>
                            ${renderProcessActionButton("表单", "show-process-work-form", instance.id)}
                            ${
                              canCancelProcessInstance(instance)
                                ? renderProcessActionButton("取消关键行动", "cancel-process", instance.id, "danger-button")
                                : ""
                            }
                            ${
                              canRelaunchProcessInstance(instance)
                                ? renderProcessActionButton("重新发起", "relaunch-process", instance.id)
                                : ""
                            }
                          </td>
                        </tr>
                      `;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderProcessCustomFields(instance) {
  const customFields = instance.customFields ?? {};
  const entries = Object.entries(customFields).filter(([key, value]) => {
    if (key === standardWorkAttachmentsKey) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== "";
  });
  const taskTemplate = getTaskTemplate(instance.taskTemplateId ?? "");
  const fieldLabels = new Map(getSortedFormFields(taskTemplate).map((field) => [field.key, field.label]));

  if (entries.length === 0) {
    return `<p>暂无关键行动公共信息</p>`;
  }

  return `
    <div class="detail-grid">
      ${entries
        .map(([key, value]) => renderDetailField(fieldLabels.get(key) ?? key, escapeHtml(Array.isArray(value) ? value.join("、") : value)))
        .join("")}
    </div>
  `;
}

function renderProcessStepProgress(instance) {
  const tasks = sortProcessTasks(getProcessTasks(instance.id));

  if (tasks.length === 0) {
    return `<div class="empty-detail">暂无标准步骤任务</div>`;
  }

  return `
    <div class="table-wrap">
      <table class="data-table process-progress-detail-table">
        <thead>
          <tr>
            <th>步骤名称</th>
            <th>步骤</th>
            <th>负责人</th>
            <th>状态</th>
            <th>截止时间</th>
            <th>是否逾期</th>
            <th>步骤完成标准</th>
            <th>步骤审核标准</th>
            <th>输出结果</th>
            <th>完成时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${tasks
            .map((task, index) => {
              const node = getProcessNode(task);
              return `
                <tr>
                  <td>${escapeHtml(task.name)}</td>
                  <td>${formatProcessStepLabel(index + 1)}</td>
                  <td>${findName(people, task.ownerId, "未设置")}</td>
                  <td><span class="status-pill">${getTaskBusinessStatus(task).label}</span></td>
                  <td>${formatBusinessMinuteDateTime(task.dueDate)}</td>
                  <td>${renderOverdue(task)}</td>
                  <td class="wide-text">${escapeHtml(task.completionStandard ?? node?.completionStandard ?? "-")}</td>
                  <td class="wide-text">${escapeHtml(task.reviewStandard ?? node?.reviewStandard ?? "-")}</td>
                  <td class="wide-text">${escapeHtml(task.resultText ?? "暂无")}</td>
                  <td>${task.completedAt ?? "未完成"}</td>
                  <td><button class="text-button" type="button" data-action="open-process-task" data-task-id="${task.id}">查看任务</button></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderProcessProgressDetail() {
  const selectedInstance = state.processInstances.find((item) => item.id === selectedProcessInstanceId) ?? null;
  const instance =
    selectedInstance !== null && matchesProcessProgressFilters(selectedInstance)
      ? selectedInstance
      : getFilteredProcessInstances()[0] ?? null;

  if (instance === null) {
    return `
      <section class="settings-section task-detail">
        <div class="section-heading"><h2>关键行动进度详情</h2></div>
        <div class="empty-detail">暂无已发起关键行动</div>
      </section>
    `;
  }

  return renderLaunchedProcessDetail(instance.id);
}

function renderDetailField(label, value) {
  return `
    <div class="detail-field">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function getTaskActionContext(task) {
  const instance = getTaskProcessInstance(task);
  const taskTemplate = instance === null ? getTaskTemplateForTask(task) : getTaskTemplate(instance.taskTemplateId ?? instance.standardWorkId ?? "");
  const customFields = getTaskCustomFields(task);
  const title = instance === null ? "未关联关键行动" : getProcessDisplayTitle(instance);

  return {
    instance,
    taskTemplate,
    customFields,
    title,
  };
}

function renderActionSummary(task, context) {
  const { instance, taskTemplate, title, customFields } = context;
  if (instance === null) {
    return `
      <div class="detail-block">
        <h3>关键行动信息</h3>
        <p class="form-note">该任务未关联关键行动。</p>
      </div>
    `;
  }

  return `
    <div class="detail-block">
      <div class="section-heading with-actions">
        <div>
          <h3>关键行动信息</h3>
          <p class="form-note">${escapeHtml(title)}</p>
        </div>
        <button class="secondary-button" type="button" data-action="view-launched-process-detail" data-task-id="${escapeHtml(task.id)}">查看关键行动详情</button>
      </div>
      ${renderWorkFormViewer({
        formFields: getSortedFormFields(taskTemplate),
        customFields,
      })}
    </div>
  `;
}

function renderCurrentTaskSection(task) {
  const requirement = getTaskSubmitRequirement(task);
  const remaining = getTaskRemainingText(task);

  return `
    <div class="detail-block current-task-block">
      <h3>本次任务</h3>
      <div class="detail-grid">
        ${renderDetailField("任务名称", escapeHtml(task.name))}
        ${renderDetailField("执行人", findName(people, task.executorId ?? task.ownerId, "未设置"))}
        ${renderDetailField("剩余时间", escapeHtml(remaining.label))}
        ${renderDetailField("状态", getTaskBusinessStatus(task).label)}
      </div>
      <p>任务说明：${escapeHtml(task.description || "未填写")}</p>
      <p>完成标准：${escapeHtml(task.completionStandard || "未填写")}</p>
      ${
        task.reviewStandard === undefined || task.reviewStandard === null || task.reviewStandard === ""
          ? ""
          : `<p>${task.source === TaskSource.Process ? "步骤审核标准" : "审核标准"}：${escapeHtml(task.reviewStandard)}</p>`
      }
      <p>提交要求：${escapeHtml(submitTypeNames[requirement.submitType] ?? "填写表单")} ${requirement.submitDescription ? `｜${escapeHtml(requirement.submitDescription)}` : ""}</p>
      <div class="row-actions task-status-actions">
        ${renderStatusActions(task) || "<span class=\"muted-action\">暂无可用操作</span>"}
      </div>
    </div>
  `;
}

function renderReturnRecordsContent(task) {
  const records = getReturnRecords(task);
  if (records.length === 0) return `<p class="form-note">暂无退回记录。</p>`;

  return `
    <div class="return-record-list">
      ${records
        .map(
          (record) => `
            <div class="return-record-item">
              <strong>${escapeHtml(record.returnedAt ?? "未记录时间")} ${escapeHtml(record.returnedByName ?? "未记录人员")} 退回到“${escapeHtml(record.toTaskName ?? "上一节点")}”</strong>
              <p>从“${escapeHtml(record.fromTaskName ?? "当前节点")}”退回；原因：${escapeHtml(record.reason ?? "未填写")}</p>
              ${
                Array.isArray(record.affectedTaskNames) && record.affectedTaskNames.length > 0
                  ? `<p>影响节点：${record.affectedTaskNames.map((name) => escapeHtml(name)).join("、")}</p>`
                  : ""
              }
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderStatusActions(task) {
  if (!canCurrentUser("tasks.changeStatus")) return "";
  const returnAction = canReturnTask(task) ? renderActionButton("退回重做", "return-task", task.id) : "";
  if (task.status === TaskStatus.Waiting) {
    if (canActivateWaitingProcessTask(task)) {
      return `${renderActionButton("开始任务", "start-task", task.id)}${returnAction}`;
    }
    return `<span class="muted-action">等待前置任务完成</span>${returnAction}`;
  }

  if (task.status === TaskStatus.Todo) {
    return `${renderActionButton("开始任务", "start-task", task.id)}${returnAction}`;
  }

  if (task.status === TaskStatus.Doing && task.needAcceptance) {
    return `${renderActionButton("提交验收", "submit-acceptance", task.id)}${returnAction}`;
  }

  if (task.status === TaskStatus.Doing) {
    return `${renderActionButton("提交完成", "submit-done", task.id)}${returnAction}`;
  }

  if (task.status === TaskStatus.PendingAcceptance) {
    return `
      ${renderActionButton("验收通过", "accept-task", task.id)}
      ${renderActionButton("验收退回", "reject-task", task.id, "danger-button")}
      ${returnAction}
    `;
  }

  return returnAction;
}

function renderTaskSubmitResultDetail(task) {
  const requirement = getTaskSubmitRequirement(task);
  const formRows = includesSubmitPart(requirement.submitType, "form")
    ? getSubmitFields(task)
        .map((field) => renderDetailField(field.label, escapeHtml(getSubmitFieldValue(requirement.submitFormData, field) || "未填写")))
        .join("")
    : "";
  const fileRows = includesSubmitPart(requirement.submitType, "file")
    ? renderAttachmentPreviewList(requirement.submitFiles, "未上传")
    : "不需要";
  const linkRows = includesSubmitPart(requirement.submitType, "link")
    ? requirement.submitLinks.map((link) => `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>`).join("、") || "未填写"
    : "不需要";
  const editable = task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled;
  const resultAttachments = task.resultAttachments ?? [];

  return `
    <div class="detail-block">
      <div class="section-heading with-actions compact-heading">
        <h3>提交结果</h3>
        ${
          requirement.submitType !== SubmitType.None && editable && canCurrentUser("tasks.submitResult")
            ? renderActionButton("填写提交结果", "submit-result", task.id)
            : ""
        }
      </div>
      ${
        requirement.submitType === SubmitType.None
          ? `<p>本步骤无需单独填写提交表单。</p>`
          : `<p>提交类型：${submitTypeNames[requirement.submitType] ?? "填写表单"}</p>
             <p>提交说明：${escapeHtml(requirement.submitDescription ?? "")}</p>`
      }
      ${formRows === "" ? "" : `<div class="detail-grid">${formRows}</div>`}
      <div class="submit-file-preview">
        <p>上传文件：</p>
        ${fileRows}
      </div>
      <p>提交链接：${linkRows}</p>
      <p>提交时间：${task.submittedAt ?? "未提交"}</p>
      <p>提交人：${findName(people, task.submittedBy, "未记录")}</p>
      <p>结果说明：${escapeHtml(task.resultText ?? "暂无")}</p>
      <div class="submit-file-preview">
        <p>结果附件：</p>
        ${renderAttachmentPreviewList(resultAttachments, "暂无结果附件")}
      </div>
      <p>完成时间：${task.completedAt ?? "未完成"}</p>
    </div>
  `;
}

function getPreviousProcessTask(task) {
  if (
    task.source !== TaskSource.Process ||
    task.processInstanceId === null ||
    task.processInstanceId === undefined ||
    task.processInstanceId === ""
  ) {
    return null;
  }
  const processTasks = sortProcessTasks(getProcessTasks(task.processInstanceId));
  const currentIndex = processTasks.findIndex((item) => item.id === task.id);
  if (currentIndex <= 0) return null;
  return processTasks[currentIndex - 1] ?? null;
}

function getTaskSubmittedFiles(task) {
  if (task === null || task === undefined) return [];
  const files = [];
  const seen = new Set();
  const addFile = (file) => {
    const key = typeof file === "string" ? file : file?.url ?? file?.filePath ?? file?.filename ?? "";
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  if (Array.isArray(task.submitFiles)) task.submitFiles.forEach(addFile);
  if (Array.isArray(task.resultAttachments)) task.resultAttachments.forEach(addFile);
  return files;
}

function renderSubmittedFormDataRows(task) {
  const formData = task?.submitFormData && typeof task.submitFormData === "object" ? task.submitFormData : {};
  const fields = getSubmitFields(task ?? {});
  const labelByKey = new Map(fields.map((field) => [field.key, field.label || field.key]));
  const rows = Object.entries(formData)
    .filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined && value !== "";
    })
    .map(([key, value]) => {
      const displayValue = Array.isArray(value) ? value.join("、") : typeof value === "object" ? JSON.stringify(value) : value;
      return renderDetailField(escapeHtml(labelByKey.get(key) ?? key), escapeHtml(displayValue));
    })
    .join("");

  return rows === "" ? `<p class="form-note">前步任务暂无表单提交内容。</p>` : `<div class="detail-grid">${rows}</div>`;
}

function renderSubmittedLinks(task) {
  const links = Array.isArray(task?.submitLinks) ? task.submitLinks.filter(Boolean) : [];
  if (links.length === 0) return "未填写";
  return links
    .map((link) => `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>`)
    .join("、");
}

function renderPreviousTaskSubmissionBlock(task) {
  const previousTask = getPreviousProcessTask(task);
  if (previousTask === null) {
    return `
      <div class="detail-block">
        <h3>前步提交结果</h3>
        <p class="form-note">当前任务没有前一步任务。</p>
      </div>
    `;
  }
  const files = getTaskSubmittedFiles(previousTask);
  const resultText = String(previousTask.resultText ?? "").trim() || "暂无";
  const summaryText = resultText.length > 80 ? `${resultText.slice(0, 80)}...` : resultText;

  return `
    <div class="detail-block">
      <h3>前步提交结果</h3>
      <p><strong>${escapeHtml(previousTask.name)}</strong>｜${escapeHtml(summaryText)}</p>
      <details>
        <summary>展开查看完整提交</summary>
        <div class="detail-grid">
          ${renderDetailField("任务状态", escapeHtml(getTaskBusinessStatus(previousTask).label))}
          ${renderDetailField("提交时间", escapeHtml(previousTask.submittedAt ?? "未提交"))}
          ${renderDetailField("提交人", escapeHtml(findName(people, previousTask.submittedBy, "未记录")))}
        </div>
        <p>结果说明：${escapeHtml(resultText)}</p>
        ${renderSubmittedFormDataRows(previousTask)}
        <p>提交链接：${renderSubmittedLinks(previousTask)}</p>
        <div class="submit-file-preview">
          <p>提交文件：</p>
          ${renderAttachmentPreviewList(files, "前步任务暂无提交文件")}
        </div>
      </details>
    </div>
  `;
}

function renderPreviousTaskFilesBlock(task) {
  return renderPreviousTaskSubmissionBlock(task);
}

function renderTaskRelatedInfoSection(task, context) {
  const actionAttachments = getStandardWorkAttachments(context.customFields);

  return `
    <details class="detail-block">
      <summary><strong>关联信息</strong></summary>
      <div class="detail-grid">
        ${renderDetailField("负责人", findName(people, task.ownerId, "未设置"))}
        ${renderDetailField("负责部门", findName(departments, task.departmentId, "未设置"))}
        ${renderDetailField("所属关键行动标准流程", escapeHtml(getTaskProcessTemplateName(task)))}
        ${renderDetailField("所属标准步骤", escapeHtml(getTaskProcessStepName(task)))}
      </div>
      <div class="row-actions task-status-actions">
        ${task.processNodeId ? getMethodologyLinkByNodeId(task.processNodeId) : "<span class=\"muted-action\">暂无关联方法论</span>"}
      </div>
      <h4>关联模板</h4>
      ${renderTaskLinkedTemplateSummary(task.templateId, "detail")}
      <h4>关键行动附件</h4>
      ${renderAttachmentPreviewList(actionAttachments, "暂无关键行动附件")}
      <h4>退回记录</h4>
      ${renderReturnRecordsContent(task)}
    </details>
  `;
}

function renderVisualTemplateDownloadLink(label, file, variant = "") {
  const fileUrl = file?.fileUrl ?? file?.url ?? "";
  if (!fileUrl) return `<span class="muted-action">${escapeHtml(label)}</span>`;
  return `
    <a class="text-button ${variant}" href="${escapeAttribute(resolveAssetUrl(fileUrl))}" download="${escapeAttribute(file.fileName ?? "")}" target="_blank" rel="noreferrer">
      ${escapeHtml(label)}
    </a>
  `;
}

function renderTaskLinkedTemplateSummary(templateId, mode = "form") {
  const template = getVisualTemplateById(templateId);
  const previewImage = getVisualTemplatePreviewImage(template);
  if (template === null) {
    return `<div class="content-template-summary is-empty"><span>未关联</span></div>`;
  }
  return `
    <div class="content-template-summary ${mode === "detail" ? "is-detail" : ""}">
      <button class="content-template-thumb" type="button" data-action="preview-task-linked-template" data-template-id="${escapeAttribute(template.id)}">
        ${
          previewImage.fileUrl
            ? `<img src="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeAttribute(getVisualTemplateName(template))}" />`
            : `<span>无预览</span>`
        }
      </button>
      <div class="content-template-meta">
        <strong>${escapeHtml(getVisualTemplateName(template))}</strong>
        ${
          mode === "detail"
            ? `<div class="row-actions">
                ${renderVisualTemplateDownloadLink("下载图片", previewImage)}
                ${renderVisualTemplateDownloadLink("下载源文件", getVisualTemplateSourceFile(template))}
              </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderTaskTemplateLinkField(templateId) {
  return `
    <div class="content-template-field">
      <span>关联模板</span>
      <div class="content-template-control">
        <input type="hidden" name="templateId" value="${escapeAttribute(templateId ?? "")}" />
        ${renderTaskLinkedTemplateSummary(templateId)}
        <div class="row-actions">
          <button class="secondary-button" type="button" data-action="open-task-template-picker">更换模板</button>
          ${templateId ? `<button class="text-button danger-button" type="button" data-action="clear-task-template">取消关联</button>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderTaskLinkedTemplatePreviewModal() {
  const previewTemplate = getVisualTemplateById(modalState?.templatePreviewId ?? "");
  if (previewTemplate === null) return "";
  const previewImage = getVisualTemplatePreviewImage(previewTemplate);
  return `
    <div class="modal-backdrop content-template-preview-backdrop" role="presentation">
      <div class="modal-panel content-template-preview-modal" role="dialog" aria-modal="true" aria-label="预览模板">
        <div class="modal-header">
          <h2>${escapeHtml(getVisualTemplateName(previewTemplate))}</h2>
          <button class="icon-button" type="button" data-action="close-task-linked-template-preview" aria-label="关闭">×</button>
        </div>
        <div class="content-template-preview-body">
          ${previewImage.fileUrl ? `<img src="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeAttribute(getVisualTemplateName(previewTemplate))}" />` : `<span>无预览</span>`}
        </div>
        <div class="row-actions">
          ${renderVisualTemplateDownloadLink("下载图片", previewImage)}
          ${renderVisualTemplateDownloadLink("下载源文件", getVisualTemplateSourceFile(previewTemplate))}
        </div>
      </div>
    </div>
  `;
}

function renderTaskTemplatePicker() {
  if (modalState?.templatePickerOpen !== true) return "";
  const selectedTags = normalizeVisualTemplateTags(modalState.templateTagFilters ?? {});
  const groupedTags = getVisualTemplateFilterTags();
  const visibleTemplates = getFilteredVisualTemplates();
  const previewTemplate = getVisualTemplateById(modalState.templatePreviewId ?? "");

  return `
    <div class="modal-backdrop content-template-picker-backdrop" role="presentation">
      <div class="modal-panel extra-wide-modal" role="dialog" aria-modal="true" aria-label="选择模板">
        <div class="modal-header">
          <h2>选择模板</h2>
          <button class="icon-button" type="button" data-action="close-task-template-picker" aria-label="关闭">×</button>
        </div>
        <div class="content-template-picker">
          <div class="content-template-picker-toolbar">
            <input data-task-template-picker-search value="${escapeAttribute(modalState.templateQuery ?? "")}" autocomplete="off" />
          </div>
          <div class="content-template-picker-layout">
            <aside class="content-template-picker-filters">
              ${templateTagCategories.map((category) => `
                <div class="content-template-filter-group">
                  <h3>${escapeHtml(category.label)}</h3>
                  <div class="template-tag-cloud">
                    ${(groupedTags[category.id] ?? []).map((tag) => {
                      const active = (selectedTags[category.id] ?? []).includes(tag);
                      return `<button class="${active ? "is-active" : ""}" type="button" data-task-template-picker-tag="${escapeAttribute(tag)}" data-task-template-picker-category="${category.id}">${escapeHtml(tag)}</button>`;
                    }).join("")}
                  </div>
                </div>
              `).join("")}
            </aside>
            <div class="content-template-picker-main">
              ${visualTemplatesLoading ? `<div class="empty-detail">模板加载中</div>` : ""}
              ${
                !visualTemplatesLoading && visibleTemplates.length === 0
                  ? `<div class="empty-detail">暂无模板</div>`
                  : `<div class="content-template-picker-grid">
                      ${visibleTemplates.map((template) => {
                        const previewImage = getVisualTemplatePreviewImage(template);
                        return `
                          <article class="content-template-option ${modalState.templateId === template.id ? "is-selected" : ""}">
                            <button class="content-template-option-thumb" type="button" data-action="preview-task-template-option" data-template-id="${escapeAttribute(template.id)}">
                              ${previewImage.fileUrl ? `<img src="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeAttribute(getVisualTemplateName(template))}" />` : `<span>无预览</span>`}
                            </button>
                            <h3>${escapeHtml(getVisualTemplateName(template))}</h3>
                            <button class="primary-button" type="button" data-action="select-task-template-option" data-template-id="${escapeAttribute(template.id)}">选择</button>
                          </article>
                        `;
                      }).join("")}
                    </div>`
              }
            </div>
          </div>
        </div>
      </div>
      ${
        previewTemplate === null
          ? ""
          : `<div class="modal-panel content-template-preview-modal" role="dialog" aria-modal="true" aria-label="预览模板">
              <div class="modal-header">
                <h2>${escapeHtml(getVisualTemplateName(previewTemplate))}</h2>
                <button class="icon-button" type="button" data-action="close-task-template-preview" aria-label="关闭">×</button>
              </div>
              <div class="content-template-preview-body">
                ${getVisualTemplatePreviewImage(previewTemplate).fileUrl ? `<img src="${escapeAttribute(resolveAssetUrl(getVisualTemplatePreviewImage(previewTemplate).fileUrl))}" alt="${escapeAttribute(getVisualTemplateName(previewTemplate))}" />` : `<span>无预览</span>`}
              </div>
            </div>`
      }
    </div>
  `;
}

function renderExecutionGroupTaskList(tasks) {
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>任务</th><th>负责人</th><th>执行人</th><th>状态</th><th>规定时长</th></tr>
        </thead>
        <tbody>
          ${tasks.map((task) => `
            <tr>
              <td>${escapeHtml(task.name)}</td>
              <td>${findName(people, task.ownerId, "未设置")}</td>
              <td>${findName(people, getTaskExecutorId(task), "未设置")}</td>
              <td>${getTaskBusinessStatus(task).label}</td>
              <td>${getTaskStandardDurationMinutes(task)} 分钟</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderExecutionGroupCreateModal() {
  if (modalState?.kind !== "executionGroupCreate") return "";
  const tasks = modalState.taskIds.map(getTask).filter(Boolean);
  const standardTotalMinutes = tasks.reduce((total, task) => total + getTaskStandardDurationMinutes(task), 0);
  const firstTask = tasks[0] ?? null;
  const belonging = firstTask === null ? null : getTaskBelonging(firstTask);
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <div>
          <h2>创建执行组</h2>
          <p class="form-note">执行组代表一次真实共同执行过程，成员任务仍然独立存在。</p>
        </div>
        <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
      </div>
      ${modalState.error ? `<div class="form-error">${escapeHtml(modalState.error)}</div>` : ""}
      <label>
        <span>执行组名称</span>
        <input name="executionGroupName" value="${escapeHtml(modalState.name ?? buildExecutionGroupName(tasks))}" autocomplete="off" />
      </label>
      <div class="detail-grid">
        ${renderDetailField("关键行动", escapeHtml(belonging?.standardWorkName ?? "-"))}
        ${renderDetailField("负责人", escapeHtml(findName(people, firstTask?.ownerId, "-")))}
        ${renderDetailField("执行人", escapeHtml(findName(people, firstTask === null ? "" : getTaskExecutorId(firstTask), "-")))}
        ${renderDetailField("成员任务数量", `${tasks.length}`)}
        ${renderDetailField("标准总时长", `${standardTotalMinutes} 分钟`)}
      </div>
      ${renderExecutionGroupTaskList(tasks)}
      <div class="modal-actions">
        <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
        <button class="primary-button" type="button" data-action="confirm-create-execution-group">确认创建</button>
      </div>
    </div></div>
  `;
}

function getExecutionGroupStatusText(status) {
  return {
    created: "已创建",
    doing: "执行中",
    done: "已完成",
    canceled: "已取消",
  }[status] ?? status ?? "-";
}

function renderExecutionGroupDetailModal() {
  if (modalState?.kind !== "executionGroupDetail") return "";
  const group = getExecutionGroupById(modalState.groupId);
  if (group === null) return "";
  const tasks = getExecutionGroupTasks(group);
  const actualMinutes = group.actualTotalMinutes ?? (group.status === "doing" ? getExecutionGroupActualMinutes(group) : null);
  const savedMinutes = actualMinutes === null ? group.savedMinutes : (Number(group.standardTotalMinutes) || 0) - actualMinutes;
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <div>
          <h2>${escapeHtml(group.name)}</h2>
          <p class="form-note">状态：${escapeHtml(getExecutionGroupStatusText(group.status))}</p>
        </div>
        <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
      </div>
      ${modalState.error ? `<div class="form-error">${escapeHtml(modalState.error)}</div>` : ""}
      <div class="detail-grid">
        ${renderDetailField("关键行动", escapeHtml(getTaskTemplate(group.taskTemplateId ?? group.standardWorkId)?.name ?? "-"))}
        ${renderDetailField("负责人", escapeHtml(findName(people, group.ownerId, "-")))}
        ${renderDetailField("执行人", escapeHtml(findName(people, group.executorId, "-")))}
        ${renderDetailField("标准总时长", `${group.standardTotalMinutes ?? 0} 分钟`)}
        ${renderDetailField("开始时间", escapeHtml(formatBusinessMinuteDateTime(group.startedAt, "未开始")))}
        ${renderDetailField("结束时间", escapeHtml(formatBusinessMinuteDateTime(group.endedAt, "未完成")))}
        ${renderDetailField("实际总时长", actualMinutes === null ? "未记录" : `${actualMinutes} 分钟`)}
        ${renderDetailField("节约时间", savedMinutes === null || savedMinutes === undefined ? "未记录" : `${savedMinutes} 分钟`)}
      </div>
      <h3>包含任务</h3>
      ${renderExecutionGroupTaskList(tasks)}
      <div class="modal-actions">
        <button class="secondary-button" type="button" data-action="close-task-modal">关闭</button>
        ${group.status === "created" ? `<button class="secondary-button" type="button" data-action="cancel-execution-group" data-execution-group-id="${escapeHtml(group.id)}">取消执行组</button>` : ""}
        ${group.status === "created" ? `<button class="primary-button" type="button" data-action="start-execution-group" data-execution-group-id="${escapeHtml(group.id)}">开始执行</button>` : ""}
        ${group.status === "doing" ? `<button class="secondary-button" type="button" data-action="cancel-execution-group" data-execution-group-id="${escapeHtml(group.id)}">取消执行组</button>` : ""}
        ${group.status === "doing" ? `<button class="primary-button" type="button" data-action="complete-execution-group" data-execution-group-id="${escapeHtml(group.id)}">完成执行组</button>` : ""}
      </div>
    </div></div>
  `;
}

function renderTaskDetail() {
  const selectedTaskCandidate = getTask(selectedTaskId);
  const selectedTask =
    selectedTaskCandidate !== null && isTaskVisibleInExecutionStage(selectedTaskCandidate)
      ? selectedTaskCandidate
      : getFilteredTasks()[0] ?? null;

  if (selectedTask === null) {
    return `
      <section class="settings-section task-detail">
        <div class="section-heading">
          <h2>任务详情</h2>
        </div>
        <div class="empty-detail">暂无匹配任务</div>
      </section>
    `;
  }

  const actionContext = getTaskActionContext(selectedTask);

  return `
    <section class="settings-section task-detail">
      <div class="section-heading with-actions task-action-heading">
        <div>
          <h2>任务详情</h2>
          <p class="form-note">${escapeHtml(selectedTask.name)}</p>
        </div>
        <div class="section-actions">
          ${canEditTask(selectedTask) ? renderActionButton("编辑", "edit-task", selectedTask.id) : ""}
          ${canCancelTask(selectedTask) ? renderActionButton("取消", "cancel-task", selectedTask.id, "danger-button") : ""}
          ${canRestoreTask(selectedTask) ? renderActionButton("恢复为待处理", "restore-task", selectedTask.id) : ""}
        </div>
      </div>
      ${renderActionSummary(selectedTask, actionContext)}
      ${renderCurrentTaskSection(selectedTask)}
      ${renderPreviousTaskFilesBlock(selectedTask)}
      ${renderTaskSubmitResultDetail(selectedTask)}
      ${renderTaskRelatedInfoSection(selectedTask, actionContext)}
    </section>
  `;
}

function renderLaunchedProcessDetailModal() {
  if (modalState === null || modalState.kind !== "launchedProcessDetail") return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal task-detail-modal" role="dialog" aria-modal="true" aria-label="关键行动详情">
        <div class="modal-header">
          <h2>关键行动详情</h2>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        ${renderLaunchedProcessDetail(modalState.instanceId)}
      </div>
    </div>
  `;
}

function renderTaskDetailModal() {
  if (modalState === null || modalState.kind !== "taskDetail") return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal task-detail-modal" role="dialog" aria-modal="true" aria-label="任务详情">
        <div class="modal-header">
          <h2>任务详情</h2>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
        ${renderTaskDetail()}
        ${renderTaskLinkedTemplatePreviewModal()}
      </div>
    </div>
  `;
}

function getWorkFormModalData() {
  if (modalState === null || modalState.kind !== "workForm") return null;
  const task = modalState.taskId === undefined ? null : getTask(modalState.taskId);
  const instanceId = modalState.instanceId ?? task?.processInstanceId ?? null;
  const instance = instanceId === null ? null : state.processInstances.find((item) => item.id === instanceId) ?? null;
  const taskTemplate = instance === null ? getTaskTemplateForTask(task) : getTaskTemplate(instance.taskTemplateId ?? instance.standardWorkId ?? "");
  const customFields = task === null ? instance?.customFields ?? {} : getTaskCustomFields(task);

  return {
    task,
    instance,
    taskTemplate,
    customFields,
  };
}

function renderWorkFormModal() {
  if (modalState === null || modalState.kind !== "workForm") return "";
  const data = getWorkFormModalData();
  if (data === null) return "";
  const { task, instance, taskTemplate, customFields } = data;

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="关键行动公共信息">
        <div class="modal-header">
          <div>
            <h2>关键行动公共信息</h2>
            <p class="form-note">
              ${escapeHtml(taskTemplate?.name ?? "未关联关键行动")}
              ${instance === null ? "" : `｜${escapeHtml(instance.displayTitle ?? instance.name)}`}
              ${instance?.goalId ? `｜${escapeHtml(findName(goals, instance.goalId, "未设置目标"))}` : ""}
            </p>
          </div>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        <div class="detail-block">
          ${renderWorkFormViewer({
            formFields: getSortedFormFields(taskTemplate),
            customFields,
          })}
        </div>
        <p class="form-note">该信息在发起关键行动时填写，同一关键行动下所有任务共享。</p>
        ${
          task !== null
            ? `<p class="form-note">当前任务：${escapeHtml(task.name)}</p>`
            : ""
        }
        ${task === null ? "" : renderPreviousTaskSubmissionBlock(task)}
      </div>
    </div>
  `;
}

function renderCancelProcessModal() {
  if (modalState === null || modalState.kind !== "cancelProcess") return "";
  const instance = state.processInstances.find((item) => item.id === modalState.instanceId) ?? null;
  if (instance === null) return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="取消关键行动">
        <div class="modal-header">
          <div>
            <h2>取消关键行动</h2>
            <p class="form-note">${escapeHtml(getProcessDisplayTitle(instance))}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        <form class="modal-form cancel-process-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error)}</div>
          <p>确定要取消这个关键行动吗？</p>
          <p class="form-note">取消后，该关键行动下所有未完成的任务都会一并取消；已完成任务会保留完成状态。</p>
          <label>
            <span>取消原因</span>
            <textarea name="cancelReason" rows="4" placeholder="可填写：需求取消、产品取消、目标调整、信息填写错误、重复发起或其他原因">${escapeHtml(modalState.cancelReason ?? "")}</textarea>
          </label>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">返回</button>
            <button class="primary-button danger-button" type="submit">确认取消</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderReturnTaskModal() {
  if (modalState === null || modalState.kind !== "returnTask") return "";
  const task = getTask(modalState.taskId);
  if (task === null) return "";
  const returnableTasks = getReturnableProcessTasks(task);

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="退回重做">
        <div class="modal-header">
          <div>
            <h2>退回重做</h2>
            <p class="form-note">请选择要退回的历史节点，并填写退回原因。</p>
          </div>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        <form class="modal-form return-task-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error)}</div>
          <div class="detail-grid">
            ${renderDetailField("当前节点", escapeHtml(task.name))}
          </div>
          <label>
            <span>退回到哪个节点</span>
            <select name="returnTargetTaskId" required>
              <option value="">请选择历史节点</option>
              ${returnableTasks
                .map((targetTask, index) => {
                  const selected = modalState.returnTargetTaskId === targetTask.id ? "selected" : "";
                  return `<option value="${targetTask.id}" ${selected}>${formatProcessStepLabel(index + 1)}：${escapeHtml(targetTask.name)}</option>`;
                })
                .join("")}
            </select>
          </label>
          <label>
            <span>退回原因</span>
            <textarea name="returnReason" rows="4" placeholder="请填写为什么需要该节点重新处理">${escapeHtml(modalState.returnReason ?? "")}</textarea>
          </label>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button danger-button" type="submit">确认退回</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function getEditingTask() {
  return modalState?.taskId === undefined ? null : getTask(modalState.taskId);
}

function renderTemplateLockedInfo(template) {
  if (template === null) {
    return `<p class="form-note">请选择关键行动后查看自动带出的锁定信息。</p>`;
  }

  return `
    <div class="locked-template-info">
      ${renderDetailField("关键行动名称", escapeHtml(template.name))}
      ${renderDetailField("价值链模块", getStandardWorkValueChain(template))}
      ${renderDetailField("对应关键行动标准流程", getProcessTemplateName(template.defaultProcessTemplateId))}
      ${renderDetailField("负责部门", findName(departments, template.departmentId, "未设置"))}
      ${renderDetailField("负责人", findName(people, template.ownerId, "未设置"))}
      ${renderDetailField("需要验收", template.needAcceptance ? "是" : "否")}
      ${renderDetailField("验收人", findName(people, template.accepterId, "无"))}
      ${renderDetailField("标准任务说明", escapeHtml(template.description))}
      ${renderDetailField("标准完成要求", escapeHtml(template.completionStandard))}
    </div>
  `;
}

function renderTaskModal() {
  if (modalState === null || modalState.kind !== "task") return "";

  const task = getEditingTask();
  const isEdit = modalState.mode === "edit";
  const isProcessTask = task?.source === TaskSource.Process;
  const draft = modalState.draft ?? {};
  const effectiveTask = isEdit && task !== null
    ? { ...task, ...draft, customFields: draft.customFields ?? task.customFields }
    : task;
  const selectedVisualTemplateId = modalState.templateId ?? draft.templateId ?? task?.templateId ?? "";
  const selectedCategoryId = modalState.categoryId ?? "";
  const availableTemplates = getActiveTaskTemplatesByCategory(selectedCategoryId);
  const selectedTemplate = availableTemplates.find((template) => template.id === modalState.taskTemplateId) ?? null;
  const editTemplate = task === null ? null : getTaskTemplateForTask(task);
  const templateHint =
    selectedCategoryId === ""
      ? "请先选择价值链模块"
      : availableTemplates.length === 0
        ? "该价值链模块暂无关键行动"
        : "请选择关键行动";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "编辑任务" : "发起关键行动"}">
        <div class="modal-header">
          <h2>${isEdit ? "编辑任务" : "发起关键行动"}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
            <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form task-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          ${
            isEdit
              ? `
                ${isProcessTask ? "<p class=\"form-note\">标准步骤生成的任务，其步骤完成标准来自关键行动标准流程；本次负责人和执行人可以按实际人员调整。</p>" : "<p class=\"form-note\">任务来自关键行动库，任务名称、负责部门和标准完成要求已锁定；本次负责人和执行人可以调整。</p>"}
                <div class="detail-grid">
                  ${renderDetailField("任务名称", escapeHtml(task?.name ?? ""))}
                  ${renderDetailField("关联目标", findName(goals, task?.goalId ?? null, "未设置"))}
                  ${renderDetailField("价值链模块", getStandardWorkValueChain(editTemplate))}
                  ${renderDetailField("负责部门", findName(departments, task?.departmentId ?? null, "未设置"))}
                  ${renderDetailField("负责人", findName(people, task?.ownerId ?? null, "未设置"))}
                  ${renderDetailField(isProcessTask ? "步骤完成标准" : "标准完成要求", escapeHtml(task?.completionStandard ?? ""))}
                </div>
                ${renderTaskTemplateLinkField(selectedVisualTemplateId)}
                <div class="form-grid">
                  <label>
                    <span>负责人</span>
                    <select name="ownerId">${renderOptions(people, effectiveTask?.ownerId ?? "", "请选择负责人")}</select>
                  </label>
                  <label>
                    <span>执行人</span>
                    <select name="executorId">${renderOptions(people, getTaskExecutorId(effectiveTask), "请选择执行人")}</select>
                  </label>
                </div>
              `
              : `
                <div class="form-grid">
                  <label>
                    <span>关联目标</span>
                    <select name="goalId">${renderOptions(getActiveGoals(), "", "请选择目标")}</select>
                  </label>
                  <label>
                    <span>选择价值链模块</span>
                    <select name="categoryId" data-task-value-module-select>
                      ${renderOptions(getTaskCategories(), selectedCategoryId, "请选择价值链模块")}
                    </select>
                  </label>
                  <label>
                    <span>选择关键行动</span>
                    <select name="taskTemplateId" data-task-template-select ${selectedCategoryId === "" ? "disabled" : ""}>
                      ${renderOptions(availableTemplates, modalState.taskTemplateId ?? "", templateHint)}
                    </select>
                  </label>
                </div>
                ${renderTemplateLockedInfo(selectedTemplate)}
                ${renderCustomFieldsForm(selectedTemplate)}
                ${renderStandardWorkAttachmentsField()}
              `
          }
          <div class="form-grid">
            <label>
              <span>计划开始日期</span>
              <input name="startDate" type="date" value="${effectiveTask?.startDate ?? ""}" />
            </label>
            <label>
              <span>截止时间</span>
              <input name="dueDateDate" type="date" value="${escapeHtml(getBusinessDatePart(effectiveTask?.dueDate))}" />
              <select name="dueDateTime">${renderBusinessMinuteOptions(getBusinessMinutePart(effectiveTask?.dueDate), "请选择时间")}</select>
            </label>
            <label>
              <span>计划周</span>
              <input name="plannedWeek" value="${effectiveTask?.plannedWeek ?? ""}" placeholder="例如 2026-W27" autocomplete="off" />
            </label>
          </div>
          <label>
            <span>${isEdit ? "补充说明 / 任务说明" : "补充说明"}</span>
            <textarea name="${isEdit ? "description" : "remark"}" rows="3">${escapeHtml(effectiveTask?.description ?? "")}</textarea>
          </label>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="submit">保存</button>
          </div>
        </form>
        ${renderTaskTemplatePicker()}
      </div>
    </div>
  `;
}

function renderResultModal() {
  if (modalState === null || modalState.kind !== "result") return "";

  const task = getTask(modalState.taskId);
  const title =
    modalState.action === "submit-done"
      ? "提交完成"
      : modalState.action === "submit-acceptance"
        ? "提交验收"
        : "提交结果";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal-header">
          <h2>${title}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
            <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form result-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <p class="form-note">${escapeHtml(task?.name ?? "")}</p>
          <label>
            <span>完成结果说明</span>
            <textarea name="resultText" rows="4">${escapeHtml(task?.resultText ?? "")}</textarea>
          </label>
          ${task === null ? "" : renderSubmitResultForm(task)}
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="submit">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function updateFilters(form) {
  const formData = new FormData(form);

  filters = {
    keyword: formData.get("keyword")?.toString().trim() ?? "",
    status: formData.get("status")?.toString() ?? "",
    source: formData.get("source")?.toString() ?? "",
    departmentId: formData.get("departmentId")?.toString() ?? "",
    ownerId: formData.get("ownerId")?.toString() ?? "",
    executorId: formData.get("executorId")?.toString() ?? "",
    goalId: formData.get("goalId")?.toString() ?? "",
    categoryId: formData.get("categoryId")?.toString() ?? "",
    overdue: formData.get("overdue")?.toString() ?? "",
    showDone: formData.has("showDone"),
    showCanceled: formData.has("showCanceled"),
  };
}

function updateProcessProgressFilters(form) {
  const formData = new FormData(form);

  processProgressFilters = {
    keyword: formData.get("keyword")?.toString().trim() ?? "",
    goalId: formData.get("goalId")?.toString() ?? "",
    templateId: formData.get("templateId")?.toString() ?? "",
    status: formData.get("status")?.toString() ?? "",
    ownerId: formData.get("ownerId")?.toString() ?? "",
    overdue: formData.get("overdue")?.toString() ?? "",
    initiatorId: formData.get("initiatorId")?.toString() ?? "",
    showDone: formData.has("showDone"),
    showCanceled: formData.has("showCanceled"),
    showStockClearance: formData.has("showStockClearance"),
  };
}

function updateClearanceFilters(form) {
  const formData = new FormData(form);

  clearanceFilters = {
    keyword: formData.get("keyword")?.toString().trim() ?? "",
    status: formData.get("status")?.toString() ?? "",
    ownerId: formData.get("ownerId")?.toString() ?? "",
    channel: formData.get("channel")?.toString() ?? "",
    warehouse: formData.get("warehouse")?.toString() ?? "",
    showDone: formData.has("showDone"),
    showCanceled: formData.has("showCanceled"),
  };
}

function buildTaskDraft(form, task) {
  const dueDateResult = collectBusinessMinuteDateTime(form, "dueDate");
  if (task === null) {
    const selectedCategoryId = getFormValue(form, "categoryId");
    let taskTemplateId = getFormValue(form, "taskTemplateId");
    let template = getTaskTemplate(taskTemplateId);
    if (template === null) {
      template = getActiveTaskTemplatesByCategory(selectedCategoryId)[0] ?? getActiveTaskTemplates()[0] ?? null;
      taskTemplateId = template?.id ?? "";
    }
    const remark = getFormValue(form, "remark");
    const valueModuleId = inferValueModuleIdForTemplate(template);
    const customFields = withValueModuleCustomFields(template === null ? {} : collectCustomFields(form, template), valueModuleId);

    return {
      taskTemplateId,
      template,
      customFields,
      valueModuleId,
      valueModuleName: getValueModuleName(valueModuleId),
      goalId: getFormValue(form, "goalId") || getActiveGoals()[0]?.id || "",
      initiatorId: getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "",
      startDate: getFormValue(form, "startDate") || null,
      dueDate: dueDateResult.value,
      dueDateError: dueDateResult.error,
      plannedWeek: getFormValue(form, "plannedWeek") || null,
      remark,
    };
  }
  return {
    ...task,
    customFields: task.customFields && typeof task.customFields === "object" ? task.customFields : {},
    templateId: getFormValue(form, "templateId") || modalState?.templateId || task.templateId || "",
    ownerId: getFormValue(form, "ownerId") || task.ownerId,
    executorId: getFormValue(form, "executorId") || task.executorId || "",
    description: getFormValue(form, "description"),
    startDate: getFormValue(form, "startDate") || null,
    dueDate: dueDateResult.value,
    dueDateError: dueDateResult.error,
    plannedWeek: getFormValue(form, "plannedWeek") || null,
  };
}

function validateTaskDraft(draft, isAdd) {
  if (isAdd) {
    if (!isValueModuleId(draft.valueModuleId)) return "必须选择价值链模块。";
    if (draft.taskTemplateId === "" || draft.template === null) return "必须选择启用的关键行动。";
    if (draft.template.status !== TaskTemplateStatus.Active) return "停用的关键行动不能用于发起关键行动。";
    if (!draft.template.defaultProcessTemplateId) return "该关键行动尚未绑定关键行动标准流程，请先到关键行动库中配置。";
    const processTemplate = getProcessTemplateById(draft.template.defaultProcessTemplateId);
    if (processTemplate === null || processTemplate.status !== ProcessTemplateStatus.Active) return "该关键行动绑定的关键行动标准流程未启用。";
    const customError = validateCustomFields(draft.customFields, draft.template);
    if (customError !== "") return customError;
  }


  if (draft.dueDateError !== "") return draft.dueDateError;
  if (draft.startDate !== null && draft.dueDate !== null && draft.startDate > draft.dueDate) {
    return "计划开始时间不能晚于截止时间。";
  }
  if (draft.plannedWeek !== null && !plannedWeekPattern.test(draft.plannedWeek)) {
    return "计划周格式应为 YYYY-WW，例如 2026-W27。";
  }

  return "";
}

function setModalError(error) {
  modalState = { ...modalState, error };
  const errorElement = document.querySelector(".modal-form .form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
  }
}

async function uploadSelectedStandardWorkAttachments(form) {
  const input = form.elements.standardWorkAttachments;
  const files = input?.files === undefined ? [] : Array.from(input.files);
  const validationError = validateStandardWorkAttachmentFiles(files);
  if (validationError !== "") throw new Error(validationError);

  const uploaded = [];
  for (const file of files) {
    uploaded.push(await uploadStandardWorkAttachment(file));
  }
  return uploaded;
}

async function saveTask(form, rerender) {
  const task = getEditingTask();
  const draft = buildTaskDraft(form, task);
  const isAdd = modalState.mode === "add";
  const error = validateTaskDraft(draft, isAdd);

  if (error !== "") return setModalError(error, rerender);

  if (isAdd) {
    let uploadedAttachments = [];
    try {
      uploadedAttachments = await uploadSelectedStandardWorkAttachments(form);
    } catch (error) {
      return setModalError(error.message ?? "表格附件上传失败。", rerender);
    }

    const displayTitle = buildDisplayTitle(draft.template, draft.customFields);
    const coverImageUrl = getPrimaryImageUrl({ customFields: draft.customFields }) || null;
    const description = draft.remark === ""
      ? draft.template.description
      : `${draft.template.description}\n补充说明：${draft.remark}`;
    const now = getNow();
    const workPlanId = createId("work-plan");
    const customFields =
      uploadedAttachments.length === 0
        ? draft.customFields
        : {
            ...draft.customFields,
            [standardWorkAttachmentsKey]: uploadedAttachments.map((attachment) => ({
              originalName: attachment.originalName,
              filePath: attachment.filePath ?? attachment.url,
              url: attachment.url,
              mimeType: attachment.mimeType,
              ext: attachment.ext ?? getFileExt(attachment.originalName ?? attachment.filename ?? ""),
              uploadedAt: attachment.uploadedAt ?? now,
              standardWorkId: draft.template.id,
              workPlanId,
              processInstanceId: null,
              taskIds: [],
            })),
          };
    const workPlan = {
      id: workPlanId,
      goalId: draft.goalId,
      departmentId: draft.template.departmentId ?? null,
      taskTemplateId: draft.template.id,
      title: displayTitle,
      customFields,
      coverImageUrl,
      status: WorkPlanStatus.ThisWeek,
      plannedWeek: draft.plannedWeek ?? getCurrentWeek(),
      dueDate: draft.dueDate,
      description,
      processInstanceId: null,
      createdAt: now,
      updatedAt: now,
      launchedAt: null,
      canceledAt: null,
    };

    try {
      const currentUserId = getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "";
      if (currentUserId === "") return setModalError("无法确认当前发起人，请重新登录后再试。", rerender);
      const result = await launchWorkPlanDraftAsProcess(workPlan, {
        dueDate: workPlan.dueDate,
        initiatorId: currentUserId,
        launchAssignments: buildLaunchAssignments(draft.template.defaultProcessTemplateId, draft.template, currentUserId),
      });
      selectedProcessInstanceId = result.instance.id;
      selectedTaskId = state.tasks.find((item) => item.processInstanceId === result.instance.id)?.id ?? selectedTaskId;
    } catch (error) {
      console.error("发起关键行动保存失败", error);
      return setModalError(error.message || "发起关键行动保存失败，请检查本地数据库服务。", rerender);
    }

    activeTaskTab = "process-progress";
  } else {
    const now = getNow();
    const updatedTask = {
      ...task,
      customFields: task.customFields && typeof task.customFields === "object" ? task.customFields : {},
      displayTitle: task.displayTitle ?? null,
      coverImageUrl: task.coverImageUrl ?? null,
      templateId: draft.templateId ?? task.templateId ?? "",
      ownerId: draft.ownerId,
      executorId: draft.executorId,
      description: draft.description,
      startDate: draft.startDate,
      dueDate: draft.dueDate,
      plannedWeek: draft.plannedWeek,
      updatedAt: now,
    };
    try {
      await updatePersistentResource("tasks", updatedTask.id, updatedTask);
    } catch (error) {
      console.error("任务保存失败", error);
      return setModalError(error.message || "任务保存失败，请检查本地数据库服务。", rerender);
    }
    state.tasks = state.tasks.map((item) => (item.id === updatedTask.id ? updatedTask : item));
  }

  modalState = null;
  rerender();
}

function readCurrentTaskModalDraft() {
  const form = document.querySelector(".task-form");
  if (form === null || modalState?.kind !== "task") return modalState?.draft ?? {};
  const task = getEditingTask();
  if (task === null) return modalState.draft ?? {};
  return buildTaskDraft(form, task);
}

async function ensureVisualTemplatesLoaded(rerender) {
  if (visualTemplatesLoaded || visualTemplatesLoading) return;
  visualTemplatesLoading = true;
  try {
    await loadTemplates();
    visualTemplatesLoaded = true;
  } catch (error) {
    console.error("模板列表读取失败", error);
    modalState = { ...modalState, error: error.message || "模板列表读取失败，请检查本地数据库服务。" };
  } finally {
    visualTemplatesLoading = false;
    rerender();
  }
}

async function handleTaskTemplateLinkAction(action, actionButton, rerender) {
  if (action === "open-task-template-picker") {
    if (modalState?.kind !== "task") return true;
    const draft = readCurrentTaskModalDraft();
    modalState = {
      ...modalState,
      draft,
      templateId: draft.templateId ?? modalState.templateId ?? "",
      templatePickerOpen: true,
      templateQuery: modalState.templateQuery ?? "",
      templateTagFilters: modalState.templateTagFilters ?? createEmptyTemplateTags(),
      templatePreviewId: "",
    };
    rerender();
    await ensureVisualTemplatesLoaded(rerender);
    return true;
  }
  if (action === "close-task-template-picker") {
    modalState = {
      ...modalState,
      draft: readCurrentTaskModalDraft(),
      templatePickerOpen: false,
      templatePreviewId: "",
    };
    rerender();
    return true;
  }
  if (action === "clear-task-template") {
    modalState = { ...modalState, draft: { ...readCurrentTaskModalDraft(), templateId: "" }, templateId: "" };
    rerender();
    return true;
  }
  if (action === "select-task-template-option") {
    const templateId = actionButton.dataset.templateId ?? "";
    modalState = {
      ...modalState,
      draft: { ...readCurrentTaskModalDraft(), templateId },
      templateId,
      templatePickerOpen: false,
      templatePreviewId: "",
    };
    rerender();
    return true;
  }
  if (action === "preview-task-template-option") {
    modalState = {
      ...modalState,
      draft: modalState?.kind === "task" ? readCurrentTaskModalDraft() : modalState?.draft,
      templatePreviewId: actionButton.dataset.templateId ?? "",
    };
    rerender();
    return true;
  }
  if (action === "close-task-template-preview") {
    modalState = {
      ...modalState,
      draft: modalState?.kind === "task" ? readCurrentTaskModalDraft() : modalState?.draft,
      templatePreviewId: "",
    };
    rerender();
    return true;
  }
  if (action === "preview-task-linked-template") {
    modalState = { ...modalState, templatePreviewId: actionButton.dataset.templateId ?? "" };
    rerender();
    return true;
  }
  if (action === "close-task-linked-template-preview") {
    modalState = { ...modalState, templatePreviewId: "" };
    rerender();
    return true;
  }
  return false;
}

function handleTaskTemplatePickerTagClick(templateTagButton, rerender) {
  if (templateTagButton === null || modalState?.kind !== "task") return false;
  const categoryId = templateTagButton.dataset.taskTemplatePickerCategory;
  const tag = templateTagButton.dataset.taskTemplatePickerTag;
  const currentFilters = normalizeVisualTemplateTags(modalState.templateTagFilters ?? {});
  const currentTags = currentFilters[categoryId] ?? [];
  const nextTags = currentTags.includes(tag)
    ? currentTags.filter((item) => item !== tag)
    : [...currentTags, tag];
  modalState = {
    ...modalState,
    draft: readCurrentTaskModalDraft(),
    templateTagFilters: { ...currentFilters, [categoryId]: nextTags },
  };
  rerender();
  return true;
}

function handleTaskTemplatePickerSearchInput(searchInput, rerender) {
  if (searchInput === null || modalState?.kind !== "task") return false;
  modalState = {
    ...modalState,
    draft: readCurrentTaskModalDraft(),
    templateQuery: searchInput.value,
  };
  rerender();
  return true;
}

function parseAttachments(value) {
  if (value.trim() === "") return [];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectSubmitFormData(form, task) {
  const formData = {};
  for (const field of getSubmitFields(task)) {
    const inputName = `submit__${field.key}`;
    if (field.type === "multi_select") {
      formData[field.key] = new FormData(form).getAll(inputName).map(String);
    } else if (field.type === "datetime_hour") {
      const result = collectBusinessDateTime(form, inputName, field.label);
      formData[field.key] = result.value ?? "";
    } else {
      formData[field.key] = getFormValue(form, inputName);
    }
  }
  return formData;
}

async function uploadSelectedSubmitFiles(form) {
  const input = form.elements.submitFiles;
  const files = input?.files === undefined ? [] : Array.from(input.files);
  const uploaded = [];
  for (const file of files) {
    uploaded.push(await uploadGenericFile(file));
  }
  return uploaded;
}

function parseSubmitLinks(value) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function saveResult(form, rerender) {
  if (!canCurrentUser("tasks.submitResult")) return setModalError("你没有权限提交任务结果。", rerender);
  const task = getTask(modalState.taskId);
  if (task === null) return;
  const resultText = getFormValue(form, "resultText");

  const submitFormData = collectSubmitFormData(form, task);
  let uploadedFiles = [];
  try {
    uploadedFiles = await uploadSelectedSubmitFiles(form);
  } catch (error) {
    return setModalError(error.message ?? "文件上传失败。", rerender);
  }
  const currentRequirement = getTaskSubmitRequirement(task);
  const submitFiles = [...getVisibleSubmitFiles(currentRequirement.submitFiles), ...uploadedFiles];
  const submitLinks = parseSubmitLinks(getFormValue(form, "submitLinks"));
  const submitError = validateSubmittedResult(task, { submitFormData, submitFiles, submitLinks }, {
    allowBlockedVerification: modalState.action === "submit-result",
  });
  if (submitError !== "") return setModalError(submitError, rerender);

  const now = getNow();
  const nextStatus =
    modalState.action === "submit-done"
      ? TaskStatus.Done
      : modalState.action === "submit-acceptance"
        ? TaskStatus.PendingAcceptance
        : task.status;
  const completedAt =
    modalState.action === "submit-done"
      ? now
      : modalState.action === "submit-result"
        ? task.completedAt ?? null
        : null;
  const resultAttachments = submitFiles;
  const nextCustomFields = task.customFields && typeof task.customFields === "object" ? { ...task.customFields } : {};
  if (isRectificationStandardOptimizationTask(task)) {
    nextCustomFields.standardOptimizationApplied = submitFormData.needStandardUpdate === "需要" ? "是" : "否";
    nextCustomFields.standardOptimizationScope = submitFormData.standardUpdateScope ?? [];
    nextCustomFields.standardOptimizationNote = submitFormData.standardUpdateNote ?? "";
    nextCustomFields.standardOptimizationAt = now;
    nextCustomFields.standardOptimizationOperatorId = getCurrentUser()?.personId ?? getCurrentUser()?.id ?? task.ownerId ?? "";
  }

  const updatedTask = markTaskOverdueRecordIfNeeded({
    ...task,
    resultText,
    resultAttachments,
    submitFormData,
    submitFiles,
    submitLinks,
    customFields: nextCustomFields,
    submittedAt: now,
    submittedBy: task.ownerId,
    status: nextStatus,
    completedAt,
    updatedAt: now,
  }, completedAt ?? now);
  try {
    await updatePersistentResource("tasks", updatedTask.id, updatedTask);
  } catch (error) {
    console.error("任务结果保存失败", error);
    return setModalError(error.message || "任务结果保存失败，请检查本地数据库服务。", rerender);
  }
  state.tasks = state.tasks.map((item) => (item.id === updatedTask.id ? updatedTask : item));
  await triggerOverdueRectificationIfNeeded(task, updatedTask);
  if (nextStatus === TaskStatus.Done) {
    try {
      await advanceProcessAfterTaskDone(modalState.taskId);
    } catch (error) {
      console.error("关键行动推进保存失败", error);
      return setModalError(error.message || "关键行动推进保存失败，请检查本地数据库服务。", rerender);
    }
  }
  modalState = null;
  rerender();
}

async function updateTaskStatus(taskId, status, rerender) {
  if (!canCurrentUser("tasks.changeStatus")) return;
  let task = getTask(taskId);

  if (task === null) return;

  if (task.source === TaskSource.Process && task.status === TaskStatus.Waiting && status !== TaskStatus.Canceled) {
    try {
      await ensureTaskReadyForExecution(taskId);
      task = getTask(taskId);
    } catch (error) {
      console.error("标准任务激活失败", error);
      window.alert(error.message || "标准任务激活失败，请检查本地数据库服务。");
      rerender();
      return;
    }
    if (task === null) return;
  }

  if (task.status === status) {
    rerender();
    return;
  }

  if (isDoneStatus(task.status) && !window.confirm("该任务已完成，确定要修改它的状态吗？修改后可能影响关键行动记录。")) {
    rerender();
    return;
  }

  if (isCanceledStatus(task.status)) {
    const instance = getTaskProcessInstance(task);
    const message =
      instance !== null && isCanceledStatus(instance.status) && status !== TaskStatus.Canceled
        ? "所属关键行动已取消，建议重新发起关键行动。是否仍要仅修改该任务状态？"
        : "该任务已取消，确定要修改它的状态吗？";
    if (!window.confirm(message)) {
      rerender();
      return;
    }
  }

  const statusError = getTaskStatusChangeError(task, status);
  if (statusError !== "") {
    window.alert(statusError);
    rerender();
    return;
  }

  if ([TaskStatus.Done, TaskStatus.PendingAcceptance].includes(status) && !hasValidSubmittedResult(task)) {
    selectedTaskId = taskId;
    modalState = {
      kind: "taskDetail",
      taskId,
      error: "该步骤需要提交结果，请先填写提交内容。",
    };
    rerender();
    return;
  }

  if (
    status === TaskStatus.Canceled &&
    !isDoneStatus(task.status) &&
    !isCanceledStatus(task.status) &&
    !window.confirm("确定要取消该任务吗？取消后历史记录仍会保留。")
  ) {
    rerender();
    return;
  }

  const now = getNow();
  const updatedTask = markTaskOverdueRecordIfNeeded({
    ...task,
    status,
    updatedAt: now,
    completedAt: status === TaskStatus.Done ? now : null,
  }, now);

  try {
    await updatePersistentResource("tasks", taskId, updatedTask);
  } catch (error) {
    console.error("任务状态保存失败", error);
    window.alert(error.message || "任务状态保存失败，请检查本地数据库服务。");
    rerender();
    return;
  }

  state.tasks = state.tasks.map((item) => (item.id === taskId ? updatedTask : item));
  await triggerOverdueRectificationIfNeeded(task, updatedTask);
  if (status === TaskStatus.Done) {
    try {
      await advanceProcessAfterTaskDone(taskId);
    } catch (error) {
      console.error("关键行动推进保存失败", error);
      window.alert(error.message || "关键行动推进保存失败，请检查本地数据库服务。");
      rerender();
      return;
    }
  }
  rerender();
}

function getTaskStatusChangeError(task, status) {
  if (task.source === TaskSource.Process && task.status === TaskStatus.Waiting && status !== TaskStatus.Canceled) {
    return "前置步骤未完成，当前步骤暂不能处理。";
  }
  return "";
}

async function bulkUpdateTaskStatus(status, rerender) {
  if (status === TaskStatus.Done && !canCurrentUser("tasks.batchComplete")) return;
  if (status === TaskStatus.Canceled && !canCurrentUser("tasks.batchCancel")) return;
  const selectedTasks = [...selectedTaskIds].map(getTask).filter(Boolean);
  if (selectedTasks.length === 0) return;
  if (status === TaskStatus.Canceled && !window.confirm("确定要取消选中的任务吗？")) return;

  try {
    await batchUpdateTaskStatusResource(selectedTasks.map((task) => task.id), status);
  } catch (error) {
    console.error("批量修改任务状态失败", error);
    window.alert(error.message || "任务状态保存失败，请检查本地数据库服务。");
    rerender();
    return;
  }

  const previousTaskMap = new Map(selectedTasks.map((task) => [task.id, task]));
  if (status === TaskStatus.Done) {
    await Promise.all(
      selectedTasks
        .map((task) => state.tasks.find((item) => item.id === task.id))
        .filter(Boolean)
        .map((updatedTask) => triggerOverdueRectificationIfNeeded(previousTaskMap.get(updatedTask.id), updatedTask)),
    );
  }

  selectedTaskIds = new Set();
  rerender();
}

function openExecutionGroupCreateModal(rerender) {
  if (!canCurrentUser("tasks.batchComplete")) return;
  const selectedTasks = sortExecutionGroupTasks([...selectedTaskIds].map(getTask).filter(Boolean));
  const validationError = validateExecutionGroupTasks(selectedTasks);
  if (validationError !== "") {
    window.alert(validationError);
    return;
  }

  modalState = {
    kind: "executionGroupCreate",
    taskIds: selectedTasks.map((task) => task.id),
    name: buildExecutionGroupName(selectedTasks),
    error: "",
  };
  rerender();
}

async function confirmCreateExecutionGroup(rerender) {
  if (modalState?.kind !== "executionGroupCreate") return;
  const input = document.querySelector("[name='executionGroupName']");
  const name = String(input?.value ?? modalState.name ?? "").trim();
  try {
    await createExecutionGroupResource({ name, taskIds: modalState.taskIds });
  } catch (error) {
    modalState = { ...modalState, name, error: error.message || "执行组创建失败，请检查本地数据库服务。" };
    rerender();
    return;
  }

  const firstTask = getTask(modalState.taskIds[0]);
  const groupId = firstTask?.executionGroupId ?? "";
  selectedTaskIds = new Set();
  modalState = groupId === "" ? null : { kind: "executionGroupDetail", groupId, error: "" };
  rerender();
}

async function startExecutionGroup(groupId, rerender) {
  try {
    await startExecutionGroupResource(groupId);
    modalState = { kind: "executionGroupDetail", groupId, error: "" };
  } catch (error) {
    modalState = { kind: "executionGroupDetail", groupId, error: error.message || "执行组开始失败，请检查本地数据库服务。" };
  }
  rerender();
}

async function cancelExecutionGroup(groupId, rerender) {
  if (!window.confirm("确定取消该执行组吗？成员任务会解除关联，任务状态保持不变。")) return;
  try {
    await cancelExecutionGroupResource(groupId);
    modalState = null;
  } catch (error) {
    modalState = { kind: "executionGroupDetail", groupId, error: error.message || "执行组取消失败，请检查本地数据库服务。" };
  }
  rerender();
}

function getExecutionGroupCompletionErrors(group) {
  if (group === null) return ["未找到执行组。"];
  if (group.status !== "doing") return ["执行组尚未开始，不能完成。"];
  const tasks = getExecutionGroupTasks(group);
  const errors = [];
  tasks.forEach((task) => {
    if (isCanceledStatus(task.status)) errors.push(`${task.name}：已取消，不能完成执行组。`);
    if (isDoneStatus(task.status) || task.status === TaskStatus.PendingAcceptance) return;
    const status = task.needAcceptance ? TaskStatus.PendingAcceptance : TaskStatus.Done;
    const statusError = getTaskStatusChangeError(task, status);
    if (statusError !== "") errors.push(`${task.name}：${statusError}`);
    const requirement = getTaskSubmitRequirement(task);
    const hasForm = includesSubmitPart(requirement.submitType, "form");
    const hasFile = includesSubmitPart(requirement.submitType, "file");
    const hasLink = includesSubmitPart(requirement.submitType, "link");
    if (hasForm) {
      for (const field of getSubmitFields(task)) {
        if (field.required !== true) continue;
        const value = requirement.submitFormData[field.key];
        const isEmpty = Array.isArray(value) ? value.length === 0 : String(value ?? "").trim() === "";
        if (isEmpty) errors.push(`${task.name}：请先填写${field.label}。`);
      }
    }
    if (hasFile && getVisibleSubmitFiles(requirement.submitFiles).length === 0) errors.push(`${task.name}：请先上传提交文件。`);
    if (hasLink && requirement.submitLinks.length === 0) errors.push(`${task.name}：请先填写提交链接。`);
    const submitError = validateSubmittedResult(task);
    if (submitError !== "") errors.push(`${task.name}：${submitError}`);
  });
  return errors;
}

async function completeExecutionGroup(groupId, rerender) {
  const group = getExecutionGroupById(groupId);
  const errors = getExecutionGroupCompletionErrors(group);
  if (errors.length > 0) {
    modalState = { kind: "executionGroupDetail", groupId, error: errors.join("；") };
    rerender();
    return;
  }
  const actualTotalMinutes = getExecutionGroupActualMinutes(group);

  if (!window.confirm(`确定完成该执行组吗？\n实际总时长：${actualTotalMinutes} 分钟\n系统将逐条完成成员任务。`)) return;

  try {
    await completeExecutionGroupResource(groupId);
  } catch (error) {
    console.error("执行组完成失败", error);
    modalState = { kind: "executionGroupDetail", groupId, error: error.message || "执行组完成失败，请检查本地数据库服务。" };
    rerender();
    return;
  }
  modalState = { kind: "executionGroupDetail", groupId, error: "" };
  rerender();
}

async function cancelTask(taskId, rerender) {
  const task = getTask(taskId);

  if (task.source === TaskSource.Process) {
    window.alert("标准步骤生成的任务不能单独取消，需要在关键行动中终止。");
    return;
  }

  if (task.status === TaskStatus.Done) return;

  if (!window.confirm("确定要取消该任务吗？取消后历史记录仍会保留。")) return;

  const now = getNow();
  const updatedTask = { ...task, status: TaskStatus.Canceled, updatedAt: now };
  try {
    await updatePersistentResource("tasks", taskId, updatedTask);
  } catch (error) {
    console.error("取消任务失败", error);
    window.alert(error.message || "任务状态保存失败，请检查本地数据库服务。");
    return;
  }
  state.tasks = state.tasks.map((item) => (item.id === taskId ? updatedTask : item));
  rerender();
}

async function restoreCanceledTask(taskId, rerender) {
  const task = getTask(taskId);
  if (task === null || !canRestoreTask(task)) return;
  const instance = getTaskProcessInstance(task);
  if (instance !== null && isCanceledStatus(instance.status)) {
    window.alert("所属关键行动已取消，请重新发起关键行动。");
    return;
  }
  if (instance !== null && instance.status !== ProcessInstanceStatus.Running) {
    window.alert("所属关键行动不是进行中状态，不能单独恢复该任务。");
    return;
  }
  if (!window.confirm("确定要将该任务恢复为待处理吗？")) return;
  const now = getNow();
  const restoredTask = { ...task, status: TaskStatus.Todo, startDate: task.startDate ?? today, updatedAt: now, cancelReason: null };
  try {
    await updatePersistentResource("tasks", taskId, restoredTask);
  } catch (error) {
    console.error("恢复任务失败", error);
    window.alert(error.message || "任务状态保存失败，请检查本地数据库服务。");
    return;
  }
  state.tasks = state.tasks.map((item) => (item.id === taskId ? restoredTask : item));
  rerender();
}

async function relaunchProcessAsWorkPlan(instanceId, rerender) {
  const instance = state.processInstances.find((item) => item.id === instanceId) ?? null;
  if (!canRelaunchProcessInstance(instance)) return;
  if (!window.confirm("确定基于该关键行动重新发起一条新工作吗？重新发起会创建一条新的工作，原取消记录会保留。")) return;
  const now = getNow();
  const workPlan = {
    id: createId("work-plan"),
    goalId: instance.goalId,
    departmentId: null,
    taskTemplateId: instance.taskTemplateId ?? instance.standardWorkId ?? "",
    title: `${getProcessDisplayTitle(instance)}（重新发起）`,
    customFields: { ...(instance.customFields ?? {}) },
    coverImageUrl: getPrimaryImageUrl(instance) || null,
    status: WorkPlanStatus.ThisWeek,
    plannedWeek: getCurrentWeek(),
    dueDate: null,
    description: instance.description ?? "",
    processInstanceId: null,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    canceledAt: null,
  };
  try {
    await createPersistentResource("work-plans", workPlan);
  } catch (error) {
    console.error("重新发起失败", error);
    window.alert(error.message || "重新发起失败，请检查本地数据库服务。");
    return;
  }
  state.workPlans = [workPlan, ...state.workPlans];
  window.alert("已创建新的待发起工作计划。");
  rerender();
}

async function returnTaskToSelectedStep(form, rerender) {
  if (!canCurrentUser("tasks.changeStatus")) return;
  const task = getTask(modalState.taskId);
  if (task === null) return;
  const returnableTasks = getReturnableProcessTasks(task);
  const targetTaskId = getFormValue(form, "returnTargetTaskId");
  const targetTask = returnableTasks.find((item) => item.id === targetTaskId) ?? null;
  const orderedTasks = getOrderedActiveProcessTasks(task) ?? [];
  const targetIndex = orderedTasks.findIndex((item) => item.id === targetTaskId);
  const currentIndex = orderedTasks.findIndex((item) => item.id === task.id);
  const reason = getFormValue(form, "returnReason");

  if (targetTask === null || targetIndex < 0 || currentIndex < 0 || targetIndex >= currentIndex) {
    setModalError("请选择当前节点之前的历史节点。");
    return;
  }
  if (reason === "") {
    setModalError("退回原因不能为空。");
    return;
  }
  if (!canReturnTask(task)) {
    setModalError("当前任务不满足退回条件。");
    return;
  }

  const affectedTasks = orderedTasks.slice(targetIndex, currentIndex + 1);
  const now = getNow();
  const user = getCurrentUser();
  const recordId = createId("return-record");
  const record = {
    id: recordId,
    returnedAt: now,
    returnedBy: user?.id ?? null,
    returnedByName: user?.name ?? "未记录人员",
    reason,
    fromTaskId: task.id,
    fromTaskName: task.name,
    fromNodeId: task.processNodeId,
    toTaskId: targetTask.id,
    toTaskName: targetTask.name,
    toNodeId: targetTask.processNodeId,
    affectedTaskIds: affectedTasks.map((item) => item.id),
    affectedTaskNames: affectedTasks.map((item) => item.name),
  };
  const returnedTasks = affectedTasks.map((affectedTask, index) => {
    const nextStatus = index === 0 ? TaskStatus.Todo : TaskStatus.Waiting;
    const extraFields = index === 0 ? { [latestReturnReasonKey]: reason } : {};
    return appendReturnRecord(
      {
        ...affectedTask,
        status: nextStatus,
        startDate: nextStatus === TaskStatus.Todo ? (affectedTask.startDate ?? today) : affectedTask.startDate,
        completedAt: null,
        updatedAt: now,
      },
      record,
      extraFields,
    );
  });

  try {
    for (const returnedTask of returnedTasks) {
      await updatePersistentResource("tasks", returnedTask.id, returnedTask);
    }
  } catch (error) {
    console.error("退回重做失败", error);
    setModalError(error.message || "退回重做失败，请检查本地数据库服务。");
    return;
  }

  const returnedTaskMap = new Map(returnedTasks.map((returnedTask) => [returnedTask.id, returnedTask]));
  state.tasks = state.tasks.map((item) => {
    return returnedTaskMap.get(item.id) ?? item;
  });
  for (const returnedTask of returnedTasks) {
    const previousRecordCount = getReturnRecords(affectedTasks.find((item) => item.id === returnedTask.id) ?? {}).length;
    const nextRecordCount = getReturnRecords(returnedTask).length;
    if (previousRecordCount < 2 && nextRecordCount >= 2) {
      await triggerRectificationForTaskException(returnedTask, "rework_twice", `任务“${returnedTask.name}”连续返工达到 ${nextRecordCount} 次，需要发起改善。`);
    }
  }
  selectedTaskId = targetTask.id;
  modalState = null;
  rerender();
}

async function handleTaskAction(action, taskId, rerender, actionButton = null) {
  const task = getTask(taskId);

  if (task === null) return;

  if (action === "open-standard-optimization-target") {
    openStandardOptimizationTarget(task, actionButton?.dataset.target ?? "");
    return;
  }

  if (action === "view-task") {
    selectedTaskId = taskId;
    modalState = { kind: "taskDetail", taskId, error: "" };
    rerender();
    return;
  }

  if (action === "view-launched-process-detail") {
    if (task.processInstanceId === null || task.processInstanceId === undefined || task.processInstanceId === "") {
      window.alert("该任务未关联关键行动。");
      return;
    }
    modalState = { kind: "launchedProcessDetail", instanceId: task.processInstanceId };
    rerender();
    return;
  }

  if (action === "edit-task") {
    if (!canEditTask(task)) return;
    modalState = { kind: "task", mode: "edit", taskId, templateId: task.templateId ?? "", error: "" };
    rerender();
    return;
  }

  if (action === "cancel-task") {
    await cancelTask(taskId, rerender);
    return;
  }

  if (action === "restore-task") {
    await restoreCanceledTask(taskId, rerender);
    return;
  }

  if (action === "return-task") {
    if (!canReturnTask(task)) return;
    modalState = { kind: "returnTask", taskId, returnReason: "", error: "" };
    rerender();
    return;
  }

  if (action === "start-task" && (task.status === TaskStatus.Todo || task.status === TaskStatus.Waiting)) {
    await updateTaskStatus(taskId, TaskStatus.Doing, rerender);
    return;
  }

  if (action === "submit-done" || action === "submit-acceptance" || action === "submit-result") {
    modalState = { kind: "result", action, taskId, error: "" };
    rerender();
    return;
  }

  if (action === "accept-task" && task.status === TaskStatus.PendingAcceptance) {
    await updateTaskStatus(taskId, TaskStatus.Done, rerender);
    return;
  }

  if (action === "reject-task" && task.status === TaskStatus.PendingAcceptance) {
    window.alert("验收已退回，任务状态恢复为进行中。");
    const now = getNow();
    const rejectRecord = {
      id: createId("review-reject"),
      rejectedAt: now,
      rejectedBy: getCurrentUser()?.id ?? null,
      rejectedByName: getCurrentUser()?.name ?? "未记录人员",
    };
    const updatedTask = {
      ...task,
      status: TaskStatus.Doing,
      completedAt: null,
      updatedAt: now,
      customFields: {
        ...(task.customFields ?? {}),
        reviewRejectRecords: [...(Array.isArray(task.customFields?.reviewRejectRecords) ? task.customFields.reviewRejectRecords : []), rejectRecord],
      },
    };
    try {
      await updatePersistentResource("tasks", taskId, updatedTask);
    } catch (error) {
      console.error("退回任务保存失败", error);
      window.alert(error.message || "任务状态保存失败，请检查本地数据库服务。");
      return;
    }
    state.tasks = state.tasks.map((item) => (item.id === taskId ? updatedTask : item));
    await triggerRectificationForTaskException(updatedTask, "acceptance_rejected", `任务“${updatedTask.name}”审核退回，需要发起改善。`);
    rerender();
  }
}

function openStandardOptimizationTarget(task, target) {
  const sourceStandardWork = getRectificationSourceStandardWork(task);
  if (sourceStandardWork === null) {
    window.alert("未定位到来源关键行动。");
    return;
  }
  if (target === "form") {
    window.sessionStorage?.setItem("wufanFormDesignStandardWorkId", sourceStandardWork.id);
    window.location.hash = "settings/form-design";
    return;
  }
  if (target === "standard-work") {
    window.sessionStorage?.setItem("wufanStandardWorkFocusId", sourceStandardWork.id);
    window.location.hash = "task-library";
    return;
  }
  if (target === "process" || target === "completion-standard") {
    if (!sourceStandardWork.defaultProcessTemplateId) {
      window.alert("该关键行动尚未绑定标准。");
      return;
    }
    window.location.hash = `process-template-${sourceStandardWork.defaultProcessTemplateId}`;
  }
}

async function handleTaskSubmit(event, rerender) {
  event.preventDefault();

  if (modalState?.kind === "task") await saveTask(event.target, rerender);
  if (modalState?.kind === "result") await saveResult(event.target, rerender);
  if (modalState?.kind === "returnTask") await returnTaskToSelectedStep(event.target, rerender);
}

function renderSelectedStandardWorkAttachments(input) {
  const container = input.closest(".standard-work-attachments-field")?.querySelector("[data-selected-standard-work-attachments]");
  if (container === null || container === undefined) return;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) {
    container.innerHTML = `<p class="form-note">暂无已选择附件</p>`;
    return;
  }
  container.innerHTML = `
    <ul class="attachment-list editable-attachment-list">
      ${files
        .map(
          (file, index) => `
            <li>
              <span>${escapeHtml(file.name)}</span>
              <button class="text-button" type="button" data-action="remove-selected-standard-work-attachment" data-attachment-index="${index}">删除</button>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function removeSelectedStandardWorkAttachment(button) {
  const field = button.closest(".standard-work-attachments-field");
  const input = field?.querySelector("[data-standard-work-attachments]");
  if (input === null || input === undefined) return;
  const removeIndex = Number(button.dataset.attachmentIndex);
  const transfer = new DataTransfer();
  Array.from(input.files ?? []).forEach((file, index) => {
    if (index !== removeIndex) transfer.items.add(file);
  });
  input.files = transfer.files;
  renderSelectedStandardWorkAttachments(input);
}

function renderSelectedSubmitFiles(input) {
  const container = input.closest(".submit-result-form")?.querySelector("[data-selected-submit-files]");
  if (container === null || container === undefined) return;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) {
    container.innerHTML = `<p class="form-note">暂无新选择附件</p>`;
    return;
  }
  container.innerHTML = `
    <ul class="attachment-list editable-attachment-list">
      ${files
        .map(
          (file, index) => `
            <li>
              <span>${escapeHtml(file.name)}</span>
              <button class="text-button" type="button" data-action="remove-selected-submit-file" data-file-index="${index}">删除</button>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function removeSelectedSubmitFile(button) {
  const form = button.closest(".result-form");
  const input = form?.querySelector("[data-submit-files]");
  if (input === null || input === undefined) return;
  const removeIndex = Number(button.dataset.fileIndex);
  const transfer = new DataTransfer();
  Array.from(input.files ?? []).forEach((file, index) => {
    if (index !== removeIndex) transfer.items.add(file);
  });
  input.files = transfer.files;
  renderSelectedSubmitFiles(input);
}

function removeExistingSubmitFile(button, rerender) {
  if (modalState === null || modalState.kind !== "result") return;
  const fileKey = decodeURIComponent(button.dataset.fileKey ?? "");
  if (fileKey === "") return;
  modalState = {
    ...modalState,
    removedSubmitFileKeys: [...new Set([...(modalState.removedSubmitFileKeys ?? []), fileKey])],
  };
  rerender();
}

function updateImagePreview(input) {
  const preview = input.closest(".image-url-field")?.querySelector(".image-preview-box");
  if (preview === undefined || preview === null) return;
  const value = input.value.trim();
  preview.innerHTML = value === ""
    ? "暂无图片"
    : `<img src="${escapeHtml(resolveAssetUrl(value))}" alt="图片预览" onerror="this.replaceWith('图片无法预览')" />`;
}

async function handleImageUpload(input) {
  const file = input.files?.[0];
  if (file === undefined) return;

  const field = input.closest(".image-url-field");
  const hiddenInput = field?.querySelector(`input[name="custom__${input.dataset.imageUploadKey}"]`);
  const preview = field?.querySelector(".image-preview-box");
  if (preview !== null && preview !== undefined) preview.textContent = "上传中...";

  try {
    const result = await uploadImageFile(file);
    if (hiddenInput !== null && hiddenInput !== undefined) {
      hiddenInput.value = result.url;
      updateImagePreview(hiddenInput);
    }
    setModalError("");
  } catch (error) {
    if (preview !== null && preview !== undefined) preview.textContent = "图片上传失败";
    setModalError(error.message ?? "图片上传失败。");
  }
}

export function bindTasksPageEvents(rerender) {
  const tasksPage = document.querySelector(".tasks-page");
  const filterForm = document.querySelector(".task-filters");
  const clearanceFilterForm = document.querySelector(".clearance-filters");
  const processProgressFilterForm = document.querySelector(".process-progress-filters");
  const taskForm = document.querySelector(".task-form");
  const resultForm = document.querySelector(".result-form");
  const returnTaskForm = document.querySelector(".return-task-form");
  const clearanceImportInput = document.querySelector("[data-clearance-file='import']");

  if (tasksPage === null) return;

  document.querySelectorAll("[data-task-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTaskTab = tab.dataset.taskTab;
      if (window.location.hash.replace(/^#/, "") === activeTaskTab) {
        rerender();
        return;
      }
      window.location.hash = activeTaskTab;
      rerender();
    });
  });

  document.querySelectorAll("[data-task-list-view]").forEach((button) => {
    button.addEventListener("click", () => {
      taskListView = button.dataset.taskListView;
      const firstRow = getTaskTableRows()[0];
      selectedTaskId = firstRow?.task.id ?? null;
      rerender();
    });
  });

  document.querySelectorAll("[data-task-display-view]").forEach((button) => {
    button.addEventListener("click", () => {
      taskDisplayView = button.dataset.taskDisplayView === "card" ? "card" : "list";
      rerender();
    });
  });

  if (activeTaskTab === "content-schedule") {
    bindContentScheduleEvents(rerender);
    return;
  }

  if (activeTaskTab === "clearance") {
    if (clearanceFilterForm !== null) {
      clearanceFilterForm.addEventListener("input", () => {
        updateClearanceFilters(clearanceFilterForm);
        selectedTaskId = getClearanceGroups()[0]?.currentTask?.id ?? selectedTaskId;
        rerender();
      });
      clearanceFilterForm.addEventListener("change", () => {
        updateClearanceFilters(clearanceFilterForm);
        selectedTaskId = getClearanceGroups()[0]?.currentTask?.id ?? selectedTaskId;
        rerender();
      });
    }

    tasksPage.addEventListener("change", (event) => {
      const statusSelect = event.target.closest("[data-task-status-select]");
      if (statusSelect === null) return;
      updateTaskStatus(statusSelect.dataset.taskId, statusSelect.value, rerender);
    });

    tasksPage.addEventListener("click", async (event) => {
      if (event.target.closest("[data-task-status-select]") !== null) return;
      const actionButton = event.target.closest("[data-action]");

      if (actionButton !== null) {
        const action = actionButton.dataset.action;

        if (await handleTaskTemplateLinkAction(action, actionButton, rerender)) return;

        if (action === "close-task-modal") {
          modalState = null;
          rerender();
          return;
        }
        if (action === "download-clearance-template") {
          if (!canCurrentUser("workPlans.launch")) return;
          downloadClearanceImportTemplate();
          return;
        }
        if (action === "confirm-clearance-import") {
          if (!canCurrentUser("workPlans.launch")) return;
          confirmClearanceImport(rerender);
          return;
        }
        if (action === "toggle-clearance-group") {
          const groupId = actionButton.dataset.clearanceGroupId;
          expandedClearanceGroups = new Set(expandedClearanceGroups);
          if (expandedClearanceGroups.has(groupId)) {
            expandedClearanceGroups.delete(groupId);
          } else {
            expandedClearanceGroups.add(groupId);
          }
          rerender();
          return;
        }
        if (action === "relaunch-process") {
          relaunchProcessAsWorkPlan(actionButton.dataset.processInstanceId, rerender);
          return;
        }
        handleTaskAction(action, actionButton.dataset.taskId, rerender);
        return;
      }

      if (handleTaskTemplatePickerTagClick(event.target.closest("[data-task-template-picker-tag]"), rerender)) return;

      const row = event.target.closest("[data-row-task-id]");
      if (row === null) return;
      selectedTaskId = row.dataset.rowTaskId;
      rerender();
    });

    tasksPage.addEventListener("input", (event) => {
      if (handleTaskTemplatePickerSearchInput(event.target.closest("[data-task-template-picker-search]"), rerender)) return;
    });

    if (taskForm !== null) taskForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
    if (taskForm !== null) {
      taskForm.addEventListener("input", (event) => {
        if (event.target.name?.startsWith("custom__")) updateImagePreview(event.target);
      });
      taskForm.addEventListener("change", (event) => {
        if (event.target.matches("[data-task-value-module-select]")) {
          modalState = { ...modalState, categoryId: event.target.value, taskTemplateId: "", error: "" };
          rerender();
        }
        if (event.target.matches("[data-task-template-select]")) {
          modalState = { ...modalState, taskTemplateId: event.target.value };
          rerender();
        }
        if (event.target.matches("[data-image-upload-key]")) {
          handleImageUpload(event.target);
        }
      });
    }
    if (resultForm !== null) resultForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
    if (returnTaskForm !== null) returnTaskForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
    if (clearanceImportInput !== null) {
      clearanceImportInput.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file !== undefined) handleClearanceImportFile(file, rerender);
        event.target.value = "";
      });
    }
    return;
  }

  if (activeTaskTab === "process-progress") {
    if (processProgressFilterForm !== null) {
      processProgressFilterForm.addEventListener("input", () => {
        updateProcessProgressFilters(processProgressFilterForm);
        selectedProcessInstanceId = getFilteredProcessInstances()[0]?.id ?? null;
        rerender();
      });
      processProgressFilterForm.addEventListener("change", () => {
        updateProcessProgressFilters(processProgressFilterForm);
        selectedProcessInstanceId = getFilteredProcessInstances()[0]?.id ?? null;
        rerender();
      });
    }

    tasksPage.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (actionButton !== null && actionButton.dataset.action === "close-task-modal") {
        modalState = null;
        rerender();
        return;
      }
      if (actionButton !== null && actionButton.dataset.action === "show-process-work-form") {
        modalState = { kind: "workForm", instanceId: actionButton.dataset.processInstanceId };
        rerender();
        return;
      }
      if (actionButton !== null && actionButton.dataset.action === "cancel-process") {
        const instance = state.processInstances.find((item) => item.id === actionButton.dataset.processInstanceId) ?? null;
        if (!canCancelProcessInstance(instance)) {
          window.alert(instance?.status === ProcessInstanceStatus.Done ? "已完成关键行动不能取消。" : "该关键行动当前不能取消。");
          return;
        }
        modalState = { kind: "cancelProcess", instanceId: instance.id, cancelReason: "", error: "" };
        rerender();
        return;
      }
      if (actionButton !== null && actionButton.dataset.action === "relaunch-process") {
        relaunchProcessAsWorkPlan(actionButton.dataset.processInstanceId, rerender);
        return;
      }
      if (actionButton !== null && actionButton.dataset.action === "open-process-task") {
        selectedTaskId = actionButton.dataset.taskId;
        activeTaskTab = "task-list";
        rerender();
        return;
      }

      const row = event.target.closest("[data-process-progress-id]");
      if (row === null) return;
      selectedProcessInstanceId = row.dataset.processProgressId;
      rerender();
    });
    const cancelProcessForm = document.querySelector(".cancel-process-form");
    if (cancelProcessForm !== null) {
      cancelProcessForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (modalState === null || modalState.kind !== "cancelProcess") return;
        const formData = new FormData(cancelProcessForm);
        const cancelReason = String(formData.get("cancelReason") ?? "").trim();
        try {
          await cancelProcessInstance(modalState.instanceId, cancelReason);
          modalState = null;
        } catch (error) {
          console.error("取消关键行动失败", error);
          modalState = {
            ...modalState,
            cancelReason,
            error: error.message || "取消关键行动失败，请检查本地数据库服务。",
          };
        }
        rerender();
      });
    }
    bindLaunchedProcessDetailEvents(tasksPage, rerender, {
      onTaskSelect: (taskId) => {
        selectedTaskId = taskId;
        activeTaskTab = "task-list";
        rerender();
      },
    });
    return;
  }

  if (filterForm === null) return;

  document.querySelectorAll("[data-task-select-all]").forEach((checkbox) => {
    checkbox.indeterminate = checkbox.dataset.indeterminate === "true";
  });

  filterForm.addEventListener("input", () => {
    updateFilters(filterForm);
    const firstRow = getTaskTableRows()[0];
    selectedTaskId = firstRow?.task.id ?? null;
    rerender();
  });
  filterForm.addEventListener("change", () => {
    updateFilters(filterForm);
    const firstRow = getTaskTableRows()[0];
    selectedTaskId = firstRow?.task.id ?? null;
    rerender();
  });
  tasksPage.addEventListener("change", (event) => {
    const selectAll = event.target.closest("[data-task-select-all]");
    if (selectAll !== null) {
      const visibleTaskIds = getVisibleTaskIdsFromRows(getTaskTableRows());
      if (selectAll.checked) {
        selectedTaskIds = new Set([...selectedTaskIds, ...visibleTaskIds]);
      } else {
        selectedTaskIds = new Set([...selectedTaskIds].filter((taskId) => !visibleTaskIds.includes(taskId)));
      }
      rerender();
      return;
    }

    const rowSelect = event.target.closest("[data-task-row-select]");
    if (rowSelect !== null) {
      selectedTaskIds = new Set(selectedTaskIds);
      if (rowSelect.checked) {
        selectedTaskIds.add(rowSelect.dataset.taskId);
      } else {
        selectedTaskIds.delete(rowSelect.dataset.taskId);
      }
      rerender();
      return;
    }

    const statusSelect = event.target.closest("[data-task-status-select]");

    if (statusSelect === null) return;

    updateTaskStatus(statusSelect.dataset.taskId, statusSelect.value, rerender);
  });
  tasksPage.addEventListener("click", async (event) => {
    if (event.target.closest("[data-task-row-select], [data-task-select-all]") !== null) return;
    if (event.target.closest("[data-task-status-select]") !== null) {
      event.stopPropagation();
      return;
    }

    const actionButton = event.target.closest("[data-action]");

      if (actionButton !== null) {
        event.stopPropagation();
        const action = actionButton.dataset.action;

      if (await handleTaskTemplateLinkAction(action, actionButton, rerender)) return;

      if (action === "add-task") {
        modalState = { kind: "task", mode: "add", categoryId: "", taskTemplateId: "", error: "" };
        rerender();
        return;
      }

      if (action === "close-task-modal") {
        modalState = null;
        rerender();
        return;
      }

      if (action === "remove-selected-standard-work-attachment") {
        removeSelectedStandardWorkAttachment(actionButton);
        return;
      }

      if (action === "remove-selected-submit-file") {
        removeSelectedSubmitFile(actionButton);
        return;
      }

      if (action === "remove-existing-submit-file") {
        removeExistingSubmitFile(actionButton, rerender);
        return;
      }

      if (action === "bulk-status") {
        bulkUpdateTaskStatus(actionButton.dataset.status, rerender);
        return;
      }
      if (action === "create-execution-group") {
        openExecutionGroupCreateModal(rerender);
        return;
      }
      if (action === "confirm-create-execution-group") {
        await confirmCreateExecutionGroup(rerender);
        return;
      }
      if (action === "view-execution-group") {
        modalState = { kind: "executionGroupDetail", groupId: actionButton.dataset.executionGroupId, error: "" };
        rerender();
        return;
      }
      if (action === "start-execution-group") {
        await startExecutionGroup(actionButton.dataset.executionGroupId, rerender);
        return;
      }
      if (action === "cancel-execution-group") {
        await cancelExecutionGroup(actionButton.dataset.executionGroupId, rerender);
        return;
      }
      if (action === "complete-execution-group") {
        await completeExecutionGroup(actionButton.dataset.executionGroupId, rerender);
        return;
      }
      if (action === "bulk-complete") {
        bulkUpdateTaskStatus(TaskStatus.Done, rerender);
        return;
      }
      if (action === "bulk-cancel") {
        bulkUpdateTaskStatus(TaskStatus.Canceled, rerender);
        return;
      }
      if (action === "toggle-due-date-sort") {
        taskDueDateSort = taskDueDateSort === "asc" ? "" : "asc";
        rerender();
        return;
      }
      handleTaskAction(action, actionButton.dataset.taskId, rerender, actionButton);
      return;
    }

    if (handleTaskTemplatePickerTagClick(event.target.closest("[data-task-template-picker-tag]"), rerender)) return;

    const row = event.target.closest("[data-row-task-id]");

    if (row === null) return;

    if (row.matches("[data-task-card]")) {
      await handleTaskAction("view-task", row.dataset.rowTaskId, rerender);
      return;
    }

    selectedTaskId = row.dataset.rowTaskId;
    rerender();
  });

  if (taskForm !== null) taskForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
  tasksPage.addEventListener("input", (event) => {
    if (handleTaskTemplatePickerSearchInput(event.target.closest("[data-task-template-picker-search]"), rerender)) return;
  });
  if (taskForm !== null) {
    taskForm.addEventListener("input", (event) => {
      if (event.target.name?.startsWith("custom__")) updateImagePreview(event.target);
    });
    taskForm.addEventListener("change", (event) => {
      if (event.target.matches("[data-task-value-module-select]")) {
        modalState = { ...modalState, categoryId: event.target.value, taskTemplateId: "", error: "" };
        rerender();
      }
      if (event.target.matches("[data-task-template-select]")) {
        modalState = { ...modalState, taskTemplateId: event.target.value };
        rerender();
      }
      if (event.target.matches("[data-image-upload-key]")) {
        handleImageUpload(event.target);
      }
      if (event.target.matches("[data-standard-work-attachments]")) {
        renderSelectedStandardWorkAttachments(event.target);
      }
    });
  }
  if (resultForm !== null) resultForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
  if (resultForm !== null) {
    resultForm.addEventListener("change", (event) => {
      if (event.target.matches("[data-submit-files]")) {
        renderSelectedSubmitFiles(event.target);
      }
    });
  }
  if (returnTaskForm !== null) returnTaskForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
  if (modalState?.kind === "launchedProcessDetail") {
    bindLaunchedProcessDetailEvents(tasksPage, rerender, {
      onTaskSelect: (taskId) => {
        selectedTaskId = taskId;
        modalState = { kind: "taskDetail", taskId, error: "" };
        rerender();
      },
    });
  }
}

export function renderTasksPage() {
  syncTaskTabFromHash();
  if (activeTaskTab === "task-library") activeTaskTab = "task-list";
  if (activeTaskTab === "task-list" && !canCurrentUser("tasks.view")) activeTaskTab = canCurrentUser("contentSchedules.view") ? "content-schedule" : "task-list";
  if (activeTaskTab === "clearance" && !canCurrentUser("tasks.view")) activeTaskTab = canCurrentUser("contentSchedules.view") ? "content-schedule" : "task-list";
  if (activeTaskTab === "process-progress" && !canCurrentUser("tasks.viewProcessProgress")) {
    activeTaskTab = canCurrentUser("tasks.view") ? "task-list" : "content-schedule";
  }
  if (activeTaskTab === "content-schedule" && !canCurrentUser("contentSchedules.view")) activeTaskTab = "task-list";
  const canViewActiveTab =
    (activeTaskTab === "task-list" && canCurrentUser("tasks.view")) ||
    (activeTaskTab === "clearance" && canCurrentUser("tasks.view")) ||
    (activeTaskTab === "process-progress" && canCurrentUser("tasks.viewProcessProgress")) ||
    (activeTaskTab === "content-schedule" && canCurrentUser("contentSchedules.view"));

  return `
    <div class="tasks-page">
      <div class="settings-tabs task-subtabs" aria-label="任务页签">
        ${canCurrentUser("tasks.view") ? `<button class="${activeTaskTab === "task-list" ? "is-active" : ""}" type="button" data-task-tab="task-list">任务</button>` : ""}
        ${canCurrentUser("tasks.view") ? `<button class="${activeTaskTab === "clearance" ? "is-active" : ""}" type="button" data-task-tab="clearance">库存清仓</button>` : ""}
        ${canCurrentUser("contentSchedules.view") ? `<button class="${activeTaskTab === "content-schedule" ? "is-active" : ""}" type="button" data-task-tab="content-schedule">内容排期</button>` : ""}
      </div>
      ${
        !canViewActiveTab
          ? `<section class="settings-section"><div class="empty-detail">你没有权限访问该页面。</div></section>`
        : activeTaskTab === "content-schedule"
          ? renderContentSchedulePage()
          : activeTaskTab === "clearance"
            ? renderClearancePage()
          : activeTaskTab === "process-progress"
            ? `
              ${renderProcessProgressFilters()}
              ${renderProcessProgressTable()}
              ${renderProcessProgressDetail()}
              ${renderWorkFormModal()}
              ${renderCancelProcessModal()}
            `
            : `
              ${renderTaskListViewSwitch()}
              ${renderFilters()}
              ${taskDisplayView === "card" ? renderTaskCardGrid() : renderTaskTable()}
              ${renderTaskDetail()}
              ${renderTaskDetailModal()}
              ${renderLaunchedProcessDetailModal()}
              ${renderTaskModal()}
              ${renderResultModal()}
              ${renderReturnTaskModal()}
              ${renderWorkFormModal()}
              ${renderExecutionGroupCreateModal()}
              ${renderExecutionGroupDetailModal()}
            `
      }
    </div>
  `;
}
