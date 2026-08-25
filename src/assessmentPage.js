import {
  createId,
  createPersistentResource,
  getCurrentUser,
  getNow,
  hasOpenRectificationWorkForSource,
  launchRectificationWorkForSource,
  loadWorkResultsInitial,
  state,
  updatePersistentResource,
} from "./appState.js";
import { getDataScope, hasPermission } from "../shared/permissions.js";
import {
  ProcessInstanceStatus,
  TaskStatus,
  WorkPlanStatus,
  WorkType,
  processInstanceStatusNames,
  taskStatusNames,
} from "./data/modelOptions.js";
import { hasTaskOverdueRecord, isCanceledStatus, isDoneStatus, isTaskOverdue } from "./data/taskUtils.js";
import {
  getCurrentExecutor as selectCurrentExecutor,
  getCurrentProcessTask as selectCurrentProcessTask,
  getProcessInstanceOwner as selectProcessInstanceOwner,
  isTaskExecutionStarted,
} from "./data/processInstanceSelectors.js";
import {
  getPeriodWorkResultSummary,
  getProcessInstanceByWorkPlan as getStatsProcessInstanceByWorkPlan,
  getWorkPlanRecordDate as getStatsWorkPlanRecordDate,
  getWorkPlanStatusLabel as getStatsWorkPlanStatusLabel,
  getWorkResultSummary,
  isWorkPlanRelatedToPerson as isStatsWorkPlanRelatedToPerson,
  UnassignedDepartmentId,
} from "./data/workResultStats.js";
import { formatBusinessDateTime } from "./businessTime.js";
import { bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js";

const today = new Date().toISOString().slice(0, 10);
let activeAssessmentTab = "stats";
let modalState = null;
let statsFilters = {
  period: "this_week",
  startDate: "",
  endDate: "",
  departmentId: "",
  personId: "",
  goalId: "",
};
let dashboardFilters = {
  days: 30,
};
let showAllTodayEvents = false;
let activeTodayOverview = "startedActions";
let reportFilters = {
  weekStart: "",
  departmentId: "",
  status: "",
  submitterId: "",
};
let problemFilters = {
  status: "",
  departmentId: "",
  problemType: "",
};
let rectificationFilters = {
  status: "",
  ownerId: "",
  executorId: "",
  sourceType: "",
  focus: "",
};
let workResultsLoading = false;
let workResultsLoadedDays = 0;

async function ensureWorkResultsLoaded(rerender, days = dashboardFilters.days) {
  if (workResultsLoading || workResultsLoadedDays === days) return;
  workResultsLoading = true;
  try {
    await loadWorkResultsInitial(days);
    workResultsLoadedDays = days;
    rerender();
  } catch (error) {
    console.error("工作结果摘要按需读取失败", error);
  } finally {
    workResultsLoading = false;
  }
}

const tabHashMap = {
  "dashboard-management": "stats",
  assessment: "stats",
  "assessment-stats": "stats",
  "assessment-reports": "reports",
  "assessment-problems": "problems",
  "assessment-rectifications": "rectifications",
  "assessment-person-profiles": "personProfiles",
};

const weeklyReportQuestionLabels = {
  goalAlignedWork: "本周围绕目标推进了哪些关键事情？",
  workEffectReview: "这些事情做得怎么样？是否真正解决了问题、产生了效果？",
  efficiencyReview: "任务效率如何？有无提升空间？",
};

const weeklyReportPlaceholders = {
  goalAlignedWork: "请只写与目标直接相关的关键工作，不写日常流水账。说明对齐哪个目标，推进了什么。",
  workEffectReview: "请说明这些事情是否做对了，解决了什么问题，产生了什么实际效果。不要只写“已完成”。",
  efficiencyReview: "请说明本周任务推进过程中是否存在低效、返工、卡点、等待、沟通不顺等问题，以及下周有什么改进空间。",
};

const weeklyReportStatusNames = {
  draft: "草稿",
  submitted: "已提交",
};

const problemStatusNames = {
  unresolved: "未解决",
  resolving: "解决中",
  resolved: "已解决",
  closed: "已关闭",
};

const problemTypeOptions = ["目标不清晰", "标准问题", "人员问题", "沟通问题", "产品问题", "供应链问题", "内容问题", "库存问题", "效率问题", "其他"];
const impactLevelOptions = ["轻微", "一般", "严重"];
const rectificationSourceTypeNames = {
  overdue_task: "逾期任务",
  returned_task: "审核退回",
  rework_task: "连续返工",
  delayed_process: "项目延期",
  manual: "人工创建改善",
};

const rectificationFocusNames = {
  pending: "待改善",
  active: "改善中",
  todayException: "今日新增异常",
  todayDone: "今日完成改善",
};

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function findName(items, id, fallback = "未设置") {
  if (id === null || id === undefined || id === "") return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function getMonday(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getWeekRange(weekStart = "") {
  const start = weekStart === "" ? getMonday() : getMonday(new Date(`${weekStart}T00:00:00`));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    weekStart: toDateOnly(start),
    weekEnd: toDateOnly(end),
    weekLabel: `${start.getFullYear()}年第${getWeekNumber(start)}周`,
  };
}

function getWeekNumber(date) {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date - firstDay) / 86400000);
  return Math.ceil((days + firstDay.getDay() + 1) / 7);
}

function getStatsRange() {
  const now = new Date();
  if (statsFilters.period === "last_week") {
    const start = getMonday(now);
    start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { startDate: toDateOnly(start), endDate: toDateOnly(end) };
  }
  if (statsFilters.period === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startDate: toDateOnly(start), endDate: toDateOnly(end) };
  }
  if (statsFilters.period === "custom") {
    return { startDate: statsFilters.startDate || "0000-01-01", endDate: statsFilters.endDate || "9999-12-31" };
  }
  const week = getWeekRange();
  return { startDate: week.weekStart, endDate: week.weekEnd };
}

function dateInRange(value, range) {
  const date = String(value ?? "").slice(0, 10);
  if (date === "") return false;
  return date >= range.startDate && date <= range.endDate;
}

function getScopedDepartments() {
  const user = getCurrentUser();
  if (canCurrentUser("workResults.viewAll")) return state.departments;
  if (canCurrentUser("workResults.viewDepartment")) return state.departments.filter((department) => department.id === user?.departmentId);
  return state.departments.filter((department) => department.id === user?.departmentId);
}

function getScopedPeople() {
  const user = getCurrentUser();
  if (canCurrentUser("workResults.viewAll")) return state.people;
  if (canCurrentUser("workResults.viewDepartment")) return state.people.filter((person) => person.departmentId === user?.departmentId || person.id === user?.id);
  return state.people.filter((person) => person.id === user?.id);
}

function isVisibleByAssessmentScope(item) {
  const user = getCurrentUser();
  if (canCurrentUser("workResults.viewAll")) return true;
  if (canCurrentUser("workResults.viewDepartment")) return item.departmentId === user?.departmentId || item.ownerId === user?.id || item.submitterId === user?.id;
  if (canCurrentUser("workResults.viewSelf")) return item.ownerId === user?.id || item.submitterId === user?.id || item.id === user?.id;
  const dataScope = getDataScope(user);
  if (dataScope === "all") return true;
  if (dataScope === "department") return item.departmentId === user?.departmentId;
  return item.ownerId === user?.id || item.submitterId === user?.id;
}

function getTaskPeriodDate(task) {
  return task.completedAt ?? task.updatedAt ?? task.createdAt ?? task.dueDate;
}

function isTaskAssessmentOverdue(task) {
  return isTaskOverdue(task, today) || hasTaskOverdueRecord(task);
}

function isTaskVisibleForStatistics(task) {
  return isTaskExecutionStarted(task, state);
}

function getFilteredStatsTasks() {
  const range = getStatsRange();
  return state.tasks.filter((task) => {
    if (!isTaskVisibleForStatistics(task)) return false;
    if (!isVisibleByAssessmentScope(task)) return false;
    if (!dateInRange(getTaskPeriodDate(task), range) && !dateInRange(task.dueDate, range)) return false;
    if (statsFilters.departmentId !== "" && task.departmentId !== statsFilters.departmentId) return false;
    if (statsFilters.personId !== "" && task.ownerId !== statsFilters.personId) return false;
    if (statsFilters.goalId !== "" && task.goalId !== statsFilters.goalId) return false;
    return true;
  });
}

function getFilteredStatsProcessInstances() {
  const range = getStatsRange();
  return state.processInstances.filter((instance) => {
    if (!isVisibleByAssessmentScope(instance)) return false;
    if (!dateInRange(instance.startedAt ?? instance.createdAt, range) && !dateInRange(instance.updatedAt, range)) return false;
    if (statsFilters.goalId !== "" && instance.goalId !== statsFilters.goalId) return false;
    return true;
  });
}

function hasSubmittedResult(task) {
  return Boolean(task.submittedAt || task.resultText || (task.submitFiles ?? []).length > 0 || (task.submitLinks ?? []).length > 0);
}

function hasOpenRectificationWorkForTask(taskId) {
  return hasOpenRectificationWorkForSource({ sourceTaskId: taskId });
}

function getProcessTasks(processInstanceId) {
  if (!processInstanceId) return [];
  return state.tasks
    .filter((task) => task.processInstanceId === processInstanceId)
    .sort((left, right) => {
      const leftNode = state.processTemplateNodes.find((node) => node.id === left.processNodeId);
      const rightNode = state.processTemplateNodes.find((node) => node.id === right.processNodeId);
      const leftOrder = Number(leftNode?.stepOrder ?? leftNode?.stageOrder ?? leftNode?.nodeOrder ?? 1);
      const rightOrder = Number(rightNode?.stepOrder ?? rightNode?.stageOrder ?? rightNode?.nodeOrder ?? 1);
      return leftOrder - rightOrder;
    });
}

function formatPercent(value) {
  if (value === null || Number.isNaN(value)) return "-";
  return `${Math.round(value)}%`;
}

function renderTrendValue(label, current, previous, formatter = (value) => value) {
  const hasValue = current !== null && current !== undefined && !Number.isNaN(current);
  const hasPrevious = previous !== null && previous !== undefined && !Number.isNaN(previous);
  const delta = hasValue && hasPrevious ? current - previous : null;
  const deltaLabel = delta === null ? "无上期数据" : `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}${formatter(Math.abs(delta))}`;
  return `
    <div class="person-profile-trend-item">
      <span>${escapeHtml(label)}</span>
      <strong>${hasValue ? formatter(current) : "-"}</strong>
      <em class="${delta === null ? "" : delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}">${escapeHtml(deltaLabel)}</em>
    </div>
  `;
}

function getPersonProfile(person) {
  const summary = getWorkResultSummary(state, { personId: person.id, currentDate: today });
  const rectificationRows = getRectificationRows().filter((row) => isStatsWorkPlanRelatedToPerson(state, row.workPlan, person.id));
  const recentRectifications = rectificationRows
    .slice()
    .sort((left, right) => String(right.processInstance?.startedAt ?? right.workPlan.launchedAt ?? right.workPlan.createdAt ?? "").localeCompare(String(left.processInstance?.startedAt ?? left.workPlan.launchedAt ?? left.workPlan.createdAt ?? "")))
    .slice(0, 3);
  const records = summary.workPlans
    .slice()
    .sort((left, right) => String(getStatsWorkPlanRecordDate(right) ?? "").localeCompare(String(getStatsWorkPlanRecordDate(left) ?? "")))
    .slice(0, 8);
  const current30 = getPeriodWorkResultSummary(state, { personId: person.id, days: 30 });
  const previous30 = getPeriodWorkResultSummary(state, { personId: person.id, days: 30, offsetDays: 30 });
  const current90 = getPeriodWorkResultSummary(state, { personId: person.id, days: 90 });
  const previous90 = getPeriodWorkResultSummary(state, { personId: person.id, days: 90, offsetDays: 90 });
  return {
    ...summary,
    rectificationRows,
    recentRectifications,
    records,
    trends: { current30, previous30, current90, previous90 },
  };
}

function getRectificationRows() {
  return state.workPlans
    .filter((workPlan) => workPlan.workType === WorkType.Rectification)
    .map((workPlan) => {
      const processInstance = state.processInstances.find((instance) => instance.id === workPlan.processInstanceId) ?? null;
      const tasks = getProcessTasks(processInstance?.id);
      const sourceTask = state.tasks.find((task) => task.id === workPlan.customFields?.sourceTaskId) ?? null;
      const sourceStandardWorkId = workPlan.customFields?.sourceStandardWorkId ?? sourceTask?.taskTemplateId ?? processInstance?.taskTemplateId ?? "";
      const sourceStandardWork = state.taskTemplates.find((template) => template.id === sourceStandardWorkId) ?? null;
      const currentTask = processInstance === null ? null : selectCurrentProcessTask(processInstance.id, state);
      const currentExecutor = processInstance === null ? { personId: "" } : selectCurrentExecutor(processInstance.id, state);
      const sourceType = workPlan.customFields?.sourceType ?? "manual";
      const status =
        processInstance?.status === ProcessInstanceStatus.Done
          ? "done"
          : processInstance?.status === ProcessInstanceStatus.Stopped || processInstance?.status === "canceled" || workPlan.status === WorkPlanStatus.Canceled
            ? "canceled"
            : currentTask?.name ?? "pending";
      const statusLabel =
        status === "done"
          ? "已完成"
          : status === "canceled"
            ? "已取消"
            : status === "pending"
              ? "未开始"
              : status;
      return {
        workPlan,
        processInstance,
        tasks,
        sourceTask,
        sourceStandardWork,
        currentTask,
        sourceType,
        status,
        statusLabel,
        ownerId: workPlan.customFields?.sourceOwnerId ?? currentTask?.ownerId ?? sourceTask?.ownerId ?? "",
        executorId: workPlan.customFields?.sourceExecutorId ?? currentExecutor.personId ?? sourceTask?.executorId ?? sourceTask?.assigneeId ?? "",
      };
    });
}

function getFilteredRectificationRows() {
  return getRectificationRows().filter((row) => {
    if (!isVisibleByAssessmentScope({ ...row.workPlan, ownerId: row.ownerId, submitterId: row.executorId })) return false;
    if (rectificationFilters.focus !== "" && !matchesRectificationFocus(row, rectificationFilters.focus)) return false;
    if (rectificationFilters.status !== "" && row.status !== rectificationFilters.status) return false;
    if (rectificationFilters.ownerId !== "" && row.ownerId !== rectificationFilters.ownerId) return false;
    if (rectificationFilters.executorId !== "" && row.executorId !== rectificationFilters.executorId) return false;
    if (rectificationFilters.sourceType !== "" && row.sourceType !== rectificationFilters.sourceType) return false;
    return true;
  });
}

function getLocalDateKey(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isTodayValue(value) {
  return getLocalDateKey(value) === getLocalDateKey(new Date());
}

function getRectificationStartAt(row) {
  return row.processInstance?.startedAt ?? row.workPlan.launchedAt ?? row.workPlan.createdAt ?? "";
}

function getRectificationDoneAt(row) {
  return row.processInstance?.completedAt ?? row.workPlan.completedAt ?? (row.status === "done" ? row.workPlan.updatedAt : "");
}

function isActiveRectificationRow(row) {
  return row.status !== "done" && row.status !== "canceled";
}

function matchesRectificationFocus(row, focus) {
  if (focus === "pending") return isActiveRectificationRow(row) && row.status === "pending";
  if (focus === "active") return isActiveRectificationRow(row) && row.status !== "pending";
  if (focus === "todayException") return row.sourceType !== "manual" && isTodayValue(getRectificationStartAt(row));
  if (focus === "todayDone") return row.status === "done" && isTodayValue(getRectificationDoneAt(row));
  return true;
}

function getTaskProcessInstance(task) {
  return state.processInstances.find((instance) => instance.id === task.processInstanceId) ?? null;
}

function getTaskStandardWork(task) {
  const processInstance = getTaskProcessInstance(task);
  const templateId = task.taskTemplateId ?? processInstance?.taskTemplateId ?? "";
  return state.taskTemplates.find((template) => template.id === templateId) ?? null;
}

function getTaskDepartmentId(task) {
  return task.departmentId ?? getTaskProcessInstance(task)?.departmentId ?? "";
}

function getRowDepartmentId(row) {
  return row.workPlan.departmentId ?? row.sourceTask?.departmentId ?? row.processInstance?.departmentId ?? "";
}

function getTaskRecordDate(record, fallback = "") {
  return record?.createdAt ?? record?.updatedAt ?? record?.time ?? record?.date ?? fallback;
}

function getTaskReturnRecords(task) {
  return Array.isArray(task.customFields?.returnRecords) ? task.customFields.returnRecords : [];
}

function getTaskReviewRejectRecords(task) {
  return Array.isArray(task.customFields?.reviewRejectRecords) ? task.customFields.reviewRejectRecords : [];
}

function getLatestRecordDate(records, fallback = "") {
  return records.reduce((latest, record) => {
    const value = getTaskRecordDate(record, fallback);
    return String(value) > String(latest) ? value : latest;
  }, fallback);
}

function getReportWeekStart() {
  return reportFilters.weekStart || getWeekRange().weekStart;
}

function getFilteredReports() {
  const weekStart = getReportWeekStart();
  return state.weeklyReports.filter((report) => {
    if (!isVisibleByAssessmentScope(report)) return false;
    if (report.weekStart !== weekStart) return false;
    if (reportFilters.departmentId !== "" && report.departmentId !== reportFilters.departmentId) return false;
    if (reportFilters.status !== "" && report.status !== reportFilters.status) return false;
    if (reportFilters.submitterId !== "" && report.submitterId !== reportFilters.submitterId) return false;
    return true;
  });
}

function getFilteredProblems() {
  return state.weeklyReportProblems.filter((problem) => {
    if (!isVisibleByAssessmentScope(problem)) return false;
    if (problemFilters.status !== "" && problem.status !== problemFilters.status) return false;
    if (problemFilters.departmentId !== "" && problem.departmentId !== problemFilters.departmentId) return false;
    if (problemFilters.problemType !== "" && problem.problemType !== problemFilters.problemType) return false;
    return true;
  });
}

function renderOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items.map((item) => `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
  `;
}

function renderAssessmentTabs() {
  const tabs = [
    ["stats", "今日概览", "assessment-stats"],
    ["reports", "目标推进周报", "assessment-reports"],
    ["problems", "问题汇总", "assessment-problems"],
    ["rectifications", "改善工作", "assessment-rectifications"],
    ["personProfiles", "人员档案", "assessment-person-profiles"],
  ];
  return `
    <div class="settings-tabs task-subtabs" aria-label="工作结果页签">
      ${tabs.map(([key, label, hash]) => `<button class="${activeAssessmentTab === key ? "is-active" : ""}" type="button" data-assessment-tab="${key}" data-hash="${hash}">${label}</button>`).join("")}
    </div>
  `;
}

function renderValueOptions(values, selectedValue, labels, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${values.map((value) => `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(labels[value] ?? value)}</option>`).join("")}
  `;
}

function formatNumber(value) {
  return String(Math.round(Number(value) || 0));
}

function getDashboardPeriodLabel(days) {
  if (Number(days) === 7) return "近7天";
  if (Number(days) === 90) return "近90天";
  return "近30天";
}

function renderMetricDelta(current, previous, formatter = formatNumber) {
  const currentNumber = Number(current) || 0;
  const previousNumber = Number(previous) || 0;
  const delta = currentNumber - previousNumber;
  return `<em class="${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}">${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}${escapeHtml(formatter(Math.abs(delta)))}</em>`;
}

function renderDashboardMetricCard(label, current, previous, formatter = formatNumber) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatter(current))}</strong>
      ${renderMetricDelta(current, previous, formatter)}
    </div>
  `;
}

function getDashboardSummaries(days = dashboardFilters.days) {
  if (state.workResultDashboard?.days === days) {
    return { current: state.workResultDashboard.current, previous: state.workResultDashboard.previous };
  }
  const current = getPeriodWorkResultSummary(state, { days });
  const previous = getPeriodWorkResultSummary(state, { days, offsetDays: days });
  return { current, previous };
}

function renderDashboardFilters() {
  return `
    <form class="assessment-dashboard-filters task-filters">
      <label><span>时间范围</span><select name="days">
        <option value="7" ${dashboardFilters.days === 7 ? "selected" : ""}>近7天</option>
        <option value="30" ${dashboardFilters.days === 30 ? "selected" : ""}>近30天</option>
        <option value="90" ${dashboardFilters.days === 90 ? "selected" : ""}>近90天</option>
      </select></label>
    </form>
  `;
}

function getVisibleRectificationRows() {
  return getRectificationRows().filter((row) => isVisibleByAssessmentScope({ ...row.workPlan, ownerId: row.ownerId, submitterId: row.executorId }));
}

function getTodayCompletedTasks() {
  return state.tasks.filter((task) => isTaskVisibleForStatistics(task) && isVisibleByAssessmentScope(task) && isDoneStatus(task.status) && isTodayValue(task.completedAt));
}

function getTodayExceptionTasks() {
  return state.tasks.filter((task) => {
    if (!isTaskVisibleForStatistics(task)) return false;
    if (!isVisibleByAssessmentScope(task) || isDoneStatus(task.status) || isCanceledStatus(task.status)) return false;
    const returnRecords = getTaskReturnRecords(task);
    const rejectRecords = getTaskReviewRejectRecords(task);
    return (
      isTaskAssessmentOverdue(task)
      || returnRecords.some((record) => isTodayValue(getTaskRecordDate(record, task.updatedAt)))
      || rejectRecords.some((record) => isTodayValue(getTaskRecordDate(record, task.updatedAt)))
    );
  });
}

function getTodayManagementSummary() {
  const rows = getVisibleRectificationRows();
  return {
    completedTasks: getTodayCompletedTasks().length,
    todayExceptions: getTodayExceptionTasks().length,
    todayRectifications: rows.filter((row) => matchesRectificationFocus(row, "todayException")).length,
    todayDoneRectifications: rows.filter((row) => matchesRectificationFocus(row, "todayDone")).length,
  };
}

function getHighestRiskDepartment(events) {
  const counts = new Map();
  events
    .filter((event) => event.severity >= 2)
    .forEach((event) => {
      const departmentName = event.departmentName ?? "";
      if (departmentName === "") return;
      counts.set(departmentName, (counts.get(departmentName) ?? 0) + 1);
    });
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
}

function getTodayWorkResultSummaryText(events) {
  const summary = getTodayManagementSummary();
  const focusIssues = getFocusIssues().length;
  const riskDepartment = getHighestRiskDepartment(events);
  if (summary.todayExceptions === 0 && focusIssues === 0) {
    if (summary.todayDoneRectifications > 0) return `今日整体运行平稳，暂无重点异常，${summary.todayDoneRectifications} 个改善完成验证。`;
    return "今日整体运行平稳，暂无重点异常。";
  }
  const parts = [`今日新增异常 ${summary.todayExceptions} 条`];
  if (focusIssues > 0) parts.push(`${focusIssues} 个重点问题需要管理层关注`);
  if (summary.todayDoneRectifications > 0) parts.push(`${summary.todayDoneRectifications} 个改善完成验证`);
  if (riskDepartment !== "") parts.push(`当前${riskDepartment}风险最高`);
  return `${parts.join("，")}。`;
}

function getTodayWorkResultEvents() {
  const events = [];
  getTodayExceptionTasks().forEach((task) => {
    const returnRecords = getTaskReturnRecords(task);
    const rejectRecords = getTaskReviewRejectRecords(task);
    const standardWork = getTaskStandardWork(task);
    const reason = isTaskAssessmentOverdue(task)
      ? "任务已逾期"
      : rejectRecords.length > 0
        ? "验收退回"
        : returnRecords.length > 0
          ? "发生返工"
          : "任务异常";
    events.push({
      level: "critical",
      severity: 3,
      label: "今日新增异常",
      title: `${findName(state.departments, getTaskDepartmentId(task), "未归属部门")}：${task.name}`,
      departmentName: findName(state.departments, getTaskDepartmentId(task), "未归属部门"),
      description: `${reason}，来源关键行动：${standardWork?.name ?? "未关联关键行动"}`,
      owner: findName(state.people, task.ownerId ?? task.executorId, "未设置"),
      handling: hasOpenRectificationWorkForTask(task.id) ? "已发起改善" : "待确认是否发起改善",
      action: hasOpenRectificationWorkForTask(task.id) ? "查看改善" : "查看异常",
      focus: hasOpenRectificationWorkForTask(task.id) ? "active" : "todayException",
      date: task.updatedAt ?? task.dueDate ?? "",
    });
  });
  getVisibleRectificationRows()
    .filter((row) => matchesRectificationFocus(row, "todayException"))
    .forEach((row) => {
      events.push({
        level: "warning",
        severity: 2,
        label: "今日新增改善",
        title: row.processInstance?.name ?? row.workPlan.title ?? "未命名改善",
        departmentName: findName(state.departments, getRowDepartmentId(row), "未归属部门"),
        description: `来源：${rectificationSourceTypeNames[row.sourceType] ?? row.sourceType}，当前步骤：${row.currentTask?.name ?? row.statusLabel}`,
        owner: findName(state.people, row.ownerId, "未设置"),
        handling: "改善已启动",
        action: "查看改善",
        processInstanceId: row.processInstance?.id ?? "",
        focus: "active",
        date: getRectificationStartAt(row),
      });
    });
  getVisibleRectificationRows()
    .filter((row) => matchesRectificationFocus(row, "todayDone"))
    .forEach((row) => {
      events.push({
        level: "success",
        severity: 1,
        label: "今日验证成功",
        title: row.processInstance?.name ?? row.workPlan.title ?? "未命名改善",
        departmentName: findName(state.departments, getRowDepartmentId(row), "未归属部门"),
        description: `来源关键行动：${row.sourceStandardWork?.name ?? "未关联关键行动"}`,
        owner: findName(state.people, row.ownerId, "未设置"),
        handling: "已完成验证",
        action: "查看改善",
        processInstanceId: row.processInstance?.id ?? "",
        focus: "todayDone",
        date: getRectificationDoneAt(row),
      });
    });
  return events
    .sort((left, right) => {
      if (right.severity !== left.severity) return right.severity - left.severity;
      return String(right.date).localeCompare(String(left.date));
    });
}

function renderEventAction(event) {
  if (event.processInstanceId) {
    return `<button class="text-button" type="button" data-assessment-action="view-rectification" data-process-instance-id="${escapeHtml(event.processInstanceId)}">${escapeHtml(event.action)}</button>`;
  }
  return `<button class="text-button" type="button" data-assessment-action="open-rectification-focus" data-focus="${escapeHtml(event.focus)}">${escapeHtml(event.action)}</button>`;
}

function renderTodayWorkResultStream() {
  const events = getTodayWorkResultEvents();
  const visibleEvents = showAllTodayEvents ? events : events.slice(0, 5);
  const summaryText = getTodayWorkResultSummaryText(events);
  return `
    <section class="settings-section work-result-section-primary">
      <div class="section-heading">
        <h2>今日工作结果</h2>
        <div class="work-result-summary">
          <span>今日工作摘要</span>
          <strong>${escapeHtml(summaryText)}</strong>
        </div>
        <p class="form-note">先看今天真正发生的关键事件，按需要介入的程度排序。</p>
      </div>
      <div class="work-result-event-list">
        ${events.length === 0 ? `<div class="empty-detail">今天暂无需要管理层介入的异常或已形成闭环的改善。</div>` : visibleEvents.map((event) => `
          <article class="work-result-event-card is-${event.level}">
            <div>
              <span>${escapeHtml(event.label)}</span>
              <strong>${escapeHtml(event.title)}</strong>
              <p>${escapeHtml(event.description)}</p>
            </div>
            <dl>
              <div><dt>负责人</dt><dd>${escapeHtml(event.owner)}</dd></div>
              <div><dt>当前处理</dt><dd>${escapeHtml(event.handling)}</dd></div>
            </dl>
            ${renderEventAction(event)}
          </article>
        `).join("")}
        ${events.length > 5 && !showAllTodayEvents ? `
          <button class="secondary-button work-result-more-button" type="button" data-assessment-action="show-all-today-events">查看更多</button>
        ` : ""}
      </div>
    </section>
  `;
}

function getActionOwnerName(instance) {
  const ownerId = selectProcessInstanceOwner(instance.id, state).userId;
  return findName(state.people, ownerId, "未设置");
}

function getTodayStartedActions() {
  return (state.processInstances ?? [])
    .filter((instance) => isTodayValue(instance.createdAt) && isVisibleByAssessmentScope({
      ...instance,
      ownerId: selectProcessInstanceOwner(instance.id, state).userId,
    }))
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

function getTodayCompletedActions() {
  return (state.processInstances ?? [])
    .filter((instance) => instance.status === ProcessInstanceStatus.Done && isTodayValue(instance.completedAt) && isVisibleByAssessmentScope({
      ...instance,
      ownerId: selectProcessInstanceOwner(instance.id, state).userId,
    }))
    .sort((left, right) => String(right.completedAt ?? "").localeCompare(String(left.completedAt ?? "")));
}

function getTodayExceptionItems() {
  const problemItems = (state.weeklyReportProblems ?? [])
    .filter((problem) => isTodayValue(problem.createdAt) && isVisibleByAssessmentScope(problem))
    .map((problem) => ({
      id: `problem-${problem.id}`,
      name: problem.title ?? problem.problemTitle ?? problem.description ?? "未命名问题",
      source: "问题汇总",
      owner: findName(state.people, problem.ownerId ?? problem.responsibleId ?? problem.submitterId, "未设置"),
      status: problem.status ?? "待处理",
      createdAt: problem.createdAt ?? "",
    }));
  const taskItems = (state.tasks ?? [])
    .filter((task) => {
      if (!isTaskVisibleForStatistics(task) || !isVisibleByAssessmentScope(task)) return false;
      const returnedToday = getTaskReturnRecords(task).some((record) => isTodayValue(getTaskRecordDate(record)));
      const rejectedToday = getTaskReviewRejectRecords(task).some((record) => isTodayValue(getTaskRecordDate(record)));
      return returnedToday || rejectedToday || isTodayValue(task.customFields?.assessmentOverdueRecordedAt);
    })
    .map((task) => {
      const returnedToday = getTaskReturnRecords(task).some((record) => isTodayValue(getTaskRecordDate(record)));
      const rejectedToday = getTaskReviewRejectRecords(task).some((record) => isTodayValue(getTaskRecordDate(record)));
      const source = rejectedToday ? "任务验收退回" : returnedToday ? "任务返工" : "任务超时";
      return {
        id: `task-${task.id}`,
        name: task.name,
        source,
        owner: findName(state.people, task.ownerId ?? task.executorId ?? task.assigneeId, "未设置"),
        status: taskStatusNames[task.status] ?? task.status ?? "待处理",
        createdAt: task.updatedAt ?? task.customFields?.assessmentOverdueRecordedAt ?? "",
      };
    });
  return [...problemItems, ...taskItems].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function getTodayCompletedImprovements() {
  return getVisibleRectificationRows()
    .filter((row) => matchesRectificationFocus(row, "todayDone"))
    .sort((left, right) => String(getRectificationDoneAt(right)).localeCompare(String(getRectificationDoneAt(left))));
}

function getTodayOverviewSections() {
  return {
    startedActions: getTodayStartedActions(),
    completedActions: getTodayCompletedActions(),
    exceptions: getTodayExceptionItems(),
    completedImprovements: getTodayCompletedImprovements(),
  };
}

function renderTodayOverviewList(key, rows) {
  const emptyLabels = {
    startedActions: "今天暂无新发起的关键行动",
    completedActions: "今天暂无完成的关键行动",
    exceptions: "今天暂无新增异常",
    completedImprovements: "今天暂无完成的改善项目",
  };
  if (key === "startedActions") {
    return `<div class="table-wrap assessment-today-overview-list"><table class="data-table"><thead><tr><th>行动名称</th><th>负责人</th><th>发起时间</th><th>当前状态</th></tr></thead><tbody>${rows.length ? rows.map((instance) => `<tr><td><strong>${escapeHtml(instance.displayTitle ?? instance.name ?? "未命名关键行动")}</strong></td><td>${escapeHtml(getActionOwnerName(instance))}</td><td>${escapeHtml(formatBusinessDateTime(instance.createdAt, "未记录"))}</td><td>${escapeHtml(processInstanceStatusNames[instance.status] ?? instance.status)}</td></tr>`).join("") : `<tr><td colspan="4">${emptyLabels[key]}</td></tr>`}</tbody></table></div>`;
  }
  if (key === "completedActions") {
    return `<div class="table-wrap assessment-today-overview-list"><table class="data-table"><thead><tr><th>行动名称</th><th>完成人</th><th>完成时间</th><th>结果状态</th></tr></thead><tbody>${rows.length ? rows.map((instance) => `<tr><td><strong>${escapeHtml(instance.displayTitle ?? instance.name ?? "未命名关键行动")}</strong></td><td>${escapeHtml(findName(state.people, instance.completedBy ?? selectProcessInstanceOwner(instance.id, state).userId, "未设置"))}</td><td>${escapeHtml(formatBusinessDateTime(instance.completedAt, "未记录"))}</td><td>${escapeHtml(processInstanceStatusNames[instance.status] ?? "已完成")}</td></tr>`).join("") : `<tr><td colspan="4">${emptyLabels[key]}</td></tr>`}</tbody></table></div>`;
  }
  if (key === "exceptions") {
    return `<div class="table-wrap assessment-today-overview-list"><table class="data-table"><thead><tr><th>异常名称</th><th>来源</th><th>负责人</th><th>当前状态</th></tr></thead><tbody>${rows.length ? rows.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.status)}</td></tr>`).join("") : `<tr><td colspan="4">${emptyLabels[key]}</td></tr>`}</tbody></table></div>`;
  }
  return `<div class="table-wrap assessment-today-overview-list"><table class="data-table"><thead><tr><th>改善项目名称</th><th>负责人</th><th>完成时间</th><th>改善结果</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td><strong>${escapeHtml(row.processInstance?.displayTitle ?? row.processInstance?.name ?? row.workPlan.title ?? "未命名改善")}</strong></td><td>${escapeHtml(findName(state.people, row.ownerId, "未设置"))}</td><td>${escapeHtml(formatBusinessDateTime(getRectificationDoneAt(row), "未记录"))}</td><td>${escapeHtml(getRectificationVerificationResult(row) || "已完成验证")}</td></tr>`).join("") : `<tr><td colspan="4">${emptyLabels[key]}</td></tr>`}</tbody></table></div>`;
}

function renderTodayOverview() {
  const sections = getTodayOverviewSections();
  const items = [
    ["startedActions", "新发起行动数", sections.startedActions.length],
    ["completedActions", "完成行动数", sections.completedActions.length],
    ["exceptions", "新增异常数", sections.exceptions.length],
    ["completedImprovements", "完成改善数", sections.completedImprovements.length],
  ];
  const activeItem = items.find(([key]) => key === activeTodayOverview) ?? items[0];
  return `
    <section class="settings-section assessment-today-overview">
      <div class="section-heading"><div><h2>今日概览</h2><p class="form-note">点击统计卡片查看今天的具体管理事项。</p></div></div>
      <div class="assessment-today-overview-cards" role="tablist" aria-label="今日概览分类">
        ${items.map(([key, label, value]) => `
          <button class="${activeItem[0] === key ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeItem[0] === key ? "true" : "false"}" data-assessment-today-overview="${key}">
            <span>${escapeHtml(label)}</span>
            <strong>${value}</strong>
            <em>查看明细</em>
          </button>
        `).join("")}
      </div>
      ${renderTodayOverviewList(activeItem[0], sections[activeItem[0]])}
    </section>
  `;
}

function renderDashboardMetrics() {
  const { current, previous } = getDashboardSummaries();
  const metrics = [
    ["普通关键行动数", current.normalWorkCount, previous.normalWorkCount],
    ["改善工作数", current.rectificationCount, previous.rectificationCount],
    ["改善率", current.rectificationRate, previous.rectificationRate, formatPercent],
    ["完成任务数", current.completedTaskCount, previous.completedTaskCount],
    ["准时率", current.onTimeRate ?? 0, previous.onTimeRate ?? 0, formatPercent],
    ["超时次数", current.overdueCount, previous.overdueCount],
    ["返工次数", current.returnCount, previous.returnCount],
    ["验收退回次数", current.rejectCount, previous.rejectCount],
    ["改善中", current.rectificationActiveCount, previous.rectificationActiveCount],
    ["已完成改善", current.rectificationDoneCount, previous.rectificationDoneCount],
  ];
  return `<div class="assessment-dashboard-metrics">${metrics.map(([label, value, previousValue, formatter]) => renderDashboardMetricCard(label, value, previousValue, formatter)).join("")}</div>`;
}

function getFocusIssues() {
  const taskIssues = getTodayExceptionTasks().map((task) => {
    const returnCount = getTaskReturnRecords(task).length;
    const rejectCount = getTaskReviewRejectRecords(task).length;
    const standardWork = getTaskStandardWork(task);
    const hasRectification = hasOpenRectificationWorkForTask(task.id);
    const reason = isTaskAssessmentOverdue(task)
      ? "连续超时或已确认超时"
      : rejectCount > 0
        ? "验收退回需要关注"
        : returnCount >= 2
          ? "连续返工需要关注"
          : "任务异常需要确认";
    return {
      severity: isTaskAssessmentOverdue(task) || returnCount >= 2 || rejectCount >= 2 ? 3 : 2,
      department: findName(state.departments, getTaskDepartmentId(task), "未归属部门"),
      standardWork: standardWork?.name ?? "未关联关键行动",
      owner: findName(state.people, task.ownerId ?? task.executorId, "未设置"),
      launched: hasRectification,
      action: hasRectification ? "跟进改善进展" : "判断是否发起改善",
      reason,
    };
  });
  const stuckRectifications = getVisibleRectificationRows()
    .filter((row) => isActiveRectificationRow(row) && !isTodayValue(getRectificationStartAt(row)))
    .slice(0, 5)
    .map((row) => ({
      severity: 2,
      department: findName(state.departments, getRowDepartmentId(row), "未归属部门"),
      standardWork: row.sourceStandardWork?.name ?? "未关联关键行动",
      owner: findName(state.people, row.ownerId, "未设置"),
      launched: true,
      action: "推动当前改善节点",
      reason: `改善停留在：${row.currentTask?.name ?? row.statusLabel}`,
    }));
  return [...taskIssues, ...stuckRectifications]
    .sort((left, right) => right.severity - left.severity)
    .slice(0, 8);
}

function renderFocusIssues() {
  const issues = getFocusIssues();
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>重点问题</h2>
        <p class="form-note">只放今天最需要管理层关注、协调或决策的问题。</p>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>部门</th><th>来源关键行动</th><th>当前负责人</th><th>是否已发起改善</th><th>建议动作</th></tr></thead>
        <tbody>
          ${issues.length === 0 ? `<tr><td colspan="5">今天暂无需要重点介入的问题</td></tr>` : issues.map((issue) => `
            <tr>
              <td>${escapeHtml(issue.department)}</td>
              <td>${escapeHtml(issue.standardWork)}</td>
              <td>${escapeHtml(issue.owner)}</td>
              <td>${issue.launched ? "是" : "否"}</td>
              <td><strong>${escapeHtml(issue.reason)}</strong><br /><span class="form-note">${escapeHtml(issue.action)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function getRectificationVerificationResult(row) {
  const verificationTask = row.tasks.find((task) => task.name === "效果验证") ?? null;
  return verificationTask?.submitFormData?.verificationResult ?? verificationTask?.customFields?.verificationResult ?? "";
}

function getImprovementProgressGroups() {
  const rows = getVisibleRectificationRows();
  return [
    {
      key: "active",
      label: "改善中",
      rows: rows.filter((row) => isActiveRectificationRow(row) && row.currentTask?.name !== "效果验证" && !["部分改善", "无改善"].includes(getRectificationVerificationResult(row))),
    },
    {
      key: "verify",
      label: "待验证",
      rows: rows.filter((row) => isActiveRectificationRow(row) && row.currentTask?.name === "效果验证"),
    },
    {
      key: "success",
      label: "已验证成功",
      rows: rows.filter((row) => row.status === "done" || getRectificationVerificationResult(row) === "已解决"),
    },
    {
      key: "failed",
      label: "验证失败",
      rows: rows.filter((row) => ["部分改善", "无改善"].includes(getRectificationVerificationResult(row))),
    },
  ];
}

function renderImprovementProgress() {
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>改善推进</h2>
        <p class="form-note">围绕“异常 → 改善 → 验证 → 关键行动升级”的闭环查看推进状态。</p>
      </div>
      <div class="work-result-progress-grid">
        ${getImprovementProgressGroups().map((group) => `
          <div class="work-result-progress-column">
            <div class="work-result-progress-title">
              <span>${escapeHtml(group.label)}</span>
              <strong>${group.rows.length}</strong>
            </div>
            ${group.rows.slice(0, 5).map((row) => `
              <button class="work-result-progress-item" type="button" data-assessment-action="view-rectification" data-process-instance-id="${escapeHtml(row.processInstance?.id ?? "")}" ${row.processInstance === null ? "disabled" : ""}>
                <span>${escapeHtml(row.processInstance?.name ?? row.workPlan.title ?? "未命名改善")}</span>
                <em>${escapeHtml(row.currentTask?.name ?? row.statusLabel)}</em>
              </button>
            `).join("") || `<p class="form-note">暂无</p>`}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function getDepartmentTodaySignal(departmentId) {
  const todayExceptions = getTodayExceptionTasks().filter((task) => {
    const taskDepartmentId = getTaskDepartmentId(task);
    if (departmentId === UnassignedDepartmentId) return taskDepartmentId === "";
    return taskDepartmentId === departmentId;
  }).length;
  const activeRectifications = getVisibleRectificationRows().filter((row) => {
    const rowDepartmentId = getRowDepartmentId(row);
    if (departmentId === UnassignedDepartmentId) return rowDepartmentId === "";
    return rowDepartmentId === departmentId;
  }).filter(isActiveRectificationRow).length;
  return { todayExceptions, activeRectifications };
}

function getDepartmentHealth(signal) {
  if (signal.todayExceptions > 0) return { label: "需关注", level: "watch" };
  return { label: "待评估", level: "normal" };
}

function renderDepartmentOverview() {
  const unassignedSummary = getPeriodWorkResultSummary(state, { departmentId: UnassignedDepartmentId, days: dashboardFilters.days });
  const departments = [
    ...getScopedDepartments(),
    ...(unassignedSummary.workPlans.length > 0 || unassignedSummary.tasks.length > 0 ? [{ id: UnassignedDepartmentId, name: "未归属" }] : []),
  ];
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>部门健康度</h2>
        <p class="form-note">第一版先保留部门健康位置，展示今日异常和改善中数量，健康算法后续单独设计。</p>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>部门</th><th>今日异常</th><th>改善中</th><th>健康状态</th></tr></thead>
        <tbody>
          ${departments.length === 0 ? `<tr><td colspan="4">暂无部门</td></tr>` : departments.map((department) => {
            const signal = getDepartmentTodaySignal(department.id);
            const health = getDepartmentHealth(signal);
            return `
              <tr>
                <td>${escapeHtml(department.name)}</td>
                <td>${signal.todayExceptions}</td>
                <td>${signal.activeRectifications}</td>
                <td><span class="assessment-health-pill is-${health.level}">${health.label}</span></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function renderAuxiliaryMetrics() {
  return `
    <section class="settings-section work-result-auxiliary">
      <div class="section-heading">
        <h2>辅助经营指标</h2>
        <p class="form-note">${getDashboardPeriodLabel(dashboardFilters.days)}公司整体工作结果。指标用于辅助分析，不作为首页第一判断。</p>
      </div>
      ${renderDashboardFilters()}
      ${renderDashboardMetrics()}
    </section>
  `;
}

function renderPersonProfileEntry() {
  return `
    <section class="settings-section">
      <div class="section-heading with-actions">
        <div>
          <h2>人员档案</h2>
          <p class="form-note">人员档案作为历史分析入口，用于查看个人工作记录和成长趋势。</p>
        </div>
        <button class="secondary-button" type="button" data-assessment-tab="personProfiles" data-hash="assessment-person-profiles">进入人员档案</button>
      </div>
    </section>
  `;
}

function renderRecentRectifications() {
  const rows = getVisibleRectificationRows()
    .sort((a, b) => {
      const dateA = new Date(getRectificationStartAt(a)).getTime() || 0;
      const dateB = new Date(getRectificationStartAt(b)).getTime() || 0;
      return dateB - dateA;
    })
    .slice(0, 10);
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>最近改善工作</h2>
        <p class="form-note">展示最近发起的改善工作，点击继续复用已发起关键行动详情。</p>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>改善工作名称</th><th>来源任务</th><th>负责人</th><th>当前步骤</th><th>状态</th><th>发起时间</th><th>操作</th></tr></thead>
        <tbody>
          ${rows.length === 0 ? `<tr><td colspan="7">暂无改善工作</td></tr>` : rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.processInstance?.name ?? row.workPlan.title ?? "未命名改善工作")}</td>
              <td>${escapeHtml(row.sourceTask?.name ?? row.workPlan.customFields?.sourceTaskId ?? "-")}</td>
              <td>${findName(state.people, row.ownerId, "-")}</td>
              <td>${escapeHtml(row.currentTask?.name ?? (row.status === "done" ? "已完成" : row.status === "canceled" ? "已取消" : "未开始"))}</td>
              <td><span class="status-pill">${escapeHtml(row.statusLabel)}</span></td>
              <td>${getRectificationStartAt(row) || "-"}</td>
              <td>${row.processInstance === null ? "-" : `<button class="text-button" type="button" data-assessment-action="view-rectification" data-process-instance-id="${escapeHtml(row.processInstance.id)}">查看详情</button>`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function renderStatsFilters() {
  const departments = getScopedDepartments();
  const people = getScopedPeople();
  return `
    <form class="assessment-stats-filters task-filters">
      <label><span>周期</span><select name="period">
        <option value="this_week" ${statsFilters.period === "this_week" ? "selected" : ""}>本周</option>
        <option value="last_week" ${statsFilters.period === "last_week" ? "selected" : ""}>上周</option>
        <option value="this_month" ${statsFilters.period === "this_month" ? "selected" : ""}>本月</option>
        <option value="custom" ${statsFilters.period === "custom" ? "selected" : ""}>自定义</option>
      </select></label>
      <label><span>开始日期</span><input name="startDate" type="date" value="${escapeHtml(statsFilters.startDate)}" ${statsFilters.period === "custom" ? "" : "disabled"} /></label>
      <label><span>结束日期</span><input name="endDate" type="date" value="${escapeHtml(statsFilters.endDate)}" ${statsFilters.period === "custom" ? "" : "disabled"} /></label>
      <label><span>部门</span><select name="departmentId">${renderOptions(departments, statsFilters.departmentId, "全部部门")}</select></label>
      <label><span>人员</span><select name="personId">${renderOptions(people, statsFilters.personId, "全部人员")}</select></label>
      <label><span>目标</span><select name="goalId">${renderOptions(state.goals, statsFilters.goalId, "全部目标")}</select></label>
    </form>
  `;
}

function renderMetricCards(tasks, processes) {
  const reports = state.weeklyReports.filter((report) => dateInRange(report.weekStart, getStatsRange()) && isVisibleByAssessmentScope(report));
  const departments = getScopedDepartments();
  const submittedDepartmentIds = new Set(reports.filter((report) => report.status === "submitted").map((report) => report.departmentId));
  const unresolvedProblems = getFilteredProblems().filter((problem) => !["resolved", "closed"].includes(problem.status)).length;
  const metrics = [
    ["本周期任务总数", tasks.length],
    ["已完成任务数", tasks.filter((task) => isDoneStatus(task.status)).length],
    ["进行中任务数", tasks.filter((task) => !isDoneStatus(task.status) && !isCanceledStatus(task.status)).length],
    ["逾期任务数", tasks.filter(isTaskAssessmentOverdue).length],
    ["已取消任务数", tasks.filter((task) => isCanceledStatus(task.status)).length],
    ["已提交周报部门数", submittedDepartmentIds.size],
    ["未提交周报部门数", Math.max(departments.length - submittedDepartmentIds.size, 0)],
    ["未解决问题数", unresolvedProblems],
  ];
  return `<div class="assessment-metrics">${metrics.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
}

function renderPersonStatsTable(tasks, processes) {
  const people = getScopedPeople().filter((person) => statsFilters.personId === "" || person.id === statsFilters.personId);
  return `
    <section class="settings-section">
      <div class="section-heading"><h2>个人工作统计</h2></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>员工</th><th>部门</th><th>本周期任务数</th><th>已完成</th><th>进行中</th><th>待审核</th><th>逾期</th><th>已取消</th><th>提交结果数</th><th>参与关键行动数</th><th>操作</th></tr></thead>
        <tbody>
          ${people.length === 0 ? `<tr><td colspan="11">暂无人员</td></tr>` : people.map((person) => {
            const personTasks = tasks.filter((task) => task.ownerId === person.id);
            const processIds = new Set(personTasks.map((task) => task.processInstanceId).filter(Boolean));
            return `
              <tr>
                <td>${escapeHtml(person.name)}</td>
                <td>${findName(state.departments, person.departmentId)}</td>
                <td>${personTasks.length}</td>
                <td>${personTasks.filter((task) => isDoneStatus(task.status)).length}</td>
                <td>${personTasks.filter((task) => !isDoneStatus(task.status) && !isCanceledStatus(task.status)).length}</td>
                <td>${personTasks.filter((task) => task.status === TaskStatus.PendingAcceptance).length}</td>
                <td>${personTasks.filter(isTaskAssessmentOverdue).length}</td>
                <td>${personTasks.filter((task) => isCanceledStatus(task.status)).length}</td>
                <td>${personTasks.filter(hasSubmittedResult).length}</td>
                <td>${processes.filter((instance) => processIds.has(instance.id)).length}</td>
                <td><button class="text-button" type="button" data-assessment-action="view-person-detail" data-person-id="${person.id}">查看明细</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function renderDepartmentStatsTable(tasks, processes) {
  const departments = getScopedDepartments().filter((department) => statsFilters.departmentId === "" || department.id === statsFilters.departmentId);
  const weekStart = getWeekRange().weekStart;
  return `
    <section class="settings-section">
      <div class="section-heading"><h2>部门工作统计</h2></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>部门</th><th>负责人</th><th>本周期任务数</th><th>已完成任务</th><th>逾期任务</th><th>进行中关键行动</th><th>已完成关键行动</th><th>已取消关键行动</th><th>周报状态</th><th>未解决问题数</th><th>操作</th></tr></thead>
        <tbody>
          ${departments.length === 0 ? `<tr><td colspan="11">暂无部门</td></tr>` : departments.map((department) => {
            const departmentTasks = tasks.filter((task) => task.departmentId === department.id);
            const departmentProcesses = processes.filter((instance) => instance.departmentId === department.id || departmentTasks.some((task) => task.processInstanceId === instance.id));
            const report = state.weeklyReports.find((item) => item.departmentId === department.id && item.weekStart === weekStart);
            const unresolved = state.weeklyReportProblems.filter((problem) => problem.departmentId === department.id && !["resolved", "closed"].includes(problem.status)).length;
            return `
              <tr>
                <td>${escapeHtml(department.name)}</td>
                <td>${findName(state.people, department.leaderId)}</td>
                <td>${departmentTasks.length}</td>
                <td>${departmentTasks.filter((task) => isDoneStatus(task.status)).length}</td>
                <td>${departmentTasks.filter(isTaskAssessmentOverdue).length}</td>
                <td>${departmentProcesses.filter((item) => item.status === ProcessInstanceStatus.Running).length}</td>
                <td>${departmentProcesses.filter((item) => isDoneStatus(item.status)).length}</td>
                <td>${departmentProcesses.filter((item) => isCanceledStatus(item.status)).length}</td>
                <td>${report === undefined ? "未提交" : weeklyReportStatusNames[report.status]}</td>
                <td>${unresolved}</td>
                <td><button class="text-button" type="button" data-assessment-action="open-report" data-department-id="${department.id}">查看周报</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function renderStatsPage() {
  return `
    ${renderTodayWorkResultStream()}
    ${renderTodayOverview()}
    ${renderFocusIssues()}
    ${renderImprovementProgress()}
    ${renderDepartmentOverview()}
    ${renderAuxiliaryMetrics()}
    ${renderPersonProfileEntry()}
  `;
}

function renderReportFilters() {
  const week = getWeekRange(getReportWeekStart());
  return `
    <form class="assessment-report-filters task-filters">
      <label><span>周报周期</span><input name="weekStart" type="date" value="${escapeHtml(week.weekStart)}" /></label>
      <label><span>部门</span><select name="departmentId">${renderOptions(getScopedDepartments(), reportFilters.departmentId, "全部部门")}</select></label>
      <label><span>提交状态</span><select name="status"><option value="">全部状态</option><option value="draft" ${reportFilters.status === "draft" ? "selected" : ""}>草稿</option><option value="submitted" ${reportFilters.status === "submitted" ? "selected" : ""}>已提交</option></select></label>
      <label><span>提交人</span><select name="submitterId">${renderOptions(getScopedPeople(), reportFilters.submitterId, "全部提交人")}</select></label>
    </form>
  `;
}

function getGoalNames(goalIds = []) {
  return goalIds.map((goalId) => findName(state.goals, goalId, "")).filter(Boolean).join("、") || "未关联目标";
}

function renderReportsPage() {
  const reports = getFilteredReports();
  return `
    ${renderReportFilters()}
    <section class="settings-section">
      <div class="section-heading with-actions">
        <div>
          <h2>目标推进周报</h2>
          <p class="form-note">周报不是为了写总结，也不是为了报工作量。它帮助部门负责人每周保持对目标、问题和效率的清晰感知。</p>
        </div>
        ${canCurrentUser("workResults.submit") ? `<button class="primary-button" type="button" data-assessment-action="fill-report">填写周报</button>` : ""}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>周期</th><th>部门</th><th>提交人</th><th>提交状态</th><th>提交时间</th><th>关联目标</th><th>操作</th></tr></thead>
        <tbody>
          ${reports.length === 0 ? `<tr><td colspan="7">暂无目标推进周报</td></tr>` : reports.map((report) => `
            <tr>
              <td>${escapeHtml(report.weekLabel)}</td>
              <td>${findName(state.departments, report.departmentId)}</td>
              <td>${findName(state.people, report.submitterId)}</td>
              <td><span class="status-pill">${weeklyReportStatusNames[report.status] ?? report.status}</span></td>
              <td>${report.submittedAt ?? "未提交"}</td>
              <td>${escapeHtml(getGoalNames(report.relatedGoalIds))}</td>
              <td><span class="row-actions">
                <button class="text-button" type="button" data-assessment-action="view-report" data-report-id="${report.id}">查看</button>
                ${canCurrentUser("workResults.manage") ? `<button class="text-button" type="button" data-assessment-action="edit-report" data-report-id="${report.id}">编辑</button>` : ""}
                ${canCurrentUser("workResults.manage") ? `<button class="text-button" type="button" data-assessment-action="add-problem-from-report" data-report-id="${report.id}">添加到问题汇总</button>` : ""}
              </span></td>
            </tr>
          `).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function renderProblemsPage() {
  const problems = getFilteredProblems();
  return `
    <form class="assessment-problem-filters task-filters">
      <label><span>状态</span><select name="status"><option value="">全部状态</option>${Object.entries(problemStatusNames).map(([value, label]) => `<option value="${value}" ${problemFilters.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label><span>部门</span><select name="departmentId">${renderOptions(getScopedDepartments(), problemFilters.departmentId, "全部部门")}</select></label>
      <label><span>问题类型</span><select name="problemType"><option value="">全部类型</option>${problemTypeOptions.map((option) => `<option value="${option}" ${problemFilters.problemType === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>
    </form>
    <section class="settings-section">
      <div class="section-heading with-actions">
        <h2>问题汇总</h2>
        ${canCurrentUser("workResults.manage") ? `<button class="primary-button" type="button" data-assessment-action="add-problem">新增问题</button>` : ""}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>问题标题</th><th>来源部门</th><th>提交人</th><th>关联目标</th><th>问题类型</th><th>影响程度</th><th>当前状态</th><th>需要支持</th><th>下一步动作</th><th>期望解决日期</th><th>操作</th></tr></thead>
        <tbody>
          ${problems.length === 0 ? `<tr><td colspan="11">暂无问题记录</td></tr>` : problems.map((problem) => `
            <tr>
              <td>${escapeHtml(problem.title)}</td>
              <td>${findName(state.departments, problem.departmentId)}</td>
              <td>${findName(state.people, problem.submitterId)}</td>
              <td>${findName(state.goals, problem.relatedGoalId, "未关联目标")}</td>
              <td>${escapeHtml(problem.problemType ?? "其他")}</td>
              <td>${escapeHtml(problem.impactLevel ?? "一般")}</td>
              <td><span class="status-pill">${problemStatusNames[problem.status] ?? problem.status}</span></td>
              <td>${problem.needSupport ? "是" : "否"}</td>
              <td>${escapeHtml(problem.nextAction ?? "未填写")}</td>
              <td>${problem.expectedResolveDate ?? "未设置"}</td>
              <td><span class="row-actions">
                <button class="text-button" type="button" data-assessment-action="view-problem" data-problem-id="${problem.id}">查看</button>
                ${canCurrentUser("workResults.manage") ? `<button class="text-button" type="button" data-assessment-action="edit-problem" data-problem-id="${problem.id}">更新状态</button>` : ""}
              </span></td>
            </tr>
          `).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function renderRectificationFilters() {
  const rows = getRectificationRows();
  const statusOptions = [...new Set(rows.map((row) => row.status))].filter(Boolean);
  const sourceTypeOptions = [...new Set(rows.map((row) => row.sourceType))].filter(Boolean);
  return `
    <form class="assessment-rectification-filters task-filters">
      <label><span>状态</span><select name="status">${renderValueOptions(statusOptions, rectificationFilters.status, Object.fromEntries(rows.map((row) => [row.status, row.statusLabel])), "全部状态")}</select></label>
      <label><span>负责人</span><select name="ownerId">${renderOptions(getScopedPeople(), rectificationFilters.ownerId, "全部负责人")}</select></label>
      <label><span>执行人</span><select name="executorId">${renderOptions(getScopedPeople(), rectificationFilters.executorId, "全部执行人")}</select></label>
      <label><span>来源类型</span><select name="sourceType">${renderValueOptions(sourceTypeOptions, rectificationFilters.sourceType, rectificationSourceTypeNames, "全部来源")}</select></label>
    </form>
  `;
}

function renderRectificationPage() {
  const rows = getFilteredRectificationRows();
  const focusLabel = rectificationFilters.focus === "" ? "" : rectificationFocusNames[rectificationFilters.focus] ?? "";
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>改善工作</h2>
        <p class="form-note">只展示由工作结果或异常来源发起的改善工作，详情继续复用已发起关键行动详情。</p>
      </div>
      ${renderRectificationFilters()}
      ${focusLabel === "" ? "" : `<div class="inline-alert">当前来自今日重点筛选：${escapeHtml(focusLabel)}。调整上方筛选后会自动退出该快捷筛选。</div>`}
      <div class="table-wrap"><table class="data-table">
        <thead>
          <tr>
            <th>改善工作名称</th>
            <th>来源任务</th>
            <th>来源关键行动</th>
            <th>来源类型</th>
            <th>执行人</th>
            <th>负责人</th>
            <th>当前标准步骤</th>
            <th>改善状态</th>
            <th>截止时间</th>
            <th>发起时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? `<tr><td colspan="11">暂无改善工作</td></tr>` : rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.processInstance?.name ?? row.workPlan.title ?? "未命名改善工作")}</td>
              <td>${escapeHtml(row.sourceTask?.name ?? row.workPlan.customFields?.sourceTaskId ?? "-")}</td>
              <td>${escapeHtml(row.sourceStandardWork?.name ?? row.workPlan.customFields?.sourceStandardWorkId ?? "-")}</td>
              <td>${escapeHtml(rectificationSourceTypeNames[row.sourceType] ?? row.sourceType)}</td>
              <td>${findName(state.people, row.executorId, "-")}</td>
              <td>${findName(state.people, row.ownerId, "-")}</td>
              <td>${escapeHtml(row.currentTask?.name ?? (row.status === "done" ? "已完成" : row.status === "canceled" ? "已取消" : "未开始"))}</td>
              <td><span class="status-pill">${escapeHtml(row.statusLabel)}</span></td>
              <td>${formatBusinessDateTime(row.processInstance?.dueDate ?? row.workPlan.dueDate)}</td>
              <td>${row.processInstance?.startedAt ?? row.workPlan.launchedAt ?? row.workPlan.createdAt ?? "-"}</td>
              <td>${row.processInstance === null ? "-" : `<button class="text-button" type="button" data-assessment-action="view-rectification" data-process-instance-id="${escapeHtml(row.processInstance.id)}">查看详情</button>`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table></div>
    </section>
  `;
}

function renderPersonProfileMetric(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderPersonProfileCard(person) {
  const profile = getPersonProfile(person);
  const departmentName = findName(state.departments, person.departmentId);
  const positionName = findName(state.positions, person.positionId, "未设置岗位");
  const rectificationRunning = profile.rectificationActiveCount;
  const rectificationDone = profile.rectificationDoneCount;
  return `
    <article class="person-profile-card">
      <header class="person-profile-header">
        <div>
          <h3>${escapeHtml(person.name)}</h3>
          <p>${escapeHtml(departmentName)} · ${escapeHtml(positionName)}</p>
        </div>
      </header>
      <section class="person-profile-block">
        <h4>工作结果</h4>
        <div class="person-profile-metrics">
          ${renderPersonProfileMetric("普通关键行动数量", profile.normalWorks.length)}
          ${renderPersonProfileMetric("改善工作数量", profile.rectificationWorks.length)}
          ${renderPersonProfileMetric("完成任务数", profile.completedTasks.length)}
          ${renderPersonProfileMetric("准时率", formatPercent(profile.onTimeRate))}
          ${renderPersonProfileMetric("超时次数", profile.overdueCount)}
          ${renderPersonProfileMetric("返工次数", profile.returnCount)}
          ${renderPersonProfileMetric("验收退回次数", profile.rejectCount)}
        </div>
      </section>
      <section class="person-profile-block">
        <h4>改善情况</h4>
        <div class="person-profile-metrics compact">
          ${renderPersonProfileMetric("发起改善次数", profile.rectificationRows.length)}
          ${renderPersonProfileMetric("已完成改善", rectificationDone)}
          ${renderPersonProfileMetric("改善中", rectificationRunning)}
        </div>
        <div class="person-profile-list">
          ${profile.recentRectifications.length === 0 ? `<p class="form-note">暂无最近改善记录</p>` : profile.recentRectifications.map((row) => `
            <div class="person-profile-list-item">
              <span>${escapeHtml(row.processInstance?.name ?? row.workPlan.title ?? "未命名改善工作")}</span>
              <em>${escapeHtml(row.statusLabel)}</em>
              ${row.processInstance === null ? "" : `<button class="text-button" type="button" data-assessment-action="view-person-profile-process" data-process-instance-id="${escapeHtml(row.processInstance.id)}">查看</button>`}
            </div>
          `).join("")}
        </div>
      </section>
      <section class="person-profile-block">
        <h4>成长趋势</h4>
        <div class="person-profile-trends">
          <div>
            <strong>近30天</strong>
            ${renderTrendValue("准时率", profile.trends.current30.onTimeRate, profile.trends.previous30.onTimeRate, formatPercent)}
            ${renderTrendValue("改善率", profile.trends.current30.rectificationRate, profile.trends.previous30.rectificationRate, formatPercent)}
            ${renderTrendValue("完成任务", profile.trends.current30.completedTaskCount, profile.trends.previous30.completedTaskCount, (value) => String(Math.round(value)))}
          </div>
          <div>
            <strong>近90天</strong>
            ${renderTrendValue("准时率", profile.trends.current90.onTimeRate, profile.trends.previous90.onTimeRate, formatPercent)}
            ${renderTrendValue("改善率", profile.trends.current90.rectificationRate, profile.trends.previous90.rectificationRate, formatPercent)}
            ${renderTrendValue("完成任务", profile.trends.current90.completedTaskCount, profile.trends.previous90.completedTaskCount, (value) => String(Math.round(value)))}
          </div>
        </div>
      </section>
      <section class="person-profile-block">
        <h4>工作记录</h4>
        <div class="table-wrap compact-table"><table class="data-table">
          <thead><tr><th>类型</th><th>工作</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            ${profile.records.length === 0 ? `<tr><td colspan="5">暂无工作记录</td></tr>` : profile.records.map((workPlan) => {
              const processInstance = getStatsProcessInstanceByWorkPlan(state, workPlan);
              return `
                <tr>
                  <td>${workPlan.workType === WorkType.Rectification ? "改善工作" : "普通关键行动"}</td>
                  <td>${escapeHtml(processInstance?.name ?? workPlan.title ?? "未命名工作")}</td>
                  <td>${escapeHtml(getStatsWorkPlanStatusLabel(workPlan, processInstance))}</td>
                  <td>${escapeHtml(formatBusinessDateTime(getStatsWorkPlanRecordDate(workPlan)))}</td>
                  <td>${processInstance === null ? "-" : `<button class="text-button" type="button" data-assessment-action="view-person-profile-process" data-process-instance-id="${escapeHtml(processInstance.id)}">查看详情</button>`}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table></div>
      </section>
    </article>
  `;
}

function renderPersonProfilesPage() {
  const people = getScopedPeople();
  return `
    <section class="settings-section">
      <div class="section-heading">
        <h2>人员档案</h2>
        <p class="form-note">人员档案从现有关键行动和任务中汇总，用于观察工作结果和成长趋势，不做评分、排名或奖惩。</p>
      </div>
      <div class="person-profile-grid">
        ${people.length === 0 ? `<div class="empty-detail">暂无可查看人员</div>` : people.map(renderPersonProfileCard).join("")}
      </div>
    </section>
  `;
}

function getReport(reportId) {
  return state.weeklyReports.find((report) => report.id === reportId) ?? null;
}

function getProblem(problemId) {
  return state.weeklyReportProblems.find((problem) => problem.id === problemId) ?? null;
}

function getDefaultReportDraft(departmentId = "") {
  const user = getCurrentUser();
  const week = getWeekRange(reportFilters.weekStart);
  const selectedDepartmentId = departmentId || (canCurrentUser("workResults.viewAll") ? reportFilters.departmentId : user?.departmentId) || "";
  const existing = state.weeklyReports.find((report) => report.weekStart === week.weekStart && report.departmentId === selectedDepartmentId);
  if (existing !== undefined) return existing;
  return {
    id: "",
    ...week,
    departmentId: selectedDepartmentId,
    submitterId: user?.id ?? "",
    relatedGoalIds: [],
    goalAlignedWork: "",
    workEffectReview: "",
    efficiencyReview: "",
    status: "draft",
    submittedAt: null,
  };
}

function renderReportModal() {
  if (modalState?.kind !== "report") return "";
  const report = modalState.mode === "add" ? getDefaultReportDraft(modalState.departmentId ?? "") : getReport(modalState.reportId);
  const readonly = modalState.readonly;
  if (report === null) return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="目标推进周报">
        <div class="modal-header">
          <h2>${readonly ? "查看周报" : "填写周报"}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-assessment-action="close-modal">取消</button>
            ${readonly ? "" : `<button class="secondary-button" type="button" data-action="submit-modal-form" data-submit-intent="draft">保存草稿</button><button class="primary-button" type="button" data-action="submit-modal-form" data-submit-intent="submitted">提交周报</button>`}
            <button class="icon-button" type="button" data-assessment-action="close-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form assessment-report-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error ?? "")}</div>
          <div class="form-note">周报不是工作流水账，也不是为了统计做了多少事。少写空话，多写事实；少写流水账，多写目标推进；少写表面完成，多写问题和解决动作。</div>
          <div class="form-grid">
            <label><span>周报周期</span><input name="weekStart" type="date" value="${escapeHtml(report.weekStart)}" ${readonly ? "disabled" : ""} /></label>
            <label><span>部门</span><select name="departmentId" ${readonly || !canCurrentUser("workResults.viewAll") ? "disabled" : ""}>${renderOptions(getScopedDepartments(), report.departmentId, "请选择部门")}</select></label>
            <label><span>关联目标</span><select name="relatedGoalIds" multiple size="5" ${readonly ? "disabled" : ""}>${state.goals.map((goal) => `<option value="${goal.id}" ${(report.relatedGoalIds ?? []).includes(goal.id) ? "selected" : ""}>${escapeHtml(goal.name)}</option>`).join("")}</select></label>
          </div>
          ${Object.entries(weeklyReportQuestionLabels).map(([key, label]) => `
            <label>
              <span>${label}</span>
              <textarea name="${key}" rows="5" placeholder="${escapeHtml(weeklyReportPlaceholders[key])}" ${readonly ? "disabled" : ""}>${escapeHtml(report[key] ?? "")}</textarea>
            </label>
          `).join("")}
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-assessment-action="close-modal">取消</button>
            ${readonly ? "" : `<button class="secondary-button" type="submit" data-submit-intent="draft">保存草稿</button><button class="primary-button" type="submit" data-submit-intent="submitted">提交周报</button>`}
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderProblemModal() {
  if (modalState?.kind !== "problem") return "";
  const problem = modalState.mode === "add" ? {
    id: "",
    weeklyReportId: modalState.reportId ?? "",
    departmentId: modalState.departmentId ?? getCurrentUser()?.departmentId ?? "",
    submitterId: getCurrentUser()?.id ?? "",
    relatedGoalId: modalState.relatedGoalId ?? "",
    sourceQuestion: modalState.sourceQuestion ?? "efficiencyReview",
    title: "",
    description: modalState.description ?? "",
    problemType: "效率问题",
    impactLevel: "一般",
    status: "unresolved",
    needSupport: false,
    supportNeeded: "",
    nextAction: "",
    expectedResolveDate: "",
  } : getProblem(modalState.problemId);
  const readonly = modalState.readonly;
  if (problem === null) return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="问题记录">
        <div class="modal-header">
          <h2>${readonly ? "查看问题" : "维护问题"}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-assessment-action="close-modal">取消</button>
            ${readonly ? "" : `<button class="primary-button" type="button" data-action="submit-modal-form">保存问题</button>`}
            <button class="icon-button" type="button" data-assessment-action="close-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form assessment-problem-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error ?? "")}</div>
          <div class="form-grid">
            <label><span>问题标题</span><input name="title" value="${escapeHtml(problem.title)}" ${readonly ? "disabled" : ""} /></label>
            <label><span>来源部门</span><select name="departmentId" ${readonly ? "disabled" : ""}>${renderOptions(getScopedDepartments(), problem.departmentId, "请选择部门")}</select></label>
            <label><span>关联目标</span><select name="relatedGoalId" ${readonly ? "disabled" : ""}>${renderOptions(state.goals, problem.relatedGoalId, "未关联目标")}</select></label>
            <label><span>问题类型</span><select name="problemType" ${readonly ? "disabled" : ""}>${problemTypeOptions.map((option) => `<option value="${option}" ${problem.problemType === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>
            <label><span>影响程度</span><select name="impactLevel" ${readonly ? "disabled" : ""}>${impactLevelOptions.map((option) => `<option value="${option}" ${problem.impactLevel === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>
            <label><span>状态</span><select name="status" ${readonly ? "disabled" : ""}>${Object.entries(problemStatusNames).map(([value, label]) => `<option value="${value}" ${problem.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
            <label><span>期望解决日期</span><input name="expectedResolveDate" type="date" value="${escapeHtml(problem.expectedResolveDate ?? "")}" ${readonly ? "disabled" : ""} /></label>
            <label class="checkbox-field"><input name="needSupport" type="checkbox" ${problem.needSupport ? "checked" : ""} ${readonly ? "disabled" : ""} /><span>需要支持</span></label>
          </div>
          <label><span>问题描述</span><textarea name="description" rows="4" ${readonly ? "disabled" : ""}>${escapeHtml(problem.description ?? "")}</textarea></label>
          <label><span>需要什么支持</span><textarea name="supportNeeded" rows="3" ${readonly ? "disabled" : ""}>${escapeHtml(problem.supportNeeded ?? "")}</textarea></label>
          <label><span>下一步动作</span><textarea name="nextAction" rows="3" ${readonly ? "disabled" : ""}>${escapeHtml(problem.nextAction ?? "")}</textarea></label>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-assessment-action="close-modal">取消</button>
            ${readonly ? "" : `<button class="primary-button" type="submit">保存问题</button>`}
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderPersonDetailModal() {
  if (modalState?.kind !== "personDetail") return "";
  const person = state.people.find((item) => item.id === modalState.personId);
  const range = getStatsRange();
  const tasks = getFilteredStatsTasks().filter((task) => task.ownerId === modalState.personId);
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="个人工作明细">
        <div class="modal-header">
          <h2>${escapeHtml(person?.name ?? "员工")} 工作明细</h2>
          <button class="icon-button" type="button" data-assessment-action="close-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-form">
          <p class="form-note">${range.startDate} 至 ${range.endDate}</p>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>任务名</th><th>所属关键行动</th><th>对齐目标</th><th>负责部门</th><th>状态</th><th>截止时间</th><th>完成时间</th><th>是否逾期</th><th>提交结果</th><th>操作</th></tr></thead>
            <tbody>${tasks.length === 0 ? `<tr><td colspan="10">暂无任务明细</td></tr>` : tasks.map((task) => {
              const process = state.processInstances.find((item) => item.id === task.processInstanceId);
              const canLaunchRectification = isTaskAssessmentOverdue(task);
              const hasRectification = hasOpenRectificationWorkForTask(task.id);
              return `<tr><td>${escapeHtml(task.name)}</td><td>${escapeHtml(process?.name ?? "无")}</td><td>${findName(state.goals, task.goalId, "未对齐目标")}</td><td>${findName(state.departments, task.departmentId)}</td><td>${taskStatusNames[task.status] ?? task.status}</td><td>${formatBusinessDateTime(task.dueDate)}</td><td>${task.completedAt ?? "未完成"}</td><td>${canLaunchRectification ? "已逾期" : "否"}</td><td>${hasSubmittedResult(task) ? "是" : "否"}</td><td>${canLaunchRectification ? `<button class="text-button" type="button" data-assessment-action="launch-rectification" data-task-id="${task.id}" ${hasRectification ? "disabled" : ""}>${hasRectification ? "已发起改善" : "发起改善工作"}</button>` : "-"}</td></tr>`;
            }).join("")}</tbody>
          </table></div>
        </div>
      </div>
    </div>
  `;
}

function renderRectificationDetailModal() {
  if (modalState?.kind !== "rectificationDetail") return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="改善工作详情">
        <div class="modal-header">
          <h2>改善工作详情</h2>
          <button class="icon-button" type="button" data-assessment-action="close-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-form">
          ${renderLaunchedProcessDetail(modalState.processInstanceId, {
            emptyHtml: `<div class="empty-detail">未找到该改善工作详情。</div>`,
          })}
        </div>
      </div>
    </div>
  `;
}

function renderPersonProfileProcessModal() {
  if (modalState?.kind !== "personProfileProcessDetail") return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="工作详情">
        <div class="modal-header">
          <h2>工作详情</h2>
          <button class="icon-button" type="button" data-assessment-action="close-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-form">
          ${renderLaunchedProcessDetail(modalState.processInstanceId, {
            emptyHtml: `<div class="empty-detail">未找到该工作详情。</div>`,
          })}
        </div>
      </div>
    </div>
  `;
}

function renderModals() {
  return `${renderReportModal()}${renderProblemModal()}${renderPersonDetailModal()}${renderRectificationDetailModal()}${renderPersonProfileProcessModal()}`;
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

async function saveReport(form, status, rerender) {
  const week = getWeekRange(getFormValue(form, "weekStart"));
  const reportId = modalState.mode === "edit" ? modalState.reportId : "";
  const existing = reportId ? getReport(reportId) : null;
  const departmentId = getFormValue(form, "departmentId") || getCurrentUser()?.departmentId || "";
  const draft = {
    id: existing?.id || createId("weekly-report"),
    ...week,
    departmentId,
    submitterId: existing?.submitterId || getCurrentUser()?.id || "",
    relatedGoalIds: new FormData(form).getAll("relatedGoalIds").map(String),
    goalAlignedWork: getFormValue(form, "goalAlignedWork"),
    workEffectReview: getFormValue(form, "workEffectReview"),
    efficiencyReview: getFormValue(form, "efficiencyReview"),
    status,
    submittedAt: status === "submitted" ? getNow() : existing?.submittedAt ?? null,
    createdAt: existing?.createdAt ?? getNow(),
    updatedAt: getNow(),
  };
  if (draft.departmentId === "") return setModalError("请选择部门。", rerender);
  if (status === "submitted" && [draft.goalAlignedWork, draft.workEffectReview, draft.efficiencyReview].some((value) => value === "")) {
    return setModalError("提交周报前必须填写三个核心问题。", rerender);
  }
  try {
    if (existing === null) {
      await createPersistentResource("weekly-reports", draft);
      state.weeklyReports = [draft, ...state.weeklyReports];
    } else {
      await updatePersistentResource("weekly-reports", existing.id, draft);
      state.weeklyReports = state.weeklyReports.map((item) => (item.id === existing.id ? draft : item));
    }
    modalState = null;
  } catch (error) {
    console.error("周报保存失败", error);
    return setModalError(error.message || "周报保存失败，请检查本地数据库服务。", rerender);
  }
  rerender();
}

async function saveProblem(form, rerender) {
  const existing = modalState.mode === "edit" ? getProblem(modalState.problemId) : null;
  const status = getFormValue(form, "status") || "unresolved";
  const draft = {
    id: existing?.id || createId("weekly-report-problem"),
    weeklyReportId: existing?.weeklyReportId ?? modalState.reportId ?? "",
    departmentId: getFormValue(form, "departmentId") || getCurrentUser()?.departmentId || "",
    submitterId: existing?.submitterId || getCurrentUser()?.id || "",
    relatedGoalId: getFormValue(form, "relatedGoalId") || null,
    sourceQuestion: existing?.sourceQuestion ?? modalState.sourceQuestion ?? "efficiencyReview",
    title: getFormValue(form, "title"),
    description: getFormValue(form, "description"),
    problemType: getFormValue(form, "problemType") || "其他",
    impactLevel: getFormValue(form, "impactLevel") || "一般",
    status,
    needSupport: new FormData(form).has("needSupport"),
    supportNeeded: getFormValue(form, "supportNeeded"),
    nextAction: getFormValue(form, "nextAction"),
    expectedResolveDate: getFormValue(form, "expectedResolveDate") || null,
    resolvedAt: status === "resolved" ? existing?.resolvedAt ?? getNow() : null,
    createdAt: existing?.createdAt ?? getNow(),
    updatedAt: getNow(),
  };
  if (draft.title === "") return setModalError("请填写问题标题。", rerender);
  try {
    if (existing === null) {
      await createPersistentResource("weekly-report-problems", draft);
      state.weeklyReportProblems = [draft, ...state.weeklyReportProblems];
    } else {
      await updatePersistentResource("weekly-report-problems", existing.id, draft);
      state.weeklyReportProblems = state.weeklyReportProblems.map((item) => (item.id === existing.id ? draft : item));
    }
    modalState = null;
  } catch (error) {
    console.error("问题保存失败", error);
    return setModalError(error.message || "问题保存失败，请检查本地数据库服务。", rerender);
  }
  rerender();
}

async function launchRectificationWorkFromTask(taskId, rerender) {
  const sourceTask = state.tasks.find((task) => task.id === taskId) ?? null;
  if (sourceTask === null) return window.alert("未找到来源任务。");
  if (!isTaskAssessmentOverdue(sourceTask)) return window.alert("只有异常或逾期任务可以发起改善工作。");
  if (hasOpenRectificationWorkForTask(sourceTask.id)) return window.alert("该任务已经存在未完成的改善工作，不能重复发起。");

  try {
    await launchRectificationWorkForSource({
      sourceTaskId: sourceTask.id,
      sourceProcessInstanceId: sourceTask.processInstanceId ?? null,
      sourceType: "overdue_task",
      problemSummary: `任务“${sourceTask.name}”已逾期，需要发起改善。`,
    });
    window.alert("改善工作已发起。");
  } catch (error) {
    console.error("发起改善工作失败", error);
    window.alert(error.message || "发起改善工作失败，请检查本地数据库服务。");
  }
  rerender();
}

function setModalError(error, rerender) {
  modalState = { ...modalState, error };
  const errorElement = document.querySelector(".modal-form .form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
    return;
  }
  rerender();
}

function updateStatsFilters(form) {
  const formData = new FormData(form);
  statsFilters = {
    period: formData.get("period")?.toString() ?? "this_week",
    startDate: formData.get("startDate")?.toString() ?? "",
    endDate: formData.get("endDate")?.toString() ?? "",
    departmentId: formData.get("departmentId")?.toString() ?? "",
    personId: formData.get("personId")?.toString() ?? "",
    goalId: formData.get("goalId")?.toString() ?? "",
  };
}

function updateReportFilters(form) {
  const formData = new FormData(form);
  reportFilters = {
    weekStart: getWeekRange(formData.get("weekStart")?.toString() ?? "").weekStart,
    departmentId: formData.get("departmentId")?.toString() ?? "",
    status: formData.get("status")?.toString() ?? "",
    submitterId: formData.get("submitterId")?.toString() ?? "",
  };
}

function updateProblemFilters(form) {
  const formData = new FormData(form);
  problemFilters = {
    status: formData.get("status")?.toString() ?? "",
    departmentId: formData.get("departmentId")?.toString() ?? "",
    problemType: formData.get("problemType")?.toString() ?? "",
  };
}

function updateDashboardFilters(form) {
  const formData = new FormData(form);
  const days = Number(formData.get("days")?.toString() ?? "30");
  dashboardFilters = {
    days: [7, 30, 90].includes(days) ? days : 30,
  };
}

function updateRectificationFilters(form) {
  const formData = new FormData(form);
  rectificationFilters = {
    status: formData.get("status")?.toString() ?? "",
    ownerId: formData.get("ownerId")?.toString() ?? "",
    executorId: formData.get("executorId")?.toString() ?? "",
    sourceType: formData.get("sourceType")?.toString() ?? "",
    focus: "",
  };
}

function syncAssessmentTabFromHash() {
  activeAssessmentTab = tabHashMap[window.location.hash.replace(/^#/, "")] ?? activeAssessmentTab;
}

export function bindAssessmentPageEvents(rerender) {
  const page = document.querySelector(".assessment-page");
  if (page === null) return;
  ensureWorkResultsLoaded(rerender);

  document.querySelectorAll("[data-assessment-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      window.location.hash = tab.dataset.hash;
    });
  });

  const statsForm = document.querySelector(".assessment-stats-filters");
  statsForm?.addEventListener("change", () => {
    updateStatsFilters(statsForm);
    rerender();
  });
  statsForm?.addEventListener("input", () => {
    updateStatsFilters(statsForm);
    rerender();
  });

  const dashboardForm = document.querySelector(".assessment-dashboard-filters");
  dashboardForm?.addEventListener("change", () => {
    updateDashboardFilters(dashboardForm);
    rerender();
    ensureWorkResultsLoaded(rerender, dashboardFilters.days);
  });

  const reportForm = document.querySelector(".assessment-report-filters");
  reportForm?.addEventListener("change", () => {
    updateReportFilters(reportForm);
    rerender();
  });

  const problemForm = document.querySelector(".assessment-problem-filters");
  problemForm?.addEventListener("change", () => {
    updateProblemFilters(problemForm);
    rerender();
  });

  const rectificationForm = document.querySelector(".assessment-rectification-filters");
  rectificationForm?.addEventListener("change", () => {
    updateRectificationFilters(rectificationForm);
    rerender();
  });

  page.addEventListener("click", (event) => {
    const todayOverviewButton = event.target.closest("[data-assessment-today-overview]");
    if (todayOverviewButton !== null) {
      activeTodayOverview = todayOverviewButton.dataset.assessmentTodayOverview ?? "startedActions";
      rerender();
      return;
    }
    const button = event.target.closest("[data-assessment-action]");
    if (button === null) return;
    const action = button.dataset.assessmentAction;
    if (action === "close-modal") {
      modalState = null;
      rerender();
      return;
    }
    if (action === "fill-report") {
      modalState = { kind: "report", mode: "add", departmentId: reportFilters.departmentId, readonly: false, error: "" };
      rerender();
      return;
    }
    if (action === "open-report") {
      activeAssessmentTab = "reports";
      reportFilters = { ...reportFilters, departmentId: button.dataset.departmentId ?? "", weekStart: getWeekRange().weekStart };
      window.location.hash = "assessment-reports";
      rerender();
      return;
    }
    if (action === "view-report" || action === "edit-report") {
      modalState = { kind: "report", mode: "edit", reportId: button.dataset.reportId, readonly: action === "view-report", error: "" };
      rerender();
      return;
    }
    if (action === "add-problem" || action === "add-problem-from-report") {
      const report = getReport(button.dataset.reportId) ?? null;
      modalState = {
        kind: "problem",
        mode: "add",
        reportId: report?.id ?? "",
        departmentId: report?.departmentId ?? "",
        relatedGoalId: report?.relatedGoalIds?.[0] ?? "",
        description: report?.efficiencyReview ?? "",
        readonly: false,
        error: "",
      };
      rerender();
      return;
    }
    if (action === "view-problem" || action === "edit-problem") {
      modalState = { kind: "problem", mode: "edit", problemId: button.dataset.problemId, readonly: action === "view-problem", error: "" };
      rerender();
      return;
    }
    if (action === "view-person-detail") {
      modalState = { kind: "personDetail", personId: button.dataset.personId };
      rerender();
      return;
    }
    if (action === "launch-rectification") {
      launchRectificationWorkFromTask(button.dataset.taskId, rerender);
      return;
    }
    if (action === "open-rectification-focus") {
      rectificationFilters = {
        status: "",
        ownerId: "",
        executorId: "",
        sourceType: "",
        focus: button.dataset.focus ?? "",
      };
      activeAssessmentTab = "rectifications";
      window.location.hash = "assessment-rectifications";
      rerender();
      return;
    }
    if (action === "show-all-today-events") {
      showAllTodayEvents = true;
      rerender();
      return;
    }
    if (action === "view-rectification") {
      modalState = { kind: "rectificationDetail", processInstanceId: button.dataset.processInstanceId };
      rerender();
      return;
    }
    if (action === "view-person-profile-process") {
      modalState = { kind: "personProfileProcessDetail", processInstanceId: button.dataset.processInstanceId };
      rerender();
    }
  });

  const weeklyReportForm = document.querySelector(".assessment-report-form");
  weeklyReportForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    saveReport(weeklyReportForm, submitter?.dataset.submitIntent ?? "draft", rerender);
  });

  const assessmentProblemForm = document.querySelector(".assessment-problem-form");
  assessmentProblemForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveProblem(assessmentProblemForm, rerender);
  });

  const rectificationDetail = document.querySelector("[data-launched-process-detail]");
  if (rectificationDetail !== null) {
    bindLaunchedProcessDetailEvents(document, rerender, {
      onSaved: () => {
        modalState = null;
        rerender();
      },
    });
  }
}

export function renderAssessmentPage() {
  syncAssessmentTabFromHash();
  if (!canCurrentUser("workResults.view")) {
    return `<section class="placeholder"><h2>你没有权限访问管理驾驶舱</h2><p>请联系管理员调整账号权限。</p></section>`;
  }
  return `
    <div class="assessment-page">
      <div class="section-heading with-actions page-toolbar">
        <div>
          <h2>管理驾驶舱</h2>
          <p class="form-note">公司的每日管理入口，优先回答今天发生了什么、哪些事情需要介入、哪些经验已经沉淀为新的标准。</p>
        </div>
      </div>
      ${renderAssessmentTabs()}
      ${
        activeAssessmentTab === "reports"
          ? renderReportsPage()
          : activeAssessmentTab === "problems"
            ? canCurrentUser("workResults.view") ? renderProblemsPage() : `<section class="settings-section"><div class="empty-detail">你没有权限查看问题汇总。</div></section>`
            : activeAssessmentTab === "rectifications"
              ? renderRectificationPage()
              : activeAssessmentTab === "personProfiles"
                ? renderPersonProfilesPage()
                : renderStatsPage()
      }
      ${renderModals()}
    </div>
  `;
}
