import assert from "node:assert/strict";
import {
  getEffectivePublishTime,
  normalizePublishTimeFields,
  normalizePublishTimeMode,
  PublishTimeMode,
} from "../src/data/contentPublishTime.js";

const originalPublishTime = "2026-08-10T16:00:00+08:00";
const originalDeadline = "2026-08-10T18:00:00+08:00";
const changedDeadline = "2026-08-11T20:00:00+08:00";

assert.equal(normalizePublishTimeMode(undefined), PublishTimeMode.Custom, "历史记录应默认按自定义发布时间解释");
assert.equal(getEffectivePublishTime({ publishDate: originalPublishTime }, originalDeadline), originalPublishTime);

const deadlineFields = normalizePublishTimeFields({ publishDate: originalPublishTime, title: "测试笔记" }, PublishTimeMode.Deadline);
assert.equal(deadlineFields.publishTimeMode, PublishTimeMode.Deadline);
assert.equal(Object.hasOwn(deadlineFields, "publishDate"), false, "跟随模式不得保存重复发布时间");
assert.equal(getEffectivePublishTime(deadlineFields, originalDeadline), originalDeadline);
assert.equal(getEffectivePublishTime(deadlineFields, changedDeadline), changedDeadline, "截止时间变化后有效发布时间必须动态同步");

const customFields = normalizePublishTimeFields({ publishDate: originalPublishTime }, PublishTimeMode.Custom);
assert.equal(getEffectivePublishTime(customFields, changedDeadline), originalPublishTime, "自定义发布时间不得随截止时间变化");

console.log("发布内容行动发布时间模式验证通过");
