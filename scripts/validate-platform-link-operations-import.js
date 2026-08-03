import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import XLSX from "xlsx";
import { initializeDatabase, getDatabase, closeDatabase } from "../server/db.js";
import {
  confirmConnectionDataImport,
  listConnectionImportTemplates,
  previewConnectionDataImport,
} from "../server/connectionDataFoundationService.js";

const expected = [
  ["天猫-点意旗舰店链接经营模板", 513],
  ["淘宝-半然链接经营模板", 234],
  ["小红书-半然链接经营模板", 283],
  ["京东-点意链接经营模板", 150],
];

const files = process.argv.slice(2);
if (files.length !== expected.length) {
  throw new Error("请依次传入天猫、淘宝、小红书、京东四个样表路径。");
}

initializeDatabase();
const database = getDatabase();
const before = Object.fromEntries(["sales_links", "connection_profiles", "connection_period_snapshots", "products", "sales_link_skus"].map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
const historicalSnapshotIds = database.prepare("SELECT id FROM connection_period_snapshots ORDER BY id").all().map((row) => row.id);
const snapshotDigest = (ids) => crypto.createHash("sha256").update(JSON.stringify(ids.map((snapshotId) => database.prepare("SELECT * FROM connection_period_snapshots WHERE id=?").get(snapshotId)))).digest("hex");
const historicalSnapshotDigestBefore = snapshotDigest(historicalSnapshotIds);
const templates = listConnectionImportTemplates();
const results = [];

for (let index = 0; index < expected.length; index += 1) {
  const [templateName, expectedRows] = expected[index];
  const template = templates.find((item) => item.name === templateName);
  if (!template) throw new Error(`缺少模板：${templateName}`);
  const filePath = path.resolve(files[index]);
  const preview = previewConnectionDataImport({
    buffer: fs.readFileSync(filePath),
    fileName: path.basename(filePath),
    importType: "platform_link_operations",
    templateVersionId: template.currentVersionId,
    userId: null,
  });
  if (preview.preview.filteredRows !== expectedRows) throw new Error(`${templateName} 有效行数应为 ${expectedRows}，实际为 ${preview.preview.filteredRows}`);
  if (preview.blocked || preview.preview.errors) throw new Error(`${templateName} 预览存在阻断或异常。`);
  const confirmed = confirmConnectionDataImport(preview.batch.id);
  const repeated = previewConnectionDataImport({ buffer: fs.readFileSync(filePath), fileName: path.basename(filePath), importType: "platform_link_operations", templateVersionId: template.currentVersionId, userId: null });
  if (!repeated.idempotent || !["completed", "completed_with_errors"].includes(repeated.batch.status)) throw new Error(`${templateName} 重复导入保护失败。`);
  results.push({ templateName, ...preview.preview, result: confirmed.result, repeatedBatchId: repeated.batch.id });
}

const jdTemplate = templates.find((item) => item.name === "京东-点意链接经营模板");
const jdWorkbook = XLSX.read(fs.readFileSync(path.resolve(files[3])), { type: "buffer", raw: true });
const jdSheetName = jdWorkbook.SheetNames[0]; const jdMatrix = XLSX.utils.sheet_to_json(jdWorkbook.Sheets[jdSheetName], { header: 1, defval: "" });
jdMatrix.push([...jdMatrix[2]]);
jdWorkbook.Sheets[jdSheetName] = XLSX.utils.aoa_to_sheet(jdMatrix);
const duplicatePreview = previewConnectionDataImport({ buffer: XLSX.write(jdWorkbook, { type: "buffer", bookType: "xlsx" }), fileName: "京东重复商品测试.xlsx", importType: "platform_link_operations", templateVersionId: jdTemplate.currentVersionId, userId: null });
if (!duplicatePreview.blocked || duplicatePreview.preview.duplicateGoodsIds.length !== 1) throw new Error(`过滤后重复商品ID阻断验证失败：${JSON.stringify(duplicatePreview.preview)}`);

const missingPeriodWorkbook = XLSX.read(fs.readFileSync(path.resolve(files[3])), { type: "buffer", raw: true });
const missingSheetName = missingPeriodWorkbook.SheetNames[0]; const missingMatrix = XLSX.utils.sheet_to_json(missingPeriodWorkbook.Sheets[missingSheetName], { header: 1, defval: "" });
const timeColumn = missingMatrix[0].findIndex((value) => String(value).trim() === "时间"); missingMatrix[2][timeColumn] = "";
missingPeriodWorkbook.Sheets[missingSheetName] = XLSX.utils.aoa_to_sheet(missingMatrix);
const missingPeriodPreview = previewConnectionDataImport({ buffer: XLSX.write(missingPeriodWorkbook, { type: "buffer", bookType: "xlsx" }), fileName: "京东缺失周期测试.xlsx", importType: "platform_link_operations", templateVersionId: jdTemplate.currentVersionId, userId: null });
if (missingPeriodPreview.preview.errors !== 1 || !missingPeriodPreview.rows.some((row) => row.errorType === "missing_period")) throw new Error("周期缺失异常验证失败。");

const after = Object.fromEntries(Object.keys(before).map((table) => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
const integrity = database.pragma("integrity_check");
const foreignKeys = database.pragma("foreign_key_check");
const historicalSnapshotDigestAfter = snapshotDigest(historicalSnapshotIds);
const indexes = database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='connection_period_snapshots' ORDER BY name").all();
const crossShopIdentityPeriods = database.prepare("SELECT externalId,periodStart,periodEnd,COUNT(DISTINCT salesLinkId) AS linkCount FROM connection_period_snapshots WHERE sourceType='platform_operation' GROUP BY externalId,periodStart,periodEnd HAVING linkCount>1").all();
console.log(JSON.stringify({ database: process.env.WUFAN_DB_PATH, before, after, results, anomalyTests: { duplicateBlocked: duplicatePreview.blocked, duplicateGoodsIds: duplicatePreview.preview.duplicateGoodsIds, missingPeriodErrors: missingPeriodPreview.preview.errors }, historicalSnapshotsUnchanged: historicalSnapshotDigestBefore === historicalSnapshotDigestAfter, snapshotIndexReview: { indexes, crossShopIdentityPeriods: crossShopIdentityPeriods.length }, integrity, foreignKeys }, null, 2));
closeDatabase();
