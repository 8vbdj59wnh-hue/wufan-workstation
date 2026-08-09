import { resolveAssetUrl, state } from "./appState.js";
import { normalizePublicFormFields } from "./publicFormFields.js?v=20260722-public-form-key-normalize1";
import { getActionImageUrls } from "./data/taskUtils.js?v=20260705-state-singleton1";
import { renderActionImageGrid } from "./actionImages.js";

const hiddenSystemFieldKeys = new Set(["standardWorkAttachments", "productImages", "publishTimeMode"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === "";
}

function renderValue(field, value, customFields = {}) {
  if (isEmptyValue(value)) return `<span class="muted-action">未填写</span>`;
  if (field?.type === "image") {
    const imageUrls = Array.isArray(value) ? value : getActionImageUrls({ customFields: { ...customFields, productImages: [value] } });
    return renderActionImageGrid(imageUrls, {
      className: "work-form-image-grid",
      alt: field.label ?? "产品图片",
      placeholder: "暂无图片",
    });
  }
  if (Array.isArray(value)) return escapeHtml(value.join("、"));

  const textValue = String(value);
  if (field?.key === "storeId") {
    const store = state.stores.find((item) => item.id === textValue);
    return escapeHtml(customFields.storeName || store?.name || customFields.platform || textValue);
  }

  if (field?.type === "person") {
    const person = state.people.find((item) => item.id === textValue);
    return escapeHtml(person?.name ?? textValue);
  }

  if (field?.type === "department") {
    const department = state.departments.find((item) => item.id === textValue);
    return escapeHtml(department?.name ?? textValue);
  }

  if (field?.type === "file" || field?.type === "link" || field?.type === "url") {
    return `<a href="${escapeHtml(resolveAssetUrl(textValue))}" target="_blank" rel="noreferrer">${escapeHtml(textValue)}</a>`;
  }

  if (field?.type === "textarea") {
    return `<span class="work-form-multiline">${escapeHtml(textValue)}</span>`;
  }

  return escapeHtml(textValue);
}

function getExtraLabel(key) {
  if (key === "platform") return "上架平台（旧字段）";
  if (key === "storeName") return "上架店铺";
  return key;
}

export function renderWorkFormViewer({ formFields = [], customFields = {} }) {
  const fields = normalizePublicFormFields(formFields);
  const knownKeys = new Set(fields.map((field) => field.key));
  const productImageUrls = getActionImageUrls({ customFields });
  const hasImageField = fields.some((field) => field.type === "image");
  const displayFields = hasImageField || productImageUrls.length === 0
    ? fields
    : [{ key: "productImages", label: "产品图片", type: "image" }, ...fields];
  const rows = [
    ...displayFields.map((field) => ({
      key: field.key,
      label: field.label,
      field,
      value: field.type === "image" && productImageUrls.length > 0 ? productImageUrls : customFields[field.key],
    })),
    ...Object.entries(customFields)
      .filter(([key]) => !knownKeys.has(key) && !hiddenSystemFieldKeys.has(key))
      .map(([key, value]) => ({
        key,
        label: getExtraLabel(key),
        field: { key, label: getExtraLabel(key), type: "text" },
        value,
      })),
  ];

  if (rows.length === 0 || (fields.length === 0 && rows.every((row) => isEmptyValue(row.value)))) {
    return `<p>暂无关键行动公共信息。</p>`;
  }

  return `
    <div class="work-form-viewer">
      ${rows
        .map(
          (row) => `
            <div class="work-form-row">
              <span>${escapeHtml(row.label)}</span>
              <strong>${renderValue(row.field, row.value, customFields)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}
