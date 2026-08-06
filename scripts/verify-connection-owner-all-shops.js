import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";

const databasePath = path.join(os.tmpdir(), `wufan-owner-all-shops-${process.pid}-${Date.now()}.db`);
process.env.WUFAN_DB_PATH = databasePath;
const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { previewConnectionOwnerImport, confirmConnectionOwnerImport, getCurrentConnectionOwnerImport } = await import("../server/connectionOwnerImportService.js");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  initializeDatabase({ reset: true });
  const db = getDatabase(); const stamp = new Date().toISOString();
  const people = db.prepare("SELECT id FROM persons WHERE status='active' ORDER BY id LIMIT 2").all();
  assert(people.length === 2, "隔离库缺少测试人员。");
  db.prepare("UPDATE persons SET name='陈启甜' WHERE id=?").run(people[0].id);
  db.prepare("UPDATE persons SET name='张小薇' WHERE id=?").run(people[1].id);
  const shops = [
    ["owner-shop-tmall-a", "天猫", "点意旗舰店"],
    ["owner-shop-tmall-b", "天猫", "半然旗舰店"],
    ["owner-shop-taobao", "淘宝", "Banran半然"],
  ];
  for (const [shopId, platform, name] of shops) db.prepare(`INSERT INTO sales_shops
    (id,platform,shopName,normalizedShopName,displayName,status,createdAt,updatedAt) VALUES (?,?,?,?,?,'active',?,?)`).run(shopId, platform, name, name, name, stamp, stamp);
  const links = [
    ["owner-link-1", "owner-shop-tmall-a", "100", "点意商品"],
    ["owner-link-2", "owner-shop-taobao", "200", "淘宝商品"],
    ["owner-link-3", "owner-shop-tmall-b", "100", "半然商品"],
    ["owner-link-4", "owner-shop-taobao", "300", "淘宝第二商品"],
  ];
  for (const [linkId, shopId, goodsId, title] of links) {
    db.prepare(`INSERT INTO sales_links (id,shopId,platformGoodsId,title,identityStrength,currentState,createdAt,updatedAt)
      VALUES (?,?,?,?,'goods_id','active',?,?)`).run(linkId, shopId, goodsId, title, stamp, stamp);
    db.prepare(`INSERT INTO connection_profiles (id,salesLinkId,name,status,level,originSource,createdAt,updatedAt)
      VALUES (?,?,?,'active','new','test',?,?)`).run(`owner-profile-${linkId}`, linkId, title, stamp, stamp);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { 平台: "天猫", 店铺: "点意旗舰店", 商品ID: "100", 负责人: "陈启甜" },
    { 平台: "淘宝", 店铺: "Banran半然", 商品ID: "200", 负责人: "陈启甜" },
    { 平台: "天猫", 店铺: "半然旗舰店", 商品ID: "100", 负责人: "张小薇" },
    { 平台: "淘宝", 店铺: "Banran半然", 商品ID: "300", 负责人: "张小薇" },
    { 平台: "淘宝", 店铺: "Banran半然", 商品ID: "300", 负责人: "张小薇" },
    { 平台: "京东", 店铺: "不存在店铺", 商品ID: "900", 负责人: "陈启甜" },
    { 平台: "淘宝", 店铺: "Banran半然", 商品ID: "999", 负责人: "陈启甜" },
    { 平台: "京东", 店铺: "点意旗舰店", 商品ID: "100", 负责人: "陈启甜" },
    { 平台: "淘宝", 店铺: "Banran半然", 商品ID: "888", 负责人: "" },
  ]), "负责人匹配");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const protectedBefore = db.prepare(`SELECT (SELECT COUNT(*) FROM sales_links) links,(SELECT COUNT(*) FROM sales_shops) shops,
    (SELECT COUNT(*) FROM sales_link_skus) linkSkus,(SELECT COUNT(*) FROM sales_link_sku_erp_mappings) mappings,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) salesFacts`).get();
  const preview = previewConnectionOwnerImport({ buffer, fileName: "负责人匹配.xlsx", userId: people[0].id });
  assert(preview.batch.status === "preview_ready" && preview.submission.canSubmit && !preview.blocked, "单行异常错误阻断了正常行确认。");
  assert(preview.preview.totalRows === 9 && preview.preview.ownerCount === 2, "总行数或负责人数统计错误。");
  assert(preview.preview.platformCount === 3 && preview.preview.shopCount === 4, "平台或店铺统计错误。");
  assert(preview.preview.updatableLinks === 4 && preview.preview.unmatchedLinks === 1, "可更新或未匹配链接统计错误。");
  assert(preview.preview.changeRows === 4 && preview.preview.unchangedRows === 0, "负责人变更或保持不变统计错误。");
  assert(preview.preview.ownerChangeGroups.length === 2 && preview.preview.ownerChangeGroups.reduce((sum, group) => sum + group.linkCount, 0) === 4, "负责人变更分组错误。");
  assert(preview.preview.shopConflictRows === 2 && preview.preview.duplicateRelations === 1, "店铺冲突或重复关系统计错误。");
  const restored = getCurrentConnectionOwnerImport(people[0].id);
  assert(restored?.batch.id === preview.batch.id && restored.submission.canSubmit, "刷新后未恢复当前待确认预览。");
  let denied = false;
  try { confirmConnectionOwnerImport(preview.batch.id, people[1].id); } catch (error) { denied = error.message.includes("无权"); }
  assert(denied, "其他用户可以提交非本人预览。");
  const committed = confirmConnectionOwnerImport(preview.batch.id, people[0].id);
  assert(committed.result.updated === 4 && committed.result.unchanged === 0, "跨店铺负责人更新数量错误。");
  assert(committed.batch.status === "partial", "存在隔离异常时批次未标记为partial。");
  const assignments = db.prepare(`SELECT sl.id,cp.ownerId FROM sales_links sl JOIN connection_profiles cp ON cp.salesLinkId=sl.id
    WHERE sl.id LIKE 'owner-link-%' ORDER BY sl.id`).all();
  assert(assignments[0].ownerId === people[0].id && assignments[1].ownerId === people[0].id, "陈启甜未覆盖多个店铺。");
  assert(assignments[2].ownerId === people[1].id && assignments[3].ownerId === people[1].id, "张小薇未覆盖多个店铺。");
  const repeated = previewConnectionOwnerImport({ buffer, fileName: "负责人匹配.xlsx", userId: people[0].id });
  assert(repeated.idempotent && repeated.batch.id === preview.batch.id && repeated.batch.status === "partial", "重复导入未返回原批次。");
  const repeatedCommit = confirmConnectionOwnerImport(preview.batch.id, people[0].id);
  assert(repeatedCommit.idempotent && repeatedCommit.result.updated === 4, "重复点击未幂等返回原提交结果。");
  const protectedAfter = db.prepare(`SELECT (SELECT COUNT(*) FROM sales_links) links,(SELECT COUNT(*) FROM sales_shops) shops,
    (SELECT COUNT(*) FROM sales_link_skus) linkSkus,(SELECT COUNT(*) FROM sales_link_sku_erp_mappings) mappings,
    (SELECT COUNT(*) FROM connection_sku_sales_facts) salesFacts`).get();
  assert(JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), "负责人匹配修改了受保护业务数据数量。");
  assert(db.pragma("integrity_check", { simple: true }) === "ok", "SQLite完整性检查失败。");
  assert(db.pragma("foreign_key_check").length === 0, "SQLite外键检查失败。");
  console.log(JSON.stringify({ preview: preview.preview, result: committed.result, idempotent: true,
    protectedCountsUnchanged: true, integrityCheck: "ok", foreignKeyCheck: "ok" }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
}
