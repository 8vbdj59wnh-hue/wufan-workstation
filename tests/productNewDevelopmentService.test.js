import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getProductNewDevelopmentCenter } from "../server/productNewDevelopmentService.js";

test("新品开发中心只读识别已发起的新品关键行动", () => {
  const center = getProductNewDevelopmentCenter({
    processInstances: [
      { id: "action-standard", taskTemplateId: "task-template-new-product-development", name: "2026秋季新品花瓶开发", status: "active", ownerId: "person-owner", initiatorId: "person-starter", goalId: "goal-growth", dueDate: "2026-10-10", createdAt: "2026-08-28T08:00:00.000Z", customFields: { productName: "双耳新品花瓶" } },
      { id: "action-sample", taskTemplateId: "task-template-product-work", name: "新材质花器打样", status: "active", createdAt: "2026-08-27T08:00:00.000Z", customFields: { valueModuleId: "product_development", productDirection: "大尺寸陶瓷花器" } },
      { id: "action-clearance", taskTemplateId: "task-template-product-work", name: "老品清仓淘汰", status: "active", createdAt: "2026-08-26T08:00:00.000Z", customFields: { valueModuleId: "product_development" } },
      { id: "action-cancelled", taskTemplateId: "task-template-new-product-development", name: "已取消新品", status: "cancelled", createdAt: "2026-08-25T08:00:00.000Z" },
    ],
    taskTemplates: [
      { id: "task-template-new-product-development", name: "新品开发", categoryId: "product_development" },
      { id: "task-template-product-work", name: "产品开发与淘汰", categoryId: "product_development" },
    ],
    tasks: [
      { id: "task-1", processInstanceId: "action-standard", status: "done" },
      { id: "task-2", processInstanceId: "action-standard", status: "doing" },
    ],
    people: [
      { id: "person-owner", name: "产品负责人" },
      { id: "person-starter", name: "行动发起人" },
    ],
    goals: [{ id: "goal-growth", name: "建立新品增长曲线" }],
    products: [{ id: "product-new", name: "双耳新品花瓶", skuCode: "NEW-001", mainImage: "/uploads/new.jpg" }],
    actionProducts: [{ actionId: "action-standard", productId: "product-new" }],
  });

  assert.deepEqual(center.summary, { total: 2, pending: 1, running: 1, done: 0 });
  assert.deepEqual(center.items.map((item) => item.id), ["action-standard", "action-sample"]);
  assert.equal(center.items[0].status.code, "running");
  assert.deepEqual(center.items[0].progress, { total: 2, completed: 1, percentage: 50 });
  assert.equal(center.items[0].owner.name, "产品负责人");
  assert.equal(center.items[0].linkedProducts[0].id, "product-new");
  assert.equal(center.definitions.source, "existing_key_actions");
  assert.equal(center.definitions.automaticActionCreation, false);
  assert.equal(center.definitions.automaticTaskCreation, false);
});

test("产品中心提供新品开发入口、状态筛选、行动卡片和原关键行动跳转", () => {
  const source = fs.readFileSync(new URL("../src/productCenterPage.js", import.meta.url), "utf8");
  assert.match(source, /data-view="new-product-development"[^>]*>新品开发<\/button>/);
  assert.match(source, /product-new-development-grid/);
  assert.match(source, /data-action="filter-product-new-development"/);
  assert.match(source, /data-action="open-product-new-development"/);
  assert.match(source, /canViewProducts\(\) \? \["business-dashboard", "business-cockpit", "product-sandbox", "new-product-development", "clearance-plans"\]/);
  assert.match(source, /前往关键行动/);
  assert.match(source, /window\.location\.hash = "schedule-board"/);
  assert.doesNotMatch(source, /import\s+["']\.\/productNewDevelopment\.css["']/);
  assert.match(source, /data-product-new-development-styles/);
});
