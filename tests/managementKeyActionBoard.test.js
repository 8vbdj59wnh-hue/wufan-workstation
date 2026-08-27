import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const assessmentPageSource = fs.readFileSync(new URL("../src/assessmentPage.js", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("management cockpit today overview renders the seven-value-chain key action board", () => {
  assert.match(assessmentPageSource, /valueModuleList\.map\(\(module\)/u);
  assert.match(assessmentPageSource, /关键行动看板/u);
  assert.match(assessmentPageSource, /七个价值链分类/u);
  assert.match(assessmentPageSource, /renderTodayOverviewList[\s\S]*renderKeyActionBoard\(\)/u);
});

test("management cockpit renders the matching incomplete improvement action board", () => {
  const todayOverviewSource = assessmentPageSource.match(/function renderTodayOverview\(\) \{[\s\S]*?\n\}/u)?.[0] ?? "";
  const rectificationPageSource = assessmentPageSource.match(/function renderRectificationPage\(\) \{[\s\S]*?\n\}/u)?.[0] ?? "";
  assert.match(assessmentPageSource, /改善行动看板/u);
  assert.match(assessmentPageSource, /getVisibleRectificationRows\(\)/u);
  assert.match(assessmentPageSource, /row\.status !== "done" && row\.status !== "canceled"/u);
  assert.match(assessmentPageSource, /action:\s*"view-rectification"/u);
  assert.doesNotMatch(todayOverviewSource, /renderImprovementActionBoard\(\)/u);
  assert.match(rectificationPageSource, /<h2>改善工作<\/h2>[\s\S]*renderImprovementActionBoard\(\)[\s\S]*renderRectificationFilters\(\)/u);
});

test("key action cards only use incomplete non-rectification actions and expose required fields", () => {
  assert.match(assessmentPageSource, /selectProcessInstanceBusinessStatus\(instance\.id, state\)\.status !== "done"/u);
  assert.match(assessmentPageSource, /workPlan\.workType === WorkType\.Rectification/u);
  assert.match(assessmentPageSource, /发起人/u);
  assert.match(assessmentPageSource, /负责人/u);
  assert.match(assessmentPageSource, /步骤进度/u);
  assert.match(assessmentPageSource, /selectProcessProgress\(instance\.id, state\)/u);
  assert.match(assessmentPageSource, /逾期/u);
  assert.match(assessmentPageSource, /剩余/u);
});

test("key action board keeps large action sets usable", () => {
  assert.match(stylesSource, /\.assessment-key-action-board\s*\{[\s\S]*grid-template-columns:\s*repeat\(7,/u);
  assert.match(stylesSource, /\.assessment-key-action-list\s*\{[\s\S]*max-height:\s*620px;[\s\S]*overflow-y:\s*auto;/u);
});

test("management cockpit omits the removed intro and today work result sections", () => {
  assert.doesNotMatch(assessmentPageSource, /<h2>管理驾驶舱<\/h2>/u);
  assert.doesNotMatch(assessmentPageSource, /renderTodayWorkResultStream/u);
  assert.doesNotMatch(assessmentPageSource, /<h2>今日工作结果<\/h2>/u);
  assert.doesNotMatch(stylesSource, /\.work-result-section-primary/u);
});

test("management cockpit omits the problem summary tab and redirects its legacy route", () => {
  const tabsSource = assessmentPageSource.match(/function renderAssessmentTabs\(\) \{[\s\S]*?\n\}/u)?.[0] ?? "";
  const pageSource = assessmentPageSource.match(/export function renderAssessmentPage\(\) \{[\s\S]*?\n\}/u)?.[0] ?? "";
  assert.doesNotMatch(tabsSource, /问题汇总/u);
  assert.doesNotMatch(tabsSource, /\["problems"/u);
  assert.doesNotMatch(pageSource, /activeAssessmentTab === "problems"/u);
  assert.match(assessmentPageSource, /"assessment-problems": "stats"/u);
});
