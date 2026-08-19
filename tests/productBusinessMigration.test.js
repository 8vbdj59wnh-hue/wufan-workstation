import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("产品经营正式读取不再依赖旧经营快照", () => {
  for (const file of [
    "server/productManagementV2Service.js",
    "server/productBusinessReadModel.js",
    "server/dataCenterService.js",
    "server/operationManagementService.js",
  ]) {
    const content = source(file);
    assert.doesNotMatch(content, /\b(?:erp_fact_snapshots|product_daily_snapshots|product_erp_daily_snapshots)\b/, file);
  }
  const management = source("server/productManagementV2Service.js");
  assert.match(management, /connection_sku_sales_daily_facts/);
  assert.match(management, /relation: "sales_object"/);
  assert.match(management, /erp_sku_inventory_daily_summaries/);
});

test("旧快照生成停止且经营数据中心正式退役", () => {
  const sync = source("server/productV2Import.js");
  const server = source("server/index.js");
  const productPage = source("src/productCenterPage.js");
  const dataCenterPage = source("src/dataCenterPage.js");

  assert.doesNotMatch(sync, /generateErpFactSnapshot/);
  assert.match(server, /legacy_snapshot_retired/);
  assert.doesNotMatch(productPage, /retry-erp-snapshot|generateErpSyncSnapshot/);
  assert.match(productPage, /产品经营统一读取销售日报、Sales Object与库存事实/);
  assert.match(dataCenterPage, /renderAdminDataCenterPage/);
  assert.match(dataCenterPage, /loadDataSyncCenter/);
  assert.doesNotMatch(dataCenterPage, /loadDataCenterView|loadDataCenterProductDetail|产品经营分析已迁移/);
  assert.doesNotMatch(server, /\/api\/data-center\/(?:summary|trends|slow-moving|capital-occupation|products)/);
});
