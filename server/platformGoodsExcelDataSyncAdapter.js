import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { getDatabase } from "./db.js";
import { assertCurrentDataSyncPreview, completeDataSyncBatch, createDataSyncBatch, getDataSyncBatch, getDataSyncTask, markDataSyncBatchPreviewReady } from "./dataSyncCenterService.js";

const TASK_CODE = "platform_goods_excel_import";
const SOURCE_BATCH_TYPE = "platform_goods_excel_import";
const PARSER_VERSION = "platform-goods-excel-v2-mapping";
const text = (value) => String(value ?? "").trim();

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return text(value).replace(/\.0+$/u, "");
}

function parseWorkbook(buffer) {
  if (!buffer?.length) throw new Error("请选择平台货品Excel文件。");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
  const required = ["店铺", "货品ID", "规格ID", "平台规格编码", "系统货品"];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missing = required.filter((field) => !headers.includes(field));
  if (missing.length) throw new Error(`Excel缺少必需字段：${missing.join("、")}。`);
  return { sheetName, rows: rows.map((row, index) => ({
    rowNumber: index + 2,
    sourceShopName: normalizeCell(row["店铺"]),
    platformGoodsId: normalizeCell(row["货品ID"]),
    platformSkuId: normalizeCell(row["规格ID"]),
    merchantSkuCode: normalizeCell(row["平台规格编码"]),
    systemGoodsType: normalizeCell(row["系统货品"]),
    sourceModifiedAt: normalizeCell(row["最后修改时间"]),
    rawData: row,
  })) };
}

function mapUnique(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = text(row[key]);
    if (!value) continue;
    const list = result.get(value) || [];
    list.push(row);
    result.set(value, list);
  }
  return result;
}

function exception(row, exceptionType, message, extra = {}) {
  return {
    ...row, action: "exception", exceptionType, message,
    rawData: { ...row.rawData, ...extra },
  };
}

function analyzeRows(rows, { shopId, sourceShopName }) {
  const db = getDatabase();
  const shop = db.prepare("SELECT id,platform,shopName,displayName,status FROM sales_shops WHERE id=?").get(shopId);
  if (!shop || shop.status !== "active") throw new Error("请选择有效的系统店铺。");
  const filtered = rows.filter((row) => row.sourceShopName === sourceShopName);
  if (!filtered.length) throw new Error(`文件中未找到店铺“${sourceShopName}”的数据。`);

  const links = db.prepare("SELECT id,platformGoodsId FROM sales_links WHERE shopId=?").all(shopId);
  const linkMap = mapUnique(links, "platformGoodsId");
  const linkIds = links.map((row) => row.id);
  const platformSkus = linkIds.length
    ? db.prepare(`SELECT id,salesLinkId,platformSkuId,platformSkuCode,erpSkuId FROM sales_link_skus WHERE salesLinkId IN (${linkIds.map(() => "?").join(",")})`).all(...linkIds)
    : [];
  const skuMap = new Map();
  for (const row of platformSkus) {
    const key = `${row.salesLinkId}\u0000${text(row.platformSkuId)}`;
    const list = skuMap.get(key) || [];
    list.push(row); skuMap.set(key, list);
  }
  const erpMap = mapUnique(db.prepare("SELECT id,merchantSkuCode FROM erp_skus").all(), "merchantSkuCode");
  const seenSkuIds = new Set();
  const evaluated = [];

  for (const row of filtered) {
    if (!row.platformGoodsId) { evaluated.push(exception(row, "missing_platform_goods_id", "货品ID为空，无法匹配链接。")); continue; }
    if (!row.platformSkuId) { evaluated.push(exception(row, "missing_platform_sku_id", "规格ID为空，无法确定平台SKU身份。")); continue; }
    if (row.systemGoodsType === "组合装") { evaluated.push(exception(row, "bundle_sku", "组合装可能对应多个ERP SKU，已隔离。")); continue; }
    if (!row.systemGoodsType || row.systemGoodsType === "无") { evaluated.push(exception(row, "no_system_goods", "系统货品为空或为“无”，已隔离。")); continue; }
    if (!row.merchantSkuCode) { evaluated.push(exception(row, "missing_erp_sku_code", "平台规格编码为空，无法匹配ERP SKU。")); continue; }
    const identity = `${row.platformGoodsId}\u0000${row.platformSkuId}`;
    if (seenSkuIds.has(identity)) { evaluated.push(exception(row, "duplicate_platform_sku", "文件内平台SKU重复，已隔离。")); continue; }
    seenSkuIds.add(identity);
    const matchedLinks = linkMap.get(row.platformGoodsId) || [];
    if (!matchedLinks.length) { evaluated.push(exception(row, "missing_sales_link", "货品ID未匹配到目标店铺链接资产。")); continue; }
    if (matchedLinks.length > 1) { evaluated.push(exception(row, "ambiguous_sales_link", "货品ID匹配到多个链接资产。")); continue; }
    const salesLink = matchedLinks[0];
    const matchedPlatformSkus = skuMap.get(`${salesLink.id}\u0000${row.platformSkuId}`) || [];
    if (!matchedPlatformSkus.length) { evaluated.push(exception(row, "missing_platform_sku", "规格ID未匹配到链接下的平台SKU。")); continue; }
    if (matchedPlatformSkus.length > 1) { evaluated.push(exception(row, "ambiguous_platform_sku", "规格ID匹配到多个平台SKU关系。")); continue; }
    const matchedErpSkus = erpMap.get(row.merchantSkuCode) || [];
    if (!matchedErpSkus.length) { evaluated.push(exception(row, "missing_erp_sku", "平台规格编码未匹配到ERP SKU。")); continue; }
    if (matchedErpSkus.length > 1) { evaluated.push(exception(row, "ambiguous_erp_sku", "ERP SKU编码存在歧义。")); continue; }
    const platformSku = matchedPlatformSkus[0];
    const erpSku = matchedErpSkus[0];
    const activeMappings = db.prepare("SELECT erpSkuId FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active'").all(platformSku.id);
    const exactMapping = activeMappings.some((item) => item.erpSkuId === erpSku.id);
    const conflictingMappings = activeMappings.filter((item) => item.erpSkuId !== erpSku.id);
    if (conflictingMappings.length) {
      evaluated.push(exception(row, "existing_erp_sku_conflict", "平台SKU已存在不同的V2 ERP SKU关系，本行已阻断。", { currentErpSkuIds: conflictingMappings.map((item) => item.erpSkuId), expectedErpSkuId: erpSku.id }));
      continue;
    }
    evaluated.push({ ...row, salesLinkId: salesLink.id, salesLinkSkuId: platformSku.id, erpSkuId: erpSku.id, action: exactMapping ? "already_linked" : "link", exceptionType: null, message: exactMapping ? "V2关系已存在。" : "可补充V2 ERP SKU关系。" });
  }
  return { shop, filtered, evaluated };
}

function summaryFor(batch, rows) {
  const count = (action) => rows.filter((row) => row.action === action).length;
  const exceptions = rows.filter((row) => row.action === "exception");
  const types = Object.fromEntries([...new Set(exceptions.map((row) => row.exceptionType))].map((type) => [type, exceptions.filter((row) => row.exceptionType === type).length]));
  return {
    fileName: batch.fileName, fileHash: batch.scope?.sourceFileHash || batch.fileHash, parserVersion: batch.scope?.parserVersion || PARSER_VERSION, periodStart: batch.periodStart, periodEnd: batch.periodEnd,
    sourceRows: rows.length, totalPlatformSkus: rows.filter((row) => row.platformSkuId).length,
    linkable: count("link"), alreadyLinked: count("already_linked"), exceptionCount: exceptions.length,
    bundleCount: types.bundle_sku || 0, exceptionTypes: types,
  };
}

export function previewPlatformGoodsExcelDataSync({ taskId, buffer, fileName, shopId, sourceShopName, createdBy = "" }) {
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== TASK_CODE) throw new Error("平台货品关系导入任务不存在。");
  if (!shopId) throw new Error("请选择系统店铺。");
  if (!text(sourceShopName)) throw new Error("请填写Excel店铺名称。");
  const sourceFileHash = crypto.createHash("sha256").update(buffer || Buffer.alloc(0)).digest("hex");
  const fileHash = crypto.createHash("sha256").update(buffer || Buffer.alloc(0)).update(`\0${PARSER_VERSION}`).digest("hex");
  const existing = getDatabase().prepare("SELECT id FROM data_sync_batches WHERE taskId=? AND fileHash=? ORDER BY createdAt DESC LIMIT 1").get(taskId, fileHash);
  if (existing) return { ...readPlatformGoodsExcelDataSyncPreview(existing.id), idempotent: true };

  const parsed = parseWorkbook(buffer);
  const analysis = analyzeRows(parsed.rows, { shopId, sourceShopName: text(sourceShopName) });
  const dates = analysis.filtered.map((row) => row.sourceModifiedAt).filter(Boolean).sort();
  const batch = createDataSyncBatch(taskId, { triggerMode: "manual", syncMode: "full", fileName, fileHash, periodStart: dates[0] || null, periodEnd: dates.at(-1) || null, scope: { shopId, sourceShopName: text(sourceShopName), sheetName: parsed.sheetName, parserVersion: PARSER_VERSION, sourceFileHash }, createdBy });
  const db = getDatabase();
  const insert = db.prepare(`INSERT INTO platform_goods_excel_import_rows (batchId,rowNumber,sourceShopName,platformGoodsId,platformSkuId,merchantSkuCode,systemGoodsType,salesLinkId,salesLinkSkuId,erpSkuId,action,exceptionType,message,rawDataJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const row of analysis.evaluated) insert.run(batch.id, row.rowNumber, row.sourceShopName, row.platformGoodsId || null, row.platformSkuId || null, row.merchantSkuCode || null, row.systemGoodsType || null, row.salesLinkId || null, row.salesLinkSkuId || null, row.erpSkuId || null, row.action, row.exceptionType || null, row.message || null, JSON.stringify(row.rawData || {}));
  }).immediate();
  const staged = db.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? ORDER BY rowNumber").all(batch.id);
  const summary = summaryFor({ ...batch, periodStart: dates[0] || null, periodEnd: dates.at(-1) || null }, staged);
  const exceptions = staged.filter((row) => row.action === "exception").map((row) => ({ exceptionType: row.exceptionType, severity: "error", message: row.message, entityType: "platform_sku", entityId: row.platformSkuId, rawData: JSON.parse(row.rawDataJson || "{}") }));
  markDataSyncBatchPreviewReady(batch.id, { sourceBatchType: SOURCE_BATCH_TYPE, sourceBatchId: batch.id, summary: { total: summary.totalPlatformSkus, updated: summary.linkable, exceptionCount: summary.exceptionCount }, exceptions, message: "平台货品Excel关系预览已生成。" });
  db.prepare("UPDATE data_sync_batches SET periodStart=?,periodEnd=?,scopeJson=? WHERE id=?").run(dates[0] || null, dates.at(-1) || null, JSON.stringify({ shopId, sourceShopName: text(sourceShopName), sheetName: parsed.sheetName, parserVersion: PARSER_VERSION, sourceFileHash }), batch.id);
  return readPlatformGoodsExcelDataSyncPreview(batch.id);
}

export function readPlatformGoodsExcelDataSyncPreview(batchId) {
  const db = getDatabase();
  const batch = getDataSyncBatch(batchId);
  if (!batch || batch.sourceBatchType !== SOURCE_BATCH_TYPE) throw new Error("平台货品Excel导入预览不存在。");
  const rows = db.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? ORDER BY rowNumber").all(batchId);
  const current = db.prepare("SELECT id FROM data_sync_batches WHERE taskId=? AND status='preview_ready' ORDER BY createdAt DESC,id DESC LIMIT 1").get(batch.taskId);
  return { dataSyncBatch: batch, summary: summaryFor(batch, rows), isCurrent: batch.status === "preview_ready" && current?.id === batch.id, preview: rows.slice(0, 200).map((row) => ({ ...row, rawData: JSON.parse(row.rawDataJson || "{}") })) };
}

export function commitPlatformGoodsExcelDataSync(batchId) {
  const batch = assertCurrentDataSyncPreview(batchId);
  if (batch.sourceBatchType !== SOURCE_BATCH_TYPE) throw new Error("当前批次不是平台货品Excel导入预览。");
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? AND action='link' ORDER BY rowNumber").all(batchId);
  let created = 0; let conflicts = 0;
  const committedAt = new Date().toISOString();
  db.transaction(() => {
    for (const row of rows) {
      const platformSku = db.prepare("SELECT id FROM sales_link_skus WHERE id=?").get(row.salesLinkSkuId);
      const erpSku = db.prepare("SELECT id FROM erp_skus WHERE id=?").get(row.erpSkuId);
      if (!platformSku || !erpSku) { conflicts += 1; continue; }
      const active = db.prepare("SELECT erpSkuId FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active'").all(row.salesLinkSkuId);
      if (active.some((item) => item.erpSkuId !== row.erpSkuId)) { conflicts += 1; continue; }
      if (active.some((item) => item.erpSkuId === row.erpSkuId)) continue;
      created += db.prepare(`INSERT OR IGNORE INTO sales_link_sku_erp_mappings
        (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,sourceBatchId,createdAt,updatedAt)
        VALUES (?,?,?,?,1,'active','platform_goods_excel',?,?,?)`).run(
        `sales-link-sku-erp-map-${crypto.randomUUID()}`, row.salesLinkSkuId, row.erpSkuId, "single", batchId, committedAt, committedAt,
      ).changes;
    }
  }).immediate();
  const previewExceptions = Number(batch.exceptionCount || 0);
  const status = previewExceptions || conflicts ? "partial" : "succeeded";
  const completed = completeDataSyncBatch(batchId, { status, totalCount: Number(batch.totalCount || 0), createdCount: created, updatedCount: 0, exceptionCount: previewExceptions + conflicts });
  return { dataSyncBatch: completed, created, updated: 0, conflicts, protected: { salesLinksCreated: 0, productsCreated: 0, legacySalesLinkSkuErpIdsUpdated: 0 } };
}
