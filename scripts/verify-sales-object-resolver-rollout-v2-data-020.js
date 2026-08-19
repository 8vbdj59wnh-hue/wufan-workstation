import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import XLSX from "xlsx";

const [sourcePath, platformPath, comboPath, outputPath] = process.argv.slice(2).map((value) => value ? path.resolve(value) : "");
assert([sourcePath, platformPath, comboPath].every((file) => file && fs.existsSync(file)), "需要源数据库和两份主数据Excel");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-data-020-rollout-")); const target = path.join(directory, "isolated.db");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); const sourceHash = sha(sourcePath);
fs.copyFileSync(sourcePath, target); process.env.WUFAN_DB_PATH = target;
const rows = (file) => { const workbook = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false }); };
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { generateSalesObjectsFromMasterData } = await import("../server/salesObjectMasterDataService.js");
const { resolveLinkSkuRelationsForRead, readSalesObjectResolverFeature } = await import("../server/capabilities/resolveLinkSkuRelationRead.js");
const { listSalesObjectComboSkus } = await import("../server/salesObjectComboSkuReadService.js");
const { queryLinkBusinessTable } = await import("../server/linkBusinessTableService.js");
const { getProductV2Overview } = await import("../server/productManagementV2Service.js");

try {
  initializeDatabase({ reset: false }); const database = getDatabase(); database.pragma("foreign_keys=ON");
  const protectedTables = ["sales_link_sku_erp_mappings","sales_link_sku_product_structures","connection_sku_sales_daily_facts","erp_skus","products","product_erp_mappings"];
  const counts = () => Object.fromEntries(protectedTables.map((table) => [table, database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total]));
  const before = counts(); generateSalesObjectsFromMasterData({ platformRows: rows(platformPath), comboRows: rows(comboPath) }, { database });
  const ids = database.prepare("SELECT linkSkuId FROM sales_link_sku_sales_object_relations WHERE status='active' ORDER BY linkSkuId LIMIT 500").all().map((row) => row.linkSkuId);
  const logs = [];
  let formalOldQueries = 0; let formalNewQueries = 0; let started = performance.now();
  const formal = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, { database, scope: "comboSkuManagement", salesObjectResolverEnabled: false, onOldQuery: () => formalOldQueries++, onNewQuery: () => formalNewQueries++ });
  const formalMs = performance.now() - started;
  assert.equal(formal.feature.active, true); assert.equal(formal.feature.mode, "sales_object_single_read");
  assert.equal(formalOldQueries, 0); assert(formalNewQueries > 0); assert(Object.values(formal.results).every((row) => row.resolverSource === "sales_object"));
  let shadowOldQueries = 0; let shadowNewQueries = 0; started = performance.now();
  const shadow = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids }, { database, scope: "resolverDiagnostic", shadowCompare: true, logDifference: (row) => logs.push(row), onOldQuery: () => shadowOldQueries++, onNewQuery: () => shadowNewQueries++ });
  const shadowMs = performance.now() - started;
  assert(shadowOldQueries > 0); assert(shadowNewQueries > 0); assert.equal(shadow.diagnostics.mode, "shadow_compare");
  assert.deepEqual(shadow.results, formal.results); assert.equal(shadow.differences.filter((row) => ["reduced","conflict"].includes(row.differenceType)).length, 0);
  const formerlyExcludedScope = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: ids.slice(0, 5) }, { database, scope: "linkBusinessTable", salesObjectResolverEnabled: false });
  assert.equal(formerlyExcludedScope.feature.active, true); assert(Object.values(formerlyExcludedScope.results).every((row) => row.resolverSource === "sales_object"));
  const combo = listSalesObjectComboSkus({ limit: 100 }, { database, salesObjectResolverEnabled: true, logDifference: (row) => logs.push(row) });
  assert(combo.items.length > 0); assert(combo.items.every((row) => row.objectType === "bundle" && row.relation.isUsable));
  const knownAdded = database.prepare(`SELECT r.linkSkuId FROM sales_link_sku_sales_object_relations r
    WHERE r.status='active' AND NOT EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.salesLinkSkuId=r.linkSkuId AND m.currentState='active') LIMIT 1`).get();
  if (knownAdded) {
    const addedRead = resolveLinkSkuRelationsForRead({ salesLinkSkuIds: [knownAdded.linkSkuId] }, { database, scope: "resolverDiagnostic", shadowCompare: true, logDifference: (row) => logs.push(row) });
    assert.equal(addedRead.differences[0]?.differenceType, "added"); assert.equal(addedRead.results[knownAdded.linkSkuId].resolverSource, "sales_object");
  }
  const administrator = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get();
  const oldFlag = process.env.SALES_OBJECT_RESOLVER_ENABLED;
  process.env.SALES_OBJECT_RESOLVER_ENABLED = "0"; const businessOff = queryLinkBusinessTable({ scope: "company", preset: "custom", startDate: "2026-07-09", endDate: "2026-08-09", pageSize: 20 }, administrator.id, true); const productOff = getProductV2Overview();
  process.env.SALES_OBJECT_RESOLVER_ENABLED = "1"; const businessOn = queryLinkBusinessTable({ scope: "company", preset: "custom", startDate: "2026-07-09", endDate: "2026-08-09", pageSize: 20 }, administrator.id, true); const productOn = getProductV2Overview();
  if (oldFlag === undefined) delete process.env.SALES_OBJECT_RESOLVER_ENABLED; else process.env.SALES_OBJECT_RESOLVER_ENABLED = oldFlag;
  assert.deepEqual(businessOn, businessOff); assert.deepEqual(productOn, productOff);
  const facts = database.prepare("SELECT COUNT(*) total,SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount FROM connection_sku_sales_daily_facts").get();
  const after = counts(); assert.deepEqual(after, before);
  const result = { success: true, sourceHash, legacyFlagMetadata: readSalesObjectResolverFeature({ environment: {} }), formal: { active: formal.feature.active, mode: formal.feature.mode, batchSize: ids.length, oldQueries: formalOldQueries, newQueries: formalNewQueries, elapsedMs: Number(formalMs.toFixed(4)) }, shadowCompare: { oldQueries: shadowOldQueries, newQueries: shadowNewQueries, elapsedMs: Number(shadowMs.toFixed(4)), summary: shadow.diagnostics, differences: shadow.differences }, formerlyExcludedScope: formerlyExcludedScope.feature, comboSkuManagement: { items: combo.items.length, usable: combo.items.filter((row) => row.relation.isUsable).length, differences: combo.differences }, existingBusinessReads: { linkBusinessTableStable: true, productWorkspaceStable: true, businessRows: businessOn.items?.length ?? businessOn.rows?.length ?? 0, products: productOn.total }, metrics: { facts: facts.total, salesAmount: facts.salesAmount, profitAmount: facts.profitAmount, unchanged: true }, protectedBefore: before, protectedAfter: after, differenceLogs: logs, integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyCheckErrors: database.pragma("foreign_key_check").length };
  if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result, null, 2));
} finally { closeDatabase(); assert.equal(sha(sourcePath), sourceHash); fs.rmSync(directory, { recursive: true, force: true }); }
