import { getStoreOptionsLoadState, resolveAssetUrl, state, uploadImageFile } from "./appState.js";
import {
  collectBusinessDateTime,
  getBusinessDatePart,
  getBusinessHourPart,
  isBusinessDueDateField,
  renderBusinessHourOptions,
} from "./businessTime.js";
import {
  collectPublicFormMultiSelectValues,
  normalizePublicFormFields,
  renderPublicFormMultiSelectField,
  validatePublicFormMultiSelectValue,
} from "./publicFormFields.js";
import {
  getPublishingAccountFieldOptions,
  isPublishingAccountField,
} from "./publishingAccountOptions.js";
import {
  collectProductImageField,
  handleProductImagesUpload,
  isProductImageField,
  removeProductImage,
  renderProductImageEditor,
  validateProductImages,
} from "./actionImages.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getFormValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() ?? "";
}

function getStoreOptionLabel(store) {
  return store.platform ? `${store.name}（${store.platform}）` : store.name;
}

function getEmptyStoreOptionLabel() {
  const loadState = getStoreOptionsLoadState();
  if (loadState.status === "loading") return "正在读取可选店铺…";
  if (loadState.status === "error") return loadState.message || "店铺加载失败，请稍后重试。";
  if (loadState.status === "ready") return "暂无启用店铺，请到系统设置 → 店铺管理中启用或新增店铺。";
  return "暂无可选店铺，正在尝试重新读取。";
}

function getDynamicFieldOptions(field) {
  if (isPublishingAccountField(field)) return getPublishingAccountFieldOptions(state.publishingAccounts);
  if ((field.options ?? []).length > 0) return field.options.map((option) => ({ value: option, label: option }));
  if (field.key === "departmentId" || field.type === "department") {
    return state.departments.filter((department) => department.status === "active").map((department) => ({ value: department.id, label: department.name }));
  }
  if (field.key === "interviewerId" || field.type === "person") {
    return state.people.filter((person) => person.status === "active").map((person) => ({ value: person.id, label: person.name }));
  }
  if (field.key === "storeId") {
    return state.stores.filter((store) => store.status === "active").map((store) => ({ value: store.id, label: getStoreOptionLabel(store) }));
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

export function renderPublicFormFieldInput(field, customFields = {}) {
  const value = customFields[field.key] ?? (field.type === "multi_select" ? field.defaultValue ?? [] : "");
  const requiredMark = "";

  if (field.type === "textarea") {
    return `
      <label>
        <span>${escapeHtml(field.label)}${requiredMark}</span>
        <textarea name="custom__${escapeHtml(field.key)}" rows="3" placeholder="${escapeHtml(field.placeholder ?? "")}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  if (field.type === "select" || field.type === "person" || field.type === "department") {
    const options = getDynamicFieldOptions(field);
    return `
      <label>
        <span>${escapeHtml(field.label)}${requiredMark}</span>
        <select name="custom__${escapeHtml(field.key)}">
          <option value="">${field.key === "storeId" && options.length === 0 ? escapeHtml(getEmptyStoreOptionLabel()) : "请选择"}</option>
          ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
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
        <input name="custom__${escapeHtml(field.key)}" type="hidden" value="${escapeHtml(imageUrl)}" />
        <input name="upload__${escapeHtml(field.key)}" type="file" accept="image/jpeg,image/png,image/webp" data-image-upload-key="${escapeHtml(field.key)}" />
        <span class="form-note">上传1:1产品图，支持 JPG、PNG、WebP，单张不超过 5MB。</span>
        <span class="image-preview-box">
          ${imageUrl === "" ? "暂无图片" : `<img src="${escapeHtml(resolveAssetUrl(imageUrl))}" alt="${escapeHtml(field.label)}预览" onerror="this.replaceWith('图片无法预览')" />`}
        </span>
      </label>
    `;
  }

  if (isBusinessDueDateField(field)) {
    return `
      <label>
        <span>${escapeHtml(field.label)}${requiredMark}</span>
        <input name="custom__${escapeHtml(field.key)}Date" type="date" value="${escapeHtml(getBusinessDatePart(value))}" />
        <select name="custom__${escapeHtml(field.key)}Hour">${renderBusinessHourOptions(getBusinessHourPart(value), "请选择小时")}</select>
      </label>
    `;
  }

  const inputType = field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text";
  return `
    <label>
      <span>${escapeHtml(field.label)}${requiredMark}</span>
      <input name="custom__${escapeHtml(field.key)}" type="${inputType}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder ?? "")}" />
    </label>
  `;
}

export function renderPublicFormEditor({ fields = [], customFields = {}, title = "本次关键行动信息" }) {
  const normalizedFields = normalizePublicFormFields(fields);
  if (normalizedFields.length === 0) return "";

  return `
    <div class="template-custom-fields">
      ${title === "" ? "" : `<h3>${escapeHtml(title)}</h3>`}
      <div class="form-grid">
        ${normalizedFields.map((field) => renderPublicFormFieldInput(field, customFields)).join("")}
      </div>
    </div>
  `;
}

export function collectPublicFormFields(form, fields = []) {
  const formData = new FormData(form);
  return normalizePublicFormFields(fields).reduce((result, field) => {
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
      const store = state.stores.find((item) => item.id === result.storeId);
      result.storeName = store?.name ?? "";
    }
    return result;
  }, {});
}

export function validatePublicFormFields(customFields, fields = []) {
  const productImagesError = validateProductImages(customFields);
  if (productImagesError !== "") return productImagesError;
  for (const field of normalizePublicFormFields(fields)) {
    const value = customFields[field.key];
    if (field.type === "multi_select") {
      const error = validatePublicFormMultiSelectValue(field, value, getDynamicFieldOptions(field));
      if (error !== "") return error;
      continue;
    }
    const isEmpty = Array.isArray(value) ? value.length === 0 : value === "";
    if (isEmpty) {
      if (field.required) return `${field.label}不能为空。`;
      continue;
    }
    if (typeof value === "string" && value.startsWith("__INVALID_BUSINESS_TIME__:")) return value.replace("__INVALID_BUSINESS_TIME__:", "");
    if (field.type === "number" && Number.isNaN(Number(value))) return `${field.label}必须是数字。`;
    if (isBusinessDueDateField(field) && !String(value).includes("T")) return `${field.label}必须选择日期和整点小时。`;
    if (field.type === "date" && !isBusinessDueDateField(field) && Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) return `${field.label}必须是合法日期。`;
    if (field.type === "url" && !isValidUrl(value)) return `${field.label}必须是有效链接。`;
    if (field.type === "image" && !isValidImagePath(value)) return `${field.label}必须是上传后的图片路径。`;
    if ((field.type === "select" || field.type === "person" || field.type === "department") && !getDynamicFieldOptions(field).some((option) => option.value === value)) return `${field.label}必须选择有效选项。`;
  }
  return "";
}

export function updatePublicFormImagePreview(input) {
  const preview = input.closest(".image-url-field")?.querySelector(".image-preview-box");
  if (preview === undefined || preview === null) return;
  const value = input.value.trim();
  preview.innerHTML = value === ""
    ? "暂无图片"
    : `<img src="${escapeHtml(resolveAssetUrl(value))}" alt="图片预览" onerror="this.replaceWith('图片无法预览')" />`;
}

export async function handlePublicFormImageUpload(input) {
  if (input.matches("[data-product-images-upload]")) return handleProductImagesUpload(input);
  const file = input.files?.[0];
  if (file === undefined) return null;

  const field = input.closest(".image-url-field");
  const hiddenInput = field?.querySelector(`input[name="custom__${input.dataset.imageUploadKey}"]`);
  const preview = field?.querySelector(".image-preview-box");
  if (preview !== null && preview !== undefined) preview.textContent = "上传中...";

  try {
    const result = await uploadImageFile(file);
    if (hiddenInput !== null && hiddenInput !== undefined) {
      hiddenInput.value = result.url;
      updatePublicFormImagePreview(hiddenInput);
    }
    return result;
  } catch (error) {
    if (preview !== null && preview !== undefined) preview.textContent = "图片上传失败";
    throw error;
  }
}

export function removePublicFormImage(button) {
  removeProductImage(button);
}
