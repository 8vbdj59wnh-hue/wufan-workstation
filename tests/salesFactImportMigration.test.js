import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(target) : entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

test("旧周期销售事实仅保留归档，不再有生产写入或重新迁移入口", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const writePattern = /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+connection_sku_sales_facts\b/i;
  const offenders = javascriptFiles(path.join(root, "server")).filter((file) => writePattern.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders, [], `发现旧周期销售事实写入：${offenders.join(", ")}`);

  const productBusiness = fs.readFileSync(path.join(root, "server/productBusinessReadModel.js"), "utf8");
  const previewService = fs.readFileSync(path.join(root, "server/salesDailyFactPreviewService.js"), "utf8");
  const serverEntry = fs.readFileSync(path.join(root, "server/index.js"), "utf8");
  const appState = fs.readFileSync(path.join(root, "src/appState.js"), "utf8");
  assert.match(productBusiness, /FROM connection_sku_sales_daily_facts/);
  assert.doesNotMatch(productBusiness, /FROM connection_sku_sales_facts\b/);
  assert.match(previewService, /resolveLinkSkuRelationsForRead/);
  assert.doesNotMatch(previewService, /connection_sku_sales_facts|previewLegacySalesFactsAsDaily/);
  assert.doesNotMatch(serverEntry, /sales-daily\/migrate-legacy|previewLegacySalesFactsAsDaily/);
  assert.doesNotMatch(appState, /migrate-legacy|reparseLegacyConnectionSalesFactImport/);
});

test("ERP用途未人工确认不再作为商品销售异常", async () => {
  const { classifySalesDetailLine } = await import("../server/capabilities/classifySalesDetailLine.js");
  const result = classifySalesDetailLine({
    normalizationStatus: "valid",
    isAtomicLine: true,
    erpSkuId: "erp-sku-current",
    salesLinkSkuId: "link-sku-current",
  }, {
    erpSkuBusinessUsage: {
      usageType: "unknown",
      isConfirmed: false,
      isUsable: true,
      conflicts: [],
      warnings: [{ code: "ERP_USAGE_NOT_CLASSIFIED" }],
    },
    relation: { relationStatus: "missing", isUsable: false, mappings: [] },
  });
  assert.equal(result.classification, "product_sale");
  assert.equal(result.requiresManualReview, false);
  assert.deepEqual(result.reasonCodes, ["ERP_USAGE_DEFAULT_PRODUCT"]);
});

test("正式销售导入只写daily facts并保持幂等，Legacy表不增长", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sales-fact-single-track-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  const { confirmConnectionDataImport } = await import("../server/connectionDataFoundationService.js");
  const { previewSalesFactDataSync, commitSalesFactDataSync } = await import("../server/salesFactDataSyncAdapter.js");
  const { getDataSyncCenterOverview } = await import("../server/dataSyncCenterService.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const stamp = "2026-08-19T08:00:00.000Z";
    const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 1").get();
    database.prepare("INSERT INTO sales_shops(id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES(?,?,?,?,?,'active',?,?)")
      .run("shop-single-track", "taobao", "测试店铺", "测试店铺", "测试店铺", stamp, stamp);
    database.prepare("INSERT INTO sales_links(id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,'active',?,?)")
      .run("link-single-track", "shop-single-track", "goods-single-track", "单轨链接", "strong", stamp, stamp);
    database.prepare("INSERT INTO sales_link_skus(id,salesLinkId,platformSkuId,platformSkuCode,matchStatus,currentState,createdAt,updatedAt) VALUES(?,?,?,?, 'erp_linked','active',?,?)")
      .run("link-sku-single-track", "link-single-track", "platform-sku-single-track", "PLATFORM-SKU", stamp, stamp);
    database.prepare("INSERT INTO erp_import_batches(id,importType,originalFilename,fileHash,status,createdAt) VALUES(?,?,?,?,?,?)")
      .run("erp-batch-single-track", "goods_info", "erp.xlsx", "erp-single-track", "completed", stamp);
    database.prepare("INSERT INTO erp_goods(id,goodsCode,goodsName,rawSourceData,currentState,createdAt,updatedAt) VALUES(?,?,?,?, 'active',?,?)")
      .run("erp-goods-single-track", "ERP-GOODS", "ERP商品", "{}", stamp, stamp);
    database.prepare("INSERT INTO erp_skus(id,merchantSkuCode,erpGoodsId,rawSourceData,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt) VALUES(?,?,?,?,?,?, 'active',?,?)")
      .run("erp-sku-single-track", "ERP-SKU", "erp-goods-single-track", "{}", "erp-batch-single-track", "erp-batch-single-track", stamp, stamp);
    database.prepare("INSERT INTO sales_objects(id,objectCode,normalizedObjectCode,objectType,source,sourceType,sourceCode,status,firstSeenAt,lastSeenAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)")
      .run("sales-object-single-track", "SO-SINGLE-TRACK", "so-single-track", "single", "test", "sales_object", "link-sku-single-track", stamp, stamp, stamp, stamp);
    database.prepare("INSERT INTO sales_link_sku_sales_object_relations(id,linkSkuId,salesObjectId,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,'active','sales_object','{}',?,?)")
      .run("sales-object-relation-single-track", "link-sku-single-track", "sales-object-single-track", stamp, stamp, stamp);
    database.prepare("INSERT INTO sales_object_structures(id,salesObjectId,version,structureHash,effectiveFrom,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,'draft','sales_object','{}',?,?)")
      .run("sales-object-structure-single-track", "sales-object-single-track", 1, "structure-hash", stamp, stamp, stamp);
    database.prepare("INSERT INTO sales_object_structure_components(id,structureId,salesObjectId,erpSkuId,quantity,sortOrder,status,sourceType,sourceReferenceJson,createdAt,updatedAt) VALUES(?,?,?,?,?,1,'active','sales_object','{}',?,?)")
      .run("sales-object-component-single-track", "sales-object-structure-single-track", "sales-object-single-track", "erp-sku-single-track", 1, stamp, stamp);
    database.prepare("UPDATE sales_object_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id='sales-object-structure-single-track'")
      .run(reviewer.id, stamp, stamp, stamp);

    database.prepare(`INSERT INTO connection_import_batches(id,sourceType,externalShopId,fileName,fileHash,businessDate,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,previewSummaryJson)
      VALUES('legacy-read-only','erp_sales','','历史利润表.xlsx','legacy-read-only-hash','2026-08-18','validated',1,0,1,0,?,?,?,'erp_sales','{}')`).run(reviewer.id, stamp, stamp);
    assert.throws(() => confirmConnectionDataImport("legacy-read-only"), (error) => error.code === "legacy_read_only");

    const legacyTableCount = () => database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='connection_sku_sales_facts'").get().count;
    assert.equal(legacyTableCount(), 0);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      {
        店铺: "测试店铺", 平台货品ID: "goods-single-track", 平台规格ID: "platform-sku-single-track", 商家编码: "ERP-SKU",
        日期: "2026-08-19", 销量: "2", 销售额: "88.8888", 成本: "50", 利润: "38.8888",
      },
      {
        店铺: "合计:", 平台货品ID: "NA", 平台规格ID: "NA", 商家编码: "NA",
        日期: "", 销量: "2", 销售额: "88.8888", 成本: "50", 利润: "38.8888",
      },
    ]), "Sheet1");
    const task = database.prepare("SELECT id FROM data_sync_tasks WHERE taskCode='sales_fact_excel_import'").get();
    const preview = previewSalesFactDataSync({
      taskId: task.id,
      buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      fileName: "正式利润表.xlsx",
      createdBy: reviewer.id,
    });
    assert.equal(preview.summary.excludedRows, 1);
    assert.equal(preview.summary.sourceSalesAmount, 88.8888);
    assert.equal(preview.summary.salesAmountCoverage, 1);
    const committed = commitSalesFactDataSync(preview.dataSyncBatch.id);
    assert.equal(committed.result.insertedCount, 1);
    assert.equal(legacyTableCount(), 0);
    assert.equal(database.prepare("SELECT salesAmount FROM connection_sku_sales_daily_facts WHERE saleDate='2026-08-19'").get().salesAmount, 88.8888);

    const repeated = commitSalesFactDataSync(preview.dataSyncBatch.id);
    assert.equal(repeated.result.insertedCount, 0);
    assert.equal(repeated.result.skippedCount, 1);
    assert.equal(repeated.result.idempotent, true);
    assert.equal(legacyTableCount(), 0);

    const reanalyzed = previewSalesFactDataSync({
      taskId: task.id,
      buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      fileName: "正式利润表.xlsx",
      createdBy: reviewer.id,
    });
    assert.equal(reanalyzed.idempotent, false);
    assert.notEqual(reanalyzed.dataSyncBatch.id, preview.dataSyncBatch.id);
    assert.notEqual(reanalyzed.importBatch.id, preview.importBatch.id);
    assert.equal(reanalyzed.summary.readyRows, 1);
    assert.equal(reanalyzed.summary.errorRows, 0);
    assert.equal(reanalyzed.summary.salesAmountCoverage, 1);
    const overview = getDataSyncCenterOverview();
    assert.equal(overview.latestSalesDailyBatch.id, reanalyzed.importBatch.id);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(database.pragma("foreign_key_check").length, 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
