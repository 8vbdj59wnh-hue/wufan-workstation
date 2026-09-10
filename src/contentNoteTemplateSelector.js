import { state, getCurrentUser, resolveAssetUrl } from "./appState.js";
import { canAccessTemplateCenter } from "../shared/permissions.js";
const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function getPublishContentNoteTemplates() {
  return state.templates.filter((template) => {
    const tags = template?.tags;
    if (tags === null || tags === undefined || typeof tags !== "object" || Array.isArray(tags)) return false;
    return Array.isArray(tags.platform) && tags.platform.includes("小红书")
      && Array.isArray(tags.usage) && tags.usage.includes("笔记");
  });
}

function getGoalTemplatePreviewUrl(template) {
  const rawUrl = template?.previewImage?.fileUrl ?? template?.previewImage?.url ?? "";
  return rawUrl === "" ? "" : resolveAssetUrl(rawUrl);
}

export function renderContentNoteTemplateSelector(selectedTemplate) {
  if (!canAccessTemplateCenter(getCurrentUser())) {
    return `<div class="form-error">你没有模板中心查看权限，无法选择发布内容笔记模板。</div>`;
  }
  const templates = getPublishContentNoteTemplates();
  return `
    <fieldset class="goal-content-note-template-selector">
      <legend>关联模板</legend><input type="search" data-content-template-search placeholder="搜索模板名称或编码" aria-label="搜索关联模板" />
      <p class="form-note">仅显示平台含“小红书”且用途含“笔记”的模板；本次关键行动只能关联一个模板。</p>
      ${
        templates.length === 0
          ? `<div class="empty-detail">模板中心暂无可用的发布笔记模板</div>`
          : `<div class="goal-content-note-template-grid">
              ${templates.map((template) => {
                const previewUrl = getGoalTemplatePreviewUrl(template);
                return `
                  <label class="goal-content-note-template-option">
                    <input type="radio" name="linkedTemplateId" value="${escapeHtml(template.id)}" ${selectedTemplate === template.id ? "checked" : ""} />
                    <span class="goal-content-note-template-thumb" ${previewUrl === "" ? "" : `data-action-template-preview-url="${escapeHtml(previewUrl)}" data-action-template-preview-title="${escapeHtml(template.name)}"`}>${previewUrl === "" ? "无预览" : `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(template.name)}" />`}</span>
                    <span>
                      <strong>${escapeHtml(template.name)}</strong>
                      <small>${escapeHtml(template.businessCode || "—")} · ${escapeHtml(template.fileType || "文件")}</small>
                    </span>
                  </label>
                `;
              }).join("")}
            </div>`
      }
      <button class="text-button" type="button" data-action="clear-goal-linked-template">清除模板选择</button>
    </fieldset>
  `;
}

export function bindContentNoteTemplateSelectors(root = document) {
  root.querySelectorAll("[data-content-template-search]").forEach(input => input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    input.closest("fieldset").querySelectorAll(".goal-content-note-template-option").forEach(option => { option.hidden = !option.textContent.toLowerCase().includes(query); });
  }));
}
