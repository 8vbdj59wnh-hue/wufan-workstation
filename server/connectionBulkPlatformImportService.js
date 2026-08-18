import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import {
  confirmConnectionDataImport,
  PLATFORM_LINK_OPERATION_PARSER_VERSION,
  previewConnectionDataImport,
} from "./connectionDataFoundationService.js";
import { normalizeUploadedFileName } from "./uploadFileName.js";

const text = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const json = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };

let queueScheduled = false;
let queueRunning = false;

function childRow(row) {
  if (!row) return null;
  return { ...row, fileName: normalizeUploadedFileName(row.fileName), summary: json(row.summaryJson, {}), contentBlob: undefined };
}

function refreshBatch(database, batchId) {
  const counts = database.prepare(`SELECT COUNT(*) fileCount,
    SUM(CASE WHEN status IN ('preview_ready','already_imported','blocked','failed','completed','completed_with_errors') THEN 1 ELSE 0 END) processedCount,
    SUM(CASE WHEN status IN ('blocked','failed') THEN 1 ELSE 0 END) failedCount,
    SUM(CASE WHEN status IN ('completed','completed_with_errors','already_imported') THEN 1 ELSE 0 END) completedCount,
    SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) runningCount,
    SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) waitingCount,
    SUM(CASE WHEN status='preview_ready' THEN 1 ELSE 0 END) readyCount
    FROM connection_bulk_platform_import_files WHERE bulkBatchId=?`).get(batchId);
  const waiting = Number(counts.waitingCount || 0); const running = Number(counts.runningCount || 0);
  const ready = Number(counts.readyCount || 0); const failed = Number(counts.failedCount || 0);
  let status = "running";
  if (waiting) status = running ? "running" : "waiting";
  else if (!running) status = ready ? (failed ? "preview_ready_with_errors" : "preview_ready")
    : Number(counts.completedCount || 0) ? (failed ? "completed_with_errors" : "completed") : "failed";
  database.prepare(`UPDATE connection_bulk_platform_import_batches SET status=?,processedCount=?,failedCount=?,completedCount=?,updatedAt=?,completedAt=CASE WHEN ? IN ('completed','completed_with_errors','failed') THEN COALESCE(completedAt,?) ELSE completedAt END WHERE id=?`)
    .run(status, Number(counts.processedCount || 0), failed, Number(counts.completedCount || 0), now(), status, now(), batchId);
}

function batchResult(database, batchId) {
  const batch = database.prepare("SELECT * FROM connection_bulk_platform_import_batches WHERE id=?").get(text(batchId));
  if (!batch) throw new Error("批量导入批次不存在。");
  const files = database.prepare("SELECT * FROM connection_bulk_platform_import_files WHERE bulkBatchId=? ORDER BY sequenceNo,id").all(batch.id).map(childRow);
  const summary = files.reduce((result, file) => {
    const item = file.summary || {};
    result.rawRows += Number(item.rawRows || 0); result.filteredRows += Number(item.filteredRows || 0);
    result.newLinks += Number(item.newLinks || 0); result.updatedLinks += Number(item.updatedLinks || 0);
    result.operationFacts += Number(item.operationFacts || 0); result.errors += Number(item.errors || 0);
    return result;
  }, { rawRows: 0, filteredRows: 0, newLinks: 0, updatedLinks: 0, operationFacts: 0, errors: 0 });
  return { batch, files, summary };
}

export function createConnectionBulkPlatformImport({ files = [], createdBy = "" } = {}) {
  const normalized = files.filter((file) => Buffer.isBuffer(file?.buffer) && file.buffer.length).map((file, index) => ({
    fileName: text(normalizeUploadedFileName(file.originalname || file.fileName)) || `平台链接数据-${index + 1}.xlsx`, buffer: file.buffer, fileHash: hash(file.buffer), sequenceNo: index + 1,
  }));
  if (!normalized.length) throw new Error("请选择至少一个平台链接Excel文件。");
  if (normalized.length > 20) throw new Error("一次最多上传20个Excel文件。");
  const batchHash = crypto.createHash("sha256")
    .update(PLATFORM_LINK_OPERATION_PARSER_VERSION)
    .update("\0")
    .update(normalized.map((file) => file.fileHash).sort().join("|"))
    .digest("hex");
  const database = getDatabase();
  const existing = database.prepare("SELECT id FROM connection_bulk_platform_import_batches WHERE batchHash=? ORDER BY createdAt DESC LIMIT 1").get(batchHash);
  if (existing) return { ...batchResult(database, existing.id), idempotent: true };
  const batchId = id("connection-bulk-platform"); const createdAt = now(); const seen = new Set();
  database.transaction(() => {
    database.prepare(`INSERT INTO connection_bulk_platform_import_batches (id,batchHash,status,fileCount,processedCount,completedCount,failedCount,createdBy,createdAt,updatedAt) VALUES (?,?, 'waiting',?,0,0,0,?,?,?)`)
      .run(batchId, batchHash, normalized.length, text(createdBy) || null, createdAt, createdAt);
    const insert = database.prepare(`INSERT INTO connection_bulk_platform_import_files (id,bulkBatchId,sequenceNo,fileName,fileHash,contentBlob,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,'waiting',?,?)`);
    for (const file of normalized) {
      const duplicate = seen.has(file.fileHash); seen.add(file.fileHash);
      insert.run(id("connection-bulk-file"), batchId, file.sequenceNo, file.fileName, file.fileHash, file.buffer, createdAt, createdAt);
      if (duplicate) database.prepare("UPDATE connection_bulk_platform_import_files SET status='failed',errorMessage='同一批次包含重复文件。',completedAt=?,updatedAt=? WHERE bulkBatchId=? AND sequenceNo=?").run(createdAt, createdAt, batchId, file.sequenceNo);
    }
  })();
  refreshBatch(database, batchId); scheduleConnectionBulkPlatformImportQueue();
  return { ...batchResult(database, batchId), idempotent: false };
}

function processOne() {
  const database = getDatabase();
  const file = database.prepare("SELECT * FROM connection_bulk_platform_import_files WHERE status='waiting' ORDER BY createdAt,sequenceNo,id LIMIT 1").get();
  if (!file) return false;
  database.prepare("UPDATE connection_bulk_platform_import_files SET status='running',startedAt=?,updatedAt=? WHERE id=? AND status='waiting'").run(now(), now(), file.id);
  try {
    const preview = previewConnectionDataImport({ buffer: Buffer.from(file.contentBlob), fileName: file.fileName, importType: "platform_link_operations", userId: database.prepare("SELECT createdBy FROM connection_bulk_platform_import_batches WHERE id=?").get(file.bulkBatchId)?.createdBy || "" });
    const completed = ["completed", "completed_with_errors"].includes(preview.batch?.status);
    const status = preview.blocked ? "blocked" : completed ? "already_imported" : "preview_ready";
    database.prepare(`UPDATE connection_bulk_platform_import_files SET status=?,foundationBatchId=?,platform=?,shopId=?,shop=?,summaryJson=?,idempotent=?,contentBlob=NULL,errorMessage=NULL,completedAt=?,updatedAt=? WHERE id=?`)
      .run(status, preview.batch?.id || null, text(preview.preview?.platform), text(preview.preview?.shopId), text(preview.preview?.shop), JSON.stringify(preview.preview || {}), preview.idempotent ? 1 : 0, now(), now(), file.id);
  } catch (error) {
    database.prepare("UPDATE connection_bulk_platform_import_files SET status='failed',contentBlob=NULL,errorMessage=?,completedAt=?,updatedAt=? WHERE id=?").run(text(error.message) || "文件解析失败。", now(), now(), file.id);
  }
  refreshBatch(database, file.bulkBatchId);
  return true;
}

export function drainConnectionBulkPlatformImportQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try { while (processOne()) {} } finally { queueRunning = false; }
}

export function scheduleConnectionBulkPlatformImportQueue() {
  if (process.env.WUFAN_BULK_QUEUE_MANUAL === "1") return;
  if (queueScheduled || queueRunning) return;
  queueScheduled = true;
  setImmediate(() => {
    queueScheduled = false;
    let processed = false;
    queueRunning = true;
    try { processed = processOne(); }
    catch (error) { console.error("平台链接批量导入队列执行失败", error); }
    finally { queueRunning = false; }
    if (processed) scheduleConnectionBulkPlatformImportQueue();
  });
}

export function resumeConnectionBulkPlatformImports() {
  const database = getDatabase();
  database.prepare("UPDATE connection_bulk_platform_import_files SET status='waiting',updatedAt=? WHERE status='running'").run(now());
  for (const row of database.prepare("SELECT DISTINCT bulkBatchId FROM connection_bulk_platform_import_files WHERE status='waiting'").all()) refreshBatch(database, row.bulkBatchId);
  scheduleConnectionBulkPlatformImportQueue();
}

export function readConnectionBulkPlatformImport(batchId) { return batchResult(getDatabase(), batchId); }

export function listConnectionBulkPlatformImports(limit = 20) {
  return getDatabase().prepare("SELECT * FROM connection_bulk_platform_import_batches ORDER BY createdAt DESC,id DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 20)));
}

export function confirmConnectionBulkPlatformImport(batchId) {
  const database = getDatabase(); const current = batchResult(database, batchId);
  if (["waiting", "running"].includes(current.batch.status)) throw new Error("批量预览尚未完成，请稍后再确认。");
  if (["completed", "completed_with_errors"].includes(current.batch.status)) return { ...current, idempotent: true };
  let createdLinks = 0; let updatedLinks = 0; let factsCreated = 0;
  for (const file of current.files) {
    if (file.status === "already_imported") {
      database.prepare("UPDATE connection_bulk_platform_import_files SET status='completed',updatedAt=? WHERE id=?").run(now(), file.id); continue;
    }
    if (file.status !== "preview_ready" || !file.foundationBatchId) continue;
    try {
      const result = confirmConnectionDataImport(file.foundationBatchId);
      createdLinks += Number(result.result?.createdLinks || 0); updatedLinks += Number(result.result?.updatedLinks || 0); factsCreated += Number(result.result?.factsCreated || 0);
      database.prepare("UPDATE connection_bulk_platform_import_files SET status=?,updatedAt=? WHERE id=?").run(result.batch?.status === "completed_with_errors" ? "completed_with_errors" : "completed", now(), file.id);
    } catch (error) {
      database.prepare("UPDATE connection_bulk_platform_import_files SET status='failed',errorMessage=?,updatedAt=? WHERE id=?").run(text(error.message) || "确认导入失败。", now(), file.id);
    }
  }
  refreshBatch(database, current.batch.id);
  return { ...batchResult(database, current.batch.id), result: { createdLinks, updatedLinks, factsCreated }, idempotent: false };
}
