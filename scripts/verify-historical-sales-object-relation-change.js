import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  analyzeAuthoritativeRelationChange,
  applyAuthoritativeRelationChange,
  resolveHistoricalRelationForFact,
} from "../server/salesObjectRelationHistoryService.js";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("usage: verify-historical-sales-object-relation-change.js <isolated-db>");
const database = new Database(databasePath);
database.pragma("foreign_keys=ON");
const linkSkuId = "sales-link-sku-00e4c0a2527bd800d79c3314";
const current = database.prepare(`SELECT r.*,o.objectCode FROM sales_link_sku_sales_object_relations r
  JOIN sales_objects o ON o.id=r.salesObjectId WHERE r.linkSkuId=? AND r.status='active'`).get(linkSkuId);
const target = database.prepare("SELECT id,objectCode FROM sales_objects WHERE normalizedObjectCode='hp0613-1'").get();
assert(current && target);
const factBefore = database.prepare(`SELECT id,saleDate,erpSkuId,quantity,salesAmount,costAmount,profitAmount
  FROM connection_sku_sales_daily_facts WHERE salesLinkSkuId=? ORDER BY id`).all(linkSkuId);
const financialBefore = database.prepare(`SELECT COUNT(*) facts,ROUND(COALESCE(SUM(salesAmount),0),4) salesAmount,
  ROUND(COALESCE(SUM(costAmount),0),4) costAmount,ROUND(COALESCE(SUM(profitAmount),0),4) profitAmount
  FROM connection_sku_sales_daily_facts`).get();
const actor = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY CASE authRole WHEN 'admin' THEN 0 ELSE 1 END,id LIMIT 1").get()?.id || null;
const analysis = analyzeAuthoritativeRelationChange(database, { linkSkuId, currentSalesObjectId: current.salesObjectId, targetSalesObjectId: target.id });
assert.equal(analysis.classification, "historical_relation_change");
const result = database.transaction(() => applyAuthoritativeRelationChange(database, {
  linkSkuId,
  currentRelation: current,
  targetSalesObjectId: target.id,
  targetSourceType: "platform_goods_v3_projection",
  targetSourceBatchId: analysis.latest.batchId,
  targetSourceReference: { isolatedVerification: true },
  actor,
  timestamp: "2026-08-27T00:00:00.000Z",
  analysis,
}))();
const historicalFact = factBefore[0];
const historical = resolveHistoricalRelationForFact(database, {
  linkSkuId,
  erpSkuId: historicalFact.erpSkuId,
  businessDate: historicalFact.saleDate,
});
assert.equal(historical?.classification, "historical_relation_change");
const active = database.prepare(`SELECT r.*,o.objectCode FROM sales_link_sku_sales_object_relations r
  JOIN sales_objects o ON o.id=r.salesObjectId WHERE r.linkSkuId=? AND r.status='active'`).get(linkSkuId);
assert.equal(active.objectCode, "HP0613-1");
assert.deepEqual(database.prepare(`SELECT id,saleDate,erpSkuId,quantity,salesAmount,costAmount,profitAmount
  FROM connection_sku_sales_daily_facts WHERE salesLinkSkuId=? ORDER BY id`).all(linkSkuId), factBefore);
assert.deepEqual(database.prepare(`SELECT COUNT(*) facts,ROUND(COALESCE(SUM(salesAmount),0),4) salesAmount,
  ROUND(COALESCE(SUM(costAmount),0),4) costAmount,ROUND(COALESCE(SUM(profitAmount),0),4) profitAmount
  FROM connection_sku_sales_daily_facts`).get(), financialBefore);
assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
assert.equal(database.pragma("foreign_key_check").length, 0);
console.log(JSON.stringify({ success: true, linkSkuId, priorCode: current.objectCode, currentCode: active.objectCode, analysis, applied: result,
  historicalFact, historical, financialBefore, integrityCheck: "ok", foreignKeyErrors: 0 }, null, 2));
database.close();
