import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, uploadsDir } from "./db.js";
import { queryWangdianPlatformGoods } from "./wangdianClient.js";

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
  const rows = [];
  let pages = 0;
  try {
    for (const window of windows) {
      let pageNo = 0;
      let received = 0;
      let total = null;
      while (pageNo < 10000) {
        const payload = await queryApi({ params: window, pageNo, pageSize: 100 });
        pages += 1;
        const list = Array.isArray(payload?.data?.goods_list) ? payload.data.goods_list : [];
        if (pageNo === 0 && Number.isFinite(Number(payload?.data?.total_count))) total = Number(payload.data.total_count);
        rows.push(...list);
        received += list.length;
        if (list.length < 100 || (total !== null && received >= total)) break;
        pageNo += 1;
      }
      if (pageNo >= 10000) throw new Error("旺店通平台货品分页异常，已停止读取。");
    }
    const analysis = analyzeRows(id, rows, scope);
    const insert = database.prepare(`INSERT INTO wangdian_platform_goods_sync_exceptions (id,syncLogId,rowNumber,exceptionType,shopNo,platformGoodsId,platformSkuId,merchantNo,message,rawDataJson,createdAt) VALUES (@id,@syncLogId,@rowNumber,@exceptionType,@shopNo,@platformGoodsId,@platformSkuId,@merchantNo,@message,@rawDataJson,@createdAt)`);
    database.transaction(() => analysis.exceptions.forEach((item) => insert.run(item)))();
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.writeFileSync(path.join(stagingRoot, `${id}.json`), JSON.stringify(analysis.valid.map(({ source, mapping, link, erpSku, productMapping }) => ({ source, shopId: mapping.shopId, salesLinkId: link.id, erpSkuId: erpSku.id, productId: productMapping?.productId ?? null }))));
    const projectedCreated = analysis.valid.filter((item) => item.plannedAction === "create").length;
    const projectedUpdated = analysis.valid.length - projectedCreated;
    database.prepare(`UPDATE wangdian_platform_goods_sync_logs SET status='previewed',pageCount=?,sourceRowCount=?,matchedCount=?,exceptionCount=?,createdCount=?,updatedCount=?,completedAt=? WHERE id=?`).run(pages, rows.length, analysis.valid.length, analysis.exceptions.length, projectedCreated, projectedUpdated, new Date().toISOString(), id);
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
  database.transaction(() => {
    for (const row of rows) {
      const source = row.source;
      const current = database.prepare("SELECT * FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?").get(row.salesLinkId, text(source.spec_id));
      const id = current?.id ?? stableId("sales-link-sku", `${row.salesLinkId}|${text(source.spec_id)}`);
      const manual = current?.matchMethod === "manual" || current?.matchStatus === "matched_manual";
      const productId = manual ? current.productId : row.productId;
      database.prepare(`INSERT INTO sales_link_skus (id,salesLinkId,productId,erpSkuId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,price,platformStock,occupiedStock,systemGoodsType,syncEnabled,lastSyncedStock,lastSyncedAt,stopSyncReason,matchStatus,matchMethod,matchReason,lastSeenBatchId,currentState,missingAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET erpSkuId=excluded.erpSkuId,platformSkuCode=excluded.platformSkuCode,normalizedPlatformSkuCode=excluded.normalizedPlatformSkuCode,specificationName=excluded.specificationName,normalizedSpecificationName=excluded.normalizedSpecificationName,price=excluded.price,platformStock=excluded.platformStock,occupiedStock=excluded.occupiedStock,productId=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.productId ELSE excluded.productId END,matchStatus=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchStatus ELSE excluded.matchStatus END,matchMethod=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchMethod ELSE excluded.matchMethod END,matchReason=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchReason ELSE excluded.matchReason END,lastSeenBatchId=excluded.lastSeenBatchId,currentState='active',missingAt=NULL,updatedAt=excluded.updatedAt`).run(
        id, row.salesLinkId, productId, row.erpSkuId, text(source.spec_id), text(source.spec_outer_id), lower(source.spec_outer_id), text(source.spec_name), lower(source.spec_name), Number(source.price) || null, Number(source.stock_num) || null, Number(source.hold_stock) || null, Number(source.match_target_type) === 2 ? "combination" : "single", null, null, null, productId ? "matched_auto" : "erp_linked", "wangdian_merchant_no", productId ? "旺店通merchant_no精确关联ERP SKU及产品映射" : "旺店通merchant_no精确关联ERP SKU，产品映射待建立", logId, "active", null, current?.createdAt ?? now, now,
      );
      if (current) updated += 1; else created += 1;
    }
    database.prepare(`UPDATE wangdian_platform_goods_sync_logs SET status='completed',createdCount=?,updatedCount=?,completedAt=? WHERE id=?`).run(created, updated, now, logId);
  })();
  return { ...readWangdianPlatformGoodsSync(logId), idempotent: false };
}
