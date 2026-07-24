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
  if (typeof value === "string" && value.trim() !== "") {
    const imageUrl = value.trim();
    if (
      imageUrl.startsWith("/uploads/images/")
      || imageUrl.startsWith("uploads/images/")
      || imageUrl.startsWith("https://")
      || imageUrl.startsWith("http://")
      || imageUrl.startsWith("data:image/")
    ) {
      return imageUrl;
    }
    return "";
  }
  if (value && typeof value === "object") {
    return normalizeImageUrl(value.url ?? value.src ?? value.path);
  }
  return "";
}

function normalizeImageList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeImageUrl).filter(Boolean);
}

function getImagesFromCustomFields(customFields) {
  if (customFields === null || typeof customFields !== "object") return [];

  const productImages = normalizeImageList(customFields.productImages);
  if (productImages.length > 0) return productImages;

  const legacyImage = normalizeImageUrl(
    customFields.productImage ?? customFields.coverImageUrl ?? customFields.imageUrl,
  );
  return legacyImage === "" ? [] : [legacyImage];
}

function getImageFromCustomFields(customFields) {
  if (customFields === null || typeof customFields !== "object") return "";

  const directImage = getImagesFromCustomFields(customFields)[0] ?? "";
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

export function getActionImageUrls(...items) {
  for (const item of items) {
    if (item === null || item === undefined) continue;

    const customFieldImages = getImagesFromCustomFields(item.customFields);
    if (customFieldImages.length > 0) return [...new Set(customFieldImages)].slice(0, 9);

    const directImages = normalizeImageList(item.productImages);
    if (directImages.length > 0) return [...new Set(directImages)].slice(0, 9);

    const legacyImage = normalizeImageUrl(item.productImage ?? item.coverImageUrl ?? item.imageUrl);
    if (legacyImage !== "") return [legacyImage];
  }

  return [];
}

export function getPrimaryImageUrl(...items) {
  const actionImages = getActionImageUrls(...items);
  if (actionImages.length > 0) return actionImages[0];

  for (const item of items) {
    if (item === null || item === undefined) continue;

    const directImage = normalizeImageUrl(item.coverImageUrl ?? item.productImage ?? item.imageUrl);
    if (directImage !== "") return directImage;

    const customFieldImage = getImageFromCustomFields(item.customFields);
    if (customFieldImage !== "") return customFieldImage;
  }

  return "";
}
