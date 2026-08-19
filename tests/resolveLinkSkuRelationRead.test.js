import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("正式关系读取仅执行Sales Object Resolver，Shadow Compare独立诊断", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-object-single-read-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { resolveLinkSkuRelationsForRead } = await import("../server/capabilities/resolveLinkSkuRelationRead.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const now = "2026-08-19T16:00:00.000Z";
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("shop-single-read", "test", "测试店铺", "测试店铺", "测试店铺", "active", now, now);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)")
      .run("link-single-read", "shop-single-read", "goods-single-read", "测试链接", "strong", "active", now, now);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("link-sku-single-read", "link-single-read", "platform-sku-single-read", "matched", "active", now, now);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES(?,?,?,?,?,?)")
      .run("erp-batch-single-read", "goods_info", "erp.xlsx", "erp-hash-single-read", "completed", now);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)")
      .run("erp-goods-single-read", "ERP-GOODS-SINGLE-READ", "ERP商品", "{}", "active", now, now);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("erp-sku-single-read", "ERP-SKU-SINGLE-READ", "erp-goods-single-read", "{}", "erp-batch-single-read", "erp-batch-single-read", "active", now, now);
    database.prepare("INSERT INTO sales_objects(id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)")
      .run("sales-object-single-read", "SO-SINGLE-READ", "so-single-read", "single", "test", "platform_goods", "SO-SINGLE-READ", now, now, now, now);
    database.prepare("INSERT INTO sales_link_sku_sales_object_relations(id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,'active','platform_goods','{}',?,?)")
      .run("sales-object-relation-single-read", "link-sku-single-read", "sales-object-single-read", now, now, now);
    database.prepare("INSERT INTO sales_object_structures(id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,'draft','platform_goods','{}',?,?)")
      .run("sales-object-structure-single-read", "sales-object-single-read", 1, "structure-hash-single-read", now, now, now);
    database.prepare("INSERT INTO sales_object_structure_components(id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,1,'active','platform_goods','{}',?,?)")
      .run("sales-object-component-single-read", "sales-object-structure-single-read", "sales-object-single-read", "erp-sku-single-read", 1, now, now);
    const reviewerId = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get().id;
    database.prepare("UPDATE sales_object_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id=?")
      .run(reviewerId, now, now, now, "sales-object-structure-single-read");

    assert.equal(Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_link_sku_erp_mappings'").get()), false,
      "新数据库不得创建Legacy mapping表");
    assert.equal(Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_link_sku_combo_groups'").get()), false,
      "新数据库不得创建Legacy Combo Group表");

    let formalOldQueries = 0;
    let formalNewQueries = 0;
    const formal = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ["link-sku-single-read"] }, {
      database,
      scope: "linkDetail",
      onOldQuery: () => { formalOldQueries += 1; },
      onNewQuery: () => { formalNewQueries += 1; },
    });
    const formalResult = formal.results["link-sku-single-read"];
    assert.equal(formal.feature.mode, "sales_object_single_read");
    assert.equal(formalOldQueries, 0, "正式请求不得执行旧Resolver查询");
    assert(formalNewQueries > 0);
    assert.equal(formalResult.resolverSource, "sales_object");
    assert.equal(formalResult.salesLinkId, "link-single-read");
    assert.deepEqual(formalResult.mappings.map((row) => [row.erpSkuId, row.quantity]), [["erp-sku-single-read", 1]]);
    assert.equal(formal.diagnostics.mode, "disabled");

    let shadowOldQueries = 0;
    const shadow = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ["link-sku-single-read"] }, {
      database,
      scope: "resolverDiagnostic",
      shadowCompare: true,
      logDifference: () => {},
      onOldQuery: () => { shadowOldQueries += 1; },
    });
    assert.equal(shadowOldQueries, 0, "新数据库不存在Legacy Schema时诊断不得执行旧Resolver");
    assert.deepEqual(shadow.results["link-sku-single-read"], formalResult,
      "诊断比较不得改变正式业务结果");
    assert.equal(shadow.diagnostics.mode, "legacy_unavailable");
    assert.equal(shadow.diagnostics.total, 0);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(database.pragma("foreign_key_check").length, 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
