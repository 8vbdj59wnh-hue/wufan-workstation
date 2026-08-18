import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveLinkSkuErpRelations } from "../server/capabilities/resolveLinkSkuErpRelation.js";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
};
const databasePath = path.resolve(valueAfter("--database") || "");
const execute = args.includes("--execute");
assert(databasePath, "必须通过 --database 指定数据库路径。");

const database = new Database(databasePath, { readonly: !execute, fileMustExist: true });
database.pragma("busy_timeout = 10000");
if (!execute) database.pragma("query_only = ON");

const timestamp = new Date().toISOString();
const protectedTables = [
  "sales_links",
  "sales_link_skus",
  "sales_link_sku_combo_groups",
  "sales_link_sku_combo_group_components",
  "sales_link_sku_product_structures",
  "sales_link_sku_product_structure_components",
  "sales_link_sku_erp_mappings",
  "connection_sku_sales_facts",
  "connection_sku_sales_daily_facts",
  "products",
  "erp_skus",
];
const oldExceptionTypes = ["bundle_sku", "combo_goods"];
const platformAliases = {
  tmall: ["tmall", "天猫"], "天猫": ["tmall", "天猫"],
  taobao: ["taobao", "淘宝"], "淘宝": ["taobao", "淘宝"],
  jd: ["jd", "京东"], "京东": ["jd", "京东"],
  xiaohongshu: ["xiaohongshu", "小红书"], "小红书": ["xiaohongshu", "小红书"],
};

const text = (value) => String(value ?? "").trim();
const parseJson = (value) => { try { return JSON.parse(value || "{}"); } catch { return {}; } };
const uniqueOne = (rows) => {
  const values = [...new Map(rows.map((row) => [row.id, row])).values()];
  return values.length === 1 ? values[0] : null;
};

function tableFingerprint(table) {
  const primaryKeys = database.prepare(`PRAGMA table_info(${table})`).all()
    .filter((column) => column.pk)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => `"${column.name}"`);
  const orderBy = primaryKeys.length ? ` ORDER BY ${primaryKeys.join(",")}` : " ORDER BY rowid";
  const rows = database.prepare(`SELECT * FROM ${table}${orderBy}`).all();
  return { count: rows.length, sha256: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

function protectedSnapshot() {
  return Object.fromEntries(protectedTables.map((table) => [table, tableFingerprint(table)]));
}

function parseShopName(value) {
  const raw = text(value);
  const rules = [
    { pattern: /-(天猫|淘宝|京东|小红书|抖店|视频号小店)(?:-公司)?$/u, group: 1 },
    { pattern: /-淘宝C店$/u, platform: "淘宝" },
  ];
  for (const rule of rules) {
    const match = raw.match(rule.pattern);
    if (match) return { raw, shopName: raw.slice(0, match.index).trim(), platform: rule.platform || match[rule.group] };
  }
  if (raw.startsWith("小红书") && raw.length > 3) return { raw, shopName: raw.slice(3).trim(), platform: "小红书" };
  return { raw, shopName: raw, platform: "" };
}

const findShopByName = database.prepare(`SELECT DISTINCT s.id,s.platform FROM sales_shops s
  LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
  WHERE s.status='active' AND (LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?))`);
const findShopByPlatform = database.prepare(`SELECT DISTINCT s.id,s.platform FROM sales_shops s
  LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
  WHERE s.status='active' AND LOWER(s.platform)=LOWER(?)
    AND (LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?))`);
const findLink = database.prepare("SELECT id FROM sales_links WHERE shopId=? AND platformGoodsId=? AND currentState='active'");
const findSku = database.prepare("SELECT id FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=? AND currentState='active'");

function findShop(value, platform = "") {
  const parsed = parseShopName(value);
  const platformName = text(platform) || parsed.platform;
  const platforms = platformAliases[platformName.toLowerCase()] || (platformName ? [platformName] : []);
  let result = platforms.length
    ? uniqueOne(platforms.flatMap((item) => findShopByPlatform.all(item, parsed.shopName, parsed.shopName, parsed.shopName)))
    : uniqueOne(findShopByName.all(parsed.shopName, parsed.shopName, parsed.shopName));
  if (!result && parsed.shopName !== parsed.raw) result = uniqueOne(findShopByName.all(parsed.raw, parsed.raw, parsed.raw));
  return result;
}

function dataFromException(row) {
  const raw = parseJson(row.rawDataJson);
  return raw.normalized || {
    sourceShopName: raw["店铺"],
    platformGoodsId: raw["货品ID"],
    platformSkuId: raw["规格ID"],
  };
}

function identify(row) {
  const data = dataFromException(row);
  const shop = findShop(data.shop || data.sourceShopName, data.platform);
  const link = shop && text(data.platformGoodsId) ? findLink.get(shop.id, text(data.platformGoodsId)) : null;
  const sku = link && text(data.platformSkuId) ? findSku.get(link.id, text(data.platformSkuId)) : null;
  return { data, shop, link, sku };
}

function modelCounts() {
  const count = (table) => Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);
  return {
    comboGroups: count("sales_link_sku_combo_groups"),
    comboComponents: count("sales_link_sku_combo_group_components"),
    productStructures: count("sales_link_sku_product_structures"),
    productStructureComponents: count("sales_link_sku_product_structure_components"),
    activeMappings: Number(database.prepare("SELECT COUNT(*) count FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().count),
  };
}

function exceptionCounts() {
  return database.prepare(`SELECT exceptionType,status,COUNT(*) count FROM data_sync_exceptions
    WHERE exceptionType IN ('bundle_sku','combo_goods','missing_product_structure','product_structure_review_pending','product_structure_conflict')
    GROUP BY exceptionType,status ORDER BY exceptionType,status`).all();
}

function analyze() {
  const rows = database.prepare(`SELECT e.*,b.sourceBatchId FROM data_sync_exceptions e
    JOIN data_sync_batches b ON b.id=e.batchId
    JOIN data_sync_tasks t ON t.id=e.taskId
    WHERE e.status='open' AND e.exceptionType IN ('bundle_sku','combo_goods')
      AND t.taskCode IN ('platform_goods_excel_import','sales_fact_excel_import')
    ORDER BY e.id`).all().map((row) => ({ ...row, identity: identify(row) }));
  const skuIds = [...new Set(rows.map((row) => row.identity.sku?.id).filter(Boolean))];
  const relations = {};
  for (let offset = 0; offset < skuIds.length; offset += 500) {
    Object.assign(relations, resolveLinkSkuErpRelations(
      { salesLinkSkuIds: skuIds.slice(offset, offset + 500) },
      { database },
    ).results);
  }
  const structuresBySku = new Map();
  if (skuIds.length) {
    const placeholders = skuIds.map(() => "?").join(",");
    for (const structure of database.prepare(`SELECT s.*,COUNT(c.id) componentCount
      FROM sales_link_sku_product_structures s
      LEFT JOIN sales_link_sku_product_structure_components c ON c.productStructureId=s.id
      WHERE s.salesLinkSkuId IN (${placeholders}) GROUP BY s.id ORDER BY s.createdAt,s.id`).all(...skuIds)) {
      const list = structuresBySku.get(structure.salesLinkSkuId) || [];
      list.push(structure);
      structuresBySku.set(structure.salesLinkSkuId, list);
    }
  }
  const classified = rows.map((row) => {
    const skuId = row.identity.sku?.id;
    const structures = structuresBySku.get(skuId) || [];
    const relation = relations[skuId];
    const active = structures.find((item) => item.status === "active" && Number(item.componentCount) > 0);
    const pending = structures.find((item) => item.status === "pending_review" && Number(item.componentCount) > 0);
    if (active && relation?.relationStatus === "active_complete" && relation.isUsable) {
      return { ...row, category: "resolved", structure: active, relation };
    }
    if (pending) return { ...row, category: "review_pending", structure: pending, relation };
    if (!structures.length || structures.every((item) => !Number(item.componentCount))) {
      return { ...row, category: "missing", structure: null, relation };
    }
    return { ...row, category: "conflict", structure: active || structures[0], relation };
  });
  return {
    rows: classified,
    objectCount: new Set(classified.map((row) => row.identity.sku?.id).filter(Boolean)).size,
    unresolvedIdentityCount: classified.filter((row) => !row.identity.sku).length,
    byCategory: Object.fromEntries(["resolved", "review_pending", "missing", "conflict"].map((category) => {
      const items = classified.filter((row) => row.category === category);
      return [category, { records: items.length, objects: new Set(items.map((row) => row.identity.sku?.id).filter(Boolean)).size }];
    })),
  };
}

const before = {
  modelCounts: modelCounts(),
  exceptionCounts: exceptionCounts(),
  protectedTables: protectedSnapshot(),
  totalExceptions: Number(database.prepare("SELECT COUNT(*) count FROM data_sync_exceptions").get().count),
};
const analysis = analyze();
assert([0, 110].includes(analysis.rows.length), "Combo历史异常数量不符合预期，停止执行。");
if (analysis.rows.length) {
  assert.equal(analysis.objectCount, 15, "Combo历史异常对象数量不符合预期，停止执行。");
  assert.equal(analysis.unresolvedIdentityCount, 0, "存在无法定位到链接SKU的Combo异常，停止执行。");
}

let changes = { resolved: 0, reviewPending: 0, missing: 0, conflict: 0, sourceRows: 0 };
if (execute && analysis.rows.length) {
  changes = database.transaction(() => {
    const result = { resolved: 0, reviewPending: 0, missing: 0, conflict: 0, sourceRows: 0 };
    const resolveUnified = database.prepare(`UPDATE data_sync_exceptions SET status='resolved',resolutionType='rule_fixed',
      resolutionNote=?,resolvedReason=?,resolvedAt=?,resolvedBy='system:product-structure-convergence-phase1'
      WHERE id=? AND status='open' AND exceptionType IN ('bundle_sku','combo_goods')`);
    const reclassifyUnified = database.prepare(`UPDATE data_sync_exceptions SET exceptionType=?,message=?
      WHERE id=? AND status='open' AND exceptionType IN ('bundle_sku','combo_goods')`);
    const resolveImportRow = database.prepare(`UPDATE connection_import_rows SET status='resolved',resolutionType='rule_fixed',
      resolutionNote=?,resolvedReason=?,resolvedAt=? WHERE batchId=? AND rowNumber=? AND status='error' AND errorType='combo_goods'`);
    const reclassifyImportRow = database.prepare(`UPDATE connection_import_rows SET errorType=?,errorMessage=?
      WHERE batchId=? AND rowNumber=? AND status='error' AND errorType='combo_goods'`);
    const resolvePlatformRow = database.prepare(`UPDATE platform_goods_excel_import_rows SET action='resolved',resolutionType='rule_fixed',
      resolutionNote=?,resolvedAt=? WHERE batchId=? AND sourceShopName=? AND platformGoodsId=? AND platformSkuId=?
        AND action='exception' AND exceptionType='bundle_sku'`);
    const reclassifyPlatformRow = database.prepare(`UPDATE platform_goods_excel_import_rows SET exceptionType=?,message=?
      WHERE batchId=? AND sourceShopName=? AND platformGoodsId=? AND platformSkuId=?
        AND action='exception' AND exceptionType='bundle_sku'`);
    const definitions = {
      review_pending: { type: "product_structure_review_pending", message: "商品结构草稿已存在，等待结构审核。", counter: "reviewPending" },
      missing: { type: "missing_product_structure", message: "链接SKU缺少商品结构，需要建立Product Structure治理任务。", counter: "missing" },
      conflict: { type: "product_structure_conflict", message: "商品结构与当前生效关系不一致，需要处理结构冲突。", counter: "conflict" },
    };
    const resolvedNote = "Product Structure已完整，Combo Group不再作为必要治理对象";
    for (const item of analysis.rows) {
      const sourceRowNumber = Number(parseJson(item.rawDataJson).rowNumber || item.entityId || 0);
      if (item.category === "resolved") {
        result.resolved += resolveUnified.run(resolvedNote, resolvedNote, timestamp, item.id).changes;
        result.sourceRows += item.exceptionType === "combo_goods"
          ? resolveImportRow.run(resolvedNote, resolvedNote, timestamp, item.sourceBatchId, sourceRowNumber).changes
          : resolvePlatformRow.run(resolvedNote, timestamp, item.sourceBatchId, text(item.identity.data.sourceShopName),
            text(item.identity.data.platformGoodsId), text(item.identity.data.platformSkuId)).changes;
        continue;
      }
      const definition = definitions[item.category];
      result[definition.counter] += reclassifyUnified.run(definition.type, definition.message, item.id).changes;
      result.sourceRows += item.exceptionType === "combo_goods"
        ? reclassifyImportRow.run(definition.type, definition.message, item.sourceBatchId, sourceRowNumber).changes
        : reclassifyPlatformRow.run(definition.type, definition.message, item.sourceBatchId, text(item.identity.data.sourceShopName),
          text(item.identity.data.platformGoodsId), text(item.identity.data.platformSkuId)).changes;
    }
    return result;
  }).immediate();
}

const after = {
  modelCounts: modelCounts(),
  exceptionCounts: exceptionCounts(),
  protectedTables: protectedSnapshot(),
  totalExceptions: Number(database.prepare("SELECT COUNT(*) count FROM data_sync_exceptions").get().count),
};
const changedProtectedTables = protectedTables.filter((table) =>
  before.protectedTables[table].count !== after.protectedTables[table].count
  || before.protectedTables[table].sha256 !== after.protectedTables[table].sha256);
assert.deepEqual(changedProtectedTables, [], `受保护业务表发生变化：${changedProtectedTables.join("、")}`);
assert.equal(after.totalExceptions, before.totalExceptions, "异常记录总量发生变化。");
assert.deepEqual(after.modelCounts, before.modelCounts, "商品结构或关系模型数量发生变化。");

const report = {
  databasePath,
  mode: execute ? "execute" : "dry_run",
  timestamp,
  before,
  analysis: {
    records: analysis.rows.length,
    objectCount: analysis.objectCount,
    byCategory: analysis.byCategory,
    objects: [...new Map(analysis.rows.map((row) => [row.identity.sku.id, {
      salesLinkSkuId: row.identity.sku.id,
      category: row.category,
      structureId: row.structure?.id || null,
      structureStatus: row.structure?.status || null,
      resolverStatus: row.relation?.relationStatus || "missing",
      exceptionRecords: analysis.rows.filter((item) => item.identity.sku.id === row.identity.sku.id).length,
    }])).values()],
  },
  changes,
  after,
  changedProtectedTables,
  integrityCheck: database.pragma("integrity_check", { simple: true }),
  foreignKeyIssues: database.pragma("foreign_key_check").length,
};
console.log(JSON.stringify(report, null, 2));
database.close();
