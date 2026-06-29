import {
  createId,
  createPersistentResource,
  getCurrentUser,
  getNow,
  state,
  updatePersistentResource,
} from "./appState.js?v=20260627-methods1";
import { getDataScope, hasPermission } from "./permissions.js?v=20260627-methods1";
import { ProcessInstanceStatus, TaskStatus, processInstanceStatusNames, taskStatusNames } from "./data/modelOptions.js";
import { isCanceledStatus, isDoneStatus, isTaskOverdue } from "./data/taskUtils.js?v=20260627-methods1";

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

const tabHashMap = {
  assessment: "stats",
  "assessment-stats": "stats",
  "assessment-reports": "reports",
  "assessment-problems": "problems",
};

const weeklyReportQuestionLabels = {
  goalAlignedWork: "本周围绕目标推进了哪些关键事情？",
  workEffectReview: "这些事情做得怎么样？是否真正解决了问题、产生了效果？",
  efficiencyReview: "执行效率如何？有无提升空间？",
};

const weeklyReportPlaceholders = {
  goalAlignedWork: "请只写与目标直接相关的关键工作，不写日常流水账。说明对齐哪个目标，推进了什么。",
  workEffectReview: "请说明这些事情是否做对了，解决了什么问题，产生了什么实际效果。不要只写“已完成”。",
  efficiencyReview: "请说明本周执行过程中是否存在低效、返工、卡点、等待、沟通不顺等问题，以及下周有什么改进空间。",
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

const problemTypeOptions = ["目标不清晰", "流程问题", "人员问题", "沟通问题", "产品问题", "供应链问题", "内容问题", "库存问题", "效率问题", "其他"];
const impactLevelOptions = ["轻微", "一般", "严重"];

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
  if (canCurrentUser("assessment.viewAll")) return state.departments;
  if (canCurrentUser("assessment.viewDepartment")) return state.departments.filter((department) => department.id === user?.departmentId);
  return state.departments.filter((department) => department.id === user?.departmentId);
}

function getScopedPeople() {
  const user = getCurrentUser();
  if (canCurrentUser("assessment.viewAll")) return state.people;
  if (canCurrentUser("assessment.viewDepartment")) return state.people.filter((person) => person.departmentId === user?.departmentId || person.id === user?.id);
  return state.people.filter((person) => person.id === user?.id);
}

function isVisibleByAssessmentScope(item) {
  const user = getCurrentUser();
  if (canCurrentUser("assessment.viewAll")) return true;
  if (canCurrentUser("assessment.viewDepartment")) return item.departmentId === user?.departmentId || item.ownerId === user?.id || item.submitterId === user?.id;
  if (canCurrentUser("assessment.viewSelf")) return item.ownerId === user?.id || item.submitterId === user?.id || item.id === user?.id;
  const dataScope = getDataScope(user);
  if (dataScope === "all") return true;
  if (dataScope === "department") return item.departmentId === user?.departmentId;
  return item.ownerId === user?.id || item.submitterId === user?.id;
}

function getTaskPeriodDate(task) {
  return task.completedAt ?? task.updatedAt ?? task.createdAt ?? task.dueDate;
}

function getFilteredStatsTasks() {
  const range = getStatsRange();
  return state.tasks.filter((task) => {
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
    ["stats", "工作统计", "assessment-stats"],
    ["reports", "目标推进周报", "assessment-reports"],
    ["problems", "问题汇总", "assessment-problems"],
  ];
  return `
    <div class="settings-tabs task-subtabs" aria-label="考核页签">
      ${tabs.map(([key, label, hash]) => `<button class="${activeAssessmentTab === key ? "is-active" : ""}" type="button" data-assessment-tab="${key}" data-hash="${hash}">${label}</button>`).join("")}
    </div>
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
    ["本周期执行任务总数", tasks.length],
    ["已完成任务数", tasks.filter((task) => isDoneStatus(task.status)).length],
    ["进行中任务数", tasks.filter((task) => !isDoneStatus(task.status) && !isCanceledStatus(task.status)).length],
    ["逾期任务数", tasks.filter((task) => isTaskOverdue(task, today)).length],
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
        <thead><tr><th>员工</th><th>部门</th><th>本周期任务数</th><th>已完成</th><th>进行中</th><th>待审核</th><th>逾期</th><th>已取消</th><th>提交结果数</th><th>参与流程数</th><th>操作</th></tr></thead>
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
                <td>${personTasks.filter((task) => isTaskOverdue(task, today)).length}</td>
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
        <thead><tr><th>部门</th><th>负责人</th><th>本周期任务数</th><th>已完成任务</th><th>逾期任务</th><th>进行中流程</th><th>已完成流程</th><th>已取消流程</th><th>周报状态</th><th>未解决问题数</th><th>操作</th></tr></thead>
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
                <td>${departmentTasks.filter((task) => isTaskOverdue(task, today)).length}</td>
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
  const tasks = getFilteredStatsTasks();
  const processes = getFilteredStatsProcessInstances();
  return `
    ${renderStatsFilters()}
    <section class="settings-section">
      <div class="section-heading">
        <h2>工作统计</h2>
        <p class="form-note">统计只展示工作数量和状态，不做绩效打分、工资奖金计算或员工排名。</p>
      </div>
      ${renderMetricCards(tasks, processes)}
    </section>
    ${renderPersonStatsTable(tasks, processes)}
    ${renderDepartmentStatsTable(tasks, processes)}
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
        ${canCurrentUser("assessment.fillWeeklyReport") ? `<button class="primary-button" type="button" data-assessment-action="fill-report">填写周报</button>` : ""}
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
                ${canCurrentUser("assessment.editWeeklyReport") ? `<button class="text-button" type="button" data-assessment-action="edit-report" data-report-id="${report.id}">编辑</button>` : ""}
                ${canCurrentUser("assessment.updateProblems") ? `<button class="text-button" type="button" data-assessment-action="add-problem-from-report" data-report-id="${report.id}">添加到问题汇总</button>` : ""}
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
        ${canCurrentUser("assessment.updateProblems") ? `<button class="primary-button" type="button" data-assessment-action="add-problem">新增问题</button>` : ""}
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
                ${canCurrentUser("assessment.updateProblems") ? `<button class="text-button" type="button" data-assessment-action="edit-problem" data-problem-id="${problem.id}">更新状态</button>` : ""}
              </span></td>
            </tr>
          `).join("")}
        </tbody>
      </table></div>
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
  const selectedDepartmentId = departmentId || (canCurrentUser("assessment.viewAll") ? reportFilters.departmentId : user?.departmentId) || "";
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
          <button class="icon-button" type="button" data-assessment-action="close-modal" aria-label="关闭">×</button>
        </div>
        <form class="modal-form assessment-report-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error ?? "")}</div>
          <div class="form-note">周报不是工作流水账，也不是为了统计做了多少事。少写空话，多写事实；少写流水账，多写目标推进；少写表面完成，多写问题和解决动作。</div>
          <div class="form-grid">
            <label><span>周报周期</span><input name="weekStart" type="date" value="${escapeHtml(report.weekStart)}" ${readonly ? "disabled" : ""} /></label>
            <label><span>部门</span><select name="departmentId" ${readonly || !canCurrentUser("assessment.viewAll") ? "disabled" : ""}>${renderOptions(getScopedDepartments(), report.departmentId, "请选择部门")}</select></label>
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
          <button class="icon-button" type="button" data-assessment-action="close-modal" aria-label="关闭">×</button>
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
            <thead><tr><th>任务名</th><th>所属流程</th><th>对齐目标</th><th>负责部门</th><th>状态</th><th>截止日期</th><th>完成时间</th><th>是否逾期</th><th>提交结果</th></tr></thead>
            <tbody>${tasks.length === 0 ? `<tr><td colspan="9">暂无任务明细</td></tr>` : tasks.map((task) => {
              const process = state.processInstances.find((item) => item.id === task.processInstanceId);
              return `<tr><td>${escapeHtml(task.name)}</td><td>${escapeHtml(process?.name ?? "无")}</td><td>${findName(state.goals, task.goalId, "未对齐目标")}</td><td>${findName(state.departments, task.departmentId)}</td><td>${taskStatusNames[task.status] ?? task.status}</td><td>${task.dueDate ?? "未设置"}</td><td>${task.completedAt ?? "未完成"}</td><td>${isTaskOverdue(task, today) ? "已逾期" : "否"}</td><td>${hasSubmittedResult(task) ? "是" : "否"}</td></tr>`;
            }).join("")}</tbody>
          </table></div>
        </div>
      </div>
    </div>
  `;
}

function renderModals() {
  return `${renderReportModal()}${renderProblemModal()}${renderPersonDetailModal()}`;
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

function syncAssessmentTabFromHash() {
  activeAssessmentTab = tabHashMap[window.location.hash.replace(/^#/, "")] ?? activeAssessmentTab;
}

export function bindAssessmentPageEvents(rerender) {
  const page = document.querySelector(".assessment-page");
  if (page === null) return;

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

  page.addEventListener("click", (event) => {
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
}

export function renderAssessmentPage() {
  syncAssessmentTabFromHash();
  if (!canCurrentUser("assessment.view")) {
    return `<section class="placeholder"><h2>你没有权限访问考核模块</h2><p>请联系管理员调整账号权限。</p></section>`;
  }
  return `
    <div class="assessment-page">
      <div class="section-heading with-actions page-toolbar">
        <div>
          <h2>考核</h2>
          <p class="form-note">第一版只做目标推进周报、工作统计和问题意识，不做绩效打分、工资奖金或员工排名。</p>
        </div>
      </div>
      ${renderAssessmentTabs()}
      ${
        activeAssessmentTab === "reports"
          ? renderReportsPage()
          : activeAssessmentTab === "problems"
            ? canCurrentUser("assessment.viewProblems") ? renderProblemsPage() : `<section class="settings-section"><div class="empty-detail">你没有权限查看问题汇总。</div></section>`
            : renderStatsPage()
      }
      ${renderModals()}
    </div>
  `;
}
