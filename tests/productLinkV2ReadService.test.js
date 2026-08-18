import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("产品链接接口仅按V2关系解析产品归属", async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "product-link-v2-read-"));
  process.env.WUFAN_DB_PATH = path.join(tempDirectory, "workstation.db");
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
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,productId,erpSkuId,platformSkuId,platformSkuCode,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("link-sku-v2", "link-v2", "product-legacy", null, "platform-sku-v2", "PLATFORM-SKU-V2", "matched_manual", "active", now, now);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,productId,erpSkuId,platformSkuId,platformSkuCode,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("link-sku-unmatched", "link-v2", "product-legacy", null, "platform-sku-unmatched", "PLATFORM-SKU-UNMATCHED", "pending", "active", now, now);
    database.prepare("INSERT INTO sales_link_sku_erp_mappings(id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,createdAt,updatedAt) VALUES(?,?,?,?,?,'active','product_structure',?,?)")
      .run("link-map-v2", "link-sku-v2", "erp-sku-v2", "single", 1, now, now);
    database.prepare("INSERT INTO connection_import_batches(id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run("sales-batch-v2", "erp_sales", "", "sales.xlsx", "sales-hash-v2", "2026-08-18", "2026-08-18", "2026-08-18", "completed", now, now);
    database.prepare("INSERT INTO connection_sku_sales_facts(id,batchId,salesLinkId,salesLinkSkuId,erpSkuId,platformGoodsId,skuCode,periodStart,periodEnd,shippedQuantity,salesAmount,costAmount,profitAmount,rawDataJson,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("sales-fact-v2", "sales-batch-v2", "link-v2", "link-sku-v2", "erp-sku-v2", "goods-v2", "ERP-SKU-V2", "2026-08-18", "2026-08-18", 1, 100, 60, 40, "{}", now);

    const unmatched = queryUnmatchedPlatformSkus({ query: "PLATFORM-SKU", limit: 100 }, { database });
    assert.deepEqual(unmatched.rows.map((row) => row.id), ["link-sku-unmatched"]);
    assert.equal(unmatched.rows[0].productId, null);

    const summaries = queryProductSalesSummaries({ database });
    assert.deepEqual(summaries.map((row) => row.productId), ["product-v2"]);
    assert.equal(summaries[0].linkCount, 1);
    assert.equal(summaries[0].shopCount, 1);

    const links = queryProductSalesLinks("product-v2", { database });
    assert.deepEqual(links.map((row) => row.id), ["link-sku-v2"]);
    assert.equal(links[0].productId, "product-v2");
    assert.deepEqual(links[0].resolvedErpSkuIds, ["erp-sku-v2"]);
    assert.deepEqual(queryProductSalesLinks("product-legacy", { database }), []);
  } finally {
    closeDatabase();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
