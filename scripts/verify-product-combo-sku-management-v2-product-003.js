import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const [sourcePath, platformPath, comboPath] = process.argv.slice(2).map((value) => path.resolve(value || ""));
assert([sourcePath, platformPath, comboPath].every(fs.existsSync), "需要数据库副本、平台货品.xlsx、组合装明细.xlsx");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceHash = sha(sourcePath); const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-product-003-"));
const target = path.join(directory, "isolated.db"); fs.copyFileSync(sourcePath, target); process.env.WUFAN_DB_PATH = target;
const rows = (file) => { const workbook = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false }); };
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { generateSalesObjectsFromMasterData } = await import("../server/salesObjectMasterDataService.js");
const { listSalesObjectComboSkus, getSalesObjectComboSkuDetail } = await import("../server/salesObjectComboSkuReadService.js");
try {
  initializeDatabase({ reset: false }); const database = getDatabase(); database.pragma("foreign_keys=ON");
  generateSalesObjectsFromMasterData({ platformRows: rows(platformPath), comboRows: rows(comboPath) }, { database });
  const list = listSalesObjectComboSkus({ limit: 10 }, { database });
  assert(list.pagination.total > 0 && list.items.length === 10, "组合SKU列表或分页无效");
  assert.equal(new Set(list.items.map((row) => row.salesObjectId)).size, list.items.length, "列表重复Sales Object");
  const detail = getSalesObjectComboSkuDetail(list.items[0].salesObjectId, { database });
  assert.equal(detail.salesObject.objectType, "bundle"); assert(detail.components.length > 0, "组合组件为空");
  assert(detail.links.every((row) => row.relation?.salesObject?.id === detail.salesObject.id), "Link反查未经过Sales Object Resolver");
  const directComponents = database.prepare("SELECT erpSkuId,quantity FROM sales_object_structure_components WHERE structureId=? AND status='active' ORDER BY sortOrder,erpSkuId").all(detail.structure.id);
  assert.deepEqual(detail.components.map(({ erpSkuId, quantity }) => ({ erpSkuId, quantity })), directComponents.map(({ erpSkuId, quantity }) => ({ erpSkuId, quantity: Number(quantity) })), "详情组件与Sales Object Structure不一致");
  const directProducts = database.prepare("SELECT COUNT(DISTINCT pm.productId) total FROM sales_object_structure_components c JOIN product_erp_mappings pm ON pm.erpSkuId=c.erpSkuId AND pm.currentState='active' WHERE c.structureId=? AND c.status='active'").get(detail.structure.id).total;
  assert.equal(detail.components.filter((row) => row.productId).length, Number(directProducts), "Product关联数量不一致");
  const sourceText = fs.readFileSync(new URL("../server/salesObjectComboSkuReadService.js", import.meta.url), "utf8");
  assert(!sourceText.includes("sales_link_sku_product_structure"), "组合SKU服务读取Legacy Product Structure");
  assert.equal(detail.salesPerformance.allocation, "source_sales_line_once", "销售金额未按Sales Object源销售行去重");
  const salesObjectWithFacts = database.prepare(`SELECT r.salesObjectId FROM sales_link_sku_sales_object_relations r JOIN sales_objects o ON o.id=r.salesObjectId AND o.objectType='bundle' AND o.status='active' JOIN connection_sku_sales_daily_facts f ON f.salesLinkSkuId=r.linkSkuId WHERE r.status='active' LIMIT 1`).get()?.salesObjectId;
  const salesDetail = salesObjectWithFacts ? getSalesObjectComboSkuDetail(salesObjectWithFacts, { database }) : null;
  if (salesDetail) {
    const direct = database.prepare(`WITH ranked AS (SELECT f.*,ROW_NUMBER() OVER (PARTITION BY f.salesLinkSkuId,f.saleDate,COALESCE(NULLIF(f.sourceBatchId,''),f.id),COALESCE(f.sourceRowNumber,f.id) ORDER BY f.id) rank FROM connection_sku_sales_daily_facts f WHERE EXISTS (SELECT 1 FROM sales_link_sku_sales_object_relations r WHERE r.salesObjectId=? AND r.linkSkuId=f.salesLinkSkuId AND r.status='active')) SELECT SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount FROM ranked WHERE rank=1`).get(salesObjectWithFacts);
    assert.equal(salesDetail.salesPerformance.summary.salesAmount, Number(direct.salesAmount || 0)); assert.equal(salesDetail.salesPerformance.summary.profitAmount, Number(direct.profitAmount || 0));
  }
  const result = { bundleCount: list.pagination.total, sample: { salesObjectId: detail.salesObject.id, objectCode: detail.salesObject.objectCode, componentCount: detail.components.length, linkCount: detail.links.length, productCount: directProducts }, salesSample: salesDetail ? { salesObjectId: salesDetail.salesObject.id, ...salesDetail.salesPerformance.summary } : null, integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyErrors: database.pragma("foreign_key_check").length, sourceDatabaseUnchanged: sha(sourcePath) === sourceHash };
  assert.equal(result.integrityCheck, "ok"); assert.equal(result.foreignKeyErrors, 0); assert(result.sourceDatabaseUnchanged);
  console.log(JSON.stringify(result, null, 2));
} finally { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); }
