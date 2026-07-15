const businessTimezoneOffset = "+08:00";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const hourPattern = /^(?:[01]\d|2[0-3]):00$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function getBusinessDatePart(value) {
  return getBusinessDueDateParts(value).date;
}

export function getBusinessHourPart(value) {
  return getBusinessDueDateParts(value).hour;
}

export function getBusinessDueDateParts(value) {
  const rawValue = String(value ?? "").trim();
  const dateMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch === null) return { date: "", hour: "" };
  const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  const match = String(value ?? "").match(/T(\d{2}):/);
  if (match === null) return { date, hour: "" };
  const minuteMatch = rawValue.match(/T\d{2}:(\d{2})/);
  const originalHour = Number(match[1]);
  const minute = Number(minuteMatch?.[1] ?? "0");
  if (!Number.isFinite(originalHour) || !Number.isFinite(minute)) return { date, hour: "" };

  let normalizedHour = originalHour + (minute > 0 ? 1 : 0);
  if (normalizedHour < 24) return { date, hour: `${String(normalizedHour).padStart(2, "0")}:00` };

  const shiftedDate = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]) + 1);
  const shiftedYear = shiftedDate.getFullYear();
  const shiftedMonth = String(shiftedDate.getMonth() + 1).padStart(2, "0");
  const shiftedDay = String(shiftedDate.getDate()).padStart(2, "0");
  normalizedHour = 0;
  return { date: `${shiftedYear}-${shiftedMonth}-${shiftedDay}`, hour: "00:00" };
}

export function getBusinessStartDateParts(value) {
  const rawValue = String(value ?? "").trim();
  const date = rawValue.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  if (date === "") return { date: "", hour: "" };
  const match = rawValue.match(/T(\d{2}):/);
  if (match === null) return { date, hour: "" };
  return { date, hour: `${match[1]}:00` };
}

export function renderBusinessHourOptions(selectedHour = "", emptyLabel = "未设置") {
  const options = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
  for (let hour = 0; hour < 24; hour += 1) {
    const value = `${String(hour).padStart(2, "0")}:00`;
    options.push(`<option value="${value}" ${value === selectedHour ? "selected" : ""}>${value}</option>`);
  }
  return options.join("");
}

export function isBusinessDueDateField(field = {}) {
  const key = String(field.key ?? "");
  if (field.type === "datetime_hour") return true;
  return /^(dueDate|expectedDoneDate|rectificationDueDate)$/.test(key);
}

export function collectBusinessDateTime(form, name, label = "截止时间") {
  const data = form instanceof FormData ? form : new FormData(form);
  const date = data.get(`${name}Date`)?.toString().trim() ?? "";
  const hour = data.get(`${name}Hour`)?.toString().trim() ?? "";

  if (date === "" && hour === "") return { value: null, error: "" };
  if (date === "") return { value: null, error: `请选择${label}日期。` };
  if (!datePattern.test(date)) return { value: null, error: `${label}日期格式不正确。` };
  if (hour === "") return { value: null, error: `请选择${label}小时。` };
  if (!hourPattern.test(hour)) return { value: null, error: `${label}只能选择整点小时。` };

  return { value: `${date}T${hour}:00${businessTimezoneOffset}`, error: "" };
}

export function formatBusinessDateTime(value, emptyLabel = "未设置") {
  const rawValue = String(value ?? "").trim();
  if (rawValue === "") return emptyLabel;

  const date = getBusinessDatePart(rawValue);
  if (date === "") return rawValue;

  const hour = getBusinessHourPart(rawValue);
  return hour === "" ? date : `${date} ${hour}`;
}
