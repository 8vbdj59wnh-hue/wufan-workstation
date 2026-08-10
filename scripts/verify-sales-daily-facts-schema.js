import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const databasePath = path.join(os.tmpdir(), `wufan-sales-daily-schema-${process.pid}-${Date.now()}.db`);
process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectConstraint = (operation, pattern, message) => {
  try { operation(); } catch (error) {
    assert(pattern.test(String(error.message)), `${message}：${error.message}`);
    return;
  }
  throw new Error(message);
};

try {
  initializeDatabase({ reset: true });
  const database = getDatabase();
  database.pragma("foreign_keys = ON");
  const now = new Date().toISOString();

  const columns = database.prepare("PRAGMA table_info(connection_sku_sales_daily_facts)").all();
  const expectedColumns = [
    "id", "salesLinkId", "salesLinkSkuId", "erpSkuId", "saleDate", "quantity", "salesAmount", "costAmount", "profitAmount",
    "incomeAmount", "refundAmount", "returnAmount", "postageIncomeAmount", "goodsCostAmount", "returnCostAmount", "postageCostAmount",
    "otherAdjustmentAmount", "feeAmount", "receivedAmount", "factType", "sourceBatchId", "sourceRowNumber", "rawDataJson", "createdAt", "updatedAt",
  ];
  assert(columns.map((column) => column.name).join("|") === expectedColumns.join("|"), "日报事实字段定义不完整或顺序错误。");
  for (const column of ["salesLinkId", "salesLinkSkuId", "erpSkuId", "saleDate", "factType", "sourceBatchId", "sourceRowNumber", "rawDataJson", "createdAt", "updatedAt"]) {
    assert(columns.find((item) => item.name === column)?.notnull === 1, `${column} 必须为非空字段。`);
  }

  const foreignKeys = database.prepare("PRAGMA foreign_key_list(connection_sku_sales_daily_facts)").all();
  const foreignKeyTargets = new Map(foreignKeys.map((item) => [item.from, `${item.table}.${item.to}`]));
  assert(foreignKeyTargets.get("salesLinkId") === "sales_links.id", "salesLinkId外键错误。");
  assert(foreignKeyTargets.get("salesLinkSkuId") === "sales_link_skus.id", "salesLinkSkuId外键错误。");
  assert(foreignKeyTargets.get("erpSkuId") === "erp_skus.id", "erpSkuId外键错误。");
  assert(foreignKeyTargets.get("sourceBatchId") === "connection_import_batches.id", "sourceBatchId外键错误。");

  database.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt)
    VALUES ('daily-shop','天猫','日报测试店','日报测试店','日报测试店','active',?,?)`).run(now, now);
  database.prepare(`INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,originSource,enrichmentStatus,currentState,createdAt,updatedAt)
    VALUES ('daily-link','daily-shop','daily-goods','日报测试链接','goods_id','schema_test','complete','active',?,?)`).run(now, now);
  database.prepare(`INSERT INTO sales_link_skus (id,salesLinkId,platformSkuId,matchStatus,currentState,createdAt,updatedAt)
    VALUES ('daily-link-sku','daily-link','daily-platform-sku','unmatched','active',?,?)`).run(now, now);
  database.prepare(`INSERT INTO erp_goods (id,goodsCode,goodsName,rawSourceData,lastSeenBatchId,currentState,createdAt,updatedAt)
    VALUES ('daily-erp-goods','DAILY-GOODS','日报ERP货品','{}','schema-test','active',?,?)`).run(now, now);
  for (const [id, code] of [["daily-erp-sku-1", "DAILY-SKU-1"], ["daily-erp-sku-2", "DAILY-SKU-2"]]) {
    database.prepare(`INSERT INTO erp_skus (id,merchantSkuCode,erpGoodsId,firstSeenBatchId,lastSeenBatchId,currentState,createdAt,updatedAt)
      VALUES (?,?, 'daily-erp-goods','schema-test','schema-test','active',?,?)`).run(id, code, now, now);
  }
  database.prepare(`INSERT INTO connection_import_batches
    (id,sourceType,externalShopId,fileName,fileHash,businessDate,periodStart,periodEnd,periodType,status,createdAt,updatedAt,importType,previewSummaryJson)
    VALUES ('daily-source-batch','sales_daily','daily-shop','schema-test.xlsx','schema-test-hash','2026-08-09','2026-08-09','2026-08-09','day','validated',?,?,'erp_sales_daily','{}')`).run(now, now);

  const insert = database.prepare(`INSERT INTO connection_sku_sales_daily_facts
    (id,salesLinkId,salesLinkSkuId,erpSkuId,saleDate,quantity,salesAmount,costAmount,profitAmount,incomeAmount,refundAmount,returnAmount,postageIncomeAmount,goodsCostAmount,returnCostAmount,postageCostAmount,otherAdjustmentAmount,feeAmount,receivedAmount,factType,sourceBatchId,sourceRowNumber,rawDataJson,createdAt,updatedAt)
    VALUES (@id,@salesLinkId,@salesLinkSkuId,@erpSkuId,@saleDate,@quantity,@salesAmount,@costAmount,@profitAmount,@incomeAmount,@refundAmount,@returnAmount,@postageIncomeAmount,@goodsCostAmount,@returnCostAmount,@postageCostAmount,@otherAdjustmentAmount,@feeAmount,@receivedAmount,@factType,@sourceBatchId,@sourceRowNumber,@rawDataJson,@createdAt,@updatedAt)`);
  const normal = {
    id: "daily-fact-1", salesLinkId: "daily-link", salesLinkSkuId: "daily-link-sku", erpSkuId: "daily-erp-sku-1", saleDate: "2026-08-09",
    quantity: 2, salesAmount: 100.25, costAmount: 40.1, profitAmount: 50.05, incomeAmount: 100.25, refundAmount: 0, returnAmount: 0,
    postageIncomeAmount: 0, goodsCostAmount: 30.1, returnCostAmount: 0, postageCostAmount: 10, otherAdjustmentAmount: 0, feeAmount: 0,
    receivedAmount: 0, factType: "normal", sourceBatchId: "daily-source-batch", sourceRowNumber: 2, rawDataJson: "{}", createdAt: now, updatedAt: now,
  };
  insert.run(normal);
  insert.run({ ...normal, id: "daily-fact-2", erpSkuId: "daily-erp-sku-2", factType: "combo_component", sourceRowNumber: 3 });
  assert(database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total === 2, "同平台SKU、同日的不同ERP SKU事实未被允许。");

  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-duplicate", sourceRowNumber: 4 }), /UNIQUE constraint failed/, "日报唯一身份没有阻止重复事实。");
  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-link-fk", salesLinkId: "missing-link", saleDate: "2026-08-10" }), /FOREIGN KEY constraint failed/, "salesLinkId外键没有生效。");
  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-sku-fk", salesLinkSkuId: "missing-sku", saleDate: "2026-08-10" }), /FOREIGN KEY constraint failed/, "salesLinkSkuId外键没有生效。");
  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-erp-fk", erpSkuId: "missing-erp", saleDate: "2026-08-10" }), /FOREIGN KEY constraint failed/, "erpSkuId外键没有生效。");
  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-batch-fk", sourceBatchId: "missing-batch", saleDate: "2026-08-10" }), /FOREIGN KEY constraint failed/, "sourceBatchId外键没有生效。");
  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-type", factType: "invalid", saleDate: "2026-08-10" }), /CHECK constraint failed/, "factType约束没有生效。");
  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-date", saleDate: "20260810" }), /CHECK constraint failed/, "saleDate格式约束没有生效。");
  expectConstraint(() => insert.run({ ...normal, id: "daily-fact-row", saleDate: "2026-08-10", sourceRowNumber: 0 }), /CHECK constraint failed/, "sourceRowNumber约束没有生效。");

  const expectedIndexes = new Set([
    "idx_connection_sku_sales_daily_link_date", "idx_connection_sku_sales_daily_erp_date",
    "idx_connection_sku_sales_daily_date", "idx_connection_sku_sales_daily_batch",
  ]);
  const indexes = database.prepare("PRAGMA index_list(connection_sku_sales_daily_facts)").all();
  for (const index of expectedIndexes) assert(indexes.some((item) => item.name === index), `缺少索引 ${index}。`);
  assert(indexes.some((item) => item.unique === 1 && database.prepare(`PRAGMA index_info(${item.name})`).all().map((column) => column.name).join("|") === "salesLinkSkuId|erpSkuId|saleDate"), "缺少日报业务唯一约束。");

  const beforeRepeat = {
    dailyFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
    periodFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total,
    mappings: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total,
  };
  initializeDatabase({ reset: false });
  const afterRepeat = {
    dailyFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_daily_facts").get().total,
    periodFacts: database.prepare("SELECT COUNT(*) total FROM connection_sku_sales_facts").get().total,
    mappings: database.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings").get().total,
  };
  assert(JSON.stringify(afterRepeat) === JSON.stringify(beforeRepeat), "重复迁移改变了事实或V2关系数据。");

  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeyErrors = database.pragma("foreign_key_check");
  assert(integrity === "ok", `integrity_check失败：${integrity}`);
  assert(foreignKeyErrors.length === 0, `foreign_key_check发现${foreignKeyErrors.length}条异常。`);
  console.log(JSON.stringify({ success: true, databasePath, columns: columns.length, foreignKeys: foreignKeys.length, indexes: indexes.map((item) => item.name), facts: afterRepeat.dailyFacts, integrityCheck: integrity, foreignKeyCheckErrors: foreignKeyErrors.length, migrationIdempotent: true, protected: { periodFacts: afterRepeat.periodFacts, v2Mappings: afterRepeat.mappings } }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
}
