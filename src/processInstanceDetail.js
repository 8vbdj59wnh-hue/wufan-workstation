import { getNow, getProcessNodeStepOrder, state } from "./appState.js?v=20260627-methods1";
import {
  ProcessInstanceStatus,
  TaskImportance,
  TaskStatus,
  TaskUrgency,
  processInstanceStatusNames,
  taskImportanceNames,
  taskStatusNames,
  taskUrgencyNames,
} from "./data/modelOptions.js";
import { getTaskQuadrant, isTaskOverdue } from "./data/taskUtils.js?v=20260627-methods1";
import { renderWorkFormViewer } from "./workFormViewer.js?v=20260627-methods1";

const today = "2026-06-24";
const plannedWeekPattern = /^\d{4}-W\d{2}$/;
const departments = state.departments;
const goals = state.goals;
const people = state.people;

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

function renderDetailField(label, value) {
  return `<div class="detail-field"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items
      .map((item) => `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
      .join("")}
  `;
}

function renderValueOptions(values, selectedValue, names, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${Object.values(values)
      .map((value) => `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${names[value]}</option>`)
      .join("")}
  `;
}

function getInstance(instanceId) {
  return state.processInstances.find((instance) => instance.id === instanceId) ?? null;
}

function getTemplate(instance) {
  return state.processTemplates.find((template) => template.id === instance.templateId) ?? null;
}

function getTaskTemplate(instance) {
  return state.taskTemplates.find((template) => template.id === (instance.taskTemplateId ?? instance.standardWorkId)) ?? null;
}

function getInstanceTasks(instanceId) {
  return state.tasks
    .filter((task) => task.processInstanceId === instanceId)
    .sort((left, right) => {
      const leftNode = getNode(left.processNodeId);
      const rightNode = getNode(right.processNodeId);
      return getProcessNodeStepOrder(leftNode ?? {}) - getProcessNodeStepOrder(rightNode ?? {});
    });
}

function getNode(nodeId) {
  return state.processTemplateNodes.find((node) => node.id === nodeId) ?? null;
}

function getProgress(instanceId) {
  const tasks = getInstanceTasks(instanceId);
  const done = tasks.filter((task) => task.status === TaskStatus.Done).length;
  return `${done}/${tasks.length}`;
}

function canEditInstance(instance) {
  return instance.status === ProcessInstanceStatus.Running;
}

function canEditTask(task) {
  return task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled;
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function getCustomFieldEntries(instance) {
  return Object.entries(instance.customFields ?? {});
}

function renderCustomFields(instance, editable) {
  const entries = getCustomFieldEntries(instance);
  const taskTemplate = getTaskTemplate(instance);
  const fieldLabels = new Map((taskTemplate?.formFields ?? []).map((field) => [field.key, field.label]));

  if (entries.length === 0) return `<p>暂无本次工作差异信息</p>`;

  if (!editable) {
    return renderWorkFormViewer({
      formFields: taskTemplate?.formFields ?? [],
      customFields: instance.customFields ?? {},
    });
  }

  return `
    <div class="form-grid">
      ${entries
        .map(([key, value]) => {
          const label = fieldLabels.get(key) ?? key;
          const textValue = Array.isArray(value) ? value.join("、") : value;
          return `
            <label>
              <span>${escapeHtml(label)}</span>
              <input name="custom__${escapeHtml(key)}" value="${escapeHtml(textValue)}" />
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderStepTask(task, editable) {
  const node = getNode(task.processNodeId);
  const canEdit = editable && canEditTask(task);

  if (!canEdit) {
    return `
      <tr>
        <td>${escapeHtml(task.name)}</td>
        <td>${getProcessNodeStepOrder(node ?? {})}</td>
        <td>${findName(people, task.ownerId, "未设置")}</td>
        <td>${findName(departments, task.departmentId, "未设置")}</td>
        <td><span class="status-pill">${taskStatusNames[task.status]}</span></td>
        <td>${task.dueDate ?? "未设置"}</td>
        <td>${isTaskOverdue(task, today) ? "已逾期" : "未逾期"}</td>
        <td>${getTaskQuadrant(task.importance, task.urgency)}</td>
        <td class="wide-text">${escapeHtml(task.completionStandard ?? node?.completionStandard ?? "-")}</td>
        <td class="wide-text">${escapeHtml(task.reviewStandard ?? node?.reviewStandard ?? "-")}</td>
        <td class="wide-text">${escapeHtml(task.resultText ?? "暂无")}</td>
        <td>${task.completedAt ?? "未完成"}</td>
        <td><button class="text-button" type="button" data-launched-process-task-id="${task.id}">查看执行任务</button></td>
      </tr>
    `;
  }

  return `
    <tr>
      <td>${escapeHtml(task.name)}</td>
      <td>${getProcessNodeStepOrder(node ?? {})}</td>
      <td><select name="task__${task.id}__ownerId">${renderOptions(people, task.ownerId, "请选择负责人")}</select></td>
      <td><select name="task__${task.id}__departmentId">${renderOptions(departments, task.departmentId, "请选择部门")}</select></td>
      <td><span class="status-pill">${taskStatusNames[task.status]}</span></td>
      <td><input name="task__${task.id}__dueDate" type="date" value="${task.dueDate ?? ""}" /></td>
      <td>${isTaskOverdue(task, today) ? "已逾期" : "未逾期"}</td>
      <td>
        <select name="task__${task.id}__importance">${renderValueOptions(TaskImportance, task.importance, taskImportanceNames, "重要性")}</select>
        <select name="task__${task.id}__urgency">${renderValueOptions(TaskUrgency, task.urgency, taskUrgencyNames, "紧急性")}</select>
      </td>
      <td class="wide-text">${escapeHtml(task.completionStandard ?? node?.completionStandard ?? "-")}</td>
      <td class="wide-text">${escapeHtml(task.reviewStandard ?? node?.reviewStandard ?? "-")}</td>
      <td>
        <input name="task__${task.id}__plannedWeek" value="${task.plannedWeek ?? ""}" placeholder="2026-W27" />
        <select name="task__${task.id}__accepterId">${renderOptions(people, task.accepterId ?? "", "无验收人")}</select>
        <textarea name="task__${task.id}__description" rows="2">${escapeHtml(task.description ?? "")}</textarea>
      </td>
      <td>${task.completedAt ?? "未完成"}</td>
      <td><button class="text-button" type="button" data-launched-process-task-id="${task.id}">查看执行任务</button></td>
    </tr>
  `;
}

export function renderLaunchedProcessDetail(instanceId, options = {}) {
  const instance = getInstance(instanceId);
  if (instance === null) {
    return options.emptyHtml ?? "";
  }

  const editable = canEditInstance(instance);
  const template = getTemplate(instance);
  const taskTemplate = getTaskTemplate(instance);
  const tasks = getInstanceTasks(instance.id);

  return `
    <section class="settings-section process-detail launched-process-detail" data-launched-process-detail="${instance.id}">
      <div class="section-heading with-actions">
        <h2>已发起流程详情：${escapeHtml(instance.displayTitle ?? instance.name)}</h2>
        ${editable ? `<button class="primary-button" type="submit" form="launched-process-form-${instance.id}">保存修改</button>` : `<span class="muted-action">只读</span>`}
      </div>
      <form id="launched-process-form-${instance.id}" class="launched-process-form">
        <div class="form-error" hidden></div>
        <div class="detail-block">
          <h3>基本信息</h3>
          <div class="form-grid">
            <label>
              <span>本次流程名称</span>
              <input name="name" value="${escapeHtml(instance.name)}" ${editable ? "" : "disabled"} />
            </label>
            <label>
              <span>关联目标</span>
              <select name="goalId" ${editable ? "" : "disabled"}>${renderOptions(goals, instance.goalId, "请选择目标")}</select>
            </label>
          </div>
          <div class="detail-grid">
            ${renderDetailField("标准工作事项", escapeHtml(taskTemplate?.name ?? "未关联标准工作事项"))}
            ${renderDetailField("标准流程", `${escapeHtml(template?.name ?? "未设置")} v${instance.templateVersion}`)}
            ${renderDetailField("发起人", findName(people, instance.initiatorId, "未设置"))}
            ${renderDetailField("状态", processInstanceStatusNames[instance.status])}
            ${renderDetailField("步骤进度", getProgress(instance.id))}
            ${renderDetailField("发起时间", instance.startedAt)}
            ${
              instance.status === ProcessInstanceStatus.Canceled
                ? `
                  ${renderDetailField("取消时间", instance.canceledAt ?? "未记录")}
                  ${renderDetailField("取消原因", escapeHtml(instance.cancelReason ?? "未填写"))}
                `
                : ""
            }
          </div>
          <label>
            <span>本次流程说明</span>
            <textarea name="description" rows="3" ${editable ? "" : "disabled"}>${escapeHtml(instance.description ?? "")}</textarea>
          </label>
        </div>
        <div class="detail-block">
          <h3>本次工作表单</h3>
          ${renderCustomFields(instance, editable)}
          <p class="form-note">本表单为发起工作时填写的本次工作要求，不是执行结果。</p>
        </div>
        <div class="detail-block">
          <h3>流程步骤执行任务</h3>
          <div class="table-wrap">
            <table class="data-table process-instance-task-table">
              <thead>
                <tr>
                  <th>步骤名称</th><th>步骤</th><th>负责人</th><th>负责部门</th><th>状态</th><th>截止日期</th><th>是否逾期</th><th>四象限</th><th>步骤完成标准</th><th>步骤审核标准</th><th>输出结果 / 执行安排</th><th>完成时间</th><th>操作</th>
                </tr>
              </thead>
              <tbody>${tasks.map((task) => renderStepTask(task, editable)).join("")}</tbody>
            </table>
          </div>
        </div>
      </form>
    </section>
  `;
}

function showFormError(form, error) {
  const errorElement = form.querySelector(".form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
  }
}

export function bindLaunchedProcessDetailEvents(root, rerender, options = {}) {
  const detail = root.querySelector("[data-launched-process-detail]");
  if (detail === null) return;

  detail.addEventListener("click", (event) => {
    const taskButton = event.target.closest("[data-launched-process-task-id]");
    if (taskButton === null) return;
    options.onTaskSelect?.(taskButton.dataset.launchedProcessTaskId);
  });

  const form = detail.querySelector(".launched-process-form");
  if (form === null) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const instanceId = detail.dataset.launchedProcessDetail;
    const instance = getInstance(instanceId);
    if (instance === null || !canEditInstance(instance)) return;

    const name = getFormValue(form, "name");
    const goalId = getFormValue(form, "goalId");
    const description = getFormValue(form, "description");
    const editableTasks = getInstanceTasks(instanceId).filter(canEditTask);
    const invalidPlannedWeek = editableTasks
      .map((task) => getFormValue(form, `task__${task.id}__plannedWeek`) || null)
      .find((plannedWeek) => plannedWeek !== null && !plannedWeekPattern.test(plannedWeek));
    if (invalidPlannedWeek !== undefined) {
      return showFormError(form, "计划周格式应为 YYYY-WW，例如 2026-W27。");
    }

    const now = getNow();
    const oldGoalId = instance.goalId;
    const customFields = { ...(instance.customFields ?? {}) };
    Object.keys(customFields).forEach((key) => {
      const input = form.elements[`custom__${key}`];
      if (input !== undefined) customFields[key] = input.value.trim();
    });

    state.processInstances = state.processInstances.map((item) =>
      item.id === instanceId ? { ...item, name, goalId, description, customFields, updatedAt: now } : item,
    );

    state.tasks = state.tasks.map((task) => {
      if (task.processInstanceId !== instanceId) return task;
      if (task.status === TaskStatus.Done || task.status === TaskStatus.Canceled) return task;

      const plannedWeek = getFormValue(form, `task__${task.id}__plannedWeek`) || null;

      return {
        ...task,
        goalId: oldGoalId === goalId ? task.goalId : goalId,
        ownerId: getFormValue(form, `task__${task.id}__ownerId`) || task.ownerId,
        departmentId: getFormValue(form, `task__${task.id}__departmentId`) || task.departmentId,
        dueDate: getFormValue(form, `task__${task.id}__dueDate`) || null,
        plannedWeek,
        importance: getFormValue(form, `task__${task.id}__importance`) || task.importance,
        urgency: getFormValue(form, `task__${task.id}__urgency`) || task.urgency,
        accepterId: getFormValue(form, `task__${task.id}__accepterId`) || null,
        description: getFormValue(form, `task__${task.id}__description`) || task.description,
        updatedAt: now,
      };
    });

    rerender();
  });
}
