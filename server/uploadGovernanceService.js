import crypto from "node:crypto";
import path from "node:path";

const MEBIBYTE = 1024 * 1024;
const DEFAULT_DAILY_QUOTA_BYTES = 1024 * MEBIBYTE;
const MAX_DAILY_QUOTA_BYTES = 100 * 1024 * MEBIBYTE;

const uploadTypePolicies = {
  image: {
    extensions: {
      ".jpg": ["image/jpeg"],
      ".jpeg": ["image/jpeg"],
      ".png": ["image/png"],
      ".webp": ["image/webp"],
    },
  },
  file: {
    extensions: {
      ".jpg": ["image/jpeg"],
      ".jpeg": ["image/jpeg"],
      ".png": ["image/png"],
      ".webp": ["image/webp"],
      ".pdf": ["application/pdf"],
      ".doc": ["application/msword", "application/octet-stream"],
      ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
      ".xls": ["application/vnd.ms-excel", "application/octet-stream"],
      ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
      ".zip": ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
      ".txt": ["text/plain"],
      ".mp4": ["video/mp4"],
      ".mov": ["video/quicktime"],
      ".m4v": ["video/x-m4v", "video/mp4"],
      ".webm": ["video/webm"],
      ".psd": ["image/vnd.adobe.photoshop", "application/octet-stream"],
      ".psb": ["image/vnd.adobe.photoshop", "application/octet-stream"],
      ".ai": ["application/illustrator", "application/postscript", "application/pdf", "application/octet-stream"],
      ".fig": ["application/zip", "application/octet-stream"],
    },
  },
  spreadsheet: {
    extensions: {
      ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
      ".xls": ["application/vnd.ms-excel", "application/octet-stream"],
      ".csv": ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"],
    },
  },
};

function startsWith(buffer, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function isZip(buffer) {
  return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]);
}

function isText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0x00);
}

function matchesFileSignature(extension, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if ([".jpg", ".jpeg"].includes(extension)) return startsWith(buffer, [0xff, 0xd8, 0xff]);
  if (extension === ".png") return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (extension === ".pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if ([".doc", ".xls"].includes(extension)) return startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if ([".docx", ".xlsx", ".zip"].includes(extension)) return isZip(buffer);
  if ([".txt", ".csv"].includes(extension)) return isText(buffer);
  if ([".mp4", ".mov", ".m4v"].includes(extension)) return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  if (extension === ".webm") return startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  if ([".psd", ".psb"].includes(extension)) return buffer.subarray(0, 4).toString("ascii") === "8BPS";
  if (extension === ".ai") {
    const prefix = buffer.subarray(0, 16).toString("ascii");
    return prefix.startsWith("%PDF-") || prefix.startsWith("%!PS-Adobe");
  }
  if (extension === ".fig") return isZip(buffer) || buffer.subarray(0, 8).toString("ascii") === "fig-kiwi";
  return false;
}

export function getUploadDailyQuotaBytes(rawValue = process.env.UPLOAD_DAILY_QUOTA_MB) {
  if (rawValue === undefined || String(rawValue).trim() === "") return DEFAULT_DAILY_QUOTA_BYTES;
  const parsedMegabytes = Number(rawValue);
  if (!Number.isFinite(parsedMegabytes) || parsedMegabytes <= 0) return DEFAULT_DAILY_QUOTA_BYTES;
  return Math.min(Math.floor(parsedMegabytes * MEBIBYTE), MAX_DAILY_QUOTA_BYTES);
}

export function validateUploadMetadata(file, policyKey) {
  const policy = uploadTypePolicies[policyKey];
  if (policy === undefined) return { valid: false, reason: "未知上传策略。" };
  const extension = path.extname(String(file?.originalname ?? "")).toLowerCase();
  const mimeType = String(file?.mimetype ?? "").toLowerCase();
  const allowedMimeTypes = policy.extensions[extension];
  if (allowedMimeTypes === undefined || !allowedMimeTypes.includes(mimeType)) {
    return { valid: false, reason: "文件扩展名与文件类型不匹配。" };
  }
  return { valid: true, extension };
}

export function validateUploadContent(file, buffer, policyKey) {
  const metadataResult = validateUploadMetadata(file, policyKey);
  if (!metadataResult.valid) return metadataResult;
  if (!matchesFileSignature(metadataResult.extension, buffer)) {
    return { valid: false, reason: "文件内容与声明的文件类型不匹配。" };
  }
  return metadataResult;
}

export function getShanghaiDayWindow(now = new Date()) {
  const shanghaiTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const startUtc = Date.UTC(
    shanghaiTime.getUTCFullYear(),
    shanghaiTime.getUTCMonth(),
    shanghaiTime.getUTCDate(),
  ) - 8 * 60 * 60 * 1000;
  return {
    start: new Date(startUtc).toISOString(),
    end: new Date(startUtc + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export class UploadQuotaExceededError extends Error {
  constructor(snapshot) {
    super("今日上传配额已用尽，请明日再试或联系管理员。");
    this.name = "UploadQuotaExceededError";
    this.code = "UPLOAD_QUOTA_EXCEEDED";
    this.snapshot = snapshot;
  }
}

export function getUserUploadQuota(database, userId, { now = new Date(), quotaLimitBytes = getUploadDailyQuotaBytes() } = {}) {
  const window = getShanghaiDayWindow(now);
  const row = database.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN reservedBytes ELSE byteSize END), 0) AS usedBytes
     FROM upload_audits
     WHERE userId = @userId
       AND status IN ('pending', 'success')
       AND createdAt >= @start
       AND createdAt < @end`,
  ).get({ userId, ...window });
  const usedBytes = Number(row?.usedBytes ?? 0);
  return {
    usedBytes,
    quotaLimitBytes,
    remainingBytes: Math.max(0, quotaLimitBytes - usedBytes),
    resetsAt: window.end,
  };
}

export function beginUploadAttempt(database, input) {
  const now = input.now instanceof Date ? input.now : new Date();
  const createdAt = now.toISOString();
  const reservedBytes = Number(input.contentLength);
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes <= 0) {
    const error = new Error("上传请求必须提供有效的 Content-Length。");
    error.code = "UPLOAD_LENGTH_REQUIRED";
    throw error;
  }
  const quotaLimitBytes = input.quotaLimitBytes ?? getUploadDailyQuotaBytes();
  const transaction = database.transaction(() => {
    const snapshot = getUserUploadQuota(database, input.userId, { now, quotaLimitBytes });
    if (reservedBytes > snapshot.remainingBytes) throw new UploadQuotaExceededError(snapshot);
    const id = crypto.randomUUID();
    database.prepare(
      `INSERT INTO upload_audits (
         id, userId, requestPath, method, status, fileCount, originalNamesJson, mimeTypesJson,
         byteSize, reservedBytes, quotaLimitBytes, responseStatus, reasonCode, reasonMessage,
         ipAddress, userAgent, createdAt, completedAt
       ) VALUES (
         @id, @userId, @requestPath, @method, 'pending', 0, '[]', '[]',
         0, @reservedBytes, @quotaLimitBytes, NULL, NULL, NULL,
         @ipAddress, @userAgent, @createdAt, NULL
       )`,
    ).run({
      id,
      userId: input.userId,
      requestPath: String(input.requestPath ?? "").slice(0, 500),
      method: String(input.method ?? "POST").slice(0, 16),
      reservedBytes,
      quotaLimitBytes,
      ipAddress: String(input.ipAddress ?? "").slice(0, 128),
      userAgent: String(input.userAgent ?? "").slice(0, 500),
      createdAt,
    });
    return { id, quota: { ...snapshot, remainingBytes: snapshot.remainingBytes - reservedBytes } };
  });
  return transaction();
}

export function recordRejectedUploadAttempt(database, input) {
  const id = crypto.randomUUID();
  const createdAt = (input.now instanceof Date ? input.now : new Date()).toISOString();
  database.prepare(
    `INSERT INTO upload_audits (
       id, userId, requestPath, method, status, fileCount, originalNamesJson, mimeTypesJson,
       byteSize, reservedBytes, quotaLimitBytes, responseStatus, reasonCode, reasonMessage,
       ipAddress, userAgent, createdAt, completedAt
     ) VALUES (
       @id, @userId, @requestPath, @method, 'rejected', 0, '[]', '[]',
       0, 0, @quotaLimitBytes, @responseStatus, @reasonCode, @reasonMessage,
       @ipAddress, @userAgent, @createdAt, @createdAt
     )`,
  ).run({
    id,
    userId: input.userId,
    requestPath: String(input.requestPath ?? "").slice(0, 500),
    method: String(input.method ?? "POST").slice(0, 16),
    quotaLimitBytes: input.quotaLimitBytes ?? getUploadDailyQuotaBytes(),
    responseStatus: Number(input.responseStatus ?? 400),
    reasonCode: String(input.reasonCode ?? "UPLOAD_REJECTED").slice(0, 100),
    reasonMessage: String(input.reasonMessage ?? "上传请求被拒绝。").slice(0, 500),
    ipAddress: String(input.ipAddress ?? "").slice(0, 128),
    userAgent: String(input.userAgent ?? "").slice(0, 500),
    createdAt,
  });
  return id;
}

export function finalizeUploadAttempt(database, input) {
  const files = Array.isArray(input.files) ? input.files : [];
  const byteSize = files.reduce((total, file) => total + Math.max(0, Number(file?.size ?? 0)), 0);
  const responseStatus = Number(input.responseStatus ?? 500);
  const succeeded = responseStatus >= 200 && responseStatus < 400;
  const completedAt = (input.now instanceof Date ? input.now : new Date()).toISOString();
  database.prepare(
    `UPDATE upload_audits
     SET status = @status,
         fileCount = @fileCount,
         originalNamesJson = @originalNamesJson,
         mimeTypesJson = @mimeTypesJson,
         byteSize = @byteSize,
         reservedBytes = @byteSize,
         responseStatus = @responseStatus,
         reasonCode = @reasonCode,
         reasonMessage = @reasonMessage,
         completedAt = @completedAt
     WHERE id = @id AND status = 'pending'`,
  ).run({
    id: input.id,
    status: succeeded ? "success" : "rejected",
    fileCount: files.length,
    originalNamesJson: JSON.stringify(files.map((file) => String(file?.originalname ?? "").slice(0, 255))),
    mimeTypesJson: JSON.stringify(files.map((file) => String(file?.mimetype ?? "").slice(0, 150))),
    byteSize,
    responseStatus,
    reasonCode: succeeded ? null : String(input.reasonCode ?? `HTTP_${responseStatus}`).slice(0, 100),
    reasonMessage: succeeded ? null : String(input.reasonMessage ?? "上传请求未成功完成。").slice(0, 500),
    completedAt,
  });
}

export function listUploadAudits(database, { userId = "", status = "", limit = 100 } = {}) {
  const normalizedLimit = Math.floor(Math.min(200, Math.max(1, Number(limit) || 100)));
  const conditions = [];
  const params = { limit: normalizedLimit };
  if (String(userId).trim() !== "") {
    conditions.push("userId = @userId");
    params.userId = String(userId).trim();
  }
  if (["pending", "success", "rejected"].includes(status)) {
    conditions.push("status = @status");
    params.status = status;
  }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  return database.prepare(
    `SELECT id, userId, requestPath, method, status, fileCount, originalNamesJson, mimeTypesJson,
            byteSize, quotaLimitBytes, responseStatus, reasonCode, reasonMessage, ipAddress,
            createdAt, completedAt
     FROM upload_audits ${where}
     ORDER BY createdAt DESC
     LIMIT @limit`,
  ).all(params).map((row) => ({
    ...row,
    originalNames: JSON.parse(row.originalNamesJson || "[]"),
    mimeTypes: JSON.parse(row.mimeTypesJson || "[]"),
  }));
}
