import { createId, getCurrentUser, getCurrentWeek, getNow, resolveAssetUrl, state, uploadImageFile } from "./appState.js?v=20260627-methods1";
import { hasPermission } from "./permissions.js?v=20260627-methods1";
import {
  CategoryType,
  ContentScheduleStatus,
  ProcessAccepterRule,
  ProcessInstanceStatus,
  ProcessOwnerRule,
  ProcessTemplateStatus,
  TaskStatus,
  TaskTemplateStatus,
  TaskImportance,
  TaskUrgency,
  WorkPlanStatus,
  contentScheduleAccountOptions,
  contentScheduleAudienceOptions,
  contentSchedulePurposeOptions,
  contentScheduleStatusNames,
  contentScheduleTypeOptions,
  processInstanceStatusNames,
  taskStatusNames,
  workPlanStatusNames,
} from "./data/modelOptions.js";

const defaultDepartmentId = "dept-marketing";
const defaultOwnerId = "person-005";
const categories = state.categories;
const goals = state.goals;
const requiredImportHeaders = [];
const exportHeaders = [
  "发布日期",
  "发布账号",
  "内容类型",
  "内容目的",
  "受众人群",
  "对应产品",
  "标题",
  "文案",
  "参考场景",
  "#话题",
  "状态",
  "关联目标",
];

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

function getTaskCategories() {
  return categories.filter((category) => category.type === CategoryType.Task);
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

function normalizeImportDate(value) {
  const trimmedValue = value.trim();
  let year = 0;
  let month = 0;
  let day = 0;
  const fullDateMatch = trimmedValue.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const monthDayMatch = trimmedValue.match(/^(\d{1,2})月(\d{1,2})日$/);

  if (fullDateMatch) {
    year = Number(fullDateMatch[1]);
    month = Number(fullDateMatch[2]);
    day = Number(fullDateMatch[3]);
  } else if (monthDayMatch) {
    year = 2026;
    month = Number(monthDayMatch[1]);
    day = Number(monthDayMatch[2]);
  } else {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
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
  if (filters.dateFrom !== "" && schedule.publishDate < filters.dateFrom) return false;
  if (filters.dateTo !== "" && schedule.publishDate > filters.dateTo) return false;
  if (filters.account !== "" && schedule.account !== filters.account) return false;
  if (filters.contentType !== "" && normalizeContentType(schedule.contentType) !== filters.contentType) return false;
  if (filters.contentPurpose !== "" && normalizeContentPurpose(schedule.contentPurpose) !== filters.contentPurpose) return false;
  if (filters.targetAudience !== "" && normalizeContentAudience(schedule.targetAudience) !== filters.targetAudience) return false;
  if (filters.status !== "" && normalizeContentScheduleStatus(schedule.status) !== filters.status) return false;
  if (filters.goalId !== "" && schedule.goalId !== filters.goalId) return false;
  if (filters.productKeyword !== "" && !schedule.product.includes(filters.productKeyword)) return false;
  if (filters.titleKeyword !== "" && !schedule.title.includes(filters.titleKeyword)) return false;
  return true;
}

function getFilteredSchedules() {
  return state.contentSchedules.filter(matchesFilters).sort((left, right) => left.publishDate.localeCompare(right.publishDate));
}

function renderFilters() {
  return `
    <form class="content-schedule-filters" aria-label="内容排期筛选">
      <label><span>开始日期</span><input name="dateFrom" type="date" value="${filters.dateFrom}" /></label>
      <label><span>结束日期</span><input name="dateTo" type="date" value="${filters.dateTo}" /></label>
      <label><span>发布账号</span><select name="account">${renderStringOptions(contentScheduleAccountOptions, filters.account, "全部账号")}</select></label>
      <label><span>内容类型</span><select name="contentType">${renderStringOptions(contentScheduleTypeOptions, filters.contentType, "全部类型")}</select></label>
      <label><span>内容目的</span><select name="contentPurpose">${renderStringOptions(contentSchedulePurposeOptions, filters.contentPurpose, "全部目的")}</select></label>
      <label><span>受众人群</span><select name="targetAudience">${renderStringOptions(contentScheduleAudienceOptions, filters.targetAudience, "全部人群")}</select></label>
      <label><span>状态</span><select name="status">${renderStatusOptions(filters.status, "全部状态")}</select></label>
      <label><span>关联目标</span><select name="goalId">${renderEntityOptions(goals, filters.goalId, "全部目标")}</select></label>
      <label><span>产品关键词</span><input name="productKeyword" value="${escapeAttribute(filters.productKeyword)}" placeholder="搜索产品" /></label>
      <label><span>标题关键词</span><input name="titleKeyword" value="${escapeAttribute(filters.titleKeyword)}" placeholder="搜索标题" /></label>
    </form>
  `;
}

function renderActionButton(label, action, scheduleId, variant = "") {
  return `<button class="text-button ${variant}" type="button" data-content-action="${action}" data-schedule-id="${scheduleId}">${label}</button>`;
}

function renderImageCell(schedule) {
  return schedule.productImage
    ? `<img class="content-thumb" src="${escapeAttribute(resolveAssetUrl(schedule.productImage))}" alt="1:1 产品主图" />`
    : `<span class="empty-thumb">无图</span>`;
}

function getProcessProgressText(processInstanceId) {
  const processTasks = state.tasks.filter((task) => task.processInstanceId === processInstanceId);
  if (processTasks.length === 0) return "";
  const doneCount = processTasks.filter((task) => task.status === TaskStatus.Done).length;
  return `${doneCount}/${processTasks.length}`;
}

function renderScheduleFlowStatus(schedule) {
  if (schedule.workPlanId) {
    const workPlan = state.workPlans.find((item) => item.id === schedule.workPlanId);
    if (workPlan !== undefined) {
      return `<span class="status-pill">${workPlanStatusNames[workPlan.status] ?? "已加入工作计划"}</span>`;
    }
  }

  if (schedule.processInstanceId !== null) {
    const instance = state.processInstances.find((item) => item.id === schedule.processInstanceId);
    if (instance === undefined) return `<span class="status-pill is-inactive">流程已失效</span>`;

    const statusText =
      instance.status === ProcessInstanceStatus.Running
        ? "流程进行中"
        : instance.status === ProcessInstanceStatus.Done
          ? "流程已完成"
          : instance.status === ProcessInstanceStatus.Stopped
            ? "流程已终止"
            : `流程${processInstanceStatusNames[instance.status] ?? "未知"}`;
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
  const schedules = getFilteredSchedules();
  const visibleScheduleIds = schedules.map((schedule) => schedule.id);
  const visibleSelectedCount = visibleScheduleIds.filter((scheduleId) => selectedScheduleIds.has(scheduleId)).length;
  const selectedCount = selectedScheduleIds.size;
  const isAllVisibleSelected = visibleScheduleIds.length > 0 && visibleSelectedCount === visibleScheduleIds.length;
  const isPartiallyVisibleSelected = visibleSelectedCount > 0 && visibleSelectedCount < visibleScheduleIds.length;

  return `
    <section class="settings-section">
      <div class="section-heading with-actions">
        <h2>内容排期表</h2>
        <div class="section-actions">
          ${canCurrentUser("contentSchedules.import") ? `<button class="secondary-button" type="button" data-content-action="download-template">下载导入模板</button>` : ""}
          ${canCurrentUser("contentSchedules.import") ? `
            <label class="secondary-button file-button">
              导入排期
              <input type="file" data-content-file="import" accept=".xls,.xml,.csv,.tsv,.txt" />
            </label>
          ` : ""}
          ${canCurrentUser("contentSchedules.export") ? `<button class="secondary-button" type="button" data-content-action="export-schedules">导出 Excel</button>` : ""}
          ${canCurrentUser("contentSchedules.create") ? `<button class="primary-button" type="button" data-content-action="add-schedule">新增排期</button>` : ""}
        </div>
      </div>
      <div class="bulk-task-bar">
        <strong>已选择 ${selectedCount} 条内容</strong>
        ${canCurrentUser("contentSchedules.addToFuture") ? `<button class="secondary-button" type="button" data-content-action="bulk-create-work-plan" data-status="${WorkPlanStatus.Future}" ${selectedCount === 0 ? "disabled" : ""}>加入未来工作</button>` : ""}
        ${canCurrentUser("contentSchedules.addToThisWeek") ? `<button class="secondary-button" type="button" data-content-action="bulk-create-work-plan" data-status="${WorkPlanStatus.ThisWeek}" ${selectedCount === 0 ? "disabled" : ""}>加入本周工作</button>` : ""}
        ${canCurrentUser("contentSchedules.batchCancel") ? `<button class="secondary-button danger-button" type="button" data-content-action="bulk-cancel-schedules" ${selectedCount === 0 ? "disabled" : ""}>批量取消</button>` : ""}
      </div>
      <div class="table-wrap">
        <table class="data-table content-schedule-table">
          <thead>
            <tr>
              <th class="task-select-column">
                <label class="task-select-all">
                  <input
                    type="checkbox"
                    data-content-schedule-select-all
                    data-indeterminate="${isPartiallyVisibleSelected ? "true" : "false"}"
                    ${isAllVisibleSelected ? "checked" : ""}
                    ${visibleScheduleIds.length === 0 ? "disabled" : ""}
                  />
                  <span>序号</span>
                </label>
              </th>
              <th>产品图</th>
              <th>发布日期</th>
              <th>发布账号</th>
              <th>内容类型</th>
              <th>目的</th>
              <th>受众人群</th>
              <th>标题</th>
              <th>内容文案</th>
              <th>流程状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${
              schedules.length === 0
                ? `<tr><td colspan="11">暂无匹配排期</td></tr>`
                : schedules
                    .map(
                      (schedule, index) => `
                        <tr class="${schedule.id === selectedScheduleId ? "is-selected" : ""}" data-schedule-row-id="${schedule.id}">
                          <td class="task-select-column">
                            <label class="task-row-select">
                              <input
                                type="checkbox"
                                data-content-schedule-row-select
                                data-schedule-id="${schedule.id}"
                                ${selectedScheduleIds.has(schedule.id) ? "checked" : ""}
                              />
                              <span>${index + 1}</span>
                            </label>
                          </td>
                          <td class="content-image-column">${renderImageCell(schedule)}</td>
                          <td>${schedule.publishDate}</td>
                          <td>${escapeHtml(schedule.account)}</td>
                          <td>${escapeHtml(normalizeContentType(schedule.contentType))}</td>
                          <td>${escapeHtml(normalizeContentPurpose(schedule.contentPurpose))}</td>
                          <td>${escapeHtml(normalizeContentAudience(schedule.targetAudience))}</td>
                          <td class="content-title-cell"><span>${escapeHtml(schedule.title)}</span></td>
                          <td class="content-copy-cell"><span>${escapeHtml(schedule.copywriting || "未填写")}</span></td>
                          <td>${renderScheduleFlowStatus(schedule)}</td>
                          <td>
                            <span class="row-actions">
                              ${renderActionButton("查看", "view-schedule", schedule.id)}
                              ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.edit") ? renderActionButton("编辑", "edit-schedule", schedule.id) : ""}
                              ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.addToFuture") ? renderActionButton("加入未来工作", "generate-task", schedule.id) : ""}
                              ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.addToThisWeek") ? renderActionButton("加入本周工作", "start-content-process", schedule.id) : ""}
                              ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.batchCancel") ? renderActionButton("取消", "cancel-schedule", schedule.id, "danger-button") : ""}
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

function renderDetailField(label, value) {
  return `<div class="detail-field"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderScheduleDetail() {
  const schedule = getSchedule(selectedScheduleId) ?? getFilteredSchedules()[0] ?? null;

  if (schedule === null) {
    return `
      <section class="settings-section task-detail">
        <div class="section-heading"><h2>排期详情</h2></div>
        <div class="empty-detail">暂无排期</div>
      </section>
    `;
  }

  return `
    <section class="settings-section task-detail">
      <div class="section-heading with-actions">
        <h2>排期详情</h2>
        <div class="section-actions">
          ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.edit") ? renderActionButton("编辑", "edit-schedule", schedule.id) : ""}
          ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.addToFuture") ? renderActionButton("加入未来工作", "generate-task", schedule.id) : ""}
          ${schedule.status !== ContentScheduleStatus.Canceled && canCurrentUser("contentSchedules.addToThisWeek") ? renderActionButton("加入本周工作", "start-content-process", schedule.id) : ""}
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
          ${renderDetailField("发布日期", schedule.publishDate)}
          ${renderDetailField("发布账号", escapeHtml(schedule.account))}
          ${renderDetailField("内容类型", escapeHtml(normalizeContentType(schedule.contentType)))}
          ${renderDetailField("内容目的", escapeHtml(normalizeContentPurpose(schedule.contentPurpose)))}
          ${renderDetailField("受众人群", escapeHtml(normalizeContentAudience(schedule.targetAudience)))}
          ${renderDetailField("对应产品", escapeHtml(schedule.product || "未填写"))}
          ${renderDetailField("状态", getStatusName(schedule.status))}
          ${renderDetailField("关联目标", findName(goals, schedule.goalId, "未关联"))}
          ${renderDetailField("生成执行任务", schedule.taskId === null ? "未生成" : findName(state.tasks, schedule.taskId, "已生成"))}
        </div>
      </div>
      <div class="detail-block">
        <h3>内容信息</h3>
        <p>文案：${escapeHtml(schedule.copywriting || "未填写")}</p>
        <p>参考场景：${escapeHtml(schedule.scene || "未填写")}</p>
        <p>话题：${escapeHtml(schedule.hashtags || "未填写")}</p>
      </div>
    </section>
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

function renderScheduleModal() {
  if (modalState === null || modalState.kind !== "schedule") return "";

  const schedule = modalState.mode === "edit" ? getSchedule(modalState.scheduleId) : null;
  const image = modalState.productImage ?? schedule?.productImage ?? "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="${modalState.mode === "edit" ? "编辑排期" : "新增排期"}">
        <div class="modal-header">
          <h2>${modalState.mode === "edit" ? "编辑排期" : "新增排期"}</h2>
          <button class="icon-button" type="button" data-content-action="close-content-modal" aria-label="关闭">×</button>
        </div>
        <form class="modal-form content-schedule-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <div class="form-grid">
            <label><span>发布日期</span><input name="publishDate" type="date" value="${schedule?.publishDate ?? ""}" /></label>
            <label><span>发布账号</span><select name="account">${renderStringOptions(contentScheduleAccountOptions, schedule?.account ?? "", "请选择账号")}</select></label>
            <label><span>内容类型</span><select name="contentType">${renderStringOptions(contentScheduleTypeOptions, normalizeContentType(schedule?.contentType ?? ""), "请选择类型")}</select></label>
            <label><span>内容目的</span><select name="contentPurpose">${renderStringOptions(contentSchedulePurposeOptions, normalizeContentPurpose(schedule?.contentPurpose ?? ""), "请选择目的")}</select></label>
            <label><span>受众人群</span><select name="targetAudience">${renderStringOptions(contentScheduleAudienceOptions, normalizeContentAudience(schedule?.targetAudience ?? ""), "请选择人群")}</select></label>
            <label><span>状态</span><select name="status">${renderStatusOptions(normalizeContentScheduleStatus(schedule?.status) || ContentScheduleStatus.PendingSubmit, "请选择状态")}</select></label>
            <label><span>关联目标</span><select name="goalId">${renderEntityOptions(goals, schedule?.goalId ?? "", "请选择目标")}</select></label>
            <label><span>对应产品</span><input name="product" value="${escapeAttribute(schedule?.product ?? "")}" autocomplete="off" /></label>
          </div>
          ${renderImageField(image)}
          <label><span>标题</span><input name="title" value="${escapeAttribute(schedule?.title ?? "")}" autocomplete="off" /></label>
          <label><span>文案</span><textarea name="copywriting" rows="4">${escapeHtml(schedule?.copywriting ?? "")}</textarea></label>
          <div class="form-grid">
            <label><span>参考场景</span><input name="scene" value="${escapeAttribute(schedule?.scene ?? "")}" autocomplete="off" /></label>
            <label><span>#话题</span><input name="hashtags" value="${escapeAttribute(schedule?.hashtags ?? "")}" autocomplete="off" /></label>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-content-action="close-content-modal">取消</button>
            <button class="primary-button" type="submit">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderImportModal() {
  if (modalState === null || modalState.kind !== "import") return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="导入排期预览">
        <div class="modal-header">
          <h2>导入排期预览</h2>
          <button class="icon-button" type="button" data-content-action="close-content-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-form">
          <div class="form-error" ${modalState.error === "" ? "hidden" : ""}>${modalState.error}</div>
          <p class="form-note">${escapeHtml(modalState.fileName)}，共 ${modalState.rows.length} 行，可导入 ${modalState.rows.filter((row) => row.errors.length === 0).length} 行。</p>
          <div class="table-wrap">
            <table class="data-table compact-import-table">
              <thead><tr><th>行号</th><th>发布日期</th><th>标题</th><th>状态</th><th>校验</th></tr></thead>
              <tbody>
                ${modalState.rows
                  .map(
                    (row) => `
                      <tr>
                        <td>${row.rowNumber}</td>
                        <td>${escapeHtml(row.data.发布日期)}</td>
                        <td>${escapeHtml(row.data.标题)}</td>
                        <td>${escapeHtml(row.data.状态)}</td>
                        <td>${row.errors.length === 0 ? "可导入" : escapeHtml(row.errors.join("；"))}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-content-action="close-content-modal">取消</button>
            <button class="primary-button" type="button" data-content-action="confirm-import">确认导入有效行</button>
          </div>
        </div>
      </div>
    </div>
  `;
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
  return {
    publishDate: getFormValue(form, "publishDate"),
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
  };
}

function validateScheduleDraft(draft) {
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

function saveSchedule(form, rerender) {
  const editingSchedule = modalState.mode === "edit" ? getSchedule(modalState.scheduleId) : null;
  const draft = buildScheduleDraft(form);
  const error = validateScheduleDraft(draft);
  if (error !== "") return setModalError(error, rerender);

  const now = getNow();
  const normalizedDraft = { ...draft, publishDate: normalizeImportDate(draft.publishDate) };
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
    state.contentSchedules = [newSchedule, ...state.contentSchedules];
    selectedScheduleId = newSchedule.id;
  } else {
    state.contentSchedules = state.contentSchedules.map((schedule) =>
      schedule.id === editingSchedule.id ? { ...schedule, ...normalizedDraft, updatedAt: now } : schedule,
    );
  }

  modalState = null;
  rerender();
}

function cancelSchedule(scheduleId, rerender) {
  if (!window.confirm("确定要取消该内容排期吗？取消后历史记录仍会保留。")) return;
  const now = getNow();
  state.contentSchedules = state.contentSchedules.map((schedule) =>
    schedule.id === scheduleId ? { ...schedule, status: ContentScheduleStatus.Canceled, updatedAt: now } : schedule,
  );
  rerender();
}

function bulkUpdateScheduleStatus(status, rerender) {
  if (selectedScheduleIds.size === 0) return;
  if (status === ContentScheduleStatus.Canceled && !window.confirm("确定要取消选中的内容排期吗？")) return;

  const now = getNow();
  state.contentSchedules = state.contentSchedules.map((schedule) =>
    selectedScheduleIds.has(schedule.id) ? { ...schedule, status, updatedAt: now } : schedule,
  );
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
    return { error: "电商视觉需要手动选择标准工作事项。" };
  }
  if (template === null) return { error: "未找到对应标准工作事项，请先到标准工作库配置。" };
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
      importance: TaskImportance.Important,
      urgency: TaskUrgency.NotUrgent,
      status,
      plannedWeek: status === WorkPlanStatus.ThisWeek ? getCurrentWeek() : null,
      dueDate: schedule.publishDate || null,
      description: `由内容排期创建：${schedule.publishDate} ${schedule.account} ${schedule.title}`,
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

function createWorkPlanFromSchedule(scheduleId, status, rerender) {
  const schedule = getSchedule(scheduleId);
  if (schedule === null) return;
  const now = getNow();
  const result = buildWorkPlanFromSchedule(schedule, status, null, now);
  if (result.error !== undefined) return window.alert(result.error);
  if (result.skipped === "duplicated") return window.alert("该内容已加入工作计划，已跳过重复创建。");
  state.workPlans = [result.workPlan, ...state.workPlans];
  state.contentSchedules = state.contentSchedules.map((item) =>
    item.id === result.scheduleId ? { ...item, workPlanId: result.workPlanId, updatedAt: now } : item,
  );
  window.alert(status === WorkPlanStatus.ThisWeek ? "已加入本周工作，请到优先级模块发起工作。" : "已加入未来工作，请到优先级模块安排。");
  rerender();
}

function bulkCreateWorkPlansFromSchedules(status, rerender) {
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
    state.workPlans = [...createdWorkPlans, ...state.workPlans];
    state.contentSchedules = state.contentSchedules.map((item) =>
      scheduleWorkPlanMap.has(item.id) ? { ...item, workPlanId: scheduleWorkPlanMap.get(item.id), updatedAt: now } : item,
    );
  }

  selectedScheduleIds = new Set();
  const targetText = status === WorkPlanStatus.ThisWeek ? "本周工作" : "未来工作";
  const messages = [`已加入 ${createdWorkPlans.length} 条${targetText}。`];
  if (duplicatedCount > 0) messages.push("部分内容已加入工作计划，已跳过重复创建。");
  if (manualSelectCount > 0) messages.push("电商视觉需要手动选择标准工作事项，已跳过。");
  if (errorCount > 0) messages.push("部分内容未找到对应标准工作事项，请先到标准工作库配置。");
  window.alert(messages.join("\n"));
  rerender();
}

function bulkCancelSchedules(rerender) {
  if (selectedScheduleIds.size === 0) return;
  if (!window.confirm("确定要取消选中的内容排期吗？")) return;
  const now = getNow();
  state.contentSchedules = state.contentSchedules.map((schedule) =>
    selectedScheduleIds.has(schedule.id) ? { ...schedule, status: ContentScheduleStatus.Canceled, updatedAt: now } : schedule,
  );
  selectedScheduleIds = new Set();
  rerender();
}

function generateTaskFromSchedule(scheduleId, rerender) {
  createWorkPlanFromSchedule(scheduleId, WorkPlanStatus.Future, rerender);
}

function startContentProcess(scheduleId, rerender) {
  createWorkPlanFromSchedule(scheduleId, WorkPlanStatus.ThisWeek, rerender);
}

function createXmlWorkbook(rows) {
  const xmlRows = rows
    .map(
      (row) => `
        <Row>
          ${exportHeaders
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
  <Worksheet ss:Name="内容排期">
    <Table>
      <Row>${exportHeaders.map((header) => `<Cell><Data ss:Type="String">${header}</Data></Cell>`).join("")}</Row>
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
    发布日期: schedule.publishDate,
    发布账号: schedule.account,
    内容类型: normalizeContentType(schedule.contentType),
    内容目的: normalizeContentPurpose(schedule.contentPurpose),
    受众人群: normalizeContentAudience(schedule.targetAudience),
    对应产品: schedule.product,
    标题: schedule.title,
    文案: schedule.copywriting,
    参考场景: schedule.scene,
    "#话题": schedule.hashtags,
    状态: getStatusName(schedule.status),
    关联目标: findName(goals, schedule.goalId, ""),
  }));
}

function exportSchedules() {
  const schedules = getFilteredSchedules();
  if (schedules.length === 0) {
    window.alert("暂无可导出的内容排期。");
    return;
  }
  downloadFile(createXmlWorkbook(getExportRows(schedules)), "半然内容排期导出.xls", "application/vnd.ms-excel;charset=utf-8");
}

function downloadTemplate() {
  const rows = [
    {
      发布日期: "2026-07-03",
      发布账号: "阿柚",
      内容类型: "图文笔记",
      内容目的: "种草引流",
      受众人群: "兴趣人群",
      对应产品: "赛里木湖蓝花瓶",
      标题: "这个蓝色花瓶太适合夏天了",
      文案: "放在窗边真的很有夏天的感觉，清透、安静、不抢空间。",
      参考场景: "窗台",
      "#话题": "#花瓶 #家居软装 #氛围感家居",
      状态: "待提交",
      关联目标: "提高内容互动转化效率",
    },
  ];
  downloadFile(createXmlWorkbook(rows), "半然内容排期导入模板.xls", "application/vnd.ms-excel;charset=utf-8");
}

function parseDelimitedRows(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function parseXmlWorkbook(text) {
  const document = new DOMParser().parseFromString(text, "text/xml");
  if (document.querySelector("parsererror") !== null) return [];
  return [...document.querySelectorAll("Row")].map((row) =>
    [...row.querySelectorAll("Cell")].map((cell) => cell.textContent?.trim() ?? ""),
  );
}

function rowsToRecords(rows) {
  const headers = rows[0] ?? [];
  return rows.slice(1).map((row) =>
    exportHeaders.reduce((record, header) => {
      const index = header === "受众人群" && !headers.includes("受众人群") ? headers.indexOf("对应人群") : headers.indexOf(header);
      record[header] = index >= 0 ? row[index] ?? "" : "";
      return record;
    }, {}),
  );
}

function hasImportHeader(headers, header) {
  if (header === "受众人群") return headers.includes("受众人群") || headers.includes("对应人群");
  return headers.includes(header);
}

function buildImportPreviewRows(records) {
  return records.map((record, index) => {
    const data = { ...record };
    const rowNumber = index + 2;
    const errors = [];
    const normalizedDate = normalizeImportDate(data.发布日期);
    const contentType = normalizeContentType(data.内容类型);
    const contentPurpose = normalizeContentPurpose(data.内容目的);
    const targetAudience = normalizeContentAudience(data.受众人群);
    const statusValue = getStatusValueByName(data.状态);

    if (data.发布日期 !== "" && normalizedDate === null) errors.push(`第 ${rowNumber} 行：【发布日期】必须是合法日期`);
    if (normalizedDate !== null) data.发布日期 = normalizedDate;
    if (data.内容类型 !== "" && !contentScheduleTypeOptions.includes(contentType)) {
      errors.push(`第 ${rowNumber} 行：【内容类型】不在固定选项中`);
    } else {
      data.内容类型 = contentType;
    }
    if (data.内容目的 !== "" && !contentSchedulePurposeOptions.includes(contentPurpose)) {
      errors.push(`第 ${rowNumber} 行：【内容目的】不在固定选项中`);
    } else {
      data.内容目的 = contentPurpose;
    }
    if (data.受众人群 !== "" && !contentScheduleAudienceOptions.includes(targetAudience)) {
      errors.push(`第 ${rowNumber} 行：【受众人群】不在固定选项中`);
    } else {
      data.受众人群 = targetAudience;
    }
    if (data.状态 !== "" && statusValue === "") errors.push(`第 ${rowNumber} 行：【状态】不在固定选项中`);
    if (statusValue !== "") data.状态 = contentScheduleStatusNames[statusValue];
    if (data.关联目标 !== "" && !goals.some((goal) => goal.name === data.关联目标)) {
      errors.push(`第 ${rowNumber} 行：【关联目标】不存在`);
    }
    if (data.关联目标 === "") data.关联目标 = "提高内容互动转化效率";

    return { rowNumber, data, errors };
  });
}

async function handleImportFile(file, rerender) {
  try {
    const text = await file.text();
    const rows = text.trimStart().startsWith("<?xml") || text.includes("<Workbook") ? parseXmlWorkbook(text) : parseDelimitedRows(text);
    const headers = rows[0] ?? [];
    const missingHeaders = requiredImportHeaders.filter((header) => !hasImportHeader(headers, header));
    if (missingHeaders.length > 0) {
      modalState = { kind: "import", fileName: file.name, rows: [], error: `缺少必要表头：${missingHeaders.join("、")}` };
      rerender();
      return;
    }

    modalState = {
      kind: "import",
      fileName: file.name,
      rows: buildImportPreviewRows(rowsToRecords(rows)),
      error: "",
    };
    rerender();
  } catch {
    modalState = { kind: "import", fileName: file.name, rows: [], error: "文件解析失败，请使用系统导出的 xls 模板，或 CSV/TSV 文件。" };
    rerender();
  }
}

function confirmImport(rerender) {
  const validRows = modalState.rows.filter((row) => row.errors.length === 0);
  const failedCount = modalState.rows.length - validRows.length;
  if (validRows.length === 0) {
    modalState = { ...modalState, error: "没有可导入的有效行。" };
    rerender();
    return;
  }

  const now = getNow();
  const importedSchedules = validRows.map((row) => {
    const goalId = goals.find((goal) => goal.name === row.data.关联目标)?.id ?? "goal-marketing-2026-07";
    return {
      id: createId("content-schedule"),
      publishDate: row.data.发布日期,
      account: row.data.发布账号,
      contentType: row.data.内容类型,
      contentPurpose: row.data.内容目的,
      targetAudience: row.data.受众人群,
      product: row.data.对应产品,
      productImage: "",
      title: row.data.标题,
      copywriting: row.data.文案,
      scene: row.data.参考场景,
      hashtags: row.data["#话题"],
      status: getStatusValueByName(row.data.状态),
      goalId,
      taskId: null,
      processInstanceId: null,
      workPlanId: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  state.contentSchedules = [...importedSchedules, ...state.contentSchedules];
  selectedScheduleId = importedSchedules[0]?.id ?? selectedScheduleId;
  modalState = null;
  window.alert(`导入完成：成功 ${importedSchedules.length} 行，跳过 ${failedCount} 行。`);
  rerender();
}

function handleScheduleAction(action, scheduleId, rerender) {
  const schedule = getSchedule(scheduleId);
  if (schedule === null) return;

  if (action === "view-schedule") {
    selectedScheduleId = scheduleId;
    rerender();
    return;
  }
  if (action === "edit-schedule") {
    if (!canCurrentUser("contentSchedules.edit")) return;
    modalState = { kind: "schedule", mode: "edit", scheduleId, productImage: schedule.productImage, error: "" };
    rerender();
    return;
  }
  if (action === "cancel-schedule") {
    if (!canCurrentUser("contentSchedules.batchCancel")) return;
    cancelSchedule(scheduleId, rerender);
    return;
  }
  if (action === "generate-task") {
    if (!canCurrentUser("contentSchedules.addToFuture")) return;
    generateTaskFromSchedule(scheduleId, rerender);
    return;
  }
  if (action === "start-content-process") {
    if (!canCurrentUser("contentSchedules.addToThisWeek")) return;
    startContentProcess(scheduleId, rerender);
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
    filterForm.addEventListener("input", () => {
      updateFilters(filterForm);
      selectedScheduleId = getFilteredSchedules()[0]?.id ?? null;
      rerender();
    });
    filterForm.addEventListener("change", () => {
      updateFilters(filterForm);
      selectedScheduleId = getFilteredSchedules()[0]?.id ?? null;
      rerender();
    });
  }

  page.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-content-action]");
    if (actionButton !== null) {
      const action = actionButton.dataset.contentAction;
      if (action === "add-schedule") {
        if (!canCurrentUser("contentSchedules.create")) return;
        modalState = { kind: "schedule", mode: "add", productImage: "", error: "" };
        rerender();
        return;
      }
      if (action === "close-content-modal") {
        modalState = null;
        rerender();
        return;
      }
      if (action === "remove-image") {
        modalState = { ...modalState, productImage: "" };
        rerender();
        return;
      }
      if (action === "export-schedules") {
        if (!canCurrentUser("contentSchedules.export")) return;
        exportSchedules();
        return;
      }
      if (action === "download-template") {
        if (!canCurrentUser("contentSchedules.import")) return;
        downloadTemplate();
        return;
      }
      if (action === "confirm-import") {
        if (!canCurrentUser("contentSchedules.import")) return;
        confirmImport(rerender);
        return;
      }
      if (action === "bulk-create-work-plan") {
        if (actionButton.dataset.status === WorkPlanStatus.Future && !canCurrentUser("contentSchedules.addToFuture")) return;
        if (actionButton.dataset.status === WorkPlanStatus.ThisWeek && !canCurrentUser("contentSchedules.addToThisWeek")) return;
        bulkCreateWorkPlansFromSchedules(actionButton.dataset.status, rerender);
        return;
      }
      if (action === "bulk-cancel-schedules") {
        if (!canCurrentUser("contentSchedules.batchCancel")) return;
        bulkCancelSchedules(rerender);
        return;
      }
      handleScheduleAction(action, actionButton.dataset.scheduleId, rerender);
      return;
    }

    if (event.target.closest("[data-content-schedule-row-select], [data-content-schedule-select-all]") !== null) return;

    const row = event.target.closest("[data-schedule-row-id]");
    if (row === null) return;
    selectedScheduleId = row.dataset.scheduleRowId;
    rerender();
  });

  page.addEventListener("change", (event) => {
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
    scheduleForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveSchedule(event.target, rerender);
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
}

export function renderContentSchedulePage() {
  return `
    <div class="content-schedule-page">
      ${renderFilters()}
      ${renderScheduleTable()}
      ${renderScheduleDetail()}
      ${renderScheduleModal()}
      ${renderImportModal()}
    </div>
  `;
}
