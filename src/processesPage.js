import {
  createPersistentResource,
  createId,
  deletePersistentResource,
  formatProcessStepLabel,
  getCurrentUser,
  getNow,
  getProcessNodeStepOrder,
  launchWorkPlanDraftAsProcess,
  normalizeSubmitRequirement,
  normalizeProcessStepOrders,
  sortProcessNodes,
  state,
  stopProcess,
  updateProcessTemplateNodeStatus,
  updatePersistentResource,
} from "./appState.js?v=20260705-state-singleton1";
import { canLaunchActionTemplate, hasPermission } from "./permissions.js?v=20260724-action-launch-permissions1";
import {
  CategoryType,
  GoalStatus,
  ProcessAccepterRule,
  ProcessInstanceStatus,
  ProcessOwnerRule,
  ProcessTemplateNodeStatus,
  ProcessTemplateStatus,
  SubmitType,
  TaskStatus,
  WorkPlanStatus,
  WorkType,
  getValueModuleName,
  inferValueModuleIdFromText,
  isValueModuleId,
  processAccepterRuleNames,
  processOwnerRuleNames,
  processTemplateNodeStatusNames,
  processTemplateStatusNames,
  submitTypeNames,
  taskStatusNames,
  valueModuleList,
} from "./data/modelOptions.js?v=20260705-state-singleton1";
import { isDoneStatus, isHiddenByDefaultStatus, isTaskOverdue } from "./data/taskUtils.js?v=20260705-state-singleton1";
import { getProcessInstanceBusinessStatus as selectProcessInstanceBusinessStatus } from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
import { bindLaunchedProcessDetailEvents, renderLaunchedProcessDetail } from "./processInstanceDetail.js?v=20260803-action-product-manual-link1";
import { getMethodologyLinkByNodeId } from "./methodologiesPage.js?v=20260802-template-center-v22";
import { bindActionProductSelectors, collectActionProductIds, renderActionProductSelector } from "./actionProductRelations.js?v=20260803-action-product-manual-link1";
import { bindStandardWorkLibraryEvents, openTaskTemplateLaunchModal, renderStandardWorkLibraryPage } from "./actionStandardsPage.js?v=20260803-action-product-manual-link1";
import { selectTask } from "./tasksPage.js?v=20260724-action-template-link1";

const today = "2026-06-24";
let selectedTemplateId = state.processTemplates[0]?.id ?? null;
let selectedInstanceId = null;
let modalState = null;
let startedProcessFilters = { showDone: false, showCanceled: false };

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

function getActiveGoals() {
  return state.goals.filter((goal) => goal.status !== GoalStatus.Inactive);
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
const processExecutorInitiatorRule = "initiator";

function shouldShowStartedProcess(instance) {
  if (isDoneStatus(instance.status)) return startedProcessFilters.showDone;
  if (isHiddenByDefaultStatus(instance.status)) return startedProcessFilters.showCanceled;
  return true;
}

function findName(items, id, fallback) {
  if (id === null) return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function getCurrentUserId() {
  const currentUser = getCurrentUser();
  return currentUser?.personId ?? currentUser?.id ?? "";
}

function getStandardWorkForTemplate(templateId) {
  return state.taskTemplates.find((template) => template.defaultProcessTemplateId === templateId) ?? null;
}

function canCurrentUserLaunchProcessTemplate(templateId) {
  const standardWork = getStandardWorkForTemplate(templateId);
  return standardWork !== null && canLaunchActionTemplate(getCurrentUser(), standardWork.id);
}

function getLaunchableProcessTemplates() {
  return state.processTemplates.filter(
    (template) =>
      template.status === ProcessTemplateStatus.Active &&
      canCurrentUserLaunchProcessTemplate(template.id),
  );
}

function getLaunchedInstancesForTemplate(templateId) {
  return state.processInstances.filter((instance) => instance.templateId === templateId);
}

function getActiveTemplateNodeCount(templateId) {
  return state.processTemplateNodes.filter((node) => node.templateId === templateId && node.status === ProcessTemplateNodeStatus.Active).length;
}

function getValueChainCategoryByModuleId(valueModuleId) {
  const moduleName = getValueModuleName(valueModuleId, "");
  return categories.find((category) => category.type === CategoryType.Task && category.status !== "inactive" && category.name === moduleName) ?? null;
}

function getProcessTemplateValueModuleId(template) {
  const standardWork = getStandardWorkForTemplate(template.id);
  const standardWorkCategoryName = categories.find((category) => category.id === standardWork?.categoryId)?.name ?? "";
  const explicitValueModuleId = template.valueModuleId ?? template.customFields?.valueModuleId ?? "";
  if (isValueModuleId(explicitValueModuleId)) return explicitValueModuleId;
  return inferValueModuleIdFromText(`${standardWorkCategoryName} ${standardWork?.name ?? ""} ${template.name ?? ""}`);
}

function getProcessTemplateValueModuleName(template) {
  return getValueModuleName(getProcessTemplateValueModuleId(template));
}

function getTemplateNodes(templateId) {
  return sortProcessNodes(
    state.processTemplateNodes.filter((node) => node.templateId === templateId && node.status !== ProcessTemplateNodeStatus.Deleted),
  );
}

function shouldShowTemplate(template) {
  return showInactiveTemplates || template.status !== ProcessTemplateStatus.Inactive;
}

function getVisibleProcessTemplates() {
  return state.processTemplates.filter(shouldShowTemplate);
}

function syncSelectedTemplateFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("process-template-")) {
    const templateId = hash.slice("process-template-".length);
    if (state.processTemplates.some((template) => template.id === templateId)) {
      selectedTemplateId = templateId;
    }
    return;
  }
  const focusedStandardWorkId = window.sessionStorage?.getItem("wufanStandardWorkFocusId") ?? "";
  if (focusedStandardWorkId !== "") {
    const standardWork = state.taskTemplates.find((template) => template.id === focusedStandardWorkId) ?? null;
    if (standardWork?.defaultProcessTemplateId && state.processTemplates.some((template) => template.id === standardWork.defaultProcessTemplateId)) {
      selectedTemplateId = standardWork.defaultProcessTemplateId;
    }
    window.sessionStorage?.removeItem("wufanStandardWorkFocusId");
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

function renderExecutorOptions(selectedId) {
  return `
    <option value="">同负责人</option>
    <option value="${processExecutorInitiatorRule}" ${selectedId === processExecutorInitiatorRule ? "selected" : ""}>同发起人</option>
    ${people
      .map(
        (person) => `
          <option value="${person.id}" ${person.id === selectedId ? "selected" : ""}>${person.name}</option>
        `,
      )
      .join("")}
  `;
}

function getExecutorDisplayName(node, fallback = "同负责人") {
  if (node?.executorId === processExecutorInitiatorRule) return "同发起人";
  return findName(people, node?.executorId, fallback);
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
        <h2>关键行动标准流程</h2>
        <p class="form-note">关键行动标准流程通常由关键行动自动创建。如需新增关键行动标准流程，请优先到关键行动库新增关键行动。</p>
        <label class="checkbox-field process-filter-checkbox">
          <input type="checkbox" data-show-inactive-processes ${showInactiveTemplates ? "checked" : ""} />
          <span>显示停用标准</span>
        </label>
        ${canCurrentUser("processes.editTemplates") ? `<button class="primary-button" type="button" data-action="add-template">新增关键行动标准流程</button>` : ""}
      </div>
      <div class="standard-work-board-wrap">
        <div class="standard-work-board process-template-board">
          ${valueModuleList
            .map((module) => {
              const templates = getVisibleProcessTemplates().filter((template) => getProcessTemplateValueModuleId(template) === module.id);
              templates.forEach((template) => categorizedTemplateIds.add(template.id));
              return `
                <section class="standard-work-column">
                  <div class="standard-work-column-header">
                    <h3>${module.name}</h3>
                    <span>${templates.length} 个</span>
                  </div>
                  <div class="standard-work-card-list">
                    ${
                      templates.length === 0
                        ? `<div class="empty-note">${showInactiveTemplates ? "暂无关键行动标准流程" : "暂无启用标准"}</div>`
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
        <span>对应关键行动</span>
        <strong>${standardWork?.name ?? "未绑定关键行动"}</strong>
      </div>
      ${isUncategorized ? `<p class="form-note">该关键行动未绑定关键行动或部门。</p>` : ""}
      <div class="standard-work-card-meta">
        <span>标准负责人</span>
        <strong>${findName(people, template.ownerId, "未设置")}</strong>
      </div>
      <div class="standard-work-card-meta">
        <span>标准步骤</span>
        <strong>${renderTemplateStepCount(template.id)}</strong>
      </div>
      <div class="standard-work-card-meta">
        <span>版本 / 更新时间</span>
        <strong>v${template.version} · ${template.updatedAt}</strong>
      </div>
      <div class="standard-work-card-actions">
        <button class="text-button" type="button" data-action="select-template" data-template-id="${template.id}">查看标准</button>
        ${canCurrentUser("processes.editSteps") ? `<button class="text-button" type="button" data-action="add-node" data-template-id="${template.id}" onclick="window.__handleProcessNodeAction?.(this, event)">编辑标准步骤</button>` : ""}
        ${
          canCurrentUser("processes.editTemplates") && template.status === ProcessTemplateStatus.Inactive
            ? `<button class="text-button" type="button" data-action="activate-template" data-template-id="${template.id}">启用标准</button>`
            : ""
        }
        ${
          canCurrentUser("processes.editTemplates") && template.status !== ProcessTemplateStatus.Inactive
            ? `<button class="text-button danger-button" type="button" data-action="deactivate-template" data-template-id="${template.id}">停用标准</button>`
            : ""
        }
        ${canCurrentUser("processes.editTemplates") ? `<button class="text-button danger-button" type="button" data-action="delete-template" data-template-id="${template.id}">删除标准</button>` : ""}
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
        <h3>未分类标准</h3>
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
          (node, index) => `
            <article class="process-node">
              <div class="process-node-header">
                <div class="process-node-title">
                  <strong>${formatProcessStepLabel(index + 1)}</strong>
                  <h4>${node.name}</h4>
                  <span class="process-step-type ${node.stepType === "review" ? "is-review" : ""}">${node.stepType === "review" ? "审核步骤" : "执行步骤"}</span>
                </div>
                <span class="row-actions">
                  <span class="status-pill ${node.status === ProcessTemplateNodeStatus.Inactive ? "is-inactive" : ""}">${processTemplateNodeStatusNames[node.status]}</span>
                  ${canCurrentUser("processes.sortSteps") && index !== 0 ? `<button class="text-button" type="button" data-action="move-node-up" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">上移</button>` : ""}
                  ${canCurrentUser("processes.sortSteps") && index !== nodes.length - 1 ? `<button class="text-button" type="button" data-action="move-node-down" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">下移</button>` : ""}
                  ${canCurrentUser("processes.editSteps") ? `<button class="text-button" type="button" data-action="edit-node" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">编辑</button>` : ""}
                  ${getMethodologyLinkByNodeId(node.id)}
                  ${
                    canCurrentUser("processes.editSteps") && node.status === ProcessTemplateNodeStatus.Inactive
                      ? `<button class="text-button" type="button" data-action="activate-node" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">启用</button>`
                      : ""
                  }
                  ${
                    canCurrentUser("processes.editSteps") && node.status !== ProcessTemplateNodeStatus.Inactive
                      ? `<button class="text-button danger-button" type="button" data-action="deactivate-node" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">停用</button>`
                      : ""
                  }
                  ${canCurrentUser("processes.editSteps") ? `<button class="text-button danger-button" type="button" data-action="delete-node" data-node-id="${node.id}" onclick="window.__handleProcessNodeAction?.(this, event)">删除</button>` : ""}
                </span>
              </div>
              <div class="process-node-meta">
                ${
                  node.stepType === "review"
                    ? `<span><em>审核人</em>${findName(people, node.reviewerId, "未设置")}</span>
                       <span><em>审核时限</em>${node.durationMinutes ?? (Number(node.durationDays ?? 1) * 1440)} 分钟</span>
                       <span><em>审核对象</em>上一个执行步骤的工作结果</span>`
                    : `<span><em>负责部门</em>${findName(departments, node.departmentId ?? node.ownerDepartmentId, "未设置")}</span>
                       <span><em>负责人</em>${findName(people, node.ownerId ?? node.defaultOwnerId, "未设置")}</span>
                       <span><em>执行人</em>${getExecutorDisplayName(node)}</span>
                       <span><em>任务时长</em>${node.durationMinutes ?? (Number(node.durationDays ?? 1) * 1440)} 分钟</span>`
                }
                <span><em>状态</em>${processTemplateNodeStatusNames[node.status]}</span>
              </div>
              <div class="process-node-copy">
                ${
                  node.stepType === "review"
                    ? `<p><strong>不通过退回：</strong>${escapeHtml(findName(state.processTemplateNodes, node.returnToNodeId, "最近的上一个执行步骤"))}</p>
                       <p><strong>不通过原因：</strong>${node.requireRejectionReason ? "必须填写" : "可选"}</p>`
                    : `<p><strong>步骤说明：</strong>${node.description}</p>
                       <p><strong>完成标准：</strong>${node.completionStandard}</p>`
                }
              </div>
            </article>
            `,
        )
        .join("")}
    </div>
  `;
}

function renderTemplateDetail() {
  const visibleTemplates = getVisibleProcessTemplates();
  const template = state.processTemplates.find((item) => item.id === selectedTemplateId) ?? visibleTemplates[0] ?? state.processTemplates[0];
  if (template === undefined) {
    return `
      <section class="settings-section process-detail">
        <div class="section-heading"><h2>关键行动详情</h2></div>
        <div class="empty-note">暂无关键行动</div>
      </section>
    `;
  }
  const standardWork = getStandardWorkForTemplate(template.id);
  const departmentNames = template.applicableDepartmentIds
    .map((departmentId) => findName(departments, departmentId, "未设置"))
    .join("、");
  const standardWorkDepartment = findName(departments, standardWork?.departmentId ?? "", "未设置");
  const rectificationRecords = standardWork === null
    ? []
    : state.workPlans
        .filter((workPlan) =>
          workPlan.workType === WorkType.Rectification &&
          (
            workPlan.customFields?.sourceStandardWorkId === standardWork.id ||
            workPlan.taskTemplateId === standardWork.id
          ),
        )
        .slice()
        .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
        .slice(0, 5);
  const relatedInstances = state.processInstances.filter((instance) =>
    instance.templateId === template.id ||
    instance.taskTemplateId === standardWork?.id ||
    instance.standardWorkId === standardWork?.id
  );
  const launchCount = relatedInstances.length;
  const improvementCount = rectificationRecords.length;

  return `
    <section class="settings-section process-detail">
      <div class="section-heading with-actions">
        <h2>关键行动详情</h2>
        <div class="section-actions">
          ${canCurrentUser("processes.editTemplates") ? `<button class="secondary-button" type="button" data-action="edit-template" data-template-id="${template.id}">编辑标准</button>` : ""}
          ${
            canCurrentUser("processes.editTemplates") && template.status === ProcessTemplateStatus.Inactive
              ? `<button class="secondary-button" type="button" data-action="activate-template" data-template-id="${template.id}">启用标准</button>`
              : ""
          }
          ${
            canCurrentUser("processes.editTemplates") && template.status !== ProcessTemplateStatus.Inactive
              ? `<button class="secondary-button danger-button" type="button" data-action="deactivate-template" data-template-id="${template.id}">停用标准</button>`
              : ""
          }
          ${canCurrentUser("processes.editTemplates") ? `<button class="secondary-button danger-button" type="button" data-action="delete-template" data-template-id="${template.id}">删除标准</button>` : ""}
          ${canCurrentUser("processes.editSteps") ? `<button class="secondary-button" type="button" data-action="add-node" data-template-id="${template.id}" onclick="window.__handleProcessNodeAction?.(this, event)">新增标准步骤</button>` : ""}
        </div>
      </div>
      <p class="key-action-position-note">关键行动：部门长期实践验证有效、能够持续推进目标实现、可以反复发起工作事项的标准模板。</p>
      <div class="process-template-summary">
        <div class="process-template-title-row">
          <h3>${standardWork?.name ?? template.name}</h3>
          <span class="status-pill ${template.status === ProcessTemplateStatus.Inactive ? "is-inactive" : ""}">${processTemplateStatusNames[template.status]}</span>
        </div>
        <div class="key-action-detail-section">
          <h3>基本信息</h3>
          <div class="process-template-meta">
            <span><em>行动标准编码</em>${escapeHtml(standardWork?.businessCode ?? "—")}</span>
            <span><em>行动标准名称</em>${standardWork?.name ?? template.name}</span>
            <span><em>默认流程名称</em>${escapeHtml(template.name)}</span>
            <span><em>流程模板编码</em>${escapeHtml(template.businessCode ?? "未编号")}</span>
            <span><em>所属价值链</em>${getProcessTemplateValueModuleName(template)}</span>
            <span><em>责任部门</em>${standardWorkDepartment}</span>
            <span><em>负责人</em>${findName(people, template.ownerId, "未设置")}</span>
            <span><em>启用 / 停用</em>${processTemplateStatusNames[template.status]}</span>
            <span><em>当前版本</em>v${template.version}</span>
          </div>
        </div>
      </div>
      <div class="detail-block key-action-detail-section">
        <h3>行动流程</h3>
        <div class="process-template-copy key-action-completion-copy">
          <p><strong>关键行动说明：</strong>${standardWork?.description ?? template.purpose}</p>
          <p><strong>发起条件：</strong>${template.startCondition}</p>
          <p><strong>完成条件：</strong>${template.completionCondition}</p>
          <p><strong>完成标准：</strong>${standardWork?.completionStandard ?? template.overallStandard}</p>
        </div>
        ${renderTemplateNodes(template.id)}
      </div>
      <div class="detail-block key-action-detail-section">
        <h3>改善记录</h3>
        ${
          rectificationRecords.length === 0
            ? `<p class="empty-note">暂无改善记录</p>`
            : `<div class="compact-record-list">
                ${rectificationRecords.map((record) => {
                  const customFields = record.customFields ?? {};
                  const editorName = findName(people, record.ownerId ?? customFields.sourceOwnerId ?? "", "未记录");
                  return `
                  <div class="compact-record-item">
                    <strong>${record.createdAt ?? "-"}</strong>
                    <span>原因：${customFields.sourceType ?? customFields.rectificationSource ?? "未记录"}</span>
                    <span>改善内容：${customFields.problemSummary ?? record.title ?? record.name ?? "未记录"}</span>
                    <span>修改人：${editorName}</span>
                  </div>
                `;
                }).join("")}
              </div>`
        }
      </div>
      <div class="detail-block key-action-detail-section">
        <h3>版本</h3>
        <div class="compact-record-list">
          <div class="compact-record-item">
            <strong>v${template.version}</strong>
            <span>当前版本 · ${template.updatedAt ?? "-"}</span>
          </div>
          <div class="compact-record-item">
            <strong>版本历史</strong>
            <span>已预留，后续接入完整版本记录。</span>
          </div>
        </div>
      </div>
      <div class="detail-block key-action-detail-section">
        <h3>使用情况</h3>
        <div class="key-action-usage-grid">
          <div><span>发起次数</span><strong>${launchCount}</strong></div>
          <div><span>正常完成率</span><strong>-</strong><em>待接入完整统计</em></div>
          <div><span>异常完成率</span><strong>-</strong><em>待接入完整统计</em></div>
          <div><span>改善次数</span><strong>${improvementCount}</strong></div>
        </div>
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
        <div class="section-heading"><h2>已发起关键行动</h2></div>
        <div class="empty-detail">暂未发起关键行动，下一步将实现关键行动发起功能。</div>
      </section>
    `;
  }

  return `
    <section class="settings-section">
      <div class="section-heading"><h2>已发起关键行动</h2></div>
      <form class="task-filters started-process-filters" aria-label="已发起关键行动筛选">
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
            <tr><th>已发起关键行动名称</th><th>关键行动标准流程</th><th>关联目标</th><th>发起人</th><th>当前步骤</th><th>步骤进度</th><th>状态</th><th>发起时间</th><th>完成时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${visibleInstances.length === 0 ? `<tr><td colspan="10">暂无匹配的已发起关键行动</td></tr>` : visibleInstances
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
                    <td><span class="status-pill">${selectProcessInstanceBusinessStatus(instance.id, state).label}</span></td>
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
  const selectedValueModuleId = template === null ? "" : getProcessTemplateValueModuleId(template);
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <h2>${template ? "编辑关键行动标准流程" : "新增关键行动标准流程"}</h2>
        <div class="modal-header-actions">
          <button class="secondary-button" type="button" data-action="close-process-modal">取消</button>
          <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
          <button class="icon-button" type="button" data-action="close-process-modal">×</button>
        </div>
      </div>
      <form class="modal-form process-template-form">
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
        <label><span>标准名称</span><input name="name" value="${template?.name ?? ""}" /></label>
        <div class="form-grid">
          <label><span>价值链模块</span><select name="valueModuleId">${renderOptions(valueModuleList, selectedValueModuleId, "请选择价值链模块")}</select></label>
          <label><span>标准负责人</span><select name="ownerId">${renderOptions(people, template?.ownerId ?? "", "请选择负责人")}</select></label>
        </div>
        <label><span>适用部门</span><select name="applicableDepartmentIds" multiple>${departments.map((department) => `<option value="${department.id}" ${applicableDepartmentIds.includes(department.id) ? "selected" : ""}>${department.name}</option>`).join("")}</select></label>
        <label><span>标准目的</span><textarea name="purpose">${template?.purpose ?? ""}</textarea></label>
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
  const stepType = modalState.stepType ?? node?.stepType ?? "execution";
  const nodeOrder = node === null ? Number.MAX_SAFE_INTEGER : getProcessNodeStepOrder(node);
  const returnTargets = getTemplateNodes(selectedTemplateId).filter(
    (candidate) =>
      candidate.id !== node?.id &&
      (candidate.stepType ?? "execution") === "execution" &&
      getProcessNodeStepOrder(candidate) < nodeOrder,
  );
  const defaultReturnNodeId = node?.returnToNodeId ?? returnTargets.at(-1)?.id ?? "";
  const submitRequirement = normalizeSubmitRequirement(node ?? { name: "" });
  const submitFieldsJson = JSON.stringify(submitRequirement.submitFields ?? [], null, 2);
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <h2>${node ? "编辑标准步骤" : "新增标准步骤"}</h2>
        <div class="modal-header-actions">
          <button class="secondary-button" type="button" data-action="close-process-modal">取消</button>
          <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
          <button class="icon-button" type="button" data-action="close-process-modal">×</button>
        </div>
      </div>
      <form class="modal-form process-node-form">
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
        <fieldset class="process-step-type-picker">
          <legend>步骤类型</legend>
          <label><input type="radio" name="stepType" value="execution" ${stepType === "execution" ? "checked" : ""} /> 执行步骤</label>
          <label><input type="radio" name="stepType" value="review" ${stepType === "review" ? "checked" : ""} /> 审核步骤</label>
        </fieldset>
        ${
          stepType === "review"
            ? `
        <div class="form-grid">
          <label><span>审核步骤名称</span><input name="name" value="${escapeHtml(node?.name ?? "")}" /></label>
          <label><span>审核人</span><select name="reviewerId">${renderOptions(people, node?.reviewerId ?? "", "请选择审核人")}</select></label>
          <label><span>审核时限（分钟）</span><input name="durationMinutes" type="number" min="1" step="1" value="${node === null ? 120 : node.durationMinutes ?? (Number(node.durationDays ?? 1) * 1440)}" /></label>
          <label><span>审核对象</span><input value="上一个执行步骤提交的工作结果" disabled /></label>
          <label><span>不通过退回步骤</span><select name="returnToNodeId">${renderOptions(returnTargets, defaultReturnNodeId, "请选择之前的执行步骤")}</select></label>
          <label><span>状态</span><select name="status">${renderValueOptions(ProcessTemplateNodeStatus, node?.status ?? ProcessTemplateNodeStatus.Active, processTemplateNodeStatusNames, "请选择状态")}</select></label>
        </div>
        <label class="checkbox-field"><input type="checkbox" name="requireRejectionReason" ${node?.requireRejectionReason ? "checked" : ""} /> <span>不通过时必须填写原因</span></label>
        <p class="form-note">审核步骤只审核上一个执行步骤的工作结果；不通过时退回所选执行步骤。</p>
            `
            : `
        <div class="form-grid">
          <label><span>步骤名称</span><input name="name" value="${node?.name ?? ""}" /></label>
          <label><span>负责部门</span><select name="departmentId">${renderOptions(departments, node?.departmentId ?? node?.ownerDepartmentId ?? "", "请选择部门")}</select></label>
          <label><span>负责人</span><select name="ownerId">${renderOptions(people, node?.ownerId ?? node?.defaultOwnerId ?? "", "请选择负责人")}</select></label>
          <label><span>执行人</span><select name="executorId">${renderExecutorOptions(node?.executorId ?? "")}</select></label>
          <label><span>任务时长（分钟）</span><input name="durationMinutes" type="number" min="1" step="1" value="${node === null ? 120 : node.durationMinutes ?? (Number(node.durationDays ?? 1) * 1440)}" /></label>
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
        <div class="form-subsection process-wave-settings">
          <h3>任务波次</h3>
          <label class="checkbox-field">
            <input type="checkbox" name="waveEnabled" ${node?.waveEnabled ? "checked" : ""} />
            <span>启用任务波次</span>
          </label>
          <div data-wave-settings-detail ${node?.waveEnabled ? "" : "hidden"}>
            <div class="form-grid process-wave-limit-settings">
              <fieldset>
                <legend>波次任务数量</legend>
                <label class="checkbox-field">
                  <input type="radio" name="waveLimitMode" value="limited" ${node?.waveUnlimited ? "" : "checked"} />
                  <span>设置上限</span>
                </label>
                <label class="checkbox-field">
                  <input type="radio" name="waveLimitMode" value="unlimited" ${node?.waveUnlimited ? "checked" : ""} />
                  <span>不限数量</span>
                </label>
              </fieldset>
              <label data-wave-size-field ${node?.waveUnlimited ? "hidden" : ""}>
                <span>每个波次最多任务数</span>
                <input name="waveSize" type="number" min="2" max="100" step="1" value="${Number.isInteger(Number(node?.waveSize)) ? Number(node.waveSize) : 10}" ${node?.waveUnlimited ? "disabled" : ""} />
              </label>
            </div>
            <p class="form-note">每个波次至少包含2项任务。系统仅组合相同行动标准、流程模板、关联模板、步骤节点和执行人的任务；不同关联模板绝不混合。</p>
          </div>
        </div>
            `
        }
        <div class="modal-actions"><button class="secondary-button" type="button" data-action="close-process-modal">取消</button><button class="primary-button" type="submit">保存</button></div>
      </form>
    </div></div>
  `;
}

function renderWorkflowNodesModal() {
  if (modalState?.kind !== "workflowNodes") return "";
  const template = state.processTemplates.find((item) => item.id === modalState.templateId);
  if (template === undefined) return "";
  const nodes = getTemplateNodes(template.id);
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <h2>${escapeHtml(template.name)} · 标准节点</h2>
        <div class="modal-header-actions">
          <button class="secondary-button" type="button" data-action="close-process-modal">关闭</button>
          <button class="icon-button" type="button" data-action="close-process-modal">×</button>
        </div>
      </div>
      ${
        nodes.length === 0
          ? `<p class="empty-state">暂无标准节点</p>`
          : `
            <div class="process-node-list">
              ${nodes
                .map((node, index) => {
                  const ownerName = findName(people, node.ownerId ?? node.defaultOwnerId, "未设置");
                  const executorName = getExecutorDisplayName(node, ownerName === "未设置" ? "未设置" : ownerName);
                  const durationMinutes = node.durationMinutes ?? (Number(node.durationDays ?? 1) * 1440);
                  return `
                    <article class="process-node">
                      <div class="process-node-header">
                        <div class="process-node-title">
                          <strong>${formatProcessStepLabel(index + 1)}</strong>
                          <h4>${escapeHtml(node.name || "未命名任务")}</h4>
                        </div>
                      </div>
                      <div class="process-node-meta">
                        <span><em>负责人</em>${escapeHtml(ownerName)}</span>
                        <span><em>执行人</em>${escapeHtml(executorName)}</span>
                        <span><em>任务时长</em>${escapeHtml(durationMinutes)} 分钟</span>
                      </div>
                      <div class="process-node-copy">
                        <p><strong>完成标准：</strong>${escapeHtml(node.completionStandard || "未填写")}</p>
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>
          `
      }
    </div></div>
  `;
}

function renderStartModal() {
  if (modalState?.kind !== "start") return "";
  const launchableTemplates = getLaunchableProcessTemplates();
  const template =
    launchableTemplates.find((item) => item.id === modalState.templateId) ??
    launchableTemplates[0] ??
    null;
  if (template === null) return "";
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <h2>发起关键行动标准流程</h2>
        <div class="modal-header-actions">
          <button class="secondary-button" type="button" data-action="close-process-modal">取消</button>
          <button class="primary-button" type="button" data-action="submit-modal-form">发起</button>
          <button class="icon-button" type="button" data-action="close-process-modal">×</button>
        </div>
      </div>
      <form class="modal-form process-start-form">
        <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
        <label><span>关键行动标准流程</span><select name="templateId">${renderOptions(launchableTemplates, template.id, "请选择关键行动标准流程")}</select></label>
        <label><span>已发起关键行动名称</span><input name="name" value="${template.name}" /></label>
        <div class="form-grid">
          <label><span>关联目标</span><select name="goalId">${renderOptions(getActiveGoals(), "", "请选择目标")}</select></label>
          <label><span>发起人</span><select name="initiatorId" disabled>${renderOptions(people, getCurrentUserId(), "当前用户")}</select></label>
        </div>
        <label><span>本次关键行动说明</span><textarea name="description"></textarea></label>
        ${renderActionProductSelector()}
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
  const valueModuleId = getFormValue(form, "valueModuleId");
  const valueChainCategory = getValueChainCategoryByModuleId(valueModuleId);
  const draft = {
    name: getFormValue(form, "name"),
    categoryId: valueChainCategory?.id ?? null,
    applicableDepartmentIds: data.getAll("applicableDepartmentIds").map(String),
    ownerId: getFormValue(form, "ownerId"),
    purpose: getFormValue(form, "purpose"),
    startCondition: getFormValue(form, "startCondition"),
    completionCondition: getFormValue(form, "completionCondition"),
    overallStandard: getFormValue(form, "overallStandard"),
    status: getFormValue(form, "status") || ProcessTemplateStatus.Active,
  };
  if (draft.name === "") return setModalError("请填写标准名称。");
  if (!isValueModuleId(valueModuleId) || valueChainCategory === null) return setModalError("请选择有效的价值链模块。");
  if (draft.ownerId === "") return setModalError("请选择标准负责人。");
  const now = getNow();
  if (modalState.id) {
    const existingTemplate = state.processTemplates.find((template) => template.id === modalState.id);
    if (existingTemplate === undefined) return setModalError("未找到要编辑的关键行动标准流程。");
    const updatedTemplate = { ...existingTemplate, ...draft, version: existingTemplate.version + 1, updatedAt: now };
    try {
      await updatePersistentResource("process-templates", existingTemplate.id, updatedTemplate);
    } catch (error) {
      console.error("关键行动标准流程保存失败", error);
      return setModalError(error.message || "关键行动标准流程保存失败，请检查本地数据库服务。");
    }
    state.processTemplates = state.processTemplates.map((template) => (template.id === existingTemplate.id ? updatedTemplate : template));
  } else {
    const template = { id: createId("process-template"), ...draft, status: ProcessTemplateStatus.Active, version: 1, createdAt: now, updatedAt: now };
    try {
      await createPersistentResource("process-templates", template);
    } catch (error) {
      console.error("关键行动标准流程保存失败", error);
      return setModalError(error.message || "关键行动标准流程保存失败，请检查本地数据库服务。");
    }
    state.processTemplates = [template, ...state.processTemplates];
    selectedTemplateId = template.id;
  }
  modalState = null;
  rerender();
}

async function saveNode(form, rerender) {
  const stepType = getFormValue(form, "stepType") === "review" ? "review" : "execution";
  const durationMinutes = Number(getFormValue(form, "durationMinutes"));
  const durationDays = Math.max(1, Math.ceil((Number.isFinite(durationMinutes) ? durationMinutes : 1440) / 1440));
  let submitFields = [];
  if (stepType === "execution") {
    try {
      submitFields = JSON.parse(getFormValue(form, "submitFieldsJson") || "[]");
      if (!Array.isArray(submitFields)) throw new Error("invalid");
    } catch {
      return setModalError("表单字段配置必须是合法 JSON 数组。", rerender);
    }
  }
  const existingNode = modalState.id ? state.processTemplateNodes.find((node) => node.id === modalState.id) : null;
  const waveEnabled = stepType === "execution" && (form.elements.waveEnabled?.checked ?? false);
  const waveUnlimited =
    stepType === "execution" && waveEnabled && getFormValue(form, "waveLimitMode") === "unlimited";
  const waveSizeValue =
    stepType === "execution" && !waveUnlimited ? getFormValue(form, "waveSize") : existingNode?.waveSize ?? 10;
  const rawWaveSize = waveSizeValue === "" ? 10 : Number(waveSizeValue);
  const waveSizeIsValid = Number.isInteger(rawWaveSize) && rawWaveSize >= 2 && rawWaveSize <= 100;
  const waveSize = waveSizeIsValid ? rawWaveSize : 10;
  const nextStepOrder =
    existingNode === null
      ? Math.max(0, ...getTemplateNodes(selectedTemplateId).map((node) => getProcessNodeStepOrder(node))) + 1
      : getProcessNodeStepOrder(existingNode);
  const draft = {
    stepType,
    name: getFormValue(form, "name"),
    stepOrder: nextStepOrder,
    stageName: "默认标准",
    stageOrder: nextStepOrder,
    nodeOrder: nextStepOrder,
    departmentId: stepType === "review" ? null : getFormValue(form, "departmentId"),
    ownerId: stepType === "review" ? getFormValue(form, "reviewerId") : getFormValue(form, "ownerId"),
    executorId: stepType === "review" ? getFormValue(form, "reviewerId") : getFormValue(form, "executorId") || null,
    ownerRule: ProcessOwnerRule.FixedPerson,
    ownerDepartmentId: stepType === "review" ? null : getFormValue(form, "departmentId"),
    ownerPositionId: null,
    defaultOwnerId: stepType === "review" ? getFormValue(form, "reviewerId") : getFormValue(form, "ownerId"),
    durationDays,
    durationMinutes,
    description: stepType === "review" ? "" : getFormValue(form, "description"),
    completionStandard: stepType === "review" ? "" : getFormValue(form, "completionStandard"),
    reviewStandard: null,
    needAcceptance: false,
    accepterRule: ProcessAccepterRule.None,
    defaultAccepterId: null,
    outputRequirement: null,
    submitType: stepType === "review" ? SubmitType.None : getFormValue(form, "submitType") || SubmitType.None,
    submitDescription: stepType === "review" ? "" : getFormValue(form, "submitDescription"),
    submitFields,
    requireFile: stepType === "execution" && (form.elements.requireFile?.checked ?? false),
    requireLink: stepType === "execution" && (form.elements.requireLink?.checked ?? false),
    reviewerId: stepType === "review" ? getFormValue(form, "reviewerId") : null,
    reviewTargetType: stepType === "review" ? "previous_execution_result" : null,
    returnToNodeId: stepType === "review" ? getFormValue(form, "returnToNodeId") : null,
    requireRejectionReason: stepType === "review" && (form.elements.requireRejectionReason?.checked ?? false),
    waveEnabled,
    waveUnlimited,
    waveSize,
    waveTemplatePriority: true,
    status: getFormValue(form, "status") || ProcessTemplateNodeStatus.Active,
  };
  const emptySubmitDefault = normalizeSubmitRequirement({ name: "" });
  const shouldInferSubmitForNewNode =
    stepType === "execution" &&
    existingNode === null &&
    draft.submitType === emptySubmitDefault.submitType &&
    draft.submitDescription === emptySubmitDefault.submitDescription &&
    JSON.stringify(draft.submitFields) === JSON.stringify(emptySubmitDefault.submitFields) &&
    !draft.requireFile &&
    !draft.requireLink;
  if (shouldInferSubmitForNewNode) {
    Object.assign(draft, normalizeSubmitRequirement({ name: draft.name }));
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return setModalError("请填写大于 0 的任务时长（分钟）。");
  if (waveEnabled && !waveUnlimited && !waveSizeIsValid) {
    return setModalError("波次任务数量上限必须是 2—100 的整数。");
  }
  if (draft.name === "") return setModalError(stepType === "review" ? "请填写审核步骤名称。" : "请填写步骤名称。");
  if (stepType === "review") {
    if (nextStepOrder <= 1) return setModalError("审核步骤不能作为流程第一步。");
    if (draft.reviewerId === "") return setModalError("请选择审核人。");
    const validReturnTarget = getTemplateNodes(selectedTemplateId).some(
      (node) =>
        node.id === draft.returnToNodeId &&
        node.id !== existingNode?.id &&
        (node.stepType ?? "execution") === "execution" &&
        getProcessNodeStepOrder(node) < nextStepOrder,
    );
    if (!validReturnTarget) return setModalError("审核步骤之前必须有执行步骤，并选择有效的不通过退回步骤。");
  } else {
    if (draft.departmentId === "") return setModalError("请选择负责部门。");
    if (draft.ownerId === "") return setModalError("请选择负责人。");
  }
  const now = getNow();
  if (modalState.id) {
    const existingNode = state.processTemplateNodes.find((node) => node.id === modalState.id);
    if (existingNode === undefined) return setModalError("未找到要编辑的标准步骤。");
    const updatedNode = { ...existingNode, ...draft, updatedAt: now };
    try {
      await updatePersistentResource("process-template-nodes", existingNode.id, updatedNode);
    } catch (error) {
      console.error("标准步骤保存失败", error);
      return setModalError(error.message || "标准步骤保存失败，请检查本地数据库服务。");
    }
    state.processTemplateNodes = state.processTemplateNodes.map((node) => (node.id === existingNode.id ? updatedNode : node));
  } else {
    const createdNode = { id: createId("process-node"), templateId: selectedTemplateId, ...draft, status: ProcessTemplateNodeStatus.Active, createdAt: now, updatedAt: now };
    try {
      await createPersistentResource("process-template-nodes", createdNode);
    } catch (error) {
      console.error("标准步骤保存失败", error);
      return setModalError(error.message || "标准步骤保存失败，请检查本地数据库服务。");
    }
    state.processTemplateNodes = [...state.processTemplateNodes, createdNode];
    if (!state.methodologies.some((methodology) => methodology.processNodeId === createdNode.id)) {
      const standardWork = getStandardWorkForTemplate(createdNode.templateId);
      const methodology = {
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
      };
      try {
        await createPersistentResource("methodologies", methodology);
        state.methodologies = [methodology, ...state.methodologies];
      } catch (error) {
        console.error("方法论自动生成失败", error);
        window.alert(error.message || "标准步骤已保存，但方法论自动生成失败，请稍后到方法论中补建。");
      }
    }
  }
  const orderSaved = await persistContiguousNodeOrder(selectedTemplateId);
  if (!orderSaved) return;
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
  await persistContiguousNodeOrder(node.templateId, reorderedNodes);
}

async function persistContiguousNodeOrder(templateId, orderedNodes = getTemplateNodes(templateId)) {
  const now = getNow();
  const orderById = new Map(orderedNodes.map((item, index) => [item.id, index + 1]));

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
    console.error("标准步骤排序保存失败", error);
    window.alert(error.message || "标准步骤排序保存失败，请检查本地数据库服务。");
    return false;
  }
  state.processTemplateNodes = updatedNodes;
  normalizeProcessStepOrders(templateId);
  return true;
}

async function submitStart(form, rerender) {
  const productIds = collectActionProductIds(form);
  const launchableTemplates = getLaunchableProcessTemplates();
  const template =
    launchableTemplates.find((item) => item.id === getFormValue(form, "templateId")) ??
    launchableTemplates[0] ??
    null;
  if (template === null) return setModalError("暂无可发起的关键行动标准。", rerender);
  const standardWork = getStandardWorkForTemplate(template.id);
  if (standardWork === null) return setModalError("该关键行动标准流程未关联行动标准，不能直接发起关键行动。", rerender);
  const name = getFormValue(form, "name") || template.name;
  const goalId = getFormValue(form, "goalId") || getActiveGoals()[0]?.id || "";
  const initiatorId = getCurrentUserId();
  if (initiatorId === "") return setModalError("无法确认当前发起人，请重新登录后再试。", rerender);
  const now = getNow();
  const workPlan = {
    id: createId("work-plan"),
    goalId,
    departmentId: standardWork.departmentId ?? null,
    taskTemplateId: standardWork.id,
    title: name,
    customFields: {},
    coverImageUrl: null,
    status: WorkPlanStatus.ThisWeek,
    plannedWeek: null,
    dueDate: null,
    description: getFormValue(form, "description") || template.description || "",
    processInstanceId: null,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    canceledAt: null,
  };
  try {
    const result = await launchWorkPlanDraftAsProcess(workPlan, {
      initiatorId,
      launchAssignments: { owner: {}, accepter: {} },
      productIds,
    });
    selectedInstanceId = result.instance.id;
  } catch (error) {
    console.error("发起关键行动标准流程失败", error);
    return setModalError(error.message || "发起关键行动失败，请检查本地数据库服务。", rerender);
  }
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
  if (action === "activate-node") {
    await updateNodeStatus(actionButton.dataset.nodeId, ProcessTemplateNodeStatus.Active);
    rerender();
    return true;
  }
  if (action === "deactivate-node") {
    await updateNodeStatus(actionButton.dataset.nodeId, ProcessTemplateNodeStatus.Inactive);
    rerender();
    return true;
  }
  if (action === "delete-node") {
    await deleteNode(actionButton.dataset.nodeId, rerender);
    return true;
  }
  return false;
}

async function deleteTemplate(templateId, rerender) {
  const template = state.processTemplates.find((item) => item.id === templateId);
  if (template === undefined) return;

  const standardWork = getStandardWorkForTemplate(template.id);
  if (standardWork !== null) {
    window.alert("该关键行动已绑定关键行动，请先停用标准，不要删除。");
    return;
  }

  if (getLaunchedInstancesForTemplate(template.id).length > 0) {
    window.alert("该关键行动已有发起记录，为保留历史数据不能删除，请使用停用标准。");
    return;
  }

  if (!window.confirm(`确定要删除标准「${template.name}」吗？删除后会同时删除该关键行动的步骤和方法论空记录，且不会影响已发起关键行动。`)) return;

  try {
    await deletePersistentResource("process-templates", template.id);
  } catch (error) {
    console.error("标准删除失败", error);
    window.alert(error.message || "标准删除失败，请检查本地数据库服务。");
    return;
  }

  const nodeIds = new Set(state.processTemplateNodes.filter((node) => node.templateId === template.id).map((node) => node.id));
  state.processTemplates = state.processTemplates.filter((item) => item.id !== template.id);
  state.processTemplateNodes = state.processTemplateNodes.filter((node) => node.templateId !== template.id);
  state.methodologies = state.methodologies.filter(
    (methodology) => methodology.processTemplateId !== template.id && !nodeIds.has(methodology.processNodeId),
  );
  if (selectedTemplateId === template.id) selectedTemplateId = getVisibleProcessTemplates()[0]?.id ?? null;
  rerender();
}

async function updateTemplateStatus(templateId, status) {
  const template = state.processTemplates.find((item) => item.id === templateId);
  if (template === undefined) return false;

  const now = getNow();
  const updatedTemplate = { ...template, status, updatedAt: now };
  try {
    await updatePersistentResource("process-templates", updatedTemplate.id, updatedTemplate);
  } catch (error) {
    const actionText = status === ProcessTemplateStatus.Active ? "启用" : "停用";
    console.error(`标准${actionText}失败`, error);
    window.alert(error.message || `标准${actionText}失败，请检查本地数据库服务。`);
    return false;
  }
  state.processTemplates = state.processTemplates.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item));
  return true;
}

async function updateNodeStatus(nodeId, status) {
  const node = state.processTemplateNodes.find((item) => item.id === nodeId);
  if (node === undefined) return false;

  try {
    await updateProcessTemplateNodeStatus(node.id, status);
  } catch (error) {
    const actionText = status === ProcessTemplateNodeStatus.Active ? "启用" : "停用";
    console.error(`标准节点${actionText}失败`, error);
    window.alert(error.message || `标准节点${actionText}失败，请检查本地数据库服务。`);
    return false;
  }
  return true;
}

async function deleteNode(nodeId, rerender) {
  const node = state.processTemplateNodes.find((item) => item.id === nodeId);
  if (node === undefined) return;

  const generatedTask = state.tasks.find((task) => task.processNodeId === node.id);
  if (generatedTask !== undefined) {
    window.alert("该标准节点已经生成过任务，为保留历史数据不能删除，请使用停用节点。");
    return;
  }
  const referencedByReviewNode = state.processTemplateNodes.find(
    (candidate) =>
      candidate.templateId === node.templateId &&
      candidate.status !== ProcessTemplateNodeStatus.Deleted &&
      candidate.stepType === "review" &&
      candidate.returnToNodeId === node.id,
  );
  if (referencedByReviewNode !== undefined) {
    window.alert(`审核步骤“${referencedByReviewNode.name}”将该步骤设为不通过退回目标，请先重新选择退回步骤。`);
    return;
  }

  if (!window.confirm(`确定要删除标准节点「${node.name}」吗？删除后会同时删除该节点的方法论记录。`)) return;

  try {
    await deletePersistentResource("process-template-nodes", node.id);
  } catch (error) {
    console.error("标准节点删除失败", error);
    window.alert(error.message || "标准节点删除失败，请检查本地数据库服务。");
    return;
  }

  state.processTemplateNodes = state.processTemplateNodes.map((item) =>
    item.id === node.id ? { ...item, status: ProcessTemplateNodeStatus.Deleted, updatedAt: getNow() } : item,
  );
  const orderSaved = await persistContiguousNodeOrder(node.templateId);
  if (!orderSaved) return;
  rerender();
}

export function bindProcessesPageEvents(rerender) {
  const page = document.querySelector(".processes-page");
  const templateForm = document.querySelector(".process-template-form");
  const nodeForm = document.querySelector(".process-node-form");
  const startForm = document.querySelector(".process-start-form");
  if (startForm !== null) bindActionProductSelectors(startForm);
  const startedProcessFilterForm = document.querySelector(".started-process-filters");
  if (page === null) return;
  if (document.querySelector(".standard-work-library-host") !== null) {
    bindStandardWorkLibraryEvents(rerender, page);
  }

  window.__handleProcessNodeAction = async (button, event) => {
    event?.preventDefault();
    event?.stopPropagation();
    await handleProcessNodeAction(button, rerender);
  };

  page.addEventListener("click", async (event) => {
    const actionButton = event.target.closest('button[data-action="add-node"], button[data-action="edit-node"], button[data-action="move-node-up"], button[data-action="move-node-down"], button[data-action="activate-node"], button[data-action="deactivate-node"], button[data-action="delete-node"]');
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
      if (action === "view-standard-work-process") return;
      if (action === "launch-task-template") {
        openTaskTemplateLaunchModal(actionButton.dataset.templateId ?? "", rerender);
        return;
      }
      if (action === "add-task-template" || action === "edit-task-template" || action === "deactivate-task-template" || action === "remove-selected-standard-work-attachment" || action === "add-task-template-field" || action === "remove-task-template-field" || action === "move-task-template-field-up" || action === "move-task-template-field-down") return;
      if (action === "close-process-modal") modalState = null;
      if (action === "add-template" && canCurrentUser("processes.editTemplates")) modalState = { kind: "template", error: "" };
      if (action === "select-template") modalState = { kind: "workflowNodes", templateId: actionButton.dataset.templateId };
      if (action === "edit-template" && canCurrentUser("processes.editTemplates")) modalState = { kind: "template", id: actionButton.dataset.templateId, error: "" };
      if (action === "start-process" && canCurrentUserLaunchProcessTemplate(actionButton.dataset.templateId ?? "")) {
        modalState = { kind: "start", templateId: actionButton.dataset.templateId, error: "" };
      }
      if (action === "view-process-instance") selectedInstanceId = actionButton.dataset.instanceId;
      if (action === "delete-template" && canCurrentUser("processes.editTemplates")) {
        await deleteTemplate(actionButton.dataset.templateId, rerender);
        return;
      }
      if (action === "activate-template" && canCurrentUser("processes.editTemplates")) {
        await updateTemplateStatus(actionButton.dataset.templateId, ProcessTemplateStatus.Active);
      }
      if (action === "deactivate-template" && canCurrentUser("processes.editTemplates")) {
        await updateTemplateStatus(actionButton.dataset.templateId, ProcessTemplateStatus.Inactive);
      }
      if (action === "stop-process" && canCurrentUser("processes.editInstances") && window.confirm("确定要终止该关键行动吗？未完成标准步骤任务将自动取消。")) {
        stopProcess(actionButton.dataset.instanceId);
      }
      if (action === "select-process-task") {
        selectTask(actionButton.dataset.taskId);
        window.alert("已选中该任务，请切换到任务查看详情。");
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
    const waveEnabledInput = event.target.closest('input[name="waveEnabled"]');
    if (waveEnabledInput !== null) {
      const detail = waveEnabledInput.closest(".process-wave-settings")?.querySelector("[data-wave-settings-detail]");
      if (detail !== null && detail !== undefined) detail.hidden = !waveEnabledInput.checked;
      return;
    }
    const waveLimitModeInput = event.target.closest('input[name="waveLimitMode"]');
    if (waveLimitModeInput !== null) {
      const settings = waveLimitModeInput.closest(".process-wave-settings");
      const sizeField = settings?.querySelector("[data-wave-size-field]");
      const sizeInput = settings?.querySelector('input[name="waveSize"]');
      const unlimited = waveLimitModeInput.value === "unlimited";
      if (sizeField !== null && sizeField !== undefined) sizeField.hidden = unlimited;
      if (sizeInput !== null && sizeInput !== undefined) sizeInput.disabled = unlimited;
      return;
    }
    const stepTypeInput = event.target.closest('input[name="stepType"]');
    if (stepTypeInput !== null && modalState?.kind === "node") {
      modalState = { ...modalState, stepType: stepTypeInput.value, error: "" };
      rerender();
      return;
    }
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
      window.alert("已选中该任务，请切换到任务查看详情。");
    },
  });
}

export function renderProcessesPage() {
  syncSelectedTemplateFromHash();
  const canViewTemplates = canCurrentUser("processes.viewTemplates");
  const canViewStandardWorks = canCurrentUser("settings.viewStandardWorks") || canViewTemplates;
  return `
    <div class="processes-page">
      <div class="settings-tabs" aria-label="关键行动分区">
        ${canViewStandardWorks ? `<a href="#task-library">关键行动库</a>` : ""}
      </div>
      ${canViewStandardWorks
          ? `
            ${renderStandardWorkLibraryPage(selectedTemplateId)}
            ${canViewTemplates ? `
              <div id="process-templates" class="process-section">
                ${renderTemplateDetail()}
              </div>
            ` : ""}
          `
          : canViewTemplates
            ? `
              <div id="process-templates" class="process-section">
                ${renderTemplateDetail()}
              </div>
            `
            : ""}
      ${renderTemplateModal()}
      ${renderNodeModal()}
      ${renderWorkflowNodesModal()}
      ${renderStartModal()}
    </div>
  `;
}
