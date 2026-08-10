import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-combo-design-analysis.db";
const sourceFile = process.env.SALES_DAILY_FILE || "/Users/mac/Downloads/7.9-8.9链接利润报表（SKU明细）.xlsx";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-combo-review-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDb, databasePath); process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { previewSalesDailyFacts } = await import("../server/salesDailyFactPreviewService.js");
const { generatePendingComboGroups, queryComboReviewAnomalyDates, queryComboReviewGroups, queryComboReviewSourceRows, readComboReviewGroup } = await import("../server/salesComboReviewService.js");
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0);
const digestRows = (db, sql) => crypto.createHash("sha256").update(JSON.stringify(db.prepare(sql).all())).digest("hex");
const elapsed = (action) => { const start = performance.now(); const result = action(); return { result, milliseconds: Number((performance.now() - start).toFixed(2)) }; };

try {
  initializeDatabase({ reset: false }); const db = getDatabase(); db.pragma("foreign_keys = ON");
  const protectedBefore = {
    mappings: count(db, "sales_link_sku_erp_mappings"), dailyFacts: count(db, "connection_sku_sales_daily_facts"), periodFacts: count(db, "connection_sku_sales_facts"),
    links: count(db, "sales_links"), linkSkus: count(db, "sales_link_skus"), erpSkus: count(db, "erp_skus"), products: count(db, "products"),
    legacyIdentityHash: digestRows(db, "SELECT id,erpSkuId,productId FROM sales_link_skus ORDER BY id"),
  };
  const existingBatch = db.prepare(`SELECT b.*,SUM(CASE WHEN c.candidateType='combo' THEN 1 ELSE 0 END) comboCandidateCount
    FROM connection_import_batches b JOIN sales_link_sku_erp_mapping_candidates c ON c.sourceBatchId=b.id
    GROUP BY b.id HAVING comboCandidateCount=938 ORDER BY b.createdAt DESC LIMIT 1`).get();
  const preview = existingBatch ? { batch: existingBatch, summary: { comboCandidateCount: 938 } } : previewSalesDailyFacts({ buffer: fs.readFileSync(sourceFile), fileName: path.basename(sourceFile) });
  fs.writeFileSync("/private/tmp/combo-review-progress.txt", "preview\n");
  assert.equal(preview.summary.comboCandidateCount, 938);
  const firstGeneration = generatePendingComboGroups(preview.batch.id, { createdBy: db.prepare("SELECT id FROM persons LIMIT 1").get()?.id });
  assert.equal(firstGeneration.candidateCount, 938); assert.equal(firstGeneration.platformSkuCount, 448);
  assert.equal(firstGeneration.createdGroups, 448); assert.equal(firstGeneration.createdComponents, 938);
  const secondGeneration = generatePendingComboGroups(preview.batch.id, {});
  fs.appendFileSync("/private/tmp/combo-review-progress.txt", "generated\n");
  assert.equal(secondGeneration.createdGroups, 0); assert.equal(secondGeneration.createdComponents, 0); assert.equal(secondGeneration.existingGroups, 448);

  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_combo_groups WHERE sourceBatchId=? AND status='pending'").get(preview.batch.id).total, 448);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_combo_groups WHERE sourceBatchId=? AND status<>'pending'").get(preview.batch.id).total, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) total FROM sales_link_sku_combo_group_components c JOIN sales_link_sku_combo_groups g ON g.id=c.comboGroupId WHERE g.sourceBatchId=?`).get(preview.batch.id).total, 938);
  assert.equal(db.prepare(`SELECT COUNT(*) total FROM sales_link_sku_combo_group_components c JOIN sales_link_sku_combo_groups g ON g.id=c.comboGroupId WHERE g.sourceBatchId=? AND (c.quantity IS NOT NULL OR c.quantitySource IS NOT NULL OR c.status<>'included')`).get(preview.batch.id).total, 0);

  const distribution = Object.fromEntries(db.prepare(`SELECT componentCount,COUNT(*) total FROM (
    SELECT g.id,COUNT(c.id) componentCount FROM sales_link_sku_combo_groups g JOIN sales_link_sku_combo_group_components c ON c.comboGroupId=g.id AND c.status='included'
    WHERE g.sourceBatchId=? GROUP BY g.id) GROUP BY componentCount ORDER BY componentCount`).all(preview.batch.id).map((row) => [row.componentCount, row.total]));
  assert.deepEqual(distribution, { 2: 411, 3: 32, 4: 5 });

  const listTiming = elapsed(() => queryComboReviewGroups({ sourceBatchId: preview.batch.id, status: "pending", page: 1, pageSize: 20 }));
  const fullTiming = elapsed(() => queryComboReviewGroups({ sourceBatchId: preview.batch.id, status: "pending", page: 1, pageSize: 100 }));
  const allGroups = [];
  for (let page = 1; page <= fullTiming.result.pagination.totalPages; page += 1) allGroups.push(...queryComboReviewGroups({ sourceBatchId: preview.batch.id, status: "pending", page, pageSize: 100 }).items);
  assert.equal(listTiming.result.items.length, 20); assert.equal(listTiming.result.pagination.total, 448); assert.equal(listTiming.result.summary.platformSkuCount, 448);
  assert.equal(queryComboReviewGroups({ sourceBatchId: preview.batch.id, componentCount: 4, page: 1, pageSize: 20 }).pagination.total, 5);
  assert.equal(queryComboReviewGroups({ sourceBatchId: preview.batch.id, stability: "changing", page: 1, pageSize: 20 }).pagination.total, 13);
  assert.equal(queryComboReviewGroups({ sourceBatchId: preview.batch.id, platform: listTiming.result.items[0].shop.platform, page: 1, pageSize: 20 }).items.every((item) => item.shop.platform === listTiming.result.items[0].shop.platform), true);
  assert.equal(queryComboReviewGroups({ sourceBatchId: preview.batch.id, page: 2, pageSize: 20 }).items.length, 20);
  assert.equal(allGroups.length, 448);
  fs.appendFileSync("/private/tmp/combo-review-progress.txt", "listed\n");
  const changing = allGroups.filter((group) => group.stability === "changing");
  const singleAnomalyDates = allGroups.reduce((sum, group) => sum + Number(group.stabilityEvidence.singleComponentDates || 0), 0);
  assert.equal(changing.length, 13); assert.equal(singleAnomalyDates, 26);
  assert.equal(allGroups.reduce((sum, group) => sum + group.affectedRowCount, 0), 2174);

  const comboCandidates = db.prepare("SELECT SUM(affectedRowCount) rows,SUM(salesAmount) sales,SUM(profitAmount) profit FROM sales_link_sku_erp_mapping_candidates WHERE sourceBatchId=? AND candidateType='combo'").get(preview.batch.id);
  assert.equal(listTiming.result.summary.affectedRowCount, comboCandidates.rows);
  assert.ok(Math.abs(listTiming.result.summary.salesAmount - comboCandidates.sales) < 0.0001);
  assert.ok(Math.abs(listTiming.result.summary.profitAmount - comboCandidates.profit) < 0.0001);

  const detailCache = new Map();
  const detail = (group) => { if (!detailCache.has(group.id)) detailCache.set(group.id, readComboReviewGroup(group.id)); return detailCache.get(group.id); };
  const stableTwo = allGroups.find((group) => group.componentCount === 2 && group.stability === "stable");
  const three = allGroups.find((group) => group.componentCount === 3); const four = allGroups.find((group) => group.componentCount === 4);
  const changed = changing[0]; const singleAnomaly = allGroups.find((group) => group.stabilityEvidence.singleComponentDates > 0);
  const nonOneToOneSku = db.prepare(`SELECT json_extract(normalizedDataJson,'$.salesLinkSkuId') salesLinkSkuId
    FROM connection_import_rows WHERE batchId=? AND status='pending_relation'
    GROUP BY salesLinkSkuId,json_extract(normalizedDataJson,'$.saleDate')
    HAVING COUNT(DISTINCT json_extract(normalizedDataJson,'$.erpSkuId'))=2
      AND MIN(CAST(json_extract(normalizedDataJson,'$.quantity') AS REAL))<>MAX(CAST(json_extract(normalizedDataJson,'$.quantity') AS REAL))
    LIMIT 1`).get(preview.batch.id)?.salesLinkSkuId;
  const nonOneToOne = allGroups.find((group) => group.platformSku.id === nonOneToOneSku);
  for (const sample of [stableTwo, nonOneToOne, three, four, changed, singleAnomaly]) assert.ok(sample, "缺少要求的真实Combo样例。");
  for (const sample of [stableTwo, nonOneToOne, three, four, changed]) {
    const evidence = detail(sample); assert.equal(evidence.components.length, sample.componentCount);
    assert.ok(evidence.components.every((component) => component.quantity === null && component.quantityLabel === "待人工确认"));
  }
  fs.appendFileSync("/private/tmp/combo-review-progress.txt", "samples\n");
  const anomalyPage = queryComboReviewAnomalyDates(singleAnomaly.id, { page: 1, pageSize: 1 });
  assert.equal(anomalyPage.items.length, 1); assert.ok(anomalyPage.pagination.total >= 1);
  const sourcePage = queryComboReviewSourceRows(stableTwo.id, { page: 1, pageSize: 5 });
  assert.equal(sourcePage.items.length, Math.min(5, sourcePage.pagination.total)); assert.ok(sourcePage.pagination.total > sourcePage.items.length);
  const detailTiming = elapsed(() => readComboReviewGroup(stableTwo.id));
  const sampleSummary = (group) => ({
    shop: group.shop.name, link: group.link.title, platformSku: group.platformSku.specificationName || group.platformSku.platformSkuId,
    componentCount: group.componentCount, stability: group.stability,
    singleComponentDates: group.stabilityEvidence.singleComponentDates, componentSetChangeDates: group.stabilityEvidence.componentSetChangeDates,
    components: detail(group).components.map((component) => ({ merchantSkuCode: component.erpSku.merchantSkuCode, name: component.erpSku.specificationName, draftQuantity: component.quantity, dailyQuantityRange: [component.evidence.dailyQuantityMin, component.evidence.dailyQuantityMax] })),
  });

  const protectedAfter = {
    mappings: count(db, "sales_link_sku_erp_mappings"), dailyFacts: count(db, "connection_sku_sales_daily_facts"), periodFacts: count(db, "connection_sku_sales_facts"),
    links: count(db, "sales_links"), linkSkus: count(db, "sales_link_skus"), erpSkus: count(db, "erp_skus"), products: count(db, "products"),
    legacyIdentityHash: digestRows(db, "SELECT id,erpSkuId,productId FROM sales_link_skus ORDER BY id"),
  };
  assert.deepEqual(protectedAfter, protectedBefore);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM sales_link_sku_erp_mappings WHERE mappingType='combo'").get().total, 0);
  const integrity = db.pragma("integrity_check", { simple: true }); const foreignKeyErrors = db.pragma("foreign_key_check");
  assert.equal(integrity, "ok"); assert.equal(foreignKeyErrors.length, 0);

  const report = {
    success: true, isolatedDatabase: databasePath, sourceFile: path.basename(sourceFile), sourceBatchId: preview.batch.id,
    generation: { first: firstGeneration, second: secondGeneration }, distribution,
    evidence: { changingPlatformSkus: changing.length, singleComponentAnomalyDates: singleAnomalyDates, affectedRows: comboCandidates.rows, salesAmount: comboCandidates.sales, profitAmount: comboCandidates.profit },
    samples: { stableTwo: sampleSummary(stableTwo), nonOneToOne: sampleSummary(nonOneToOne), threeComponents: sampleSummary(three), fourComponents: sampleSummary(four), changing: sampleSummary(changed), singleComponentAnomaly: sampleSummary(singleAnomaly) },
    pagination: { listPageSize: listTiming.result.items.length, listTotal: listTiming.result.pagination.total, sourcePageSize: sourcePage.items.length, sourceTotal: sourcePage.pagination.total, anomalyPageSize: anomalyPage.items.length, anomalyTotal: anomalyPage.pagination.total },
    performanceMs: { listFirstPage: listTiming.milliseconds, listHundred: fullTiming.milliseconds, detail: detailTiming.milliseconds },
    protected: protectedAfter, integrityCheck: integrity, foreignKeyCheckErrors: foreignKeyErrors.length,
  };
  fs.writeFileSync("/private/tmp/combo-review-verification.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  closeDatabase(); fs.rmSync(root, { recursive: true, force: true });
}
