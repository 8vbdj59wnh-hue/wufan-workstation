export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "—";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "—";
  return numericValue.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}
