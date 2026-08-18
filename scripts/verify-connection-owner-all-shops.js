import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const databasePath = path.join(os.tmpdir(), `wufan-owner-by-link-id-${process.pid}-${Date.now()}.db`);
process.env.WUFAN_DB_PATH = databasePath;
const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { previewConnectionOwnerImport, confirmConnectionOwnerImport, getCurrentConnectionOwnerImport } = await import("../server/connectionOwnerImportService.js");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function workbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "负责人匹配");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

try {
  initializeDatabase({ reset: true });
  const db = getDatabase(); const stamp = new Date().toISOString();
  const people = db.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 2").all();
  assert(people.length === 2, "隔离库缺少测试人员。");
  db.prepare("UPDATE persons SET name='原负责人' WHERE id=?").run(people[0].id);
  db.prepare("UPDATE persons SET name='新负责人' WHERE id=?").run(people[1].id);
  const shops = [
    ["owner-shop-tmall", "天猫", "测试天猫店"],
    ["owner-shop-taobao", "淘宝", "测试淘宝店"],
  ];
  for (const [shopId, platform, name] of shops) db.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?)`).run(shopId, platform, name, name, name, stamp, stamp);
  const links = [
    ["owner-link-1", "owner-shop-tmall", "100", "首次分配一"],
    ["owner-link-2", "owner-shop-taobao", "200", "首次分配二"],
    ["owner-link-3", "owner-shop-tmall", "300", "已有负责人"],
    ["owner-link-4", "owner-shop-taobao", "400", "混合首次分配"],
    ["owner-link-5", "owner-shop-tmall", "500", "档案ID匹配"],
  ];
  for (const [linkId, shopId, goodsId, title] of links) {
    db.prepare(`INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt)
      VALUES (?,?,?,?,'goods_id','active',?,?)`).run(linkId, shopId, goodsId, title, stamp, stamp);
    db.prepare(`INSERT INTO connection_profiles (id,salesLinkId,name,ownerId,status,level,originSource,createdAt,updatedAt)
      VALUES (?,?,?,?, 'active','new','test',?,?)`).run(`owner-profile-${linkId}`, linkId, title, linkId === "owner-link-3" ? people[0].id : null, stamp, stamp);
  }
  const protectedBefore = db.prepare(`SELECT (SELECT COUNT(*) FROM sales_links) links,(SELECT COUNT(*) FROM sales_shops) shops,
    (SELECT COUNT(*) FROM sales_link_skus) linkSkus,(SELECT COUNT(*) FROM sales_link_sku_erp_mappings) mappings,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) salesFacts`).get();

  const firstBuffer = workbookBuffer([{ 链接ID: "owner-link-1" }, { 链接ID: "owner-link-2" }]);
  const firstPreview = previewConnectionOwnerImport({ buffer: firstBuffer, fileName: "首次分配.xlsx", userId: people[0].id, ownerId: people[1].id });
  assert(firstPreview.preview.firstAssignmentRows === 2 && firstPreview.preview.reassignmentRows === 0, "首次分配分类错误。");
  assert(!firstPreview.preview.requiresOverwriteConfirmation, "首次分配不应要求覆盖确认。");
  const firstCommitted = confirmConnectionOwnerImport(firstPreview.batch.id, people[0].id);
  assert(firstCommitted.result.firstAssigned === 2 && firstCommitted.result.reassigned === 0, "首次分配提交结果错误。");

  const mixedBuffer = workbookBuffer([
    { 链接ID: "owner-link-3" },
    { 链接ID: "owner-link-4" },
    { 链接ID: "owner-profile-owner-link-5" },
    { 链接ID: "owner-link-4" },
    { 链接ID: "missing-link" },
    { 链接ID: "" },
  ]);
  const preview = previewConnectionOwnerImport({ buffer: mixedBuffer, fileName: "负责人变更.xlsx", userId: people[0].id, ownerId: people[1].id });
  assert(preview.batch.status === "preview_ready" && preview.submission.canSubmit && !preview.blocked, "异常行阻断了正常行确认。");
  assert(preview.preview.totalRows === 5 && preview.preview.selectedOwnerName === "新负责人", "总行数或所选负责人错误。");
  assert(preview.preview.updatableLinks === 3 && preview.preview.firstAssignmentRows === 2 && preview.preview.reassignmentRows === 1, "首次分配与负责人变更分类错误。");
  assert(preview.preview.unmatchedLinks === 1 && preview.preview.duplicateRelations === 1, "异常链接统计错误。");
  assert(preview.preview.requiresOverwriteConfirmation, "已有负责人时未要求覆盖确认。");
  const restored = getCurrentConnectionOwnerImport(people[0].id);
  assert(restored?.batch.id === preview.batch.id && restored.submission.canSubmit, "刷新后未恢复当前待确认预览。");
  let denied = false;
  try { confirmConnectionOwnerImport(preview.batch.id, people[1].id, { confirmOverwrite: true }); } catch (error) { denied = error.message.includes("无权"); }
  assert(denied, "其他用户可以提交非本人预览。");
  let overwriteBlocked = false;
  try { confirmConnectionOwnerImport(preview.batch.id, people[0].id); } catch (error) { overwriteBlocked = error.message.includes("已有负责人"); }
  assert(overwriteBlocked, "已有负责人变更未被二次确认保护。");
  const committed = confirmConnectionOwnerImport(preview.batch.id, people[0].id, { confirmOverwrite: true });
  assert(committed.result.updated === 3 && committed.result.firstAssigned === 2 && committed.result.reassigned === 1, "负责人更新数量错误。");
  assert(committed.batch.status === "partial", "存在隔离异常时批次未标记为partial。");
  const assignments = db.prepare(`SELECT sl.id,cp.ownerId FROM sales_links sl JOIN connection_profiles cp ON cp.salesLinkId=sl.id
    WHERE sl.id LIKE 'owner-link-%' ORDER BY sl.id`).all();
  assert(assignments.every((item) => item.ownerId === people[1].id), "链接未全部匹配到所选负责人。");
  const repeated = previewConnectionOwnerImport({ buffer: mixedBuffer, fileName: "负责人变更.xlsx", userId: people[0].id, ownerId: people[1].id });
  assert(repeated.idempotent && repeated.batch.id === preview.batch.id, "同文件同负责人重复导入未返回原批次。");
  const repeatedCommit = confirmConnectionOwnerImport(preview.batch.id, people[0].id);
  assert(repeatedCommit.idempotent && repeatedCommit.result.reassigned === 1, "重复点击未幂等返回原提交结果。");
  const protectedAfter = db.prepare(`SELECT (SELECT COUNT(*) FROM sales_links) links,(SELECT COUNT(*) FROM sales_shops) shops,
    (SELECT COUNT(*) FROM sales_link_skus) linkSkus,(SELECT COUNT(*) FROM sales_link_sku_erp_mappings) mappings,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) salesFacts`).get();
  assert(JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), "负责人匹配修改了受保护业务数据数量。");
  assert(db.pragma("integrity_check", { simple: true }) === "ok", "SQLite完整性检查失败。");
  assert(db.pragma("foreign_key_check").length === 0, "SQLite外键检查失败。");
  console.log(JSON.stringify({ firstAssignment: firstCommitted.result, mixedPreview: preview.preview, result: committed.result,
    overwriteProtection: true, idempotent: true, protectedCountsUnchanged: true, integrityCheck: "ok", foreignKeyCheck: "ok" }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
}
