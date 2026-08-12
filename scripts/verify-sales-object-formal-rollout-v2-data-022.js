import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const [sourcePath, platformPath, comboPath, outputPath] = process.argv.slice(2).map((value) => value ? path.resolve(value) : "");
assert([sourcePath, platformPath, comboPath].every((file) => file && fs.existsSync(file)));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-data-022-formal-")); const target = path.join(directory, "isolated.db");
const fileHash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); const sourceHash = fileHash(sourcePath);
fs.copyFileSync(sourcePath, target); process.env.WUFAN_DB_PATH = target;
const rows = (file) => { const workbook = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false }); };
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { generateSalesObjectsFromMasterData } = await import("../server/salesObjectMasterDataService.js");
const { getConnectionCoreDetail } = await import("../server/connectionCorePageService.js");
const { getConnectionDailySalesPerformance } = await import("../server/connectionDailySalesService.js");
const { getConnectionBusinessCockpit } = await import("../server/connectionBusinessCockpitService.js");
const { getProductCenterV2SkuDetail, listProductCenterV2Skus } = await import("../server/productCenterV2Service.js");
const { getProductBusinessAnalysis } = await import("../server/productManagementV2Service.js");
const { getSalesObjectComboSkuDetail, listSalesObjectComboSkus } = await import("../server/salesObjectComboSkuReadService.js");

try {
  initializeDatabase({ reset: false }); const database = getDatabase(); database.pragma("foreign_keys=ON");
  const snapshot = () => ({ facts: database.prepare("SELECT COUNT(*) count,SUM(salesAmount) sales,SUM(profitAmount) profit FROM connection_sku_sales_daily_facts").get(), mappings: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings").get().count, structures: database.prepare("SELECT COUNT(*) count FROM sales_link_sku_product_structures").get().count, products: database.prepare("SELECT COUNT(*) count FROM products").get().count, inventory: database.prepare("SELECT COUNT(*) count FROM erp_sku_inventory_daily_summaries").get().count });
  const before = snapshot(); generateSalesObjectsFromMasterData({ platformRows: rows(platformPath), comboRows: rows(comboPath) }, { database });
  const connection = database.prepare(`SELECT c.id,c.ownerId FROM connection_profiles c WHERE EXISTS (SELECT 1 FROM connection_sku_sales_daily_facts f WHERE f.salesLinkId=c.salesLinkId) AND EXISTS (SELECT 1 FROM sales_link_skus x JOIN sales_link_sku_sales_object_relations r ON r.linkSkuId=x.id WHERE x.salesLinkId=c.salesLinkId AND r.status='active') ORDER BY c.id LIMIT 1`).get();
  const detail = getConnectionCoreDetail(connection.id, connection.ownerId, true); assert(detail.skuSales.every((row) => !row.isUsable || row.erpRelations.every((item) => item.salesObjectId)));
  const daily = getConnectionDailySalesPerformance({ connectionId: connection.id, startDate: "2026-07-09", endDate: "2026-08-09" }, { database }); assert(daily.bySku.items.every((row) => !row.relation.isUsable || row.relation.erpSkus.length > 0));
  const erpSku = database.prepare("SELECT c.erpSkuId FROM sales_object_structure_components c JOIN product_erp_mappings p ON p.erpSkuId=c.erpSkuId AND p.currentState='active' LIMIT 1").get();
  const skuLinks = getProductCenterV2SkuDetail(erpSku.erpSkuId, { scope: "links" }).links; assert(skuLinks.length > 0); assert(skuLinks.every((row) => row.relation?.resolverSource === "sales_object"));
  const productId = database.prepare("SELECT productId FROM product_erp_mappings WHERE erpSkuId=? AND currentState='active'").get(erpSku.erpSkuId).productId;
  const product = getProductBusinessAnalysis(productId); assert(product.product.id === productId);
  const skuList = listProductCenterV2Skus({ limit: 20, includeUnarchived: true }); assert(skuList.rows.length > 0);
  const combo = listSalesObjectComboSkus({ limit: 100 }, { database }); assert.equal(combo.source, "sales_object_v1"); assert.equal(new Set(combo.items.map((row) => row.salesObjectId)).size, combo.items.length);
  const comboDetail = getSalesObjectComboSkuDetail(combo.items[0].salesObjectId, { database }); assert(comboDetail.links.every((row) => row.relation?.salesObject?.id === comboDetail.salesObject.id && row.relation.isUsable));
  const cockpit = getConnectionBusinessCockpit("", true); const after = snapshot(); assert.deepEqual(after, before);
  const facts = before.facts;
  const result = { success: true, sourceHash, switched: { linkDetail: { connectionId: connection.id, skuSales: detail.skuSales.length, products: detail.products.length }, linkDailySales: { skuRows: daily.bySku.items.length, salesAmount: daily.summary.salesAmount, profitAmount: daily.summary.profitAmount }, productAssociations: { erpSkuId: erpSku.erpSkuId, links: skuLinks.length }, productWorkspace: { productId, analysisLoaded: true }, skuManagement: { rows: skuList.rows.length }, comboSkuManagement: { rows: combo.items.length }, businessCockpit: { connections: cockpit.summary.connectionCount } }, metrics: { facts: facts.count, salesAmount: facts.sales, profitAmount: facts.profit, unchanged: true }, productCoverage: database.prepare("SELECT COUNT(DISTINCT c.erpSkuId) total,COUNT(DISTINCT pm.erpSkuId) covered FROM sales_object_structure_components c LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=c.erpSkuId AND pm.currentState='active'").get(), legacy: { mappings: before.mappings, structures: before.structures, unchanged: true }, integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyCheckErrors: database.pragma("foreign_key_check").length };
  if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result, null, 2));
} finally { closeDatabase(); assert.equal(fileHash(sourcePath), sourceHash); fs.rmSync(directory, { recursive: true, force: true }); }
