import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("产品链接接口仅按V2关系解析产品归属", async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "product-link-v2-read-"));
  process.env.WUFAN_DB_PATH = path.join(tempDirectory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { queryProductSalesLinks, queryProductSalesSummaries, queryUnmatchedPlatformSkus } = await import("../server/productLinkV2ReadService.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const now = "2026-08-19T10:00:00.000Z";
    database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .run("product-v2", "PRODUCT-V2", "V2归属产品", "成熟期", now, now);
    database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .run("product-legacy", "PRODUCT-LEGACY", "旧字段错误产品", "成熟期", now, now);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("erp-goods-v2", "ERP-GOODS-V2", "V2 ERP货品", "{}", "active", now, now);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES(?,?,?,?,?,?)")
      .run("erp-batch-v2", "goods_info", "v2.xlsx", "hash-v2", "completed", now);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-v2", "ERP-SKU-V2", "erp-goods-v2", "{}", "erp-batch-v2", "erp-batch-v2", "active", now, now);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("product-map-v2", "product-v2", "erp-goods-v2", "erp-sku-v2", "ERP-SKU-V2", "exact_sku", "active", now, now);
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("shop-v2", "测试平台", "测试店铺", "测试店铺", "测试店铺", "active", now, now);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("link-v2", "shop-v2", "goods-v2", "V2测试链接", "strong", "active", now, now);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,platformSkuCode,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("link-sku-v2", "link-v2", "platform-sku-v2", "PLATFORM-SKU-V2", "matched_manual", "active", now, now);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,platformSkuCode,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("link-sku-unmatched", "link-v2", "platform-sku-unmatched", "PLATFORM-SKU-UNMATCHED", "pending", "active", now, now);
    const reviewerId = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get().id;
    database.prepare("INSERT INTO sales_objects(id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)")
      .run("sales-object-v2", "SO-V2", "so-v2", "single", "test", "product_structure", "link-sku-v2", now, now, now, now);
    database.prepare("INSERT INTO sales_link_sku_sales_object_relations(id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,'active','product_structure','{}',?,?)")
      .run("sales-object-relation-v2", "link-sku-v2", "sales-object-v2", now, now, now);
    database.prepare("INSERT INTO sales_object_structures(id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,'draft','product_structure','{}',?,?)")
      .run("sales-object-structure-v2", "sales-object-v2", 1, "structure-hash-v2", now, now, now);
    database.prepare("INSERT INTO sales_object_structure_components(id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,1,'active','product_structure','{}',?,?)")
      .run("sales-object-component-v2", "sales-object-structure-v2", "sales-object-v2", "erp-sku-v2", 1, now, now);
    database.prepare("UPDATE sales_object_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id=?")
      .run(reviewerId, now, now, now, "sales-object-structure-v2");
    database.prepare("INSERT INTO connection_import_batches(id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run("sales-batch-v2", "erp_sales", "", "sales.xlsx", "sales-hash-v2", "2026-08-18", "2026-08-18", "2026-08-18", "completed", now, now);
    database.prepare(`INSERT INTO connection_sku_sales_daily_facts
      (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,'normal',?,1,'{}',?,?)`)
      .run("sales-daily-fact-v2", "link-v2", "link-sku-v2", "erp-sku-v2", "2026-08-18", 1, 100, 60, 40, "sales-batch-v2", now, now);

    const unmatched = queryUnmatchedPlatformSkus({ query: "PLATFORM-SKU", limit: 100 }, { database });
    assert.deepEqual(unmatched.rows.map((row) => row.id), ["link-sku-unmatched"]);
    assert.equal(unmatched.rows[0].productId, null);

    const summaries = queryProductSalesSummaries({ database });
    assert.deepEqual(summaries.map((row) => row.productId), ["product-v2"]);
    assert.equal(summaries[0].linkCount, 1);
    assert.equal(summaries[0].shopCount, 1);

    const links = queryProductSalesLinks("product-v2", { database });
    assert.deepEqual(links.map((row) => row.id), ["link-sku-v2"]);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='sales_link_sku_erp_mappings'").get().count, 0);
    assert.equal(links[0].productId, "product-v2");
    assert.deepEqual(links[0].resolvedErpSkuIds, ["erp-sku-v2"]);
    assert.deepEqual(queryProductSalesLinks("product-legacy", { database }), []);
  } finally {
    closeDatabase();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("正式业务读取服务不直接查询Legacy关系资产", () => {
  const serviceFiles = [
    "productLinkV2ReadService.js",
    "connectionBusinessCockpitService.js",
    "connectionCorePageService.js",
    "connectionDailySalesService.js",
    "connectionService.js",
    "salesDataQualityAnomalyGovernanceService.js",
    "salesRelationGovernanceService.js",
  ];
  for (const fileName of serviceFiles) {
    const source = fs.readFileSync(new URL(`../server/${fileName}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /sales_link_sku_erp_mappings|sales_link_sku_product_structures|sales_link_sku_combo_groups|resolveLinkSkuErpRelation/,
      `${fileName} 不得绕过统一读取门面直接依赖Legacy关系`);
  }
});

test("产品详情关联链接展示7天、15天、30天真实销量", async () => {
  const database = new Database(":memory:");
  database.exec(`CREATE TABLE connection_sku_sales_daily_facts (
    id TEXT PRIMARY KEY,
    salesLinkSkuId TEXT,
    erpSkuId TEXT,
    saleDate TEXT,
    quantity REAL
  )`);
  const insert = database.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES (?,?,?,?,?)");
  insert.run("f-01", "link-sku-a", "erp-sku-a", "2026-08-30", 2);
  insert.run("f-other-erp", "link-sku-a", "erp-sku-b", "2026-08-30", 40);
  insert.run("f-02", "link-sku-a", "erp-sku-a", "2026-08-24", 1);
  insert.run("f-03", "link-sku-a", "erp-sku-a", "2026-08-23", 5);
  insert.run("f-04", "link-sku-a", "erp-sku-a", "2026-08-16", 4);
  insert.run("f-05", "link-sku-a", "erp-sku-a", "2026-08-15", 7);
  insert.run("f-06", "link-sku-a", "erp-sku-a", "2026-08-01", 3);
  insert.run("f-outside", "link-sku-a", "erp-sku-a", "2026-07-31", 99);
  try {
    const { attachProductLinkSalesWindows } = await import("../server/productCenterV2Service.js");
    const { renderUiModule } = await import("../src/uiModuleRegistry.js");
    await import("../src/uiModules/productWorkspaceModules.js");
    const rows = attachProductLinkSalesWindows([
      { salesLinkSkuId: "link-sku-a", title: "有销量链接" },
      { salesLinkSkuId: "link-sku-b", title: "无销量链接" },
    ], { database, erpSkuId: "erp-sku-a" });
    assert.deepEqual(rows[0].salesWindows, { dataDate: "2026-08-30", quantity7d: 3, quantity15d: 12, quantity30d: 22 });
    assert.deepEqual(rows[1].salesWindows, { dataDate: "2026-08-30", quantity7d: 0, quantity15d: 0, quantity30d: 0 });
    const html = renderUiModule("product_links", {
      state: { loaded: true, loading: false, error: "", rows: [
        { ...rows[0], platform: "天猫", shopName: "测试店铺", connectionId: "connection-a" },
        { ...rows[1], platform: "抖店", shopName: "零销量店铺", connectionId: "connection-b" },
        { salesLinkSkuId: "link-sku-c", title: "高销量链接", platform: "淘宝", shopName: "高销量店铺", connectionId: "connection-c", salesWindows: { quantity7d: 10, quantity15d: 10, quantity30d: 10 } },
      ] },
      salesSort: "7d",
      formatMetric: (value) => `销量${value}`,
    });
    for (const expected of ["7天销量", "15天销量", "30天销量", "销量3", "销量12", "销量22"]) assert.match(html, new RegExp(expected));
    assert.match(html, /销量排序/);
    assert.match(html, /data-sales-sort="7d" class="is-active"/);
    assert.ok(html.indexOf("高销量链接") < html.indexOf("有销量链接"));
    assert.ok(html.indexOf("有销量链接") < html.indexOf("无销量链接"));
  } finally {
    database.close();
  }
});
