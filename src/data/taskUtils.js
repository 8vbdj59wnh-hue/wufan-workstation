import { TaskStatus } from "./modelOptions.js";

export function isTaskOverdue(task, currentDate) {
  if (task.dueDate === null) return false;
  if (task.status === TaskStatus.Done || task.status === TaskStatus.Canceled) return false;

  const dueTime = parseComparableTime(task.dueDate, "end");
  const currentTime = parseComparableTime(currentDate ?? new Date().toISOString(), "start");
  if (dueTime === null || currentTime === null) return false;
  return currentTime > dueTime;
}

function parseComparableTime(value, dateMode = "start") {
  const rawValue = String(value ?? "").trim();
  if (rawValue === "") return null;
  const fallbackTime = dateMode === "end" ? "T23:59:59+08:00" : "T00:00:00+08:00";
  const parsed = new Date(rawValue.length === 10 ? `${rawValue}${fallbackTime}` : rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function hasTaskOverdueRecord(task) {
  return Boolean(task?.customFields?.assessmentOverdueRecordedAt);
}

export function isDoneStatus(status) {
  return status === TaskStatus.Done;
}

export function isCanceledStatus(status) {
  return status === TaskStatus.Canceled;
}

export function isHiddenByDefaultStatus(status) {
  return isDoneStatus(status) || isCanceledStatus(status);
}

function normalizeImageUrl(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (value && typeof value === "object") {
    if (typeof value.url === "string" && value.url.trim() !== "") return value.url.trim();
    if (typeof value.src === "string" && value.src.trim() !== "") return value.src.trim();
    if (typeof value.path === "string" && value.path.trim() !== "") return value.path.trim();
  }
  return "";
}

function getImageFromCustomFields(customFields) {
  if (customFields === null || typeof customFields !== "object") return "";

  const directImage = normalizeImageUrl(customFields.coverImageUrl ?? customFields.productImage ?? customFields.imageUrl);
  if (directImage !== "") return directImage;

  for (const value of Object.values(customFields)) {
    if (Array.isArray(value)) {
      const image = value.map(normalizeImageUrl).find(Boolean);
      if (image) return image;
      continue;
    }

    const image = normalizeImageUrl(value);
    if (image) return image;
  }

  return "";
}

export function getPrimaryImageUrl(...items) {
  for (const item of items) {
    if (item === null || item === undefined) continue;

    const directImage = normalizeImageUrl(item.coverImageUrl ?? item.productImage ?? item.imageUrl);
    if (directImage !== "") return directImage;

    const customFieldImage = getImageFromCustomFields(item.customFields);
    if (customFieldImage !== "") return customFieldImage;
  }

  return "";
}
