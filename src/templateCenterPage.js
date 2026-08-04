import {
  createTemplate,
  changeTemplateAssetVersionStatus,
  getCurrentUser,
  loadPersistentData,
  loadTemplateAssetVersions,
  loadTemplates,
  resolveAssetUrl,
  prepareTemplateIteration,
  state,
  updateTemplate,
  uploadGenericFile,
  uploadImageFile,
} from "./appState.js";
import { bindStandardWorkLibraryEvents, renderStandardWorkLibraryPage } from "./actionStandardsPage.js?v=20260803-action-product-manual-link1";
import { bindMethodologiesPageEvents, renderMethodologiesPage } from "./methodologiesPage.js?v=20260802-template-version1";
import { bindSettingsPageEvents, renderFormDesignSection } from "./settingsPage.js?v=20260802-template-center-form1";

const materialTypeNames = {
  image: "图片",
  video: "视频",
  design: "设计文件",
  pdf: "PDF",
  zip: "压缩包",
};
const templateVideoExts = new Set(["mp4", "mov", "m4v", "webm"]);
const templateSourceFileAccept = [
  ".psd",
  ".psb",
  ".ai",
  ".fig",
  ".pdf",
  ".zip",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  "application/pdf",
  "application/zip",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
].join(",");

let filters = {
  keyword: "",
  selectedTags: createEmptyTags(),
};
let previewMaterialId = null;
let editingTagsMaterialId = null;
let uploadTags = createEmptyTags();
let uploadTagQuery = "";
let editingTagQuery = "";
let uploadDraft = {
  previewFile: null,
  sourceFile: null,
};
let templatesLoaded = false;
let templatesLoading = false;
let templateError = "";
let templateUploading = false;
let assetCategory = "visual";
let unifiedKeyword = "";
let unifiedOrder = "recent-use";
let unifiedDetail = null;
let versionHistoryAsset = null;
let versionsLoaded = false;
let versionsLoading = false;
let versionError = "";

function createEmptyTags() {
  return Object.fromEntries(getTemplateTagCategories({ includeInactive: true }).map((category) => [category.id, []]));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatUploadTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getFileExt(fileName) {
  return String(fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
}

function detectFileType(file) {
  const ext = getFileExt(file.name);
  if (file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (file.type.startsWith("video/") || templateVideoExts.has(ext)) return "video";
  if (["psd", "psb", "ai", "fig"].includes(ext)) return "design";
  if (ext === "pdf") return "pdf";
  if (ext === "zip") return "zip";
  return null;
}

function detectSourceFileType(file) {
  const ext = getFileExt(file.name);
  if (file.type.startsWith("video/") || templateVideoExts.has(ext)) return "video";
  if (["psd", "psb", "ai", "fig"].includes(ext)) return "design";
  if (ext === "pdf") return "pdf";
  if (ext === "zip") return "zip";
  return null;
}

function normalizeTagName(value) {
  return String(value ?? "").trim();
}

function addUniqueTag(tags, tag) {
  const normalizedTag = normalizeTagName(tag);
  if (normalizedTag === "") return tags;
  if (tags.some((item) => item.toLowerCase() === normalizedTag.toLowerCase())) return tags;
  return [...tags, normalizedTag];
}

function removeTag(tags, tag) {
  const normalizedTag = normalizeTagName(tag).toLowerCase();
  return tags.filter((item) => item.toLowerCase() !== normalizedTag);
}

function hasTag(tags, tag) {
  const normalizedTag = normalizeTagName(tag).toLowerCase();
  return tags.some((item) => item.toLowerCase() === normalizedTag);
}

function sortTemplateTagItem(left, right) {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || String(left.name ?? "").localeCompare(String(right.name ?? ""), "zh-Hans-CN") || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function getTemplateTagCategories({ includeInactive = false } = {}) {
  return (state.templateTagCategories ?? [])
    .filter((category) => includeInactive || category.status !== "inactive")
    .slice()
    .sort(sortTemplateTagItem)
    .map((category) => ({
      ...category,
      label: category.name,
    }));
}

function getTemplateTagsByCategory(categoryId, { includeInactive = false } = {}) {
  return (state.templateTags ?? [])
    .filter((tag) => tag.categoryId === categoryId)
    .filter((tag) => includeInactive || tag.status !== "inactive")
    .slice()
    .sort(sortTemplateTagItem)
    .map((tag) => tag.name);
}

function findTagCategory(tagName) {
  const normalizedTag = normalizeTagName(tagName);
  return getTemplateTagCategories({ includeInactive: true })
    .find((category) => hasTag(getTemplateTagsByCategory(category.id, { includeInactive: true }), normalizedTag))?.id ?? null;
}

function mapLegacyTagToFinal(tagName) {
  const tag = normalizeTagName(tagName);
  const directCategory = findTagCategory(tag);
  if (directCategory !== null) return { categoryId: directCategory, name: tag };

  const mappings = {
    屋范: { categoryId: "brand", name: "屋范" },
    半然: { categoryId: "brand", name: "半然" },
    点意: { categoryId: "brand", name: "点意" },
    青未: { categoryId: "brand", name: "青未" },
    今也: { categoryId: "brand", name: "今也" },
    南颜: { categoryId: "brand", name: "南颜" },
    南屿: { categoryId: "brand", name: "南屿" },
    小红书: { categoryId: "platform", name: "小红书" },
    淘宝: { categoryId: "platform", name: "淘宝" },
    抖音: { categoryId: "platform", name: "抖音" },
    封面: { categoryId: "usage", name: "笔记" },
    主图: { categoryId: "usage", name: "主图" },
    产品图: { categoryId: "usage", name: "主图" },
    详情页: { categoryId: "usage", name: "详情页" },
    种草引流: { categoryId: "usage", name: "笔记" },
    图片: { categoryId: "format", name: "图片" },
    设计源文件: { categoryId: "format", name: "图片" },
    视频: { categoryId: "format", name: "视频" },
    高级感: { categoryId: "tone", name: "品牌感" },
    极简: { categoryId: "tone", name: "品牌感" },
    侘寂风: { categoryId: "tone", name: "品牌感" },
  };

  return mappings[tag] ?? null;
}

function normalizeMaterialTags(tags) {
  const normalizedTags = createEmptyTags();

  const addMappedTag = (tagName) => {
    const mappedTag = mapLegacyTagToFinal(tagName);
    if (mappedTag === null) return;
    normalizedTags[mappedTag.categoryId] = addUniqueTag(normalizedTags[mappedTag.categoryId], mappedTag.name);
  };

  if (Array.isArray(tags)) {
    tags.forEach(addMappedTag);
  } else if (tags && typeof tags === "object") {
    getTemplateTagCategories({ includeInactive: true }).forEach((category) => {
      if (Array.isArray(tags[category.id])) {
        tags[category.id].forEach(addMappedTag);
      }
    });
    Object.entries(tags).forEach(([categoryId, value]) => {
      if (getTemplateTagCategories({ includeInactive: true }).some((category) => category.id === categoryId)) return;
      if (Array.isArray(value)) value.forEach(addMappedTag);
    });
  }

  return normalizedTags;
}

function getMaterialTags(material) {
  return normalizeMaterialTags(material.tags);
}

function generateTemplateName(tags) {
  const normalizedTags = normalizeMaterialTags(tags);
  const selectedTags = getTemplateTagCategories({ includeInactive: true }).flatMap((category) => normalizedTags[category.id] ?? []);
  return selectedTags.filter(Boolean).join(" ") || "未命名模板";
}

function getMaterialName(material) {
  return generateTemplateName(getMaterialTags(material));
}

function getPreviewImage(material) {
  if (material.previewImage && typeof material.previewImage === "object") return material.previewImage;
  if (material.fileType === "image" && material.fileUrl !== "") {
    return {
      fileName: material.fileName ?? "预览图",
      fileUrl: material.fileUrl,
    };
  }
  return {
    fileName: "预览图",
    fileUrl: "",
  };
}

function getSourceFile(material) {
  if (material.sourceFile && typeof material.sourceFile === "object") return material.sourceFile;
  return {
    fileName: material.fileName ?? "源文件",
    fileUrl: material.fileUrl ?? "",
  };
}

function getMaterialFileTypeLabel(material) {
  const sourceExt = getFileExt(getSourceFile(material).fileName);
  if (["psd", "psb", "ai", "fig", "pdf", "zip"].includes(sourceExt)) return sourceExt.toUpperCase();
  return materialTypeNames[material.fileType] ?? "文件";
}

function getMaterials() {
  return state.templates ?? [];
}

function getMaterialUploadTime(material) {
  if (material.uploadTime) return material.uploadTime;
  if (!material.createdAt) return "";
  const date = new Date(material.createdAt);
  return Number.isNaN(date.getTime()) ? material.createdAt : formatUploadTime(date);
}

function getFlatTags(tags) {
  return getTemplateTagCategories({ includeInactive: true }).flatMap((category) => tags[category.id] ?? [])
    .filter((tag, index, list) => list.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index);
}

function hasAnyTag(tags) {
  return getFlatTags(normalizeMaterialTags(tags)).length > 0;
}

function isValidTemplatePayload(payload) {
  return Boolean(payload.previewImage)
    && Boolean(payload.sourceFile)
    && hasAnyTag(payload.tags);
}

function getTemplateErrorText(error) {
  return String(error?.message ?? error ?? "").trim();
}

function normalizeTemplateUploadError(error, { fileKind = "source" } = {}) {
  const message = getTemplateErrorText(error);
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("fetch failed") || lowerMessage.includes("networkerror")) {
    return "无法连接后端服务，请确认当前访问地址正确，并检查 3001 端口是否可访问。";
  }
  if (message.includes("401") || message.includes("未登录") || message.includes("登录") || lowerMessage.includes("unauthorized")) {
    return "登录已过期，请重新登录后再上传。";
  }
  if (message.includes("413") || lowerMessage.includes("too large") || lowerMessage.includes("size") || message.includes("超过")) {
    return fileKind === "preview"
      ? "预览图超过上传限制，请压缩后上传，当前限制为10MB。"
      : "源文件超过上传限制，请压缩后上传，当前限制为600MB。";
  }
  return message || "未知错误";
}

function getFilteredMaterials() {
  const keyword = filters.keyword.trim().toLowerCase();

  return getMaterials().filter((material) => {
    const materialTags = getMaterialTags(material);
    const flatTags = getFlatTags(materialTags);
    const sourceFile = getSourceFile(material);
    const searchableText = `${material.businessCode ?? ""} ${getMaterialName(material)} ${sourceFile.fileName} ${flatTags.join(" ")}`.toLowerCase();

    if (keyword !== "" && !searchableText.includes(keyword)) return false;

    return getTemplateTagCategories({ includeInactive: true }).every((category) => {
      const selectedTags = filters.selectedTags[category.id] ?? [];
      if (selectedTags.length === 0) return true;
      return selectedTags.every((tag) => hasTag(materialTags[category.id] ?? [], tag));
    });
  });
}

function renderTagSelector({ scope, selectedTags }) {
  const flatSelectedTags = getFlatTags(selectedTags);

  return `
    <div class="template-tag-input" data-tag-scope="${escapeHtml(scope)}">
      ${flatSelectedTags.length === 0 ? "" : `
        <div class="template-tag-input-pills">
          ${getTemplateTagCategories({ includeInactive: true }).map((category) => (selectedTags[category.id] ?? []).map((tag) => `
                <span class="template-tag-pill">
                  ${escapeHtml(tag)}
                  <button type="button" data-action="remove-template-input-tag" data-tag-scope="${escapeHtml(scope)}" data-category-id="${escapeHtml(category.id)}" data-tag="${escapeHtml(tag)}" aria-label="删除标签 ${escapeHtml(tag)}">×</button>
                </span>
              `).join("")).join("")}
        </div>
      `}
      <div class="template-tag-group-list">
        ${getTemplateTagCategories().map((category) => {
          const tags = getTemplateTagsByCategory(category.id)
            .filter((tag) => !hasTag(selectedTags[category.id] ?? [], tag));
          return `
            <div class="template-tag-group">
              <h3>${escapeHtml(category.name)}</h3>
              <div class="template-tag-suggestions">
                ${tags.map((tag) => `<button type="button" data-action="select-template-library-tag" data-tag-scope="${escapeHtml(scope)}" data-category-id="${escapeHtml(category.id)}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderTagLibraryFilter() {
  return `
    <div class="template-tag-group-list">
      ${getTemplateTagCategories().map((category) => `
        <div class="template-tag-group">
          <h3>${escapeHtml(category.name)}</h3>
          <div class="template-tag-cloud">
            ${getTemplateTagsByCategory(category.id).map((tag) => `<button class="${hasTag(filters.selectedTags[category.id] ?? [], tag) ? "is-active" : ""}" type="button" data-template-filter-tag="${escapeHtml(tag)}" data-category-id="${escapeHtml(category.id)}">${escapeHtml(tag)}</button>`).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderUploadFileState(file, emptyText) {
  const fileName = file?.name ?? emptyText;
  return fileName === "" ? "" : `<span class="template-upload-file-name">${escapeHtml(fileName)}</span>`;
}

function renderMaterialThumb(material) {
  const previewImage = getPreviewImage(material);
  const videoMarker = material.fileType === "video"
    ? `<span class="template-material-video-marker" aria-label="视频">▶</span>`
    : "";
  if (previewImage.fileUrl !== "") {
    return `<img src="${escapeHtml(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeHtml(getMaterialName(material))}" />${videoMarker}`;
  }
  return videoMarker;
}

function renderMaterialTags(material) {
  return getFlatTags(getMaterialTags(material))
    .map((tag) => `<button type="button" data-template-flat-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
    .join("");
}

function renderMaterialCard(material) {
  const sourceFile = getSourceFile(material);
  const previewImage = getPreviewImage(material);
  const templateName = getMaterialName(material);
  const canPreview = previewImage.fileUrl !== "" || material.fileType === "video";
  const previewDownloadAction = previewImage.fileUrl === ""
    ? `<button class="text-button" type="button" disabled>图片</button>`
    : `<a class="text-button" href="${escapeHtml(resolveAssetUrl(previewImage.fileUrl))}" download="${escapeHtml(previewImage.fileName)}">图片</a>`;
  const sourceDownloadAction = sourceFile.fileUrl === ""
    ? `<button class="text-button" type="button" disabled>源文件</button>`
    : `<a class="text-button" href="${escapeHtml(resolveAssetUrl(sourceFile.fileUrl))}" download="${escapeHtml(sourceFile.fileName)}">源文件</a>`;
  return `
    <article class="template-material-card">
      <div class="template-material-body">
        <div class="template-material-tags">
          ${renderMaterialTags(material)}
        </div>
        <button class="template-material-thumb" type="button" data-action="preview-material" data-material-id="${escapeHtml(material.id)}" ${canPreview ? "" : "disabled"} aria-label="预览 ${escapeHtml(templateName)}">
          ${renderMaterialThumb(material)}
        </button>
        <div class="template-material-title-row">
          <h3 title="${escapeHtml(templateName)}">${escapeHtml(templateName)}</h3>
        </div>
        ${renderVersionControls("visual", material.id)}
        <div class="template-material-code">
          <span>模板编码</span>
          ${
            material.businessCode
              ? `<button type="button" data-action="copy-template-business-code" data-template-business-code="${escapeHtml(material.businessCode)}" title="点击复制完整模板编码">${escapeHtml(material.businessCode)}</button>`
              : `<strong>—</strong>`
          }
          <em aria-live="polite"></em>
        </div>
        <div class="template-material-actions">
          <button class="secondary-button" type="button" data-template-iterate="visual" data-asset-id="${escapeHtml(material.id)}">迭代</button>
          ${previewDownloadAction}
          ${sourceDownloadAction}
        </div>
        <p class="template-material-time">${escapeHtml(getMaterialFileTypeLabel(material))} · ${escapeHtml(getMaterialUploadTime(material))}</p>
      </div>
    </article>
  `;
}

const assetCategories = [
  { id: "visual", name: "视觉模板", description: "图片、设计、拍摄与视频资产" },
  { id: "action", name: "关键行动库", description: "价值链、改善行动与标准流程" },
  { id: "form", name: "表单模板", description: "公共表单、业务表单与流程表单" },
  { id: "standard", name: "任务操作说明书", description: "SOP、操作步骤、执行与验收标准" },
];

const versionStatusNames = { active: "启用", inactive: "停用", archived: "归档", superseded: "历史版本" };

function getAssetVersions(assetType, assetId) {
  return (state.templateAssetVersions ?? []).filter((item) => item.assetType === assetType && item.assetId === assetId)
    .slice().sort((left, right) => right.majorVersion - left.majorVersion || right.minorVersion - left.minorVersion);
}

function getCurrentAssetVersion(assetType, assetId) {
  const versions = getAssetVersions(assetType, assetId);
  return versions.find((item) => item.status === "active") ?? versions[0] ?? null;
}

function renderVersionControls(assetType, assetId) {
  const current = getCurrentAssetVersion(assetType, assetId);
  return `<div class="template-version-controls"><span>${escapeHtml(current?.versionNumber || "V1.0")}</span><em>${escapeHtml(versionStatusNames[current?.status] || (versionsLoading ? "读取中" : "启用"))}</em><button class="text-button" type="button" data-template-version-history="${assetType}" data-asset-id="${escapeHtml(assetId)}">版本历史</button></div>`;
}

function summarizeVersionDifference(version, olderVersion) {
  if (!olderVersion) return "初始版本";
  const keys = new Set([...Object.keys(olderVersion.content ?? {}), ...Object.keys(version.content ?? {})]);
  const changed = [...keys].filter((key) => JSON.stringify(olderVersion.content?.[key]) !== JSON.stringify(version.content?.[key]));
  return changed.length ? `变化字段：${changed.join("、")}` : "内容无差异";
}

function renderVersionHistoryModal() {
  if (!versionHistoryAsset) return "";
  const versions = getAssetVersions(versionHistoryAsset.assetType, versionHistoryAsset.assetId);
  return `<div class="modal-backdrop" role="presentation"><div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="版本历史"><div class="modal-header"><div><h2>版本管理</h2><p class="form-note">历史内容只读保留；启用历史版本会恢复该版本为当前业务版本。</p></div><button class="icon-button" type="button" data-action="close-template-version-history">×</button></div>${versionError ? `<div class="form-error">${escapeHtml(versionError)}</div>` : ""}<div class="template-version-list">${versions.map((version, index) => `<article><div><strong>${escapeHtml(version.versionNumber)}</strong><span>${escapeHtml(versionStatusNames[version.status] || version.status)}</span></div><p>${escapeHtml(version.changeSummary || "未填写修改说明")}</p><p class="form-note">${escapeHtml(summarizeVersionDifference(version, versions[index + 1]))}</p><small>${escapeHtml(version.createdAt)} · 创建人 ${escapeHtml(version.createdBy || "系统迁移")} · 使用 ${version.useCount ?? 0} 次</small><details><summary>查看该版本内容</summary><pre>${escapeHtml(JSON.stringify(version.content, null, 2))}</pre></details><div class="toolbar-actions">${version.status !== "active" && version.status !== "archived" ? `<button class="secondary-button" type="button" data-template-version-action="activate" data-version-id="${escapeHtml(version.id)}">启用</button>` : ""}${version.status === "active" ? `<button class="secondary-button" type="button" data-template-version-action="deactivate" data-version-id="${escapeHtml(version.id)}">停用</button>` : ""}${version.status !== "archived" ? `<button class="text-button" type="button" data-template-version-action="archive" data-version-id="${escapeHtml(version.id)}">归档</button>` : ""}</div></article>`).join("") || `<div class="empty-state">暂无版本记录</div>`}</div><div class="modal-actions"><button class="primary-button" type="button" data-action="close-template-version-history">关闭</button></div></div></div>`;
}

function timestamp(value) {
  const parsed = new Date(value ?? 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestDate(values) {
  return values.filter(Boolean).sort((left, right) => timestamp(right) - timestamp(left))[0] ?? "";
}

function getActionAssets() {
  return (state.taskTemplates ?? []).map((item) => {
    const process = (state.processTemplates ?? []).find((candidate) => candidate.id === item.defaultProcessTemplateId);
    const nodes = (state.processTemplateNodes ?? []).filter((node) => node.templateId === process?.id);
    const instances = (state.processInstances ?? []).filter((instance) => instance.taskTemplateId === item.id || instance.templateId === process?.id);
    return { id: item.id, category: "action", title: item.name, code: item.businessCode, description: item.description || item.completionStandard || "未填写说明", status: item.status,
      tags: [process ? `流程 v${process.version ?? 1}` : "未绑定流程", `${nodes.length}个标准节点`, item.needAcceptance ? "需要验收" : "无需验收"],
      content: process ? `${process.name}；${nodes.map((node) => node.name).join(" → ") || "尚未配置节点"}` : "尚未绑定关键行动标准流程",
      scene: process?.purpose || item.description || "用于创建关键行动并生成标准任务",
      references: [`流程：${process?.name || "未绑定"}`, `节点：${nodes.length}`, `已发起关键行动：${instances.length}`],
      useCount: instances.length, lastUsedAt: latestDate(instances.map((instance) => instance.startedAt || instance.createdAt)), updatedAt: item.updatedAt || item.createdAt,
      href: "#processes" };
  });
}

function getFormAssets() {
  const formal = (state.standardWorkForms ?? []).map((form) => {
    const action = (state.taskTemplates ?? []).find((item) => item.id === form.standardWorkId);
    const fields = form.formSchema?.fields ?? [];
    const tasks = (state.tasks ?? []).filter((task) => task.standardWorkId === form.standardWorkId || task.taskTemplateId === form.standardWorkId);
    return { id: form.id, category: "form", versionAssetType: "form", versionAssetId: form.id, title: `${action?.name || "关键行动"}表单`, code: action?.businessCode, description: "正式版本化公共表单", status: action?.status || "active", formType: "公共表单", fields,
      tags: ["公共表单", `${fields.length}个字段`], content: fields.map((field) => field.label || field.name).filter(Boolean).join("、") || "空表单",
      scene: "用于关键行动、任务提交与工作结果记录", references: [`行动模板：${action?.name || form.standardWorkId}`, `任务引用：${tasks.length}`],
      useCount: tasks.length, lastUsedAt: latestDate(tasks.map((task) => task.completedAt || task.updatedAt || task.createdAt)), updatedAt: form.updatedAt || form.createdAt, href: "#processes" };
  });
  const inline = (state.taskTemplates ?? []).filter((item) => Array.isArray(item.formFields) && item.formFields.length).map((item) => {
    const tasks = (state.tasks ?? []).filter((task) => task.taskTemplateId === item.id);
    return { id: `inline-${item.id}`, category: "form", versionAssetType: "action", versionAssetId: item.id, title: `${item.name}任务表单`, code: item.businessCode, description: "关键行动内嵌业务表单", status: item.status, formType: "业务表单", fields: item.formFields,
      tags: ["任务表单", `${item.formFields.length}个字段`], content: item.formFields.map((field) => field.label || field.name).filter(Boolean).join("、"),
      scene: "用于该行动模板生成任务后的提交与验收", references: [`行动模板：${item.name}`, `任务引用：${tasks.length}`], useCount: tasks.length,
      lastUsedAt: latestDate(tasks.map((task) => task.completedAt || task.updatedAt || task.createdAt)), updatedAt: item.updatedAt || item.createdAt, href: "#processes" };
  });
  return [...formal, ...inline];
}

function getStandardAssets() {
  const methodologyAssets = (state.methodologies ?? []).map((item) => {
    const action = (state.taskTemplates ?? []).find((candidate) => candidate.id === item.taskTemplateId || candidate.id === item.standardWorkId);
    const node = (state.processTemplateNodes ?? []).find((candidate) => candidate.id === item.processNodeId);
    const tasks = (state.tasks ?? []).filter((task) => task.processNodeId === item.processNodeId || task.taskTemplateId === item.taskTemplateId);
    const steps = Array.isArray(item.steps) ? item.steps : [];
    return { id: item.id, category: "standard", title: item.title, description: item.description || "未填写说明", status: "active",
      tags: [node ? "节点作业标准" : "通用方法论", `${steps.length}个步骤`], content: steps.map((step) => step.title || step.name || step).join(" → ") || item.description || "暂无步骤",
      scene: action ? `适用于行动模板：${action.name}` : node ? `适用于标准节点：${node.name}` : "企业通用工作标准",
      references: [`行动模板：${action?.name || "未绑定"}`, `标准节点：${node?.name || "未绑定"}`, `任务引用：${tasks.length}`], useCount: tasks.length,
      lastUsedAt: latestDate(tasks.map((task) => task.completedAt || task.updatedAt || task.createdAt)), updatedAt: item.updatedAt || item.createdAt,
      href: `#methodology-${item.id}` };
  });
  const methodologyNodeIds = new Set((state.methodologies ?? []).map((item) => item.processNodeId).filter(Boolean));
  const nodeAssets = (state.processTemplateNodes ?? []).filter((node) => !methodologyNodeIds.has(node.id)).map((node) => {
    const process = (state.processTemplates ?? []).find((item) => item.id === node.templateId);
    const action = (state.taskTemplates ?? []).find((item) => item.defaultProcessTemplateId === node.templateId);
    const tasks = (state.tasks ?? []).filter((task) => task.processNodeId === node.id);
    const standards = [node.completionStandard, node.reviewStandard, node.outputRequirement].filter(Boolean);
    return { id: `node-${node.id}`, category: "standard", title: `${node.name}工作标准`, description: node.description || node.completionStandard || "流程节点作业标准", status: node.status,
      tags: [node.needAcceptance ? "检查标准" : "作业标准", node.submitType || "任务执行"], content: standards.join("；") || "尚未填写完成与检查标准",
      scene: `${process?.name || "关键行动流程"} · ${node.stageName || "标准步骤"}`,
      references: [`行动模板：${action?.name || "未绑定"}`, `流程：${process?.name || node.templateId}`, `任务引用：${tasks.length}`], useCount: tasks.length,
      lastUsedAt: latestDate(tasks.map((task) => task.completedAt || task.updatedAt || task.createdAt)), updatedAt: node.updatedAt || node.createdAt, href: "#processes" };
  });
  return [...methodologyAssets, ...nodeAssets];
}

function getUnifiedAssets() {
  if (assetCategory === "action") return getActionAssets();
  if (assetCategory === "form") return getFormAssets();
  if (assetCategory === "standard") return getStandardAssets();
  return [];
}

function filteredUnifiedAssets() {
  const keyword = unifiedKeyword.trim().toLowerCase();
  return getUnifiedAssets().filter((item) => `${item.title} ${item.code || ""} ${item.description} ${item.tags.join(" ")} ${item.content}`.toLowerCase().includes(keyword))
    .sort((left, right) => unifiedOrder === "name" ? left.title.localeCompare(right.title, "zh-Hans-CN") : unifiedOrder === "recent-update" ? timestamp(right.updatedAt) - timestamp(left.updatedAt) : timestamp(right.lastUsedAt || right.updatedAt) - timestamp(left.lastUsedAt || left.updatedAt));
}

function renderUnifiedDetail() {
  if (!unifiedDetail) return "";
  const item = getUnifiedAssets().find((candidate) => candidate.id === unifiedDetail);
  if (!item) return "";
  const formPreview = item.category === "form" ? `<section class="template-form-preview"><h3>完整字段结构与布局</h3><div class="template-form-preview-grid">${(item.fields ?? []).map((field) => `<div class="template-form-preview-field" style="--field-span:${Math.min(12, Math.max(1, Number(field.width) || 12))}"><span>${escapeHtml(field.label || field.name || "未命名字段")}${field.required ? " *" : ""}</span><small>${escapeHtml(field.type || "text")} · 宽度 ${escapeHtml(field.width || 12)}/12</small><div>${escapeHtml(field.placeholder || field.defaultValue || "字段输入区域")}</div></div>`).join("") || `<div class="empty-state compact">当前表单尚未配置字段</div>`}</div></section>` : "";
  return `<div class="modal-backdrop" role="presentation"><div class="modal-panel wide-modal template-asset-detail" role="dialog" aria-modal="true" aria-label="模板详情">
    <div class="modal-header"><div><h2>${escapeHtml(item.title)}</h2><p class="form-note">${escapeHtml(item.code || "无独立编码")} · ${escapeHtml(item.tags.join(" · "))}</p></div><button class="icon-button" type="button" data-action="close-unified-template-detail">×</button></div>
    ${formPreview}
    <div class="template-asset-detail-grid"><section><h3>模板内容</h3><p>${escapeHtml(item.content)}</p></section><section><h3>使用场景</h3><p>${escapeHtml(item.scene)}</p></section><section><h3>使用记录</h3><p>累计引用 ${item.useCount} 次</p><p>最近使用：${escapeHtml(item.lastUsedAt || "暂无使用记录")}</p></section><section><h3>引用关系</h3>${item.references.map((reference) => `<p>${escapeHtml(reference)}</p>`).join("")}</section></div>
    <div class="modal-actions"><a class="secondary-button" href="${item.category === "form" ? "#templateCenter/form-design" : escapeHtml(item.href)}">进入完整编辑</a><button class="primary-button" type="button" data-action="close-unified-template-detail">关闭</button></div>
  </div></div>`;
}

function renderUnifiedLibrary() {
  const items = filteredUnifiedAssets();
  return `<div class="template-unified-library"><div class="section-heading"><div><h2>${escapeHtml(assetCategories.find((item) => item.id === assetCategory)?.name)}</h2><p class="form-note">统一查看内容、使用场景、使用记录和引用关系；底层数据与业务引用保持不变。</p></div><div class="template-unified-tools"><input type="search" data-unified-template-keyword value="${escapeHtml(unifiedKeyword)}" placeholder="搜索名称、编码、内容或标签"/><select data-unified-template-order><option value="recent-use" ${unifiedOrder === "recent-use" ? "selected" : ""}>最近使用</option><option value="recent-update" ${unifiedOrder === "recent-update" ? "selected" : ""}>最近更新</option><option value="name" ${unifiedOrder === "name" ? "selected" : ""}>名称</option></select></div></div>
    <div class="template-asset-grid">${items.map((item) => `<article class="template-asset-card"><div class="template-asset-card-head"><span>${escapeHtml(assetCategories.find((category) => category.id === item.category)?.name)}</span><em>${escapeHtml(item.status || "—")}</em></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p>${item.category === "form" ? `<dl class="template-form-card-meta"><div><dt>使用场景</dt><dd>${escapeHtml(item.scene)}</dd></div><div><dt>表单类型</dt><dd>${escapeHtml(item.formType || "业务表单")}</dd></div><div><dt>更新时间</dt><dd>${escapeHtml(item.updatedAt || "暂无记录")}</dd></div></dl>${renderVersionControls(item.versionAssetType, item.versionAssetId)}<div class="toolbar-actions"><button class="secondary-button" type="button" data-template-iterate="${item.versionAssetType}" data-asset-id="${escapeHtml(item.versionAssetId)}">迭代</button><button class="text-button" type="button" data-unified-template-detail="${escapeHtml(item.id)}">查看详情</button></div>` : `<div class="template-asset-tags">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><small>引用 ${item.useCount} 次 · ${escapeHtml(item.lastUsedAt ? `最近使用 ${item.lastUsedAt}` : "暂无使用记录")}</small><button class="secondary-button" type="button" data-unified-template-detail="${escapeHtml(item.id)}">查看详情</button>`}</article>`).join("") || `<div class="empty-state">没有符合条件的模板资产</div>`}</div>${renderUnifiedDetail()}</div>`;
}

function renderPreviewModal() {
  const material = getMaterials().find((item) => item.id === previewMaterialId);
  if (material === undefined) return "";
  const previewImage = getPreviewImage(material);
  const sourceFile = getSourceFile(material);
  const previewDownloadAction = previewImage.fileUrl === ""
    ? `<button class="secondary-button" type="button" disabled>下载预览图</button>`
    : `<a class="secondary-button" href="${escapeHtml(resolveAssetUrl(previewImage.fileUrl))}" download="${escapeHtml(previewImage.fileName)}">下载预览图</a>`;

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="素材预览">
        <div class="modal-header">
          <div>
            <h2>${escapeHtml(getMaterialName(material))}</h2>
            <p class="form-note">模板编码：${escapeHtml(material.businessCode || "—")} · ${escapeHtml(getMaterialFileTypeLabel(material))} · ${escapeHtml(getMaterialUploadTime(material))}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-template-preview" aria-label="关闭">×</button>
        </div>
        <div class="template-preview-body">
          ${previewImage.fileUrl === ""
            ? material.fileType === "video"
              ? `<div class="template-design-preview"><span class="template-video-preview-icon" aria-hidden="true">▶</span><strong>${escapeHtml(sourceFile.fileName)}</strong><span class="form-note">视频文件</span></div>`
              : `<div class="template-design-preview"><strong>${escapeHtml(previewImage.fileName)}</strong><span class="form-note">暂无预览图</span></div>`
            : `<img src="${escapeHtml(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeHtml(getMaterialName(material))}" />`
          }
        </div>
        <div class="modal-actions">
          ${previewDownloadAction}
          <button class="secondary-button" type="button" data-action="close-template-preview">关闭</button>
        </div>
      </div>
    </div>
  `;
}

function renderEditTagsModal() {
  const material = getMaterials().find((item) => item.id === editingTagsMaterialId);
  if (material === undefined) return "";
  const previewImage = getPreviewImage(material);
  const sourceFile = getSourceFile(material);

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="编辑模板">
        <div class="modal-header">
          <div>
            <h2>编辑模板</h2>
            <p class="form-note">${escapeHtml(getMaterialName(material))}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-template-tags" aria-label="关闭">×</button>
        </div>
        <form class="template-tags-form">
          <div class="template-file-pair">
            <label class="template-file-picker">
              <span>替换预览图</span>
              ${renderUploadFileState(null, previewImage.fileName)}
              <input data-template-edit-preview-upload type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
            </label>
            <label class="template-file-picker">
              <span>替换源文件</span>
              ${renderUploadFileState(null, sourceFile.fileName)}
              <input data-template-edit-source-upload type="file" accept="${templateSourceFileAccept}" />
            </label>
          </div>
          ${renderTagSelector({
            scope: "edit",
            selectedTags: getMaterialTags(material),
          })}
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="close-template-tags">取消</button>
            <button class="primary-button" type="submit">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderTemplateCenterPage() {
  const route = window.location.hash.replace(/^#/, "");
  const showingFormDesigner = route === "templateCenter/form-design";
  if (showingFormDesigner) assetCategory = "form";
  const visibleMaterials = getFilteredMaterials();
  const canCreateTemplate = !templateUploading && isValidTemplatePayload({
    previewImage: uploadDraft.previewFile,
    sourceFile: uploadDraft.sourceFile,
    tags: uploadTags,
  });

  return `
    <section class="template-center-page">
      <header class="template-center-hero"><div><h1>模板中心</h1><p>企业视觉、改善行动、业务表单与任务操作标准的统一入口</p></div></header>
      <nav class="template-asset-tabs" aria-label="模板分类">${assetCategories.map((item) => `<button class="${assetCategory === item.id ? "is-active" : ""}" type="button" data-template-asset-category="${item.id}"><strong>${item.name}</strong><span>${item.description}</span></button>`).join("")}</nav>
      ${assetCategory === "action" ? renderStandardWorkLibraryPage() : assetCategory === "standard" ? renderMethodologiesPage(getCurrentUser()) : showingFormDesigner ? `<div class="template-form-designer-header"><a class="text-button" href="#templateCenter">← 返回表单模板</a><h2>表单设计</h2><p class="form-note">继续使用原关键行动公共表单设计能力，保存后原业务引用立即生效。</p></div>${renderFormDesignSection()}` : assetCategory === "form" ? renderUnifiedLibrary() : `
      <div class="template-upload-taxonomy">
        <div class="template-upload-line">
          <label class="template-file-picker">
            <span>预览图</span>
            ${renderUploadFileState(uploadDraft.previewFile, "")}
            <input data-template-preview-upload type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" />
          </label>
          <label class="template-file-picker">
            <span>源文件</span>
            ${renderUploadFileState(uploadDraft.sourceFile, "")}
            <input data-template-source-upload type="file" accept="${templateSourceFileAccept}" />
          </label>
          <button class="primary-button template-upload-submit" type="button" data-action="create-template-from-upload" ${canCreateTemplate ? "" : "disabled"}>上传模板</button>
        </div>
        ${templateError === "" ? "" : `<div class="form-error">${escapeHtml(templateError)}</div>`}
        ${renderTagSelector({
          scope: "upload",
          selectedTags: uploadTags,
        })}
      </div>
      <div class="template-center-layout">
        <aside class="template-filter-panel">
          <h2>筛选</h2>
          ${renderTagLibraryFilter()}
        </aside>
        <div class="template-material-list">
          <div class="section-heading">
            <h2>模板列表</h2>
            <input class="template-material-search" type="search" value="${escapeHtml(filters.keyword)}" placeholder="搜索模板名称、编码、文件或标签" data-template-keyword autocomplete="off" />
          </div>
          ${
            visibleMaterials.length === 0
              ? ""
              : `<div class="template-material-grid">${visibleMaterials.map(renderMaterialCard).join("")}</div>`
          }
        </div>
      </div>
      `}
      ${renderPreviewModal()}
      ${renderEditTagsModal()}
      ${renderVersionHistoryModal()}
    </section>
  `;
}

export function bindTemplateCenterPageEvents(rerender) {
  const page = document.querySelector(".template-center-page");
  if (page === null) return;

  page.querySelectorAll("[data-template-asset-category]").forEach((button) => button.addEventListener("click", () => { assetCategory = button.dataset.templateAssetCategory; unifiedDetail = null; if (window.location.hash === "#templateCenter/form-design") window.history.replaceState(null, "", "#templateCenter"); rerender(); }));
  if (assetCategory === "action") bindStandardWorkLibraryEvents(rerender, page);
  if (assetCategory === "standard") bindMethodologiesPageEvents(rerender);
  if (window.location.hash === "#templateCenter/form-design") bindSettingsPageEvents(rerender);

  if (!versionsLoaded && !versionsLoading) {
    versionsLoading = true;
    loadTemplateAssetVersions()
      .then(() => { versionError = ""; })
      .catch((error) => {
        console.error("模板版本读取失败", error);
        versionError = "模板版本读取失败，请检查本地数据库服务。";
      })
      .finally(() => {
        versionsLoaded = true;
        versionsLoading = false;
        rerender();
      });
  }

  page.querySelectorAll("[data-template-version-history]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    versionHistoryAsset = { assetType: button.dataset.templateVersionHistory, assetId: button.dataset.assetId };
    rerender();
  }));
  page.querySelectorAll('[data-action="close-template-version-history"]').forEach((button) => button.addEventListener("click", () => {
    versionHistoryAsset = null;
    rerender();
  }));
  page.querySelectorAll("[data-template-version-action]").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!versionHistoryAsset) return;
    const action = button.dataset.templateVersionAction;
    if (action === "archive" && !window.confirm("归档后将退出日常使用，但历史和引用仍会保留。确认归档？")) return;
    try {
      versionError = "";
      await changeTemplateAssetVersionStatus(versionHistoryAsset.assetType, versionHistoryAsset.assetId, button.dataset.versionId, action);
      await loadPersistentData();
      await loadTemplateAssetVersions(versionHistoryAsset.assetType, versionHistoryAsset.assetId);
    } catch (error) {
      versionError = error.message || "模板版本状态更新失败。";
    }
    rerender();
  }));
  page.querySelectorAll("[data-template-iterate]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const assetType = button.dataset.templateIterate;
    const assetId = button.dataset.assetId;
    const changeSummary = window.prompt("请输入本次迭代说明：", "内容迭代");
    if (changeSummary === null) return;
    const bump = window.confirm("是否升级为大版本（例如 V1.1 → V2.0）？\n选择“取消”将生成小版本。") ? "major" : "minor";
    prepareTemplateIteration(assetType, assetId, { bump, changeSummary });
    if (assetType === "visual") {
      editingTagsMaterialId = assetId;
      editingTagQuery = "";
      rerender();
      return;
    }
    if (assetType === "form") {
      window.location.hash = "templateCenter/form-design";
      return;
    }
    if (assetType === "action") {
      const editButton = [...page.querySelectorAll('[data-action="edit-task-template"]')].find((candidate) => candidate.dataset.templateId === assetId);
      editButton?.click();
      return;
    }
    if (assetType === "manual") {
      const editButton = [...page.querySelectorAll('[data-action="edit-methodology"]')].find((candidate) => candidate.dataset.methodologyId === assetId);
      if (editButton) editButton.click();
      else window.location.hash = `methodology-${assetId}`;
    }
  }));
  page.querySelector("[data-unified-template-keyword]")?.addEventListener("input", (event) => { unifiedKeyword = event.target.value; rerender(); window.requestAnimationFrame(() => { const input = document.querySelector("[data-unified-template-keyword]"); input?.focus(); input?.setSelectionRange(event.target.value.length, event.target.value.length); }); });
  page.querySelector("[data-unified-template-order]")?.addEventListener("change", (event) => { unifiedOrder = event.target.value; rerender(); });
  page.querySelectorAll("[data-unified-template-detail]").forEach((button) => button.addEventListener("click", () => { unifiedDetail = button.dataset.unifiedTemplateDetail; rerender(); }));
  page.querySelectorAll('[data-action="close-unified-template-detail"]').forEach((button) => button.addEventListener("click", () => { unifiedDetail = null; rerender(); }));

  page.querySelector("[data-template-keyword]")?.addEventListener("input", (event) => {
    filters.keyword = event.target.value;
    const selectionStart = event.target.selectionStart;
    const selectionEnd = event.target.selectionEnd;
    rerender();
    window.requestAnimationFrame(() => {
      const input = document.querySelector("[data-template-keyword]");
      if (input === null) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(selectionStart, selectionEnd);
    });
  });

  const getSelectedTagsByScope = (scope) => {
    if (scope === "upload") return uploadTags;
    if (scope === "filter") return filters.selectedTags;
    if (scope === "edit" && editingTagsMaterialId !== null) {
      const material = getMaterials().find((item) => item.id === editingTagsMaterialId);
      return material === undefined ? createEmptyTags() : getMaterialTags(material);
    }
    return createEmptyTags();
  };

  const updateSelectedTagsByScope = (scope, categoryId, transform) => {
    if (scope === "upload") {
      uploadTags = { ...uploadTags, [categoryId]: transform(uploadTags[categoryId] ?? []) };
      return;
    }
    if (scope === "filter") {
      filters = {
        ...filters,
        selectedTags: { ...filters.selectedTags, [categoryId]: transform(filters.selectedTags[categoryId] ?? []) },
      };
      return;
    }
    if (scope === "edit" && editingTagsMaterialId !== null) {
      const nextTemplates = state.templates.map((material) => (
        material.id === editingTagsMaterialId
          ? (() => {
              const nextTags = { ...getMaterialTags(material), [categoryId]: transform(getMaterialTags(material)[categoryId] ?? []) };
              return {
                ...material,
                name: generateTemplateName(nextTags),
                tags: nextTags,
              };
            })()
          : material
      ));
      state.templates.splice(0, state.templates.length, ...nextTemplates);
    }
  };

  const updateQueryByScope = (scope, value) => {
    if (scope === "upload") {
      uploadTagQuery = value;
      return;
    }
    if (scope === "edit") editingTagQuery = value;
  };

  page.querySelector("[data-template-preview-upload]")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (file !== null && detectFileType(file) !== "image") {
      event.currentTarget.value = "";
      return;
    }
    uploadDraft = { ...uploadDraft, previewFile: file };
    rerender();
  });

  page.querySelector("[data-template-source-upload]")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (file !== null && detectSourceFileType(file) === null) {
      event.currentTarget.value = "";
      return;
    }
    uploadDraft = { ...uploadDraft, sourceFile: file };
    rerender();
  });

  if (!templatesLoaded && !templatesLoading) {
    templatesLoading = true;
    loadTemplates()
      .then(() => {
        templatesLoaded = true;
        templateError = "";
      })
      .catch((error) => {
        console.error("模板列表读取失败", error);
        templateError = "模板列表读取失败，请检查本地数据库服务。";
      })
      .finally(() => {
        templatesLoading = false;
        rerender();
      });
  }

  page.querySelector("[data-action='create-template-from-upload']")?.addEventListener("click", async () => {
    if (!isValidTemplatePayload({
      previewImage: uploadDraft.previewFile,
      sourceFile: uploadDraft.sourceFile,
      tags: uploadTags,
    })) return;
    const sourceFileType = detectSourceFileType(uploadDraft.sourceFile);
    if (sourceFileType === null) return;
    const tags = normalizeMaterialTags(uploadTags);
    if (!isValidTemplatePayload({
      previewImage: uploadDraft.previewFile,
      sourceFile: uploadDraft.sourceFile,
      tags,
    })) return;
    const templateName = generateTemplateName(tags);
    templateUploading = true;
    templateError = "";
    rerender();
    try {
      let previewUpload;
      try {
        previewUpload = await uploadImageFile(uploadDraft.previewFile);
      } catch (error) {
        throw new Error(`预览图上传失败：${normalizeTemplateUploadError(error, { fileKind: "preview" })}`);
      }
      let sourceUpload;
      try {
        sourceUpload = await uploadGenericFile(uploadDraft.sourceFile);
      } catch (error) {
        throw new Error(`源文件上传失败：${normalizeTemplateUploadError(error, { fileKind: "source" })}`);
      }
      const now = new Date().toISOString();
      try {
        await createTemplate({
          id: createId("template-material"),
          name: templateName,
          previewImage: {
            fileName: uploadDraft.previewFile.name,
            fileUrl: previewUpload.url,
          },
          sourceFile: {
            fileName: sourceUpload.originalName ?? uploadDraft.sourceFile.name,
            fileUrl: sourceUpload.url,
          },
          fileType: sourceFileType,
          tags,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        throw new Error(`模板信息保存失败：${normalizeTemplateUploadError(error, { fileKind: "source" })}`);
      }
      uploadDraft = {
        previewFile: null,
        sourceFile: null,
      };
      uploadTags = createEmptyTags();
      uploadTagQuery = "";
      await loadTemplates();
      templatesLoaded = true;
    } catch (error) {
      console.error("模板保存失败", error);
      templateError = getTemplateErrorText(error) || "模板保存失败，请检查本地数据库服务。";
    } finally {
      templateUploading = false;
      rerender();
    }
  });

  page.querySelector("[data-template-edit-preview-upload]")?.addEventListener("change", (event) => {
    if (editingTagsMaterialId === null) return;
    const file = event.currentTarget.files?.[0] ?? null;
    if (file === null) return;
    if (detectFileType(file) !== "image") {
      event.currentTarget.value = "";
      return;
    }
    uploadImageFile(file)
      .then((uploaded) => {
        const material = getMaterials().find((item) => item.id === editingTagsMaterialId);
        if (material === undefined) return;
        return updateTemplate(material.id, {
          ...material,
          previewImage: {
            fileName: file.name,
            fileUrl: uploaded.url,
          },
          updatedAt: new Date().toISOString(),
        });
      })
      .then(() => loadTemplates())
      .then(() => {
        templatesLoaded = true;
        rerender();
      })
      .catch((error) => {
        console.error("模板预览图更新失败", error);
        templateError = "模板保存失败，请检查本地数据库服务。";
        rerender();
      });
  });

  page.querySelector("[data-template-edit-source-upload]")?.addEventListener("change", (event) => {
    if (editingTagsMaterialId === null) return;
    const file = event.currentTarget.files?.[0] ?? null;
    if (file === null) return;
    const sourceFileType = detectSourceFileType(file);
    if (sourceFileType === null) {
      event.currentTarget.value = "";
      return;
    }
    uploadGenericFile(file)
      .then((uploaded) => {
        const material = getMaterials().find((item) => item.id === editingTagsMaterialId);
        if (material === undefined) return;
        return updateTemplate(material.id, {
          ...material,
          sourceFile: {
            fileName: uploaded.originalName ?? file.name,
            fileUrl: uploaded.url,
          },
          fileType: sourceFileType,
          updatedAt: new Date().toISOString(),
        });
      })
      .then(() => loadTemplates())
      .then(() => {
        templatesLoaded = true;
        rerender();
      })
      .catch((error) => {
        console.error("模板源文件更新失败", error);
        templateError = "模板保存失败，请检查本地数据库服务。";
        rerender();
      });
  });

  page.querySelectorAll("[data-action='select-template-library-tag']").forEach((button) => {
    button.addEventListener("click", () => {
      updateSelectedTagsByScope(
        button.dataset.tagScope ?? "",
        button.dataset.categoryId ?? "",
        (selectedTags) => addUniqueTag(selectedTags, button.dataset.tag ?? ""),
      );
      updateQueryByScope(button.dataset.tagScope ?? "", "");
      rerender();
    });
  });

  page.querySelectorAll("[data-action='remove-template-input-tag']").forEach((button) => {
    button.addEventListener("click", () => {
      updateSelectedTagsByScope(
        button.dataset.tagScope ?? "",
        button.dataset.categoryId ?? "",
        (selectedTags) => removeTag(selectedTags, button.dataset.tag ?? ""),
      );
      rerender();
    });
  });

  page.querySelectorAll("[data-template-filter-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      updateSelectedTagsByScope("filter", button.dataset.categoryId ?? "", (selectedTags) => (
        hasTag(selectedTags, button.dataset.templateFilterTag ?? "")
          ? removeTag(selectedTags, button.dataset.templateFilterTag ?? "")
          : addUniqueTag(selectedTags, button.dataset.templateFilterTag ?? "")
      ));
      rerender();
    });
  });

  page.querySelectorAll("[data-template-flat-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      const mappedTag = mapLegacyTagToFinal(button.dataset.templateFlatTag ?? "");
      if (mappedTag === null) return;
      updateSelectedTagsByScope("filter", mappedTag.categoryId, (selectedTags) => addUniqueTag(selectedTags, mappedTag.name));
      rerender();
    });
  });

  page.querySelectorAll("[data-action='preview-material']").forEach((button) => {
    button.addEventListener("click", () => {
      previewMaterialId = button.dataset.materialId ?? null;
      rerender();
    });
  });

  page.querySelectorAll("[data-action='copy-template-business-code']").forEach((button) => {
    button.addEventListener("click", async () => {
      const businessCode = button.dataset.templateBusinessCode ?? "";
      if (businessCode === "") return;
      try {
        await navigator.clipboard.writeText(businessCode);
        const feedback = button.parentElement?.querySelector("em");
        if (feedback !== null && feedback !== undefined) {
          feedback.textContent = "已复制";
          feedback.classList.add("is-visible");
          window.setTimeout(() => feedback.classList.remove("is-visible"), 1200);
        }
      } catch {
        templateError = "复制失败，请手工选择模板编码。";
        rerender();
      }
    });
  });

  page.querySelectorAll("[data-action='edit-material-tags']").forEach((button) => {
    button.addEventListener("click", () => {
      editingTagsMaterialId = button.dataset.materialId ?? null;
      editingTagQuery = "";
      rerender();
    });
  });

  page.querySelector("[data-action='close-template-preview']")?.addEventListener("click", () => {
    previewMaterialId = null;
    rerender();
  });

  page.querySelectorAll("[data-action='close-template-tags']").forEach((button) => {
    button.addEventListener("click", () => {
      editingTagsMaterialId = null;
      editingTagQuery = "";
      rerender();
    });
  });

  page.querySelector(".template-tags-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const material = getMaterials().find((item) => item.id === editingTagsMaterialId);
    if (material === undefined) {
      editingTagsMaterialId = null;
      editingTagQuery = "";
      rerender();
      return;
    }
    try {
      const tags = getMaterialTags(material);
      await updateTemplate(material.id, {
        ...material,
        name: generateTemplateName(tags),
        tags,
        updatedAt: new Date().toISOString(),
      });
      await loadTemplates();
      templatesLoaded = true;
      editingTagsMaterialId = null;
      editingTagQuery = "";
      templateError = "";
    } catch (error) {
      console.error("模板标签保存失败", error);
      templateError = "模板保存失败，请检查本地数据库服务。";
    }
    rerender();
  });
}
