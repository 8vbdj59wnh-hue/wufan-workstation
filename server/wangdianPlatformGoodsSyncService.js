import crypto from "node:crypto";
import { beginReleaseManagedJob, finishReleaseManagedJob } from "./releaseMaintenanceService.js";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, uploadsDir } from "./db.js";
import { queryWangdianPlatformGoods } from "./wangdianClient.js";
import { clearDataSyncCheckpoint, runWangdianPagedWindows } from "./dataSyncPagedExecution.js";
import { ensureSingleLinkSkuErpMapping, inspectSingleLinkSkuErpMapping } from "./linkSkuErpMappingService.js";

const stagingRoot = path.join(uploadsDir, "wangdian-platform-goods-sync");
const restrictedPlatforms = new Set(["淘宝", "天猫", "taobao", "tmall"]);
const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase("zh-CN");
const stableId = (prefix, source) => `${prefix}-${crypto.createHash("sha256").update(String(source)).digest("hex").slice(0, 24)}`;
const formatDateTime = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

function normalizeQuery(input = {}, importMode = "incremental") {
  const start = new Date(text(input.startTime ?? input.start_time).replace(" ", "T"));
  const end = new Date(text(input.endTime ?? input.end_time).replace(" ", "T"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error("旺店通平台货品同步时间范围无效。");
  if (importMode !== "full" && end.getTime() - start.getTime() > 30 * 86400000) throw new Error("旺店通平台货品增量同步跨度不能超过30天。");
  const lookback = Math.min(1440, Math.max(0, Number(input.safetyLookbackMinutes ?? 5) || 0));
  return { start_time: formatDateTime(new Date(start.getTime() - lookback * 60000)), end_time: formatDateTime(end) };
}

function splitWindows(query) {
  const end = new Date(query.end_time.replace(" ", "T"));
  const windows = [];
  let cursor = new Date(query.start_time.replace(" ", "T"));
  while (cursor <= end) {
    const windowEnd = new Date(Math.min(cursor.getTime() + 30 * 86400000, end.getTime()));
    windows.push({ start_time: formatDateTime(cursor), end_time: formatDateTime(windowEnd) });
    cursor = new Date(windowEnd.getTime() + 1000);
  }
  return windows;
}

export function readWangdianPlatformGoodsSync(logId) {
  const database = getDatabase();
  const row = database.prepare("SELECT * FROM wangdian_platform_goods_sync_logs WHERE id=?").get(logId);
  if (!row) return null;
  const exceptions = database.prepare("SELECT * FROM wangdian_platform_goods_sync_exceptions WHERE syncLogId=? ORDER BY rowNumber,id").all(logId).map((item) => ({ ...item, rawData: JSON.parse(item.rawDataJson || "{}") }));
  return {
    ...row,
    requestJson: JSON.parse(row.requestJson || "{}"),
    exceptions,
    canCommit: !exceptions.some((item) => item.exceptionType === "unknown_shop"),
  };
}

export function listWangdianShopMappings() {
  return getDatabase().prepare(`SELECT m.*,s.platform,s.shopName,s.displayName FROM wangdian_shop_mappings m JOIN sales_shops s ON s.id=m.shopId ORDER BY m.wangdianShopNo`).all();
}

export function saveWangdianShopMapping(input = {}, userId = "") {
  const database = getDatabase();
  const shopNo = text(input.wangdianShopNo);
  const shopId = text(input.shopId);
  if (!shopNo || !shopId) throw new Error("旺店通店铺编号和系统店铺均为必填。");
  const shop = database.prepare("SELECT * FROM sales_shops WHERE id=? AND status='active'").get(shopId);
  if (!shop) throw new Error("系统店铺不存在或已停用。");
  const now = new Date().toISOString();
  const current = database.prepare("SELECT * FROM wangdian_shop_mappings WHERE lower(wangdianShopNo)=lower(?)").get(shopNo);
  const row = { id: current?.id ?? stableId("wdt-shop-map", lower(shopNo)), wangdianShopNo: shopNo, wangdianShopId: text(input.wangdianShopId) || current?.wangdianShopId || null, shopId, status: input.status === "inactive" ? "inactive" : "active", createdBy: current?.createdBy ?? (text(userId) || null), createdAt: current?.createdAt ?? now, updatedAt: now };
  database.prepare(`INSERT INTO wangdian_shop_mappings (id,wangdianShopNo,wangdianShopId,shopId,status,createdBy,createdAt,updatedAt) VALUES (@id,@wangdianShopNo,@wangdianShopId,@shopId,@status,@createdBy,@createdAt,@updatedAt) ON CONFLICT(wangdianShopNo) DO UPDATE SET wangdianShopId=excluded.wangdianShopId,shopId=excluded.shopId,status=excluded.status,updatedAt=excluded.updatedAt`).run(row);
  return listWangdianShopMappings().find((item) => item.id === row.id);
}

export async function discoverWangdianPlatformShops({ startTime, endTime, shopId, queryApi = queryWangdianPlatformGoods, pageSize = 100, maxPages = 500 } = {}) {
  const database = getDatabase();
  const end = endTime ? new Date(String(endTime).replace(" ", "T")) : new Date();
  const start = startTime ? new Date(String(startTime).replace(" ", "T")) : new Date(end.getTime() - 30 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error("旺店通店铺识别时间范围无效。");
  const targetShopId = text(shopId);
  if (!targetShopId) throw new Error("请先选择需要识别的系统店铺。");
  const targetShop = database.prepare("SELECT id,platform,shopName,displayName FROM sales_shops WHERE id=? AND status='active'").get(targetShopId);
  if (!targetShop) throw new Error("系统店铺不存在或已停用。");
  const targetGoodsIds = new Set(database.prepare("SELECT platformGoodsId FROM sales_links WHERE shopId=? AND platformGoodsId IS NOT NULL AND platformGoodsId<>''").all(targetShopId).map((row) => text(row.platformGoodsId)));
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 100));
  const safeMaxPages = Math.min(1000, Math.max(1, Number(maxPages) || 500));
  const candidates = new Map();
  let totalCount = 0;
  let returnedRows = 0;
  let pageCount = 0;
  for (let pageNo = 0; pageNo < safeMaxPages; pageNo += 1) {
    const payload = await queryApi({ params: { start_time: formatDateTime(start), end_time: formatDateTime(end) }, pageNo, pageSize: safePageSize });
    const rows = Array.isArray(payload?.data?.goods_list) ? payload.data.goods_list : [];
    if (pageNo === 0) totalCount = Number(payload?.data?.total_count ?? payload?.total_count ?? rows.length) || rows.length;
    pageCount += 1;
    returnedRows += rows.length;
    for (const row of rows) {
      const shopNo = text(row.shop_no);
      if (!shopNo) continue;
      const current = candidates.get(lower(shopNo)) ?? { shopNo, returnedRows: 0, goodsIds: new Set(), matchedGoodsIds: new Set() };
      current.returnedRows += 1;
      const goodsId = text(row.goods_id);
      if (goodsId) {
        current.goodsIds.add(goodsId);
        if (targetGoodsIds.has(goodsId)) current.matchedGoodsIds.add(goodsId);
      }
      candidates.set(lower(shopNo), current);
    }
    if (!rows.length || rows.length < safePageSize || returnedRows >= totalCount) break;
  }
  const mappings = new Map(listWangdianShopMappings().map((item) => [lower(item.wangdianShopNo), item]));
  const rankedCandidates = [...candidates.values()].map((item) => {
    const returnedGoodsCount = item.goodsIds.size;
    const matchedGoodsCount = item.matchedGoodsIds.size;
    return {
      shopNo: item.shopNo,
      returnedRows: item.returnedRows,
      returnedGoodsCount,
      matchedGoodsCount,
      matchRate: returnedGoodsCount ? matchedGoodsCount / returnedGoodsCount : 0,
      samplePlatformGoodsIds: [...item.goodsIds].slice(0, 5),
      matchedPlatformGoodsIds: [...item.matchedGoodsIds].slice(0, 10),
      mapping: mappings.get(lower(item.shopNo)) ?? null,
    };
  }).sort((left, right) => right.matchedGoodsCount - left.matchedGoodsCount || right.matchRate - left.matchRate || right.returnedGoodsCount - left.returnedGoodsCount);
  return {
    readOnly: true,
    targetShop,
    targetLinkCount: targetGoodsIds.size,
    returnedRows,
    totalCount,
    pageCount,
    truncated: pageCount >= safeMaxPages && returnedRows < totalCount,
    candidates: rankedCandidates,
  };
}

const activeShopDiscoveryBatches = new Set();

function readShopDiscoveryBatchRow(batchId) {
  const database = getDatabase();
  const batch = database.prepare(`SELECT b.*,s.platform,s.shopName,s.displayName FROM wangdian_shop_discovery_batches b JOIN sales_shops s ON s.id=b.targetShopId WHERE b.id=?`).get(batchId);
  if (!batch) return null;
  const mappings = new Map(listWangdianShopMappings().map((item) => [lower(item.wangdianShopNo), item]));
  const candidates = database.prepare(`
    SELECT c.shopNo,c.returnedRows,COUNT(g.platformGoodsId) returnedGoodsCount,
      COALESCE(SUM(g.matched),0) matchedGoodsCount
    FROM wangdian_shop_discovery_candidates c
    LEFT JOIN wangdian_shop_discovery_goods g ON g.batchId=c.batchId AND lower(g.shopNo)=lower(c.shopNo)
    WHERE c.batchId=?
    GROUP BY c.batchId,c.shopNo,c.returnedRows
    ORDER BY matchedGoodsCount DESC,
      CASE WHEN COUNT(g.platformGoodsId)>0 THEN CAST(COALESCE(SUM(g.matched),0) AS REAL)/COUNT(g.platformGoodsId) ELSE 0 END DESC,
      returnedGoodsCount DESC
  `).all(batchId).map((item) => {
    const matchedPlatformGoodsIds = database.prepare(`SELECT platformGoodsId FROM wangdian_shop_discovery_goods WHERE batchId=? AND lower(shopNo)=lower(?) AND matched=1 ORDER BY platformGoodsId LIMIT 10`).all(batchId, item.shopNo).map((row) => row.platformGoodsId);
    const samplePlatformGoodsIds = database.prepare(`SELECT platformGoodsId FROM wangdian_shop_discovery_goods WHERE batchId=? AND lower(shopNo)=lower(?) ORDER BY platformGoodsId LIMIT 5`).all(batchId, item.shopNo).map((row) => row.platformGoodsId);
    return {
      ...item,
      returnedRows: Number(item.returnedRows || 0),
      returnedGoodsCount: Number(item.returnedGoodsCount || 0),
      matchedGoodsCount: Number(item.matchedGoodsCount || 0),
      matchRate: Number(item.returnedGoodsCount || 0) ? Number(item.matchedGoodsCount || 0) / Number(item.returnedGoodsCount || 0) : 0,
      matchedPlatformGoodsIds,
      samplePlatformGoodsIds,
      mapping: mappings.get(lower(item.shopNo)) ?? null,
    };
  });
  return { ...batch, currentPage: Number(batch.currentPage || 0), totalPages: batch.totalPages === null ? null : Number(batch.totalPages), totalRows: batch.totalRows === null ? null : Number(batch.totalRows), readRows: Number(batch.readRows || 0), candidates };
}

export function readWangdianShopDiscoveryBatch(batchId) {
  const batch = readShopDiscoveryBatchRow(batchId);
  if (!batch) throw new Error("店铺识别批次不存在。");
  return batch;
}

export function createWangdianShopDiscoveryBatch({ shopId, startTime, endTime, createdBy = "" } = {}) {
  const database = getDatabase();
  const end = endTime ? new Date(String(endTime).replace(" ", "T")) : new Date();
  const start = startTime ? new Date(String(startTime).replace(" ", "T")) : new Date(end.getTime() - 30 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new Error("旺店通店铺识别时间范围无效。");
  const targetShopId = text(shopId);
  if (!targetShopId) throw new Error("请先选择需要识别的系统店铺。");
  const targetShop = database.prepare("SELECT id FROM sales_shops WHERE id=? AND status='active'").get(targetShopId);
  if (!targetShop) throw new Error("系统店铺不存在或已停用。");
  const now = new Date().toISOString();
  const batch = { id: `wdt-shop-discovery-${crypto.randomUUID()}`, targetShopId, requestStart: formatDateTime(start), requestEnd: formatDateTime(end), status: "waiting", createdBy: text(createdBy) || null, createdAt: now, updatedAt: now };
  database.prepare(`INSERT INTO wangdian_shop_discovery_batches (id,targetShopId,requestStart,requestEnd,status,createdBy,createdAt,updatedAt) VALUES (@id,@targetShopId,@requestStart,@requestEnd,@status,@createdBy,@createdAt,@updatedAt)`).run(batch);
  return readShopDiscoveryBatchRow(batch.id);
}

export async function runWangdianShopDiscoveryBatch(batchId, { queryApi = queryWangdianPlatformGoods, pageSize = 100 } = {}) {
  if (activeShopDiscoveryBatches.has(batchId)) return readShopDiscoveryBatchRow(batchId);
  activeShopDiscoveryBatches.add(batchId);
  const database = getDatabase();
  try {
    const claimedAt = new Date().toISOString();
    const claimed = database.prepare(`UPDATE wangdian_shop_discovery_batches SET status='running',startedAt=COALESCE(startedAt,?),errorMessage=NULL,updatedAt=? WHERE id=? AND status='waiting'`).run(claimedAt, claimedAt, batchId);
    if (!claimed.changes) return readWangdianShopDiscoveryBatch(batchId);
    const batch = database.prepare("SELECT * FROM wangdian_shop_discovery_batches WHERE id=?").get(batchId);
    const targetGoodsIds = new Set(database.prepare("SELECT platformGoodsId FROM sales_links WHERE shopId=? AND platformGoodsId IS NOT NULL AND platformGoodsId<>''").all(batch.targetShopId).map((row) => text(row.platformGoodsId)));
    let pageNo = Number(batch.currentPage || 0);
    let readRows = Number(batch.readRows || 0);
    let totalRows = batch.totalRows === null ? null : Number(batch.totalRows);
    let totalPages = batch.totalPages === null ? null : Number(batch.totalPages);
    const persistPage = database.transaction((rows, nextPage) => {
      const upsertCandidate = database.prepare(`INSERT INTO wangdian_shop_discovery_candidates (batchId,shopNo,returnedRows) VALUES (?,?,1) ON CONFLICT(batchId,shopNo) DO UPDATE SET returnedRows=returnedRows+1`);
      const insertGoods = database.prepare(`INSERT OR IGNORE INTO wangdian_shop_discovery_goods (batchId,shopNo,platformGoodsId,matched) VALUES (?,?,?,?)`);
      for (const row of rows) {
        const shopNo = text(row.shop_no);
        if (!shopNo) continue;
        upsertCandidate.run(batchId, shopNo);
        const goodsId = text(row.goods_id);
        if (goodsId) insertGoods.run(batchId, shopNo, goodsId, targetGoodsIds.has(goodsId) ? 1 : 0);
      }
      readRows += rows.length;
      database.prepare(`UPDATE wangdian_shop_discovery_batches SET currentPage=?,totalPages=?,totalRows=?,readRows=?,updatedAt=? WHERE id=?`).run(nextPage, totalPages, totalRows, readRows, new Date().toISOString(), batchId);
    });
    for (; pageNo < 10000; pageNo += 1) {
      const payload = await queryApi({ params: { start_time: batch.requestStart, end_time: batch.requestEnd }, pageNo, pageSize });
      const rows = Array.isArray(payload?.data?.goods_list) ? payload.data.goods_list : [];
      if (pageNo === 0 && totalRows === null) {
        totalRows = Number(payload?.data?.total_count ?? payload?.total_count ?? rows.length) || rows.length;
        totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
      }
      persistPage(rows, pageNo + 1);
      if (!rows.length || rows.length < pageSize || (totalRows !== null && readRows >= totalRows)) break;
    }
    if (pageNo >= 10000) throw new Error("旺店通店铺识别分页数量异常，已停止读取。");
    const completedAt = new Date().toISOString();
    database.prepare(`UPDATE wangdian_shop_discovery_batches SET status='completed',completedAt=?,updatedAt=? WHERE id=?`).run(completedAt, completedAt, batchId);
  } catch (error) {
    const failedAt = new Date().toISOString();
    database.prepare(`UPDATE wangdian_shop_discovery_batches SET status='failed',errorMessage=?,updatedAt=? WHERE id=?`).run(error.message || "店铺识别失败。", failedAt, batchId);
  } finally {
    activeShopDiscoveryBatches.delete(batchId);
  }
  return readShopDiscoveryBatchRow(batchId);
}

export function queueWangdianShopDiscoveryBatch(batchId, options = {}) {
  setImmediate(async () => {
    const maintenanceToken = beginReleaseManagedJob("wangdian_shop_discovery");
    if (!maintenanceToken) return;
    try {
      await runWangdianShopDiscoveryBatch(batchId, options);
    } catch (error) {
      console.error("旺店通店铺识别后台批次失败", error);
    } finally {
      finishReleaseManagedJob(maintenanceToken);
    }
  });
}

export function resumeWangdianShopDiscoveryBatch(batchId, options = {}) {
  const database = getDatabase();
  const updated = database.prepare(`UPDATE wangdian_shop_discovery_batches SET status='waiting',errorMessage=NULL,updatedAt=? WHERE id=? AND status='failed'`).run(new Date().toISOString(), batchId);
  const batch = readWangdianShopDiscoveryBatch(batchId);
  if (updated.changes || batch.status === "waiting") queueWangdianShopDiscoveryBatch(batchId, options);
  return batch;
}

export function resumePendingWangdianShopDiscoveryBatches() {
  const database = getDatabase();
  database.prepare(`UPDATE wangdian_shop_discovery_batches SET status='waiting',updatedAt=? WHERE status='running'`).run(new Date().toISOString());
  const rows = database.prepare(`SELECT id FROM wangdian_shop_discovery_batches WHERE status='waiting' ORDER BY createdAt`).all();
  for (const row of rows) queueWangdianShopDiscoveryBatch(row.id);
  return rows.length;
}

function makeException(logId, rowNumber, type, source, message) {
  return { id: `wdt-platform-exception-${crypto.randomUUID()}`, syncLogId: logId, rowNumber, exceptionType: type, shopNo: text(source.shop_no), platformGoodsId: text(source.goods_id), platformSkuId: text(source.spec_id), merchantNo: text(source.merchant_no), message, rawDataJson: JSON.stringify(source), createdAt: new Date().toISOString() };
}

function analyzeRows(logId, rows, scope = {}) {
  const database = getDatabase();
  const mappings = new Map(listWangdianShopMappings().filter((item) => item.status === "active").map((item) => [lower(item.wangdianShopNo), item]));
  const seen = new Set();
  const valid = [];
  const exceptions = [];
  let unknownShop = false;
  const shopScope = new Set(Array.isArray(scope.shops) ? scope.shops.map(text) : []);
  const platformScope = new Set(Array.isArray(scope.platforms) ? scope.platforms.map(lower) : []);
  rows.forEach((source, index) => {
    const shopNo = text(source.shop_no);
    const goodsId = text(source.goods_id);
    const specId = text(source.spec_id);
    const merchantNo = text(source.merchant_no);
    const mapping = mappings.get(lower(shopNo));
    const reject = (type, message) => exceptions.push(makeException(logId, index + 1, type, source, message));
    if (!mapping) { unknownShop = true; reject("unknown_shop", "旺店通店铺尚未映射到系统店铺。"); return; }
    if ((shopScope.size && !shopScope.has(mapping.shopId)) || (platformScope.size && !platformScope.has(lower(mapping.platform)))) return;
    if (restrictedPlatforms.has(mapping.platform)) { reject("platform_restricted", "淘系平台货品接口返回范围受限，本行不作为链接关系来源。"); return; }
    if (!goodsId || !specId) { reject("invalid_data", "平台商品ID或平台SKU ID缺失。"); return; }
    if (Number(source.match_target_type) === 2) { reject("missing_product_structure", "旺店通返回组合商品，已进入商品结构治理；不创建独立组合审核组，也不自动生成单品关系。"); return; }
    const identity = `${mapping.shopId}|${goodsId}|${specId}`;
    if (seen.has(identity)) { reject("duplicate_platform_sku", "同一店铺、商品和平台SKU在响应中重复。"); return; }
    seen.add(identity);
    const link = database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(mapping.shopId, goodsId);
    if (!link) { reject("missing_platform_goods", "平台商品尚不存在于链接资产，未创建新链接。"); return; }
    if (!merchantNo) { reject("missing_merchant_no", "merchant_no为空，无法精确关联ERP SKU。"); return; }
    const erpSkus = database.prepare("SELECT * FROM erp_skus WHERE lower(merchantSkuCode)=lower(?)").all(merchantNo);
    if (erpSkus.length === 0) { reject("missing_erp_sku", "merchant_no未匹配到ERP SKU。"); return; }
    if (erpSkus.length > 1) { reject("ambiguous_erp_sku", "merchant_no匹配到多个ERP SKU，禁止自动关联。"); return; }
    const erpSku = erpSkus[0];
    const productMapping = database.prepare("SELECT * FROM product_erp_mappings WHERE lower(merchantSkuCode)=lower(?) AND currentState='active'").get(merchantNo) ?? null;
    const existingSku = database.prepare("SELECT id FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").get(link.id, specId);
    if (existingSku) {
      const relation = inspectSingleLinkSkuErpMapping(database, existingSku.id, erpSku.id);
      if (!["missing", "active_exact"].includes(relation.status)) {
        reject("existing_erp_sku_conflict", relation.reason);
        return;
      }
    }
    valid.push({ source, mapping, link, erpSku, productMapping, plannedAction: existingSku ? "update" : "create" });
  });
  return { valid, exceptions, canCommit: !unknownShop };
}

export async function previewWangdianPlatformGoodsSync({ dataSyncBatchId, importMode = "incremental", startTime, endTime, safetyLookbackMinutes = 5, scope = {}, createdBy = "", queryApi = queryWangdianPlatformGoods } = {}) {
  const database = getDatabase();
  const batch = database.prepare(`SELECT b.*,t.taskCode FROM data_sync_batches b JOIN data_sync_tasks t ON t.id=b.taskId WHERE b.id=?`).get(dataSyncBatchId);
  if (!batch || batch.taskCode !== "wangdian_platform_goods" || batch.status !== "running") throw new Error("当前统一同步批次不可用于平台SKU关系预览。");
  const mode = importMode === "full" ? "full" : "incremental";
  const query = normalizeQuery({ startTime, endTime, safetyLookbackMinutes }, mode);
  const windows = splitWindows(query);
  const id = `wdt-platform-sync-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  database.prepare(`INSERT INTO wangdian_platform_goods_sync_logs (id,dataSyncBatchId,importMode,requestStart,requestEnd,requestJson,status,windowCount,createdBy,startedAt) VALUES (?,?,?,?,?,?,'running',?,?,?)`).run(id, dataSyncBatchId, mode, query.start_time, query.end_time, JSON.stringify({ query, windows, scope }), windows.length, text(createdBy) || null, startedAt);
  let rows = [];
  let pages = 0;
  try {
    const paged = await runWangdianPagedWindows({ batchId: dataSyncBatchId, windows, pageSize: 100, queryPage: queryApi, extractItems: (payload) => Array.isArray(payload?.data?.goods_list) ? payload.data.goods_list : [] });
    rows = paged.rows;
    pages = paged.pageCount;
    const analysis = analyzeRows(id, rows, scope);
    const insert = database.prepare(`INSERT INTO wangdian_platform_goods_sync_exceptions (id,syncLogId,rowNumber,exceptionType,shopNo,platformGoodsId,platformSkuId,merchantNo,message,rawDataJson,createdAt) VALUES (@id,@syncLogId,@rowNumber,@exceptionType,@shopNo,@platformGoodsId,@platformSkuId,@merchantNo,@message,@rawDataJson,@createdAt)`);
    database.transaction(() => analysis.exceptions.forEach((item) => insert.run(item)))();
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.writeFileSync(path.join(stagingRoot, `${id}.json`), JSON.stringify(analysis.valid.map(({ source, mapping, link, erpSku, productMapping }) => ({ source, shopId: mapping.shopId, salesLinkId: link.id, erpSkuId: erpSku.id, hasProductMapping: Boolean(productMapping?.productId) }))));
    const projectedCreated = analysis.valid.filter((item) => item.plannedAction === "create").length;
    const projectedUpdated = analysis.valid.length - projectedCreated;
    database.prepare(`UPDATE wangdian_platform_goods_sync_logs SET status='previewed',pageCount=?,sourceRowCount=?,matchedCount=?,exceptionCount=?,createdCount=?,updatedCount=?,completedAt=? WHERE id=?`).run(pages, rows.length, analysis.valid.length, analysis.exceptions.length, projectedCreated, projectedUpdated, new Date().toISOString(), id);
    clearDataSyncCheckpoint(dataSyncBatchId);
    return { ...readWangdianPlatformGoodsSync(id), canCommit: analysis.canCommit };
  } catch (error) {
    database.prepare(`UPDATE wangdian_platform_goods_sync_logs SET status='failed',pageCount=?,sourceRowCount=?,exceptionCount=exceptionCount+1,errorMessage=?,completedAt=? WHERE id=?`).run(pages, rows.length, error.message || "旺店通平台货品接口错误", new Date().toISOString(), id);
    throw error;
  }
}

export function commitWangdianPlatformGoodsSync(logId) {
  const database = getDatabase();
  const log = readWangdianPlatformGoodsSync(logId);
  if (!log) throw new Error("旺店通平台关系同步预览不存在。");
  if (log.status === "completed") return { ...log, idempotent: true };
  if (log.status !== "previewed") throw new Error("请先完成平台关系同步预览。");
  if (log.exceptions.some((item) => item.exceptionType === "unknown_shop")) throw new Error("存在未确认店铺映射，禁止提交同步。");
  const stagingPath = path.join(stagingRoot, `${logId}.json`);
  if (!fs.existsSync(stagingPath)) throw new Error("平台关系同步暂存文件不存在，请重新预览。");
  const rows = JSON.parse(fs.readFileSync(stagingPath, "utf8"));
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let mappingCreated = 0;
  let governancePending = 0;
  database.transaction(() => {
    for (const row of rows) {
      const source = row.source;
      const current = database.prepare("SELECT * FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").get(row.salesLinkId, text(source.spec_id));
      const id = current?.id ?? stableId("sales-link-sku", `${row.salesLinkId}|${text(source.spec_id)}`);
      const skuRow = {
        id,
        salesLinkId: row.salesLinkId,
        platformSkuId: text(source.spec_id),
        platformSkuCode: text(source.spec_outer_id),
        normalizedPlatformSkuCode: lower(source.spec_outer_id),
        specificationName: text(source.spec_name),
        normalizedSpecificationName: lower(source.spec_name),
        price: Number(source.price) || null,
        platformStock: Number(source.stock_num) || null,
        occupiedStock: Number(source.hold_stock) || null,
        systemGoodsType: "single",
        matchStatus: row.hasProductMapping ? "matched_auto" : "erp_linked",
        matchMethod: "wangdian_merchant_no",
        matchReason: row.hasProductMapping ? "旺店通merchant_no精确建立V2 ERP SKU关系，ERP SKU已有产品映射" : "旺店通merchant_no精确建立V2 ERP SKU关系，产品映射待建立",
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      database.prepare(`INSERT INTO sales_link_skus
        (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,price,platformStock,occupiedStock,systemGoodsType,syncEnabled,lastSyncedStock,lastSyncedAt,stopSyncReason,matchStatus,matchMethod,matchReason,currentState,missingAt,createdAt,updatedAt)
        VALUES (@id,@salesLinkId,@platformSkuId,@platformSkuCode,@normalizedPlatformSkuCode,@specificationName,@normalizedSpecificationName,@price,@platformStock,@occupiedStock,@systemGoodsType,0,NULL,NULL,NULL,@matchStatus,@matchMethod,@matchReason,'active',NULL,@createdAt,@updatedAt)
        ON CONFLICT(id) DO UPDATE SET platformSkuCode=excluded.platformSkuCode,normalizedPlatformSkuCode=excluded.normalizedPlatformSkuCode,
          specificationName=excluded.specificationName,normalizedSpecificationName=excluded.normalizedSpecificationName,price=excluded.price,
          platformStock=excluded.platformStock,occupiedStock=excluded.occupiedStock,systemGoodsType=excluded.systemGoodsType,
          matchStatus=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchStatus ELSE excluded.matchStatus END,
          matchMethod=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchMethod ELSE excluded.matchMethod END,
          matchReason=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchReason ELSE excluded.matchReason END,
          currentState='active',missingAt=NULL,updatedAt=excluded.updatedAt`).run(skuRow);
      const relation = ensureSingleLinkSkuErpMapping(database, { salesLinkSkuId: id, erpSkuId: row.erpSkuId, sourceType: "wangdian_platform_goods", sourceBatchId: logId, timestamp: now });
      if (relation.outcome === "governance_pending") {
        governancePending += 1;
        database.prepare("UPDATE sales_link_skus SET matchStatus='pending_relation',matchMethod='product_structure_application',matchReason=?,updatedAt=? WHERE id=?")
          .run(relation.reason, now, id);
      }
      if (relation.outcome === "created") mappingCreated += 1;
      if (current) updated += 1; else created += 1;
    }
    database.prepare(`UPDATE wangdian_platform_goods_sync_logs SET status='completed',createdCount=?,updatedCount=?,completedAt=? WHERE id=?`).run(created, updated, now, logId);
  })();
  return { ...readWangdianPlatformGoodsSync(logId), mappingCreated, governancePending, idempotent: false };
}
