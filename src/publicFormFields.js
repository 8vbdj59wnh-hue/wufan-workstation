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
