import { formatProcessStepLabel, getCurrentUser, getLatestStandardWorkFormFields, getNow, getProcessNodeStepOrder, loadTemplates, resolveAssetUrl, state, updatePersistentResource, uploadStandardWorkAttachment } from "./appState.js?v=20260705-state-singleton1";
import {
  GoalStatus,
  ProcessInstanceStatus,
  TaskStatus,
} from "./data/modelOptions.js";
import {
  getProcessInstanceBusinessStatus as selectProcessInstanceBusinessStatus,
  getProcessInstanceOwner,
  getProcessProgress as selectProcessProgress,
} from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
import { getTaskBusinessStatus } from "./data/taskSelectors.js?v=20260723-task-business-status2";
import { renderWorkFormViewer } from "./workFormViewer.js?v=20260705-state-singleton1";
import {
  collectPublicFormFields,
  handlePublicFormImageUpload,
  renderPublicFormEditor,
  updatePublicFormImagePreview,
  validatePublicFormFields,
} from "./workFormEditor.js?v=20260722-public-form-editor1";
import { normalizePublicFormFields } from "./publicFormFields.js?v=20260722-public-form-key-normalize1";
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
} from "./businessTime.js?v=20260705-state-singleton1";

const goals = state.goals;
const people = state.people;
const standardWorkAttachmentsKey = "standardWorkAttachments";
const linkedActionTemplateIdsKey = "linkedTemplateIds";
const returnRecordsKey = "returnRecords";
const spreadsheetAttachmentExts = new Set([".xlsx", ".xls", ".csv"]);
const maxStandardWorkAttachmentSize = 20 * 1024 * 1024;

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

function canEditTask(task) {
  return task.status !== TaskStatus.Done && task.status !== TaskStatus.Canceled;
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

function validateStandardWorkAttachmentFiles(files) {
  for (const file of files) {
    const ext = getFileExt(file.name);
    if (!spreadsheetAttachmentExts.has(ext)) return "表格附件只支持 .xlsx、.xls、.csv。";
    if (file.size > maxStandardWorkAttachmentSize) return "单个表格附件不能超过 20MB。";
  }
  return "";
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

function renderReturnRecords(instanceId) {
  const records = getInstanceReturnRecords(instanceId);
  if (records.length === 0) return "";

  return `
    <div class="detail-block">
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

function renderEditableStandardWorkAttachments(instance, editable) {
  const attachments = getStandardWorkAttachments(instance);
  if (!editable) return renderStandardWorkAttachments(instance);

  return `
    <div class="detail-block standard-work-attachments-field">
      <h3>附件</h3>
      <p class="form-note">支持 .xlsx、.xls、.csv，单个文件不超过 20MB。新增附件会追加到已有附件；删除只移除关联，不删除 uploads 里的实际文件。</p>
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
        <span>新增表格附件</span>
        <input name="standardWorkAttachments" type="file" accept=".xlsx,.xls,.csv" multiple data-standard-work-attachments />
      </label>
      <div class="selected-attachment-list" data-selected-standard-work-attachments>
        <p class="form-note">暂无新选择附件</p>
      </div>
    </div>
  `;
}

function renderCustomFields(instance, editable) {
  const formFields = getInstanceFormFields(instance);

  if (!editable) {
    return renderWorkFormViewer({
      formFields,
      customFields: instance.customFields ?? {},
    });
  }

  return renderPublicFormEditor({
    fields: formFields,
    customFields: instance.customFields ?? {},
    title: "",
  }) || `<p>暂无关键行动公共信息</p>`;
}

function renderStepTask(task, editable, stepIndex) {
  const canEdit = editable && canEditTask(task);
  const stepLabel = formatProcessStepLabel(stepIndex + 1);
  const taskDueDateFieldName = `task__${task.id}__dueDate`;
  const processNode = getNode(task.processNodeId);
  const displayedOwnerId = processNode === null ? task.ownerId : processNode.ownerId;
  const displayedExecutorId = processNode === null ? task.executorId : processNode.executorId;

  if (!canEdit) {
    return `
      <tr>
        <td><strong>${stepLabel}</strong><br />${escapeHtml(task.name)}</td>
        <td><span class="status-pill">${escapeHtml(getTaskBusinessStatus(task).label)}</span></td>
        <td>${findName(people, displayedOwnerId, "未设置")}</td>
        <td>${findName(people, displayedExecutorId, "未设置")}</td>
        <td>${formatBusinessMinuteDateTime(task.dueDate)}</td>
        <td><button class="text-button" type="button" data-launched-process-task-id="${task.id}">查看任务</button></td>
      </tr>
    `;
  }

  return `
    <tr>
      <td><strong>${stepLabel}</strong><br />${escapeHtml(task.name)}</td>
      <td><span class="status-pill">${escapeHtml(getTaskBusinessStatus(task).label)}</span></td>
      <td><select name="task__${task.id}__ownerId">${renderOptions(people, task.ownerId, "请选择负责人")}</select></td>
      <td><select name="task__${task.id}__executorId">${renderOptions(people, task.executorId, "请选择执行人")}</select></td>
      <td>
        <input name="${taskDueDateFieldName}Date" type="date" value="${escapeHtml(getBusinessDatePart(task.dueDate))}" data-task-due-date-control="${task.id}" />
        <select name="${taskDueDateFieldName}Time" data-task-due-date-control="${task.id}">${renderBusinessMinuteOptions(getBusinessMinutePart(task.dueDate), "时间")}</select>
        <input name="${taskDueDateFieldName}Changed" type="hidden" value="false" />
      </td>
      <td><button class="text-button" type="button" data-launched-process-task-id="${task.id}">查看任务</button></td>
    </tr>
  `;
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

  return `
    <section class="settings-section process-detail launched-process-detail" data-launched-process-detail="${instance.id}">
      <div class="section-heading with-actions">
        <h2>已发起关键行动详情：${escapeHtml(instance.displayTitle ?? instance.name)}</h2>
        ${editable ? `<button class="primary-button" type="submit" form="launched-process-form-${instance.id}">保存修改</button>` : `<span class="muted-action">只读</span>`}
      </div>
      <form id="launched-process-form-${instance.id}" class="launched-process-form">
        <div class="form-error" hidden></div>
        <div class="detail-block">
          <h3>基本信息</h3>
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
            ${renderDetailField("关键行动", escapeHtml(taskTemplate?.name ?? "未关联关键行动"))}
            ${renderDetailField("关键行动标准流程", `${escapeHtml(template?.name ?? "未设置")} v${instance.templateVersion}`)}
            ${renderDetailField("行动负责人", actionOwnerName)}
            ${renderDetailField("发起人", findName(people, instance.initiatorId, "未设置"))}
            ${renderDetailField("状态", selectProcessInstanceBusinessStatus(instance.id, state).label)}
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
            <span>本次关键行动说明</span>
            <textarea name="description" rows="3" ${editable ? "" : "disabled"}>${escapeHtml(instance.description ?? "")}</textarea>
          </label>
        </div>
        <div class="detail-block">
          <h3>关键行动表单</h3>
          ${renderCustomFields(instance, editable)}
          <p class="form-note">该信息在发起关键行动时填写，同一关键行动下所有任务共享。</p>
        </div>
        <div class="detail-block action-linked-template-section">
          <div class="section-heading with-actions compact-heading">
            <h3>关联模板</h3>
            ${editable ? `<button class="secondary-button" type="button" data-action="open-action-template-picker">关联模板</button>` : ""}
          </div>
          <input type="hidden" name="${linkedActionTemplateIdsKey}" value="${escapeHtml(JSON.stringify(getLinkedActionTemplateIds(instance)))}" />
          <div data-action-linked-template-list-host>
            ${renderActionLinkedTemplates(instance, { editable })}
          </div>
          ${editable ? `<div data-action-template-picker-host></div>` : ""}
        </div>
        ${renderEditableStandardWorkAttachments(instance, editable)}
        ${renderReturnRecords(instance.id)}
        <div class="detail-block">
          <h3>标准步骤任务</h3>
          <div class="table-wrap">
            <table class="data-table process-instance-task-table">
              <thead>
                <tr>
                  <th>步骤名称</th><th>当前状态</th><th>负责人</th><th>执行人</th><th>截止时间</th><th>操作</th>
                </tr>
              </thead>
              <tbody>${tasks.map((task, index) => renderStepTask(task, editable, index)).join("")}</tbody>
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

export function bindLaunchedProcessDetailEvents(root, rerender, options = {}) {
  const detail = root.querySelector("[data-launched-process-detail]");
  if (detail === null) return;
  bindActionLinkedTemplatePreviewEvents(detail);

  detail.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton?.dataset.action === "remove-existing-standard-work-attachment") {
      actionButton.closest("[data-existing-attachment-item]")?.remove();
      return;
    }
    if (actionButton?.dataset.action === "remove-selected-standard-work-attachment") {
      removeSelectedStandardWorkAttachment(actionButton);
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
  });

  const form = detail.querySelector(".launched-process-form");
  if (form === null) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const instanceId = detail.dataset.launchedProcessDetail;
    const instance = getInstance(instanceId);
    if (instance === null || !canEditInstance(instance)) return;

    const linkedWorkPlan = getLinkedWorkPlan(instance);
    const name = getFormValue(form, "name");
    const goalId = getFormValue(form, "goalId");
    const description = getFormValue(form, "description");
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
    const customFields = { ...(instance.customFields ?? {}), ...collectPublicFormFields(form, formFields) };
    customFields[linkedActionTemplateIdsKey] = getSelectedActionTemplateIds(form);
    const customError = validatePublicFormFields(customFields, formFields);
    if (customError !== "") return showFormError(form, customError);
    try {
      const existingAttachments = collectExistingStandardWorkAttachments(form);
      const uploadedAttachments = await uploadSelectedStandardWorkAttachments(form, instanceId);
      customFields[standardWorkAttachmentsKey] = [...existingAttachments, ...uploadedAttachments];
    } catch (error) {
      return showFormError(form, error.message || "表格附件上传失败。");
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
        executorId: getFormValue(form, `task__${task.id}__executorId`) || task.executorId,
        dueDate: taskDueDateResults.get(task.id)?.value ?? null,
        updatedAt: now,
      };
    });

    try {
      await updatePersistentResource("process-instances", updatedInstance.id, updatedInstance);
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
