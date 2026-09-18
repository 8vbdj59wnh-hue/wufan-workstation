export function isContentNoteBodyField(field) {
  return ['contentText','copyText','copywriting'].includes(field.key) || ['内容文案','文案','正文'].includes(String(field.label||'').trim());
}
