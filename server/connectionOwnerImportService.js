import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDatabase } from "./db.js";

const IMPORT_TYPE = "connection_owner_assignments";

function text(value) { return String(value ?? "").trim(); }
function json(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }

function readRows(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择负责人匹配Excel文件。");
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Excel中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows.map((raw, index) => ({
    rowNumber: index + 2,
    raw,
    platformGoodsId: text(raw["商品ID"] ?? raw.platformGoodsId),
    ownerName: text(raw["负责人"] ?? raw.owner),
    operationGroup: text(raw["运营组"] ?? raw.operationGroup),
    remark: text(raw["备注"] ?? raw.remark),
  })).filter((row) => Object.values(row.raw).some((value) => text(value)));
}

function batchResult(database, batch, idempotent = false) {
  const rows = database.prepare("SELECT * FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber,id").all(batch.id).map((row) => ({
    ...row,
    rawData: json(row.rawDataJson),
    data: json(row.normalizedDataJson),
  }));
  return { batch, preview: json(batch.previewSummaryJson), rows, idempotent, blocked: batch.status === "blocked" };
}

export function previewConnectionOwnerImport({ buffer, fileName, shopId, userId }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择负责人匹配Excel文件。");
  const selectedShopId = text(shopId);
  if (!selectedShopId) throw new Error("请选择链接所属店铺。");
  const database = getDatabase();
  const shop = database.prepare("SELECT id,platform,shopName,displayName FROM sales_shops WHERE id=? AND status='active'").get(selectedShopId);
  if (!shop) throw new Error("所选店铺不存在或已停用。");
  const hash = crypto.createHash("sha256").update(buffer).update(`|${selectedShopId}`).digest("hex");
  const existing = database.prepare("SELECT * FROM connection_import_batches WHERE importType=? AND fileHash=? ORDER BY createdAt DESC LIMIT 1").get(IMPORT_TYPE, hash);
  if (existing) return batchResult(database, existing, true);

  const sourceRows = readRows(buffer);
  if (!sourceRows.length) throw new Error("Excel中没有负责人匹配数据。");
  const duplicateIds = new Set(); const seen = new Set();
  for (const row of sourceRows) {
    if (!row.platformGoodsId) continue;
    if (seen.has(row.platformGoodsId)) duplicateIds.add(row.platformGoodsId);
    seen.add(row.platformGoodsId);
  }

  const rows = sourceRows.map((row) => {
    let status = "matched"; let errorType = null; let errorMessage = null;
    let salesLink = null; let profile = null; let owner = null;
    if (!row.platformGoodsId) { status = "unmatched"; errorType = "missing_goods_id"; errorMessage = "商品ID不能为空。"; }
    else if (duplicateIds.has(row.platformGoodsId)) { status = "conflict"; errorType = "duplicate_goods_id"; errorMessage = "同一商品ID在文件中重复，已阻断确认。"; }
    else if (!row.ownerName) { status = "ignored"; errorType = "empty_owner"; errorMessage = "负责人为空，本行不会更新。"; }
    if (status === "matched") {
      const links = database.prepare("SELECT id,title FROM sales_links WHERE shopId=? AND platformGoodsId=?").all(selectedShopId, row.platformGoodsId);
      if (links.length === 0) { status = "unmatched"; errorType = "goods_not_found"; errorMessage = "当前店铺未找到该商品ID。"; }
      else if (links.length > 1) { status = "conflict"; errorType = "link_conflict"; errorMessage = "当前店铺商品ID对应多个销售链接。"; }
      else {
        salesLink = links[0]; profile = database.prepare("SELECT id,name,ownerId FROM connection_profiles WHERE salesLinkId=?").get(salesLink.id);
        if (!profile) { status = "unmatched"; errorType = "profile_not_found"; errorMessage = "商品ID尚未建立链接档案。"; }
      }
    }
    if (status === "matched") {
      const owners = database.prepare("SELECT id,name FROM persons WHERE name=? AND status='active'").all(row.ownerName);
      if (owners.length === 0) { status = "conflict"; errorType = "owner_not_found"; errorMessage = "系统中不存在该负责人。"; }
      else if (owners.length > 1) { status = "conflict"; errorType = "owner_conflict"; errorMessage = "存在多个同名负责人，请先处理人员重名。"; }
      else owner = owners[0];
    }
    const currentOwner = profile?.ownerId ? database.prepare("SELECT id,name FROM persons WHERE id=?").get(profile.ownerId) : null;
    return {
      ...row, status, errorType, errorMessage,
      data: {
        platformGoodsId: row.platformGoodsId, shopId: selectedShopId,
        salesLinkId: salesLink?.id || null, connectionId: profile?.id || null, linkTitle: salesLink?.title || profile?.name || "",
        currentOwnerId: currentOwner?.id || null, currentOwnerName: currentOwner?.name || "未分配",
        newOwnerId: owner?.id || null, newOwnerName: owner?.name || row.ownerName,
        operationGroup: row.operationGroup, remark: row.remark,
      },
    };
  });

  const matched = rows.filter((row) => row.status === "matched").length;
  const unmatched = rows.filter((row) => row.status === "unmatched").length;
  const conflicts = rows.filter((row) => row.status === "conflict").length;
  const ignored = rows.filter((row) => row.status === "ignored").length;
  const blocked = conflicts > 0;
  const createdAt = now(); const batchId = id("connection-owner-import");
  const preview = {
    shopId: shop.id, platform: shop.platform, shop: shop.displayName || shop.shopName,
    totalRows: rows.length, matchedRows: matched, unmatchedRows: unmatched,
    conflictRows: conflicts, ignoredRows: ignored, duplicateGoodsIds: [...duplicateIds],
  };
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_import_batches
      (id,sourceType,externalShopId,fileName,fileHash,businessDate,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,sourcePlatform,previewSummaryJson)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      batchId, IMPORT_TYPE, shop.id, text(fileName) || "链接负责人匹配.xlsx", hash, createdAt.slice(0, 10), blocked ? "blocked" : "validated",
      rows.length, matched, unmatched + ignored, conflicts, text(userId) || null, createdAt, createdAt, IMPORT_TYPE, shop.platform, JSON.stringify(preview),
    );
    const insert = database.prepare(`INSERT INTO connection_import_rows
      (id,batchId,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) insert.run(id("connection-owner-import-row"), batchId, row.rowNumber, row.platformGoodsId, JSON.stringify(row.raw), JSON.stringify(row.data), row.status, row.errorType, row.errorMessage, createdAt);
  })();
  return batchResult(database, database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batchId));
}

export function confirmConnectionOwnerImport(batchId) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("负责人匹配批次不存在。");
  if (batch.status === "completed") return { ...batchResult(database, batch, true), result: json(batch.previewSummaryJson).result || { updated: 0, unchanged: 0 } };
  if (batch.status !== "validated") throw new Error("批次存在负责人或商品ID冲突，不能确认更新。");
  const rows = database.prepare("SELECT * FROM connection_import_rows WHERE batchId=? AND status='matched' ORDER BY rowNumber").all(batch.id);
  let updated = 0; let unchanged = 0;
  database.transaction(() => {
    for (const row of rows) {
      const data = json(row.normalizedDataJson);
      const profile = database.prepare("SELECT id,ownerId FROM connection_profiles WHERE id=? AND salesLinkId=?").get(data.connectionId, data.salesLinkId);
      const owner = database.prepare("SELECT id FROM persons WHERE id=? AND status='active'").get(data.newOwnerId);
      if (!profile || !owner) throw new Error(`第${row.rowNumber}行的链接或负责人已变化，请重新生成预览。`);
      if (profile.ownerId === owner.id) unchanged += 1;
      else { database.prepare("UPDATE connection_profiles SET ownerId=?,updatedAt=? WHERE id=?").run(owner.id, now(), profile.id); updated += 1; }
      database.prepare("UPDATE connection_import_rows SET status='success' WHERE id=?").run(row.id);
    }
    const completedAt = now(); const preview = { ...json(batch.previewSummaryJson), result: { updated, unchanged } };
    database.prepare("UPDATE connection_import_batches SET status='completed',completedAt=?,updatedAt=?,previewSummaryJson=? WHERE id=?").run(completedAt, completedAt, JSON.stringify(preview), batch.id);
  })();
  const completed = database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batch.id);
  return { ...batchResult(database, completed), result: { updated, unchanged } };
}
