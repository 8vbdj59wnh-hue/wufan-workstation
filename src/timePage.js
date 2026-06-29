import { getCurrentUser, getCurrentWeek, getNow, resolveAssetUrl, startProcess, state } from "./appState.js?v=20260627-methods1";
import { hasPermission } from "./permissions.js?v=20260627-methods1";
import {
  ProcessTemplateStatus,
  TaskImportance,
  TaskUrgency,
  WorkPlanStatus,
  taskImportanceNames,
  taskUrgencyNames,
  workPlanStatusNames,
} from "./data/modelOptions.js";
import { getPrimaryImageUrl, getTaskQuadrant, isCanceledStatus, isDoneStatus, quadrantNames } from "./data/taskUtils.js?v=20260627-methods1";

const currentWeek = getCurrentWeek();
const departments = state.departments;
const goals = state.goals;
const people = state.people;
let filters = { departmentId: "", ownerId: "", goalId: "", quadrant: "", status: "", showDone: false, showCanceled: false };
let activeTimeTab = "future-works";
let selectedFutureWorkIds = new Set();
let selectedWeekWorkIds = new Set();

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

const timeTabHashMap = {
  "future-works": "future-works",
  "work-priority": "work-priority",
  "week-works": "week-works",
};
const priorityQuadrantLayout = [
  { key: "second", rowLabel: "重要", columnLabel: "不紧急" },
  { key: "first", rowLabel: "重要", columnLabel: "紧急" },
  { key: "fourth", rowLabel: "不重要", columnLabel: "不紧急" },
  { key: "third", rowLabel: "不重要", columnLabel: "紧急" },
];

function syncTimeTabFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  activeTimeTab = timeTabHashMap[hash] ?? activeTimeTab;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function findName(items, id, fallback) {
  if (id === null || id === "") return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function getTaskTemplate(workPlan) {
  return state.taskTemplates.find((template) => template.id === workPlan.taskTemplateId) ?? null;
}

function getWorkDepartmentId(workPlan) {
  return workPlan.departmentId ?? getTaskTemplate(workPlan)?.departmentId ?? null;
}

function getProcessTemplate(templateId) {
  return state.processTemplates.find((template) => template.id === templateId) ?? null;
}

function renderOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items.map((item) => `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
  `;
}

function getQuadrantKey(workPlan) {
  const name = getTaskQuadrant(workPlan.importance, workPlan.urgency);
  return Object.entries(quadrantNames).find(([, value]) => value === name)?.[0] ?? "";
}

function getWorkObjectName(workPlan) {
  const fields = workPlan.customFields ?? {};
  return (
    fields.productName ??
    fields.product ??
    fields.productTitle ??
    fields.objectName ??
    fields.itemName ??
    ""
  );
}

function getWorkTitle(workPlan) {
  const template = getTaskTemplate(workPlan);
  if (workPlan.title) return workPlan.title;
  const objectName = getWorkObjectName(workPlan);
  if (objectName !== "") return `${objectName}｜${template?.name ?? "标准工作"}`;
  return template?.name ?? "未命名工作";
}

function renderCover(workPlan) {
  const imageUrl = getPrimaryImageUrl(workPlan);
  return imageUrl
    ? `<img class="task-cover-thumb" src="${escapeHtml(resolveAssetUrl(imageUrl))}" alt="产品图" />`
    : `<span class="task-cover-placeholder">无图</span>`;
}

function getSelectionSet(listType) {
  return listType === "future" ? selectedFutureWorkIds : selectedWeekWorkIds;
}

function setSelectionSet(listType, nextSelection) {
  if (listType === "future") {
    selectedFutureWorkIds = nextSelection;
    return;
  }
  selectedWeekWorkIds = nextSelection;
}

function matchesFilters(workPlan) {
  const template = getTaskTemplate(workPlan);
  if (filters.status === "" && isDoneStatus(workPlan.status) && !filters.showDone) return false;
  if (filters.status === "" && isCanceledStatus(workPlan.status) && !filters.showCanceled) return false;
  if (filters.departmentId !== "" && getWorkDepartmentId(workPlan) !== filters.departmentId) return false;
  if (filters.ownerId !== "" && template?.ownerId !== filters.ownerId) return false;
  if (filters.goalId !== "" && workPlan.goalId !== filters.goalId) return false;
  if (filters.quadrant !== "" && getQuadrantKey(workPlan) !== filters.quadrant) return false;
  if (filters.status !== "" && workPlan.status !== filters.status) return false;
  return true;
}

function matchesTimeListStatus(workPlan, listType) {
  const targetStatus = listType === "future" ? WorkPlanStatus.Future : WorkPlanStatus.ThisWeek;
  if (workPlan.status === targetStatus) return true;
  if (isCanceledStatus(workPlan.status)) {
    if (!(filters.showCanceled || filters.status === WorkPlanStatus.Canceled)) return false;
    return listType === "week" ? workPlan.plannedWeek === currentWeek : workPlan.plannedWeek !== currentWeek;
  }
  if (isDoneStatus(workPlan.status)) {
    if (!filters.showDone && filters.status === "") return false;
    return listType === "week" ? workPlan.plannedWeek === currentWeek : workPlan.plannedWeek !== currentWeek;
  }
  return false;
}

function renderWorkSelectHeader(workPlans, listType) {
  const selectedIds = getSelectionSet(listType);
  const visibleIds = workPlans.map((workPlan) => workPlan.id);
  const visibleSelectedCount = visibleIds.filter((workPlanId) => selectedIds.has(workPlanId)).length;
  const isAllVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const isPartiallyVisibleSelected = visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;

  return `
    <th class="task-select-column">
      <label class="task-select-all">
        <input
          type="checkbox"
          data-work-select-all
          data-list-type="${listType}"
          data-indeterminate="${isPartiallyVisibleSelected ? "true" : "false"}"
          ${isAllVisibleSelected ? "checked" : ""}
          ${visibleIds.length === 0 ? "disabled" : ""}
        />
        <span>序号</span>
      </label>
    </th>
  `;
}

function renderWorkSelectCell(workPlan, listType, index) {
  const selectedIds = getSelectionSet(listType);
  return `
    <td class="task-select-column">
      <label class="task-row-select">
        <input
          type="checkbox"
          data-work-row-select
          data-list-type="${listType}"
          data-work-id="${workPlan.id}"
          ${selectedIds.has(workPlan.id) ? "checked" : ""}
        />
        <span>${index + 1}</span>
      </label>
    </td>
  `;
}

function getVisibleSelectedWorkIds(listType) {
  const targetStatus = listType === "future" ? WorkPlanStatus.Future : WorkPlanStatus.ThisWeek;
  const selectedIds = getSelectionSet(listType);
  return state.workPlans
    .filter((workPlan) => workPlan.status === targetStatus)
    .filter(matchesFilters)
    .map((workPlan) => workPlan.id)
    .filter((workPlanId) => selectedIds.has(workPlanId));
}

function renderWorkBulkBar(listType) {
  const selectedCount = getVisibleSelectedWorkIds(listType).length;

  if (listType === "future") {
    return `
      <div class="bulk-task-bar">
        <strong>已选择 ${selectedCount} 条未来工作</strong>
        ${canCurrentUser("workPlans.batchOperate") && canCurrentUser("workPlans.joinThisWeek") ? `<button class="secondary-button" type="button" data-action="bulk-set-this-week" ${selectedCount === 0 ? "disabled" : ""}>批量加入本周</button>` : ""}
        ${canCurrentUser("workPlans.batchOperate") && canCurrentUser("workPlans.cancelFuture") ? `<button class="secondary-button danger-button" type="button" data-action="bulk-cancel-future" ${selectedCount === 0 ? "disabled" : ""}>批量取消</button>` : ""}
      </div>
    `;
  }

  return `
      <div class="bulk-task-bar">
      <strong>已选择 ${selectedCount} 条本周工作</strong>
      ${canCurrentUser("workPlans.batchOperate") && canCurrentUser("workPlans.returnToFuture") ? `<button class="secondary-button" type="button" data-action="bulk-set-future" ${selectedCount === 0 ? "disabled" : ""}>批量退回未来工作</button>` : ""}
      ${canCurrentUser("workPlans.batchOperate") && canCurrentUser("workPlans.cancelFuture") ? `<button class="secondary-button danger-button" type="button" data-action="bulk-cancel-week" ${selectedCount === 0 ? "disabled" : ""}>批量取消</button>` : ""}
    </div>
  `;
}

function renderFilters() {
  return `
    <form class="task-filters time-filters">
      <label><span>部门</span><select name="departmentId">${renderOptions(departments, filters.departmentId, "全部部门")}</select></label>
      <label><span>负责人</span><select name="ownerId">${renderOptions(people, filters.ownerId, "全部负责人")}</select></label>
      <label><span>对齐目标</span><select name="goalId">${renderOptions(goals, filters.goalId, "全部目标")}</select></label>
      <label>
        <span>工作优先级</span>
        <select name="quadrant">
          <option value="">全部优先级</option>
          ${Object.entries(quadrantNames).map(([key, name]) => `<option value="${key}" ${filters.quadrant === key ? "selected" : ""}>${name}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>状态</span>
        <select name="status">
          <option value="">全部状态</option>
          ${Object.entries(workPlanStatusNames).map(([status, name]) => `<option value="${status}" ${filters.status === status ? "selected" : ""}>${name}</option>`).join("")}
        </select>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showDone" type="checkbox" ${filters.showDone ? "checked" : ""} />
        <span>显示已完成</span>
      </label>
      <label class="checkbox-field task-filter-checkbox">
        <input name="showCanceled" type="checkbox" ${filters.showCanceled ? "checked" : ""} />
        <span>显示已取消</span>
      </label>
    </form>
  `;
}

function renderWorkRow(workPlan, actions = "", listType = null, index = 0) {
  const template = getTaskTemplate(workPlan);

  return `
    <tr>
      ${listType === null ? "" : renderWorkSelectCell(workPlan, listType, index)}
      <td class="task-cover-column">${renderCover(workPlan)}</td>
      <td><strong>${escapeHtml(getWorkTitle(workPlan))}</strong></td>
      <td>${findName(goals, workPlan.goalId, "未对齐目标")}</td>
      <td>${escapeHtml(template?.name ?? "未关联标准工作")}</td>
      <td>${findName(departments, getWorkDepartmentId(workPlan), "未设置")}</td>
      <td>${findName(people, template?.ownerId ?? null, "未设置")}</td>
      <td><span class="task-soft-tag">${getTaskQuadrant(workPlan.importance, workPlan.urgency)}</span></td>
      <td>${workPlan.dueDate ?? "未设置"}</td>
      <td><span class="status-pill">${workPlanStatusNames[workPlan.status]}</span></td>
      <td><span class="row-actions">${actions}</span></td>
    </tr>
  `;
}

function renderFutureWorks() {
  const workPlans = state.workPlans.filter((workPlan) => matchesTimeListStatus(workPlan, "future")).filter(matchesFilters);
  return `
    <section class="settings-section" id="future-works">
      <div class="section-heading"><h2>未来工作</h2></div>
      ${renderWorkBulkBar("future")}
      <div class="table-wrap">
        <table class="data-table task-table">
          <thead><tr>${renderWorkSelectHeader(workPlans, "future")}<th>产品图</th><th>工作事项</th><th>对齐目标</th><th>标准工作事项</th><th>负责部门</th><th>负责人</th><th>优先级</th><th>期望完成日期</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${workPlans.length === 0 ? `<tr><td colspan="11">暂无未来工作</td></tr>` : workPlans
              .map((workPlan, index) =>
                renderWorkRow(
                  workPlan,
                  isCanceledStatus(workPlan.status)
                    ? `${canCurrentUser("workPlans.editFuture") ? `<button class="text-button" type="button" data-action="set-future" data-work-id="${workPlan.id}">重新加入未来工作</button>` : ""}`
                    : `${canCurrentUser("workPlans.editFuture") ? `<button class="text-button" type="button" data-action="edit-work" data-work-id="${workPlan.id}">编辑</button>` : ""}${canCurrentUser("workPlans.joinThisWeek") ? `<button class="text-button" type="button" data-action="set-this-week" data-work-id="${workPlan.id}">加入本周工作</button>` : ""}${canCurrentUser("workPlans.cancelFuture") ? `<button class="text-button danger-button" type="button" data-action="cancel-work" data-work-id="${workPlan.id}">取消</button>` : ""}`,
                  "future",
                  index,
                ),
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPriorityQuadrants() {
  const activeWorkPlans = state.workPlans
    .filter((workPlan) => workPlan.status === WorkPlanStatus.Future || workPlan.status === WorkPlanStatus.ThisWeek || (filters.status !== "" && workPlan.status === filters.status))
    .filter(matchesFilters);
  return `
    <section class="settings-section" id="work-priority">
      <div class="section-heading"><h2>工作优先级</h2></div>
      <div class="quadrant-grid">
        ${priorityQuadrantLayout
          .map(({ key, rowLabel, columnLabel }) => {
            const name = quadrantNames[key];
            const workPlans = activeWorkPlans.filter((workPlan) => getQuadrantKey(workPlan) === key);
            return `
              <div class="quadrant-box">
                <div class="quadrant-axis-labels">
                  <span>${rowLabel}</span>
                  <span>${columnLabel}</span>
                </div>
                <h3>${name}</h3>
                ${workPlans.length === 0 ? `<p class="empty-detail">暂无工作</p>` : workPlans
                  .map((workPlan) => {
                    const template = getTaskTemplate(workPlan);
                    return `
                      <article class="task-card">
                        <div class="row-actions">${renderCover(workPlan)}</div>
                        <strong>${escapeHtml(getWorkTitle(workPlan))}</strong>
                        <p>${findName(goals, workPlan.goalId, "未对齐目标")} · ${escapeHtml(template?.name ?? "未关联标准工作")}</p>
                        <p>${findName(people, template?.ownerId ?? null, "未设置")} · ${workPlan.dueDate ?? "未设置"} · ${workPlanStatusNames[workPlan.status]}</p>
                        <div class="row-actions">
                          <button class="text-button" type="button" data-action="toggle-importance" data-work-id="${workPlan.id}">${taskImportanceNames[workPlan.importance]}</button>
                          <button class="text-button" type="button" data-action="toggle-urgency" data-work-id="${workPlan.id}">${taskUrgencyNames[workPlan.urgency]}</button>
                          ${workPlan.status === WorkPlanStatus.Future ? `<button class="text-button" type="button" data-action="set-this-week" data-work-id="${workPlan.id}">加入本周工作</button>` : `<button class="text-button" type="button" data-action="set-future" data-work-id="${workPlan.id}">退回未来工作</button>`}
                          <button class="text-button danger-button" type="button" data-action="cancel-work" data-work-id="${workPlan.id}">取消</button>
                        </div>
                      </article>
                    `;
                  })
                  .join("")}
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderThisWeekWorks() {
  const workPlans = state.workPlans.filter((workPlan) => matchesTimeListStatus(workPlan, "week")).filter(matchesFilters);
  return `
    <section class="settings-section" id="week-works">
      <div class="section-heading"><h2>本周工作</h2></div>
      ${renderWorkBulkBar("week")}
      <div class="table-wrap">
        <table class="data-table task-table">
          <thead><tr>${renderWorkSelectHeader(workPlans, "week")}<th>产品图</th><th>工作事项</th><th>对齐目标</th><th>标准工作事项</th><th>负责部门</th><th>负责人</th><th>优先级</th><th>期望完成日期</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${workPlans.length === 0 ? `<tr><td colspan="11">暂无本周工作</td></tr>` : workPlans
              .map((workPlan, index) =>
                renderWorkRow(
                  workPlan,
                  isCanceledStatus(workPlan.status)
                    ? `${canCurrentUser("workPlans.joinThisWeek") ? `<button class="text-button" type="button" data-action="set-this-week" data-work-id="${workPlan.id}">重新加入本周工作</button>` : ""}`
                    : `${canCurrentUser("workPlans.editFuture") ? `<button class="text-button" type="button" data-action="edit-work" data-work-id="${workPlan.id}">编辑</button>` : ""}${canCurrentUser("workPlans.launch") ? `<button class="text-button" type="button" data-action="launch-work" data-work-id="${workPlan.id}">发起工作</button>` : ""}${canCurrentUser("workPlans.returnToFuture") ? `<button class="text-button" type="button" data-action="set-future" data-work-id="${workPlan.id}">退回未来工作</button>` : ""}${canCurrentUser("workPlans.cancelFuture") ? `<button class="text-button danger-button" type="button" data-action="cancel-work" data-work-id="${workPlan.id}">取消</button>` : ""}`,
                  "week",
                  index,
                ),
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function updateFilters(form) {
  const data = new FormData(form);
  filters = {
    departmentId: data.get("departmentId")?.toString() ?? "",
    ownerId: data.get("ownerId")?.toString() ?? "",
    goalId: data.get("goalId")?.toString() ?? "",
    quadrant: data.get("quadrant")?.toString() ?? "",
    status: data.get("status")?.toString() ?? "",
    showDone: data.has("showDone"),
    showCanceled: data.has("showCanceled"),
  };
}

function updateWorkPlan(workPlanId, patch) {
  const now = getNow();
  state.workPlans = state.workPlans.map((workPlan) =>
    workPlan.id === workPlanId ? { ...workPlan, ...patch, updatedAt: now } : workPlan,
  );
}

function bulkUpdateWorkPlans(workPlanIds, patch) {
  const now = getNow();
  const targetIds = new Set(workPlanIds);
  state.workPlans = state.workPlans.map((workPlan) =>
    targetIds.has(workPlan.id) ? { ...workPlan, ...patch, updatedAt: now } : workPlan,
  );
}

function bulkSetFutureWorksToThisWeek(rerender) {
  const workPlanIds = getVisibleSelectedWorkIds("future");
  if (workPlanIds.length === 0) return;
  bulkUpdateWorkPlans(workPlanIds, { status: WorkPlanStatus.ThisWeek, plannedWeek: currentWeek });
  selectedFutureWorkIds = new Set();
  rerender();
}

function bulkSetWeekWorksToFuture(rerender) {
  const workPlanIds = getVisibleSelectedWorkIds("week");
  if (workPlanIds.length === 0) return;
  bulkUpdateWorkPlans(workPlanIds, { status: WorkPlanStatus.Future, plannedWeek: null });
  selectedWeekWorkIds = new Set();
  rerender();
}

function bulkCancelWorkPlans(listType, rerender) {
  const workPlanIds = getVisibleSelectedWorkIds(listType);
  if (workPlanIds.length === 0) return;
  const message = listType === "future" ? "确定要取消选中的未来工作吗？" : "确定要取消选中的本周工作吗？";
  if (!window.confirm(message)) return;
  bulkUpdateWorkPlans(workPlanIds, { status: WorkPlanStatus.Canceled, canceledAt: getNow() });
  setSelectionSet(listType, new Set());
  rerender();
}

function launchWorkPlan(workPlanId) {
  const workPlan = state.workPlans.find((item) => item.id === workPlanId);
  if (workPlan === undefined) return;
  const template = getTaskTemplate(workPlan);
  if (template === null) return window.alert("该工作计划未关联标准工作事项。");
  if (!template.defaultProcessTemplateId) return window.alert("该标准工作事项尚未绑定标准流程。");
  const processTemplate = getProcessTemplate(template.defaultProcessTemplateId);
  if (processTemplate === null || processTemplate.status !== ProcessTemplateStatus.Active) {
    return window.alert("该标准工作事项绑定的标准流程未启用。");
  }

  const result = startProcess({
    templateId: template.defaultProcessTemplateId,
    taskTemplateId: template.id,
    customFields: workPlan.customFields ?? {},
    displayTitle: getWorkTitle(workPlan),
    coverImageUrl: getPrimaryImageUrl(workPlan) || null,
    name: getWorkTitle(workPlan),
    goalId: workPlan.goalId,
    initiatorId: template.ownerId,
    description: workPlan.description || `由本周工作发起：${getWorkTitle(workPlan)}`,
    launchAssignments: { owner: {}, accepter: {} },
  });

  if (result.error !== undefined) return window.alert(result.error);

  const now = getNow();
  state.workPlans = state.workPlans.map((item) =>
    item.id === workPlanId
      ? {
          ...item,
          status: WorkPlanStatus.Launched,
          processInstanceId: result.instance.id,
          launchedAt: now,
          updatedAt: now,
        }
      : item,
  );
  window.alert("已发起工作，流程步骤执行任务已进入执行任务列表。");
}

function editWorkPlan(workPlanId) {
  const workPlan = state.workPlans.find((item) => item.id === workPlanId);
  if (workPlan === undefined) return;
  const title = window.prompt("请输入本次工作标题", workPlan.title ?? getWorkTitle(workPlan));
  if (title === null) return;
  const dueDate = window.prompt("请输入期望完成日期，例如 2026-07-03，可留空", workPlan.dueDate ?? "");
  if (dueDate === null) return;
  if (dueDate !== "" && Number.isNaN(Date.parse(`${dueDate}T00:00:00+08:00`))) {
    window.alert("期望完成日期格式不正确。");
    return;
  }
  const description = window.prompt("请输入补充说明，可留空", workPlan.description ?? "");
  if (description === null) return;
  updateWorkPlan(workPlanId, { title: title.trim() || null, dueDate: dueDate || null, description: description || null });
}

export function bindTimePageEvents(rerender) {
  const page = document.querySelector(".time-page");
  const filterForm = document.querySelector(".time-filters");
  if (page === null || filterForm === null) return;

  page.querySelectorAll("[data-work-select-all]").forEach((checkbox) => {
    checkbox.indeterminate = checkbox.dataset.indeterminate === "true";
  });

  document.querySelectorAll("[data-time-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTimeTab = tab.dataset.timeTab;
      rerender();
    });
  });

  filterForm.addEventListener("change", () => {
    updateFilters(filterForm);
    rerender();
  });

  page.addEventListener("change", (event) => {
    const selectAll = event.target.closest("[data-work-select-all]");
    if (selectAll !== null) {
      const listType = selectAll.dataset.listType;
      const targetStatus = listType === "future" ? WorkPlanStatus.Future : WorkPlanStatus.ThisWeek;
      const visibleIds = state.workPlans
        .filter((workPlan) => workPlan.status === targetStatus)
        .filter(matchesFilters)
        .map((workPlan) => workPlan.id);

      if (selectAll.checked) {
        setSelectionSet(listType, new Set([...getSelectionSet(listType), ...visibleIds]));
      } else {
        const visibleIdSet = new Set(visibleIds);
        setSelectionSet(listType, new Set([...getSelectionSet(listType)].filter((workPlanId) => !visibleIdSet.has(workPlanId))));
      }
      rerender();
      return;
    }

    const rowSelect = event.target.closest("[data-work-row-select]");
    if (rowSelect !== null) {
      const listType = rowSelect.dataset.listType;
      const workPlanId = rowSelect.dataset.workId;
      const nextSelection = new Set(getSelectionSet(listType));
      if (rowSelect.checked) {
        nextSelection.add(workPlanId);
      } else {
        nextSelection.delete(workPlanId);
      }
      setSelectionSet(listType, nextSelection);
      rerender();
    }
  });

  page.addEventListener("click", (event) => {
    if (event.target.closest("[data-work-row-select], [data-work-select-all]") !== null) return;

    const button = event.target.closest("[data-action]");
    if (button === null) return;
    const workPlanId = button.dataset.workId;
    if (button.dataset.action === "bulk-set-this-week") {
      bulkSetFutureWorksToThisWeek(rerender);
      return;
    }
    if (button.dataset.action === "bulk-set-future") {
      bulkSetWeekWorksToFuture(rerender);
      return;
    }
    if (button.dataset.action === "bulk-cancel-future") {
      bulkCancelWorkPlans("future", rerender);
      return;
    }
    if (button.dataset.action === "bulk-cancel-week") {
      bulkCancelWorkPlans("week", rerender);
      return;
    }
    if (button.dataset.action === "set-this-week") updateWorkPlan(workPlanId, { status: WorkPlanStatus.ThisWeek, plannedWeek: currentWeek });
    if (button.dataset.action === "set-future") updateWorkPlan(workPlanId, { status: WorkPlanStatus.Future, plannedWeek: null });
    if (button.dataset.action === "cancel-work" && window.confirm("确定要取消该工作计划吗？")) {
      updateWorkPlan(workPlanId, { status: WorkPlanStatus.Canceled, canceledAt: getNow() });
    }
    if (button.dataset.action === "toggle-importance") {
      const workPlan = state.workPlans.find((item) => item.id === workPlanId);
      updateWorkPlan(workPlanId, { importance: workPlan.importance === TaskImportance.Important ? TaskImportance.NotImportant : TaskImportance.Important });
    }
    if (button.dataset.action === "toggle-urgency") {
      const workPlan = state.workPlans.find((item) => item.id === workPlanId);
      updateWorkPlan(workPlanId, { urgency: workPlan.urgency === TaskUrgency.Urgent ? TaskUrgency.NotUrgent : TaskUrgency.Urgent });
    }
    if (button.dataset.action === "edit-work") editWorkPlan(workPlanId);
    if (button.dataset.action === "launch-work") launchWorkPlan(workPlanId);
    rerender();
  });
}

export function renderTimePage() {
  syncTimeTabFromHash();

  return `
    <div class="time-page">
      <div class="settings-tabs" aria-label="优先级页签">
        <button class="${activeTimeTab === "future-works" ? "is-active" : ""}" type="button" data-time-tab="future-works">未来工作</button>
        <button class="${activeTimeTab === "work-priority" ? "is-active" : ""}" type="button" data-time-tab="work-priority">工作优先级</button>
        <button class="${activeTimeTab === "week-works" ? "is-active" : ""}" type="button" data-time-tab="week-works">本周工作</button>
      </div>
      ${renderFilters()}
      ${
        activeTimeTab === "work-priority"
          ? renderPriorityQuadrants()
          : activeTimeTab === "week-works"
            ? renderThisWeekWorks()
            : renderFutureWorks()
      }
    </div>
  `;
}
