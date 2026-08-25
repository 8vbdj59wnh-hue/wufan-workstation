import assert from "node:assert/strict";
import test from "node:test";

import {
  goalCenterBootstrapResources,
  goalCenterInitialResources,
  pickGoalCenterBootstrapResources,
  readGoalCenterBootstrap,
} from "../server/goalCenterBootstrapService.js";

test("goal center reads only its declared resources", () => {
  const reads = [];
  const snapshot = readGoalCenterBootstrap((resource) => {
    reads.push(resource);
    return [{ id: `${resource}-1` }];
  });

  assert.deepEqual(reads, goalCenterInitialResources);
  assert.deepEqual(Object.keys(snapshot), goalCenterBootstrapResources);
  assert.equal(Object.hasOwn(snapshot, "erpGoods"), false);
  assert.equal(Object.hasOwn(snapshot, "salesLinks"), false);
  assert.equal(Object.hasOwn(snapshot, "weeklyReports"), false);
  ["tasks", "processInstances", "workPlans", "products", "actionProducts", "productErpMappings"].forEach((resource) => {
    assert.deepEqual(snapshot[resource], [], `${resource} must be loaded from the selected goal detail`);
  });
});

test("goal center response cannot leak undeclared scoped resources", () => {
  const response = pickGoalCenterBootstrapResources({
    goals: [{ id: "goal-1" }],
    erpGoods: [{ id: "erp-1" }],
    salesLinks: [{ id: "link-1" }],
  });

  assert.deepEqual(Object.keys(response), goalCenterBootstrapResources);
  assert.deepEqual(response.goals, [{ id: "goal-1" }]);
  assert.equal(Object.hasOwn(response, "erpGoods"), false);
  assert.equal(Object.hasOwn(response, "salesLinks"), false);
});

test("goal center resource contract covers current goal page dependencies", () => {
  const requiredResources = [
    "companies",
    "departments",
    "people",
    "categories",
    "stores",
    "publishingAccounts",
    "goals",
    "tasks",
    "taskTemplates",
    "processTemplates",
    "processTemplateNodes",
    "processInstances",
    "workPlans",
    "templates",
    "templateTagCategories",
    "standardWorkForms",
    "products",
    "actionProducts",
    "productErpMappings",
  ];

  requiredResources.forEach((resource) => {
    assert.equal(goalCenterBootstrapResources.includes(resource), true, `missing ${resource}`);
  });
});
