import assert from "node:assert/strict";
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
const timestamp = new Date().toISOString();
const linkTaskCodes = ["platform_operations", "sales_fact_excel_import", "platform_goods_excel_import", "wangdian_platform_goods"];
const governanceTypes = new Set([
  "bundle_sku", "combo_goods", "duplicate_data", "missing_erp_mapping",
  "erp_relation_governance_pending", "erp_relation_conflict",
]);
const platformAliases = {
  tmall: ["tmall", "天猫"], "天猫": ["tmall", "天猫"],
  taobao: ["taobao", "淘宝"], "淘宝": ["taobao", "淘宝"],
  jd: ["jd", "京东"], "京东": ["jd", "京东"],
  xiaohongshu: ["xiaohongshu", "小红书"], "小红书": ["xiaohongshu", "小红书"],
};

function hasColumn(table, column) {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

function ensureColumn(table, column, definition) {
  if (!hasColumn(table, column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

function text(value) { return String(value ?? "").trim(); }

function parseSourceShopIdentity(sourceShopName) {
  const raw = text(sourceShopName);
  const suffixRules = [
    { pattern: /-(天猫|淘宝|京东|小红书|抖店|视频号小店)(?:-公司)?$/u, platformGroup: 1 },
    { pattern: /-淘宝C店$/u, platform: "淘宝" },
  ];
  for (const rule of suffixRules) {
    const match = raw.match(rule.pattern);
    if (match) return { platform: rule.platform || match[rule.platformGroup], shopName: raw.slice(0, match.index).trim(), raw };
  }
  if (raw.startsWith("小红书") && raw.length > 3) return { platform: "小红书", shopName: raw.slice(3).trim(), raw };
  return { platform: "", shopName: raw, raw };
}

const findShopByName = database.prepare(`SELECT DISTINCT s.id,s.platform FROM sales_shops s
  LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
  WHERE LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?)`);
const findShopByPlatform = database.prepare(`SELECT DISTINCT s.id,s.platform FROM sales_shops s
  LEFT JOIN sales_shop_aliases a ON a.shopId=s.id
  WHERE LOWER(s.platform)=LOWER(?) AND (LOWER(s.shopName)=LOWER(?) OR LOWER(s.displayName)=LOWER(?) OR LOWER(a.rawName)=LOWER(?))`);
const findLink = database.prepare("SELECT id FROM sales_links WHERE shopId=? AND platformGoodsId=?");
const findLinkSku = database.prepare("SELECT id FROM sales_link_skus WHERE salesLinkId=? AND platformSkuId=?");
const findErpSku = database.prepare("SELECT id FROM erp_skus WHERE LOWER(merchantSkuCode)=LOWER(?)");
const findPeriodFact = database.prepare(`SELECT * FROM connection_sku_sales_facts
  WHERE salesLinkSkuId=? AND erpSkuId=? AND periodStart=? AND periodEnd=?`);

function unique(rows) {
  const values = [...new Map(rows.map((item) => [item.id, item])).values()];
  return values.length === 1 ? values[0] : null;
}

function resolveShop(sourceName, platform = "") {
  const parsed = parseSourceShopIdentity(sourceName);
  const platformName = text(platform) || parsed.platform;
  const platforms = platformAliases[platformName.toLowerCase()] || (platformName ? [platformName] : []);
  let shop = platforms.length
    ? unique(platforms.flatMap((item) => findShopByPlatform.all(item, parsed.shopName, parsed.shopName, parsed.shopName)))
    : unique(findShopByName.all(parsed.shopName, parsed.shopName, parsed.shopName));
  if (!shop && parsed.shopName !== parsed.raw) shop = unique(findShopByName.all(parsed.raw, parsed.raw, parsed.raw));
  return shop;
}

function identityFromData(data) {
  const shop = resolveShop(data.shop || data.sourceShopName, data.platform);
  const link = shop ? findLink.get(shop.id, text(data.platformGoodsId)) : null;
  const salesLinkSku = link ? findLinkSku.get(link.id, text(data.platformSkuId)) : null;
  const erpSku = text(data.skuCode || data.merchantSkuCode) ? findErpSku.get(text(data.skuCode || data.merchantSkuCode)) : null;
  return { shop, link, salesLinkSku, erpSku };
}

function resolveRelations(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const results = {};
  for (let offset = 0; offset < uniqueIds.length; offset += 500) {
    Object.assign(results, resolveLinkSkuErpRelations(
      { salesLinkSkuIds: uniqueIds.slice(offset, offset + 500) },
      { database },
    ).results);
  }
  return results;
}

function relationComplete(relation, erpSkuId = null) {
  if (relation?.relationStatus !== "active_complete" || !relation.isUsable) return false;
  if (!relation.mappings.length || relation.mappings.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) return false;
  return !erpSkuId || relation.mappings.some((item) => item.erpSkuId === erpSkuId);
}

function exactDuplicateRows() {
  const rows = database.prepare(`SELECT r.* FROM connection_import_rows r
    JOIN connection_import_batches b ON b.id=r.batchId
    WHERE b.importType='erp_sales' AND r.errorType='duplicate_data' AND r.status='error'`).all();
  const exact = [];
  const different = [];
  for (const row of rows) {
    const data = parseJson(row.normalizedDataJson);
    const identity = identityFromData(data);
    const fact = identity.salesLinkSku && identity.erpSku
      ? findPeriodFact.get(identity.salesLinkSku.id, identity.erpSku.id, text(data.periodStart), text(data.periodEnd))
      : null;
    const fields = ["shippedQuantity", "salesAmount", "costAmount", "profitAmount"];
    const same = fact && fields.every((field) => Math.abs(Number(data[field] || 0) - Number(fact[field] || 0)) < 1e-9);
    (same ? exact : different).push(row);
  }
  return { exact, different, total: rows.length };
}

function comboCandidates() {
  const bundleExceptions = database.prepare(`SELECT e.id,e.batchId,e.rawDataJson,b.sourceBatchId
    FROM data_sync_exceptions e JOIN data_sync_batches b ON b.id=e.batchId
    JOIN data_sync_tasks t ON t.id=e.taskId
    WHERE e.status='open' AND e.exceptionType='bundle_sku' AND t.taskCode='platform_goods_excel_import'`).all()
    .map((row) => {
      const raw = parseJson(row.rawDataJson);
      const data = { sourceShopName: raw["店铺"], platformGoodsId: raw["货品ID"], platformSkuId: raw["规格ID"] };
      return { ...row, data, identity: identityFromData(data), kind: "bundle" };
    });
  const comboExceptions = database.prepare(`SELECT e.id,e.batchId,e.rawDataJson,b.sourceBatchId
    FROM data_sync_exceptions e JOIN data_sync_batches b ON b.id=e.batchId
    JOIN data_sync_tasks t ON t.id=e.taskId
    WHERE e.status='open' AND e.exceptionType='combo_goods' AND t.taskCode='sales_fact_excel_import'`).all()
    .map((row) => {
      const payload = parseJson(row.rawDataJson);
      const data = payload.normalized || {};
      return { ...row, sourceRowNumber: Number(payload.rowNumber || 0), data, identity: identityFromData(data), kind: "combo" };
    });
  const all = [...bundleExceptions, ...comboExceptions];
  const relations = resolveRelations(all.map((item) => item.identity.salesLinkSku?.id));
  const resolved = [];
  const pending = [];
  for (const item of all) {
    const relation = relations[item.identity.salesLinkSku?.id];
    const complete = relationComplete(relation, item.kind === "combo" ? item.identity.erpSku?.id : null);
    (complete ? resolved : pending).push({ ...item, relation });
  }
  return { resolved, pending, total: all.length };
}

function linkScopeSummary() {
  const placeholders = linkTaskCodes.map(() => "?").join(",");
  const unifiedResolution = hasColumn("data_sync_exceptions", "resolutionType") ? "e.resolutionType" : "NULL";
  const legacyResolution = hasColumn("connection_import_rows", "resolutionType") ? "r.resolutionType" : "NULL";
  const legacyResolutionFilter = hasColumn("connection_import_rows", "resolutionType") ? "OR r.resolutionType IS NOT NULL" : "";
  const unified = database.prepare(`SELECT e.status,e.exceptionType,${unifiedResolution} resolutionType,COUNT(*) count
    FROM data_sync_exceptions e JOIN data_sync_tasks t ON t.id=e.taskId
    WHERE t.taskCode IN (${placeholders}) GROUP BY e.status,e.exceptionType,resolutionType`).all(...linkTaskCodes);
  const legacy = database.prepare(`SELECT r.status,r.errorType,${legacyResolution} resolutionType,COUNT(*) count
    FROM connection_import_rows r JOIN connection_import_batches b ON b.id=r.batchId
    WHERE (r.status='error' ${legacyResolutionFilter})
      AND (b.importType IS NOT NULL OR b.sourceType IN ('business_advisor','platform_operations'))
      AND NOT EXISTS (SELECT 1 FROM data_sync_batches ds WHERE ds.sourceBatchId=b.id)
    GROUP BY r.status,r.errorType,resolutionType`).all();
  const summary = { blockingErrorCount: 0, governancePendingCount: 0, historicalCount: 0, idempotentSkippedCount: 0, resolvedCount: 0, totalCount: 0 };
  for (const row of unified) {
    const count = Number(row.count || 0); summary.totalCount += count;
    if (row.status === "open") {
      if (governanceTypes.has(row.exceptionType)) summary.governancePendingCount += count;
      else summary.blockingErrorCount += count;
    } else if (row.status === "idempotent_skipped") summary.idempotentSkippedCount += count;
    else if (row.status === "resolved") summary.resolvedCount += count;
    else if (["ignored", "superseded"].includes(row.status)) summary.historicalCount += count;
  }
  for (const row of legacy) {
    const count = Number(row.count || 0); summary.totalCount += count;
    if (row.status === "error") summary.blockingErrorCount += count;
    else if (row.status === "idempotent_skipped") summary.idempotentSkippedCount += count;
    else if (row.status === "resolved") summary.resolvedCount += count;
    else if (["ignored", "superseded"].includes(row.status)) summary.historicalCount += count;
  }
  summary.actionableCount = summary.blockingErrorCount + summary.governancePendingCount;
  return summary;
}

function protectedCounts() {
  return Object.fromEntries([
    "sales_links", "sales_link_skus", "sales_link_sku_erp_mappings", "connection_sku_sales_facts",
    "connection_sku_sales_daily_facts", "product_erp_mappings", "products", "erp_skus",
  ].map((table) => [table, Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));
}

function preview() {
  const historical = Number(database.prepare(`SELECT COUNT(*) count FROM connection_import_rows r
    JOIN connection_import_batches b ON b.id=r.batchId
    WHERE b.importType='erp_product_relations' AND r.errorType='missing_field' AND r.status='error'`).get().count);
  const superseded = Number(database.prepare(`SELECT COUNT(*) count FROM data_sync_exceptions e
    JOIN data_sync_batches b ON b.id=e.batchId WHERE e.status='open' AND b.status='superseded'`).get().count);
  const supersededInLinkScope = Number(database.prepare(`SELECT COUNT(*) count FROM data_sync_exceptions e
    JOIN data_sync_batches b ON b.id=e.batchId JOIN data_sync_tasks t ON t.id=e.taskId
    WHERE e.status='open' AND b.status='superseded' AND t.taskCode IN (${linkTaskCodes.map(() => "?").join(",")})`).get(...linkTaskCodes).count);
  const normalBusiness = Number(database.prepare("SELECT COUNT(*) count FROM data_sync_exceptions WHERE status='open' AND exceptionType='no_system_goods'").get().count);
  const duplicates = exactDuplicateRows();
  const combos = comboCandidates();
  return { historical, superseded, supersededInLinkScope, normalBusiness, duplicates, combos };
}

const before = { summary: linkScopeSummary(), protectedCounts: protectedCounts() };
const analysis = preview();
assert([57254, 57345].includes(before.summary.totalCount), "链接中心异常基线已变化，停止执行。");
const initialState = analysis.historical === 34339
  && analysis.supersededInLinkScope === 623
  && analysis.normalBusiness === 1126
  && analysis.duplicates.total === 505
  && analysis.duplicates.exact.length === 471
  && analysis.combos.total === 18295;
const convergedState = analysis.historical === 0
  && analysis.supersededInLinkScope === 0
  && analysis.normalBusiness === 0
  && analysis.duplicates.total === 34
  && analysis.duplicates.exact.length === 0
  && analysis.combos.total === 110;
assert(initialState || convergedState, "异常数据既不符合执行前基线，也不符合已收敛状态，停止执行。");

let changes = null;
if (execute) {
  ensureColumn("data_sync_exceptions", "resolutionType", "TEXT");
  ensureColumn("connection_import_rows", "resolutionType", "TEXT");
  ensureColumn("connection_import_rows", "resolutionNote", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "resolutionType", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "resolutionNote", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "resolvedAt", "TEXT");
  changes = database.transaction(() => {
    const result = {};
    result.historicalNonLink = database.prepare(`UPDATE connection_import_rows SET
      status='ignored',resolutionType='normal_business',resolutionNote=?,resolvedReason=?,resolvedAt=?
      WHERE id IN (SELECT r.id FROM connection_import_rows r JOIN connection_import_batches b ON b.id=r.batchId
        WHERE b.importType='erp_product_relations' AND r.errorType='missing_field' AND r.status='error')`)
      .run("非链接数据范围，不属于链接中心异常治理", "非链接数据范围，不属于链接中心异常治理", timestamp).changes;
    result.superseded = database.prepare(`UPDATE data_sync_exceptions SET
      status='superseded',resolutionType='source_corrected',resolutionNote=?,resolvedReason=?,resolvedAt=?
      WHERE status='open' AND batchId IN (SELECT id FROM data_sync_batches WHERE status='superseded')`)
      .run("异常所属批次已被新批次替代", "异常所属批次已被新批次替代", timestamp).changes;
    result.normalBusiness = database.prepare(`UPDATE data_sync_exceptions SET
      status='ignored',resolutionType='normal_business',resolutionNote=?,resolvedReason=?,resolvedAt=?
      WHERE status='open' AND exceptionType='no_system_goods'`)
      .run("源数据明确标记为无系统货品，按正常业务状态收敛", "源数据明确标记为无系统货品，按正常业务状态收敛", timestamp).changes;
    database.prepare(`UPDATE platform_goods_excel_import_rows SET action='ignored',resolutionType='normal_business',resolutionNote=?,resolvedAt=?
      WHERE action='exception' AND exceptionType='no_system_goods'`)
      .run("源数据明确标记为无系统货品，按正常业务状态收敛", timestamp);

    const updateImportDuplicate = database.prepare(`UPDATE connection_import_rows SET status='idempotent_skipped',
      resolutionType='idempotent_skipped',resolutionNote=?,resolvedReason=?,resolvedAt=? WHERE id=? AND status='error'`);
    const updateUnifiedDuplicate = database.prepare(`UPDATE data_sync_exceptions SET status='idempotent_skipped',
      resolutionType='idempotent_skipped',resolutionNote=?,resolvedReason=?,resolvedAt=?
      WHERE status='open' AND exceptionType='duplicate_data' AND entityId=?
        AND batchId IN (SELECT id FROM data_sync_batches WHERE sourceBatchId=?)`);
    result.idempotentSkipped = 0;
    result.idempotentUnified = 0;
    for (const row of analysis.duplicates.exact) {
      const note = "销售事实身份与内容完全一致，按幂等重复跳过";
      result.idempotentSkipped += updateImportDuplicate.run(note, note, timestamp, row.id).changes;
      result.idempotentUnified += updateUnifiedDuplicate.run(note, note, timestamp, String(row.rowNumber), row.batchId).changes;
    }

    const updateUnifiedCombo = database.prepare(`UPDATE data_sync_exceptions SET status='resolved',
      resolutionType='rule_fixed',resolutionNote=?,resolvedReason=?,resolvedAt=? WHERE id=? AND status='open'`);
    const updateImportCombo = database.prepare(`UPDATE connection_import_rows SET status='resolved',
      resolutionType='rule_fixed',resolutionNote=?,resolvedReason=?,resolvedAt=? WHERE batchId=? AND rowNumber=? AND status='error' AND errorType='combo_goods'`);
    const updatePlatformCombo = database.prepare(`UPDATE platform_goods_excel_import_rows SET action='resolved',
      resolutionType='rule_fixed',resolutionNote=?,resolvedAt=?
      WHERE batchId=? AND sourceShopName=? AND platformGoodsId=? AND platformSkuId=? AND action='exception' AND exceptionType='bundle_sku'`);
    result.comboResolved = 0;
    result.comboSourceRowsResolved = 0;
    const comboNote = "V2关系模型已建立，历史异常自动收敛";
    for (const item of analysis.combos.resolved) {
      result.comboResolved += updateUnifiedCombo.run(comboNote, comboNote, timestamp, item.id).changes;
      if (item.kind === "combo") {
        result.comboSourceRowsResolved += updateImportCombo.run(comboNote, comboNote, timestamp, item.sourceBatchId, item.sourceRowNumber).changes;
      } else {
        result.comboSourceRowsResolved += updatePlatformCombo.run(
          comboNote, timestamp, item.sourceBatchId, text(item.data.sourceShopName), text(item.data.platformGoodsId), text(item.data.platformSkuId),
        ).changes;
      }
    }
    return result;
  }).immediate();
}

const after = { summary: linkScopeSummary(), protectedCounts: protectedCounts() };
if (execute) {
  assert.deepEqual(after.protectedCounts, before.protectedCounts, "受保护业务表数量发生变化。");
  assert.equal(after.summary.totalCount, before.summary.totalCount, "收敛后异常记录总量发生变化。");
}
const report = {
  databasePath, mode: execute ? "execute" : "dry_run", timestamp,
  before, analysis: {
    historicalNonLink: analysis.historical,
    supersededAllScopes: analysis.superseded,
    supersededInLinkScope: analysis.supersededInLinkScope,
    normalBusiness: analysis.normalBusiness,
    duplicateData: { total: analysis.duplicates.total, exact: analysis.duplicates.exact.length, different: analysis.duplicates.different.length },
    comboRelations: {
      total: analysis.combos.total,
      resolved: analysis.combos.resolved.length,
      pending: analysis.combos.pending.length,
      pendingReasons: analysis.combos.pending.reduce((result, item) => {
        const reason = !item.identity.shop ? "missing_shop"
          : !item.identity.link ? "missing_link"
            : !item.identity.salesLinkSku ? "missing_link_sku"
              : item.kind === "combo" && !item.identity.erpSku ? "missing_erp_sku"
                : item.relation?.relationStatus !== "active_complete" ? `relation_${item.relation?.relationStatus || "missing"}`
                  : item.kind === "combo" && !item.relation.mappings.some((mapping) => mapping.erpSkuId === item.identity.erpSku.id)
                    ? "target_erp_not_in_relation"
                    : "relation_incomplete";
        result[reason] = Number(result[reason] || 0) + 1;
        return result;
      }, {}),
    },
  },
  changes, after,
  integrityCheck: database.pragma("integrity_check", { simple: true }),
  foreignKeyErrors: database.pragma("foreign_key_check").length,
};
console.log(JSON.stringify(report, null, 2));
database.close();
