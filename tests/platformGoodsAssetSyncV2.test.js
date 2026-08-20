import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

function workbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "平台货品");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("平台货品资产同步先生成Diff，确认后只同步资产和关系候选", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "platform-assets-v2-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
    const { commitPlatformGoodsExcelDataSync, previewPlatformGoodsExcelDataSync, reanalyzePlatformGoodsExcelDataSync } = await import("../server/platformGoodsExcelDataSyncAdapter.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const stamp = "2026-08-20T08:00:00.000Z";
    const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES('shop-existing','淘宝','平台资产测试旧店20260820','平台资产测试旧店20260820','平台资产测试旧店20260820','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,originSource,enrichmentStatus,createdAt,updatedAt) VALUES('link-existing','shop-existing','goods-existing','旧标题','strong','active','platform_goods_excel','complete',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,platformSkuCode,specificationName,matchStatus,currentState,createdAt,updatedAt) VALUES('sku-existing','link-existing','sku-existing','ERP-1','旧规格','erp_linked','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES('erp-batch-assets','goods_info','erp.xlsx','erp-assets','completed',?)").run(stamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES('erp-goods-assets','ERP-GOODS','ERP商品','{}','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES('erp-sku-1','ERP-1','erp-goods-assets','{}','erp-batch-assets','erp-batch-assets','active',?,?)").run(stamp, stamp);
    database.prepare("INSERT INTO sales_objects(id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES('sales-object-existing','ERP-1','erp-1','single','test','test','sku-existing','active',?,?,?,?)").run(stamp, stamp, stamp, stamp);
    database.prepare("INSERT INTO sales_link_sku_sales_object_relations(id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES('relation-existing','sku-existing','sales-object-existing',?,'active','test','{}',?,?)").run(stamp, stamp, stamp);
    database.prepare("INSERT INTO sales_object_structures(id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES('structure-existing','sales-object-existing',1,'hash-existing',?,'draft','test','{}',?,?)").run(stamp, stamp, stamp);
    database.prepare("INSERT INTO sales_object_structure_components(id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES('component-existing','structure-existing','sales-object-existing','erp-sku-1',1,1,'active','test','{}',?,?)").run(stamp, stamp);
    database.prepare("UPDATE sales_object_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id='structure-existing'").run(reviewer.id, stamp, stamp, stamp);

    const sourceRows = [
      { 店铺: "平台资产测试旧店20260820", 货品ID: "goods-existing", 规格ID: "sku-existing", 平台规格编码: "ERP-1", 系统货品: "单品", 货品名称: "新标题", 规格名称: "新规格", 价格: "99.00", 平台库存: "8", 平台商品链接: "https://item.taobao.com/item.htm?id=goods-existing" },
      { 店铺: "平台资产测试新店20260820", 货品ID: "goods-new", 规格ID: "sku-new", 平台规格编码: "ERP-1", 系统货品: "单品", 货品名称: "新链接", 规格名称: "新SKU", 平台商品链接: "https://www.xiaohongshu.com/goods-detail/goods-new" },
      { 店铺: "平台资产测试新店20260820", 货品ID: "goods-conflict", 规格ID: "sku-conflict", 平台规格编码: "ERP-NOT-FOUND", 系统货品: "单品", 货品名称: "关系冲突", 规格名称: "待治理SKU", 平台商品链接: "https://www.xiaohongshu.com/goods-detail/goods-conflict" },
      { 店铺: "平台资产测试新店20260820", 货品ID: "goods-combo", 规格ID: "sku-combo", 平台规格编码: "COMBO-NOT-ERP", 系统货品: "组合装", 货品名称: "组合商品", 规格名称: "结构待治理", 平台商品链接: "https://www.xiaohongshu.com/goods-detail/goods-combo" },
      { 店铺: "平台资产测试新店20260820", 货品ID: "goods-no-erp", 规格ID: "sku-no-erp", 平台规格编码: "", 系统货品: "无", 货品名称: "无需ERP关系", 规格名称: "平台规格", 平台商品链接: "https://www.xiaohongshu.com/goods-detail/goods-no-erp" },
      { 店铺: "总计:", 货品ID: "", 规格ID: "", 平台规格编码: "", 系统货品: "" },
    ];
    const buffer = workbookBuffer(sourceRows);
    const task = database.prepare("SELECT id FROM data_sync_tasks WHERE taskCode='platform_goods_excel_import'").get();
    const before = {
      shops: database.prepare("SELECT COUNT(*) total FROM sales_shops").get().total,
      links: database.prepare("SELECT COUNT(*) total FROM sales_links").get().total,
      skus: database.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total,
      dailyFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
      structures: database.prepare("SELECT COUNT(*) total FROM sales_object_structures").get().total,
    };
    const preview = previewPlatformGoodsExcelDataSync({ taskId: task.id, buffer, fileName: "历史平台货品.xlsx", createdBy: reviewer.id });
    assert.deepEqual(preview.summary.shops, { total: 2, new: 1, updated: 0, unchanged: 1, exception: 0 });
    assert.deepEqual(preview.summary.links, { total: 5, new: 4, updated: 1, unchanged: 0, exception: 0 });
    assert.deepEqual(preview.summary.linkSkus, { total: 5, new: 4, updated: 1, unchanged: 0, exception: 0 });
    assert.deepEqual(preview.summary.erpRelations, { total: 5, existing: 1, newCandidates: 1, governancePending: 1, notApplicable: 1, identityBlocked: 0, unresolved: 1, conflicts: 0 });
    assert.equal(preview.summary.ignoredNonBusiness, 1);
    assert.deepEqual({
      shops: database.prepare("SELECT COUNT(*) total FROM sales_shops").get().total,
      links: database.prepare("SELECT COUNT(*) total FROM sales_links").get().total,
      skus: database.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total,
    }, { shops: before.shops, links: before.links, skus: before.skus }, "预览阶段不应写入资产");

    const committed = commitPlatformGoodsExcelDataSync(preview.dataSyncBatch.id);
    assert.equal(committed.result.shops.created, 1);
    assert.equal(committed.result.links.created, 4);
    assert.equal(committed.result.links.updated, 1);
    assert.equal(committed.result.linkSkus.created, 4);
    assert.equal(committed.result.linkSkus.updated, 1);
    assert.equal(committed.result.erpRelations.candidates, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM product_structure_application_items WHERE approvalStatus='pending'").get().total, 1);
    assert.equal(database.prepare("SELECT title FROM sales_links WHERE id='link-existing'").get().title, "新标题");
    assert.equal(database.prepare("SELECT specificationName FROM sales_link_skus WHERE id='sku-existing'").get().specificationName, "新规格");
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_shops").get().total, before.shops + 1);
    assert.deepEqual(database.prepare("SELECT platform,shopName FROM sales_shops WHERE shopName='平台资产测试新店20260820'").get(), { platform: "小红书", shopName: "平台资产测试新店20260820" });
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_links").get().total, before.links + 4);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total, before.skus + 4);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total, before.dailyFacts);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_object_structures").get().total, before.structures);

    const repeated = previewPlatformGoodsExcelDataSync({ taskId: task.id, buffer, fileName: "历史平台货品.xlsx", createdBy: reviewer.id });
    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.duplicateFile, true);
    assert.equal(repeated.requiresChoice, true);
    assert.equal(repeated.dataSyncBatch.id, preview.dataSyncBatch.id);
    assert.equal(repeated.history.length, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM platform_goods_excel_source_files").get().total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_links").get().total, before.links + 4);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM product_structure_application_items").get().total, 1);
    const repeatedInitialCommit = commitPlatformGoodsExcelDataSync(preview.dataSyncBatch.id);
    assert.equal(repeatedInitialCommit.idempotent, true);
    assert.equal(repeatedInitialCommit.result.links.created, 0);
    assert.equal(repeatedInitialCommit.result.links.updated, 0);

    const reanalyzed = reanalyzePlatformGoodsExcelDataSync(preview.dataSyncBatch.id, { createdBy: reviewer.id });
    assert.equal(reanalyzed.reanalyzed, true);
    assert.notEqual(reanalyzed.dataSyncBatch.id, preview.dataSyncBatch.id);
    assert.equal(reanalyzed.history.length, 2);
    assert.deepEqual(reanalyzed.summary.links, { total: 5, new: 0, updated: 0, unchanged: 5, exception: 0 });
    assert.deepEqual(reanalyzed.summary.linkSkus, { total: 5, new: 0, updated: 0, unchanged: 5, exception: 0 });
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_links").get().total, before.links + 4);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total, before.skus + 4);

    const recommitted = commitPlatformGoodsExcelDataSync(reanalyzed.dataSyncBatch.id);
    assert.equal(recommitted.result.links.created, 0);
    assert.equal(recommitted.result.links.updated, 0);
    assert.equal(recommitted.result.linkSkus.created, 0);
    assert.equal(recommitted.result.linkSkus.updated, 0);
    const duplicateCommit = commitPlatformGoodsExcelDataSync(reanalyzed.dataSyncBatch.id);
    assert.equal(duplicateCommit.idempotent, true);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_links").get().total, before.links + 4);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total, before.skus + 4);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM product_structure_application_items").get().total, 1);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total, before.dailyFacts);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(database.pragma("foreign_key_check").length, 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
