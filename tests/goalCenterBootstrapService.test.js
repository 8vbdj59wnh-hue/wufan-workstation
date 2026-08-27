import assert from "node:assert/strict";
import test from "node:test";

import {
  apiNoStoreHeaders,
  configureApiCachePolicy,
} from "../server/apiCachePolicy.js";
import {
  goalCenterBootstrapResources,
  goalCenterInitialResources,
  pickGoalCenterBootstrapResources,
  readGoalCenterBootstrap,
} from "../server/goalCenterBootstrapService.js";

test("API cache policy disables conditional responses and marks every API response as no-store", () => {
  const calls = [];
  const app = {
    disable(setting) {
      calls.push(["disable", setting]);
    },
    use(path, middleware) {
      calls.push(["use", path, middleware]);
    },
  };

  configureApiCachePolicy(app);

  assert.deepEqual(calls.slice(0, 1), [["disable", "etag"]]);
  assert.equal(calls[1][0], "use");
  assert.equal(calls[1][1], "/api");

  const headers = {};
  let nextCalls = 0;
  calls[1][2]({}, {
    setHeader(name, value) {
      headers[name] = value;
    },
  }, () => {
    nextCalls += 1;
  });

  assert.deepEqual(headers, apiNoStoreHeaders);
  assert.equal(nextCalls, 1);
});

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
