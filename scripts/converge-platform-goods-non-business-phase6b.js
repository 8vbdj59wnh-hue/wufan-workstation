import crypto from "node:crypto";
import Database from "better-sqlite3";

const databasePath = process.argv[2] || "/private/tmp/v2-development-workstation.db";
const db = new Database(databasePath);
const protectedTables = [
  "sales_links",
  "sales_link_skus",
  "sales_link_sku_erp_mappings",
  "connection_sku_sales_facts",
  "connection_sku_sales_daily_facts",
  "products",
  "erp_skus",
];
const normalize = (value) => String(value ?? "").trim().replace(/\s+/gu, "");
const isNonBusinessName = (value) => /^(?:无效|总计|合计|汇总)[:：]?$/u.test(normalize(value));

function tableFingerprint(table) {
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
  return Object.fromEntries(protectedTables.map((table) => [table, tableFingerprint(table)]));
}

function statusCounts() {
  return Object.fromEntries(db.prepare(`
    SELECT status,COUNT(*) count
    FROM data_sync_exceptions
    GROUP BY status
    ORDER BY status
  `).all().map((row) => [row.status, row.count]));
}

try {
  const before = protectedSnapshot();
  const beforeStatus = statusCounts();
  const exceptionTotalBefore = db.prepare("SELECT COUNT(*) count FROM data_sync_exceptions").get().count;
  const exceptionCandidates = db.prepare(`
    SELECT id,rawDataJson
    FROM data_sync_exceptions
    WHERE status='open' AND exceptionType='missing_shop'
  `).all().filter((row) => {
    try { return isNonBusinessName(JSON.parse(row.rawDataJson || "{}")["店铺"]); }
    catch { return false; }
  });
  const rowCandidates = db.prepare(`
    SELECT batchId,rowNumber,sourceShopName
    FROM platform_goods_excel_import_rows
    WHERE action='exception' AND exceptionType='missing_shop'
  `).all().filter((row) => isNonBusinessName(row.sourceShopName));

  const now = new Date().toISOString();
  const note = "平台货品非业务行，不创建店铺或链接，不属于异常治理范围";
  const updateException = db.prepare(`
    UPDATE data_sync_exceptions
    SET status='ignored',resolutionType='normal_business',resolutionNote=?,
        resolvedReason=?,resolvedAt=?,resolvedBy='system:platform-goods-non-business-governance'
    WHERE id=? AND status='open'
  `);
  const updateImportRow = db.prepare(`
    UPDATE platform_goods_excel_import_rows
    SET action='ignored',resolutionType='normal_business',resolutionNote=?,resolvedAt=?,
        message='汇总或无效行已过滤，不进入店铺匹配和异常治理。'
    WHERE batchId=? AND rowNumber=? AND action='exception'
  `);
  const changed = db.transaction(() => {
    let exceptions = 0;
    let importRows = 0;
    for (const row of exceptionCandidates) exceptions += updateException.run(note, note, now, row.id).changes;
    for (const row of rowCandidates) importRows += updateImportRow.run(note, now, row.batchId, row.rowNumber).changes;
    return { exceptions, importRows };
  }).immediate();

  const after = protectedSnapshot();
  const changedProtectedTables = protectedTables.filter((table) =>
    before[table].count !== after[table].count || before[table].sha256 !== after[table].sha256);
  const exceptionTotalAfter = db.prepare("SELECT COUNT(*) count FROM data_sync_exceptions").get().count;
  const remaining = db.prepare(`
    SELECT COUNT(*) count
    FROM data_sync_exceptions
    WHERE status='open' AND exceptionType='missing_shop'
  `).get().count;
  const integrityCheck = db.pragma("integrity_check", { simple: true });
  const foreignKeyIssues = db.pragma("foreign_key_check").length;

  if (changedProtectedTables.length) throw new Error(`受保护业务表发生变化：${changedProtectedTables.join("、")}`);
  if (exceptionTotalBefore !== exceptionTotalAfter) throw new Error("异常记录总数发生变化。");
  if (integrityCheck !== "ok" || foreignKeyIssues) throw new Error("数据库完整性检查失败。");

  console.log(JSON.stringify({
    databasePath,
    candidates: { exceptions: exceptionCandidates.length, importRows: rowCandidates.length },
    changed,
    remainingOpenMissingShop: remaining,
    exceptionStatusBefore: beforeStatus,
    exceptionStatusAfter: statusCounts(),
    exceptionRecordsDeleted: exceptionTotalBefore - exceptionTotalAfter,
    protectedTables: after,
    changedProtectedTables,
    integrityCheck,
    foreignKeyIssues,
  }, null, 2));
} finally {
  db.close();
}
