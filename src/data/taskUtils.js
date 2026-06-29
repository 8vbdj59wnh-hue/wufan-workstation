import { TaskImportance, TaskStatus, TaskUrgency } from "./modelOptions.js";

export const quadrantNames = Object.freeze({
  first: "重要且紧急",
  second: "重要不紧急",
  third: "不重要但紧急",
  fourth: "不重要不紧急",
});

export function getTaskQuadrant(importance, urgency) {
  if (importance === TaskImportance.Important && urgency === TaskUrgency.Urgent) {
    return quadrantNames.first;
  }

  if (importance === TaskImportance.Important && urgency === TaskUrgency.NotUrgent) {
    return quadrantNames.second;
  }

  if (importance === TaskImportance.NotImportant && urgency === TaskUrgency.Urgent) {
    return quadrantNames.third;
  }

  return quadrantNames.fourth;
}

export function isTaskOverdue(task, currentDate) {
  if (task.dueDate === null) return false;
  if (task.status === TaskStatus.Done || task.status === TaskStatus.Canceled) return false;

  return currentDate > task.dueDate;
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
