import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDatabase } from "./db.js";
import { LINK_ASSET_SELECT_SQL } from "./linkAssetSql.js";
import { readXlsxWorkbook } from "./workbookReader.js";

const IMPORT_TYPE = "connection_owner_assignments";
const PARSER_VERSION = "connection-owner-v4-link-id-owner-selection";
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

function text(value) { return String(value ?? "").trim(); }
function json(value, fallback = {}) { try { return JSON.parse(value || ""); } catch { return fallback; } }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }

function readRows(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择负责人匹配Excel文件。");
  const workbook = readXlsxWorkbook(buffer, { type: "buffer", raw: false }, { context: "connection-owner-import" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Excel中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows.map((raw, index) => ({
    rowNumber: index + 2,
    raw,
    linkId: text(raw["链接ID"] ?? raw["链接Id"] ?? raw["链接id"] ?? raw.linkId ?? raw.connectionId),
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
  const firstAssignmentRows = changed.filter((row) => !text(row.data?.currentOwnerId)).length;
  const reassignmentRows = changed.length - firstAssignmentRows;
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
  return {
    changeRows: changed.length,
    firstAssignmentRows,
    reassignmentRows,
    unchangedRows: matched.length - changed.length,
    requiresOverwriteConfirmation: reassignmentRows > 0,
    ownerChangeGroups: [...groups.values()],
  };
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
  else if (preview.parserVersion !== PARSER_VERSION) reason = "负责人匹配规则已更新，请重新上传链接ID表。";
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

function batchSummaryResult(database, batch, idempotent = false) {
  const preview = json(batch.previewSummaryJson);
  return { batch, preview: { ...preview, ownerChangeGroups: (preview.ownerChangeGroups || []).map((group) => ({ ...group, links: undefined })) },
    submission: submissionState(database, batch), idempotent, blocked: batch.status === "blocked" };
}

export function listConnectionOwnerImportRows(batchId, userId, { kind = "changes", page = 1, pageSize = 50 } = {}) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("负责人匹配批次不存在。");
  if (batch.createdBy && batch.createdBy !== text(userId)) throw new Error("无权查看其他用户创建的负责人匹配预览。");
  const size = Math.min(200, Math.max(20, Number(pageSize) || 50)); const currentPage = Math.max(1, Number(page) || 1);
  const condition = kind === "errors" ? "status NOT IN ('matched','success')" : "status IN ('matched','success')";
  const total = Number(database.prepare(`SELECT COUNT(*) count FROM connection_import_rows WHERE batchId=? AND ${condition}`).get(batch.id)?.count || 0);
  const rows = database.prepare(`SELECT * FROM connection_import_rows WHERE batchId=? AND ${condition} ORDER BY rowNumber,id LIMIT ? OFFSET ?`).all(batch.id, size, (currentPage - 1) * size).map((row) => ({
    ...row, rawData: json(row.rawDataJson), data: json(row.normalizedDataJson), rawDataJson: undefined, normalizedDataJson: undefined,
  }));
  return { rows, pagination: { page: currentPage, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) } };
}

export function getCurrentConnectionOwnerImport(userId) {
  const database = getDatabase();
  const batch = database.prepare(`SELECT * FROM connection_import_batches
    WHERE importType=? AND createdBy IS ? ORDER BY createdAt DESC,id DESC LIMIT 1`).get(IMPORT_TYPE, text(userId) || null);
  return batch ? batchSummaryResult(database, batch) : null;
}

export function previewConnectionOwnerImport({ buffer, fileName, userId, ownerId, replaceBatchId = "", preserveFileHash = "" }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("请选择负责人匹配Excel文件。");
  const database = getDatabase();
  const selectedOwner = database.prepare("SELECT id,name FROM persons WHERE id=? AND status='active'").get(text(ownerId));
  if (!selectedOwner) throw new Error("请选择有效负责人。");
  const hash = crypto.createHash("sha256").update(buffer).update(`|${PARSER_VERSION}|${selectedOwner.id}`).digest("hex");
  const existing = replaceBatchId ? null : database.prepare("SELECT * FROM connection_import_batches WHERE importType=? AND fileHash=? AND status<>'cancelled' ORDER BY createdAt DESC LIMIT 1").get(IMPORT_TYPE, hash);
  if (existing) return batchSummaryResult(database, existing, true);

  const sourceRows = readRows(buffer);
  if (!sourceRows.length) throw new Error("Excel中没有负责人匹配数据。");
  const identityGroups = new Map();
  for (const row of sourceRows) {
    const group = identityGroups.get(row.linkId) || [];
    group.push(row); identityGroups.set(row.linkId, group);
  }
  const repeatedRows = new Set();
  for (const group of identityGroups.values()) {
    if (group.length < 2) continue;
    for (const row of group.slice(1)) repeatedRows.add(row.rowNumber);
  }

  const links = database.prepare(`SELECT sl.id salesLinkId,sl.platformGoodsId,sl.title,sh.platform,
      COALESCE(NULLIF(sh.displayName,''),sh.shopName) shopName,cp.id connectionId,cp.name connectionName,cp.ownerId
    FROM sales_links sl JOIN sales_shops sh ON sh.id=sl.shopId
    LEFT JOIN ${LINK_ASSET_SELECT_SQL} cp ON cp.salesLinkId=sl.id
    WHERE sl.currentState='active' AND sh.status='active'`).all();

  const rows = sourceRows.map((row) => {
    let status = "matched"; let errorType = null; let errorMessage = null;
    let link = null;
    if (!row.linkId) { status = "unmatched"; errorType = "missing_link_id"; errorMessage = "链接ID不能为空。"; }
    else if (repeatedRows.has(row.rowNumber)) { status = "ignored"; errorType = "duplicate_relation"; errorMessage = "文件内链接ID重复，本行不重复更新。"; }
    if (status === "matched") {
      const direct = links.filter((item) => item.salesLinkId === row.linkId);
      const matched = direct.length ? direct : links.filter((item) => item.connectionId === row.linkId);
      if (!matched.length) { status = "unmatched"; errorType = "link_not_found"; errorMessage = "系统中不存在该链接ID。"; }
      else if (matched.length > 1) { status = "conflict"; errorType = "link_conflict"; errorMessage = "链接ID匹配到多个链接，请联系管理员处理。"; }
      else if (!matched[0].connectionId) { status = "unmatched"; errorType = "profile_not_found"; errorMessage = "该链接尚未建立链接档案。"; }
      else link = matched[0];
    }
    const currentOwner = link?.ownerId ? database.prepare("SELECT id,name FROM persons WHERE id=?").get(link.ownerId) : null;
    return {
      ...row, status, errorType, errorMessage,
      data: {
        platform: link?.platform || "", shopName: link?.shopName || "", platformGoodsId: link?.platformGoodsId || "",
        salesLinkId: link?.salesLinkId || null, connectionId: link?.connectionId || null, linkTitle: link?.title || link?.connectionName || "",
        currentOwnerId: currentOwner?.id || null, currentOwnerName: currentOwner?.name || "未分配",
        newOwnerId: selectedOwner.id, newOwnerName: selectedOwner.name,
        remark: row.remark,
      },
    };
  });

  const matched = rows.filter((row) => row.status === "matched").length;
  const unmatched = rows.filter((row) => row.status === "unmatched").length;
  const conflicts = rows.filter((row) => row.status === "conflict").length;
  const ignored = rows.filter((row) => row.status === "ignored").length;
  const duplicateRelations = rows.filter((row) => row.errorType === "duplicate_relation").length;
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
    selectedOwnerId: selectedOwner.id, selectedOwnerName: selectedOwner.name, ownerCount: 1,
    platformCount: new Set(rows.map((row) => row.data?.platform).filter(Boolean)).size,
    shopCount: new Set(rows.map((row) => row.data?.shopName).filter(Boolean)).size,
    updatableLinks: changes.changeRows,
    unmatchedLinks: rows.filter((row) => ["link_not_found", "profile_not_found"].includes(row.errorType)).length,
    shopConflictRows: 0,
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
    for (const row of rows) insert.run(id("connection-owner-import-row"), batchId, row.rowNumber, row.linkId, JSON.stringify(row.raw), JSON.stringify(row.data), row.status, row.errorType, row.errorMessage, createdAt);
  })();
  return batchSummaryResult(database, database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batchId));
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
  return previewConnectionOwnerImport({ buffer, fileName: batch.fileName, userId, ownerId: json(batch.previewSummaryJson).selectedOwnerId, replaceBatchId: batch.id, preserveFileHash: batch.fileHash });
}

export function confirmConnectionOwnerImport(batchId, userId, { confirmOverwrite = false } = {}) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("负责人匹配批次不存在。");
  if (batch.createdBy && batch.createdBy !== text(userId)) throw new Error("无权提交其他用户创建的负责人匹配预览。");
  if (["completed", "partial"].includes(batch.status)) return { ...batchSummaryResult(database, batch, true), result: json(batch.previewSummaryJson).result || { updated: 0, unchanged: 0, firstAssigned: 0, reassigned: 0 } };
  const submission = submissionState(database, batch);
  if (!submission.canSubmit) throw new Error(submission.reason);
  const previewBeforeSubmit = json(batch.previewSummaryJson);
  if (Number(previewBeforeSubmit.reassignmentRows || 0) > 0 && confirmOverwrite !== true) {
    throw new Error(`其中 ${previewBeforeSubmit.reassignmentRows} 个链接已有负责人，请确认后再变更。`);
  }
  const rows = database.prepare("SELECT * FROM connection_import_rows WHERE batchId=? AND status='matched' ORDER BY rowNumber").all(batch.id);
  let updated = 0; let unchanged = 0; let firstAssigned = 0; let reassigned = 0;
  database.transaction(() => {
    for (const row of rows) {
      const data = json(row.normalizedDataJson);
      const profile = database.prepare("SELECT id,ownerId FROM sales_links WHERE id=? AND id=?").get(data.connectionId, data.salesLinkId);
      const owner = database.prepare("SELECT id FROM persons WHERE id=? AND status='active'").get(data.newOwnerId);
      if (!profile || !owner || text(profile.ownerId) !== text(data.currentOwnerId)) throw new Error(`第${row.rowNumber}行的链接、负责人或现有数据已变化，请重新生成预览。`);
      if (profile.ownerId === owner.id) unchanged += 1;
      else {
        if (profile.ownerId) reassigned += 1; else firstAssigned += 1;
        database.prepare("UPDATE sales_links SET ownerId=?,updatedAt=? WHERE id=?").run(owner.id, now(), profile.id); updated += 1;
      }
      database.prepare("UPDATE connection_import_rows SET status='success' WHERE id=?").run(row.id);
    }
    const completedAt = now(); const preview = { ...json(batch.previewSummaryJson), result: { updated, unchanged, firstAssigned, reassigned } };
    const finalStatus = Number(batch.errorRows || 0) > 0 ? "partial" : "completed";
    database.prepare("UPDATE connection_import_batches SET status=?,completedAt=?,updatedAt=?,previewSummaryJson=? WHERE id=?").run(finalStatus, completedAt, completedAt, JSON.stringify(preview), batch.id);
  })();
  const completed = database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batch.id);
  return { ...batchSummaryResult(database, completed), result: { updated, unchanged, firstAssigned, reassigned } };
}

export function cancelConnectionOwnerImport(batchId, userId) {
  const database = getDatabase();
  const batch = database.prepare("SELECT * FROM connection_import_batches WHERE id=? AND importType=?").get(text(batchId), IMPORT_TYPE);
  if (!batch) throw new Error("负责人匹配批次不存在。");
  if (batch.createdBy && batch.createdBy !== text(userId)) throw new Error("无权取消其他用户创建的预览。");
  if (["completed", "partial"].includes(batch.status)) throw new Error("已提交批次不能取消。");
  if (batch.status !== "cancelled") database.prepare("UPDATE connection_import_batches SET status='cancelled',updatedAt=? WHERE id=?").run(now(), batch.id);
  return batchSummaryResult(database, database.prepare("SELECT * FROM connection_import_batches WHERE id=?").get(batch.id));
}
