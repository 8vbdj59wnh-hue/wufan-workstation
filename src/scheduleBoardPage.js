import { resolveAssetUrl, state } from "./appState.js?v=20260705-state-singleton1";
import { selectTask } from "./tasksPage.js?v=20260705-state-singleton1";
import {
  TaskStatus,
  getValueModuleName,
  inferValueModuleIdFromText,
  taskStatusNames,
  valueModuleList,
} from "./data/modelOptions.js?v=20260705-state-singleton1";
import { getPrimaryImageUrl, isCanceledStatus } from "./data/taskUtils.js?v=20260705-state-singleton1";

const dayMs = 24 * 60 * 60 * 1000;
const boardDayCount = 30;

const filters = {
  keyword: "",
  valueModuleId: "",
  standardWorkId: "",
  ownerId: "",
  executorId: "",
  status: "",
  unscheduledOnly: false,
};

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
    };
  });
}

function getPersonName(personId, fallback = "未设置") {
  if (!personId) return fallback;
  return state.people.find((person) => person.id === personId)?.name ?? fallback;
}

function getTaskTemplate(templateId) {
  if (!templateId) return null;
  return state.taskTemplates.find((template) => template.id === templateId) ?? null;
}

function getProcessInstance(instanceId) {
  if (!instanceId) return null;
  return state.processInstances.find((instance) => instance.id === instanceId) ?? null;
}

function getTaskCustomFields(task) {
  return task?.customFields && typeof task.customFields === "object" ? task.customFields : {};
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

function getTaskExecutorId(task) {
  return task.executorId ?? task.assigneeId ?? task.responsiblePersonId ?? task.ownerId ?? "";
}

function getTaskOwnerId(task) {
  return task.ownerId ?? task.responsiblePersonId ?? task.executorId ?? task.assigneeId ?? "";
}

function getTaskStandardWorkId(task, instance = null) {
  return (
    task.taskTemplateId ??
    task.standardWorkId ??
    instance?.taskTemplateId ??
    instance?.standardWorkId ??
    ""
  );
}

function getStandardWorkName(task, instance = null) {
  const template = getTaskTemplate(getTaskStandardWorkId(task, instance));
  if (template?.name) return template.name;
  const title = instance?.displayTitle ?? instance?.name ?? task.displayTitle ?? "";
  const firstSegment = String(title).split("｜").map((segment) => segment.trim()).find(Boolean);
  return firstSegment || "未关联标准工作";
}

function getWorkInstanceName(tasks, instance = null) {
  const firstTask = tasks[0] ?? {};
  const customFields = {
    ...(instance?.customFields ?? {}),
    ...getTaskCustomFields(firstTask),
  };
  const candidates = [
    instance?.displayTitle,
    instance?.name,
    firstTask.displayTitle,
    getTextFromFields(customFields, ["productName", "product", "productTitle", "objectName", "itemName"]),
    firstTask.name,
  ];
  return candidates.map((value) => String(value ?? "").trim()).find(Boolean) ?? "独立任务";
}

function getWorkValueModuleId(tasks, instance = null) {
  const firstTask = tasks[0] ?? {};
  const standardWorkId = getTaskStandardWorkId(firstTask, instance);
  const template = getTaskTemplate(standardWorkId);
  const candidate =
    template?.categoryId ??
    firstTask.categoryId ??
    instance?.categoryId ??
    "";
  if (valueModuleList.some((module) => module.id === candidate)) return candidate;
  return inferValueModuleIdFromText([template?.name, instance?.displayTitle, instance?.name, firstTask.name].join(" "));
}

function normalizeAttachmentList(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function getImageFromAttachmentList(list) {
  const imageExtPattern = /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i;
  for (const file of normalizeAttachmentList(list)) {
    const url = typeof file === "string" ? file : file?.url ?? file?.filePath ?? file?.path ?? "";
    const name = typeof file === "string" ? file : file?.originalName ?? file?.filename ?? url;
    if (url && (imageExtPattern.test(url) || imageExtPattern.test(name))) return url;
  }
  return "";
}

function getWorkThumbnail(tasks, instance = null) {
  for (const task of tasks) {
    const image =
      getTaskCustomFields(task).coverImageUrl ??
      task.coverImageUrl ??
      task.productImage ??
      task.imageUrl ??
      getPrimaryImageUrl(task);
    if (image) return image;
  }
  const instanceImage =
    instance?.customFields?.coverImageUrl ??
    instance?.coverImageUrl ??
    instance?.productImage ??
    instance?.imageUrl ??
    getPrimaryImageUrl(instance);
  if (instanceImage) return instanceImage;

  for (const task of tasks) {
    const attachmentImage =
      getImageFromAttachmentList(task.attachments) ||
      getImageFromAttachmentList(task.standardWorkAttachments) ||
      getImageFromAttachmentList(task.resultAttachments) ||
      getImageFromAttachmentList(task.submitFiles);
    if (attachmentImage) return attachmentImage;
  }
  return "";
}

function getScheduledDateKey(task) {
  const startDate = parseDate(task.scheduledStartAt);
  if (startDate !== null) return formatDate(startDate);
  if (typeof task.scheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.scheduledDate)) return task.scheduledDate;
  return "";
}

function isTaskUnscheduled(task) {
  return getScheduledDateKey(task) === "";
}

function formatTaskTimeRange(task) {
  const startDate = parseDate(task.scheduledStartAt);
  const endDate = parseDate(task.scheduledEndAt);
  if (startDate === null && endDate === null) return "";
  const formatTime = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (startDate !== null && endDate !== null) return `${formatTime(startDate)}-${formatTime(endDate)}`;
  if (startDate !== null) return formatTime(startDate);
  return `至 ${formatTime(endDate)}`;
}

function getProgressText(tasks) {
  const doneCount = tasks.filter((task) => task.status === TaskStatus.Done).length;
  return `${doneCount}/${tasks.length}`;
}

function uniqueNames(ids) {
  return [...new Set(ids.filter(Boolean).map((id) => getPersonName(id, "")).filter(Boolean))];
}

function buildWorkRows() {
  const groups = new Map();
  for (const task of state.tasks) {
    const instanceId = task.processInstanceId ?? "";
    const groupId = instanceId || `standalone-${task.id}`;
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        id: groupId,
        processInstanceId: instanceId || null,
        tasks: [],
      });
    }
    groups.get(groupId).tasks.push(task);
  }

  return [...groups.values()].map((row) => {
    const instance = getProcessInstance(row.processInstanceId);
    const tasks = row.tasks.sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
    const firstTask = tasks[0] ?? {};
    const standardWorkId = getTaskStandardWorkId(firstTask, instance);
    const standardWorkName = getStandardWorkName(firstTask, instance);
    const ownerNames = uniqueNames(tasks.map(getTaskOwnerId));
    const executorNames = uniqueNames(tasks.map(getTaskExecutorId));
    return {
      ...row,
      tasks,
      instance,
      standardWorkId,
      standardWorkName,
      valueModuleId: getWorkValueModuleId(tasks, instance),
      name: row.processInstanceId === null ? "独立任务" : getWorkInstanceName(tasks, instance),
      thumbnail: getWorkThumbnail(tasks, instance),
      progressText: getProgressText(tasks),
      ownerSummary: ownerNames.length === 0 ? "未设置" : ownerNames.slice(0, 3).join("、"),
      executorSummary: executorNames.length === 0 ? "未设置" : executorNames.slice(0, 3).join("、"),
    };
  });
}

function getSearchText(row) {
  return [
    row.name,
    row.standardWorkName,
    getValueModuleName(row.valueModuleId, ""),
    row.ownerSummary,
    row.executorSummary,
    ...row.tasks.flatMap((task) => [
      task.name,
      task.description,
      getPersonName(getTaskOwnerId(task), ""),
      getPersonName(getTaskExecutorId(task), ""),
      task.dueDate,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function taskMatchesStatus(task) {
  if (filters.status === "") return !isCanceledStatus(task.status);
  return task.status === filters.status;
}

function rowMatchesFilters(row) {
  const keyword = filters.keyword.trim().toLowerCase();
  if (keyword !== "" && !getSearchText(row).includes(keyword)) return false;
  if (filters.valueModuleId !== "" && row.valueModuleId !== filters.valueModuleId) return false;
  if (filters.standardWorkId !== "" && row.standardWorkId !== filters.standardWorkId) return false;
  if (filters.ownerId !== "" && !row.tasks.some((task) => getTaskOwnerId(task) === filters.ownerId)) return false;
  if (filters.executorId !== "" && !row.tasks.some((task) => getTaskExecutorId(task) === filters.executorId)) return false;
  if (filters.unscheduledOnly && !row.tasks.some(isTaskUnscheduled)) return false;
  return row.tasks.some(taskMatchesStatus);
}

function getVisibleTasks(row) {
  return row.tasks.filter((task) => {
    if (!taskMatchesStatus(task)) return false;
    if (filters.ownerId !== "" && getTaskOwnerId(task) !== filters.ownerId) return false;
    if (filters.executorId !== "" && getTaskExecutorId(task) !== filters.executorId) return false;
    if (filters.unscheduledOnly && !isTaskUnscheduled(task)) return false;
    return true;
  });
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
  return [
    `<option value="">全部状态</option>`,
    ...Object.entries(taskStatusNames).map(
      ([value, label]) => `<option value="${escapeAttribute(value)}" ${filters.status === value ? "selected" : ""}>${escapeHtml(label)}</option>`,
    ),
  ].join("");
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
        <span>执行人</span>
        <select name="executorId">${renderOptions(activePeople, filters.executorId, "全部执行人")}</select>
      </label>
      <label>
        <span>状态</span>
        <select name="status">${renderStatusOptions()}</select>
      </label>
      <label class="inline-checkbox">
        <input type="checkbox" name="unscheduledOnly" ${filters.unscheduledOnly ? "checked" : ""} />
        <span>只看未排期</span>
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
      alt="${escapeAttribute(row.name)}"
      onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'schedule-board-thumb-placeholder', textContent: '无图' }))"
    />
  `;
}

function getTaskStatusClass(task) {
  if (task.status === TaskStatus.Waiting) return "is-waiting";
  if (task.status === TaskStatus.Doing || task.status === TaskStatus.PendingAcceptance) return "is-doing";
  if (task.status === TaskStatus.Done) return "is-done";
  if (task.status === TaskStatus.Canceled) return "is-canceled";
  return "is-todo";
}

function renderTaskBlock(task) {
  const timeText = formatTaskTimeRange(task);
  return `
    <button class="schedule-task-block ${getTaskStatusClass(task)}" type="button" data-schedule-task-id="${escapeAttribute(task.id)}">
      <strong>${escapeHtml(task.name)}</strong>
      <span>${escapeHtml(taskStatusNames[task.status] ?? task.status ?? "未设置")}${timeText ? `｜${escapeHtml(timeText)}` : ""}</span>
      <small>${escapeHtml(getPersonName(getTaskExecutorId(task), "未设置"))}${task.dueDate ? `｜截止 ${escapeHtml(task.dueDate)}` : ""}</small>
    </button>
  `;
}

function renderDateCell(tasks, dayKey) {
  const tasksForDay = tasks.filter((task) => getScheduledDateKey(task) === dayKey);
  if (tasksForDay.length === 0) return `<div class="schedule-board-cell"></div>`;
  return `
    <div class="schedule-board-cell">
      ${tasksForDay.map(renderTaskBlock).join("")}
    </div>
  `;
}

function renderUnscheduledCell(tasks) {
  const unscheduledTasks = tasks.filter(isTaskUnscheduled);
  if (unscheduledTasks.length === 0) return `<div class="schedule-board-cell is-unscheduled"><span class="empty-cell">无</span></div>`;
  return `<div class="schedule-board-cell is-unscheduled">${unscheduledTasks.map(renderTaskBlock).join("")}</div>`;
}

function renderBoardRows(rows, days) {
  if (rows.length === 0) {
    return `
      <div class="schedule-board-empty">
        <h2>暂无匹配排期任务</h2>
        <p>请调整筛选条件，或查看未排期任务。</p>
      </div>
    `;
  }

  return rows
    .map((row) => {
      const visibleTasks = getVisibleTasks(row);
      return `
        <div class="schedule-board-row">
          <div class="schedule-work-cell">
            <div class="schedule-work-thumb-wrap">${renderThumbnail(row)}</div>
            <div class="schedule-work-meta">
              <strong>${escapeHtml(row.name)}</strong>
              <span>${escapeHtml(row.standardWorkName)}</span>
              <small>进度 ${escapeHtml(row.progressText)}｜${escapeHtml(getValueModuleName(row.valueModuleId, "未分类"))}</small>
              <small>负责人：${escapeHtml(row.ownerSummary)}</small>
              <small>执行人：${escapeHtml(row.executorSummary)}</small>
            </div>
          </div>
          ${
            filters.unscheduledOnly
              ? renderUnscheduledCell(visibleTasks)
              : days.map((day) => renderDateCell(visibleTasks, day.key)).join("")
          }
        </div>
      `;
    })
    .join("");
}

function renderBoardHeader(days) {
  const dayHeaders = filters.unscheduledOnly
    ? `<div class="schedule-day-header is-unscheduled">未排期</div>`
    : days
        .map(
          (day) => `
            <div class="schedule-day-header ${day.isToday ? "is-today" : ""}">
              <strong>${escapeHtml(day.label)}</strong>
              <span>周${escapeHtml(day.weekday)}</span>
            </div>
          `,
        )
        .join("");
  return `
    <div class="schedule-board-header">
      <div class="schedule-work-header">工作实例</div>
      ${dayHeaders}
    </div>
  `;
}

export function renderScheduleBoardPage() {
  const days = buildBoardDays();
  const rows = buildWorkRows().filter(rowMatchesFilters);
  const columnCount = filters.unscheduledOnly ? 1 : boardDayCount;
  return `
    <section class="schedule-board-page" style="--schedule-day-count: ${columnCount};">
      <div class="page-toolbar">
        <div>
          <h2>排期看板</h2>
          <p class="form-note">按已发起执行任务聚合展示，主看板仅显示未来30天。</p>
        </div>
      </div>
      ${renderFilters()}
      <div class="schedule-board-shell">
        <div class="schedule-board-grid">
          ${renderBoardHeader(days)}
          ${renderBoardRows(rows, days)}
        </div>
      </div>
    </section>
  `;
}

export function bindScheduleBoardPageEvents(rerender) {
  document.querySelector(".schedule-board-filters")?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    if (target.name === "unscheduledOnly") {
      filters.unscheduledOnly = target.checked;
    } else if (Object.prototype.hasOwnProperty.call(filters, target.name)) {
      filters[target.name] = target.value;
    }
    rerender();
  });

  document.querySelectorAll("[data-schedule-task-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.dataset.scheduleTaskId ?? "";
      if (taskId === "") return;
      selectTask(taskId);
      window.location.hash = "task-list";
    });
  });
}
