import { getCurrentUser, getProcessNodeStepOrder, resolveAssetUrl, savePersistentData, state, uploadImageFile } from "./appState.js?v=20260627-methods1";
import { hasPermission } from "./permissions.js?v=20260627-methods1";
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
  TaskImportance,
  TaskStatus,
  TaskTemplateStatus,
  TaskUrgency,
  WorkPlanStatus,
  goalLevelNames,
  goalPeriodTypeNames,
  goalStatusNames,
  goalTypeNames,
  metricDirectionNames,
  processInstanceStatusNames,
  taskImportanceNames,
  taskStatusNames,
  taskUrgencyNames,
} from "./data/modelOptions.js";
import { getPrimaryImageUrl, getTaskQuadrant, isTaskOverdue } from "./data/taskUtils.js?v=20260627-methods1";
import { bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js?v=20260627-methods1";
import { selectTask } from "./tasksPage.js?v=20260627-methods1";

const categories = state.categories;
const departments = state.departments;
const people = state.people;
const stores = state.stores;
let goals = state.goals;
let modalState = null;
let selectedGoalProcessInstanceId = null;
let draggedGoalId = null;
let dragOverGoalId = null;
let activeGoalTab = "alignment";
let isSavingGoal = false;
const today = "2026-06-24";
const plannedWeekPattern = /^\d{4}-W\d{2}$/;
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

function getTaskCategories() {
  return categories.filter((category) => category.type === CategoryType.Task);
}

function getActiveTaskTemplates() {
  return state.taskTemplates.filter((template) => template.status === TaskTemplateStatus.Active);
}

function getActiveDepartments() {
  return departments.filter((department) => department.status === "active");
}

function getActiveTaskTemplatesByDepartment(departmentId) {
  if (!departmentId) return [];
  return getActiveTaskTemplates().filter((template) => template.departmentId === departmentId);
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
  const tasks = getProcessTasks(instance.id);
  const done = tasks.filter((task) => task.status === TaskStatus.Done).length;
  return `${done}/${tasks.length}`;
}

function getCurrentProcessTasks(instance) {
  if (instance.status !== "running") return [];
  const tasks = getProcessTasks(instance.id)
    .filter((task) => task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled && task.status !== TaskStatus.Waiting)
    .sort((left, right) => {
      const leftNode = getProcessNode(left);
      const rightNode = getProcessNode(right);
      return getProcessNodeStepOrder(leftNode ?? {}) - getProcessNodeStepOrder(rightNode ?? {});
    });
  if (tasks.length === 0) return [];
  return [tasks[0]];
}

function getProcessCurrentStepText(instance) {
  if (instance.status === "done") return "已完成";
  if (instance.status === "stopped") return "已终止";
  const currentTasks = getCurrentProcessTasks(instance);
  if (currentTasks.length > 0) return currentTasks.map((task) => task.name).join("、");
  return "等待前置";
}

function getProcessCurrentOwners(instance) {
  const owners = Array.from(new Set(getCurrentProcessTasks(instance).map((task) => findName(people, task.ownerId, "未设置"))));
  return owners.length === 0 ? "-" : owners.join("、");
}

function isProcessInstanceOverdue(instance) {
  return getProcessTasks(instance.id).some((task) => task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled && isTaskOverdue(task, today));
}

function getStandardWorkName(instance) {
  const taskTemplateId = instance.taskTemplateId ?? instance.standardWorkId ?? null;
  return getTaskTemplate(taskTemplateId ?? "")?.name ?? "未关联标准工作事项";
}

function getProcessTemplateById(templateId) {
  return state.processTemplates.find((template) => template.id === templateId) ?? null;
}

function getProcessTemplateName(templateId) {
  return state.processTemplates.find((template) => template.id === templateId)?.name ?? "未绑定标准流程";
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

function renderCustomFieldInput(field) {
  const requiredMark = "";

  if (field.type === "textarea") {
    return `<label><span>${field.label}${requiredMark}</span><textarea name="custom__${field.key}" rows="3" placeholder="${escapeHtml(field.placeholder ?? "")}"></textarea></label>`;
  }

  if (field.type === "select") {
    const options = getDynamicFieldOptions(field);
    return `
      <label>
        <span>${field.label}${requiredMark}</span>
        <select name="custom__${field.key}">
          <option value="">${field.key === "storeId" && options.length === 0 ? "暂无可选店铺，请先到设置 → 店铺管理中新增店铺。" : "请选择"}</option>
          ${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
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
          ${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  if (field.type === "image") {
    return `
      <label class="image-url-field">
        <span>${field.label}${requiredMark}</span>
        <input name="custom__${field.key}" type="hidden" />
        <input name="upload__${field.key}" type="file" accept="image/jpeg,image/png,image/webp" data-image-upload-key="${escapeHtml(field.key)}" />
        <span class="form-note">上传1:1产品图，支持 JPG、PNG、WebP，单张不超过 5MB。</span>
        <span class="image-preview-box">暂无图片</span>
      </label>
    `;
  }

  const inputType = field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text";
  return `<label><span>${field.label}${requiredMark}</span><input name="custom__${field.key}" type="${inputType}" placeholder="${escapeHtml(field.placeholder ?? "")}" /></label>`;
}

function renderCustomFieldsForm(template) {
  const fields = getSortedFormFields(template);
  if (fields.length === 0) return "";

  return `
    <div class="template-custom-fields">
      <h3>本次任务信息</h3>
      <div class="form-grid">
        ${fields.map((field) => renderCustomFieldInput(field)).join("")}
      </div>
    </div>
  `;
}

function collectCustomFields(form, template) {
  const formData = new FormData(form);
  return getSortedFormFields(template).reduce((result, field) => {
    if (field.type === "multi_select") {
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
    if (field.type === "number" && Number.isNaN(Number(value))) return `${field.label}必须是数字。`;
    if (field.type === "date" && Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) return `${field.label}必须是合法日期。`;
    if (field.type === "url" && !isValidUrl(value)) return `${field.label}必须是有效链接。`;
    if (field.type === "image" && !isValidImagePath(value)) return `${field.label}必须是上传后的图片路径。`;
    if (field.type === "select" && !getDynamicFieldOptions(field).some((option) => option.value === value)) return `${field.label}必须选择有效选项。`;
    if (field.type === "multi_select" && value.some((item) => !getDynamicFieldOptions(field).some((option) => option.value === item))) return `${field.label}包含无效选项。`;
  }
  return "";
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
    return `<p class="form-note">请选择标准工作事项后查看自动带出的锁定信息。</p>`;
  }

  return `
    <div class="locked-template-info">
      ${renderDetailField("标准工作名称", escapeHtml(template.name))}
      ${renderDetailField("工作分类", findName(categories, template.categoryId, "未设置"))}
      ${renderDetailField("对应标准流程", getProcessTemplateName(template.defaultProcessTemplateId))}
      ${renderDetailField("负责部门", findName(departments, template.departmentId, "未设置"))}
      ${renderDetailField("负责人", findName(people, template.ownerId, "未设置"))}
      ${renderDetailField("重要性", taskImportanceNames[template.importance])}
      ${renderDetailField("紧急性", taskUrgencyNames[template.urgency])}
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
      draggable="${canCurrentUser("goals.dragAlign") ? "true" : "false"}"
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
        canCurrentUser("goals.addWork")
          ? `
            <div class="goal-map-card-actions">
              <button
                class="secondary-button compact-button goal-card-add-work-button"
                type="button"
                draggable="false"
                data-action="add-goal-task"
                data-goal-id="${goal.id}"
                data-modal-title="添加工作"
              >
                添加工作
              </button>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderGoalMapNode(goal) {
  const children = getChildren(goal.id);

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
  const rootGoals = goals
    .filter((goal) => goal.parentGoalId === null)
    .sort((left, right) => {
      if (left.level === GoalLevel.Company && left.type === GoalType.Ultimate) return -1;
      if (right.level === GoalLevel.Company && right.type === GoalType.Ultimate) return 1;
      return left.createdAt.localeCompare(right.createdAt);
    });

  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>目标对齐图</h2>
      </div>
      <div class="goal-map-scroll">
        <div class="goal-map">
          ${rootGoals.map((goal) => renderGoalMapNode(goal)).join("")}
        </div>
      </div>
    </section>
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
            <th>执行任务名称</th>
            <th>负责人</th>
            <th>负责部门</th>
            <th>四象限</th>
            <th>截止日期</th>
            <th>状态</th>
            <th>是否逾期</th>
          </tr>
        </thead>
        <tbody>
          ${
            goalTasks.length === 0
              ? `<tr><td colspan="7">暂无关联执行任务</td></tr>`
              : goalTasks
                  .map(
                    (task) => `
                      <tr>
                        <td>${escapeHtml(task.name)}</td>
                        <td>${findName(people, task.ownerId, "未设置")}</td>
                        <td>${findName(departments, task.departmentId, "未设置")}</td>
                        <td>${getTaskQuadrant(task.importance, task.urgency)}</td>
                        <td>${task.dueDate ?? "未设置"}</td>
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
    return `<div class="empty-detail">暂无已发起流程</div>`;
  }

  return `
    <div class="table-wrap">
      <table class="data-table compact-goal-process-table">
        <thead>
          <tr>
            <th>本次工作标题</th>
            <th>标准工作事项</th>
            <th>标准流程</th>
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
                  <td>${escapeHtml(getProcessTemplate(instance)?.name ?? "未知流程")}</td>
                  <td>${escapeHtml(getProcessCurrentStepText(instance))}</td>
                  <td>${getProcessProgress(instance)}</td>
                  <td>${escapeHtml(getProcessCurrentOwners(instance))}</td>
                  <td>${findName(people, instance.initiatorId, "未设置")}</td>
                  <td><span class="status-pill">${processInstanceStatusNames[instance.status]}</span></td>
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
          ${canCurrentUser("goals.edit") ? `<button class="secondary-button" type="button" data-action="edit-goal" data-goal-id="${goal.id}">编辑目标</button>` : ""}
          ${canCurrentUser("goals.addWork") ? `<button class="primary-button" type="button" data-action="add-goal-task" data-goal-id="${goal.id}">添加未来工作</button>` : ""}
        </div>
      </div>
      <div class="detail-block">
        <h3>目标基本信息</h3>
        <div class="detail-grid">
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
        canCurrentUser("goals.viewRelatedData")
          ? `
            <div class="detail-block">
              <h3>目标下的执行任务</h3>
              ${renderGoalTaskTable(goal)}
            </div>
            <div class="detail-block">
              <h3>已发起流程</h3>
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
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>目标列表</h2>
      </div>
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
            ${goals
              .map(
                (goal) => `
                  <tr>
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
                        ${canCurrentUser("goals.edit") ? renderActionButton("编辑", "edit-goal", goal.id) : ""}
                        ${
                          goal.type === GoalType.Period
                            ? renderActionButton("更新当前值", "update-current-value", goal.id)
                            : ""
                        }
                        ${canCurrentUser("goals.delete") ? renderActionButton("停用", "deactivate-goal", goal.id, "danger-button") : ""}
                      </span>
                    </td>
                  </tr>
                `,
              )
              .join("")}
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
          <button class="icon-button" type="button" data-action="close-goal-modal" aria-label="关闭">×</button>
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
          <button class="icon-button" type="button" data-action="close-goal-modal" aria-label="关闭">×</button>
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

function renderGoalTaskModal() {
  if (modalState === null || modalState.kind !== "goalTask") return "";

  const goal = getGoal(modalState.goalId);
  const selectedDepartmentId = modalState.departmentId ?? "";
  const availableTemplates = getActiveTaskTemplatesByDepartment(selectedDepartmentId);
  const selectedTemplate = availableTemplates.find((template) => template.id === modalState.taskTemplateId) ?? null;
  const templateHint =
    selectedDepartmentId === ""
      ? "请先选择部门"
      : availableTemplates.length === 0
        ? "该部门暂无标准工作事项，请先到标准工作库中添加。"
        : "请选择标准工作事项";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(modalState.title ?? "添加未来工作")}">
        <div class="modal-header">
          <h2>${escapeHtml(modalState.title ?? "添加未来工作")}</h2>
          <button class="icon-button" type="button" data-action="close-goal-modal" aria-label="关闭">×</button>
        </div>
        <form class="modal-form goal-task-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <p class="form-note">自动对齐目标：${escapeHtml(goal?.name ?? "未选择目标")}</p>
          <div class="form-grid">
            <label>
              <span>选择部门</span>
              <select name="departmentId" data-goal-work-department-select>
                ${renderOptions(getActiveDepartments(), selectedDepartmentId, "请选择部门")}
              </select>
            </label>
            <label>
              <span>标准工作事项</span>
              <select name="taskTemplateId" data-goal-task-template-select ${selectedDepartmentId === "" ? "disabled" : ""}>
                ${renderOptions(availableTemplates, modalState.taskTemplateId ?? "", templateHint)}
              </select>
            </label>
            <label>
              <span>本次工作标题</span>
              <input name="title" placeholder="可留空，系统会根据填写信息生成" autocomplete="off" />
            </label>
            <label>
              <span>重要性</span>
              <select name="importance">${renderValueOptions(TaskImportance, selectedTemplate?.importance ?? TaskImportance.Important, taskImportanceNames)}</select>
            </label>
            <label>
              <span>紧急性</span>
              <select name="urgency">${renderValueOptions(TaskUrgency, selectedTemplate?.urgency ?? TaskUrgency.NotUrgent, taskUrgencyNames)}</select>
            </label>
            <label>
              <span>期望完成日期</span>
              <input name="dueDate" type="date" />
            </label>
          </div>
          ${renderTaskTemplateLockedInfo(selectedTemplate)}
          ${renderCustomFieldsForm(selectedTemplate)}
          <label>
            <span>补充说明</span>
            <textarea name="description" rows="3"></textarea>
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
  const selectedDepartmentId = getFormValue(form, "departmentId");
  let taskTemplateId = getFormValue(form, "taskTemplateId");
  let template = getTaskTemplate(taskTemplateId);
  if (template === null) {
    template = getActiveTaskTemplatesByDepartment(selectedDepartmentId)[0] ?? getActiveTaskTemplates()[0] ?? null;
    taskTemplateId = template?.id ?? "";
  }
  const departmentId = selectedDepartmentId || template?.departmentId || "";
  const customFields = template === null ? {} : collectCustomFields(form, template);

  return {
    goalId,
    departmentId,
    taskTemplateId,
    template,
    customFields,
    title: getFormValue(form, "title") || null,
    importance: getFormValue(form, "importance"),
    urgency: getFormValue(form, "urgency"),
    dueDate: getFormValue(form, "dueDate") || null,
    description: getFormValue(form, "description") || null,
  };
}

function validateGoalTaskDraft(draft) {
  if (getGoal(draft.goalId) === null) return "当前目标必须存在。";
  if (draft.taskTemplateId === "" || draft.template === null) return "必须选择启用的标准工作事项。";
  if (draft.template.status !== TaskTemplateStatus.Active) return "停用的标准工作事项不能用于添加未来工作。";
  if (!draft.template.defaultProcessTemplateId) return "该标准工作事项尚未绑定标准流程，请先到标准工作库中配置。";
  const customError = validateCustomFields(draft.customFields, draft.template);
  if (customError !== "") return customError;
  if (draft.dueDate !== null && Number.isNaN(Date.parse(`${draft.dueDate}T00:00:00+08:00`))) return "期望完成日期必须是合法日期。";

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

function alignGoalToParent(draggedGoalId, targetGoalId, rerender) {
  const draggedGoal = getGoal(draggedGoalId);
  const targetGoal = getGoal(targetGoalId);
  if (draggedGoal === null || targetGoal === null) return;

  const error = validateDraggedGoalAlignment(draggedGoal, targetGoal);
  if (error !== "") {
    window.alert(error);
    return;
  }

  if (!window.confirm(`确定将「${draggedGoal.name}」对齐到「${targetGoal.name}」吗？`)) return;

  const now = getNow();
  replaceGoals(
    goals.map((goal) =>
      goal.id === draggedGoalId
        ? {
            ...goal,
            parentGoalId: targetGoalId,
            updatedAt: now,
          }
        : goal,
    ),
  );
  selectedGoalId = draggedGoalId;
  selectedGoalProcessInstanceId = null;
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

    replaceGoals([
      ...goals,
      {
        id: goalId,
        ...draft,
        status: GoalStatus.Active,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    selectedGoalId = goalId;
  } else {
    const now = getNow();

    replaceGoals(
      goals.map((goal) =>
        goal.id === modalState.goalId ? { ...goal, ...draft, updatedAt: now } : goal,
      ),
    );
  }

  const saved = await savePersistentData();
  isSavingGoal = false;

  if (!saved) {
    replaceGoals(previousGoals);
    selectedGoalId = previousSelectedGoalId;
    modalState = {
      ...modalState,
      error: modalState.mode === "add" ? "新增目标失败，请检查本地数据库服务。" : "保存目标失败，请检查本地数据库服务。",
    };
    rerender();
    return;
  }

  modalState = null;
  rerender();
}

function saveCurrentValue(form, rerender) {
  const currentValue = parseNullableNumber(getFormValue(form, "currentValue"));

  if (Number.isNaN(currentValue)) {
    return setModalError("当前值必须是数字。", rerender);
  }

  const now = getNow();

  replaceGoals(
    goals.map((goal) =>
      goal.id === modalState.goalId ? { ...goal, currentValue, updatedAt: now } : goal,
    ),
  );
  modalState = null;
  rerender();
}

function saveGoalTask(form, rerender) {
  const draft = buildGoalTaskDraft(form, modalState.goalId);
  const error = validateGoalTaskDraft(draft);

  if (error !== "") return setModalError(error, rerender);

  const displayTitle = buildDisplayTitle(draft.template, draft.customFields);
  const coverImageUrl = getPrimaryImageUrl({ customFields: draft.customFields }) || null;
  const now = getNow();

  selectedGoalId = draft.goalId;
  state.workPlans = [
    {
      id: createId("work-plan"),
      goalId: draft.goalId,
      departmentId: draft.departmentId,
      taskTemplateId: draft.template.id,
      title: draft.title || displayTitle,
      customFields: draft.customFields,
      coverImageUrl,
      importance: draft.importance,
      urgency: draft.urgency,
      status: WorkPlanStatus.Future,
      plannedWeek: null,
      dueDate: draft.dueDate,
      description: draft.description,
      processInstanceId: null,
      createdAt: now,
      updatedAt: now,
      launchedAt: null,
      canceledAt: null,
    },
    ...state.workPlans,
  ];
  modalState = null;
  rerender();
}

function deactivateGoal(goalId, rerender) {
  const now = getNow();

  replaceGoals(
    goals.map((goal) =>
      goal.id === goalId ? { ...goal, status: GoalStatus.Inactive, updatedAt: now } : goal,
    ),
  );
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

  if (action === "add-goal") {
    if (!canCurrentUser("goals.create")) return;
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
    if (!canCurrentUser("goals.addWork")) return;
    selectedGoalId = goalId;
    modalState = { kind: "goalTask", goalId, departmentId: "", taskTemplateId: "", title: button.dataset.modalTitle ?? "添加未来工作", error: "" };
    rerender();
    return;
  }

  if (action === "edit-goal") {
    if (!canCurrentUser("goals.edit")) return;
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
    if (!canCurrentUser("goals.delete")) return;
    if (window.confirm("确定要停用该目标吗？停用后历史任务和流程仍会保留。")) {
      deactivateGoal(goalId, rerender);
    }
    return;
  }

  if (action === "view-goal-process") {
    if (!canCurrentUser("goals.viewRelatedData")) return;
    selectedGoalProcessInstanceId = button.dataset.instanceId;
    rerender();
    return;
  }

  if (action === "close-goal-modal") {
    modalState = null;
    rerender();
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
  if (!canCurrentUser("goals.dragAlign")) {
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

function handleGoalDrop(event, rerender) {
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
  alignGoalToParent(droppedGoalId, targetGoalId, rerender);
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
    saveCurrentValue(event.target, rerender);
  }

  if (modalState?.kind === "goalTask") {
    saveGoalTask(event.target, rerender);
  }
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

export function bindGoalsPageEvents(rerender) {
  const goalsPage = document.querySelector(".goals-page");
  const goalForm = document.querySelector(".goal-form");
  const currentValueForm = document.querySelector(".current-value-form");
  const goalTaskForm = document.querySelector(".goal-task-form");

  if (goalsPage === null) return;

  bindGoalTabs(rerender);
  goalsPage.addEventListener("click", (event) => handleGoalClick(event, rerender));
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
    goalTaskForm.addEventListener("submit", (event) => handleGoalSubmit(event, rerender));
    goalTaskForm.addEventListener("input", (event) => {
      if (event.target.name?.startsWith("custom__")) updateImagePreview(event.target);
    });
    goalTaskForm.addEventListener("change", (event) => {
      if (event.target.matches("[data-goal-work-department-select]")) {
        modalState = { ...modalState, departmentId: event.target.value, taskTemplateId: "", error: "" };
        rerender();
      }
      if (event.target.matches("[data-goal-task-template-select]")) {
        modalState = { ...modalState, taskTemplateId: event.target.value, error: "" };
        rerender();
      }
      if (event.target.matches("[data-image-upload-key]")) {
        handleImageUpload(event.target);
      }
    });
  }
  bindLaunchedProcessDetailEvents(goalsPage, rerender, {
    onTaskSelect: (taskId) => {
      selectTask(taskId);
      window.alert("已选中该执行任务，请切换到执行查看详情。");
    },
  });
}

export function renderGoalsPage() {
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
      <div class="section-heading page-toolbar with-actions">
        <h2>目标</h2>
        <div class="section-actions">
          ${canCurrentUser("goals.create") ? `<button class="primary-button" type="button" data-action="add-goal">新增目标</button>` : ""}
        </div>
      </div>
      ${renderGoalTabs()}
      ${content}
      ${renderGoalModal()}
      ${renderCurrentValueModal()}
      ${renderGoalTaskModal()}
    </div>
  `;
}
