import {
  createPersistentResource,
  getCurrentUser,
  getProcessNodeStepOrder,
  getLatestStandardWorkFormFields,
  launchWorkPlanAsProcess,
  resolveAssetUrl,
  state,
  updatePersistentResource,
  uploadStandardWorkAttachment,
} from "./appState.js";
import {
  canLaunchActionTemplate,
  canLaunchAnyActionTemplate,
  canAccessTemplateCenter,
  hasPermission,
} from "../shared/permissions.js";
import {
  CategoryType,
  GoalLevel,
  GoalPeriodType,
  GoalStatus,
  GoalType,
  MetricDirection,
  ProcessAccepterRule,
  ProcessOwnerRule,
  ProcessTemplateStatus,
  TaskTemplateStatus,
  WorkPlanStatus,
  goalLevelNames,
  goalPeriodTypeNames,
  goalStatusNames,
  goalTypeNames,
  metricDirectionNames,
  taskStatusNames,
  getValueModuleName,
  inferValueModuleIdFromText,
  isValueModuleId,
  ValueModule,
} from "./data/modelOptions.js";
import { getPrimaryImageUrl, isTaskOverdue } from "./data/taskUtils.js";
import {
  getCurrentExecutor as selectCurrentExecutor,
  getCurrentProcessTask as selectCurrentProcessTask,
  getProcessInstanceBusinessStatus as selectProcessInstanceBusinessStatus,
  getProcessProgress as selectProcessProgress,
  isProcessInstanceOverdue as selectProcessInstanceOverdue,
} from "./data/processInstanceSelectors.js";
import { bindActionLinkedTemplatePreviewEvents, bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js";
import { invokeModuleAction } from "./moduleActions.js";
import {
  collectBusinessDateTime,
  formatBusinessDateTime,
  renderBusinessHourOptions,
} from "./businessTime.js";
import { normalizePublishTimeFields, PublishTimeMode } from "./data/contentPublishTime.js";
import {
  collectPublicFormFields,
  handlePublicFormImageUpload,
  removePublicFormImage,
  renderPublicFormEditor,
  updatePublicFormImagePreview,
  validatePublicFormFields,
} from "./workFormEditor.js";
import { normalizePublicFormFields } from "./publicFormFields.js";
import { bindActionProductSelectors, collectActionProductIds, renderActionProductSelector } from "./actionProductRelations.js";
import { standardWorkAttachmentAccept, validateStandardWorkAttachmentFiles } from "./standardWorkAttachmentPolicy.js";

const departments = state.departments;
const categories = state.categories;
const people = state.people;
const stores = state.stores;
let goals = state.goals;
let modalState = null;
let selectedGoalProcessInstanceId = null;
let draggedGoalId = null;
let dragOverGoalId = null;
let activeGoalTab = "alignment";
let isSavingGoal = false;
let showInactiveGoals = false;
let goalKeyword = "";
const today = "2026-06-24";
const plannedWeekPattern = /^\d{4}-W\d{2}$/;
const standardWorkAttachmentsKey = "standardWorkAttachments";
const publishContentNoteTemplateId = "task-template-publish-content-note";
const linkedActionTemplateIdsKey = "linkedTemplateIds";
let selectedGoalId =
  goals.find((goal) => goal.level === GoalLevel.Company && goal.type === GoalType.Ultimate)?.id ??
  goals[0]?.id ??
  null;

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

function replaceGoals(nextGoals) {
  state.goals.splice(0, state.goals.length, ...nextGoals);
  goals = state.goals;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getPublishContentNoteTemplates() {
  return state.templates.filter((template) => {
    const tags = template?.tags;
    if (tags === null || tags === undefined || typeof tags !== "object" || Array.isArray(tags)) return false;
    return Array.isArray(tags.platform) && tags.platform.includes("小红书")
      && Array.isArray(tags.usage) && tags.usage.includes("笔记");
  });
}

function getGoalTemplatePreviewUrl(template) {
  const rawUrl = template?.previewImage?.fileUrl ?? template?.previewImage?.url ?? "";
  return rawUrl === "" ? "" : resolveAssetUrl(rawUrl);
}

function renderContentNoteTemplateSelector(selectedTemplate) {
  if (!canAccessTemplateCenter(getCurrentUser())) {
    return `<div class="form-error">你没有模板中心查看权限，无法选择发布内容笔记模板。</div>`;
  }
  const templates = getPublishContentNoteTemplates();
  return `
    <fieldset class="goal-content-note-template-selector">
      <legend>关联模板</legend>
      <p class="form-note">仅显示平台含“小红书”且用途含“笔记”的模板；本次关键行动只能关联一个模板。</p>
      ${
        templates.length === 0
          ? `<div class="empty-detail">模板中心暂无可用的发布笔记模板</div>`
          : `<div class="goal-content-note-template-grid">
              ${templates.map((template) => {
                const previewUrl = getGoalTemplatePreviewUrl(template);
                return `
                  <label class="goal-content-note-template-option">
                    <input type="radio" name="linkedTemplateId" value="${escapeHtml(template.id)}" ${selectedTemplate === template.id ? "checked" : ""} />
                    <span class="goal-content-note-template-thumb" ${previewUrl === "" ? "" : `data-action-template-preview-url="${escapeHtml(previewUrl)}" data-action-template-preview-title="${escapeHtml(template.name)}"`}>${previewUrl === "" ? "无预览" : `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(template.name)}" />`}</span>
                    <span>
                      <strong>${escapeHtml(template.name)}</strong>
                      <small>${escapeHtml(template.businessCode || "—")} · ${escapeHtml(template.fileType || "文件")}</small>
                    </span>
                  </label>
                `;
              }).join("")}
            </div>`
      }
      <button class="text-button" type="button" data-action="clear-goal-linked-template">清除模板选择</button>
    </fieldset>
  `;
}

function findName(items, id, fallback) {
  if (id === null) return fallback;

  return items.find((item) => item.id === id)?.name ?? fallback;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getNow() {
  return new Date().toISOString();
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function getChildren(parentGoalId) {
  return goals.filter((goal) => goal.parentGoalId === parentGoalId);
}

function getGoal(goalId) {
  return goals.find((goal) => goal.id === goalId) ?? null;
}

function isInactiveGoal(goal) {
  return goal.status === GoalStatus.Inactive;
}

function getActiveGoals() {
  return goals.filter((goal) => !isInactiveGoal(goal));
}

function getVisibleGoals() {
  return showInactiveGoals ? goals : getActiveGoals();
}

function getVisibleGoal(goalId) {
  const goal = getGoal(goalId);
  if (goal === null) return null;
  if (!showInactiveGoals && isInactiveGoal(goal)) return null;
  return goal;
}

function getVisibleChildren(parentGoalId) {
  const visibleGoalIds = new Set(getVisibleGoals().map((goal) => goal.id));
  return goals.filter((goal) => goal.parentGoalId === parentGoalId && visibleGoalIds.has(goal.id));
}

function ensureSelectedGoalVisible() {
  if (selectedGoalId !== null && getVisibleGoal(selectedGoalId) !== null) return;
  selectedGoalId =
    getVisibleGoals().find((goal) => goal.level === GoalLevel.Company && goal.type === GoalType.Ultimate)?.id ??
    getVisibleGoals()[0]?.id ??
    null;
  selectedGoalProcessInstanceId = null;
}

function isSelectableGoalWorkTemplate(template) {
  return template.name !== "改善工作";
}

function getActiveTaskTemplates() {
  const currentUser = getCurrentUser();
  return state.taskTemplates.filter(
    (template) =>
      template.status === TaskTemplateStatus.Active &&
      isSelectableGoalWorkTemplate(template) &&
      canLaunchActionTemplate(currentUser, template.id),
  );
}

function canCurrentUserLaunchGoalAction() {
  return (
    canCurrentUser("keyActions.launch") &&
    canLaunchAnyActionTemplate(
      getCurrentUser(),
      state.taskTemplates.filter(
        (template) => template.status === TaskTemplateStatus.Active && isSelectableGoalWorkTemplate(template),
      ),
    )
  );
}

function sortCategoriesBySortOrder(left, right) {
  return (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999) || left.name.localeCompare(right.name, "zh-Hans-CN");
}

function getTaskCategories() {
  return categories
    .filter((category) => category.type === CategoryType.Task && category.status !== "inactive")
    .sort(sortCategoriesBySortOrder);
}

function inferValueModuleIdForTemplate(template) {
  if (template === null || template === undefined) return ValueModule.InfrastructureMaintenance;
  const categoryName = categories.find((category) => category.id === template.categoryId && category.type === CategoryType.Task)?.name ?? "";
  const searchableText = `${categoryName} ${template.name ?? ""}`.toLowerCase();
  return inferValueModuleIdFromText(searchableText);
}

function getActiveTaskTemplatesByCategory(categoryId) {
  if (!getTaskCategories().some((category) => category.id === categoryId)) return [];
  return getActiveTaskTemplates().filter((template) => template.categoryId === categoryId);
}

function getTaskTemplateValueModuleName(template) {
  return getValueModuleName(inferValueModuleIdForTemplate(template));
}

function withValueModuleCustomFields(customFields, valueModuleId) {
  const normalizedValueModuleId = isValueModuleId(valueModuleId) ? valueModuleId : ValueModule.InfrastructureMaintenance;
  return {
    ...customFields,
    valueModuleId: normalizedValueModuleId,
    valueModuleName: getValueModuleName(normalizedValueModuleId),
  };
}

function getTaskTemplate(templateId) {
  return state.taskTemplates.find((template) => template.id === templateId) ?? null;
}

function getProcessTemplate(instance) {
  return state.processTemplates.find((template) => template.id === instance.templateId) ?? null;
}

function getProcessNode(task) {
  return state.processTemplateNodes.find((node) => node.id === task.processNodeId) ?? null;
}

function getProcessTasks(processInstanceId) {
  return state.tasks.filter((task) => task.processInstanceId === processInstanceId);
}

function getProcessProgress(instance) {
  const progress = selectProcessProgress(instance.id, state);
  return `${progress.completed}/${progress.total}`;
}

function getCurrentProcessTasks(instance) {
  if (instance.status !== "running") return [];
  const currentTask = selectCurrentProcessTask(instance.id, state);
  return currentTask === null ? [] : [currentTask];
}

function getProcessCurrentStepText(instance) {
  if (instance.status === "done") return "已完成";
  if (instance.status === "stopped") return "已终止";
  const currentTasks = getCurrentProcessTasks(instance);
  if (currentTasks.length > 0) return currentTasks.map((task) => task.name).join("、");
  return "等待前置";
}

function getProcessCurrentOwners(instance) {
  const currentExecutor = selectCurrentExecutor(instance.id, state);
  return currentExecutor.personId === "" ? "-" : findName(people, currentExecutor.personId, "未设置");
}

function isProcessInstanceOverdue(instance) {
  return selectProcessInstanceOverdue(instance.id, state, today);
}

function getStandardWorkName(instance) {
  const taskTemplateId = instance.taskTemplateId ?? instance.standardWorkId ?? null;
  return getTaskTemplate(taskTemplateId ?? "")?.name ?? "未关联关键行动";
}

function getProcessTemplateById(templateId) {
  return state.processTemplates.find((template) => template.id === templateId) ?? null;
}

function getProcessTemplateName(templateId) {
  return state.processTemplates.find((template) => template.id === templateId)?.name ?? "未绑定关键行动标准流程";
}

const contentNoteRequiredFields = [
  { id: "content-note-product-name", label: "对应产品", key: "productName", type: "text", required: false, placeholder: "请输入对应产品", options: [], showInList: true, sortOrder: 7 },
  { id: "content-note-scene", label: "参考场景", key: "scene", type: "text", required: false, placeholder: "请输入参考场景", options: [], showInList: true, sortOrder: 10 },
  { id: "content-note-hashtags", label: "话题", key: "hashtags", type: "text", required: false, placeholder: "例如 #花瓶 #家居软装", options: [], showInList: true, sortOrder: 11 },
];

function isContentNoteTemplate(template) {
  return template?.id === "task-template-publish-content-note" || template?.taskTemplateId === "task-template-publish-content-note" || template?.name === "发布内容笔记";
}

function getSortedFormFields(template) {
  const fields = normalizePublicFormFields(getLatestStandardWorkFormFields(template?.id, template?.formFields ?? []));
  if (isContentNoteTemplate(template)) {
    fields.forEach((field) => {
      if (field.key === "publishDate") field.type = "datetime_hour";
    });
    contentNoteRequiredFields.forEach((field) => {
      if (!fields.some((item) => item.key === field.key)) fields.push(field);
    });
  }
  return fields.sort((left, right) => left.sortOrder - right.sortOrder);
}

function getCustomFieldValue(customFields, field) {
  const value = customFields[field.key];
  if (Array.isArray(value)) return value.join("、");
  if (field.key === "departmentId") return findName(departments, value, "");
  if (field.key === "interviewerId") return findName(people, value, "");
  if (field.key === "storeId") return customFields.storeName || findName(stores, value, customFields.platform ?? "");
  return value ?? "";
}

function buildDisplayTitle(template, customFields) {
  const values = getSortedFormFields(template)
    .filter((field) => field.showInList && field.key !== "coverImageUrl")
    .map((field) => getCustomFieldValue(customFields, field))
    .filter(Boolean)
    .slice(0, 3);

  return values.length === 0 ? template.name : `${template.name}｜${values.join("｜")}`;
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

function renderCustomFieldsForm(template) {
  const fields = getSortedFormFields(template);
  const editor = renderPublicFormEditor({ fields, customFields: {}, title: "本次关键行动信息" });
  if (!isContentNoteTemplate(template)) return editor;
  return `
    <div class="publish-time-mode-panel" data-publish-time-mode-panel>
      <span class="publish-time-mode-title">发布时间</span>
      <label><input type="radio" name="publishTimeMode" value="custom" checked /> 自定义时间</label>
      <label><input type="radio" name="publishTimeMode" value="deadline" /> 同截止时间</label>
      <div class="publish-time-deadline-preview" data-publish-time-deadline-preview hidden>
        <strong>跟随截止时间</strong>
        <span data-publish-time-deadline-value>请先设置截止时间</span>
      </div>
    </div>
    ${editor}
  `;
}

function getFileExt(filename = "") {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function renderStandardWorkAttachmentsField() {
  return `
    <div class="standard-work-attachments-field">
      <label>
        <span>附件</span>
        <input name="standardWorkAttachments" type="file" accept="${standardWorkAttachmentAccept}" multiple data-standard-work-attachments />
      </label>
      <p class="form-note">支持 .xlsx、.xls、.csv、.xmind，单个文件不超过 20MB。未上传也可以发起关键行动。</p>
      <div class="selected-attachment-list" data-selected-standard-work-attachments>
        <p class="form-note">暂无已选择附件</p>
      </div>
    </div>
  `;
}

function collectCustomFields(form, template) {
  return collectPublicFormFields(form, getSortedFormFields(template));
}

function validateCustomFields(customFields, template) {
  return validatePublicFormFields(customFields, getSortedFormFields(template));
}

function getSelectedGoal() {
  const selectedGoal = selectedGoalId === null ? null : getGoal(selectedGoalId);

  if (selectedGoal !== null) return selectedGoal;

  selectedGoalId =
    goals.find((goal) => goal.level === GoalLevel.Company && goal.type === GoalType.Ultimate)?.id ??
    goals[0]?.id ??
    null;

  return selectedGoalId === null ? null : getGoal(selectedGoalId);
}

function formatPeriod(goal) {
  if (goal.periodType === null || goal.periodValue === null) return "-";

  return `${goalPeriodTypeNames[goal.periodType]} · ${goal.periodValue}`;
}

function formatMetric(goal) {
  if (goal.metricName === null) return "长期目标";

  return `${goal.metricName}（${metricDirectionNames[goal.metricDirection]}，单位：${goal.metricUnit}）`;
}

function formatGoalValue(value, unit) {
  if (value === null) return "-";

  return `${value}${unit ?? ""}`;
}

function calculateProgress(goal) {
  if (
    goal.type !== GoalType.Period ||
    goal.metricDirection === null ||
    goal.targetValue === null ||
    goal.currentValue === null
  ) {
    return null;
  }

  if (goal.metricDirection === MetricDirection.GreaterThanOrEqual) {
    return Math.min((goal.currentValue / goal.targetValue) * 100, 100);
  }

  if (goal.metricDirection === MetricDirection.LessThanOrEqual) {
    return Math.min((goal.targetValue / goal.currentValue) * 100, 100);
  }

  if (goal.metricDirection === MetricDirection.Equal && goal.currentValue === goal.targetValue) {
    return 100;
  }

  return null;
}

function formatProgress(goal) {
  const currentValue = formatGoalValue(goal.currentValue, goal.metricUnit);
  const targetValue = formatGoalValue(goal.targetValue, goal.metricUnit);
  const progress = calculateProgress(goal);

  if (goal.type !== GoalType.Period) return "长期目标";

  if (progress === null) return `${currentValue} / ${targetValue}`;

  return `${currentValue} / ${targetValue}（${Math.round(progress)}%）`;
}

function renderStatus(goal) {
  const modifier = goal.status === GoalStatus.Inactive ? " is-inactive" : "";

  return `<span class="status-pill${modifier}">${goalStatusNames[goal.status]}</span>`;
}

function renderTaskOverdue(task) {
  return isTaskOverdue(task, today)
    ? `<span class="status-pill is-danger">已逾期</span>`
    : `<span class="status-pill">未逾期</span>`;
}

function renderTaskTemplateLockedInfo(template) {
  if (template === null) {
    return `<p class="form-note">请选择关键行动后查看自动带出的锁定信息。</p>`;
  }

  return `
    <div class="locked-template-info">
      ${renderDetailField("行动标准编码", escapeHtml(template.businessCode ?? "—"))}
      ${renderDetailField("关键行动名称", escapeHtml(template.name))}
      ${renderDetailField("价值链模块", getTaskTemplateValueModuleName(template))}
      ${renderDetailField("对应关键行动标准流程", getProcessTemplateName(template.defaultProcessTemplateId))}
      ${renderDetailField("负责部门", findName(departments, template.departmentId, "未设置"))}
      ${renderDetailField("负责人", findName(people, template.ownerId, "未设置"))}
      ${renderDetailField("需要验收", template.needAcceptance ? "是" : "否")}
      ${renderDetailField("验收人", findName(people, template.accepterId, "无"))}
      ${renderDetailField("任务说明", escapeHtml(template.description))}
      ${renderDetailField("标准完成要求", escapeHtml(template.completionStandard))}
    </div>
  `;
}

function isSelectableParent(candidate, draft, editingGoalId) {
  if (candidate.id === editingGoalId) return false;
  return !createsCycle(editingGoalId, candidate.id);
}

function createsCycle(goalId, parentGoalId) {
  if (goalId === null || parentGoalId === null) return false;

  let currentParentId = parentGoalId;
  const visitedGoalIds = new Set([goalId]);

  while (currentParentId !== null) {
    if (visitedGoalIds.has(currentParentId)) return true;
    visitedGoalIds.add(currentParentId);
    currentParentId = getGoal(currentParentId)?.parentGoalId ?? null;
  }

  return false;
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

function renderTaskTemplateOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items
      .map((item) => {
        const label = item.businessCode ? `${item.businessCode}｜${item.name}` : item.name;
        return `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("")}
  `;
}

function renderValueOptions(items, selectedValue, names) {
  return Object.values(items)
    .map(
      (value) => `
        <option value="${value}" ${value === selectedValue ? "selected" : ""}>
          ${names[value]}
        </option>
      `,
    )
    .join("");
}

function renderParentGoalOptions(selectedGoalId) {
  return `
    <option value="">不选择</option>
    ${goals
      .filter((goal) => !isInactiveGoal(goal) || goal.id === selectedGoalId)
      .map(
        (goal) => `
          <option
            value="${goal.id}"
            ${goal.id === selectedGoalId ? "selected" : ""}
            data-level="${goal.level}"
            data-type="${goal.type}"
            data-department-id="${goal.departmentId ?? ""}"
            data-status="${goal.status}"
          >
            ${escapeHtml(goal.name)}
          </option>
        `,
      )
      .join("")}
  `;
}

function renderGoalMapCard(goal) {
  const isSelected = goal.id === selectedGoalId;
  const statusClass = goal.status === GoalStatus.Inactive ? " is-inactive" : "";
  const selectedClass = isSelected ? " is-selected" : "";
  const draggingClass = goal.id === draggedGoalId ? " is-dragging" : "";
  const dragOverClass = goal.id === dragOverGoalId && goal.id !== draggedGoalId ? " is-drag-over" : "";

  return `
    <div
      class="goal-map-card ${goal.level === GoalLevel.Company ? "is-company" : "is-department"}${statusClass}${selectedClass}${draggingClass}${dragOverClass}"
      draggable="${canCurrentUser("goals.manage") ? "true" : "false"}"
      data-goal-id="${goal.id}"
      data-goal-drag-id="${goal.id}"
      data-goal-drop-id="${goal.id}"
    >
      <button
        class="goal-map-card-inner"
        type="button"
        data-action="select-goal"
        data-goal-id="${goal.id}"
      >
        <strong>${escapeHtml(goal.name)}</strong>
        <span class="goal-map-meta">
          <em>${goalLevelNames[goal.level]}</em>
          <em>${goalTypeNames[goal.type]}</em>
        </span>
        ${
          goal.periodType !== null && goal.periodValue !== null
            ? `<span class="goal-map-line">${formatPeriod(goal)}</span>`
            : ""
        }
        <span class="goal-map-line">负责人：${findName(people, goal.ownerId, "未设置")}</span>
        <span class="goal-map-line">${formatProgress(goal)}</span>
      </button>
      ${
        canCurrentUserLaunchGoalAction()
          ? `
            <div class="goal-map-card-actions">
              <button
                class="secondary-button compact-button goal-card-add-work-button"
                type="button"
                draggable="false"
                data-action="add-goal-task"
                data-goal-id="${goal.id}"
                data-modal-title="发起关键行动"
              >
                发起关键行动
              </button>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderGoalMapNode(goal) {
  const children = getVisibleChildren(goal.id);

  return `
    <div class="goal-map-branch">
      ${renderGoalMapCard(goal)}
      ${
        children.length > 0
          ? `
              <div class="goal-map-children">
                ${children.map((childGoal) => renderGoalMapNode(childGoal)).join("")}
              </div>
            `
          : ""
      }
    </div>
  `;
}

function renderGoalTree() {
  const visibleGoals = getVisibleGoals();
  const visibleGoalIds = new Set(visibleGoals.map((goal) => goal.id));
  const rootGoals = visibleGoals
    .filter((goal) => goal.parentGoalId === null || !visibleGoalIds.has(goal.parentGoalId))
    .sort((left, right) => {
      if (left.level === GoalLevel.Company && left.type === GoalType.Ultimate) return -1;
      if (right.level === GoalLevel.Company && right.type === GoalType.Ultimate) return 1;
      return left.createdAt.localeCompare(right.createdAt);
    });

  return `
    <section class="settings-section">
      ${renderInactiveGoalToggle()}
      <div class="goal-map-scroll">
        <div class="goal-map">
          ${rootGoals.map((goal) => renderGoalMapNode(goal)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderInactiveGoalToggle() {
  return `
    <label class="checkbox-field goal-inactive-toggle">
      <input type="checkbox" data-goal-toggle-inactive ${showInactiveGoals ? "checked" : ""} />
      <span>显示停用目标</span>
    </label>
  `;
}

function renderDetailField(label, value) {
  return `
    <div class="detail-field">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderFilters() {
  return `
    <section class="goal-filters" aria-label="目标筛选">
      <label>
        <span>关键词</span>
        <input data-goal-keyword value="${escapeHtml(goalKeyword)}" placeholder="搜索目标名称或编号" autocomplete="off" />
      </label>
      <label>
        <span>目标层级</span>
        <select>
          <option>全部层级</option>
          <option>公司目标</option>
          <option>部门目标</option>
        </select>
      </label>
      <label>
        <span>目标类型</span>
        <select>
          <option>全部类型</option>
          <option>终极目标</option>
          <option>周期目标</option>
        </select>
      </label>
      <label>
        <span>周期</span>
        <select>
          <option>全部周期</option>
          <option>2026年7月</option>
        </select>
      </label>
      <label>
        <span>状态</span>
        <select>
          <option>全部状态</option>
          <option>进行中</option>
          <option>已完成</option>
          <option>已终止</option>
          <option>停用</option>
        </select>
      </label>
    </section>
  `;
}

function renderGoalTabs() {
  return `
    <div class="settings-tabs" aria-label="目标页签">
      <button class="${activeGoalTab === "alignment" ? "is-active" : ""}" type="button" data-goal-tab="alignment">目标对齐图</button>
      <button class="${activeGoalTab === "list" ? "is-active" : ""}" type="button" data-goal-tab="list">目标列表</button>
    </div>
  `;
}

function renderActionButton(label, action, goalId, variant = "") {
  return `
    <button
      class="text-button ${variant}"
      type="button"
      data-action="${action}"
      data-goal-id="${goalId}"
    >
      ${label}
    </button>
  `;
}

function renderGoalTaskTable(goal) {
  const goalTasks = state.tasks.filter((task) => task.goalId === goal.id);

  return `
    <div class="table-wrap">
      <table class="data-table compact-goal-task-table">
        <thead>
          <tr>
            <th>任务名称</th>
            <th>负责人</th>
            <th>负责部门</th>
            <th>截止时间</th>
            <th>状态</th>
            <th>是否逾期</th>
          </tr>
        </thead>
        <tbody>
          ${
            goalTasks.length === 0
              ? `<tr><td colspan="6">暂无关联任务</td></tr>`
              : goalTasks
                  .map(
                    (task) => `
                      <tr>
                        <td>${escapeHtml(task.name)}</td>
                        <td>${findName(people, task.ownerId, "未设置")}</td>
                        <td>${findName(departments, task.departmentId, "未设置")}</td>
                        <td>${formatBusinessDateTime(task.dueDate)}</td>
                        <td><span class="status-pill">${taskStatusNames[task.status]}</span></td>
                        <td>${renderTaskOverdue(task)}</td>
                      </tr>
                    `,
                  )
                  .join("")
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderGoalProcessTable(goal) {
  const instances = state.processInstances.filter((instance) => instance.goalId === goal.id);

  if (instances.length === 0) {
    return `<div class="empty-detail">暂无已发起关键行动</div>`;
  }

  return `
    <div class="table-wrap">
      <table class="data-table compact-goal-process-table">
        <thead>
          <tr>
            <th>本次关键行动标题</th>
            <th>关键行动</th>
            <th>关键行动标准流程</th>
            <th>当前步骤</th>
            <th>步骤进度</th>
            <th>当前负责人</th>
            <th>发起人</th>
            <th>状态</th>
            <th>是否逾期</th>
            <th>发起时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${instances
            .map(
              (instance) => `
                <tr class="${instance.id === selectedGoalProcessInstanceId ? "is-selected" : ""}">
                  <td>${escapeHtml(instance.displayTitle ?? instance.name)}</td>
                  <td>${escapeHtml(getStandardWorkName(instance))}</td>
                  <td>${escapeHtml(getProcessTemplate(instance)?.name ?? "未知标准")}</td>
                  <td>${escapeHtml(getProcessCurrentStepText(instance))}</td>
                  <td>${getProcessProgress(instance)}</td>
                  <td>${escapeHtml(getProcessCurrentOwners(instance))}</td>
                  <td>${findName(people, instance.initiatorId, "未设置")}</td>
                  <td><span class="status-pill">${selectProcessInstanceBusinessStatus(instance.id, state).label}</span></td>
                  <td>${isProcessInstanceOverdue(instance) ? `<span class="status-pill is-danger">已逾期</span>` : `<span class="status-pill">正常</span>`}</td>
                  <td>${instance.startedAt}</td>
                  <td><button class="text-button" type="button" data-action="view-goal-process" data-instance-id="${instance.id}">查看 / 编辑</button></td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderGoalDetail() {
  const goal = getSelectedGoal();

  if (goal === null) {
    return `
      <section class="settings-section goal-detail">
        <div class="section-heading"><h2>目标详情</h2></div>
        <div class="empty-detail">暂无目标</div>
      </section>
    `;
  }
  const selectedGoalProcessInstance = state.processInstances.find(
    (instance) => instance.id === selectedGoalProcessInstanceId && instance.goalId === goal.id,
  );

  return `
    <section class="settings-section goal-detail">
      <div class="section-heading with-actions">
        <h2>目标详情：${escapeHtml(goal.name)}</h2>
        <div class="section-actions">
          ${canCurrentUser("goals.manage") ? `<button class="secondary-button" type="button" data-action="edit-goal" data-goal-id="${goal.id}">编辑目标</button>` : ""}
          ${canCurrentUserLaunchGoalAction() && !isInactiveGoal(goal) ? `<button class="primary-button" type="button" data-action="add-goal-task" data-goal-id="${goal.id}">发起关键行动</button>` : ""}
          ${canCurrentUser("goals.close") && !isInactiveGoal(goal) ? `<button class="secondary-button danger-button" type="button" data-action="deactivate-goal" data-goal-id="${goal.id}">停用目标</button>` : ""}
          ${canCurrentUser("goals.close") && isInactiveGoal(goal) ? `<button class="secondary-button" type="button" data-action="activate-goal" data-goal-id="${goal.id}">重新启用</button>` : ""}
        </div>
      </div>
      <div class="detail-block">
        <h3>目标基本信息</h3>
        <div class="detail-grid">
          ${renderDetailField("目标编号", escapeHtml(goal.businessCode ?? "未编号"))}
          ${renderDetailField("目标名称", escapeHtml(goal.name))}
          ${renderDetailField("目标层级", goalLevelNames[goal.level])}
          ${renderDetailField("目标类型", goalTypeNames[goal.type])}
          ${renderDetailField("所属部门", findName(departments, goal.departmentId, "公司"))}
          ${renderDetailField("负责人", findName(people, goal.ownerId, "未设置"))}
          ${renderDetailField("对齐目标", findName(goals, goal.parentGoalId, "无"))}
          ${renderDetailField("状态", goalStatusNames[goal.status])}
        </div>
      </div>
      <div class="detail-block">
        <h3>周期目标指标信息</h3>
        <div class="detail-grid">
          ${renderDetailField("周期类型", goal.periodType === null ? "-" : goalPeriodTypeNames[goal.periodType])}
          ${renderDetailField("具体周期", goal.periodValue ?? "-")}
          ${renderDetailField("核心指标名称", goal.metricName ?? "-")}
          ${renderDetailField("当前值", formatGoalValue(goal.currentValue, goal.metricUnit))}
          ${renderDetailField("目标值", formatGoalValue(goal.targetValue, goal.metricUnit))}
          ${renderDetailField("达标方向", goal.metricDirection === null ? "-" : metricDirectionNames[goal.metricDirection])}
          ${renderDetailField("指标单位", goal.metricUnit ?? "-")}
        </div>
      </div>
      <div class="detail-block">
        <h3>目标说明</h3>
        <p>${escapeHtml(goal.description || "暂无说明")}</p>
      </div>
      ${
        canCurrentUser("goals.view")
          ? `
            <div class="detail-block">
              <h3>目标下的任务</h3>
              ${renderGoalTaskTable(goal)}
            </div>
            <div class="detail-block">
              <h3>已发起关键行动</h3>
              ${renderGoalProcessTable(goal)}
            </div>
            ${selectedGoalProcessInstance === undefined ? "" : renderLaunchedProcessDetail(selectedGoalProcessInstance.id, { emptyHtml: "" })}
          `
          : ""
      }
    </section>
  `;
}

function renderGoalTable() {
  const normalizedKeyword = goalKeyword.trim().toLowerCase();
  const visibleGoals = getVisibleGoals().filter((goal) => {
    if (normalizedKeyword === "") return true;
    return `${goal.name ?? ""} ${goal.businessCode ?? ""}`.toLowerCase().includes(normalizedKeyword);
  });
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>目标列表</h2>
      </div>
      ${renderInactiveGoalToggle()}
      <div class="table-wrap">
        <table class="data-table goal-table">
          <thead>
            <tr>
              <th>目标名称</th>
              <th>层级</th>
              <th>类型</th>
              <th>周期</th>
              <th>所属部门</th>
              <th>负责人</th>
              <th>对齐目标</th>
              <th>核心指标</th>
              <th>当前值 / 目标值</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              visibleGoals.length === 0
                ? `<tr><td colspan="11">暂无可显示目标。</td></tr>`
                : visibleGoals
              .map(
                (goal) => `
                  <tr class="${isInactiveGoal(goal) ? "is-inactive" : ""}">
                    <td>
                      <button class="table-link-button" type="button" data-action="select-goal" data-goal-id="${goal.id}">
                        ${escapeHtml(goal.name)}
                      </button>
                    </td>
                    <td>${goalLevelNames[goal.level]}</td>
                    <td>${goalTypeNames[goal.type]}</td>
                    <td>${formatPeriod(goal)}</td>
                    <td>${findName(departments, goal.departmentId, "公司")}</td>
                    <td>${findName(people, goal.ownerId, "未设置")}</td>
                    <td>${findName(goals, goal.parentGoalId, "无")}</td>
                    <td>${formatMetric(goal)}</td>
                    <td>${formatProgress(goal)}</td>
                    <td>${renderStatus(goal)}</td>
                    <td>
                      <span class="row-actions">
                        ${canCurrentUser("goals.manage") ? renderActionButton("编辑", "edit-goal", goal.id) : ""}
                        ${
                          goal.type === GoalType.Period
                            ? renderActionButton("更新当前值", "update-current-value", goal.id)
                            : ""
                        }
                        ${canCurrentUser("goals.close") && !isInactiveGoal(goal) ? renderActionButton("停用目标", "deactivate-goal", goal.id, "danger-button") : ""}
                        ${canCurrentUser("goals.close") && isInactiveGoal(goal) ? renderActionButton("重新启用", "activate-goal", goal.id) : ""}
                      </span>
                    </td>
                  </tr>
                `,
              )
              .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function getEditingGoal() {
  if (modalState?.goalId === undefined) return null;

  return getGoal(modalState.goalId);
}

function renderGoalModal() {
  if (modalState === null || modalState.kind !== "goal") return "";

  const goal = getEditingGoal();
  const isEdit = modalState.mode === "edit";
  const level = goal?.level ?? GoalLevel.Company;
  const type = goal?.type ?? GoalType.Ultimate;
  const currentValue = goal?.currentValue ?? (type === GoalType.Period ? 0 : "");

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "编辑目标" : "新增目标"}">
        <div class="modal-header">
          <h2>${isEdit ? "编辑目标" : "新增目标"}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-goal-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form" ${isSavingGoal ? "disabled" : ""}>${isSavingGoal ? "保存中..." : isEdit ? "保存修改" : "保存"}</button>
            <button class="icon-button" type="button" data-action="close-goal-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form goal-form" data-editing-goal-id="${goal?.id ?? ""}">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <label>
            <span>目标名称</span>
            <input name="name" value="${escapeHtml(goal?.name ?? "")}" autocomplete="off" required />
          </label>
          <div class="form-grid">
            <label>
              <span>目标层级</span>
              <select name="level">
                ${renderValueOptions(GoalLevel, level, goalLevelNames)}
              </select>
            </label>
            <label>
              <span>目标类型</span>
              <select name="type">
                ${renderValueOptions(GoalType, type, goalTypeNames)}
              </select>
            </label>
          </div>
          <label data-field-group="department">
            <span>所属部门</span>
            <select name="departmentId">
              ${renderOptions(departments, goal?.departmentId ?? "", "请选择部门")}
            </select>
          </label>
          <label>
            <span>目标负责人</span>
            <select name="ownerId">
              ${renderOptions(people, goal?.ownerId ?? "", "请选择负责人")}
            </select>
          </label>
          <label>
            <span>对齐目标</span>
            <select name="parentGoalId">
              ${renderParentGoalOptions(goal?.parentGoalId ?? "")}
            </select>
          </label>
          <div class="form-grid" data-field-group="period">
            <label>
              <span>周期类型</span>
              <select name="periodType">
                <option value="">请选择周期类型</option>
                ${renderValueOptions(GoalPeriodType, goal?.periodType ?? "", goalPeriodTypeNames)}
              </select>
            </label>
            <label>
              <span>具体周期</span>
              <input name="periodValue" value="${escapeHtml(goal?.periodValue ?? "")}" autocomplete="off" />
            </label>
          </div>
          <div class="form-grid" data-field-group="metric">
            <label>
              <span>核心指标名称</span>
              <input name="metricName" value="${escapeHtml(goal?.metricName ?? "")}" autocomplete="off" />
            </label>
            <label>
              <span>指标单位</span>
              <input name="metricUnit" value="${escapeHtml(goal?.metricUnit ?? "")}" autocomplete="off" />
            </label>
            <label>
              <span>达标方向</span>
              <select name="metricDirection">
                <option value="">请选择达标方向</option>
                ${renderValueOptions(MetricDirection, goal?.metricDirection ?? "", metricDirectionNames)}
              </select>
            </label>
            <label>
              <span>目标值</span>
              <input name="targetValue" value="${goal?.targetValue ?? ""}" inputmode="decimal" />
            </label>
            <label>
              <span>当前值</span>
              <input name="currentValue" value="${currentValue}" inputmode="decimal" />
            </label>
          </div>
          <label>
            <span>目标说明</span>
            <textarea name="description" rows="3">${escapeHtml(goal?.description ?? "")}</textarea>
          </label>
          ${
            isEdit
              ? `
                <label>
                  <span>状态</span>
                  <select name="status">
                    ${renderValueOptions(GoalStatus, goal?.status ?? GoalStatus.Active, goalStatusNames)}
                  </select>
                </label>
              `
              : ""
          }
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-goal-modal">取消</button>
            <button class="primary-button" type="submit" ${isSavingGoal ? "disabled" : ""}>${isSavingGoal ? "保存中..." : isEdit ? "保存修改" : "保存"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderCurrentValueModal() {
  if (modalState === null || modalState.kind !== "currentValue") return "";

  const goal = getGoal(modalState.goalId);

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="更新当前值">
        <div class="modal-header">
          <h2>更新当前值</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-goal-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
            <button class="icon-button" type="button" data-action="close-goal-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form current-value-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <p class="form-note">${escapeHtml(goal?.name ?? "")}</p>
          <label>
            <span>当前值</span>
            <input name="currentValue" value="${goal?.currentValue ?? ""}" inputmode="decimal" />
          </label>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-goal-modal">取消</button>
            <button class="primary-button" type="submit">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderDeactivateGoalModal() {
  if (modalState === null || modalState.kind !== "deactivateGoal") return "";
  const goal = getGoal(modalState.goalId);
  if (goal === null) return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="确认停用目标">
        <div class="modal-header">
          <div>
            <h2>确认停用目标？</h2>
            <p class="form-note">停用后，该目标将默认隐藏，但不会删除历史任务、关键行动和记录。</p>
          </div>
          <button class="icon-button" type="button" data-action="close-goal-modal" aria-label="关闭">×</button>
        </div>
        <div class="detail-grid">
          ${renderDetailField("目标名称", escapeHtml(goal.name))}
          ${renderDetailField("当前状态", goalStatusNames[goal.status])}
        </div>
        <div class="modal-actions">
          <button class="secondary-button" type="button" data-action="close-goal-modal">取消</button>
          <button class="primary-button danger-button" type="button" data-action="confirm-deactivate-goal" data-goal-id="${goal.id}">确认停用</button>
        </div>
      </div>
    </div>
  `;
}

function renderGoalTaskModal() {
  if (modalState === null || modalState.kind !== "goalTask") return "";

  const goal = getGoal(modalState.goalId);
  const selectedCategoryId = modalState.categoryId ?? "";
  const availableTemplates = getActiveTaskTemplatesByCategory(selectedCategoryId);
  const selectedTemplate = availableTemplates.find((template) => template.id === modalState.taskTemplateId) ?? null;
  const isPublishContentNote = selectedTemplate?.id === publishContentNoteTemplateId;
  const templateHint =
    selectedCategoryId === ""
      ? "请先选择价值链模块"
      : availableTemplates.length === 0
        ? "该价值链模块暂无关键行动，请先到关键行动库中添加。"
        : "请选择关键行动";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(modalState.title ?? "发起关键行动")}">
        <div class="modal-header">
          <h2>${escapeHtml(modalState.title ?? "发起关键行动")}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-goal-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">${modalState.launchImmediately ? "发起" : "保存"}</button>
            <button class="icon-button" type="button" data-action="close-goal-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form goal-task-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <p class="form-note">自动对齐目标：${escapeHtml(goal?.name ?? "未选择目标")}</p>
          <div class="form-grid">
            <label>
              <span>选择价值链模块</span>
              <select name="categoryId" data-goal-work-value-module-select>
                ${renderOptions(getTaskCategories(), selectedCategoryId, "请选择价值链模块")}
              </select>
            </label>
            <label>
              <span>关键行动</span>
              <select name="taskTemplateId" data-goal-task-template-select ${selectedCategoryId === "" ? "disabled" : ""}>
                ${renderTaskTemplateOptions(availableTemplates, modalState.taskTemplateId ?? "", templateHint)}
              </select>
            </label>
            <label>
              <span>本次关键行动标题</span>
              <input name="title" value="${escapeHtml(modalState.actionTitle ?? "")}" placeholder="可留空，系统会根据填写信息生成" autocomplete="off" data-goal-action-title data-auto-title="${modalState.actionTitle ? "false" : "true"}" />
            </label>
            <label>
              <span>截止时间日期</span>
              <input name="dueDateDate" type="date" />
            </label>
            <label>
              <span>截止时间小时</span>
              <select name="dueDateHour">${renderBusinessHourOptions("", "请选择小时")}</select>
            </label>
          </div>
          ${modalState.sourceContext?.source === "sales_anomaly" ? `<section class="goal-anomaly-source"><strong>来源：销售经营异常</strong><span>${escapeHtml(modalState.sourceContext.objectType)} · ${escapeHtml(modalState.sourceContext.objectId)}</span><small>${escapeHtml(modalState.sourceContext.anomalySnapshot?.anomalyType || "—")} · 当前值 ${escapeHtml(modalState.sourceContext.anomalySnapshot?.currentValue ?? "暂无数据")} · 对比值 ${escapeHtml(modalState.sourceContext.anomalySnapshot?.compareValue ?? "暂无数据")}</small><small>行动标准：${escapeHtml(modalState.recommendedActionStandard?.name || "未配置")}</small><small>标准目标：${escapeHtml(modalState.recommendedActionStandard?.target || "未维护")}</small><small>流程说明：${escapeHtml(modalState.recommendedActionStandard?.processDescription || "未维护")}</small><small>异常快照只用于追溯，保存时不会自动生成任务。</small></section>` : ""}
          ${renderTaskTemplateLockedInfo(selectedTemplate)}
          ${renderCustomFieldsForm(selectedTemplate)}
          ${renderActionProductSelector(modalState.sourceContext?.productId ? [modalState.sourceContext.productId] : [])}
          ${isPublishContentNote ? renderContentNoteTemplateSelector(modalState.linkedTemplateId ?? "") : ""}
          ${renderStandardWorkAttachmentsField()}
          <label>
            <span>补充说明</span>
            <textarea name="description" rows="3">${escapeHtml(modalState.description ?? "")}</textarea>
          </label>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-goal-modal">取消</button>
            <button class="primary-button" type="submit">${modalState.launchImmediately ? "发起" : "保存"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function parseNullableNumber(value) {
  if (value === "") return null;

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : NaN;
}

function buildGoalDraft(form) {
  const level = getFormValue(form, "level");
  const type = getFormValue(form, "type");
  const isDepartmentGoal = level === GoalLevel.Department;
  const isPeriodGoal = type === GoalType.Period;

  return {
    name: getFormValue(form, "name"),
    level,
    type,
    departmentId: isDepartmentGoal ? getFormValue(form, "departmentId") || null : null,
    ownerId: getFormValue(form, "ownerId"),
    parentGoalId: getFormValue(form, "parentGoalId") || null,
    periodType: isPeriodGoal ? getFormValue(form, "periodType") || null : null,
    periodValue: isPeriodGoal ? getFormValue(form, "periodValue") || null : null,
    metricName: isPeriodGoal ? getFormValue(form, "metricName") || null : null,
    metricUnit: isPeriodGoal ? getFormValue(form, "metricUnit") || null : null,
    metricDirection: isPeriodGoal ? getFormValue(form, "metricDirection") || null : null,
    targetValue: isPeriodGoal ? parseNullableNumber(getFormValue(form, "targetValue")) : null,
    currentValue: isPeriodGoal ? parseNullableNumber(getFormValue(form, "currentValue")) : null,
    description: getFormValue(form, "description"),
    status: getFormValue(form, "status") || GoalStatus.Active,
  };
}

function buildGoalTaskDraft(form, goalId) {
  const selectedCategoryId = getFormValue(form, "categoryId");
  let taskTemplateId = getFormValue(form, "taskTemplateId");
  let template = getTaskTemplate(taskTemplateId);
  const categoryTemplates = getActiveTaskTemplatesByCategory(selectedCategoryId);
  if (template === null) {
    template = categoryTemplates[0] ?? null;
    taskTemplateId = template?.id ?? "";
  }
  const departmentId = template?.departmentId || "";
  const valueModuleId = inferValueModuleIdForTemplate(template);
  const linkedTemplateId = getFormValue(form, "linkedTemplateId");
  const collectedCustomFields = template === null ? {} : collectCustomFields(form, template);
  const dueDateResult = collectBusinessDateTime(form, "dueDate");
  const publishTimeMode = template?.id === publishContentNoteTemplateId
    ? getFormValue(form, "publishTimeMode") || PublishTimeMode.Custom
    : PublishTimeMode.Custom;
  const publishFields = template?.id === publishContentNoteTemplateId
    ? normalizePublishTimeFields(collectedCustomFields, publishTimeMode)
    : collectedCustomFields;
  const customFields = withValueModuleCustomFields(
    template?.id === publishContentNoteTemplateId && linkedTemplateId !== ""
      ? { ...publishFields, [linkedActionTemplateIdsKey]: [linkedTemplateId] }
      : publishFields,
    valueModuleId,
  );
  return {
    goalId,
    departmentId,
    valueModuleId,
    valueModuleName: getValueModuleName(valueModuleId),
    taskTemplateId,
    template,
    customFields,
    linkedTemplateId,
    publishTimeMode,
    title: getFormValue(form, "title") || null,
    dueDate: dueDateResult.value,
    dueDateError: dueDateResult.error,
    description: getFormValue(form, "description") || null,
  };
}

function validateGoalTaskDraft(draft) {
  if (getGoal(draft.goalId) === null) return "当前目标必须存在。";
  if (draft.taskTemplateId === "" || draft.template === null) return "必须选择启用的关键行动。";
  if (draft.template.status !== TaskTemplateStatus.Active) return "停用的关键行动不能用于发起。";
  if (!canLaunchActionTemplate(getCurrentUser(), draft.template.id)) return "你没有权限发起该关键行动。";
  if (!draft.template.defaultProcessTemplateId) return "该关键行动尚未绑定关键行动标准流程，请先到关键行动库中配置。";
  if (draft.template.id === publishContentNoteTemplateId) {
    if (!canAccessTemplateCenter(getCurrentUser())) return "你没有模板中心查看权限，无法发起发布内容笔记。";
    const linkedTemplate = getPublishContentNoteTemplates().find((template) => template.id === draft.linkedTemplateId);
    if (linkedTemplate === undefined) return "必须选择一个有效的发布内容笔记模板。";
    if (draft.publishTimeMode === PublishTimeMode.Deadline && !draft.dueDate) return "选择同截止时间时必须设置截止时间。";
  }
  const validationFields = draft.publishTimeMode === PublishTimeMode.Deadline
    ? getSortedFormFields(draft.template).filter((field) => field.key !== "publishDate")
    : getSortedFormFields(draft.template);
  const customError = validatePublicFormFields(draft.customFields, validationFields);
  if (customError !== "") return customError;
  if (draft.dueDateError !== "") return draft.dueDateError;

  return "";
}

function validateGoalDraft(draft, editingGoalId) {
  if (draft.name === "") return "目标名称不能为空。";
  if (!Object.values(GoalLevel).includes(draft.level)) return "目标层级无效。";
  if (!Object.values(GoalType).includes(draft.type)) return "目标类型无效。";
  if (!Object.values(GoalStatus).includes(draft.status)) return "目标状态无效。";
  if (draft.level === GoalLevel.Department && draft.departmentId === null) return "部门目标必须选择所属部门。";

  if (draft.type === GoalType.Period) {
    if (Number.isNaN(draft.targetValue) || Number.isNaN(draft.currentValue)) {
      return "目标值和当前值必须是数字。";
    }
  }

  if (draft.parentGoalId !== null) {
    const parentGoal = getGoal(draft.parentGoalId);

    if (parentGoal === null) {
      return "对齐目标不存在。";
    }
    if (parentGoal.id === editingGoalId) {
      return "目标不能对齐到自己。";
    }
  }

  if (createsCycle(editingGoalId, draft.parentGoalId)) {
    return "不能形成循环对齐。";
  }

  return "";
}

function buildAlignmentDraft(goal, parentGoalId) {
  return {
    name: goal.name,
    level: goal.level,
    type: goal.type,
    departmentId: goal.departmentId,
    ownerId: goal.ownerId,
    parentGoalId,
    periodType: goal.periodType,
    periodValue: goal.periodValue,
    metricName: goal.metricName,
    metricUnit: goal.metricUnit,
    metricDirection: goal.metricDirection,
    targetValue: goal.targetValue,
    currentValue: goal.currentValue,
    description: goal.description ?? "",
    status: goal.status,
  };
}

function validateDraggedGoalAlignment(draggedGoal, targetGoal) {
  if (draggedGoal.id === targetGoal.id) return "不能对齐到自己。";
  if (createsCycle(draggedGoal.id, targetGoal.id)) return "不能形成循环对齐。";
  return "";
}

async function alignGoalToParent(draggedGoalId, targetGoalId, rerender) {
  const draggedGoal = getGoal(draggedGoalId);
  const targetGoal = getGoal(targetGoalId);
  if (draggedGoal === null || targetGoal === null) return;

  const error = validateDraggedGoalAlignment(draggedGoal, targetGoal);
  if (error !== "") {
    window.alert(error);
    return;
  }

  if (!window.confirm(`确定将「${draggedGoal.name}」对齐到「${targetGoal.name}」吗？`)) return;

  const previousGoals = goals.map((goal) => ({ ...goal }));
  const previousSelectedGoalId = selectedGoalId;
  const now = getNow();
  const updatedGoal = {
    ...draggedGoal,
    parentGoalId: targetGoalId,
    updatedAt: now,
  };
  replaceGoals(
    goals.map((goal) =>
      goal.id === draggedGoalId
        ? updatedGoal
        : goal,
    ),
  );
  selectedGoalId = draggedGoalId;
  selectedGoalProcessInstanceId = null;
  try {
    await updatePersistentResource("goals", draggedGoalId, updatedGoal);
  } catch (error) {
    console.error("目标对齐保存失败", error);
    replaceGoals(previousGoals);
    selectedGoalId = previousSelectedGoalId;
    window.alert(error.message || "目标对齐保存失败，请检查本地数据库服务。");
  }
  rerender();
}

function setModalError(error) {
  modalState = { ...modalState, error };
  const errorElement = document.querySelector(".modal-form .form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
  }
}

async function saveGoal(form, rerender) {
  if (isSavingGoal) return;
  const draft = buildGoalDraft(form);
  const editingGoalId = modalState.mode === "edit" ? modalState.goalId : null;
  const error = validateGoalDraft(draft, editingGoalId);

  if (error !== "") return setModalError(error, rerender);

  const previousGoals = goals.map((goal) => ({ ...goal }));
  const previousSelectedGoalId = selectedGoalId;
  isSavingGoal = true;
  setModalError("");

  if (modalState.mode === "add") {
    const now = getNow();
    const goalId = createId("goal");
    const newGoal = {
      id: goalId,
      ...draft,
      status: GoalStatus.Active,
      createdAt: now,
      updatedAt: now,
    };

    replaceGoals([
      ...goals,
      newGoal,
    ]);
    selectedGoalId = goalId;
    try {
      await createPersistentResource("goals", newGoal);
    } catch (error) {
      console.error("新增目标保存失败", error);
      isSavingGoal = false;
      replaceGoals(previousGoals);
      selectedGoalId = previousSelectedGoalId;
      modalState = {
        ...modalState,
        error: "新增目标失败，请检查本地数据库服务。",
      };
      rerender();
      return;
    }
  } else {
    const now = getNow();
    const updatedGoal = {
      ...getGoal(modalState.goalId),
      ...draft,
      updatedAt: now,
    };

    replaceGoals(
      goals.map((goal) =>
        goal.id === modalState.goalId ? updatedGoal : goal,
      ),
    );
    try {
      await updatePersistentResource("goals", modalState.goalId, updatedGoal);
    } catch (error) {
      console.error("目标保存失败", error);
      isSavingGoal = false;
      replaceGoals(previousGoals);
      selectedGoalId = previousSelectedGoalId;
      modalState = {
        ...modalState,
        error: "保存目标失败，请检查本地数据库服务。",
      };
      rerender();
      return;
    }
  }

  isSavingGoal = false;
  modalState = null;
  rerender();
}

async function saveCurrentValue(form, rerender) {
  const currentValue = parseNullableNumber(getFormValue(form, "currentValue"));

  if (Number.isNaN(currentValue)) {
    return setModalError("当前值必须是数字。", rerender);
  }

  const goal = getGoal(modalState.goalId);
  if (goal === null) return;
  const previousGoals = goals.map((item) => ({ ...item }));
  const now = getNow();
  const updatedGoal = { ...goal, currentValue, updatedAt: now };

  replaceGoals(
    goals.map((goal) =>
      goal.id === modalState.goalId ? updatedGoal : goal,
    ),
  );
  try {
    await updatePersistentResource("goals", updatedGoal.id, updatedGoal);
    modalState = null;
  } catch (error) {
    console.error("目标当前值保存失败", error);
    replaceGoals(previousGoals);
    modalState = { ...modalState, error: error.message || "目标当前值保存失败，请检查本地数据库服务。" };
  }
  rerender();
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

async function saveGoalTask(form, rerender) {
  const draft = buildGoalTaskDraft(form, modalState.goalId);
  const productIds = collectActionProductIds(form);
  const error = validateGoalTaskDraft(draft);

  if (error !== "") return setModalError(error, rerender);
  if (draft.template.id === publishContentNoteTemplateId && productIds.length === 0) {
    return setModalError("发布内容笔记必须关联至少一个产品。", rerender);
  }

  let uploadedAttachments = [];
  try {
    uploadedAttachments = await uploadSelectedStandardWorkAttachments(form);
  } catch (uploadError) {
    return setModalError(uploadError.message ?? "附件上传失败。", rerender);
  }

  const displayTitle = buildDisplayTitle(draft.template, draft.customFields);
  const coverImageUrl = getPrimaryImageUrl({ customFields: draft.customFields }) || null;
  const now = getNow();
  const workPlanId = createId("work-plan");
  const sourceFields = modalState.sourceContext?.source === "sales_anomaly"
    ? { ...draft.customFields, source: "sales_anomaly", sourceType: "sales_anomaly", actionStandardId: draft.template.id, salesLinkId: modalState.sourceContext.salesLinkId ?? null, productId: modalState.sourceContext.productId ?? null, anomalySnapshot: modalState.sourceContext.anomalySnapshot, baselineSnapshot: modalState.sourceContext.baselineSnapshot, recommendedActionStandard: modalState.recommendedActionStandard ?? modalState.sourceContext.recommendedActionStandard, recommendedActionTemplate: modalState.recommendedActionTemplate ?? modalState.sourceContext.recommendedActionTemplate }
    : draft.customFields;
  const customFields =
    uploadedAttachments.length === 0
      ? sourceFields
      : {
          ...sourceFields,
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
    departmentId: draft.departmentId,
    taskTemplateId: draft.template.id,
    title: draft.title || displayTitle,
    customFields,
    coverImageUrl,
    status: WorkPlanStatus.Future,
    plannedWeek: null,
    dueDate: draft.dueDate,
    description: draft.description,
    processInstanceId: null,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    canceledAt: null,
  };

  try {
    await createPersistentResource("work-plans", workPlan);
  } catch (error) {
    console.error("关键行动保存失败", error);
    return setModalError(error.message || "关键行动保存失败，请检查本地数据库服务。", rerender);
  }

  selectedGoalId = draft.goalId;
  state.workPlans = [workPlan, ...state.workPlans];
  if (modalState.launchImmediately) {
    try {
      await launchWorkPlanAsProcess(workPlan.id, { dueDate: workPlan.dueDate, productIds });
    } catch (error) {
      console.error("关键行动发起失败", error);
      return setModalError(error.message || "关键行动发起失败，请检查本地数据库服务。", rerender);
    }
  }
  modalState = null;
  rerender();
}

async function updateGoalStatus(goalId, status, rerender) {
  const previousGoals = goals.map((goal) => ({ ...goal }));
  const previousSelectedGoalId = selectedGoalId;
  const now = getNow();
  const goal = getGoal(goalId);
  if (goal === null) return;
  const updatedGoal = { ...goal, status, updatedAt: now };

  replaceGoals(
    goals.map((goal) =>
      goal.id === goalId ? updatedGoal : goal,
    ),
  );
  if (status === GoalStatus.Inactive && !showInactiveGoals && selectedGoalId === goalId) {
    ensureSelectedGoalVisible();
  }
  if (status !== GoalStatus.Inactive) {
    selectedGoalId = goalId;
  }

  try {
    await updatePersistentResource("goals", goalId, updatedGoal);
  } catch (error) {
    console.error("目标状态保存失败", error);
    replaceGoals(previousGoals);
    selectedGoalId = previousSelectedGoalId;
    window.alert(error.message || "目标状态保存失败，请检查本地数据库服务。");
  }

  modalState = null;
  rerender();
}

function updateGoalFormVisibility() {
  const form = document.querySelector(".goal-form");

  if (form === null) return;

  const level = form.elements.level.value;
  const type = form.elements.type.value;
  const departmentId = form.elements.departmentId.value;
  const editingGoalId = form.dataset.editingGoalId || null;
  const draft = {
    level,
    type,
    departmentId: level === GoalLevel.Department ? departmentId || null : null,
  };

  form.querySelector('[data-field-group="department"]').hidden = level === GoalLevel.Company;
  form.elements.departmentId.required = level === GoalLevel.Department;
  form.querySelectorAll('[data-field-group="period"], [data-field-group="metric"]').forEach((field) => {
    field.hidden = type === GoalType.Ultimate;
  });
  if (type === GoalType.Period && form.elements.currentValue.value.trim() === "") {
    form.elements.currentValue.value = "0";
  }

  Array.from(form.elements.parentGoalId.options).forEach((option) => {
    if (option.value === "") {
      option.hidden = false;
      return;
    }

    option.hidden = !isSelectableParent(
      {
        id: option.value,
        level: option.dataset.level,
        type: option.dataset.type,
        departmentId: option.dataset.departmentId || null,
        status: option.dataset.status,
      },
      draft,
      editingGoalId,
    );
  });

  const selectedOption = form.elements.parentGoalId.selectedOptions[0];

  if (selectedOption?.hidden) {
    form.elements.parentGoalId.value = "";
  }
}

function handleGoalClick(event, rerender) {
  const button = event.target.closest("[data-action]");

  if (button === null) return;

  event.stopPropagation();

  const action = button.dataset.action;
  const goalId = button.dataset.goalId;

  if (action === "remove-product-image") {
    removePublicFormImage(button);
    return;
  }

  if (action === "add-goal") {
    if (!canCurrentUser("goals.manage")) return;
    modalState = { kind: "goal", mode: "add", error: "" };
    rerender();
    return;
  }

  if (action === "select-goal") {
    selectedGoalId = goalId;
    rerender();
    return;
  }

  if (action === "add-goal-task") {
    if (!canCurrentUserLaunchGoalAction()) return;
    const goal = getGoal(goalId);
    if (goal === null || isInactiveGoal(goal)) return;
    selectedGoalId = goalId;
    modalState = {
      kind: "goalTask",
      goalId,
      categoryId: "",
      taskTemplateId: "",
      title: button.dataset.modalTitle ?? "发起关键行动",
      launchImmediately: true,
      error: "",
    };
    rerender();
    return;
  }

  if (action === "edit-goal") {
    if (!canCurrentUser("goals.manage")) return;
    modalState = { kind: "goal", mode: "edit", goalId, error: "" };
    rerender();
    return;
  }

  if (action === "update-current-value") {
    modalState = { kind: "currentValue", goalId, error: "" };
    rerender();
    return;
  }

  if (action === "deactivate-goal") {
    if (!canCurrentUser("goals.close")) return;
    modalState = { kind: "deactivateGoal", goalId };
    rerender();
    return;
  }

  if (action === "confirm-deactivate-goal") {
    if (!canCurrentUser("goals.close")) return;
    updateGoalStatus(goalId, GoalStatus.Inactive, rerender);
    return;
  }

  if (action === "activate-goal") {
    if (!canCurrentUser("goals.close")) return;
    updateGoalStatus(goalId, GoalStatus.Active, rerender);
    return;
  }

  if (action === "view-goal-process") {
    if (!canCurrentUser("goals.view")) return;
    selectedGoalProcessInstanceId = button.dataset.instanceId;
    rerender();
    return;
  }

  if (action === "close-goal-modal") {
    modalState = null;
    rerender();
    return;
  }

  if (action === "remove-selected-standard-work-attachment") {
    removeSelectedStandardWorkAttachment(button);
  }
}

function bindGoalTabs(rerender) {
  document.querySelectorAll("[data-goal-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeGoalTab = tab.dataset.goalTab;
      rerender();
    });
  });
}

function handleGoalDragStart(event) {
  if (!canCurrentUser("goals.manage")) {
    event.preventDefault();
    return;
  }
  if (event.target.closest("[data-action], button, input, select, textarea")) {
    event.preventDefault();
    return;
  }

  const card = event.target.closest(".goal-map-card[data-goal-drag-id]");
  if (card === null) return;
  event.stopPropagation();
  draggedGoalId = card.dataset.goalDragId;
  dragOverGoalId = null;
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedGoalId);
}

function handleGoalDragEnter(event) {
  const dropCard = event.target.closest(".goal-map-card[data-goal-drop-id]");
  if (dropCard === null || draggedGoalId === null) return;
  event.preventDefault();
}

function handleGoalDragOver(event) {
  const dropCard = event.target.closest(".goal-map-card[data-goal-drop-id]");
  if (dropCard === null || draggedGoalId === null) return;
  const targetGoalId = dropCard.dataset.goalDropId;
  if (targetGoalId === draggedGoalId) return;
  event.preventDefault();
  const draggedGoal = getGoal(draggedGoalId);
  const targetGoal = getGoal(targetGoalId);
  const canDrop = draggedGoal !== null && targetGoal !== null && validateDraggedGoalAlignment(draggedGoal, targetGoal) === "";
  event.dataTransfer.dropEffect = "move";
  if (dragOverGoalId !== targetGoalId) {
    document.querySelectorAll(".goal-map-card.is-drag-over").forEach((card) => card.classList.remove("is-drag-over"));
    dragOverGoalId = canDrop ? targetGoalId : null;
    if (canDrop) dropCard.classList.add("is-drag-over");
  }
}

function handleGoalDragLeave(event) {
  const dropCard = event.target.closest(".goal-map-card[data-goal-drop-id]");
  if (dropCard === null || dropCard.dataset.goalDropId !== dragOverGoalId) return;
  const nextTarget = event.relatedTarget?.closest?.(".goal-map-card[data-goal-drop-id]");
  if (nextTarget === dropCard) return;
  dragOverGoalId = null;
  dropCard.classList.remove("is-drag-over");
}

async function handleGoalDrop(event, rerender) {
  const dropCard = event.target.closest(".goal-map-card[data-goal-drop-id]");
  if (dropCard === null) return;
  event.preventDefault();
  event.stopPropagation();
  const droppedGoalId = event.dataTransfer.getData("text/plain") || draggedGoalId;
  const targetGoalId = dropCard.dataset.goalDropId;
  draggedGoalId = null;
  dragOverGoalId = null;
  document.querySelectorAll(".goal-map-card.is-dragging, .goal-map-card.is-drag-over").forEach((card) => {
    card.classList.remove("is-dragging", "is-drag-over");
  });
  if (droppedGoalId === null || droppedGoalId === "" || targetGoalId === droppedGoalId) {
    return;
  }
  await alignGoalToParent(droppedGoalId, targetGoalId, rerender);
}

function handleGoalDragEnd() {
  draggedGoalId = null;
  dragOverGoalId = null;
  document.querySelectorAll(".goal-map-card.is-dragging, .goal-map-card.is-drag-over").forEach((card) => {
    card.classList.remove("is-dragging", "is-drag-over");
  });
}

async function handleGoalSubmit(event, rerender) {
  event.preventDefault();

  if (modalState?.kind === "goal") {
    await saveGoal(event.target, rerender);
  }

  if (modalState?.kind === "currentValue") {
    await saveCurrentValue(event.target, rerender);
  }

  if (modalState?.kind === "goalTask") {
    await saveGoalTask(event.target, rerender);
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

async function handleImageUpload(input) {
  try {
    await handlePublicFormImageUpload(input);
    setModalError("");
  } catch (error) {
    setModalError(error.message ?? "图片上传失败。");
  }
}

export function bindGoalsPageEvents(rerender) {
  const goalsPage = document.querySelector(".goals-page");
  const goalForm = document.querySelector(".goal-form");
  const currentValueForm = document.querySelector(".current-value-form");
  const goalTaskForm = document.querySelector(".goal-task-form");

  if (goalsPage === null) return;

  bindGoalTabs(rerender);
  goalsPage.addEventListener("click", (event) => handleGoalClick(event, rerender));
  goalsPage.addEventListener("change", (event) => {
    if (event.target.matches("[data-goal-toggle-inactive]")) {
      showInactiveGoals = event.target.checked;
      ensureSelectedGoalVisible();
      rerender();
    }
  });
  goalsPage.addEventListener("input", (event) => {
    const input = event.target.closest("[data-goal-keyword]");
    if (input === null) return;
    goalKeyword = input.value;
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    rerender();
    window.requestAnimationFrame(() => {
      const nextInput = document.querySelector("[data-goal-keyword]");
      if (nextInput === null) return;
      nextInput.focus({ preventScroll: true });
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    });
  });
  goalsPage.addEventListener("dragstart", handleGoalDragStart);
  goalsPage.addEventListener("dragenter", handleGoalDragEnter);
  goalsPage.addEventListener("dragover", handleGoalDragOver);
  goalsPage.addEventListener("dragleave", handleGoalDragLeave);
  goalsPage.addEventListener("drop", (event) => handleGoalDrop(event, rerender));
  goalsPage.addEventListener("dragend", handleGoalDragEnd);

  if (goalForm !== null) {
    goalForm.addEventListener("submit", (event) => handleGoalSubmit(event, rerender));
    goalForm.addEventListener("change", updateGoalFormVisibility);
    updateGoalFormVisibility();
  }

  if (currentValueForm !== null) {
    currentValueForm.addEventListener("submit", (event) => handleGoalSubmit(event, rerender));
  }

  if (goalTaskForm !== null) {
    bindActionProductSelectors(goalTaskForm);
    bindActionLinkedTemplatePreviewEvents(goalTaskForm);
    const updateSuggestedContentNoteTitle = () => {
      const titleInput = goalTaskForm.querySelector("[data-goal-action-title]");
      if (titleInput === null || titleInput.dataset.autoTitle === "false") return;
      const productId = goalTaskForm.querySelector('[name="actionProductId"]:checked')?.value ?? "";
      const templateId = goalTaskForm.querySelector('[name="linkedTemplateId"]:checked')?.value ?? "";
      const product = state.products.find((item) => item.id === productId);
      const template = state.templates.find((item) => item.id === templateId);
      titleInput.value = product !== undefined && template !== undefined
        ? `发布内容笔记｜${product.name}｜${template.name}`
        : "";
    };
    const updatePublishTimeMode = () => {
      const mode = getFormValue(goalTaskForm, "publishTimeMode") || PublishTimeMode.Custom;
      const publishInput = goalTaskForm.querySelector('[name="custom__publishDateDate"]');
      const publishHour = goalTaskForm.querySelector('[name="custom__publishDateHour"]');
      const publishLabel = publishInput?.closest("label");
      const deadlinePreview = goalTaskForm.querySelector("[data-publish-time-deadline-preview]");
      const deadlineValue = goalTaskForm.querySelector("[data-publish-time-deadline-value]");
      const deadlineResult = collectBusinessDateTime(goalTaskForm, "dueDate");
      const followsDeadline = mode === PublishTimeMode.Deadline;
      if (publishLabel !== null && publishLabel !== undefined) publishLabel.hidden = followsDeadline;
      if (publishHour !== null) publishHour.disabled = followsDeadline;
      if (publishInput !== null) publishInput.disabled = followsDeadline;
      if (deadlinePreview !== null) deadlinePreview.hidden = !followsDeadline;
      if (deadlineValue !== null) deadlineValue.textContent = deadlineResult.value ? formatBusinessDateTime(deadlineResult.value) : "请先设置截止时间";
    };
    goalTaskForm.addEventListener("submit", (event) => handleGoalSubmit(event, rerender));
    goalTaskForm.addEventListener("input", (event) => {
      if (event.target.name?.startsWith("custom__")) updatePublicFormImagePreview(event.target);
      if (event.target.matches("[data-goal-action-title]")) event.target.dataset.autoTitle = "false";
      if (event.target.name === "dueDateDate") updatePublishTimeMode();
    });
    goalTaskForm.addEventListener("change", (event) => {
      if (event.target.matches("[data-goal-work-value-module-select]")) {
        modalState = { ...modalState, categoryId: event.target.value, taskTemplateId: "", error: "" };
        rerender();
      }
      if (event.target.matches("[data-goal-task-template-select]")) {
        modalState = { ...modalState, taskTemplateId: event.target.value, error: "" };
        rerender();
      }
      if (event.target.matches("[data-image-upload-key]")) {
        handleImageUpload(event.target);
      }
      if (event.target.matches("[data-standard-work-attachments]")) {
        renderSelectedStandardWorkAttachments(event.target);
      }
      if (event.target.name === "actionProductId" || event.target.name === "linkedTemplateId") {
        updateSuggestedContentNoteTitle();
      }
      if (["publishTimeMode", "dueDateDate", "dueDateHour"].includes(event.target.name)) updatePublishTimeMode();
    });
    goalTaskForm.addEventListener("click", (event) => {
      if (event.target.closest("[data-action='clear-goal-linked-template']") !== null) {
        goalTaskForm.querySelectorAll('[name="linkedTemplateId"]').forEach((input) => {
          input.checked = false;
        });
        updateSuggestedContentNoteTitle();
        return;
      }
      if (event.target.closest("[data-action='remove-action-product']") !== null) {
        window.requestAnimationFrame(updateSuggestedContentNoteTitle);
      }
    });
    updatePublishTimeMode();
  }
  bindLaunchedProcessDetailEvents(goalsPage, rerender, {
    onTaskSelect: async (taskId) => {
      await invokeModuleAction("tasks", "selectTask", taskId);
      window.alert("已选中该任务，请切换到任务查看详情。");
    },
  });
}

function consumeGoalTaskPrefill() {
  if (modalState !== null || typeof window === "undefined") return;
  const rawPrefill = window.sessionStorage.getItem("goalTaskPrefill");
  if (rawPrefill === null) return;
  window.sessionStorage.removeItem("goalTaskPrefill");
  let prefill = null;
  try {
    prefill = JSON.parse(rawPrefill);
  } catch {
    return;
  }
  const requestedTemplate = getTaskTemplate(prefill?.taskTemplateId ?? "");
  const recommendedTemplate = state.taskTemplates.find((item) => item.status === TaskTemplateStatus.Active && item.id === (prefill?.recommendedActionStandard?.actionStandardId ?? prefill?.sourceContext?.recommendedActionStandard?.actionStandardId) && item.defaultProcessTemplateId) ?? state.taskTemplates.find((item) => item.status === TaskTemplateStatus.Active && item.name === prefill?.recommendedActionTemplate?.name && item.defaultProcessTemplateId) ?? null;
  const template = requestedTemplate ?? recommendedTemplate;
  const isSalesAnomaly = prefill?.sourceContext?.source === "sales_anomaly";
  const goal = getGoal(prefill?.goalId ?? selectedGoalId) ?? getActiveGoals()[0] ?? null;
  if ((!isSalesAnomaly && template === null) || goal === null || isInactiveGoal(goal)) return;
  selectedGoalId = goal.id;
  modalState = {
    kind: "goalTask",
    goalId: goal.id,
    categoryId: prefill.categoryId ?? template?.categoryId ?? "",
    taskTemplateId: template?.id ?? "",
    title: prefill.title ?? "发起关键行动",
    launchImmediately: prefill.launchImmediately === true,
    actionTitle: prefill.actionTitle ?? "",
    description: prefill.description ?? "",
    sourceContext: isSalesAnomaly ? prefill.sourceContext : null,
    recommendedActionTemplate: isSalesAnomaly ? prefill.recommendedActionTemplate ?? prefill.sourceContext?.recommendedActionTemplate ?? null : null,
    recommendedActionStandard: isSalesAnomaly ? prefill.recommendedActionStandard ?? prefill.sourceContext?.recommendedActionStandard ?? null : null,
    error: "",
  };
}

export function renderGoalsPage() {
  consumeGoalTaskPrefill();
  ensureSelectedGoalVisible();
  const content =
    activeGoalTab === "list"
      ? `
          ${renderFilters()}
          ${renderGoalTable()}
          ${renderGoalDetail()}
        `
      : `
          ${renderGoalTree()}
          ${renderGoalDetail()}
        `;

  return `
    <div class="goals-page">
      <div class="goal-page-controls">
        ${renderGoalTabs()}
        ${canCurrentUser("goals.manage") ? `<button class="primary-button" type="button" data-action="add-goal">新增目标</button>` : ""}
      </div>
      ${content}
      ${renderGoalModal()}
      ${renderCurrentValueModal()}
      ${renderDeactivateGoalModal()}
      ${renderGoalTaskModal()}
    </div>
  `;
}
