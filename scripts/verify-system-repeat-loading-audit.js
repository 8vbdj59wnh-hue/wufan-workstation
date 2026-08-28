import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolvePersistentDataRoute } from "../src/persistentDataRouting.js";

const routeExpectations = new Map([
  ["", "dashboard"],
  ["dashboard", "dashboard"],
  ["dashboard-operation", "dashboard"],
  ["dashboard-management", "dashboardManagement"],
  ["assessment-reports", "dashboardManagement"],
  ["goals", "goals"],
  ["task-list", "tasks"],
  ["task-waves", "tasks"],
  ["schedule-board", "scheduleBoard"],
  ["schedule-board/content-note", "scheduleBoard"],
  ["process-templates", "processes"],
  ["process-template-example", "processes"],
  ["task-library", "processes"],
  ["templateCenter", "templateCenter"],
  ["templateCenter/form-design", "templateCenter"],
  ["template-center", "templateCenter"],
  ["products", "products"],
  ["products/sku/example", "products"],
  ["settings", "settings"],
  ["settings/permissions", "settings"],
  ["permissions", "settings"],
  ["settings/admin-data-center", "adminDataCenter"],
]);

for (const [route, expected] of routeExpectations) {
  assert.equal(resolvePersistentDataRoute(route), expected, `${route || "<empty>"} should use ${expected}`);
}

const [mainSource, stateSource, goalsSource, scheduleSource, tasksSource, assessmentSource, templateSource, productSource] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/appState.js", import.meta.url), "utf8"),
  readFile(new URL("../src/goalsPage.js", import.meta.url), "utf8"),
  readFile(new URL("../src/scheduleBoardPage.js", import.meta.url), "utf8"),
  readFile(new URL("../src/tasksPage.js", import.meta.url), "utf8"),
  readFile(new URL("../src/assessmentPage.js", import.meta.url), "utf8"),
  readFile(new URL("../src/templateCenterPage.js", import.meta.url), "utf8"),
  readFile(new URL("../src/productCenterPage.js", import.meta.url), "utf8"),
]);

assert.ok((mainSource.match(/loadPersistentData\(\{ useCache: true \}\)/g) ?? []).length >= 3, "startup and navigation must use the page cache");
assert.ok(!mainSource.includes("loadedDataModuleId"), "single-current-module cache must not return");
assert.match(stateSource, /const loadedPersistentDataRoutes = new Set\(\)/, "per-user loaded route set is required");
assert.match(stateSource, /loadedPersistentDataRoutes\.has\(cacheKey\)/, "repeat reads must be skipped");
assert.match(stateSource, /loadedPersistentDataRoutes\.add\(cacheKey\)/, "successful reads must be cached");
assert.match(stateSource, /loadedPersistentDataRoutes\.clear\(\)/, "logout must clear cached module state");
assert.match(stateSource, /dashboardManagementLoaded = false/, "logout must clear management dashboard state");
assert.match(stateSource, /bootstrapModule === "dashboardManagement"\) dashboardManagementLoaded = true/, "management dashboard must not repeat its bootstrap during first render");
assert.match(goalsSource, /loadedGoalDetails/, "goal detail state must stay reusable");
assert.match(scheduleSource, /schedulePageState\.loaded && page === schedulePageState\.page/, "key-action page state must stay reusable");
assert.match(tasksSource, /taskListLoaded/, "task page state must stay reusable");
assert.match(assessmentSource, /workResultsLoadedDays === days/, "work-result query state must stay reusable");
assert.match(templateSource, /loadedLibraryCategories/, "template category state must stay reusable");
assert.match(productSource, /productSkuV2State\.loaded/, "product list state must stay reusable");
assert.match(mainSource, /app\.innerHTML =/, "whole-app redraw remains an audited architectural follow-up");

console.log(`system repeat-loading audit verification passed (${routeExpectations.size} routes)`);
