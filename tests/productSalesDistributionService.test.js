import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getProductSalesDistribution, resolveProductSalesDistributionRange } from "../server/productSalesDistributionService.js";
import { renderProductSalesDistribution } from "../src/uiModules/productSalesDistribution.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,skuCode TEXT,mainImage TEXT,brand TEXT,category TEXT,status TEXT,ownerId TEXT);
    CREATE TABLE persons(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE product_erp_mappings(id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,currentState TEXT,updatedAt TEXT);
    CREATE TABLE operating_erp_set_members(erpSkuId TEXT,lifecycleStatus TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,saleDate TEXT,salesLinkId TEXT,salesLinkSkuId TEXT,quantity REAL,salesAmount REAL,costAmount REAL,profitAmount REAL,sourceBatchId TEXT);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectCode TEXT,objectType TEXT,status TEXT);
    CREATE TABLE sales_link_sku_sales_object_relations(id TEXT PRIMARY KEY,linkSkuId TEXT,salesObjectId TEXT,status TEXT);
    CREATE TABLE sales_object_structures(id TEXT PRIMARY KEY,salesObjectId TEXT,version INTEGER,status TEXT,validityBasis TEXT,sourceType TEXT);
    CREATE TABLE sales_object_structure_components(id TEXT PRIMARY KEY,structureId TEXT,erpSkuId TEXT,quantity REAL,sortOrder INTEGER,status TEXT);
    CREATE TABLE sales_object_structure_effective_periods(id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,validFrom TEXT,validTo TEXT,sourceState TEXT,validityBasis TEXT);
    INSERT INTO persons VALUES('owner-1','负责人甲');
    INSERT INTO products VALUES
      ('product-a','花瓶A','A','/uploads/a.jpg','半然','花瓶','在售','owner-1'),
      ('product-b','花瓶B','B','','半然','花瓶','在售',NULL),
      ('product-c','组合贡献产品','C','','半然','花材','在售',NULL),
      ('product-d','历史产品','D','','半然','花瓶','已归档',NULL);
    INSERT INTO product_erp_mappings VALUES
      ('map-a','product-a','erp-a','active','2026-08-20'),
      ('map-b','product-b','erp-b','active','2026-08-20'),
      ('map-c','product-c','erp-c','active','2026-08-20'),
      ('map-d','product-d','erp-d','active','2026-08-20');
    INSERT INTO operating_erp_set_members VALUES
      ('erp-a','active'),('erp-b','sales_active'),('erp-c','active_dependency'),('erp-d','archived');
    INSERT INTO sales_objects VALUES
      ('object-a','A','single','active'),('object-b','B','single','active'),('object-c','C-BUNDLE','bundle','active');
    INSERT INTO sales_link_sku_sales_object_relations VALUES
      ('relation-a','link-sku-a','object-a','active'),('relation-b','link-sku-b','object-b','active'),('relation-c','link-sku-c','object-c','active');
    INSERT INTO sales_object_structures VALUES
      ('structure-a','object-a',1,'active','exact','formal'),
      ('structure-b','object-b',1,'active','exact','formal'),
      ('structure-c','object-c',1,'active','exact','formal');
    INSERT INTO sales_object_structure_components VALUES
      ('component-a','structure-a','erp-a',1,1,'active'),
      ('component-b','structure-b','erp-b',1,1,'active'),
      ('component-c','structure-c','erp-c',2,1,'active');
    INSERT INTO connection_sku_sales_daily_facts VALUES
      ('fact-a','2026-08-20','link-a','link-sku-a',10,100,60,40,'batch-1'),
      ('fact-b','2026-08-20','link-b','link-sku-b',4,40,25,15,'batch-1'),
      ('fact-c','2026-08-20','link-c','link-sku-c',3,200,120,80,'batch-1');
  `);
  return database;
}

test("产品销售结构按直接销售额排序且不拆分组合装金额", () => {
  const database = fixture();
  const before = database.prepare("SELECT COUNT(*) facts,SUM(salesAmount) sales FROM connection_sku_sales_daily_facts").get();
  const result = getProductSalesDistribution({ preset: "custom", startDate: "2026-08-20", endDate: "2026-08-20" }, { database });
  assert.deepEqual(result.items.map((item) => item.productId), ["product-a", "product-b", "product-c"]);
  assert.equal(result.items[0].directSalesAmount, 100);
  assert.equal(result.items[1].directSalesAmount, 40);
  assert.equal(result.items[2].directSalesAmount, null);
  assert.equal(result.items[2].totalPhysicalContribution, 6);
  assert.equal(result.summary.totalDirectSalesAmount, 140);
  assert.equal(result.summary.totalPhysicalContribution, 20);
  assert.equal(result.summary.productsWithSalesAmount, 2);
  assert.equal(result.summary.productsWithPhysicalContribution, 3);
  assert.deepEqual(database.prepare("SELECT COUNT(*) facts,SUM(salesAmount) sales FROM connection_sku_sales_daily_facts").get(), before);
  database.close();
});

test("产品销售结构默认排除历史产品且可显式查看", () => {
  const database = fixture();
  const current = getProductSalesDistribution({ preset: "custom", startDate: "2026-08-20", endDate: "2026-08-20" }, { database });
  const all = getProductSalesDistribution({ preset: "custom", startDate: "2026-08-20", endDate: "2026-08-20", includeHistorical: true }, { database });
  assert.equal(current.items.some((item) => item.productId === "product-d"), false);
  assert.equal(all.items.some((item) => item.productId === "product-d"), true);
  assert.equal(all.items.find((item) => item.productId === "product-d").noData, true);
  database.close();
});

test("产品销售结构支持驾驶舱时间档位并限制自定义周期", () => {
  assert.deepEqual(resolveProductSalesDistributionRange({ preset: "15d" }, "2026-08-20"), { preset: "15d", startDate: "2026-08-06", endDate: "2026-08-20" });
  assert.throws(() => resolveProductSalesDistributionRange({ preset: "custom", startDate: "2025-01-01", endDate: "2026-08-20" }), /不超过366天/u);
});

test("产品柱形图展示真实口径并提供分组和产品档案下钻", () => {
  const database = fixture();
  const state = getProductSalesDistribution({ preset: "custom", startDate: "2026-08-20", endDate: "2026-08-20" }, { database });
  const html = renderProductSalesDistribution({ state });
  assert.match(html, /公司产品销售结构/u);
  assert.match(html, /组合装金额不拆分/u);
  assert.match(html, /data-product-distribution-group="1"/u);
  assert.doesNotMatch(html, /data-product-distribution-bar/u);
  assert.doesNotMatch(html, /data-product-distribution-tooltip/u);
  const zoomed = renderProductSalesDistribution({ state: { ...state, selectedGroup: 1 }, resolveUrl: (value) => `http://127.0.0.1:3001${value}` });
  assert.match(zoomed, /data-product-distribution-product="product-a"/u);
  assert.match(zoomed, /data-product-distribution-bar/u);
  assert.match(zoomed, /data-product-distribution-tooltip/u);
  assert.match(zoomed, /data-tooltip-name="花瓶A"/u);
  assert.match(zoomed, /data-tooltip-image="http:\/\/127\.0\.0\.1:3001\/uploads\/a\.jpg"/u);
  assert.match(zoomed, /点击柱形进入对应产品档案/u);
  database.close();
});

test("产品中心提供经营驾驶舱入口并通过只读接口加载柱形图", () => {
  const page = fs.readFileSync(path.join(root, "src/productCenterPage.js"), "utf8");
  const appState = fs.readFileSync(path.join(root, "src/appState.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  assert.match(page, /data-view="business-cockpit"[^>]*>经营驾驶舱</u);
  assert.match(page, /renderUiModule\("product_sales_distribution"/u);
  assert.match(appState, /\/api\/product-management\/sales-distribution/u);
  assert.match(server, /app\.get\("\/api\/product-management\/sales-distribution"/u);
  assert.match(server, /visibleProductIds/u);
});
