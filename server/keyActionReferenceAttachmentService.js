import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDatabase } from "./db.js";

export const keyActionReferenceImagesKey = "referenceImageAttachments";
export const keyActionReferenceImageLimits = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxCount: 9,
  stagingLifetimeMs: 24 * 60 * 60 * 1000,
});

function attachmentError(message, status = 400, code = "key_action_reference_image_invalid") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function cleanText(value, label, { required = false, maximum = 255 } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && normalized === "") throw attachmentError(`${label}不能为空。`);
  if (normalized.length > maximum) throw attachmentError(`${label}不能超过${maximum}个字符。`);
  return normalized;
}

function safeRemove(filePath, rootDirectory) {
  const resolvedRoot = `${path.resolve(rootDirectory)}${path.sep}`;
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot)) throw attachmentError("参考图文件路径不在受控目录内。", 500, "key_action_reference_image_path_invalid");
  fs.rmSync(resolvedFile, { force: true });
}

function publicAttachment(row) {
  return {
    id: row.id,
    purpose: "reference_image",
    originalName: row.originalName,
    url: row.filePath,
    filePath: row.filePath,
    mimeType: row.mimeType,
    size: Number(row.byteSize),
    sha256: row.sha256,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? null,
  };
}

function readAttachment(id) {
  return getDatabase().prepare("SELECT * FROM key_action_reference_attachments WHERE id=? LIMIT 1").get(id) ?? null;
}

function normalizeAttachmentIds(values) {
  if (!Array.isArray(values)) throw attachmentError("参考图附件ID必须是数组。");
  const ids = [...new Set(values.map((value) => cleanText(value, "参考图附件ID", { required: true, maximum: 120 })))];
  if (ids.length > keyActionReferenceImageLimits.maxCount) throw attachmentError(`参考图最多${keyActionReferenceImageLimits.maxCount}张。`);
  return ids;
}

function isExpired(row, now = new Date()) {
  return row.status === "staged" && Number.isFinite(Date.parse(row.expiresAt)) && Date.parse(row.expiresAt) <= now.getTime();
}

export function cleanupExpiredKeyActionReferenceImages(referenceImagesDirectory, { now = new Date() } = {}) {
  const database = getDatabase();
  const rows = database.prepare(`SELECT a.* FROM key_action_reference_attachments a
    WHERE a.status='staged' AND a.expiresAt IS NOT NULL AND a.expiresAt<=?
      AND NOT EXISTS (SELECT 1 FROM key_action_reference_attachment_links l WHERE l.attachmentId=a.id)`).all(now.toISOString());
  const expired = [];
  for (const row of rows) {
    try {
      safeRemove(path.join(referenceImagesDirectory, row.storedName), referenceImagesDirectory);
      const removedAt = now.toISOString();
      database.prepare(`UPDATE key_action_reference_attachments SET status='expired',removedAt=?,updatedAt=?
        WHERE id=? AND status='staged'`).run(removedAt, removedAt, row.id);
      expired.push(row.id);
    } catch (error) {
      console.error("过期关键行动参考图清理失败", { attachmentId: row.id, message: error.message });
    }
  }
  return { expiredCount: expired.length, attachmentIds: expired };
}

export function registerKeyActionReferenceImage({
  ownerUserId,
  ownerSessionId,
  idempotencyKey,
  stagedPath,
  originalName,
  mimeType,
  byteSize,
  extension,
  referenceImagesDirectory,
  now = new Date(),
}) {
  const database = getDatabase();
  const userId = cleanText(ownerUserId, "附件所有人", { required: true, maximum: 120 });
  const sessionId = cleanText(ownerSessionId, "助手设备会话", { required: true, maximum: 120 });
  const requestKey = cleanText(idempotencyKey, "上传幂等键", { required: true, maximum: 160 });
  const name = cleanText(originalName, "图片文件名", { required: true, maximum: 255 });
  const normalizedMimeType = cleanText(mimeType, "图片类型", { required: true, maximum: 100 });
  const size = Number(byteSize);
  if (!Number.isSafeInteger(size) || size <= 0 || size > keyActionReferenceImageLimits.maxBytes) {
    throw attachmentError("参考图大小必须在1字节至5MB之间。", 413, "key_action_reference_image_size_invalid");
  }
  cleanupExpiredKeyActionReferenceImages(referenceImagesDirectory, { now });
  const bytes = fs.readFileSync(stagedPath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const existingByKey = database.prepare(`SELECT * FROM key_action_reference_attachments
    WHERE ownerUserId=? AND ownerSessionId=? AND idempotencyKey=? LIMIT 1`).get(userId, sessionId, requestKey);
  if (existingByKey) {
    safeRemove(stagedPath, path.dirname(stagedPath));
    if (existingByKey.sha256 !== sha256 || Number(existingByKey.byteSize) !== size || existingByKey.mimeType !== normalizedMimeType) {
      throw attachmentError("同一上传幂等键对应了不同图片，请为新图片使用新的幂等键。", 409, "key_action_reference_image_idempotency_conflict");
    }
    if (!["staged", "active"].includes(existingByKey.status)) {
      throw attachmentError("该上传幂等键对应的暂存图片已清理，请使用新的幂等键重新上传。", 409, "key_action_reference_image_already_removed");
    }
    return { attachment: publicAttachment(existingByKey), duplicate: true, created: false };
  }
  const existingByHash = database.prepare(`SELECT * FROM key_action_reference_attachments
    WHERE ownerUserId=? AND ownerSessionId=? AND sha256=? AND status IN ('staged','active')
    ORDER BY createdAt DESC LIMIT 1`).get(userId, sessionId, sha256);
  if (existingByHash) {
    safeRemove(stagedPath, path.dirname(stagedPath));
    return { attachment: publicAttachment(existingByHash), duplicate: true, created: false };
  }

  const id = crypto.randomUUID();
  const safeExtension = cleanText(extension, "图片扩展名", { required: true, maximum: 10 }).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(safeExtension)) throw attachmentError("参考图格式无效。");
  const storedName = `${id}${safeExtension}`;
  const destinationPath = path.join(referenceImagesDirectory, storedName);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + keyActionReferenceImageLimits.stagingLifetimeMs).toISOString();
  fs.mkdirSync(referenceImagesDirectory, { recursive: true });
  if (fs.existsSync(destinationPath)) throw attachmentError("参考图文件名冲突，请重试。", 409, "key_action_reference_image_name_conflict");
  fs.renameSync(stagedPath, destinationPath);
  try {
    database.prepare(`INSERT INTO key_action_reference_attachments
      (id,ownerUserId,ownerSessionId,idempotencyKey,originalName,storedName,filePath,mimeType,byteSize,sha256,status,createdAt,expiresAt,updatedAt,removedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,'staged',?,?,?,NULL)`).run(
      id, userId, sessionId, requestKey, name, storedName,
      `/uploads/key-action-reference-images/${storedName}`, normalizedMimeType, size, sha256,
      createdAt, expiresAt, createdAt,
    );
  } catch (error) {
    safeRemove(destinationPath, referenceImagesDirectory);
    throw error;
  }
  return { attachment: publicAttachment(readAttachment(id)), duplicate: false, created: true };
}

export function resolveOwnedKeyActionReferenceImages(attachmentIds, {
  ownerUserId,
  ownerSessionId,
  now = new Date(),
} = {}) {
  const ids = normalizeAttachmentIds(attachmentIds);
  const userId = cleanText(ownerUserId, "附件所有人", { required: true, maximum: 120 });
  const sessionId = cleanText(ownerSessionId, "助手设备会话", { required: true, maximum: 120 });
  return ids.map((id) => {
    const row = readAttachment(id);
    if (!row) throw attachmentError(`参考图附件不存在：${id}`, 404, "key_action_reference_image_not_found");
    if (row.ownerUserId !== userId || row.ownerSessionId !== sessionId) {
      throw attachmentError("不能引用其他账号或设备上传的参考图。", 403, "key_action_reference_image_forbidden");
    }
    if (isExpired(row, now) || !["staged", "active"].includes(row.status)) {
      throw attachmentError("参考图暂存已过期或已清理，请重新上传并预览。", 409, "key_action_reference_image_unavailable");
    }
    return publicAttachment(row);
  });
}

export function linkKeyActionReferenceImagesInTransaction({
  attachmentIds,
  ownerUserId,
  ownerSessionId,
  processInstanceId,
  workPlanId,
  now = new Date(),
}) {
  const attachments = resolveOwnedKeyActionReferenceImages(attachmentIds, { ownerUserId, ownerSessionId, now });
  const createdAt = now.toISOString();
  const insert = getDatabase().prepare(`INSERT OR IGNORE INTO key_action_reference_attachment_links
    (attachmentId,processInstanceId,workPlanId,createdAt) VALUES(?,?,?,?)`);
  const activate = getDatabase().prepare(`UPDATE key_action_reference_attachments
    SET status='active',expiresAt=NULL,updatedAt=? WHERE id=? AND ownerUserId=? AND ownerSessionId=? AND status IN ('staged','active')`);
  for (const attachment of attachments) {
    const result = activate.run(createdAt, attachment.id, ownerUserId, ownerSessionId);
    if (result.changes !== 1) throw attachmentError("参考图关联状态已变化，请重新预览。", 409, "key_action_reference_image_state_changed");
    insert.run(attachment.id, processInstanceId, workPlanId, createdAt);
  }
  return attachments.map((attachment) => ({ ...attachment, status: "active", expiresAt: null }));
}

export function discardOwnedKeyActionReferenceImages(attachmentIds, {
  ownerUserId,
  ownerSessionId,
  referenceImagesDirectory,
  now = new Date(),
} = {}) {
  const ids = normalizeAttachmentIds(attachmentIds);
  const userId = cleanText(ownerUserId, "附件所有人", { required: true, maximum: 120 });
  const sessionId = cleanText(ownerSessionId, "助手设备会话", { required: true, maximum: 120 });
  const discarded = [];
  const retained = [];
  for (const id of ids) {
    const row = readAttachment(id);
    if (!row) continue;
    if (row.ownerUserId !== userId || row.ownerSessionId !== sessionId) {
      throw attachmentError("不能清理其他账号或设备上传的参考图。", 403, "key_action_reference_image_forbidden");
    }
    const linked = getDatabase().prepare("SELECT 1 FROM key_action_reference_attachment_links WHERE attachmentId=? LIMIT 1").get(id);
    if (linked || row.status === "active") {
      retained.push(id);
      continue;
    }
    if (row.status === "staged") {
      safeRemove(path.join(referenceImagesDirectory, row.storedName), referenceImagesDirectory);
      const removedAt = now.toISOString();
      getDatabase().prepare(`UPDATE key_action_reference_attachments SET status='discarded',removedAt=?,updatedAt=?
        WHERE id=? AND status='staged'`).run(removedAt, removedAt, id);
      discarded.push(id);
    }
  }
  return { discarded, retained };
}

export function getKeyActionReferenceAttachmentByStoredName(storedName) {
  const normalized = cleanText(storedName, "参考图文件名", { required: true, maximum: 180 });
  return getDatabase().prepare("SELECT * FROM key_action_reference_attachments WHERE storedName=? LIMIT 1").get(normalized) ?? null;
}

export function listKeyActionReferenceAttachmentLinks(attachmentId) {
  return getDatabase().prepare(`SELECT attachmentId,processInstanceId,workPlanId,createdAt
    FROM key_action_reference_attachment_links WHERE attachmentId=? ORDER BY createdAt,processInstanceId`).all(attachmentId);
}
