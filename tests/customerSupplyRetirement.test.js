import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const retiredTables = [
  "customers",
  "customer_consumptions",
  "customer_tags",
  "customer_tag_relations",
  "customer_followups",
  "suppliers",
  "supplier_products",
  "purchase_orders",
  "purchase_order_items",
  "supplier_quality_issues",
  "supplier_evaluations",
];

test("客户中心和供应链中心不再注册路由、页面或API", () => {
  const modules = read("../src/modules.js");
  const main = read("../src/main.js");
  const server = read("../server/index.js");
  const appState = read("../src/appState.js");

  for (const retiredId of ["customerCenter", "supplyChainCenter"]) {
    assert.doesNotMatch(modules, new RegExp(`id:\\s*[\"']${retiredId}[\"']`));
    assert.doesNotMatch(main, new RegExp(retiredId));
  }
  assert.doesNotMatch(server, /\/api\/(?:customer-center|supply-chain)/);
  assert.doesNotMatch(appState, /\/api\/(?:customer-center|supply-chain)/);
});

test("专属表退出Schema且迁移显式覆盖全部退役表", () => {
  const schema = read("../server/schema.sql");
  const database = read("../server/db.js");

  for (const table of retiredTables) {
    assert.doesNotMatch(schema, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`, "i"));
    assert.match(database, new RegExp(`[\"']${table}[\"']`));
  }
});

test("共享产品、ERP、库存、销售利润和财务资产仍在正式Schema", () => {
  const schema = read("../server/schema.sql");
  for (const table of [
    "products",
    "product_erp_mappings",
    "erp_skus",
    "erp_sku_warehouse_inventory_facts",
    "erp_sku_inventory_daily_summaries",
    "connection_sku_sales_daily_facts",
    "finance_entries",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`, "i"));
  }
});

test("退役迁移同时清除历史权限负载中的模块授权", () => {
  const database = read("../server/db.js");
  assert.match(database, /withoutRetiredModulePermissions/);
  assert.match(database, /\["supplyChain", "customers", "aiAssistant"\]/);
  assert.match(database, /permission_templates/);
  assert.match(database, /permissionOverrides/);
});
