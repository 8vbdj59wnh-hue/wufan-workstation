// Bind canonical note values to the current editable action-form schema.
export function mapContentNotePrefill(fields, values = {}) {
  const result = { ...values };
  const aliases = [
    { key: 'title', keys: ['title', 'noteTitle'], labels: ['标题', '笔记标题'] },
    { key: 'contentText', keys: ['contentText', 'copywriting', 'copyText'], labels: ['内容文案', '文案', '正文'] },
    { key: 'productName', keys: ['productName', 'product'], labels: ['对应产品'] },
    { key: 'hashtags', keys: ['hashtags'], labels: ['话题'] },
    { key: 'remark', keys: ['remark', 'remarks', 'notes'], labels: ['备注'] },
  ];
  for (const field of fields) {
    if (Object.hasOwn(result, field.key)) continue;
    const match = aliases.find(item => item.keys.includes(field.key) || item.labels.includes(String(field.label || '').trim()));
    if (match && Object.hasOwn(values, match.key)) result[field.key] = values[match.key];
  }
  return result;
}

export { isContentNoteBodyField } from '../shared/contentNoteFields.js';
