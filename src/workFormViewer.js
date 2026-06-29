import { resolveAssetUrl, state } from "./appState.js?v=20260627-methods1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeFields(formFields = []) {
  return [...formFields].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}

function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === "";
}

function renderValue(field, value, customFields = {}) {
  if (isEmptyValue(value)) return `<span class="muted-action">未填写</span>`;
  if (Array.isArray(value)) return escapeHtml(value.join("、"));

  const textValue = String(value);
  if (field?.key === "storeId") {
    const store = state.stores.find((item) => item.id === textValue);
    return escapeHtml(customFields.storeName || store?.name || customFields.platform || textValue);
  }

  if (field?.type === "image") {
    return `
      <a href="${escapeHtml(resolveAssetUrl(textValue))}" target="_blank" rel="noreferrer">
        <img class="work-form-image" src="${escapeHtml(resolveAssetUrl(textValue))}" alt="${escapeHtml(field.label ?? "图片")}" onerror="this.replaceWith('图片无法预览')" />
      </a>
    `;
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
  const fields = normalizeFields(formFields);
  const knownKeys = new Set(fields.map((field) => field.key));
  const rows = [
    ...fields.map((field) => ({
      key: field.key,
      label: field.label,
      field,
      value: customFields[field.key],
    })),
    ...Object.entries(customFields)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, value]) => ({
        key,
        label: getExtraLabel(key),
        field: { key, label: getExtraLabel(key), type: "text" },
        value,
      })),
  ];

  if (rows.length === 0 || rows.every((row) => isEmptyValue(row.value))) {
    return `<p>暂无本次工作表单信息。</p>`;
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
