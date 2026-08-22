export const LINK_TIME_RANGE_OPTIONS = Object.freeze([
  { value: "yesterday", label: "昨日", days: 1 },
  { value: "7d", label: "近7天", days: 7 },
  { value: "15d", label: "近15天", days: 15 },
  { value: "30d", label: "近30天", days: 30 },
  { value: "45d", label: "近45天", days: 45 },
  { value: "60d", label: "近60天", days: 60 },
  { value: "90d", label: "近90天", days: 90 },
  { value: "custom", label: "自定义", days: null },
]);

export const LINK_TIME_RANGE_VALUES = Object.freeze(LINK_TIME_RANGE_OPTIONS.map((option) => option.value));

export function linkTimeRangeDays(preset) {
  return LINK_TIME_RANGE_OPTIONS.find((option) => option.value === preset)?.days ?? null;
}
