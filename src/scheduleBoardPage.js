import { cancelProcessInstance, getCurrentUser, resolveAssetUrl, startProcessInstanceExecution, state } from "./appState.js?v=20260705-state-singleton1";
import { selectTask } from "./tasksPage.js?v=20260705-state-singleton1";
import { bindLaunchedProcessDetailEvents, canEditLaunchedProcessInstance, renderLaunchedProcessDetail } from "./processInstanceDetail.js?v=20260722-due-date-boundary2";
import { formatBusinessDateTime } from "./businessTime.js?v=20260705-state-singleton1";
import {
  ProcessInstanceStatus,
  TaskStatus,
  WorkType,
  getValueModuleName,
  inferValueModuleIdFromText,
  isValueModuleId,
  valueModuleList,
} from "./data/modelOptions.js?v=20260705-state-singleton1";
import { getPrimaryImageUrl } from "./data/taskUtils.js?v=20260705-state-singleton1";
import {
  getCurrentExecutor as selectCurrentExecutor,
  getCurrentProcessTask as selectCurrentProcessTask,
  getProcessInstanceBusinessStatus as selectProcessInstanceBusinessStatus,
  getProcessInstanceOwner as selectProcessInstanceOwner,
  getProcessProgress as selectProcessProgress,
  isProcessInstanceOverdue as selectProcessInstanceOverdue,
} from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";

const dayMs = 24 * 60 * 60 * 1000;
const boardDayCount = 30;
const workdayStartHour = 8;
const workdayEndHour = 24;
const timeSlotHours = 2;
const keyActionPendingStatusFilter = "pending";
const keyActionRunningStatusFilter = "running";
const keyActionDoneStatusFilter = "done";
const hiddenProcessStatuses = new Set([
  ProcessInstanceStatus.Done,
  ProcessInstanceStatus.Canceled,
  ProcessInstanceStatus.Stopped,
  ProcessInstanceStatus.Terminated,
  "canceled",
  "cancelled",
  "terminated",
]);
const completedProcessStatuses = new Set([ProcessInstanceStatus.Done, "done", "completed"]);
const canceledProcessStatuses = new Set([ProcessInstanceStatus.Canceled, "canceled", "cancelled"]);

const filters = {
  keyword: "",
  valueModuleId: "",
  standardWorkId: "",
  departmentId: "",
  ownerId: "",
  initiatorId: "",
  status: "",
  overdue: "",
  noDueDateOnly: false,
};

let activeScheduleView = "board";
let selectedProcessInstanceId = null;
let selectedLaunchedProcessIds = new Set();
let draggedSourceId = null;
let draggedSourceType = null;
let suppressProcessClickId = null;
let expandedSlotKey = "";
const savingWorkPlanIds = new Set();
const previewSize = 172;
const previewGap = 12;
const slotBaseHeight = 50;
const slotLabelHeight = 23;
const slotCardHeight = 29;
const slotCardGap = 3;

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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function getTodayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function buildBoardDays() {
  const today = getTodayDate();
  return Array.from({ length: boardDayCount }, (_, index) => {
    const date = new Date(today.getTime() + index * dayMs);
    return {
      date,
      key: formatDate(date),
      label: `${date.getMonth() + 1}月${date.getDate()}日`,
      weekday: ["日", "一", "二", "三", "四", "五", "六"][date.getDay()],
      isToday: index === 0,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    };
  });
}

function buildTimeSlots() {
  const slots = [];
  for (let hour = workdayStartHour; hour < workdayEndHour; hour += timeSlotHours) {
    const endHour = Math.min(hour + timeSlotHours, workdayEndHour);
    slots.push({
      startHour: hour,
      endHour,
      label: `${formatHour(hour)}—${formatHour(endHour)}`,
    });
  }
  return slots;
}

function getDateKey(value) {
  if (typeof value !== "string") return "";
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function shiftDateKey(dateKey, dayOffset) {
  const match = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match === null) return dateKey;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + dayOffset);
  return formatDate(date);
}

function getDueDatePlacement(value) {
  const dateKey = getDateKey(value);
  if (dateKey === "") return { dateKey: "", slotHour: null };
  if (typeof value !== "string" || !value.includes("T")) return { dateKey, slotHour: workdayStartHour };

  const timeMatch = value.match(/T(\d{2})(?::(\d{2}))?/);
  if (timeMatch === null) return { dateKey, slotHour: workdayStartHour };

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return { dateKey, slotHour: workdayStartHour };

  if (hour === 0 && minute === 0) {
    return {
      dateKey: shiftDateKey(dateKey, -1),
      slotHour: workdayEndHour - timeSlotHours,
    };
  }

  const roundedDueHour = Math.min(workdayEndHour, hour + (minute > 0 ? 1 : 0));
  if (roundedDueHour <= workdayStartHour) return { dateKey, slotHour: workdayStartHour };
  if (roundedDueHour >= workdayEndHour) return { dateKey, slotHour: workdayEndHour - timeSlotHours };

  const slotEndHour = Math.ceil((roundedDueHour - workdayStartHour) / timeSlotHours) * timeSlotHours + workdayStartHour;
  return {
    dateKey,
    slotHour: Math.max(workdayStartHour, slotEndHour - timeSlotHours),
  };
}

function findName(items, id, fallback) {
  if (!id) return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function getTaskTemplate(workPlan) {
  return state.taskTemplates.find((template) => template.id === workPlan.taskTemplateId) ?? null;
}

function getProcessInstance(workPlan) {
  if (!workPlan.processInstanceId) return null;
  return state.processInstances.find((instance) => instance.id === workPlan.processInstanceId) ?? null;
}

function getProcessTasks(instanceId) {
  if (!instanceId) return [];
  return state.tasks.filter((task) => task.processInstanceId === instanceId);
}

function getWorkCustomFields(workPlan) {
  return workPlan?.customFields && typeof workPlan.customFields === "object" ? workPlan.customFields : {};
}

function getTextFromFields(customFields, keys) {
  for (const key of keys) {
    const value = customFields?.[key];
    if (Array.isArray(value)) {
      const text = value.map((item) => String(item ?? "").trim()).find(Boolean);
      if (text) return text;
      continue;
    }
    if (value !== null && value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function normalizeImageUrl(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (value && typeof value === "object") {
    if (typeof value.url === "string" && value.url.trim() !== "") return value.url.trim();
    if (typeof value.fileUrl === "string" && value.fileUrl.trim() !== "") return value.fileUrl.trim();
    if (typeof value.filePath === "string" && value.filePath.trim() !== "") return value.filePath.trim();
    if (typeof value.path === "string" && value.path.trim() !== "") return value.path.trim();
    if (typeof value.src === "string" && value.src.trim() !== "") return value.src.trim();
  }
  return "";
}

function getImageFromCustomFields(customFields, keys) {
  if (customFields === null || typeof customFields !== "object") return "";
  for (const key of keys) {
    const image = normalizeImageUrl(customFields[key]);
    if (image !== "") return image;
  }
  return "";
}

function getImageFromAttachments(...attachmentLists) {
  const imageExtPattern = /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i;
  for (const list of attachmentLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const url = normalizeImageUrl(item);
      const name = typeof item === "string" ? item : item?.originalName ?? item?.filename ?? item?.name ?? url;
      if (url !== "" && (imageExtPattern.test(url) || imageExtPattern.test(String(name ?? "")))) return url;
    }
  }
  return "";
}

function getWorkObjectName(workPlan) {
  return getTextFromFields(getWorkCustomFields(workPlan), ["productName", "product", "productTitle", "objectName", "itemName"]);
}

function getWorkTitle(workPlan) {
  const template = getTaskTemplate(workPlan);
  if (workPlan.title) return workPlan.title;
  const objectName = getWorkObjectName(workPlan);
  if (objectName !== "") return `${objectName}｜${template?.name ?? "关键行动"}`;
  return template?.name ?? "未命名工作";
}

function getValueModuleId(workPlan) {
  const customFields = getWorkCustomFields(workPlan);
  if (isValueModuleId(customFields.valueModuleId)) return customFields.valueModuleId;
  const template = getTaskTemplate(workPlan);
  if (isValueModuleId(template?.categoryId)) return template.categoryId;
  if (isValueModuleId(workPlan.categoryId)) return workPlan.categoryId;
  const categoryName = state.categories.find((category) => category.id === template?.categoryId)?.name ?? "";
  return inferValueModuleIdFromText(`${categoryName} ${workPlan.title ?? ""} ${template?.name ?? ""}`);
}

function getOwnerId(workPlan) {
  return workPlan.ownerId ?? getTaskTemplate(workPlan)?.ownerId ?? "";
}

function getWorkThumbnail(workPlan) {
  const processInstance = getProcessInstance(workPlan);
  const imageUrl =
    getPrimaryImageUrl(workPlan) ||
    getPrimaryImageUrl(processInstance) ||
    processInstance?.coverImageUrl ||
    workPlan.coverImageUrl ||
    "";
  return imageUrl;
}

function getReliableContentScheduleImage(workPlan, processInstance) {
  const customFields = {
    ...(workPlan?.customFields ?? {}),
    ...(processInstance?.customFields ?? {}),
  };
  const contentScheduleId =
    workPlan?.contentScheduleId ??
    processInstance?.contentScheduleId ??
    customFields.contentScheduleId ??
    customFields.scheduleId ??
    "";
  if (!contentScheduleId) return "";
  const schedule = state.contentSchedules.find((item) => item.id === contentScheduleId);
  return normalizeImageUrl(schedule?.productImage ?? schedule?.imageUrl ?? schedule?.coverImageUrl ?? schedule?.previewImage);
}

function getProcessPreviewImage(row) {
  const workPlan = row.workPlan;
  const processInstance = row.processInstance;
  const explicitKeys = ["coverImageUrl", "productImage", "imageUrl", "mainImageUrl", "primaryImageUrl", "previewImageUrl"];
  const workPlanCover = normalizeImageUrl(workPlan.coverImageUrl);
  if (workPlanCover !== "") return workPlanCover;

  const workPlanCustomCover = normalizeImageUrl(workPlan.customFields?.coverImageUrl);
  if (workPlanCustomCover !== "") return workPlanCustomCover;

  const processCustomCover = normalizeImageUrl(processInstance?.customFields?.coverImageUrl);
  if (processCustomCover !== "") return processCustomCover;

  for (const task of row.tasks) {
    const taskCustomImage = getImageFromCustomFields(task.customFields, explicitKeys);
    if (taskCustomImage !== "") return taskCustomImage;

    const taskDirectImage = normalizeImageUrl(task.productImage ?? task.imageUrl ?? task.coverImageUrl ?? task.mainImageUrl ?? task.primaryImageUrl ?? task.previewImageUrl);
    if (taskDirectImage !== "") return taskDirectImage;
  }

  for (const task of row.tasks) {
    const attachmentImage = getImageFromAttachments(task.attachments, task.standardWorkAttachments, task.resultAttachments, task.submitFiles);
    if (attachmentImage !== "") return attachmentImage;
  }

  return getReliableContentScheduleImage(workPlan, processInstance);
}

function getProcessInstanceFilterStatus(processInstance) {
  if (processInstance === null) return "";
  return selectProcessInstanceBusinessStatus(processInstance.id, state).status;
}

function getProcessInstanceListStatusLabel(processInstance) {
  if (processInstance === null) return "";
  return selectProcessInstanceBusinessStatus(processInstance.id, state).label;
}

function getLatestTaskDueDate(tasks) {
  return tasks
    .map((task) => task.dueDate)
    .filter((dueDate) => typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate))
    .sort()
    .at(-1) ?? "";
}

function getProcessDueDate(workPlan, processInstance, tasks) {
  if (typeof processInstance?.dueDate === "string" && processInstance.dueDate !== "") return processInstance.dueDate;
  if (typeof workPlan.dueDate === "string" && workPlan.dueDate !== "") return workPlan.dueDate;
  return getLatestTaskDueDate(tasks);
}

function getProcessStartDate(workPlan, processInstance) {
  return processInstance?.startAt ?? processInstance?.startedAt ?? processInstance?.launchedAt ?? workPlan.launchedAt ?? processInstance?.createdAt ?? workPlan.createdAt ?? "";
}

function isProcessRowOverdue(row) {
  if (row.processInstance === null) return false;
  return selectProcessInstanceOverdue(row.processInstance.id, state);
}

function buildScheduledDueDate(targetDate, targetDueHour) {
  if (targetDueHour >= workdayEndHour) {
    return `${shiftDateKey(targetDate, 1)}T00:00:00+08:00`;
  }
  return `${targetDate}T${String(targetDueHour).padStart(2, "0")}:00:00+08:00`;
}

function getProcessProgress(tasks) {
  if (tasks.length === 0) return "0/0";
  const doneCount = tasks.filter((task) => task.status === "done").length;
  return `${doneCount}/${tasks.length}`;
}

function getOwnerSummary(tasks, fallbackOwnerId) {
  const ownerIds = [...new Set([fallbackOwnerId, ...tasks.map((task) => task.ownerId)].filter(Boolean))];
  if (ownerIds.length === 0) return "未设置";
  return ownerIds.map((ownerId) => findName(state.people, ownerId, "")).filter(Boolean).slice(0, 3).join("、") || "未设置";
}

function buildRows() {
  return state.workPlans
    .map((workPlan) => {
      const processInstance = getProcessInstance(workPlan);
      const tasks = getProcessTasks(processInstance?.id);
      const template = getTaskTemplate(workPlan);
      const dueDate = processInstance === null ? "" : getProcessDueDate(workPlan, processInstance, tasks);
      const duePlacement = getDueDatePlacement(dueDate);
      const progress = processInstance === null ? null : selectProcessProgress(processInstance.id, state);
      const currentTask = processInstance === null ? null : selectCurrentProcessTask(processInstance.id, state);
      const currentExecutor = processInstance === null ? { personId: "" } : selectCurrentExecutor(processInstance.id, state);
      return {
        id: workPlan.id,
        workPlan,
        processInstance,
        tasks,
        template,
        title: getWorkTitle(workPlan),
        objectName: getWorkObjectName(workPlan),
        standardWorkName: template?.name ?? "未关联关键行动",
        goalName: findName(state.goals, workPlan.goalId, "未对齐目标"),
        valueModuleId: getValueModuleId(workPlan),
        valueModuleName: getValueModuleName(getValueModuleId(workPlan)),
        ownerId: getOwnerId(workPlan),
        ownerName: findName(state.people, getOwnerId(workPlan), "未设置"),
        departmentName: findName(state.departments, workPlan.departmentId ?? template?.departmentId ?? "", "未设置部门"),
        statusValue: processInstance === null ? "" : getProcessInstanceFilterStatus(processInstance),
        statusLabel: processInstance === null ? "" : getProcessInstanceListStatusLabel(processInstance),
        thumbnail: getWorkThumbnail(workPlan),
        dueDate,
        dueDateKey: duePlacement.dateKey,
        dueSlotHour: duePlacement.slotHour,
        progressText: progress === null ? getProcessProgress(tasks) : `${progress.completed}/${progress.total}`,
        ownerSummary: getOwnerSummary(tasks, getOwnerId(workPlan)),
        startDate: getProcessStartDate(workPlan, processInstance),
        currentTask,
        currentTaskName: currentTask?.name ?? (tasks.length === 0 ? "" : "已完成"),
        currentExecutorName: currentExecutor.personId === "" ? "" : findName(state.people, currentExecutor.personId, "未设置"),
      };
    });
}

function buildLaunchedRows() {
  return buildRows().filter((row) => row.processInstance !== null && !hiddenProcessStatuses.has(row.processInstance.status));
}

function buildLaunchedListRows() {
  return buildRows().filter(
    (row) =>
      row.processInstance !== null &&
      !completedProcessStatuses.has(row.processInstance.status) &&
      !canceledProcessStatuses.has(row.processInstance.status),
  );
}

function isDueDateInBoard(row, dayKeys) {
  return row.processInstance !== null && row.dueDateKey !== "" && dayKeys.has(row.dueDateKey);
}

function isNoDueDate(row) {
  return row.processInstance !== null && row.dueDateKey === "";
}

function getSearchText(row) {
  return [
    row.title,
    row.standardWorkName,
    row.goalName,
    row.valueModuleName,
    row.ownerName,
    row.departmentName,
    row.statusLabel,
    row.processInstance?.displayTitle,
    row.processInstance?.name,
  ].filter(Boolean).join(" ").toLowerCase();
}

function rowMatchesBaseFilters(row) {
  const keyword = filters.keyword.trim().toLowerCase();
  if (keyword !== "" && !getSearchText(row).includes(keyword)) return false;
  if (filters.valueModuleId !== "" && row.valueModuleId !== filters.valueModuleId) return false;
  if (filters.standardWorkId !== "" && row.workPlan.taskTemplateId !== filters.standardWorkId) return false;
  if (filters.departmentId !== "" && row.workPlan.departmentId !== filters.departmentId && row.template?.departmentId !== filters.departmentId) return false;
  if (filters.ownerId !== "" && row.ownerId !== filters.ownerId && !row.tasks.some((task) => task.ownerId === filters.ownerId)) return false;
  return true;
}

function launchedRowMatchesFilters(row) {
  if (!rowMatchesBaseFilters(row)) return false;
  if (filters.initiatorId !== "" && row.processInstance?.initiatorId !== filters.initiatorId) return false;
  if (filters.status !== "" && row.statusValue !== filters.status) return false;
  if (filters.noDueDateOnly && !isNoDueDate(row)) return false;
  if (filters.overdue === "yes" && !isProcessRowOverdue(row)) return false;
  if (filters.overdue === "no" && isProcessRowOverdue(row)) return false;
  return true;
}

function isImprovementActionRow(row) {
  if (row.workPlan.workType === WorkType.Rectification) return true;
  const customFields = row.processInstance?.customFields ?? {};
  return Boolean(
    customFields.rectificationSource ||
      customFields.sourceTaskId ||
      customFields.sourceProcessInstanceId ||
      customFields.sourceStandardWorkId,
  );
}

function renderOptions(options, selectedValue, placeholder) {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...options.map(
      (option) => `<option value="${escapeAttribute(option.id)}" ${option.id === selectedValue ? "selected" : ""}>${escapeHtml(option.name)}</option>`,
    ),
  ].join("");
}

function renderStatusOptions() {
  const options = [
    { id: keyActionPendingStatusFilter, name: "待执行" },
    { id: keyActionRunningStatusFilter, name: "执行中" },
    { id: keyActionDoneStatusFilter, name: "已完成" },
  ];
  return renderOptions(options, filters.status, "全部状态");
}

function renderFilters() {
  const activePeople = state.people.filter((person) => person.status !== "inactive");
  const activeDepartments = state.departments.filter((department) => department.status !== "inactive");
  const standardWorks = state.taskTemplates.filter((template) => template.status !== "inactive");
  return `
    <section class="schedule-board-filters" aria-label="关键行动筛选">
      <label>
        <span>关键词</span>
        <input name="keyword" value="${escapeAttribute(filters.keyword)}" autocomplete="off" />
      </label>
      <label>
        <span>价值链</span>
        <select name="valueModuleId">${renderOptions(valueModuleList, filters.valueModuleId, "全部价值链")}</select>
      </label>
      <label>
        <span>关键行动</span>
        <select name="standardWorkId">${renderOptions(standardWorks, filters.standardWorkId, "全部关键行动")}</select>
      </label>
      <label>
        <span>负责人</span>
        <select name="ownerId">${renderOptions(activePeople, filters.ownerId, "全部负责人")}</select>
      </label>
      <label>
        <span>发起人</span>
        <select name="initiatorId">${renderOptions(activePeople, filters.initiatorId, "全部发起人")}</select>
      </label>
      <label>
        <span>责任部门</span>
        <select name="departmentId">${renderOptions(activeDepartments, filters.departmentId, "全部部门")}</select>
      </label>
      <label>
        <span>状态</span>
        <select name="status">${renderStatusOptions()}</select>
      </label>
      <label>
        <span>是否超时</span>
        <select name="overdue">${renderOptions([{ id: "yes", name: "已超时" }, { id: "no", name: "未超时" }], filters.overdue, "全部")}</select>
      </label>
      <label class="inline-checkbox">
        <input type="checkbox" name="noDueDateOnly" ${filters.noDueDateOnly ? "checked" : ""} />
        <span>只看无截止时间</span>
      </label>
    </section>
  `;
}

function renderThumbnail(row) {
  if (row.thumbnail === "") return `<div class="schedule-board-thumb-placeholder">无图</div>`;
  return `
    <img
      class="schedule-board-thumb"
      src="${escapeAttribute(resolveAssetUrl(row.thumbnail))}"
      alt="${escapeAttribute(row.title)}"
      onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'schedule-board-thumb-placeholder', textContent: '无图' }))"
    />
  `;
}

function getProcessStatusClass(row) {
  if (row.processInstance === null) return "is-waiting";
  if (row.statusValue === keyActionDoneStatusFilter) return "is-done";
  if (row.processInstance.status === ProcessInstanceStatus.Stopped) return "is-canceled";
  if (row.statusValue === keyActionPendingStatusFilter) return "is-todo";
  return "is-doing";
}

function getValueModuleCardClass(valueModuleId) {
  if (valueModuleList.some((module) => module.id === valueModuleId)) return `is-value-${valueModuleId.replaceAll("_", "-")}`;
  return "is-value-default";
}

function getValueModuleLegendLabel(valueModuleId, fallbackName) {
  const labels = {
    infrastructure_maintenance: "基础设施",
    human_asset_management: "人力资产",
    product_development: "产品开发",
    supply_chain_management: "供应链管理",
    brand_marketing: "品牌营销",
    channel_sales: "渠道销售",
    customer_maintenance: "客户维护",
  };
  return labels[valueModuleId] ?? fallbackName;
}

function canDragProcess(row) {
  return canStartProcessExecution(row);
}

function isAdminUser(user) {
  const role = user?.role ?? "";
  const authRole = user?.authRole ?? "";
  return role === "admin" || role === "system_admin" || authRole === "admin";
}

function getCurrentUserPersonId() {
  const user = getCurrentUser();
  return user?.personId ?? user?.id ?? "";
}

function canStartProcessExecution(row) {
  if (row.processInstance === null) return false;
  if (savingWorkPlanIds.has(row.workPlan.id)) return false;
  if (row.statusValue !== keyActionPendingStatusFilter) return false;
  if (row.currentTask?.status !== TaskStatus.Todo) return false;
  const user = getCurrentUser();
  if (isAdminUser(user)) return true;
  const userId = getCurrentUserPersonId();
  const processOwnerId = selectProcessInstanceOwner(row.processInstance.id, state).userId;
  return userId !== "" && [row.processInstance.initiatorId, processOwnerId].includes(userId);
}

function getProcessCardTitle(row) {
  return row.processInstance?.displayTitle ?? row.processInstance?.name ?? row.title;
}

function getProcessCurrentProgressText(tasks) {
  if (tasks.length === 0) return "暂无进度";
  const processInstanceId = tasks[0]?.processInstanceId ?? "";
  const progress = selectProcessProgress(processInstanceId, state);
  if (progress.current === null && progress.total > 0 && progress.completed === progress.total) return "已完成";
  return progress.current?.name ?? "暂无任务";
}

function renderProcessBlock(row) {
  if (row.processInstance === null) return "";
  const canDrag = canDragProcess(row);
  const canStart = canStartProcessExecution(row);
  const title = getProcessCardTitle(row);
  const previewImage = getProcessPreviewImage(row);
  const valueModuleClass = getValueModuleCardClass(row.valueModuleId);
  const progressText = getProcessCurrentProgressText(row.tasks);
  return `
    <article
      class="schedule-process-block ${getProcessStatusClass(row)} ${valueModuleClass} ${savingWorkPlanIds.has(row.workPlan.id) ? "is-saving" : ""}"
      role="button"
      tabindex="0"
      data-schedule-process-id="${escapeAttribute(row.processInstance.id)}"
      data-schedule-work-plan-id="${escapeAttribute(row.workPlan.id)}"
      data-schedule-drag-type="process-instance"
      data-schedule-preview-title="${escapeAttribute(title)}"
      data-schedule-preview-image="${escapeAttribute(previewImage === "" ? "" : resolveAssetUrl(previewImage))}"
      data-schedule-preview-progress="${escapeAttribute(progressText)}"
      draggable="${canDrag ? "true" : "false"}"
      title="${escapeAttribute(title)}"
      aria-label="${escapeAttribute(title)}"
    >
      <strong>${escapeHtml(title)}</strong>
      <span class="schedule-process-status-label">${escapeHtml(row.statusLabel)}</span>
      ${
        canStart
          ? `<button class="schedule-process-start-button" type="button" data-schedule-start-process-id="${escapeAttribute(row.processInstance.id)}">开始执行</button>`
          : ""
      }
    </article>
  `;
}

function renderPendingProcessCard(row) {
  if (row.processInstance === null) return "";
  const canDrag = canDragProcess(row);
  const canStart = canStartProcessExecution(row);
  const title = getProcessCardTitle(row);
  const previewImage = getProcessPreviewImage(row);
  const imageUrl = previewImage === "" ? "" : resolveAssetUrl(previewImage);
  const initiatorName = findName(state.people, row.processInstance.initiatorId ?? "", "未设置");
  return `
    <article
      class="schedule-pending-card ${savingWorkPlanIds.has(row.workPlan.id) ? "is-saving" : ""}"
      role="button"
      tabindex="0"
      data-schedule-process-id="${escapeAttribute(row.processInstance.id)}"
      data-schedule-work-plan-id="${escapeAttribute(row.workPlan.id)}"
      data-schedule-preview-title="${escapeAttribute(title)}"
      data-schedule-preview-image="${escapeAttribute(imageUrl)}"
      data-schedule-preview-progress="${escapeAttribute(getProcessCurrentProgressText(row.tasks))}"
      data-schedule-drag-type="process-instance"
      draggable="${canDrag ? "true" : "false"}"
      title="${escapeAttribute(title)}"
      aria-label="${escapeAttribute(title)}"
    >
      <div class="schedule-pending-card-media">
        ${
          imageUrl === ""
            ? `<div class="schedule-pending-card-placeholder">无图</div>`
            : `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(title)}" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'schedule-pending-card-placeholder', textContent: '无图' }))" />`
        }
      </div>
      <div class="schedule-pending-card-body">
        <strong>${escapeHtml(title)}</strong>
        <span>发起人：${escapeHtml(initiatorName)}</span>
        ${
          canStart
            ? `<button class="schedule-process-start-button" type="button" data-schedule-start-process-id="${escapeAttribute(row.processInstance.id)}">开始执行</button>`
            : ""
        }
      </div>
    </article>
  `;
}

function getPreviewElement() {
  let preview = document.querySelector(".schedule-hover-preview");
  if (preview !== null) return preview;
  preview = document.createElement("div");
  preview.className = "schedule-hover-preview";
  preview.setAttribute("aria-hidden", "true");
  document.body.appendChild(preview);
  return preview;
}

function positionSchedulePreview(preview, anchor) {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = rect.right + previewGap;
  let top = rect.top;

  if (left + previewSize > viewportWidth - previewGap) left = rect.left - previewSize - previewGap;
  if (left < previewGap) left = previewGap;
  if (top + previewSize > viewportHeight - previewGap) top = viewportHeight - previewSize - previewGap;
  if (top < previewGap) top = previewGap;

  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(top)}px`;
}

function showSchedulePreview(button) {
  if (draggedSourceId !== null) return;
  const preview = getPreviewElement();
  const imageUrl = button.dataset.schedulePreviewImage ?? "";
  const title = button.dataset.schedulePreviewTitle ?? "";
  const progressText = button.dataset.schedulePreviewProgress ?? "暂无进度";
  preview.classList.remove("is-hidden");
  preview.innerHTML = `
    <div class="schedule-hover-preview-media">
      ${
        imageUrl === ""
          ? `<div class="schedule-hover-preview-empty">无预览图</div>`
          : `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(title)}" />`
      }
    </div>
    <div class="schedule-hover-preview-progress" title="${escapeAttribute(`当前进度：${progressText}`)}">当前进度：${escapeHtml(progressText)}</div>
  `;
  preview.querySelector("img")?.addEventListener("error", () => {
    const media = preview.querySelector(".schedule-hover-preview-media");
    if (media !== null) media.innerHTML = `<div class="schedule-hover-preview-empty">无预览图</div>`;
  }, { once: true });
  positionSchedulePreview(preview, button);
}

function hideSchedulePreview() {
  const preview = document.querySelector(".schedule-hover-preview");
  if (preview !== null) preview.classList.add("is-hidden");
}

function getSlotMinHeight(cardCount) {
  if (cardCount <= 1) return slotBaseHeight;
  return Math.max(slotBaseHeight, slotLabelHeight + cardCount * slotCardHeight + (cardCount - 1) * slotCardGap);
}

function buildSlotHeightMap(rows, days) {
  const dayKeys = new Set(days.map((day) => day.key));
  return buildTimeSlots().reduce((result, slot) => {
    const maxCardCount = days.reduce((maxCount, day) => {
      const count = rows.filter((row) => row.processInstance !== null && row.dueDateKey === day.key && row.dueSlotHour === slot.startHour).length;
      return Math.max(maxCount, count);
    }, 0);
    result.set(slot.startHour, getSlotMinHeight(dayKeys.size === 0 ? 0 : maxCardCount));
    return result;
  }, new Map());
}

function renderTimeSlot(rows, dayKey, slot, slotHeights) {
  const slotRows = rows.filter((row) => row.processInstance !== null && row.dueDateKey === dayKey && row.dueSlotHour === slot.startHour);
  const slotMinHeight = slotHeights.get(slot.startHour) ?? slotBaseHeight;
  return `
    <div
      class="schedule-time-slot"
      data-schedule-date="${escapeAttribute(dayKey)}"
      data-schedule-hour="${escapeAttribute(slot.endHour)}"
      style="--schedule-slot-min-height: ${slotMinHeight}px;"
      title="${escapeAttribute(slot.label)}"
    >
      <span class="schedule-time-slot-label">${escapeHtml(slot.label)}</span>
      <div class="schedule-time-slot-items">
        ${slotRows.map(renderProcessBlock).join("")}
      </div>
    </div>
  `;
}

function renderDateColumn(rows, day, slotHeights) {
  const slots = buildTimeSlots();
  return `
    <div class="schedule-board-cell ${day.isToday ? "is-today" : ""} ${day.isWeekend ? "is-weekend" : ""}" data-schedule-day="${escapeAttribute(day.key)}">
      ${slots.map((slot) => renderTimeSlot(rows, day.key, slot, slotHeights)).join("")}
    </div>
  `;
}

function renderNoDueDateColumn(rows) {
  const noDueRows = rows.filter(isNoDueDate);
  return `
    <div class="schedule-board-cell is-unscheduled">
      ${noDueRows.length === 0 ? `<span class="empty-cell">无</span>` : noDueRows.map(renderProcessBlock).join("")}
    </div>
  `;
}

function renderBoardRows(rows, days) {
  if (rows.length === 0) {
    return `
      <div class="schedule-board-empty">
        <h2>暂无匹配关键行动</h2>
        <p>请调整筛选条件，或查看无截止时间工作。</p>
      </div>
    `;
  }

  const slotHeights = buildSlotHeightMap(rows, days);

  return `
    <div class="schedule-board-row schedule-calendar-row">
      ${filters.noDueDateOnly ? renderNoDueDateColumn(rows) : days.map((day) => renderDateColumn(rows, day, slotHeights)).join("")}
    </div>
  `;
}

function renderPendingProcessList(rows) {
  const sortedRows = [...rows].sort((left, right) =>
    String(left.dueDate ?? "").localeCompare(String(right.dueDate ?? "")) ||
    String(right.processInstance?.createdAt ?? "").localeCompare(String(left.processInstance?.createdAt ?? "")),
  );
  return `
    <aside class="schedule-pending-panel" aria-label="待执行关键行动">
      <div class="schedule-pending-panel-header">
        <h3>待执行关键行动</h3>
        <span>${sortedRows.length} 个</span>
      </div>
      <div class="schedule-pending-list">
        ${sortedRows.length === 0 ? `<p class="schedule-pending-empty">暂无待执行关键行动</p>` : sortedRows.map(renderPendingProcessCard).join("")}
      </div>
    </aside>
  `;
}

function renderBoardHeader(days) {
  const dayHeaders = filters.noDueDateOnly
    ? `<div class="schedule-day-header is-unscheduled">无截止时间</div>`
    : days
        .map(
          (day) => `
            <div class="schedule-day-header ${day.isToday ? "is-today" : ""} ${day.isWeekend ? "is-weekend" : ""}">
              <strong>${escapeHtml(day.label)}</strong>
              <span>周${escapeHtml(day.weekday)}</span>
            </div>
          `,
        )
        .join("");
  return `
    <div class="schedule-board-header">
      ${dayHeaders}
    </div>
  `;
}

function renderSummary(launchedRows, days) {
  const dayKeys = new Set(days.map((day) => day.key));
  const noDueDateCount = launchedRows.filter(isNoDueDate).length;
  const outOfRangeCount = launchedRows.filter((row) => row.processInstance !== null && row.dueDateKey !== "" && !isDueDateInBoard(row, dayKeys)).length;
  return `
    <div class="schedule-board-summary">
      <span>关键行动 ${launchedRows.length}</span>
      <span>无截止时间 ${noDueDateCount}</span>
      <span>超出30天 ${outOfRangeCount}</span>
    </div>
  `;
}

function renderValueChainLegend() {
  return `
    <div class="schedule-value-legend" aria-label="价值链颜色说明">
      ${valueModuleList
        .map((module) => {
          const className = getValueModuleCardClass(module.id);
          return `<span class="schedule-value-legend-item ${className}">${escapeHtml(getValueModuleLegendLabel(module.id, module.name))}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderScheduleViewTabs() {
  return `
    <div class="settings-tabs schedule-view-tabs" aria-label="关键行动视图">
      <button class="${activeScheduleView === "board" ? "is-active" : ""}" type="button" data-schedule-view="board">原有视图</button>
      <button class="${activeScheduleView === "list" ? "is-active" : ""}" type="button" data-schedule-view="list">列表</button>
    </div>
  `;
}

function renderCellText(value) {
  const text = String(value ?? "").trim();
  return text === "" ? "—" : escapeHtml(text);
}

function getListProcessDueDate(row) {
  return row.processInstance?.dueDate ?? "";
}

function getActionOwnerName(row) {
  if (row.processInstance === null) return "未设置";
  const actionOwner = selectProcessInstanceOwner(row.processInstance.id, state);
  return findName(state.people, actionOwner.userId, "未设置");
}

function getActionInitiatorName(row) {
  return findName(state.people, row.processInstance?.initiatorId ?? "", "未设置");
}

function getDueTimestamp(value) {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const date = new Date(text.length === 10 ? `${text}T23:59:59+08:00` : text);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDurationByHours(milliseconds) {
  const totalHours = Math.max(1, Math.ceil(Math.abs(milliseconds) / (60 * 60 * 1000)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days}天${hours}小时`;
  return `${hours}小时`;
}

function formatRemainingDueTime(value) {
  const dueTimestamp = getDueTimestamp(value);
  if (dueTimestamp === null) return "—";
  const diff = dueTimestamp - Date.now();
  return diff >= 0 ? `剩余 ${formatDurationByHours(diff)}` : `已超时 ${formatDurationByHours(diff)}`;
}

function renderLaunchedActionList(rows) {
  const sortedRows = [...rows].sort((left, right) =>
    String(right.startDate ?? "").localeCompare(String(left.startDate ?? "")) ||
    String(right.processInstance?.createdAt ?? "").localeCompare(String(left.processInstance?.createdAt ?? "")),
  );

  return `
    <section class="schedule-launched-list-section">
      <div class="table-wrap">
        <table class="data-table schedule-launched-list-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>选择</th>
              <th>产品图</th>
              <th>关键行动名</th>
              <th>发起人</th>
              <th>行动负责人</th>
              <th>当前步骤</th>
              <th>截止时间</th>
              <th>剩余时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              sortedRows.length === 0
                ? `<tr><td colspan="10">暂无匹配的关键行动</td></tr>`
                : sortedRows
                    .map((row, index) => {
                      const instanceId = row.processInstance?.id ?? "";
                      const processDueDate = getListProcessDueDate(row);
                      const canEdit = canEditLaunchedProcessInstance(row.processInstance, getCurrentUser());
                      const checked = selectedLaunchedProcessIds.has(instanceId) ? "checked" : "";
                      return `
                        <tr data-schedule-process-row-id="${escapeAttribute(instanceId)}">
                          <td>${index + 1}</td>
                          <td><input type="checkbox" data-schedule-list-select="${escapeAttribute(instanceId)}" ${checked} aria-label="选择${escapeAttribute(getProcessCardTitle(row))}" /></td>
                          <td>${renderThumbnail(row)}</td>
                          <td><strong>${renderCellText(getProcessCardTitle(row))}</strong></td>
                          <td>${renderCellText(getActionInitiatorName(row))}</td>
                          <td>${renderCellText(getActionOwnerName(row))}</td>
                          <td>${renderCellText(row.currentTaskName)}</td>
                          <td>${renderCellText(formatBusinessDateTime(processDueDate, ""))}</td>
                          <td>${renderCellText(formatRemainingDueTime(processDueDate))}</td>
                          <td>
                            <span class="row-actions">
                              <button class="text-button" type="button" data-schedule-list-action="view" data-schedule-process-id="${escapeAttribute(instanceId)}">查看</button>
                              ${canEdit ? `<button class="text-button" type="button" data-schedule-list-action="edit" data-schedule-process-id="${escapeAttribute(instanceId)}">编辑</button>` : ""}
                              ${canEdit ? `<button class="text-button danger-button" type="button" data-schedule-list-action="cancel" data-schedule-process-id="${escapeAttribute(instanceId)}">取消</button>` : ""}
                            </span>
                          </td>
                        </tr>
                      `;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>
      <p class="form-note">列表只展示关键行动；查看和编辑均复用现有关键行动详情能力。</p>
    </section>
  `;
}

function findRowByProcessInstanceId(processInstanceId) {
  return buildRows().find((row) => row.processInstance?.id === processInstanceId) ?? null;
}

async function scheduleAndStartProcessExecution(processInstanceId, targetDate, targetHour, rerender) {
  const row = findRowByProcessInstanceId(processInstanceId);
  if (row === null || row.processInstance === null) return;
  if (!canDragProcess(row)) return;
  const nextDueDate = buildScheduledDueDate(targetDate, targetHour);

  savingWorkPlanIds.add(row.workPlan.id);
  rerender();

  try {
    await startProcessInstanceExecution(processInstanceId, { dueDate: nextDueDate });
  } catch (error) {
    window.alert(error.message || "排期并开始执行失败，请检查本地数据库服务。");
  } finally {
    savingWorkPlanIds.delete(row.workPlan.id);
    draggedSourceId = null;
    draggedSourceType = null;
    suppressProcessClickId = row.processInstance.id;
    rerender();
    window.setTimeout(() => {
      if (suppressProcessClickId === row.processInstance.id) suppressProcessClickId = null;
    }, 250);
  }
}

async function startLaunchedProcessExecution(processInstanceId, rerender) {
  const row = findRowByProcessInstanceId(processInstanceId);
  if (row === null || row.processInstance === null) return;
  if (!canStartProcessExecution(row)) return;

  savingWorkPlanIds.add(row.workPlan.id);
  rerender();

  try {
    await startProcessInstanceExecution(processInstanceId);
  } catch (error) {
    window.alert(error.message || "开始执行关键行动失败，请检查本地数据库服务。");
  } finally {
    savingWorkPlanIds.delete(row.workPlan.id);
    suppressProcessClickId = processInstanceId;
    rerender();
    window.setTimeout(() => {
      if (suppressProcessClickId === processInstanceId) suppressProcessClickId = null;
    }, 250);
  }
}

function renderProcessDetailModal() {
  if (selectedProcessInstanceId === null) return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal schedule-process-modal" role="dialog" aria-modal="true" aria-label="关键行动详情">
        <div class="modal-header">
          <h2>关键行动详情</h2>
          <button class="icon-button" type="button" data-action="close-schedule-process-modal" aria-label="关闭">×</button>
        </div>
        ${renderLaunchedProcessDetail(selectedProcessInstanceId, {
          emptyHtml: `<section class="placeholder"><h2>未找到关键行动</h2></section>`,
        })}
      </div>
    </div>
  `;
}

export function renderScheduleBoardPage() {
  const days = buildBoardDays();
  const launchedRows = buildLaunchedRows().filter(launchedRowMatchesFilters);
  const pendingRows = launchedRows.filter((row) => row.statusValue === keyActionPendingStatusFilter && !isImprovementActionRow(row));
  const scheduledRows = launchedRows.filter(
    (row) => row.statusValue === keyActionRunningStatusFilter && !isNoDueDate(row),
  );
  const launchedListRows = buildLaunchedListRows().filter(launchedRowMatchesFilters);
  const columnCount = filters.noDueDateOnly ? 1 : boardDayCount;
  return `
    <section class="schedule-board-page" style="--schedule-day-count: ${columnCount};">
      ${renderFilters()}
      ${renderSummary(launchedRows, days)}
      ${renderScheduleViewTabs()}
      ${
        activeScheduleView === "list"
          ? renderLaunchedActionList(launchedListRows)
          : `
            <div class="schedule-board-layout">
              ${renderPendingProcessList(pendingRows)}
              <div class="schedule-board-shell">
                ${renderValueChainLegend()}
                <div class="schedule-board-grid">
                  ${renderBoardHeader(days)}
                  ${renderBoardRows(scheduledRows, days)}
                </div>
              </div>
            </div>
          `
      }
      ${renderProcessDetailModal()}
    </section>
  `;
}

export function bindScheduleBoardPageEvents(rerender) {
  hideSchedulePreview();

  document.querySelector(".schedule-board-filters")?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    if (target.name === "noDueDateOnly") {
      filters[target.name] = target.checked;
    } else if (Object.prototype.hasOwnProperty.call(filters, target.name)) {
      filters[target.name] = target.value;
    }
    rerender();
  });

  document.querySelectorAll("[data-schedule-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeScheduleView = button.dataset.scheduleView === "list" ? "list" : "board";
      rerender();
    });
  });

  document.querySelectorAll("[data-schedule-list-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const processInstanceId = button.dataset.scheduleProcessId ?? "";
      if (processInstanceId === "") return;
      if (button.dataset.scheduleListAction === "cancel") {
        const reason = window.prompt("请输入取消原因：", "");
        if (reason === null) return;
        try {
          await cancelProcessInstance(processInstanceId, reason);
          selectedLaunchedProcessIds.delete(processInstanceId);
        } catch (error) {
          window.alert(error.message || "取消关键行动失败，请检查本地数据库服务。");
        }
        rerender();
        return;
      }
      selectedProcessInstanceId = processInstanceId;
      rerender();
    });
  });

  document.querySelectorAll("[data-schedule-list-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const processInstanceId = checkbox.dataset.scheduleListSelect ?? "";
      if (processInstanceId === "") return;
      if (checkbox.checked) selectedLaunchedProcessIds.add(processInstanceId);
      else selectedLaunchedProcessIds.delete(processInstanceId);
    });
  });

  document.querySelectorAll("[data-schedule-start-process-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const processInstanceId = button.dataset.scheduleStartProcessId ?? "";
      if (processInstanceId === "") return;
      await startLaunchedProcessExecution(processInstanceId, rerender);
    });
  });

  document.querySelectorAll("[data-schedule-process-id]").forEach((button) => {
    const showPreview = () => {
      showSchedulePreview(button);
    };

    button.addEventListener("mouseenter", showPreview);
    button.addEventListener("pointerenter", showPreview);
    button.addEventListener("mouseleave", hideSchedulePreview);
    button.addEventListener("pointerleave", hideSchedulePreview);

    button.addEventListener("dragstart", (event) => {
      const processInstanceId = button.dataset.scheduleProcessId ?? "";
      if (button.getAttribute("draggable") !== "true" || processInstanceId === "") {
        event.preventDefault();
        return;
      }
      hideSchedulePreview();
      draggedSourceId = processInstanceId;
      draggedSourceType = "process-instance";
      suppressProcessClickId = button.dataset.scheduleProcessId ?? null;
      button.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", processInstanceId);
      event.dataTransfer?.setData("application/x-schedule-drag-type", "process-instance");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    button.addEventListener("dragend", () => {
      hideSchedulePreview();
      button.classList.remove("is-dragging");
      document.querySelectorAll(".schedule-time-slot.is-drop-target").forEach((cell) => cell.classList.remove("is-drop-target"));
      window.setTimeout(() => {
        draggedSourceId = null;
        draggedSourceType = null;
        suppressProcessClickId = null;
      }, 250);
    });

    button.addEventListener("click", () => {
      if (suppressProcessClickId === button.dataset.scheduleProcessId) return;
      selectedProcessInstanceId = button.dataset.scheduleProcessId ?? null;
      rerender();
    });

    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (suppressProcessClickId === button.dataset.scheduleProcessId) return;
      selectedProcessInstanceId = button.dataset.scheduleProcessId ?? null;
      rerender();
    });
  });

  document.querySelectorAll("[data-schedule-date][data-schedule-hour]").forEach((cell) => {
    cell.addEventListener("dragover", (event) => {
      if (draggedSourceId === null) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      cell.classList.add("is-drop-target");
    });

    cell.addEventListener("dragleave", () => {
      cell.classList.remove("is-drop-target");
    });

    cell.addEventListener("drop", (event) => {
      event.preventDefault();
      cell.classList.remove("is-drop-target");
      const sourceId = event.dataTransfer?.getData("text/plain") || draggedSourceId;
      const sourceType = event.dataTransfer?.getData("application/x-schedule-drag-type") || draggedSourceType;
      const targetDate = cell.dataset.scheduleDate ?? "";
      const targetHour = Number(cell.dataset.scheduleHour);
      if (sourceId === null || sourceId === "" || targetDate === "" || !Number.isFinite(targetHour)) return;
      if (sourceType === "process-instance") {
        scheduleAndStartProcessExecution(sourceId, targetDate, targetHour, rerender);
      }
    });
  });

  document.querySelectorAll("[data-schedule-slot-more]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const slotKey = button.dataset.scheduleSlotMore ?? "";
      expandedSlotKey = expandedSlotKey === slotKey ? "" : slotKey;
      rerender();
    });
  });

  document.querySelector('[data-action="close-schedule-process-modal"]')?.addEventListener("click", () => {
    selectedProcessInstanceId = null;
    rerender();
  });

  const modal = document.querySelector(".schedule-process-modal");
  if (modal !== null) {
    bindLaunchedProcessDetailEvents(modal, rerender, {
      onTaskSelect: (taskId) => {
        selectedProcessInstanceId = null;
        selectTask(taskId);
        window.location.hash = "task-list";
      },
      onSaved: () => {
        selectedProcessInstanceId = null;
        rerender();
      },
    });
  }
}
