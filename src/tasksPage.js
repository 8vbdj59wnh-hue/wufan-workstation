import {
  advanceProcessAfterTaskDone,
  cancelProcessInstance,
  createPersistentResource,
  createOrReuseProcessTemplateForStandardWork,
  createId,
  ensureTaskReadyForExecution,
  getCurrentWeek,
  getProcessNodeStepOrder,
  getCurrentUser,
  getNow,
  loadTemplates,
  moveTaskTemplateToValueChain,
  normalizeSubmitRequirement,
  resolveAssetUrl,
  startProcess,
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
  ProcessTemplateStatus,
  SubmitType,
  TaskImportance,
  TaskSource,
  TaskStatus,
  TaskTemplateStatus,
  TaskUrgency,
  WorkPlanStatus,
  processInstanceStatusNames,
  taskImportanceNames,
  taskSourceNames,
  taskStatusNames,
  taskTemplateStatusNames,
  taskUrgencyNames,
  submitTypeNames,
  getValueModuleName,
  inferValueModuleIdFromText,
  isValueModuleId,
  ValueModule,
} from "./data/modelOptions.js";
import { getPrimaryImageUrl, getTaskQuadrant, hasTaskOverdueRecord, isCanceledStatus, isDoneStatus, isHiddenByDefaultStatus, isTaskOverdue, quadrantNames } from "./data/taskUtils.js?v=20260705-state-singleton1";
import { bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js?v=20260705-state-singleton1";
import { getMethodologyLinkByNodeId } from "./methodologiesPage.js?v=20260705-state-singleton1";
import { renderWorkFormViewer } from "./workFormViewer.js?v=20260705-state-singleton1";
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

const today = "2026-06-24";
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
  goalId: "",
  categoryId: "",
  quadrant: "",
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
let expandedProcessTaskGroups = new Set();
let expandAllTaskGroups = false;
let taskDueDateSort = "";
let expandedClearanceGroups = new Set();
let modalState = null;
let activeTaskTab = "task-list";
let standardWorkMoveStatus = null;
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
  { value: TaskStatus.Todo, label: "待执行" },
  { value: TaskStatus.Doing, label: "执行中" },
  { value: TaskStatus.PendingAcceptance, label: "待审核" },
  { value: TaskStatus.Done, label: "已完成" },
  { value: TaskStatus.Canceled, label: "已取消" },
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

const hiddenLegacyStandardWorkNames = [
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

function getStandardWorkValueChainColumns() {
  return getTaskCategories().map((category) => ({ id: category.id, title: category.name }));
}

function getActiveTaskTemplates() {
  return state.taskTemplates.filter((template) => template.status === TaskTemplateStatus.Active);
}

function getTaskTemplate(templateId) {
  return state.taskTemplates.find((template) => template.id === templateId) ?? null;
}

function getActiveProcessTemplates() {
  return state.processTemplates.filter((template) => template.status === ProcessTemplateStatus.Active);
}

function getSelectableProcessTemplates(selectedTemplateId = "") {
  return state.processTemplates.filter(
    (template) => template.status === ProcessTemplateStatus.Active || template.id === selectedTemplateId,
  );
}

function getProcessTemplateName(templateId) {
  return state.processTemplates.find((template) => template.id === templateId)?.name ?? "未绑定标准流程";
}

function getStandardWorkStepCount(template) {
  const processTemplateId = template.defaultProcessTemplateId ?? "";
  if (processTemplateId === "") return 0;
  return state.processTemplateNodes.filter((node) => node.templateId === processTemplateId).length;
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
    processName === "未绑定标准流程" ? "" : processName,
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

function getTaskTemplateValueChainCategoryId(template) {
  if (template === null || template === undefined) return "";
  if (getTaskCategories().some((category) => category.id === template.categoryId)) return template.categoryId;
  return getTaskCategories().find((category) => category.name === getStandardWorkValueChain(template))?.id ?? "";
}

function renderStandardWorkValueChainSelect(template) {
  if (!canCurrentUser("settings.editStandardWorks")) return "";
  const currentCategoryId = getTaskTemplateValueChainCategoryId(template);
  return `
    <label class="standard-work-category-select">
      <span>价值链</span>
      <select data-action="change-standard-work-value-chain" data-template-id="${escapeHtml(template.id)}">
        ${getStandardWorkValueChainColumns()
          .map(
            (column) => `
              <option value="${escapeHtml(column.id)}" ${column.id === currentCategoryId ? "selected" : ""}>
                ${escapeHtml(column.title)}
              </option>
            `,
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderStandardWorkMoveStatus() {
  if (standardWorkMoveStatus === null) return "";
  return `
    <p class="standard-work-move-status is-${escapeHtml(standardWorkMoveStatus.type)}">
      ${escapeHtml(standardWorkMoveStatus.message)}
    </p>
  `;
}

function getTaskTemplateForTask(task) {
  const directTemplate = getTaskTemplate(task.taskTemplateId ?? "");
  if (directTemplate !== null) return directTemplate;
  const instance = getTaskProcessInstance(task);
  return getTaskTemplate(instance?.taskTemplateId ?? "") ?? null;
}

function getTaskCustomFields(task) {
  const instance = getTaskProcessInstance(task);
  return instance?.customFields ?? task.customFields ?? {};
}

function mergePreservedTaskCustomFields(previousCustomFields = {}, nextCustomFields = {}) {
  const preservedKeys = [standardWorkAttachmentsKey];
  return preservedKeys.reduce(
    (result, key) => {
      if (!Object.prototype.hasOwnProperty.call(result, key) && Object.prototype.hasOwnProperty.call(previousCustomFields, key)) {
        result[key] = previousCustomFields[key];
      }
      return result;
    },
    { ...nextCustomFields },
  );
}

function getTaskCoverImage(task) {
  const instance = getTaskProcessInstance(task);
  return getPrimaryImageUrl(task, instance);
}

function buildUpdatedProcessInstanceForTaskForm(task, customFields, displayTitle, coverImageUrl, now) {
  const instance = getTaskProcessInstance(task);
  if (instance === null) return null;
  const mergedCustomFields = mergePreservedTaskCustomFields(instance.customFields ?? {}, customFields);
  return {
    ...instance,
    customFields: mergedCustomFields,
    displayTitle: displayTitle ?? instance.displayTitle ?? instance.name,
    coverImageUrl: coverImageUrl || instance.coverImageUrl || null,
    updatedAt: now,
  };
}

function getSortedFormFields(template) {
  return [...(template?.formFields ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
}

function getCustomFieldValue(customFields, field) {
  const value = customFields[field.key];
  if (Array.isArray(value)) return value.join("、");
  if (field.key === "departmentId") return findName(departments, value, "");
  if (field.key === "interviewerId") return findName(people, value, "");
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
  if (field.key === "interviewerId") {
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
  return {
    ...normalized,
    submitFormData: task.submitFormData && typeof task.submitFormData === "object" ? task.submitFormData : {},
    submitFiles: Array.isArray(task.submitFiles) ? task.submitFiles : [],
    submitLinks: Array.isArray(task.submitLinks) ? task.submitLinks : [],
  };
}

function getSubmitFields(task) {
  return [...(getTaskSubmitRequirement(task).submitFields ?? [])].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}

function getSubmitFieldValue(formData, field) {
  const value = formData?.[field.key];
  if (Array.isArray(value)) return value.join("、");
  return value ?? "";
}

function validateSubmittedResult(task, nextData = {}) {
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
  return `<input ${common} type="${field.type === "url" ? "url" : field.type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder ?? "")}" />`;
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
        "未关联标准工作");
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

  const standardWorkName = getStandardWorkNameFromTitle(task.displayTitle) || "未关联标准工作";
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
  const mutedClass = belonging.standardWorkName === "未关联标准工作" ? " is-muted" : "";

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
    title: instance === null ? fallbackBelonging?.title ?? fallbackTask.displayTitle ?? fallbackTask.name ?? "未命名清仓流程" : getProcessDisplayTitle(instance),
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
      <p class="form-note">支持 .xlsx、.xls、.csv，单个文件不超过 20MB。未上传也可以发起标准工作。</p>
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

  if (field.type === "select") {
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
      <h3>本次任务信息</h3>
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

function renderProcessTemplateOptions(selectedId) {
  return `
    <option value="">请选择标准流程</option>
    ${getSelectableProcessTemplates(selectedId)
      .map((template) => {
        const statusLabel = template.status === ProcessTemplateStatus.Active ? "" : "（已停用）";
        return `
          <option value="${template.id}" ${template.id === selectedId ? "selected" : ""}>
            ${escapeHtml(template.name)}${statusLabel}
          </option>
        `;
      })
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

function getQuadrantKey(task) {
  const quadrantName = getTaskQuadrant(task.importance, task.urgency);

  return Object.entries(quadrantNames).find(([, name]) => name === quadrantName)?.[0] ?? "";
}

function getTaskDisplayStatusValue(status) {
  if (isDoneStatus(status)) return TaskStatus.Done;
  if (isCanceledStatus(status)) return TaskStatus.Canceled;
  return status === TaskStatus.Waiting ? TaskStatus.Todo : status;
}

function matchesTaskStatusFilter(task, selectedStatus) {
  if (selectedStatus === "") return true;
  if (selectedStatus === TaskStatus.Done) return isDoneStatus(task.status);
  if (selectedStatus === TaskStatus.Canceled) return isCanceledStatus(task.status);
  return getTaskDisplayStatusValue(task.status) === selectedStatus;
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
  if (filters.goalId !== "" && task.goalId !== filters.goalId) return false;
  if (filters.categoryId !== "" && task.categoryId !== filters.categoryId) return false;
  if (filters.quadrant !== "" && getQuadrantKey(task) !== filters.quadrant) return false;
  if (filters.overdue === "yes" && !overdue) return false;
  if (filters.overdue === "no" && overdue) return false;

  return true;
}

function getFilteredTasks() {
  return state.tasks.filter((task) => !isClearanceTask(task)).filter(matchesFilters);
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

function getTaskStatusClass(status) {
  if (status === TaskStatus.Doing) return "is-doing";
  if (status === TaskStatus.PendingAcceptance) return "is-review";
  if (isDoneStatus(status)) return "is-done";
  if (isCanceledStatus(status)) return "is-canceled";
  return "is-todo";
}

function renderTaskStatusSelect(task) {
  const disabled = !canCurrentUser("tasks.changeStatus");
  const value = getTaskDisplayStatusValue(task.status);
  const title =
    disabled
      ? "没有修改任务状态的权限。"
      :
    task.source === TaskSource.Process && task.status === TaskStatus.Waiting
      ? "前置步骤未完成，当前步骤暂不能执行。"
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

function renderTaskRow(task, index, options = {}) {
  const rowClass = [
    task.id === selectedTaskId ? "is-selected" : "",
    options.child ? "task-group-child-row" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const numberText = options.numberText ?? String(index + 1);
  const prefix = options.child ? `<span class="task-node-indent">${escapeHtml(options.childLabel ?? "")}</span>` : "";

  return `
    <tr class="${rowClass}" data-row-task-id="${task.id}">
      <td class="task-select-column">
        <label class="task-row-select">
          <input type="checkbox" data-task-row-select data-task-id="${task.id}" ${selectedTaskIds.has(task.id) ? "checked" : ""} />
          <span>${numberText}</span>
        </label>
      </td>
      <td class="task-cover-column">${renderCoverImage(task)}</td>
      <td class="task-belonging-column">${renderTaskBelonging(task)}</td>
      <td class="task-name-column">${prefix}<span class="task-line-clamp task-name-text">${escapeHtml(task.name)}</span></td>
      <td class="task-executor-column">${findName(people, task.ownerId, "未设置")}</td>
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
          ${canRestoreTask(task) ? renderActionButton("恢复为待执行", "restore-task", task.id) : ""}
        </span>
      </td>
    </tr>
  `;
}

function renderProcessTaskGroupRow(row, index) {
  const task = row.currentTask;
  const title = getProcessGroupTitle(row.instance, row.tasks);
  const expandedIcon = row.expanded ? "▾" : "▸";
  const selected = task.id === selectedTaskId ? "is-selected" : "";

  return `
    <tr class="task-process-group-row ${selected}" data-row-task-id="${task.id}" data-process-task-group-id="${row.processInstanceId}">
      <td class="task-select-column">
        <div class="task-group-control">
          <button class="icon-button task-group-toggle" type="button" data-action="toggle-task-group" data-process-instance-id="${row.processInstanceId}" aria-label="${row.expanded ? "折叠流程任务" : "展开流程任务"}">${expandedIcon}</button>
          <label class="task-row-select">
            <input type="checkbox" data-task-row-select data-task-id="${task.id}" ${selectedTaskIds.has(task.id) ? "checked" : ""} />
            <span>${index + 1}</span>
          </label>
        </div>
      </td>
      <td class="task-cover-column">${renderCoverImage(task)}</td>
      <td class="task-belonging-column">
        <div class="task-belonging">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(getTaskBelonging(task).standardWorkName)}</span>
          <small>${row.expanded ? `已展开 ${row.tasks.length} 个节点` : `当前任务：${escapeHtml(task.name)}`}</small>
        </div>
      </td>
      <td class="task-name-column"><span class="task-line-clamp task-name-text">${escapeHtml(task.name)}</span></td>
      <td class="task-executor-column">${findName(people, task.ownerId, "未设置")}</td>
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
          ${canRestoreTask(task) ? renderActionButton("恢复为待执行", "restore-task", task.id) : ""}
        </span>
      </td>
    </tr>
    ${
      row.expanded
        ? row.tasks
            .map((childTask, childIndex) =>
              renderTaskRow(childTask, childIndex, {
                child: true,
                childLabel: `${childIndex + 1}.`,
                numberText: `${index + 1}.${childIndex + 1}`,
              }),
            )
            .join("")
        : ""
    }
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

function getTaskProgressStatusPriority(status) {
  if (status === TaskStatus.Doing) return 1;
  if (status === TaskStatus.PendingAcceptance) return 2;
  if (status === TaskStatus.Todo) return 3;
  if (status === TaskStatus.Waiting) return 4;
  return 9;
}

function getCurrentTaskOfProcess(processTasks) {
  const activeTasks = processTasks.filter((task) => !isDoneStatus(task.status) && !isCanceledStatus(task.status));
  if (activeTasks.length === 0) return null;

  return sortProcessTasks(activeTasks).sort((left, right) => {
    const leftNode = getProcessNode(left);
    const rightNode = getProcessNode(right);
    const stepDifference = getProcessNodeStepOrder(leftNode ?? left) - getProcessNodeStepOrder(rightNode ?? right);
    if (stepDifference !== 0) return stepDifference;
    const statusDifference = getTaskProgressStatusPriority(left.status) - getTaskProgressStatusPriority(right.status);
    if (statusDifference !== 0) return statusDifference;
    return String(left.createdAt ?? left.dueDate ?? "").localeCompare(String(right.createdAt ?? right.dueDate ?? ""));
  })[0] ?? null;
}

function getProcessGroupTitle(instance, processTasks) {
  if (instance?.name) return instance.name;
  if (instance !== null && instance !== undefined) return getStandardWorkName(instance);
  const template = getTaskTemplateForTask(processTasks[0] ?? {});
  return template?.name ?? "未命名流程";
}

function getTaskTableRows() {
  const filteredTasks = getFilteredTasks();
  if (taskDueDateSort === "asc") {
    return sortTaskTableRows(filteredTasks.map((task, index) => ({ type: "task", task, order: index })));
  }

  const processGroups = new Map();
  const rows = [];

  filteredTasks.forEach((task, index) => {
    if (task.processInstanceId === null || task.processInstanceId === undefined || task.processInstanceId === "") {
      rows.push({ type: "task", task, order: index });
      return;
    }

    const group = processGroups.get(task.processInstanceId) ?? {
      type: "process-group",
      processInstanceId: task.processInstanceId,
      tasks: [],
      order: index,
    };
    group.tasks.push(task);
    group.order = Math.min(group.order, index);
    processGroups.set(task.processInstanceId, group);
  });

  processGroups.forEach((group) => {
    const sortedTasks = sortProcessTasks(group.tasks);
    const currentTask = getCurrentTaskOfProcess(sortedTasks) ?? sortedTasks[sortedTasks.length - 1] ?? sortedTasks[0] ?? null;
    if (currentTask === null) return;

    rows.push({
      ...group,
      tasks: sortedTasks,
      instance: state.processInstances.find((item) => item.id === group.processInstanceId) ?? null,
      currentTask,
      expanded: expandAllTaskGroups || expandedProcessTaskGroups.has(group.processInstanceId),
    });
  });

  return sortTaskTableRows(rows);
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

    if (template === null) errors.push("未找到已启用的【库存清仓】标准工作");
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

async function persistStartedProcess(result) {
  await createPersistentResource("process-instances", result.instance);
  const generatedTasks = state.tasks.filter((task) => task.processInstanceId === result.instance.id);
  for (const task of generatedTasks) {
    await createPersistentResource("tasks", task);
  }
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
    modalState = { ...modalState, error: "未找到已启用的【库存清仓】标准工作。" };
    rerender();
    return;
  }
  if (!template.defaultProcessTemplateId) {
    modalState = { ...modalState, error: "【库存清仓】标准工作尚未绑定标准流程。" };
    rerender();
    return;
  }

  const originalInstances = [...state.processInstances];
  const originalTasks = [...state.tasks];
  const importedInstances = [];

  try {
    for (const row of validRows) {
      const customFields = getClearanceImportCustomFields(row.data);
      const goal = getClearanceGoalByName(row.data.关联目标);
      const initiator = getClearanceInitiatorByName(row.data.发起人);
      const displayTitle = buildDisplayTitle(template, customFields);
      const result = startProcess({
        templateId: template.defaultProcessTemplateId,
        taskTemplateId: template.id,
        customFields,
        displayTitle,
        coverImageUrl: getPrimaryImageUrl({ customFields }) || null,
        name: displayTitle,
        goalId: goal?.id ?? "",
        initiatorId: initiator?.id ?? "",
        description: template.description || `库存清仓：${row.data.清仓产品}`,
        launchAssignments: buildLaunchAssignments(template.defaultProcessTemplateId, template, initiator?.id ?? ""),
      });

      if (result.error !== undefined) throw new Error(result.error);
      await persistStartedProcess(result);
      importedInstances.push(result.instance);
    }
  } catch (error) {
    state.processInstances = originalInstances;
    state.tasks = originalTasks;
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
    return `<div class="empty-detail compact-empty">暂无流程步骤任务</div>`;
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
                    ${canRestoreTask(task) ? renderActionButton("恢复为待执行", "restore-task", task.id) : ""}
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
  const expandedIcon = group.expanded ? "▾" : "▸";
  const currentTaskName = currentTask === null ? getProcessCurrentStepText(group.instance ?? {}) : currentTask.name;
  const currentOwner = currentTask === null ? "未设置" : findName(people, currentTask.ownerId, "未设置");
  const currentDueDate = formatBusinessMinuteDateTime(currentTask?.dueDate ?? info.dueDate, "未填写");
  const currentStatus = currentTask === null ? processInstanceStatusNames[status] ?? status : taskStatusNames[currentTask.status] ?? currentTask.status;

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
            <span class="status-pill ${getTaskStatusClass(status)}">${processInstanceStatusNames[status] ?? taskStatusNames[status] ?? status}</span>
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
        <span><b>当前任务节点</b>${escapeHtml(currentTaskName ?? "暂无执行任务")}</span>
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
          <p class="form-note">集中查看库存清仓标准工作产生的流程和执行任务；批量导入可在“产品图”列填写图片地址，或在对应行插入图片。</p>
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
  return rows.flatMap((row) => {
    if (row.type === "task") return [row.task.id];
    if (row.expanded) return row.tasks.map((task) => task.id);
    return [row.currentTask.id];
  });
}

function getProcessProgress(processInstanceId) {
  const processTasks = getProcessTasks(processInstanceId);
  const done = processTasks.filter((task) => task.status === TaskStatus.Done).length;
  const total = processTasks.length;

  return { done, total, text: `${done}/${total}` };
}

function getCurrentSteps(processInstanceId) {
  const processTasks = sortProcessTasks(getProcessTasks(processInstanceId));
  const executableTasks = processTasks.filter((task) => task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled && task.status !== TaskStatus.Waiting);

  if (executableTasks.length > 0) {
    return [executableTasks[0]];
  }

  return [];
}

function getWaitingProcessTasks(processInstanceId) {
  return sortProcessTasks(getProcessTasks(processInstanceId)).filter((task) => task.status === TaskStatus.Waiting);
}

function isProcessOverdue(processInstanceId) {
  return getProcessTasks(processInstanceId).some((task) => task.status !== TaskStatus.Canceled && (isTaskOverdue(task, today) || hasTaskOverdueRecord(task)));
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

  return "暂无执行任务";
}

function getProcessCurrentOwners(instance) {
  const ownerNames = Array.from(
    new Set(getCurrentSteps(instance.id).map((task) => findName(people, task.ownerId, "未设置"))),
  ).filter(Boolean);

  if (ownerNames.length > 0) return ownerNames.join("、");
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
  if (taskTemplateId === null) return "未关联标准工作";
  return getTaskTemplate(taskTemplateId)?.name ?? "未关联标准工作";
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
  if (processProgressFilters.status !== "" && instance.status !== processProgressFilters.status) return false;
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
  filters = { ...filters, source: "", goalId: "", categoryId: "", quadrant: "" };
  return `
    <form class="task-filters task-list-filters" aria-label="任务筛选">
      <label>
        <span>关键词</span>
        <input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="搜索执行任务名称" />
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
        <span>是否逾期</span>
        <select name="overdue">
          <option value="">全部</option>
          <option value="yes" ${filters.overdue === "yes" ? "selected" : ""}>已逾期</option>
          <option value="no" ${filters.overdue === "no" ? "selected" : ""}>未逾期</option>
        </select>
      </label>
      <div class="task-filter-options">
        <label class="checkbox-field task-filter-checkbox">
          <input name="showDone" type="checkbox" ${filters.showDone ? "checked" : ""} />
          <span>显示已完成</span>
        </label>
        <label class="checkbox-field task-filter-checkbox">
          <input name="showCanceled" type="checkbox" ${filters.showCanceled ? "checked" : ""} />
          <span>显示已取消</span>
        </label>
        <label class="checkbox-field task-filter-checkbox">
          <input name="expandAllGroups" type="checkbox" ${expandAllTaskGroups ? "checked" : ""} />
          <span>全部展开</span>
        </label>
      </div>
    </form>
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
  return instance !== null && isCanceledStatus(instance.status) && canCurrentUser("workPlans.editFuture");
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
        <strong>已选择 ${selectedCount} 条执行任务</strong>
        <span class="row-actions">
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
                ? `<tr><td colspan="12">暂无匹配的执行任务</td></tr>`
                : tableRows
                    .map((row, index) => (row.type === "task" ? renderTaskRow(row.task, index) : renderProcessTaskGroupRow(row, index)))
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTaskTemplateTable(selectedProcessTemplateId = "") {
  const visibleTemplates = state.taskTemplates.filter((template) => !hiddenLegacyStandardWorkNames.includes(template.name));

  return `
    <section class="settings-section">
      <div class="section-heading with-actions">
        <h2>标准工作库</h2>
        <p class="form-note">标准工作库用于维护公司允许发起的标准工作事项。标准工作事项不是员工直接执行的任务，而是发起流程或生成执行任务的入口。</p>
        <button class="primary-button" type="button" data-action="add-task-template">新增标准工作事项</button>
      </div>
      ${renderStandardWorkMoveStatus()}
      <div class="standard-work-board-wrap">
        <div class="standard-work-board">
          ${getStandardWorkValueChainColumns()
            .map((column) => {
              const columnTemplates = visibleTemplates.filter((template) => template.categoryId === column.id);
              return `
                <section class="standard-work-column" data-standard-work-category-id="${escapeHtml(column.id)}">
                  <div class="standard-work-column-header">
                    <h3>${column.title}</h3>
                    <span>${columnTemplates.length} 项</span>
                  </div>
                  <div class="standard-work-card-list" data-standard-work-drop-zone="${escapeHtml(column.id)}">
                    ${
                      columnTemplates.length === 0
                        ? `<div class="standard-work-drop-hint">拖到这里</div>`
                        : `${columnTemplates.map((template) => renderStandardWorkCard(template, selectedProcessTemplateId)).join("")}
                          <div class="standard-work-drop-hint">拖到这里归入${escapeHtml(column.title)}</div>`
                    }
                  </div>
                </section>
              `;
            })
            .join("")}
        </div>
      </div>
      <p class="form-note">可拖动标准工作卡片到其他价值链分类中，调整后会保存到标准工作库。</p>
    </section>
  `;
}

export function renderStandardWorkLibraryPage(selectedProcessTemplateId = "") {
  return `
    <div class="standard-work-library-host">
      ${renderTaskTemplateTable(selectedProcessTemplateId)}
      ${renderTaskTemplateModal()}
    </div>
  `;
}

function renderStandardWorkCard(template, selectedProcessTemplateId = "") {
  const isSelected = template.defaultProcessTemplateId !== undefined && template.defaultProcessTemplateId === selectedProcessTemplateId;
  const draggable = canCurrentUser("settings.editStandardWorks") ? ` draggable="true"` : "";
  const stepCount = getStandardWorkStepCount(template);
  return `
    <article class="standard-work-card ${isSelected ? "is-selected" : ""}"${draggable} data-standard-work-template-id="${escapeHtml(template.id)}" data-process-template-id="${escapeHtml(template.defaultProcessTemplateId ?? "")}">
      <div class="standard-work-card-title">
        <h4>${escapeHtml(template.name)}</h4>
        <span class="status-pill ${template.status === TaskTemplateStatus.Inactive ? "is-inactive" : ""}">${taskTemplateStatusNames[template.status]}</span>
      </div>
      <div class="standard-work-card-meta">
        <span>负责人</span>
        <strong>${findName(people, template.ownerId, "未设置")}</strong>
        <span class="standard-work-step-count">${stepCount} 步</span>
      </div>
      ${renderStandardWorkValueChainSelect(template)}
      <div class="standard-work-card-actions">
        ${renderTemplateActionButton("编辑", "edit-task-template", template.id)}
        ${
          template.status === TaskTemplateStatus.Active
            ? renderTemplateActionButton("停用", "deactivate-task-template", template.id, "danger-button")
            : ""
        }
        ${
          template.defaultProcessTemplateId
            ? renderTemplateActionButton("查看流程", "view-standard-work-process", template.id)
            : ""
        }
      </div>
    </article>
  `;
}

function renderProcessProgressFilters() {
  return `
    <form class="process-progress-filters task-filters" aria-label="标准工作流程进度筛选">
      <label>
        <span>关键词</span>
        <input name="keyword" value="${escapeHtml(processProgressFilters.keyword)}" placeholder="搜索本次工作、标准流程、目标" />
      </label>
      <label>
        <span>关联目标</span>
        <select name="goalId">${renderOptions(getActiveGoals(), processProgressFilters.goalId, "全部目标")}</select>
      </label>
      <label>
        <span>标准流程</span>
        <select name="templateId">${renderOptions(state.processTemplates, processProgressFilters.templateId, "全部标准流程")}</select>
      </label>
      <label>
        <span>状态</span>
        <select name="status">${renderValueOptions(ProcessInstanceStatus, processProgressFilters.status, processInstanceStatusNames, "全部状态")}</select>
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
        <h2>标准工作流程进度</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table process-progress-table">
          <thead>
            <tr>
              <th class="task-cover-column">产品图</th>
              <th>本次工作标题</th>
              <th>标准工作事项</th>
              <th>关联目标</th>
              <th>标准流程</th>
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
                ? `<tr><td colspan="14">暂无匹配的已发起流程</td></tr>`
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
                          <td><span class="status-pill">${processInstanceStatusNames[instance.status]}</span></td>
                          <td>${renderProcessOverdue(instance)}</td>
                          <td>${findName(people, instance.initiatorId, "未设置")}</td>
                          <td>${instance.startedAt}</td>
                          <td>
                            ${renderProcessActionButton("表单", "show-process-work-form", instance.id)}
                            ${
                              canCancelProcessInstance(instance)
                                ? renderProcessActionButton("取消流程", "cancel-process", instance.id, "danger-button")
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
    return `<p>暂无本次工作差异信息</p>`;
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
    return `<div class="empty-detail">暂无流程步骤执行任务</div>`;
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
            .map((task) => {
              const node = getProcessNode(task);
              return `
                <tr>
                  <td>${escapeHtml(task.name)}</td>
                  <td>${getProcessNodeStepOrder(node ?? {})}</td>
                  <td>${findName(people, task.ownerId, "未设置")}</td>
                  <td><span class="status-pill">${taskStatusNames[task.status]}</span></td>
                  <td>${formatBusinessMinuteDateTime(task.dueDate)}</td>
                  <td>${renderOverdue(task)}</td>
                  <td class="wide-text">${escapeHtml(task.completionStandard ?? node?.completionStandard ?? "-")}</td>
                  <td class="wide-text">${escapeHtml(task.reviewStandard ?? node?.reviewStandard ?? "-")}</td>
                  <td class="wide-text">${escapeHtml(task.resultText ?? "暂无")}</td>
                  <td>${task.completedAt ?? "未完成"}</td>
                  <td><button class="text-button" type="button" data-action="open-process-task" data-task-id="${task.id}">查看执行任务</button></td>
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
        <div class="section-heading"><h2>流程进度详情</h2></div>
        <div class="empty-detail">暂无已发起流程</div>
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

function renderWorkInfoValue(field, value) {
  if (Array.isArray(value)) return escapeHtml(value.join("、") || "-");
  if (value === null || value === undefined || value === "") return "-";
  if (field.type === "image") {
    return `<img class="inline-detail-image" src="${escapeHtml(resolveAssetUrl(value))}" alt="${escapeHtml(field.label)}" onerror="this.replaceWith('-')" />`;
  }
  if (field.type === "file" || field.type === "link" || field.type === "url") {
    return `<a href="${escapeHtml(resolveAssetUrl(value))}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`;
  }
  return escapeHtml(getCustomFieldValue({ [field.key]: value }, field));
}

function getExtraCustomFieldLabel(key) {
  if (key === "platform") return "上架平台（旧字段）";
  if (key === "storeName") return "上架店铺";
  return key;
}

function renderTaskWorkInfo(task, taskTemplate) {
  const customFields = getTaskCustomFields(task);
  const fields = getSortedFormFields(taskTemplate);
  const visibleKeys = new Set(fields.map((field) => field.key));
  const configuredRows = fields
    .map((field) => renderDetailField(field.label, renderWorkInfoValue(field, customFields[field.key])))
    .join("");
  const extraRows = Object.entries(customFields)
    .filter(
      ([key, value]) =>
        !visibleKeys.has(key) &&
        key !== "storeName" &&
        key !== standardWorkAttachmentsKey &&
        key !== returnRecordsKey &&
        key !== latestReturnReasonKey &&
        value !== null &&
        value !== undefined &&
        value !== "",
    )
    .map(([key, value]) => renderDetailField(getExtraCustomFieldLabel(key), escapeHtml(Array.isArray(value) ? value.join("、") : value)))
    .join("");

  if (configuredRows === "" && extraRows === "") return `<p>暂无本次工作信息</p>`;
  return `<div class="detail-grid">${configuredRows}${extraRows}</div>`;
}

function renderReturnRecordsBlock(task) {
  const records = getReturnRecords(task);
  if (records.length === 0) return "";

  return `
    <div class="detail-block">
      <h3>退回记录</h3>
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
  if (requirement.submitType === SubmitType.None) {
    return `
      <div class="detail-block">
        <h3>提交结果</h3>
        <p>本步骤无需提交结果。</p>
      </div>
    `;
  }

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

  return `
    <div class="detail-block">
      <div class="section-heading with-actions compact-heading">
        <h3>提交结果</h3>
        ${editable && canCurrentUser("tasks.submitResult") ? renderActionButton("填写提交结果", "submit-result", task.id) : ""}
      </div>
      <p>提交类型：${submitTypeNames[requirement.submitType] ?? "填写表单"}</p>
      <p>提交说明：${escapeHtml(requirement.submitDescription ?? "")}</p>
      ${formRows === "" ? "" : `<div class="detail-grid">${formRows}</div>`}
      <div class="submit-file-preview">
        <p>上传文件：</p>
        ${fileRows}
      </div>
      <p>提交链接：${linkRows}</p>
      <p>提交时间：${task.submittedAt ?? "未提交"}</p>
      <p>提交人：${findName(people, task.submittedBy, "未记录")}</p>
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
  if (previousTask === null) return "";
  const files = getTaskSubmittedFiles(previousTask);
  const resultText = previousTask.resultText === null || previousTask.resultText === undefined || previousTask.resultText === ""
    ? "暂无"
    : previousTask.resultText;

  return `
    <div class="detail-block">
      <h3>前步任务提交结果</h3>
      <div class="detail-grid">
        ${renderDetailField("前步任务", escapeHtml(previousTask.name))}
        ${renderDetailField("任务状态", escapeHtml(taskStatusNames[previousTask.status] ?? previousTask.status ?? "未记录"))}
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
    </div>
  `;
}

function renderPreviousTaskFilesBlock(task) {
  return renderPreviousTaskSubmissionBlock(task);
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

function renderTaskDetail() {
  const selectedTask = getTask(selectedTaskId) ?? getFilteredTasks()[0] ?? null;

  if (selectedTask === null) {
    return `
      <section class="settings-section task-detail">
        <div class="section-heading">
          <h2>执行任务详情</h2>
        </div>
        <div class="empty-detail">暂无匹配任务</div>
      </section>
    `;
  }

  const processText =
    selectedTask.source === TaskSource.Process
      ? `已发起流程：${selectedTask.processInstanceId}；流程步骤：${selectedTask.processNodeId}`
      : "无";
  const resultAttachments = selectedTask.resultAttachments ?? [];
  const attachments = renderAttachmentPreviewList(resultAttachments, "无");
  const taskTemplate = getTaskTemplateForTask(selectedTask);
  const coverImageUrl = getTaskCoverImage(selectedTask);
  const belonging = getTaskBelonging(selectedTask);

  return `
    <section class="settings-section task-detail">
      <div class="section-heading with-actions">
        <h2>${escapeHtml(selectedTask.name)}</h2>
        <div class="section-actions">
          ${canEditTask(selectedTask) ? renderActionButton("编辑", "edit-task", selectedTask.id) : ""}
          ${selectedTask.processNodeId ? getMethodologyLinkByNodeId(selectedTask.processNodeId) : ""}
          ${canCancelTask(selectedTask) ? renderActionButton("取消", "cancel-task", selectedTask.id, "danger-button") : ""}
          ${canRestoreTask(selectedTask) ? renderActionButton("恢复为待执行", "restore-task", selectedTask.id) : ""}
        </div>
      </div>
      <div class="task-primary-actions">
        <div class="row-actions">${renderStatusActions(selectedTask) || "<span class=\"muted-action\">暂无可用操作</span>"}</div>
      </div>
      <div class="detail-block">
        <h3>本次任务信息</h3>
        <div class="task-work-overview">
          <div class="task-image-detail">
            ${
              coverImageUrl === ""
                ? `<div class="task-image-empty">暂无产品图片</div>`
                : `<img src="${escapeHtml(resolveAssetUrl(coverImageUrl))}" alt="相关产品图片" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'task-image-empty', textContent: '图片无法预览' }))" />`
            }
          </div>
          <div class="task-work-main">
            <div class="detail-grid">
              ${renderDetailField("本次工作标题", escapeHtml(belonging.title || selectedTask.name || "无"))}
              ${renderDetailField("归属标准工作", escapeHtml(belonging.standardWorkName))}
              ${renderDetailField("当前任务节点", escapeHtml(selectedTask.name))}
              ${renderDetailField("任务来源", taskSourceNames[selectedTask.source])}
            </div>
            ${renderTaskWorkInfo(selectedTask, taskTemplate)}
          </div>
        </div>
      </div>
      <div class="detail-block">
        <h3>关联模板</h3>
        ${renderTaskLinkedTemplateSummary(selectedTask.templateId ?? "", "detail")}
      </div>
      ${renderStandardWorkAttachmentsBlock(getTaskCustomFields(selectedTask))}
      ${renderPreviousTaskFilesBlock(selectedTask)}
      ${renderTaskSubmitResultDetail(selectedTask)}
      <div class="detail-block">
        <h3>执行结果</h3>
        <p>完成结果说明：${escapeHtml(selectedTask.resultText ?? "暂无")}</p>
        <div class="submit-file-preview">
          <p>结果附件：</p>
          ${attachments}
        </div>
        <p>完成时间：${selectedTask.completedAt ?? "未完成"}</p>
      </div>
      <div class="detail-block">
        <h3>任务状态</h3>
        <div class="detail-grid">
          ${renderDetailField("当前状态", taskStatusNames[selectedTask.status])}
          ${renderDetailField("执行人", findName(people, selectedTask.ownerId, "未设置"))}
          ${renderDetailField("负责部门", findName(departments, selectedTask.departmentId, "未设置"))}
          ${renderDetailField("截止时间", formatBusinessMinuteDateTime(selectedTask.dueDate))}
          ${renderDetailField("是否逾期", isTaskOverdue(selectedTask) || hasTaskOverdueRecord(selectedTask) ? "已逾期" : "未逾期")}
          ${renderDetailField("计划周", selectedTask.plannedWeek ?? "未安排")}
          ${renderDetailField("发起人", findName(people, selectedTask.initiatorId, "未设置"))}
          ${renderDetailField("验收人", selectedTask.needAcceptance ? findName(people, selectedTask.accepterId, "未设置") : "无需验收")}
        </div>
      </div>
      <div class="detail-block">
        <h3>执行要求</h3>
        <p>流程节点：${getTaskProcessStepName(selectedTask)}</p>
        <p>任务说明：${escapeHtml(selectedTask.description || "未填写")}</p>
        <p>完成标准：${escapeHtml(selectedTask.completionStandard || "未填写")}</p>
        ${
          selectedTask.reviewStandard === undefined || selectedTask.reviewStandard === null || selectedTask.reviewStandard === ""
            ? ""
            : `<p>${selectedTask.source === TaskSource.Process ? "步骤审核标准" : "审核标准"}：${escapeHtml(selectedTask.reviewStandard)}</p>`
        }
        <div class="row-actions task-status-actions">
          ${selectedTask.processNodeId ? getMethodologyLinkByNodeId(selectedTask.processNodeId) : "<span class=\"muted-action\">暂无关联方法论</span>"}
        </div>
      </div>
      ${renderReturnRecordsBlock(selectedTask)}
      <div class="detail-block">
        <h3>关联信息</h3>
        <div class="detail-grid">
          ${renderDetailField("所属标准流程", getTaskProcessTemplateName(selectedTask))}
          ${renderDetailField("所属流程步骤", getTaskProcessStepName(selectedTask))}
          ${renderDetailField("关联目标", findName(goals, selectedTask.goalId, "未设置"))}
          ${renderDetailField("四象限", getTaskQuadrant(selectedTask.importance, selectedTask.urgency))}
        </div>
        <p>${processText}</p>
      </div>
    </section>
  `;
}

function renderTaskDetailModal() {
  if (modalState === null || modalState.kind !== "taskDetail") return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal task-detail-modal" role="dialog" aria-modal="true" aria-label="执行任务详情">
        <div class="modal-header">
          <h2>执行任务详情</h2>
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
  const customFields = instance?.customFields ?? task?.customFields ?? {};

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
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="本次工作表单">
        <div class="modal-header">
          <div>
            <h2>本次工作表单</h2>
            <p class="form-note">
              ${escapeHtml(taskTemplate?.name ?? "未关联标准工作事项")}
              ${instance === null ? "" : `｜${escapeHtml(instance.displayTitle ?? instance.name)}`}
              ${instance?.goalId ? `｜${escapeHtml(findName(goals, instance.goalId, "未设置目标"))}` : ""}
            </p>
          </div>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        <div class="detail-block">
          ${renderWorkFormViewer({
            formFields: taskTemplate?.formFields ?? [],
            customFields,
          })}
        </div>
        <p class="form-note">本表单为发起工作时填写的本次工作要求，不是执行结果。</p>
        ${
          task !== null
            ? `<p class="form-note">当前执行任务：${escapeHtml(task.name)}</p>`
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
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="取消流程">
        <div class="modal-header">
          <div>
            <h2>取消流程</h2>
            <p class="form-note">${escapeHtml(getProcessDisplayTitle(instance))}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
        <form class="modal-form cancel-process-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error)}</div>
          <p>确定要取消这个流程吗？</p>
          <p class="form-note">取消后，该流程下所有未完成的执行任务都会一并取消；已完成任务会保留完成状态。</p>
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
                  return `<option value="${targetTask.id}" ${selected}>步骤${index + 1}：${escapeHtml(targetTask.name)}</option>`;
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
    return `<p class="form-note">请选择标准工作事项后查看自动带出的锁定信息。</p>`;
  }

  return `
    <div class="locked-template-info">
      ${renderDetailField("标准工作名称", escapeHtml(template.name))}
      ${renderDetailField("价值链模块", getStandardWorkValueChain(template))}
      ${renderDetailField("对应标准流程", getProcessTemplateName(template.defaultProcessTemplateId))}
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
        ? "该价值链模块暂无标准工作事项"
        : "请选择标准工作事项";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "编辑执行任务" : "发起标准工作"}">
        <div class="modal-header">
          <h2>${isEdit ? "编辑执行任务" : "发起标准工作"}</h2>
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
                ${isProcessTask ? "<p class=\"form-note\">流程步骤生成的执行任务，其步骤完成标准来自标准流程；本次执行人可以按实际人员调整。</p>" : "<p class=\"form-note\">执行任务来自标准工作库，任务名称、负责部门和标准完成要求已锁定；本次执行人可以调整。</p>"}
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
                    <span>执行人</span>
                    <select name="ownerId">${renderOptions(people, effectiveTask?.ownerId ?? "", "请选择执行人")}</select>
                  </label>
                </div>
                ${renderCustomFieldsForm(editTemplate, getTaskCustomFields(effectiveTask))}
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
                    <span>选择标准工作事项</span>
                    <select name="taskTemplateId" data-task-template-select ${selectedCategoryId === "" ? "disabled" : ""}>
                      ${renderOptions(availableTemplates, modalState.taskTemplateId ?? "", templateHint)}
                    </select>
                  </label>
                  <label>
                    <span>发起人</span>
                    <select name="initiatorId">${renderOptions(people, "", "请选择发起人")}</select>
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
            ${
              isEdit
                ? `
                  <label>
                    <span>重要性</span>
                    <select name="importance">${renderValueOptions(TaskImportance, effectiveTask?.importance ?? "", taskImportanceNames, "请选择重要性")}</select>
                  </label>
                  <label>
                    <span>紧急性</span>
                    <select name="urgency">${renderValueOptions(TaskUrgency, effectiveTask?.urgency ?? "", taskUrgencyNames, "请选择紧急性")}</select>
                  </label>
                `
                : ""
            }
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

function getEditingTaskTemplate() {
  return modalState?.templateId === undefined ? null : getTaskTemplate(modalState.templateId);
}

const templateFieldTypes = ["text", "textarea", "select", "date", "datetime_hour", "number", "image", "file", "link"];

function normalizeTemplateFormFields(fields = []) {
  return [...fields]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((field, index) => ({
      id: field.id || createId("field"),
      label: field.label ?? "",
      key: field.key ?? field.id ?? "",
      type: field.type ?? "text",
      required: false,
      placeholder: field.placeholder ?? "",
      options: Array.isArray(field.options) ? field.options : [],
      showInList: field.showInList !== false,
      sortOrder: index + 1,
    }));
}

function createDefaultTemplateFormFields() {
  return normalizeTemplateFormFields([
    {
      id: createId("field"),
      label: "工作对象",
      key: "workObject",
      type: "text",
      required: false,
      placeholder: "例如产品名、页面名、岗位名、事项名",
      options: [],
      showInList: true,
      sortOrder: 1,
    },
    {
      id: createId("field"),
      label: "产品图",
      key: "coverImageUrl",
      type: "image",
      required: false,
      placeholder: "上传1:1产品图",
      options: [],
      showInList: true,
      sortOrder: 2,
    },
    {
      id: createId("field"),
      label: "本次工作要求",
      key: "workRequirement",
      type: "textarea",
      required: false,
      placeholder: "补充本次工作的特殊要求",
      options: [],
      showInList: false,
      sortOrder: 3,
    },
  ]);
}

function getTemplateFormFieldsDraft() {
  if (modalState?.formFieldsDraft !== undefined) return modalState.formFieldsDraft;
  const template = getEditingTaskTemplate();
  return template === null ? createDefaultTemplateFormFields() : normalizeTemplateFormFields(template.formFields ?? []);
}

function parseOptionsText(value) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectTemplateFormFields(form) {
  const rows = [...form.querySelectorAll("[data-template-field-row]")];
  return rows.map((row, index) => ({
    id: row.querySelector("[name='fieldId']")?.value || createId("field"),
    label: row.querySelector("[name='fieldLabel']")?.value.trim() ?? "",
    key: row.querySelector("[name='fieldKey']")?.value.trim() ?? "",
    type: row.querySelector("[name='fieldType']")?.value ?? "text",
    required: false,
    placeholder: row.querySelector("[name='fieldPlaceholder']")?.value.trim() ?? "",
    options: parseOptionsText(row.querySelector("[name='fieldOptions']")?.value ?? ""),
    showInList: row.querySelector("[name='fieldShowInList']")?.checked ?? false,
    sortOrder: index + 1,
  }));
}

function validateTemplateFormFields(fields) {
  const keys = new Set();
  for (const field of fields) {
    if (field.label === "" && field.key === "") continue;
    if (field.label === "") field.label = field.key;
    if (field.key === "") field.key = `field_${keys.size + 1}`;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.key)) return `字段 ${field.label} 的 key 只能使用英文字母、数字和下划线，并且以字母开头。`;
    if (keys.has(field.key)) return `字段 key “${field.key}” 重复。`;
    keys.add(field.key);
    if (!templateFieldTypes.includes(field.type)) return `字段 ${field.label} 的类型无效。`;
  }
  return "";
}

function renderTemplateFormFieldEditor() {
  const fields = getTemplateFormFieldsDraft();
  return `
    <div class="template-custom-fields">
      <div class="section-heading with-actions compact-heading">
        <h3>定制表单</h3>
        <button class="secondary-button" type="button" data-action="add-task-template-field">新增字段</button>
      </div>
      <p class="form-note">选择该标准工作事项添加未来工作时，会按这里配置的字段显示表单，填写内容保存到本次工作信息。</p>
      <div class="template-field-editor">
        ${
          fields.length === 0
            ? `<div class="empty-note">暂无字段，请新增。</div>`
            : fields
                .map((field, index) => {
                  const optionText = (field.options ?? []).join("\n");
                  return `
                    <div class="template-field-row" data-template-field-row data-field-index="${index}">
                      <input name="fieldId" type="hidden" value="${escapeHtml(field.id)}" />
                      <label>
                        <span>字段名称</span>
                        <input name="fieldLabel" value="${escapeHtml(field.label)}" placeholder="例如 产品图" />
                      </label>
                      <label>
                        <span>字段 key</span>
                        <input name="fieldKey" value="${escapeHtml(field.key)}" placeholder="例如 coverImageUrl" />
                      </label>
                      <label>
                        <span>类型</span>
                        <select name="fieldType">
                          ${templateFieldTypes.map((type) => `<option value="${type}" ${field.type === type ? "selected" : ""}>${type}</option>`).join("")}
                        </select>
                      </label>
                      <label>
                        <span>提示文字</span>
                        <input name="fieldPlaceholder" value="${escapeHtml(field.placeholder ?? "")}" />
                      </label>
                      <label>
                        <span>选项</span>
                        <textarea name="fieldOptions" rows="2" placeholder="select 类型可一行一个选项">${escapeHtml(optionText)}</textarea>
                      </label>
                      <div class="field-row-flags">
                        <label class="checkbox-label"><input name="fieldShowInList" type="checkbox" ${field.showInList ? "checked" : ""} /><span>用于标题</span></label>
                      </div>
                      <div class="row-actions">
                        <button class="secondary-button" type="button" data-action="move-task-template-field-up" data-field-index="${index}" ${index === 0 ? "disabled" : ""}>上移</button>
                        <button class="secondary-button" type="button" data-action="move-task-template-field-down" data-field-index="${index}" ${index === fields.length - 1 ? "disabled" : ""}>下移</button>
                        <button class="danger-button" type="button" data-action="remove-task-template-field" data-field-index="${index}">删除</button>
                      </div>
                    </div>
                  `;
                })
                .join("")
        }
      </div>
    </div>
  `;
}

function renderTaskTemplateModal() {
  if (modalState === null || modalState.kind !== "taskTemplate") return "";

  const template = getEditingTaskTemplate();
  const isEdit = modalState.mode === "edit";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "编辑标准工作事项" : "新增标准工作事项"}">
        <div class="modal-header">
          <h2>${isEdit ? "编辑标准工作事项" : "新增标准工作事项"}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
            <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form task-template-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <label>
            <span>标准工作名称</span>
            <input name="name" value="${escapeHtml(template?.name ?? "")}" autocomplete="off" />
          </label>
          <div class="form-grid">
            <label>
              <span>价值链模块</span>
              <select name="categoryId">${renderOptions(getTaskCategories(), getTaskTemplateValueChainCategoryId(template), "请选择价值链模块")}</select>
            </label>
            ${
              isEdit
                ? `
                  <label>
                    <span>对应标准流程</span>
                    <select name="defaultProcessTemplateId">${renderProcessTemplateOptions(template?.defaultProcessTemplateId ?? "")}</select>
                  </label>
                `
                : `<p class="form-note">新建标准工作事项时，系统会自动创建同名标准流程，后续可在流程模块中编辑流程步骤。</p>`
            }
            <label>
              <span>固定负责部门</span>
              <select name="departmentId">${renderOptions(departments, template?.departmentId ?? "", "请选择部门")}</select>
            </label>
            <label>
              <span>固定负责人</span>
              <select name="ownerId">${renderOptions(people, template?.ownerId ?? "", "请选择负责人")}</select>
            </label>
            <label>
              <span>默认验收人</span>
              <select name="accepterId">${renderOptions(people, template?.accepterId ?? "", "无")}</select>
            </label>
            <label>
              <span>默认重要性</span>
              <select name="importance">${renderValueOptions(TaskImportance, template?.importance ?? "", taskImportanceNames, "请选择重要性")}</select>
            </label>
            <label>
              <span>默认紧急性</span>
              <select name="urgency">${renderValueOptions(TaskUrgency, template?.urgency ?? "", taskUrgencyNames, "请选择紧急性")}</select>
            </label>
            <label class="checkbox-label">
              <input name="needAcceptance" type="checkbox" ${template?.needAcceptance ? "checked" : ""} />
              <span>需要验收</span>
            </label>
          </div>
          <label>
            <span>标准任务说明</span>
            <textarea name="description" rows="3">${escapeHtml(template?.description ?? "")}</textarea>
          </label>
          <label>
            <span>标准完成要求</span>
            <textarea name="completionStandard" rows="3">${escapeHtml(template?.completionStandard ?? "")}</textarea>
          </label>
          ${renderTemplateFormFieldEditor()}
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
    goalId: formData.get("goalId")?.toString() ?? "",
    categoryId: formData.get("categoryId")?.toString() ?? "",
    quadrant: formData.get("quadrant")?.toString() ?? "",
    overdue: formData.get("overdue")?.toString() ?? "",
    showDone: formData.has("showDone"),
    showCanceled: formData.has("showCanceled"),
  };
  expandAllTaskGroups = formData.has("expandAllGroups");
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

function buildTaskTemplateDraft(form) {
  const formData = new FormData(form);

  return {
    name: getFormValue(form, "name"),
    categoryId: getFormValue(form, "categoryId") || null,
    defaultProcessTemplateId: getFormValue(form, "defaultProcessTemplateId"),
    departmentId: getFormValue(form, "departmentId"),
    ownerId: getFormValue(form, "ownerId"),
    description: getFormValue(form, "description"),
    completionStandard: getFormValue(form, "completionStandard"),
    importance: getFormValue(form, "importance"),
    urgency: getFormValue(form, "urgency"),
    needAcceptance: formData.has("needAcceptance"),
    accepterId: getFormValue(form, "accepterId") || null,
  };
}

function validateTaskTemplateDraft(draft) {
  if (!getTaskCategories().some((category) => category.id === draft.categoryId)) return "标准工作必须选择有效的价值链模块。";
  if (modalState.mode === "edit") {
    if (draft.defaultProcessTemplateId !== "") {
      const processTemplate = getProcessTemplateById(draft.defaultProcessTemplateId);
      if (processTemplate === null || processTemplate.status !== ProcessTemplateStatus.Active) return "对应标准流程必须是启用状态。";
    }
  }

  return "";
}

async function saveTaskTemplate(form, rerender) {
  const draft = buildTaskTemplateDraft(form);
  const formFields = normalizeTemplateFormFields(collectTemplateFormFields(form));
  const error = validateTaskTemplateDraft(draft);

  if (error !== "") return setModalError(error, rerender);
  const formFieldsError = validateTemplateFormFields(formFields);
  if (formFieldsError !== "") return setModalError(formFieldsError, rerender);

  const now = getNow();
  if (modalState.mode === "add") {
    const defaultProcessTemplateId = createOrReuseProcessTemplateForStandardWork({
      name: draft.name,
      ownerId: draft.ownerId,
      departmentId: draft.departmentId,
      now,
    });
    const defaultProcessTemplate = getProcessTemplateById(defaultProcessTemplateId);
    const createdTemplate = {
      id: createId("task-template"),
      ...draft,
      defaultProcessTemplateId,
      status: TaskTemplateStatus.Active,
      formFields,
      createdAt: now,
      updatedAt: now,
    };
    try {
      if (defaultProcessTemplate !== null) {
        await createPersistentResource("process-templates", defaultProcessTemplate);
      }
      await createPersistentResource("task-templates", createdTemplate);
    } catch (error) {
      console.error("标准工作事项保存失败", error);
      return setModalError(error.message || "标准工作事项保存失败，请检查本地数据库服务。", rerender);
    }
    state.taskTemplates = [createdTemplate, ...state.taskTemplates];
  } else {
    const oldTemplate = getTaskTemplate(modalState.templateId);
    if (oldTemplate === null) return setModalError("未找到要编辑的标准工作事项。", rerender);
    const boundProcessTemplate = getProcessTemplateById(draft.defaultProcessTemplateId || oldTemplate?.defaultProcessTemplateId || "");
    const shouldSyncProcessName =
      oldTemplate !== null &&
      boundProcessTemplate !== null &&
      draft.defaultProcessTemplateId === oldTemplate.defaultProcessTemplateId &&
      boundProcessTemplate.name === `${oldTemplate.name}流程` &&
      oldTemplate.name !== draft.name;
    const shouldNoticeProcessNameNotSynced =
      oldTemplate !== null &&
      boundProcessTemplate !== null &&
      draft.defaultProcessTemplateId === oldTemplate.defaultProcessTemplateId &&
      boundProcessTemplate.name !== `${oldTemplate.name}流程` &&
      oldTemplate.name !== draft.name;

    let updatedProcessTemplate = null;
    if (shouldSyncProcessName) {
      updatedProcessTemplate = { ...boundProcessTemplate, name: `${draft.name}流程`, updatedAt: now };
    }
    if (shouldNoticeProcessNameNotSynced) {
      window.alert("对应标准流程名称已被单独修改，本次未自动同步流程名称。");
    }

    const updatedTemplate = { ...oldTemplate, ...draft, formFields, updatedAt: now };
    try {
      if (updatedProcessTemplate !== null) {
        await updatePersistentResource("process-templates", updatedProcessTemplate.id, updatedProcessTemplate);
      }
      await updatePersistentResource("task-templates", updatedTemplate.id, updatedTemplate);
    } catch (error) {
      console.error("标准工作事项保存失败", error);
      return setModalError(error.message || "标准工作事项保存失败，请检查本地数据库服务。", rerender);
    }

    if (updatedProcessTemplate !== null) {
      state.processTemplates = state.processTemplates.map((processTemplate) =>
        processTemplate.id === updatedProcessTemplate.id ? updatedProcessTemplate : processTemplate,
      );
    }
    state.taskTemplates = state.taskTemplates.map((template) => (template.id === updatedTemplate.id ? updatedTemplate : template));
  }

  modalState = null;
  rerender();
}

function deactivateTaskTemplate(templateId, rerender) {
  if (!window.confirm("确定要停用该标准工作事项吗？停用后不能用于发起标准工作。停用标准工作事项不会删除对应标准流程，也不会影响历史已发起流程。")) return;

  const now = getNow();
  state.taskTemplates = state.taskTemplates.map((template) =>
    template.id === templateId ? { ...template, status: TaskTemplateStatus.Inactive, updatedAt: now } : template,
  );
  rerender();
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
      initiatorId: getFormValue(form, "initiatorId") || people[0]?.id || "",
      startDate: getFormValue(form, "startDate") || null,
      dueDate: dueDateResult.value,
      dueDateError: dueDateResult.error,
      plannedWeek: getFormValue(form, "plannedWeek") || null,
      remark,
    };
  }
  const template = getTaskTemplateForTask(task);
  const previousCustomFields = getTaskCustomFields(task);
  const customFields = template === null ? previousCustomFields : mergePreservedTaskCustomFields(previousCustomFields, collectCustomFields(form, template));

  return {
    ...task,
    customFields,
    templateId: getFormValue(form, "templateId") || modalState?.templateId || task.templateId || "",
    ownerId: getFormValue(form, "ownerId") || task.ownerId,
    description: getFormValue(form, "description"),
    importance: getFormValue(form, "importance") || task.importance,
    urgency: getFormValue(form, "urgency") || task.urgency,
    startDate: getFormValue(form, "startDate") || null,
    dueDate: dueDateResult.value,
    dueDateError: dueDateResult.error,
    plannedWeek: getFormValue(form, "plannedWeek") || null,
  };
}

function validateTaskDraft(draft, isAdd) {
  if (isAdd) {
    if (!isValueModuleId(draft.valueModuleId)) return "必须选择价值链模块。";
    if (draft.taskTemplateId === "" || draft.template === null) return "必须选择启用的标准工作事项。";
    if (draft.template.status !== TaskTemplateStatus.Active) return "停用的标准工作事项不能用于发起标准工作。";
    if (!draft.template.defaultProcessTemplateId) return "该标准工作事项尚未绑定标准流程，请先到标准工作库中配置。";
    const processTemplate = getProcessTemplateById(draft.template.defaultProcessTemplateId);
    if (processTemplate === null || processTemplate.status !== ProcessTemplateStatus.Active) return "该标准工作事项绑定的标准流程未启用。";
    const customError = validateCustomFields(draft.customFields, draft.template);
    if (customError !== "") return customError;
  }

  if (!isAdd) {
    const template = getTaskTemplateForTask(draft);
    if (template !== null) {
      const customError = validateCustomFields(draft.customFields, template);
      if (customError !== "") return customError;
    }
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
    const originalInstances = [...state.processInstances];
    const originalTasks = [...state.tasks];

    const result = startProcess({
      templateId: draft.template.defaultProcessTemplateId,
      taskTemplateId: draft.template.id,
      customFields: draft.customFields,
      displayTitle,
      coverImageUrl,
      name: displayTitle,
      goalId: draft.goalId,
      initiatorId: draft.initiatorId,
      description,
      launchAssignments: buildLaunchAssignments(draft.template.defaultProcessTemplateId, draft.template, draft.initiatorId),
    });

    if (result.error !== undefined) return setModalError(result.error, rerender);

    if (uploadedAttachments.length > 0) {
      const processTaskIds = state.tasks.filter((item) => item.processInstanceId === result.instance.id).map((item) => item.id);
      const attachments = uploadedAttachments.map((attachment) => ({
        originalName: attachment.originalName,
        filePath: attachment.filePath ?? attachment.url,
        url: attachment.url,
        mimeType: attachment.mimeType,
        ext: attachment.ext ?? getFileExt(attachment.originalName ?? attachment.filename ?? ""),
        uploadedAt: attachment.uploadedAt ?? getNow(),
        standardWorkId: draft.template.id,
        processInstanceId: result.instance.id,
        taskIds: processTaskIds,
      }));
      result.instance.customFields = {
        ...(result.instance.customFields ?? {}),
        [standardWorkAttachmentsKey]: attachments,
      };
    }

    try {
      await persistStartedProcess(result);
    } catch (error) {
      console.error("发起标准工作保存失败", error);
      state.processInstances = originalInstances;
      state.tasks = originalTasks;
      return setModalError(error.message || "发起标准工作保存失败，请检查本地数据库服务。", rerender);
    }

    selectedProcessInstanceId = result.instance.id;
    selectedTaskId = state.tasks.find((item) => item.processInstanceId === result.instance.id)?.id ?? selectedTaskId;
    activeTaskTab = "process-progress";
  } else {
    const now = getNow();
    const template = getTaskTemplateForTask(draft);
    const displayTitle = template === null ? draft.displayTitle ?? null : buildDisplayTitle(template, draft.customFields);
    const coverImageUrl = getPrimaryImageUrl({ customFields: draft.customFields }) || null;
    const updatedProcessInstance = buildUpdatedProcessInstanceForTaskForm(task, draft.customFields, displayTitle, coverImageUrl, now);
    const updatedTask = {
      ...task,
      customFields: draft.customFields,
      displayTitle,
      coverImageUrl,
      templateId: draft.templateId ?? task.templateId ?? "",
      ownerId: draft.ownerId,
      description: draft.description,
      importance: draft.importance,
      urgency: draft.urgency,
      startDate: draft.startDate,
      dueDate: draft.dueDate,
      plannedWeek: draft.plannedWeek,
      updatedAt: now,
    };
    try {
      if (updatedProcessInstance !== null) {
        await updatePersistentResource("process-instances", updatedProcessInstance.id, updatedProcessInstance);
      }
      await updatePersistentResource("tasks", updatedTask.id, updatedTask);
    } catch (error) {
      console.error("执行任务保存失败", error);
      return setModalError(error.message || "执行任务保存失败，请检查本地数据库服务。", rerender);
    }
    if (updatedProcessInstance !== null) {
      state.processInstances = state.processInstances.map((item) =>
        item.id === updatedProcessInstance.id ? updatedProcessInstance : item,
      );
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
  const submitError = validateSubmittedResult(task, { submitFormData, submitFiles, submitLinks });
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

  const updatedTask = markTaskOverdueRecordIfNeeded({
    ...task,
    resultText,
    resultAttachments,
    submitFormData,
    submitFiles,
    submitLinks,
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
  if (nextStatus === TaskStatus.Done) {
    try {
      await advanceProcessAfterTaskDone(modalState.taskId);
    } catch (error) {
      console.error("流程推进保存失败", error);
      return setModalError(error.message || "流程推进保存失败，请检查本地数据库服务。", rerender);
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
      console.error("流程任务激活失败", error);
      window.alert(error.message || "流程任务激活失败，请检查本地数据库服务。");
      rerender();
      return;
    }
    if (task === null) return;
  }

  if (task.status === status) {
    rerender();
    return;
  }

  if (isDoneStatus(task.status) && !window.confirm("该任务已完成，确定要修改它的状态吗？修改后可能影响流程记录。")) {
    rerender();
    return;
  }

  if (isCanceledStatus(task.status)) {
    const instance = getTaskProcessInstance(task);
    const message =
      instance !== null && isCanceledStatus(instance.status) && status !== TaskStatus.Canceled
        ? "所属流程已取消，建议重新发起流程。是否仍要仅修改该任务状态？"
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
    !window.confirm("确定要取消该执行任务吗？取消后历史记录仍会保留。")
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
  if (status === TaskStatus.Done) {
    try {
      await advanceProcessAfterTaskDone(taskId);
    } catch (error) {
      console.error("流程推进保存失败", error);
      window.alert(error.message || "流程推进保存失败，请检查本地数据库服务。");
      rerender();
      return;
    }
  }
  rerender();
}

function getTaskStatusChangeError(task, status) {
  if (task.source === TaskSource.Process && task.status === TaskStatus.Waiting && status !== TaskStatus.Canceled) {
    return "前置步骤未完成，当前步骤暂不能执行。";
  }
  return "";
}

function buildTaskStatusUpdate(task, status, now) {
  return markTaskOverdueRecordIfNeeded({
    ...task,
    status,
    updatedAt: now,
    completedAt: status === TaskStatus.Done ? now : null,
  }, now);
}

async function bulkUpdateTaskStatus(status, rerender) {
  if (status === TaskStatus.Done && !canCurrentUser("tasks.batchComplete")) return;
  if (status === TaskStatus.Canceled && !canCurrentUser("tasks.batchCancel")) return;
  const selectedTasks = [...selectedTaskIds].map(getTask).filter(Boolean);
  if (selectedTasks.length === 0) return;
  if (status === TaskStatus.Canceled && !window.confirm("确定要取消选中的执行任务吗？")) return;

  const now = getNow();
  const skipped = [];
  const updatedTasks = [];
  for (const selectedTask of selectedTasks) {
    let task = selectedTask;
    if (task.source === TaskSource.Process && task.status === TaskStatus.Waiting && status !== TaskStatus.Canceled) {
      try {
        await ensureTaskReadyForExecution(task.id);
        task = getTask(task.id) ?? task;
      } catch (error) {
        console.error("流程任务激活失败", error);
        skipped.push(task.name);
        continue;
      }
    }
    const error = getTaskStatusChangeError(task, status);
    if (error !== "") {
      skipped.push(task.name);
      continue;
    }
    if ([TaskStatus.Done, TaskStatus.PendingAcceptance].includes(status) && !hasValidSubmittedResult(task)) {
      skipped.push(task.name);
      continue;
    }
    updatedTasks.push(buildTaskStatusUpdate(task, status, now));
  }

  try {
    for (const updatedTask of updatedTasks) {
      await updatePersistentResource("tasks", updatedTask.id, updatedTask);
    }
  } catch (error) {
    console.error("批量修改任务状态失败", error);
    window.alert(error.message || "任务状态保存失败，请检查本地数据库服务。");
    rerender();
    return;
  }

  const updatedTaskMap = new Map(updatedTasks.map((task) => [task.id, task]));
  state.tasks = state.tasks.map((task) => updatedTaskMap.get(task.id) ?? task);
  if (status === TaskStatus.Done) {
    try {
      for (const task of updatedTasks) {
        await advanceProcessAfterTaskDone(task.id);
      }
    } catch (error) {
      console.error("流程推进保存失败", error);
      window.alert(error.message || "流程推进保存失败，请检查本地数据库服务。");
      rerender();
      return;
    }
  }

  selectedTaskIds = new Set();
  if (skipped.length > 0) {
    const reason = status === TaskStatus.Done ? "部分任务因前置步骤未完成或提交结果不完整，未能完成。" : `已修改 ${updatedTasks.length} 条任务，跳过 ${skipped.length} 条不可修改任务。`;
    window.alert(reason);
  }
  rerender();
}

async function cancelTask(taskId, rerender) {
  const task = getTask(taskId);

  if (task.source === TaskSource.Process) {
    window.alert("流程步骤生成的执行任务不能单独取消，需要在流程中终止。");
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
    window.alert("所属流程已取消，请重新发起流程。");
    return;
  }
  if (instance !== null && instance.status !== ProcessInstanceStatus.Running) {
    window.alert("所属流程不是进行中状态，不能单独恢复该任务。");
    return;
  }
  if (!window.confirm("确定要将该执行任务恢复为待执行吗？")) return;
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
  if (!window.confirm("确定基于该流程重新发起一条新工作吗？重新发起会创建一条新的工作，原取消记录会保留。")) return;
  const now = getNow();
  const workPlan = {
    id: createId("work-plan"),
    goalId: instance.goalId,
    departmentId: null,
    taskTemplateId: instance.taskTemplateId ?? instance.standardWorkId ?? "",
    title: `${getProcessDisplayTitle(instance)}（重新发起）`,
    customFields: { ...(instance.customFields ?? {}) },
    coverImageUrl: getPrimaryImageUrl(instance) || null,
    importance: TaskImportance.Important,
    urgency: TaskUrgency.NotUrgent,
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
  window.alert("已创建新的本周工作，请在本周工作中点击“发起工作”。");
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
  selectedTaskId = targetTask.id;
  modalState = null;
  rerender();
}

async function handleTaskAction(action, taskId, rerender) {
  const task = getTask(taskId);

  if (task === null) return;

  if (action === "view-task") {
    selectedTaskId = taskId;
    modalState = { kind: "taskDetail", taskId, error: "" };
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
    const updatedTask = { ...task, status: TaskStatus.Doing, completedAt: null, updatedAt: now };
    try {
      await updatePersistentResource("tasks", taskId, updatedTask);
    } catch (error) {
      console.error("退回任务保存失败", error);
      window.alert(error.message || "任务状态保存失败，请检查本地数据库服务。");
      return;
    }
    state.tasks = state.tasks.map((item) => (item.id === taskId ? updatedTask : item));
    rerender();
  }
}

function handleTaskTemplateAction(action, templateId, rerender) {
  if (action === "add-task-template") {
    modalState = { kind: "taskTemplate", mode: "add", error: "", formFieldsDraft: createDefaultTemplateFormFields() };
    rerender();
    return;
  }

  if (action === "edit-task-template") {
    const template = getTaskTemplate(templateId);
    modalState = { kind: "taskTemplate", mode: "edit", templateId, error: "", formFieldsDraft: normalizeTemplateFormFields(template?.formFields ?? []) };
    rerender();
    return;
  }

  if (action === "deactivate-task-template") {
    deactivateTaskTemplate(templateId, rerender);
    return;
  }

  if (action === "view-standard-work-process") {
    const template = getTaskTemplate(templateId);
    if (template?.defaultProcessTemplateId) {
      window.location.hash = `process-template-${template.defaultProcessTemplateId}`;
    }
  }
}

function syncTemplateFieldDraftFromForm() {
  const form = document.querySelector(".task-template-form");
  if (form === null || modalState?.kind !== "taskTemplate") return;
  modalState = { ...modalState, formFieldsDraft: normalizeTemplateFormFields(collectTemplateFormFields(form)) };
}

function handleTaskTemplateFieldAction(action, index, rerender) {
  if (modalState?.kind !== "taskTemplate") return false;
  syncTemplateFieldDraftFromForm();
  const fields = [...getTemplateFormFieldsDraft()];

  if (action === "add-task-template-field") {
    fields.push({
      id: createId("field"),
      label: "新字段",
      key: `field${fields.length + 1}`,
      type: "text",
      required: false,
      placeholder: "",
      options: [],
      showInList: false,
      sortOrder: fields.length + 1,
    });
  } else if (action === "remove-task-template-field") {
    fields.splice(index, 1);
  } else if (action === "move-task-template-field-up" && index > 0) {
    [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
  } else if (action === "move-task-template-field-down" && index < fields.length - 1) {
    [fields[index + 1], fields[index]] = [fields[index], fields[index + 1]];
  } else {
    return false;
  }

  modalState = { ...modalState, formFieldsDraft: normalizeTemplateFormFields(fields) };
  rerender();
  return true;
}

async function handleTaskSubmit(event, rerender) {
  event.preventDefault();

  if (modalState?.kind === "task") await saveTask(event.target, rerender);
  if (modalState?.kind === "result") await saveResult(event.target, rerender);
  if (modalState?.kind === "returnTask") await returnTaskToSelectedStep(event.target, rerender);
  if (modalState?.kind === "taskTemplate") await saveTaskTemplate(event.target, rerender);
}

async function moveStandardWorkToValueChain(templateId, categoryId, rerender) {
  if (!canCurrentUser("settings.editStandardWorks")) {
    window.alert("你没有权限调整标准工作的价值链模块。");
    return;
  }

  const template = getTaskTemplate(templateId);
  const category = getTaskCategories().find((item) => item.id === categoryId) ?? null;
  if (template === null || category === null) return;

  const previousCategoryId = template.categoryId ?? null;
  template.categoryId = category.id;
  standardWorkMoveStatus = { type: "saving", message: `正在保存到「${category.name}」...` };
  rerender();
  try {
    await moveTaskTemplateToValueChain(template.id, { id: category.id, name: category.name });
    const updatedTemplate = getTaskTemplate(template.id);
    if (updatedTemplate !== null) updatedTemplate.categoryId = category.id;
    standardWorkMoveStatus = { type: "success", message: `已保存到「${category.name}」，刷新后仍会保留。` };
    rerender();
  } catch (error) {
    const currentTemplate = getTaskTemplate(templateId);
    if (currentTemplate !== null) currentTemplate.categoryId = previousCategoryId;
    standardWorkMoveStatus = { type: "error", message: "分类保存失败，已恢复原分类。" };
    console.error("标准工作价值链模块保存失败", error);
    window.alert(error.message || "标准工作价值链模块保存失败，请检查本地数据库服务。");
    rerender();
  }
}

function clearStandardWorkDragState(host) {
  host.querySelectorAll(".standard-work-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
  host.querySelectorAll(".standard-work-column.is-drag-over").forEach((column) => column.classList.remove("is-drag-over"));
}

function getStandardWorkDropColumn(target) {
  return target?.closest?.("[data-standard-work-category-id]") ?? null;
}

let draggedStandardWorkTemplateId = "";
let didDragStandardWorkCard = false;

export function bindStandardWorkLibraryEvents(rerender, container = document) {
  const host = container.querySelector?.(".standard-work-library-host") ?? container;
  const taskTemplateForm = document.querySelector(".task-template-form");

  host.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".standard-work-card[draggable='true']");
    if (card === null) return;
    draggedStandardWorkTemplateId = card.dataset.standardWorkTemplateId ?? "";
    didDragStandardWorkCard = true;
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedStandardWorkTemplateId);
    }
    card.classList.add("is-dragging");
  });

  host.addEventListener("dragend", () => {
    clearStandardWorkDragState(host);
    draggedStandardWorkTemplateId = "";
    window.setTimeout(() => {
      didDragStandardWorkCard = false;
    }, 0);
  });

  host.addEventListener("dragover", (event) => {
    const column = getStandardWorkDropColumn(event.target);
    if (column === null) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    host.querySelectorAll(".standard-work-column.is-drag-over").forEach((item) => {
      if (item !== column) item.classList.remove("is-drag-over");
    });
    column.classList.add("is-drag-over");
  });

  host.addEventListener("dragleave", (event) => {
    const column = getStandardWorkDropColumn(event.target);
    if (column !== null && !column.contains(event.relatedTarget)) column.classList.remove("is-drag-over");
  });

  host.addEventListener("drop", async (event) => {
    const column = getStandardWorkDropColumn(event.target);
    if (column === null) return;
    event.preventDefault();
    const templateId = event.dataTransfer?.getData("text/plain") || draggedStandardWorkTemplateId;
    clearStandardWorkDragState(host);
    await moveStandardWorkToValueChain(templateId, column.dataset.standardWorkCategoryId ?? "", rerender);
    draggedStandardWorkTemplateId = "";
    didDragStandardWorkCard = false;
  });

  host.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-action='change-standard-work-value-chain']");
    if (select === null) return;
    await moveStandardWorkToValueChain(select.dataset.templateId ?? "", select.value ?? "", rerender);
  });

  host.addEventListener("click", (event) => {
    if (didDragStandardWorkCard) {
      event.preventDefault();
      didDragStandardWorkCard = false;
      return;
    }

    const actionButton = event.target.closest("[data-action]");

    if (actionButton === null) {
      const card = event.target.closest("[data-standard-work-template-id]");
      const processTemplateId = card?.dataset.processTemplateId ?? "";
      if (processTemplateId !== "") {
        window.location.hash = `process-template-${processTemplateId}`;
      }
      return;
    }

    const action = actionButton.dataset.action;
    if (action === "close-task-modal") {
      modalState = null;
      rerender();
      return;
    }

    if (action === "remove-selected-standard-work-attachment") {
      removeSelectedStandardWorkAttachment(actionButton);
      return;
    }

    if (action === "show-task-work-form") {
      modalState = { kind: "workForm", taskId: actionButton.dataset.taskId };
      rerender();
      return;
    }
    if (handleTaskTemplateFieldAction(action, Number(actionButton.dataset.fieldIndex ?? -1), rerender)) return;
    handleTaskTemplateAction(action, actionButton.dataset.templateId, rerender);
  });

  if (taskTemplateForm !== null) {
    taskTemplateForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
  }
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
  const taskTemplateForm = document.querySelector(".task-template-form");
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
          window.alert(instance?.status === ProcessInstanceStatus.Done ? "已完成流程不能取消。" : "该流程当前不能取消。");
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
          console.error("取消流程失败", error);
          modalState = {
            ...modalState,
            cancelReason,
            error: error.message || "取消流程失败，请检查本地数据库服务。",
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

  if (activeTaskTab === "task-library") {
    bindStandardWorkLibraryEvents(rerender, tasksPage);
    return;
  }

  if (filterForm === null) return;

  document.querySelectorAll("[data-task-select-all]").forEach((checkbox) => {
    checkbox.indeterminate = checkbox.dataset.indeterminate === "true";
  });

  filterForm.addEventListener("input", () => {
    updateFilters(filterForm);
    const firstRow = getTaskTableRows()[0];
    selectedTaskId = firstRow?.type === "process-group" ? firstRow.currentTask.id : firstRow?.task.id ?? null;
    rerender();
  });
  filterForm.addEventListener("change", () => {
    updateFilters(filterForm);
    const firstRow = getTaskTableRows()[0];
    selectedTaskId = firstRow?.type === "process-group" ? firstRow.currentTask.id : firstRow?.task.id ?? null;
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
    if (event.target.closest("[data-task-status-select]") !== null) return;

    const actionButton = event.target.closest("[data-action]");

      if (actionButton !== null) {
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
      if (action === "toggle-task-group") {
        const processInstanceId = actionButton.dataset.processInstanceId;
        if (expandAllTaskGroups) {
          expandedProcessTaskGroups = new Set(
            getTaskTableRows()
              .filter((row) => row.type === "process-group")
              .map((row) => row.processInstanceId),
          );
          expandAllTaskGroups = false;
        } else {
          expandedProcessTaskGroups = new Set(expandedProcessTaskGroups);
        }
        if (expandedProcessTaskGroups.has(processInstanceId)) {
          expandedProcessTaskGroups.delete(processInstanceId);
        } else {
          expandedProcessTaskGroups.add(processInstanceId);
        }
        rerender();
        return;
      }

      if (actionButton.dataset.templateId !== undefined || action === "add-task-template") {
        handleTaskTemplateAction(action, actionButton.dataset.templateId, rerender);
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
  if (taskTemplateForm !== null) taskTemplateForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
  if (resultForm !== null) resultForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
  if (resultForm !== null) {
    resultForm.addEventListener("change", (event) => {
      if (event.target.matches("[data-submit-files]")) {
        renderSelectedSubmitFiles(event.target);
      }
    });
  }
  if (returnTaskForm !== null) returnTaskForm.addEventListener("submit", (event) => handleTaskSubmit(event, rerender));
}

export function renderTasksPage() {
  syncTaskTabFromHash();
  if (activeTaskTab === "task-library") activeTaskTab = "task-list";
  if (activeTaskTab === "task-list" && !canCurrentUser("tasks.view")) activeTaskTab = "process-progress";
  if (activeTaskTab === "clearance" && !canCurrentUser("tasks.view")) activeTaskTab = "process-progress";
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
      <div class="settings-tabs task-subtabs" aria-label="执行页签">
        ${canCurrentUser("tasks.view") ? `<button class="${activeTaskTab === "task-list" ? "is-active" : ""}" type="button" data-task-tab="task-list">执行任务列表</button>` : ""}
        ${canCurrentUser("tasks.view") ? `<button class="${activeTaskTab === "clearance" ? "is-active" : ""}" type="button" data-task-tab="clearance">库存清仓</button>` : ""}
        ${canCurrentUser("tasks.viewProcessProgress") ? `<button class="${activeTaskTab === "process-progress" ? "is-active" : ""}" type="button" data-task-tab="process-progress">标准工作流程进度</button>` : ""}
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
              ${renderFilters()}
              ${renderTaskTable()}
              ${renderTaskDetail()}
              ${renderTaskDetailModal()}
              ${renderTaskModal()}
              ${renderResultModal()}
              ${renderReturnTaskModal()}
              ${renderWorkFormModal()}
            `
      }
    </div>
  `;
}
