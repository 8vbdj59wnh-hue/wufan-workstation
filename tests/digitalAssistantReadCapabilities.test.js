import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("company scope Link读取、纯GET状态和产品精简查询共享正式能力", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digital-assistant-read-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { getConnectionCoreDetail, listConnectionCoreProfilesPage } = await import("../server/connectionCorePageService.js");
  const { getDataSyncAnomalySummary, getDataSyncCenterOverview } = await import("../server/dataSyncCenterService.js");
  const {
    getProductCenterV2OperatingSummary,
    getProductCenterV2ProductSummary,
    listProductCenterV2Skus,
    queryProductCenterV2Catalog,
  } = await import("../server/productCenterV2Service.js");

  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const stamp = "2026-09-03T01:00:00.000Z";
    const ownerId = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get().id;
    const viewerId = database.prepare("SELECT id FROM persons WHERE id<>? ORDER BY id LIMIT 1").get(ownerId).id;

    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES(?,?,?,?,?,'active',?,?)")
      .run("assistant-shop", "test", "assistant-shop", "assistant-shop", "数字助手验收店铺", stamp, stamp);
    const insertLink = database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,ownerId,identityStrength,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,'strong',?,?,?)");
    insertLink.run("assistant-link-1", "assistant-shop", "goods-001", "公司Link一", ownerId, "active", stamp, stamp);
    insertLink.run("assistant-link-2", "assistant-shop", "goods-002", "公司Link二", ownerId, "active", stamp, stamp);
    insertLink.run("assistant-link-legacy", "assistant-shop", "goods-legacy", "历史Link", ownerId, "inactive", stamp, stamp);

    const selfPage = listConnectionCoreProfilesPage({ page: 1, pageSize: 1, keyword: "公司Link" }, viewerId, false);
    const companyPage1 = listConnectionCoreProfilesPage({ page: 1, pageSize: 1, keyword: "公司Link", platform: "test" }, viewerId, true);
    const companyPage2 = listConnectionCoreProfilesPage({ page: 2, pageSize: 1, keyword: "公司Link", platform: "test" }, viewerId, true);
    assert.equal(selfPage.pagination.total, 0);
    assert.equal(companyPage1.pagination.total, 2);
    assert.equal(companyPage1.items.length, 1);
    assert.equal(companyPage2.items.length, 1);
    assert.notEqual(companyPage1.items[0].id, companyPage2.items[0].id);
    assert.equal(getConnectionCoreDetail("assistant-link-1", viewerId, true).profile.salesLinkId, "assistant-link-1");
    assert.throws(() => getConnectionCoreDetail("assistant-link-1", viewerId, false), /只能查看/u);

    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("assistant-link-sku-na", "assistant-link-1", "platform-na", "not_applicable", "active", stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("assistant-link-sku-missing", "assistant-link-1", "platform-missing", "pending_relation", "active", stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("assistant-link-sku-conflict", "assistant-link-2", "platform-conflict", "pending_relation", "active", stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("assistant-link-sku-legacy", "assistant-link-legacy", "platform-legacy", "pending_relation", "inactive", stamp, stamp);
    database.prepare("INSERT INTO sales_objects(id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)")
      .run("assistant-sales-object", "ASSISTANT-OBJECT", "assistant-object", "single", "test", "test", "assistant", stamp, stamp, stamp, stamp);
    database.prepare("INSERT INTO sales_link_sku_sales_object_relations(id,linkSkuId,salesObjectId,effectiveFrom,effectiveTo,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,'conflict','test','{}',?,?)")
      .run("assistant-conflict-relation", "assistant-link-sku-conflict", "assistant-sales-object", stamp, stamp, stamp, stamp);

    const task = database.prepare("SELECT id FROM data_sync_tasks ORDER BY id LIMIT 1").get();
    database.prepare("INSERT INTO data_sync_exceptions(id,taskId,exceptionType,severity,status,message,entityType,entityId,rawDataJson,createdAt) VALUES(?,?,?,'error','open',?,?,?,'{}',?)")
      .run("assistant-exception-1", task.id, "missing_relation", "待完善一", "link_sku", "assistant-link-sku-missing", stamp);
    database.prepare("INSERT INTO data_sync_exceptions(id,taskId,exceptionType,severity,status,message,entityType,entityId,rawDataJson,createdAt) VALUES(?,?,?,'error','open',?,?,?,'{}',?)")
      .run("assistant-exception-2", task.id, "missing_relation", "待完善二", "link_sku", "assistant-link-sku-missing", stamp);

    const changesBeforeStatusRead = database.totalChanges;
    const overview = getDataSyncCenterOverview({ batchLimit: 1, exceptionLimit: 5 });
    assert.equal(database.totalChanges, changesBeforeStatusRead);
    assert.equal(overview.readOnly, true);
    assert.equal(overview.readStatus.readOnly, true);
    const anomalies = getDataSyncAnomalySummary({ database });
    assert.equal(anomalies.openExceptions.recordCount, 2);
    assert.equal(anomalies.openExceptions.businessObjectCount, 1);
    assert.equal(anomalies.classifications.notApplicable.isAnomaly, false);
    assert.ok(anomalies.classifications.notApplicable.businessObjectCount >= 1);
    assert.ok(anomalies.classifications.masterDataIncomplete.businessObjectCount >= 1);
    assert.ok(anomalies.classifications.relationConflict.businessObjectCount >= 1);
    assert.ok(anomalies.classifications.legacyHistoricalAsset.businessObjectCount >= 1);
    assert.match(anomalies.definitions.masterDataIncomplete, /不等同于新旧关系冲突/u);

    database.prepare("INSERT INTO products(id,skuCode,name,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .run("assistant-product", "PRODUCT-001", "数字助手验收产品", "成熟期", stamp, stamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("assistant-goods", "GOODS-001", "数字助手验收产品", "{}", "active", stamp, stamp);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES(?,?,?,?,?,?)")
      .run("assistant-erp-batch", "goods_info", "assistant.xlsx", "assistant-hash", "completed", stamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("assistant-erp-sku", "ERP-SKU-001", "assistant-goods", JSON.stringify({ prop7: "在售" }), "assistant-erp-batch", "assistant-erp-batch", "active", stamp, stamp);
    database.prepare("INSERT INTO product_erp_mappings(id,productId,erpGoodsId,erpSkuId,merchantSkuCode,matchMethod,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("assistant-product-map", "assistant-product", "assistant-goods", "assistant-erp-sku", "ERP-SKU-001", "exact_sku", "active", stamp, stamp);

    for (const exact of [
      { erpSkuId: "assistant-erp-sku" },
      { productId: "assistant-product" },
      { erpSkuCode: "ERP-SKU-001" },
      { productCode: "GOODS-001" },
    ]) assert.equal(listProductCenterV2Skus({ ...exact, includeHistorical: true, page: 1, pageSize: 1 }).pagination.total, 1);
    const catalog = queryProductCenterV2Catalog({ search: "数字助手验收产品", includeHistorical: true, page: 1, pageSize: 1 });
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.pagination.pageSize, 1);
    assert.equal(Object.hasOwn(catalog.items[0], "rawSourceData"), false);
    assert.ok(Buffer.byteLength(JSON.stringify(catalog)) < 100_000);
    for (const [identifier, by] of [["assistant-product", "productId"], ["assistant-erp-sku", "erpSkuId"], ["ERP-SKU-001", "erpSkuCode"], ["GOODS-001", "productCode"]]) {
      assert.equal(getProductCenterV2ProductSummary(identifier, { by }).item.erpSkuId, "assistant-erp-sku");
    }
    assert.equal(getProductCenterV2OperatingSummary({ days: 30 }).readOnly, true);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(database.pragma("foreign_key_check"), []);
  } catch (error) {
    console.error(error.stack || error);
    throw error;
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
