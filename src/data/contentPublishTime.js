export const PublishTimeMode = Object.freeze({
  Custom: "custom",
  Deadline: "deadline",
});

export function normalizePublishTimeMode(value) {
  return value === PublishTimeMode.Deadline ? PublishTimeMode.Deadline : PublishTimeMode.Custom;
}

export function getEffectivePublishTime(customFields = {}, deadline = null) {
  return normalizePublishTimeMode(customFields.publishTimeMode) === PublishTimeMode.Deadline
    ? deadline ?? ""
    : customFields.publishDate ?? "";
}

export function normalizePublishTimeFields(customFields = {}, mode = PublishTimeMode.Custom) {
  const normalizedMode = normalizePublishTimeMode(mode);
  const nextFields = { ...customFields, publishTimeMode: normalizedMode };
  if (normalizedMode === PublishTimeMode.Deadline) delete nextFields.publishDate;
  return nextFields;
}
