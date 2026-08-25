import {
  batchLaunchWorkPlanDrafts,
  createId,
  createPersistentResource,
  getCurrentUser,
  getCurrentWeek,
  getLatestStandardWorkFormFields,
  getNow,
  loadTemplates,
  parseContentNoteImport,
  prepareWorkPlanLaunchPayload,
  resolveAssetUrl,
  state,
  updatePersistentResource,
  uploadImageFile,
} from "./appState.js";
import {
  collectBusinessDateTime,
  formatBusinessDateTime,
  getBusinessDatePart,
  getBusinessHourPart,
  renderBusinessHourOptions,
} from "./businessTime.js";
import { getEffectivePublishTime, normalizePublishTimeMode, PublishTimeMode } from "./data/contentPublishTime.js";
import { canLaunchActionTemplate, hasPermission } from "../shared/permissions.js";
import { rerenderPreservingInputFocus } from "./inputFocus.js";
import { normalizeProductSkuCode, splitProductSkuCodes } from "./data/productSku.js";
import {
  CategoryType,
  ContentScheduleStatus,
  GoalStatus,
  ProcessAccepterRule,
  ProcessInstanceStatus,
  ProcessOwnerRule,
  ProcessTemplateStatus,
  Status,
  TaskStatus,
  TaskTemplateStatus,
  WorkPlanStatus,
  contentScheduleAudienceOptions,
  contentSchedulePurposeOptions,
  contentScheduleStatusNames,
  contentScheduleTypeOptions,
  taskStatusNames,
  workPlanStatusNames,
} from "./data/modelOptions.js";
import {
  getCurrentProcessTask as selectCurrentProcessTask,
  getProcessInstanceBusinessStatus as selectProcessInstanceBusinessStatus,
  getProcessProgress as selectProcessProgress,
  isProcessInstanceOverdue as selectProcessInstanceOverdue,
} from "./data/processInstanceSelectors.js";
import { normalizePublicFormFields } from "./publicFormFields.js";
import {
  getPublishingAccountNames,
  isPublishingAccountField,
} from "./publishingAccountOptions.js";
import {
  bindLaunchedProcessDetailEvents,
  canEditLaunchedProcessInstance,
  renderLaunchedProcessDetail,
} from "./processInstanceDetail.js";

const defaultDepartmentId = "dept-marketing";
const defaultOwnerId = "person-005";
const contentNoteTaskTemplateId = "task-template-publish-content-note";
const categories = state.categories;
const goals = state.goals;
const contentNoteExportHeaders = [
  "行动编码",
  "发布日期",
  "发布账号",
  "笔记形式",
  "内容目的",
  "对应产品",
  "关键行动名称",
  "当前状态",
  "对齐目标",
];
const contentNoteStatusOptions = ["待提交", "待制作", "待审核", "待发布", "已发布", "已超时", "已取消"];
const legacyScheduleWriteDisabledMessage = "历史排期维护已停用，请通过“发起发布内容笔记”创建新排期。";

let filters = {
  dateFrom: "",
  dateTo: "",
  account: "",
  contentType: "",
  contentPurpose: "",
  targetAudience: "",
  status: "",
  productKeyword: "",
  titleKeyword: "",
  goalId: "",
};
let selectedScheduleId = state.contentSchedules[0]?.id ?? null;
let selectedScheduleIds = new Set();
let modalState = null;
let importProductMatchIndex = null;
let contentTemplatesLoaded = false;
let contentTemplatesLoading = false;

const templateTagCategories = [
  { id: "brand", label: "品牌" },
  { id: "platform", label: "平台" },
  { id: "tone", label: "调性" },
  { id: "format", label: "形式" },
  { id: "usage", label: "用途" },
];

function canCurrentUser(permissionPath) {
  return hasPermission(getCurrentUser(), permissionPath);
}

function getActiveGoals() {
  return goals.filter((goal) => goal.status !== GoalStatus.Inactive);
}

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

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function findName(items, id, fallback) {
  if (id === null || id === "") return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function getSchedule(scheduleId) {
  return state.contentSchedules.find((item) => item.id === scheduleId) ?? null;
}

function createEmptyTemplateTags() {
  return Object.fromEntries(templateTagCategories.map((category) => [category.id, []]));
}

function addUniqueTemplateTag(list, tag) {
  const normalizedTag = String(tag ?? "").trim();
  if (normalizedTag === "") return list;
  return list.includes(normalizedTag) ? list : [...list, normalizedTag];
}

function normalizeTemplateTags(tags) {
  const normalizedTags = createEmptyTemplateTags();
  if (Array.isArray(tags)) {
    tags.forEach((tag) => {
      normalizedTags.usage = addUniqueTemplateTag(normalizedTags.usage, tag);
    });
    return normalizedTags;
  }
  if (tags && typeof tags === "object") {
    templateTagCategories.forEach((category) => {
      if (Array.isArray(tags[category.id])) {
        tags[category.id].forEach((tag) => {
          normalizedTags[category.id] = addUniqueTemplateTag(normalizedTags[category.id], tag);
        });
      }
    });
  }
  return normalizedTags;
}

function getFlatTemplateTags(tags) {
  return templateTagCategories.flatMap((category) => normalizeTemplateTags(tags)[category.id] ?? []);
}

function getTemplateName(template) {
  const nameFromTags = getFlatTemplateTags(template?.tags).filter(Boolean).join(" ");
  return nameFromTags || template?.name || "未命名模板";
}

function getTemplatePreviewImage(template) {
  if (template?.previewImage && typeof template.previewImage === "object") return template.previewImage;
  return { fileName: "", fileUrl: "" };
}

function getTemplateSourceFile(template) {
  if (template?.sourceFile && typeof template.sourceFile === "object") return template.sourceFile;
  return { fileName: "", fileUrl: "", sourceUrl: "" };
}

function getTemplateSourceUrl(template) {
  const sourceUrl = String(getTemplateSourceFile(template).sourceUrl ?? "").trim();
  if (sourceUrl === "") return "";
  try {
    const parsed = new URL(sourceUrl);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function getTemplateAssetLinks(template) {
  const previewImage = getTemplatePreviewImage(template);
  const sourceUrl = getTemplateSourceUrl(template);
  return `
    <div class="row-actions">
      ${previewImage.fileUrl ? `<a class="text-button" href="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" download="${escapeAttribute(previewImage.fileName || "template-preview")}">图片</a>` : ""}
      ${sourceUrl ? `<a class="text-button" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer">源文件链接</a>` : ""}
    </div>
  `;
}

function getSelectedContentTemplate(templateId) {
  if (!templateId) return null;
  return state.templates.find((template) => template.id === templateId) ?? null;
}

function getTemplateFilterTags() {
  const groupedTags = createEmptyTemplateTags();
  state.templates.forEach((template) => {
    const tags = normalizeTemplateTags(template.tags);
    templateTagCategories.forEach((category) => {
      tags[category.id].forEach((tag) => {
        groupedTags[category.id] = addUniqueTemplateTag(groupedTags[category.id], tag);
      });
    });
  });
  return groupedTags;
}

function getFilteredContentTemplates() {
  const query = (modalState?.templateQuery ?? "").trim().toLowerCase();
  const selectedTags = normalizeTemplateTags(modalState?.templateTagFilters ?? {});
  return state.templates.filter((template) => {
    const tags = normalizeTemplateTags(template.tags);
    const flatTags = getFlatTemplateTags(tags);
    const searchableText = `${getTemplateName(template)} ${flatTags.join(" ")}`.toLowerCase();
    if (query !== "" && !searchableText.includes(query)) return false;
    return templateTagCategories.every((category) => {
      const requiredTags = selectedTags[category.id] ?? [];
      if (requiredTags.length === 0) return true;
      const templateTags = tags[category.id] ?? [];
      return requiredTags.every((tag) => templateTags.includes(tag));
    });
  });
}

function getTaskCategories() {
  return categories.filter((category) => category.type === CategoryType.Task && category.status !== "inactive");
}

function getDefaultContentTaskTemplate() {
  return (
    state.taskTemplates.find(
      (template) => template.name === "发布内容笔记" && template.status === TaskTemplateStatus.Active,
    ) ??
    state.taskTemplates.find((template) => template.name === "小红书笔记发布" && template.status === TaskTemplateStatus.Active) ??
    state.taskTemplates.find((template) => template.status === TaskTemplateStatus.Active) ??
    null
  );
}

function getContentTaskTemplate(schedule) {
  const contentType = normalizeContentType(schedule.contentType);
  if (contentType === "电商视觉") return null;
  const preferredName = contentType === "买家秀" ? "发布买家秀" : "发布内容笔记";
  return (
    state.taskTemplates.find((template) => template.name === preferredName && template.status === TaskTemplateStatus.Active) ??
    (preferredName === "发布内容笔记"
      ? state.taskTemplates.find((template) => template.name === "小红书笔记发布" && template.status === TaskTemplateStatus.Active)
      : null)
  );
}

function getOperationDepartmentId() {
  return (
    state.departments.find((department) => department.name === "运营部")?.id ??
    state.departments.find((department) => department.name === "营销部")?.id ??
    defaultDepartmentId
  );
}

function getProcessTemplateById(templateId) {
  return state.processTemplates.find((template) => template.id === templateId) ?? null;
}

function buildLaunchAssignments(templateId, taskTemplate, initiatorId) {
  const launchAssignments = { owner: {}, accepter: {} };
  state.processTemplateNodes
    .filter((node) => node.templateId === templateId)
    .forEach((node) => {
      if (node.ownerRule === ProcessOwnerRule.LaunchAssign) {
        launchAssignments.owner[node.id] = taskTemplate.ownerId ?? initiatorId;
      }
      if (node.accepterRule === ProcessAccepterRule.LaunchAssign) {
        launchAssignments.accepter[node.id] = taskTemplate.accepterId ?? initiatorId;
      }
    });
  return launchAssignments;
}

function getSortedFormFields(template) {
  return [...(template?.formFields ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
}

function getCustomFieldValue(customFields, field) {
  const value = customFields[field.key];
  if (Array.isArray(value)) return value.join("、");
  return value ?? "";
}

function buildDisplayTitle(template, customFields) {
  const values = getSortedFormFields(template)
    .filter((field) => field.showInList && field.key !== "coverImageUrl")
    .map((field) => getCustomFieldValue(customFields, field))
    .filter(Boolean)
    .slice(0, 3);
  return values.length === 0 ? template.name : `${template.name}｜${values.join("｜")}`;
}

function getStatusValueByName(name) {
  return normalizeContentScheduleStatus(name);
}

function getStatusName(valueOrName) {
  const normalizedStatus = normalizeContentScheduleStatus(valueOrName);
  return contentScheduleStatusNames[normalizedStatus] ?? valueOrName ?? "";
}

const legacyContentTypeMap = {
  图文: "图文笔记",
  短视频: "视频笔记",
  长文: "图文笔记",
  直播预告: "视频笔记",
  新品预热: "图文笔记",
  互动: "图文笔记",
  测评: "图文笔记",
  知识: "图文笔记",
  种草: "图文笔记",
  搭配: "图文笔记",
  产品介绍: "电商视觉",
  搭配灵感: "图文笔记",
  日常分享: "图文笔记",
  福利活动: "图文笔记",
};

const legacyContentPurposeMap = {
  种草: "种草引流",
  新品种草: "种草引流",
  拉新: "种草引流",
  活动宣传: "种草引流",
  用户教育: "场景教育",
  提高互动: "场景教育",
  提升收藏: "审美表达",
  建立信任: "信任建立",
  提高信任: "信任建立",
  品牌认知: "品牌心智",
  转化: "转化收割",
  提升转化: "转化收割",
  引导进群: "转化收割",
  直播蓄水: "转化收割",
  老客维护: "信任建立",
};

const legacyContentAudienceMap = {
  新用户: "新客",
  老用户: "老客",
  潜在用户: "兴趣人群",
  潜在购买用户: "兴趣人群",
  关注居家生活的人群: "兴趣人群",
  正在挑选礼物的人群: "兴趣人群",
  粉丝: "老客",
  高消费用户: "老客",
  送礼人群: "兴趣人群",
};

const legacyStatusMap = {
  draft: ContentScheduleStatus.PendingSubmit,
  planning: ContentScheduleStatus.PendingSubmit,
  shooting: ContentScheduleStatus.PendingProduction,
  editing: ContentScheduleStatus.PendingProduction,
  copywriting: ContentScheduleStatus.PendingProduction,
  reviewing: ContentScheduleStatus.PendingReview,
  ready_to_publish: ContentScheduleStatus.PendingPublish,
  reviewed: ContentScheduleStatus.Published,
  草稿: ContentScheduleStatus.PendingSubmit,
  选题中: ContentScheduleStatus.PendingSubmit,
  待拍摄: ContentScheduleStatus.PendingProduction,
  待修图: ContentScheduleStatus.PendingProduction,
  待写文案: ContentScheduleStatus.PendingProduction,
  待制作: ContentScheduleStatus.PendingProduction,
  待审核: ContentScheduleStatus.PendingReview,
  待发布: ContentScheduleStatus.PendingPublish,
  已发布: ContentScheduleStatus.Published,
  已复盘: ContentScheduleStatus.Published,
  已超时: ContentScheduleStatus.Overdue,
  取消: ContentScheduleStatus.Canceled,
  已取消: ContentScheduleStatus.Canceled,
};

function normalizeOptionValue(value, options, legacyMap) {
  const normalizedValue = value ?? "";
  if (options.includes(normalizedValue)) return normalizedValue;
  return legacyMap[normalizedValue] ?? normalizedValue;
}

function normalizeContentType(value) {
  return normalizeOptionValue(value, contentScheduleTypeOptions, legacyContentTypeMap);
}

function normalizeContentPurpose(value) {
  return normalizeOptionValue(value, contentSchedulePurposeOptions, legacyContentPurposeMap);
}

function normalizeContentAudience(value) {
  return normalizeOptionValue(value, contentScheduleAudienceOptions, legacyContentAudienceMap);
}

function normalizeContentScheduleStatus(valueOrName) {
  const value = valueOrName ?? "";
  if (contentScheduleStatusNames[value] !== undefined) return value;
  const namedStatus = Object.entries(contentScheduleStatusNames).find(([, label]) => label === value)?.[0] ?? "";
  if (namedStatus !== "") return namedStatus;
  return legacyStatusMap[value] ?? "";
}

function renderStringOptions(options, selectedValue, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${options
      .map(
        (option) => `
          <option value="${escapeAttribute(option)}" ${option === selectedValue ? "selected" : ""}>
            ${escapeHtml(option)}
          </option>
        `,
      )
      .join("")}
  `;
}

function renderEntityOptions(items, selectedId, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${items
      .map(
        (item) => `
          <option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>
            ${escapeHtml(item.name)}
          </option>
        `,
      )
      .join("")}
  `;
}

function getActivePublishingAccountNames(selectedAccount = "") {
  const names = getPublishingAccountNames(state.publishingAccounts);
  if (selectedAccount !== "" && !names.includes(selectedAccount)) return [...names, selectedAccount];
  return names;
}

function renderStatusOptions(selectedStatus, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${Object.entries(contentScheduleStatusNames)
      .map(
        ([value, label]) => `
          <option value="${value}" ${value === selectedStatus ? "selected" : ""}>
            ${label}
          </option>
        `,
      )
      .join("")}
  `;
}

function renderContentNoteStatusOptions(selectedStatus, emptyLabel) {
  return `
    <option value="">${emptyLabel}</option>
    ${contentNoteStatusOptions
      .map((status) => `<option value="${status}" ${status === selectedStatus ? "selected" : ""}>${status}</option>`)
      .join("")}
  `;
}

function normalizeImportDate(value) {
  const trimmedValue = String(value ?? "").trim();
  if (trimmedValue === "") return "";
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  const fullDateMatch = trimmedValue.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  const monthDayMatch = trimmedValue.match(/^(\d{1,2})月(\d{1,2})日$/);

  if (fullDateMatch) {
    year = Number(fullDateMatch[1]);
    month = Number(fullDateMatch[2]);
    day = Number(fullDateMatch[3]);
    hour = fullDateMatch[4] === undefined ? 0 : Number(fullDateMatch[4]);
    minute = fullDateMatch[5] === undefined ? 0 : Number(fullDateMatch[5]);
    if (hour > 23 || minute > 59) return null;
  } else if (monthDayMatch) {
    year = 2026;
    month = Number(monthDayMatch[1]);
    day = Number(monthDayMatch[2]);
  } else {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  if (minute > 0) {
    hour += 1;
    minute = 0;
  }
  if (hour >= 24) {
    date.setDate(date.getDate() + 1);
    hour = 0;
  }

  const normalizedDate = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `${normalizedDate}T${String(hour).padStart(2, "0")}:00:00+08:00`;
}

function compressProductImage(file) {
  return new Promise((resolve, reject) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      reject(new Error("请上传 jpg、jpeg、png 或 webp 格式的图片"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片加载失败，请重新选择"));
      image.onload = () => {
        const maxSize = 800;
        const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
        const width = Math.round(image.width * scale);
        const height = Math.round(image.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (context === null) {
          reject(new Error("当前浏览器不支持图片压缩"));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function matchesFilters(schedule) {
  const publishDate = getBusinessDatePart(schedule.publishDate) || (schedule.publishDate ?? "");
  const product = schedule.product ?? "";
  const title = schedule.title ?? "";
  if (filters.dateFrom !== "" && publishDate < filters.dateFrom) return false;
  if (filters.dateTo !== "" && publishDate > filters.dateTo) return false;
  if (filters.account !== "" && schedule.account !== filters.account) return false;
  if (filters.contentType !== "" && normalizeContentType(schedule.contentType) !== filters.contentType) return false;
  if (filters.contentPurpose !== "" && normalizeContentPurpose(schedule.contentPurpose ?? schedule.purpose) !== filters.contentPurpose) return false;
  if (filters.targetAudience !== "" && normalizeContentAudience(schedule.targetAudience ?? schedule.audience) !== filters.targetAudience) return false;
  if (filters.status === "" && normalizeContentScheduleStatus(schedule.status) === ContentScheduleStatus.Canceled) return false;
  if (filters.status !== "" && schedule.status !== filters.status && normalizeContentScheduleStatus(schedule.status) !== filters.status) return false;
  if (filters.goalId !== "" && schedule.goalId !== filters.goalId) return false;
  if (filters.productKeyword !== "" && !product.includes(filters.productKeyword)) return false;
  if (filters.titleKeyword !== "" && !title.includes(filters.titleKeyword)) return false;
  return true;
}

function getFilteredSchedules() {
  return state.contentSchedules
    .filter(matchesFilters)
    .sort((left, right) => (left.publishDate ?? "").localeCompare(right.publishDate ?? ""));
}

function renderFilters() {
  return `
    <form class="content-schedule-filters" aria-label="发布内容笔记筛选">
      <label><span>开始日期</span><input name="dateFrom" type="date" value="${filters.dateFrom}" /></label>
      <label><span>结束日期</span><input name="dateTo" type="date" value="${filters.dateTo}" /></label>
      <label><span>发布账号</span><select name="account">${renderStringOptions(getActivePublishingAccountNames(filters.account), filters.account, "全部账号")}</select></label>
      <label><span>笔记形式</span><select name="contentType">${renderStringOptions(contentScheduleTypeOptions, filters.contentType, "全部形式")}</select></label>
      <label><span>内容目的</span><select name="contentPurpose">${renderStringOptions(contentSchedulePurposeOptions, filters.contentPurpose, "全部目的")}</select></label>
      <label><span>状态</span><select name="status">${renderContentNoteStatusOptions(filters.status, "全部状态")}</select></label>
      <label><span>关联目标</span><select name="goalId">${renderEntityOptions(getActiveGoals(), filters.goalId, "全部目标")}</select></label>
      <label><span>产品关键词</span><input name="productKeyword" value="${escapeAttribute(filters.productKeyword)}" placeholder="搜索产品" /></label>
      <label><span>标题关键词</span><input name="titleKeyword" value="${escapeAttribute(filters.titleKeyword)}" placeholder="搜索标题" /></label>
    </form>
  `;
}

function renderActionButton(label, action, scheduleId, variant = "") {
  return `<button class="text-button ${variant}" type="button" data-content-action="${action}" data-schedule-id="${scheduleId}">${label}</button>`;
}

function renderContentActionButton(label, action, itemId, variant = "") {
  return `<button class="text-button ${variant}" type="button" data-content-action="${action}" data-content-id="${escapeAttribute(itemId)}">${label}</button>`;
}

function renderImageCell(item) {
  return item.productImage
    ? `<img class="content-thumb" src="${escapeAttribute(resolveAssetUrl(item.productImage))}" alt="1:1 产品主图" />`
    : `<span class="empty-thumb">无图</span>`;
}

function getContentNoteTemplate() {
  return (
    state.taskTemplates.find((template) => template.id === contentNoteTaskTemplateId) ??
    state.taskTemplates.find((template) => template.name === "发布内容笔记") ??
    state.taskTemplates.find((template) => template.name === "小红书笔记发布") ??
    null
  );
}

const contentNoteExtraFormFields = [
  { id: "content-note-product-name", key: "productName", label: "对应产品", type: "text", required: false, options: [], showInList: true, sortOrder: 7 },
  { id: "content-note-scene", key: "scene", label: "参考场景", type: "text", required: false, options: [], showInList: true, sortOrder: 10 },
  { id: "content-note-hashtags", key: "hashtags", label: "话题", type: "text", required: false, options: [], showInList: true, sortOrder: 11 },
];

function getContentNoteFormFields() {
  const template = getContentNoteTemplate();
  if (template === null) return [];
  const fields = normalizePublicFormFields(getLatestStandardWorkFormFields(template.id, template.formFields ?? []));
  fields.forEach((field) => {
    if (field.key === "publishDate") field.type = "datetime_hour";
  });
  contentNoteExtraFormFields.forEach((field) => {
    if (!fields.some((item) => item.key === field.key)) fields.push({ ...field });
  });
  return fields.sort((left, right) => left.sortOrder - right.sortOrder);
}

function getContentNoteBatchFormFields() {
  const template = getContentNoteTemplate();
  if (template === null) return [];
  return normalizePublicFormFields(getLatestStandardWorkFormFields(template.id, template.formFields ?? []))
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function findContentFormField(keys = [], labels = []) {
  return getContentNoteFormFields().find(
    (field) => keys.includes(field.key) || labels.includes(String(field.label ?? "").trim()),
  ) ?? null;
}

function getContentTitleField() {
  return findContentFormField(["title", "contentTitle"], ["标题", "内容标题"]);
}

function getContentFieldHeader(field) {
  if (field.key === "publishDate") return null;
  if (field.key === "coverImageUrl" || field.type === "image" || field.type === "file") return null;
  if (field.label === "标题") return "内容标题";
  if (field.label === "文案") return "内容文案";
  if (field.label === "目的") return "内容目的";
  return field.label;
}

function getBatchTemplateColumns() {
  const columns = ["对齐目标", "关键行动名称", "产品编码", "模板编码", "完成日期", "完成时间"];
  getContentNoteBatchFormFields().forEach((field) => {
    if (field.key === "publishDate") {
      columns.push("发布日期", "发布时间");
      return;
    }
    const header = getContentFieldHeader(field);
    if (header && !columns.includes(header)) columns.push(header);
  });
  ["参考场景", "话题", "备注"].forEach((header) => {
    if (!columns.includes(header)) columns.push(header);
  });
  return columns;
}

function getFieldAllowedValues(field) {
  if (isPublishingAccountField(field)) return getActivePublishingAccountNames();
  if (!Array.isArray(field?.options)) return [];
  return field.options.map((option) => String(option?.label ?? option?.name ?? option?.value ?? option)).filter(Boolean);
}

function getBatchTemplateInstruction(column) {
  if (column === "对齐目标") return "可留空并在预览页统一选择；填写目标编码或唯一目标名称";
  if (column === "产品编码") return "选填；可填写多个产品编码，使用逗号、分号或换行分隔；空值不建立产品关联";
  if (column === "模板编码") return "选填；格式 MB-YYYYMM-NNNN；仅限小红书笔记模板；空值不建立模板关联";
  if (column === "关键行动名称") return "选填；留空按产品和模板名称自动生成";
  if (column === "完成日期") return "选填；格式 YYYY-MM-DD";
  if (column === "完成时间") return "与完成日期同时填写；整点 HH:00";
  if (column === "发布日期") return "选填；有值时格式 YYYY-MM-DD";
  if (column === "发布时间") return "选填；与发布日期同时填写，整点 HH:00";
  const field = getContentNoteBatchFormFields().find((item) => getContentFieldHeader(item) === column);
  if (column === "参考场景" || column === "话题" || column === "备注") return "选填；普通字段允许留空";
  const options = getFieldAllowedValues(field);
  return `选填；普通字段允许留空${options.length ? `；有值时可选：${options.join(" / ")}` : ""}`;
}

function getFieldValueByHeader(record, field) {
  const header = getContentFieldHeader(field);
  return header ? String(record[header] ?? "").trim() : "";
}

function isSelectableImportProduct(product) {
  return !["inactive", "archived", "已归档", "停用"].includes(String(product?.status ?? "").trim());
}

function canLaunchContentNote() {
  const template = getContentNoteTemplate();
  return template !== null && canLaunchActionTemplate(getCurrentUser(), template.id);
}

function isContentNoteInstance(instance) {
  const template = getContentNoteTemplate();
  if (instance.taskTemplateId === contentNoteTaskTemplateId) return true;
  if (template !== null && instance.taskTemplateId === template.id) return true;
  return state.taskTemplates.find((item) => item.id === instance.taskTemplateId)?.name === "发布内容笔记";
}

function getWorkPlanByProcessInstance(instanceId) {
  return state.workPlans.find((workPlan) => workPlan.processInstanceId === instanceId) ?? null;
}

function getInstanceTasks(instanceId) {
  return state.tasks
    .filter((task) => task.processInstanceId === instanceId && task.status !== TaskStatus.Canceled)
    .sort((left, right) => {
      const leftNode = state.processTemplateNodes.find((node) => node.id === left.processNodeId);
      const rightNode = state.processTemplateNodes.find((node) => node.id === right.processNodeId);
      const leftOrder = leftNode?.stepOrder ?? leftNode?.nodeOrder ?? 999;
      const rightOrder = rightNode?.stepOrder ?? rightNode?.nodeOrder ?? 999;
      return leftOrder - rightOrder;
    });
}

function getAliasedField(fields, keys, fallback = "") {
  for (const key of keys) {
    const value = fields?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizeContentNoteFields(instance, workPlan) {
  const fields = { ...(workPlan?.customFields ?? {}), ...(instance.customFields ?? {}) };
  const titleField = getContentTitleField();
  const copyField = findContentFormField(["contentText", "copywriting"], ["内容文案", "文案"]);
  return {
    publishTimeMode: normalizePublishTimeMode(fields.publishTimeMode),
    publishDate: getEffectivePublishTime(fields, instance.dueDate ?? workPlan?.dueDate ?? "") || getAliasedField(fields, ["publishDate"], instance.dueDate ?? workPlan?.dueDate ?? ""),
    account: getAliasedField(fields, ["account"]),
    contentType: normalizeContentType(getAliasedField(fields, ["contentType"])),
    contentPurpose: normalizeContentPurpose(getAliasedField(fields, ["purpose", "contentPurpose"])),
    targetAudience: normalizeContentAudience(getAliasedField(fields, ["audience", "targetAudience"])),
    product: getAliasedField(fields, ["productName", "product"]),
    productImage: getAliasedField(fields, ["coverImageUrl", "productImage"], instance.coverImageUrl ?? workPlan?.coverImageUrl ?? ""),
    title: getAliasedField(fields, [titleField?.key, "title"].filter(Boolean), instance.displayTitle ?? instance.name ?? ""),
    copywriting: getAliasedField(fields, [copyField?.key, "contentText", "copywriting"].filter(Boolean)),
    scene: getAliasedField(fields, ["scene"]),
    hashtags: getAliasedField(fields, ["hashtags"]),
  };
}

function getContentNoteStatus(instance, tasks) {
  if (instance.status === ProcessInstanceStatus.Stopped || instance.status === "canceled") return "已取消";
  if (instance.status === ProcessInstanceStatus.Done) return "已发布";
  const currentTask = selectCurrentProcessTask(instance.id, state);
  if (selectProcessInstanceOverdue(instance.id, state)) return "已超时";
  const taskName = currentTask?.name ?? "";
  if (currentTask?.status === TaskStatus.PendingAcceptance || taskName.includes("审核")) return "待审核";
  if (taskName.includes("发布")) return "待发布";
  if (taskName.includes("制作") || taskName.includes("素材") || taskName.includes("文案")) return "待制作";
  return "待提交";
}

function buildContentNoteItem(instance) {
  const workPlan = getWorkPlanByProcessInstance(instance.id);
  const tasks = getInstanceTasks(instance.id);
  const fields = normalizeContentNoteFields(instance, workPlan);
  const productLinks = state.actionProducts.filter((link) => link.actionId === instance.id);
  const relatedProducts = productLinks.map((link) => state.products.find((product) => product.id === link.productId)).filter(Boolean);
  return {
    id: instance.id,
    instance,
    workPlan,
    tasks,
    currentTask: selectCurrentProcessTask(instance.id, state),
    goalId: instance.goalId ?? workPlan?.goalId ?? "",
    actionName: workPlan?.title ?? instance.displayTitle ?? instance.name ?? "",
    ...fields,
    product: relatedProducts.map((product) => product.name).join("、") || fields.product,
    status: getContentNoteStatus(instance, tasks),
  };
}

function getContentNoteItems() {
  const oldLinkedInstanceIds = new Set(
    state.contentSchedules
      .map((schedule) => schedule.processInstanceId)
      .filter((instanceId) => instanceId !== null && instanceId !== undefined && instanceId !== ""),
  );
  return state.processInstances
    .filter(isContentNoteInstance)
    .filter((instance) => !oldLinkedInstanceIds.has(instance.id))
    .map(buildContentNoteItem)
    .filter(matchesFilters)
    .sort((left, right) => (left.publishDate ?? "").localeCompare(right.publishDate ?? ""));
}

function getProcessProgressText(processInstanceId) {
  const progress = selectProcessProgress(processInstanceId, state);
  if (progress.total === 0) return "";
  return `${progress.completed}/${progress.total}`;
}

function renderScheduleFlowStatus(schedule) {
  if (schedule.workPlanId) {
    const workPlan = state.workPlans.find((item) => item.id === schedule.workPlanId);
    if (workPlan !== undefined) {
      return `<span class="status-pill">${workPlanStatusNames[workPlan.status] ?? "已加入关键行动计划"}</span>`;
    }
  }

  if (schedule.processInstanceId !== null) {
    const instance = state.processInstances.find((item) => item.id === schedule.processInstanceId);
    if (instance === undefined) return `<span class="status-pill is-inactive">关键行动已失效</span>`;

    const statusText = `关键行动${selectProcessInstanceBusinessStatus(instance.id, state).label}`;
    const progressText = getProcessProgressText(instance.id);

    return `
      <span class="content-flow-status">
        <span class="status-pill ${instance.status === ProcessInstanceStatus.Stopped ? "is-inactive" : ""}">${statusText}</span>
        ${progressText === "" ? "" : `<span class="muted-action">${progressText}</span>`}
      </span>
    `;
  }

  if (schedule.taskId !== null) {
    const task = state.tasks.find((item) => item.id === schedule.taskId);
    if (task !== undefined) return `<span class="status-pill">${taskStatusNames[task.status] ?? "已生成"}</span>`;
  }

  return `<span class="status-pill is-inactive">未发起</span>`;
}

function renderScheduleTable() {
  const schedules = getContentNoteItems();

  return `
    <section class="settings-section">
      <div class="section-heading with-actions">
        <div>
          <h2>发布内容笔记</h2>
          <p class="form-note">用于单条或批量发起真正的“发布内容笔记”关键行动。附件和产品图片请在单条发起时上传，首版批量导入不接收文件。</p>
        </div>
        <div class="section-actions">
          ${canLaunchContentNote() ? `<button class="primary-button" type="button" data-content-action="launch-content-note">发起发布内容笔记</button>` : ""}
          ${canLaunchContentNote() ? `
            <label class="secondary-button content-import-button">批量导入<input type="file" accept=".xlsx,.xls,.csv,.tsv" data-content-file="import" hidden /></label>
            <button class="text-button" type="button" data-content-action="download-template">下载导入模板</button>
          ` : ""}
          ${canCurrentUser("contentSchedules.export") ? `<button class="text-button" type="button" data-content-action="export-schedules">导出当前列表</button>` : ""}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table content-schedule-table">
          <thead>
            <tr>
              <th>发布时间</th>
              <th>发布账号</th>
              <th>笔记形式</th>
              <th>目的</th>
              <th>对应产品</th>
              <th>行动编码</th>
              <th>关键行动名称</th>
              <th>内容标题</th>
              <th>负责人</th>
              <th>当前步骤</th>
              <th>当前状态</th>
              <th>关联目标</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              schedules.length === 0
                ? `<tr><td colspan="13">暂无已发起的“发布内容笔记”关键行动，可使用单条发起或批量导入。</td></tr>`
                : schedules
                    .map(
                      (schedule, index) => `
                        <tr class="${schedule.id === selectedScheduleId ? "is-selected" : ""}" data-schedule-row-id="${schedule.id}">
                          <td>${schedule.publishTimeMode === PublishTimeMode.Deadline ? "跟随截止时间" : formatBusinessDateTime(schedule.publishDate, "-")}</td>
                          <td>${escapeHtml(schedule.account)}</td>
                          <td>${escapeHtml(normalizeContentType(schedule.contentType))}</td>
                          <td>${escapeHtml(normalizeContentPurpose(schedule.contentPurpose))}</td>
                          <td>${escapeHtml(schedule.product || "未填写")}</td>
                          <td>
                            <span class="content-action-code">
                              <button class="copyable-code" type="button" data-copy-content-code="${escapeAttribute(schedule.instance.businessCode ?? "")}" ${schedule.instance.businessCode ? "" : "disabled"}>${escapeHtml(schedule.instance.businessCode || "—")}</button>
                              <em data-content-code-feedback aria-live="polite"></em>
                            </span>
                          </td>
                          <td class="content-title-cell"><span>${escapeHtml(schedule.actionName)}</span></td>
                          <td class="content-title-cell"><span>${escapeHtml(schedule.title)}</span></td>
                          <td>${escapeHtml(findName(state.people, schedule.currentTask?.executorId ?? schedule.currentTask?.ownerId, "未设置"))}</td>
                          <td>${escapeHtml(schedule.currentTask?.name ?? "已完成")}</td>
                          <td><span class="status-pill ${schedule.status === "已超时" || schedule.status === "已取消" ? "is-inactive" : ""}">${escapeHtml(schedule.status)}</span></td>
                          <td>${escapeHtml(findName(goals, schedule.goalId, "未关联"))}</td>
                          <td>
                            <span class="row-actions">
                              ${renderContentActionButton("查看", "view-content-note", schedule.id)}
                              ${canEditLaunchedProcessInstance(schedule.instance, getCurrentUser()) ? renderContentActionButton("编辑", "edit-content-note", schedule.id) : ""}
                            </span>
                          </td>
                        </tr>
                      `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderContentNoteEditModal() {
  if (modalState?.kind !== "editContentNote") return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel extra-wide-modal content-note-edit-modal" role="dialog" aria-modal="true" aria-label="编辑发布内容笔记关键行动">
        <div class="modal-header">
          <h2>编辑发布内容笔记关键行动</h2>
          <button class="icon-button" type="button" data-content-action="close-content-modal" aria-label="关闭">×</button>
        </div>
        ${renderLaunchedProcessDetail(modalState.instanceId, {
          emptyHtml: `<section class="placeholder"><h2>未找到关键行动</h2></section>`,
        })}
      </div>
    </div>
  `;
}

function getLegacySchedules() {
  const linkedInstanceIds = new Set(state.processInstances.filter(isContentNoteInstance).map((item) => item.id));
  return state.contentSchedules
    .filter((schedule) => !schedule.processInstanceId || !linkedInstanceIds.has(schedule.processInstanceId))
    .filter(matchesFilters)
    .sort((left, right) => (left.publishDate ?? "").localeCompare(right.publishDate ?? ""));
}

function renderLegacyScheduleTable() {
  const schedules = getLegacySchedules();
  return `
    <section class="settings-section content-legacy-section">
      <div class="section-heading">
        <div>
          <h2>历史内容排期</h2>
          <p class="form-note">以下为旧内容排期数据，只读保留；新数据不再写入 content_schedules。</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table content-schedule-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>产品图</th>
              <th>发布日期</th>
              <th>发布账号</th>
              <th>内容类型</th>
              <th>目的</th>
              <th>受众人群</th>
              <th>对应产品</th>
              <th>标题</th>
              <th>历史状态</th>
            </tr>
          </thead>
          <tbody>
            ${
              schedules.length === 0
                ? `<tr><td colspan="10">暂无历史内容排期</td></tr>`
                : schedules
                    .map(
                      (schedule, index) => `
                        <tr data-schedule-row-id="${escapeAttribute(schedule.id)}">
                          <td>${index + 1}</td>
                          <td class="content-image-column">${renderImageCell(schedule)}</td>
                          <td>${formatBusinessDateTime(schedule.publishDate, "-")}</td>
                          <td>${escapeHtml(schedule.account)}</td>
                          <td>${escapeHtml(normalizeContentType(schedule.contentType))}</td>
                          <td>${escapeHtml(normalizeContentPurpose(schedule.contentPurpose))}</td>
                          <td>${escapeHtml(normalizeContentAudience(schedule.targetAudience))}</td>
                          <td>${escapeHtml(schedule.product || "未填写")}</td>
                          <td class="content-title-cell"><span>${escapeHtml(schedule.title)}</span></td>
                          <td><span class="status-pill is-inactive">${escapeHtml(getStatusName(schedule.status))}</span></td>
                        </tr>
                      `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDetailField(label, value) {
  return `<div class="detail-field"><span>${label}</span><strong>${value}</strong></div>`;
}

function formatChineseStep(index) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const value = index + 1;
  if (value <= 10) return `步骤${value === 10 ? "十" : digits[value]}`;
  if (value < 20) return `步骤十${digits[value % 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `步骤${digits[tens]}十${ones === 0 ? "" : digits[ones]}`;
}

function renderScheduleDetail() {
  const schedule = getContentNoteItems().find((item) => item.id === selectedScheduleId) ?? getContentNoteItems()[0] ?? null;

  if (schedule === null) {
    return `
      <section class="settings-section task-detail">
        <div class="section-heading"><h2>发布内容笔记详情</h2></div>
        <div class="empty-detail">暂无已发起发布内容笔记</div>
      </section>
    `;
  }

  return `
    <section class="settings-section task-detail">
      <div class="section-heading with-actions">
        <h2>发布内容笔记详情</h2>
        <div class="section-actions">
          ${renderContentActionButton("查看已发起关键行动", "view-content-note", schedule.id)}
        </div>
      </div>
      <div class="content-detail-layout">
        <div class="content-image-preview">
          ${
            schedule.productImage
              ? `<img src="${escapeAttribute(resolveAssetUrl(schedule.productImage))}" alt="1:1 产品主图预览" />`
              : `<span>暂无图片</span>`
          }
        </div>
        <div class="detail-grid">
          ${renderDetailField("标题", escapeHtml(schedule.title))}
          ${renderDetailField("发布时间", schedule.publishTimeMode === PublishTimeMode.Deadline ? "跟随截止时间" : formatBusinessDateTime(schedule.publishDate, "未填写"))}
          ${renderDetailField("发布账号", escapeHtml(schedule.account))}
          ${renderDetailField("内容类型", escapeHtml(normalizeContentType(schedule.contentType)))}
          ${renderDetailField("内容目的", escapeHtml(normalizeContentPurpose(schedule.contentPurpose)))}
          ${renderDetailField("受众人群", escapeHtml(normalizeContentAudience(schedule.targetAudience)))}
          ${renderDetailField("对应产品", escapeHtml(schedule.product || "未填写"))}
          ${renderDetailField("当前状态", escapeHtml(schedule.status))}
          ${renderDetailField("关联目标", findName(goals, schedule.goalId, "未关联"))}
          ${renderDetailField("当前任务", escapeHtml(schedule.currentTask?.name ?? "暂无当前任务"))}
        </div>
      </div>
      <div class="detail-block">
        <h3>公共内容信息</h3>
        <p>文案：${escapeHtml(schedule.copywriting || "未填写")}</p>
        <p>参考场景：${escapeHtml(schedule.scene || "未填写")}</p>
        <p>话题：${escapeHtml(schedule.hashtags || "未填写")}</p>
      </div>
      <div class="detail-block">
        <h3>行动进度</h3>
        <div class="content-progress-list">
          ${schedule.tasks.length === 0
            ? `<p class="empty-detail">暂无任务</p>`
            : schedule.tasks
                .map(
                  (task, index) => `
                    <div class="content-progress-item ${task.id === schedule.currentTask?.id ? "is-current" : ""}">
                      <span>${formatChineseStep(index)}</span>
                      <strong>${escapeHtml(task.name)}</strong>
                      <em>${escapeHtml(taskStatusNames[task.status] ?? task.status)}</em>
                    </div>
                  `,
                )
                .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderScheduleTags(schedule) {
  const tags = [
    normalizeContentType(schedule.contentType),
    normalizeContentPurpose(schedule.contentPurpose),
    normalizeContentAudience(schedule.targetAudience),
    schedule.account,
    getStatusName(schedule.status),
  ].filter(Boolean);
  return `
    <div class="content-schedule-tags">
      ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
    </div>
  `;
}

function renderViewScheduleTemplate(schedule) {
  const template = getSelectedContentTemplate(schedule.templateId ?? "");
  const previewImage = getTemplatePreviewImage(template);
  if (template === null) {
    return `<div class="content-template-summary is-empty"><span>未关联</span></div>`;
  }
  return `
    <div class="content-template-summary is-detail">
      <button class="content-template-thumb" type="button" data-content-action="preview-linked-template" data-template-id="${escapeAttribute(template.id)}">
        ${
          previewImage.fileUrl
            ? `<img src="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeAttribute(getTemplateName(template))}" />`
            : `<span>无预览</span>`
        }
      </button>
      <div class="content-template-meta">
        <strong>${escapeHtml(getTemplateName(template))}</strong>
        ${getTemplateAssetLinks(template)}
      </div>
    </div>
  `;
}

function renderLinkedTemplatePreviewModal() {
  const previewTemplate = getSelectedContentTemplate(modalState?.templatePreviewId ?? "");
  if (previewTemplate === null) return "";
  const previewImage = getTemplatePreviewImage(previewTemplate);
  return `
    <div class="modal-backdrop content-template-preview-backdrop" role="presentation">
      <div class="modal-panel content-template-preview-modal" role="dialog" aria-modal="true" aria-label="预览模板">
        <div class="modal-header">
          <h2>${escapeHtml(getTemplateName(previewTemplate))}</h2>
          <button class="icon-button" type="button" data-content-action="close-linked-template-preview" aria-label="关闭">×</button>
        </div>
        <div class="content-template-preview-body">
          ${previewImage.fileUrl ? `<img src="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeAttribute(getTemplateName(previewTemplate))}" />` : `<span>无预览</span>`}
        </div>
      </div>
    </div>
  `;
}

function renderScheduleViewModal() {
  if (modalState === null || modalState.kind !== "viewSchedule") return "";
  const schedule = getSchedule(modalState.scheduleId);
  if (schedule === null) return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="排期详情">
        <div class="modal-header">
          <h2>排期详情</h2>
          <div class="modal-header-actions">
            ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.edit") ? `<button class="secondary-button" type="button" data-content-action="edit-schedule-from-view" data-schedule-id="${escapeAttribute(schedule.id)}">编辑</button>` : ""}
            <button class="icon-button" type="button" data-content-action="close-content-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <div class="modal-form content-schedule-view-modal">
          <div class="content-schedule-view-hero">
            <div class="content-image-preview">
              ${
                schedule.productImage
                  ? `<img src="${escapeAttribute(resolveAssetUrl(schedule.productImage))}" alt="1:1 产品主图预览" />`
                  : `<span>暂无图片</span>`
              }
            </div>
            <div class="content-schedule-view-title">
              <h3>${escapeHtml(schedule.title || "未填写标题")}</h3>
              ${renderScheduleTags(schedule)}
            </div>
          </div>
          <div class="detail-grid">
            ${renderDetailField("发布日期", formatBusinessDateTime(schedule.publishDate, "未填写"))}
            ${renderDetailField("发布账号", escapeHtml(schedule.account || "未填写"))}
            ${renderDetailField("内容类型", escapeHtml(normalizeContentType(schedule.contentType) || "未填写"))}
            ${renderDetailField("内容目的", escapeHtml(normalizeContentPurpose(schedule.contentPurpose) || "未填写"))}
            ${renderDetailField("受众人群", escapeHtml(normalizeContentAudience(schedule.targetAudience) || "未填写"))}
            ${renderDetailField("对应产品", escapeHtml(schedule.product || "未填写"))}
            ${renderDetailField("状态", getStatusName(schedule.status))}
            ${renderDetailField("关联目标", findName(goals, schedule.goalId, "未关联"))}
          </div>
          <div class="detail-block">
            <h3>内容</h3>
            <p>文案：${escapeHtml(schedule.copywriting || "未填写")}</p>
            <p>参考场景：${escapeHtml(schedule.scene || "未填写")}</p>
            <p>话题：${escapeHtml(schedule.hashtags || "未填写")}</p>
          </div>
          <div class="detail-block">
            <h3>关联模板</h3>
            ${renderViewScheduleTemplate(schedule)}
          </div>
        </div>
      </div>
      ${renderLinkedTemplatePreviewModal()}
    </div>
  `;
}

function renderImageField(image) {
  return `
    <div class="content-image-field">
      <span>1:1 产品主图</span>
      <div class="content-image-control">
        <div class="content-image-box">
          ${image ? `<img src="${escapeAttribute(resolveAssetUrl(image))}" alt="1:1 产品主图预览" />` : `<span>暂无图片</span>`}
        </div>
        <div class="row-actions">
          <label class="secondary-button file-button">
            ${image ? "更换图片" : "上传1:1产品图"}
            <input type="file" data-content-file="image" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
          </label>
          ${image ? `<button class="text-button danger-button" type="button" data-content-action="remove-image">删除图片</button>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderLinkedTemplateSummary(templateId, mode = "form") {
  const template = getSelectedContentTemplate(templateId);
  const previewImage = getTemplatePreviewImage(template);
  if (template === null) {
    return `<div class="content-template-summary is-empty"><span>未关联</span></div>`;
  }
  return `
    <div class="content-template-summary ${mode === "detail" ? "is-detail" : ""}">
      <div class="content-template-thumb">
        ${
          previewImage.fileUrl
            ? `<img src="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeAttribute(getTemplateName(template))}" />`
            : `<span>无预览</span>`
        }
      </div>
      <div class="content-template-meta">
        <strong>${escapeHtml(getTemplateName(template))}</strong>
      </div>
    </div>
  `;
}

function renderTemplateLinkField(templateId) {
  return `
    <div class="content-template-field">
      <span>关联模板</span>
      <div class="content-template-control">
        ${renderLinkedTemplateSummary(templateId)}
        <div class="row-actions">
          <button class="secondary-button" type="button" data-content-action="open-template-picker">关联模板</button>
          ${templateId ? `<button class="text-button danger-button" type="button" data-content-action="clear-linked-template">取消关联</button>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderContentTemplatePicker() {
  if (modalState?.templatePickerOpen !== true) return "";
  const selectedTags = normalizeTemplateTags(modalState.templateTagFilters ?? {});
  const groupedTags = getTemplateFilterTags();
  const visibleTemplates = getFilteredContentTemplates();
  const previewTemplate = getSelectedContentTemplate(modalState.templatePreviewId ?? "");

  return `
    <div class="modal-backdrop content-template-picker-backdrop" role="presentation">
      <div class="modal-panel extra-wide-modal" role="dialog" aria-modal="true" aria-label="选择模板">
        <div class="modal-header">
          <h2>选择模板</h2>
          <button class="icon-button" type="button" data-content-action="close-template-picker" aria-label="关闭">×</button>
        </div>
        <div class="content-template-picker">
          <div class="content-template-picker-toolbar">
            <input data-template-picker-search value="${escapeAttribute(modalState.templateQuery ?? "")}" autocomplete="off" />
          </div>
          <div class="content-template-picker-layout">
            <aside class="content-template-picker-filters">
              ${templateTagCategories.map((category) => `
                <div class="content-template-filter-group">
                  <h3>${escapeHtml(category.label)}</h3>
                  <div class="template-tag-cloud">
                    ${(groupedTags[category.id] ?? []).map((tag) => {
                      const active = (selectedTags[category.id] ?? []).includes(tag);
                      return `<button class="${active ? "is-active" : ""}" type="button" data-template-picker-tag="${escapeAttribute(tag)}" data-template-picker-category="${category.id}">${escapeHtml(tag)}</button>`;
                    }).join("")}
                  </div>
                </div>
              `).join("")}
            </aside>
            <div class="content-template-picker-main">
              ${contentTemplatesLoading ? `<div class="empty-detail">模板加载中</div>` : ""}
              ${
                !contentTemplatesLoading && visibleTemplates.length === 0
                  ? `<div class="empty-detail">暂无模板</div>`
                  : `<div class="content-template-picker-grid">
                      ${visibleTemplates.map((template) => {
                        const previewImage = getTemplatePreviewImage(template);
                        return `
                          <article class="content-template-option ${modalState.templateId === template.id ? "is-selected" : ""}">
                            <button class="content-template-option-thumb" type="button" data-content-action="preview-template-option" data-template-id="${escapeAttribute(template.id)}">
                              ${previewImage.fileUrl ? `<img src="${escapeAttribute(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeAttribute(getTemplateName(template))}" />` : `<span>无预览</span>`}
                            </button>
                            <h3>${escapeHtml(getTemplateName(template))}</h3>
                            <button class="primary-button" type="button" data-content-action="select-template-option" data-template-id="${escapeAttribute(template.id)}">选择</button>
                          </article>
                        `;
                      }).join("")}
                    </div>`
              }
            </div>
          </div>
        </div>
      </div>
      ${
        previewTemplate === null
          ? ""
          : `<div class="modal-panel content-template-preview-modal" role="dialog" aria-modal="true" aria-label="预览模板">
              <div class="modal-header">
                <h2>${escapeHtml(getTemplateName(previewTemplate))}</h2>
                <button class="icon-button" type="button" data-content-action="close-template-preview" aria-label="关闭">×</button>
              </div>
              <div class="content-template-preview-body">
                ${getTemplatePreviewImage(previewTemplate).fileUrl ? `<img src="${escapeAttribute(resolveAssetUrl(getTemplatePreviewImage(previewTemplate).fileUrl))}" alt="${escapeAttribute(getTemplateName(previewTemplate))}" />` : `<span>无预览</span>`}
              </div>
            </div>`
      }
    </div>
  `;
}

function getScheduleModalDraftValue(schedule, key, fallback = "") {
  return modalState?.draft?.[key] ?? schedule?.[key] ?? fallback;
}

function renderScheduleModal() {
  if (modalState === null || modalState.kind !== "schedule") return "";

  const schedule = modalState.mode === "edit" ? getSchedule(modalState.scheduleId) : null;
  const image = modalState.productImage ?? schedule?.productImage ?? "";
  const linkedTemplateId = modalState.templateId ?? getScheduleModalDraftValue(schedule, "templateId", "");
  const publishDateValue = getScheduleModalDraftValue(schedule, "publishDate");

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${modalState.mode === "edit" ? "编辑排期" : "新增排期"}">
        <div class="modal-header">
          <h2>${modalState.mode === "edit" ? "编辑排期" : "新增排期"}</h2>
          <div class="modal-header-actions">
            <button class="secondary-button" type="button" data-content-action="close-content-modal">取消</button>
            <button class="primary-button" type="button" data-action="submit-modal-form">保存</button>
            <button class="icon-button" type="button" data-content-action="close-content-modal" aria-label="关闭">×</button>
          </div>
        </div>
        <form class="modal-form content-schedule-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <div class="form-grid">
            <label>
              <span>发布日期</span>
              <input name="publishDateDate" type="date" value="${escapeAttribute(getBusinessDatePart(publishDateValue))}" />
            </label>
            <label>
              <span>发布时间</span>
              <select name="publishDateHour">${renderBusinessHourOptions(getBusinessHourPart(publishDateValue), "请选择小时")}</select>
            </label>
            <label><span>发布账号</span><select name="account">${renderStringOptions(getActivePublishingAccountNames(getScheduleModalDraftValue(schedule, "account")), getScheduleModalDraftValue(schedule, "account"), "请选择账号")}</select></label>
            <label><span>内容类型</span><select name="contentType">${renderStringOptions(contentScheduleTypeOptions, normalizeContentType(getScheduleModalDraftValue(schedule, "contentType")), "请选择类型")}</select></label>
            <label><span>内容目的</span><select name="contentPurpose">${renderStringOptions(contentSchedulePurposeOptions, normalizeContentPurpose(getScheduleModalDraftValue(schedule, "contentPurpose")), "请选择目的")}</select></label>
            <label><span>受众人群</span><select name="targetAudience">${renderStringOptions(contentScheduleAudienceOptions, normalizeContentAudience(getScheduleModalDraftValue(schedule, "targetAudience")), "请选择人群")}</select></label>
            <label><span>状态</span><select name="status">${renderStatusOptions(normalizeContentScheduleStatus(getScheduleModalDraftValue(schedule, "status")) || ContentScheduleStatus.PendingSubmit, "请选择状态")}</select></label>
            <label><span>关联目标</span><select name="goalId">${renderEntityOptions(getSelectableGoals(getScheduleModalDraftValue(schedule, "goalId")), getScheduleModalDraftValue(schedule, "goalId"), "请选择目标")}</select></label>
            <label><span>对应产品</span><input name="product" value="${escapeAttribute(getScheduleModalDraftValue(schedule, "product"))}" autocomplete="off" /></label>
          </div>
          ${renderImageField(image)}
          ${renderTemplateLinkField(linkedTemplateId)}
          <label><span>标题</span><input name="title" value="${escapeAttribute(getScheduleModalDraftValue(schedule, "title"))}" autocomplete="off" /></label>
          <label><span>文案</span><textarea name="copywriting" rows="4">${escapeHtml(getScheduleModalDraftValue(schedule, "copywriting"))}</textarea></label>
          <div class="form-grid">
            <label><span>参考场景</span><input name="scene" value="${escapeAttribute(getScheduleModalDraftValue(schedule, "scene"))}" autocomplete="off" /></label>
            <label><span>#话题</span><input name="hashtags" value="${escapeAttribute(getScheduleModalDraftValue(schedule, "hashtags"))}" autocomplete="off" /></label>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-content-action="close-content-modal">取消</button>
            <button class="primary-button" type="submit">保存</button>
          </div>
        </form>
      </div>
      ${renderContentTemplatePicker()}
    </div>
  `;
}

function renderImportModal() {
  if (modalState === null || modalState.kind !== "import") return "";
  const results = modalState.result ?? [];
  const successCount = results.filter((item) => item.status === "success").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  const skippedCount = results.filter((item) => item.status === "skipped" || item.status === "skipped_duplicate").length;
  const resultDuplicateCount = results.filter((item) => item.status === "skipped_duplicate").length;
  const resultByRow = new Map(results.map((item) => [item.rowNumber, item]));
  const previewAvailableCount = modalState.rows.filter((row) => row.errors.length === 0 && row.duplicateType !== "database").length;
  const previewErrorCount = modalState.rows.filter((row) => row.errors.length > 0 && row.duplicateType !== "file").length;
  const previewDuplicateCount = modalState.rows.filter((row) => row.duplicateType !== "").length;
  const previewSelectedCount = modalState.rows.filter((row) => row.selected || row.forceDuplicate).length;

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel extra-wide-modal" role="dialog" aria-modal="true" aria-label="发布内容笔记批量导入预览">
        <div class="modal-header">
          <h2>发布内容笔记批量导入预览</h2>
          <button class="icon-button" type="button" data-content-action="close-content-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <p class="form-note">${escapeHtml(modalState.fileName)}，共 ${modalState.rows.length} 行。附件和产品图片不会通过本次 Excel 导入创建。</p>
          <label class="content-note-batch-goal">
            <span>本批次对齐目标</span>
            <select data-content-note-batch-goal>
              <option value="">请选择；仅用于行内目标为空的数据</option>
              ${getActiveGoals().map((goal) => `<option value="${escapeAttribute(goal.id)}" ${modalState.batchGoalId === goal.id ? "selected" : ""}>${escapeHtml(goal.businessCode ? `${goal.businessCode}｜${goal.name}` : goal.name)}</option>`).join("")}
            </select>
          </label>
          <div class="import-preview-summary">
            <span>总行数：${modalState.rows.length}</span>
            <span>可发起：${previewAvailableCount}</span>
            <span>错误：${previewErrorCount}</span>
            <span>重复：${previewDuplicateCount}</span>
            <strong>已选择：${previewSelectedCount}</strong>
          </div>
          ${results.length ? `<div class="import-result-summary"><strong>批量结果</strong><span>成功：${successCount} 条</span><span>失败：${failedCount} 条</span><span>跳过：${skippedCount} 条</span><span>重复：${resultDuplicateCount} 条</span></div>` : ""}
          <div class="table-wrap">
            <table class="data-table compact-import-table">
              <thead><tr><th>选择</th><th>行号</th><th>对齐目标</th><th>产品编码</th><th>产品名称</th><th>模板编码</th><th>模板名称</th><th>关键行动名称</th><th>发布日期</th><th>发布账号</th><th>内容标题</th><th>校验状态</th><th>错误说明</th></tr></thead>
              <tbody>
                ${modalState.rows
                  .map((row) => {
                    const result = resultByRow.get(row.rowNumber);
                    const resultText =
                      result?.status === "success"
                        ? `已创建 ${result.businessCode ?? result.processInstanceId}，任务 ${result.taskCount} 条`
                        : result?.status === "skipped_duplicate"
                          ? `已跳过：${result.message}`
                          : result?.status === "failed"
                            ? `失败：${result.message}`
                            : "";
                    return `
                      <tr>
                        <td>
                          <input type="checkbox" data-import-row-select="${row.rowNumber}" ${row.selected ? "checked" : ""} ${row.errors.length ? "disabled" : ""} />
                        </td>
                        <td>${row.rowNumber}</td>
                        <td>${escapeHtml(row.goal?.name ?? row.data.对齐目标 ?? "—")}</td>
                        <td>${escapeHtml(row.productCodes.join("、") || "—")}</td>
                        <td>
                          ${
                            row.products.length === 0
                              ? "—"
                              : `<div class="content-note-import-products">
                                  ${row.products.slice(0, 3).map((product) => `<span>${escapeHtml(product.name)}（${escapeHtml(product.skuCode)}）</span>`).join("")}
                                  ${row.products.length > 3 ? `<details><summary>另有${row.products.length - 3}个</summary>${row.products.slice(3).map((product) => `<span>${escapeHtml(product.name)}（${escapeHtml(product.skuCode)}）</span>`).join("")}</details>` : ""}
                                  <small>共 ${row.products.length} 个产品</small>
                                </div>`
                          }
                        </td>
                        <td>${escapeHtml(row.data.模板编码 || "—")}</td>
                        <td>${escapeHtml(row.linkedTemplate?.name ?? "—")}</td>
                        <td>${escapeHtml(row.actionName)}</td>
                        <td>${escapeHtml([row.data.发布日期, row.data.发布时间].filter(Boolean).join(" "))}</td>
                        <td>${escapeHtml(getBatchFieldValue(row.customFields, findBatchField(["account"], ["发布账号"])) || "—")}</td>
                        <td>${escapeHtml(getBatchFieldValue(row.customFields, findBatchField(["title", "contentTitle"], ["标题", "内容标题"])) || "—")}</td>
                        <td>${result?.status === "success" ? "已创建" : result?.status === "failed" ? "失败" : row.duplicateType === "database" ? "可能重复" : row.duplicateType === "file" ? "文件内重复" : row.errors.length ? "错误" : "可发起"}</td>
                        <td>${resultText ? escapeHtml(resultText) : row.errors.length ? `<span class="form-error-inline">${escapeHtml(row.errors.join("；"))}</span>` : row.warnings.length ? `<span class="warning-text">${escapeHtml(row.warnings.join("；"))}</span>` : "—"}</td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-content-action="close-content-modal">取消</button>
            ${results.length ? `
              ${(failedCount + skippedCount) > 0 ? `<button class="secondary-button" type="button" data-content-action="download-import-results">下载失败明细</button>` : ""}
              <button class="primary-button" type="button" data-content-action="close-content-modal">完成</button>
            ` : `<button class="primary-button" type="button" data-content-action="confirm-import" ${previewSelectedCount === 0 ? "disabled" : ""}>批量发起</button>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderContentNoteBatchTools() {
  if (!canLaunchContentNote()) return "";
  return `
    <div class="section-actions content-note-batch-tools">
      <button class="primary-button" type="button" data-content-note-batch-action="launch">发起发布内容笔记</button>
      <label class="secondary-button content-import-button">批量导入<input type="file" accept=".xlsx,.xls,.csv,.tsv" data-content-note-batch-file hidden /></label>
      <button class="text-button" type="button" data-content-note-batch-action="download-template">下载导入模板</button>
    </div>
  `;
}

export function renderContentNoteBatchModal() {
  return renderImportModal();
}

export function bindContentNoteBatchEvents(root, rerender) {
  if (root === null) return;
  root.querySelector("[data-content-note-batch-file]")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) void handleImportFile(file, rerender);
  });
  root.querySelectorAll("[data-content-note-batch-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.contentNoteBatchAction;
      if (action === "launch") {
        const template = getContentNoteTemplate();
        if (template === null || !canLaunchContentNote()) return;
        window.sessionStorage.setItem("goalTaskPrefill", JSON.stringify({
          taskTemplateId: template.id,
          categoryId: template.categoryId ?? "",
          launchImmediately: true,
          title: "发起发布内容笔记",
        }));
        window.location.hash = "goals";
      } else if (action === "download-template") {
        downloadTemplate();
      }
    });
  });
  root.querySelectorAll("[data-content-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.contentAction;
      if (action === "close-content-modal") {
        modalState = null;
        rerender();
      } else if (action === "confirm-import") {
        await confirmImport(rerender);
      } else if (action === "download-import-results") {
        downloadImportFailureDetails();
      }
    });
  });
  root.querySelectorAll("[data-import-row-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const rowNumber = Number(checkbox.dataset.importRowSelect);
      modalState = {
        ...modalState,
        rows: modalState.rows.map((row) =>
          row.rowNumber === rowNumber
            ? {
                ...row,
                selected: checkbox.checked,
                forceDuplicate: row.duplicateType === "database" ? checkbox.checked : false,
              }
            : row,
        ),
      };
      rerender();
    });
  });
  root.querySelector("[data-content-note-batch-goal]")?.addEventListener("change", (event) => {
    const batchGoalId = event.target.value;
    modalState = {
      ...modalState,
      batchGoalId,
      rows: buildImportPreviewRows(modalState.records ?? [], batchGoalId),
      result: null,
      error: "",
    };
    rerender();
  });
}

function updateFilters(form) {
  const formData = new FormData(form);
  filters = {
    dateFrom: formData.get("dateFrom")?.toString() ?? "",
    dateTo: formData.get("dateTo")?.toString() ?? "",
    account: formData.get("account")?.toString() ?? "",
    contentType: formData.get("contentType")?.toString() ?? "",
    contentPurpose: formData.get("contentPurpose")?.toString() ?? "",
    targetAudience: formData.get("targetAudience")?.toString() ?? "",
    status: formData.get("status")?.toString() ?? "",
    productKeyword: formData.get("productKeyword")?.toString().trim() ?? "",
    titleKeyword: formData.get("titleKeyword")?.toString().trim() ?? "",
    goalId: formData.get("goalId")?.toString() ?? "",
  };
}

function buildScheduleDraft(form) {
  const publishDateResult = collectBusinessDateTime(form, "publishDate", "发布日期");
  return {
    publishDate: publishDateResult.value ?? "",
    publishDateError: publishDateResult.error,
    account: getFormValue(form, "account"),
    contentType: normalizeContentType(getFormValue(form, "contentType")),
    contentPurpose: normalizeContentPurpose(getFormValue(form, "contentPurpose")),
    targetAudience: normalizeContentAudience(getFormValue(form, "targetAudience")),
    product: getFormValue(form, "product"),
    productImage: modalState?.productImage ?? "",
    title: getFormValue(form, "title"),
    copywriting: getFormValue(form, "copywriting"),
    scene: getFormValue(form, "scene"),
    hashtags: getFormValue(form, "hashtags"),
    status: normalizeContentScheduleStatus(getFormValue(form, "status")),
    goalId: getFormValue(form, "goalId"),
    templateId: modalState?.templateId ?? "",
  };
}

function validateScheduleDraft(draft) {
  if (draft.publishDateError !== "") return draft.publishDateError;
  if (draft.publishDate !== "" && normalizeImportDate(draft.publishDate) === null) return "发布日期必须是合法日期。";
  if (draft.contentType !== "" && !contentScheduleTypeOptions.includes(draft.contentType)) return "内容类型不在固定选项中。";
  if (draft.contentPurpose !== "" && !contentSchedulePurposeOptions.includes(draft.contentPurpose)) return "内容目的不在固定选项中。";
  if (draft.targetAudience !== "" && !contentScheduleAudienceOptions.includes(draft.targetAudience)) return "受众人群不在固定选项中。";
  if (draft.status !== "" && contentScheduleStatusNames[draft.status] === undefined) return "状态不在固定选项中。";
  return "";
}

function setModalError(error) {
  modalState = { ...modalState, error };
  const errorElement = document.querySelector(".modal-form .form-error");
  if (errorElement !== null) {
    errorElement.textContent = error;
    errorElement.hidden = error === "";
  }
}

async function saveSchedule(form, rerender) {
  setModalError(legacyScheduleWriteDisabledMessage);
  rerender();
  return;
  const editingSchedule = modalState.mode === "edit" ? getSchedule(modalState.scheduleId) : null;
  const draft = buildScheduleDraft(form);
  const error = validateScheduleDraft(draft);
  if (error !== "") return setModalError(error, rerender);

  const now = getNow();
  const { publishDateError: _publishDateError, ...cleanDraft } = draft;
  const normalizedDraft = { ...cleanDraft, publishDate: normalizeImportDate(cleanDraft.publishDate) };
  if (modalState.mode === "add") {
    const newSchedule = {
      id: createId("content-schedule"),
      ...normalizedDraft,
      taskId: null,
      processInstanceId: null,
      workPlanId: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await createPersistentResource("content-schedules", newSchedule);
    } catch (error) {
      console.error("内容排期保存失败", error);
      return setModalError(error.message || "内容排期保存失败，请检查本地数据库服务。", rerender);
    }
    state.contentSchedules = [newSchedule, ...state.contentSchedules];
    selectedScheduleId = newSchedule.id;
  } else {
    const updatedSchedule = { ...editingSchedule, ...normalizedDraft, updatedAt: now };
    try {
      await updatePersistentResource("content-schedules", updatedSchedule.id, updatedSchedule);
    } catch (error) {
      console.error("内容排期保存失败", error);
      return setModalError(error.message || "内容排期保存失败，请检查本地数据库服务。", rerender);
    }
    state.contentSchedules = state.contentSchedules.map((schedule) =>
      schedule.id === updatedSchedule.id ? updatedSchedule : schedule,
    );
  }

  modalState = null;
  rerender();
}

function readCurrentScheduleModalDraft() {
  const form = document.querySelector(".content-schedule-form");
  return form === null ? modalState?.draft ?? {} : buildScheduleDraft(form);
}

async function ensureTemplateOptionsLoaded(rerender) {
  if (contentTemplatesLoaded || contentTemplatesLoading) return;
  contentTemplatesLoading = true;
  try {
    await loadTemplates();
    contentTemplatesLoaded = true;
  } catch (error) {
    console.error("模板列表读取失败", error);
    modalState = { ...modalState, error: error.message || "模板列表读取失败，请检查本地数据库服务。" };
  } finally {
    contentTemplatesLoading = false;
    rerender();
  }
}

async function cancelSchedule(scheduleId, rerender) {
  window.alert(legacyScheduleWriteDisabledMessage);
  return;
  if (!window.confirm("确定要取消该内容排期吗？取消后历史记录仍会保留。")) return;
  const schedule = getSchedule(scheduleId);
  if (schedule === null) return;
  const now = getNow();
  const updatedSchedule = { ...schedule, status: ContentScheduleStatus.Canceled, updatedAt: now };
  try {
    await updatePersistentResource("content-schedules", scheduleId, updatedSchedule);
  } catch (error) {
    console.error("内容排期取消失败", error);
    window.alert(error.message || "内容排期保存失败，请检查本地数据库服务。");
    return;
  }
  state.contentSchedules = state.contentSchedules.map((item) => (item.id === scheduleId ? updatedSchedule : item));
  rerender();
}

async function bulkUpdateScheduleStatus(status, rerender) {
  window.alert(legacyScheduleWriteDisabledMessage);
  return;
  if (selectedScheduleIds.size === 0) return;
  if (status === ContentScheduleStatus.Canceled && !window.confirm("确定要取消选中的内容排期吗？")) return;

  const now = getNow();
  const updatedSchedules = state.contentSchedules
    .filter((schedule) => selectedScheduleIds.has(schedule.id))
    .map((schedule) => ({ ...schedule, status, updatedAt: now }));
  try {
    for (const schedule of updatedSchedules) {
      await updatePersistentResource("content-schedules", schedule.id, schedule);
    }
  } catch (error) {
    console.error("批量更新内容排期失败", error);
    window.alert(error.message || "内容排期保存失败，请检查本地数据库服务。");
    return;
  }
  const updatedMap = new Map(updatedSchedules.map((schedule) => [schedule.id, schedule]));
  state.contentSchedules = state.contentSchedules.map((schedule) => updatedMap.get(schedule.id) ?? schedule);
  selectedScheduleIds = new Set();
  rerender();
}

function isScheduleAlreadyInWorkPlan(schedule) {
  if (schedule.workPlanId) return true;
  return state.workPlans.some((workPlan) => workPlan.customFields?.contentScheduleId === schedule.id);
}

function getBulkFallbackGoalId(schedules) {
  if (schedules.every((schedule) => schedule.goalId)) return null;
  if (goals.length === 0) {
    window.alert("没有可选择的对齐目标，请先新增目标。");
    return undefined;
  }
  const optionsText = goals.map((goal, index) => `${index + 1}. ${goal.name}`).join("\n");
  const answer = window.prompt(`部分内容排期没有关联目标，请选择一个统一对齐目标编号：\n${optionsText}`, "1");
  if (answer === null) return undefined;
  const selectedIndex = Number.parseInt(answer, 10) - 1;
  const selectedGoal = goals[selectedIndex];
  if (selectedGoal === undefined) {
    window.alert("目标编号无效，已取消批量操作。");
    return undefined;
  }
  return selectedGoal.id;
}

function buildWorkPlanFromSchedule(schedule, status, fallbackGoalId, now) {
  if (isScheduleAlreadyInWorkPlan(schedule)) return { skipped: "duplicated" };
  const template = getContentTaskTemplate(schedule);
  if (template === null && normalizeContentType(schedule.contentType) === "电商视觉") {
    return { error: "电商视觉需要手动选择关键行动。" };
  }
  if (template === null) return { error: "未找到对应关键行动，请先到关键行动库配置。" };
  const goalId = schedule.goalId || fallbackGoalId;
  if (!goalId) return { error: "内容排期缺少对齐目标。" };
  const normalizedContentType = normalizeContentType(schedule.contentType);
  const customFields =
    template.name === "发布买家秀"
      ? {
          contentScheduleId: schedule.id,
          coverImageUrl: schedule.productImage,
          productName: schedule.product || schedule.title,
          publishDate: schedule.publishDate,
          account: schedule.account,
          title: schedule.title,
          contentText: schedule.copywriting,
          buyerShowType: "场景图",
          imageCount: "",
          imageRequirement: schedule.copywriting || schedule.scene || "",
          sceneRequirement: schedule.scene,
          needPublish: "是",
          publishPlatform: "小红书",
          dueDate: schedule.publishDate,
          remark: schedule.hashtags,
        }
      : {
          contentScheduleId: schedule.id,
          coverImageUrl: schedule.productImage,
          publishDate: schedule.publishDate,
          account: schedule.account,
          contentType: ["图文笔记", "视频笔记"].includes(normalizedContentType) ? normalizedContentType : "图文笔记",
          purpose: normalizeContentPurpose(schedule.contentPurpose),
          audience: normalizeContentAudience(schedule.targetAudience),
          title: schedule.title,
          contentText: schedule.copywriting,
        };
  const displayTitle = buildDisplayTitle(template, customFields);
  const workPlanId = createId("work-plan");
  return {
    workPlan: {
      id: workPlanId,
      goalId,
      departmentId: schedule.departmentId ?? template.departmentId ?? getOperationDepartmentId(),
      taskTemplateId: template.id,
      title: displayTitle,
      customFields,
      coverImageUrl: customFields.coverImageUrl || null,
      status,
      plannedWeek: status === WorkPlanStatus.ThisWeek ? getCurrentWeek() : null,
      dueDate: schedule.publishDate || null,
      description: `由内容排期创建：${formatBusinessDateTime(schedule.publishDate, "")} ${schedule.account} ${schedule.title}`,
      processInstanceId: null,
      createdAt: now,
      updatedAt: now,
      launchedAt: null,
      canceledAt: null,
    },
    scheduleId: schedule.id,
    workPlanId,
  };
}

async function createWorkPlanFromSchedule(scheduleId, status, rerender) {
  window.alert(legacyScheduleWriteDisabledMessage);
  return;
  const schedule = getSchedule(scheduleId);
  if (schedule === null) return;
  const now = getNow();
  const result = buildWorkPlanFromSchedule(schedule, status, null, now);
  if (result.error !== undefined) return window.alert(result.error);
  if (result.skipped === "duplicated") return window.alert("该内容已加入关键行动计划，已跳过重复创建。");
  const updatedSchedule = { ...schedule, workPlanId: result.workPlanId, updatedAt: now };
  try {
    await createPersistentResource("work-plans", result.workPlan);
    await updatePersistentResource("content-schedules", updatedSchedule.id, updatedSchedule);
  } catch (error) {
    console.error("内容排期加入工作失败", error);
    window.alert(error.message || "加入工作失败，请检查本地数据库服务。");
    return;
  }
  state.workPlans = [result.workPlan, ...state.workPlans];
  state.contentSchedules = state.contentSchedules.map((item) => (item.id === result.scheduleId ? updatedSchedule : item));
  window.alert(status === WorkPlanStatus.ThisWeek ? "已转为待发起工作计划，请到关键行动入口发起。" : "已转为待发起工作计划。");
  rerender();
}

async function bulkCreateWorkPlansFromSchedules(status, rerender) {
  window.alert(legacyScheduleWriteDisabledMessage);
  return;
  const schedules = [...selectedScheduleIds].map(getSchedule).filter(Boolean);
  if (schedules.length === 0) return;
  const fallbackGoalId = getBulkFallbackGoalId(schedules);
  if (fallbackGoalId === undefined) return;

  const now = getNow();
  const createdWorkPlans = [];
  const scheduleWorkPlanMap = new Map();
  let duplicatedCount = 0;
  let errorCount = 0;
  let manualSelectCount = 0;

  schedules.forEach((schedule) => {
    const result = buildWorkPlanFromSchedule(schedule, status, fallbackGoalId, now);
    if (result.skipped === "duplicated") {
      duplicatedCount += 1;
      return;
    }
    if (result.error !== undefined) {
      if (result.error.includes("电商视觉")) manualSelectCount += 1;
      errorCount += 1;
      return;
    }
    createdWorkPlans.push(result.workPlan);
    scheduleWorkPlanMap.set(result.scheduleId, result.workPlanId);
  });

  if (createdWorkPlans.length > 0) {
    const updatedSchedules = state.contentSchedules
      .filter((item) => scheduleWorkPlanMap.has(item.id))
      .map((item) => ({ ...item, workPlanId: scheduleWorkPlanMap.get(item.id), updatedAt: now }));
    try {
      for (const workPlan of createdWorkPlans) {
        await createPersistentResource("work-plans", workPlan);
      }
      for (const schedule of updatedSchedules) {
        await updatePersistentResource("content-schedules", schedule.id, schedule);
      }
    } catch (error) {
      console.error("批量加入工作失败", error);
      window.alert(error.message || "批量加入工作失败，请检查本地数据库服务。");
      return;
    }
    const updatedScheduleMap = new Map(updatedSchedules.map((schedule) => [schedule.id, schedule]));
    state.workPlans = [...createdWorkPlans, ...state.workPlans];
    state.contentSchedules = state.contentSchedules.map((item) => updatedScheduleMap.get(item.id) ?? item);
  }

  selectedScheduleIds = new Set();
  const targetText = "待发起工作计划";
  const messages = [`已加入 ${createdWorkPlans.length} 条${targetText}。`];
  if (duplicatedCount > 0) messages.push("部分内容已加入关键行动计划，已跳过重复创建。");
  if (manualSelectCount > 0) messages.push("电商视觉需要手动选择关键行动，已跳过。");
  if (errorCount > 0) messages.push("部分内容未找到对应关键行动，请先到关键行动库配置。");
  window.alert(messages.join("\n"));
  rerender();
}

async function bulkCancelSchedules(rerender) {
  window.alert(legacyScheduleWriteDisabledMessage);
  return;
  if (selectedScheduleIds.size === 0) return;
  if (!window.confirm("确定要取消选中的内容排期吗？")) return;
  const now = getNow();
  const updatedSchedules = state.contentSchedules
    .filter((schedule) => selectedScheduleIds.has(schedule.id))
    .map((schedule) => ({ ...schedule, status: ContentScheduleStatus.Canceled, updatedAt: now }));
  try {
    for (const schedule of updatedSchedules) {
      await updatePersistentResource("content-schedules", schedule.id, schedule);
    }
  } catch (error) {
    console.error("批量取消内容排期失败", error);
    window.alert(error.message || "内容排期保存失败，请检查本地数据库服务。");
    return;
  }
  const updatedMap = new Map(updatedSchedules.map((schedule) => [schedule.id, schedule]));
  state.contentSchedules = state.contentSchedules.map((schedule) => updatedMap.get(schedule.id) ?? schedule);
  selectedScheduleIds = new Set();
  rerender();
}

async function generateTaskFromSchedule(scheduleId, rerender) {
  await createWorkPlanFromSchedule(scheduleId, WorkPlanStatus.Future, rerender);
}

async function startContentProcess(scheduleId, rerender) {
  await createWorkPlanFromSchedule(scheduleId, WorkPlanStatus.ThisWeek, rerender);
}

function createXmlWorkbook(rows, headers = contentNoteExportHeaders) {
  const xmlRows = rows
    .map(
      (row) => `
        <Row>
          ${headers
            .map((header) => `<Cell><Data ss:Type="String">${escapeHtml(row[header] ?? "")}</Data></Cell>`)
            .join("")}
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
  <Worksheet ss:Name="发布内容笔记">
    <Table>
      <Row>${headers.map((header) => `<Cell><Data ss:Type="String">${header}</Data></Cell>`).join("")}</Row>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function downloadFile(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getExportRows(schedules) {
  return schedules.map((schedule) => ({
    行动编码: schedule.instance?.businessCode ?? "",
    发布日期: formatBusinessDateTime(schedule.publishDate, ""),
    发布账号: schedule.account,
    笔记形式: normalizeContentType(schedule.contentType),
    内容目的: normalizeContentPurpose(schedule.contentPurpose),
    对应产品: schedule.product,
    关键行动名称: schedule.actionName,
    当前状态: contentNoteStatusOptions.includes(schedule.status) ? schedule.status : getStatusName(schedule.status),
    对齐目标: findName(goals, schedule.goalId, ""),
  }));
}

function exportSchedules() {
  const schedules = getContentNoteItems();
  if (schedules.length === 0) {
    window.alert("暂无可导出的发布内容笔记。");
    return;
  }
  downloadFile(createXmlWorkbook(getExportRows(schedules)), "发布内容笔记导出.xls", "application/vnd.ms-excel;charset=utf-8");
}

function downloadTemplate() {
  const headers = getBatchTemplateColumns();
  const instruction = Object.fromEntries(headers.map((header) => [header, `说明：${getBatchTemplateInstruction(header)}`]));
  downloadFile(
    createXmlWorkbook([instruction], headers),
    "发布内容笔记批量发起模板.xls",
    "application/vnd.ms-excel;charset=utf-8",
  );
}

function rowsToRecords(rows) {
  const headers = rows[0] ?? [];
  return rows
    .slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])))
    .filter((record) => !Object.values(record).every((value) => value === ""))
    .filter((record) => !String(record.对齐目标 ?? "").startsWith("说明："));
}

function normalizeImportHour(value) {
  const match = String(value ?? "").trim().match(/^([01]?\d|2[0-3])(?::00)?$/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:00` : null;
}

function combineImportDateHour(dateValue, hourValue, label, errors, required = false) {
  const date = String(dateValue ?? "").trim();
  const hour = String(hourValue ?? "").trim();
  if (date === "" && hour === "" && !required) return null;
  const normalizedDate = normalizeImportDate(date);
  const normalizedHour = normalizeImportHour(hour);
  if (normalizedDate === null) errors.push(`${label}日期格式应为 YYYY-MM-DD`);
  if (normalizedHour === null) errors.push(`${label}时间必须是整点 HH:00`);
  return normalizedDate && normalizedHour ? `${getBusinessDatePart(normalizedDate)}T${normalizedHour}:00+08:00` : null;
}

function resolveUniqueEntity(items, rawValue, codeKeys = [], { allowEmpty = false } = {}) {
  const value = String(rawValue ?? "").trim();
  if (value === "") return { item: null, error: allowEmpty ? "" : "不能为空" };
  const matches = items.filter((item) =>
    [item.id, item.name, ...codeKeys.map((key) => item[key])].some(
      (candidate) => String(candidate ?? "").trim().toLowerCase() === value.toLowerCase(),
    ),
  );
  if (matches.length === 0) return { item: null, error: "不存在" };
  if (matches.length > 1) return { item: null, error: "名称匹配到多条，请改用编码" };
  return { item: matches[0], error: "" };
}

function isPublishContentNoteTemplate(template) {
  return Array.isArray(template?.tags?.platform)
    && template.tags.platform.includes("小红书")
    && Array.isArray(template?.tags?.usage)
    && template.tags.usage.includes("笔记");
}

function findBatchField(keys = [], labels = []) {
  return getContentNoteBatchFormFields().find(
    (field) => keys.includes(field.key) || labels.includes(String(field.label ?? "").trim()),
  ) ?? null;
}

function getBatchFieldValue(customFields, field) {
  return field === null ? "" : String(customFields?.[field.key] ?? "").trim();
}

function validateOptionalBatchField(value, field, errors) {
  const normalized = String(value ?? "").trim();
  if (normalized === "") return;
  const options = getFieldAllowedValues(field);
  if (options.length > 0 && !options.includes(normalized)) {
    errors.push(`${field.label}选项无效`);
    return;
  }
  if (field.type === "date" && normalizeImportDate(normalized) === null) {
    errors.push(`${field.label}日期格式应为 YYYY-MM-DD`);
  } else if (field.type === "time" && normalizeImportHour(normalized) === null) {
    errors.push(`${field.label}时间格式应为整点 HH:00`);
  } else if (field.type === "number" && !Number.isFinite(Number(normalized))) {
    errors.push(`${field.label}必须是数字`);
  }
}

function parseImportProductCodes(value) {
  return splitProductSkuCodes(value);
}

function buildProductSetKey(productIds = []) {
  return [...new Set(productIds.map((item) => String(item ?? "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function buildContentNoteDedupeKey(dedupe = {}) {
  const parts = [
    dedupe.taskTemplateId,
    dedupe.goalId,
    dedupe.productKey ?? buildProductSetKey(dedupe.productIds ?? (dedupe.productId ? [dedupe.productId] : [])),
    dedupe.templateId,
    dedupe.publishDate,
    dedupe.account,
    dedupe.contentTitle,
  ].map((value) => String(value ?? "").trim().toLowerCase());
  if (parts.slice(2).every((value) => value === "")) {
    parts.push(String(dedupe.actionName ?? "").trim().toLowerCase());
  } else {
    parts.push("");
  }
  return parts.join("|");
}

function getExistingContentNoteDedupeKeys() {
  const publishDateField = findBatchField(["publishDate"], ["发布日期"]);
  const accountField = findBatchField(["account"], ["发布账号"]);
  const titleField = findBatchField(["title", "contentTitle"], ["标题", "内容标题"]);
  return new Set(state.processInstances.filter(isContentNoteInstance).map((instance) => {
    const workPlan = getWorkPlanByProcessInstance(instance.id);
    const productIds = state.actionProducts.filter((link) => link.actionId === instance.id).map((link) => link.productId);
    const templateId = Array.isArray(instance.customFields?.linkedTemplateIds)
      ? instance.customFields.linkedTemplateIds[0] ?? ""
      : "";
    return buildContentNoteDedupeKey({
      taskTemplateId: contentNoteTaskTemplateId,
      goalId: instance.goalId,
      productIds,
      templateId,
      publishDate: getBatchFieldValue(instance.customFields, publishDateField),
      account: getBatchFieldValue(instance.customFields, accountField),
      contentTitle: getBatchFieldValue(instance.customFields, titleField),
      actionName: workPlan?.title ?? instance.name ?? "",
    });
  }));
}

function buildAutomaticContentNoteName(products, linkedTemplate) {
  const productLabel = products.length > 1
    ? `${products[0].name}等${products.length}个产品`
    : products[0]?.name;
  return ["发布内容笔记", productLabel, linkedTemplate?.name].filter(Boolean).join("｜");
}

function buildImportPreviewRows(records, batchGoalId = "") {
  const template = getContentNoteTemplate();
  const formFields = getContentNoteBatchFormFields();
  const existingKeys = getExistingContentNoteDedupeKeys();
  const seenKeys = new Set();
  return records.map((record, index) => {
    const rowNumber = index + 3;
    const errors = [];
    const warnings = [];
    const rowGoalValue = String(record.对齐目标 ?? "").trim();
    const batchGoal = getActiveGoals().find((goal) => goal.id === batchGoalId) ?? null;
    const goalResult = rowGoalValue === ""
      ? { item: batchGoal, error: batchGoal === null ? "不能为空" : "" }
      : resolveUniqueEntity(getActiveGoals(), rowGoalValue, ["businessCode"]);
    const productCodes = parseImportProductCodes(record.产品编码);
    const products = [];
    const missingProductCodes = [];
    const ambiguousProductCodes = [];
    const unavailableProductCodes = [];
    productCodes.forEach((productCode) => {
      const normalizedCode = normalizeProductSkuCode(productCode);
      const serverMatches = importProductMatchIndex?.get(normalizedCode);
      const allMatches = serverMatches === undefined
        ? state.products.filter(
            (product) => normalizeProductSkuCode(product.skuCode) === normalizedCode,
          )
        : serverMatches
            .map((match) => state.products.find((product) => product.id === match.id) ?? match);
      if (allMatches.length === 0) missingProductCodes.push(productCode);
      else if (allMatches.length > 1) ambiguousProductCodes.push(productCode);
      else if (!isSelectableImportProduct(allMatches[0])) unavailableProductCodes.push(productCode);
      else products.push(allMatches[0]);
    });
    const templateCode = String(record.模板编码 ?? "").trim();
    const templateMatches = templateCode === ""
      ? []
      : state.templates.filter(
          (item) => String(item.businessCode ?? "").trim().toLowerCase() === templateCode.toLowerCase(),
        );
    const linkedTemplate = templateMatches.length === 1 ? templateMatches[0] : null;
    let templateError = "";
    if (templateCode !== "" && !/^MB-\d{6}-\d{4}$/.test(templateCode)) templateError = "格式无效";
    else if (templateCode !== "" && templateMatches.length === 0) templateError = "不存在";
    else if (templateMatches.length > 1) templateError = "匹配到多条";
    else if (linkedTemplate !== null && !isPublishContentNoteTemplate(linkedTemplate)) templateError = "不是小红书笔记模板";
    if (goalResult.error) errors.push(`目标${goalResult.error}`);
    if (missingProductCodes.length > 0) errors.push(`产品编码不存在：${missingProductCodes.join("、")}`);
    if (ambiguousProductCodes.length > 0) errors.push(`产品编码匹配不唯一：${ambiguousProductCodes.join("、")}`);
    if (unavailableProductCodes.length > 0) errors.push(`产品已停用或归档，不能关联：${unavailableProductCodes.join("、")}`);
    if (templateError) errors.push(`模板编码${templateError}`);
    const dueDate = combineImportDateHour(record.完成日期, record.完成时间, "完成期限", errors, false);
    const customFields = {};
    formFields.forEach((field) => {
      if (field.key === "publishDate" || field.label === "发布日期") {
        customFields[field.key] = combineImportDateHour(record.发布日期, record.发布时间, "发布", errors, false) ?? "";
        return;
      }
      if (field.key === "coverImageUrl" || field.type === "image" || field.type === "file") {
        customFields[field.key] = "";
        return;
      }
      customFields[field.key] = getFieldValueByHeader(record, field);
      validateOptionalBatchField(customFields[field.key], field, errors);
    });
    if (!formFields.some((field) => field.label === "参考场景")) customFields.scene = String(record.参考场景 ?? "").trim();
    if (!formFields.some((field) => field.label === "话题")) customFields.hashtags = String(record.话题 ?? "").trim();
    if (!formFields.some((field) => field.label === "备注")) customFields.remark = String(record.备注 ?? "").trim();
    if (linkedTemplate !== null && templateError === "") customFields.linkedTemplateIds = [linkedTemplate.id];
    const processTemplate = state.processTemplates.find((item) => item.id === template?.defaultProcessTemplateId);
    const nodes = state.processTemplateNodes.filter(
      (node) => node.templateId === template?.defaultProcessTemplateId && node.status !== ProcessTemplateStatus.Inactive,
    );
    if (!template || template.id !== contentNoteTaskTemplateId || template.status !== TaskTemplateStatus.Active) errors.push("发布内容笔记行动标准无效");
    if (!processTemplate || processTemplate.status !== ProcessTemplateStatus.Active) errors.push("默认流程无效");
    if (nodes.length === 0) errors.push("默认流程没有启用步骤");
    const unresolvedNode = nodes.find((node) => {
      const isReview = (node.stepType ?? "execution") === "review";
      if (isReview) return !node.reviewerId;
      if (node.ownerRule === ProcessOwnerRule.LaunchAssign) return !template?.ownerId;
      return !node.ownerId && !template?.ownerId;
    });
    if (unresolvedNode) errors.push(`流程步骤“${unresolvedNode.name}”负责人或审核人配置不完整`);
    const titleField = findBatchField(["title", "contentTitle"], ["标题", "内容标题"]);
    const accountField = findBatchField(["account"], ["发布账号"]);
    const publishDateField = findBatchField(["publishDate"], ["发布日期"]);
    const actionName =
      String(record.关键行动名称 ?? "").trim()
      || buildAutomaticContentNoteName(products, linkedTemplate);
    const dedupe = {
      taskTemplateId: contentNoteTaskTemplateId,
      goalId: goalResult.item?.id ?? "",
      productIds: products.map((product) => product.id),
      productKey: buildProductSetKey(products.map((product) => product.id)),
      templateId: linkedTemplate?.id ?? "",
      publishDate: getBatchFieldValue(customFields, publishDateField),
      account: getBatchFieldValue(customFields, accountField),
      contentTitle: getBatchFieldValue(customFields, titleField),
      actionName,
      publishDateFieldId: publishDateField?.key ?? "publishDate",
      accountFieldId: accountField?.key ?? "account",
      contentTitleFieldId: titleField?.key ?? "title",
    };
    const dedupeKey = buildContentNoteDedupeKey(dedupe);
    let duplicateType = "";
    if (errors.length === 0) {
      if (seenKeys.has(dedupeKey)) {
        errors.push("导入文件内存在重复行");
        duplicateType = "file";
      } else if (existingKeys.has(dedupeKey)) {
        warnings.push("数据库中可能已存在相同内容，默认不发起");
        duplicateType = "database";
      }
      seenKeys.add(dedupeKey);
    }
    return {
      rowNumber,
      data: record,
      errors,
      warnings,
      selected: errors.length === 0 && duplicateType !== "database",
      forceDuplicate: false,
      duplicateType,
      goal: goalResult.item,
      productCodes,
      products,
      invalidProductCodes: [...missingProductCodes, ...ambiguousProductCodes, ...unavailableProductCodes],
      linkedTemplate: templateError === "" ? linkedTemplate : null,
      actionName,
      dueDate,
      customFields,
      dedupe,
    };
  });
}

export function buildContentNoteImportPreview(records, batchGoalId = "") {
  return buildImportPreviewRows(records, batchGoalId);
}

export function getContentNoteImportTemplateColumns() {
  return getBatchTemplateColumns();
}

async function handleImportFile(file, rerender) {
  try {
    const parsed = await parseContentNoteImport(file);
    importProductMatchIndex = new Map(
      (parsed.productMatches ?? []).map((entry) => [entry.normalizedCode, entry.matches ?? []]),
    );
    const rows = parsed.rows;
    const headers = rows[0] ?? [];
    const requiredHeaders = getBatchTemplateColumns();
    const missingHeaders = [...new Set(requiredHeaders)].filter((header) => !headers.includes(header));
    if (missingHeaders.length > 0) {
      modalState = { kind: "import", fileName: file.name, rows: [], error: `缺少必要表头：${missingHeaders.join("、")}` };
      rerender();
      return;
    }

    modalState = {
      kind: "import",
      fileName: file.name,
      records: rowsToRecords(rows),
      batchGoalId: "",
      rows: buildImportPreviewRows(rowsToRecords(rows), ""),
      error: "",
      result: null,
    };
    rerender();
  } catch (error) {
    importProductMatchIndex = null;
    modalState = { kind: "import", fileName: file.name, rows: [], error: error.message || "文件解析失败，请使用系统模板，或 .xlsx/.xls/.csv/.tsv 文件。" };
    rerender();
  }
}

async function confirmImport(rerender) {
  const validRows = modalState.rows.filter((row) => row.errors.length === 0 && (row.selected || row.forceDuplicate));
  if (validRows.length === 0) {
    modalState = { ...modalState, error: "没有已选择且校验通过的可发起行。" };
    rerender();
    return;
  }
  const template = getContentNoteTemplate();
  const now = getNow();
  try {
    const payloadRows = validRows.map((row) => {
      const workPlan = {
        id: createId("work-plan"),
        goalId: row.goal.id,
        departmentId: template.departmentId || "",
        taskTemplateId: template.id,
        title: row.actionName,
        customFields: {
          ...row.customFields,
          valueModuleId: row.customFields.valueModuleId || "brand_marketing",
          valueModuleName: row.customFields.valueModuleName || "品牌营销",
        },
        coverImageUrl: null,
        status: WorkPlanStatus.Future,
        plannedWeek: null,
        dueDate: row.dueDate,
        description: "通过“发布内容笔记”批量导入发起。",
        processInstanceId: null,
        createdAt: now,
        updatedAt: now,
        launchedAt: null,
        canceledAt: null,
      };
      return prepareWorkPlanLaunchPayload(workPlan, {
        productIds: row.products.map((product) => product.id),
        rowNumber: row.rowNumber,
        dedupe: row.dedupe,
        forceDuplicate: row.forceDuplicate,
      });
    });
    const response = await batchLaunchWorkPlanDrafts(payloadRows);
    const nonSubmittedResults = modalState.rows
      .filter((row) => !validRows.includes(row))
      .map((row) => ({
        rowNumber: row.rowNumber,
        status: row.errors.length > 0 ? "failed" : row.duplicateType === "database" ? "skipped_duplicate" : "skipped",
        message: row.errors.join("；") || row.warnings.join("；") || "用户未选择该行。",
      }));
    modalState = { ...modalState, result: [...response.results, ...nonSubmittedResults], error: "" };
    rerender();
  } catch (error) {
    console.error("发布内容笔记批量发起失败", error);
    modalState = { ...modalState, error: error.message || "批量发起失败，请检查本地数据库服务。" };
    rerender();
  }
}

function downloadImportFailureDetails() {
  if (modalState?.kind !== "import" || !Array.isArray(modalState.result)) return;
  const rows = modalState.result
    .filter((item) => item.status !== "success")
    .map((item) => ({
      行号: item.rowNumber,
      结果: item.status === "skipped_duplicate" ? "跳过重复" : "失败",
      原因: item.message ?? "",
    }));
  if (rows.length === 0) return;
  downloadFile(
    createXmlWorkbook(rows, ["行号", "结果", "原因"]),
    "发布内容笔记批量发起失败明细.xls",
    "application/vnd.ms-excel;charset=utf-8",
  );
}

async function handleScheduleAction(action, scheduleId, rerender) {
  const schedule = getSchedule(scheduleId);
  if (schedule === null) return;

  if (action === "view-schedule") {
    modalState = { kind: "viewSchedule", scheduleId, templatePreviewId: "" };
    rerender();
    return;
  }
  if (action === "edit-schedule") {
    if (!canCurrentUser("contentSchedules.edit")) return;
    modalState = {
      kind: "schedule",
      mode: "edit",
      scheduleId,
      productImage: schedule.productImage,
      templateId: schedule.templateId ?? "",
      error: "",
    };
    rerender();
    return;
  }
  if (action === "cancel-schedule") {
    if (!canCurrentUser("contentSchedules.batchCancel")) return;
    await cancelSchedule(scheduleId, rerender);
    return;
  }
  if (action === "generate-task") {
    if (!canCurrentUser("contentSchedules.addToFuture")) return;
    await generateTaskFromSchedule(scheduleId, rerender);
    return;
  }
  if (action === "start-content-process") {
    if (!canCurrentUser("contentSchedules.addToThisWeek")) return;
    await startContentProcess(scheduleId, rerender);
  }
}

export function bindContentScheduleEvents(rerender) {
  const page = document.querySelector(".content-schedule-page");
  const filterForm = document.querySelector(".content-schedule-filters");
  const scheduleForm = document.querySelector(".content-schedule-form");
  const importInput = document.querySelector("[data-content-file='import']");
  const imageInput = document.querySelector("[data-content-file='image']");

  if (page === null) return;

  page.querySelectorAll("[data-content-schedule-select-all]").forEach((checkbox) => {
    checkbox.indeterminate = checkbox.dataset.indeterminate === "true";
  });

  if (filterForm !== null) {
    filterForm.addEventListener("input", (event) => {
      updateFilters(filterForm);
      selectedScheduleId = getContentNoteItems()[0]?.id ?? null;
      const keywordInput = event.target.closest('input[name="productKeyword"], input[name="titleKeyword"]');
      if (keywordInput !== null) {
        rerenderPreservingInputFocus(rerender, keywordInput, `.content-schedule-filters input[name="${keywordInput.name}"]`);
        return;
      }
      rerender();
    });
    filterForm.addEventListener("change", () => {
      updateFilters(filterForm);
      selectedScheduleId = getContentNoteItems()[0]?.id ?? null;
      rerender();
    });
  }

  page.addEventListener("click", async (event) => {
    const copyCodeButton = event.target.closest("[data-copy-content-code]");
    if (copyCodeButton !== null) {
      const code = copyCodeButton.dataset.copyContentCode ?? "";
      if (!code) return;
      await navigator.clipboard.writeText(code);
      const feedback = copyCodeButton.closest(".content-action-code")?.querySelector("[data-content-code-feedback]");
      if (feedback) feedback.textContent = "已复制";
      window.setTimeout(() => {
        if (feedback) feedback.textContent = "";
      }, 1200);
      return;
    }
    const actionButton = event.target.closest("[data-content-action]");
    if (actionButton !== null) {
      const action = actionButton.dataset.contentAction;
      if (action === "add-schedule") {
        if (!canCurrentUser("contentSchedules.create")) return;
        modalState = { kind: "schedule", mode: "add", productImage: "", templateId: "", error: "" };
        rerender();
        return;
      }
      if (action === "close-content-modal") {
        modalState = null;
        rerender();
        return;
      }
      if (action === "edit-schedule-from-view") {
        const schedule = getSchedule(actionButton.dataset.scheduleId);
        if (schedule === null || !canCurrentUser("contentSchedules.edit")) return;
        modalState = {
          kind: "schedule",
          mode: "edit",
          scheduleId: schedule.id,
          productImage: schedule.productImage,
          templateId: schedule.templateId ?? "",
          error: "",
        };
        rerender();
        return;
      }
      if (action === "remove-image") {
        modalState = { ...modalState, productImage: "" };
        rerender();
        return;
      }
      if (action === "open-template-picker") {
        if (modalState?.kind !== "schedule") return;
        modalState = {
          ...modalState,
          draft: readCurrentScheduleModalDraft(),
          templateId: modalState.templateId ?? readCurrentScheduleModalDraft().templateId ?? "",
          templatePickerOpen: true,
          templateQuery: modalState.templateQuery ?? "",
          templateTagFilters: modalState.templateTagFilters ?? createEmptyTemplateTags(),
          templatePreviewId: "",
        };
        rerender();
        await ensureTemplateOptionsLoaded(rerender);
        return;
      }
      if (action === "close-template-picker") {
        modalState = {
          ...modalState,
          draft: readCurrentScheduleModalDraft(),
          templatePickerOpen: false,
          templatePreviewId: "",
        };
        rerender();
        return;
      }
      if (action === "clear-linked-template") {
        modalState = { ...modalState, draft: readCurrentScheduleModalDraft(), templateId: "" };
        rerender();
        return;
      }
      if (action === "select-template-option") {
        modalState = {
          ...modalState,
          draft: readCurrentScheduleModalDraft(),
          templateId: actionButton.dataset.templateId ?? "",
          templatePickerOpen: false,
          templatePreviewId: "",
        };
        rerender();
        return;
      }
      if (action === "preview-template-option") {
        modalState = {
          ...modalState,
          draft: readCurrentScheduleModalDraft(),
          templatePreviewId: actionButton.dataset.templateId ?? "",
        };
        rerender();
        return;
      }
      if (action === "close-template-preview") {
        modalState = { ...modalState, draft: readCurrentScheduleModalDraft(), templatePreviewId: "" };
        rerender();
        return;
      }
      if (action === "preview-linked-template") {
        modalState = { ...modalState, templatePreviewId: actionButton.dataset.templateId ?? "" };
        rerender();
        return;
      }
      if (action === "close-linked-template-preview") {
        modalState = { ...modalState, templatePreviewId: "" };
        rerender();
        return;
      }
      if (action === "export-schedules") {
        if (!canCurrentUser("contentSchedules.export")) return;
        exportSchedules();
        return;
      }
      if (action === "launch-content-note") {
        const template = getContentNoteTemplate();
        if (template === null) {
          window.alert("未找到“发布内容笔记”关键行动，请先到行动标准中配置。");
          return;
        }
        if (!canLaunchActionTemplate(getCurrentUser(), template.id)) return;
        window.sessionStorage.setItem(
          "goalTaskPrefill",
          JSON.stringify({
            taskTemplateId: template.id,
            categoryId: template.categoryId ?? "",
            launchImmediately: true,
            title: "发起发布内容笔记",
          }),
        );
        window.location.hash = "goals";
        return;
      }
      if (action === "view-content-note") {
        const instanceId = actionButton.dataset.contentId ?? "";
        if (instanceId === "") return;
        window.sessionStorage.setItem("selectedProcessInstanceId", instanceId);
        window.location.hash = "process-progress";
        return;
      }
      if (action === "edit-content-note") {
        const instanceId = actionButton.dataset.contentId ?? "";
        const instance = state.processInstances.find((item) => item.id === instanceId) ?? null;
        if (instance === null || !canEditLaunchedProcessInstance(instance, getCurrentUser())) return;
        modalState = { kind: "editContentNote", instanceId };
        rerender();
        return;
      }
      if (action === "download-template") {
        if (!canLaunchContentNote()) return;
        downloadTemplate();
        return;
      }
      if (action === "confirm-import") {
        if (!canLaunchContentNote()) return;
        await confirmImport(rerender);
        return;
      }
      if (action === "download-import-results") {
        downloadImportFailureDetails();
        return;
      }
      if (action === "bulk-create-work-plan") {
        if (actionButton.dataset.status === WorkPlanStatus.Future && !canCurrentUser("contentSchedules.addToFuture")) return;
        if (actionButton.dataset.status === WorkPlanStatus.ThisWeek && !canCurrentUser("contentSchedules.addToThisWeek")) return;
        await bulkCreateWorkPlansFromSchedules(actionButton.dataset.status, rerender);
        return;
      }
      if (action === "bulk-cancel-schedules") {
        if (!canCurrentUser("contentSchedules.batchCancel")) return;
        await bulkCancelSchedules(rerender);
        return;
      }
      await handleScheduleAction(action, actionButton.dataset.scheduleId, rerender);
      return;
    }

    const templateTagButton = event.target.closest("[data-template-picker-tag]");
    if (templateTagButton !== null && modalState?.kind === "schedule") {
      const categoryId = templateTagButton.dataset.templatePickerCategory;
      const tag = templateTagButton.dataset.templatePickerTag;
      const currentFilters = normalizeTemplateTags(modalState.templateTagFilters ?? {});
      const currentTags = currentFilters[categoryId] ?? [];
      const nextTags = currentTags.includes(tag)
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag];
      modalState = {
        ...modalState,
        draft: readCurrentScheduleModalDraft(),
        templateTagFilters: { ...currentFilters, [categoryId]: nextTags },
      };
      rerender();
      return;
    }

    if (event.target.closest("[data-content-schedule-row-select], [data-content-schedule-select-all]") !== null) return;

    const row = event.target.closest("[data-schedule-row-id]");
    if (row === null) return;
    selectedScheduleId = row.dataset.scheduleRowId;
    rerender();
  });

  page.addEventListener("input", (event) => {
    const searchInput = event.target.closest("[data-template-picker-search]");
    if (searchInput !== null && modalState?.kind === "schedule") {
      modalState = {
        ...modalState,
        draft: readCurrentScheduleModalDraft(),
        templateQuery: searchInput.value,
      };
      rerenderPreservingInputFocus(rerender, searchInput, "[data-template-picker-search]");
    }
  });

  page.addEventListener("change", (event) => {
    const importRowSelect = event.target.closest("[data-import-row-select]");
    if (importRowSelect !== null && modalState?.kind === "import") {
      const rowNumber = Number(importRowSelect.dataset.importRowSelect);
      modalState = {
        ...modalState,
        rows: modalState.rows.map((row) =>
          row.rowNumber === rowNumber
            ? {
                ...row,
                selected: importRowSelect.checked,
                forceDuplicate: row.duplicateType === "database" ? importRowSelect.checked : row.forceDuplicate,
              }
            : row,
        ),
      };
      rerender();
      return;
    }
    const searchInput = event.target.closest("[data-template-picker-search]");
    if (searchInput !== null && modalState?.kind === "schedule") {
      modalState = {
        ...modalState,
        draft: readCurrentScheduleModalDraft(),
        templateQuery: searchInput.value,
      };
      rerender();
      return;
    }

    const selectAll = event.target.closest("[data-content-schedule-select-all]");
    if (selectAll !== null) {
      const visibleIds = getFilteredSchedules().map((schedule) => schedule.id);
      if (selectAll.checked) {
        selectedScheduleIds = new Set([...selectedScheduleIds, ...visibleIds]);
      } else {
        const visibleIdSet = new Set(visibleIds);
        selectedScheduleIds = new Set([...selectedScheduleIds].filter((scheduleId) => !visibleIdSet.has(scheduleId)));
      }
      rerender();
      return;
    }

    const rowSelect = event.target.closest("[data-content-schedule-row-select]");
    if (rowSelect !== null) {
      const scheduleId = rowSelect.dataset.scheduleId;
      selectedScheduleIds = new Set(selectedScheduleIds);
      if (rowSelect.checked) {
        selectedScheduleIds.add(scheduleId);
      } else {
        selectedScheduleIds.delete(scheduleId);
      }
      rerender();
    }
  });

  if (scheduleForm !== null) {
    scheduleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveSchedule(event.target, rerender);
    });
  }

  if (importInput !== null) {
    importInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file !== undefined) handleImportFile(file, rerender);
    });
  }

  if (imageInput !== null) {
    imageInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file === undefined) return;
      try {
        const result = await uploadImageFile(file);
        modalState = { ...modalState, productImage: result.url, error: "" };
        rerender();
      } catch (error) {
        modalState = { ...modalState, error: error.message };
        rerender();
      }
    });
  }

  const editModal = document.querySelector(".content-note-edit-modal");
  if (editModal !== null && modalState?.kind === "editContentNote") {
    bindLaunchedProcessDetailEvents(editModal, rerender, {
      onTaskSelect: (taskId) => {
        window.sessionStorage.setItem("selectedTaskId", taskId);
        modalState = null;
        window.location.hash = "task-list";
      },
      onSaved: () => {
        modalState = null;
        rerender();
      },
    });
  }
}

export function renderContentSchedulePage() {
  return `
    <div class="content-schedule-page">
      ${renderFilters()}
      ${renderScheduleTable()}
      ${renderScheduleDetail()}
      ${renderLegacyScheduleTable()}
      ${renderScheduleViewModal()}
      ${renderScheduleModal()}
      ${renderImportModal()}
      ${renderContentNoteEditModal()}
    </div>
  `;
}
