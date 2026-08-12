import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const [sourcePath, platformPath, comboPath, outputPath] = process.argv.slice(2).map((value) => value ? path.resolve(value) : "");
if (![sourcePath, platformPath, comboPath].every((file) => file && fs.existsSync(file))) throw new Error("需要源数据库、平台货品.xlsx和组合装明细.xlsx。");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-data-018-sales-object-")); const target = path.join(directory, "isolated.db");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); const sourceHash = sha(sourcePath);
fs.copyFileSync(sourcePath, target); process.env.WUFAN_DB_PATH = target;
const rows = (file) => { const workbook = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false }); };
const protectedTables = ["sales_link_sku_erp_mappings", "sales_link_sku_product_structures", "sales_link_sku_product_structure_components", "connection_sku_sales_daily_facts", "erp_skus", "products", "product_erp_mappings"];

const { initializeDatabase, getDatabase, closeDatabase } = await import("../server/db.js");
const { generateSalesObjectsFromMasterData } = await import("../server/salesObjectMasterDataService.js");
const { resolveLinkSkuSalesObjects } = await import("../server/capabilities/resolveLinkSkuSalesObject.js");
const { resolveLinkSkuErpRelations } = await import("../server/capabilities/resolveLinkSkuErpRelation.js");
try {
  initializeDatabase({ reset: false }); const database = getDatabase(); database.pragma("foreign_keys=ON");
  const before = Object.fromEntries(protectedTables.map((table) => [table, database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total]));
  const generated = generateSalesObjectsFromMasterData({ platformRows: rows(platformPath), comboRows: rows(comboPath), sourceBatchId: null }, { database });
  const afterGenerate = Object.fromEntries(protectedTables.map((table) => [table, database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total]));
  const repeat = generateSalesObjectsFromMasterData({ platformRows: rows(platformPath), comboRows: rows(comboPath), sourceBatchId: null }, { database });
  const ids = database.prepare("SELECT linkSkuId FROM sales_link_sku_sales_object_relations WHERE status='active' ORDER BY linkSkuId").all().map((row) => row.linkSkuId);
  const next = {}; const old = {}; let salesObjectSql = 0;
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    Object.assign(next, resolveLinkSkuSalesObjects({ salesLinkSkuIds: batch }, { database, onQuery: () => { salesObjectSql += 1; } }).results);
    Object.assign(old, resolveLinkSkuErpRelations({ salesLinkSkuIds: batch }, { database }).results);
  }
  const difference = { consistent: 0, added: [], reduced: [], conflict: [] };
  for (const linkSkuId of ids) {
    const fresh = new Map(next[linkSkuId].components.map((item) => [item.erpSkuId, Number(item.quantity)]));
    const legacy = new Map((old[linkSkuId].mappings || []).map((item) => [item.erpSkuId, Number(item.quantity)]));
    const a = JSON.stringify([...fresh].sort()), b = JSON.stringify([...legacy].sort());
    if (a === b) difference.consistent += 1;
    else { const add = [...fresh].filter(([key,value]) => !legacy.has(key) || legacy.get(key) !== value); const remove = [...legacy].filter(([key,value]) => !fresh.has(key) || fresh.get(key) !== value); const detail = { linkSkuId, objectCode: next[linkSkuId].salesObject?.objectCode, oldStatus: old[linkSkuId].relationStatus, newComponents: [...fresh], oldComponents: [...legacy] }; if (add.length && !remove.length) difference.added.push(detail); else if (remove.length && !add.length) difference.reduced.push(detail); else difference.conflict.push(detail); }
  }
  const amounts = database.prepare("SELECT SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount FROM connection_sku_sales_daily_facts").get();
  const schema = Object.fromEntries(["sales_objects","sales_link_sku_sales_object_relations","sales_object_structures","sales_object_structure_components"].map((table) => [table, database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total]));
  const types = database.prepare("SELECT objectType,COUNT(*) total FROM sales_objects GROUP BY objectType ORDER BY objectType").all();
  const componentCoverage = database.prepare(`SELECT COUNT(DISTINCT c.erpSkuId) total,COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN c.erpSkuId END) withProduct FROM sales_object_structure_components c LEFT JOIN product_erp_mappings m ON m.erpSkuId=c.erpSkuId AND m.currentState='active' LEFT JOIN products p ON p.id=m.productId`).get();
  const legacy = database.prepare(`SELECT COUNT(*) total,SUM(EXISTS(SELECT 1 FROM sales_object_structure_components c JOIN sales_link_sku_sales_object_relations r ON r.salesObjectId=c.salesObjectId AND r.linkSkuId=s.salesLinkSkuId AND r.status='active' WHERE c.erpSkuId=x.erpSkuId AND c.quantity=x.quantity AND c.status='active')) matched FROM sales_link_sku_product_structures s JOIN sales_link_sku_product_structure_components x ON x.productStructureId=s.id WHERE s.status='active'`).get();
  const result = { success: true, sourceHash, schema, types, generated, repeat, coverage: { totalLinkSkus: database.prepare("SELECT COUNT(*) total FROM sales_link_skus").get().total, activeRelations: ids.length }, resolver: { consistent: difference.consistent, added: difference.added, reduced: difference.reduced, conflict: difference.conflict, sqlPer500: salesObjectSql / Math.ceil(ids.length / 500) }, componentCoverage, legacy: { componentRows: Number(legacy.total), matchedRows: Number(legacy.matched) }, salesFactSimulation: { facts: before.connection_sku_sales_daily_facts, ...amounts, componentAmountColumns: database.prepare("PRAGMA table_info(sales_object_structure_components)").all().filter((column) => /amount|profit/i.test(column.name)).map((column) => column.name) }, protectedBefore: before, protectedAfter: afterGenerate, integrityCheck: database.pragma("integrity_check", { simple: true }), foreignKeyCheckErrors: database.pragma("foreign_key_check").length };
  if (JSON.stringify(before) !== JSON.stringify(afterGenerate)) throw new Error("旧关系或受保护资产发生变化。");
  if (repeat.counts.objectsCreated || repeat.counts.structuresCreated || repeat.counts.componentsCreated || repeat.counts.relationsCreated) throw new Error("历史生成重复执行不幂等。");
  if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase(); if (sha(sourcePath) !== sourceHash) throw new Error("源数据库发生变化。"); fs.rmSync(directory, { recursive: true, force: true });
}
