import {
  createId,
  createOrReuseProcessTemplateForStandardWork,
  createPersistentResource,
  formatProcessStepLabel,
  getCurrentUser,
  getCurrentWeek,
  getLatestStandardWorkFormFields,
  getNow,
  launchWorkPlanDraftAsProcess,
  moveTaskTemplateToValueChain,
  normalizeSubmitRequirement,
  resolveAssetUrl,
  sortProcessNodes,
  state,
  updatePersistentResource,
  uploadImageFile,
  uploadStandardWorkAttachment,
} from "./appState.js";
import { canLaunchActionTemplate, hasPermission } from "../shared/permissions.js";
import {
  CategoryType,
  ProcessAccepterRule,
  ProcessOwnerRule,
  ProcessTemplateNodeStatus,
  ProcessTemplateStatus,
  TaskTemplateStatus,
  WorkPlanStatus,
  getValueModuleName,
  inferValueModuleIdFromText,
  processTemplateStatusNames,
  taskTemplateStatusNames,
  ValueModule,
} from "./data/modelOptions.js";
import { getPrimaryImageUrl } from "./data/taskUtils.js";
import {
  collectProductImageField,
  handleProductImagesUpload,
  isProductImageField,
  removeProductImage,
  renderProductImageEditor,
  validateProductImages,
} from "./actionImages.js";
import {
  collectBusinessDateTime,
  collectBusinessMinuteDateTime,
  getBusinessDatePart,
  getBusinessHourPart,
  getBusinessMinutePart,
  isBusinessDueDateField,
  renderBusinessHourOptions,
  renderBusinessMinuteOptions,
} from "./businessTime.js";
import {
  collectPublicFormMultiSelectValues,
  normalizePublicFormFields,
  renderPublicFormMultiSelectField,
  validatePublicFormMultiSelectValue,
} from "./publicFormFields.js";
import { bindActionProductSelectors, collectActionProductIds, renderActionProductSelector } from "./actionProductRelations.js";
import {
  getPublishingAccountFieldOptions,
  isPublishingAccountField,
} from "./publishingAccountOptions.js";
import { standardWorkAttachmentAccept, validateStandardWorkAttachmentFiles } from "./standardWorkAttachmentPolicy.js";

const categories = state.categories;
const departments = state.departments;
const goals = state.goals;
const people = state.people;
const publishingAccounts = state.publishingAccounts;
const stores = state.stores;
const standardWorkAttachmentsKey = "standardWorkAttachments";
const hiddenLegacyStandardWorkNames = [
  "小红书笔记发布",
  "买家秀图片制作",
  "内容主题策划",
  "爆款笔记复盘",
  "产品拍摄方案确认",
  "供应商交期跟进",
  "重点产品补货计划跟进",
  "新品资料整理",
  "内容质量检查",
  "任务推进检查",
];
const templateFieldTypes = ["text", "textarea", "select", "date", "datetime_hour", "number", "image", "file", "link"];
const standardFlowImportHeaders = ["关键行动名称", "步骤序号", "步骤名称", "执行部门", "执行人", "时限", "完成标准", "说明"];
const standardFlowRequiredHeaders = ["关键行动名称", "步骤序号", "步骤名称", "执行部门"];

let modalState = null;
let standardWorkMoveStatus = null;
let draggedStandardWorkTemplateId = "";
let didDragStandardWorkCard = false;
let standardWorkKeyword = "";

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

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function copyTextToClipboard(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function findName(items, id, fallback) {
  if (id === null || id === undefined || id === "") return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function renderOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items
      .map(
        (item) => `
          <option value="${escapeAttribute(item.id)}" ${item.id === selectedId ? "selected" : ""}>
            ${escapeHtml(item.name)}
          </option>
        `,
      )
      .join("")}
  `;
}

function renderTaskTemplateOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items
      .map((item) => {
        const label = item.businessCode ? `${item.businessCode}｜${item.name}` : item.name;
        return `<option value="${escapeAttribute(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("")}
  `;
}

function renderValueOptions(values, selectedValue, names, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${Object.values(values)
      .map((value) => `<option value="${escapeAttribute(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(names[value] ?? value)}</option>`)
      .join("")}
  `;
}

function getTaskCategories() {
  return categories
    .filter((category) => category.type === CategoryType.Task && category.status !== "inactive")
    .sort((left, right) => (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999) || left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function getStandardWorkValueChainColumns() {
  return getTaskCategories().map((category) => ({ id: category.id, title: category.name }));
}

function getActiveGoals() {
  return goals.filter((goal) => goal.status !== "inactive");
}

function getTaskTemplate(templateId) {
  return state.taskTemplates.find((template) => template.id === templateId) ?? null;
}

function getActiveTaskTemplates() {
  const currentUser = getCurrentUser();
  return state.taskTemplates.filter(
    (template) => template.status === TaskTemplateStatus.Active && canLaunchActionTemplate(currentUser, template.id),
  );
}

function getActiveTaskTemplatesByCategory(categoryId) {
  if (!getTaskCategories().some((category) => category.id === categoryId)) return [];
  return getActiveTaskTemplates().filter((template) => template.categoryId === categoryId);
}

function getProcessTemplateById(templateId) {
  return state.processTemplates.find((template) => template.id === templateId) ?? null;
}

function getSelectableProcessTemplates(selectedTemplateId = "") {
  return state.processTemplates.filter((template) => template.status === ProcessTemplateStatus.Active || template.id === selectedTemplateId);
}

function getProcessTemplateName(templateId) {
  return state.processTemplates.find((template) => template.id === templateId)?.name ?? "未绑定关键行动标准流程";
}

function inferValueModuleIdForTemplate(template) {
  if (template === null || template === undefined) return ValueModule.InfrastructureMaintenance;
  const category = categories.find((item) => item.id === template.categoryId && item.type === CategoryType.Task);
  if (category !== undefined) return inferValueModuleIdFromText(category.name);
  const processName = getProcessTemplateName(template.defaultProcessTemplateId ?? "");
  return inferValueModuleIdFromText(`${template.name ?? ""} ${processName === "未绑定关键行动标准流程" ? "" : processName}`);
}

function getStandardWorkValueChain(template) {
  return getTaskCategories().find((category) => category.id === template?.categoryId)?.name ?? getValueModuleName(inferValueModuleIdForTemplate(template));
}

function getTaskTemplateValueChainCategoryId(template) {
  if (template === null || template === undefined) return "";
  if (getTaskCategories().some((category) => category.id === template.categoryId)) return template.categoryId;
  return getTaskCategories().find((category) => category.name === getStandardWorkValueChain(template))?.id ?? "";
}

function getStandardWorkProcessNodes(processTemplateId) {
  return sortProcessNodes(
    state.processTemplateNodes.filter((node) => node.templateId === processTemplateId && node.status !== ProcessTemplateNodeStatus.Deleted),
  );
}

function renderProcessTemplateOptions(selectedId) {
  return `
    <option value="">请选择关键行动标准流程</option>
    ${getSelectableProcessTemplates(selectedId)
      .map((template) => {
        const statusLabel = template.status === ProcessTemplateStatus.Active ? "" : "（已停用）";
        return `<option value="${escapeAttribute(template.id)}" ${template.id === selectedId ? "selected" : ""}>${escapeHtml(template.name)}${statusLabel}</option>`;
      })
      .join("")}
  `;
}

function renderTemplateActionButton(label, action, templateId, variant = "") {
  return `<button class="text-button ${variant}" type="button" data-action="${action}" data-template-id="${escapeAttribute(templateId)}">${label}</button>`;
}

function renderDetailField(label, value) {
  return `
    <div class="detail-field">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderStandardWorkMoveStatus() {
  if (standardWorkMoveStatus === null) return "";
  return `<p class="standard-work-move-status is-${escapeAttribute(standardWorkMoveStatus.type)}">${escapeHtml(standardWorkMoveStatus.message)}</p>`;
}

function renderStandardWorkBoardView(visibleTemplates, selectedProcessTemplateId = "") {
  return `
    <div class="standard-work-board-wrap">
      <div class="standard-work-board">
        ${getStandardWorkValueChainColumns()
          .map((column) => {
            const columnTemplates = visibleTemplates.filter((template) => template.categoryId === column.id);
            return `
              <section class="standard-work-column" data-standard-work-category-id="${escapeAttribute(column.id)}">
                <div class="standard-work-column-header">
                  <h3>${escapeHtml(column.title)}</h3>
                  <span>${columnTemplates.length} 项</span>
                </div>
                <div class="standard-work-card-list" data-standard-work-drop-zone="${escapeAttribute(column.id)}">
                  ${
                    columnTemplates.length === 0
                      ? `<div class="standard-work-drop-hint">拖到这里</div>`
                      : `${columnTemplates.map((template) => renderStandardWorkCard(template, selectedProcessTemplateId)).join("")}
                        <div class="standard-work-drop-hint">拖到这里归入${escapeHtml(column.title)}</div>`
                  }
                </div>
              </section>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderStandardWorkCard(template, selectedProcessTemplateId = "") {
  const isSelected = template.defaultProcessTemplateId !== undefined && template.defaultProcessTemplateId === selectedProcessTemplateId;
  const draggable = canCurrentUser("actionStandards.manage") ? ` draggable="true"` : "";
  const departmentName = findName(departments, template.departmentId, "未设置");
  const processStepCount = template.defaultProcessTemplateId ? getStandardWorkProcessNodes(template.defaultProcessTemplateId).length : 0;
  const processStepLabel = processStepCount > 0 ? `${processStepCount}步` : "未配置";
  const versions = (state.templateAssetVersions ?? []).filter((item) => item.assetType === "action" && item.assetId === template.id);
  const currentVersion = versions.find((item) => item.status === "active") ?? versions.sort((left, right) => right.majorVersion - left.majorVersion || right.minorVersion - left.minorVersion)[0];
  const loadedLaunchCount = (state.processInstances ?? []).filter((instance) =>
    instance.taskTemplateId === template.id ||
    instance.standardWorkId === template.id ||
    (template.defaultProcessTemplateId && instance.templateId === template.defaultProcessTemplateId),
  ).length;
  const launchCount = state.templateCenterUsageSummary?.actionByTaskTemplateId?.[template.id]?.useCount ?? loadedLaunchCount;
  const description = String(template.description ?? template.completionStandard ?? "").trim() || "用于创建关键行动并生成标准步骤任务";
  return `
    <article class="standard-work-card ${isSelected ? "is-selected" : ""}"${draggable} data-standard-work-template-id="${escapeAttribute(template.id)}" data-process-template-id="${escapeAttribute(template.defaultProcessTemplateId ?? "")}">
      <div class="standard-work-card-title">
        <div>
          <h4>${escapeHtml(template.name)}</h4>
          <button class="copyable-code standard-work-business-code" type="button" data-copy-action-standard-code="${escapeAttribute(template.businessCode ?? "")}" ${template.businessCode ? "" : "disabled"} title="${template.businessCode ? "点击复制行动标准编码" : "行动标准编码缺失"}">行动标准编码：${escapeHtml(template.businessCode || "—")}</button>
        </div>
        <span class="status-pill ${template.status === TaskTemplateStatus.Inactive ? "is-inactive" : ""}">${taskTemplateStatusNames[template.status]}</span>
      </div>
      <p class="standard-work-card-description">${escapeHtml(description)}</p>
      <div class="standard-work-card-tags" aria-label="行动标准分类标签">
        <span>${escapeHtml(departmentName)}</span>
        <span>${escapeHtml(processStepLabel)}</span>
        <span>${escapeHtml(currentVersion?.versionNumber || "V1.0")}</span>
      </div>
      <div class="standard-work-card-usage">
        <span>已发起</span>
        <strong>${launchCount}<em>次</em></strong>
      </div>
      <div class="standard-work-card-actions">
        ${renderTemplateActionButton("查看详情", "view-task-template", template.id)}
        <button class="secondary-button" type="button" data-template-iterate="action" data-asset-id="${escapeAttribute(template.id)}">迭代</button><button type="button" hidden data-action="edit-task-template" data-template-id="${escapeAttribute(template.id)}"></button>
        <button class="text-button" type="button" data-template-version-history="action" data-asset-id="${escapeAttribute(template.id)}">版本历史</button>
      </div>
    </article>
  `;
}

function renderTaskTemplateTable(selectedProcessTemplateId = "") {
  const normalizedKeyword = standardWorkKeyword.trim().toLowerCase();
  const visibleTemplates = state.taskTemplates.filter((template) => {
    if (hiddenLegacyStandardWorkNames.includes(template.name)) return false;
    if (normalizedKeyword === "") return true;
    const processTemplate = state.processTemplates.find(
      (item) => item.id === template.defaultProcessTemplateId,
    );
    return `${template.name ?? ""} ${template.businessCode ?? ""} ${processTemplate?.name ?? ""} ${processTemplate?.businessCode ?? ""}`
      .toLowerCase()
      .includes(normalizedKeyword);
  });
  const canConfigureStandards = canCurrentUser("actionStandards.manage");

  return `
    <section class="settings-section">
      <div class="section-heading with-actions">
        <div>
          <h2>关键行动库</h2>
          <p class="form-note">关键行动是公司长期实践验证有效、能够持续推进目标实现，并沉淀下来的行动。关键行动不是普通关键行动，只有经过验证、值得长期保留、能够持续帮助公司实现目标的行动，才会沉淀为关键行动。</p>
        </div>
        <div class="toolbar-actions">
          ${canConfigureStandards ? `<button class="primary-button" type="button" data-action="add-task-template">新增关键行动</button>` : ""}
          ${canConfigureStandards ? `<label class="secondary-button file-button">导入模板<input type="file" data-standard-flow-file="import" accept=".xlsx,.xls,.xml,.csv,.tsv,.txt" /></label>` : ""}
          ${canConfigureStandards ? `<button class="secondary-button" type="button" data-action="download-standard-flow-template">导出待配置模板</button>` : ""}
        </div>
      </div>
      <label class="standard-work-search">
        <span>搜索</span>
        <input data-standard-work-keyword value="${escapeAttribute(standardWorkKeyword)}" placeholder="搜索关键行动、行动标准编码或流程编码" autocomplete="off" />
      </label>
      ${renderStandardWorkMoveStatus()}
      ${renderStandardWorkBoardView(visibleTemplates, selectedProcessTemplateId)}
      <p class="form-note">可拖动关键行动卡片到其他价值链分类中，调整后会保存到关键行动库。</p>
    </section>
  `;
}

export function renderStandardWorkLibraryPage(selectedProcessTemplateId = "") {
  return `
    <div class="standard-work-library-host">
      ${renderTaskTemplateTable(selectedProcessTemplateId)}
      ${renderActionStandardLaunchModal()}
      ${renderTaskTemplateModal()}
      ${renderStandardWorkProcessModal()}
      ${renderStandardFlowImportModal()}
    </div>
  `;
}

function renderStandardWorkProcessModal() {
  if (modalState?.kind !== "standardWorkProcess") return "";
  const template = getTaskTemplate(modalState.templateId);
  if (template === null) return "";
  const nodes = getStandardWorkProcessNodes(template.defaultProcessTemplateId ?? "");
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <h2>${escapeHtml(template.name)} · 标准节点</h2>
        <div class="modal-header-actions">
          <button class="secondary-button" type="button" data-action="close-task-modal">关闭</button>
          <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
        </div>
      </div>
      ${
        nodes.length === 0
          ? `<p class="empty-state">暂无标准节点</p>`
          : `<div class="process-node-list">
              ${nodes
                .map((node, index) => {
                  const ownerName = findName(people, node.ownerId ?? node.defaultOwnerId, "未设置");
                  const executorName = findName(people, node.executorId, ownerName === "未设置" ? "未设置" : ownerName);
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
            </div>`
      }
    </div></div>
  `;
}

function getEditingTaskTemplate() {
  return modalState?.templateId === undefined ? null : getTaskTemplate(modalState.templateId);
}

function normalizeTemplateFormFields(fields = []) {
  return [...fields]
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((field, index) => ({
      id: field.id || createId("field"),
      label: field.label ?? "",
      key: field.key ?? field.id ?? "",
      type: field.type ?? "text",
      required: false,
      placeholder: field.placeholder ?? "",
      options: Array.isArray(field.options) ? field.options : [],
      showInList: field.showInList !== false,
      sortOrder: index + 1,
    }));
}

function createDefaultTemplateFormFields() {
  return normalizeTemplateFormFields([
    {
      id: createId("field"),
      label: "工作对象",
      key: "workObject",
      type: "text",
      required: false,
      placeholder: "例如产品名、页面名、岗位名、事项名",
      options: [],
      showInList: true,
      sortOrder: 1,
    },
    {
      id: createId("field"),
      label: "产品图",
      key: "coverImageUrl",
      type: "image",
      required: false,
      placeholder: "上传1:1产品图",
      options: [],
      showInList: true,
      sortOrder: 2,
    },
    {
      id: createId("field"),
      label: "本次关键行动要求",
      key: "workRequirement",
      type: "textarea",
      required: false,
      placeholder: "补充本次关键行动的特殊要求",
      options: [],
      showInList: false,
      sortOrder: 3,
    },
  ]);
}

function getTemplateFormFieldsDraft() {
  if (modalState?.formFieldsDraft !== undefined) return modalState.formFieldsDraft;
  const template = getEditingTaskTemplate();
  return template === null ? createDefaultTemplateFormFields() : normalizeTemplateFormFields(template.formFields ?? []);
}

function parseOptionsText(value) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectTemplateFormFields(form) {
  return [...form.querySelectorAll("[data-template-field-row]")].map((row, index) => ({
    id: row.querySelector("[name='fieldId']")?.value || createId("field"),
    label: row.querySelector("[name='fieldLabel']")?.value.trim() ?? "",
    key: row.querySelector("[name='fieldKey']")?.value.trim() ?? "",
    type: row.querySelector("[name='fieldType']")?.value ?? "text",
    required: false,
    placeholder: row.querySelector("[name='fieldPlaceholder']")?.value.trim() ?? "",
    options: parseOptionsText(row.querySelector("[name='fieldOptions']")?.value ?? ""),
    showInList: row.querySelector("[name='fieldShowInList']")?.checked ?? false,
    sortOrder: index + 1,
  }));
}

function validateTemplateFormFields(fields) {
  const keys = new Set();
  for (const field of fields) {
    if (field.label === "" && field.key === "") continue;
    if (field.label === "") field.label = field.key;
    if (field.key === "") field.key = `field_${keys.size + 1}`;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.key)) return `字段 ${field.label} 的 key 只能使用英文字母、数字和下划线，并且以字母开头。`;
    if (keys.has(field.key)) return `字段 key “${field.key}” 重复。`;
    keys.add(field.key);
    if (!templateFieldTypes.includes(field.type)) return `字段 ${field.label} 的类型无效。`;
  }
  return "";
}

function renderTemplateFormFieldEditor() {
  const fields = getTemplateFormFieldsDraft();
  return `
    <div class="template-custom-fields">
      <div class="section-heading with-actions compact-heading">
        <h3>定制表单</h3>
        <button class="secondary-button" type="button" data-action="add-task-template-field">新增字段</button>
      </div>
      <p class="form-note">发起该关键行动时，会按这里配置的字段显示表单，填写内容保存为关键行动公共信息。</p>
      <div class="template-field-editor">
        ${
          fields.length === 0
            ? `<div class="empty-note">暂无字段，请新增。</div>`
            : fields
                .map((field, index) => {
                  const optionText = (field.options ?? []).join("\n");
                  return `
                    <div class="template-field-row" data-template-field-row data-field-index="${index}">
                      <input name="fieldId" type="hidden" value="${escapeAttribute(field.id)}" />
                      <label><span>字段名称</span><input name="fieldLabel" value="${escapeAttribute(field.label)}" placeholder="例如 产品图" /></label>
                      <label><span>字段 key</span><input name="fieldKey" value="${escapeAttribute(field.key)}" placeholder="例如 coverImageUrl" /></label>
                      <label><span>类型</span><select name="fieldType">${templateFieldTypes.map((type) => `<option value="${type}" ${field.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
                      <label><span>提示文字</span><input name="fieldPlaceholder" value="${escapeAttribute(field.placeholder ?? "")}" /></label>
                      <label><span>选项</span><textarea name="fieldOptions" rows="2" placeholder="select 类型可一行一个选项">${escapeHtml(optionText)}</textarea></label>
                      <div class="field-row-flags">
                        <label class="checkbox-label"><input name="fieldShowInList" type="checkbox" ${field.showInList ? "checked" : ""} /><span>用于标题</span></label>
                      </div>
                      <div class="row-actions">
                        <button class="secondary-button" type="button" data-action="move-task-template-field-up" data-field-index="${index}" ${index === 0 ? "disabled" : ""}>上移</button>
                        <button class="secondary-button" type="button" data-action="move-task-template-field-down" data-field-index="${index}" ${index === fields.length - 1 ? "disabled" : ""}>下移</button>
                        <button class="danger-button" type="button" data-action="remove-task-template-field" data-field-index="${index}">删除</button>
                      </div>
                    </div>
                  `;
                })
                .join("")
        }
      </div>
    </div>
  `;
}

function renderTaskTemplateModal() {
  if (modalState === null || modalState.kind !== "taskTemplate") return "";
  const template = getEditingTaskTemplate();
  const isEdit = modalState.mode === "edit";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "编辑关键行动" : "新增关键行动"}">
        <div class="modal-header">
          <h2>${isEdit ? "编辑关键行动" : "新增关键行动"}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
            <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form task-template-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error)}</div>
          ${isEdit ? `<p class="form-note">行动标准编码：${escapeHtml(template?.businessCode ?? "—")}（创建后不可修改）</p>` : ""}
          <label><span>关键行动名称</span><input name="name" value="${escapeAttribute(template?.name ?? "")}" autocomplete="off" /></label>
          <div class="form-grid">
            <label><span>价值链模块</span><select name="categoryId">${renderOptions(getTaskCategories(), getTaskTemplateValueChainCategoryId(template), "请选择价值链模块")}</select></label>
            ${
              isEdit
                ? `<label><span>对应关键行动标准流程</span><select name="defaultProcessTemplateId">${renderProcessTemplateOptions(template?.defaultProcessTemplateId ?? "")}</select></label>`
                : `<p class="form-note">新建关键行动时，系统会自动创建同名关键行动标准流程，后续可在关键行动模块中编辑标准步骤。</p>`
            }
            <label><span>固定负责部门</span><select name="departmentId">${renderOptions(departments, template?.departmentId ?? "", "请选择部门")}</select></label>
            <label><span>固定负责人</span><select name="ownerId">${renderOptions(people, template?.ownerId ?? "", "请选择负责人")}</select></label>
            <label><span>默认验收人</span><select name="accepterId">${renderOptions(people, template?.accepterId ?? "", "无")}</select></label>
            ${isEdit && canCurrentUser("actionStandards.publish") ? `<label><span>状态</span><select name="status">${renderValueOptions(TaskTemplateStatus, template?.status ?? TaskTemplateStatus.Active, taskTemplateStatusNames, "请选择状态")}</select></label>` : ""}
            <label class="checkbox-label"><input name="needAcceptance" type="checkbox" ${template?.needAcceptance ? "checked" : ""} /><span>需要验收</span></label>
          </div>
          <label><span>标准任务说明</span><textarea name="description" rows="3">${escapeHtml(template?.description ?? "")}</textarea></label>
          <label><span>标准完成要求</span><textarea name="completionStandard" rows="3">${escapeHtml(template?.completionStandard ?? "")}</textarea></label>
          ${renderTemplateFormFieldEditor()}
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="submit">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function buildTaskTemplateDraft(form) {
  const formData = new FormData(form);
  return {
    name: getFormValue(form, "name"),
    categoryId: getFormValue(form, "categoryId") || null,
    defaultProcessTemplateId: getFormValue(form, "defaultProcessTemplateId"),
    departmentId: getFormValue(form, "departmentId"),
    ownerId: getFormValue(form, "ownerId"),
    description: getFormValue(form, "description"),
    completionStandard: getFormValue(form, "completionStandard"),
    needAcceptance: formData.has("needAcceptance"),
    accepterId: getFormValue(form, "accepterId") || null,
    status: getFormValue(form, "status") || (modalState.mode === "edit"
      ? getTaskTemplate(modalState.templateId)?.status ?? TaskTemplateStatus.Inactive
      : canCurrentUser("actionStandards.publish") ? TaskTemplateStatus.Active : TaskTemplateStatus.Inactive),
  };
}

function validateTaskTemplateDraft(draft) {
  if (!getTaskCategories().some((category) => category.id === draft.categoryId)) return "关键行动必须选择有效的价值链模块。";
  if (modalState.mode === "edit" && draft.defaultProcessTemplateId !== "") {
    const processTemplate = getProcessTemplateById(draft.defaultProcessTemplateId);
    if (processTemplate === null || processTemplate.status !== ProcessTemplateStatus.Active) return "对应关键行动标准流程必须是启用状态。";
  }
  return "";
}

function setModalError(error, rerender) {
  modalState = { ...modalState, error };
  const errorElement = document.querySelector(".modal-form .form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
  }
  if (rerender) rerender();
}

async function saveTaskTemplate(form, rerender) {
  const draft = buildTaskTemplateDraft(form);
  const formFields = normalizeTemplateFormFields(collectTemplateFormFields(form));
  const error = validateTaskTemplateDraft(draft);
  if (error !== "") return setModalError(error, rerender);
  const formFieldsError = validateTemplateFormFields(formFields);
  if (formFieldsError !== "") return setModalError(formFieldsError, rerender);

  const now = getNow();
  if (modalState.mode === "add") {
    const defaultProcessTemplateId = createOrReuseProcessTemplateForStandardWork({
      name: draft.name,
      ownerId: draft.ownerId,
      departmentId: draft.departmentId,
      now,
    });
    const defaultProcessTemplate = getProcessTemplateById(defaultProcessTemplateId);
    if (defaultProcessTemplate !== null) defaultProcessTemplate.status = draft.status;
    const createdTemplate = {
      id: createId("task-template"),
      ...draft,
      defaultProcessTemplateId,
      status: draft.status,
      formFields,
      createdAt: now,
      updatedAt: now,
    };
    try {
      if (defaultProcessTemplate !== null) await createPersistentResource("process-templates", defaultProcessTemplate);
      await createPersistentResource("task-templates", createdTemplate);
    } catch (saveError) {
      console.error("关键行动保存失败", saveError);
      return setModalError(saveError.message || "关键行动保存失败，请检查本地数据库服务。", rerender);
    }
    state.taskTemplates = [createdTemplate, ...state.taskTemplates];
  } else {
    const oldTemplate = getTaskTemplate(modalState.templateId);
    if (oldTemplate === null) return setModalError("未找到要编辑的关键行动。", rerender);
    const boundProcessTemplate = getProcessTemplateById(draft.defaultProcessTemplateId || oldTemplate?.defaultProcessTemplateId || "");
    const shouldSyncProcessName =
      boundProcessTemplate !== null &&
      draft.defaultProcessTemplateId === oldTemplate.defaultProcessTemplateId &&
      boundProcessTemplate.name === `${oldTemplate.name}标准` &&
      oldTemplate.name !== draft.name;
    const shouldNoticeProcessNameNotSynced =
      boundProcessTemplate !== null &&
      draft.defaultProcessTemplateId === oldTemplate.defaultProcessTemplateId &&
      boundProcessTemplate.name !== `${oldTemplate.name}标准` &&
      oldTemplate.name !== draft.name;
    let updatedProcessTemplate = null;
    if (shouldSyncProcessName) updatedProcessTemplate = { ...boundProcessTemplate, name: `${draft.name}标准`, updatedAt: now };
    if (shouldNoticeProcessNameNotSynced) window.alert("对应关键行动标准标准名称已被单独修改，本次未自动同步标准名称。");
    const updatedTemplate = { ...oldTemplate, ...draft, formFields, updatedAt: now };
    try {
      if (updatedProcessTemplate !== null) await updatePersistentResource("process-templates", updatedProcessTemplate.id, updatedProcessTemplate);
      await updatePersistentResource("task-templates", updatedTemplate.id, updatedTemplate);
    } catch (saveError) {
      console.error("关键行动保存失败", saveError);
      return setModalError(saveError.message || "关键行动保存失败，请检查本地数据库服务。", rerender);
    }
    if (updatedProcessTemplate !== null) {
      state.processTemplates = state.processTemplates.map((processTemplate) =>
        processTemplate.id === updatedProcessTemplate.id ? updatedProcessTemplate : processTemplate,
      );
    }
    state.taskTemplates = state.taskTemplates.map((template) => (template.id === updatedTemplate.id ? updatedTemplate : template));
  }
  modalState = null;
  rerender();
}

function getSortedFormFields(template) {
  const sourceFields = [...getLatestStandardWorkFormFields(template?.id, template?.formFields ?? [])];
  if (template?.id === "task-template-publish-content-note" || template?.name === "发布内容笔记") {
    [
      { id: "content-note-product-name", label: "对应产品", key: "productName", type: "text", required: false, placeholder: "请输入对应产品", options: [], showInList: true, sortOrder: 7 },
      { id: "content-note-scene", label: "参考场景", key: "scene", type: "text", required: false, placeholder: "请输入参考场景", options: [], showInList: true, sortOrder: 10 },
      { id: "content-note-hashtags", label: "话题", key: "hashtags", type: "text", required: false, placeholder: "例如 #花瓶 #家居软装", options: [], showInList: true, sortOrder: 11 },
    ].forEach((field) => {
      if (!sourceFields.some((item) => item.key === field.key)) sourceFields.push(field);
    });
  }
  return normalizePublicFormFields(sourceFields);
}

function getCustomFieldValue(customFields, field) {
  const value = customFields[field.key];
  if (Array.isArray(value)) return value.join("、");
  if (field.key === "departmentId" || field.type === "department") return findName(departments, value, "");
  if (field.key === "interviewerId" || field.type === "person") return findName(people, value, "");
  if (field.key === "storeId") return customFields.storeName || findName(stores, value, customFields.platform ?? "");
  return value ?? "";
}

function getStoreOptionLabel(store) {
  return store.platform ? `${store.name}（${store.platform}）` : store.name;
}

function getDynamicFieldOptions(field) {
  if (isPublishingAccountField(field)) return getPublishingAccountFieldOptions(publishingAccounts, field.options);
  if ((field.options ?? []).length > 0) return field.options.map((option) => ({ value: option, label: option }));
  if (field.key === "departmentId" || field.type === "department") {
    return departments.filter((department) => department.status === "active").map((department) => ({ value: department.id, label: department.name }));
  }
  if (field.key === "interviewerId" || field.type === "person") {
    return people.filter((person) => person.status === "active").map((person) => ({ value: person.id, label: person.name }));
  }
  if (field.key === "storeId") {
    return stores.filter((store) => store.status === "active").map((store) => ({ value: store.id, label: getStoreOptionLabel(store) }));
  }
  return [];
}

function isValidUrl(value) {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidImagePath(value) {
  return value === "" || value.startsWith("/uploads/images/") || isValidUrl(value);
}

function renderCustomFieldInput(field, customFields = {}) {
  const value = customFields[field.key] ?? (field.type === "multi_select" ? field.defaultValue ?? [] : "");
  const requiredMark = "";
  if (field.type === "textarea") {
    return `<label><span>${escapeHtml(field.label)}${requiredMark}</span><textarea name="custom__${escapeAttribute(field.key)}" rows="3" placeholder="${escapeAttribute(field.placeholder ?? "")}">${escapeHtml(value)}</textarea></label>`;
  }
  if (field.type === "select" || field.type === "person" || field.type === "department") {
    const options = getDynamicFieldOptions(field);
    return `
      <label>
        <span>${escapeHtml(field.label)}${requiredMark}</span>
        <select name="custom__${escapeAttribute(field.key)}">
          <option value="">${field.key === "storeId" && options.length === 0 ? "暂无可选店铺，请确认账号有店铺选择权限，或先到设置 → 店铺管理中新增店铺。" : "请选择"}</option>
          ${options.map((option) => `<option value="${escapeAttribute(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (field.type === "multi_select") {
    const options = getDynamicFieldOptions(field);
    return renderPublicFormMultiSelectField(field, options, customFields);
  }
  if (field.type === "image") {
    if (isProductImageField(field)) return renderProductImageEditor(field, customFields);
    const imageUrl = typeof value === "string" ? value : "";
    return `
      <label class="image-url-field">
        <span>${escapeHtml(field.label)}${requiredMark}</span>
        <input name="custom__${escapeAttribute(field.key)}" type="hidden" value="${escapeAttribute(imageUrl)}" />
        <input name="upload__${escapeAttribute(field.key)}" type="file" accept="image/jpeg,image/png,image/webp" data-image-upload-key="${escapeAttribute(field.key)}" />
        <span class="form-note">上传1:1产品图，支持 JPG、PNG、WebP，单张不超过 5MB。</span>
        <span class="image-preview-box">${imageUrl === "" ? "暂无图片" : `<img src="${escapeAttribute(resolveAssetUrl(imageUrl))}" alt="${escapeAttribute(field.label)}预览" onerror="this.replaceWith('图片无法预览')" />`}</span>
      </label>
    `;
  }
  if (isBusinessDueDateField(field)) {
    return `
      <label>
        <span>${escapeHtml(field.label)}${requiredMark}</span>
        <input name="custom__${escapeAttribute(field.key)}Date" type="date" value="${escapeAttribute(getBusinessDatePart(value))}" />
        <select name="custom__${escapeAttribute(field.key)}Hour">${renderBusinessHourOptions(getBusinessHourPart(value), "请选择小时")}</select>
      </label>
    `;
  }
  const inputType = field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text";
  return `<label><span>${escapeHtml(field.label)}${requiredMark}</span><input name="custom__${escapeAttribute(field.key)}" type="${inputType}" value="${escapeAttribute(value)}" placeholder="${escapeAttribute(field.placeholder ?? "")}" /></label>`;
}

function renderCustomFieldsForm(template, customFields = {}) {
  const fields = getSortedFormFields(template);
  if (fields.length === 0) return "";
  return `
    <div class="template-custom-fields">
      <h3>本次关键行动信息</h3>
      <div class="form-grid">${fields.map((field) => renderCustomFieldInput(field, customFields)).join("")}</div>
    </div>
  `;
}

function collectCustomFields(form, template) {
  const formData = new FormData(form);
  return getSortedFormFields(template).reduce((result, field) => {
    if (isBusinessDueDateField(field)) {
      const dateTime = collectBusinessDateTime(form, `custom__${field.key}`, field.label);
      result[field.key] = dateTime.error === "" ? dateTime.value ?? "" : `__INVALID_BUSINESS_TIME__:${dateTime.error}`;
    } else if (isProductImageField(field)) {
      collectProductImageField(formData, result, field);
    } else if (field.type === "multi_select") {
      result[field.key] = collectPublicFormMultiSelectValues(formData, field.key);
    } else {
      result[field.key] = getFormValue(form, `custom__${field.key}`);
    }
    if (field.key === "storeId") {
      const store = stores.find((item) => item.id === result.storeId);
      result.storeName = store?.name ?? "";
    }
    return result;
  }, {});
}

function validateCustomFields(customFields, template) {
  const productImagesError = validateProductImages(customFields);
  if (productImagesError !== "") return productImagesError;
  for (const field of getSortedFormFields(template)) {
    const value = customFields[field.key];
    if (field.type === "multi_select") {
      const error = validatePublicFormMultiSelectValue(field, value, getDynamicFieldOptions(field));
      if (error !== "") return error;
      continue;
    }
    const isEmpty = Array.isArray(value) ? value.length === 0 : value === "";
    if (isEmpty) continue;
    if (typeof value === "string" && value.startsWith("__INVALID_BUSINESS_TIME__:")) return value.replace("__INVALID_BUSINESS_TIME__:", "");
    if (field.type === "number" && Number.isNaN(Number(value))) return `${field.label}必须是数字。`;
    if (isBusinessDueDateField(field) && !String(value).includes("T")) return `${field.label}必须选择日期和整点小时。`;
    if (field.type === "date" && !isBusinessDueDateField(field) && Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) return `${field.label}必须是合法日期。`;
    if (field.type === "url" && !isValidUrl(value)) return `${field.label}必须是有效链接。`;
    if (field.type === "image" && !isValidImagePath(value)) return `${field.label}必须是上传后的图片路径。`;
    if (field.type === "select" && !getDynamicFieldOptions(field).some((option) => option.value === value)) return `${field.label}必须选择有效选项。`;
  }
  return "";
}

function buildDisplayTitle(template, customFields) {
  const values = getSortedFormFields(template)
    .filter((field) => field.showInList && field.key !== "coverImageUrl")
    .map((field) => getCustomFieldValue(customFields, field))
    .filter(Boolean)
    .slice(0, 3);
  return values.length === 0 ? template.name : `${template.name}｜${values.join("｜")}`;
}

function getFileExt(filename = "") {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

function renderStandardWorkAttachmentsField() {
  return `
    <div class="standard-work-attachments-field">
      <label>
        <span>附件</span>
        <input name="standardWorkAttachments" type="file" accept="${standardWorkAttachmentAccept}" multiple data-standard-work-attachments />
      </label>
      <p class="form-note">支持 .xlsx、.xls、.csv、.xmind，单个文件不超过 20MB。未上传也可以发起关键行动。</p>
      <div class="selected-attachment-list" data-selected-standard-work-attachments><p class="form-note">暂无已选择附件</p></div>
    </div>
  `;
}

function renderTemplateLockedInfo(template) {
  if (template === null) return `<p class="form-note">请选择关键行动后查看自动带出的锁定信息。</p>`;
  return `
    <div class="locked-template-info">
      ${renderDetailField("行动标准编码", escapeHtml(template.businessCode ?? "—"))}
      ${renderDetailField("关键行动名称", escapeHtml(template.name))}
      ${renderDetailField("价值链模块", escapeHtml(getStandardWorkValueChain(template)))}
      ${renderDetailField("对应关键行动标准流程", escapeHtml(getProcessTemplateName(template.defaultProcessTemplateId)))}
      ${renderDetailField("负责部门", escapeHtml(findName(departments, template.departmentId, "未设置")))}
      ${renderDetailField("负责人", escapeHtml(findName(people, template.ownerId, "未设置")))}
      ${renderDetailField("需要验收", template.needAcceptance ? "是" : "否")}
      ${renderDetailField("验收人", escapeHtml(findName(people, template.accepterId, "无")))}
      ${renderDetailField("标准任务说明", escapeHtml(template.description))}
      ${renderDetailField("标准完成要求", escapeHtml(template.completionStandard))}
    </div>
  `;
}

function renderActionStandardLaunchModal() {
  if (modalState === null || modalState.kind !== "launchActionStandard") return "";
  const selectedCategoryId = modalState.categoryId ?? "";
  const availableTemplates = getActiveTaskTemplatesByCategory(selectedCategoryId);
  const selectedTemplate = getTaskTemplate(modalState.taskTemplateId ?? "") ?? availableTemplates[0] ?? null;
  const effectiveTemplateId = selectedTemplate?.id ?? modalState.taskTemplateId ?? "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="发起关键行动">
        <div class="modal-header">
          <h2>发起关键行动</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">发起</button>
            <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form action-standard-launch-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${escapeHtml(modalState.error)}</div>
          <div class="form-grid">
            <label><span>关联目标</span><select name="goalId">${renderOptions(getActiveGoals(), "", "请选择目标")}</select></label>
            <label><span>选择价值链模块</span><select name="categoryId" data-action-standard-category-select>${renderOptions(getTaskCategories(), selectedCategoryId, "请选择价值链模块")}</select></label>
            <label><span>选择关键行动</span><select name="taskTemplateId" data-action-standard-template-select ${selectedCategoryId === "" ? "disabled" : ""}>${renderTaskTemplateOptions(availableTemplates, effectiveTemplateId, selectedCategoryId === "" ? "请先选择价值链模块" : "请选择关键行动")}</select></label>
            <label><span>发起人</span><select name="initiatorId">${renderOptions(people, getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "", "请选择发起人")}</select></label>
          </div>
          ${renderTemplateLockedInfo(selectedTemplate)}
          ${renderCustomFieldsForm(selectedTemplate)}
          ${renderActionProductSelector()}
          ${renderStandardWorkAttachmentsField()}
          <div class="form-grid">
            <label><span>计划开始日期</span><input name="startDate" type="date" value="" /></label>
            <label><span>截止时间</span><input name="dueDateDate" type="date" value="" /><select name="dueDateTime">${renderBusinessMinuteOptions("", "请选择时间")}</select></label>
            <label><span>计划周</span><input name="plannedWeek" value="" placeholder="例如 2026-W27" autocomplete="off" /></label>
          </div>
          <label><span>补充说明</span><textarea name="remark" rows="3"></textarea></label>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
            <button class="primary-button" type="submit">发起</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function buildLaunchAssignments(templateId, taskTemplate, initiatorId) {
  const launchAssignments = { owner: {}, accepter: {} };
  state.processTemplateNodes
    .filter((node) => node.templateId === templateId)
    .forEach((node) => {
      if (node.ownerRule === ProcessOwnerRule.LaunchAssign) launchAssignments.owner[node.id] = taskTemplate.ownerId ?? initiatorId;
      if (node.accepterRule === ProcessAccepterRule.LaunchAssign) launchAssignments.accepter[node.id] = taskTemplate.accepterId ?? initiatorId;
    });
  return launchAssignments;
}

async function uploadSelectedStandardWorkAttachments(form) {
  const input = form.elements.standardWorkAttachments;
  const files = input?.files === undefined ? [] : Array.from(input.files);
  const validationError = validateStandardWorkAttachmentFiles(files);
  if (validationError !== "") throw new Error(validationError);
  const uploaded = [];
  for (const file of files) uploaded.push(await uploadStandardWorkAttachment(file));
  return uploaded;
}

async function saveActionStandardLaunch(form, rerender) {
  const productIds = collectActionProductIds(form);
  const dueDateResult = collectBusinessMinuteDateTime(form, "dueDate");
  const template = getTaskTemplate(getFormValue(form, "taskTemplateId"));
  if (template === null) return setModalError("必须选择启用的关键行动。", rerender);
  if (template.status !== TaskTemplateStatus.Active) return setModalError("停用的关键行动不能用于发起关键行动。", rerender);
  if (!canLaunchActionTemplate(getCurrentUser(), template.id)) return setModalError("你没有权限发起该关键行动。", rerender);
  if (!template.defaultProcessTemplateId) return setModalError("该关键行动尚未绑定关键行动标准流程，请先配置。", rerender);
  const processTemplate = getProcessTemplateById(template.defaultProcessTemplateId);
  if (processTemplate === null || processTemplate.status !== ProcessTemplateStatus.Active) return setModalError("该关键行动绑定的关键行动标准流程未启用。", rerender);
  const customFields = collectCustomFields(form, template);
  const customError = validateCustomFields(customFields, template);
  if (customError !== "") return setModalError(customError, rerender);
  if (dueDateResult.error !== "") return setModalError(dueDateResult.error, rerender);

  let uploadedAttachments = [];
  try {
    uploadedAttachments = await uploadSelectedStandardWorkAttachments(form);
  } catch (uploadError) {
    return setModalError(uploadError.message ?? "附件上传失败。", rerender);
  }

  const now = getNow();
  const workPlanId = createId("work-plan");
  const mergedCustomFields =
    uploadedAttachments.length === 0
      ? customFields
      : {
          ...customFields,
          [standardWorkAttachmentsKey]: uploadedAttachments.map((attachment) => ({
            originalName: attachment.originalName,
            filePath: attachment.filePath ?? attachment.url,
            url: attachment.url,
            mimeType: attachment.mimeType,
            ext: attachment.ext ?? getFileExt(attachment.originalName ?? attachment.filename ?? ""),
            uploadedAt: attachment.uploadedAt ?? now,
            standardWorkId: template.id,
            workPlanId,
            processInstanceId: null,
            taskIds: [],
          })),
        };
  const remark = getFormValue(form, "remark");
  const displayTitle = buildDisplayTitle(template, mergedCustomFields);
  const workPlan = {
    id: workPlanId,
    goalId: getFormValue(form, "goalId") || getActiveGoals()[0]?.id || "",
    departmentId: template.departmentId ?? null,
    taskTemplateId: template.id,
    title: displayTitle,
    customFields: mergedCustomFields,
    coverImageUrl: getPrimaryImageUrl({ customFields: mergedCustomFields }) || null,
    status: WorkPlanStatus.ThisWeek,
    plannedWeek: getFormValue(form, "plannedWeek") || getCurrentWeek(),
    dueDate: dueDateResult.value,
    description: remark === "" ? template.description : `${template.description}\n补充说明：${remark}`,
    processInstanceId: null,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    canceledAt: null,
  };
  try {
    const currentUser = getCurrentUser();
    const currentUserId = currentUser?.personId ?? currentUser?.id ?? "";
    await launchWorkPlanDraftAsProcess(workPlan, {
      dueDate: workPlan.dueDate,
      initiatorId: currentUserId,
      launchAssignments: buildLaunchAssignments(template.defaultProcessTemplateId, template, currentUserId),
      productIds,
    });
  } catch (launchError) {
    console.error("发起关键行动保存失败", launchError);
    return setModalError(launchError.message || "发起关键行动保存失败，请检查本地数据库服务。", rerender);
  }
  modalState = null;
  rerender();
}

function syncTemplateFieldDraftFromForm() {
  const form = document.querySelector(".task-template-form");
  if (form === null || modalState?.kind !== "taskTemplate") return;
  modalState = { ...modalState, formFieldsDraft: normalizeTemplateFormFields(collectTemplateFormFields(form)) };
}

function handleTaskTemplateFieldAction(action, index, rerender) {
  if (modalState?.kind !== "taskTemplate") return false;
  syncTemplateFieldDraftFromForm();
  const fields = [...getTemplateFormFieldsDraft()];
  if (action === "add-task-template-field") {
    fields.push({
      id: createId("field"),
      label: "新字段",
      key: `field${fields.length + 1}`,
      type: "text",
      required: false,
      placeholder: "",
      options: [],
      showInList: false,
      sortOrder: fields.length + 1,
    });
  } else if (action === "remove-task-template-field") {
    fields.splice(index, 1);
  } else if (action === "move-task-template-field-up" && index > 0) {
    [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
  } else if (action === "move-task-template-field-down" && index < fields.length - 1) {
    [fields[index + 1], fields[index]] = [fields[index], fields[index + 1]];
  } else {
    return false;
  }
  modalState = { ...modalState, formFieldsDraft: normalizeTemplateFormFields(fields) };
  rerender();
  return true;
}

async function handleTemplateSubmit(event, rerender) {
  event.preventDefault();
  if (modalState?.kind === "taskTemplate") await saveTaskTemplate(event.target, rerender);
}

async function handleLaunchSubmit(event, rerender) {
  event.preventDefault();
  if (modalState?.kind === "launchActionStandard") await saveActionStandardLaunch(event.target, rerender);
}

export function openTaskTemplateLaunchModal(templateId, rerender) {
  const template = getTaskTemplate(templateId);
  if (template === null || !canLaunchActionTemplate(getCurrentUser(), template.id)) return false;
  modalState = {
    kind: "launchActionStandard",
    categoryId: getTaskTemplateValueChainCategoryId(template),
    taskTemplateId: template.id,
    error: "",
  };
  rerender();
  return true;
}

function handleTaskTemplateAction(action, templateId, rerender) {
  if (action === "add-task-template") {
    modalState = { kind: "taskTemplate", mode: "add", error: "", formFieldsDraft: createDefaultTemplateFormFields() };
    rerender();
    return;
  }
  if (action === "edit-task-template") {
    const template = getTaskTemplate(templateId);
    modalState = { kind: "taskTemplate", mode: "edit", templateId, error: "", formFieldsDraft: normalizeTemplateFormFields(template?.formFields ?? []) };
    rerender();
    return;
  }
  if (action === "view-task-template") {
    const template = getTaskTemplate(templateId);
    if (template !== null) {
      window.sessionStorage?.setItem("wufanStandardWorkFocusId", template.id);
      window.location.hash = "task-library";
      rerender();
    }
    return;
  }
  if (action === "launch-task-template") {
    openTaskTemplateLaunchModal(templateId, rerender);
    return;
  }
  if (action === "view-standard-work-process") {
    const template = getTaskTemplate(templateId);
    if (template?.defaultProcessTemplateId) {
      modalState = { kind: "standardWorkProcess", templateId };
      rerender();
    }
  }
}

async function moveStandardWorkToValueChain(templateId, categoryId, rerender) {
  if (!canCurrentUser("actionStandards.manage")) {
    window.alert("你没有权限调整关键行动的价值链模块。");
    return;
  }
  const template = getTaskTemplate(templateId);
  const category = getTaskCategories().find((item) => item.id === categoryId) ?? null;
  if (template === null || category === null) return;
  const previousCategoryId = template.categoryId ?? null;
  template.categoryId = category.id;
  standardWorkMoveStatus = { type: "saving", message: `正在保存到「${category.name}」...` };
  rerender();
  try {
    await moveTaskTemplateToValueChain(template.id, { id: category.id, name: category.name });
    const updatedTemplate = getTaskTemplate(template.id);
    if (updatedTemplate !== null) updatedTemplate.categoryId = category.id;
    standardWorkMoveStatus = { type: "success", message: `已保存到「${category.name}」，刷新后仍会保留。` };
    rerender();
  } catch (error) {
    const currentTemplate = getTaskTemplate(templateId);
    if (currentTemplate !== null) currentTemplate.categoryId = previousCategoryId;
    standardWorkMoveStatus = { type: "error", message: "分类保存失败，已恢复原分类。" };
    console.error("关键行动价值链模块保存失败", error);
    window.alert(error.message || "关键行动价值链模块保存失败，请检查本地数据库服务。");
    rerender();
  }
}

function clearStandardWorkDragState(host) {
  host.querySelectorAll(".standard-work-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
  host.querySelectorAll(".standard-work-column.is-drag-over").forEach((column) => column.classList.remove("is-drag-over"));
}

function getStandardWorkDropColumn(target) {
  return target?.closest?.("[data-standard-work-category-id]") ?? null;
}

function renderSelectedStandardWorkAttachments(input) {
  const container = input.closest(".standard-work-attachments-field")?.querySelector("[data-selected-standard-work-attachments]");
  if (container === null || container === undefined) return;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) {
    container.innerHTML = `<p class="form-note">暂无已选择附件</p>`;
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

async function handleImageUpload(input) {
  if (input.matches("[data-product-images-upload]")) {
    try {
      await handleProductImagesUpload(input);
    } catch (error) {
      window.alert(error.message || "图片上传失败。");
    }
    return;
  }
  const key = input.dataset.imageUploadKey;
  const file = input.files?.[0];
  if (key === undefined || file === undefined) return;
  try {
    const uploaded = await uploadImageFile(file);
    const hidden = input.closest(".image-url-field")?.querySelector(`input[name="custom__${CSS.escape(key)}"]`);
    if (hidden !== null && hidden !== undefined) hidden.value = uploaded.url;
    const preview = input.closest(".image-url-field")?.querySelector(".image-preview-box");
    if (preview !== null && preview !== undefined) {
      preview.innerHTML = `<img src="${escapeAttribute(resolveAssetUrl(uploaded.url))}" alt="图片预览" />`;
    }
  } catch (error) {
    window.alert(error.message || "图片上传失败。");
  }
}

function downloadFile(content, fileName, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createSimpleXlsxWorkbook(sheetName, headers, rows, leadingRows = []) {
  const values = [
    ...leadingRows,
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ];
  const worksheetRows = values
    .map(
      (row, rowIndex) => `
        <Row ss:Index="${rowIndex + 1}">
          ${row.map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join("")}
        </Row>
      `,
    )
    .join("");
  return `<?xml version="1.0"?>
    <?mso-application progid="Excel.Sheet"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
      xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Worksheet ss:Name="${escapeXml(sheetName)}"><Table>${worksheetRows}</Table></Worksheet>
    </Workbook>`;
}

function hasConfiguredStandardFlow(template) {
  if (!template?.defaultProcessTemplateId) return false;
  return state.processTemplateNodes.some((node) => node.templateId === template.defaultProcessTemplateId && node.status !== ProcessTemplateNodeStatus.Deleted);
}

function getUnconfiguredStandardWorks() {
  return state.taskTemplates
    .filter((template) => !hiddenLegacyStandardWorkNames.includes(template.name))
    .filter((template) => template.status !== TaskTemplateStatus.Inactive)
    .filter((template) => !hasConfiguredStandardFlow(template))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function downloadStandardFlowTemplate() {
  const templates = getUnconfiguredStandardWorks();
  if (templates.length === 0) {
    window.alert("暂无未配置标准流程的关键行动。");
    return;
  }
  const leadingRows = [
    ["填写说明：同一关键行动可以复制该行填写多个步骤；步骤序号从 1 开始连续填写；空白行会忽略；执行部门必须使用系统已有名称。"],
    ["时限单位：分钟。例如 30、60、120、1440。执行人可留空，系统会按部门负责人或关键行动负责人兜底。"],
    [],
  ];
  const rows = templates.map((template) => ({
    关键行动名称: template.name,
    步骤序号: "",
    步骤名称: "",
    执行部门: "",
    执行人: "",
    时限: "",
    完成标准: "",
    说明: "",
  }));
  downloadFile(
    createSimpleXlsxWorkbook("标准流程模板", standardFlowImportHeaders, rows, leadingRows),
    "行动标准待配置模板.xlsx",
    "application/vnd.ms-excel",
  );
}

function parseStandardFlowDelimitedRows(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

function parseStandardFlowXmlWorkbook(text) {
  const document = new DOMParser().parseFromString(text, "text/xml");
  return [...document.getElementsByTagName("Row")].map((row) =>
    [...row.getElementsByTagName("Cell")].map((cell) => cell.textContent?.trim() ?? ""),
  );
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function inflateZipEntry(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持解析压缩 xlsx，请使用系统下载的新模板重试。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsxEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder();
  const endOffset = findEndOfCentralDirectory(view);
  if (endOffset < 0) throw new Error("不是有效的 xlsx 文件。");
  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("xlsx 文件结构异常。");
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(new Uint8Array(arrayBuffer, centralOffset + 46, fileNameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedBytes = new Uint8Array(arrayBuffer, dataStart, compressedSize);
    let bytes;
    if (method === 0) bytes = compressedBytes;
    else if (method === 8) bytes = await inflateZipEntry(compressedBytes);
    else throw new Error("xlsx 文件包含暂不支持的压缩格式。");
    entries.set(name, { bytes, text: decoder.decode(bytes) });
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function getXmlTextContent(element) {
  return [...element.getElementsByTagName("t")].map((node) => node.textContent ?? "").join("");
}

function getCellColumnIndex(cellRef) {
  const letters = String(cellRef ?? "").match(/^[A-Z]+/i)?.[0] ?? "";
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function getXlsxSharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml")?.text;
  if (xml === undefined) return [];
  const document = new DOMParser().parseFromString(xml, "text/xml");
  return [...document.getElementsByTagName("si")].map(getXmlTextContent);
}

async function parseStandardFlowXlsxWorkbook(file) {
  const entries = await unzipXlsxEntries(await file.arrayBuffer());
  const sheetXml = entries.get("xl/worksheets/sheet1.xml")?.text ?? [...entries.entries()].find(([name]) => name.startsWith("xl/worksheets/"))?.[1]?.text;
  if (!sheetXml) return [];
  const sharedStrings = getXlsxSharedStrings(entries);
  const document = new DOMParser().parseFromString(sheetXml, "text/xml");
  if (document.querySelector("parsererror") !== null) return [];
  return [...document.getElementsByTagName("row")].map((row) => {
    const values = [];
    for (const cell of row.getElementsByTagName("c")) {
      const columnIndex = getCellColumnIndex(cell.getAttribute("r"));
      if (columnIndex < 0) continue;
      const type = cell.getAttribute("t");
      const rawValue = cell.getElementsByTagName("v")[0]?.textContent?.trim() ?? "";
      let value = rawValue;
      if (type === "s") value = sharedStrings[Number.parseInt(rawValue, 10)] ?? "";
      if (type === "inlineStr") value = getXmlTextContent(cell);
      if (type === "str") value = rawValue;
      values[columnIndex] = value.trim();
    }
    return values.map((value) => value ?? "");
  });
}

async function parseStandardFlowFile(file) {
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const signature = await file.slice(0, 2).text();
    if (signature === "PK") return parseStandardFlowXlsxWorkbook(file);
  }
  const text = await file.text();
  return text.trimStart().startsWith("<?xml") || text.includes("<Workbook")
    ? parseStandardFlowXmlWorkbook(text)
    : parseStandardFlowDelimitedRows(text);
}

function getStandardFlowHeaderRowIndex(rows) {
  return rows.findIndex((row) => standardFlowRequiredHeaders.every((header) => row.includes(header)));
}

function standardFlowRowsToRecords(rows, headerRowIndex = 0) {
  const headers = rows[headerRowIndex] ?? [];
  return rows.slice(headerRowIndex + 1).map((row, rowIndex) =>
    standardFlowImportHeaders.reduce((record, header) => {
      const index = headers.indexOf(header);
      record[header] = index >= 0 ? row[index] ?? "" : "";
      return record;
    }, { __rowNumber: headerRowIndex + rowIndex + 2 }),
  );
}

function normalizeStandardFlowRecord(record) {
  const normalized = standardFlowImportHeaders.reduce((result, header) => {
    result[header] = String(record[header] ?? "").trim();
    return result;
  }, {});
  normalized.__rowNumber = record.__rowNumber;
  return normalized;
}

function isBlankStandardFlowRecord(record) {
  return standardFlowImportHeaders.every((header) => String(record[header] ?? "").trim() === "");
}

function isReservedStandardFlowBlankRow(record) {
  return String(record.关键行动名称 ?? "").trim() !== "" &&
    ["步骤序号", "步骤名称", "执行部门", "执行人", "时限", "完成标准", "说明"].every((header) => String(record[header] ?? "").trim() === "");
}

function getDepartmentByName(name) {
  const text = String(name ?? "").trim();
  return departments.find((department) => department.name === text) ?? null;
}

function getPersonByName(name) {
  const text = String(name ?? "").trim();
  if (text === "") return null;
  return people.find((person) => [person.name, person.account, person.username].includes(text)) ?? null;
}

function normalizeStandardFlowDuration(value) {
  const text = String(value ?? "").trim();
  if (text === "") return 120;
  const number = Number(text.replace(/分钟|分/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function buildStandardFlowImportPreviewRows(records) {
  const stepOrdersByTemplate = new Map();
  const previewRows = records
    .map(normalizeStandardFlowRecord)
    .filter((record) => !isBlankStandardFlowRecord(record) && !isReservedStandardFlowBlankRow(record))
    .map((record) => {
      const rowNumber = Number(record.__rowNumber) || 2;
      const errors = [];
      const template = state.taskTemplates.find((item) => item.name === record.关键行动名称) ?? null;
      const department = getDepartmentByName(record.执行部门);
      const executor = getPersonByName(record.执行人);
      const durationMinutes = normalizeStandardFlowDuration(record.时限);
      const stepOrder = Number(record.步骤序号);
      if (template === null) errors.push(`第 ${rowNumber} 行：关键行动不存在`);
      if (template !== null && hasConfiguredStandardFlow(template)) errors.push(`第 ${rowNumber} 行：【${template.name}】已配置标准流程，本轮不支持更新模式`);
      if (record.步骤序号 === "") errors.push(`第 ${rowNumber} 行：【步骤序号】不能为空`);
      if (record.步骤序号 !== "" && (!Number.isInteger(stepOrder) || stepOrder <= 0)) errors.push(`第 ${rowNumber} 行：【步骤序号】必须是正整数`);
      if (record.步骤名称 === "") errors.push(`第 ${rowNumber} 行：【步骤名称】不能为空`);
      if (record.执行部门 === "") errors.push(`第 ${rowNumber} 行：【执行部门】不能为空`);
      if (record.执行部门 !== "" && department === null) errors.push(`第 ${rowNumber} 行：【执行部门】不存在`);
      if (record.执行人 !== "" && executor === null) errors.push(`第 ${rowNumber} 行：【执行人】不存在`);
      if (durationMinutes === null) errors.push(`第 ${rowNumber} 行：【时限】必须是分钟数字`);
      if (template !== null && Number.isInteger(stepOrder) && stepOrder > 0) {
        const orders = stepOrdersByTemplate.get(template.id) ?? new Set();
        if (orders.has(stepOrder)) errors.push(`第 ${rowNumber} 行：【${template.name}】步骤序号 ${stepOrder} 重复`);
        orders.add(stepOrder);
        stepOrdersByTemplate.set(template.id, orders);
      }
      return {
        rowNumber,
        record,
        template,
        department,
        executor,
        durationMinutes: durationMinutes ?? 120,
        stepOrder: Number.isInteger(stepOrder) && stepOrder > 0 ? stepOrder : 1,
        errors,
      };
    });
  const rowsByTemplate = previewRows.reduce((result, row) => {
    if (row.template === null) return result;
    result.set(row.template.id, [...(result.get(row.template.id) ?? []), row]);
    return result;
  }, new Map());
  rowsByTemplate.forEach((rows) => {
    const validOrderRows = rows.filter((row) => Number.isInteger(row.stepOrder) && row.stepOrder > 0);
    const uniqueOrders = [...new Set(validOrderRows.map((row) => row.stepOrder))].sort((left, right) => left - right);
    const expectedOrders = Array.from({ length: uniqueOrders.length }, (_, index) => index + 1);
    const isContinuous = uniqueOrders.length > 0 && uniqueOrders.every((order, index) => order === expectedOrders[index]);
    if (!isContinuous) {
      const firstRow = rows[0];
      firstRow.errors.push(`第 ${firstRow.rowNumber} 行：【${firstRow.template.name}】步骤序号必须从 1 开始连续填写，当前为 ${uniqueOrders.join("、") || "空"}`);
    }
  });
  return previewRows;
}

async function handleStandardFlowImportFile(file, rerender) {
  try {
    const rows = await parseStandardFlowFile(file);
    const headerRowIndex = getStandardFlowHeaderRowIndex(rows);
    const headers = headerRowIndex >= 0 ? rows[headerRowIndex] ?? [] : [];
    const missingHeaders = standardFlowRequiredHeaders.filter((header) => !headers.includes(header));
    if (missingHeaders.length > 0) {
      modalState = { kind: "standardFlowImport", fileName: file.name, rows: [], error: `缺少必要表头：${missingHeaders.join("、")}` };
      rerender();
      return;
    }
    const previewRows = buildStandardFlowImportPreviewRows(standardFlowRowsToRecords(rows, headerRowIndex));
    modalState = {
      kind: "standardFlowImport",
      fileName: file.name,
      rows: previewRows,
      error: previewRows.length === 0 ? "没有可导入的有效步骤行。" : "",
    };
    rerender();
  } catch {
    modalState = { kind: "standardFlowImport", fileName: file.name, rows: [], error: "文件解析失败，请使用系统导出的模板，或 CSV/TSV 文件。" };
    rerender();
  }
}

function renderStandardFlowImportModal() {
  if (modalState?.kind !== "standardFlowImport") return "";
  const invalidCount = modalState.rows.filter((row) => row.errors.length > 0).length;
  const validCount = modalState.rows.length - invalidCount;
  return `
    <div class="modal-backdrop"><div class="modal-panel wide-modal">
      <div class="modal-header">
        <div>
          <h2>导入关键行动标准流程</h2>
          <p class="form-note">${escapeHtml(modalState.fileName)}，共 ${modalState.rows.length} 行，可导入 ${validCount} 行。</p>
        </div>
        <button class="icon-button" type="button" data-action="close-task-modal" aria-label="关闭">×</button>
      </div>
      ${modalState.error ? `<div class="form-error">${escapeHtml(modalState.error)}</div>` : ""}
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>行号</th><th>关键行动</th><th>序号</th><th>步骤名称</th><th>执行部门</th><th>执行人</th><th>时限</th><th>状态</th></tr></thead>
          <tbody>
            ${
              modalState.rows.length === 0
                ? `<tr><td colspan="8">暂无可导入步骤</td></tr>`
                : modalState.rows.map((row) => `
                  <tr>
                    <td>${row.rowNumber}</td>
                    <td>${escapeHtml(row.record.关键行动名称)}</td>
                    <td>${escapeHtml(row.record.步骤序号)}</td>
                    <td>${escapeHtml(row.record.步骤名称)}</td>
                    <td>${escapeHtml(row.record.执行部门)}</td>
                    <td>${escapeHtml(row.record.执行人 || "-")}</td>
                    <td>${escapeHtml(row.record.时限 || "120")}</td>
                    <td>${row.errors.length === 0 ? "可导入" : escapeHtml(row.errors.join("；"))}</td>
                  </tr>
                `).join("")
            }
          </tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="secondary-button" type="button" data-action="close-task-modal">取消</button>
        <button class="primary-button" type="button" data-action="confirm-standard-flow-import" ${validCount === 0 || invalidCount > 0 ? "disabled" : ""}>确认导入</button>
      </div>
    </div></div>
  `;
}

function getStandardFlowFallbackOwnerId(template, department) {
  return department?.leaderId ?? template.ownerId ?? getCurrentUser()?.id ?? people[0]?.id ?? null;
}

function buildImportedProcessNode(row, processTemplateId, now, stepOrder = row.stepOrder) {
  const ownerId = getStandardFlowFallbackOwnerId(row.template, row.department);
  const submitDefaults = normalizeSubmitRequirement({ name: row.record.步骤名称 });
  return {
    id: createId("process-node"),
    templateId: processTemplateId,
    name: row.record.步骤名称,
    stepOrder,
    stageName: "默认标准",
    stageOrder: stepOrder,
    nodeOrder: stepOrder,
    departmentId: row.department?.id ?? "",
    ownerId,
    executorId: row.executor?.id ?? ownerId,
    ownerRule: ProcessOwnerRule.FixedPerson,
    ownerDepartmentId: row.department?.id ?? "",
    ownerPositionId: null,
    defaultOwnerId: ownerId,
    durationDays: Math.max(1, Math.ceil(row.durationMinutes / 1440)),
    durationMinutes: row.durationMinutes,
    description: row.record.说明,
    completionStandard: row.record.完成标准,
    reviewStandard: null,
    needAcceptance: false,
    accepterRule: ProcessAccepterRule.None,
    defaultAccepterId: null,
    outputRequirement: null,
    ...submitDefaults,
    status: ProcessTemplateNodeStatus.Active,
    createdAt: now,
    updatedAt: now,
  };
}

async function confirmStandardFlowImport(rerender) {
  if (modalState === null || modalState.kind !== "standardFlowImport") return;
  const invalidRows = modalState.rows.filter((row) => row.errors.length > 0);
  if (invalidRows.length > 0) {
    modalState = { ...modalState, error: "存在校验错误，请修正后重新导入；本次没有写入任何标准流程。" };
    rerender();
    return;
  }
  if (modalState.rows.length === 0) {
    modalState = { ...modalState, error: "没有可导入的有效步骤行。" };
    rerender();
    return;
  }
  const rowsByTemplateId = modalState.rows.reduce((result, row) => {
    result.set(row.template.id, [...(result.get(row.template.id) ?? []), row]);
    return result;
  }, new Map());
  const originalProcessTemplates = [...state.processTemplates];
  const originalProcessTemplateNodes = [...state.processTemplateNodes];
  const originalTaskTemplates = [...state.taskTemplates];
  const now = getNow();
  try {
    for (const [templateId, rows] of rowsByTemplateId.entries()) {
      const template = getTaskTemplate(templateId);
      if (template === null) throw new Error("导入过程中未找到关键行动。");
      if (hasConfiguredStandardFlow(template)) throw new Error(`【${template.name}】已配置标准流程，本轮不支持更新模式。`);
      const beforeProcessTemplateIds = new Set(state.processTemplates.map((item) => item.id));
      const processTemplateId = createOrReuseProcessTemplateForStandardWork({
        name: template.name,
        ownerId: template.ownerId,
        departmentId: template.departmentId,
        now,
        templateId: template.defaultProcessTemplateId || null,
      });
      const processTemplate = state.processTemplates.find((item) => item.id === processTemplateId);
      if (processTemplate === undefined) throw new Error(`【${template.name}】标准流程创建失败。`);
      if (!beforeProcessTemplateIds.has(processTemplateId)) await createPersistentResource("process-templates", processTemplate);
      else await updatePersistentResource("process-templates", processTemplate.id, processTemplate);
      if (template.defaultProcessTemplateId !== processTemplateId) {
        const updatedTemplate = { ...template, defaultProcessTemplateId: processTemplateId, updatedAt: now };
        await updatePersistentResource("task-templates", updatedTemplate.id, updatedTemplate);
        state.taskTemplates = state.taskTemplates.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item));
      }
      const nodes = rows
        .slice()
        .sort((left, right) => left.stepOrder - right.stepOrder)
        .map((row, index) => buildImportedProcessNode(row, processTemplateId, now, index + 1));
      for (const node of nodes) await createPersistentResource("process-template-nodes", node);
      state.processTemplateNodes = [...state.processTemplateNodes, ...nodes];
    }
  } catch (error) {
    state.processTemplates = originalProcessTemplates;
    state.processTemplateNodes = originalProcessTemplateNodes;
    state.taskTemplates = originalTaskTemplates;
    modalState = { ...modalState, error: error.message || "行动标准导入失败，请检查本地数据库服务。" };
    rerender();
    return;
  }
  const importedTemplateCount = rowsByTemplateId.size;
  const importedNodeCount = modalState.rows.length;
  modalState = null;
  window.alert(`导入完成：已为 ${importedTemplateCount} 个关键行动生成 ${importedNodeCount} 个标准节点。`);
  rerender();
}

export function bindStandardWorkLibraryEvents(rerender, container = document) {
  const host = container.querySelector?.(".standard-work-library-host") ?? container;
  const taskTemplateForm = document.querySelector(".task-template-form");
  const launchForm = document.querySelector(".action-standard-launch-form");
  if (launchForm !== null) bindActionProductSelectors(launchForm);
  host.addEventListener("input", (event) => {
    const input = event.target.closest("[data-standard-work-keyword]");
    if (input === null) return;
    standardWorkKeyword = input.value;
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    rerender();
    window.requestAnimationFrame(() => {
      const nextInput = document.querySelector("[data-standard-work-keyword]");
      if (nextInput === null) return;
      nextInput.focus({ preventScroll: true });
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    });
  });

  host.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".standard-work-card[draggable='true']");
    if (card === null) return;
    draggedStandardWorkTemplateId = card.dataset.standardWorkTemplateId ?? "";
    didDragStandardWorkCard = true;
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedStandardWorkTemplateId);
    }
    card.classList.add("is-dragging");
  });

  host.addEventListener("dragend", () => {
    clearStandardWorkDragState(host);
    draggedStandardWorkTemplateId = "";
    window.setTimeout(() => {
      didDragStandardWorkCard = false;
    }, 0);
  });

  host.addEventListener("dragover", (event) => {
    const column = getStandardWorkDropColumn(event.target);
    if (column === null) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    host.querySelectorAll(".standard-work-column.is-drag-over").forEach((item) => {
      if (item !== column) item.classList.remove("is-drag-over");
    });
    column.classList.add("is-drag-over");
  });

  host.addEventListener("dragleave", (event) => {
    const column = getStandardWorkDropColumn(event.target);
    if (column !== null && !column.contains(event.relatedTarget)) column.classList.remove("is-drag-over");
  });

  host.addEventListener("drop", async (event) => {
    const column = getStandardWorkDropColumn(event.target);
    if (column === null) return;
    event.preventDefault();
    const templateId = event.dataTransfer?.getData("text/plain") || draggedStandardWorkTemplateId;
    clearStandardWorkDragState(host);
    await moveStandardWorkToValueChain(templateId, column.dataset.standardWorkCategoryId ?? "", rerender);
    draggedStandardWorkTemplateId = "";
    didDragStandardWorkCard = false;
  });

  host.addEventListener("click", (event) => {
    if (didDragStandardWorkCard) {
      event.preventDefault();
      didDragStandardWorkCard = false;
      return;
    }
    const codeButton = event.target.closest("[data-copy-action-standard-code]");
    if (codeButton !== null) {
      event.preventDefault();
      event.stopPropagation();
      const code = codeButton.dataset.copyActionStandardCode ?? "";
      if (code === "") return;
      copyTextToClipboard(code).then((copied) => {
        if (!copied) return;
        const originalText = codeButton.textContent;
        codeButton.textContent = "已复制";
        window.setTimeout(() => {
          if (codeButton.isConnected) codeButton.textContent = originalText;
        }, 1200);
      });
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton === null) {
      const card = event.target.closest("[data-standard-work-template-id]");
      const processTemplateId = card?.dataset.processTemplateId ?? "";
      if (processTemplateId !== "") window.location.hash = `process-template-${processTemplateId}`;
      return;
    }
    const action = actionButton.dataset.action;
    if (action === "submit-modal-form") {
      const form = actionButton.closest(".modal-panel")?.querySelector("form");
      form?.requestSubmit();
      return;
    }
    if (action === "close-task-modal") {
      modalState = null;
      rerender();
      return;
    }
    if (action === "remove-selected-standard-work-attachment") {
      removeSelectedStandardWorkAttachment(actionButton);
      return;
    }
    if (action === "remove-product-image") {
      removeProductImage(actionButton);
      return;
    }
    if (action === "download-standard-flow-template") {
      downloadStandardFlowTemplate();
      return;
    }
    if (action === "confirm-standard-flow-import") {
      confirmStandardFlowImport(rerender);
      return;
    }
    if (handleTaskTemplateFieldAction(action, Number(actionButton.dataset.fieldIndex ?? -1), rerender)) return;
    handleTaskTemplateAction(action, actionButton.dataset.templateId, rerender);
  });

  host.addEventListener("change", async (event) => {
    const standardSelect = event.target.closest("[data-action='change-standard-work-value-chain']");
    if (standardSelect !== null) {
      await moveStandardWorkToValueChain(standardSelect.dataset.templateId ?? "", standardSelect.value ?? "", rerender);
      return;
    }
    if (event.target.matches("[data-action-standard-category-select]")) {
      modalState = { ...modalState, categoryId: event.target.value, taskTemplateId: "", error: "" };
      rerender();
      return;
    }
    if (event.target.matches("[data-action-standard-template-select]")) {
      modalState = { ...modalState, taskTemplateId: event.target.value };
      rerender();
      return;
    }
    if (event.target.matches("[data-image-upload-key]")) {
      handleImageUpload(event.target);
      return;
    }
    if (event.target.matches("[data-standard-work-attachments]")) {
      renderSelectedStandardWorkAttachments(event.target);
    }
  });

  if (taskTemplateForm !== null) taskTemplateForm.addEventListener("submit", (event) => handleTemplateSubmit(event, rerender));
  if (launchForm !== null) launchForm.addEventListener("submit", (event) => handleLaunchSubmit(event, rerender));
  host.querySelector("[data-standard-flow-file='import']")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    handleStandardFlowImportFile(file, rerender);
  });
}
