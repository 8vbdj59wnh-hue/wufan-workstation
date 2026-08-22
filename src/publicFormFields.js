const legacyPublicFormPrefixes = ["发布内容笔记-", "新品上新-", "新品上架链接-", "库存清仓-"];

function normalizePublicFormFieldKey(field, fallback) {
  const rawKey = String(field?.key ?? field?.fieldId ?? field?.id ?? fallback);
  return legacyPublicFormPrefixes.reduce((key, prefix) => (key.startsWith(prefix) ? key.slice(prefix.length) : key), rawKey);
}

export function normalizePublicFormField(field = {}, index = 0) {
  const typeMap = {
    multi: "multi_select",
    checkbox: "multi_select",
    attachment: "file",
  };
  const key = normalizePublicFormFieldKey(field, `field-${index + 1}`);
  const type = typeMap[field.type] ?? field.type ?? "text";

  return {
    ...field,
    id: field.id ?? field.fieldId ?? key,
    key,
    label: field.label ?? "未命名字段",
    type,
    required: field.required === true,
    placeholder: field.placeholder ?? "",
    options: Array.isArray(field.options) ? field.options : [],
    showInList: field.showInList !== false,
    sortOrder: Number.isFinite(Number(field.sortOrder ?? field.order)) ? Number(field.sortOrder ?? field.order) : index + 1,
  };
}

export function normalizePublicFormFields(fields = []) {
  return fields.map(normalizePublicFormField).sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizePublicFormMultiSelectValue(value) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (value === null || value === undefined || String(value).trim() === "") return [];

  const text = String(value).trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return normalizePublicFormMultiSelectValue(parsed);
    } catch {
      // Keep compatibility with historical comma-separated defaults.
    }
  }
  return [...new Set(text.split(/,|，|\n/).map((item) => item.trim()).filter(Boolean))];
}

export function getPublicFormMultiSelectValue(field, customFields = {}, options = field.options ?? []) {
  const value = customFields[field.key] ?? field.defaultValue ?? [];
  const normalizedValue = normalizePublicFormMultiSelectValue(value);
  if (Array.isArray(value) || typeof value !== "string") return normalizedValue;

  const optionValues = options.map((option) => String(
    typeof option === "object" && option !== null ? option.value ?? "" : option ?? "",
  )).filter(Boolean);
  if (optionValues.length === 0 || normalizedValue.every((item) => optionValues.includes(item))) return normalizedValue;

  const historicalMatches = optionValues.filter((option) => value.includes(option));
  return historicalMatches.length > 0 ? historicalMatches : normalizedValue;
}

export function renderPublicFormMultiSelectField(field, options = [], customFields = {}) {
  const normalizedOptions = options.map((option) => (
    typeof option === "object" && option !== null
      ? { value: String(option.value ?? ""), label: String(option.label ?? option.value ?? "") }
      : { value: String(option ?? ""), label: String(option ?? "") }
  ));
  const selectedValues = getPublicFormMultiSelectValue(field, customFields, normalizedOptions);
  const inputName = `custom__${field.key}`;

  return `
    <div class="public-form-multi-select-field">
      <span class="public-form-field-label">${escapeHtml(field.label)}</span>
      <div class="form-renderer-choice-list public-form-multi-select" role="group" aria-label="${escapeHtml(field.label)}">
        ${normalizedOptions.length === 0
          ? `<span class="form-note">暂无可选项</span>`
          : normalizedOptions.map((option) => `
              <label>
                <input type="checkbox" name="${escapeHtml(inputName)}" value="${escapeHtml(option.value)}" ${selectedValues.includes(option.value) ? "checked" : ""} />
                <span>${escapeHtml(option.label)}</span>
              </label>
            `).join("")}
      </div>
    </div>
  `;
}

export function collectPublicFormMultiSelectValues(formData, fieldKey) {
  return formData.getAll(`custom__${fieldKey}`).map((item) => item.toString());
}

export function validatePublicFormMultiSelectValue(field, value, options = []) {
  const values = normalizePublicFormMultiSelectValue(value);
  if (values.length === 0) return field.required ? `${field.label}不能为空。` : "";
  const allowedValues = new Set(options.map((option) => String(
    typeof option === "object" && option !== null ? option.value ?? "" : option ?? "",
  )));
  return values.some((item) => !allowedValues.has(item)) ? `${field.label}包含无效选项。` : "";
}
