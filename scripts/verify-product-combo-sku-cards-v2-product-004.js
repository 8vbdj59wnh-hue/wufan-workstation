import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const [sourcePath, platformPath, comboPath] = process.argv.slice(2).map((value) => path.resolve(value || ""));
assert([sourcePath, platformPath, comboPath].every(fs.existsSync), "需要数据库副本、平台货品.xlsx、组合装明细.xlsx");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceHash = sha(sourcePath);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-product-004-"));
const target = path.join(directory, "isolated.db");
fs.copyFileSync(sourcePath, target);
process.env.WUFAN_DB_PATH = target;
const workbookRows = (file) => {
  const workbook = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
};
const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { generateSalesObjectsFromMasterData } = await import("../server/salesObjectMasterDataService.js");
const { listSalesObjectComboSkus } = await import("../server/salesObjectComboSkuReadService.js");

try {
  initializeDatabase({ reset: false });
  const database = getDatabase();
  database.pragma("foreign_keys=ON");
  generateSalesObjectsFromMasterData({ platformRows: workbookRows(platformPath), comboRows: workbookRows(comboPath) }, { database });
  const samples = database.prepare(`SELECT o.id,o.objectCode,COUNT(*) componentCount
    FROM sales_objects o JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
    JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE o.objectType='bundle' AND o.status='active'
    GROUP BY o.id
    HAVING COUNT(*)=1 OR COUNT(*) BETWEEN 2 AND 4 OR COUNT(*)>9
    ORDER BY CASE WHEN COUNT(*)=1 THEN 1 WHEN COUNT(*) BETWEEN 2 AND 4 THEN 2 ELSE 3 END,COUNT(*) DESC`).all();
  const pick = (predicate) => samples.find(predicate);
  const selected = [pick((row) => row.componentCount === 1), pick((row) => row.componentCount >= 2 && row.componentCount <= 4), pick((row) => row.componentCount > 9)];
  assert(selected.every(Boolean), "缺少单组件、2-4组件或超过9组件的隔离样本");
  const results = selected.map((sample) => {
    const item = listSalesObjectComboSkus({ search: sample.objectCode, limit: 100 }, { database }).items.find((row) => row.salesObjectId === sample.id);
    assert(item, `未读取到组合对象 ${sample.objectCode}`);
    assert.equal(item.componentProducts.length, Math.min(9, sample.componentCount), "卡片组件图片槽数量不符合规则");
    const expected = database.prepare(`SELECT c.erpSkuId,p.id productId,p.name productName,p.mainImage
      FROM sales_object_structures s JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
      LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=c.erpSkuId AND pm.currentState='active'
      LEFT JOIN products p ON p.id=pm.productId
      WHERE s.salesObjectId=? AND s.status='active' ORDER BY c.sortOrder,c.id LIMIT 9`).all(sample.id);
    assert.deepEqual(item.componentProducts, expected.map((row) => ({ erpSkuId: row.erpSkuId, productId: row.productId || null, productName: row.productName || "", mainImage: row.mainImage || "" })), "卡片主图并非来自组件Product");
    return { objectCode: sample.objectCode, componentCount: sample.componentCount, displayedImages: item.componentProducts.length };
  });
  const salesObjectId = database.prepare(`SELECT r.salesObjectId FROM sales_link_sku_sales_object_relations r
    JOIN sales_objects o ON o.id=r.salesObjectId AND o.objectType='bundle' AND o.status='active'
    JOIN connection_sku_sales_daily_facts f ON f.salesLinkSkuId=r.linkSkuId WHERE r.status='active' LIMIT 1`).get()?.salesObjectId;
  let salesCheck = null;
  if (salesObjectId) {
    const objectCode = database.prepare("SELECT objectCode FROM sales_objects WHERE id=?").get(salesObjectId).objectCode;
    const item = listSalesObjectComboSkus({ search: objectCode, limit: 100 }, { database }).items.find((row) => row.salesObjectId === salesObjectId);
    const expected = database.prepare(`WITH ranked AS (SELECT f.salesAmount,ROW_NUMBER() OVER (
      PARTITION BY f.salesLinkSkuId,f.saleDate,COALESCE(NULLIF(f.sourceBatchId,''),f.id),COALESCE(f.sourceRowNumber,f.id)
      ORDER BY f.id) rank FROM connection_sku_sales_daily_facts f WHERE EXISTS (
        SELECT 1 FROM sales_link_sku_sales_object_relations r WHERE r.salesObjectId=? AND r.linkSkuId=f.salesLinkSkuId AND r.status='active'))
      SELECT COALESCE(SUM(salesAmount),0) salesAmount FROM ranked WHERE rank=1`).get(salesObjectId).salesAmount;
    assert.equal(item.salesAmount, Number(expected), "卡片销售额未按Sales Object源销售行去重");
    salesCheck = { salesObjectId, salesAmount: item.salesAmount };
  }
  const serviceSource = fs.readFileSync(new URL("../server/salesObjectComboSkuReadService.js", import.meta.url), "utf8");
  assert(!serviceSource.includes("sales_link_sku_product_structure"), "卡片服务读取Legacy Product Structure");
  const result = {
    bundleCount: listSalesObjectComboSkus({ limit: 1 }, { database }).pagination.total,
    layouts: results,
    salesCheck,
    integrityCheck: database.pragma("integrity_check", { simple: true }),
    foreignKeyErrors: database.pragma("foreign_key_check").length,
    sourceDatabaseUnchanged: sha(sourcePath) === sourceHash,
  };
  assert.equal(result.integrityCheck, "ok");
  assert.equal(result.foreignKeyErrors, 0);
  assert(result.sourceDatabaseUnchanged);
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
}
