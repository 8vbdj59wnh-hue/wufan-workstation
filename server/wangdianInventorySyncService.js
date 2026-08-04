import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, uploadsDir } from "./db.js";
import { queryWangdianInventory } from "./wangdianClient.js";
import { clearDataSyncCheckpoint, runWangdianPagedWindows } from "./dataSyncPagedExecution.js";

const stagingRoot = path.join(uploadsDir, "wangdian-inventory-sync");
const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase("en-US");
const stableId = (prefix, source) => `${prefix}-${crypto.createHash("sha256").update(String(source)).digest("hex").slice(0, 24)}`;
const formatDateTime = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const localDate = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function finiteNumber(value, field) {
  if (value === null || value === undefined || value === "") return field === "cost_price" ? null : 0;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${field}不是有效数字。`);
  return result;
}

function normalizeRequest(input = {}) {
  const importMode = input.importMode === "full" ? "full" : "incremental";
  const businessDate = text(input.businessDate) || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) throw new Error("库存业务日期格式必须为YYYY-MM-DD。");
  const start = new Date(text(input.startTime ?? input.start_time).replace(" ", "T"));
  const end = new Date(text(input.endTime ?? input.end_time).replace(" ", "T"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error("旺店通库存同步时间范围无效。");
  const lookback = importMode === "incremental" ? Math.min(1440, Math.max(0, Number(input.safetyLookbackMinutes ?? 10) || 0)) : 0;
  const query = {
    start_time: formatDateTime(new Date(start.getTime() - lookback * 60000)),
    end_time: formatDateTime(end),
    mask: 3,
  };
  const specNos = Array.isArray(input.specNos) ? input.specNos.map(text).filter(Boolean) : text(input.spec_nos ?? input.specNos).split(",").map(text).filter(Boolean);
  if (specNos.length > 0) query.spec_nos = [...new Set(specNos)].join(",");
  return { importMode, businessDate, query, safetyLookbackMinutes: lookback };
}

function splitWindows(query) {
  const end = new Date(query.end_time.replace(" ", "T"));
  const windows = [];
  let cursor = new Date(query.start_time.replace(" ", "T"));
  while (cursor <= end) {
    const windowEnd = new Date(Math.min(cursor.getTime() + 30 * 86400000, end.getTime()));
    windows.push({ ...query, start_time: formatDateTime(cursor), end_time: formatDateTime(windowEnd) });
    cursor = new Date(windowEnd.getTime() + 1000);
  }
  return windows;
}

function readBatch(id) {
  const database = getDatabase();
  const row = database.prepare("SELECT * FROM wangdian_inventory_sync_batches WHERE id=?").get(id);
  if (!row) return null;
  return {
    ...row,
    requestJson: JSON.parse(row.requestJson || "{}"),
    exceptions: database.prepare("SELECT * FROM wangdian_inventory_sync_exceptions WHERE syncBatchId=? ORDER BY rowNumber,id").all(id).map((item) => ({ ...item, rawData: JSON.parse(item.rawDataJson || "{}") })),
  };
}

function buildException(batchId, rowNumber, type, source, message) {
  return {
    id: `wdt-inventory-exception-${crypto.randomUUID()}`,
    syncBatchId: batchId,
    rowNumber,
    exceptionType: type,
    specNo: text(source?.spec_no) || null,
    warehouseId: text(source?.warehouse_id) || null,
    warehouseNo: text(source?.warehouse_no) || null,
    message,
    rawDataJson: JSON.stringify(source ?? {}),
    createdAt: new Date().toISOString(),
  };
}

function analyzeRows(batchId, businessDate, sourceRows, scope = {}) {
  const database = getDatabase();
  const skuMap = new Map(database.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active'").all().map((row) => [lower(row.merchantSkuCode), row]));
  const canonical = new Map();
  const exceptions = [];
  const warehouseScope = new Set(Array.isArray(scope.warehouseIds) ? scope.warehouseIds.map(text).filter(Boolean) : []);
  sourceRows.forEach((source, index) => {
    const specNo = text(source?.spec_no);
    const warehouseId = text(source?.warehouse_id);
    const push = (type, message) => exceptions.push(buildException(batchId, index + 1, type, source, message));
    if (!specNo) { push("missing_sku_code", "spec_no缺失，无法匹配ERP SKU。"); return; }
    const erpSku = skuMap.get(lower(specNo));
    if (!erpSku) { push("missing_erp_sku", "spec_no未匹配到有效ERP SKU。"); return; }
    if (!warehouseId || !text(source?.warehouse_no) || !text(source?.warehouse_name)) { push("missing_warehouse", "仓库ID、编号或名称缺失。"); return; }
    if (warehouseScope.size && !warehouseScope.has(warehouseId)) return;
    if (source?.stock_num === null || source?.stock_num === undefined || source?.stock_num === "" || source?.available_send_stock === null || source?.available_send_stock === undefined || source?.available_send_stock === "") {
      push("invalid_field", "stock_num或available_send_stock缺失。");
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(source, "cost_price")) push("cost_permission", "接口未返回cost_price，请检查成本字段权限。");
    let normalized;
    try {
      normalized = {
        businessDate,
        erpSkuId: erpSku.id,
        specNo,
        warehouseId,
        warehouseNo: text(source.warehouse_no),
        warehouseName: text(source.warehouse_name),
        warehouseType: source.warehouse_type === null || source.warehouse_type === undefined || source.warehouse_type === "" ? null : finiteNumber(source.warehouse_type, "warehouse_type"),
        stockNum: finiteNumber(source.stock_num, "stock_num"),
        availableSendStock: finiteNumber(source.available_send_stock, "available_send_stock"),
        costPrice: finiteNumber(source.cost_price, "cost_price"),
        sales7d: finiteNumber(source.num_7days, "num_7days"),
        salesMonth: finiteNumber(source.num_month, "num_month"),
        sales90d: finiteNumber(source.num_90days, "num_90days"),
        sourceModifiedAt: text(source.modified) || null,
        sourceRecordId: text(source.rec_id) || null,
        rawSourceData: JSON.stringify(source),
      };
    } catch (error) {
      push("invalid_field", error.message);
      return;
    }
    const identity = `${erpSku.id}|${warehouseId}`;
    const current = canonical.get(identity);
    if (!current || text(normalized.sourceModifiedAt) >= text(current.sourceModifiedAt)) canonical.set(identity, normalized);
  });
  return { valid: [...canonical.values()], exceptions };
}

export async function previewWangdianInventorySync(input = {}, userId = "", queryApi = queryWangdianInventory) {
  const request = normalizeRequest(input);
  const windows = splitWindows(request.query);
  const id = `wdt-inventory-sync-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const database = getDatabase();
  const dataSyncBatch = input.dataSyncBatchId ? database.prepare(`SELECT b.*,t.taskCode FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId WHERE b.id=?`).get(input.dataSyncBatchId) : null;
  if (!dataSyncBatch || dataSyncBatch.taskCode !== "wangdian_inventory" || dataSyncBatch.status !== "running") throw new Error("当前统一同步批次不可用于旺店通库存预览。");
  const scope = { specNos: Array.isArray(input.specNos) ? input.specNos.map(text).filter(Boolean) : [], warehouseIds: Array.isArray(input.warehouseIds) ? input.warehouseIds.map(text).filter(Boolean) : [] };
  database.prepare(`INSERT INTO wangdian_inventory_sync_batches (id,dataSyncBatchId,importMode,businessDate,requestStart,requestEnd,requestJson,status,windowCount,createdBy,startedAt) VALUES (?,?,?,?,?,?,?,'running',?,?,?)`).run(
    id, dataSyncBatch.id, request.importMode, request.businessDate, request.query.start_time, request.query.end_time, JSON.stringify({ query: request.query, windows, safetyLookbackMinutes: request.safetyLookbackMinutes, scope }), windows.length, text(userId) || null, startedAt,
  );
  let sourceRows = [];
  let pageCount = 0;
  try {
    const paged = await runWangdianPagedWindows({ batchId: dataSyncBatch.id, windows, pageSize: 500, queryPage: queryApi, extractItems: (payload) => Array.isArray(payload?.data?.detail_list) ? payload.data.detail_list : [] });
    sourceRows = paged.rows;
    pageCount = paged.pageCount;
    const analysis = analyzeRows(id, request.businessDate, sourceRows, scope);
    const insertException = database.prepare(`INSERT INTO wangdian_inventory_sync_exceptions (id,syncBatchId,rowNumber,exceptionType,specNo,warehouseId,warehouseNo,message,rawDataJson,createdAt) VALUES (@id,@syncBatchId,@rowNumber,@exceptionType,@specNo,@warehouseId,@warehouseNo,@message,@rawDataJson,@createdAt)`);
    database.transaction(() => analysis.exceptions.forEach((item) => insertException.run(item)))();
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.writeFileSync(path.join(stagingRoot, `${id}.json`), JSON.stringify(analysis.valid));
    const existingKeys = new Set(database.prepare("SELECT erpSkuId,warehouseId FROM erp_sku_warehouse_inventory_facts WHERE businessDate=?").all(request.businessDate).map((item) => `${item.erpSkuId}|${item.warehouseId}`));
    const projectedCreated = analysis.valid.filter((item) => !existingKeys.has(`${item.erpSkuId}|${item.warehouseId}`)).length;
    const projectedUpdated = analysis.valid.length - projectedCreated;
    database.prepare(`UPDATE wangdian_inventory_sync_batches SET status='previewed',pageCount=?,sourceRowCount=?,matchedCount=?,exceptionCount=?,createdCount=?,updatedCount=?,completedAt=? WHERE id=?`).run(pageCount, sourceRows.length, analysis.valid.length, analysis.exceptions.length, projectedCreated, projectedUpdated, new Date().toISOString(), id);
    clearDataSyncCheckpoint(dataSyncBatch.id);
    return readBatch(id);
  } catch (error) {
    database.prepare(`UPDATE wangdian_inventory_sync_batches SET status='failed',pageCount=?,sourceRowCount=?,exceptionCount=exceptionCount+1,errorMessage=?,completedAt=? WHERE id=?`).run(pageCount, sourceRows.length, error.message || "旺店通库存接口错误", new Date().toISOString(), id);
    throw error;
  }
}

function comparable(row) {
  return JSON.stringify([
    row.warehouseNo, row.warehouseName, row.warehouseType, row.stockNum, row.availableSendStock,
    row.costPrice, row.sales7d, row.salesMonth, row.sales90d, row.sourceModifiedAt, row.sourceRecordId, row.rawSourceData,
  ]);
}

export function commitWangdianInventorySync(batchId) {
  const database = getDatabase();
  const batch = readBatch(batchId);
  if (!batch) throw new Error("旺店通库存同步批次不存在。");
  if (batch.status === "completed") return { ...batch, idempotent: true };
  if (batch.status !== "previewed") throw new Error("请先完成旺店通库存同步预览。");
  const stagingPath = path.join(stagingRoot, `${batchId}.json`);
  if (!fs.existsSync(stagingPath)) throw new Error("库存同步暂存文件不存在，请重新预览。");
  const rows = JSON.parse(fs.readFileSync(stagingPath, "utf8"));
  const existing = new Map(database.prepare("SELECT * FROM erp_sku_warehouse_inventory_facts WHERE businessDate=?").all(batch.businessDate).map((row) => [`${row.erpSkuId}|${row.warehouseId}`, row]));
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const upsert = database.prepare(`
    INSERT INTO erp_sku_warehouse_inventory_facts (
      id,businessDate,erpSkuId,warehouseId,warehouseNo,warehouseName,warehouseType,stockNum,availableSendStock,costPrice,
      sales7d,salesMonth,sales90d,sourceModifiedAt,sourceRecordId,rawSourceData,syncBatchId,createdAt,updatedAt
    ) VALUES (
      @id,@businessDate,@erpSkuId,@warehouseId,@warehouseNo,@warehouseName,@warehouseType,@stockNum,@availableSendStock,@costPrice,
      @sales7d,@salesMonth,@sales90d,@sourceModifiedAt,@sourceRecordId,@rawSourceData,@syncBatchId,@createdAt,@updatedAt
    ) ON CONFLICT(businessDate,erpSkuId,warehouseId) DO UPDATE SET
      warehouseNo=excluded.warehouseNo,warehouseName=excluded.warehouseName,warehouseType=excluded.warehouseType,
      stockNum=excluded.stockNum,availableSendStock=excluded.availableSendStock,costPrice=excluded.costPrice,
      sales7d=excluded.sales7d,salesMonth=excluded.salesMonth,sales90d=excluded.sales90d,sourceModifiedAt=excluded.sourceModifiedAt,
      sourceRecordId=excluded.sourceRecordId,rawSourceData=excluded.rawSourceData,syncBatchId=excluded.syncBatchId,updatedAt=excluded.updatedAt
  `);
  database.transaction(() => {
    for (const row of rows) {
      const key = `${row.erpSkuId}|${row.warehouseId}`;
      const current = existing.get(key);
      const record = { ...row, id: current?.id ?? stableId("erp-inventory-fact", `${row.businessDate}|${key}`), syncBatchId: batchId, createdAt: current?.createdAt ?? now, updatedAt: now };
      if (!current) created += 1;
      else if (comparable(current) === comparable(row)) unchanged += 1;
      else updated += 1;
      upsert.run(record);
    }
    database.prepare(`
      INSERT INTO erp_sku_inventory_daily_summaries (
        id,businessDate,erpSkuId,warehouseCount,stockNum,availableSendStock,costPrice,inventoryCostAmount,
        sales7d,salesMonth,sales90d,syncBatchId,createdAt,updatedAt
      )
      SELECT
        'erp-inventory-summary-' || businessDate || '-' || erpSkuId,
        businessDate,erpSkuId,COUNT(*),SUM(stockNum),SUM(availableSendStock),
        CASE WHEN SUM(CASE WHEN stockNum>0 AND costPrice IS NOT NULL THEN stockNum ELSE 0 END)>0
          THEN SUM(CASE WHEN stockNum>0 AND costPrice IS NOT NULL THEN stockNum*costPrice ELSE 0 END)/SUM(CASE WHEN stockNum>0 AND costPrice IS NOT NULL THEN stockNum ELSE 0 END)
          ELSE AVG(costPrice) END,
        SUM(CASE WHEN costPrice IS NOT NULL THEN stockNum*costPrice ELSE 0 END),
        SUM(sales7d),SUM(salesMonth),SUM(sales90d),?,MIN(createdAt),?
      FROM erp_sku_warehouse_inventory_facts
      WHERE businessDate=?
      GROUP BY businessDate,erpSkuId
      ON CONFLICT(businessDate,erpSkuId) DO UPDATE SET
        warehouseCount=excluded.warehouseCount,stockNum=excluded.stockNum,availableSendStock=excluded.availableSendStock,
        costPrice=excluded.costPrice,inventoryCostAmount=excluded.inventoryCostAmount,sales7d=excluded.sales7d,
        salesMonth=excluded.salesMonth,sales90d=excluded.sales90d,syncBatchId=excluded.syncBatchId,updatedAt=excluded.updatedAt
    `).run(batchId, now, batch.businessDate);
    database.prepare(`UPDATE wangdian_inventory_sync_batches SET status='completed',createdCount=?,updatedCount=?,unchangedCount=?,completedAt=? WHERE id=?`).run(created, updated, unchanged, now, batchId);
  })();
  return { ...readBatch(batchId), idempotent: false };
}

export function listWangdianInventorySyncBatches(limit = 30) {
  return getDatabase().prepare("SELECT id FROM wangdian_inventory_sync_batches ORDER BY startedAt DESC LIMIT ?").all(Math.min(100, Math.max(1, Number(limit) || 30))).map((row) => readBatch(row.id));
}

export function readWangdianInventorySyncBatch(id) {
  return readBatch(id);
}
