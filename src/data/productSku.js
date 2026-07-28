const invisibleSkuCharacters = /[\r\n\t\u00a0\u200b-\u200d\u2060\ufeff]/g;
const productCodeSeparators = /[,，;；\r\n]+/;

export function normalizeProductSkuCode(value) {
  return String(value ?? "")
    .replace(invisibleSkuCharacters, "")
    .trim()
    .toLowerCase();
}

export function splitProductSkuCodes(value) {
  const seen = new Set();
  const codes = [];
  for (const rawPart of String(value ?? "").split(productCodeSeparators)) {
    const code = String(rawPart ?? "").replace(invisibleSkuCharacters, "").trim();
    const normalized = normalizeProductSkuCode(code);
    if (normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);
    codes.push(code);
  }
  return codes;
}
