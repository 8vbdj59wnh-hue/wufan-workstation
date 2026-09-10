import { ensureStoreOptionsLoaded, formatProcessStepLabel, getCurrentUser, getLatestStandardWorkFormFields, getNow, getProcessNodeStepOrder, getStoreOptionsLoadState, loadBusinessImprovementResult, loadTemplates, resolveAssetUrl, state, updateActionProducts, updatePersistentResource, updateProcessTaskExecutor, uploadStandardWorkAttachment } from "./appState.js";
import { renderUiModule } from "./uiModuleRegistry.js";
import "./uiModules/businessImprovementResult.js";
import {
  GoalStatus,
  ProcessInstanceStatus,
  TaskStatus,
} from "./data/modelOptions.js";
import {
  getProcessInstanceBusinessStatus as selectProcessInstanceBusinessStatus,
  getProcessInstanceOwner,
  getProcessProgress as selectProcessProgress,
} from "./data/processInstanceSelectors.js";
import { getTaskBusinessStatus } from "./data/taskSelectors.js";
import { renderWorkFormViewer } from "./workFormViewer.js";
import {
  collectPublicFormFields,
  handlePublicFormImageUpload,
  removePublicFormImage,
  renderPublicFormEditor,
  updatePublicFormImagePreview,
  validatePublicFormFields,
} from "./workFormEditor.js";
import { normalizePublicFormFields } from "./publicFormFields.js";
import { bindActionProductSelectors, collectActionProductIds, getActionProductIds, getActionProducts, renderActionProductSelector, renderLinkedActionProducts } from "./actionProductRelations.js";
import { hasPermission } from "../shared/permissions.js";
import { getActionDeadlinePresentation } from "./data/actionDeadline.js";
import { normalizePublishTimeFields, normalizePublishTimeMode, PublishTimeMode } from "./data/contentPublishTime.js";
import {
  collectBusinessDateTime,
  collectBusinessMinuteDateTime,
  formatBusinessDateTime,
  formatBusinessMinuteDateTime,
  getBusinessDatePart,
  getBusinessHourPart,
  getBusinessMinutePart,
  renderBusinessHourOptions,
  renderBusinessMinuteOptions,
} from "./businessTime.js";
import { standardWorkAttachmentAccept, validateStandardWorkAttachmentFiles } from "./standardWorkAttachmentPolicy.js";

const goals = state.goals;
const people = state.people;
const standardWorkAttachmentsKey = "standardWorkAttachments";
const linkedActionTemplateIdsKey = "linkedTemplateIds";
const returnRecordsKey = "returnRecords";
const executorEditableTaskStatuses = new Set([TaskStatus.Waiting, TaskStatus.Todo, TaskStatus.Doing]);
let taskExecutorPickerState = null;
const improvementResultState = new Map();

function getSelectableGoals(selectedGoalId = "") {
  return goals.filter((goal) => goal.status !== GoalStatus.Inactive || goal.id === selectedGoalId);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getFileExt(filename) {
  const index = String(filename ?? "").lastIndexOf(".");
  return index === -1 ? "" : String(filename).slice(index).toLowerCase();
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

function getStandardWorkFormFields(standardWorkId, fallbackFields = []) {
  const sourceFields = getLatestStandardWorkFormFields(standardWorkId, fallbackFields);
  return normalizePublicFormFields(sourceFields);
}

function getInstanceFormFields(instance) {
  const taskTemplate = getTaskTemplate(instance);
  return getStandardWorkFormFields(taskTemplate?.id ?? instance.standardWorkId ?? instance.taskTemplateId, taskTemplate?.formFields ?? []);
}

function isContentNoteInstance(instance) {
  const template = getTaskTemplate(instance);
  return template?.id === "task-template-publish-content-note" || template?.name === "发布内容笔记";
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

function getLinkedWorkPlan(instance) {
  return state.workPlans.find((workPlan) => workPlan.processInstanceId === instance.id) ?? null;
}

function getNode(nodeId) {
  return state.processTemplateNodes.find((node) => node.id === nodeId) ?? null;
}

function getProgress(instanceId) {
  const progress = selectProcessProgress(instanceId, state);
  return `${progress.completed}/${progress.total}`;
}

function isAdminUser(user) {
  const role = user?.role ?? "";
  const authRole = user?.authRole ?? "";
  return role === "admin" || role === "system_admin" || authRole === "admin";
}

export function canEditLaunchedProcessInstance(instance, user = getCurrentUser()) {
  if (instance === null || instance === undefined) return false;
  if (instance.status !== ProcessInstanceStatus.Running) return false;
  if (isAdminUser(user)) return true;
  const userPersonId = user?.personId ?? user?.id ?? "";
  return userPersonId !== "" && instance.initiatorId === userPersonId;
}

function canEditInstance(instance) {
  return canEditLaunchedProcessInstance(instance);
}

function canManageActionProducts(instance) {
  return canEditInstance(instance) && hasPermission(getCurrentUser(), "products.view");
}

function canEditTask(task) {
  return task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled;
}

function canChangeTaskExecutor(instance, task, user = getCurrentUser()) {
  if (!executorEditableTaskStatuses.has(task.status)) return false;
  if (isAdminUser(user)) return true;
  const userPersonId = user?.personId ?? user?.id ?? "";
  const processOwnerId = getProcessInstanceOwner(instance.id, state).userId;
  const processNode = getNode(task.processNodeId);
  const stepOwnerId = processNode === null ? task.ownerId : processNode.ownerId;
  return userPersonId !== "" && (userPersonId === processOwnerId || userPersonId === stepOwnerId);
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function getStandardWorkAttachments(instance) {
  const attachments = instance.customFields?.[standardWorkAttachmentsKey];
  return Array.isArray(attachments) ? attachments : [];
}

export function getLinkedActionTemplateIds(source) {
  const customFields = source?.customFields ?? source ?? {};
  const templateIds = customFields?.[linkedActionTemplateIdsKey];
  if (!Array.isArray(templateIds)) return [];
  return [...new Set(templateIds.map((templateId) => String(templateId ?? "").trim()).filter(Boolean))];
}

function getTemplateTagCategories() {
  return (state.templateTagCategories ?? [])
    .filter((category) => category.status !== "inactive")
    .slice()
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((category) => ({ id: category.id, label: category.name ?? category.label ?? category.id }));
}

function normalizeTemplateTags(tags) {
  const categories = getTemplateTagCategories();
  const normalized = Object.fromEntries(categories.map((category) => [category.id, []]));
  if (Array.isArray(tags)) {
    const fallbackCategoryId = categories.find((category) => category.id === "usage")?.id ?? categories[0]?.id;
    if (fallbackCategoryId !== undefined) normalized[fallbackCategoryId] = tags.map((tag) => String(tag ?? "").trim()).filter(Boolean);
    return normalized;
  }
  if (tags === null || typeof tags !== "object") return normalized;
  categories.forEach((category) => {
    normalized[category.id] = Array.isArray(tags[category.id])
      ? [...new Set(tags[category.id].map((tag) => String(tag ?? "").trim()).filter(Boolean))]
      : [];
  });
  return normalized;
}

function getTemplateFlatTags(template) {
  const tags = normalizeTemplateTags(template?.tags);
  return getTemplateTagCategories().flatMap((category) => tags[category.id] ?? []);
}

function getLinkedTemplateName(template) {
  const nameFromTags = getTemplateFlatTags(template).join(" ");
  return nameFromTags || template?.name || "未命名模板";
}

function getLinkedTemplatePreviewUrl(template) {
  const previewUrl = template?.previewImage?.fileUrl ?? template?.previewImage?.url ?? "";
  if (previewUrl !== "") return resolveAssetUrl(previewUrl);
  if (template?.fileType === "image") return resolveAssetUrl(template.fileUrl ?? "");
  return "";
}

function renderLinkedTemplateTags(template) {
  const tags = getTemplateFlatTags(template);
  if (tags.length === 0) return "";
  return `<div class="action-template-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`;
}

export function renderActionLinkedTemplates(instance, { editable = false, compact = false } = {}) {
  const templateIds = getLinkedActionTemplateIds(instance);
  const templates = templateIds
    .map((templateId) => state.templates.find((template) => template.id === templateId) ?? null)
    .filter(Boolean);

  if (templates.length === 0) {
    return `<div class="action-linked-template-empty">暂无关联模板</div>`;
  }

  return `
    <div class="action-linked-template-grid ${compact ? "is-compact" : ""}" data-action-linked-template-list>
      ${templates
        .map((template) => {
          const previewUrl = getLinkedTemplatePreviewUrl(template);
          return `
            <article class="action-linked-template-card">
              <div
                class="action-linked-template-thumb"
                ${previewUrl === "" ? "" : `data-action-template-preview-url="${escapeHtml(previewUrl)}" data-action-template-preview-title="${escapeHtml(getLinkedTemplateName(template))}"`}
              >
                ${previewUrl === "" ? `<span>无预览</span>` : `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(getLinkedTemplateName(template))}" />`}
              </div>
              <div class="action-linked-template-meta">
                <strong>${escapeHtml(getLinkedTemplateName(template))}</strong>
                ${renderLinkedTemplateTags(template)}
              </div>
              ${
                editable
                  ? `<button class="text-button danger-button" type="button" data-action="remove-action-template" data-template-id="${escapeHtml(template.id)}">移除</button>`
                  : ""
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderActionTemplatePicker(
  selectedTemplateIds,
  {
    title = "关联模板",
    confirmLabel = "完成",
    confirmAction = "close-action-template-picker",
    closeAction = "close-action-template-picker",
    error = "",
    saving = false,
  } = {},
) {
  const categories = getTemplateTagCategories();
  const selectedIds = new Set(selectedTemplateIds);
  const groupedTags = Object.fromEntries(categories.map((category) => [category.id, []]));
  state.templates.forEach((template) => {
    const tags = normalizeTemplateTags(template.tags);
    categories.forEach((category) => {
      groupedTags[category.id] = [...new Set([...(groupedTags[category.id] ?? []), ...(tags[category.id] ?? [])])];
    });
  });

  return `
    <div class="modal-backdrop content-template-picker-backdrop action-template-picker-backdrop" role="presentation" data-action-template-picker>
      <div class="modal-panel extra-wide-modal action-template-picker" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-header">
          <h2>${escapeHtml(title)}</h2>
          <button class="icon-button" type="button" data-action="${escapeHtml(closeAction)}" aria-label="关闭">×</button>
        </div>
        <div class="content-template-picker">
          <div class="content-template-picker-toolbar">
            <input data-action-template-search placeholder="搜索模板名称或标签" autocomplete="off" />
          </div>
          <div class="content-template-picker-layout">
            <aside class="content-template-picker-filters">
              ${categories
                .map(
                  (category) => `
                    <div class="content-template-filter-group">
                      <h3>${escapeHtml(category.label)}</h3>
                      <div class="template-tag-cloud">
                        ${(groupedTags[category.id] ?? [])
                          .map(
                            (tag) =>
                              `<button type="button" data-action="filter-action-template" data-template-category="${escapeHtml(category.id)}" data-template-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`,
                          )
                          .join("")}
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </aside>
            <div class="content-template-picker-main">
              <div class="content-template-picker-grid" data-action-template-options>
                ${state.templates
                  .map((template) => {
                    const previewUrl = getLinkedTemplatePreviewUrl(template);
                    const name = getLinkedTemplateName(template);
                    const tags = normalizeTemplateTags(template.tags);
                    const selected = selectedIds.has(template.id);
                    return `
                      <article
                        class="content-template-option ${selected ? "is-selected" : ""}"
                        data-action-template-option
                        data-template-id="${escapeHtml(template.id)}"
                        data-template-search="${escapeHtml(`${name} ${getTemplateFlatTags(template).join(" ")}`.toLowerCase())}"
                        data-template-tags="${escapeHtml(encodeURIComponent(JSON.stringify(tags)))}"
                      >
                        <div
                          class="content-template-option-thumb"
                          ${previewUrl === "" ? "" : `data-action-template-preview-url="${escapeHtml(previewUrl)}" data-action-template-preview-title="${escapeHtml(name)}"`}
                        >
                          ${previewUrl === "" ? `<span>无预览</span>` : `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(name)}" />`}
                        </div>
                        <h3>${escapeHtml(name)}</h3>
                        ${renderLinkedTemplateTags(template)}
                        <button class="${selected ? "secondary-button" : "primary-button"}" type="button" data-action="toggle-action-template" data-template-id="${escapeHtml(template.id)}">${selected ? "已选择" : "选择"}</button>
                      </article>
                    `;
                  })
                  .join("")}
              </div>
              <div class="empty-detail" data-action-template-empty ${state.templates.length === 0 ? "" : "hidden"}>暂无匹配模板</div>
            </div>
          </div>
        </div>
        ${error === "" ? "" : `<div class="form-error action-template-picker-error">${escapeHtml(error)}</div>`}
        <div class="modal-footer">
          <button class="primary-button" type="button" data-action="${escapeHtml(confirmAction)}" ${saving ? "disabled" : ""}>${escapeHtml(saving ? "保存中…" : confirmLabel)}</button>
        </div>
      </div>
    </div>
  `;
}

function getTaskReturnRecords(task) {
  const records = task.customFields?.[returnRecordsKey];
  return Array.isArray(records) ? records : [];
}

function getInstanceReturnRecords(instanceId) {
  const records = getInstanceTasks(instanceId).flatMap((task) => getTaskReturnRecords(task));
  const uniqueRecords = new Map();
  records.forEach((record) => {
    if (record?.id !== undefined) uniqueRecords.set(record.id, record);
  });
  return [...uniqueRecords.values()].sort((left, right) => String(right.returnedAt ?? "").localeCompare(String(left.returnedAt ?? "")));
}

function renderReturnRecords(instanceId, { embedded = false } = {}) {
  const records = getInstanceReturnRecords(instanceId);
  if (records.length === 0) return "";

  return `
    <div class="${embedded ? "process-record-section" : "detail-block"}">
      <h3>退回记录</h3>
      <div class="return-record-list">
        ${records
          .map(
            (record) => `
              <div class="return-record-item">
                <strong>${escapeHtml(record.returnedAt ?? "未记录时间")} ${escapeHtml(record.returnedByName ?? "未记录人员")}在“${escapeHtml(record.fromTaskName ?? "当前节点")}”退回到“${escapeHtml(record.toTaskName ?? "目标节点")}”</strong>
                <p>原因：${escapeHtml(record.reason ?? "未填写")}</p>
                ${
                  Array.isArray(record.affectedTaskNames) && record.affectedTaskNames.length > 0
                    ? `<p>影响节点：${record.affectedTaskNames.map((name) => escapeHtml(name)).join("、")}</p>`
                    : ""
                }
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderStandardWorkAttachments(instance) {
  const attachments = getStandardWorkAttachments(instance);
  return `
    <div class="detail-block">
      <h3>附件</h3>
      ${
        attachments.length === 0
          ? `<p>暂无附件</p>`
          : `
            <ul class="attachment-list">
              ${attachments
                .map((attachment) => {
                  const href = resolveAssetUrl(attachment.filePath ?? attachment.url ?? "");
                  const name = attachment.originalName ?? attachment.filename ?? attachment.filePath ?? "未命名附件";
                  return `
                    <li>
                      <a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" download>${escapeHtml(name)}</a>
                      ${attachment.ext ? `<span>${escapeHtml(attachment.ext)}</span>` : ""}
                    </li>
                  `;
                })
                .join("")}
            </ul>
          `
      }
    </div>
  `;
}

function renderEditableStandardWorkAttachments(instance, editable, { embedded = false } = {}) {
  const attachments = getStandardWorkAttachments(instance);
  if (!editable) {
    if (!embedded) return renderStandardWorkAttachments(instance);
    return `<div class="process-record-section"><h3>附件</h3>${attachments.length === 0 ? `<p>暂无附件</p>` : `<ul class="attachment-list">${attachments.map((attachment) => { const href = resolveAssetUrl(attachment.filePath ?? attachment.url ?? ""); const name = attachment.originalName ?? attachment.filename ?? attachment.filePath ?? "未命名附件"; return `<li><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" download>${escapeHtml(name)}</a>${attachment.ext ? `<span>${escapeHtml(attachment.ext)}</span>` : ""}</li>`; }).join("")}</ul>`}</div>`;
  }

  return `
    <div class="${embedded ? "process-record-section" : "detail-block"} standard-work-attachments-field">
      <h3>附件</h3>
      <p class="form-note">支持 .xlsx、.xls、.csv、.xmind，单个文件不超过 20MB。新增附件会追加到已有附件；删除只移除关联，不删除 uploads 里的实际文件。</p>
      <div data-existing-standard-work-attachments>
        ${
          attachments.length === 0
            ? `<p class="form-note">暂无已有附件</p>`
            : `
              <ul class="attachment-list editable-attachment-list">
                ${attachments
                  .map((attachment, index) => {
                    const href = resolveAssetUrl(attachment.filePath ?? attachment.url ?? "");
                    const name = attachment.originalName ?? attachment.filename ?? attachment.filePath ?? "未命名附件";
                    return `
                      <li data-existing-attachment-item>
                        <input type="hidden" name="existingStandardWorkAttachment" value="${escapeHtml(JSON.stringify(attachment))}" />
                        <a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" download>${escapeHtml(name)}</a>
                        ${attachment.ext ? `<span>${escapeHtml(attachment.ext)}</span>` : ""}
                        <button class="text-button danger-button" type="button" data-action="remove-existing-standard-work-attachment" data-attachment-index="${index}">删除关联</button>
                      </li>
                    `;
                  })
                  .join("")}
              </ul>
            `
        }
      </div>
      <label>
        <span>新增附件</span>
        <input name="standardWorkAttachments" type="file" accept="${standardWorkAttachmentAccept}" multiple data-standard-work-attachments />
      </label>
      <div class="selected-attachment-list" data-selected-standard-work-attachments>
        <p class="form-note">暂无新选择附件</p>
      </div>
    </div>
  `;
}

function renderCustomFields(instance, editable) {
  const formFields = getInstanceFormFields(instance);
  const isContentNote = isContentNoteInstance(instance);
  const mode = normalizePublishTimeMode(instance.customFields?.publishTimeMode);

  if (!editable) {
    const visibleFields = isContentNote && mode === PublishTimeMode.Deadline
      ? formFields.filter((field) => field.key !== "publishDate")
      : formFields;
    const publishMode = isContentNote && mode === PublishTimeMode.Deadline
      ? `<div class="work-form-viewer"><div class="work-form-row"><span>发布时间</span><strong>跟随截止时间</strong></div></div>`
      : "";
    return `${publishMode}${renderWorkFormViewer({
      formFields: visibleFields,
      customFields: instance.customFields ?? {},
    })}`;
  }

  const editor = renderPublicFormEditor({
    fields: formFields,
    customFields: instance.customFields ?? {},
    title: "",
  }) || `<p>暂无关键行动公共信息</p>`;
  if (!isContentNote) return editor;
  return `
    <div class="publish-time-mode-panel" data-publish-time-mode-panel>
      <span class="publish-time-mode-title">发布时间</span>
      <label><input type="radio" name="publishTimeMode" value="custom" ${mode === PublishTimeMode.Custom ? "checked" : ""} /> 自定义时间</label>
      <label><input type="radio" name="publishTimeMode" value="deadline" ${mode === PublishTimeMode.Deadline ? "checked" : ""} /> 同截止时间</label>
      <div class="publish-time-deadline-preview" data-publish-time-deadline-preview ${mode === PublishTimeMode.Deadline ? "" : "hidden"}>
        <strong>跟随截止时间</strong>
        <span data-publish-time-deadline-value>${escapeHtml(formatBusinessDateTime(instance.dueDate, "请先设置截止时间"))}</span>
      </div>
    </div>
    ${editor}
  `;
}

function updatePublishTimeModeUi(form) {
  if (form?.elements.publishTimeMode === undefined) return;
  const mode = form.elements.publishTimeMode.value || PublishTimeMode.Custom;
  const followsDeadline = mode === PublishTimeMode.Deadline;
  const publishDateInput = form.querySelector('[name="custom__publishDateDate"]');
  const publishHourInput = form.querySelector('[name="custom__publishDateHour"]');
  const field = publishDateInput?.closest("label");
  if (field !== null && field !== undefined) field.hidden = followsDeadline;
  if (publishDateInput !== null) publishDateInput.disabled = followsDeadline;
  if (publishHourInput !== null) publishHourInput.disabled = followsDeadline;
  const preview = form.querySelector("[data-publish-time-deadline-preview]");
  if (preview !== null) preview.hidden = !followsDeadline;
  const deadlineValue = form.querySelector("[data-publish-time-deadline-value]");
  if (deadlineValue !== null) {
    const result = collectBusinessDateTime(form, "instanceDueDate");
    deadlineValue.textContent = result.value ? formatBusinessDateTime(result.value) : "请先设置截止时间";
  }
}

function renderPersonIdentity(personId, fallback = "未设置") {
  const person = people.find((item) => item.id === personId) ?? null;
  const personName = person?.name ?? fallback;
  const avatarUrl = person?.avatarUrl ? resolveAssetUrl(person.avatarUrl) : "";
  const avatarInitial = Array.from(personName.trim())[0] || "未";
  return `
    <span class="process-task-person" title="${escapeHtml(personName)}">
      ${
        avatarUrl === ""
          ? `<span class="process-task-person-avatar process-task-person-avatar-placeholder" aria-hidden="true">${escapeHtml(avatarInitial)}</span>`
          : `<img class="process-task-person-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(personName)}头像" />`
      }
      <span>${escapeHtml(personName)}</span>
    </span>
  `;
}

function renderTaskExecutorCell(instance, task, displayedExecutorId) {
  const canChangeExecutor = canChangeTaskExecutor(instance, task);
  return `
    <div class="process-task-executor-cell">
      ${renderPersonIdentity(displayedExecutorId)}
      ${
        canChangeExecutor
          ? `<button class="text-button" type="button" data-action="open-task-executor-picker" data-task-id="${escapeHtml(task.id)}">调整</button>`
          : ""
      }
    </div>
  `;
}

function groupStepTasks(tasks) {
  const groups = [];
  const byKey = new Map();
  tasks.forEach((task) => {
    const node = getNode(task.processNodeId);
    const key = task.processNodeId || `task-${task.id}`;
    if (!byKey.has(key)) {
      const group = { key, node, stepIndex: groups.length, tasks: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).tasks.push(task);
  });
  return groups;
}

function getStepGroupStatus(tasks) {
  if (tasks.length === 0) return "未安排";
  if (tasks.every((task) => task.status === TaskStatus.Done)) return "已完成";
  const activeTask = tasks.find((task) => task.status === TaskStatus.Doing)
    ?? tasks.find((task) => task.status === TaskStatus.Todo)
    ?? tasks.find((task) => task.status === TaskStatus.Waiting)
    ?? tasks.find((task) => task.status !== TaskStatus.Canceled)
    ?? tasks[0];
  return getTaskBusinessStatus(activeTask).label;
}

function renderStepTaskCard(instance, group, editable) {
  const tasks = group.tasks;
  const completed = tasks.filter((task) => task.status === TaskStatus.Done).length;
  const percent = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
  const currentTask = tasks.find((task) => task.status === TaskStatus.Doing)
    ?? tasks.find((task) => task.status === TaskStatus.Todo)
    ?? tasks.find((task) => task.status === TaskStatus.Waiting)
    ?? tasks[0];
  const processNode = group.node;
  const ownerId = processNode?.ownerId || currentTask?.ownerId || "";
  const executorId = currentTask?.executorId || processNode?.executorId || "";
  const startAt = currentTask?.startedAt || currentTask?.readyAt || currentTask?.startDate || currentTask?.createdAt || "";
  const dueAt = currentTask?.dueDate || "";
  const stepName = processNode?.name || currentTask?.name || "未命名步骤";

  return `
    <article class="process-step-card">
      <header class="process-step-card-header">
        <div class="process-step-number">${escapeHtml(formatProcessStepLabel(group.stepIndex + 1))}</div>
        <div class="process-step-title"><h4>${escapeHtml(stepName)}</h4></div>
        <span class="status-pill">${escapeHtml(getStepGroupStatus(tasks))}</span>
      </header>
      <div class="process-step-progress" aria-label="步骤完成进度 ${percent}%"><span style="width:${percent}%"></span></div>
      <div class="process-step-summary">
        <div><span>当前负责人</span>${renderPersonIdentity(ownerId)}</div>
        <div><span>当前执行人</span>${renderPersonIdentity(executorId)}</div>
        <div><span>开始时间</span><strong>${escapeHtml(formatBusinessMinuteDateTime(startAt))}</strong></div>
        <div><span>截止时间</span><strong>${escapeHtml(formatBusinessMinuteDateTime(dueAt))}</strong></div>
      </div>
      <div class="process-step-task-list">
        ${group.tasks.map((task) => {
          const canEdit = editable && canEditTask(task);
          const taskDueDateFieldName = `task__${task.id}__dueDate`;
          const taskNode = getNode(task.processNodeId);
          const displayedExecutorId = task.executorId || taskNode?.executorId || "";
          return `<div class="process-step-task-row">
            <button class="process-step-task-link" type="button" data-launched-process-task-id="${escapeHtml(task.id)}"><span>${escapeHtml(task.name)}</span><small>查看任务 →</small></button>
            <span class="status-pill">${escapeHtml(getTaskBusinessStatus(task).label)}</span>
            <div>${renderTaskExecutorCell(instance, task, displayedExecutorId)}</div>
            ${canEdit ? `<label class="process-step-owner-edit"><span>负责人</span><select name="task__${task.id}__ownerId">${renderOptions(people, task.ownerId, "请选择负责人")}</select></label>` : `<span class="process-step-owner-readonly">负责人：${escapeHtml(findName(people, taskNode?.ownerId || task.ownerId, "未设置"))}</span>`}
            ${canEdit ? `<div class="process-step-due-edit"><input name="${taskDueDateFieldName}Date" type="date" value="${escapeHtml(getBusinessDatePart(task.dueDate))}" data-task-due-date-control="${task.id}" /><select name="${taskDueDateFieldName}Time" data-task-due-date-control="${task.id}">${renderBusinessMinuteOptions(getBusinessMinutePart(task.dueDate), "时间")}</select><input name="${taskDueDateFieldName}Changed" type="hidden" value="false" /></div>` : `<span>${escapeHtml(formatBusinessMinuteDateTime(task.dueDate))}</span>`}
          </div>`;
        }).join("")}
      </div>
    </article>
  `;
}

function renderStandardStepTasks(instance, tasks, editable) {
  const groups = groupStepTasks(tasks);
  const progress = selectProcessProgress(instance.id, state);
  return `
    <section class="detail-block process-step-priority-block">
      <div class="section-heading with-actions compact-heading">
        <div><h3>标准步骤任务</h3></div>
        <strong class="process-overall-progress">总进度 ${progress.completed}/${progress.total}</strong>
      </div>
      ${groups.length === 0 ? `<div class="empty-detail">当前关键行动尚未生成标准步骤任务</div>` : `<div class="process-step-card-list">${groups.map((group) => renderStepTaskCard(instance, group, editable)).join("")}</div>`}
    </section>
  `;
}

function renderProcessRecords(instance, editable) {
  return `
    <section class="detail-block process-records-block">
      <h3>过程记录</h3>
      <div class="process-record-columns">
        <div><h4>操作与问题记录</h4>${renderReturnRecords(instance.id, { embedded: true }) || `<p class="form-note">暂无退回或问题记录</p>`}</div>
        <div><h4>沟通与附件记录</h4>${renderEditableStandardWorkAttachments(instance, editable, { embedded: true })}</div>
      </div>
    </section>
  `;
}

function renderResultReview(tasks) {
  const completedTasks = tasks.filter((task) => task.status === TaskStatus.Done || task.completedAt || task.resultText);
  return `
    <section class="detail-block process-result-review-block">
      <h3>结果与复盘</h3>
      ${completedTasks.length === 0 ? `<p class="form-note">暂无已提交的工作结果或验收结果</p>` : `<div class="process-result-list">${completedTasks.map((task) => `<article><div><strong>${escapeHtml(task.name)}</strong><span class="status-pill">${escapeHtml(getTaskBusinessStatus(task).label)}</span></div><p>${escapeHtml(task.resultText || task.reviewComment || "已完成，暂无文字结果")}</p><small>完成时间：${escapeHtml(formatBusinessMinuteDateTime(task.completedAt))} · 验收：${escapeHtml(task.reviewStatus || (task.needAcceptance ? "待验收" : "无需验收"))}</small><button class="text-button" type="button" data-launched-process-task-id="${escapeHtml(task.id)}">查看任务详情</button></article>`).join("")}</div>`}
    </section>
  `;
}

function renderTaskExecutorPicker(instance) {
  if (taskExecutorPickerState?.instanceId !== instance.id) return "";
  const task = getInstanceTasks(instance.id).find((item) => item.id === taskExecutorPickerState.taskId) ?? null;
  if (task === null || !canChangeTaskExecutor(instance, task)) return "";
  const departments = state.departments.filter((department) => department.status !== "inactive");
  const activePeople = people.filter((person) => person.status !== "inactive");
  return `
    <div class="modal-backdrop task-executor-picker-backdrop" role="presentation" data-task-executor-picker>
      <div class="modal-panel task-executor-picker" role="dialog" aria-modal="true" aria-label="调整执行人">
        <div class="modal-header">
          <div>
            <h2>调整执行人</h2>
            <p>${escapeHtml(task.name)}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-task-executor-picker" aria-label="关闭">×</button>
        </div>
        <div class="task-executor-picker-filters">
          <input type="search" placeholder="搜索人员" autocomplete="off" data-task-executor-search />
          <select data-task-executor-department>
            ${renderOptions(departments, "", "全部部门")}
          </select>
        </div>
        <div class="form-error" ${taskExecutorPickerState.error === "" ? "hidden" : ""}>${escapeHtml(taskExecutorPickerState.error)}</div>
        <div class="task-executor-picker-grid" data-task-executor-options>
          ${activePeople
            .map(
              (person) => `
                <button
                  class="task-executor-option ${person.id === task.executorId ? "is-current" : ""}"
                  type="button"
                  data-action="select-task-executor"
                  data-person-id="${escapeHtml(person.id)}"
                  data-person-search="${escapeHtml(`${person.name ?? ""} ${findName(state.departments, person.departmentId, "")}`.toLowerCase())}"
                  data-department-id="${escapeHtml(person.departmentId ?? "")}"
                >
                  ${renderPersonIdentity(person.id)}
                  <small>${escapeHtml(findName(state.departments, person.departmentId, "未设置部门"))}</small>
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="empty-detail" data-task-executor-empty hidden>暂无匹配人员</div>
      </div>
    </div>
  `;
}

function filterTaskExecutorOptions(picker) {
  const keyword = picker.querySelector("[data-task-executor-search]")?.value.trim().toLowerCase() ?? "";
  const departmentId = picker.querySelector("[data-task-executor-department]")?.value ?? "";
  let visibleCount = 0;
  picker.querySelectorAll(".task-executor-option").forEach((option) => {
    const matchesKeyword = keyword === "" || (option.dataset.personSearch ?? "").includes(keyword);
    const matchesDepartment = departmentId === "" || option.dataset.departmentId === departmentId;
    option.hidden = !matchesKeyword || !matchesDepartment;
    if (!option.hidden) visibleCount += 1;
  });
  const empty = picker.querySelector("[data-task-executor-empty]");
  if (empty !== null) empty.hidden = visibleCount > 0;
}

function collectTaskDueDateForLaunchedProcess(form, task) {
  const fieldName = `task__${task.id}__dueDate`;
  if (getFormValue(form, `${fieldName}Changed`) !== "true") return { value: task.dueDate ?? null, error: "" };

  const data = new FormData(form);
  const date = data.get(`${fieldName}Date`)?.toString().trim() ?? "";
  const time = data.get(`${fieldName}Time`)?.toString().trim() ?? "";
  const originalDate = getBusinessDatePart(task.dueDate);
  const originalTime = getBusinessMinutePart(task.dueDate);

  if (date === originalDate && time === originalTime) return { value: task.dueDate ?? null, error: "" };

  return collectBusinessMinuteDateTime(form, fieldName);
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
  const actionOwner = getProcessInstanceOwner(instance.id, state);
  const actionOwnerName = findName(people, actionOwner.userId, "未设置");
  const businessStatus = selectProcessInstanceBusinessStatus(instance.id, state);
  const deadline = getActionDeadlinePresentation(instance);
  const primaryProduct = getActionProducts(instance.id)[0] ?? null;
  const primaryProductImage = primaryProduct?.productImage || primaryProduct?.erpSkuImage || primaryProduct?.mainImage || instance.coverImageUrl || "";

  return `
    <section class="settings-section process-detail launched-process-detail" data-launched-process-detail="${instance.id}">
      <div class="section-heading with-actions">
        <h2>${escapeHtml(instance.displayTitle ?? instance.name)}</h2>
        ${editable ? `<button class="primary-button" type="submit" form="launched-process-form-${instance.id}">保存修改</button>` : `<span class="muted-action">只读</span>`}
      </div>
      <div class="key-action-detail-summary">
        <div><span>当前状态</span><strong>${escapeHtml(businessStatus.label)}</strong></div>
        <div><span>行动负责人</span><strong>${escapeHtml(actionOwnerName)}</strong></div>
        <div class="key-action-detail-countdown ${deadline.overdue ? "is-overdue" : ""}"><span>截止提醒</span><strong data-action-deadline-id="${escapeHtml(instance.id)}">${escapeHtml(formatBusinessDateTime(instance.dueDate, "未设置"))} · ${escapeHtml(deadline.label)}</strong></div>
      </div>
      <div class="key-action-detail-hero">
        ${primaryProductImage ? `<img loading="lazy" src="${escapeHtml(resolveAssetUrl(primaryProductImage))}" alt="${escapeHtml(primaryProduct?.name || instance.displayTitle || instance.name)}" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'task-cover-placeholder', textContent: '无图' }))" />` : `<span class="task-cover-placeholder">无图</span>`}
      </div>
      <form id="launched-process-form-${instance.id}" class="launched-process-form">
        <div class="form-error" hidden></div>
        ${renderStandardStepTasks(instance, tasks, editable)}
        <div class="detail-block key-action-information-block">
          <h3>关键行动信息</h3>
          <div class="form-grid">
            <label>
              <span>本次标准名称</span>
              <input name="name" value="${escapeHtml(instance.name)}" ${editable ? "" : "disabled"} />
            </label>
            <label>
              <span>关联目标</span>
              <select name="goalId" ${editable ? "" : "disabled"}>${renderOptions(getSelectableGoals(instance.goalId), instance.goalId, "请选择目标")}</select>
            </label>
            <label>
              <span>截止时间日期</span>
              <input name="instanceDueDateDate" type="date" value="${escapeHtml(getBusinessDatePart(instance.dueDate))}" ${editable ? "" : "disabled"} />
            </label>
            <label>
              <span>截止时间小时</span>
              <select name="instanceDueDateHour" ${editable ? "" : "disabled"}>${renderBusinessHourOptions(getBusinessHourPart(instance.dueDate), "请选择小时")}</select>
            </label>
          </div>
          <div class="detail-grid">
            ${renderDetailField("执行标准", escapeHtml(template?.name ?? taskTemplate?.name ?? "未设置"))}
            ${renderDetailField("价值链分类", escapeHtml(state.categories.find((category) => category.id === taskTemplate?.categoryId)?.name ?? "未设置"))}
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
            <span>本次关键行动说明</span>
            <textarea name="description" rows="3" ${editable ? "" : "disabled"}>${escapeHtml(instance.description ?? "")}</textarea>
          </label>
        </div>
        ${instance.customFields?.source === "sales_anomaly" ? `${renderUiModule("business_improvement_result", { state: improvementResultState.get(instance.id) || { loading: true } })}<div class="detail-block action-anomaly-source"><h3>销售异常来源</h3><div class="detail-grid">${renderDetailField("关联对象", escapeHtml(instance.customFields.productId || instance.customFields.salesLinkId || "未记录"))}${renderDetailField("异常类型", escapeHtml(instance.customFields.anomalySnapshot?.anomalyType || "未记录"))}${renderDetailField("行动标准", escapeHtml(instance.customFields.recommendedActionStandard?.name || getTaskTemplate(instance)?.name || "未记录"))}${renderDetailField("标准目标", escapeHtml(instance.customFields.recommendedActionStandard?.target || getTaskTemplate(instance)?.completionStandard || "未维护"))}${renderDetailField("流程说明", escapeHtml(instance.customFields.recommendedActionStandard?.processDescription || getTemplate(instance)?.purpose || "未维护"))}${renderDetailField("当前周期", escapeHtml(`${instance.customFields.anomalySnapshot?.currentPeriod?.startDate || "—"} 至 ${instance.customFields.anomalySnapshot?.currentPeriod?.endDate || "—"}`))}${renderDetailField("对比周期", escapeHtml(`${instance.customFields.anomalySnapshot?.comparePeriod?.startDate || "—"} 至 ${instance.customFields.anomalySnapshot?.comparePeriod?.endDate || "—"}`))}${renderDetailField("当前值", escapeHtml(instance.customFields.anomalySnapshot?.currentValue ?? "暂无数据"))}${renderDetailField("对比值", escapeHtml(instance.customFields.anomalySnapshot?.compareValue ?? "暂无数据"))}</div><p class="form-note">来源快照用于追溯，不代表系统已经判断原因或给出改善方案。</p></div>` : ""}
        <div class="detail-block">
          <h3>关键行动表单</h3>
          ${renderCustomFields(instance, editable)}
        </div>
        <div class="detail-block">
          <h3>关联产品</h3>
          ${canManageActionProducts(instance) ? renderActionProductSelector(getActionProductIds(instance.id), { label: "选择产品", actionId: instance.id }) : renderLinkedActionProducts(instance.id)}
        </div>
        <div class="detail-block action-linked-template-section">
          <div class="section-heading with-actions compact-heading">
            <h3>视觉模板</h3>
            ${editable ? `<button class="secondary-button" type="button" data-action="open-action-template-picker">关联视觉模板</button>` : ""}
          </div>
          <input type="hidden" name="${linkedActionTemplateIdsKey}" value="${escapeHtml(JSON.stringify(getLinkedActionTemplateIds(instance)))}" />
          <div data-action-linked-template-list-host>
            ${renderActionLinkedTemplates(instance, { editable })}
          </div>
          ${editable ? `<div data-action-template-picker-host></div>` : ""}
        </div>
        ${renderProcessRecords(instance, editable)}
        ${renderResultReview(tasks)}
      </form>
      ${renderTaskExecutorPicker(instance)}
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

function collectExistingStandardWorkAttachments(form) {
  return [...form.querySelectorAll("[name='existingStandardWorkAttachment']")]
    .map((input) => {
      try {
        return JSON.parse(input.value);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function uploadSelectedStandardWorkAttachments(form, instanceId) {
  const input = form.elements.standardWorkAttachments;
  const files = input?.files === undefined ? [] : Array.from(input.files);
  const validationError = validateStandardWorkAttachmentFiles(files);
  if (validationError !== "") throw new Error(validationError);

  const uploaded = [];
  for (const file of files) {
    const attachment = await uploadStandardWorkAttachment(file);
    uploaded.push({
      originalName: attachment.originalName,
      filePath: attachment.filePath ?? attachment.url,
      url: attachment.url,
      mimeType: attachment.mimeType,
      ext: attachment.ext ?? getFileExt(attachment.originalName ?? attachment.filename ?? ""),
      uploadedAt: attachment.uploadedAt ?? getNow(),
      processInstanceId: instanceId,
    });
  }
  return uploaded;
}

function renderSelectedStandardWorkAttachments(input) {
  const container = input.closest(".standard-work-attachments-field")?.querySelector("[data-selected-standard-work-attachments]");
  if (container === null || container === undefined) return;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) {
    container.innerHTML = `<p class="form-note">暂无新选择附件</p>`;
    return;
  }
  container.innerHTML = `
    <ul class="attachment-list editable-attachment-list">
      ${files
        .map(
          (file, index) => `
            <li>
              <span>${escapeHtml(file.name)}</span>
              <button class="text-button" type="button" data-action="remove-selected-standard-work-attachment" data-attachment-index="${index}">删除</button>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function removeSelectedStandardWorkAttachment(button) {
  const field = button.closest(".standard-work-attachments-field");
  const input = field?.querySelector("[data-standard-work-attachments]");
  if (input === null || input === undefined) return;
  const removeIndex = Number(button.dataset.attachmentIndex);
  const transfer = new DataTransfer();
  Array.from(input.files ?? []).forEach((file, index) => {
    if (index !== removeIndex) transfer.items.add(file);
  });
  input.files = transfer.files;
  renderSelectedStandardWorkAttachments(input);
}

function getSelectedActionTemplateIds(form) {
  const value = form.elements[linkedActionTemplateIdsKey]?.value ?? "[]";
  try {
    return getLinkedActionTemplateIds({ [linkedActionTemplateIdsKey]: JSON.parse(value) });
  } catch {
    return [];
  }
}

function setSelectedActionTemplateIds(form, templateIds) {
  const normalizedIds = getLinkedActionTemplateIds({ [linkedActionTemplateIdsKey]: templateIds });
  const input = form.elements[linkedActionTemplateIdsKey];
  if (input !== undefined) input.value = JSON.stringify(normalizedIds);
  const instance = getInstance(form.closest("[data-launched-process-detail]")?.dataset.launchedProcessDetail ?? "");
  const listHost = form.querySelector("[data-action-linked-template-list-host]");
  if (listHost !== null) {
    listHost.innerHTML = renderActionLinkedTemplates(
      { ...(instance ?? {}), customFields: { ...(instance?.customFields ?? {}), [linkedActionTemplateIdsKey]: normalizedIds } },
      { editable: true },
    );
  }
  form.querySelectorAll("[data-action-template-option]").forEach((option) => {
    const selected = normalizedIds.includes(option.dataset.templateId ?? "");
    option.classList.toggle("is-selected", selected);
    const button = option.querySelector("[data-action='toggle-action-template']");
    if (button === null) return;
    button.textContent = selected ? "已选择" : "选择";
    button.classList.toggle("primary-button", !selected);
    button.classList.toggle("secondary-button", selected);
  });
}

export function filterActionTemplateOptions(picker) {
  const query = picker.querySelector("[data-action-template-search]")?.value.trim().toLowerCase() ?? "";
  const selectedTags = new Map();
  picker.querySelectorAll("[data-action='filter-action-template'].is-active").forEach((button) => {
    const categoryId = button.dataset.templateCategory ?? "";
    const categoryTags = selectedTags.get(categoryId) ?? [];
    categoryTags.push(button.dataset.templateTag ?? "");
    selectedTags.set(categoryId, categoryTags);
  });

  let visibleCount = 0;
  picker.querySelectorAll("[data-action-template-option]").forEach((option) => {
    let tags = {};
    try {
      tags = JSON.parse(decodeURIComponent(option.dataset.templateTags ?? ""));
    } catch {
      tags = {};
    }
    const matchesQuery = query === "" || (option.dataset.templateSearch ?? "").includes(query);
    const matchesTags = [...selectedTags.entries()].every(([categoryId, requiredTags]) =>
      requiredTags.every((tag) => (tags[categoryId] ?? []).includes(tag)),
    );
    option.hidden = !matchesQuery || !matchesTags;
    if (!option.hidden) visibleCount += 1;
  });
  const empty = picker.querySelector("[data-action-template-empty]");
  if (empty !== null) empty.hidden = visibleCount > 0;
}

export function updateActionTemplatePickerSelection(picker, templateIds) {
  const selectedIds = new Set(getLinkedActionTemplateIds({ [linkedActionTemplateIdsKey]: templateIds }));
  picker.querySelectorAll("[data-action-template-option]").forEach((option) => {
    const selected = selectedIds.has(option.dataset.templateId ?? "");
    option.classList.toggle("is-selected", selected);
    const button = option.querySelector("[data-action='toggle-action-template']");
    if (button === null) return;
    button.textContent = selected ? "已选择" : "选择";
    button.classList.toggle("primary-button", !selected);
    button.classList.toggle("secondary-button", selected);
  });
}

function getActionTemplateHoverPreview() {
  let preview = document.querySelector(".thumbnail-hover-preview.action-template-hover-preview");
  if (preview !== null) return preview;
  preview = document.createElement("div");
  preview.className = "thumbnail-hover-preview action-template-hover-preview is-hidden";
  preview.setAttribute("aria-hidden", "true");
  document.body.appendChild(preview);
  return preview;
}

function showActionTemplateHoverPreview(anchor) {
  const imageUrl = anchor.dataset.actionTemplatePreviewUrl ?? "";
  if (imageUrl === "") return;
  const preview = getActionTemplateHoverPreview();
  preview.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(anchor.dataset.actionTemplatePreviewTitle ?? "模板预览")}" />`;
  preview.classList.remove("is-hidden");
  const rect = anchor.getBoundingClientRect();
  const previewSize = 360;
  const gap = 12;
  const left = rect.right + previewSize + gap <= window.innerWidth ? rect.right + gap : Math.max(gap, rect.left - previewSize - gap);
  const top = Math.min(Math.max(gap, rect.top), Math.max(gap, window.innerHeight - previewSize - gap));
  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(top)}px`;
}

function hideActionTemplateHoverPreview() {
  document.querySelector(".thumbnail-hover-preview.action-template-hover-preview")?.classList.add("is-hidden");
}

export function bindActionLinkedTemplatePreviewEvents(root) {
  root.addEventListener("pointerover", (event) => {
    const previewAnchor = event.target.closest("[data-action-template-preview-url]");
    if (previewAnchor === null || previewAnchor.contains(event.relatedTarget)) return;
    showActionTemplateHoverPreview(previewAnchor);
  });

  root.addEventListener("pointerout", (event) => {
    const previewAnchor = event.target.closest("[data-action-template-preview-url]");
    if (previewAnchor === null || previewAnchor.contains(event.relatedTarget)) return;
    hideActionTemplateHoverPreview();
  });
}

export async function ensureStoreOptionsForLaunchedProcessDetail(detail, rerender) {
  if (
    detail === null ||
    detail === undefined ||
    detail.querySelector('select[name="custom__storeId"]') === null ||
    getStoreOptionsLoadState().status !== "idle"
  ) return false;

  try {
    await ensureStoreOptionsLoaded();
  } finally {
    rerender();
  }
  return true;
}

export function bindLaunchedProcessDetailEvents(root, rerender, options = {}) {
  const detail = root.querySelector("[data-launched-process-detail]");
  const detailInstance = detail ? getInstance(detail.dataset.launchedProcessDetail) : null;
  if (detailInstance?.customFields?.source === "sales_anomaly" && !improvementResultState.has(detailInstance.id)) {
    improvementResultState.set(detailInstance.id, { loading: true });
    loadBusinessImprovementResult(detailInstance.id).then((response) => { improvementResultState.set(detailInstance.id, { data: response.result, loading: false }); rerender(); }).catch((error) => { improvementResultState.set(detailInstance.id, { error: error.message || "经营改善结果读取失败。", loading: false }); rerender(); });
  }
  if (detail === null) return;

  // The launched-action detail is shared by the task center, action board,
  // goals, assessments and content scheduling. Some of those lightweight
  // bootstraps intentionally omit the store directory, so load the scoped
  // option endpoint whenever an editable store field is actually present.
  // Only the idle state starts a request; the rerender after an empty or failed
  // response therefore cannot create a retry loop.
  void ensureStoreOptionsForLaunchedProcessDetail(detail, rerender)
    .catch((error) => console.error("店铺选项加载失败", error));
  bindActionLinkedTemplatePreviewEvents(detail);

  detail.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton?.dataset.action === "remove-product-image") {
      removePublicFormImage(actionButton);
      return;
    }
    if (actionButton?.dataset.action === "remove-existing-standard-work-attachment") {
      actionButton.closest("[data-existing-attachment-item]")?.remove();
      return;
    }
    if (actionButton?.dataset.action === "remove-selected-standard-work-attachment") {
      removeSelectedStandardWorkAttachment(actionButton);
      return;
    }
    if (actionButton?.dataset.action === "open-task-executor-picker") {
      const taskId = actionButton.dataset.taskId ?? "";
      const instance = getInstance(detail.dataset.launchedProcessDetail);
      const task = getInstanceTasks(instance?.id ?? "").find((item) => item.id === taskId) ?? null;
      if (instance !== null && task !== null && canChangeTaskExecutor(instance, task)) {
        taskExecutorPickerState = { instanceId: instance.id, taskId, error: "" };
        rerender();
      }
      return;
    }
    if (actionButton?.dataset.action === "close-task-executor-picker") {
      taskExecutorPickerState = null;
      rerender();
      return;
    }
    if (actionButton?.dataset.action === "select-task-executor") {
      const pickerState = taskExecutorPickerState;
      if (pickerState === null) return;
      try {
        await updateProcessTaskExecutor(
          pickerState.instanceId,
          pickerState.taskId,
          actionButton.dataset.personId ?? "",
        );
        taskExecutorPickerState = null;
      } catch (error) {
        taskExecutorPickerState = { ...pickerState, error: error.message || "任务执行人保存失败。" };
      }
      rerender();
      return;
    }
    if (actionButton?.dataset.action === "open-action-template-picker") {
      try {
        await loadTemplates();
        const pickerHost = form?.querySelector("[data-action-template-picker-host]");
        if (pickerHost !== null && pickerHost !== undefined) {
          pickerHost.innerHTML = renderActionTemplatePicker(getSelectedActionTemplateIds(form));
          pickerHost.querySelector("[data-action-template-search]")?.focus({ preventScroll: true });
        }
      } catch (error) {
        showFormError(form, error.message || "模板列表读取失败。");
      }
      return;
    }
    if (actionButton?.dataset.action === "close-action-template-picker") {
      hideActionTemplateHoverPreview();
      actionButton.closest("[data-action-template-picker]")?.remove();
      return;
    }
    if (actionButton?.dataset.action === "toggle-action-template") {
      const templateId = actionButton.dataset.templateId ?? "";
      const selectedIds = getSelectedActionTemplateIds(form);
      setSelectedActionTemplateIds(
        form,
        selectedIds.includes(templateId) ? selectedIds.filter((selectedId) => selectedId !== templateId) : [...selectedIds, templateId],
      );
      return;
    }
    if (actionButton?.dataset.action === "remove-action-template") {
      const templateId = actionButton.dataset.templateId ?? "";
      setSelectedActionTemplateIds(
        form,
        getSelectedActionTemplateIds(form).filter((selectedId) => selectedId !== templateId),
      );
      return;
    }
    if (actionButton?.dataset.action === "filter-action-template") {
      actionButton.classList.toggle("is-active");
      filterActionTemplateOptions(actionButton.closest("[data-action-template-picker]"));
      return;
    }

    const taskButton = event.target.closest("[data-launched-process-task-id]");
    if (taskButton === null) return;
    options.onTaskSelect?.(taskButton.dataset.launchedProcessTaskId);
  });

  detail.addEventListener("input", (event) => {
    if (event.target.name?.startsWith("custom__")) updatePublicFormImagePreview(event.target);
    if (event.target.matches("[data-action-template-search]")) {
      filterActionTemplateOptions(event.target.closest("[data-action-template-picker]"));
    }
    if (event.target.matches("[data-task-executor-search]")) {
      filterTaskExecutorOptions(event.target.closest("[data-task-executor-picker]"));
    }
  });

  detail.addEventListener("change", async (event) => {
    if (event.target.matches("[data-standard-work-attachments]")) {
      renderSelectedStandardWorkAttachments(event.target);
      return;
    }
    if (event.target.matches("[data-image-upload-key]")) {
      try {
        await handlePublicFormImageUpload(event.target);
        showFormError(form, "");
      } catch (error) {
        showFormError(form, error.message || "图片上传失败。");
      }
      return;
    }
    if (event.target.matches("[data-task-due-date-control]")) {
      const taskId = event.target.dataset.taskDueDateControl;
      const changedInput = form?.elements[`task__${taskId}__dueDateChanged`];
      if (changedInput !== undefined) changedInput.value = "true";
    }
    if (event.target.matches("[data-task-executor-department]")) {
      filterTaskExecutorOptions(event.target.closest("[data-task-executor-picker]"));
    }
  });

  const form = detail.querySelector(".launched-process-form");
  if (form === null) return;
  bindActionProductSelectors(form);
  updatePublishTimeModeUi(form);
  form.addEventListener("change", (event) => {
    if (["publishTimeMode", "instanceDueDateDate", "instanceDueDateHour"].includes(event.target.name)) updatePublishTimeModeUi(form);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const instanceId = detail.dataset.launchedProcessDetail;
    const instance = getInstance(instanceId);
    if (instance === null || !canEditInstance(instance)) return;

    const linkedWorkPlan = getLinkedWorkPlan(instance);
    const name = getFormValue(form, "name");
    const goalId = getFormValue(form, "goalId");
    const description = getFormValue(form, "description");
    const productSelector = form.querySelector("[data-action-product-selector]");
    const productIds = productSelector === null ? null : collectActionProductIds(form);
    const editableTasks = getInstanceTasks(instanceId).filter(canEditTask);
    const instanceDueDateResult = collectBusinessDateTime(form, "instanceDueDate");
    if (instanceDueDateResult.error !== "") return showFormError(form, instanceDueDateResult.error);
    const taskDueDateResults = new Map(
      editableTasks.map((task) => [task.id, collectTaskDueDateForLaunchedProcess(form, task)]),
    );
    const invalidTaskDueDate = [...taskDueDateResults.values()].find((result) => result.error !== "");
    if (invalidTaskDueDate !== undefined) return showFormError(form, invalidTaskDueDate.error);
    const now = getNow();
    const oldGoalId = instance.goalId;
    const formFields = getInstanceFormFields(instance);
    const collectedFields = { ...(instance.customFields ?? {}), ...collectPublicFormFields(form, formFields) };
    const publishTimeMode = isContentNoteInstance(instance)
      ? form.elements.publishTimeMode?.value || PublishTimeMode.Custom
      : normalizePublishTimeMode(collectedFields.publishTimeMode);
    const customFields = isContentNoteInstance(instance)
      ? normalizePublishTimeFields(collectedFields, publishTimeMode)
      : collectedFields;
    customFields[linkedActionTemplateIdsKey] = getSelectedActionTemplateIds(form);
    const validationFields = publishTimeMode === PublishTimeMode.Deadline
      ? formFields.filter((field) => field.key !== "publishDate")
      : formFields;
    const customError = validatePublicFormFields(customFields, validationFields);
    if (customError !== "") return showFormError(form, customError);
    if (publishTimeMode === PublishTimeMode.Deadline && !instanceDueDateResult.value) {
      return showFormError(form, "选择同截止时间时必须设置截止时间。");
    }
    try {
      const existingAttachments = collectExistingStandardWorkAttachments(form);
      const uploadedAttachments = await uploadSelectedStandardWorkAttachments(form, instanceId);
      customFields[standardWorkAttachmentsKey] = [...existingAttachments, ...uploadedAttachments];
    } catch (error) {
      return showFormError(form, error.message || "附件上传失败。");
    }

    const updatedInstance = { ...instance, name, goalId, description, dueDate: instanceDueDateResult.value, customFields, updatedAt: now };

    const updatedTasks = state.tasks
      .filter((task) => task.processInstanceId === instanceId)
      .filter((task) => task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled)
      .filter(canEditTask)
      .map((task) => {
      return {
        ...task,
        goalId: oldGoalId === goalId ? task.goalId : goalId,
        ownerId: getFormValue(form, `task__${task.id}__ownerId`) || task.ownerId,
        executorId: task.executorId,
        dueDate: taskDueDateResults.get(task.id)?.value ?? null,
        updatedAt: now,
      };
    });

    try {
      await updatePersistentResource("process-instances", updatedInstance.id, updatedInstance);
      if (productIds !== null) await updateActionProducts(updatedInstance.id, productIds);
      if (linkedWorkPlan !== null) {
        await updatePersistentResource("work-plans", linkedWorkPlan.id, { dueDate: updatedInstance.dueDate ?? null });
      }
      for (const task of updatedTasks) {
        await updatePersistentResource("tasks", task.id, task);
      }
    } catch (error) {
      console.error("已发起关键行动保存失败", error);
      return showFormError(form, error.message || "已发起关键行动保存失败，请检查本地数据库服务。");
    }

    const updatedTaskMap = new Map(updatedTasks.map((task) => [task.id, task]));
    state.processInstances = state.processInstances.map((item) => (item.id === instanceId ? updatedInstance : item));
    if (linkedWorkPlan !== null) {
      state.workPlans = state.workPlans.map((item) =>
        item.id === linkedWorkPlan.id ? { ...item, dueDate: updatedInstance.dueDate ?? null } : item,
      );
    }
    state.tasks = state.tasks.map((task) => updatedTaskMap.get(task.id) ?? task);

    if (typeof options.onSaved === "function") {
      options.onSaved(updatedInstance);
      return;
    }
    rerender();
  });
}
