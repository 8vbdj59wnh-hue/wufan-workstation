import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPublicFormMultiSelectValues,
  normalizePublicFormField,
  normalizePublicFormMultiSelectValue,
  renderPublicFormMultiSelectField,
  validatePublicFormMultiSelectValue,
} from "../src/publicFormFields.js";

const activityStoreField = {
  id: "field-stores",
  key: "stores",
  label: "店铺",
  type: "multi_select",
  required: true,
  options: ["点意旗舰店", "玖兀旗舰店", "点意家居", "今也", "南屿", "chicfun", "屋范", "半然淘宝", "青未陶坊", "半然天猫"],
};

test("public form keeps the formal multi-select type mapping", () => {
  assert.equal(normalizePublicFormField({ key: "stores", type: "checkbox" }).type, "multi_select");
  assert.equal(normalizePublicFormField(activityStoreField).type, "multi_select");
});

test("activity registration multi-select renders unchecked checkboxes instead of a select list", () => {
  const html = renderPublicFormMultiSelectField(activityStoreField, activityStoreField.options, {});

  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 10);
  assert.equal(html.includes("<select"), false);
  assert.equal(html.includes(" multiple"), false);
  assert.equal(html.includes(" checked"), false);
});

test("configured defaults and saved values check only their own options", () => {
  const fieldWithDefault = { ...activityStoreField, defaultValue: "点意旗舰店，今也" };
  const defaultHtml = renderPublicFormMultiSelectField(fieldWithDefault, fieldWithDefault.options, {});
  assert.equal((defaultHtml.match(/ checked/g) ?? []).length, 2);

  const savedHtml = renderPublicFormMultiSelectField(fieldWithDefault, fieldWithDefault.options, {
    stores: ["南屿"],
  });
  assert.equal((savedHtml.match(/ checked/g) ?? []).length, 1);
  assert.match(savedHtml, /value="南屿" checked/);
  assert.doesNotMatch(savedHtml, /value="点意旗舰店" checked/);
});

test("multi-select submission remains a real array for zero, one, and many values", () => {
  const empty = new FormData();
  assert.deepEqual(collectPublicFormMultiSelectValues(empty, "stores"), []);

  const one = new FormData();
  one.append("custom__stores", "点意旗舰店");
  assert.deepEqual(collectPublicFormMultiSelectValues(one, "stores"), ["点意旗舰店"]);

  const many = new FormData();
  many.append("custom__stores", "点意旗舰店");
  many.append("custom__stores", "今也");
  assert.deepEqual(collectPublicFormMultiSelectValues(many, "stores"), ["点意旗舰店", "今也"]);
});

test("required multi-select needs one value while optional multi-select may stay empty", () => {
  assert.equal(validatePublicFormMultiSelectValue(activityStoreField, [], activityStoreField.options), "店铺不能为空。");
  assert.equal(validatePublicFormMultiSelectValue(activityStoreField, ["点意旗舰店"], activityStoreField.options), "");
  assert.equal(validatePublicFormMultiSelectValue({ ...activityStoreField, required: false }, [], activityStoreField.options), "");
  assert.equal(validatePublicFormMultiSelectValue(activityStoreField, ["不存在的店铺"], activityStoreField.options), "店铺包含无效选项。");
});

test("saved selections echo correctly and historical default formats remain compatible", () => {
  assert.deepEqual(normalizePublicFormMultiSelectValue('["点意旗舰店","今也"]'), ["点意旗舰店", "今也"]);
  const html = renderPublicFormMultiSelectField(activityStoreField, activityStoreField.options, {
    stores: ["点意旗舰店", "今也"],
  });
  assert.equal((html.match(/ checked/g) ?? []).length, 2);
  assert.match(html, /value="点意旗舰店" checked/);
  assert.match(html, /value="今也" checked/);

  const historicalHtml = renderPublicFormMultiSelectField(activityStoreField, activityStoreField.options, {
    stores: "chicfun、屋范、 半然淘宝  青未陶坊  半然天猫,点意旗舰店、玖兀旗舰店、点意家居、今也，南屿",
  });
  assert.equal((historicalHtml.match(/ checked/g) ?? []).length, 10);
});
