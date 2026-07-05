import {
  createTemplate,
  loadTemplates,
  resolveAssetUrl,
  state,
  updateTemplate,
  uploadGenericFile,
  uploadImageFile,
} from "./appState.js?v=20260705-state-singleton1";

const materialTypeNames = {
  image: "图片",
  video: "视频",
  design: "设计文件",
  zip: "压缩包",
};

const tagCategories = [
  { id: "brand", label: "品牌 Brand" },
  { id: "platform", label: "平台 Platform" },
  { id: "tone", label: "调性 Tone" },
  { id: "format", label: "形式 Format" },
  { id: "usage", label: "用途 Usage" },
];

let tagLibrary = {
  brand: ["半然", "点意", "青未", "今也", "屋范", "chicfun", "南颜", "南屿"],
  platform: ["淘宝", "小红书", "抖音"],
  usage: ["首页", "详情页", "主图", "sku图", "笔记", "买家秀"],
  format: ["图片", "视频"],
  tone: ["品牌感", "网红感", "活人感", "专家感"],
};

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

function createEmptyTags() {
  return Object.fromEntries(tagCategories.map((category) => [category.id, []]));
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
  if (file.type.startsWith("video/") || ["mp4", "mov"].includes(ext)) return "video";
  if (["psd", "ai", "fig"].includes(ext)) return "design";
  if (ext === "zip") return "zip";
  return null;
}

function detectSourceFileType(file) {
  const ext = getFileExt(file.name);
  if (["psd", "ai", "fig"].includes(ext)) return "design";
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

function findTagCategory(tagName) {
  const normalizedTag = normalizeTagName(tagName);
  return tagCategories.find((category) => hasTag(tagLibrary[category.id] ?? [], normalizedTag))?.id ?? null;
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
    tagCategories.forEach((category) => {
      if (Array.isArray(tags[category.id])) {
        tags[category.id].forEach(addMappedTag);
      }
    });
    Object.entries(tags).forEach(([categoryId, value]) => {
      if (tagCategories.some((category) => category.id === categoryId)) return;
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
  const selectedTags = tagCategories.flatMap((category) => normalizedTags[category.id] ?? []);
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
  return tagCategories.flatMap((category) => tags[category.id] ?? [])
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

function getFilteredMaterials() {
  const keyword = filters.keyword.trim().toLowerCase();

  return getMaterials().filter((material) => {
    const materialTags = getMaterialTags(material);
    const flatTags = getFlatTags(materialTags);
    const sourceFile = getSourceFile(material);
    const searchableText = `${getMaterialName(material)} ${sourceFile.fileName} ${flatTags.join(" ")}`.toLowerCase();

    if (keyword !== "" && !searchableText.includes(keyword)) return false;

    return tagCategories.every((category) => {
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
          ${tagCategories.map((category) => (selectedTags[category.id] ?? []).map((tag) => `
                <span class="template-tag-pill">
                  ${escapeHtml(tag)}
                  <button type="button" data-action="remove-template-input-tag" data-tag-scope="${escapeHtml(scope)}" data-category-id="${escapeHtml(category.id)}" data-tag="${escapeHtml(tag)}" aria-label="删除标签 ${escapeHtml(tag)}">×</button>
                </span>
              `).join("")).join("")}
        </div>
      `}
      <div class="template-tag-group-list">
        ${tagCategories.map((category) => {
          const tags = (tagLibrary[category.id] ?? [])
            .filter((tag) => !hasTag(selectedTags[category.id] ?? [], tag));
          return `
            <div class="template-tag-group">
              <h3>${escapeHtml(category.label)}</h3>
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
      ${tagCategories.map((category) => `
        <div class="template-tag-group">
          <h3>${escapeHtml(category.label)}</h3>
          <div class="template-tag-cloud">
            ${(tagLibrary[category.id] ?? []).map((tag) => `<button class="${hasTag(filters.selectedTags[category.id] ?? [], tag) ? "is-active" : ""}" type="button" data-template-filter-tag="${escapeHtml(tag)}" data-category-id="${escapeHtml(category.id)}">${escapeHtml(tag)}</button>`).join("")}
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
  if (previewImage.fileUrl !== "") {
    return `<img src="${escapeHtml(resolveAssetUrl(previewImage.fileUrl))}" alt="${escapeHtml(getMaterialName(material))}" />`;
  }
  return "";
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
        <button class="template-material-thumb" type="button" data-action="preview-material" data-material-id="${escapeHtml(material.id)}" ${previewImage.fileUrl === "" ? "disabled" : ""} aria-label="预览 ${escapeHtml(templateName)}">
          ${renderMaterialThumb(material)}
        </button>
        <div class="template-material-title-row">
          <h3 title="${escapeHtml(templateName)}">${escapeHtml(templateName)}</h3>
        </div>
        <div class="template-material-actions">
          <button class="secondary-button" type="button" data-action="edit-material-tags" data-material-id="${escapeHtml(material.id)}">编辑</button>
          ${previewDownloadAction}
          ${sourceDownloadAction}
        </div>
        <p class="template-material-time">${escapeHtml(getMaterialUploadTime(material))}</p>
      </div>
    </article>
  `;
}

function renderPreviewModal() {
  const material = getMaterials().find((item) => item.id === previewMaterialId);
  if (material === undefined) return "";
  const previewImage = getPreviewImage(material);
  const previewDownloadAction = previewImage.fileUrl === ""
    ? `<button class="secondary-button" type="button" disabled>下载预览图</button>`
    : `<a class="secondary-button" href="${escapeHtml(resolveAssetUrl(previewImage.fileUrl))}" download="${escapeHtml(previewImage.fileName)}">下载预览图</a>`;

  return `
    <div class="modal-backdrop" role="presentation">
      <div class="modal-panel wide-modal" role="dialog" aria-modal="true" aria-label="素材预览">
        <div class="modal-header">
          <div>
            <h2>${escapeHtml(getMaterialName(material))}</h2>
            <p class="form-note">${materialTypeNames[material.fileType]} · ${escapeHtml(getMaterialUploadTime(material))}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-template-preview" aria-label="关闭">×</button>
        </div>
        <div class="template-preview-body">
          ${previewImage.fileUrl === ""
            ? `<div class="template-design-preview"><strong>${escapeHtml(previewImage.fileName)}</strong><span class="form-note">暂无预览图</span></div>`
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
              <input data-template-edit-source-upload type="file" accept=".psd,.ai,.fig,.zip,application/zip" />
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
  const visibleMaterials = getFilteredMaterials();
  const canCreateTemplate = !templateUploading && isValidTemplatePayload({
    previewImage: uploadDraft.previewFile,
    sourceFile: uploadDraft.sourceFile,
    tags: uploadTags,
  });

  return `
    <section class="template-center-page">
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
            <input data-template-source-upload type="file" accept=".psd,.ai,.fig,.zip,application/zip" />
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
          </div>
          ${
            visibleMaterials.length === 0
              ? ""
              : `<div class="template-material-grid">${visibleMaterials.map(renderMaterialCard).join("")}</div>`
          }
        </div>
      </div>
      ${renderPreviewModal()}
      ${renderEditTagsModal()}
    </section>
  `;
}

export function bindTemplateCenterPageEvents(rerender) {
  const page = document.querySelector(".template-center-page");
  if (page === null) return;

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
      const [previewUpload, sourceUpload] = await Promise.all([
        uploadImageFile(uploadDraft.previewFile),
        uploadGenericFile(uploadDraft.sourceFile),
      ]);
      const now = new Date().toISOString();
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
      templateError = "模板保存失败，请检查本地数据库服务。";
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
