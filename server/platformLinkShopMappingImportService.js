import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const platformAliases = new Map([
  ["tmall", "tmall"], ["天猫", "tmall"],
  ["taobao", "taobao"], ["淘宝", "taobao"],
  ["xiaohongshu", "xiaohongshu"], ["小红书", "xiaohongshu"],
  ["jd", "jd"], ["京东", "jd"],
  ["douyin", "douyin"], ["抖音", "douyin"], ["抖店", "douyin"],
]);
const systemPlatformAliases = {
  tmall: ["tmall", "天猫"], taobao: ["taobao", "淘宝"], xiaohongshu: ["xiaohongshu", "小红书"],
  jd: ["jd", "京东"], douyin: ["douyin", "抖音", "抖店"],
};

function normalizePlatform(value) {
  return platformAliases.get(text(value).toLowerCase()) || platformAliases.get(text(value)) || "";
}

function parseWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择店铺匹配Excel文件。");
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel中没有可读取的工作表。");
  const source = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
  const aliases = {
    platform: ["平台", "platform"],
    platformGoodsId: ["平台商品ID", "平台货品ID", "商品ID", "SPU", "platformGoodsId"],
    systemShop: ["系统店铺", "系统店铺ID", "店铺", "shopId"],
  };
  const headers = source[0] ? Object.keys(source[0]) : [];
  const header = (key) => headers.find((item) => aliases[key].some((alias) => alias.toLowerCase() === text(item).toLowerCase()));
  const mapping = { platform: header("platform"), platformGoodsId: header("platformGoodsId"), systemShop: header("systemShop") };
  const missing = Object.entries(mapping).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`店铺匹配表缺少必需字段：${missing.join("、")}。`);
  return { sheetName, rows: source.map((row, index) => ({ rowNumber: index + 2, platform: normalizePlatform(row[mapping.platform]), platformGoodsId: text(row[mapping.platformGoodsId]), systemShop: text(row[mapping.systemShop]), rawData: row })) };
}

function findShop(database, platform, reference) {
  if (!platform || !reference) return [];
  const platforms = systemPlatformAliases[platform] || [platform];
  const placeholders = platforms.map(() => "?").join(",");
  return database.prepare(`SELECT DISTINCT s.id,s.platform,s.shopName,s.displayName FROM sales_shops s
    LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
    WHERE s.status='active' AND s.platform IN (${placeholders}) AND
      (s.id=? OR LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?))`).all(...platforms, reference, reference, reference, reference);
}

function analyze(rows) {
  const database = getDatabase();
  const identities = new Map();
  return rows.map((row) => {
    let status = "validated"; let errorType = null; let message = "可新增店铺匹配。"; let shopId = null;
    if (!row.platform) { status = "error"; errorType = "invalid_platform"; message = "平台无法识别。"; }
    else if (!row.platformGoodsId) { status = "error"; errorType = "missing_platform_goods_id"; message = "平台商品ID为空。"; }
    else if (!row.systemShop) { status = "error"; errorType = "missing_system_shop"; message = "系统店铺为空。"; }
    if (status === "validated") {
      const shops = findShop(database, row.platform, row.systemShop);
      if (shops.length !== 1) {
        status = "error"; errorType = shops.length ? "ambiguous_system_shop" : "missing_system_shop";
        message = shops.length ? "系统店铺匹配到多个候选。" : "系统店铺不存在或平台不一致。";
      } else shopId = shops[0].id;
    }
    const key = `${row.platform}\u0000${row.platformGoodsId}`;
    if (status === "validated") {
      const seenShopId = identities.get(key);
      if (seenShopId && seenShopId !== shopId) { status = "error"; errorType = "conflicting_shop_mapping"; message = "同一平台商品ID在文件中对应不同店铺。"; }
      else identities.set(key, shopId);
    }
    if (status === "validated") {
      const existing = database.prepare("SELECT shopId FROM platform_link_shop_mappings WHERE platform=? AND platformGoodsId=? AND currentState='active'").get(row.platform, row.platformGoodsId);
      if (existing?.shopId && existing.shopId !== shopId) { status = "error"; errorType = "existing_shop_conflict"; message = "该平台商品ID已绑定其他系统店铺。"; }
      else if (existing?.shopId === shopId) { status = "existing"; message = "店铺匹配已存在。"; }
    }
    return { ...row, shopId, status, errorType, message };
  });
}

function readBatch(batchId) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM platform_link_shop_mapping_import_batches WHERE id=?").get(text(batchId));
  if (!batch) throw new Error("店铺匹配导入批次不存在。");
  const rows = database.prepare("SELECT * FROM platform_link_shop_mapping_import_rows WHERE batchId=? ORDER BY rowNumber").all(batch.id);
  return { batch, rows, summary: JSON.parse(batch.summaryJson || "{}") };
}

export function previewPlatformLinkShopMappings({ buffer, fileName, createdBy = "" }) {
  const database = getDatabase(); const fileHash = crypto.createHash("sha256").update(buffer || Buffer.alloc(0)).digest("hex");
  const existing = database.prepare("SELECT id FROM platform_link_shop_mapping_import_batches WHERE fileHash=? ORDER BY createdAt DESC LIMIT 1").get(fileHash);
  if (existing) return { ...readBatch(existing.id), idempotent: true };
  const parsed = parseWorkbook(buffer); const analyzed = analyze(parsed.rows); const createdAt = now(); const batchId = makeId("platform-shop-map-import");
  const summary = {
    total: analyzed.length,
    valid: analyzed.filter((row) => row.status === "validated").length,
    existing: analyzed.filter((row) => row.status === "existing").length,
    errors: analyzed.filter((row) => row.status === "error").length,
  };
  database.transaction(() => {
    database.prepare(`INSERT INTO platform_link_shop_mapping_import_batches
      (id,fileName,fileHash,sheetName,status,totalRows,validRows,existingRows,errorRows,summaryJson,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(batchId, text(fileName) || "店铺匹配.xlsx", fileHash, parsed.sheetName, "preview_ready", summary.total, summary.valid, summary.existing, summary.errors, JSON.stringify(summary), text(createdBy) || null, createdAt, createdAt);
    const insert = database.prepare(`INSERT INTO platform_link_shop_mapping_import_rows
      (id,batchId,rowNumber,platform,platformGoodsId,systemShopText,shopId,status,errorType,message,rawDataJson,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of analyzed) insert.run(makeId("platform-shop-map-row"), batchId, row.rowNumber, row.platform || null, row.platformGoodsId || null, row.systemShop || null, row.shopId, row.status, row.errorType, row.message, JSON.stringify(row.rawData), createdAt);
  }).immediate();
  return { ...readBatch(batchId), idempotent: false };
}

export function confirmPlatformLinkShopMappings(batchId) {
  const database = getDatabase(); const current = readBatch(batchId);
  if (current.batch.status === "completed" || current.batch.status === "completed_with_errors") return { ...current, idempotent: true };
  if (current.batch.status !== "preview_ready") throw new Error("当前店铺匹配批次不能确认。 ");
  const committedAt = now(); let created = 0;
  database.transaction(() => {
    for (const row of current.rows.filter((item) => item.status === "validated")) {
      created += database.prepare(`INSERT OR IGNORE INTO platform_link_shop_mappings
        (id,platform,platformGoodsId,shopId,currentState,sourceType,sourceBatchId,createdBy,createdAt,updatedAt)
        VALUES (?,?,?,?, 'active','excel_import',?,?,?,?)`).run(makeId("platform-link-shop-map"), row.platform, row.platformGoodsId, row.shopId, current.batch.id, current.batch.createdBy, committedAt, committedAt).changes;
    }
    database.prepare("UPDATE platform_link_shop_mapping_import_batches SET status=?,committedAt=?,updatedAt=? WHERE id=?").run(current.summary.errors ? "completed_with_errors" : "completed", committedAt, committedAt, current.batch.id);
  }).immediate();
  return { ...readBatch(batchId), created, idempotent: false, protected: { salesLinksUpdated: 0, salesFactsUpdated: 0 } };
}

export function listPlatformLinkShopMappings(limit = 200) {
  return getDatabase().prepare(`SELECT m.*,s.platform AS shopPlatform,s.shopName,s.displayName FROM platform_link_shop_mappings m
    JOIN sales_shops s ON s.id=m.shopId WHERE m.currentState='active' ORDER BY m.updatedAt DESC LIMIT ?`).all(Math.max(1, Math.min(1000, Number(limit) || 200)));
}
