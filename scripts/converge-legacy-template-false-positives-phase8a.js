import crypto from "node:crypto";
import Database from "better-sqlite3";

const databasePath = process.argv[2] || "/private/tmp/v2-development-workstation.db";
const batchId = "connection-import-cfe04f55-ff48-4cd0-b922-3676f5c7641a";
const db = new Database(databasePath, { fileMustExist: true });
const protectedTables = [
  "sales_links",
  "sales_link_skus",
  "sales_link_sku_erp_mappings",
  "connection_sku_sales_facts",
  "connection_sku_sales_daily_facts",
  "products",
  "erp_skus",
];

function fingerprint(table) {
  const primaryKeys = db.prepare(`PRAGMA table_info(${table})`).all()
    .filter((column) => column.pk)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => `"${column.name}"`);
  const orderBy = primaryKeys.length ? ` ORDER BY ${primaryKeys.join(",")}` : " ORDER BY rowid";
  const rows = db.prepare(`SELECT * FROM ${table}${orderBy}`).all();
  return {
    count: rows.length,
    sha256: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

function protectedSnapshot() {
  return Object.fromEntries(protectedTables.map((table) => [table, fingerprint(table)]));
}

function statusSummary() {
  return Object.fromEntries(db.prepare(`
    SELECT status,COUNT(*) count
    FROM connection_import_rows
    WHERE batchId=?
    GROUP BY status
    ORDER BY status
  `).all(batchId).map((row) => [row.status, Number(row.count || 0)]));
}

try {
  const batch = db.prepare(`
    SELECT id,fileName,importType,fileHash
    FROM connection_import_batches
    WHERE id=?
  `).get(batchId);
  if (!batch || batch.importType !== "platform_links") throw new Error("指定的旧平台链接导入批次不存在。");

  const before = protectedSnapshot();
  const beforeStatus = statusSummary();
  const exceptionTotalBefore = db.prepare("SELECT COUNT(*) count FROM connection_import_rows WHERE batchId=?").get(batchId).count;
  const candidates = db.prepare(`
    SELECT id
    FROM connection_import_rows
    WHERE batchId=? AND status='error' AND errorType='missing_field'
    ORDER BY rowNumber
  `).all(batchId);
  const timestamp = new Date().toISOString();
  const resolutionNote = "历史导入模板错误解析，不属于链接业务异常";
  const update = db.prepare(`
    UPDATE connection_import_rows
    SET status='ignored',resolutionType='source_corrected',resolutionNote=?,
        resolvedReason=?,resolvedAt=?
    WHERE id=? AND status='error' AND errorType='missing_field'
  `);
  const changed = db.transaction(() => {
    let count = 0;
    for (const row of candidates) count += update.run(resolutionNote, resolutionNote, timestamp, row.id).changes;
    return count;
  }).immediate();

  const after = protectedSnapshot();
  const changedProtectedTables = protectedTables.filter((table) =>
    before[table].count !== after[table].count || before[table].sha256 !== after[table].sha256);
  const exceptionTotalAfter = db.prepare("SELECT COUNT(*) count FROM connection_import_rows WHERE batchId=?").get(batchId).count;
  const remaining = db.prepare(`
    SELECT COUNT(*) count
    FROM connection_import_rows
    WHERE batchId=? AND status='error' AND errorType='missing_field'
  `).get(batchId).count;
  const integrityCheck = db.pragma("integrity_check", { simple: true });
  const foreignKeyIssues = db.pragma("foreign_key_check").length;

  if (changedProtectedTables.length) throw new Error(`受保护业务表发生变化：${changedProtectedTables.join("、")}`);
  if (exceptionTotalBefore !== exceptionTotalAfter) throw new Error("历史异常记录数量发生变化。");
  if (integrityCheck !== "ok" || foreignKeyIssues) throw new Error("数据库完整性检查失败。");

  console.log(JSON.stringify({
    databasePath,
    batch,
    candidates: candidates.length,
    changed,
    remaining,
    statusBefore: beforeStatus,
    statusAfter: statusSummary(),
    recordsDeleted: exceptionTotalBefore - exceptionTotalAfter,
    resolutionType: "source_corrected",
    resolutionNote,
    protectedTables: after,
    changedProtectedTables,
    integrityCheck,
    foreignKeyIssues,
  }, null, 2));
} finally {
  db.close();
}
