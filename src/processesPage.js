import {
  createPersistentResource,
  createId,
  getCurrentUser,
  getNow,
  getProcessNodeStepOrder,
  normalizeSubmitRequirement,
  normalizeProcessStepOrders,
  sortProcessNodes,
  startProcess,
  state,
  stopProcess,
  updatePersistentResource,
} from "./appState.js?v=20260627-methods1";
import { hasPermission } from "./permissions.js?v=20260627-methods1";
import {
  CategoryType,
  ProcessAccepterRule,
  ProcessInstanceStatus,
  ProcessOwnerRule,
  ProcessTemplateNodeStatus,
  ProcessTemplateStatus,
  SubmitType,
  TaskImportance,
  TaskStatus,
  TaskUrgency,
  processAccepterRuleNames,
  processInstanceStatusNames,
  processOwnerRuleNames,
  processTemplateNodeStatusNames,
  processTemplateStatusNames,
  submitTypeNames,
  taskImportanceNames,
  taskStatusNames,
  taskUrgencyNames,
} from "./data/modelOptions.js";
import { getTaskQuadrant, isDoneStatus, isHiddenByDefaultStatus, isTaskOverdue } from "./data/taskUtils.js?v=20260627-methods1";
import { bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js?v=20260627-methods1";
import { getMethodologyLinkByNodeId } from "./methodologiesPage.js?v=20260627-methods1";
import { selectTask } from "./tasksPage.js?v=20260627-methods1";

const today = "2026-06-24";
let selectedTemplateId = state.processTemplates[0]?.id ?? null;
let selectedInstanceId = null;
let modalState = null;
let startedProcessFilters = { showDone: false, showCanceled: false };

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let showInactiveTemplates = false;
const categories = state.categories;
const departments = state.departments;
const goals = state.goals;
const people = state.people;
const positions = state.positions;

const stepNumberNames = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const processDepartmentColumns = [
  { title: "视觉部", names: ["视觉部", "视觉营销部"] },
  { title: "供应链", names: ["供应链", "供应链部"] },
  { title: "运营部", names: ["运营部"] },
  { title: "产品部", names: ["产品部"] },
  { title: "综合部", names: ["综合部"] },
];

function shouldShowStartedProcess(instance) {
  if (isDoneStatus(instance.status)) return startedProcessFilters.showDone;
  if (isHiddenByDefaultStatus(instance.status)) return startedProcessFilters.showCanceled;
  return true;
}

function findName(items, id, fallback) {
  if (id === null) return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function findDepartmentByNames(names) {
  return departments.find((department) => names.includes(department.name)) ?? null;
}

function getStandardWorkForTemplate(templateId) {
  return state.taskTemplates.find((template) => template.defaultProcessTemplateId === templateId) ?? null;
}

function getTemplateDepartmentId(template) {
  const standardWork = getStandardWorkForTemplate(template.id);
  if (standardWork?.departmentId) return standardWork.departmentId;
  return template.applicableDepartmentIds?.[0] ?? null;
}

function getActiveTemplateNodeCount(templateId) {
  return state.processTemplateNodes.filter((node) => node.templateId === templateId && node.status === ProcessTemplateNodeStatus.Active).length;
}

function getProcessCategories() {
  return categories.filter((category) => category.type === CategoryType.Process);
}

function getTemplateNodes(templateId) {
  return sortProcessNodes(state.processTemplateNodes.filter((node) => node.templateId === templateId));
}

function shouldShowTemplate(template) {
  return showInactiveTemplates || template.status !== ProcessTemplateStatus.Inactive;
}

function getVisibleProcessTemplates() {
  return state.processTemplates.filter(shouldShowTemplate);
}

function getStepLabel(stepOrder) {
  return stepOrder <= 10 ? `步骤${stepNumberNames[stepOrder]}` : `步骤${stepOrder}`;
}

function syncSelectedTemplateFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith("process-template-")) return;
  const templateId = hash.slice("process-template-".length);
  if (state.processTemplates.some((template) => template.id === templateId)) {
    selectedTemplateId = templateId;
  }
}

function renderOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items
      .map(
        (item) => `
          <option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${item.name}</option>
        `,
      )
      .join("")}
  `;
}

function renderValueOptions(values, selectedValue, names, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${Object.values(values)
      .map(
        (value) => `
          <option value="${value}" ${value === selectedValue ? "selected" : ""}>${names[value]}</option>
        `,
      )
      .join("")}
  `;
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function renderTemplateList() {
  const categorizedTemplateIds = new Set();
  return `
    <section class="settings-section">
      <div class="section-heading with-actions">
        <h2>标准流程</h2>
        <p class="form-note">标准流程通常由标准工作事项自动创建。如需新增标准流程，请优先到标准工作库新增标准工作事项。</p>
        <label class="checkbox-field process-filter-checkbox">
          <input type="checkbox" data-show-inactive-processes ${showInactiveTemplates ? "checked" : ""} />
          <span>显示停用流程</span>
        </label>
        ${canCurrentUser("processes.editTemplates") ? `<button class="primary-button" type="button" data-action="add-template">新增标准流程</button>` : ""}
      </div>
      <div class="standard-work-board-wrap">
        <div class="standard-work-board process-template-board">
          ${processDepartmentColumns
            .map((column) => {
              const department = findDepartmentByNames(column.names);
              const templates = getVisibleProcessTemplates().filter((template) => getTemplateDepartmentId(template) === department?.id);
              templates.forEach((template) => categorizedTemplateIds.add(template.id));
              return `
                <section class="standard-work-column">
                  <div class="standard-work-column-header">
                    <h3>${column.title}</h3>
                    <span>${templates.length} 个</span>
                  </div>
                  <div class="standard-work-card-list">
                    ${
                      templates.length === 0
                        ? `<div class="empty-note">${showInactiveTemplates ? "暂无标准流程" : "暂无启用流程"}</div>`
                        : templates.map((template) => renderProcessTemplateCard(template)).join("")
                    }
                  </div>
                </section>
              `;
            })
            .join("")}
          ${renderUncategorizedTemplateColumn(categorizedTemplateIds)}
        </div>
      </div>
    </section>
  `;
}

function renderTemplateStepCount(templateId) {
  const count = getActiveTemplateNodeCount(templateId);
  return count === 0 ? `<span class="status-pill is-danger">未配置步骤</span>` : `${count} 个步骤`;
}

function renderProcessTemplateCard(template, isUncategorized = false) {
  const standardWork = getStandardWorkForTemplate(template.id);
  return `
    <article class="standard-work-card process-template-card ${template.id === selectedTemplateId ? "is-selected" : ""} ${template.status === ProcessTemplateStatus.Inactive ? "is-inactive" : ""}" data-template-id="${template.id}">
      <div class="standard-work-card-title">
        <h4>${template.name}</h4>
        <span class="status-pill ${template.status === ProcessTemplateStatus.Inactive ? "is-inactive" : ""}">${processTemplateStatusNames[template.status]}</span>
      </div>
      <div class="standard-work-card-meta">
        <span>对应标准工作事项</span>
        <strong>${standardWork?.name ?? "未绑定标准工作事项"}</strong>
      </div>
      ${isUncategorized ? `<p class="form-note">该流程未绑定标准工作事项或部门。</p>` : ""}
      <div class="standard-work-card-meta">
        <span>流程负责人</span>
        <strong>${findName(people, template.ownerId, "未设置")}</strong>
      </div>
      <div class="standard-work-card-meta">
        <span>流程步骤</span>
        <strong>${renderTemplateStepCount(template.id)}</strong>
      </div>
      <div class="standard-work-card-meta">
        <span>版本 / 更新时间</span>
        <strong>v${template.version} · ${template.updatedAt}</strong>
      </div>
      <div class="standard-work-card-actions">
        <button class="text-button" type="button" data-action="select-template" data-template-id="${template.id}">查看流程</button>
        ${canCurrentUser("processes.editSteps") ? `<button class="text-button" type="button" data-action="add-node" data-template-id="${template.id}" onclick="window.__handleProcessNodeAction?.(this, event)">编辑流程步骤</button>` : ""}
        ${canCurrentUser("processes.editTemplates") ? `<button class="text-button danger-button" type="button" data-action="deactivate-template" data-template-id="${template.id}">停用流程</button>` : ""}
      </div>
    </article>
  `;
}

function renderUncategorizedTemplateColumn(categorizedTemplateIds) {
  const templates = getVisibleProcessTemplates().filter((template) => !categorizedTemplateIds.has(template.id));
  if (templates.length === 0) return "";
  return `
    <section class="standard-work-column">
      <div class="standard-work-column-header">
        <h3>未分类流程</h3>
        <span>${templates.length} 个</span>
      </div>
      <div class="standard-work-card-list">
        ${templates.map((template) => renderProcessTemplateCard(template, true)).join("")}
      </div>
    </section>
  `;
}

function renderDetailField(label, value) {
  return `<div class="detail-field"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderTemplateNodes(templateId) {
  const nodes = getTemplateNodes(templateId);
  return `
    <div class="process-node-list">
      ${nodes
        .map(
          (node, index) => {
            const stepOrder = getProcessNodeStepOrder(node);
            return `
            <article class="process-node">
              <div class="process-node-header">
                <div>
                  <strong>${getStepLabel(stepOrder)}</strong>
                  <h4>${node.name}</h4>
                </div>
                <span class="row-actions">
                  <span class="status-pill ${node.status === ProcessTemplateNodeStatus.Inactive ? "is-inactive" : ""}">${processTemplateNodeStatusNames[node.status]}</span>
                  ${canCurrentUser("processes.sortSteps") && index !== 0 ? `<button class="text-button" type="button" data-action="move-node-up" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">上移</button>` : ""}
                  ${canCurrentUser("processes.sortSteps") && index !== nodes.length - 1 ? `<button class="text-button" type="button" data-action="move-node-down" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">下移</button>` : ""}
                  ${canCurrentUser("processes.editSteps") ? `<button class="text-button" type="button" data-action="edit-node" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">编辑</button>` : ""}
                  ${getMethodologyLinkByNodeId(node.id)}
                  ${canCurrentUser("processes.editSteps") ? `<button class="text-button danger-button" type="button" data-action="deactivate-node" data-node-id="${node.id}">停用</button>` : ""}
                </span>
              </div>
              <div class="detail-grid">
                ${renderDetailField("步骤", getStepLabel(stepOrder))}
                ${renderDetailField("负责部门", findName(departments, node.departmentId ?? node.ownerDepartmentId, "未设置"))}
                ${renderDetailField("负责人", findName(people, node.ownerId ?? node.defaultOwnerId, "未设置"))}
                ${renderDetailField("执行人", findName(people, node.executorId, "同负责人"))}
                ${renderDetailField("限时完成", `${node.durationDays} 天`)}
                ${renderDetailField("状态", processTemplateNodeStatusNames[node.status])}
              </div>
              <div class="process-node-copy">
                <p><strong>步骤说明：</strong>${node.description}</p>
                <p><strong>完成标准：</strong>${node.completionStandard}</p>
              </div>
            </article>
          `;
          },
        )
        .join("")}
    </div>
  `;
}

function renderTemplateDetail() {
  const visibleTemplates = getVisibleProcessTemplates();
  const template = visibleTemplates.find((item) => item.id === selectedTemplateId) ?? visibleTemplates[0] ?? state.processTemplates[0];
  if (template === undefined) {
    return `
      <section class="settings-section process-detail">
        <div class="section-heading"><h2>标准流程详情</h2></div>
        <div class="empty-note">暂无标准流程</div>
      </section>
    `;
  }
  const departmentNames = template.applicableDepartmentIds
    .map((departmentId) => findName(departments, departmentId, "未设置"))
    .join("、");

  return `
    <section class="settings-section process-detail">
      <div class="section-heading with-actions">
        <h2>标准流程详情</h2>
        <div class="section-actions">
          ${canCurrentUser("processes.editTemplates") ? `<button class="secondary-button" type="button" data-action="edit-template" data-template-id="${template.id}">编辑流程</button>` : ""}
          ${canCurrentUser("workPlans.launch") ? `<button class="primary-button" type="button" data-action="start-process" data-template-id="${template.id}">发起标准流程</button>` : ""}
          ${canCurrentUser("processes.editSteps") ? `<button class="secondary-button" type="button" data-action="add-node" data-template-id="${template.id}" onclick="window.__handleProcessNodeAction?.(this, event)">新增流程步骤</button>` : ""}
        </div>
      </div>
      <div class="detail-block">
        <h3>基本信息</h3>
        <div class="detail-grid">
          ${renderDetailField("流程名称", template.name)}
          ${renderDetailField("流程分类", findName(categories, template.categoryId, "未设置"))}
          ${renderDetailField("适用部门", departmentNames)}
          ${renderDetailField("流程负责人", findName(people, template.ownerId, "未设置"))}
          ${renderDetailField("版本号", `v${template.version}`)}
          ${renderDetailField("状态", processTemplateStatusNames[template.status])}
        </div>
      </div>
      <div class="detail-block">
        <h3>流程说明</h3>
        <p>流程目的：${template.purpose}</p>
        <p>发起条件：${template.startCondition}</p>
        <p>完成条件：${template.completionCondition}</p>
        <p>整体标准：${template.overallStandard}</p>
      </div>
      <div class="detail-block">
        <h3>流程步骤</h3>
        ${renderTemplateNodes(template.id)}
      </div>
    </section>
  `;
}

function getInstanceTasks(instanceId) {
  return state.tasks.filter((task) => task.processInstanceId === instanceId);
}

function getCurrentStep(instance) {
  const activeTask = getInstanceTasks(instance.id).find((task) =>
    [TaskStatus.Todo, TaskStatus.Doing, TaskStatus.PendingAcceptance].includes(task.status),
  );
  const node = state.processTemplateNodes.find((item) => item.id === activeTask?.processNodeId);
  return node?.name ?? "-";
}

function renderStartedProcesses() {
  const visibleInstances = state.processInstances.filter(shouldShowStartedProcess);

  if (state.processInstances.length === 0) {
    return `
      <section class="settings-section">
        <div class="section-heading"><h2>已发起流程</h2></div>
        <div class="empty-detail">暂未发起流程，下一步将实现流程发起功能。</div>
      </section>
    `;
  }

  return `
    <section class="settings-section">
      <div class="section-heading"><h2>已发起流程</h2></div>
      <form class="task-filters started-process-filters" aria-label="已发起流程筛选">
        <label class="checkbox-field task-filter-checkbox">
          <input name="showDone" type="checkbox" ${startedProcessFilters.showDone ? "checked" : ""} />
          <span>显示已完成</span>
        </label>
        <label class="checkbox-field task-filter-checkbox">
          <input name="showCanceled" type="checkbox" ${startedProcessFilters.showCanceled ? "checked" : ""} />
          <span>显示已取消</span>
        </label>
        <p class="form-note">已取消的数据默认隐藏，可勾选显示已取消查看。</p>
      </form>
      <div class="table-wrap">
        <table class="data-table process-table">
          <thead>
            <tr><th>已发起流程名称</th><th>标准流程</th><th>关联目标</th><th>发起人</th><th>当前步骤</th><th>步骤进度</th><th>状态</th><th>发起时间</th><th>完成时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${visibleInstances.length === 0 ? `<tr><td colspan="10">暂无匹配的已发起流程</td></tr>` : visibleInstances
              .map((instance) => {
                const instanceTasks = getInstanceTasks(instance.id);
                const doneCount = instanceTasks.filter((task) => task.status === TaskStatus.Done).length;
                return `
                  <tr class="${instance.id === selectedInstanceId ? "is-selected" : ""}" data-instance-id="${instance.id}">
                    <td>${instance.name}</td>
                    <td>${findName(state.processTemplates, instance.templateId, "未设置")}</td>
                    <td>${findName(goals, instance.goalId, "未设置")}</td>
                    <td>${findName(people, instance.initiatorId, "未设置")}</td>
                    <td>${getCurrentStep(instance)}</td>
                    <td>${doneCount} / ${instanceTasks.length}</td>
                    <td><span class="status-pill">${processInstanceStatusNames[instance.status]}</span></td>
                    <td>${instance.startedAt}</td>
                    <td>${instance.completedAt ?? "-"}</td>
                    <td>
                      <span class="row-actions">
                        <button class="text-button" type="button" data-action="view-process-instance" data-instance-id="${instance.id}">查看</button>
                        ${instance.status === ProcessInstanceStatus.Running && canCurrentUser("processes.editInstances") ? `<button class="text-button danger-button" type="button" data-action="stop-process" data-instance-id="${instance.id}">终止</button>` : ""}
                      </span>
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    ${visibleInstances.some((instance) => instance.id === selectedInstanceId) ? renderInstanceDetail() : ""}
  `;
}

function renderInstanceDetail() {
  return renderLaunchedProcessDetail(selectedInstanceId, { emptyHtml: "" });
}

function renderTemplateModal() {
  if (modalState?.kind !== "template") return "";
  const template = modalState.id ? state.processTemplates.find((item) => item.id === modalState.id) : null;
  const applicableDepartmentIds = Array.isArray(template?.applicableDepartmentIds) ? template.applicableDepartmentIds : [];
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header"><h2>${template ? "编辑标准流程" : "新增标准流程"}</h2><button class="icon-button" type="button" data-action="close-process-modal">×</button></div>
      <form class="modal-form process-template-form">
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
        <label><span>流程名称</span><input name="name" value="${template?.name ?? ""}" /></label>
        <div class="form-grid">
          <label><span>流程分类</span><select name="categoryId">${renderOptions(getProcessCategories(), template?.categoryId ?? "", "请选择流程分类")}</select></label>
          <label><span>流程负责人</span><select name="ownerId">${renderOptions(people, template?.ownerId ?? "", "请选择负责人")}</select></label>
        </div>
        <label><span>适用部门</span><select name="applicableDepartmentIds" multiple>${departments.map((department) => `<option value="${department.id}" ${applicableDepartmentIds.includes(department.id) ? "selected" : ""}>${department.name}</option>`).join("")}</select></label>
        <label><span>流程目的</span><textarea name="purpose">${template?.purpose ?? ""}</textarea></label>
        <label><span>发起条件</span><textarea name="startCondition">${template?.startCondition ?? ""}</textarea></label>
        <label><span>完成条件</span><textarea name="completionCondition">${template?.completionCondition ?? ""}</textarea></label>
        <label><span>整体标准</span><textarea name="overallStandard">${template?.overallStandard ?? ""}</textarea></label>
        <label><span>状态</span><select name="status">${renderValueOptions(ProcessTemplateStatus, template?.status ?? ProcessTemplateStatus.Active, processTemplateStatusNames, "请选择状态")}</select></label>
        <div class="modal-actions"><button class="secondary-button" type="button" data-action="close-process-modal">取消</button><button class="primary-button" type="submit">保存</button></div>
      </form>
    </div></div>
  `;
}

function renderNodeModal() {
  if (modalState?.kind !== "node") return "";
  const node = modalState.id ? state.processTemplateNodes.find((item) => item.id === modalState.id) : null;
  const submitRequirement = normalizeSubmitRequirement(node ?? { name: "" });
  const submitFieldsJson = JSON.stringify(submitRequirement.submitFields ?? [], null, 2);
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header"><h2>${node ? "编辑流程步骤" : "新增流程步骤"}</h2><button class="icon-button" type="button" data-action="close-process-modal">×</button></div>
      <form class="modal-form process-node-form">
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
        <div class="form-grid">
          <label><span>步骤名称</span><input name="name" value="${node?.name ?? ""}" /></label>
          <label><span>负责部门</span><select name="departmentId">${renderOptions(departments, node?.departmentId ?? node?.ownerDepartmentId ?? "", "请选择部门")}</select></label>
          <label><span>负责人</span><select name="ownerId">${renderOptions(people, node?.ownerId ?? node?.defaultOwnerId ?? "", "请选择负责人")}</select></label>
          <label><span>执行人</span><select name="executorId">${renderOptions(people, node?.executorId ?? "", "同负责人")}</select></label>
          <label><span>限时完成（天）</span><input name="durationDays" value="${node?.durationDays ?? 1}" /></label>
          <label><span>状态</span><select name="status">${renderValueOptions(ProcessTemplateNodeStatus, node?.status ?? ProcessTemplateNodeStatus.Active, processTemplateNodeStatusNames, "请选择状态")}</select></label>
        </div>
        <label><span>步骤说明</span><textarea name="description">${node?.description ?? ""}</textarea></label>
        <label><span>完成标准</span><textarea name="completionStandard">${node?.completionStandard ?? ""}</textarea></label>
        <div class="form-subsection">
          <h3>提交要求</h3>
          <div class="form-grid">
            <label><span>提交类型</span><select name="submitType">${renderValueOptions(SubmitType, submitRequirement.submitType, submitTypeNames, "请选择提交类型")}</select></label>
            <label class="checkbox-field"><input type="checkbox" name="requireFile" ${submitRequirement.requireFile ? "checked" : ""} /> <span>需要上传文件</span></label>
            <label class="checkbox-field"><input type="checkbox" name="requireLink" ${submitRequirement.requireLink ? "checked" : ""} /> <span>需要填写链接</span></label>
          </div>
          <label><span>提交说明</span><textarea name="submitDescription">${escapeHtml(submitRequirement.submitDescription ?? "")}</textarea></label>
          <label>
            <span>表单字段配置（JSON）</span>
            <textarea name="submitFieldsJson" rows="8" spellcheck="false">${escapeHtml(submitFieldsJson)}</textarea>
          </label>
          <p class="form-note">字段格式：label、key、type、required、placeholder、options、sortOrder。type 支持 text、textarea、number、date、select、multi_select、url。</p>
        </div>
        <div class="modal-actions"><button class="secondary-button" type="button" data-action="close-process-modal">取消</button><button class="primary-button" type="submit">保存</button></div>
      </form>
    </div></div>
  `;
}

function renderStartModal() {
  if (modalState?.kind !== "start") return "";
  const template = state.processTemplates.find((item) => item.id === modalState.templateId);
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header"><h2>发起标准流程</h2><button class="icon-button" type="button" data-action="close-process-modal">×</button></div>
      <form class="modal-form process-start-form">
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
        <label><span>标准流程</span><select name="templateId">${renderOptions(state.processTemplates.filter((item) => item.status === ProcessTemplateStatus.Active), template.id, "请选择标准流程")}</select></label>
        <label><span>已发起流程名称</span><input name="name" value="${template.name}" /></label>
        <div class="form-grid">
          <label><span>关联目标</span><select name="goalId">${renderOptions(goals, "", "请选择目标")}</select></label>
          <label><span>发起人</span><select name="initiatorId">${renderOptions(people, "", "请选择发起人")}</select></label>
        </div>
        <label><span>本次流程说明</span><textarea name="description"></textarea></label>
        <div class="modal-actions"><button class="secondary-button" type="button" data-action="close-process-modal">取消</button><button class="primary-button" type="submit">发起</button></div>
      </form>
    </div></div>
  `;
}

function setModalError(error) {
  modalState = { ...modalState, error };
  const errorElement = document.querySelector(".modal-form .form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
  }
}

async function saveTemplate(form, rerender) {
  const data = new FormData(form);
  const draft = {
    name: getFormValue(form, "name"),
    categoryId: getFormValue(form, "categoryId") || null,
    applicableDepartmentIds: data.getAll("applicableDepartmentIds").map(String),
    ownerId: getFormValue(form, "ownerId"),
    purpose: getFormValue(form, "purpose"),
    startCondition: getFormValue(form, "startCondition"),
    completionCondition: getFormValue(form, "completionCondition"),
    overallStandard: getFormValue(form, "overallStandard"),
    status: getFormValue(form, "status") || ProcessTemplateStatus.Active,
  };
  if (draft.name === "") return setModalError("请填写流程名称。");
  if (draft.ownerId === "") return setModalError("请选择流程负责人。");
  const now = getNow();
  if (modalState.id) {
    const existingTemplate = state.processTemplates.find((template) => template.id === modalState.id);
    if (existingTemplate === undefined) return setModalError("未找到要编辑的流程模板。");
    const updatedTemplate = { ...existingTemplate, ...draft, version: existingTemplate.version + 1, updatedAt: now };
    try {
      await updatePersistentResource("process-templates", existingTemplate.id, updatedTemplate);
    } catch (error) {
      console.error("流程模板保存失败", error);
      return setModalError(error.message || "流程模板保存失败，请检查本地数据库服务。");
    }
    state.processTemplates = state.processTemplates.map((template) => (template.id === existingTemplate.id ? updatedTemplate : template));
  } else {
    const template = { id: createId("process-template"), ...draft, status: ProcessTemplateStatus.Active, version: 1, createdAt: now, updatedAt: now };
    try {
      await createPersistentResource("process-templates", template);
    } catch (error) {
      console.error("流程模板保存失败", error);
      return setModalError(error.message || "流程模板保存失败，请检查本地数据库服务。");
    }
    state.processTemplates = [template, ...state.processTemplates];
    selectedTemplateId = template.id;
  }
  modalState = null;
  rerender();
}

async function saveNode(form, rerender) {
  const durationDays = Number(getFormValue(form, "durationDays"));
  let submitFields = [];
  try {
    submitFields = JSON.parse(getFormValue(form, "submitFieldsJson") || "[]");
    if (!Array.isArray(submitFields)) throw new Error("invalid");
  } catch {
    return setModalError("表单字段配置必须是合法 JSON 数组。", rerender);
  }
  const existingNode = modalState.id ? state.processTemplateNodes.find((node) => node.id === modalState.id) : null;
  const nextStepOrder =
    existingNode === null
      ? Math.max(0, ...getTemplateNodes(selectedTemplateId).map((node) => getProcessNodeStepOrder(node))) + 1
      : getProcessNodeStepOrder(existingNode);
  const draft = {
    name: getFormValue(form, "name"),
    stepOrder: nextStepOrder,
    stageName: "默认流程",
    stageOrder: nextStepOrder,
    nodeOrder: nextStepOrder,
    departmentId: getFormValue(form, "departmentId"),
    ownerId: getFormValue(form, "ownerId"),
    executorId: getFormValue(form, "executorId") || null,
    ownerRule: ProcessOwnerRule.FixedPerson,
    ownerDepartmentId: getFormValue(form, "departmentId"),
    ownerPositionId: null,
    defaultOwnerId: getFormValue(form, "ownerId"),
    durationDays,
    description: getFormValue(form, "description"),
    completionStandard: getFormValue(form, "completionStandard"),
    reviewStandard: null,
    defaultImportance: existingNode?.defaultImportance ?? TaskImportance.Important,
    defaultUrgency: existingNode?.defaultUrgency ?? TaskUrgency.NotUrgent,
    needAcceptance: false,
    accepterRule: ProcessAccepterRule.None,
    defaultAccepterId: null,
    outputRequirement: null,
    submitType: getFormValue(form, "submitType") || SubmitType.None,
    submitDescription: getFormValue(form, "submitDescription"),
    submitFields,
    requireFile: form.elements.requireFile?.checked ?? false,
    requireLink: form.elements.requireLink?.checked ?? false,
    status: getFormValue(form, "status") || ProcessTemplateNodeStatus.Active,
  };
  const emptySubmitDefault = normalizeSubmitRequirement({ name: "" });
  const shouldInferSubmitForNewNode =
    existingNode === null &&
    draft.submitType === emptySubmitDefault.submitType &&
    draft.submitDescription === emptySubmitDefault.submitDescription &&
    JSON.stringify(draft.submitFields) === JSON.stringify(emptySubmitDefault.submitFields) &&
    !draft.requireFile &&
    !draft.requireLink;
  if (shouldInferSubmitForNewNode) {
    Object.assign(draft, normalizeSubmitRequirement({ name: draft.name }));
  }
  if (!Number.isFinite(durationDays)) draft.durationDays = 1;
  const now = getNow();
  if (modalState.id) {
    const existingNode = state.processTemplateNodes.find((node) => node.id === modalState.id);
    if (existingNode === undefined) return setModalError("未找到要编辑的流程步骤。");
    const updatedNode = { ...existingNode, ...draft, updatedAt: now };
    try {
      await updatePersistentResource("process-template-nodes", existingNode.id, updatedNode);
    } catch (error) {
      console.error("流程步骤保存失败", error);
      return setModalError(error.message || "流程步骤保存失败，请检查本地数据库服务。");
    }
    state.processTemplateNodes = state.processTemplateNodes.map((node) => (node.id === existingNode.id ? updatedNode : node));
  } else {
    const createdNode = { id: createId("process-node"), templateId: selectedTemplateId, ...draft, status: ProcessTemplateNodeStatus.Active, createdAt: now, updatedAt: now };
    try {
      await createPersistentResource("process-template-nodes", createdNode);
    } catch (error) {
      console.error("流程步骤保存失败", error);
      return setModalError(error.message || "流程步骤保存失败，请检查本地数据库服务。");
    }
    state.processTemplateNodes = [...state.processTemplateNodes, createdNode];
    if (!state.methodologies.some((methodology) => methodology.processNodeId === createdNode.id)) {
      const standardWork = getStandardWorkForTemplate(createdNode.templateId);
      state.methodologies = [
        {
          id: `methodology-${createdNode.id}`,
          title: `${createdNode.name.replaceAll("+", "").trim()}操作说明`,
          processTemplateId: createdNode.templateId,
          processNodeId: createdNode.id,
          standardWorkId: standardWork?.id ?? "",
          taskTemplateId: standardWork?.id ?? "",
          description: "",
          steps: [],
          createdAt: createdNode.createdAt,
          updatedAt: createdNode.updatedAt,
        },
        ...state.methodologies,
      ];
    }
  }
  normalizeProcessStepOrders(selectedTemplateId);
  modalState = null;
  rerender();
}

async function moveNode(nodeId, direction) {
  const node = state.processTemplateNodes.find((item) => item.id === nodeId);
  if (node === undefined) return;

  const nodes = getTemplateNodes(node.templateId);
  const currentIndex = nodes.findIndex((item) => item.id === nodeId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= nodes.length) return;

  const reorderedNodes = [...nodes];
  [reorderedNodes[currentIndex], reorderedNodes[targetIndex]] = [reorderedNodes[targetIndex], reorderedNodes[currentIndex]];
  const now = getNow();
  const orderById = new Map(reorderedNodes.map((item, index) => [item.id, index + 1]));

  const updatedNodes = state.processTemplateNodes.map((item) => {
    const stepOrder = orderById.get(item.id);
    if (stepOrder === undefined) return item;
    return {
      ...item,
      stepOrder,
      stageOrder: stepOrder,
      nodeOrder: stepOrder,
      updatedAt: now,
    };
  });
  const changedNodes = updatedNodes.filter((item) => orderById.has(item.id));
  try {
    for (const changedNode of changedNodes) {
      await updatePersistentResource("process-template-nodes", changedNode.id, changedNode);
    }
  } catch (error) {
    console.error("流程步骤排序保存失败", error);
    window.alert(error.message || "流程步骤排序保存失败，请检查本地数据库服务。");
    return;
  }
  state.processTemplateNodes = updatedNodes;
  normalizeProcessStepOrders(node.templateId);
}

function submitStart(form, rerender) {
  const template = state.processTemplates.find((item) => item.id === getFormValue(form, "templateId")) ?? state.processTemplates.find((item) => item.status === ProcessTemplateStatus.Active) ?? null;
  if (template === null) return setModalError("暂无可发起的标准流程。", rerender);
  const templateId = template.id;
  const name = getFormValue(form, "name") || template.name;
  const goalId = getFormValue(form, "goalId") || goals[0]?.id || "";
  const initiatorId = getFormValue(form, "initiatorId") || people[0]?.id || "";
  const result = startProcess({
    templateId,
    name,
    goalId,
    initiatorId,
    description: getFormValue(form, "description"),
    launchAssignments: { owner: {}, accepter: {} },
  });
  if (result.error) return setModalError(result.error, rerender);
  selectedInstanceId = result.instance.id;
  modalState = null;
  rerender();
}

async function handleProcessNodeAction(actionButton, rerender) {
  const action = actionButton.dataset.action;
  if (action === "add-node") {
    if (actionButton.dataset.templateId) selectedTemplateId = actionButton.dataset.templateId;
    modalState = { kind: "node", error: "" };
    rerender();
    return true;
  }
  if (action === "edit-node") {
    modalState = { kind: "node", id: actionButton.dataset.nodeId, error: "" };
    rerender();
    return true;
  }
  if (action === "move-node-up" || action === "move-node-down") {
    await moveNode(actionButton.dataset.nodeId, action === "move-node-up" ? "up" : "down");
    rerender();
    return true;
  }
  return false;
}

export function bindProcessesPageEvents(rerender) {
  const page = document.querySelector(".processes-page");
  const templateForm = document.querySelector(".process-template-form");
  const nodeForm = document.querySelector(".process-node-form");
  const startForm = document.querySelector(".process-start-form");
  const startedProcessFilterForm = document.querySelector(".started-process-filters");
  if (page === null) return;

  window.__handleProcessNodeAction = async (button, event) => {
    event?.preventDefault();
    event?.stopPropagation();
    await handleProcessNodeAction(button, rerender);
  };

  page.addEventListener("click", async (event) => {
    const actionButton = event.target.closest('button[data-action="add-node"], button[data-action="edit-node"], button[data-action="move-node-up"], button[data-action="move-node-down"]');
    if (actionButton === null) return;
    event.preventDefault();
    event.stopPropagation();
    await handleProcessNodeAction(actionButton, rerender);
  }, { capture: true });

  if (startedProcessFilterForm !== null) {
    startedProcessFilterForm.addEventListener("change", () => {
      const formData = new FormData(startedProcessFilterForm);
      startedProcessFilters = { showDone: formData.has("showDone"), showCanceled: formData.has("showCanceled") };
      rerender();
    });
  }

  page.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton !== null) {
      const action = actionButton.dataset.action;
      if (action === "close-process-modal") modalState = null;
      if (action === "add-template" && canCurrentUser("processes.editTemplates")) modalState = { kind: "template", error: "" };
      if (action === "select-template") selectedTemplateId = actionButton.dataset.templateId;
      if (action === "edit-template" && canCurrentUser("processes.editTemplates")) modalState = { kind: "template", id: actionButton.dataset.templateId, error: "" };
      if (action === "start-process" && canCurrentUser("workPlans.launch")) modalState = { kind: "start", templateId: actionButton.dataset.templateId, error: "" };
      if (action === "view-process-instance") selectedInstanceId = actionButton.dataset.instanceId;
      if (action === "deactivate-template" && canCurrentUser("processes.editTemplates")) {
        const now = getNow();
        state.processTemplates = state.processTemplates.map((template) =>
          template.id === actionButton.dataset.templateId ? { ...template, status: ProcessTemplateStatus.Inactive, updatedAt: now } : template,
        );
      }
      if (action === "deactivate-node" && canCurrentUser("processes.editSteps")) {
        const now = getNow();
        const node = state.processTemplateNodes.find((item) => item.id === actionButton.dataset.nodeId);
        if (node !== undefined) {
          const updatedNode = { ...node, status: ProcessTemplateNodeStatus.Inactive, updatedAt: now };
          try {
            await updatePersistentResource("process-template-nodes", updatedNode.id, updatedNode);
          } catch (error) {
            console.error("流程步骤停用失败", error);
            window.alert(error.message || "流程步骤停用失败，请检查本地数据库服务。");
            return;
          }
          state.processTemplateNodes = state.processTemplateNodes.map((item) => (item.id === updatedNode.id ? updatedNode : item));
        }
      }
      if (action === "stop-process" && canCurrentUser("processes.editInstances") && window.confirm("确定要终止该流程吗？未完成流程步骤执行任务将自动取消。")) {
        stopProcess(actionButton.dataset.instanceId);
      }
      if (action === "select-process-task") {
        selectTask(actionButton.dataset.taskId);
        window.alert("已选中该任务，请切换到执行查看详情。");
      }
      rerender();
      return;
    }
    const templateRow = event.target.closest("[data-template-id]");
    const instanceRow = event.target.closest("[data-instance-id]");
    if (templateRow !== null) selectedTemplateId = templateRow.dataset.templateId;
    if (instanceRow !== null) selectedInstanceId = instanceRow.dataset.instanceId;
    if (templateRow !== null || instanceRow !== null) rerender();
  });

  page.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-show-inactive-processes]");
    if (checkbox === null) return;
    showInactiveTemplates = checkbox.checked;
    if (!showInactiveTemplates) {
      const selectedTemplate = state.processTemplates.find((template) => template.id === selectedTemplateId);
      if (selectedTemplate?.status === ProcessTemplateStatus.Inactive) {
        selectedTemplateId = getVisibleProcessTemplates()[0]?.id ?? selectedTemplateId;
      }
    }
    rerender();
  });

  if (templateForm !== null) templateForm.addEventListener("submit", (event) => { event.preventDefault(); saveTemplate(event.target, rerender); });
  if (nodeForm !== null) nodeForm.addEventListener("submit", async (event) => { event.preventDefault(); await saveNode(event.target, rerender); });
  if (startForm !== null) startForm.addEventListener("submit", (event) => { event.preventDefault(); submitStart(event.target, rerender); });
  bindLaunchedProcessDetailEvents(page, rerender, {
    onTaskSelect: (taskId) => {
      selectTask(taskId);
      window.alert("已选中该执行任务，请切换到执行查看详情。");
    },
  });
}

export function renderProcessesPage() {
  syncSelectedTemplateFromHash();
  return `
    <div class="processes-page">
      <div class="settings-tabs" aria-label="流程分区">
        ${canCurrentUser("processes.viewTemplates") ? `<a href="#process-templates">标准流程</a>` : ""}
        ${canCurrentUser("processes.viewInstances") ? `<a href="#started-processes">已发起流程</a>` : ""}
      </div>
      ${canCurrentUser("processes.viewTemplates") ? `
        <div id="process-templates" class="process-section">
          ${renderTemplateList()}
          ${renderTemplateDetail()}
        </div>
      ` : ""}
      ${canCurrentUser("processes.viewInstances") ? `
        <div id="started-processes" class="process-section">
          ${renderStartedProcesses()}
        </div>
      ` : ""}
      ${renderTemplateModal()}
      ${renderNodeModal()}
      ${renderStartModal()}
    </div>
  `;
}
