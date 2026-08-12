import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDatabase = process.env.SOURCE_DB;
assert.ok(sourceDatabase && fs.existsSync(sourceDatabase), "SOURCE_DB必须指向生产数据库只读副本。");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-data-010-"));
const databasePath = path.join(directory, "isolated.db");
fs.copyFileSync(sourceDatabase, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const sourceSha256 = crypto.createHash("sha256").update(fs.readFileSync(sourceDatabase)).digest("hex");
const { getDatabase, closeDatabase } = await import("../server/db.js");
const { createProductsFromErpSkus } = await import("../server/erpSkuService.js");
const database = getDatabase();

const count = (table) => Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total || 0);
const digestRows = (sql, params = []) => crypto.createHash("sha256").update(JSON.stringify(database.prepare(sql).all(...params))).digest("hex");
const candidateSql = `
  SELECT DISTINCT e.id
  FROM sales_link_sku_erp_mappings lm
  JOIN erp_skus e ON e.id=lm.erpSkuId AND e.currentState='active'
  LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=e.id AND pm.currentState='active'
  WHERE lm.currentState='active' AND pm.id IS NULL
  ORDER BY e.id`;

const candidateIds = database.prepare(candidateSql).all().map((row) => row.id);
const existingProductIds = database.prepare("SELECT id FROM products ORDER BY id").all().map((row) => row.id);
const existingMappingIds = database.prepare("SELECT id FROM product_erp_mappings ORDER BY id").all().map((row) => row.id);
const placeholders = (items) => items.map(() => "?").join(",");
const existingProductsHash = digestRows(`SELECT * FROM products WHERE id IN (${placeholders(existingProductIds)}) ORDER BY id`, existingProductIds);
const existingMappingsHash = digestRows(`SELECT * FROM product_erp_mappings WHERE id IN (${placeholders(existingMappingIds)}) ORDER BY id`, existingMappingIds);

const before = {
  products: count("products"),
  productMappings: count("product_erp_mappings"),
  candidates: candidateIds.length,
  mappedSalesErpSkus: Number(database.prepare("SELECT COUNT(DISTINCT erpSkuId) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total || 0),
  coveredSalesErpSkus: Number(database.prepare(`SELECT COUNT(DISTINCT lm.erpSkuId) total FROM sales_link_sku_erp_mappings lm JOIN product_erp_mappings pm ON pm.erpSkuId=lm.erpSkuId AND pm.currentState='active' WHERE lm.currentState='active'`).get().total || 0),
};

assert.equal(before.candidates, 1295, "隔离副本候选基线不是预期的1295个。");
const created = createProductsFromErpSkus(candidateIds);
assert.equal(created.createdCount, candidateIds.length);

const remainingIds = database.prepare(candidateSql).all().map((row) => row.id);
const repeated = {
  insertedCount: remainingIds.length ? createProductsFromErpSkus(remainingIds).createdCount : 0,
  skippedCount: candidateIds.filter((id) => database.prepare("SELECT 1 FROM product_erp_mappings WHERE erpSkuId=? AND currentState='active'").get(id)).length,
  idempotent: remainingIds.length === 0,
};

const after = {
  products: count("products"),
  productMappings: count("product_erp_mappings"),
  candidates: database.prepare(candidateSql).all().length,
  mappedSalesErpSkus: Number(database.prepare("SELECT COUNT(DISTINCT erpSkuId) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total || 0),
  coveredSalesErpSkus: Number(database.prepare(`SELECT COUNT(DISTINCT lm.erpSkuId) total FROM sales_link_sku_erp_mappings lm JOIN product_erp_mappings pm ON pm.erpSkuId=lm.erpSkuId AND pm.currentState='active' WHERE lm.currentState='active'`).get().total || 0),
};

assert.equal(after.products - before.products, candidateIds.length);
assert.equal(after.productMappings - before.productMappings, candidateIds.length);
assert.equal(after.candidates, 0);
assert.equal(after.mappedSalesErpSkus, before.mappedSalesErpSkus);
assert.equal(after.coveredSalesErpSkus, after.mappedSalesErpSkus);
assert.equal(repeated.insertedCount, 0);
assert.equal(repeated.skippedCount, candidateIds.length);
assert.equal(repeated.idempotent, true);
assert.equal(digestRows(`SELECT * FROM products WHERE id IN (${placeholders(existingProductIds)}) ORDER BY id`, existingProductIds), existingProductsHash, "原产品数据发生变化。");
assert.equal(digestRows(`SELECT * FROM product_erp_mappings WHERE id IN (${placeholders(existingMappingIds)}) ORDER BY id`, existingMappingIds), existingMappingsHash, "原产品映射发生变化。");

const oneToOne = database.prepare(`SELECT COUNT(*) total FROM (
  SELECT pm.erpSkuId FROM product_erp_mappings pm
  WHERE pm.erpSkuId IN (${placeholders(candidateIds)}) AND pm.currentState='active'
  GROUP BY pm.erpSkuId HAVING COUNT(*)=1
)`).get(...candidateIds).total;
assert.equal(Number(oneToOne), candidateIds.length);

const samples = database.prepare(`SELECT e.id erpSkuId,e.merchantSkuCode,g.goodsName,e.specificationName,p.id productId,p.name productName,p.status,p.mainImage,pm.id mappingId
  FROM erp_skus e JOIN erp_goods g ON g.id=e.erpGoodsId
  JOIN product_erp_mappings pm ON pm.erpSkuId=e.id AND pm.currentState='active'
  JOIN products p ON p.id=pm.productId
  WHERE e.id IN (${placeholders(candidateIds)}) ORDER BY e.merchantSkuCode LIMIT 10`).all(...candidateIds);

const statusDistribution = database.prepare(`SELECT p.status,COUNT(*) count FROM product_erp_mappings pm JOIN products p ON p.id=pm.productId
  WHERE pm.erpSkuId IN (${placeholders(candidateIds)}) GROUP BY p.status`).all(...candidateIds);
assert.deepEqual(statusDistribution, [{ status: "开发中", count: candidateIds.length }]);

const fieldQuality = database.prepare(`SELECT COUNT(*) total,
  SUM(trim(COALESCE(p.name,''))='') missingName,SUM(trim(COALESCE(p.skuCode,''))='') missingSkuCode,
  SUM(trim(COALESCE(p.brand,''))='') missingBrand,SUM(trim(COALESCE(p.category,''))='') missingCategory,
  SUM(trim(COALESCE(p.specification,''))='') missingSpecification,SUM(trim(COALESCE(p.mainImage,''))='') missingImage,
  SUM(trim(COALESCE(p.material,''))='') missingMaterial
  FROM product_erp_mappings pm JOIN products p ON p.id=pm.productId
  WHERE pm.erpSkuId IN (${placeholders(candidateIds)})`).get(...candidateIds);

const integrityCheck = database.pragma("integrity_check", { simple: true });
const foreignKeyErrors = database.pragma("foreign_key_check");
assert.equal(integrityCheck, "ok");
assert.equal(foreignKeyErrors.length, 0);

process.stdout.write(`${JSON.stringify({
  success: true,
  sourceDatabase,
  sourceSha256,
  isolatedDatabase: databasePath,
  before,
  firstRun: { insertedCount: created.createdCount, skippedCount: 0 },
  repeated,
  after,
  oneToOneCount: Number(oneToOne),
  existingProductsUnchanged: true,
  existingMappingsUnchanged: true,
  statusDistribution,
  fieldQuality,
  samples,
  integrityCheck,
  foreignKeyErrors: foreignKeyErrors.length,
}, null, 2)}\n`);

closeDatabase();
