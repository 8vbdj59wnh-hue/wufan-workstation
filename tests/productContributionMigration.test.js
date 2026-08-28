import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(relativePath) { return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"); }

test("产品列表和详情明确展示三类数量口径", () => {
  const page = source("src/productCenterPage.js");
  const daily = source("src/uiModules/productDailySales.js");
  for (const label of ["直接销量", "组合贡献销量", "实际出货贡献", "直接销售额"]) assert.match(`${page}\n${daily}`, new RegExp(label));
  assert.match(daily, /Bundle销售额和利润不拆分/);
});

test("经营驾驶舱使用实际出货而非原始Bundle套数", () => {
  const service = source("server/operationManagementService.js");
  const page = source("src/operationDashboardPage.js");
  assert.match(service, /totalPhysicalContribution/);
  assert.match(service, /model\.physicalTrend/);
  assert.match(page, /实际出货/);
});

test("销售经营驾驶舱的产品排行不再分摊Bundle金额", () => {
  const service = source("server/salesBusinessDashboardService.js");
  const capability = source("server/capabilities/queryDailySales.js");
  const page = source("src/uiModules/salesBusinessDashboard.js");
  assert.match(service, /queryDailySalesSummaryComparison/);
  assert.match(service, /readComparison\("product"/);
  assert.match(capability, /queryProductContributions/);
  assert.match(capability, /metricContract: "product-contribution-v1"/);
  assert.match(capability, /bundleAllocation: "none"/);
  assert.match(page, /product: "产品"/);
});

test("链接驾驶舱停止Bundle组件金额分摊", () => {
  const service = source("server/connectionBusinessCockpitService.js");
  assert.match(service, /salesObjectType==="single"/);
  assert.match(service, /bundleAllocation:"none"/);
  assert.doesNotMatch(service, /salesAmount\s*\*\s*attribution\.share/);
});

test("AI产品证据获得新口径且金额仅为Single直接事实", () => {
  const management = source("server/productManagementV2Service.js");
  const diagnosis = source("server/productBusinessDiagnosisService.js");
  assert.match(management, /directSalesQuantity/);
  assert.match(management, /bundleContributionQuantity/);
  assert.match(management, /totalPhysicalContribution/);
  assert.match(management, /bundleAllocation: "none"/);
  assert.match(diagnosis, /ProductBusinessReadModel\.sales/);
});

test("旧字段保留在明确Legacy兼容区而不静默改义", () => {
  const model = source("server/productBusinessReadModel.js");
  assert.match(model, /legacyFields/);
  assert.match(model, /item\.sales\.legacy/);
  assert.match(model, /identity: "ERP SKU"/);
  assert.match(model, /salesContractVersion: "erp-sku-contribution-v2"/);
});

test("新口径仅读Daily Facts、Sales Object BOM和Product Mapping", () => {
  const model = source("server/productContributionReadModel.js");
  assert.match(model, /connection_sku_sales_daily_facts/);
  assert.match(model, /sales_link_sku_sales_object_relations/);
  assert.match(model, /sales_object_structure_components/);
  assert.match(model, /product_erp_mappings/);
  assert.doesNotMatch(model, /FROM connection_sku_sales_facts\b/);
  assert.doesNotMatch(model, /sales_link_sku_product_structures/);
  assert.match(model, /不读Legacy Product Structure/);
});
