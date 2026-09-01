import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  UploadQuotaExceededError,
  beginUploadAttempt,
  finalizeUploadAttempt,
  getShanghaiDayWindow,
  getUserUploadQuota,
  recordRejectedUploadAttempt,
  validateUploadContent,
  validateUploadMetadata,
} from "../server/uploadGovernanceService.js";

function createAuditDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE upload_audits (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      requestPath TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      fileCount INTEGER NOT NULL,
      originalNamesJson TEXT NOT NULL,
      mimeTypesJson TEXT NOT NULL,
      byteSize INTEGER NOT NULL,
      reservedBytes INTEGER NOT NULL,
      quotaLimitBytes INTEGER NOT NULL,
      responseStatus INTEGER,
      reasonCode TEXT,
      reasonMessage TEXT,
      ipAddress TEXT,
      userAgent TEXT,
      createdAt TEXT NOT NULL,
      completedAt TEXT
    );
  `);
  return database;
}

test("生产数据库结构可增量创建上传审计表", () => {
  const database = new Database(":memory:");
  const schema = fs.readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8");
  database.exec(schema);
  const columns = database.prepare("PRAGMA table_info(upload_audits)").all().map((column) => column.name);
  assert.deepEqual(columns, [
    "id", "userId", "requestPath", "method", "status", "fileCount", "originalNamesJson", "mimeTypesJson",
    "byteSize", "reservedBytes", "quotaLimitBytes", "responseStatus", "reasonCode", "reasonMessage",
    "ipAddress", "userAgent", "createdAt", "completedAt",
  ]);
  database.close();
});

test("上传类型同时校验扩展名、MIME 和文件签名", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const validFile = { originalname: "evidence.png", mimetype: "image/png" };
  assert.equal(validateUploadMetadata(validFile, "image").valid, true);
  assert.equal(validateUploadContent(validFile, png, "image").valid, true);

  assert.equal(validateUploadMetadata({ originalname: "evidence.jpg", mimetype: "image/png" }, "image").valid, false);
  assert.equal(validateUploadContent(validFile, Buffer.from("not a png"), "image").valid, false);
  assert.equal(validateUploadMetadata({ originalname: "script.exe", mimetype: "text/plain" }, "file").valid, false);
});

test("XMind 作为普通附件通过扩展名、MIME 和 ZIP 签名校验", () => {
  const xmindZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  for (const mimetype of [
    "application/x-xmind",
    "application/vnd.xmind.workbook",
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ]) {
    const file = { originalname: "经营复盘.xmind", mimetype };
    assert.equal(validateUploadContent(file, xmindZip, "spreadsheet").valid, true);
    assert.equal(validateUploadContent(file, xmindZip, "file").valid, true);
  }

  assert.equal(validateUploadMetadata({ originalname: "经营复盘.xmind", mimetype: "text/plain" }, "spreadsheet").valid, false);
  assert.equal(validateUploadContent({ originalname: "经营复盘.xmind", mimetype: "application/x-xmind" }, Buffer.from("not zip"), "spreadsheet").valid, false);
});

test("标准工作附件原有格式保持可用", () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const legacyExcel = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(validateUploadContent({ originalname: "计划.xlsx", mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, zip, "spreadsheet").valid, true);
  assert.equal(validateUploadContent({ originalname: "计划.xls", mimetype: "application/vnd.ms-excel" }, legacyExcel, "spreadsheet").valid, true);
  assert.equal(validateUploadContent({ originalname: "计划.csv", mimetype: "text/csv" }, Buffer.from("name,value\nA,1"), "spreadsheet").valid, true);
});

test("用户每日配额会预留并按实际成功字节结算", () => {
  const database = createAuditDatabase();
  const now = new Date("2026-08-20T04:00:00.000Z");
  const first = beginUploadAttempt(database, {
    userId: "person-1",
    requestPath: "/api/uploads/file",
    method: "POST",
    contentLength: 700,
    quotaLimitBytes: 1000,
    now,
  });
  assert.equal(getUserUploadQuota(database, "person-1", { now, quotaLimitBytes: 1000 }).remainingBytes, 300);

  assert.throws(() => beginUploadAttempt(database, {
    userId: "person-1",
    requestPath: "/api/uploads/file",
    method: "POST",
    contentLength: 301,
    quotaLimitBytes: 1000,
    now,
  }), UploadQuotaExceededError);

  finalizeUploadAttempt(database, {
    id: first.id,
    files: [{ originalname: "report.pdf", mimetype: "application/pdf", size: 400 }],
    responseStatus: 200,
    now,
  });
  const quota = getUserUploadQuota(database, "person-1", { now, quotaLimitBytes: 1000 });
  assert.equal(quota.usedBytes, 400);
  assert.equal(quota.remainingBytes, 600);
});

test("失败上传留有审计记录但不占用成功配额", () => {
  const database = createAuditDatabase();
  const now = new Date("2026-08-20T04:00:00.000Z");
  const attempt = beginUploadAttempt(database, {
    userId: "person-1",
    requestPath: "/api/uploads/image",
    method: "POST",
    contentLength: 500,
    quotaLimitBytes: 1000,
    now,
  });
  finalizeUploadAttempt(database, {
    id: attempt.id,
    files: [],
    responseStatus: 400,
    reasonCode: "UPLOAD_CONTENT_MISMATCH",
    now,
  });
  recordRejectedUploadAttempt(database, {
    userId: "person-1",
    requestPath: "/api/uploads/file",
    method: "POST",
    responseStatus: 411,
    reasonCode: "UPLOAD_LENGTH_REQUIRED",
    quotaLimitBytes: 1000,
    now,
  });

  assert.equal(getUserUploadQuota(database, "person-1", { now, quotaLimitBytes: 1000 }).usedBytes, 0);
  assert.deepEqual(database.prepare("SELECT status, reasonCode FROM upload_audits ORDER BY createdAt, rowid").all(), [
    { status: "rejected", reasonCode: "UPLOAD_CONTENT_MISMATCH" },
    { status: "rejected", reasonCode: "UPLOAD_LENGTH_REQUIRED" },
  ]);
});

test("每日配额按上海自然日重置", () => {
  assert.deepEqual(getShanghaiDayWindow(new Date("2026-08-20T15:59:59.000Z")), {
    start: "2026-08-19T16:00:00.000Z",
    end: "2026-08-20T16:00:00.000Z",
  });
  assert.deepEqual(getShanghaiDayWindow(new Date("2026-08-20T16:00:00.000Z")), {
    start: "2026-08-20T16:00:00.000Z",
    end: "2026-08-21T16:00:00.000Z",
  });
});

test("上传读取路径使用独立资产凭证，通用上传入口使用独立权限", () => {
  const serverSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(serverSource, /app\.use\(cors\(resolveCorsOptions\)\)/);
  assert.doesNotMatch(serverSource, /app\.use\(cors\(\)\)/);
  assert.match(serverSource, /app\.use\("\/uploads", requireAssetAccess, express\.static\(uploadsDir,/);
  assert.match(serverSource, /verifyAssetToken\(request\.query\?\.access_token\)/);
  assert.match(serverSource, /response\.setHeader\("Referrer-Policy", "no-referrer"\)/);
  assert.match(serverSource, /response\.setHeader\("X-Content-Type-Options", "nosniff"\)/);
  assert.doesNotMatch(serverSource, /app\.use\("\/uploads", express\.static\(uploadsDir\)\)/);
  assert.equal([...serverSource.matchAll(/callback\(null, uploadStagingDir\)/g)].length, 3);
  assert.match(serverSource, /promoteValidatedUpload\(request, response, imageUploadsDir\)/);
  assert.match(serverSource, /app\.post\("\/api\/uploads\/image", requirePermission\("uploads\.image"\)/);
  assert.match(serverSource, /app\.post\("\/api\/uploads\/file", requirePermission\("uploads\.file"\)/);
  assert.match(serverSource, /app\.post\("\/api\/uploads\/standard-work-attachment", requirePermission\("uploads\.standardWorkAttachment"\)/);
  assert.match(serverSource, /\/uploads\/standard-work-attachments\/\$\{request\.file\.filename\}/);
});
