import { launchWorkPlanAsProcess, resolveAssetUrl, state, updatePersistentResource } from "./appState.js?v=20260705-state-singleton1";
import { selectTask } from "./tasksPage.js?v=20260705-state-singleton1";
import { bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js?v=20260705-state-singleton1";
import {
  ProcessInstanceStatus,
  WorkPlanStatus,
  getValueModuleName,
  inferValueModuleIdFromText,
  isValueModuleId,
  processInstanceStatusNames,
  valueModuleList,
  workPlanStatusNames,
} from "./data/modelOptions.js?v=20260705-state-singleton1";
import { getPrimaryImageUrl } from "./data/taskUtils.js?v=20260705-state-singleton1";

const dayMs = 24 * 60 * 60 * 1000;
const boardDayCount = 30;
const workdayStartHour = 8;
const workdayEndHour = 24;
const timeSlotHours = 2;
const launchedStatusFilter = "launched";
const completedStatusFilter = "completed";
const futureWorkStatuses = new Set([WorkPlanStatus.Future, WorkPlanStatus.ThisWeek]);
const hiddenProcessStatuses = new Set([
  ProcessInstanceStatus.Done,
  ProcessInstanceStatus.Canceled,
  ProcessInstanceStatus.Stopped,
  ProcessInstanceStatus.Terminated,
  "canceled",
  "cancelled",
  "terminated",
]);

const filters = {
  keyword: "",
  valueModuleId: "",
  standardWorkId: "",
  ownerId: "",
  status: "",
  unlaunchedOnly: false,
  noDueDateOnly: false,
};

let selectedProcessInstanceId = null;
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

function parseDate(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
    slots.push({
      startHour: hour,
      endHour: Math.min(hour + timeSlotHours, workdayEndHour),
      label: `${String(hour).padStart(2, "0")}-${String(Math.min(hour + timeSlotHours, workdayEndHour)).padStart(2, "0")}`,
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

function isWorkPlanLaunched(workPlan) {
  return Boolean(workPlan.processInstanceId) || workPlan.status === WorkPlanStatus.Launched || getProcessInstance(workPlan) !== null;
}

function isFutureWorkPlan(workPlan) {
  return futureWorkStatuses.has(workPlan.status) && !isWorkPlanLaunched(workPlan);
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
  if (objectName !== "") return `${objectName}｜${template?.name ?? "标准工作"}`;
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

function getWorkPlanDisplayStatus(workPlan, processInstance) {
  if (processInstance?.status === ProcessInstanceStatus.Done) return completedStatusFilter;
  if (processInstance !== null) return launchedStatusFilter;
  return workPlan.status;
}

function getWorkPlanStatusLabel(workPlan, processInstance) {
  if (processInstance?.status === ProcessInstanceStatus.Done) return "已完成";
  if (processInstance !== null) return "已发起";
  return workPlanStatusNames[workPlan.status] ?? workPlan.status ?? "未设置";
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
      return {
        id: workPlan.id,
        workPlan,
        processInstance,
        tasks,
        template,
        title: getWorkTitle(workPlan),
        standardWorkName: template?.name ?? "未关联标准工作",
        goalName: findName(state.goals, workPlan.goalId, "未对齐目标"),
        valueModuleId: getValueModuleId(workPlan),
        valueModuleName: getValueModuleName(getValueModuleId(workPlan)),
        ownerId: getOwnerId(workPlan),
        ownerName: findName(state.people, getOwnerId(workPlan), "未设置"),
        departmentName: findName(state.departments, workPlan.departmentId ?? template?.departmentId ?? "", "未设置部门"),
        statusValue: getWorkPlanDisplayStatus(workPlan, processInstance),
        statusLabel: getWorkPlanStatusLabel(workPlan, processInstance),
        thumbnail: getWorkThumbnail(workPlan),
        dueDate,
        dueDateKey: duePlacement.dateKey,
        dueSlotHour: duePlacement.slotHour,
        progressText: getProcessProgress(tasks),
        ownerSummary: getOwnerSummary(tasks, getOwnerId(workPlan)),
      };
    });
}

function buildFutureRows() {
  return buildRows().filter((row) => isFutureWorkPlan(row.workPlan));
}

function buildLaunchedRows() {
  return buildRows().filter((row) => row.processInstance !== null && !hiddenProcessStatuses.has(row.processInstance.status));
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
  if (filters.ownerId !== "" && row.ownerId !== filters.ownerId && !row.tasks.some((task) => task.ownerId === filters.ownerId)) return false;
  return true;
}

function futureRowMatchesFilters(row) {
  if (!rowMatchesBaseFilters(row)) return false;
  if (filters.status !== "" && row.workPlan.status !== filters.status) return false;
  if (filters.status !== "" && !futureWorkStatuses.has(filters.status)) return false;
  if (filters.noDueDateOnly) return false;
  return true;
}

function launchedRowMatchesFilters(row) {
  if (!rowMatchesBaseFilters(row)) return false;
  if (filters.status !== "" && row.statusValue !== filters.status) return false;
  if (filters.unlaunchedOnly) return false;
  if (filters.noDueDateOnly && !isNoDueDate(row)) return false;
  return true;
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
    { id: WorkPlanStatus.Future, name: "未来工作" },
    { id: WorkPlanStatus.ThisWeek, name: "本周工作" },
    { id: launchedStatusFilter, name: "已发起" },
    { id: completedStatusFilter, name: "已完成" },
  ];
  return renderOptions(options, filters.status, "全部状态");
}

function renderFilters() {
  const activePeople = state.people.filter((person) => person.status !== "inactive");
  const standardWorks = state.taskTemplates.filter((template) => template.status !== "inactive");
  return `
    <section class="schedule-board-filters" aria-label="排期看板筛选">
      <label>
        <span>关键词</span>
        <input name="keyword" value="${escapeAttribute(filters.keyword)}" autocomplete="off" />
      </label>
      <label>
        <span>价值链</span>
        <select name="valueModuleId">${renderOptions(valueModuleList, filters.valueModuleId, "全部价值链")}</select>
      </label>
      <label>
        <span>标准工作</span>
        <select name="standardWorkId">${renderOptions(standardWorks, filters.standardWorkId, "全部标准工作")}</select>
      </label>
      <label>
        <span>负责人</span>
        <select name="ownerId">${renderOptions(activePeople, filters.ownerId, "全部负责人")}</select>
      </label>
      <label>
        <span>状态</span>
        <select name="status">${renderStatusOptions()}</select>
      </label>
      <label class="inline-checkbox">
        <input type="checkbox" name="unlaunchedOnly" ${filters.unlaunchedOnly ? "checked" : ""} />
        <span>只看未发起</span>
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
  if (row.processInstance.status === ProcessInstanceStatus.Done) return "is-done";
  if (row.processInstance.status === ProcessInstanceStatus.Stopped) return "is-canceled";
  return "is-doing";
}

function canDragProcess(row) {
  return row.processInstance !== null && row.processInstance.status === ProcessInstanceStatus.Running && !savingWorkPlanIds.has(row.workPlan.id);
}

function canDragFutureWork(row) {
  return isFutureWorkPlan(row.workPlan) && !savingWorkPlanIds.has(row.workPlan.id);
}

function getProcessCardTitle(row) {
  return row.processInstance?.displayTitle ?? row.processInstance?.name ?? row.title;
}

function renderProcessBlock(row) {
  if (row.processInstance === null) return "";
  const canDrag = canDragProcess(row);
  const title = getProcessCardTitle(row);
  const previewImage = getProcessPreviewImage(row);
  return `
    <button
      class="schedule-process-block ${getProcessStatusClass(row)} ${savingWorkPlanIds.has(row.workPlan.id) ? "is-saving" : ""}"
      type="button"
      data-schedule-process-id="${escapeAttribute(row.processInstance.id)}"
      data-schedule-work-plan-id="${escapeAttribute(row.workPlan.id)}"
      data-schedule-drag-type="process-instance"
      data-schedule-preview-title="${escapeAttribute(title)}"
      data-schedule-preview-image="${escapeAttribute(previewImage === "" ? "" : resolveAssetUrl(previewImage))}"
      draggable="${canDrag ? "true" : "false"}"
      title="${escapeAttribute(title)}"
      aria-label="${escapeAttribute(title)}"
    >
      <strong>${escapeHtml(title)}</strong>
    </button>
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
  preview.classList.remove("is-hidden");
  preview.innerHTML = imageUrl === ""
    ? `<div class="schedule-hover-preview-empty">无预览图</div>`
    : `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(title)}" />`;
  preview.querySelector("img")?.addEventListener("error", () => {
    preview.innerHTML = `<div class="schedule-hover-preview-empty">无预览图</div>`;
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

function renderWorkCell(row) {
  const canDrag = canDragFutureWork(row);
  return `
    <article
      class="schedule-work-cell ${canDrag ? "is-draggable" : ""} ${savingWorkPlanIds.has(row.workPlan.id) ? "is-saving" : ""}"
      title="${escapeAttribute(`${row.title}｜${row.standardWorkName}｜负责人：${row.ownerName}`)}"
      data-schedule-future-work-id="${escapeAttribute(row.workPlan.id)}"
      data-schedule-drag-type="work-plan"
      draggable="${canDrag ? "true" : "false"}"
    >
      <div class="schedule-work-thumb-wrap">${renderThumbnail(row)}</div>
      <div class="schedule-work-meta">
        <strong>${escapeHtml(row.title)}</strong>
        <span>${escapeHtml(row.standardWorkName)}</span>
        <small>目标：${escapeHtml(row.goalName)}</small>
        <small>${escapeHtml(row.valueModuleName)}｜${escapeHtml(row.departmentName)}</small>
        <small>负责人：${escapeHtml(row.ownerName)}｜${escapeHtml(row.statusLabel)}</small>
      </div>
    </article>
  `;
}

function renderBoardRows(rows, days) {
  if (rows.length === 0) {
    return `
      <div class="schedule-board-empty">
        <h2>暂无匹配已发起工作</h2>
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

function renderSummary(futureRows, launchedRows, days) {
  const dayKeys = new Set(days.map((day) => day.key));
  const noDueDateCount = launchedRows.filter(isNoDueDate).length;
  const outOfRangeCount = launchedRows.filter((row) => row.processInstance !== null && row.dueDateKey !== "" && !isDueDateInBoard(row, dayKeys)).length;
  return `
    <div class="schedule-board-summary">
      <span>未来工作 ${futureRows.length}</span>
      <span>已发起 ${launchedRows.length}</span>
      <span>无截止时间 ${noDueDateCount}</span>
      <span>超出30天 ${outOfRangeCount}</span>
    </div>
  `;
}

function renderFutureWorkList(rows) {
  return `
    <aside class="schedule-future-panel" aria-label="未来工作">
      <div class="schedule-future-panel-header">
        <h3>未来工作</h3>
        <span>${rows.length}</span>
      </div>
      <div class="schedule-future-list">
        ${rows.length === 0 ? `<p class="schedule-future-empty">暂无匹配未来工作</p>` : rows.map(renderWorkCell).join("")}
      </div>
    </aside>
  `;
}

function findRowByWorkPlanId(workPlanId) {
  return buildRows().find((row) => row.workPlan.id === workPlanId) ?? null;
}

function findRowByProcessInstanceId(processInstanceId) {
  return buildRows().find((row) => row.processInstance?.id === processInstanceId) ?? null;
}

async function moveLaunchedProcessDueDate(processInstanceId, targetDate, targetHour, rerender) {
  const row = findRowByProcessInstanceId(processInstanceId);
  if (row === null || row.processInstance === null) return;
  if (!canDragProcess(row)) return;
  const nextDueDate = buildScheduledDueDate(targetDate, targetHour);
  if (row.dueDate === nextDueDate && row.workPlan.dueDate === nextDueDate) return;

  const instanceIndex = state.processInstances.findIndex((instance) => instance.id === row.processInstance.id);
  const workPlanIndex = state.workPlans.findIndex((workPlan) => workPlan.id === row.workPlan.id);
  if (instanceIndex < 0) return;

  const previousInstanceDueDate = state.processInstances[instanceIndex].dueDate ?? null;
  const previousWorkPlanDueDate = workPlanIndex >= 0 ? state.workPlans[workPlanIndex].dueDate ?? null : null;

  savingWorkPlanIds.add(row.workPlan.id);
  state.processInstances[instanceIndex] = { ...state.processInstances[instanceIndex], dueDate: nextDueDate };
  if (workPlanIndex >= 0) state.workPlans[workPlanIndex] = { ...state.workPlans[workPlanIndex], dueDate: nextDueDate };
  rerender();

  try {
    const savedInstance = await updatePersistentResource("process-instances", row.processInstance.id, { dueDate: nextDueDate });
    const savedWorkPlan = await updatePersistentResource("work-plans", row.workPlan.id, { dueDate: nextDueDate });
    const savedIndex = state.processInstances.findIndex((instance) => instance.id === row.processInstance.id);
    if (savedIndex >= 0) state.processInstances[savedIndex] = { ...state.processInstances[savedIndex], ...savedInstance };
    const savedWorkPlanIndex = state.workPlans.findIndex((workPlan) => workPlan.id === row.workPlan.id);
    if (savedWorkPlanIndex >= 0) state.workPlans[savedWorkPlanIndex] = { ...state.workPlans[savedWorkPlanIndex], ...savedWorkPlan };
  } catch (error) {
    await Promise.allSettled([
      updatePersistentResource("process-instances", row.processInstance.id, { dueDate: previousInstanceDueDate }),
      updatePersistentResource("work-plans", row.workPlan.id, { dueDate: previousWorkPlanDueDate }),
    ]);
    const rollbackIndex = state.processInstances.findIndex((instance) => instance.id === row.processInstance.id);
    if (rollbackIndex >= 0) state.processInstances[rollbackIndex] = { ...state.processInstances[rollbackIndex], dueDate: previousInstanceDueDate };
    const rollbackWorkPlanIndex = state.workPlans.findIndex((workPlan) => workPlan.id === row.workPlan.id);
    if (rollbackWorkPlanIndex >= 0) state.workPlans[rollbackWorkPlanIndex] = { ...state.workPlans[rollbackWorkPlanIndex], dueDate: previousWorkPlanDueDate };
    window.alert(error.message || "截止时间保存失败，请检查本地数据库服务。");
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

async function launchFutureWorkPlanToSlot(workPlanId, targetDate, targetHour, rerender) {
  const row = findRowByWorkPlanId(workPlanId);
  if (row === null || !canDragFutureWork(row)) return;
  const dueDate = buildScheduledDueDate(targetDate, targetHour);

  savingWorkPlanIds.add(workPlanId);
  rerender();

  try {
    await launchWorkPlanAsProcess(workPlanId, { dueDate });
  } catch (error) {
    window.alert(error.message || "发起并排期失败，请检查本地数据库服务。");
  } finally {
    savingWorkPlanIds.delete(workPlanId);
    draggedSourceId = null;
    draggedSourceType = null;
    rerender();
  }
}

function renderProcessDetailModal() {
  if (selectedProcessInstanceId === null) return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal schedule-process-modal" role="dialog" aria-modal="true" aria-label="已发起工作详情">
        <div class="modal-header">
          <h2>已发起工作详情</h2>
          <button class="icon-button" type="button" data-action="close-schedule-process-modal" aria-label="关闭">×</button>
        </div>
        ${renderLaunchedProcessDetail(selectedProcessInstanceId, {
          emptyHtml: `<section class="placeholder"><h2>未找到已发起工作</h2></section>`,
        })}
      </div>
    </div>
  `;
}

export function renderScheduleBoardPage() {
  const days = buildBoardDays();
  const futureRows = buildFutureRows().filter(futureRowMatchesFilters);
  const launchedRows = buildLaunchedRows().filter(launchedRowMatchesFilters);
  const columnCount = filters.noDueDateOnly ? 1 : boardDayCount;
  return `
    <section class="schedule-board-page" style="--schedule-day-count: ${columnCount};">
      ${renderFilters()}
      ${renderSummary(futureRows, launchedRows, days)}
      <div class="schedule-board-layout">
        ${renderFutureWorkList(futureRows)}
        <div class="schedule-board-shell">
          <div class="schedule-board-grid">
            ${renderBoardHeader(days)}
            ${renderBoardRows(launchedRows, days)}
          </div>
        </div>
      </div>
      ${renderProcessDetailModal()}
    </section>
  `;
}

export function bindScheduleBoardPageEvents(rerender) {
  hideSchedulePreview();

  document.querySelector(".schedule-board-filters")?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    if (target.name === "unlaunchedOnly" || target.name === "noDueDateOnly") {
      filters[target.name] = target.checked;
    } else if (Object.prototype.hasOwnProperty.call(filters, target.name)) {
      filters[target.name] = target.value;
    }
    rerender();
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
  });

  document.querySelectorAll("[data-schedule-future-work-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      const workPlanId = card.dataset.scheduleFutureWorkId ?? "";
      if (card.getAttribute("draggable") !== "true" || workPlanId === "") {
        event.preventDefault();
        return;
      }
      hideSchedulePreview();
      draggedSourceId = workPlanId;
      draggedSourceType = "work-plan";
      card.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", workPlanId);
      event.dataTransfer?.setData("application/x-schedule-drag-type", "work-plan");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragend", () => {
      hideSchedulePreview();
      card.classList.remove("is-dragging");
      document.querySelectorAll(".schedule-time-slot.is-drop-target").forEach((cell) => cell.classList.remove("is-drop-target"));
      window.setTimeout(() => {
        draggedSourceId = null;
        draggedSourceType = null;
      }, 250);
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
      if (sourceType === "work-plan") {
        launchFutureWorkPlanToSlot(sourceId, targetDate, targetHour, rerender);
        return;
      }
      if (sourceType === "process-instance") {
        moveLaunchedProcessDueDate(sourceId, targetDate, targetHour, rerender);
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
    });
  }
}
