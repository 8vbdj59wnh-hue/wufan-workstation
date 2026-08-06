import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDatabase } from "./db.js";

const IMPORT_TYPE = "connection_owner_assignments";
const PARSER_VERSION = "connection-owner-v3-shop-platform-inference";
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

function text(value) { return String(value ?? "").trim(); }
function json(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }

function normalizePlatform(value) {
  const raw = text(value).toLowerCase().replaceAll(" ", "");
  return ({
    tmall: "天猫", "天猫": "天猫", taobao: "淘宝", "淘宝": "淘宝",
    jd: "京东", jingdong: "京东", "京东": "京东",
    xiaohongshu: "小红书", redbook: "小红书", "小红书": "小红书",
    douyin: "抖店", doudian: "抖店", "抖音": "抖店", "抖店": "抖店",
    wechat: "视频号小店", "视频号": "视频号小店", "视频号小店": "视频号小店",
  })[raw] || "";
}

function inferPlatformFromShop(value) {
  const shop = text(value).replaceAll(" ", "");
  if (shop.includes("小红书")) return "小红书";
  if (shop.endsWith("-天猫") || shop.includes("-天猫-")) return "天猫";
  if (shop.endsWith("-淘宝") || shop.includes("-淘宝C店")) return "淘宝";
  if (shop.endsWith("-京东") || shop.includes("-京东-")) return "京东";
  if (shop.includes("-抖店")) return "抖店";
  if (shop.includes("-视频号小店")) return "视频号小店";
  return "";
}

function sourceShopNames(value, platform) {
  const raw = text(value); const names = [raw];
  const suffixes = platform === "淘宝" ? ["-淘宝", "-淘宝C店"] : [`-${platform}`, `-${platform}-公司`];
  for (const suffix of suffixes) if (raw.endsWith(suffix)) names.push(raw.slice(0, -suffix.length).trim());
  if (platform === "小红书" && raw.startsWith("小红书")) names.push(raw.slice(3).trim());
  return [...new Set(names.filter(Boolean))];
}

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
    platformRaw: text(raw["平台"] ?? raw.platform) || inferPlatformFromShop(raw["店铺"] ?? raw.shop),
    shopName: text(raw["店铺"] ?? raw.shop),
    platformGoodsId: text(raw["商品ID"] ?? raw["货品ID"] ?? raw.platformGoodsId),
    ownerName: text(raw["负责人"] ?? raw.owner),
    operationGroup: text(raw["运营组"] ?? raw.operationGroup),
    remark: text(raw["备注"] ?? raw.remark),
  })).filter((row) => Object.values(row.raw).some((value) => text(value)));
}

function previewExpiresAt(batch) {
  const preview = json(batch.previewSummaryJson);
  return preview.expiresAt || new Date(new Date(batch.createdAt).getTime() + PREVIEW_TTL_MS).toISOString();
}

function changeSummary(rows) {
  const matched = rows.filter((row) => row.status === "matched");
  const changed = matched.filter((row) => text(row.data?.currentOwnerId) !== text(row.data?.newOwnerId));
  const groups = new Map();
  for (const row of changed) {
    const data = row.data || {};
    const key = `${text(data.currentOwnerId)}\u0000${text(data.newOwnerId)}`;
    const group = groups.get(key) || {
      currentOwnerId: data.currentOwnerId || null,
      currentOwnerName: data.currentOwnerName || "未分配",
      newOwnerId: data.newOwnerId || null,
      newOwnerName: data.newOwnerName || "—",
      linkCount: 0,
      links: [],
    };
    group.linkCount += 1;
    group.links.push({
      connectionId: data.connectionId,
      salesLinkId: data.salesLinkId,
      title: data.linkTitle,
      platform: data.platform,
      shop: data.shopName,
      platformGoodsId: data.platformGoodsId,
    });
    groups.set(key, group);
  }
  return { changeRows: changed.length, unchangedRows: matched.length - changed.length, ownerChangeGroups: [...groups.values()] };
}

function submissionState(database, batch) {
  const preview = json(batch.previewSummaryJson);
  const ready = ["validated", "preview_ready"].includes(batch.status);
  const latest = database.prepare(`SELECT id FROM connection_import_batches
    WHERE importType=? AND createdBy IS ? AND status IN ('validated','preview_ready')
    ORDER BY createdAt DESC,id DESC LIMIT 1`).get(IMPORT_TYPE, batch.createdBy || null);
  let reason = "";
  if (["completed", "partial"].includes(batch.status)) reason = "批次已经提交。";
  else if (batch.status === "cancelled") reason = "本次预览已取消。";
  else if (!ready) reason = "批次不是待确认状态。";
  else if (latest?.id !== batch.id) reason = "批次不是当前有效预览。";
  else if (Date.now() > new Date(previewExpiresAt(batch)).getTime()) reason = "预览已经过期，请重新生成。";
  else if (Number(preview.updatableLinks || batch.matchedRows || 0) <= 0) reason = "没有可更新链接。";
  return { canSubmit: !reason, reason, expiresAt: previewExpiresAt(batch), isCurrentPreview: latest?.id === batch.id };
}

function batchResult(database, batch, idempotent = false) {
  const rows = database.prepare("SELECT * FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber,id").all(batch.id).map((row) => ({
    ...row,
    rawData: json(row.rawDataJson),
    data: json(row.normalizedDataJson),
  }));
  const preview = { ...json(batch.previewSummaryJson), ...changeSummary(rows) };
  preview.updatableLinks = preview.changeRows;
  return { batch, preview, rows, submission: submissionState(database, batch), idempotent, blocked: batch.status === "blocked" };
}

export function getCurrentConnectionOwnerImport(userId) {
  const database = getDatabase();
  const batch = database.prepare(`SELECT * FROM connection_import_batches
    WHERE importType=? AND createdBy IS ? ORDER BY createdAt DESC,id DESC LIMIT 1`).get(IMPORT_TYPE, text(userId) || null);
  return batch ? batchResult(database, batch) : null;
}

export function previewConnectionOwnerImport({ buffer, fileName, userId, replaceBatchId = "", preserveFileHash = "" }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择负责人匹配Excel文件。");
  const database = getDatabase();
  const hash = crypto.createHash("sha256").update(buffer).update(`|${PARSER_VERSION}`).digest("hex");
  const existing = replaceBatchId ? null : database.prepare("SELECT * FROM connection_import_batches WHERE importType=? AND fileHash=? AND status<>'cancelled' ORDER BY createdAt DESC LIMIT 1").get(IMPORT_TYPE, hash);
  if (existing) return batchResult(database, existing, true);

  const sourceRows = readRows(buffer);
  if (!sourceRows.length) throw new Error("Excel中没有负责人匹配数据。");
  const identityGroups = new Map();
  for (const row of sourceRows) {
    const platform = normalizePlatform(row.platformRaw);
    const key = `${platform}\u0000${row.shopName}\u0000${row.platformGoodsId}`;
    const group = identityGroups.get(key) || [];
    group.push(row); identityGroups.set(key, group);
  }
  const repeatedRows = new Set(); const conflictingIdentities = new Set();
  for (const [key, group] of identityGroups) {
    if (group.length < 2) continue;
    if (new Set(group.map((row) => row.ownerName)).size > 1) conflictingIdentities.add(key);
    else for (const row of group.slice(1)) repeatedRows.add(row.rowNumber);
  }

  const shops = database.prepare("SELECT id,platform,shopName,displayName FROM sales_shops WHERE status='active'").all();
  const links = database.prepare(`SELECT sl.id,sl.shopId,sl.platformGoodsId,sl.title,sh.platform,sh.shopName,sh.displayName
    FROM sales_links sl JOIN sales_shops sh ON sh.id=sl.shopId WHERE sl.currentState='active' AND sh.status='active'`).all();
  const people = database.prepare("SELECT id,name FROM persons WHERE status='active'").all();

  const rows = sourceRows.map((row) => {
    let status = "matched"; let errorType = null; let errorMessage = null;
    let salesLink = null; let profile = null; let owner = null; let shop = null;
    const platform = normalizePlatform(row.platformRaw);
    const identity = `${platform}\u0000${row.shopName}\u0000${row.platformGoodsId}`;
    if (!row.platformRaw || !platform) { status = "unmatched"; errorType = "invalid_platform"; errorMessage = "平台为空或不受支持。"; }
    else if (!row.shopName) { status = "unmatched"; errorType = "missing_shop"; errorMessage = "店铺不能为空。"; }
    else if (!row.platformGoodsId) { status = "unmatched"; errorType = "missing_goods_id"; errorMessage = "商品ID不能为空。"; }
    else if (!row.ownerName) { status = "ignored"; errorType = "empty_owner"; errorMessage = "负责人为空，本行不会更新。"; }
    else if (conflictingIdentities.has(identity)) { status = "conflict"; errorType = "duplicate_owner_conflict"; errorMessage = "同一平台、店铺和商品ID对应多个负责人，本行已隔离。"; }
    else if (repeatedRows.has(row.rowNumber)) { status = "ignored"; errorType = "duplicate_relation"; errorMessage = "文件内负责人关系重复，本行不重复更新。"; }
    if (status === "matched") {
      const names = sourceShopNames(row.shopName, platform);
      const namedShops = shops.filter((item) => names.includes(text(item.shopName)) || names.includes(text(item.displayName)));
      const matchingShops = namedShops.filter((item) => item.platform === platform);
      if (!matchingShops.length && namedShops.length) { status = "conflict"; errorType = "platform_mismatch"; errorMessage = "店铺存在，但所属平台与文件平台不一致。"; }
      else if (!matchingShops.length) { status = "unmatched"; errorType = "shop_not_found"; errorMessage = "系统中不存在该平台店铺。"; }
      else if (matchingShops.length > 1) { status = "conflict"; errorType = "shop_conflict"; errorMessage = "店铺字段匹配到多个系统店铺。"; }
      else {
        shop = matchingShops[0];
        const platformLinks = links.filter((item) => item.platform === platform && item.platformGoodsId === row.platformGoodsId);
        const matchingLinks = platformLinks.filter((item) => item.shopId === shop.id);
        if (!platformLinks.length) { status = "unmatched"; errorType = "goods_not_found"; errorMessage = "该平台未找到商品ID。"; }
        else if (!matchingLinks.length) { status = "conflict"; errorType = "shop_link_conflict"; errorMessage = "商品ID存在，但不属于文件指定店铺。"; }
        else if (matchingLinks.length > 1) { status = "conflict"; errorType = "link_conflict"; errorMessage = "平台、店铺和商品ID对应多个销售链接。"; }
        else {
          salesLink = matchingLinks[0]; profile = database.prepare("SELECT id,name,ownerId FROM connection_profiles WHERE salesLinkId=?").get(salesLink.id);
          if (!profile) { status = "unmatched"; errorType = "profile_not_found"; errorMessage = "商品ID尚未建立链接档案。"; }
        }
      }
    }
    if (status === "matched") {
      const owners = people.filter((item) => item.name === row.ownerName);
      if (owners.length === 0) { status = "conflict"; errorType = "owner_not_found"; errorMessage = "系统中不存在该负责人。"; }
      else if (owners.length > 1) { status = "conflict"; errorType = "owner_conflict"; errorMessage = "存在多个同名负责人，请先处理人员重名。"; }
      else owner = owners[0];
    }
    const currentOwner = profile?.ownerId ? database.prepare("SELECT id,name FROM persons WHERE id=?").get(profile.ownerId) : null;
    return {
      ...row, status, errorType, errorMessage,
      data: {
        platform, shopId: shop?.id || null, shopName: shop?.displayName || shop?.shopName || row.shopName,
        platformGoodsId: row.platformGoodsId,
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
  const duplicateRelations = rows.filter((row) => ["duplicate_relation", "duplicate_owner_conflict"].includes(row.errorType)).length;
  const changes = changeSummary(rows);
  const replacedBatch = replaceBatchId ? database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(replaceBatchId), IMPORT_TYPE) : null;
  if (replaceBatchId && !replacedBatch) throw new Error("负责人匹配批次不存在。");
  if (replacedBatch?.createdBy && replacedBatch.createdBy !== text(userId)) throw new Error("无权重新校验其他用户创建的负责人匹配预览。");
  if (replacedBatch && !["validated", "preview_ready"].includes(replacedBatch.status)) throw new Error("当前批次不能重新校验。");
  const createdAt = replacedBatch?.createdAt || now(); const batchId = replacedBatch?.id || id("connection-owner-import");
  const expiresAt = new Date(new Date(createdAt).getTime() + PREVIEW_TTL_MS).toISOString();
  const preview = {
    totalRows: rows.length, matchedRows: matched, unmatchedRows: unmatched,
    conflictRows: conflicts, ignoredRows: ignored,
    ownerCount: new Set(rows.map((row) => row.ownerName).filter(Boolean)).size,
    platformCount: new Set(rows.map((row) => normalizePlatform(row.platformRaw)).filter(Boolean)).size,
    shopCount: new Set(rows.map((row) => row.shopName).filter(Boolean)).size,
    updatableLinks: changes.changeRows,
    unmatchedLinks: rows.filter((row) => ["goods_not_found", "profile_not_found"].includes(row.errorType)).length,
    shopConflictRows: rows.filter((row) => ["missing_shop", "shop_not_found", "shop_conflict", "shop_link_conflict", "platform_mismatch"].includes(row.errorType)).length,
    duplicateRelations,
    ...changes, parserVersion: PARSER_VERSION, expiresAt,
  };
  database.transaction(() => {
    if (replacedBatch) {
      database.prepare("DELETE FROM connection_import_rows WHERE batchId=?").run(batchId);
      database.prepare(`UPDATE connection_import_batches SET status='preview_ready',totalRows=?,matchedRows=?,pendingRows=0,errorRows=?,updatedAt=?,sourcePlatform=?,previewSummaryJson=? WHERE id=?`).run(
        rows.length, matched, unmatched + conflicts + ignored, now(), "", JSON.stringify(preview), batchId,
      );
    } else database.prepare(`INSERT INTO connection_import_batches
      (id,sourceType,externalShopId,fileName,fileHash,businessDate,status,totalRows,matchedRows,pendingRows,errorRows,createdBy,createdAt,updatedAt,importType,sourcePlatform,previewSummaryJson)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      batchId, IMPORT_TYPE, "", text(fileName) || "链接负责人匹配.xlsx", preserveFileHash || hash, createdAt.slice(0, 10), "preview_ready",
      rows.length, matched, 0, unmatched + conflicts + ignored, text(userId) || null, createdAt, createdAt, IMPORT_TYPE, "", JSON.stringify(preview),
    );
    const insert = database.prepare(`INSERT INTO connection_import_rows
      (id,batchId,rowNumber,externalKey,rawDataJson,normalizedDataJson,status,errorType,errorMessage,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) insert.run(id("connection-owner-import-row"), batchId, row.rowNumber, `${normalizePlatform(row.platformRaw)}|${row.shopName}|${row.platformGoodsId}`, JSON.stringify(row.raw), JSON.stringify(row.data), row.status, row.errorType, row.errorMessage, createdAt);
  })();
  return batchResult(database, database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batchId));
}

export function rebuildConnectionOwnerImportPreview(batchId, userId) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("负责人匹配批次不存在。");
  const rawRows = database.prepare("SELECT rawDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber,id").all(batch.id).map((row) => json(row.rawDataJson));
  if (!rawRows.length) throw new Error("当前批次没有可重新校验的原始数据。");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawRows), "负责人匹配");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return previewConnectionOwnerImport({ buffer, fileName: batch.fileName, userId, replaceBatchId: batch.id, preserveFileHash: batch.fileHash });
}

export function confirmConnectionOwnerImport(batchId, userId) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("负责人匹配批次不存在。");
  if (batch.createdBy && batch.createdBy !== text(userId)) throw new Error("无权提交其他用户创建的负责人匹配预览。");
  if (["completed", "partial"].includes(batch.status)) return { ...batchResult(database, batch, true), result: json(batch.previewSummaryJson).result || { updated: 0, unchanged: 0 } };
  const submission = submissionState(database, batch);
  if (!submission.canSubmit) throw new Error(submission.reason);
  const rows = database.prepare("SELECT * FROM connection_import_rows WHERE batchId=? AND status='matched' ORDER BY rowNumber").all(batch.id);
  let updated = 0; let unchanged = 0;
  database.transaction(() => {
    for (const row of rows) {
      const data = json(row.normalizedDataJson);
      const profile = database.prepare("SELECT id,ownerId FROM connection_profiles WHERE id=? AND salesLinkId=?").get(data.connectionId, data.salesLinkId);
      const owner = database.prepare("SELECT id FROM persons WHERE id=? AND status='active'").get(data.newOwnerId);
      if (!profile || !owner || text(profile.ownerId) !== text(data.currentOwnerId)) throw new Error(`第${row.rowNumber}行的链接、负责人或现有数据已变化，请重新生成预览。`);
      if (profile.ownerId === owner.id) unchanged += 1;
      else { database.prepare("UPDATE connection_profiles SET ownerId=?,updatedAt=? WHERE id=?").run(owner.id, now(), profile.id); updated += 1; }
      database.prepare("UPDATE connection_import_rows SET status='success' WHERE id=?").run(row.id);
    }
    const completedAt = now(); const preview = { ...json(batch.previewSummaryJson), result: { updated, unchanged } };
    const finalStatus = Number(batch.errorRows || 0) > 0 ? "partial" : "completed";
    database.prepare("UPDATE connection_import_batches SET status=?,completedAt=?,updatedAt=?,previewSummaryJson=? WHERE id=?").run(finalStatus, completedAt, completedAt, JSON.stringify(preview), batch.id);
  })();
  const completed = database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batch.id);
  return { ...batchResult(database, completed), result: { updated, unchanged } };
}

export function cancelConnectionOwnerImport(batchId, userId) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("负责人匹配批次不存在。");
  if (batch.createdBy && batch.createdBy !== text(userId)) throw new Error("无权取消其他用户创建的预览。");
  if (["completed", "partial"].includes(batch.status)) throw new Error("已提交批次不能取消。");
  if (batch.status !== "cancelled") database.prepare("UPDATE connection_import_batches SET status='cancelled',updatedAt=? WHERE id=?").run(now(), batch.id);
  return batchResult(database, database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batch.id));
}
