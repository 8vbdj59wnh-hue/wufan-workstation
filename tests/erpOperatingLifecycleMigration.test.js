import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("ERP SKU默认视图只展示经营生命周期并保留历史开关", () => {
  const service = source("server/productCenterV2Service.js");
  const page = source("src/productCenterPage.js");
  assert.match(service, /om\.lifecycleStatus IN \('active','active_dependency','sales_active'\)/);
  assert.match(service, /includeHistorical/);
  assert.match(page, /显示历史\/非经营ERP SKU/);
  assert.match(page, /operatingLifecycleStatus/);
});

test("Product默认经营视图按关联ERP证据计算且不改Product战略生命周期", () => {
  const service = source("server/productBusinessReadModel.js");
  assert.match(service, /operatingProductLifecycleMap/);
  assert.match(service, /defaultOperatingView/);
  assert.match(service, /Product战略生命周期保持独立/);
  assert.doesNotMatch(service, /UPDATE\s+products/i);
});

test("组合装默认视图只展示当前经营Bundle并保留历史入口", () => {
  const service = source("server/salesObjectComboSkuReadService.js");
  const page = source("src/productCenterPage.js");
  assert.match(service, /operating_erp_set_members/);
  assert.match(service, /o\.objectType='bundle'/);
  assert.match(page, /显示历史组合装/);
});

test("库存风险只读识别非经营资产且不自动处理", () => {
  const service = source("server/erpOperatingLifecycleService.js");
  assert.match(service, /listNonOperatingInventoryRisk/);
  assert.match(service, /m\.lifecycleStatus IN \('archived','external_unused'\)/);
  assert.doesNotMatch(service, /UPDATE\s+erp_skus|DELETE\s+FROM\s+erp_skus/i);
});

test("生命周期不会混入数据质量异常且同步范围仍是建议态", () => {
  const service = source("server/erpOperatingLifecycleService.js");
  assert.doesNotMatch(service, /missing_erp_code|erp_not_found|sku_type_conflict|source_conflict/);
  assert.match(service, /appliedToProductionSync: false/);
});

test("数据资产地图区分ERP历史资产池与Operating ERP Set", () => {
  const service = source("server/dataAssetMapService.js");
  assert.match(service, /ERP历史资产池/);
  assert.match(service, /Operating ERP Set/);
  assert.match(service, /存在于资产池不等于当前正在经营/);
});

test("Phase 7B关系开关与Phase 8销售事实不在生命周期服务写入范围", () => {
  const service = source("server/erpOperatingLifecycleService.js");
  assert.doesNotMatch(service, /V3_AUTO_RELATION_WRITE|V3_RELATION_READ|INSERT\s+INTO\s+connection_sku_sales_daily_facts/i);
});
