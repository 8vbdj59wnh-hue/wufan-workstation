import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { getDatabase } from "./db.js";
import { assertCurrentDataSyncPreview, completeDataSyncBatch, createDataSyncBatch, getDataSyncBatch, getDataSyncTask, markDataSyncBatchPreviewReady } from "./dataSyncCenterService.js";
import { canonicalizeSalesUrl } from "./productV2Import.js";
import { getLinkOperatingSummary } from "./linkOperatingSetService.js";
import { readXlsxWorkbook } from "./workbookReader.js";

const TASK_CODE = "platform_goods_excel_import";
const SOURCE_BATCH_TYPE = "platform_goods_excel_import";
const PARSER_VERSION = "platform-goods-asset-sync-v2-preview-v1";
const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase("zh-CN");
const numberValue = (value) => {
  const parsed = Number(text(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const stableId = (prefix, source) => `${prefix}-${crypto.createHash("sha256").update(String(source)).digest("hex").slice(0, 24)}`;
const NON_BUSINESS_SHOP_NAME = /^(?:无效|总计|合计|汇总)[:：]?$/u;
const COMBO_GOODS_TYPES = new Set(["组合装", "组合商品", "套餐", "套装"]);
const NO_ERP_RELATION_TYPES = new Set(["无", "无需", "非系统货品", "非商品"]);
const EXCEPTION_REASON_LABELS = Object.freeze({
  missing_shop_name: "店铺名称为空",
  ambiguous_shop: "店铺名称匹配到多个店铺",
  missing_platform_goods_id: "货品ID为空",
  ambiguous_sales_link: "Link身份重复",
  missing_platform_sku_id: "规格ID为空",
  duplicate_platform_sku: "文件内平台SKU重复",
  ambiguous_platform_sku: "Link SKU身份重复",
  missing_erp_sku_code: "ERP SKU编码为空",
  missing_erp_sku: "ERP SKU不存在",
  ambiguous_erp_sku: "ERP SKU编码不唯一",
  existing_erp_sku_conflict: "ERP关系与现有商品结构冲突",
  missing_combo_sales_object_code: "组合规格编码为空",
  missing_combo_sales_object: "组合商品对象不存在",
  ambiguous_combo_sales_object: "组合商品对象编码不唯一",
  existing_sales_object_conflict: "组合商品关系与现有结构冲突",
  product_structure_pending: "组合商品结构待治理",
});

function sameValue(left, right) {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "";
  if (right === null || right === undefined || right === "") return false;
  return String(left) === String(right);
}

function sameNumber(left, right) {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "";
  if (right === null || right === undefined || right === "") return false;
  return Math.abs(Number(left) - Number(right)) < 0.000001;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return text(value).replace(/\.0+$/u, "");
}

function parseWorkbook(buffer) {
  if (!buffer?.length) throw new Error("请选择平台货品Excel文件。");
  const workbook = readXlsxWorkbook(buffer, { type: "buffer", cellDates: false, raw: false }, { context: "platform-goods-excel" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
  const required = ["店铺", "货品ID", "规格ID", "平台规格编码", "系统货品"];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missing = required.filter((field) => !headers.includes(field));
  if (missing.length) throw new Error(`Excel缺少必需字段：${missing.join("、")}。`);
  return { sheetName, rows: rows.map((row, index) => ({
    rowNumber: index + 2,
    sourceShopName: normalizeCell(row["店铺"]),
    platformGoodsId: normalizeCell(row["货品ID"]),
    platformSkuId: normalizeCell(row["规格ID"]),
    merchantSkuCode: normalizeCell(row["平台规格编码"]),
    systemGoodsType: normalizeCell(row["系统货品"]),
    sourceModifiedAt: normalizeCell(row["最后修改时间"]),
    platformGoodsCode: normalizeCell(row["平台货品编号"]),
    title: normalizeCell(row["货品名称"]),
    rawUrl: normalizeCell(row["平台商品链接"]),
    platformSkuName: normalizeCell(row["规格名称"]),
    status: normalizeCell(row["状态"]),
    activityStatus: normalizeCell(row["活动状态"]),
    category: normalizeCell(row["平台类目"]),
    price: numberValue(row["价格"]),
    platformStock: numberValue(row["平台库存"]),
    occupiedStock: numberValue(row["占用库存"]),
    syncEnabled: normalizeCell(row["是否需要同步"]) === "是" ? 1 : 0,
    lastSyncedStock: numberValue(row["最后同步库存"]),
    lastSyncedAt: normalizeCell(row["最后同步时间"]),
    stopSyncReason: normalizeCell(row["停止同步原因"]),
    rawData: row,
  })) };
}

function isNonBusinessRow(row) {
  return NON_BUSINESS_SHOP_NAME.test(text(row.sourceShopName).replace(/\s+/gu, ""));
}

function classifyPlatformSnapshot(rows) {
  const sourceShopNames = [...new Set(rows.map((row) => text(row.sourceShopName)).filter(Boolean))].sort();
  const businessShopNames = sourceShopNames.filter((name) => !NON_BUSINESS_SHOP_NAME.test(name.replace(/\s+/gu, "")));
  const hasSummaryRow = rows.some((row) => isNonBusinessRow(row) && /^(?:总计|合计|汇总)[:：]?$/u.test(text(row.sourceShopName).replace(/\s+/gu, "")));
  const mode = businessShopNames.length > 1 && hasSummaryRow ? "full" : "partial";
  return {
    mode,
    sourceShopNames,
    businessShopCount: businessShopNames.length,
    hasSummaryRow,
    reason: mode === "full" ? "多店完整平台货品表且包含汇总行" : businessShopNames.length <= 1 ? "仅包含单店数据" : "缺少完整导出汇总行",
  };
}

function classifyStoredPlatformSnapshot(batch, rows) {
  if (["full", "partial"].includes(batch.scope?.platformSnapshotMode)) {
    return {
      mode: batch.scope.platformSnapshotMode,
      sourceShopNames: batch.scope.sourceShopNames || [],
      businessShopCount: Number(batch.scope.platformSnapshotBusinessShopCount || 0),
      hasSummaryRow: Boolean(batch.scope.platformSnapshotHasSummaryRow),
      reason: batch.scope.platformSnapshotReason || "",
    };
  }
  return classifyPlatformSnapshot(rows.map((row) => ({ sourceShopName: row.sourceShopName })));
}

function persistPlatformSnapshotClassification(database, batch, classification) {
  const scope = {
    ...(batch.scope || {}),
    platformSnapshotMode: classification.mode,
    platformSnapshotBusinessShopCount: classification.businessShopCount,
    platformSnapshotHasSummaryRow: classification.hasSummaryRow,
    platformSnapshotReason: classification.reason,
  };
  database.prepare("UPDATE data_sync_batches SET scopeJson=? WHERE id=?").run(JSON.stringify(scope), batch.id);
  return scope;
}

function parseSourceShopIdentity(sourceShopName) {
  const raw = text(sourceShopName);
  const suffixRules = [
    { pattern: /-(天猫|淘宝|京东|小红书|抖店|视频号小店)(?:-公司)?$/u, platformGroup: 1 },
    { pattern: /-淘宝C店$/u, platform: "淘宝" },
  ];
  for (const rule of suffixRules) {
    const match = raw.match(rule.pattern);
    if (!match) continue;
    return { platform: rule.platform || match[rule.platformGroup], shopName: raw.slice(0, match.index).trim() };
  }
  if (raw.startsWith("小红书") && raw.length > 3) return { platform: "小红书", shopName: raw.slice(3).trim() };
  return { platform: "", shopName: raw };
}

function inferPlatformFromUrl(rawUrl) {
  const url = lower(rawUrl);
  if (url.includes("xiaohongshu.com")) return "小红书";
  if (url.includes("tmall.com")) return "天猫";
  if (url.includes("taobao.com")) return "淘宝";
  if (url.includes("jd.com")) return "京东";
  if (url.includes("jinritemai.com") || url.includes("douyin.com")) return "抖店";
  if (url.includes("pinduoduo.com") || url.includes("yangkeduo.com")) return "拼多多";
  if (url.includes("weixin.qq.com") || url.includes("channels.weixin.qq.com")) return "视频号小店";
  return "";
}

function sourceShopPlatform(row) {
  return parseSourceShopIdentity(row.sourceShopName).platform || inferPlatformFromUrl(row.rawUrl) || "未识别平台";
}

function linkNeedsUpdate(link, row) {
  if (!link || link.currentState !== "active") return Boolean(link);
  const canonicalUrl = canonicalizeSalesUrl(row.rawUrl);
  return [
    [row.platformGoodsCode, link.platformGoodsCode], [row.title, link.title],
    [canonicalUrl, link.canonicalUrl], [row.status, link.status],
    [row.activityStatus, link.activityStatus], [row.category, link.category],
    [row.sourceModifiedAt, link.lastModifiedAt],
  ].some(([source, current]) => text(source) && !sameValue(source, current));
}

function skuNeedsUpdate(sku, row) {
  if (!sku || sku.currentState !== "active") return Boolean(sku);
  return [
    [row.merchantSkuCode, sku.platformSkuCode], [row.platformSkuName, sku.specificationName],
    [row.systemGoodsType, sku.systemGoodsType], [row.lastSyncedAt, sku.lastSyncedAt],
    [row.stopSyncReason, sku.stopSyncReason],
  ].some(([source, current]) => text(source) && !sameValue(source, current)) || [
    [row.price, sku.price], [row.platformStock, sku.platformStock], [row.occupiedStock, sku.occupiedStock],
    [row.syncEnabled, sku.syncEnabled], [row.lastSyncedStock, sku.lastSyncedStock],
  ].some(([source, current]) => source !== null && source !== undefined && !sameNumber(source, current));
}

function actionResult(row, values = {}) {
  const result = {
    ...row,
    action: "sync",
    exceptionType: null,
    message: "已完成资产差异分析。",
    shopAction: null,
    linkAction: null,
    skuAction: null,
    relationAction: null,
    ...values,
  };
  if (result.action === "ignored") return result;
  if ([result.shopAction, result.linkAction, result.skuAction].includes("exception")) {
    result.action = result.shopAction === "exception" ? "exception" : "partial";
  }
  return result;
}

function analyzeRows(rows) {
  const db = getDatabase();
  const shops = db.prepare("SELECT id,platform,shopName,displayName,rawShopName,status,createdAt FROM sales_shops").all();
  const exactShopNames = new Map();
  for (const shop of shops) {
    for (const name of new Set([text(shop.shopName), text(shop.displayName), text(shop.rawShopName)].filter(Boolean))) {
      const matches = exactShopNames.get(name) || [];
      matches.push(shop);
      exactShopNames.set(name, matches);
    }
  }
  const links = db.prepare("SELECT * FROM sales_links").all();
  const linkMap = new Map();
  for (const link of links) {
    const key = `${link.shopId}\u0000${text(link.platformGoodsId)}`;
    const matches = linkMap.get(key) || [];
    matches.push(link);
    linkMap.set(key, matches);
  }
  const linkIds = links.map((row) => row.id);
  const platformSkus = linkIds.length
    ? db.prepare(`SELECT * FROM sales_link_skus WHERE salesLinkId IN (${linkIds.map(() => "?").join(",")})`).all(...linkIds)
    : [];
  const skuMap = new Map();
  for (const row of platformSkus) {
    const key = `${row.salesLinkId}\u0000${text(row.platformSkuId)}`;
    const list = skuMap.get(key) || [];
    list.push(row); skuMap.set(key, list);
  }
  const erpMap = new Map();
  for (const erpSku of db.prepare("SELECT id,merchantSkuCode FROM erp_skus WHERE currentState='active'").all()) {
    const key = lower(erpSku.merchantSkuCode);
    const list = erpMap.get(key) || [];
    list.push(erpSku);
    erpMap.set(key, list);
  }
  const activeMappingMap = new Map();
  for (const mapping of db.prepare(`SELECT r.linkSkuId salesLinkSkuId,c.erpSkuId
    FROM sales_link_sku_sales_object_relations r
    JOIN sales_objects o ON o.id=r.salesObjectId AND o.status='active'
    JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
    JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE r.status='active' ORDER BY r.linkSkuId,c.sortOrder,c.erpSkuId`).all()) {
    const mappings = activeMappingMap.get(mapping.salesLinkSkuId) || [];
    mappings.push(mapping);
    activeMappingMap.set(mapping.salesLinkSkuId, mappings);
  }
  const activeRelationMap = new Map();
  for (const relation of db.prepare(`SELECT linkSkuId,salesObjectId
    FROM sales_link_sku_sales_object_relations WHERE status='active' ORDER BY linkSkuId,id`).all()) {
    const relations = activeRelationMap.get(relation.linkSkuId) || [];
    relations.push(relation);
    activeRelationMap.set(relation.linkSkuId, relations);
  }
  const bundleObjectMap = new Map();
  for (const object of db.prepare(`SELECT o.id,o.objectCode,o.normalizedObjectCode,
      (SELECT COUNT(*) FROM sales_object_structures s
        WHERE s.salesObjectId=o.id AND s.status='active') activeStructureCount,
      (SELECT COUNT(*) FROM sales_object_structures s
        JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
        WHERE s.salesObjectId=o.id AND s.status='active') componentCount,
      (SELECT COUNT(*) FROM sales_object_structures s
        JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
        LEFT JOIN erp_skus e ON e.id=c.erpSkuId AND e.currentState='active'
        WHERE s.salesObjectId=o.id AND s.status='active'
          AND (c.erpSkuId IS NULL OR c.quantity IS NULL OR c.quantity<=0 OR e.id IS NULL)) invalidComponentCount
    FROM sales_objects o WHERE o.status='active' AND o.objectType='bundle'`).all()) {
    const key = lower(object.normalizedObjectCode || object.objectCode);
    if (!key) continue;
    const objects = bundleObjectMap.get(key) || [];
    objects.push({
      ...object,
      structureComplete: Number(object.activeStructureCount) === 1
        && Number(object.componentCount) > 0
        && Number(object.invalidComponentCount) === 0,
    });
    bundleObjectMap.set(key, objects);
  }
  const seenSkuIds = new Set();
  const evaluated = [];

  for (const row of rows) {
    if (isNonBusinessRow(row)) {
      evaluated.push(actionResult(row, {
        action: "ignored", shopAction: "ignored", linkAction: "ignored", skuAction: "ignored", relationAction: "ignored",
        exceptionType: "non_business_row",
        message: "汇总或无效行已过滤，不进入店铺匹配和异常治理。",
      }));
      continue;
    }
    if (!row.sourceShopName) {
      evaluated.push(actionResult(row, { action: "exception", shopAction: "exception", linkAction: "exception", skuAction: "exception", relationAction: "blocked", exceptionType: "missing_shop_name", message: "店铺字段为空，无法识别平台资产。" }));
      continue;
    }
    const platform = sourceShopPlatform(row);
    let matchedShops = exactShopNames.get(row.sourceShopName) || [];
    if (matchedShops.length > 1) {
      const samePlatform = matchedShops.filter((shop) => shop.platform === platform);
      if (samePlatform.length === 1) matchedShops = samePlatform;
    }
    if (matchedShops.length > 1) {
      evaluated.push(actionResult(row, { action: "exception", shopAction: "exception", linkAction: "exception", skuAction: "exception", relationAction: "blocked", exceptionType: "ambiguous_shop", message: `店铺“${row.sourceShopName}”匹配到多个系统店铺。` }));
      continue;
    }
    let shop = matchedShops[0] || null;
    let shopAction = "unchanged";
    if (!shop) {
      const id = stableId("sales-shop", lower(row.sourceShopName));
      shop = { id, platform, shopName: row.sourceShopName, displayName: row.sourceShopName, status: "active", createdAt: null };
      shopAction = "new";
    } else if (shop.status !== "active") {
      shopAction = "update";
    }
    const base = { shopId: shop.id, platform: shop.platform, shopName: shop.shopName, shopAction };
    if (!row.platformGoodsId) {
      evaluated.push(actionResult(row, { ...base, linkAction: "exception", skuAction: "exception", relationAction: "blocked", exceptionType: "missing_platform_goods_id", message: "货品ID为空，不能创建Link身份。" }));
      continue;
    }
    const identity = `${shop.id}\u0000${row.platformGoodsId}\u0000${row.platformSkuId}`;
    const matchedLinks = linkMap.get(`${shop.id}\u0000${row.platformGoodsId}`) || [];
    if (matchedLinks.length > 1) {
      evaluated.push(actionResult(row, { ...base, linkAction: "exception", skuAction: "exception", relationAction: "blocked", exceptionType: "ambiguous_sales_link", message: "同一店铺和货品ID匹配到多个Link。" }));
      continue;
    }
    const salesLink = matchedLinks[0] || null;
    const salesLinkId = salesLink?.id || stableId("sales-link", `${shop.id}|${row.platformGoodsId}`);
    const linkAction = salesLink ? (linkNeedsUpdate(salesLink, row) ? "update" : "unchanged") : "new";
    if (!row.platformSkuId) {
      evaluated.push(actionResult(row, { ...base, salesLinkId, linkAction, skuAction: "exception", relationAction: "blocked", exceptionType: "missing_platform_sku_id", message: "规格ID为空，Link可同步，但不能创建Link SKU。" }));
      continue;
    }
    if (seenSkuIds.has(identity)) {
      evaluated.push(actionResult(row, { ...base, salesLinkId, linkAction, skuAction: "exception", relationAction: "blocked", exceptionType: "duplicate_platform_sku", message: "文件内平台SKU重复，仅保留首条参与同步。" }));
      continue;
    }
    seenSkuIds.add(identity);
    const matchedPlatformSkus = skuMap.get(`${salesLinkId}\u0000${row.platformSkuId}`) || [];
    if (matchedPlatformSkus.length > 1) {
      evaluated.push(actionResult(row, { ...base, salesLinkId, linkAction, skuAction: "exception", relationAction: "blocked", exceptionType: "ambiguous_platform_sku", message: "规格ID匹配到多个Link SKU。" }));
      continue;
    }
    const platformSku = matchedPlatformSkus[0] || null;
    const salesLinkSkuId = platformSku?.id || stableId("sales-link-sku", `${salesLinkId}|${row.platformSkuId}`);
    const skuAction = platformSku ? (skuNeedsUpdate(platformSku, row) ? "update" : "unchanged") : "new";
    const relationBase = { ...base, salesLinkId, salesLinkSkuId, linkAction, skuAction };
    const activeMappings = activeMappingMap.get(salesLinkSkuId) || [];
    if (COMBO_GOODS_TYPES.has(row.systemGoodsType)) {
      if (!row.merchantSkuCode) {
        evaluated.push(actionResult(row, {
          ...relationBase,
          relationAction: "unresolved",
          exceptionType: "missing_combo_sales_object_code",
          message: "组合商品的平台规格编码为空，无法识别对应商品结构。",
        }));
        continue;
      }
      const matchedBundleObjects = bundleObjectMap.get(lower(row.merchantSkuCode)) || [];
      if (!matchedBundleObjects.length) {
        evaluated.push(actionResult(row, {
          ...relationBase,
          relationAction: "unresolved",
          exceptionType: "missing_combo_sales_object",
          message: "平台规格编码未匹配到组合Sales Object，需要先同步或确认组合商品档案。",
        }));
        continue;
      }
      if (matchedBundleObjects.length > 1) {
        evaluated.push(actionResult(row, {
          ...relationBase,
          relationAction: "conflict",
          exceptionType: "ambiguous_combo_sales_object",
          message: "平台规格编码匹配到多个组合Sales Object，需要人工确认。",
        }));
        continue;
      }
      const bundleObject = matchedBundleObjects[0];
      const activeRelations = activeRelationMap.get(salesLinkSkuId) || [];
      const exactRelation = activeRelations.some((item) => item.salesObjectId === bundleObject.id);
      const conflictingRelations = activeRelations.filter((item) => item.salesObjectId !== bundleObject.id);
      if (conflictingRelations.length) {
        evaluated.push(actionResult(row, {
          ...relationBase,
          relationAction: "conflict",
          exceptionType: "existing_sales_object_conflict",
          message: "Link SKU当前关联的组合商品对象与平台规格编码不一致，需要人工确认。",
          rawData: {
            ...row.rawData,
            currentSalesObjectIds: conflictingRelations.map((item) => item.salesObjectId),
            expectedSalesObjectId: bundleObject.id,
          },
        }));
      } else if (!bundleObject.structureComplete) {
        evaluated.push(actionResult(row, {
          ...relationBase,
          relationAction: "governance",
          exceptionType: "product_structure_pending",
          message: "组合Sales Object已识别，但Product Structure尚未完整生效。",
          rawData: { ...row.rawData, expectedSalesObjectId: bundleObject.id },
        }));
      } else if (exactRelation) {
        evaluated.push(actionResult(row, {
          ...relationBase,
          relationAction: "existing",
          message: "组合商品对象及Product Structure均已生效，组成关系完整。",
          rawData: { ...row.rawData, expectedSalesObjectId: bundleObject.id },
        }));
      } else {
        evaluated.push(actionResult(row, {
          ...relationBase,
          relationAction: "candidate",
          message: "已精确匹配完整的组合商品结构，确认后生成关系候选，不直接修改正式关系。",
          rawData: { ...row.rawData, expectedSalesObjectId: bundleObject.id },
        }));
      }
      continue;
    }
    if (NO_ERP_RELATION_TYPES.has(row.systemGoodsType)) {
      evaluated.push(actionResult(row, { ...relationBase, relationAction: "not_applicable", message: "该平台规格无需建立ERP商品关系。" }));
      continue;
    }
    if (!row.merchantSkuCode) {
      evaluated.push(actionResult(row, { ...relationBase, relationAction: "unresolved", exceptionType: "missing_erp_sku_code", message: "资产可同步；平台规格编码为空，ERP关系待识别。" }));
      continue;
    }
    const matchedErpSkus = erpMap.get(lower(row.merchantSkuCode)) || [];
    if (!matchedErpSkus.length) {
      evaluated.push(actionResult(row, { ...relationBase, relationAction: "unresolved", exceptionType: "missing_erp_sku", message: "资产可同步；平台规格编码未匹配到ERP SKU，关系待识别。" }));
      continue;
    }
    if (matchedErpSkus.length > 1) {
      evaluated.push(actionResult(row, { ...relationBase, relationAction: "conflict", exceptionType: "ambiguous_erp_sku", message: "资产可同步；ERP SKU编码存在歧义。" }));
      continue;
    }
    const erpSku = matchedErpSkus[0];
    const exactMapping = activeMappings.some((item) => item.erpSkuId === erpSku.id);
    const conflictingMappings = activeMappings.filter((item) => item.erpSkuId !== erpSku.id);
    if (exactMapping) {
      evaluated.push(actionResult(row, { ...relationBase, erpSkuId: erpSku.id, relationAction: "existing", message: "资产差异已分析，ERP关系已存在。" }));
    } else if (conflictingMappings.length) {
      evaluated.push(actionResult(row, {
        ...relationBase, erpSkuId: erpSku.id, relationAction: "conflict",
        exceptionType: "existing_erp_sku_conflict",
        message: "当前Product Structure不包含文件中的ERP SKU，需要人工治理。",
        rawData: { ...row.rawData, currentErpSkuIds: conflictingMappings.map((item) => item.erpSkuId), expectedErpSkuId: erpSku.id },
      }));
    } else {
      evaluated.push(actionResult(row, { ...relationBase, erpSkuId: erpSku.id, relationAction: "candidate", message: "资产确认后由V3自动投影建立Sales Object关系，不进入正常人工审批。" }));
    }
  }
  return { evaluated };
}

function decodedRaw(row) {
  if (row.rawData && typeof row.rawData === "object") return row.rawData;
  try { return JSON.parse(row.rawDataJson || "{}"); } catch { return {}; }
}

function exceptionReason(row) {
  const code = text(row.exceptionType) || "unknown";
  return { code, reason: EXCEPTION_REASON_LABELS[code] || text(row.message) || "需要人工确认" };
}

function summarizeDimension(rows, actionField, keyFor) {
  const priorities = { exception: 9, conflict: 9, unresolved: 9, blocked: 9, governance: 8, new: 7, candidate: 7, update: 6, unchanged: 4, existing: 4, not_applicable: 3, ignored: 1 };
  const entities = new Map();
  for (const row of rows) {
    const action = text(row[actionField]);
    if (!action || action === "ignored") continue;
    const key = keyFor(row, decodedRaw(row));
    const current = entities.get(key);
    if (!current || (priorities[action] || 0) > (priorities[current.action] || 0)) entities.set(key, { action, row });
  }
  const values = [...entities.values()];
  const count = (action) => values.filter((value) => value.action === action).length;
  const reasons = new Map();
  for (const value of values.filter((item) => item.action === "exception")) {
    const item = exceptionReason(value.row);
    const current = reasons.get(item.code) || { ...item, count: 0 };
    current.count += 1;
    reasons.set(item.code, current);
  }
  return {
    total: entities.size,
    new: count("new"),
    updated: count("update"),
    unchanged: count("unchanged"),
    exception: count("exception"),
    exceptionReasons: [...reasons.values()].sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, "zh-CN")),
  };
}

function summarizePlatformSkuCodeDimension(rows, kind) {
  const priorities = { exception: 9, new: 7, update: 6, unchanged: 4 };
  const entities = new Map();
  for (const row of rows) {
    const goodsType = text(row.systemGoodsType);
    if (NO_ERP_RELATION_TYPES.has(goodsType)) continue;
    const isCombo = COMBO_GOODS_TYPES.has(goodsType);
    if ((kind === "combo") !== isCombo) continue;
    const relationAction = text(row.relationAction);
    if (!relationAction || ["ignored", "not_applicable"].includes(relationAction)) continue;
    const action = relationAction === "candidate" ? "new"
      : relationAction === "existing" ? "unchanged"
        : "exception";
    const key = text(row.salesLinkSkuId)
      || `${text(row.shopId) || text(row.sourceShopName)}|${text(row.platformGoodsId)}|${text(row.platformSkuId) || row.rowNumber}`;
    const current = entities.get(key);
    if (!current || priorities[action] > priorities[current.action]) entities.set(key, { action, row });
  }
  const values = [...entities.values()];
  const count = (action) => values.filter((value) => value.action === action).length;
  const reasons = new Map();
  for (const value of values.filter((item) => item.action === "exception")) {
    const item = exceptionReason(value.row);
    const current = reasons.get(item.code) || { ...item, count: 0 };
    current.count += 1;
    reasons.set(item.code, current);
  }
  return {
    total: entities.size,
    new: count("new"),
    updated: count("update"),
    unchanged: count("unchanged"),
    exception: count("exception"),
    exceptionReasons: [...reasons.values()].sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, "zh-CN")),
  };
}

function summaryFor(batch, rows) {
  const normalizedRows = rows.map((row) => row.shopAction || row.linkAction || row.skuAction || row.relationAction ? row : {
    ...row,
    shopAction: row.action === "exception" ? "exception" : "unchanged",
    linkAction: row.action === "exception" ? "exception" : "unchanged",
    skuAction: row.action === "exception" ? "exception" : "unchanged",
    relationAction: row.action === "already_linked" ? "existing" : row.action === "link" ? "candidate" : row.action === "exception" ? "conflict" : "ignored",
  });
  const activeRows = normalizedRows.filter((row) => row.action !== "ignored");
  const shops = summarizeDimension(activeRows, "shopAction", (row) => text(row.shopId) || text(row.sourceShopName) || `row:${row.rowNumber}`);
  const links = summarizeDimension(activeRows, "linkAction", (row) => text(row.salesLinkId) || `${text(row.shopId) || text(row.sourceShopName)}|${text(row.platformGoodsId) || `row:${row.rowNumber}`}`);
  const linkSkus = summarizeDimension(activeRows, "skuAction", (row, raw) => text(row.salesLinkSkuId) || `${text(row.salesLinkId) || text(row.sourceShopName)}|${text(row.platformSkuId) || text(row.merchantSkuCode) || text(raw["规格名称"]) || `row:${row.rowNumber}`}`);
  const relationEntities = new Map();
  const relationPriority = { conflict: 7, unresolved: 6, candidate: 5, governance: 4, existing: 3, not_applicable: 2, blocked: 1 };
  for (const row of activeRows) {
    const action = text(row.relationAction);
    if (!relationPriority[action]) continue;
    const key = `${text(row.salesLinkSkuId) || `${text(row.sourceShopName)}|${text(row.platformGoodsId)}|${text(row.platformSkuId) || row.rowNumber}`}|${text(row.erpSkuId) || text(row.merchantSkuCode) || "unresolved"}`;
    const current = relationEntities.get(key);
    if (!current || relationPriority[action] > relationPriority[current]) relationEntities.set(key, action);
  }
  const relationCount = (action) => [...relationEntities.values()].filter((value) => value === action).length;
  const erpRelations = {
    total: relationEntities.size,
    existing: relationCount("existing"),
    newCandidates: relationCount("candidate"),
    governancePending: relationCount("governance"),
    notApplicable: relationCount("not_applicable"),
    identityBlocked: relationCount("blocked"),
    unresolved: relationCount("unresolved"),
    conflicts: relationCount("conflict"),
  };
  const platformSkuCodes = {
    single: summarizePlatformSkuCodeDimension(activeRows, "single"),
    combo: summarizePlatformSkuCodeDimension(activeRows, "combo"),
  };
  const exceptions = normalizedRows.filter((row) => row.action === "exception" || row.action === "partial" || ["unresolved", "conflict"].includes(row.relationAction));
  const types = Object.fromEntries([...new Set(exceptions.map((row) => row.exceptionType))].map((type) => [type, exceptions.filter((row) => row.exceptionType === type).length]));
  return {
    fileName: batch.fileName, fileHash: batch.scope?.sourceFileHash || batch.fileHash, parserVersion: batch.scope?.parserVersion || PARSER_VERSION, periodStart: batch.periodStart, periodEnd: batch.periodEnd,
    sourceRows: normalizedRows.length, totalPlatformSkus: activeRows.filter((row) => row.platformSkuId).length,
    shops, links, linkSkus, platformSkuCodes, erpRelations,
    createdAssets: shops.new + links.new + linkSkus.new,
    updatedAssets: shops.updated + links.updated + linkSkus.updated,
    unchangedAssets: shops.unchanged + links.unchanged + linkSkus.unchanged,
    linkable: erpRelations.newCandidates, alreadyLinked: erpRelations.existing, exceptionCount: exceptions.length,
    ignoredNonBusiness: normalizedRows.filter((row) => row.action === "ignored" && row.exceptionType === "non_business_row").length,
    bundleCount: types.missing_product_structure || 0, exceptionTypes: types,
    sourceShopCount: shops.total,
    matchedShopCount: shops.total - shops.exception,
  };
}

function listFileAnalysisHistory(taskId, sourceFileHash) {
  const db = getDatabase();
  const current = db.prepare("SELECT id FROM data_sync_batches WHERE taskId=? AND status='preview_ready' ORDER BY createdAt DESC,id DESC LIMIT 1").get(taskId);
  return db.prepare(`SELECT id,fileName,status,createdAt,completedAt,totalCount,createdCount,updatedCount,exceptionCount,scopeJson
    FROM data_sync_batches
    WHERE taskId=? AND sourceBatchType=? AND json_extract(scopeJson,'$.sourceFileHash')=?
    ORDER BY createdAt DESC,id DESC`).all(taskId, SOURCE_BATCH_TYPE, sourceFileHash).map((row) => {
    let scope = {};
    try { scope = JSON.parse(row.scopeJson || "{}"); } catch { scope = {}; }
    return {
      id: row.id,
      fileName: row.fileName,
      status: row.status,
      analyzedAt: row.createdAt,
      completedAt: row.completedAt,
      totalCount: Number(row.totalCount || 0),
      createdCount: Number(row.createdCount || 0),
      updatedCount: Number(row.updatedCount || 0),
      exceptionCount: Number(row.exceptionCount || 0),
      isCurrent: current?.id === row.id && row.status === "preview_ready",
      reanalysisOf: scope.reanalysisOf || null,
    };
  });
}

function retainSourceFile({ sourceFileHash, fileName, buffer, createdBy }) {
  const db = getDatabase();
  const uploadedAt = new Date().toISOString();
  db.prepare(`INSERT INTO platform_goods_excel_source_files
    (sourceFileHash,fileName,contentBlob,firstUploadedAt,lastUploadedAt,uploadedBy)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(sourceFileHash) DO UPDATE SET
      fileName=excluded.fileName,
      contentBlob=excluded.contentBlob,
      lastUploadedAt=excluded.lastUploadedAt,
      uploadedBy=COALESCE(excluded.uploadedBy,platform_goods_excel_source_files.uploadedBy)`)
    .run(sourceFileHash, text(fileName) || "平台货品.xlsx", buffer, uploadedAt, uploadedAt, text(createdBy) || null);
}

function createPlatformGoodsExcelAnalysis({ taskId, buffer, fileName, createdBy = "", sourceFileHash, reanalysisOf = null }) {
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== TASK_CODE) throw new Error("平台货品关系导入任务不存在。");
  const fileHash = reanalysisOf
    ? crypto.createHash("sha256").update(buffer).update(`\0${PARSER_VERSION}\0reanalysis:${crypto.randomUUID()}`).digest("hex")
    : crypto.createHash("sha256").update(buffer).update(`\0${PARSER_VERSION}`).digest("hex");

  const parsed = parseWorkbook(buffer);
  const analysis = analyzeRows(parsed.rows);
  const dates = parsed.rows.map((row) => row.sourceModifiedAt).filter((value) => /^\d{4}-\d{2}-\d{2}/u.test(value)).sort();
  const snapshot = classifyPlatformSnapshot(parsed.rows);
  const scope = { shopMode: snapshot.mode === "full" ? "excel_all" : "partial", sourceShopNames: snapshot.sourceShopNames,
    platformSnapshotMode: snapshot.mode, platformSnapshotBusinessShopCount: snapshot.businessShopCount,
    platformSnapshotHasSummaryRow: snapshot.hasSummaryRow, platformSnapshotReason: snapshot.reason,
    sheetName: parsed.sheetName, parserVersion: PARSER_VERSION, sourceFileHash, reanalysisOf };
  const batch = createDataSyncBatch(taskId, { triggerMode: "manual", syncMode: "full", fileName, fileHash, periodStart: dates[0] || null, periodEnd: dates.at(-1) || null, scope, createdBy });
  const db = getDatabase();
  const insert = db.prepare(`INSERT INTO platform_goods_excel_import_rows (batchId,rowNumber,sourceShopName,shopId,platform,platformGoodsId,platformSkuId,merchantSkuCode,systemGoodsType,salesLinkId,salesLinkSkuId,erpSkuId,action,shopAction,linkAction,skuAction,relationAction,exceptionType,message,rawDataJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const row of analysis.evaluated) insert.run(batch.id, row.rowNumber, row.sourceShopName, row.shopId || null, row.platform || null, row.platformGoodsId || null, row.platformSkuId || null, row.merchantSkuCode || null, row.systemGoodsType || null, row.salesLinkId || null, row.salesLinkSkuId || null, row.erpSkuId || null, row.action, row.shopAction || null, row.linkAction || null, row.skuAction || null, row.relationAction || null, row.exceptionType || null, row.message || null, JSON.stringify(row.rawData || {}));
  }).immediate();
  const staged = db.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? ORDER BY rowNumber").all(batch.id);
  const summary = summaryFor({ ...batch, periodStart: dates[0] || null, periodEnd: dates.at(-1) || null }, staged);
  const exceptions = staged.filter((row) => row.action === "exception" || row.action === "partial" || ["unresolved", "conflict"].includes(row.relationAction)).map((row) => ({
    exceptionType: row.exceptionType || "asset_sync_conflict",
    severity: row.relationAction === "conflict" && !["exception", "partial"].includes(row.action) ? "warning" : "error",
    message: row.message,
    entityType: row.platformSkuId ? "platform_sku" : row.platformGoodsId ? "sales_link" : "sales_shop",
    entityId: row.platformSkuId || row.platformGoodsId || row.sourceShopName,
    rawData: JSON.parse(row.rawDataJson || "{}"),
  }));
  markDataSyncBatchPreviewReady(batch.id, {
    sourceBatchType: SOURCE_BATCH_TYPE,
    sourceBatchId: batch.id,
    summary: { total: summary.sourceRows, created: summary.createdAssets, updated: summary.updatedAssets, exceptionCount: summary.exceptionCount },
    exceptions,
    message: "平台货品资产同步差异预览已生成。",
  });
  db.prepare("UPDATE data_sync_batches SET periodStart=?,periodEnd=?,scopeJson=? WHERE id=?").run(dates[0] || null, dates.at(-1) || null, JSON.stringify(scope), batch.id);
  return { ...readPlatformGoodsExcelDataSyncPreview(batch.id), reanalyzed: Boolean(reanalysisOf) };
}

export function previewPlatformGoodsExcelDataSync({ taskId, buffer, fileName, createdBy = "" }) {
  const task = getDataSyncTask(taskId);
  if (!task || task.taskCode !== TASK_CODE) throw new Error("平台货品关系导入任务不存在。");
  if (!buffer?.length) throw new Error("请选择平台货品Excel文件。");
  const sourceFileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  retainSourceFile({ sourceFileHash, fileName, buffer, createdBy });
  const history = listFileAnalysisHistory(taskId, sourceFileHash);
  if (history.length) {
    return {
      ...readPlatformGoodsExcelDataSyncPreview(history[0].id),
      duplicateFile: true,
      idempotent: true,
      requiresChoice: true,
      history,
      message: "该文件已有分析记录，可查看历史结果或按当前数据库状态重新分析。",
    };
  }
  const result = createPlatformGoodsExcelAnalysis({ taskId, buffer, fileName, createdBy, sourceFileHash });
  return { ...result, duplicateFile: false, history: listFileAnalysisHistory(taskId, sourceFileHash) };
}

export function reanalyzePlatformGoodsExcelDataSync(batchId, { createdBy = "" } = {}) {
  const batch = getDataSyncBatch(batchId);
  if (!batch || batch.sourceBatchType !== SOURCE_BATCH_TYPE) throw new Error("平台货品历史分析记录不存在。");
  const sourceFileHash = batch.scope?.sourceFileHash;
  if (!sourceFileHash) throw new Error("该历史记录缺少原文件标识，请重新上传原文件后再分析。");
  const source = getDatabase().prepare("SELECT fileName,contentBlob FROM platform_goods_excel_source_files WHERE sourceFileHash=?").get(sourceFileHash);
  if (!source?.contentBlob?.length) throw new Error("该历史记录未保留原文件，请重新上传同一文件后再选择重新分析。");
  const result = createPlatformGoodsExcelAnalysis({
    taskId: batch.taskId,
    buffer: source.contentBlob,
    fileName: source.fileName || batch.fileName,
    createdBy,
    sourceFileHash,
    reanalysisOf: batch.id,
  });
  return { ...result, history: listFileAnalysisHistory(batch.taskId, sourceFileHash) };
}

export function readPlatformGoodsExcelDataSyncPreview(batchId) {
  const db = getDatabase();
  const batch = getDataSyncBatch(batchId);
  if (!batch || batch.sourceBatchType !== SOURCE_BATCH_TYPE) throw new Error("平台货品Excel导入预览不存在。");
  const rows = db.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? ORDER BY rowNumber").all(batchId);
  const current = db.prepare("SELECT id FROM data_sync_batches WHERE taskId=? AND status='preview_ready' ORDER BY createdAt DESC,id DESC LIMIT 1").get(batch.taskId);
  return { dataSyncBatch: batch, summary: summaryFor(batch, rows), isCurrent: batch.status === "preview_ready" && current?.id === batch.id, preview: rows.slice(0, 200).map((row) => ({ ...row, rawData: JSON.parse(row.rawDataJson || "{}") })), history: batch.scope?.sourceFileHash ? listFileAnalysisHistory(batch.taskId, batch.scope.sourceFileHash) : [] };
}

export function commitPlatformGoodsExcelDataSync(batchId) {
  const existingBatch = getDataSyncBatch(batchId);
  if (existingBatch && ["succeeded", "partial"].includes(existingBatch.status)) {
    const database = getDatabase();
    const allExistingRows = database.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? ORDER BY rowNumber").all(batchId);
    const existingRows = allExistingRows.filter((row) => row.action !== "ignored");
    const snapshot = classifyStoredPlatformSnapshot(existingBatch, allExistingRows);
    persistPlatformSnapshotClassification(database, existingBatch, snapshot);
    if (snapshot.mode === "full" && existingBatch.status !== "succeeded") {
      database.prepare("UPDATE data_sync_batches SET status='succeeded' WHERE id=?").run(batchId);
    }
    const refreshedBatch = getDataSyncBatch(batchId);
    const existingSummary = summaryFor(existingBatch, existingRows);
    return {
      dataSyncBatch: refreshedBatch,
      idempotent: true,
      result: {
        shops: { created: 0, updated: 0, unchanged: existingSummary.shops.total - existingSummary.shops.exception, exceptions: existingSummary.shops.exception },
        links: { created: 0, updated: 0, unchanged: existingSummary.links.total - existingSummary.links.exception, exceptions: existingSummary.links.exception },
        linkSkus: { created: 0, updated: 0, unchanged: existingSummary.linkSkus.total - existingSummary.linkSkus.exception, exceptions: existingSummary.linkSkus.exception },
        erpRelations: { existing: existingSummary.erpRelations.existing, candidates: 0, conflicts: existingSummary.erpRelations.conflicts },
      },
      originalPreview: existingSummary,
      operatingSet: getLinkOperatingSummary({ database }),
      platformSnapshot: snapshot,
      protected: { salesFactsChanged: 0, formalSalesObjectsChanged: 0, formalProductStructuresChanged: 0, linksDeleted: 0, linkSkusDeleted: 0, erpRelationsDeleted: 0 },
    };
  }
  const batch = assertCurrentDataSyncPreview(batchId);
  if (batch.sourceBatchType !== SOURCE_BATCH_TYPE) throw new Error("当前批次不是平台货品资产同步预览。");
  if (batch.scope?.parserVersion !== PARSER_VERSION) throw new Error("该预览来自旧版解析规则，请重新上传文件生成资产差异预览。");
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? AND action<>'ignored' ORDER BY rowNumber").all(batchId);
  const allRows = db.prepare("SELECT * FROM platform_goods_excel_import_rows WHERE batchId=? ORDER BY rowNumber").all(batchId);
  const snapshot = classifyStoredPlatformSnapshot(batch, allRows);
  persistPlatformSnapshotClassification(db, batch, snapshot);
  const isCompleteSnapshot = snapshot.mode === "full";
  const raw = (row) => decodedRaw(row);
  const tableCount = (name) => db.prepare("SELECT COUNT(*) total FROM sqlite_master WHERE type='table' AND name=?").get(name).total
    ? Number(db.prepare(`SELECT COUNT(*) total FROM ${name}`).get().total) : null;
  const protectedBefore = {
    dailyFacts: tableCount("connection_sku_sales_daily_facts"),
    salesObjects: tableCount("sales_objects"),
    structures: tableCount("sales_object_structures"),
    structureComponents: tableCount("sales_object_structure_components"),
  };
  const commitSummary = summaryFor(batch, rows);
  const committedAt = new Date().toISOString();
  db.transaction(() => {
    const shopRows = new Map();
    for (const row of rows.filter((item) => item.shopAction && item.shopAction !== "exception")) if (!shopRows.has(row.shopId)) shopRows.set(row.shopId, row);
    for (const row of shopRows.values()) {
      const current = db.prepare("SELECT * FROM sales_shops WHERE id=?").get(row.shopId);
      if (!current) {
        db.prepare(`INSERT INTO sales_shops (id,platform,shopName,normalizedShopName,displayName,rawShopName,status,notes,createdAt,updatedAt)
          VALUES (?,?,?,?,?,?, 'active',NULL,?,?)`).run(row.shopId, row.platform || "未识别平台", row.sourceShopName, lower(row.sourceShopName), row.sourceShopName, row.sourceShopName, committedAt, committedAt);
      } else if (current.status !== "active") {
        db.prepare("UPDATE sales_shops SET status='active',updatedAt=? WHERE id=?").run(committedAt, row.shopId);
      }
    }

    const linkRows = new Map();
    for (const row of rows.filter((item) => item.linkAction && item.linkAction !== "exception")) if (!linkRows.has(row.salesLinkId)) linkRows.set(row.salesLinkId, row);
    for (const row of linkRows.values()) {
      const source = raw(row);
      const rawUrl = text(source["平台商品链接"]);
      const values = {
        id: row.salesLinkId, shopId: row.shopId, platformGoodsId: row.platformGoodsId,
        platformGoodsCode: text(source["平台货品编号"]) || null,
        title: text(source["货品名称"]) || null,
        canonicalUrl: canonicalizeSalesUrl(rawUrl) || null,
        status: text(source["状态"]) || null, activityStatus: text(source["活动状态"]) || null,
        category: text(source["平台类目"]) || null, lastModifiedAt: text(source["最后修改时间"]) || null,
        lastImportedAt: committedAt, createdAt: committedAt, updatedAt: committedAt,
      };
      db.prepare(`INSERT INTO sales_links
        (id,shopId,platformGoodsId,platformGoodsCode,title,canonicalUrl,status,activityStatus,category,identityStrength,lastModifiedAt,lastImportedAt,createdAt,updatedAt,currentState,missingAt,originSource,enrichmentStatus)
        VALUES (@id,@shopId,@platformGoodsId,@platformGoodsCode,@title,@canonicalUrl,@status,@activityStatus,@category,'strong',@lastModifiedAt,@lastImportedAt,@createdAt,@updatedAt,'active',NULL,'platform_goods_excel','complete')
        ON CONFLICT(id) DO UPDATE SET
          platformGoodsCode=COALESCE(excluded.platformGoodsCode,sales_links.platformGoodsCode),
          title=COALESCE(excluded.title,sales_links.title),canonicalUrl=COALESCE(excluded.canonicalUrl,sales_links.canonicalUrl),
          status=COALESCE(excluded.status,sales_links.status),activityStatus=COALESCE(excluded.activityStatus,sales_links.activityStatus),category=COALESCE(excluded.category,sales_links.category),
          identityStrength='strong',lastModifiedAt=COALESCE(excluded.lastModifiedAt,sales_links.lastModifiedAt),
          lastImportedAt=excluded.lastImportedAt,updatedAt=excluded.updatedAt,currentState='active',missingAt=NULL,
          originSource=CASE WHEN sales_links.originSource IS NULL OR sales_links.originSource='' OR sales_links.originSource='legacy_unknown' THEN excluded.originSource ELSE sales_links.originSource END,
          enrichmentStatus='complete'`).run(values);
    }

    const skuRows = new Map();
    for (const row of rows.filter((item) => item.skuAction && item.skuAction !== "exception")) if (!skuRows.has(row.salesLinkSkuId)) skuRows.set(row.salesLinkSkuId, row);
    for (const row of skuRows.values()) {
      const source = raw(row);
      const relationReady = row.relationAction === "existing";
      const relationNotApplicable = row.relationAction === "not_applicable";
      const matchStatus = relationReady ? "erp_linked" : relationNotApplicable ? "not_applicable" : "pending_relation";
      const matchMethod = relationReady ? "sales_object" : relationNotApplicable ? "business_rule" : "product_structure_application";
      const matchReason = relationReady ? "Product Structure关系已存在" : relationNotApplicable ? "平台货品明确标记无需ERP关系" : row.message;
      db.prepare(`INSERT INTO sales_link_skus
        (id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,specificationName,normalizedSpecificationName,price,platformStock,occupiedStock,systemGoodsType,syncEnabled,lastSyncedStock,lastSyncedAt,stopSyncReason,matchStatus,matchMethod,matchReason,createdAt,updatedAt,currentState,missingAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',NULL)
        ON CONFLICT(id) DO UPDATE SET
          platformSkuCode=COALESCE(excluded.platformSkuCode,sales_link_skus.platformSkuCode),normalizedPlatformSkuCode=COALESCE(excluded.normalizedPlatformSkuCode,sales_link_skus.normalizedPlatformSkuCode),
          specificationName=COALESCE(excluded.specificationName,sales_link_skus.specificationName),normalizedSpecificationName=COALESCE(excluded.normalizedSpecificationName,sales_link_skus.normalizedSpecificationName),
          price=COALESCE(excluded.price,sales_link_skus.price),platformStock=COALESCE(excluded.platformStock,sales_link_skus.platformStock),occupiedStock=COALESCE(excluded.occupiedStock,sales_link_skus.occupiedStock),
          systemGoodsType=COALESCE(excluded.systemGoodsType,sales_link_skus.systemGoodsType),syncEnabled=excluded.syncEnabled,lastSyncedStock=COALESCE(excluded.lastSyncedStock,sales_link_skus.lastSyncedStock),
          lastSyncedAt=COALESCE(excluded.lastSyncedAt,sales_link_skus.lastSyncedAt),stopSyncReason=COALESCE(excluded.stopSyncReason,sales_link_skus.stopSyncReason),
          matchStatus=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchStatus ELSE excluded.matchStatus END,
          matchMethod=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchMethod ELSE excluded.matchMethod END,
          matchReason=CASE WHEN sales_link_skus.matchMethod='manual' OR sales_link_skus.matchStatus='matched_manual' THEN sales_link_skus.matchReason ELSE excluded.matchReason END,
          updatedAt=excluded.updatedAt,currentState='active',missingAt=NULL`).run(
        row.salesLinkSkuId, row.salesLinkId, row.platformSkuId, row.merchantSkuCode || null, lower(row.merchantSkuCode) || null,
        text(source["规格名称"]) || null, lower(source["规格名称"]) || null,
        numberValue(source["价格"]), numberValue(source["平台库存"]), numberValue(source["占用库存"]), row.systemGoodsType || null,
        text(source["是否需要同步"]) === "是" ? 1 : 0, numberValue(source["最后同步库存"]), text(source["最后同步时间"]) || null,
        text(source["停止同步原因"]) || null, matchStatus, matchMethod,
        matchReason, committedAt, committedAt,
      );
    }

    db.prepare(`UPDATE sales_link_skus SET matchStatus='pending_relation',matchMethod='v3_auto_projection',
      matchReason='等待V3平台货品→旺店通身份→Sales Object自动投影',updatedAt=?
      WHERE id IN (SELECT DISTINCT salesLinkSkuId FROM platform_goods_excel_import_rows
        WHERE batchId=? AND relationAction='candidate' AND salesLinkSkuId IS NOT NULL)`).run(committedAt, batchId);
  }).immediate();
  const protectedAfter = {
    dailyFacts: tableCount("connection_sku_sales_daily_facts"),
    salesObjects: tableCount("sales_objects"),
    structures: tableCount("sales_object_structures"),
    structureComponents: tableCount("sales_object_structure_components"),
  };
  if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) throw new Error("平台货品资产同步触发了受保护的销售事实或正式关系变化。");
  const result = {
    shops: { created: commitSummary.shops.new, updated: commitSummary.shops.updated, unchanged: commitSummary.shops.unchanged, exceptions: commitSummary.shops.exception },
    links: { created: commitSummary.links.new, updated: commitSummary.links.updated, unchanged: commitSummary.links.unchanged, exceptions: commitSummary.links.exception },
    linkSkus: { created: commitSummary.linkSkus.new, updated: commitSummary.linkSkus.updated, unchanged: commitSummary.linkSkus.unchanged, exceptions: commitSummary.linkSkus.exception },
    erpRelations: { existing: commitSummary.erpRelations.existing, candidates: commitSummary.erpRelations.newCandidates, conflicts: commitSummary.erpRelations.conflicts },
  };
  const createdCount = result.shops.created + result.links.created + result.linkSkus.created;
  const updatedCount = result.shops.updated + result.links.updated + result.linkSkus.updated;
  const exceptionCount = Number(batch.exceptionCount || 0);
  const completed = completeDataSyncBatch(batchId, {
    status: isCompleteSnapshot ? "succeeded" : "partial",
    totalCount: Number(batch.totalCount || rows.length), createdCount, updatedCount, exceptionCount,
  });
  const operatingSet = getLinkOperatingSummary({ database: db });
  return {
    dataSyncBatch: completed,
    result,
    platformSnapshot: snapshot,
    operatingSet,
    protected: {
      salesFactsChanged: 0, formalSalesObjectsChanged: 0, formalProductStructuresChanged: 0,
      linksDeleted: 0, linkSkusDeleted: 0, erpRelationsDeleted: 0,
    },
  };
}
